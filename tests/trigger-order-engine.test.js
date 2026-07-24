"use strict";

const assert = require("assert");
const {
  createTriggerOrderEngine,
  _test
} = require("../trigger-order-engine");

let nextId = 0;

const deps = {
  PHASES: [
    "Untap",
    "Upkeep",
    "Draw",
    "Main 1",
    "Beginning Combat",
    "Declare Attackers",
    "Declare Blockers",
    "First-Strike Damage",
    "Combat Damage",
    "End Combat",
    "Main 2",
    "End",
    "Cleanup"
  ],
  createId: () => `id-${++nextId}`,
  nowIso: () => "2026-07-24T00:00:00.000Z",
  currentTypeLine: (card) => card.cardData?.typeLine || "",
  currentOracleText: (card) => card.cardData?.oracleText || "",
  isCreatureCard: (card) =>
    /\bCreature\b/i.test(card.cardData?.typeLine || ""),
  findPlayer: (room, playerId) =>
    room.players.find((player) => player.id === playerId),
  locateCard: (room, cardId) => {
    for (const player of room.players) {
      for (const zone of [
        "battlefield",
        "hand",
        "graveyard",
        "exile",
        "commandZone",
        "library"
      ]) {
        const index = player.game[zone].findIndex((card) => card.id === cardId);
        if (index >= 0) {
          return {
            player,
            zone,
            index,
            card: player.game[zone][index]
          };
        }
      }
    }
    return null;
  },
  activePlayerIds: (room) =>
    room.turn.order.filter((id) => {
      const player = room.players.find((entry) => entry.id === id);
      return player?.game && !player.game.lost && !player.game.conceded;
    }),
  resetPriority: (room, playerId) => {
    room.priority = { playerId, passedPlayerIds: [] };
  },
  queueTrigger: (room, trigger) => {
    const value = { id: deps.createId(), ...trigger };
    room.triggerQueue.push(value);
    return value;
  },
  publicCard: (card) => JSON.parse(JSON.stringify(card)),
  addLog: (room, text, type) => room.log.push({ text, type })
};

function card(id, name, typeLine = "Creature", oracleText = "") {
  return {
    id,
    name,
    ownerId: "p1",
    controllerId: "p1",
    tapped: false,
    token: false,
    cardData: {
      name,
      typeLine,
      oracleText,
      imageUrl: ""
    }
  };
}

function player(id, name, isBot = false) {
  return {
    id,
    name,
    isBot,
    game: {
      life: 40,
      lost: false,
      conceded: false,
      hand: [],
      library: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: []
    }
  };
}

const p1 = player("p1", "Active");
const p2 = player("p2", "Next");
const p3 = player("p3", "Last");
p1.game.battlefield.push(card("elf", "Elf", "Creature — Elf"));

const room = {
  players: [p1, p2, p3],
  hostId: "p1",
  turn: {
    number: 4,
    phaseIndex: 3,
    activePlayerId: "p2",
    order: ["p1", "p2", "p3"]
  },
  triggerQueue: [],
  stack: [],
  priority: { playerId: "p2", passedPlayerIds: [] },
  log: [],
  triggersV48: {}
};

assert.deepEqual(_test.activeOrder(room, deps), ["p2", "p3", "p1"]);

function queue(controllerId, sourceName, text, sourceCardId = null) {
  const trigger = {
    id: deps.createId(),
    controllerId,
    sourceCardId,
    sourceName,
    event: "TEST",
    text,
    targets: [],
    createdAt: deps.nowIso()
  };
  room.triggerQueue.push(trigger);
  return trigger;
}

const t1 = queue("p1", "A", "Whenever A attacks, draw a card.");
const t2 = queue("p2", "B", "Whenever B attacks, draw a card.");
const t3 = queue("p2", "C", "Whenever C attacks, draw a card.");
const t4 = queue("p3", "D", "Whenever D attacks, draw a card.");

const batch = _test.captureSuggested(
  room,
  "ATTACKED",
  [t1, t2, t3, t4],
  {},
  deps
);

assert(batch);
assert.deepEqual(
  batch.groups.map((group) => group.playerId),
  ["p2", "p3", "p1"]
);
assert.deepEqual(batch.groups[0].triggerIds, [t2.id, t3.id]);

