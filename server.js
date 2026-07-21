"use strict";

/*
  Torn Commander Sandbox — complete server
  ------------------------------------------------------------
  A mobile-friendly, real-time Commander tabletop for 2–6 users.
  Rooms are mirrored to PostgreSQL after every change so active games
  can survive Render restarts and redeploys. Browser deck libraries are
  kept in localStorage and only the selected deck is sent to the room.
*/

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
  maxHttpBufferSize: 2e6
});

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIRECTORY = path.join(__dirname, "public");
const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RECONNECT_GRACE_MS = 30 * 60 * 1000;
const ROOM_RETENTION_MS = 48 * 60 * 60 * 1000;
const ABANDONED_ROOM_MAX_AGE_MS = ROOM_RETENTION_MS;
const SAVE_DEBOUNCE_MS = 100;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const MAX_CHAT_MESSAGES = 100;
const MAX_LOG_ENTRIES = 150;
const PHASES = ["Untap", "Upkeep", "Draw", "Main 1", "Combat", "Main 2", "End"];
const ZONES = new Set(["hand", "battlefield", "graveyard", "exile", "commandZone", "library"]);
const VISIBLE_ZONES = ["battlefield", "graveyard", "exile", "commandZone"];
const ALLOWED_MAX_PLAYERS = new Set([2, 3, 4, 5, 6]);
const ALLOWED_STARTING_LIFE = new Set([20, 30, 40, 50, 60]);

const rooms = new Map();
const disconnectTimers = new Map();
const persistenceTimers = new Map();
const persistenceChains = new Map();

const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const DATABASE_ENABLED = DATABASE_URL.length > 0;
const databaseState = {
  enabled: DATABASE_ENABLED,
  ready: false,
  loadedRooms: 0,
  lastSavedAt: null,
  lastError: null
};

const databasePool = DATABASE_ENABLED
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: process.env.DATABASE_SSL === "true"
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null;

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(
  express.static(PUBLIC_DIRECTORY, {
    extensions: ["html"],
    maxAge: 0,
    etag: true,
    setHeaders(response) {
      response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    }
  })
);

