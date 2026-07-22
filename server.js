"use strict";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingTimeout: 25000,
  pingInterval: 25000,
  maxHttpBufferSize: 3e6
});

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIRECTORY = path.join(__dirname, "public");
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECONNECT_GRACE_MS = 30 * 60 * 1000;
const ROOM_RETENTION_MS = 48 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 100;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CHAT_MESSAGES = 100;
const MAX_LOG_ENTRIES = 200;
const PHASES = ["Untap", "Upkeep", "Draw", "Main 1", "Combat", "Main 2", "End"];
const ZONES = new Set(["hand", "battlefield", "graveyard", "exile", "commandZone", "library"]);
const ALLOWED_MAX_PLAYERS = new Set([2, 3, 4, 5, 6]);
const ALLOWED_STARTING_LIFE = new Set([20, 30, 40, 50, 60]);
const SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
const SCRYFALL_BATCH_SIZE = 75;
const CARD_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CARD_LOOKUP_MAX_NAMES = 150;
const CARD_LOOKUP_USER_AGENT = process.env.SCRYFALL_USER_AGENT || "TornCommanderSandbox/9.0 (+https://torn-commander-sandbox.onrender.com)";

const rooms = new Map();
const disconnectTimers = new Map();
const persistenceTimers = new Map();
const persistenceChains = new Map();
const cardLookupCache = new Map();

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const databaseState = {
  enabled: Boolean(DATABASE_URL),
  ready: false,
  loadedRooms: 0,
  lastSavedAt: null,
  lastError: null
};
const databasePool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
    })
  : null;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "3mb" }));
app.use(express.urlencoded({ extended: true, limit: "3mb" }));
app.use(express.static(PUBLIC_DIRECTORY, {
  extensions: ["html"],
  maxAge: 0,
  etag: true,
  setHeaders(response) {
    response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  }
}));

function nowIso() {
  return new Date().toISOString();
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizeText(value, maximumLength = 100) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function normalizeRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

function normalizePlayerName(value) {
  return normalizeText(value, 24);
}

function createId() {
  return crypto.randomUUID();
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function createRoomCode() {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    let code = "";
    for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
      code += ROOM_CODE_CHARACTERS[crypto.randomInt(0, ROOM_CODE_CHARACTERS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("Unable to generate a room code.");
}

function shuffle(input) {
  const output = [...input];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(0, index + 1);
    [output[index], output[randomIndex]] = [output[randomIndex], output[index]];
  }
  return output;
}

function createStartingRollOff(playerIds) {
  return {
    round: 1,
    currentEligiblePlayerIds: [...playerIds],
    currentRolls: {},
    rounds: [],
    tiedPlayerIds: [],
    winnerPlayerId: null,
    winningRoll: null,
    completed: false
  };
}

function migrateStartingRollOff(value, playerIds) {
  const validIds = new Set(playerIds);
  const source = value && typeof value === "object" ? value : {};
  const eligible = Array.isArray(source.currentEligiblePlayerIds)
    ? source.currentEligiblePlayerIds.filter((id) => validIds.has(id))
    : [...playerIds];
  const currentRolls = {};
  for (const [id, rawRoll] of Object.entries(source.currentRolls || {})) {
    if (validIds.has(id)) currentRolls[id] = clamp(Math.floor(Number(rawRoll) || 0), 1, 20);
  }
  const rounds = Array.isArray(source.rounds)
    ? source.rounds.slice(-20).map((entry, index) => {
        const rolls = {};
        for (const [id, rawRoll] of Object.entries(entry?.rolls || {})) {
          if (validIds.has(id)) rolls[id] = clamp(Math.floor(Number(rawRoll) || 0), 1, 20);
        }
        return { round: clamp(Math.floor(Number(entry?.round) || index + 1), 1, 99), rolls };
      })
    : [];
  const winnerPlayerId = validIds.has(source.winnerPlayerId) ? source.winnerPlayerId : null;
  return {
    round: clamp(Math.floor(Number(source.round) || 1), 1, 99),
    currentEligiblePlayerIds: eligible.length ? eligible : winnerPlayerId ? [] : [...playerIds],
    currentRolls,
    rounds,
    tiedPlayerIds: Array.isArray(source.tiedPlayerIds) ? source.tiedPlayerIds.filter((id) => validIds.has(id)) : [],
    winnerPlayerId,
    winningRoll: source.winningRoll == null ? null : clamp(Math.floor(Number(source.winningRoll) || 1), 1, 20),
    completed: Boolean(source.completed && winnerPlayerId)
  };
}

function createClockwiseTurnOrder(playerIds, startingPlayerId) {
  if (!Array.isArray(playerIds) || playerIds.length === 0) return [];
  const startIndex = Math.max(0, playerIds.indexOf(startingPlayerId));
  return [...playerIds.slice(startIndex), ...playerIds.slice(0, startIndex)];
}

function normalizeCounterMap(value) {
  if (typeof value === "number") {
    return value === 0 ? {} : { counter: clamp(Math.floor(value), -99, 999) };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawName, rawAmount] of Object.entries(value).slice(0, 30)) {
    const name = normalizeText(rawName, 30);
    const amount = clamp(Math.floor(Number(rawAmount) || 0), -99, 999);
    if (name && amount !== 0) result[name] = amount;
  }
  return result;
}


function normalizeStringArray(value, maximumItems = 20, maximumLength = 60) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeText(entry, maximumLength))
    .filter(Boolean)
    .slice(0, maximumItems);
}

function normalizeCardFace(value) {
  if (!value || typeof value !== "object") return null;
  return {
    name: normalizeText(value.name, 150),
    manaCost: normalizeText(value.manaCost ?? value.mana_cost, 120),
    typeLine: normalizeText(value.typeLine ?? value.type_line, 200),
    oracleText: normalizeText(value.oracleText ?? value.oracle_text, 2500),
    power: normalizeText(value.power, 20),
    toughness: normalizeText(value.toughness, 20),
    loyalty: normalizeText(value.loyalty, 20),
    imageUrl: normalizeText(value.imageUrl ?? value.image_uris?.normal ?? value.image_uris?.large, 600),
    artCropUrl: normalizeText(value.artCropUrl ?? value.image_uris?.art_crop, 600)
  };
}

function normalizeCardData(value) {
  if (!value || typeof value !== "object") return null;
  const faces = (Array.isArray(value.faces) ? value.faces : value.card_faces)
    ?.map(normalizeCardFace)
    .filter(Boolean)
    .slice(0, 4) || [];
  const imageUrl = normalizeText(value.imageUrl ?? value.image_uris?.normal ?? value.image_uris?.large ?? faces[0]?.imageUrl, 600);
  const artCropUrl = normalizeText(value.artCropUrl ?? value.image_uris?.art_crop ?? faces[0]?.artCropUrl, 600);
  const card = {
    scryfallId: normalizeText(value.scryfallId ?? value.id, 100),
    oracleId: normalizeText(value.oracleId ?? value.oracle_id, 100),
    name: normalizeText(value.name, 150),
    manaCost: normalizeText(value.manaCost ?? value.mana_cost, 120),
    manaValue: clamp(Number(value.manaValue ?? value.cmc) || 0, 0, 1000),
    typeLine: normalizeText(value.typeLine ?? value.type_line, 200),
    oracleText: normalizeText(value.oracleText ?? value.oracle_text, 2500),
    keywords: normalizeStringArray(value.keywords, 40, 80),
    colors: normalizeStringArray(value.colors, 10, 4),
    colorIdentity: normalizeStringArray(value.colorIdentity ?? value.color_identity, 10, 4),
    power: normalizeText(value.power, 20),
    toughness: normalizeText(value.toughness, 20),
    loyalty: normalizeText(value.loyalty, 20),
    layout: normalizeText(value.layout, 40),
    imageUrl,
    artCropUrl,
    setCode: normalizeText(value.setCode ?? value.set, 12),
    collectorNumber: normalizeText(value.collectorNumber ?? value.collector_number, 30),
    rarity: normalizeText(value.rarity, 20),
    faces
  };
  return card.name || card.scryfallId || card.oracleId ? card : null;
}

