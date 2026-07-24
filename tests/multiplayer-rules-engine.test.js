"use strict";

const assert = require("assert");
const {
  DUNGEONS,
  createMultiplayerRulesEngine,
  _test
} = require("../multiplayer-rules-engine");

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
  currentCardFace: (card) =>
    card.cardData?.faces?.[card.activeFaceIndex || 0] ||
    card.cardData ||
    {},
  currentTypeLine: (card) =>
    card.cardData?.faces?.[card.activeFaceIndex || 0]?.typeLine ||
    card.cardData?.typeLine ||
    "",
  currentOracleText: (card) =>
    card.cardData?.faces?.[card.activeFaceIndex || 0]?.oracleText ||
    card.cardData?.oracleText ||
    "",
  isCreatureCard: (card) =>
    /\bCreature\b/i.test(deps.currentTypeLine(card)),
  effectiveStats: (card) => ({
    power: Number(card.power) || 0,
    toughness: Number(card.toughness) || 0
  }),
  findPlayer: (room, playerId) =>
    room.players.find((player) => player.id === playerId),
  findBattlefieldCard: (room, cardId) => {
    for (const player of room.players) {
      const index = player.game.battlefield.findIndex(
        (card) => card.id === cardId
      );
      if (index >= 0) {
        return {
          player,
          card: player.game.battlefield[index],
          index,
          zone: "battlefield"
        };
      }
    }
    return null;
  },
  locateCard: (room, cardId) => {
    for (const player of room.players) {
      for (const zone of [
        "library",
        "hand",
        "battlefield",
        "graveyard",
        "exile",
        "commandZone"
      ]) {
        const index = player.game[zone].findIndex(
          (card) => card.id === cardId
        );
        if (index >= 0) {
          return {
            player,
            card: player.game[zone][index],
            index,
            zone
          };
        }
      }
    }
    return null;
  },
  migrateCard: (card) => JSON.parse(JSON.stringify(card)),
  publicCard: (card) => card ? JSON.parse(JSON.stringify(card)) : null,
  pushStack: (room, item) => {
    const value = {
      id: deps.createId(),
      ...item
    };
    room.stack.push(value);
    return value;
  },
  resetPriority: (room, playerId) => {
    room.priority = {
      playerId,
      passedPlayerIds: []
    };
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
  }
};

function makeCard(
  id,
  name,
  typeLine,
  oracleText = "",
  extras = {}
) {
  return {
    id,
    name,
    ownerId: extras.ownerId || "p1",
    controllerId:
      extras.controllerId ||
      extras.ownerId ||
      "p1",
    tapped: Boolean(extras.tapped),
    counters: extras.counters || {},
    damageMarked: 0,
    token: Boolean(extras.token),
    commander: false,
    attacking: Boolean(extras.attacking),
    defendingPlayerId: extras.defendingPlayerId || null,
    defendingPermanentId: null,
    blockingCardId: null,
    attachedToId: null,
    summoningSick: false,
    phasedOut: false,
    temporaryEffects: [],
    ruleEffects: [],
    manualKeywords: [],
    specialState: {},
    power: extras.power || "2",
    toughness: extras.toughness || "2",
    cardData: {
      name,
      typeLine,
      oracleText,
      power: extras.power || "2",
      toughness: extras.toughness || "2",
      keywords: extras.keywords || [],
      imageUrl: "",
      faces: []
    }
  };
}

function makePlayer(id, name = id) {
  return {
    id,
    name,
    isBot: false,
    game: {
      life: 40,
      poison: 0,
      lost: false,
      conceded: false,
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: []
    }
  };
}

const p1 = makePlayer("p1", "One");
const p2 = makePlayer("p2", "Two");
const p3 = makePlayer("p3", "Three");

const room = {
  players: [p1, p2, p3],
  hostId: "p1",
  turn: {
    number: 4,
    phaseIndex: 3,
    activePlayerId: "p1",
    order: ["p1", "p2", "p3"]
  },
  priority: {
    playerId: "p1",
    passedPlayerIds: []
  },
  stack: [],
  multiplayerV56: {},
  triggerEvents: [],
  stateChecks: [],
  log: []
};

for (let index = 0; index < 20; index += 1) {
  p1.game.library.push(
    makeCard(
      `library-${index}`,
      `Library ${index}`,
      index % 4 === 0
        ? "Basic Land — Forest"
        : index % 3 === 0
          ? "Creature — Human"
          : "Sorcery",
      "",
      {
        ownerId: "p1",
        controllerId: "p1"
      }
    )
  );
}

let result = _test.setMonarch(
  room,
  "p2",
  "test",
  deps
);
assert.equal(result.success, true);
assert.equal(
  room.multiplayerV56.monarchPlayerId,
  "p2"
);