function legacyProcess(testRoom, actor, action) {
  if (action.type !== "trigger-to-stack") {
    return { success: false, error: "Unsupported test action." };
  }

  const index = testRoom.triggerQueue.findIndex(
    (trigger) => trigger.id === action.triggerId
  );
  if (index < 0) return { success: false, error: "Missing trigger." };

  const [trigger] = testRoom.triggerQueue.splice(index, 1);
  testRoom.stack.push({
    id: deps.createId(),
    kind: "trigger",
    name: `${trigger.sourceName} trigger`,
    controllerId: trigger.controllerId,
    sourceCardId: trigger.sourceCardId,
    text: trigger.text,
    targets: trigger.targets || []
  });
  return { success: true };
}

let result = _test.moveGroupToStack(
  room,
  batch.groups[0],
  batch,
  [t3.id, t2.id],
  {},
  legacyProcess,
  deps
);
assert.equal(result.success, true);
assert.equal(room.stack.at(-1).name, "C trigger");

result = _test.autoAdvance(room, legacyProcess, deps);
assert.equal(result.success, true);
assert.equal(_test.currentBatch(room), null);
assert.deepEqual(
  room.stack.map((item) => item.controllerId),
  ["p2", "p2", "p3", "p1"]
);
assert.equal(room.priority.playerId, "p2");

const optional = queue(
  "p1",
  "Optional Source",
  "Whenever this attacks, you may draw a card."
);
const optionalBatch = _test.captureSuggested(
  room,
  "ATTACKED",
  [optional],
  {},
  deps
);
assert(optionalBatch);
result = _test.autoAdvance(room, legacyProcess, deps);
assert.equal(result.success, true);

let prepared = _test.beforeResolve(room, deps);
assert.equal(prepared.handled, true);
assert.equal(prepared.waiting, true);
assert.equal(room.triggersV48.mayChoices.length, 1);

function legacyResolve(testRoom) {
  return testRoom.stack.pop();
}

result = _test.resolveMay(
  room,
  p1,
  room.triggersV48.mayChoices[0].id,
  false,
  legacyResolve,
  legacyProcess,
  deps
);
assert.equal(result.success, true);
assert.equal(result.declined, true);

const onceA = queue(
  "p1",
  "Once Source",
  "Whenever this attacks, draw a card. This ability triggers only once each turn."
);
const onceB = queue(
  "p1",
  "Once Source",
  "Whenever this attacks, draw a card. This ability triggers only once each turn.",
  onceA.sourceCardId
);
onceB.sourceName = onceA.sourceName;
onceB.sourceCardId = onceA.sourceCardId;

const firstOnce = _test.captureSuggested(room, "ATTACKED", [onceA], {}, deps);
assert(firstOnce);
const secondOnce = _test.captureSuggested(room, "ATTACKED", [onceB], {}, deps);
assert.equal(secondOnce, null);
assert(!room.triggerQueue.some((trigger) => trigger.id === onceB.id));

const ifTrigger = {
  id: deps.createId(),
  controllerId: "p1",
  sourceCardId: "elf",
  sourceName: "Conditional",
  event: "UPKEEP",
  text: "At the beginning of your upkeep, if you control a creature, draw a card.",
  targets: []
};
assert.equal(
  _test.evaluateCondition(room, "p1", ifTrigger, deps).result,
  true
);
p1.game.battlefield = [];
assert.equal(
  _test.evaluateCondition(room, "p1", ifTrigger, deps).result,
  false
);

const delayedItem = {
  id: "stack-delayed",
  controllerId: "p1",
  sourceCardId: null,
  name: "Delayed Spell",
  text: "At the beginning of the next end step, draw a card."
};
room.turn.number = 8;
room.turn.phaseIndex = 3;
const delayed = _test.registerDelayedFromItem(room, delayedItem, deps);
assert.equal(delayed.length, 1);
room.turn.phaseIndex = deps.PHASES.indexOf("End");
const fired = _test.fireDelayedForCurrentPhase(room, deps);
assert.equal(fired.length, 1);
assert(
  room.triggerQueue.some((trigger) =>
    /draw a card/i.test(trigger.text)
  )
);

console.log("Arena trigger order and APNAP engine v48 tests passed.");
