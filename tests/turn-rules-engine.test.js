"use strict";

const assert = require("assert");
const {
  BASE_PHASES,
  createTurnRulesEngine,
  _test
} = require("../turn-rules-engine");

let nextId = 0;

const deps = {
  PHASES: BASE_PHASES,
  createId: () => `id-${++nextId}`,
  nowIso: () => "2026-07-24T00:00:00.000Z",
  currentCardFace: (card) => card?.cardData || {},
  currentOracleText: (card) => card?.cardData?.oracleText || "",
  findPlayer: (room, playerId) =>
    room.players.find((player) => player.id === playerId),
  activePlayers: (room) =>
    room.players.filter(
      (player) =>
        player.game &&
        !player.game.lost &&
        !player.game.conceded
    ),
  clearCombat: (room) => {
    for (const player of room.players) {
      for (const card of player.game?.battlefield || []) {
        card.attacking = false;
        card.blockingCardId = null;
        card.defendingPlayerId = null;
      }
    }
  },
  clearDamage: (room) => {
    for (const player of room.players) {
      for (const card of player.game?.battlefield || []) {
        card.damageMarked = 0;
      }
    }
  },
  clearMana: (room) => {
    for (const player of room.players) {
      if (player.game) {
        player.game.manaPool = {
          W: 0,
          U: 0,
          B: 0,
          R: 0,
          G: 0,
          C: 0
        };
      }
    }
  },
  expireEndOfTurnEffects: () => {},
  resetPriority: (room, playerId) => {
    room.priority = {
      playerId,
      passedPlayerIds: []
    };
  },
  resetTurnDeadline: (room) => {
    room.turn.deadlineAt = null;
  },
  queueSuggestedTriggers: (room, event, context) => {
    room.triggerEvents.push({ event, context });
  },
  runStateBasedActions: (room, reason) => {
    room.stateChecks.push(reason);
    return [];
  },
  addLog: (room, text, type) => {
    room.log.push({ text, type });
  },
  advanceTurn: () => {}
};

function makePlayer(id) {
  return {
    id,
    name: id,
    game: {
      lost: false,
      conceded: false,
      battlefield: [],
      exile: [],
      manaPool: {
        W: 0,
        U: 0,
        B: 0,
        R: 0,
        G: 0,
        C: 0
      }
    }
  };
}

function makeCard(id, ownerId = "p1") {
  return {
    id,
    name: id,
    ownerId,
    controllerId: ownerId,
    tapped: true,
    summoningSick: true,
    attacking: false,
    blockingCardId: null,
    defendingPlayerId: null,
    damageMarked: 3,
    token: false,
    cardData: {
      name: id,
      oracleText: ""
    }
  };
}

const p1 = makePlayer("p1");
const p2 = makePlayer("p2");
const p3 = makePlayer("p3");

const room = {
  status: "started",
  hostId: "p1",
  players: [p1, p2, p3],
  turn: {
    number: 4,
    phaseIndex: 10,
    activePlayerId: "p1",
    order: ["p1", "p2", "p3"],
    deadlineAt: null
  },
  priority: {
    playerId: "p1",
    passedPlayerIds: []
  },
  stack: [],
  triggerQueue: [],
  turnV60: {},
  triggerEvents: [],
  stateChecks: [],
  log: []
};

assert.deepEqual(
  _test.normalizedTurnOrder(room),
  ["p1", "p2", "p3"]
);
assert.equal(
  _test.nextNormalPlayerId(room, "p1"),
  "p2"
);

let result = _test.queueExtraTurn(
  room,
  "p2",
  {
    amount: 1,
    sourceName: "First extra"
  },
  deps
);
assert.equal(result.success, true);

result = _test.queueExtraTurn(
  room,
  "p3",
  {
    amount: 1,
    sourceName: "Newest extra"
  },
  deps
);
assert.equal(result.success, true);

let choice = _test.chooseNextTurn(room, "p1", deps);
assert.equal(choice.playerId, "p3");
assert.equal(choice.kind, "extra");