function cardDataFromScryfall(card) {
  if (!card || typeof card !== "object") return null;
  return normalizeCardData(card);
}

function cardCacheKey(name) {
  return normalizeText(name, 150).toLocaleLowerCase("en-US");
}

function cacheCardData(requestedName, cardData, updatedAt = Date.now()) {
  const key = cardCacheKey(requestedName || cardData?.name);
  const normalized = normalizeCardData(cardData);
  if (!key || !normalized) return;
  cardLookupCache.set(key, { card: normalized, updatedAt: Number(updatedAt) || Date.now() });
  const canonicalKey = cardCacheKey(normalized.name);
  if (canonicalKey) cardLookupCache.set(canonicalKey, { card: normalized, updatedAt: Number(updatedAt) || Date.now() });
  for (const face of normalized.faces || []) {
    const faceKey = cardCacheKey(face.name);
    if (faceKey) cardLookupCache.set(faceKey, { card: normalized, updatedAt: Number(updatedAt) || Date.now() });
  }
}

function getFreshMemoryCard(name) {
  const entry = cardLookupCache.get(cardCacheKey(name));
  if (!entry || Date.now() - entry.updatedAt > CARD_CACHE_MAX_AGE_MS) return null;
  return entry.card;
}

async function loadCardsFromDatabase(names) {
  if (!databasePool || !names.length) return new Map();
  const keys = [...new Set(names.map(cardCacheKey).filter(Boolean))];
  if (!keys.length) return new Map();
  const result = await databasePool.query(
    `SELECT name_key, card_data, EXTRACT(EPOCH FROM updated_at) * 1000 AS updated_ms
     FROM commander_card_cache
     WHERE name_key = ANY($1::text[]) AND updated_at >= NOW() - INTERVAL '30 days'`,
    [keys]
  );
  const found = new Map();
  for (const row of result.rows) {
    const card = normalizeCardData(row.card_data);
    if (!card) continue;
    const updatedAt = Number(row.updated_ms) || Date.now();
    cacheCardData(row.name_key, card, updatedAt);
    found.set(row.name_key, card);
  }
  return found;
}