const attacker = makeCard(
  "attacker",
  "Attacker",
  "Creature — Warrior",
  "",
  {
    ownerId: "p1",
    controllerId: "p1",
    attacking: true,
    power: "3",
    toughness: "3"
  }
);
p1.game.battlefield.push(attacker);

_test.wrapPlayerDamage(
  room,
  attacker,
  p2,
  3,
  (_room, _source, target, amount) => {
    target.game.life -= amount;
    return amount;
  },
  deps
);
assert.equal(
  room.multiplayerV56.monarchPlayerId,
  "p1"
);

room.turn.phaseIndex = 11;
room.turn.activePlayerId = "p1";
_test.processPhaseTriggers(room, deps);
const monarchTrigger = room.stack.find(
  (item) => item.v56Special?.kind === "monarch-draw"
);
assert(monarchTrigger);

const handBefore = p1.game.hand.length;
_test.resolveSpecialStack(
  room,
  monarchTrigger,
  deps
);
assert.equal(
  p1.game.hand.length,
  handBefore + 1
);

room.stack = [];
result = _test.setInitiative(
  room,
  "p2",
  "test",
  deps
);
assert.equal(result.success, true);
assert.equal(
  room.multiplayerV56.initiativePlayerId,
  "p2"
);
const initiativeTrigger = room.stack.find(
  (item) => item.v56Special?.kind === "initiative-venture"
);
assert(initiativeTrigger);
_test.resolveSpecialStack(
  room,
  initiativeTrigger,
  deps
);
assert.equal(
  room.multiplayerV56.dungeonsByPlayer.p2.dungeonId,
  "undercity"
);
assert.equal(
  room.multiplayerV56.dungeonsByPlayer.p2.roomId,
  "secret_entrance"
);

assert.equal(
  DUNGEONS.lost_mine.rooms.cave_entrance.next.length,
  2
);

room.multiplayerV56.dungeonsByPlayer.p1 = null;
result = _test.venture(
  room,
  p1,
  "normal",
  deps
);
assert.equal(result.success, true);
const startChoice = room.multiplayerV56.choices.find(
  (choice) =>
    choice.kind === "dungeon-start" &&
    choice.playerId === "p1"
);
assert(startChoice);
assert.equal(startChoice.candidates.length, 3);

result = _test.resolveDungeonChoice(
  room,
  p1,
  {
    choiceId: startChoice.id,
    dungeonId: "lost_mine"
  },
  () => ({ success: true }),
  deps
);
assert.equal(result.success, true);
assert.equal(
  room.multiplayerV56.dungeonsByPlayer.p1.roomId,
  "cave_entrance"
);

const parsedWill = _test.parseVoteInstruction(
  "Will of the council — Starting with you, each player votes for grace or condemnation."
);
assert.equal(parsedWill.mode, "will");
assert.deepEqual(
  parsedWill.options,
  ["grace", "condemnation"]
);

const vote = _test.createVoteSession(
  room,
  "p1",
  {
    title: "Test Vote",
    mode: "will",
    secret: false,
    options: ["A", "B"]
  },
  null,
  deps
);

result = _test.castVote(
  room,
  p1,
  {
    voteId: vote.id,
    option: "A"
  },
  deps
);
assert.equal(result.success, true);

result = _test.castVote(
  room,
  p2,
  {
    voteId: vote.id,
    option: "B"
  },
  deps
);
assert.equal(result.success, true);

result = _test.castVote(
  room,
  p3,
  {
    voteId: vote.id,
    option: "A"
  },
  deps
);
assert.equal(result.success, true);
assert.equal(result.complete, true);
assert.deepEqual(
  room.multiplayerV56.votes[vote.id].result.counts,
  { A: 2, B: 1 }
);

const secretVote = _test.createVoteSession(
  room,
  "p1",
  {
    title: "Secret",
    mode: "secret",
    secret: true,
    options: ["X", "Y"]
  },
  null,
  deps
);

assert.equal(
  _test.castVote(
    room,
    p3,
    {
      voteId: secretVote.id,
      option: "Y"
    },
    deps
  ).success,
  true
);
assert.equal(
  _test.castVote(
    room,
    p1,
    {
      voteId: secretVote.id,
      option: "X"
    },
    deps
  ).success,
  true
);
assert.equal(
  _test.castVote(
    room,
    p2,
    {
      voteId: secretVote.id,
      option: "Y"
    },
    deps
  ).complete,
  true
);

p2.game.lost = true;
room.multiplayerV56.monarchPlayerId = "p2";
room.turn.activePlayerId = "p1";
_test.handleDepartedHolders(room, deps);
assert.equal(
  room.multiplayerV56.monarchPlayerId,
  "p1"
);

const engine = createMultiplayerRulesEngine(deps);
const status = engine.status();
assert.equal(status.success, true);
assert.equal(status.version, "56.0.0");

console.log(
  "Arena Monarch, Initiative, Dungeons and voting engine v56 tests passed."
);
