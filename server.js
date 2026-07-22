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
const MAX_LOG_ENTRIES = 250;
const MAX_STACK_ITEMS = 60;
const MAX_TRIGGER_ITEMS = 80;
const MAX_ACTION_HISTORY = 250;
const MAX_UNDO_SNAPSHOTS = 20;
const MAX_EMOTES = 24;
const MAX_REPLAY_FRAMES = 80;
const MAX_SPECTATORS = 50;
const MAX_RULE_DECISIONS = 80;
const MAX_RULE_EFFECTS = 160;
const RULES_VERSION = "30.0";
const ALLOWED_TURN_TIMERS = new Set([0, 60, 90, 120, 180, 300]);
const PHASES = ["Untap", "Upkeep", "Draw", "Main 1", "Beginning Combat", "Declare Attackers", "Declare Blockers", "First-Strike Damage", "Combat Damage", "End Combat", "Main 2", "End", "Cleanup"];
const ZONES = new Set(["hand", "battlefield", "graveyard", "exile", "commandZone", "library"]);
const ALLOWED_MAX_PLAYERS = new Set([2, 3, 4, 5, 6]);
const ALLOWED_STARTING_LIFE = new Set([20, 30, 40, 50, 60]);
const SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
const SCRYFALL_BATCH_SIZE = 75;
const CARD_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CARD_LOOKUP_MAX_NAMES = 150;
const CARD_LOOKUP_USER_AGENT = process.env.SCRYFALL_USER_AGENT || "TornCommanderSandbox/30.0 (+https://torn-commander-sandbox.onrender.com)";

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


function normalizeManaPool(value) {
  const result = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  for (const symbol of Object.keys(result)) result[symbol] = clamp(Math.floor(Number(value?.[symbol]) || 0), 0, 999);
  return result;
}

function normalizeRoomSettings(value) {
  const timer = Number(value?.turnTimerSeconds);
  return {
    turnTimerSeconds: ALLOWED_TURN_TIMERS.has(timer) ? timer : 0,
    allowSpectators: value?.allowSpectators !== false,
    showCombatPreview: value?.showCombatPreview !== false,
    enforceDeckRules: value?.enforceDeckRules !== false,
    allowInvalidDecks: Boolean(value?.allowInvalidDecks),
    autoStateBasedActions: value?.autoStateBasedActions !== false,
    freeCommanderMulligan: value?.freeCommanderMulligan !== false
  };
}

function normalizeEmotes(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_EMOTES).map((entry) => ({
    id: normalizeText(entry?.id, 100) || createId(),
    playerId: normalizeText(entry?.playerId, 100),
    playerName: normalizeText(entry?.playerName, 24) || "Player",
    emoji: normalizeText(entry?.emoji, 12) || "👍",
    time: entry?.time || nowIso()
  }));
}

function normalizeReplayFrames(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_REPLAY_FRAMES).map((frame) => ({
    id: normalizeText(frame?.id, 100) || createId(),
    time: frame?.time || nowIso(),
    label: normalizeText(frame?.label, 180) || "Game action",
    actorName: normalizeText(frame?.actorName, 24),
    turn: frame?.turn && typeof frame.turn === "object" ? frame.turn : null,
    phase: normalizeText(frame?.phase, 60),
    priorityPlayerId: normalizeText(frame?.priorityPlayerId, 100) || null,
    stack: Array.isArray(frame?.stack) ? frame.stack.slice(-12) : [],
    players: Array.isArray(frame?.players) ? frame.players.slice(0, 6) : []
  }));
}

function normalizeTemporaryEffects(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-30).map((effect) => ({
    id: normalizeText(effect?.id, 100) || createId(),
    label: normalizeText(effect?.label, 100) || "Temporary effect",
    power: clamp(Math.floor(Number(effect?.power) || 0), -99, 99),
    toughness: clamp(Math.floor(Number(effect?.toughness) || 0), -99, 99),
    keyword: normalizeText(effect?.keyword, 60),
    expires: ["end-of-turn", "until-removed"].includes(effect?.expires) ? effect.expires : "end-of-turn"
  }));
}

function normalizeTargetList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => normalizeText(entry, 140)).filter(Boolean))].slice(0, 20);
}

function normalizeRuleEffect(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: normalizeText(value.id, 100) || createId(),
    kind: ["continuous", "replacement", "prevention", "delayed", "emblem"].includes(value.kind) ? value.kind : "continuous",
    label: normalizeText(value.label, 180) || "Rule effect",
    sourceCardId: normalizeText(value.sourceCardId, 100) || null,
    controllerId: normalizeText(value.controllerId, 100) || null,
    targetIds: normalizeTargetList(value.targetIds),
    event: normalizeText(value.event, 60),
    operation: normalizeText(value.operation, 60),
    amount: clamp(Math.floor(Number(value.amount) || 0), -9999, 9999),
    power: clamp(Math.floor(Number(value.power) || 0), -999, 999),
    toughness: clamp(Math.floor(Number(value.toughness) || 0), -999, 999),
    keyword: normalizeText(value.keyword, 80),
    layer: clamp(Math.floor(Number(value.layer) || 7), 1, 7),
    timestamp: value.timestamp || nowIso(),
    expires: ["end-of-turn", "end-of-combat", "until-removed", "next-turn"].includes(value.expires) ? value.expires : "until-removed",
    optional: Boolean(value.optional),
    usesRemaining: value.usesRemaining == null ? null : clamp(Math.floor(Number(value.usesRemaining) || 0), 0, 999),
    notes: normalizeText(value.notes, 500)
  };
}

function normalizeDecision(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: normalizeText(value.id, 100) || createId(),
    type: normalizeText(value.type, 60) || "choice",
    prompt: normalizeText(value.prompt, 500) || "Make a choice",
    playerIds: normalizeStringArray(value.playerIds, 6, 100),
    options: Array.isArray(value.options) ? value.options.slice(0, 80).map((option) => ({ id: normalizeText(option?.id, 120), label: normalizeText(option?.label, 180) })).filter((option) => option.id) : [],
    secret: Boolean(value.secret),
    minimum: clamp(Math.floor(Number(value.minimum) || 1), 0, 80),
    maximum: clamp(Math.floor(Number(value.maximum) || 1), 0, 80),
    responses: value.responses && typeof value.responses === "object" ? value.responses : {},
    status: ["open", "resolved", "cancelled"].includes(value.status) ? value.status : "open",
    context: value.context && typeof value.context === "object" ? value.context : {},
    createdAt: value.createdAt || nowIso()
  };
}

function normalizeRulesState(value, playerIds = []) {
  const validIds = new Set(playerIds);
  const source = value && typeof value === "object" ? value : {};
  return {
    version: RULES_VERSION,
    gameOver: Boolean(source.gameOver),
    winnerPlayerIds: normalizeStringArray(source.winnerPlayerIds, 6, 100).filter((id) => validIds.has(id)),
    loserPlayerIds: normalizeStringArray(source.loserPlayerIds, 6, 100).filter((id) => validIds.has(id)),
    monarchPlayerId: validIds.has(source.monarchPlayerId) ? source.monarchPlayerId : null,
    initiativePlayerId: validIds.has(source.initiativePlayerId) ? source.initiativePlayerId : null,
    dayNight: ["day", "night"].includes(source.dayNight) ? source.dayNight : null,
    decisions: (Array.isArray(source.decisions) ? source.decisions : []).map(normalizeDecision).filter(Boolean).slice(-MAX_RULE_DECISIONS),
    continuousEffects: (Array.isArray(source.continuousEffects) ? source.continuousEffects : []).map(normalizeRuleEffect).filter(Boolean).slice(-MAX_RULE_EFFECTS),
    replacementEffects: (Array.isArray(source.replacementEffects) ? source.replacementEffects : []).map(normalizeRuleEffect).filter(Boolean).slice(-MAX_RULE_EFFECTS),
    emblems: (Array.isArray(source.emblems) ? source.emblems : []).map(normalizeRuleEffect).filter(Boolean).slice(-MAX_RULE_EFFECTS),
    dungeonProgress: source.dungeonProgress && typeof source.dungeonProgress === "object" ? source.dungeonProgress : {},
    loopNotes: Array.isArray(source.loopNotes) ? source.loopNotes.slice(-40).map((entry) => ({ id: normalizeText(entry?.id,100)||createId(), text: normalizeText(entry?.text,500), result: normalizeText(entry?.result,300), createdAt: entry?.createdAt||nowIso() })) : [],
    lastStateCheckAt: source.lastStateCheckAt || null,
    stateCheckCount: clamp(Math.floor(Number(source.stateCheckCount) || 0), 0, 999999)
  };
}

function normalizeStackItem(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: normalizeText(value.id, 100) || createId(),
    kind: ["spell", "ability", "trigger", "custom"].includes(value.kind) ? value.kind : "custom",
    name: normalizeText(value.name, 180) || "Stack item",
    controllerId: normalizeText(value.controllerId, 100),
    sourceCardId: normalizeText(value.sourceCardId, 100) || null,
    sourceZone: normalizeText(value.sourceZone, 30) || null,
    card: value.card ? migrateCard(value.card, normalizeText(value.controllerId, 100)) : null,
    text: normalizeText(value.text, 2500),
    targets: normalizeTargetList(value.targets),
    effect: value.effect && typeof value.effect === "object" ? {
      action: normalizeText(value.effect.action, 40),
      amount: clamp(Math.floor(Number(value.effect.amount) || 0), -999, 999),
      counterName: normalizeText(value.effect.counterName, 40),
      tokenName: normalizeText(value.effect.tokenName, 80),
      power: normalizeText(value.effect.power, 12),
      toughness: normalizeText(value.effect.toughness, 12),
      destination: normalizeText(value.effect.destination, 30)
    } : null,
    createdAt: value.createdAt || nowIso()
  };
}

