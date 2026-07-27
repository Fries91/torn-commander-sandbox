"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "mtg-mechanics");
const ENGINE_URL = pathToFileURL(path.join(ROOT, "src", "engine", "index.mjs")).href;
const MODE = String(process.env.MTG_MECHANICS_MODE || "shadow").toLowerCase();
const ROOM_SYNC_DELAY_MS = Math.max(10, Number(process.env.MTG_MECHANICS_SYNC_DELAY_MS) || 75);
const MAX_STATUS_EVENTS = 20;

let enginePromise = null;
let catalogPromise = null;
const roomStatus = new Map();
const roomTimers = new Map();

function clone(value) {
  if (value == null) return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function normalizeZone(zone) {
  if (zone === "commandZone") return "command";
  if (zone === "command") return "command";
  return zone;
}

function phaseToStep(room, turnSequence) {
  const phase = String(
    room?.turn?.phase ||
    room?.turn?.phaseName ||
    room?.phase ||
    ""
  ).toLowerCase();
  const index = Number(room?.turn?.phaseIndex);
  const serverPhases = [
    "untap", "upkeep", "draw", "precombat_main", "begin_combat",
    "declare_attackers", "declare_blockers", "combat_damage", "combat_damage",
    "end_combat", "postcombat_main", "end", "cleanup"
  ];
  let step = Number.isInteger(index) ? serverPhases[index] : null;
  if (!step) {
    if (phase.includes("main 1")) step = "precombat_main";
    else if (phase.includes("main 2")) step = "postcombat_main";
    else if (phase.includes("begin") && phase.includes("combat")) step = "begin_combat";
    else if (phase.includes("attack")) step = "declare_attackers";
    else if (phase.includes("block")) step = "declare_blockers";
    else if (phase.includes("damage")) step = "combat_damage";
    else if (phase.includes("end combat")) step = "end_combat";
    else if (phase.includes("cleanup")) step = "cleanup";
    else if (phase.includes("upkeep")) step = "upkeep";
    else if (phase.includes("draw")) step = "draw";
    else if (phase.includes("untap")) step = "untap";
    else if (phase === "end") step = "end";
  }
  const found = turnSequence.indexOf(step);
  return found >= 0 ? found : 0;
}

function cardDefinition(card) {
  const data = card?.cardData || card?.base || card || {};
  const face = Array.isArray(data.faces) ? data.faces[Number(card?.faceIndex || 0)] : null;
  return {
    id: data.scryfallId || data.id || card?.definitionId || card?.id || card?.name,
    oracle_id: data.oracleId || data.oracle_id || null,
    name: face?.name || data.name || card?.name || "Unknown card",
    mana_cost: face?.manaCost || face?.mana_cost || data.manaCost || data.mana_cost || "",
    type_line: face?.typeLine || face?.type_line || data.typeLine || data.type_line || card?.typeLine || "",
    oracle_text: face?.oracleText || face?.oracle_text || data.oracleText || data.oracle_text || card?.oracleText || "",
    color_identity: data.colorIdentity || data.color_identity || card?.colorIdentity || [],
    power: face?.power ?? data.power ?? card?.power ?? null,
    toughness: face?.toughness ?? data.toughness ?? card?.toughness ?? null,
    loyalty: face?.loyalty ?? data.loyalty ?? card?.loyalty ?? null,
    keywords: data.keywords || card?.keywords || []
  };
}

function roomPlayers(room) {
  return (Array.isArray(room?.players) ? room.players : [])
    .filter((player) => player?.id)
    .map((player) => ({
      id: String(player.id),
      name: String(player.name || player.id),
      life: Number(player.game?.life ?? player.life ?? 40)
    }));
}

async function loadEngine() {
  if (!enginePromise) enginePromise = import(ENGINE_URL);
  return enginePromise;
}

async function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = Promise.resolve().then(() => {
      const mechanics = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "mechanics-index.json"), "utf8"));
      const digital = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "arena-digital-mechanics.json"), "utf8"));
      const model = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "core-game-model.json"), "utf8"));
      return {
        officialMechanics: Number(mechanics?.counts?.total || mechanics?.mechanics?.length || 0),
        keywordActions: Number(mechanics?.counts?.keyword_actions || 0),
        keywordAbilities: Number(mechanics?.counts?.keyword_abilities || 0),
        digitalMechanics: Array.isArray(digital?.mechanics) ? digital.mechanics.map((entry) => entry.id) : [],
        rulesBaseline: mechanics?.generated_from || model?.rules_baseline || null,
        supportedPlayers: model?.supported_game_shape || null
      };
    });
  }
  return catalogPromise;
}