async function saveCardsToDatabase(entries) {
  if (!databasePool || !entries.length) return;
  const client = await databasePool.connect();
  try {
    await client.query("BEGIN");
    for (const entry of entries) {
      const key = cardCacheKey(entry.requestedName || entry.card?.name);
      const card = normalizeCardData(entry.card);
      if (!key || !card) continue;
      await client.query(
        `INSERT INTO commander_card_cache (name_key, card_data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (name_key) DO UPDATE SET card_data = EXCLUDED.card_data, updated_at = NOW()`,
        [key, JSON.stringify(card)]
      );
      const canonicalKey = cardCacheKey(card.name);
      if (canonicalKey && canonicalKey !== key) {
        await client.query(
          `INSERT INTO commander_card_cache (name_key, card_data, updated_at)
           VALUES ($1, $2::jsonb, NOW())
           ON CONFLICT (name_key) DO UPDATE SET card_data = EXCLUDED.card_data, updated_at = NOW()`,
          [canonicalKey, JSON.stringify(card)]
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchScryfallCollection(names) {
  const response = await fetch(SCRYFALL_COLLECTION_URL, {
    method: "POST",
    headers: {
      "User-Agent": CARD_LOOKUP_USER_AGENT,
      "Accept": "application/json;q=0.9,*/*;q=0.8",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ identifiers: names.map((name) => ({ name })) }),
    signal: AbortSignal.timeout(20000)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = normalizeText(payload?.details, 240) || `Scryfall returned HTTP ${response.status}.`;
    throw new Error(detail);
  }
  return {
    data: Array.isArray(payload?.data) ? payload.data : [],
    notFound: Array.isArray(payload?.not_found) ? payload.not_found : []
  };
}

async function resolveCardNames(rawNames) {
  const names = [...new Map((Array.isArray(rawNames) ? rawNames : [])
    .map((name) => normalizeText(name, 150))
    .filter(Boolean)
    .slice(0, CARD_LOOKUP_MAX_NAMES)
    .map((name) => [cardCacheKey(name), name])).values()];
  const resolved = new Map();
  const unresolved = [];

  for (const name of names) {
    const cached = getFreshMemoryCard(name);
    if (cached) resolved.set(cardCacheKey(name), cached);
    else unresolved.push(name);
  }

  if (unresolved.length && databasePool) {
    try {
      const dbCards = await loadCardsFromDatabase(unresolved);
      for (const name of unresolved) {
        const card = dbCards.get(cardCacheKey(name));
        if (card) resolved.set(cardCacheKey(name), card);
      }
    } catch (error) {
      console.warn("Card cache database read failed:", error.message);
    }
  }

  const missing = names.filter((name) => !resolved.has(cardCacheKey(name)));
  const notFound = [];
  const newlyFetched = [];

  for (let index = 0; index < missing.length; index += SCRYFALL_BATCH_SIZE) {
    const batch = missing.slice(index, index + SCRYFALL_BATCH_SIZE);
    const result = await fetchScryfallCollection(batch);
    const returnedByName = new Map();
    for (const rawCard of result.data) {
      const card = cardDataFromScryfall(rawCard);
      if (!card) continue;
      returnedByName.set(cardCacheKey(card.name), card);
      for (const face of card.faces || []) returnedByName.set(cardCacheKey(face.name), card);
    }
    const notFoundKeys = new Set(result.notFound.map((entry) => cardCacheKey(entry?.name)));
    for (const requestedName of batch) {
      const key = cardCacheKey(requestedName);
      const card = returnedByName.get(key);
      if (card) {
        resolved.set(key, card);
        cacheCardData(requestedName, card);
        newlyFetched.push({ requestedName, card });
      } else if (notFoundKeys.has(key) || !card) {
        notFound.push(requestedName);
      }
    }
    if (index + SCRYFALL_BATCH_SIZE < missing.length) await delay(125);
  }

  if (newlyFetched.length && databasePool) {
    saveCardsToDatabase(newlyFetched).catch((error) => console.warn("Card cache database write failed:", error.message));
  }

  return {
    resolved: names
      .filter((name) => resolved.has(cardCacheKey(name)))
      .map((requestedName) => ({ requestedName, card: resolved.get(cardCacheKey(requestedName)) })),
    notFound: [...new Set(notFound)]
  };
}

function migrateCard(card, fallbackOwnerId) {
  const migrated = card && typeof card === "object" ? card : {};
  const cardData = normalizeCardData(migrated.cardData || migrated);
  return {
    id: normalizeText(migrated.id, 100) || createId(),
    name: normalizeText(migrated.name || cardData?.name, 150) || "Unknown Card",
    ownerId: normalizeText(migrated.ownerId, 100) || fallbackOwnerId,
    controllerId: normalizeText(migrated.controllerId, 100) || fallbackOwnerId,
    tapped: Boolean(migrated.tapped),
    counters: normalizeCounterMap(migrated.counters),
    damageMarked: clamp(Math.floor(Number(migrated.damageMarked) || 0), 0, 999),
    token: Boolean(migrated.token),
    commander: Boolean(migrated.commander),
    power: normalizeText(migrated.power || cardData?.power, 20),
    toughness: normalizeText(migrated.toughness || cardData?.toughness, 20),
    loyalty: normalizeText(migrated.loyalty || cardData?.loyalty, 20),
    attacking: Boolean(migrated.attacking),
    blockingCardId: normalizeText(migrated.blockingCardId, 100) || null,
    notes: normalizeText(migrated.notes, 300),
    cardData
  };
}

function migrateGame(game, playerId, startingLife, allPlayerIds) {
  const source = game && typeof game === "object" ? game : {};
  const migrateZone = (name) => Array.isArray(source[name])
    ? source[name].map((card) => migrateCard(card, playerId))
    : [];
  const commanderDamage = {};
  for (const id of allPlayerIds) {
    if (id !== playerId) commanderDamage[id] = clamp(Math.floor(Number(source.commanderDamage?.[id]) || 0), 0, 99);
  }
  return {
    life: clamp(Math.floor(Number(source.life) || startingLife), -999, 9999),
    poison: clamp(Math.floor(Number(source.poison) || 0), 0, 99),
    commanderTax: clamp(Math.floor(Number(source.commanderTax) || 0), 0, 99),
    conceded: Boolean(source.conceded),
    library: migrateZone("library"),
    hand: migrateZone("hand"),
    battlefield: migrateZone("battlefield"),
    graveyard: migrateZone("graveyard"),
    exile: migrateZone("exile"),
    commandZone: migrateZone("commandZone"),
    commanderDamage
  };
}

function migrateRoom(room) {
  if (!room || typeof room !== "object" || !Array.isArray(room.players)) return null;
  room.code = normalizeRoomCode(room.code);
  if (room.code.length !== ROOM_CODE_LENGTH) return null;
  room.maxPlayers = ALLOWED_MAX_PLAYERS.has(Number(room.maxPlayers)) ? Number(room.maxPlayers) : 6;
  room.startingLife = ALLOWED_STARTING_LIFE.has(Number(room.startingLife)) ? Number(room.startingLife) : 40;
  room.status = ["waiting", "rolloff", "started"].includes(room.status) ? room.status : "waiting";
  room.chat = Array.isArray(room.chat) ? room.chat.slice(-MAX_CHAT_MESSAGES) : [];
  room.log = Array.isArray(room.log) ? room.log.slice(-MAX_LOG_ENTRIES) : [];
  room.players = room.players.map((player) => ({
    ...player,
    id: normalizeText(player.id, 100) || createId(),
    name: normalizePlayerName(player.name) || "Player",
    connected: false,
    socketId: null,
    ready: Boolean(player.ready),
    sessionToken: normalizeText(player.sessionToken, 100) || createSessionToken(),
    game: player.game || null
  }));
  const allPlayerIds = room.players.map((player) => player.id);
  room.players.forEach((player) => {
    if (room.status === "rolloff" || room.status === "started") {
      player.game = migrateGame(player.game, player.id, room.startingLife, allPlayerIds);
    }
  });
  room.rollOff = room.status === "waiting"
    ? null
    : migrateStartingRollOff(room.rollOff, allPlayerIds);
  if (room.status === "started") {
    const existingOrder = Array.isArray(room.turn?.order)
      ? room.turn.order.filter((id) => allPlayerIds.includes(id))
      : [];
    const order = existingOrder.length === allPlayerIds.length ? existingOrder : [...allPlayerIds];
    const activePlayerId = allPlayerIds.includes(room.turn?.activePlayerId)
      ? room.turn.activePlayerId
      : order[0] || null;
    room.turn = {
      number: Math.max(1, Math.floor(Number(room.turn?.number) || 1)),
      phaseIndex: clamp(Math.floor(Number(room.turn?.phaseIndex) || 0), 0, PHASES.length - 1),
      activePlayerId,
      order
    };
  } else if (room.status === "rolloff") {
    room.turn = { number: 0, phaseIndex: 0, activePlayerId: null, order: [] };
  } else {
    room.turn = null;
  }
  room.updatedAt = room.updatedAt || nowIso();
  return room;
}

function persistenceSummary() {
  return {
    enabled: databaseState.enabled,
    ready: databaseState.ready,
    mode: databaseState.ready ? "postgresql" : "memory",
    loadedRooms: databaseState.loadedRooms,
    lastSavedAt: databaseState.lastSavedAt,
    lastError: databaseState.lastError ? "Database operation failed." : null
  };
}

function persistentRoomState(room) {
  return {
    ...room,
    players: room.players.map((player) => ({ ...player, connected: false, socketId: null }))
  };
}

async function initializeDatabase() {
  if (!databasePool) {
    console.warn("DATABASE_URL is not set. Rooms will use temporary memory.");
    return;
  }
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS commander_rooms (
      code VARCHAR(6) PRIMARY KEY,
      room_state JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `);
  await databasePool.query(`CREATE INDEX IF NOT EXISTS commander_rooms_expires_at_idx ON commander_rooms (expires_at)`);
  await databasePool.query(`
    CREATE TABLE IF NOT EXISTS commander_card_cache (
      name_key TEXT PRIMARY KEY,
      card_data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await databasePool.query(`CREATE INDEX IF NOT EXISTS commander_card_cache_updated_at_idx ON commander_card_cache (updated_at)`);
  await databasePool.query(`DELETE FROM commander_card_cache WHERE updated_at < NOW() - INTERVAL '90 days'`);
  await databasePool.query(`DELETE FROM commander_rooms WHERE expires_at <= NOW()`);
  const result = await databasePool.query(`SELECT room_state FROM commander_rooms WHERE expires_at > NOW() ORDER BY updated_at ASC`);
  for (const row of result.rows) {
    const room = migrateRoom(row.room_state);
    if (room && !rooms.has(room.code)) rooms.set(room.code, room);
  }
  databaseState.ready = true;
  databaseState.loadedRooms = rooms.size;
  databaseState.lastError = null;
  console.log(`PostgreSQL autosave ready. Restored ${rooms.size} room(s).`);
}

async function persistRoomNow(room) {
  if (!databasePool || !room || !rooms.has(room.code)) return;
  const expiresAt = new Date(Date.now() + ROOM_RETENTION_MS).toISOString();
  await databasePool.query(
    `INSERT INTO commander_rooms (code, room_state, updated_at, expires_at)
     VALUES ($1, $2::jsonb, NOW(), $3::timestamptz)
     ON CONFLICT (code) DO UPDATE SET room_state = EXCLUDED.room_state, updated_at = NOW(), expires_at = EXCLUDED.expires_at`,
    [room.code, JSON.stringify(persistentRoomState(room)), expiresAt]
  );
  databaseState.ready = true;
  databaseState.lastSavedAt = nowIso();
  databaseState.lastError = null;
}

function enqueuePersistence(roomCode, operation) {
  const previous = persistenceChains.get(roomCode) || Promise.resolve();
  const next = previous.catch(() => undefined).then(operation).catch((error) => {
    databaseState.ready = false;
    databaseState.lastError = normalizeText(error?.message, 240) || "Database save failed.";
    console.error(`Database operation failed for room ${roomCode}:`, error);
  });
  persistenceChains.set(roomCode, next);
  next.finally(() => {
    if (persistenceChains.get(roomCode) === next) persistenceChains.delete(roomCode);
  });
  return next;
}

function queueRoomSave(room, immediate = false) {
  if (!databasePool || !room) return;
  const existing = persistenceTimers.get(room.code);
  if (existing) clearTimeout(existing);
  const run = () => {
    persistenceTimers.delete(room.code);
    enqueuePersistence(room.code, () => persistRoomNow(room));
  };
  if (immediate) return run();
  const timer = setTimeout(run, SAVE_DEBOUNCE_MS);
  timer.unref();
  persistenceTimers.set(room.code, timer);
}

function deletePersistedRoom(roomCode) {
  if (!databasePool) return;
  const timer = persistenceTimers.get(roomCode);
  if (timer) clearTimeout(timer);
  persistenceTimers.delete(roomCode);
  enqueuePersistence(roomCode, () => databasePool.query(`DELETE FROM commander_rooms WHERE code = $1`, [roomCode]));
}

async function flushPersistence() {
  if (!databasePool) return;
  for (const timer of persistenceTimers.values()) clearTimeout(timer);
  persistenceTimers.clear();
  for (const room of rooms.values()) enqueuePersistence(room.code, () => persistRoomNow(room));
  await Promise.allSettled(Array.from(persistenceChains.values()));
}

function normalizeDeck(value) {
  if (!value || typeof value !== "object") return null;
  const id = normalizeText(value.id, 100) || createId();
  const name = normalizeText(value.name, 60);
  const commanders = (Array.isArray(value.commanders) ? value.commanders : [value.commander])
    .map((entry) => normalizeText(entry, 150))
    .filter(Boolean)
    .slice(0, 2);
  const commanderData = (Array.isArray(value.commanderData) ? value.commanderData : [])
    .map(normalizeCardData)
    .filter(Boolean)
    .slice(0, 2);
  if (!name || commanders.length === 0 || !Array.isArray(value.cards)) return null;
  const cardMap = new Map();
  for (const rawCard of value.cards.slice(0, 500)) {
    const intelligence = normalizeCardData(rawCard?.cardData || rawCard);
    const cardName = normalizeText(intelligence?.name || rawCard?.name, 150);
    const quantity = clamp(Math.floor(Number(rawCard?.quantity) || 0), 0, 100);
    if (!cardName || quantity <= 0) continue;
    const key = cardName.toLowerCase();
    const existing = cardMap.get(key);
    if (existing) {
      existing.quantity = clamp(existing.quantity + quantity, 1, 100);
      if (!existing.cardData && intelligence) existing.cardData = intelligence;
    } else {
      cardMap.set(key, { name: cardName, quantity, cardData: intelligence });
    }
  }
  const cards = [...cardMap.values()];
  const totalCards = cards.reduce((total, card) => total + card.quantity, 0);
  if (cards.length === 0 || totalCards < 10 || totalCards > 250) return null;
  const intelligenceCount = cards.filter((card) => card.cardData?.scryfallId).length;
  return {
    id, name, commanders, commanderData, cards, totalCards, uniqueCards: cards.length,
    intelligenceCount,
    validation: totalCards === 100 ? "valid" : "warning"
  };
}

function createCard(name, ownerId, options = {}) {
  const cardData = normalizeCardData(options.cardData);
  return migrateCard({
    id: createId(),
    name: cardData?.name || name,
    ownerId,
    controllerId: ownerId,
    tapped: options.tapped,
    counters: options.counters,
    damageMarked: options.damageMarked,
    token: options.token,
    commander: options.commander,
    power: options.power || cardData?.power,
    toughness: options.toughness || cardData?.toughness,
    loyalty: options.loyalty || cardData?.loyalty,
    attacking: options.attacking,
    blockingCardId: options.blockingCardId,
    notes: options.notes,
    cardData
  }, ownerId);
}

function buildGameState(player, startingLife, allPlayerIds) {
  const expandedDeck = [];
  for (const entry of player.deck.cards) {
    for (let quantity = 0; quantity < entry.quantity; quantity += 1) {
      expandedDeck.push(createCard(entry.name, player.id, { cardData: entry.cardData }));
    }
  }
  const commandZone = [];
  for (let commanderIndex = 0; commanderIndex < player.deck.commanders.length; commanderIndex += 1) {
    const commanderName = player.deck.commanders[commanderIndex];
    const index = expandedDeck.findIndex((card) => card.name.toLowerCase() === commanderName.toLowerCase());
    if (index >= 0) {
      const [card] = expandedDeck.splice(index, 1);
      card.commander = true;
      commandZone.push(card);
    } else {
      const data = player.deck.commanderData?.find((card) => cardDataFromScryfall(card)?.name?.toLowerCase() === commanderName.toLowerCase())
        || player.deck.commanderData?.[commanderIndex]
        || null;
      commandZone.push(createCard(commanderName, player.id, { commander: true, cardData: data }));
    }
  }
  const library = shuffle(expandedDeck);
  const hand = library.splice(0, Math.min(7, library.length));
  const commanderDamage = {};
  allPlayerIds.forEach((id) => { if (id !== player.id) commanderDamage[id] = 0; });
  return {
    life: startingLife,
    poison: 0,
    commanderTax: 0,
    conceded: false,
    library,
    hand,
    battlefield: [],
    graveyard: [],
    exile: [],
    commandZone,
    commanderDamage
  };
}

function findPlayer(room, playerId) {
  return room?.players.find((player) => player.id === playerId) || null;
}

function findBattlefieldCard(room, cardId) {
  for (const player of room.players) {
    const index = player.game?.battlefield.findIndex((card) => card.id === cardId) ?? -1;
    if (index >= 0) return { player, card: player.game.battlefield[index], index };
  }
  return null;
}

function getCardFromZone(game, zone, cardId) {
  if (!game || !ZONES.has(zone) || !Array.isArray(game[zone])) return null;
  const index = game[zone].findIndex((card) => card.id === cardId);
  return index < 0 ? null : { card: game[zone][index], index };
}

function parseStat(value) {
  const text = String(value ?? "").trim();
  return /^-?\d+$/.test(text) ? Number(text) : null;
}

function effectiveStats(card) {
  const basePower = parseStat(card.power);
  const baseToughness = parseStat(card.toughness);
  if (basePower === null || baseToughness === null) return null;
  const plus = Number(card.counters?.["+1/+1"]) || 0;
  const minus = Number(card.counters?.["-1/-1"]) || 0;
  return {
    power: clamp(basePower + plus - minus, -99, 999),
    toughness: clamp(baseToughness + plus - minus, -99, 999)
  };
}

function isLethal(card) {
  const stats = effectiveStats(card);
  return Boolean(stats && (stats.toughness <= 0 || card.damageMarked >= stats.toughness));
}

function addLog(room, text, type = "info") {
  room.log.push({ id: createId(), time: nowIso(), type, text: normalizeText(text, 400) });
  if (room.log.length > MAX_LOG_ENTRIES) room.log.splice(0, room.log.length - MAX_LOG_ENTRIES);
}

function addChat(room, player, message) {
  room.chat.push({ id: createId(), playerId: player.id, playerName: player.name, message: normalizeText(message, 500), time: nowIso() });
  if (room.chat.length > MAX_CHAT_MESSAGES) room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
}

function publicDeck(deck) {
  return deck ? {
    id: deck.id,
    name: deck.name,
    commanders: deck.commanders,
    totalCards: deck.totalCards,
    uniqueCards: deck.uniqueCards,
    intelligenceCount: deck.intelligenceCount || 0,
    validation: deck.validation
  } : null;
}

function publicCard(card) {
  return {
    id: card.id,
    name: card.name,
    ownerId: card.ownerId,
    controllerId: card.controllerId,
    tapped: card.tapped,
    counters: { ...card.counters },
    damageMarked: card.damageMarked,
    token: card.token,
    commander: card.commander,
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    cardData: card.cardData,
    attacking: card.attacking,
    blockingCardId: card.blockingCardId,
    notes: card.notes,
    effectiveStats: effectiveStats(card),
    lethal: isLethal(card)
  };
}

function publicGame(game, isViewer) {
  if (!game) return null;
  const result = {
    life: game.life,
    poison: game.poison,
    commanderTax: game.commanderTax,
    conceded: game.conceded,
    handCount: game.hand.length,
    libraryCount: game.library.length,
    commanderDamage: { ...game.commanderDamage },
    battlefield: game.battlefield.map(publicCard),
    graveyard: game.graveyard.map(publicCard),
    exile: game.exile.map(publicCard),
    commandZone: game.commandZone.map(publicCard)
  };
  if (isViewer) result.hand = game.hand.map(publicCard);
  return result;
}

function publicStartingRollOff(rollOff) {
  if (!rollOff) return null;
  return {
    round: rollOff.round,
    currentEligiblePlayerIds: [...rollOff.currentEligiblePlayerIds],
    currentRolls: { ...rollOff.currentRolls },
    rounds: rollOff.rounds.map((entry) => ({ round: entry.round, rolls: { ...entry.rolls } })),
    tiedPlayerIds: [...rollOff.tiedPlayerIds],
    winnerPlayerId: rollOff.winnerPlayerId,
    winningRoll: rollOff.winningRoll,
    completed: rollOff.completed
  };
}

function createPublicRoom(room, viewerId = null) {
  return {
    code: room.code,
    hostId: room.hostId,
    privateRoom: room.privateRoom,
    maxPlayers: room.maxPlayers,
    startingLife: room.startingLife,
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    startedAt: room.startedAt,
    persistence: persistenceSummary(),
    phases: PHASES,
    turn: room.turn ? { ...room.turn, order: [...(room.turn.order || [])] } : null,
    rollOff: publicStartingRollOff(room.rollOff),
    chat: room.chat.slice(-MAX_CHAT_MESSAGES),
    log: room.log.slice(-MAX_LOG_ENTRIES),
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      ready: player.ready,
      connected: player.connected,
      joinedAt: player.joinedAt,
      deck: publicDeck(player.deck),
      game: publicGame(player.game, player.id === viewerId)
    }))
  };
}

function emitRoomUpdate(room) {
  room.updatedAt = nowIso();
  queueRoomSave(room);
  for (const player of room.players) {
    if (!player.socketId) continue;
    const socket = io.sockets.sockets.get(player.socketId);
    if (socket) socket.emit("room-updated", createPublicRoom(room, player.id));
  }
}

function acknowledge(callback, response) {
  if (typeof callback === "function") callback(response);
}

function fail(callback, error) {
  acknowledge(callback, { success: false, error });
}

function authenticationFrom(payload) {
  const room = rooms.get(normalizeRoomCode(payload?.roomCode));
  if (!room) return { success: false, error: "That room no longer exists." };
  const player = findPlayer(room, String(payload?.playerId || ""));
  if (!player || player.sessionToken !== String(payload?.sessionToken || "")) {
    return { success: false, error: "Your saved room session could not be verified." };
  }
  return { success: true, room, player };
}

function attachSocket(socket, room, player) {
  if (socket.data.roomCode && socket.data.roomCode !== room.code) socket.leave(`commander-room:${socket.data.roomCode}`);
  socket.join(`commander-room:${room.code}`);
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  player.socketId = socket.id;
  player.connected = true;
  player.lastSeenAt = nowIso();
  const key = `${room.code}:${player.id}`;
  const timer = disconnectTimers.get(key);
  if (timer) clearTimeout(timer);
  disconnectTimers.delete(key);
}

function detachSocket(socket, roomCode) {
  if (!socket) return;
  socket.leave(`commander-room:${roomCode}`);
  socket.data.roomCode = null;
  socket.data.playerId = null;
}

function transferHostIfNeeded(room) {
  const host = findPlayer(room, room.hostId);
  if (host?.connected) return;
  const next = room.players.find((player) => player.connected) || room.players[0];
  if (next) room.hostId = next.id;
}

function removePlayer(room, playerId) {
  const index = room.players.findIndex((player) => player.id === playerId);
  if (index < 0) return null;
  const [removed] = room.players.splice(index, 1);
  if (room.players.length === 0) {
    rooms.delete(room.code);
    deletePersistedRoom(room.code);
  } else {
    transferHostIfNeeded(room);
    emitRoomUpdate(room);
  }
  return removed;
}

function scheduleDisconnectCleanup(room, player) {
  const key = `${room.code}:${player.id}`;
  const previous = disconnectTimers.get(key);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(() => {
    disconnectTimers.delete(key);
    const currentRoom = rooms.get(room.code);
    const currentPlayer = findPlayer(currentRoom, player.id);
    if (currentRoom && currentPlayer && !currentPlayer.connected && currentRoom.status === "waiting") removePlayer(currentRoom, player.id);
  }, RECONNECT_GRACE_MS);
  timer.unref();
  disconnectTimers.set(key, timer);
}

function moveCard(player, fromZone, toZone, cardId, position = "top") {
  if (!player.game || !ZONES.has(fromZone) || !ZONES.has(toZone)) return null;
  const located = getCardFromZone(player.game, fromZone, cardId);
  if (!located) return null;
  const [card] = player.game[fromZone].splice(located.index, 1);
  if (card.token && toZone !== "battlefield") return { card, removedToken: true };
  card.attacking = false;
  card.blockingCardId = null;
  card.damageMarked = 0;
  if (toZone !== "battlefield") card.tapped = false;
  if (toZone === "library" && position === "bottom") player.game.library.push(card);
  else player.game[toZone].unshift(card);
  return { card, removedToken: false };
}

function clearCombat(room) {
  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      card.attacking = false;
      card.blockingCardId = null;
    }
  }
}

function clearDamage(room) {
  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) card.damageMarked = 0;
  }
}