function normalizeTriggerItem(value) {
  if (!value || typeof value !== "object") return null;
  return {
    id: normalizeText(value.id, 100) || createId(),
    controllerId: normalizeText(value.controllerId, 100),
    sourceCardId: normalizeText(value.sourceCardId, 100) || null,
    sourceName: normalizeText(value.sourceName, 180) || "Triggered ability",
    event: normalizeText(value.event, 80),
    text: normalizeText(value.text, 2500),
    targets: normalizeTargetList(value.targets),
    createdAt: value.createdAt || nowIso()
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
    deathtouchMarked: Boolean(migrated.deathtouchMarked),
    token: Boolean(migrated.token),
    commander: Boolean(migrated.commander),
    power: normalizeText(migrated.power || cardData?.power, 20),
    toughness: normalizeText(migrated.toughness || cardData?.toughness, 20),
    loyalty: normalizeText(migrated.loyalty || cardData?.loyalty, 20),
    attacking: Boolean(migrated.attacking),
    defendingPlayerId: normalizeText(migrated.defendingPlayerId, 100) || null,
    blockingCardId: normalizeText(migrated.blockingCardId, 100) || null,
    attachedToId: normalizeText(migrated.attachedToId, 100) || null,
    summoningSick: Boolean(migrated.summoningSick),
    faceDown: Boolean(migrated.faceDown),
    phasedOut: Boolean(migrated.phasedOut),
    activeFaceIndex: clamp(Math.floor(Number(migrated.activeFaceIndex) || 0), 0, 3),
    manualKeywords: normalizeStringArray(migrated.manualKeywords, 30, 60),
    temporaryEffects: normalizeTemporaryEffects(migrated.temporaryEffects),
    chosenValues: migrated.chosenValues && typeof migrated.chosenValues === "object" ? migrated.chosenValues : {},
    copiedFromCardId: normalizeText(migrated.copiedFromCardId, 100) || null,
    linkedCardIds: normalizeStringArray(migrated.linkedCardIds, 30, 100),
    mergedCardIds: normalizeStringArray(migrated.mergedCardIds, 30, 100),
    revealed: Boolean(migrated.revealed),
    objectType: normalizeText(migrated.objectType, 40) || "card",
    defense: normalizeText(migrated.defense, 20),
    lore: clamp(Math.floor(Number(migrated.lore) || 0), 0, 999),
    level: clamp(Math.floor(Number(migrated.level) || 0), 0, 999),
    ruleEffects: (Array.isArray(migrated.ruleEffects) ? migrated.ruleEffects : []).map(normalizeRuleEffect).filter(Boolean).slice(-60),
    judgeOverrides: migrated.judgeOverrides && typeof migrated.judgeOverrides === "object" ? migrated.judgeOverrides : {},
    specialState: migrated.specialState && typeof migrated.specialState === "object" ? migrated.specialState : {},
    notes: normalizeText(migrated.notes, 500),
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
    commanderDamage,
    manaPool: normalizeManaPool(source.manaPool),
    lost: Boolean(source.lost),
    lossReason: normalizeText(source.lossReason, 240),
    drawFailed: Boolean(source.drawFailed),
    mulliganCount: clamp(Math.floor(Number(source.mulliganCount) || 0), 0, 99),
    mulliganBottomRequired: clamp(Math.floor(Number(source.mulliganBottomRequired) || 0), 0, 99),
    pregameComplete: Boolean(source.pregameComplete),
    energy: clamp(Math.floor(Number(source.energy) || 0), 0, 999),
    experience: clamp(Math.floor(Number(source.experience) || 0), 0, 999),
    radiation: clamp(Math.floor(Number(source.radiation) || 0), 0, 999),
    maxHandSize: source.maxHandSize == null ? 7 : clamp(Math.floor(Number(source.maxHandSize) || 0), -1, 999),
    companion: source.companion ? migrateCard(source.companion, playerId) : null
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
      order,
      deadlineAt: room.turn?.deadlineAt || null
    };
  } else if (room.status === "rolloff") {
    room.turn = { number: 0, phaseIndex: 0, activePlayerId: null, order: [] };
  } else {
    room.turn = null;
  }
  room.settings = normalizeRoomSettings(room.settings);
  room.emotes = normalizeEmotes(room.emotes);
  room.replayFrames = normalizeReplayFrames(room.replayFrames);
  room.spectators = [];
  room.stack = Array.isArray(room.stack) ? room.stack.map(normalizeStackItem).filter(Boolean).slice(-MAX_STACK_ITEMS) : [];
  room.triggerQueue = Array.isArray(room.triggerQueue) ? room.triggerQueue.map(normalizeTriggerItem).filter(Boolean).slice(-MAX_TRIGGER_ITEMS) : [];
  room.priority = room.priority && typeof room.priority === "object" ? {
    playerId: allPlayerIds.includes(room.priority.playerId) ? room.priority.playerId : room.turn?.activePlayerId || allPlayerIds[0] || null,
    passedPlayerIds: Array.isArray(room.priority.passedPlayerIds) ? room.priority.passedPlayerIds.filter((id) => allPlayerIds.includes(id)) : []
  } : { playerId: room.turn?.activePlayerId || allPlayerIds[0] || null, passedPlayerIds: [] };
  room.actionHistory = Array.isArray(room.actionHistory) ? room.actionHistory.slice(-MAX_ACTION_HISTORY) : [];
  room.undoStack = [];
  room.rules = normalizeRulesState(room.rules, allPlayerIds);
  room.players.forEach((player) => { if (player.deck) player.deckValidation = validateCommanderDeck(player.deck); });
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
    spectators: [],
    undoStack: [],
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

function validateCommanderDeck(deck) {
  const normalized = normalizeDeck(deck);
  if (!normalized) return { valid: false, errors: ["Deck data is incomplete."], warnings: [], colorIdentity: [] };
  const errors = [];
  const warnings = [];
  if (normalized.totalCards !== 100) errors.push(`Commander decks need exactly 100 cards including commander(s); this deck has ${normalized.totalCards}.`);
  if (normalized.commanders.length < 1 || normalized.commanders.length > 2) errors.push("Choose one commander, or two commanders when their card rules allow it.");
  const commanderColors = new Set();
  for (const data of normalized.commanderData || []) for (const color of data.colorIdentity || []) commanderColors.add(color);
  if (!(normalized.commanderData || []).length) warnings.push("Commander color identity could not be fully verified because commander data is missing.");
  const counts = new Map();
  for (const entry of normalized.cards) {
    const key = entry.name.toLocaleLowerCase("en-US");
    counts.set(key, (counts.get(key) || 0) + entry.quantity);
    const typeLine = entry.cardData?.typeLine || "";
    const oracle = entry.cardData?.oracleText || "";
    const unlimited = /basic land/i.test(typeLine) || /a deck can have any number of cards named/i.test(oracle) || /up to nine cards named/i.test(oracle);
    if (entry.quantity > 1 && !unlimited && !normalized.commanders.some((name) => name.toLocaleLowerCase("en-US") === key)) errors.push(`${entry.name} appears ${entry.quantity} times.`);
    for (const color of entry.cardData?.colorIdentity || []) if (commanderColors.size && !commanderColors.has(color)) errors.push(`${entry.name} is outside the commander's color identity.`);
  }
  for (const commander of normalized.commanders) if (!counts.has(commander.toLocaleLowerCase("en-US"))) warnings.push(`${commander} is not present in the submitted deck list; it will still be created in the command zone.`);
  const unrecognized = normalized.cards.filter((entry) => !entry.cardData?.scryfallId).length;
  if (unrecognized) warnings.push(`${unrecognized} unique card name(s) could not be rules-validated and remain manually playable.`);
  warnings.push("The current Commander banned list is not hard-coded; hosts can reject or allow cards using Judge Mode so rule updates never lock the app.");
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], colorIdentity: [...commanderColors], checkedAt: nowIso() };
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
    defendingPlayerId: options.defendingPlayerId,
    blockingCardId: options.blockingCardId,
    attachedToId: options.attachedToId,
    summoningSick: options.summoningSick,
    faceDown: options.faceDown,
    phasedOut: options.phasedOut,
    activeFaceIndex: options.activeFaceIndex,
    manualKeywords: options.manualKeywords,
    temporaryEffects: options.temporaryEffects,
    chosenValues: options.chosenValues,
    copiedFromCardId: options.copiedFromCardId,
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
    commanderDamage,
    manaPool: normalizeManaPool(null),
    lost: false,
    lossReason: "",
    drawFailed: false,
    mulliganCount: 0,
    mulliganBottomRequired: 0,
    pregameComplete: false,
    energy: 0,
    experience: 0,
    radiation: 0,
    maxHandSize: 7,
    companion: null
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

function currentCardFace(card) {
  const faces = card?.cardData?.faces || [];
  return faces[card?.activeFaceIndex || 0] || null;
}

function currentTypeLine(card) {
  return currentCardFace(card)?.typeLine || card?.cardData?.typeLine || "";
}

function currentOracleText(card) {
  return currentCardFace(card)?.oracleText || card?.cardData?.oracleText || "";
}

function keywordSet(card) {
  const result = new Set([...(card?.cardData?.keywords || []), ...(card?.manualKeywords || [])].map((value) => String(value).toLowerCase()));
  for (const effect of card?.temporaryEffects || []) if (effect.keyword) result.add(effect.keyword.toLowerCase());
  const oracle = currentOracleText(card).toLowerCase();
  for (const keyword of ["deathtouch", "double strike", "first strike", "haste", "hexproof", "indestructible", "lifelink", "menace", "reach", "trample", "vigilance", "flying", "defender"]) {
    if (oracle.includes(keyword)) result.add(keyword);
  }
  return result;
}

function hasKeyword(card, keyword) {
  return keywordSet(card).has(String(keyword).toLowerCase());
}

function isCreatureCard(card) {
  return /\bcreature\b/i.test(currentTypeLine(card)) || (parseStat(card?.power) !== null && parseStat(card?.toughness) !== null);
}

function isPermanentCard(card) {
  return /\b(artifact|battle|creature|enchantment|land|planeswalker)\b/i.test(currentTypeLine(card));
}

function effectiveStats(card) {
  const face = currentCardFace(card);
  const basePower = parseStat(face?.power || card.power);
  const baseToughness = parseStat(face?.toughness || card.toughness);
  if (basePower === null || baseToughness === null) return null;
  const plus = Number(card.counters?.["+1/+1"]) || 0;
  const minus = Number(card.counters?.["-1/-1"]) || 0;
  const layered = [...(card.ruleEffects || [])].sort((a,b) => (a.layer - b.layer) || String(a.timestamp).localeCompare(String(b.timestamp)));
  const temporaryPower = [...(card.temporaryEffects || []), ...layered].reduce((sum, effect) => sum + (Number(effect.power) || 0), 0);
  const temporaryToughness = [...(card.temporaryEffects || []), ...layered].reduce((sum, effect) => sum + (Number(effect.toughness) || 0), 0);
  const overridePower = parseStat(card.judgeOverrides?.power);
  const overrideToughness = parseStat(card.judgeOverrides?.toughness);
  return {
    power: clamp((overridePower ?? basePower) + plus - minus + temporaryPower, -99, 999),
    toughness: clamp((overrideToughness ?? baseToughness) + plus - minus + temporaryToughness, -99, 999)
  };
}

function isLethal(card) {
  const stats = effectiveStats(card);
  if (!stats) return false;
  if (stats.toughness <= 0) return true;
  if (hasKeyword(card, "indestructible")) return false;
  return Boolean(card.deathtouchMarked || card.damageMarked >= stats.toughness);
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
    validation: deck.validation,
    validationDetails: validateCommanderDeck(deck)
  } : null;
}