async function initialize() {
  const [engine, catalog] = await Promise.all([loadEngine(), loadCatalog()]);
  return {
    mode: MODE,
    engineExports: Object.keys(engine).sort(),
    mechanics: catalog
  };
}

function replaceGeneratedId(game, object, desiredId) {
  if (!desiredId || game.objects.has(desiredId)) return object.id;
  const oldId = object.id;
  game.objects.delete(oldId);
  object.id = desiredId;
  game.objects.set(desiredId, object);
  for (const player of game.players.values()) {
    for (const zone of Object.values(player.zones)) {
      const index = zone.indexOf(oldId);
      if (index >= 0) zone[index] = desiredId;
    }
  }
  return desiredId;
}

async function createShadowGame(room) {
  const engine = await loadEngine();
  const players = roomPlayers(room);
  if (players.length < 2) throw new Error("A room needs at least two players for the mechanics engine.");

  const game = engine.registerDefaultMechanics(new engine.GameState({
    format: room?.format === "commander" || room?.settings?.format === "commander" ? "commander" : (room?.format || room?.settings?.format || "commander"),
    players,
    startingPlayerId: String(room?.turn?.activePlayerId || players[0].id)
  }));

  game.turnNumber = Math.max(1, Number(room?.turn?.number || 1));
  game.stepIndex = phaseToStep(room, engine.TURN_SEQUENCE);
  if (game.players.has(String(room?.turn?.activePlayerId || ""))) {
    game.activePlayerId = String(room.turn.activePlayerId);
  }
  const priorityId = String(room?.priority?.playerId || room?.turn?.priorityPlayerId || game.activePlayerId);
  game.priorityPlayerId = game.players.has(priorityId) ? priorityId : game.activePlayerId;
  game.consecutivePasses = Array.isArray(room?.priority?.passedPlayerIds)
    ? Math.min(room.priority.passedPlayerIds.length, game.livingPlayers.length)
    : 0;

  const zoneNames = ["library", "hand", "battlefield", "graveyard", "exile", "commandZone"];
  let cardCount = 0;
  for (const roomPlayer of room.players || []) {
    const playerId = String(roomPlayer.id);
    const enginePlayer = game.players.get(playerId);
    if (!enginePlayer) continue;
    enginePlayer.life = Number(roomPlayer.game?.life ?? roomPlayer.life ?? enginePlayer.life);
    enginePlayer.poison = Number(roomPlayer.game?.poison ?? roomPlayer.poison ?? 0);
    enginePlayer.hasLost = Boolean(roomPlayer.game?.hasLost ?? roomPlayer.hasLost ?? roomPlayer.conceded);
    enginePlayer.manaPool = clone(roomPlayer.game?.manaPool || {});

    for (const roomZone of zoneNames) {
      const cards = Array.isArray(roomPlayer.game?.[roomZone]) ? roomPlayer.game[roomZone] : [];
      const engineZone = normalizeZone(roomZone);
      for (const card of cards) {
        const object = game.createCardInstance(cardDefinition(card), {
          ownerId: String(card.ownerId || playerId),
          controllerId: String(card.controllerId || playerId),
          zone: engineZone,
          token: Boolean(card.token),
          conjured: Boolean(card.conjured)
        });
        replaceGeneratedId(game, object, String(card.id || ""));
        object.tapped = Boolean(card.tapped);
        object.counters = clone(card.counters || {});
        object.damageMarked = Number(card.damageMarked || card.damage || 0);
        object.perpetualModifiers = clone(card.perpetualModifiers || card.perpetual || []);
        object.temporaryModifiers = clone(card.temporaryModifiers || []);
        object.metadata = {
          sourceRoomCode: room.code || room.id || null,
          sourceCardId: card.id || null,
          attackingPlayerId: card.attackingPlayerId || card.defenderPlayerId || null,
          faceIndex: Number(card.faceIndex || 0)
        };
        cardCount += 1;
      }
    }
  }

  game.stack = (Array.isArray(room?.stack) ? room.stack : []).map((item) => ({
    id: String(item.id || `${Date.now()}-${Math.random()}`),
    controllerId: String(item.controllerId || game.activePlayerId),
    sourceId: item.sourceCardId || item.sourceId || null,
    kind: item.kind || "unknown",
    label: item.name || item.label || item.text || "Stack item",
    targets: clone(item.targets || []),
    metadata: clone(item.metadata || {}),
    resolve: async () => undefined
  }));

  const commanderDamage = room?.commanderDamage || room?.game?.commanderDamage || null;
  if (commanderDamage && typeof commanderDamage === "object") {
    for (const [key, amount] of Object.entries(commanderDamage)) {
      const numeric = Number(amount || 0);
      if (numeric > 0) game.commanderDamage.set(key, numeric);
    }
  }

  return { game, cardCount };
}

