"use strict";

const assert = require("assert");
const {
  createWalkerBattleEngine,
  _test
} = require("../walker-battle-engine");

let nextId = 0;

const deps = {
  PHASES: [
    "Untap", "Upkeep", "Draw", "Main 1", "Beginning Combat",
    "Declare Attackers", "Declare Blockers", "First-Strike Damage",
    "Combat Damage", "End Combat", "Main 2", "End", "Cleanup"
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
    /\bCreature\b/i.test(
      deps.currentTypeLine(card)
    ),
  hasKeyword: (card, keyword) => {
    const values = [
      ...(card.cardData?.keywords || []),
      ...(card.manualKeywords || [])
    ].map((entry) => String(entry).toLowerCase());
    return values.includes(String(keyword).toLowerCase()) ||
      new RegExp(`\\b${String(keyword)}\\b`, "i")
        .test(deps.currentOracleText(card));
  },
  effectiveStats: (card) => ({
    power: Number(card.power ?? card.cardData?.power ?? 0),
    toughness: Number(card.toughness ?? card.cardData?.toughness ?? 0)
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
          zone: "battlefield",
          index,
          card: player.game.battlefield[index]
        };
      }
    }
    return null;
  },
  locateCard: () => null,
  legalDefenderIds: (room, attackerId) =>
    room.players
      .filter(
        (player) =>
          player.id !== attackerId &&
          !player.game.lost &&
          !player.game.conceded
      )
      .map((player) => player.id),
  dealCreatureDamage: (room, source, target, amount) => {
    target.damageMarked =
      (Number(target.damageMarked) || 0) + Number(amount);
    if (deps.hasKeyword(source, "deathtouch")) {
      target.deathtouchMarked = true;
    }
    room.damageLog.push({
      kind: "creature",
      source: source.id,
      target: target.id,
      amount
    });
  },
  queueSuggestedTriggers: (room, event, context) => {
    room.triggerEvents.push({ event, context });
  },
  resetPriority: (room, playerId) => {
    room.priority = { playerId, passedPlayerIds: [] };
  },
  migrateCard: (card) => JSON.parse(JSON.stringify(card)),
  publicCard: (card) =>
    card ? JSON.parse(JSON.stringify(card)) : null,
  pushStack: (room, item) => {
    const value = { id: deps.createId(), ...item };
    room.stack.push(value);
    return value;
  },
  validateTargets: (_room, targets) => [...targets],
  runStateBasedActions: (room, reason) => {
    room.stateChecks.push(reason);
    return [];
  },
  addLog: (room, text, type) => room.log.push({ text, type })
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
    token: Boolean(extras.token),
    attacking: Boolean(extras.attacking),
    defendingPlayerId: extras.defendingPlayerId || null,
    defendingPermanentId: extras.defendingPermanentId || null,
    blockingCardId: extras.blockingCardId || null,
    summoningSick: Boolean(extras.summoningSick),
    phasedOut: false,
    damageMarked: 0,
    deathtouchMarked: false,
    power: extras.power,
    toughness: extras.toughness,
    counters: extras.counters || {},
    specialState: extras.specialState || {},
    cardData: {
      name,
      typeLine,
      oracleText,
      loyalty: extras.loyalty,
      defense: extras.defense,
      power: extras.power,
      toughness: extras.toughness,
      keywords: extras.keywords || [],
      faces: extras.faces || [],
      imageUrl: ""
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
      lost: false,
      conceded: false,
      extraLoyaltyActivationsV52: 0,
      hand: [],
      library: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: [],
      manaPool: { W:0,U:0,B:0,R:0,G:0,C:0 }
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
    phaseIndex: 5,
    activePlayerId: "p1",
    order: ["p1", "p2", "p3"]
  },
  priority: { playerId: "p1", passedPlayerIds: [] },
  stack: [],
  formsV49: { battleChoices: [] },
  walkersV52: {},
  triggerEvents: [],
  damageLog: [],
  stateChecks: [],
  log: []
};

const walker = makeCard(
  "walker",
  "Test Walker",
  "Legendary Planeswalker — Test",
  "+1: Draw a card.\n−2: Destroy target creature.\n0: Scry 1.",
  {
    ownerId: "p2",
    controllerId: "p2",
    loyalty: "4"
  }
);
p2.game.battlefield.push(walker);

const abilities = _test.parseLoyaltyAbilities(walker, deps);
assert.equal(abilities.length, 3);
assert.deepEqual(
  abilities.map((entry) => entry.costLabel),
  ["+1", "-2", "0"]
);
assert.equal(_test.startingLoyalty(walker, deps), 4);