function publicCard(card) {
  const face = currentCardFace(card);
  return {
    id: card.id,
    name: card.faceDown ? "Face-down card" : (face?.name || card.name),
    printedName: card.name,
    ownerId: card.ownerId,
    controllerId: card.controllerId,
    tapped: card.tapped,
    counters: { ...card.counters },
    damageMarked: card.damageMarked,
    deathtouchMarked: card.deathtouchMarked,
    token: card.token,
    commander: card.commander,
    power: card.faceDown ? "2" : (face?.power || card.power),
    toughness: card.faceDown ? "2" : (face?.toughness || card.toughness),
    loyalty: card.faceDown ? "" : (face?.loyalty || card.loyalty),
    cardData: card.faceDown ? null : card.cardData,
    attacking: card.attacking,
    defendingPlayerId: card.defendingPlayerId,
    blockingCardId: card.blockingCardId,
    attachedToId: card.attachedToId,
    summoningSick: card.summoningSick,
    faceDown: card.faceDown,
    phasedOut: card.phasedOut,
    activeFaceIndex: card.activeFaceIndex,
    manualKeywords: [...card.manualKeywords],
    temporaryEffects: card.temporaryEffects.map((effect) => ({ ...effect })),
    chosenValues: { ...card.chosenValues },
    copiedFromCardId: card.copiedFromCardId,
    linkedCardIds: [...card.linkedCardIds],
    mergedCardIds: [...card.mergedCardIds],
    revealed: card.revealed,
    objectType: card.objectType,
    defense: card.defense,
    lore: card.lore,
    level: card.level,
    ruleEffects: card.ruleEffects.map((effect) => ({ ...effect })),
    judgeOverrides: { ...card.judgeOverrides },
    specialState: { ...card.specialState },
    notes: card.notes,
    keywords: [...keywordSet(card)],
    currentFace: card.faceDown ? null : face,
    effectiveStats: card.faceDown ? { power: 2, toughness: 2 } : effectiveStats(card),
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
    manaPool: { ...game.manaPool },
    lost: game.lost,
    lossReason: game.lossReason,
    mulliganCount: game.mulliganCount,
    mulliganBottomRequired: game.mulliganBottomRequired,
    pregameComplete: game.pregameComplete,
    energy: game.energy,
    experience: game.experience,
    radiation: game.radiation,
    maxHandSize: game.maxHandSize,
    companion: game.companion ? publicCard(game.companion) : null,
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
    settings: { ...normalizeRoomSettings(room.settings) },
    spectatorCount: Array.isArray(room.spectators) ? room.spectators.length : 0,
    spectators: (room.spectators || []).map((spectator) => ({ id: spectator.id, name: spectator.name, connected: spectator.connected })),
    emotes: normalizeEmotes(room.emotes),
    replayFrames: normalizeReplayFrames(room.replayFrames),
    persistence: persistenceSummary(),
    phases: PHASES,
    turn: room.turn ? { ...room.turn, order: [...(room.turn.order || [])] } : null,
    rollOff: publicStartingRollOff(room.rollOff),
    stack: room.stack.map((item) => ({ ...item, card: item.card ? publicCard(item.card) : null })),
    triggerQueue: room.triggerQueue.map((item) => ({ ...item })),
    priority: { ...room.priority, passedPlayerIds: [...(room.priority?.passedPlayerIds || [])] },
    rules: normalizeRulesState(room.rules, room.players.map((player) => player.id)),
    actionHistory: room.actionHistory.slice(-100),
    canUndo: Boolean(room.undoStack?.length),
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
  for (const spectator of room.spectators || []) {
    if (!spectator.socketId) continue;
    const socket = io.sockets.sockets.get(spectator.socketId);
    if (socket) socket.emit("room-updated", createPublicRoom(room, null));
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
  card.defendingPlayerId = null;
  card.blockingCardId = null;
  card.attachedToId = null;
  card.damageMarked = 0;
  card.deathtouchMarked = false;
  if (toZone !== "battlefield") {
    card.tapped = false;
    card.summoningSick = false;
  } else {
    card.controllerId = player.id;
    card.summoningSick = isCreatureCard(card);
  }
  if (toZone === "library" && position === "bottom") player.game.library.push(card);
  else player.game[toZone].unshift(card);
  return { card, removedToken: false };
}

function clearCombat(room) {
  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      card.attacking = false;
      card.defendingPlayerId = null;
      card.blockingCardId = null;
    }
  }
}

function clearDamage(room) {
  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      card.damageMarked = 0;
      card.deathtouchMarked = false;
    }
  }
}

function clearMana(room) {
  for (const player of room.players) if (player.game) player.game.manaPool = normalizeManaPool(null);
}

function expireEndOfTurnEffects(room) {
  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) card.temporaryEffects = card.temporaryEffects.filter((effect) => effect.expires !== "end-of-turn");
  }
}

function activePlayers(room) {
  const order = Array.isArray(room.turn?.order) && room.turn.order.length ? room.turn.order : room.players.map((player) => player.id);
  const byId = new Map(room.players.map((player) => [player.id, player]));
  return order.map((id) => byId.get(id)).filter((player) => player?.game && !player.game.conceded && !player.game.lost);
}

function activePlayerIds(room) {
  return activePlayers(room).map((player) => player.id);
}

function nextPlayerId(room, currentId) {
  const ids = activePlayerIds(room);
  if (!ids.length) return null;
  const index = ids.indexOf(currentId);
  return ids[(index + 1 + ids.length) % ids.length];
}

function resetPriority(room, startingPlayerId = null) {
  const ids = activePlayerIds(room);
  room.priority = { playerId: ids.includes(startingPlayerId) ? startingPlayerId : room.turn?.activePlayerId || ids[0] || null, passedPlayerIds: [] };
}

function snapshotCoreRoom(room) {
  return JSON.parse(JSON.stringify({
    status: room.status,
    startedAt: room.startedAt,
    turn: room.turn,
    rollOff: room.rollOff,
    stack: room.stack,
    priority: room.priority,
    triggerQueue: room.triggerQueue,
    players: room.players.map((player) => ({ id: player.id, ready: player.ready, game: player.game }))
  }));
}

function pushUndo(room, actor, label, snapshot) {
  room.undoStack = Array.isArray(room.undoStack) ? room.undoStack : [];
  room.undoStack.push({ id: createId(), time: nowIso(), actorId: actor.id, actorName: actor.name, label, snapshot });
  if (room.undoStack.length > MAX_UNDO_SNAPSHOTS) room.undoStack.splice(0, room.undoStack.length - MAX_UNDO_SNAPSHOTS);
}

function restoreSnapshot(room, entry) {
  const snapshot = entry?.snapshot;
  if (!snapshot) return false;
  room.status = snapshot.status;
  room.startedAt = snapshot.startedAt;
  room.turn = snapshot.turn;
  room.rollOff = snapshot.rollOff;
  room.stack = (snapshot.stack || []).map(normalizeStackItem).filter(Boolean);
  room.priority = snapshot.priority || { playerId: room.turn?.activePlayerId || null, passedPlayerIds: [] };
  room.triggerQueue = (snapshot.triggerQueue || []).map(normalizeTriggerItem).filter(Boolean);
  const byId = new Map((snapshot.players || []).map((player) => [player.id, player]));
  for (const player of room.players) {
    const saved = byId.get(player.id);
    if (!saved) continue;
    player.ready = Boolean(saved.ready);
    player.game = saved.game ? migrateGame(saved.game, player.id, room.startingLife, room.players.map((entry) => entry.id)) : null;
  }
  return true;
}

function recordAction(room, actor, type, detail = "") {
  room.actionHistory = Array.isArray(room.actionHistory) ? room.actionHistory : [];
  room.actionHistory.push({ id: createId(), time: nowIso(), actorId: actor.id, actorName: actor.name, type, detail: normalizeText(detail, 300) });
  if (room.actionHistory.length > MAX_ACTION_HISTORY) room.actionHistory.splice(0, room.actionHistory.length - MAX_ACTION_HISTORY);
}

function locateCard(room, cardId) {
  for (const player of room.players) {
    if (!player.game) continue;
    for (const zone of ["battlefield", "hand", "graveyard", "exile", "commandZone", "library"]) {
      const index = player.game[zone].findIndex((card) => card.id === cardId);
      if (index >= 0) return { player, zone, index, card: player.game[zone][index] };
    }
  }
  return null;
}

function controlledBattlefieldCard(room, actor, cardId) {
  const located = findBattlefieldCard(room, String(cardId || ""));
  return located && located.card.controllerId === actor.id ? located : null;
}

function validateTargets(room, targets) {
  const valid = [];
  for (const target of normalizeTargetList(targets)) {
    const [kind, id] = target.split(":");
    if (kind === "player" && findPlayer(room, id)) valid.push(target);
    if (kind === "card" && locateCard(room, id)) valid.push(target);
  }
  return valid;
}

function pushStack(room, item, priorityPlayerId) {
  const normalized = normalizeStackItem(item);
  if (!normalized) return null;
  room.stack.push(normalized);
  if (room.stack.length > MAX_STACK_ITEMS) room.stack.splice(0, room.stack.length - MAX_STACK_ITEMS);
  resetPriority(room, priorityPlayerId || normalized.controllerId);
  return normalized;
}

function applySimpleEffect(room, item) {
  const effect = item.effect;
  if (!effect?.action) return;
  const targets = item.targets || [];
  const playerTarget = targets.map((target) => target.startsWith("player:") ? findPlayer(room, target.slice(7)) : null).find(Boolean);
  const cardTarget = targets.map((target) => target.startsWith("card:") ? locateCard(room, target.slice(5)) : null).find(Boolean);
  const controller = findPlayer(room, item.controllerId);
  const amount = effect.amount || 1;
  switch (effect.action) {
    case "draw": {
      const target = playerTarget || controller;
      let drawn = 0;
      while (target?.game?.library.length && drawn < clamp(amount, 1, 20)) { target.game.hand.push(target.game.library.shift()); drawn += 1; }
      break;
    }
    case "gain-life": if (playerTarget || controller) (playerTarget || controller).game.life = clamp((playerTarget || controller).game.life + amount, -999, 9999); break;
    case "lose-life": if (playerTarget || controller) (playerTarget || controller).game.life = clamp((playerTarget || controller).game.life - Math.abs(amount), -999, 9999); break;
    case "damage":
      if (playerTarget) playerTarget.game.life = clamp(playerTarget.game.life - Math.abs(amount), -999, 9999);
      else if (cardTarget) cardTarget.card.damageMarked = clamp(cardTarget.card.damageMarked + Math.abs(amount), 0, 999);
      break;
    case "tap": if (cardTarget) cardTarget.card.tapped = true; break;
    case "untap": if (cardTarget) cardTarget.card.tapped = false; break;
    case "counter": if (cardTarget) cardTarget.card.counters[effect.counterName || "+1/+1"] = clamp((Number(cardTarget.card.counters[effect.counterName || "+1/+1"]) || 0) + amount, -99, 999); break;
    case "destroy": if (cardTarget && !hasKeyword(cardTarget.card, "indestructible")) { const [card] = cardTarget.player.game[cardTarget.zone].splice(cardTarget.index, 1); if (!card.token) cardTarget.player.game.graveyard.unshift(card); } break;
    case "exile": if (cardTarget) { const [card] = cardTarget.player.game[cardTarget.zone].splice(cardTarget.index, 1); if (!card.token) cardTarget.player.game.exile.unshift(card); } break;
    case "token": if (controller?.game) controller.game.battlefield.unshift(createCard(effect.tokenName || "Token", controller.id, { token: true, power: effect.power || "1", toughness: effect.toughness || "1" })); break;
    default: break;
  }
}

function resolveStackTop(room, resolverName = "Table") {
  const item = room.stack.pop();
  if (!item) return null;
  const controller = findPlayer(room, item.controllerId);
  if (item.kind === "spell" && item.card && controller?.game) {
    item.card.controllerId = controller.id;
    item.card.tapped = false;
    item.card.attacking = false;
    item.card.defendingPlayerId = null;
    if (isPermanentCard(item.card)) {
      item.card.summoningSick = isCreatureCard(item.card);
      controller.game.battlefield.unshift(item.card);
      queueSuggestedTriggers(room, "PERMANENT_ENTERED", { card: item.card, controllerId: controller.id });
    } else if (!item.card.token) {
      const owner = findPlayer(room, item.card.ownerId) || controller;
      owner.game.graveyard.unshift(item.card);
    }
  }
  applySimpleEffect(room, item);
  addLog(room, `${resolverName} resolved ${item.name}.`, "stack");
  resetPriority(room, room.turn?.activePlayerId);
  return item;
}