choice = _test.chooseNextTurn(room, "p1", deps);
assert.equal(choice.playerId, "p2");
assert.equal(choice.kind, "extra");

_test.skipNextTurn(
  room,
  "p2",
  1,
  {
    sourceName: "Skip test"
  },
  deps
);

choice = _test.chooseNextTurn(room, "p1", deps);
assert.equal(choice.playerId, "p3");
assert.equal(room.turnV60.skippedTurns.p2, 0);

result = _test.queueAdditionalPhase(
  room,
  "p1",
  "combat-main",
  {
    anchorPhaseIndex: 10,
    sourceName: "Extra combat"
  },
  deps
);
assert.equal(result.success, true);

const insertion = _test.pendingInsertion(room);
assert(insertion);
assert.deepEqual(insertion.path, [4, 5, 6, 7, 8, 9, 10]);

result = _test.customNextPhase(room, p1, deps);
assert.equal(result.success, true);
assert.equal(result.inserted, true);
assert.equal(room.turn.phaseIndex, 4);

room.turn.phaseIndex = 1;
result = _test.queueSkipPhase(
  room,
  "p1",
  "Draw",
  1,
  {
    notBeforeTurn: 4,
    sourceName: "Skip draw"
  },
  deps
);
assert.equal(result.success, true);

result = _test.customNextPhase(room, p1, deps);
assert.equal(result.success, true);
assert.equal(room.turn.phaseIndex, 3);
assert.equal(room.turnV60.skippedPhases.length, 0);

room.turn.order = ["p1", "p2", "p3"];
result = _test.reverseTurnOrder(
  room,
  "p1",
  {
    sourceName: "Reverse"
  },
  deps
);
assert.equal(result.success, true);
assert.deepEqual(room.turn.order, ["p1", "p3", "p2"]);

const stackCard = makeCard("stack-card", "p2");
room.stack = [
  {
    id: "stack-item",
    name: "Stack Spell",
    controllerId: "p2",
    card: stackCard
  }
];
p1.game.battlefield.push(makeCard("fighter", "p1"));
p1.game.battlefield[0].attacking = true;

result = _test.endTurnNow(
  room,
  "p1",
  {
    sourceName: "Sundial test"
  },
  deps
);
assert.equal(result.success, true);
assert.equal(room.turn.phaseIndex, 12);
assert.equal(room.stack.length, 0);
assert(
  p2.game.exile.some((card) => card.id === "stack-card")
);
assert.equal(p1.game.battlefield[0].attacking, false);

room.turn.phaseIndex = 6;
room.stack = [];
result = _test.endCombatNow(
  room,
  "p1",
  {
    sourceName: "End combat test"
  },
  deps
);
assert.equal(result.success, true);
assert.equal(room.turn.phaseIndex, 10);

const parsedRoom = {
  ...room,
  turn: {
    ...room.turn,
    phaseIndex: 3,
    activePlayerId: "p1"
  },
  turnV60: {},
  log: [],
  triggerEvents: []
};

const actions = _test.parseResolvedTurnEffects(
  parsedRoom,
  {
    id: "effect",
    controllerId: "p1",
    name: "Temporal Effect",
    text:
      "Take an extra turn after this one. After this main phase, there is an additional combat phase followed by an additional main phase.",
    targets: []
  },
  deps
);

assert.equal(actions.length, 2);
assert.equal(parsedRoom.turnV60.extraTurns.length, 1);
assert.equal(parsedRoom.turnV60.phaseInsertions.length, 1);

assert.equal(
  _test.shouldEndTurnBeforeResolve(
    {
      text: "End the turn."
    },
    deps
  ),
  true
);

assert.equal(
  _test.shouldEndCombatBeforeResolve(
    {
      text: "End the combat phase."
    },
    deps
  ),
  true
);

const engine = createTurnRulesEngine(deps);
const status = engine.status();

assert.equal(status.success, true);
assert.equal(status.version, "60.0.0");

console.log(
  "Arena turn order, extra turns, skipped turns and phase-control engine v60 tests passed."
);