function activePlayers(room) {
  const order = Array.isArray(room.turn?.order) && room.turn.order.length
    ? room.turn.order
    : room.players.map((player) => player.id);
  const byId = new Map(room.players.map((player) => [player.id, player]));
  return order
    .map((id) => byId.get(id))
    .filter((player) => player?.game && !player.game.conceded);
}

function advanceTurn(room) {
  const players = activePlayers(room);
  if (players.length === 0) return;
  clearCombat(room);
  clearDamage(room);
  const currentIndex = players.findIndex((player) => player.id === room.turn.activePlayerId);
  const next = players[(currentIndex + 1 + players.length) % players.length];
  room.turn.activePlayerId = next.id;
  room.turn.phaseIndex = 0;
  room.turn.number += 1;
  next.game.battlefield.forEach((card) => { card.tapped = false; });
  addLog(room, `Turn ${room.turn.number}: ${next.name} is active. Clockwise play continues.`, "turn");
}

function performStartingRoll(room, player, forcedRoll = null) {
  if (room.status !== "rolloff" || !room.rollOff) {
    return { success: false, error: "The starting-player roll is not active." };
  }
  if (!player.connected) return { success: false, error: "Reconnect before rolling." };
  const rollOff = room.rollOff;
  if (!rollOff.currentEligiblePlayerIds.includes(player.id)) {
    return { success: false, error: "Only the tied players need to roll this round." };
  }
  if (Object.prototype.hasOwnProperty.call(rollOff.currentRolls, player.id)) {
    return { success: false, error: "You already rolled for this round." };
  }

  const roll = forcedRoll == null
    ? crypto.randomInt(1, 21)
    : clamp(Math.floor(Number(forcedRoll) || 1), 1, 20);
  rollOff.currentRolls[player.id] = roll;
  addLog(room, `${player.name} rolled ${roll} on a d20 for starting player.`, "roll");

  const everyoneRolled = rollOff.currentEligiblePlayerIds.every((id) =>
    Object.prototype.hasOwnProperty.call(rollOff.currentRolls, id)
  );
  if (!everyoneRolled) return { success: true, roll, completed: false };

  const completedRolls = {};
  for (const id of rollOff.currentEligiblePlayerIds) completedRolls[id] = rollOff.currentRolls[id];
  rollOff.rounds.push({ round: rollOff.round, rolls: completedRolls });
  const highest = Math.max(...Object.values(completedRolls));
  const highestIds = rollOff.currentEligiblePlayerIds.filter((id) => completedRolls[id] === highest);

  if (highestIds.length > 1) {
    rollOff.tiedPlayerIds = [...highestIds];
    rollOff.currentEligiblePlayerIds = [...highestIds];
    rollOff.currentRolls = {};
    rollOff.round += 1;
    const tiedNames = highestIds.map((id) => findPlayer(room, id)?.name || "Player").join(", ");
    addLog(room, `${tiedNames} tied with ${highest}. They must reroll.`, "roll");
    return { success: true, roll, completed: false, tied: true };
  }

  const winnerId = highestIds[0];
  const winner = findPlayer(room, winnerId);
  const playerIds = room.players.map((roomPlayer) => roomPlayer.id);
  const order = createClockwiseTurnOrder(playerIds, winnerId);
  rollOff.winnerPlayerId = winnerId;
  rollOff.winningRoll = highest;
  rollOff.completed = true;
  rollOff.tiedPlayerIds = [];
  rollOff.currentEligiblePlayerIds = [];
  rollOff.currentRolls = {};
  room.status = "started";
  room.turn = { number: 1, phaseIndex: 0, activePlayerId: winnerId, order };
  addLog(room, `${winner?.name || "The winner"} won the d20 roll with ${highest} and takes the first turn. Play proceeds clockwise.`, "turn");
  return { success: true, roll, completed: true, winnerPlayerId: winnerId };
}