function counterStackItem(room, itemId, actor) {
  const index = room.stack.findIndex((item) => item.id === itemId);
  if (index < 0) return null;
  const [item] = room.stack.splice(index, 1);
  if (item.kind === "spell" && item.card && !item.card.token) {
    const owner = findPlayer(room, item.card.ownerId) || findPlayer(room, item.controllerId);
    owner?.game?.graveyard.unshift(item.card);
  }
  addLog(room, `${actor.name} countered or removed ${item.name} from the stack.`, "stack");
  resetPriority(room, room.turn?.activePlayerId);
  return item;
}

function queueTrigger(room, trigger) {
  const normalized = normalizeTriggerItem(trigger);
  if (!normalized) return null;
  room.triggerQueue.push(normalized);
  if (room.triggerQueue.length > MAX_TRIGGER_ITEMS) room.triggerQueue.splice(0, room.triggerQueue.length - MAX_TRIGGER_ITEMS);
  return normalized;
}

function queueSuggestedTriggers(room, event, context = {}) {
  const patterns = {
    UPKEEP_START: /at the beginning of (your|each|each player'?s|each opponent'?s) upkeep/i,
    END_STEP_START: /at the beginning of (your|each|the) end step/i,
    PERMANENT_ENTERED: /(when|whenever).{0,100}(enters the battlefield|enters)/i,
    CREATURE_DIED: /(when|whenever).{0,100}(dies|is put into a graveyard)/i,
    SPELL_CAST: /whenever.{0,100}cast/i,
    ATTACKS: /(when|whenever).{0,100}attacks/i
  };
  const pattern = patterns[event];
  if (!pattern) return;
  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      if (card.phasedOut || !pattern.test(currentOracleText(card))) continue;
      queueTrigger(room, { controllerId: card.controllerId, sourceCardId: card.id, sourceName: card.name, event, text: currentOracleText(card), createdAt: nowIso() });
    }
  }
}

function dealsInCombatPass(card, pass) {
  const first = hasKeyword(card, "first strike");
  const double = hasKeyword(card, "double strike");
  return pass === "first" ? first || double : !first || double;
}

function dealCreatureDamage(room, source, target, amount) {
  const dealt = Math.max(0, amount);
  target.damageMarked = clamp(target.damageMarked + dealt, 0, 999);
  if (dealt > 0 && hasKeyword(source, "deathtouch")) target.deathtouchMarked = true;
  if (dealt > 0 && hasKeyword(source, "lifelink")) {
    const controller = findPlayer(room, source.controllerId);
    if (controller?.game) controller.game.life = clamp(controller.game.life + dealt, -999, 9999);
  }
  return dealt;
}

function dealPlayerDamage(room, source, player, amount) {
  const dealt = Math.max(0, amount);
  player.game.life = clamp(player.game.life - dealt, -999, 9999);
  if (source.commander) {
    const sourceId = source.ownerId;
    if (sourceId !== player.id) player.game.commanderDamage[sourceId] = clamp((Number(player.game.commanderDamage[sourceId]) || 0) + dealt, 0, 99);
  }
  if (dealt > 0 && hasKeyword(source, "lifelink")) {
    const controller = findPlayer(room, source.controllerId);
    if (controller?.game) controller.game.life = clamp(controller.game.life + dealt, -999, 9999);
  }
}

function resolveCombatDamage(room, pass = "normal") {
  const activeId = room.turn?.activePlayerId;
  const attackers = [];
  for (const player of room.players) for (const card of player.game?.battlefield || []) if (card.attacking && card.controllerId === activeId && !card.phasedOut) attackers.push(card);
  for (const attacker of attackers) {
    const attackerStats = effectiveStats(attacker);
    if (!attackerStats || !dealsInCombatPass(attacker, pass)) continue;
    const blockers = [];
    for (const player of room.players) for (const card of player.game?.battlefield || []) if (card.blockingCardId === attacker.id && !card.phasedOut) blockers.push(card);
    const defender = findPlayer(room, attacker.defendingPlayerId);
    if (!blockers.length) {
      if (defender) dealPlayerDamage(room, attacker, defender, attackerStats.power);
      continue;
    }
    for (const blocker of blockers) {
      const blockerStats = effectiveStats(blocker);
      if (blockerStats && dealsInCombatPass(blocker, pass)) dealCreatureDamage(room, blocker, attacker, blockerStats.power);
    }
    let remaining = Math.max(0, attackerStats.power);
    if (hasKeyword(attacker, "trample")) {
      for (const blocker of blockers) {
        const stats = effectiveStats(blocker);
        if (!stats || remaining <= 0) continue;
        const lethalNeeded = hasKeyword(attacker, "deathtouch") ? 1 : Math.max(1, stats.toughness - blocker.damageMarked);
        const assigned = Math.min(remaining, lethalNeeded);
        dealCreatureDamage(room, attacker, blocker, assigned);
        remaining -= assigned;
      }
      if (remaining > 0 && defender) dealPlayerDamage(room, attacker, defender, remaining);
    } else {
      dealCreatureDamage(room, attacker, blockers[0], remaining);
    }
  }
  addLog(room, `${pass === "first" ? "First-strike" : "Normal"} combat damage was resolved with assisted keyword handling.`, "combat");
}

function resetTurnDeadline(room) {
  if (!room?.turn) return;
  const seconds = normalizeRoomSettings(room.settings).turnTimerSeconds;
  room.turn.deadlineAt = seconds > 0 ? new Date(Date.now() + seconds * 1000).toISOString() : null;
}

function createReplayFrame(room, actorName, label) {
  const phase = room.phases?.[room.turn?.phaseIndex] || PHASES[room.turn?.phaseIndex || 0] || "";
  return {
    id: createId(),
    time: nowIso(),
    label: normalizeText(label, 180) || "Game action",
    actorName: normalizeText(actorName, 24),
    turn: room.turn ? { number: room.turn.number, phaseIndex: room.turn.phaseIndex, activePlayerId: room.turn.activePlayerId, order: [...(room.turn.order || [])], deadlineAt: room.turn.deadlineAt || null } : null,
    phase,
    priorityPlayerId: room.priority?.playerId || null,
    stack: room.stack.slice(-12).map((item) => ({ id: item.id, name: item.name, kind: item.kind, controllerId: item.controllerId, targets: [...(item.targets || [])] })),
    players: room.players.map((player) => ({
      id: player.id, name: player.name, life: player.game?.life ?? null, poison: player.game?.poison ?? null, commanderTax: player.game?.commanderTax ?? null,
      handCount: player.game?.hand?.length ?? 0, libraryCount: player.game?.library?.length ?? 0, graveyardCount: player.game?.graveyard?.length ?? 0, exileCount: player.game?.exile?.length ?? 0,
      battlefield: (player.game?.battlefield || []).map((card) => ({ id: card.id, name: card.name, tapped: card.tapped, counters: { ...card.counters }, damageMarked: card.damageMarked, attacking: card.attacking, defendingPlayerId: card.defendingPlayerId, blockingCardId: card.blockingCardId, attachedToId: card.attachedToId, commander: card.commander, token: card.token }))
    }))
  };
}

function recordReplayFrame(room, actorName, label) {
  if (room.status !== "started") return;
  room.replayFrames = Array.isArray(room.replayFrames) ? room.replayFrames : [];
  room.replayFrames.push(createReplayFrame(room, actorName, label));
  if (room.replayFrames.length > MAX_REPLAY_FRAMES) room.replayFrames.splice(0, room.replayFrames.length - MAX_REPLAY_FRAMES);
}

function advanceTurn(room) {
  const players = activePlayers(room);
  if (players.length === 0) return;
  clearCombat(room);
  clearDamage(room);
  clearMana(room);
  expireEndOfTurnEffects(room);
  const currentIndex = players.findIndex((player) => player.id === room.turn.activePlayerId);
  const next = players[(currentIndex + 1 + players.length) % players.length];
  room.turn.activePlayerId = next.id;
  room.turn.phaseIndex = 0;
  room.turn.number += 1;
  next.game.battlefield.forEach((card) => { card.tapped = false; card.summoningSick = false; });
  resetPriority(room, next.id);
  resetTurnDeadline(room);
  addLog(room, `Turn ${room.turn.number}: ${next.name} is active. Clockwise play continues.`, "turn");
}

function performStartingRoll(room, player, forcedRoll = null) {
  if (room.status !== "rolloff" || !room.rollOff) {
    return { success: false, error: "The starting-player roll is not active." };
  }
  if (!player.connected) return { success: false, error: "Reconnect before rolling." };
  if (player.game?.mulliganBottomRequired > 0) return { success:false, error:"Finish putting mulligan cards on the bottom before rolling." };
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
  room.turn = { number: 1, phaseIndex: 0, activePlayerId: winnerId, order, deadlineAt: null };
  resetPriority(room, winnerId);
  resetTurnDeadline(room);
  addLog(room, `${winner?.name || "The winner"} won the d20 roll with ${highest} and takes the first turn. Play proceeds clockwise.`, "turn");
  return { success: true, roll, completed: true, winnerPlayerId: winnerId };
}

function requireOwnedBattlefieldCard(actor, cardId, room = null) {
  if (room) return controlledBattlefieldCard(room, actor, cardId);
  const located = getCardFromZone(actor.game, "battlefield", String(cardId || ""));
  return located || null;
}

function queueRuleDecision(room, decision) {
  room.rules = normalizeRulesState(room.rules, room.players.map((player) => player.id));
  const normalized = normalizeDecision(decision);
  if (!normalized) return null;
  const duplicate = room.rules.decisions.find((entry) => entry.status === "open" && entry.type === normalized.type && JSON.stringify(entry.context) === JSON.stringify(normalized.context));
  if (duplicate) return duplicate;
  room.rules.decisions.push(normalized);
  if (room.rules.decisions.length > MAX_RULE_DECISIONS) room.rules.decisions.splice(0, room.rules.decisions.length - MAX_RULE_DECISIONS);
  return normalized;
}

function playerIsActiveInGame(player) {
  return Boolean(player?.game && !player.game.conceded && !player.game.lost);
}

function ownerZoneMove(room, located, destination = "graveyard") {
  if (!located?.card) return null;
  const [card] = located.player.game[located.zone].splice(located.index, 1);
  card.attacking = false; card.blockingCardId = null; card.defendingPlayerId = null; card.attachedToId = null; card.tapped = false;
  const owner = findPlayer(room, card.ownerId) || located.player;
  if (card.token && destination !== "battlefield") return card;
  if (!owner?.game?.[destination]) return card;
  owner.game[destination].unshift(card);
  return card;
}

function findAnyLocatedCard(room, cardId) { return locateCard(room, cardId); }