function nowIso() {
  return new Date().toISOString();
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

function createPersistentRoomState(room) {
  return {
    ...room,
    players: room.players.map((player) => ({
      ...player,
      connected: false,
      socketId: null
    }))
  };
}

async function initializeDatabase() {
  if (!databasePool) {
    console.warn("DATABASE_URL is not set. Rooms will only use temporary memory.");
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
  await databasePool.query(`
    CREATE INDEX IF NOT EXISTS commander_rooms_expires_at_idx
    ON commander_rooms (expires_at)
  `);
  await databasePool.query(`DELETE FROM commander_rooms WHERE expires_at <= NOW()`);

  const result = await databasePool.query(`
    SELECT room_state
    FROM commander_rooms
    WHERE expires_at > NOW()
    ORDER BY updated_at ASC
  `);

  for (const row of result.rows) {
    const room = row.room_state;
    if (!room || typeof room !== "object" || !room.code || !Array.isArray(room.players)) {
      continue;
    }

    room.code = normalizeRoomCode(room.code);
    if (room.code.length !== ROOM_CODE_LENGTH || rooms.has(room.code)) continue;

    room.players = room.players.map((player) => ({
      ...player,
      connected: false,
      socketId: null
    }));
    room.chat = Array.isArray(room.chat) ? room.chat.slice(-MAX_CHAT_MESSAGES) : [];
    room.log = Array.isArray(room.log) ? room.log.slice(-MAX_LOG_ENTRIES) : [];
    room.updatedAt = room.updatedAt || nowIso();

    rooms.set(room.code, room);
  }

  databaseState.ready = true;
  databaseState.loadedRooms = rooms.size;
  databaseState.lastError = null;
  console.log(`PostgreSQL autosave ready. Restored ${rooms.size} room(s).`);
}

async function persistRoomNow(room) {
  if (!databasePool || !room || !rooms.has(room.code)) return;

  const state = createPersistentRoomState(room);
  const expiresAt = new Date(Date.now() + ROOM_RETENTION_MS).toISOString();

  await databasePool.query(
    `
      INSERT INTO commander_rooms (code, room_state, updated_at, expires_at)
      VALUES ($1, $2::jsonb, NOW(), $3::timestamptz)
      ON CONFLICT (code)
      DO UPDATE SET
        room_state = EXCLUDED.room_state,
        updated_at = NOW(),
        expires_at = EXCLUDED.expires_at
    `,
    [room.code, JSON.stringify(state), expiresAt]
  );

  databaseState.ready = true;
  databaseState.lastSavedAt = nowIso();
  databaseState.lastError = null;
}

function enqueuePersistenceOperation(roomCode, operation) {
  const previous = persistenceChains.get(roomCode) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(operation)
    .catch((error) => {
      databaseState.ready = false;
      databaseState.lastError = normalizeText(error && error.message, 240) || "Database save failed.";
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
  const roomCode = room.code;
  const existingTimer = persistenceTimers.get(roomCode);
  if (existingTimer) clearTimeout(existingTimer);

  const run = () => {
    persistenceTimers.delete(roomCode);
    enqueuePersistenceOperation(roomCode, () => persistRoomNow(room));
  };

  if (immediate) {
    run();
    return;
  }

  const timer = setTimeout(run, SAVE_DEBOUNCE_MS);
  timer.unref();
  persistenceTimers.set(roomCode, timer);
}

function deletePersistedRoom(roomCode) {
  if (!databasePool) return;
  const timer = persistenceTimers.get(roomCode);
  if (timer) clearTimeout(timer);
  persistenceTimers.delete(roomCode);

  enqueuePersistenceOperation(roomCode, async () => {
    await databasePool.query(`DELETE FROM commander_rooms WHERE code = $1`, [roomCode]);
    databaseState.ready = true;
    databaseState.lastError = null;
  });
}

async function flushPersistence() {
  if (!databasePool) return;

  for (const timer of persistenceTimers.values()) clearTimeout(timer);
  persistenceTimers.clear();

  for (const room of rooms.values()) {
    enqueuePersistenceOperation(room.code, () => persistRoomNow(room));
  }

  await Promise.allSettled(Array.from(persistenceChains.values()));
}

function roomChannel(code) {
  return `commander-room:${code}`;
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

function normalizePlayerName(value) {
  return normalizeText(value, 24);
}

function normalizeRoomCode(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, ROOM_CODE_LENGTH);
}

function normalizeMaximumPlayers(value) {
  const parsed = Number(value);
  return ALLOWED_MAX_PLAYERS.has(parsed) ? parsed : 6;
}

function normalizeStartingLife(value) {
  const parsed = Number(value);
  return ALLOWED_STARTING_LIFE.has(parsed) ? parsed : 40;
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

function normalizeDeck(value) {
  if (!value || typeof value !== "object") return null;

  const id = normalizeText(value.id, 100) || createId();
  const name = normalizeText(value.name, 60);
  const rawCommanders = Array.isArray(value.commanders)
    ? value.commanders
    : [value.commander];
  const commanders = rawCommanders
    .map((commander) => normalizeText(commander, 150))
    .filter(Boolean)
    .slice(0, 2);

  if (!name || commanders.length === 0 || !Array.isArray(value.cards)) return null;

  const cardMap = new Map();
  for (const rawCard of value.cards.slice(0, 500)) {
    const cardName = normalizeText(rawCard && rawCard.name, 150);
    const quantity = clamp(Math.floor(Number(rawCard && rawCard.quantity) || 0), 0, 100);
    if (!cardName || quantity <= 0) continue;
    const key = cardName.toLowerCase();
    const existing = cardMap.get(key);
    if (existing) {
      existing.quantity = clamp(existing.quantity + quantity, 1, 100);
    } else {
      cardMap.set(key, { name: cardName, quantity });
    }
  }

  const cards = Array.from(cardMap.values());
  const totalCards = cards.reduce((total, card) => total + card.quantity, 0);
  if (cards.length === 0 || totalCards < 10 || totalCards > 250) return null;

  return {
    id,
    name,
    commanders,
    cards,
    totalCards,
    uniqueCards: cards.length,
    validation: totalCards === 100 ? "valid" : "warning"
  };
}

function createCard(name, ownerId, options = {}) {
  return {
    id: createId(),
    name: normalizeText(name, 150) || "Unknown Card",
    ownerId,
    controllerId: ownerId,
    tapped: Boolean(options.tapped),
    counters: clamp(Math.floor(Number(options.counters) || 0), -999, 999),
    token: Boolean(options.token),
    commander: Boolean(options.commander),
    power: normalizeText(options.power, 12),
    toughness: normalizeText(options.toughness, 12)
  };
}

function buildGameState(player, startingLife, allPlayerIds) {
  const expandedDeck = [];
  for (const entry of player.deck.cards) {
    for (let quantity = 0; quantity < entry.quantity; quantity += 1) {
      expandedDeck.push(createCard(entry.name, player.id));
    }
  }

  const commandZone = [];
  for (const commanderName of player.deck.commanders) {
    const index = expandedDeck.findIndex(
      (card) => card.name.toLowerCase() === commanderName.toLowerCase()
    );
    if (index >= 0) {
      const [card] = expandedDeck.splice(index, 1);
      card.commander = true;
      commandZone.push(card);
    } else {
      commandZone.push(createCard(commanderName, player.id, { commander: true }));
    }
  }

  const library = shuffle(expandedDeck);
  const hand = library.splice(0, Math.min(7, library.length));
  const commanderDamage = {};
  allPlayerIds.forEach((id) => {
    if (id !== player.id) commanderDamage[id] = 0;
  });

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
  return room && room.players.find((player) => player.id === playerId) || null;
}

function getCardFromZone(game, zone, cardId) {
  if (!game || !ZONES.has(zone) || !Array.isArray(game[zone])) return null;
  const index = game[zone].findIndex((card) => card.id === cardId);
  if (index < 0) return null;
  return { card: game[zone][index], index };
}

function addLog(room, text, type = "info") {
  room.log.push({ id: createId(), time: nowIso(), type, text: normalizeText(text, 300) });
  if (room.log.length > MAX_LOG_ENTRIES) {
    room.log.splice(0, room.log.length - MAX_LOG_ENTRIES);
  }
}

function addChat(room, player, message) {
  room.chat.push({
    id: createId(),
    playerId: player.id,
    playerName: player.name,
    message: normalizeText(message, 500),
    time: nowIso()
  });
  if (room.chat.length > MAX_CHAT_MESSAGES) {
    room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
  }
}

function publicDeck(deck) {
  if (!deck) return null;
  return {
    id: deck.id,
    name: deck.name,
    commanders: deck.commanders,
    totalCards: deck.totalCards,
    uniqueCards: deck.uniqueCards,
    validation: deck.validation
  };
}

function publicCard(card) {
  return {
    id: card.id,
    name: card.name,
    ownerId: card.ownerId,
    controllerId: card.controllerId,
    tapped: card.tapped,
    counters: card.counters,
    token: card.token,
    commander: card.commander,
    power: card.power,
    toughness: card.toughness
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
    turn: room.turn ? { ...room.turn } : null,
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

function authenticationFrom(payload) {
  const roomCode = normalizeRoomCode(payload && payload.roomCode);
  const playerId = String(payload && payload.playerId || "");
  const sessionToken = String(payload && payload.sessionToken || "");
  const room = rooms.get(roomCode);
  if (!room) return { success: false, error: "That room no longer exists." };
  const player = findPlayer(room, playerId);
  if (!player || player.sessionToken !== sessionToken) {
    return { success: false, error: "Your saved room session could not be verified." };
  }
  return { success: true, room, player };
}

function ensureHost(room, player) {
  return room.hostId === player.id
    ? { success: true }
    : { success: false, error: "Only the room host can do that." };
}

function clearDisconnectTimer(roomCode, playerId) {
  const key = `${roomCode}:${playerId}`;
  const timer = disconnectTimers.get(key);
  if (timer) clearTimeout(timer);
  disconnectTimers.delete(key);
}

function attachSocket(socket, room, player) {
  if (socket.data.roomCode && socket.data.roomCode !== room.code) {
    socket.leave(roomChannel(socket.data.roomCode));
  }
  socket.join(roomChannel(room.code));
  socket.data.roomCode = room.code;
  socket.data.playerId = player.id;
  player.socketId = socket.id;
  player.connected = true;
  player.lastSeenAt = nowIso();
  clearDisconnectTimer(room.code, player.id);
}

function detachSocket(socket, roomCode) {
  if (!socket) return;
  socket.leave(roomChannel(roomCode));
  socket.data.roomCode = null;
  socket.data.playerId = null;
}

function transferHostIfNeeded(room) {
  const host = findPlayer(room, room.hostId);
  if (host && host.connected) return;
  const next = room.players.find((player) => player.connected) || room.players[0];
  if (next) room.hostId = next.id;
}

function removePlayer(room, playerId) {
  const index = room.players.findIndex((player) => player.id === playerId);
  if (index < 0) return null;
  const [removed] = room.players.splice(index, 1);
  clearDisconnectTimer(room.code, removed.id);
  if (room.players.length === 0) {
    rooms.delete(room.code);
    deletePersistedRoom(room.code);
    return removed;
  }
  transferHostIfNeeded(room);
  emitRoomUpdate(room);
  return removed;
}

function scheduleDisconnectCleanup(room, player) {
  clearDisconnectTimer(room.code, player.id);
  const key = `${room.code}:${player.id}`;
  const timer = setTimeout(() => {
    disconnectTimers.delete(key);
    const currentRoom = rooms.get(room.code);
    const currentPlayer = findPlayer(currentRoom, player.id);
    if (!currentRoom || !currentPlayer || currentPlayer.connected) return;
    if (currentRoom.status === "waiting") removePlayer(currentRoom, currentPlayer.id);
  }, RECONNECT_GRACE_MS);
  timer.unref();
  disconnectTimers.set(key, timer);
}

function fail(callback, error) {
  acknowledge(callback, { success: false, error });
}

async function safeHandler(socket, callback, functionBody) {
  try {
    await functionBody();
  } catch (error) {
    console.error(`Socket action failed for ${socket.id}:`, error);
    fail(callback, "An unexpected server error occurred.");
  }
}

function getTargetPlayer(room, playerId) {
  return findPlayer(room, String(playerId || ""));
}

function untapPlayer(player) {
  if (!player || !player.game) return;
  player.game.battlefield.forEach((card) => { card.tapped = false; });
}

function activePlayers(room) {
  return room.players.filter((player) => player.game && !player.game.conceded);
}

function advanceTurn(room) {
  const players = activePlayers(room);
  if (players.length === 0) return;
  const currentIndex = players.findIndex((player) => player.id === room.turn.activePlayerId);
  const next = players[(currentIndex + 1 + players.length) % players.length];
  room.turn.activePlayerId = next.id;
  room.turn.phaseIndex = 0;
  room.turn.number += 1;
  untapPlayer(next);
  addLog(room, `Turn ${room.turn.number}: ${next.name} is active.`, "turn");
}

function moveCard(player, fromZone, toZone, cardId, position = "top") {
  if (!player.game || !ZONES.has(fromZone) || !ZONES.has(toZone)) return null;
  const located = getCardFromZone(player.game, fromZone, cardId);
  if (!located) return null;
  const [card] = player.game[fromZone].splice(located.index, 1);

  if (card.token && toZone !== "battlefield") {
    return { card, removedToken: true };
  }

  if (toZone !== "battlefield") card.tapped = false;
  if (toZone === "library" && position === "bottom") {
    player.game.library.push(card);
  } else {
    player.game[toZone].unshift(card);
  }
  return { card, removedToken: false };
}

function processGameAction(room, actor, action) {
  if (room.status !== "started" || !actor.game) {
    return { success: false, error: "The game has not started." };
  }

  const type = normalizeText(action && action.type, 40);
  const target = getTargetPlayer(room, action && action.targetPlayerId) || actor;
  const amount = clamp(Math.floor(Number(action && action.amount) || 0), -9999, 9999);

  switch (type) {
    case "life": {
      target.game.life = clamp(target.game.life + amount, -999, 9999);
      addLog(room, `${actor.name} changed ${target.name}'s life to ${target.game.life}.`, "life");
      break;
    }
    case "set-life": {
      target.game.life = clamp(Math.floor(Number(action.value) || 0), -999, 9999);
      addLog(room, `${actor.name} set ${target.name}'s life to ${target.game.life}.`, "life");
      break;
    }
    case "poison": {
      target.game.poison = clamp(target.game.poison + amount, 0, 99);
      addLog(room, `${target.name} now has ${target.game.poison} poison.`, "counter");
      break;
    }
    case "commander-tax": {
      target.game.commanderTax = clamp(target.game.commanderTax + amount, 0, 99);
      addLog(room, `${target.name}'s commander tax is ${target.game.commanderTax}.`, "counter");
      break;
    }
    case "commander-damage": {
      const sourceId = String(action.sourcePlayerId || "");
      if (!findPlayer(room, sourceId) || sourceId === target.id) {
        return { success: false, error: "Choose a valid opposing commander." };
      }
      const current = Number(target.game.commanderDamage[sourceId]) || 0;
      target.game.commanderDamage[sourceId] = clamp(current + amount, 0, 99);
      addLog(room, `${target.name} has ${target.game.commanderDamage[sourceId]} commander damage from ${findPlayer(room, sourceId).name}.`, "counter");
      break;
    }
    case "draw": {
      const count = clamp(amount || 1, 1, 20);
      let drawn = 0;
      while (drawn < count && actor.game.library.length > 0) {
        actor.game.hand.push(actor.game.library.shift());
        drawn += 1;
      }
      addLog(room, `${actor.name} drew ${drawn} card${drawn === 1 ? "" : "s"}.`, "card");
      break;
    }
    case "mill": {
      const count = clamp(amount || 1, 1, 50);
      let milled = 0;
      while (milled < count && actor.game.library.length > 0) {
        actor.game.graveyard.unshift(actor.game.library.shift());
        milled += 1;
      }
      addLog(room, `${actor.name} milled ${milled} card${milled === 1 ? "" : "s"}.`, "card");
      break;
    }
    case "shuffle": {
      actor.game.library = shuffle(actor.game.library);
      addLog(room, `${actor.name} shuffled their library.`, "card");
      break;
    }
    case "mulligan": {
      actor.game.library.push(...actor.game.hand);
      actor.game.hand = [];
      actor.game.library = shuffle(actor.game.library);
      actor.game.hand = actor.game.library.splice(0, Math.min(7, actor.game.library.length));
      addLog(room, `${actor.name} took a sandbox mulligan to seven.`, "card");
      break;
    }
    case "move-card": {
      const fromZone = String(action.fromZone || "");
      const toZone = String(action.toZone || "");
      const result = moveCard(actor, fromZone, toZone, String(action.cardId || ""), action.position);
      if (!result) return { success: false, error: "That card could not be moved." };
      if (result.removedToken) {
        addLog(room, `${actor.name}'s ${result.card.name} token left the battlefield.`, "card");
      } else {
        addLog(room, `${actor.name} moved ${result.card.name} to ${toZone === "commandZone" ? "the command zone" : toZone}.`, "card");
      }
      break;
    }
    case "tap-card": {
      const located = getCardFromZone(actor.game, "battlefield", String(action.cardId || ""));
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      located.card.tapped = !located.card.tapped;
      addLog(room, `${actor.name} ${located.card.tapped ? "tapped" : "untapped"} ${located.card.name}.`, "card");
      break;
    }
    case "card-counter": {
      const located = getCardFromZone(actor.game, "battlefield", String(action.cardId || ""));
      if (!located) return { success: false, error: "That permanent is no longer on your battlefield." };
      located.card.counters = clamp(located.card.counters + amount, -99, 999);
      addLog(room, `${located.card.name} now has ${located.card.counters} counter${located.card.counters === 1 ? "" : "s"}.`, "counter");
      break;
    }
    case "create-token": {
      const tokenName = normalizeText(action.name, 80) || "Token";
      const token = createCard(tokenName, actor.id, {
        token: true,
        power: normalizeText(action.power, 12),
        toughness: normalizeText(action.toughness, 12)
      });
      actor.game.battlefield.unshift(token);
      addLog(room, `${actor.name} created a ${tokenName} token.`, "card");
      break;
    }
    case "untap-all": {
      untapPlayer(actor);
      addLog(room, `${actor.name} untapped all permanents.`, "card");
      break;
    }
    case "next-phase": {
      if (room.turn.activePlayerId !== actor.id && room.hostId !== actor.id) {
        return { success: false, error: "Only the active player or host can advance the phase." };
      }
      if (room.turn.phaseIndex >= PHASES.length - 1) {
        advanceTurn(room);
      } else {
        room.turn.phaseIndex += 1;
        addLog(room, `${PHASES[room.turn.phaseIndex]} phase.`, "turn");
      }
      break;
    }
    case "end-turn": {
      if (room.turn.activePlayerId !== actor.id && room.hostId !== actor.id) {
        return { success: false, error: "Only the active player or host can end the turn." };
      }
      advanceTurn(room);
      break;
    }
    case "set-active-player": {
      if (room.hostId !== actor.id) return { success: false, error: "Only the host can change the active player." };
      if (!target.game || target.game.conceded) return { success: false, error: "That player is not active in this game." };
      room.turn.activePlayerId = target.id;
      room.turn.phaseIndex = 0;
      untapPlayer(target);
      addLog(room, `${actor.name} made ${target.name} the active player.`, "turn");
      break;
    }
    case "concede": {
      actor.game.conceded = true;
      addLog(room, `${actor.name} conceded the game.`, "warning");
      if (room.turn.activePlayerId === actor.id) advanceTurn(room);
      break;
    }
    default:
      return { success: false, error: "That game action is not supported." };
  }

  return { success: true };
}

app.get("/api/health", (request, response) => {
  response.status(200).json({
    success: true,
    status: "online",
    app: "Torn Commander Sandbox",
    version: "6.0.0",
    connectedSockets: io.engine.clientsCount,
    activeRooms: rooms.size,
    persistence: persistenceSummary(),
    timestamp: nowIso()
  });
});

app.get("/api", (request, response) => {
  response.status(200).json({ success: true, name: "Torn Commander Sandbox API", version: "6.0.0", persistence: persistenceSummary() });
});

io.on("connection", (socket) => {
  console.log(`Connected: ${socket.id}`);
  socket.emit("server-message", { type: "success", message: "Connected to the Commander server." });

  socket.on("create-room", (payload, callback) => safeHandler(socket, callback, () => {
    if (socket.data.roomCode) return fail(callback, "Leave your current room first.");
    const name = normalizePlayerName(payload && payload.playerName);
    if (name.length < 2) return fail(callback, "Enter a player name with at least two characters.");

    const timestamp = nowIso();
    const player = {
      id: createId(), name, ready: false, connected: true, socketId: socket.id,
      sessionToken: createSessionToken(), deck: null, game: null,
      joinedAt: timestamp, lastSeenAt: timestamp
    };
    const room = {
      code: createRoomCode(), hostId: player.id, privateRoom: true,
      maxPlayers: normalizeMaximumPlayers(payload && payload.maxPlayers),
      startingLife: normalizeStartingLife(payload && payload.startingLife),
      status: "waiting", createdAt: timestamp, updatedAt: timestamp,
      startedAt: null, turn: null, players: [player], chat: [], log: []
    };
    rooms.set(room.code, room);
    attachSocket(socket, room, player);
    addLog(room, `${name} created the room.`, "room");
    acknowledge(callback, {
      success: true, playerId: player.id, sessionToken: player.sessionToken,
      room: createPublicRoom(room, player.id)
    });
    queueRoomSave(room, true);
  }));

  socket.on("join-room", (payload, callback) => safeHandler(socket, callback, () => {
    if (socket.data.roomCode) return fail(callback, "Leave your current room first.");
    const roomCode = normalizeRoomCode(payload && payload.roomCode);
    const name = normalizePlayerName(payload && payload.playerName);
    const room = rooms.get(roomCode);
    if (!room) return fail(callback, "That room code was not found.");
    if (room.status !== "waiting") return fail(callback, "That game has already started. Use your saved rejoin session.");
    if (room.players.length >= room.maxPlayers) return fail(callback, "That room is full.");
    if (name.length < 2) return fail(callback, "Enter a player name with at least two characters.");
    if (room.players.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
      return fail(callback, "That player name is already being used in the room.");
    }

    const timestamp = nowIso();
    const player = {
      id: createId(), name, ready: false, connected: true, socketId: socket.id,
      sessionToken: createSessionToken(), deck: null, game: null,
      joinedAt: timestamp, lastSeenAt: timestamp
    };
    room.players.push(player);
    attachSocket(socket, room, player);
    addLog(room, `${name} joined the room.`, "room");
    acknowledge(callback, {
      success: true, playerId: player.id, sessionToken: player.sessionToken,
      room: createPublicRoom(room, player.id)
    });
    emitRoomUpdate(room);
  }));

  socket.on("rejoin-room", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    const previousSocket = player.socketId && io.sockets.sockets.get(player.socketId);
    if (previousSocket && previousSocket.id !== socket.id) {
      previousSocket.emit("removed-from-room", { message: "This room session was opened on another device." });
      detachSocket(previousSocket, room.code);
    }
    attachSocket(socket, room, player);
    acknowledge(callback, {
      success: true, playerId: player.id, sessionToken: player.sessionToken,
      room: createPublicRoom(room, player.id)
    });
    addLog(room, `${player.name} reconnected.`, "room");
    emitRoomUpdate(room);
  }));

  socket.on("set-player-deck", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    if (room.status !== "waiting") return fail(callback, "Decks cannot change after the game starts.");
    if (payload.deck === null) {
      player.deck = null;
      player.ready = false;
    } else {
      const deck = normalizeDeck(payload.deck);
      if (!deck) return fail(callback, "The selected deck is incomplete or invalid.");
      player.deck = deck;
      player.ready = false;
    }
    acknowledge(callback, { success: true, room: createPublicRoom(room, player.id) });
    emitRoomUpdate(room);
  }));

  socket.on("toggle-ready", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    if (room.status !== "waiting") return fail(callback, "The game has already started.");
    if (!player.deck && !player.ready) return fail(callback, "Select a Commander deck first.");
    player.ready = !player.ready;
    addLog(room, `${player.name} is ${player.ready ? "ready" : "not ready"}.`, "room");
    acknowledge(callback, { success: true, room: createPublicRoom(room, player.id) });
    emitRoomUpdate(room);
  }));

  socket.on("update-room-settings", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    const hostCheck = ensureHost(room, player);
    if (!hostCheck.success) return acknowledge(callback, hostCheck);
    if (room.status !== "waiting") return fail(callback, "Room settings cannot change after the game starts.");
    const maxPlayers = normalizeMaximumPlayers(payload && payload.maxPlayers);
    if (maxPlayers < room.players.length) return fail(callback, `The room already has ${room.players.length} players.`);
    room.maxPlayers = maxPlayers;
    room.startingLife = normalizeStartingLife(payload && payload.startingLife);
    acknowledge(callback, { success: true, room: createPublicRoom(room, player.id) });
    emitRoomUpdate(room);
  }));

  socket.on("start-game", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    const hostCheck = ensureHost(room, player);
    if (!hostCheck.success) return acknowledge(callback, hostCheck);
    if (room.status !== "waiting") return fail(callback, "The game has already started.");
    if (room.players.length < 2) return fail(callback, "At least two players are required.");
    const disconnected = room.players.find((entry) => !entry.connected);
    if (disconnected) return fail(callback, `${disconnected.name} must reconnect first.`);
    const missingDeck = room.players.find((entry) => !entry.deck);
    if (missingDeck) return fail(callback, `${missingDeck.name} must select a deck.`);
    const unready = room.players.find((entry) => !entry.ready);
    if (unready) return fail(callback, `${unready.name} must mark ready.`);

    const playerIds = room.players.map((entry) => entry.id);
    room.players.forEach((entry) => {
      entry.game = buildGameState(entry, room.startingLife, playerIds);
    });
    const firstPlayer = room.players[crypto.randomInt(0, room.players.length)];
    room.status = "started";
    room.startedAt = nowIso();
    room.turn = { number: 1, activePlayerId: firstPlayer.id, phaseIndex: 0 };
    addLog(room, `Game started. ${firstPlayer.name} won the first-player roll.`, "turn");
    queueRoomSave(room, true);
    acknowledge(callback, { success: true, room: createPublicRoom(room, player.id) });
    for (const entry of room.players) {
      const targetSocket = entry.socketId && io.sockets.sockets.get(entry.socketId);
      if (targetSocket) targetSocket.emit("game-started", { room: createPublicRoom(room, entry.id) });
    }
  }));

  socket.on("game-action", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    const result = processGameAction(room, player, payload && payload.action || {});
    if (!result.success) return acknowledge(callback, result);
    acknowledge(callback, { success: true });
    emitRoomUpdate(room);
  }));

  socket.on("send-chat", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const message = normalizeText(payload && payload.message, 500);
    if (!message) return fail(callback, "Enter a message first.");
    addChat(authentication.room, authentication.player, message);
    acknowledge(callback, { success: true });
    emitRoomUpdate(authentication.room);
  }));

  socket.on("roll-tool", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    const tool = normalizeText(payload && payload.tool, 20);
    let result;
    if (tool === "coin") {
      result = crypto.randomInt(0, 2) === 0 ? "Heads" : "Tails";
      addLog(room, `${player.name} flipped ${result}.`, "tool");
    } else {
      const sides = clamp(Math.floor(Number(payload && payload.sides) || 20), 2, 1000);
      result = crypto.randomInt(1, sides + 1);
      addLog(room, `${player.name} rolled ${result} on a d${sides}.`, "tool");
    }
    acknowledge(callback, { success: true, result });
    emitRoomUpdate(room);
  }));

  socket.on("reset-game", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    const hostCheck = ensureHost(room, player);
    if (!hostCheck.success) return acknowledge(callback, hostCheck);
    room.status = "waiting";
    room.startedAt = null;
    room.turn = null;
    room.players.forEach((entry) => {
      entry.game = null;
      entry.ready = false;
    });
    room.chat = [];
    room.log = [];
    addLog(room, `${player.name} opened a new lobby.`, "room");
    acknowledge(callback, { success: true, room: createPublicRoom(room, player.id) });
    emitRoomUpdate(room);
  }));

  socket.on("remove-player", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    const hostCheck = ensureHost(room, player);
    if (!hostCheck.success) return acknowledge(callback, hostCheck);
    if (room.status !== "waiting") return fail(callback, "Players cannot be removed after the game starts.");
    const targetId = String(payload && payload.targetPlayerId || "");
    if (!targetId || targetId === player.id) return fail(callback, "The host cannot remove themselves.");
    const target = findPlayer(room, targetId);
    if (!target) return fail(callback, "That player is no longer in the room.");
    const targetSocket = target.socketId && io.sockets.sockets.get(target.socketId);
    if (targetSocket) {
      targetSocket.emit("removed-from-room", { message: `You were removed from room ${room.code}.` });
      detachSocket(targetSocket, room.code);
    }
    removePlayer(room, target.id);
    acknowledge(callback, { success: true });
  }));

  socket.on("leave-room", (payload, callback) => safeHandler(socket, callback, () => {
    const authentication = authenticationFrom(payload);
    if (!authentication.success) return acknowledge(callback, authentication);
    const { room, player } = authentication;
    if (room.status === "started") return fail(callback, "Concede first, then keep the room available for reconnecting.");
    detachSocket(socket, room.code);
    removePlayer(room, player.id);
    acknowledge(callback, { success: true });
  }));

  socket.on("connection-test", (callback) => acknowledge(callback, { success: true, socketId: socket.id, timestamp: nowIso() }));

  socket.on("disconnect", (reason) => {
    console.log(`Disconnected: ${socket.id} (${reason})`);
    const room = rooms.get(socket.data.roomCode);
    const player = findPlayer(room, socket.data.playerId);
    if (!room || !player || player.socketId !== socket.id) return;
    player.connected = false;
    player.lastSeenAt = nowIso();
    if (room.status === "waiting") player.ready = false;
    transferHostIfNeeded(room);
    addLog(room, `${player.name} disconnected.`, "warning");
    emitRoomUpdate(room);
    scheduleDisconnectCleanup(room, player);
  });
});