function requireOwnedBattlefieldCard(actor, cardId) {
  const located = getCardFromZone(actor.game, "battlefield", String(cardId || ""));
  return located || null;
}

function processGameAction(room, actor, action) {
  if (room.status !== "started" || !actor.game) return { success: false, error: "The game has not started." };
  const type = normalizeText(action?.type, 40);
  const targetPlayer = findPlayer(room, String(action?.targetPlayerId || "")) || actor;
  const amount = clamp(Math.floor(Number(action?.amount) || 0), -9999, 9999);

  switch (type) {
    case "life":
      targetPlayer.game.life = clamp(targetPlayer.game.life + amount, -999, 9999);
      addLog(room, `${actor.name} changed ${targetPlayer.name}'s life to ${targetPlayer.game.life}.`, "life");
      break;
    case "poison":
      targetPlayer.game.poison = clamp(targetPlayer.game.poison + amount, 0, 99);
      addLog(room, `${targetPlayer.name} now has ${targetPlayer.game.poison} poison.`, "counter");
      break;
    case "commander-tax":
      targetPlayer.game.commanderTax = clamp(targetPlayer.game.commanderTax + amount, 0, 99);
      addLog(room, `${targetPlayer.name}'s commander tax is ${targetPlayer.game.commanderTax}.`, "counter");
      break;
    case "commander-damage": { 
      const sourceId = String(action?.sourcePlayerId || "");
      const source = findPlayer(room, sourceId);
      if (!source || sourceId === targetPlayer.id) return { success: false, error: "Choose a valid opposing commander." };
      const current = Number(targetPlayer.game.commanderDamage[sourceId]) || 0;
      targetPlayer.game.commanderDamage[sourceId] = clamp(current + amount, 0, 99);
      addLog(room, `${targetPlayer.name} has ${targetPlayer.game.commanderDamage[sourceId]} commander damage from ${source.name}.`, "counter");
      break;
    }
    case "draw": { 
      const count = clamp(amount || 1, 1, 20);
      let drawn = 0;
      while (drawn < count && actor.game.library.length) {
        actor.game.hand.push(actor.game.library.shift());
        drawn += 1;
      }
      addLog(room, `${actor.name} drew ${drawn} card${drawn === 1 ? "" : "s"}.`, "card");
      break;
    }
    case "mill": {
      const count = clamp(amount || 1, 1, 50);
      let milled = 0;
      while (milled < count && actor.game.library.length) {
        actor.game.graveyard.unshift(actor.game.library.shift());
        milled += 1;
      }
      addLog(room, `${actor.name} milled ${milled} card${milled === 1 ? "" : "s"}.`, "card");
      break;
    }
    case "shuffle":
      actor.game.library = shuffle(actor.game.library);
      addLog(room, `${actor.name} shuffled their library.`, "card");
      break;
    case "mulligan":
      actor.game.library.push(...actor.game.hand);
      actor.game.hand = [];
      actor.game.library = shuffle(actor.game.library);
      actor.game.hand = actor.game.library.splice(0, Math.min(7, actor.game.library.length));
      addLog(room, `${actor.name} took a sandbox mulligan to seven.`, "card");
      break;
    case "move-card": {
      const result = moveCard(actor, String(action?.fromZone || ""), String(action?.toZone || ""), String(action?.cardId || ""), action?.position);
      if (!result) return { success: false, error: "That card could not be moved." };
      addLog(room, result.removedToken
        ? `${actor.name}'s ${result.card.name} token left the battlefield.`
        : `${actor.name} moved ${result.card.name} to ${action.toZone === "commandZone" ? "the command zone" : action.toZone}.`, "card");
      break;
    }
    case "tap-card": {
      const located = requireOwnedBattlefieldCard(actor, action?.cardId);
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      located.card.tapped = !located.card.tapped;
      addLog(room, `${actor.name} ${located.card.tapped ? "tapped" : "untapped"} ${located.card.name}.`, "card");
      break;
    }
    case "card-counter": {
      const located = requireOwnedBattlefieldCard(actor, action?.cardId);
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      const counterName = normalizeText(action?.counterName, 30) || "counter";
      const next = clamp((Number(located.card.counters[counterName]) || 0) + amount, -99, 999);
      if (next === 0) delete located.card.counters[counterName];
      else located.card.counters[counterName] = next;
      addLog(room, `${located.card.name} now has ${next} ${counterName} counter${Math.abs(next) === 1 ? "" : "s"}.`, "counter");
      break;
    }
    case "set-card-stats": {
      const located = requireOwnedBattlefieldCard(actor, action?.cardId);
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      located.card.power = normalizeText(action?.power, 12);
      located.card.toughness = normalizeText(action?.toughness, 12);
      located.card.notes = normalizeText(action?.notes, 300);
      addLog(room, `${actor.name} set ${located.card.name}'s stats to ${located.card.power || "?"}/${located.card.toughness || "?"}.`, "card");
      break;
    }
    case "mark-damage": {
      const located = requireOwnedBattlefieldCard(actor, action?.cardId);
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      located.card.damageMarked = clamp(located.card.damageMarked + amount, 0, 999);
      addLog(room, `${located.card.name} has ${located.card.damageMarked} damage marked${isLethal(located.card) ? " and is marked lethal" : ""}.`, "damage");
      break;
    }
    case "clear-card-damage": {
      const located = requireOwnedBattlefieldCard(actor, action?.cardId);
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      located.card.damageMarked = 0;
      addLog(room, `${actor.name} cleared damage from ${located.card.name}.`, "damage");
      break;
    }
    case "fight-card": {
      const sourceLocated = requireOwnedBattlefieldCard(actor, action?.sourceCardId);
      const targetLocated = findBattlefieldCard(room, String(action?.targetCardId || ""));
      if (!sourceLocated || !targetLocated) return { success: false, error: "One of those creatures is no longer on the battlefield." };
      if (sourceLocated.card.id === targetLocated.card.id) return { success: false, error: "A creature cannot fight itself." };
      const sourceStats = effectiveStats(sourceLocated.card);
      const targetStats = effectiveStats(targetLocated.card);
      if (!sourceStats || !targetStats) return { success: false, error: "Set numeric power and toughness on both creatures before fighting." };
      sourceLocated.card.damageMarked = clamp(sourceLocated.card.damageMarked + Math.max(0, targetStats.power), 0, 999);
      targetLocated.card.damageMarked = clamp(targetLocated.card.damageMarked + Math.max(0, sourceStats.power), 0, 999);
      addLog(room, `${actor.name}'s ${sourceLocated.card.name} fought ${targetLocated.player.name}'s ${targetLocated.card.name}.`, "fight");
      break;
    }
    case "toggle-attacking": {
      const located = requireOwnedBattlefieldCard(actor, action?.cardId);
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      located.card.attacking = !located.card.attacking;
      if (!located.card.attacking) {
        for (const player of room.players) {
          for (const card of player.game?.battlefield || []) {
            if (card.blockingCardId === located.card.id) card.blockingCardId = null;
          }
        }
      }
      addLog(room, `${located.card.name} is ${located.card.attacking ? "attacking" : "no longer attacking"}.`, "combat");
      break;
    }
    case "block-card": {
      const blocker = requireOwnedBattlefieldCard(actor, action?.sourceCardId);
      const attacker = findBattlefieldCard(room, String(action?.targetCardId || ""));
      if (!blocker || !attacker?.card.attacking) return { success: false, error: "Choose one of your permanents and a marked attacking creature." };
      blocker.card.blockingCardId = attacker.card.id;
      addLog(room, `${actor.name}'s ${blocker.card.name} is blocking ${attacker.player.name}'s ${attacker.card.name}.`, "combat");
      break;
    }
    case "clear-block": {
      const located = requireOwnedBattlefieldCard(actor, action?.cardId);
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      located.card.blockingCardId = null;
      addLog(room, `${located.card.name} is no longer blocking.`, "combat");
      break;
    }
    case "resolve-lethal": {
      const located = requireOwnedBattlefieldCard(actor, action?.cardId);
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      if (!isLethal(located.card)) return { success: false, error: "That permanent is not currently marked lethal." };
      const [card] = actor.game.battlefield.splice(located.index, 1);
      card.damageMarked = 0;
      card.attacking = false;
      card.blockingCardId = null;
      if (!card.token) actor.game.graveyard.unshift(card);
      addLog(room, card.token ? `${card.name} token was removed after lethal damage.` : `${card.name} was moved to the graveyard after lethal damage.`, "damage");
      break;
    }
    case "create-token": {
      const tokenName = normalizeText(action?.name, 80) || "Token";
      actor.game.battlefield.unshift(createCard(tokenName, actor.id, {
        token: true,
        power: normalizeText(action?.power, 12),
        toughness: normalizeText(action?.toughness, 12)
      }));
      addLog(room, `${actor.name} created a ${tokenName} token.`, "card");
      break;
    }
    case "untap-all":
      actor.game.battlefield.forEach((card) => { card.tapped = false; });
      addLog(room, `${actor.name} untapped all permanents.`, "card");
      break;
    case "clear-combat":
      clearCombat(room);
      addLog(room, `${actor.name} cleared all attack and block markers.`, "combat");
      break;
    case "clear-all-damage":
      clearDamage(room);
      addLog(room, `${actor.name} cleared all marked damage.`, "damage");
      break;
    case "next-phase":
      if (room.turn.activePlayerId !== actor.id && room.hostId !== actor.id) return { success: false, error: "Only the active player or host can advance the phase." };
      if (room.turn.phaseIndex >= PHASES.length - 1) advanceTurn(room);
      else {
        room.turn.phaseIndex += 1;
        addLog(room, `${PHASES[room.turn.phaseIndex]} phase.`, "turn");
      }
      break;
    case "end-turn":
      if (room.turn.activePlayerId !== actor.id && room.hostId !== actor.id) return { success: false, error: "Only the active player or host can end the turn." };
      advanceTurn(room);
      break;
    case "set-active-player":
      if (room.hostId !== actor.id) return { success: false, error: "Only the host can change the active player." };
      if (!targetPlayer.game || targetPlayer.game.conceded) return { success: false, error: "That player is not active in this game." };
      clearCombat(room);
      clearDamage(room);
      room.turn.activePlayerId = targetPlayer.id;
      room.turn.phaseIndex = 0;
      targetPlayer.game.battlefield.forEach((card) => { card.tapped = false; });
      addLog(room, `${actor.name} made ${targetPlayer.name} the active player.`, "turn");
      break;
    case "concede":
      actor.game.conceded = true;
      addLog(room, `${actor.name} conceded the game.`, "warning");
      if (room.turn.activePlayerId === actor.id) advanceTurn(room);
      break;
    default:
      return { success: false, error: "That game action is not supported." };
  }
  return { success: true };
}