function runStateBasedActions(room, reason = "priority") {
  room.rules = normalizeRulesState(room.rules, room.players.map((player) => player.id));
  if (room.settings?.autoStateBasedActions === false) return [];
  const results = [];
  let changed = true;
  let passes = 0;
  while (changed && passes < 12) {
    changed = false; passes += 1;
    for (const player of room.players) {
      if (!player.game || player.game.lost || player.game.conceded) continue;
      let loss = "";
      if (player.game.life <= 0) loss = "life total reached zero";
      else if (player.game.poison >= 10) loss = "received ten poison counters";
      else if (Object.values(player.game.commanderDamage || {}).some((value) => Number(value) >= 21)) loss = "received 21 commander combat damage from one commander";
      else if (player.game.drawFailed) loss = "attempted to draw from an empty library";
      if (loss) { player.game.lost = true; player.game.lossReason = loss; results.push(`${player.name} lost: ${loss}.`); changed = true; }

      const battlefield = player.game.battlefield || [];
      const legendGroups = new Map();
      for (const card of battlefield) {
        const plus = Number(card.counters?.["+1/+1"]) || 0;
        const minus = Number(card.counters?.["-1/-1"]) || 0;
        const cancel = Math.min(Math.max(0, plus), Math.max(0, minus));
        if (cancel > 0) { card.counters["+1/+1"] = plus - cancel; card.counters["-1/-1"] = minus - cancel; if (!card.counters["+1/+1"]) delete card.counters["+1/+1"]; if (!card.counters["-1/-1"]) delete card.counters["-1/-1"]; changed = true; }
        if (/\blegendary\b/i.test(currentTypeLine(card)) && !card.token) {
          const key = (currentCardFace(card)?.name || card.name).toLocaleLowerCase("en-US");
          if (!legendGroups.has(key)) legendGroups.set(key, []); legendGroups.get(key).push(card);
        }
      }
      for (const cards of legendGroups.values()) if (cards.length > 1) queueRuleDecision(room, { type: "legend-rule", prompt: `Choose one ${cards[0].name} to keep.`, playerIds: [player.id], options: cards.map((card) => ({ id: card.id, label: card.name })), minimum: 1, maximum: 1, context: { controllerId: player.id, cardIds: cards.map((card) => card.id) } });

      for (let index = battlefield.length - 1; index >= 0; index -= 1) {
        const card = battlefield[index];
        const stats = effectiveStats(card);
        const typeLine = currentTypeLine(card);
        let shouldDie = false;
        if (stats && stats.toughness <= 0) shouldDie = true;
        else if (isCreatureCard(card) && isLethal(card)) shouldDie = true;
        else if (/planeswalker/i.test(typeLine) && (Number(card.counters?.loyalty ?? card.loyalty) || 0) <= 0) shouldDie = true;
        else if (/\bbattle\b/i.test(typeLine) && (Number(card.counters?.defense ?? card.defense) || 0) <= 0) shouldDie = true;
        if (shouldDie) {
          if ((Number(card.counters?.shield) || 0) > 0 && stats?.toughness > 0) { card.counters.shield -= 1; if (!card.counters.shield) delete card.counters.shield; card.damageMarked = 0; card.deathtouchMarked = false; results.push(`${card.name}'s shield counter prevented destruction.`); changed = true; }
          else if (stats?.toughness <= 0 || !hasKeyword(card, "indestructible")) { const removed = battlefield.splice(index,1)[0]; if (!removed.token) (findPlayer(room, removed.ownerId) || player).game.graveyard.unshift(removed); results.push(`${removed.name} was put into its owner's graveyard.`); changed = true; }
        }
      }
      for (const zone of ["graveyard", "exile", "hand", "library", "commandZone"]) {
        for (let index = player.game[zone].length - 1; index >= 0; index -= 1) if (player.game[zone][index].token) { player.game[zone].splice(index,1); changed = true; }
      }
    }
  }
  const active = room.players.filter(playerIsActiveInGame);
  if (room.status === "started" && active.length <= 1 && room.players.length > 1) {
    room.rules.gameOver = true;
    room.rules.winnerPlayerIds = active.map((player) => player.id);
    room.rules.loserPlayerIds = room.players.filter((player) => !active.includes(player)).map((player) => player.id);
  }
  room.rules.lastStateCheckAt = nowIso(); room.rules.stateCheckCount += 1;
  for (const text of results) addLog(room, text, "rules");
  return results;
}

function parseManaRequirement(card, xValue = 0) {
  const text = currentCardFace(card)?.manaCost || card?.cardData?.manaCost || "";
  const requirement = { W:0,U:0,B:0,R:0,G:0,C:0,generic:0 };
  for (const token of text.match(/\{[^}]+\}/g) || []) {
    const value = token.slice(1,-1).toUpperCase();
    if (Object.prototype.hasOwnProperty.call(requirement,value) && value !== "generic") requirement[value] += 1;
    else if (/^\d+$/.test(value)) requirement.generic += Number(value);
    else if (value === "X") requirement.generic += Math.max(0, Math.floor(Number(xValue)||0));
    else if (value.includes("/")) { const choices=value.split("/"); const color=choices.find((choice)=>Object.prototype.hasOwnProperty.call(requirement,choice)); if(color) requirement[color]+=1; else requirement.generic+=1; }
  }
  return requirement;
}

function payManaCost(player, card, payment, xValue = 0, commanderTax = 0) {
  const pool = player.game.manaPool;
  const used = normalizeManaPool(payment);
  for (const symbol of Object.keys(used)) if (used[symbol] > pool[symbol]) return { success:false, error:`Not enough ${symbol} mana.` };
  const req = parseManaRequirement(card,xValue); req.generic += commanderTax;
  for (const color of ["W","U","B","R","G","C"]) if (used[color] < req[color]) return { success:false, error:`The payment is missing ${req[color]-used[color]} ${color} mana.` };
  const coloredSpent=["W","U","B","R","G","C"].reduce((sum,color)=>sum+req[color],0);
  const totalSpent=Object.values(used).reduce((sum,value)=>sum+value,0);
  if (totalSpent-coloredSpent < req.generic) return { success:false, error:`The payment is missing ${req.generic-(totalSpent-coloredSpent)} generic mana.` };
  for (const symbol of Object.keys(used)) pool[symbol]-=used[symbol];
  return { success:true, requirement:req, spent:used };
}

function resolveRuleDecision(room, actor, action) {
  const decision = room.rules?.decisions?.find((entry) => entry.id === action?.decisionId && entry.status === "open");
  if (!decision || (!decision.playerIds.includes(actor.id) && room.hostId !== actor.id)) return { success:false, error:"That decision is not available to you." };
  const selections = normalizeStringArray(action?.selections, decision.maximum || 1, 120).filter((id)=>decision.options.some((option)=>option.id===id));
  if (selections.length < decision.minimum || selections.length > decision.maximum) return { success:false, error:`Choose between ${decision.minimum} and ${decision.maximum}.` };
  decision.responses[actor.id] = selections;
  const finished = decision.playerIds.every((id)=>Object.prototype.hasOwnProperty.call(decision.responses,id));
  if (finished) {
    decision.status="resolved";
    if (decision.type === "legend-rule") {
      const keepId = Object.values(decision.responses).flat()[0];
      for (const cardId of decision.context.cardIds || []) if (cardId !== keepId) { const located=locateCard(room,cardId); if(located?.zone==="battlefield") ownerZoneMove(room,located,"graveyard"); }
    }
  }
  return { success:true };
}

function applyJudgeAction(room, actor, action) {
  if (room.hostId !== actor.id && !action?.selfOnly) return { success:false, error:"Only the host/judge can use shared Judge Mode actions." };
  const mode=normalizeText(action?.mode,60);
  if (mode === "set-player") {
    const player=findPlayer(room,String(action?.targetPlayerId||actor.id)); if(!player?.game) return {success:false,error:"Choose a player."};
    const field=normalizeText(action?.field,40); const value=Number(action?.value);
    if (["life","poison","commanderTax","energy","experience","radiation","maxHandSize"].includes(field)) player.game[field]=clamp(Math.floor(value||0), field==="life"?-9999:field==="maxHandSize"?-1:0,99999); else return {success:false,error:"Unsupported player field."};
    addLog(room,`${actor.name} set ${player.name}'s ${field} to ${player.game[field]}.`,"judge"); return {success:true};
  }
  if (mode === "move-card") { const located=locateCard(room,String(action?.cardId||"")); const destination=String(action?.destination||""); if(!located||!ZONES.has(destination)) return {success:false,error:"Choose a card and destination."}; ownerZoneMove(room,located,destination); addLog(room,`${actor.name} moved ${located.card.name} to ${destination} using Judge Mode.`,"judge"); return {success:true}; }
  if (mode === "set-card") { const located=locateCard(room,String(action?.cardId||"")); if(!located) return {success:false,error:"Choose a card."}; const field=normalizeText(action?.field,50); const value=action?.value; if(["tapped","faceDown","phasedOut","revealed"].includes(field)) located.card[field]=value===true||value==="true"||value==="1"; else if(["power","toughness","typeLine","oracleText","name"].includes(field)) located.card.judgeOverrides[field]=normalizeText(value,field==="oracleText"?2500:200); else if(["damageMarked","lore","level"].includes(field)) located.card[field]=clamp(Math.floor(Number(value)||0),0,9999); else return {success:false,error:"Unsupported card field."}; addLog(room,`${actor.name} changed ${located.card.name}'s ${field}.`,"judge"); return {success:true}; }
  if (mode === "create-object") { const player=findPlayer(room,String(action?.targetPlayerId||actor.id)); if(!player?.game) return {success:false,error:"Choose a controller."}; const card=createCard(action?.name||"Custom Object",player.id,{token:action?.objectType!=="emblem",power:action?.power,toughness:action?.toughness,notes:action?.notes}); card.objectType=normalizeText(action?.objectType,40)||"token"; card.commander=Boolean(action?.commander); if(card.objectType==="emblem") room.rules.emblems.push(normalizeRuleEffect({kind:"emblem",label:card.name,controllerId:player.id,notes:action?.notes})); else player.game.battlefield.unshift(card); addLog(room,`${actor.name} created ${card.name}.`,"judge"); return {success:true}; }
  if (mode === "add-effect") { const effect=normalizeRuleEffect({kind:action?.kind,label:action?.label,controllerId:actor.id,targetIds:action?.targetIds,event:action?.event,operation:action?.operation,amount:action?.amount,power:action?.power,toughness:action?.toughness,keyword:action?.keyword,layer:action?.layer,expires:action?.expires,notes:action?.notes}); if(!effect) return {success:false,error:"Unable to create effect."}; if(effect.kind==="replacement"||effect.kind==="prevention") room.rules.replacementEffects.push(effect); else room.rules.continuousEffects.push(effect); for(const target of effect.targetIds){ if(target.startsWith("card:")){ const located=locateCard(room,target.slice(5)); if(located) located.card.ruleEffects.push(effect); }} addLog(room,`${actor.name} created rule effect: ${effect.label}.`,"judge"); return {success:true}; }
  if (mode === "remove-effect") { const id=String(action?.effectId||""); room.rules.continuousEffects=room.rules.continuousEffects.filter((entry)=>entry.id!==id); room.rules.replacementEffects=room.rules.replacementEffects.filter((entry)=>entry.id!==id); room.rules.emblems=room.rules.emblems.filter((entry)=>entry.id!==id); for(const player of room.players) for(const card of player.game?.battlefield||[]) card.ruleEffects=card.ruleEffects.filter((entry)=>entry.id!==id); return {success:true}; }
  if (mode === "role") { const target=String(action?.targetPlayerId||""); if(target && !findPlayer(room,target)) return {success:false,error:"Choose a player."}; const role=String(action?.role||""); if(role==="monarch") room.rules.monarchPlayerId=target||null; else if(role==="initiative") room.rules.initiativePlayerId=target||null; else if(role==="day") room.rules.dayNight="day"; else if(role==="night") room.rules.dayNight="night"; else if(role==="none-day-night") room.rules.dayNight=null; else return {success:false,error:"Choose a supported role."}; return {success:true}; }
  if (mode === "loop") { room.rules.loopNotes.push({id:createId(),text:normalizeText(action?.text,500),result:normalizeText(action?.result,300),createdAt:nowIso()}); return {success:true}; }
  return { success:false, error:"Unknown Judge Mode action." };
}