const cleanupInterval = setInterval(() => {
  const currentTime = Date.now();
  for (const [roomCode, room] of rooms.entries()) {
    const hasConnectedPlayer = room.players.some((player) => player.connected);
    const age = currentTime - (Date.parse(room.updatedAt) || currentTime);
    if (!hasConnectedPlayer && age >= ABANDONED_ROOM_MAX_AGE_MS) {
      room.players.forEach((player) => clearDisconnectTimer(roomCode, player.id));
      rooms.delete(roomCode);
      deletePersistedRoom(roomCode);
      console.log(`Removed abandoned room ${roomCode}`);
    }
  }
}, CLEANUP_INTERVAL_MS);
cleanupInterval.unref();

app.get("*", (request, response, next) => {
  if (request.path.startsWith("/api/")) return next();
  response.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  return response.sendFile(path.join(PUBLIC_DIRECTORY, "index.html"));
});

app.use("/api", (request, response) => {
  response.status(404).json({ success: false, error: "API route not found." });
});

app.use((error, request, response, next) => {
  console.error("Server error:", error);
  if (response.headersSent) return next(error);
  return response.status(500).json({ success: false, error: "An unexpected server error occurred." });
});

async function startServer() {
  try {
    await initializeDatabase();
  } catch (error) {
    databaseState.ready = false;
    databaseState.lastError = normalizeText(error && error.message, 240) || "Database initialization failed.";
    console.error("Unable to initialize PostgreSQL persistence:", error);

    if (DATABASE_ENABLED) {
      if (databasePool) await databasePool.end().catch(() => undefined);
      process.exit(1);
    }
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log("-----------------------------------------");
    console.log("Torn Commander Sandbox 6.0 is running");
    console.log(`Port: ${PORT}`);
    console.log(`Persistence: ${databaseState.ready ? "PostgreSQL autosave" : "temporary memory"}`);
    console.log("-----------------------------------------");
  });
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received. Saving rooms and closing server.`);
  clearInterval(cleanupInterval);
  for (const timer of disconnectTimers.values()) clearTimeout(timer);

  try {
    await flushPersistence();
  } catch (error) {
    console.error("Final database save failed:", error);
  }

  io.close(() => {
    server.close(async () => {
      if (databasePool) await databasePool.end().catch(() => undefined);
      process.exit(0);
    });
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

startServer();

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (error) => console.error("Uncaught exception:", error));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));