app.post("/api/cards/resolve", async (request, response) => {
  const names = Array.isArray(request.body?.names) ? request.body.names : [];
  if (!names.length) return response.status(400).json({ success: false, error: "Submit at least one card name." });
  if (names.length > CARD_LOOKUP_MAX_NAMES) {
    return response.status(400).json({ success: false, error: `A maximum of ${CARD_LOOKUP_MAX_NAMES} names can be resolved at once.` });
  }
  try {
    const result = await resolveCardNames(names);
    return response.status(200).json({ success: true, source: "Scryfall", ...result });
  } catch (error) {
    console.error("Card lookup failed:", error);
    return response.status(502).json({ success: false, error: normalizeText(error?.message, 240) || "Card lookup failed." });
  }
});

app.get("/api/health", (request, response) => {
  response.status(200).json({
    success: true,
    status: "online",
    app: "Torn Commander Sandbox",
    version: "9.0.0",
    connectedSockets: io.engine.clientsCount,
    activeRooms: rooms.size,
    persistence: persistenceSummary(),
    timestamp: nowIso()
  });
});

app.get("/api", (request, response) => {
  response.status(200).json({ success: true, name: "Torn Commander Sandbox API", version: "9.0.0", persistence: persistenceSummary() });
});

io.on("connection", (socket) => {
  socket.emit("server-message", { type: "success", message: "Connected to the Commander server." });

  socket.on("create-room", (payload, callback) => {
    try {
      if (socket.data.roomCode) return fail(callback, "Leave your current room first.");
      const name = normalizePlayerName(payload?.playerName);
      if (name.length < 2) return fail(callback, "Enter a player name with at least two characters.");
      const timestamp = nowIso();
      const player = { id: createId(), name, ready: false, connected: true, socketId: socket.id, sessionToken: createSessionToken(), deck: null, game: null, joinedAt: timestamp, lastSeenAt: timestamp };
      const maxPlayers = ALLOWED_MAX_PLAYERS.has(Number(payload?.maxPlayers)) ? Number(payload.maxPlayers) : 6;
      const startingLife = ALLOWED_STARTING_LIFE.has(Number(payload?.startingLife)) ? Number(payload.startingLife) : 40;
      const room = { code: createRoomCode(), hostId: player.id, privateRoom: true, maxPlayers, startingLife, status: "waiting", createdAt: timestamp, updatedAt: timestamp, startedAt: null, turn: null, rollOff: null, players: [player], chat: [], log: [] };
      rooms.set(room.code, room);
      attachSocket(socket, room, player);
      addLog(room, `${name} created the room.`, "room");
      acknowledge(callback, { success: true, playerId: player.id, sessionToken: player.sessionToken, room: createPublicRoom(room, player.id) });
      queueRoomSave(room, true);
    } catch (error) {
      console.error(error);
      fail(callback, "An unexpected server error occurred.");
    }
  });

  socket.on("join-room", (payload, callback) => {
    try {
      if (socket.data.roomCode) return fail(callback, "Leave your current room first.");
      const room = rooms.get(normalizeRoomCode(payload?.roomCode));
      const name = normalizePlayerName(payload?.playerName);
      if (!room) return fail(callback, "That room code was not found.");
      if (room.status !== "waiting") return fail(callback, "That game has already started. Use your saved rejoin session.");
      if (room.players.length >= room.maxPlayers) return fail(callback, "That room is full.");
      if (name.length < 2) return fail(callback, "Enter a player name with at least two characters.");
      if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) return fail(callback, "That player name is already being used.");
      const timestamp = nowIso();
      const player = { id: createId(), name, ready: false, connected: true, socketId: socket.id, sessionToken: createSessionToken(), deck: null, game: null, joinedAt: timestamp, lastSeenAt: timestamp };
      room.players.push(player);
      attachSocket(socket, room, player);
      addLog(room, `${name} joined the room.`, "room");
      acknowledge(callback, { success: true, playerId: player.id, sessionToken: player.sessionToken, room: createPublicRoom(room, player.id) });
      emitRoomUpdate(room);
    } catch (error) {
      console.error(error);
      fail(callback, "An unexpected server error occurred.");
    }
  });

  socket.on("rejoin-room", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    const previousSocket = auth.player.socketId && io.sockets.sockets.get(auth.player.socketId);
    if (previousSocket && previousSocket.id !== socket.id) {
      previousSocket.emit("removed-from-room", { message: "This room session was opened on another device." });
      detachSocket(previousSocket, auth.room.code);
    }
    attachSocket(socket, auth.room, auth.player);
    acknowledge(callback, { success: true, playerId: auth.player.id, sessionToken: auth.player.sessionToken, room: createPublicRoom(auth.room, auth.player.id) });
    addLog(auth.room, `${auth.player.name} reconnected.`, "room");
    emitRoomUpdate(auth.room);
  });

  socket.on("set-player-deck", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    if (auth.room.status !== "waiting") return fail(callback, "Decks cannot change after the game starts.");
    if (payload.deck === null) {
      auth.player.deck = null;
      auth.player.ready = false;
    } else {
      const deck = normalizeDeck(payload.deck);
      if (!deck) return fail(callback, "The selected deck is incomplete or invalid.");
      auth.player.deck = deck;
      auth.player.ready = false;
    }
    acknowledge(callback, { success: true, room: createPublicRoom(auth.room, auth.player.id) });
    emitRoomUpdate(auth.room);
  });

  socket.on("toggle-ready", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    if (auth.room.status !== "waiting") return fail(callback, "The game has already started.");
    if (!auth.player.deck && !auth.player.ready) return fail(callback, "Select a Commander deck first.");
    auth.player.ready = !auth.player.ready;
    addLog(auth.room, `${auth.player.name} is ${auth.player.ready ? "ready" : "not ready"}.`, "room");
    acknowledge(callback, { success: true, room: createPublicRoom(auth.room, auth.player.id) });
    emitRoomUpdate(auth.room);
  });

  socket.on("update-room-settings", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    if (auth.room.hostId !== auth.player.id) return fail(callback, "Only the room host can do that.");
    if (auth.room.status !== "waiting") return fail(callback, "Room settings cannot change after the game starts.");
    const maxPlayers = ALLOWED_MAX_PLAYERS.has(Number(payload?.maxPlayers)) ? Number(payload.maxPlayers) : auth.room.maxPlayers;
    if (maxPlayers < auth.room.players.length) return fail(callback, "The maximum cannot be lower than the number of players already present.");
    auth.room.maxPlayers = maxPlayers;
    if (ALLOWED_STARTING_LIFE.has(Number(payload?.startingLife))) auth.room.startingLife = Number(payload.startingLife);
    acknowledge(callback, { success: true, room: createPublicRoom(auth.room, auth.player.id) });
    emitRoomUpdate(auth.room);
  });

  socket.on("start-game", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    if (auth.room.hostId !== auth.player.id) return fail(callback, "Only the room host can start the game.");
    if (auth.room.status !== "waiting") return fail(callback, "The game has already started.");
    if (auth.room.players.length < 2) return fail(callback, "At least two players are required.");
    const unavailable = auth.room.players.find((player) => !player.connected || !player.ready || !player.deck);
    if (unavailable) return fail(callback, `${unavailable.name} must be connected, choose a deck and mark ready.`);
    const ids = auth.room.players.map((player) => player.id);
    auth.room.players.forEach((player) => { player.game = buildGameState(player, auth.room.startingLife, ids); });
    auth.room.status = "rolloff";
    auth.room.startedAt = nowIso();
    auth.room.rollOff = createStartingRollOff(ids);
    auth.room.turn = { number: 0, phaseIndex: 0, activePlayerId: null, order: [] };
    addLog(auth.room, "Starting-player d20 roll-off began. Every player must roll once; tied high rolls reroll.", "roll");
    acknowledge(callback, { success: true, room: createPublicRoom(auth.room, auth.player.id) });
    emitRoomUpdate(auth.room);
  });

  socket.on("roll-starting-d20", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    const result = performStartingRoll(auth.room, auth.player);
    if (!result.success) return acknowledge(callback, result);
    acknowledge(callback, { ...result, room: createPublicRoom(auth.room, auth.player.id) });
    emitRoomUpdate(auth.room);
  });

  socket.on("game-action", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    const result = processGameAction(auth.room, auth.player, payload?.action || {});
    if (!result.success) return acknowledge(callback, result);
    acknowledge(callback, { success: true, room: createPublicRoom(auth.room, auth.player.id) });
    emitRoomUpdate(auth.room);
  });

  socket.on("send-chat", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    const message = normalizeText(payload?.message, 500);
    if (!message) return fail(callback, "Enter a message first.");
    addChat(auth.room, auth.player, message);
    acknowledge(callback, { success: true });
    emitRoomUpdate(auth.room);
  });

  socket.on("remove-player", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    if (auth.room.hostId !== auth.player.id) return fail(callback, "Only the host can remove a player.");
    if (auth.room.status !== "waiting") return fail(callback, "Players cannot be removed after the game starts.");
    const target = findPlayer(auth.room, String(payload?.targetPlayerId || ""));
    if (!target || target.id === auth.player.id) return fail(callback, "Choose another player.");
    const targetSocket = target.socketId && io.sockets.sockets.get(target.socketId);
    if (targetSocket) {
      targetSocket.emit("removed-from-room", { message: "The host removed you from the room." });
      detachSocket(targetSocket, auth.room.code);
    }
    removePlayer(auth.room, target.id);
    acknowledge(callback, { success: true });
  });

  socket.on("leave-room", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    detachSocket(socket, auth.room.code);
    if (auth.room.status === "waiting") removePlayer(auth.room, auth.player.id);
    else {
      auth.player.connected = false;
      auth.player.socketId = null;
      transferHostIfNeeded(auth.room);
      emitRoomUpdate(auth.room);
    }
    acknowledge(callback, { success: true });
  });

  socket.on("reset-game", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    if (auth.room.hostId !== auth.player.id) return fail(callback, "Only the host can reset the room.");
    auth.room.status = "waiting";
    auth.room.startedAt = null;
    auth.room.turn = null;
    auth.room.rollOff = null;
    auth.room.players.forEach((player) => { player.game = null; player.ready = false; });
    auth.room.chat = [];
    auth.room.log = [];
    addLog(auth.room, `${auth.player.name} returned the room to the lobby.`, "room");
    acknowledge(callback, { success: true });
    emitRoomUpdate(auth.room);
  });

  socket.on("disconnect", () => {
    const room = rooms.get(socket.data.roomCode);
    const player = findPlayer(room, socket.data.playerId);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.socketId = null;
    player.lastSeenAt = nowIso();
    transferHostIfNeeded(room);
    emitRoomUpdate(room);
    scheduleDisconnectCleanup(room, player);
  });
});