function publicStatus(status) {
  if (!status) return {
    mode: MODE,
    ready: false,
    synchronized: false,
    error: null
  };
  return {
    mode: status.mode,
    ready: status.ready,
    synchronized: status.synchronized,
    roomCode: status.roomCode,
    syncedAt: status.syncedAt,
    revision: status.revision,
    players: status.players,
    cards: status.cards,
    stackItems: status.stackItems,
    step: status.step,
    activePlayerId: status.activePlayerId,
    priorityPlayerId: status.priorityPlayerId,
    error: status.error || null,
    recent: status.recent || []
  };
}

async function syncRoom(room, context = {}) {
  const roomCode = String(room?.code || room?.id || "unknown");
  const previous = roomStatus.get(roomCode);
  try {
    const [{ game, cardCount }, catalog] = await Promise.all([createShadowGame(room), loadCatalog()]);
    const viewers = {};
    for (const player of game.players.values()) {
      const view = game.sanitizeFor(player.id);
      viewers[player.id] = {
        handCount: view.players[player.id]?.handCount || 0,
        libraryCount: view.players[player.id]?.libraryCount || 0,
        visibleOpponentHands: Object.values(view.players)
          .filter((entry) => entry.id !== player.id)
          .reduce((sum, entry) => sum + (entry.hand?.length || 0), 0)
      };
    }
    const recent = [...(previous?.recent || []), {
      at: new Date().toISOString(),
      reason: String(context.reason || context.actionType || "sync").slice(0, 80),
      ok: true
    }].slice(-MAX_STATUS_EVENTS);
    const status = {
      mode: MODE,
      ready: true,
      synchronized: true,
      roomCode,
      syncedAt: new Date().toISOString(),
      revision: Number(room?.revision || room?.updatedAt || game.revision || 0),
      players: game.players.size,
      cards: cardCount,
      stackItems: game.stack.length,
      step: game.currentStep,
      activePlayerId: game.activePlayerId,
      priorityPlayerId: game.priorityPlayerId,
      viewers,
      catalog,
      error: null,
      recent
    };
    roomStatus.set(roomCode, status);
    return publicStatus(status);
  } catch (error) {
    const recent = [...(previous?.recent || []), {
      at: new Date().toISOString(),
      reason: String(context.reason || context.actionType || "sync").slice(0, 80),
      ok: false,
      error: String(error?.message || error).slice(0, 300)
    }].slice(-MAX_STATUS_EVENTS);
    const status = {
      mode: MODE,
      ready: true,
      synchronized: false,
      roomCode,
      syncedAt: new Date().toISOString(),
      error: String(error?.message || error),
      recent
    };
    roomStatus.set(roomCode, status);
    throw error;
  }
}

function scheduleRoomSync(room, context = {}) {
  if (MODE === "off" || !room) return;
  const roomCode = String(room?.code || room?.id || "unknown");
  clearTimeout(roomTimers.get(roomCode));
  const timer = setTimeout(() => {
    roomTimers.delete(roomCode);
    syncRoom(room, context).catch((error) => {
      if (process.env.MTG_MECHANICS_LOG_ERRORS === "1") {
        console.warn("MTG mechanics shadow sync failed:", error?.message || error);
      }
    });
  }, ROOM_SYNC_DELAY_MS);
  timer.unref?.();
  roomTimers.set(roomCode, timer);
}

function getRoomStatus(roomOrCode) {
  const roomCode = typeof roomOrCode === "string"
    ? roomOrCode
    : String(roomOrCode?.code || roomOrCode?.id || "unknown");
  return publicStatus(roomStatus.get(roomCode));
}

function validateCardScript(script) {
  const errors = [];
  if (!script || typeof script !== "object" || Array.isArray(script)) errors.push("Card script must be an object.");
  if (!String(script?.definitionId || "").trim()) errors.push("definitionId is required.");
  if (!String(script?.name || "").trim()) errors.push("name is required.");
  if (!Array.isArray(script?.abilities)) errors.push("abilities must be an array.");
  for (const [index, ability] of (script?.abilities || []).entries()) {
    if (!ability || typeof ability !== "object") {
      errors.push(`abilities[${index}] must be an object.`);
      continue;
    }
    if (!["static", "activated", "triggered", "spell"].includes(ability.kind)) {
      errors.push(`abilities[${index}].kind is unsupported.`);
    }
    if (!String(ability.handler || "").trim()) errors.push(`abilities[${index}].handler is required.`);
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  version: "63.1.0",
  mode: MODE,
  initialize,
  loadEngine,
  loadCatalog,
  createShadowGame,
  syncRoom,
  scheduleRoomSync,
  getRoomStatus,
  validateCardScript
};