_test.initializePermanent(room, walker, p2, deps);
assert.equal(_test.loyaltyValue(walker), 4);

const battle = makeCard(
  "battle",
  "Test Siege",
  "Battle — Siege",
  "",
  {
    ownerId: "p1",
    controllerId: "p1",
    defense: "5",
    faces: [
      {
        name: "Test Siege",
        typeLine: "Battle — Siege",
        oracleText: "",
        defense: "5"
      },
      {
        name: "Victory",
        typeLine: "Creature",
        oracleText: "",
        power: "4",
        toughness: "4"
      }
    ]
  }
);
p1.game.battlefield.push(battle);

_test.initializePermanent(room, battle, p1, deps);
assert.equal(_test.defenseValue(battle), 5);
assert.equal(room.walkersV52.choices.length, 1);

battle.specialState.battleProtectorIdV52 = "p2";
room.walkersV52.choices = [];

const targets = _test.legalAttackTargets(room, p1, deps);
assert(
  targets.some(
    (target) =>
      target.kind === "planeswalker" &&
      target.id === "walker"
  )
);
assert(
  targets.some(
    (target) =>
      target.kind === "battle" &&
      target.id === "battle" &&
      target.defendingPlayerId === "p2"
  )
);

const attacker = makeCard(
  "attacker",
  "Attacker",
  "Creature",
  "",
  {
    ownerId: "p1",
    controllerId: "p1",
    power: 3,
    toughness: 3
  }
);
p1.game.battlefield.push(attacker);
assert.equal(_test.legalAttacker(room, p1, attacker, deps), true);

room.turn.phaseIndex = 3;
const ownWalker = makeCard(
  "ownwalker",
  "Own Walker",
  "Planeswalker — Own",
  "+1: Draw a card.\n-3: Destroy target creature.",
  {
    ownerId: "p1",
    controllerId: "p1",
    loyalty: 3
  }
);
p1.game.battlefield.push(ownWalker);
_test.initializePermanent(room, ownWalker, p1, deps);

assert.deepEqual(
  _test.payLoyaltyCost(
    ownWalker,
    _test.parseLoyaltyAbilities(ownWalker, deps)[0],
    {}
  ),
  { success: true, paidAmount: 1 }
);
assert.equal(_test.loyaltyValue(ownWalker), 4);

_test.setLoyalty(ownWalker, 3);
const engine = createWalkerBattleEngine(deps);

let result = engine.processGameAction(
  room,
  p1,
  {
    type: "combat-v52-activate-loyalty",
    cardId: "ownwalker",
    abilityIndex: 1,
    targets: []
  },
  () => ({ success: true })
);
assert.equal(result.success, false);

const victim = makeCard(
  "victim",
  "Victim",
  "Creature",
  "",
  {
    ownerId: "p2",
    controllerId: "p2",
    power: 2,
    toughness: 2
  }
);
p2.game.battlefield.push(victim);

result = engine.processGameAction(
  room,
  p1,
  {
    type: "combat-v52-activate-loyalty",
    cardId: "ownwalker",
    abilityIndex: 1,
    targets: ["card:victim"]
  },
  () => ({ success: true })
);
assert.equal(result.success, true);
assert.equal(_test.loyaltyValue(ownWalker), 0);
assert.equal(room.stack.length, 1);

const second = engine.processGameAction(
  room,
  p1,
  {
    type: "combat-v52-activate-loyalty",
    cardId: "ownwalker",
    abilityIndex: 0,
    targets: []
  },
  () => ({ success: true })
);
assert.equal(second.success, false);

_test.applyDamageToDefendedPermanent(
  room,
  attacker,
  walker,
  3,
  deps
);
assert.equal(_test.loyaltyValue(walker), 1);

_test.setDefense(battle, 2);
_test.applyDamageToDefendedPermanent(
  room,
  attacker,
  battle,
  3,
  deps
);
assert.equal(_test.defenseValue(battle), 0);

const defeated = _test.handleDefeatedBattles(room, deps);
assert.equal(defeated.length, 1);
assert(
  p1.game.exile.some((card) => card.id === "battle")
);
assert.equal(room.formsV49.battleChoices.length, 1);

const targetRequirement = _test.targetRequirement(
  "Destroy target creature."
);
assert.deepEqual(targetRequirement, { minimum: 1, maximum: 1 });

const status = engine.status();
assert.equal(status.success, true);
assert.equal(status.version, "52.0.0");

console.log("Arena planeswalker, Battle and loyalty engine v52 tests passed.");