const cleanupInterval = setInterval(async () => {
  const cutoff = Date.now() - ROOM_RETENTION_MS;
  for (const [code, room] of rooms.entries()) {
    const age = Date.parse(room.updatedAt || room.createdAt || nowIso());
    if (Number.isFinite(age) && age < cutoff && !room.players.some((player) => player.connected)) {
      rooms.delete(code);
      deletePersistedRoom(code);
    }
  }
  if (databasePool) {
    try {
      await databasePool.query(`DELETE FROM commander_rooms WHERE expires_at <= NOW()`);
      await databasePool.query(`DELETE FROM commander_card_cache WHERE updated_at < NOW() - INTERVAL '90 days'`);
    } catch (error) { console.error("Database cleanup failed:", error); }
  }
}, CLEANUP_INTERVAL_MS);
cleanupInterval.unref();

app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api/")) return next();
  response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  return response.sendFile(path.join(PUBLIC_DIRECTORY, "index.html"));
});

app.use("/api", (request, response) => response.status(404).json({ success: false, error: "API route not found." }));
app.use((error, request, response, next) => {
  console.error("Server error:", error);
  if (response.headersSent) return next(error);
  return response.status(500).json({ success: false, error: "An unexpected server error occurred." });
});

async function start() {
  try { await initializeDatabase(); }
  catch (error) {
    databaseState.ready = false;
    databaseState.lastError = normalizeText(error?.message, 240);
    console.error("PostgreSQL initialization failed. Continuing with memory:", error);
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Torn Commander Sandbox v9 running on port ${PORT}`);
  });
}

async function shutdown(signal) {
  console.log(`${signal} received. Closing server...`);
  clearInterval(cleanupInterval);
  for (const timer of disconnectTimers.values()) clearTimeout(timer);
  try { await flushPersistence(); } catch (error) { console.error("Final persistence flush failed:", error); }
  io.close();
  server.close(async () => {
    if (databasePool) await databasePool.end().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (error) => console.error("Uncaught exception:", error));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

module.exports = {
  createCard,
  effectiveStats,
  isLethal,
  processGameAction,
  migrateCard,
  migrateGame,
  createStartingRollOff,
  createClockwiseTurnOrder,
  performStartingRoll,
  advanceTurn,
  normalizeCardData,
  resolveCardNames
};

if (require.main === module) start();