function processGameAction(room, actor, action) {
  if (!["rolloff", "started"].includes(room.status) || !actor.game) return { success: false, error: "The game has not started." };
  const type = normalizeText(action?.type, 60);
  const pregameActions = new Set(["take-mulligan", "finish-mulligan", "judge-action", "resolve-decision", "check-state-based"]);
  if (room.status === "rolloff" && !pregameActions.has(type)) return { success:false, error:"Only mulligans and Judge Mode are available during the starting roll-off." };
  const targetPlayer = findPlayer(room, String(action?.targetPlayerId || "")) || actor;
  const amount = clamp(Math.floor(Number(action?.amount) || 0), -9999, 9999);
  const noUndo = new Set(["pass-priority", "undo-last", "check-state-based"]);
  const before = noUndo.has(type) ? null : snapshotCoreRoom(room);
  let detail = type;

  switch (type) {
    case "take-mulligan": {
      actor.game.library.push(...actor.game.hand); actor.game.hand=[]; actor.game.library=shuffle(actor.game.library); actor.game.hand=actor.game.library.splice(0,Math.min(7,actor.game.library.length)); actor.game.mulliganCount+=1; actor.game.mulliganBottomRequired=Math.max(0,actor.game.mulliganCount-(room.settings?.freeCommanderMulligan!==false?1:0)); actor.game.pregameComplete=actor.game.mulliganBottomRequired===0; addLog(room,`${actor.name} took mulligan ${actor.game.mulliganCount}${actor.game.mulliganBottomRequired?` and must put ${actor.game.mulliganBottomRequired} card(s) on the bottom`:" (free multiplayer mulligan)"}.`,"setup"); break;
    }
    case "finish-mulligan": { const ids=normalizeStringArray(action?.cardIds,99,100); if(ids.length!==actor.game.mulliganBottomRequired) return {success:false,error:`Choose exactly ${actor.game.mulliganBottomRequired} card(s) to put on the bottom.`}; for(const id of ids){ const located=getCardFromZone(actor.game,"hand",id); if(!located) return {success:false,error:"A selected card is no longer in hand."}; const [card]=actor.game.hand.splice(located.index,1); actor.game.library.push(card); } actor.game.mulliganBottomRequired=0; actor.game.pregameComplete=true; addLog(room,`${actor.name} completed their mulligan.`,"setup"); break; }
    case "resolve-decision": { const result=resolveRuleDecision(room,actor,action); if(!result.success)return result; break; }
    case "judge-action": { const result=applyJudgeAction(room,actor,action); if(!result.success)return result; break; }
    case "check-state-based": runStateBasedActions(room,"manual"); break;
    case "player-counter": { const field=normalizeText(action?.field,30); if(!["energy","experience","radiation"].includes(field)) return {success:false,error:"Choose energy, experience or radiation."}; targetPlayer.game[field]=clamp(targetPlayer.game[field]+amount,0,999); break; }
    case "life": targetPlayer.game.life = clamp(targetPlayer.game.life + amount, -999, 9999); addLog(room, `${actor.name} changed ${targetPlayer.name}'s life to ${targetPlayer.game.life}.`, "life"); break;
    case "poison": targetPlayer.game.poison = clamp(targetPlayer.game.poison + amount, 0, 99); addLog(room, `${targetPlayer.name} now has ${targetPlayer.game.poison} poison.`, "counter"); break;
    case "commander-tax": targetPlayer.game.commanderTax = clamp(targetPlayer.game.commanderTax + amount, 0, 99); addLog(room, `${targetPlayer.name}'s commander tax is ${targetPlayer.game.commanderTax}.`, "counter"); break;
    case "commander-damage": {
      const sourceId = String(action?.sourcePlayerId || ""); const source = findPlayer(room, sourceId);
      if (!source || sourceId === targetPlayer.id) return { success: false, error: "Choose a valid opposing commander." };
      targetPlayer.game.commanderDamage[sourceId] = clamp((Number(targetPlayer.game.commanderDamage[sourceId]) || 0) + amount, 0, 99);
      addLog(room, `${targetPlayer.name} has ${targetPlayer.game.commanderDamage[sourceId]} commander damage from ${source.name}.`, "counter"); break;
    }
    case "draw": { let drawn = 0; const count = clamp(amount || 1, 1, 20); while (drawn < count && actor.game.library.length) { actor.game.hand.push(actor.game.library.shift()); drawn += 1; } if (drawn < count) actor.game.drawFailed = true; addLog(room, `${actor.name} drew ${drawn} card${drawn === 1 ? "" : "s"}.`, "card"); break; }
    case "mill": { let milled = 0; const count = clamp(amount || 1, 1, 50); while (milled < count && actor.game.library.length) { actor.game.graveyard.unshift(actor.game.library.shift()); milled += 1; } addLog(room, `${actor.name} milled ${milled} card${milled === 1 ? "" : "s"}.`, "card"); break; }
    case "shuffle": actor.game.library = shuffle(actor.game.library); addLog(room, `${actor.name} shuffled their library.`, "card"); break;
    case "mulligan": actor.game.library.push(...actor.game.hand); actor.game.hand = []; actor.game.library = shuffle(actor.game.library); actor.game.hand = actor.game.library.splice(0, Math.min(7, actor.game.library.length)); addLog(room, `${actor.name} took a sandbox mulligan to seven.`, "card"); break;
    case "move-card": {
      const result = moveCard(actor, String(action?.fromZone || ""), String(action?.toZone || ""), String(action?.cardId || ""), action?.position);
      if (!result) return { success: false, error: "That card could not be moved." };
      if (action.toZone === "battlefield") queueSuggestedTriggers(room, "PERMANENT_ENTERED", { card: result.card, controllerId: actor.id });
      addLog(room, result.removedToken ? `${actor.name}'s ${result.card.name} token left the battlefield.` : `${actor.name} moved ${result.card.name} to ${action.toZone === "commandZone" ? "the command zone" : action.toZone}.`, "card"); break;
    }
    case "tap-card": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.tapped = !located.card.tapped; addLog(room, `${actor.name} ${located.card.tapped ? "tapped" : "untapped"} ${located.card.name}.`, "card"); break; }
    case "card-counter": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; const name = normalizeText(action?.counterName, 30) || "counter"; const next = clamp((Number(located.card.counters[name]) || 0) + amount, -99, 999); if (!next) delete located.card.counters[name]; else located.card.counters[name] = next; addLog(room, `${located.card.name} now has ${next} ${name} counter${Math.abs(next) === 1 ? "" : "s"}.`, "counter"); break; }
    case "set-card-stats": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.power = normalizeText(action?.power, 12); located.card.toughness = normalizeText(action?.toughness, 12); located.card.notes = normalizeText(action?.notes, 500); addLog(room, `${actor.name} set ${located.card.name}'s stats to ${located.card.power || "?"}/${located.card.toughness || "?"}.`, "card"); break; }
    case "mark-damage": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.damageMarked = clamp(located.card.damageMarked + amount, 0, 999); addLog(room, `${located.card.name} has ${located.card.damageMarked} damage marked${isLethal(located.card) ? " and is marked lethal" : ""}.`, "damage"); break; }
    case "clear-card-damage": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.damageMarked = 0; located.card.deathtouchMarked = false; addLog(room, `${actor.name} cleared damage from ${located.card.name}.`, "damage"); break; }
    case "fight-card": {
      const source = controlledBattlefieldCard(room, actor, action?.sourceCardId); const target = findBattlefieldCard(room, String(action?.targetCardId || ""));
      if (!source || !target || source.card.id === target.card.id) return { success: false, error: "Choose two different creatures on the battlefield." };
      const a = effectiveStats(source.card); const b = effectiveStats(target.card); if (!a || !b) return { success: false, error: "Set numeric power and toughness on both creatures first." };
      dealCreatureDamage(room, target.card, source.card, b.power); dealCreatureDamage(room, source.card, target.card, a.power);
      addLog(room, `${actor.name}'s ${source.card.name} fought ${target.player.name}'s ${target.card.name}.`, "fight"); break;
    }
    case "declare-attacker": {
      if (room.turn.activePlayerId !== actor.id) return { success: false, error: "Only the active player can declare attackers." };
      const located = controlledBattlefieldCard(room, actor, action?.cardId); const defender = findPlayer(room, String(action?.defenderPlayerId || ""));
      if (!located || !defender || defender.id === actor.id) return { success: false, error: "Choose your creature and an opposing player." };
      if (!isCreatureCard(located.card) || located.card.phasedOut) return { success: false, error: "Only an available creature can attack." };
      if (located.card.summoningSick && !hasKeyword(located.card, "haste")) return { success: false, error: "That creature has summoning sickness." };
      if (hasKeyword(located.card, "defender")) return { success: false, error: "That creature has defender." };
      located.card.attacking = true; located.card.defendingPlayerId = defender.id; located.card.blockingCardId = null; if (!hasKeyword(located.card, "vigilance")) located.card.tapped = true;
      queueSuggestedTriggers(room, "ATTACKS", { card: located.card, defenderId: defender.id }); addLog(room, `${actor.name} declared ${located.card.name} attacking ${defender.name}.`, "combat"); break;
    }
    case "clear-attacker": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.attacking = false; located.card.defendingPlayerId = null; for (const player of room.players) for (const card of player.game?.battlefield || []) if (card.blockingCardId === located.card.id) card.blockingCardId = null; addLog(room, `${located.card.name} is no longer attacking.`, "combat"); break; }
    case "toggle-attacking": { const defender = room.players.find((player) => player.id !== actor.id && !player.game?.conceded); return processGameAction(room, actor, { type: "declare-attacker", cardId: action.cardId, defenderPlayerId: defender?.id }); }
    case "block-card": { const blocker = controlledBattlefieldCard(room, actor, action?.sourceCardId); const attacker = findBattlefieldCard(room, String(action?.targetCardId || "")); if (!blocker || !attacker?.card.attacking || attacker.card.defendingPlayerId !== actor.id) return { success: false, error: "Choose one of your creatures and an attacker coming at you." }; blocker.card.blockingCardId = attacker.card.id; addLog(room, `${actor.name}'s ${blocker.card.name} is blocking ${attacker.player.name}'s ${attacker.card.name}.`, "combat"); break; }
    case "clear-block": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.blockingCardId = null; addLog(room, `${located.card.name} is no longer blocking.`, "combat"); break; }
    case "resolve-combat-damage": if (room.turn.activePlayerId !== actor.id && room.hostId !== actor.id) return { success: false, error: "Only the active player or host can resolve combat damage." }; resolveCombatDamage(room, action?.pass === "first" ? "first" : "normal"); break;
    case "resolve-lethal": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located || !isLethal(located.card)) return { success: false, error: "That permanent is not currently marked lethal." }; const [card] = located.player.game.battlefield.splice(located.index, 1); card.damageMarked = 0; card.deathtouchMarked = false; card.attacking = false; card.blockingCardId = null; if (!card.token) { const owner = findPlayer(room, card.ownerId) || located.player; owner.game.graveyard.unshift(card); } queueSuggestedTriggers(room, "CREATURE_DIED", { card }); addLog(room, card.token ? `${card.name} token was removed.` : `${card.name} moved to its owner's graveyard.`, "damage"); break; }
    case "create-token": actor.game.battlefield.unshift(createCard(normalizeText(action?.name, 80) || "Token", actor.id, { token: true, power: normalizeText(action?.power, 12), toughness: normalizeText(action?.toughness, 12), summoningSick: true })); addLog(room, `${actor.name} created a token.`, "card"); break;
    case "mana": { const symbol = String(action?.symbol || "C").toUpperCase(); if (!Object.prototype.hasOwnProperty.call(actor.game.manaPool, symbol)) return { success: false, error: "Choose W, U, B, R, G or C mana." }; actor.game.manaPool[symbol] = clamp(actor.game.manaPool[symbol] + amount, 0, 999); addLog(room, `${actor.name}'s ${symbol} mana is now ${actor.game.manaPool[symbol]}.`, "mana"); break; }
    case "clear-mana": actor.game.manaPool = normalizeManaPool(null); addLog(room, `${actor.name} emptied their mana pool.`, "mana"); break;
    case "cast-card": {
      const fromZone = ["hand", "commandZone", "exile", "graveyard"].includes(action?.fromZone) ? action.fromZone : "hand"; const located = getCardFromZone(actor.game, fromZone, String(action?.cardId || "")); if (!located) return { success: false, error: "That card is no longer in the selected zone." };
      const commanderTax = fromZone === "commandZone" && located.card.commander ? actor.game.commanderTax : 0;
      if (action?.enforcePayment) { const paid=payManaCost(actor,located.card,action?.manaPayment,action?.xValue,commanderTax); if(!paid.success)return paid; }
      const [card] = actor.game[fromZone].splice(located.index, 1); if(fromZone==="commandZone"&&card.commander) actor.game.commanderTax=clamp(actor.game.commanderTax+2,0,99);
      const item = pushStack(room, { kind: "spell", name: card.name, controllerId: actor.id, sourceCardId: card.id, sourceZone: fromZone, card, text: currentOracleText(card), targets: validateTargets(room, action?.targets), createdAt: nowIso(), choices:{modes:normalizeStringArray(action?.modes,10,120),xValue:clamp(Math.floor(Number(action?.xValue)||0),0,999),additionalCosts:normalizeStringArray(action?.additionalCosts,20,180)} }, actor.id);
      queueSuggestedTriggers(room, "SPELL_CAST", { card, controllerId: actor.id }); addLog(room, `${actor.name} cast ${item.name} onto the stack.`, "stack"); break;
    }
    case "activate-card": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; if (action?.tapCost) located.card.tapped = true; const item = pushStack(room, { kind: "ability", name: `${located.card.name} ability`, controllerId: actor.id, sourceCardId: located.card.id, text: normalizeText(action?.text, 2500) || currentOracleText(located.card), targets: validateTargets(room, action?.targets), effect: action?.effect, createdAt: nowIso() }, actor.id); addLog(room, `${actor.name} activated ${item.name}.`, "stack"); break; }
    case "push-stack-item": { const item = pushStack(room, { kind: action?.kind, name: action?.name, controllerId: actor.id, sourceCardId: action?.sourceCardId, text: action?.text, targets: validateTargets(room, action?.targets), effect: action?.effect, createdAt: nowIso() }, actor.id); if (!item) return { success: false, error: "Unable to create that stack item." }; addLog(room, `${actor.name} added ${item.name} to the stack.`, "stack"); break; }
    case "pass-priority": {
      const ids = activePlayerIds(room); if (!ids.length) break; if (room.priority?.playerId && room.priority.playerId !== actor.id) return { success: false, error: `Priority belongs to ${findPlayer(room, room.priority.playerId)?.name || "another player"}.` };
      const passed = new Set(room.priority?.passedPlayerIds || []); passed.add(actor.id);
      if (passed.size >= ids.length) { if (room.stack.length) resolveStackTop(room, "All players"); else resetPriority(room, room.turn?.activePlayerId); }
      else { room.priority.passedPlayerIds = [...passed]; let next = nextPlayerId(room, actor.id); while (next && passed.has(next) && next !== actor.id) next = nextPlayerId(room, next); room.priority.playerId = next; }
      addLog(room, `${actor.name} passed priority.`, "priority"); break;
    }
    case "resolve-stack-top": if (room.hostId !== actor.id && room.turn.activePlayerId !== actor.id) return { success: false, error: "Only the active player or host can force a resolution." }; if (!resolveStackTop(room, actor.name)) return { success: false, error: "The stack is empty." }; break;
    case "counter-stack-item": if (!counterStackItem(room, String(action?.stackItemId || ""), actor)) return { success: false, error: "That stack item no longer exists." }; break;
    case "create-trigger": { const located = locateCard(room, String(action?.cardId || "")); if (!located || located.card.controllerId !== actor.id) return { success: false, error: "You no longer control that card." }; const trigger = queueTrigger(room, { controllerId: actor.id, sourceCardId: located.card.id, sourceName: located.card.name, event: normalizeText(action?.event, 80) || "Manual trigger", text: normalizeText(action?.text, 2500) || currentOracleText(located.card), targets: validateTargets(room, action?.targets), createdAt: nowIso() }); addLog(room, `${actor.name} queued a trigger from ${trigger.sourceName}.`, "trigger"); break; }
    case "trigger-to-stack": { const index = room.triggerQueue.findIndex((item) => item.id === action?.triggerId); if (index < 0) return { success: false, error: "That trigger no longer exists." }; const trigger = room.triggerQueue[index]; if (trigger.controllerId !== actor.id && room.hostId !== actor.id) return { success: false, error: "Only its controller or host can move that trigger." }; room.triggerQueue.splice(index, 1); pushStack(room, { kind: "trigger", name: `${trigger.sourceName} trigger`, controllerId: trigger.controllerId, sourceCardId: trigger.sourceCardId, text: trigger.text, targets: trigger.targets }, trigger.controllerId); addLog(room, `${trigger.sourceName}'s trigger moved to the stack.`, "trigger"); break; }
    case "dismiss-trigger": { const index = room.triggerQueue.findIndex((item) => item.id === action?.triggerId); if (index < 0) return { success: false, error: "That trigger no longer exists." }; if (room.triggerQueue[index].controllerId !== actor.id && room.hostId !== actor.id) return { success: false, error: "Only its controller or host can dismiss it." }; room.triggerQueue.splice(index, 1); break; }
    case "attach-card": { const source = controlledBattlefieldCard(room, actor, action?.cardId); const target = findBattlefieldCard(room, String(action?.targetCardId || "")); if (!source || !target || source.card.id === target.card.id) return { success: false, error: "Choose an attachment you control and another permanent." }; source.card.attachedToId = target.card.id; addLog(room, `${actor.name} attached ${source.card.name} to ${target.card.name}.`, "attachment"); break; }
    case "detach-card": { const source = controlledBattlefieldCard(room, actor, action?.cardId); if (!source) return { success: false, error: "You no longer control that permanent." }; source.card.attachedToId = null; addLog(room, `${actor.name} detached ${source.card.name}.`, "attachment"); break; }
    case "change-controller": { const source = controlledBattlefieldCard(room, actor, action?.cardId); const nextController = findPlayer(room, String(action?.newControllerId || "")); if (!source || !nextController?.game) return { success: false, error: "Choose a permanent you control and a valid player." }; const [card] = source.player.game.battlefield.splice(source.index, 1); card.controllerId = nextController.id; card.attacking = false; card.blockingCardId = null; card.defendingPlayerId = null; card.summoningSick = isCreatureCard(card); nextController.game.battlefield.unshift(card); addLog(room, `${nextController.name} now controls ${card.name}.`, "control"); break; }
    case "return-control": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; const owner = findPlayer(room, located.card.ownerId); if (!owner?.game) return { success: false, error: "The owner is unavailable." }; const [card] = located.player.game.battlefield.splice(located.index, 1); card.controllerId = owner.id; owner.game.battlefield.unshift(card); addLog(room, `${card.name} returned to ${owner.name}'s control.`, "control"); break; }
    case "add-temp-effect": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.temporaryEffects.push({ id: createId(), label: normalizeText(action?.label, 100) || "Temporary effect", power: clamp(Math.floor(Number(action?.power) || 0), -99, 99), toughness: clamp(Math.floor(Number(action?.toughness) || 0), -99, 99), keyword: normalizeText(action?.keyword, 60), expires: action?.expires === "until-removed" ? "until-removed" : "end-of-turn" }); addLog(room, `${actor.name} added a temporary effect to ${located.card.name}.`, "effect"); break; }
    case "remove-temp-effect": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.temporaryEffects = located.card.temporaryEffects.filter((effect) => effect.id !== action?.effectId); break; }
    case "transform-card": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located || (located.card.cardData?.faces?.length || 0) < 2) return { success: false, error: "That card has no additional face loaded." }; located.card.activeFaceIndex = (located.card.activeFaceIndex + 1) % located.card.cardData.faces.length; addLog(room, `${actor.name} transformed ${located.card.name}.`, "card"); break; }
    case "toggle-face-down": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.faceDown = !located.card.faceDown; addLog(room, `${actor.name} turned a card ${located.card.faceDown ? "face down" : "face up"}.`, "card"); break; }
    case "toggle-phased": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; located.card.phasedOut = !located.card.phasedOut; addLog(room, `${located.card.name} ${located.card.phasedOut ? "phased out" : "phased in"}.`, "card"); break; }
    case "copy-card": { const source = findBattlefieldCard(room, String(action?.targetCardId || action?.cardId || "")); if (!source) return { success: false, error: "Choose a permanent to copy." }; const copy = migrateCard({ ...JSON.parse(JSON.stringify(source.card)), id: createId(), ownerId: actor.id, controllerId: actor.id, token: true, commander: false, copiedFromCardId: source.card.id, attachedToId: null, attacking: false, blockingCardId: null, damageMarked: 0, deathtouchMarked: false }, actor.id); actor.game.battlefield.unshift(copy); addLog(room, `${actor.name} created a copy of ${source.card.name}.`, "card"); break; }
    case "set-chosen-value": { const located = controlledBattlefieldCard(room, actor, action?.cardId); if (!located) return { success: false, error: "You no longer control that permanent." }; const key = normalizeText(action?.key, 60) || "Choice"; located.card.chosenValues[key] = normalizeText(action?.value, 180); addLog(room, `${actor.name} set ${located.card.name}'s ${key}.`, "choice"); break; }
    case "untap-all": actor.game.battlefield.forEach((card) => { card.tapped = false; }); addLog(room, `${actor.name} untapped all permanents.`, "card"); break;
    case "clear-combat": clearCombat(room); addLog(room, `${actor.name} cleared all attack and block markers.`, "combat"); break;
    case "clear-all-damage": clearDamage(room); addLog(room, `${actor.name} cleared all marked damage.`, "damage"); break;
    case "next-phase": {
      if (room.turn.activePlayerId !== actor.id && room.hostId !== actor.id) return { success: false, error: "Only the active player or host can advance the phase." };
      if (room.turn.phaseIndex >= PHASES.length - 1) advanceTurn(room); else { room.turn.phaseIndex += 1; const phase = PHASES[room.turn.phaseIndex]; if (phase === "Upkeep") queueSuggestedTriggers(room, "UPKEEP_START"); if (phase === "End") queueSuggestedTriggers(room, "END_STEP_START"); if (phase === "First-Strike Damage") resolveCombatDamage(room, "first"); addLog(room, `${phase} phase.`, "turn"); resetPriority(room, room.turn.activePlayerId); }
      break;
    }
    case "end-turn": if (room.turn.activePlayerId !== actor.id && room.hostId !== actor.id) return { success: false, error: "Only the active player or host can end the turn." }; advanceTurn(room); break;
    case "set-active-player": if (room.hostId !== actor.id) return { success: false, error: "Only the host can change the active player." }; if (!targetPlayer.game || targetPlayer.game.conceded) return { success: false, error: "That player is not active." }; clearCombat(room); clearDamage(room); room.turn.activePlayerId = targetPlayer.id; room.turn.phaseIndex = 0; targetPlayer.game.battlefield.forEach((card) => { card.tapped = false; card.summoningSick = false; }); resetPriority(room, targetPlayer.id); resetTurnDeadline(room); addLog(room, `${actor.name} made ${targetPlayer.name} the active player.`, "turn"); break;
    case "undo-last": { if (room.hostId !== actor.id) return { success: false, error: "Only the host can undo a shared game action." }; const entry = room.undoStack.pop(); if (!entry || !restoreSnapshot(room, entry)) return { success: false, error: "There is no action available to undo." }; addLog(room, `${actor.name} undid: ${entry.label}.`, "undo"); recordAction(room, actor, "undo", entry.label); return { success: true }; }
    case "concede": actor.game.conceded = true; addLog(room, `${actor.name} conceded the game.`, "warning"); if (room.turn.activePlayerId === actor.id) advanceTurn(room); break;
    default: return { success: false, error: "That game action is not supported." };
  }

  if (before) pushUndo(room, actor, type, before);
  if (type !== "resolve-decision" || room.settings?.autoStateBasedActions !== false) runStateBasedActions(room, type);
  recordAction(room, actor, type, detail);
  return { success: true };
}


app.post("/api/decks/validate", (request, response) => {
  const result = validateCommanderDeck(request.body?.deck);
  return response.status(result.valid ? 200 : 422).json({ success: result.valid, validation: result });
});

app.get("/api/rules/coverage", (request, response) => response.json({ success:true, version:RULES_VERSION, automatic:["Commander setup validation","multiplayer London mulligans","mana-payment checking for standard symbols","stack and clockwise priority","combat damage and common keywords","state-based losses","lethal and zero-toughness creatures","planeswalker loyalty and battle defense","legend-rule decisions","tokens leaving valid zones"], assisted:["targets and modes","replacement and prevention effects","continuous effects and layers","trigger ordering","special card layouts","votes and secret choices","loops and shortcuts"], universalFallback:"Judge Mode can move objects, change players/cards, create objects, add effects, assign roles and record loop results." }));

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
    app: "Arena Commander Table",
    version: "30.0.0",
    connectedSockets: io.engine.clientsCount,
    activeRooms: rooms.size,
    persistence: persistenceSummary(),
    timestamp: nowIso()
  });
});

app.get("/api", (request, response) => {
  response.status(200).json({ success: true, name: "Arena Commander Table API", version: "30.0.0", persistence: persistenceSummary() });
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
      const room = { code: createRoomCode(), hostId: player.id, privateRoom: true, maxPlayers, startingLife, status: "waiting", createdAt: timestamp, updatedAt: timestamp, startedAt: null, turn: null, rollOff: null, settings: normalizeRoomSettings(null), spectators: [], emotes: [], replayFrames: [], stack: [], triggerQueue: [], priority: { playerId: null, passedPlayerIds: [] }, rules: normalizeRulesState(null,[player.id]), actionHistory: [], undoStack: [], players: [player], chat: [], log: [] };
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
      auth.player.deckValidation = validateCommanderDeck(deck);
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
    auth.player.deckValidation = auth.player.deck ? validateCommanderDeck(auth.player.deck) : null;
    if (!auth.player.ready && auth.room.settings?.enforceDeckRules !== false && !auth.room.settings?.allowInvalidDecks && !auth.player.deckValidation?.valid) return fail(callback, auth.player.deckValidation?.errors?.[0] || "That deck did not pass Commander validation.");
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
    const timer = Number(payload?.turnTimerSeconds);
    auth.room.settings = normalizeRoomSettings({
      ...auth.room.settings,
      turnTimerSeconds: ALLOWED_TURN_TIMERS.has(timer) ? timer : auth.room.settings?.turnTimerSeconds,
      allowSpectators: payload?.allowSpectators == null ? auth.room.settings?.allowSpectators : Boolean(payload.allowSpectators),
      showCombatPreview: payload?.showCombatPreview == null ? auth.room.settings?.showCombatPreview : Boolean(payload.showCombatPreview),
      enforceDeckRules: payload?.enforceDeckRules == null ? auth.room.settings?.enforceDeckRules : Boolean(payload.enforceDeckRules),
      allowInvalidDecks: payload?.allowInvalidDecks == null ? auth.room.settings?.allowInvalidDecks : Boolean(payload.allowInvalidDecks),
      autoStateBasedActions: payload?.autoStateBasedActions == null ? auth.room.settings?.autoStateBasedActions : Boolean(payload.autoStateBasedActions),
      freeCommanderMulligan: payload?.freeCommanderMulligan == null ? auth.room.settings?.freeCommanderMulligan : Boolean(payload.freeCommanderMulligan)
    });
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
    auth.room.stack = [];
    auth.room.triggerQueue = [];
    auth.room.priority = { playerId: null, passedPlayerIds: [] };
    auth.room.actionHistory = [];
    auth.room.undoStack = [];
    auth.room.replayFrames = [];
    auth.room.emotes = [];
    addLog(auth.room, "Starting-player d20 roll-off began. Every player must roll once; tied high rolls reroll.", "roll");
    acknowledge(callback, { success: true, room: createPublicRoom(auth.room, auth.player.id) });
    emitRoomUpdate(auth.room);
  });

  socket.on("roll-starting-d20", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    const result = performStartingRoll(auth.room, auth.player);
    if (!result.success) return acknowledge(callback, result);
    if (result.completed) recordReplayFrame(auth.room, auth.player.name, "Starting player chosen");
    acknowledge(callback, { ...result, room: createPublicRoom(auth.room, auth.player.id) });
    emitRoomUpdate(auth.room);
  });

  socket.on("game-action", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    const action = payload?.action || {};
    const result = processGameAction(auth.room, auth.player, action);
    if (!result.success) return acknowledge(callback, result);
    recordReplayFrame(auth.room, auth.player.name, normalizeText(action.type, 80) || "Game action");
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
    auth.room.stack = [];
    auth.room.triggerQueue = [];
    auth.room.priority = { playerId: null, passedPlayerIds: [] };
    auth.room.actionHistory = [];
    auth.room.undoStack = [];
    auth.room.replayFrames = [];
    auth.room.emotes = [];
    auth.room.rules = normalizeRulesState(null, auth.room.players.map((player) => player.id));
    auth.room.players.forEach((player) => { player.game = null; player.ready = false; });
    auth.room.chat = [];
    auth.room.log = [];
    addLog(auth.room, `${auth.player.name} returned the room to the lobby.`, "room");
    acknowledge(callback, { success: true });
    emitRoomUpdate(auth.room);
  });

  socket.on("join-spectator", (payload, callback) => {
    const roomCode = normalizeRoomCode(payload?.roomCode);
    const room = rooms.get(roomCode);
    const name = normalizePlayerName(payload?.name) || "Spectator";
    if (!room) return fail(callback, "That room code was not found.");
    if (!normalizeRoomSettings(room.settings).allowSpectators) return fail(callback, "Spectators are disabled for this room.");
    room.spectators = Array.isArray(room.spectators) ? room.spectators : [];
    if (room.spectators.length >= MAX_SPECTATORS) return fail(callback, "That spectator gallery is full.");
    if (socket.data.roomCode) detachSocket(socket, socket.data.roomCode);
    const spectator = { id: createId(), name, socketId: socket.id, connected: true, joinedAt: nowIso() };
    room.spectators.push(spectator);
    socket.join(`commander-room:${room.code}`);
    socket.data.spectatorRoomCode = room.code;
    socket.data.spectatorId = spectator.id;
    acknowledge(callback, { success: true, spectatorId: spectator.id, room: createPublicRoom(room, null) });
    emitRoomUpdate(room);
  });

  socket.on("leave-spectator", (payload, callback) => {
    const room = rooms.get(socket.data.spectatorRoomCode);
    if (room) {
      room.spectators = (room.spectators || []).filter((entry) => entry.id !== socket.data.spectatorId);
      socket.leave(`commander-room:${room.code}`);
      emitRoomUpdate(room);
    }
    socket.data.spectatorRoomCode = null;
    socket.data.spectatorId = null;
    acknowledge(callback, { success: true });
  });

  socket.on("send-emote", (payload, callback) => {
    const auth = authenticationFrom(payload);
    if (!auth.success) return acknowledge(callback, auth);
    const allowed = new Set(["👍", "👏", "🔥", "😮", "😂", "🤔", "⚔️", "☠️", "GG", "Nice!"]);
    const emoji = normalizeText(payload?.emoji, 12);
    if (!allowed.has(emoji)) return fail(callback, "Choose one of the available table emotes.");
    auth.room.emotes = normalizeEmotes([...(auth.room.emotes || []), { id: createId(), playerId: auth.player.id, playerName: auth.player.name, emoji, time: nowIso() }]);
    addLog(auth.room, `${auth.player.name} sent ${emoji}.`, "emote");
    acknowledge(callback, { success: true });
    emitRoomUpdate(auth.room);
  });

  socket.on("disconnect", () => {
    const spectatorRoom = rooms.get(socket.data.spectatorRoomCode);
    if (spectatorRoom) {
      spectatorRoom.spectators = (spectatorRoom.spectators || []).filter((entry) => entry.id !== socket.data.spectatorId);
      emitRoomUpdate(spectatorRoom);
    }
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
    console.log(`Arena Commander Final Rules v30 running on port ${PORT}`);
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
  resolveCardNames,
  normalizeRoomSettings,
  resetTurnDeadline,
  recordReplayFrame,
  createPublicRoom,
  validateCommanderDeck,
  runStateBasedActions,
  normalizeRulesState,
  parseManaRequirement,
  payManaCost,
  resolveRuleDecision,
  applyJudgeAction
};

if (require.main === module) start();
