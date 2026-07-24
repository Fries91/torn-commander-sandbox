"use strict";

const assert = require("assert");
const {
  createCastingMechanicsEngine,
  _test
} = require("../casting-mechanics-engine");

let nextId = 0;

const deps = {
  PHASES: [
    "Untap", "Upkeep", "Draw", "Main 1",
    "Beginning Combat", "Declare Attackers", "Declare Blockers",
    "First-Strike Damage", "Combat Damage", "End Combat",
    "Main 2", "End", "Cleanup"
  ],
  createId: () => `id-${++nextId}`,
  nowIso: () => "2026-07-24T00:00:00.000Z",
  currentCardFace: (card) => card.cardData || {},
  currentTypeLine: (card) => card.cardData?.typeLine || "",
  currentOracleText: (card) =>
    card.judgeOverrides?.oracleText ||
    card.cardData?.oracleText ||
    "",
  isCreatureCard: (card) =>
    /\bCreature\b/i.test(card.cardData?.typeLine || ""),
  findPlayer: (room, playerId) =>
    room.players.find((player) => player.id === playerId),
  getCardFromZone: (game, zone, cardId) => {
    const index = game[zone].findIndex((card) => card.id === cardId);
    return index < 0 ? null : { card: game[zone][index], index };
  },
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
  publicCard: (card) => card ? JSON.parse(JSON.stringify(card)) : null,
  resetPriority: (room, playerId) => {
    room.priority = { playerId, passedPlayerIds: [] };
  },
  queueSuggestedTriggers: (room, event, context) => {
    room.triggerEvents.push({ event, context });
  },
  addLog: (room, text, type) => room.log.push({ text, type })
};

function card(id, name, typeLine, manaCost, oracleText, extras = {}) {
  return {
    id,
    name,
    ownerId: extras.ownerId || "p1",
    controllerId: extras.controllerId || extras.ownerId || "p1",
    tapped: false,
    token: Boolean(extras.token),
    power: extras.power,
    specialState: {},
    judgeOverrides: {},
    cardData: {
      name,
      typeLine,
      manaCost,
      oracleText,
      manaValue: extras.manaValue,
      imageUrl: ""
    }
  };
}

function player(id) {
  return {
    id,
    name: id,
    game: {
      life: 40,
      manaPool: { W:0,U:0,B:0,R:0,G:0,C:0 },
      hand: [],
      library: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: []
    }
  };
}

const p1 = player("p1");
const p2 = player("p2");
const room = {
  players: [p1, p2],
  hostId: "p1",
  turn: {
    number: 3,
    phaseIndex: 3,
    activePlayerId: "p1",
    order: ["p1", "p2"]
  },
  rules: {},
  stack: [],
  triggerEvents: [],
  log: [],
  playPermissions: [],
  priority: { playerId: "p1", passedPlayerIds: [] },
  castingV50: {}
};

const mechanicsCard = card(
  "mechanics",
  "Mechanics Spell",
  "Instant — Arcane",
  "{4}{U}",
  [
    "Foretell {1}{U}",
    "Suspend 3—{U}",
    "Miracle {U}",
    "Madness {2}{U}",
    "Casualty 2",
    "Bargain",
    "Cleave {2}{U}",
    "Entwine {1}",
    "Escalate {1}",
    "Affinity for artifacts"
  ].join("\n")
);

assert.deepEqual(_test.parseForetell(mechanicsCard), { manaCost: "{1}{U}" });
assert.deepEqual(_test.parseSuspend(mechanicsCard), {
  timeCounters: 3,
  manaCost: "{U}"
});
assert.deepEqual(_test.parseMiracle(mechanicsCard), { manaCost: "{U}" });
assert.deepEqual(_test.parseMadness(mechanicsCard), { manaCost: "{2}{U}" });
assert.deepEqual(_test.parseCasualty(mechanicsCard), { minimumPower: 2 });
assert.equal(_test.hasBargain(mechanicsCard), true);
assert.deepEqual(_test.parseCleave(mechanicsCard), { manaCost: "{2}{U}" });
assert.deepEqual(_test.parseEntwine(mechanicsCard), { manaCost: "{1}" });
assert.deepEqual(_test.parseEscalate(mechanicsCard), {
  kind: "mana",
  manaCost: "{1}"
});
assert.deepEqual(_test.parseAffinity(mechanicsCard), {
  quality: "artifacts"
});

const splice = card(
  "splice",
  "Splice Spell",
  "Instant — Arcane",
  "{1}{R}",
  "Splice onto Arcane {R}\nSplice effect."
);
assert.deepEqual(_test.parseSplice(splice), {
  subtype: "Arcane",
  manaCost: "{R}"
});

const offering = card(
  "offering",
  "Offering Spell",
  "Creature — Spirit",
  "{6}{U}",
  "Moonfolk offering"
);
assert.deepEqual(_test.parseOffering(offering), {
  subtype: "Moonfolk",
  manaCost: "{6}{U}"
});

const emerge = card(
  "emerge",
  "Emerge Spell",
  "Creature — Eldrazi",
  "{8}",
  "Emerge {5}{U}{U}"
);
assert.deepEqual(_test.parseEmerge(emerge), {
  permanentType: "creature",
  manaCost: "{5}{U}{U}"
});

assert.equal(
  _test.removeBracketedText("Return target [nonland] permanent."),
  "Return target permanent."
);

p1.game.hand.push(mechanicsCard, splice);
p1.game.battlefield.push(
  card("artifact", "Artifact", "Artifact", "{2}", "", { manaValue: 2 }),
  card("victim", "Victim", "Creature", "{3}", "", {
    manaValue: 3,
    power: 3
  })
);

assert.equal(
  _test.affinityCount(
    p1,
    _test.parseAffinity(mechanicsCard),
    deps
  ),
  1
);

const plan = _test.buildCastPlan(
  p1,
  mechanicsCard,
  {
    cleave: true,
    entwine: true,
    modes: ["one", "two"],
    spliceCardIds: ["splice"]
  },
  deps
);
assert.equal(plan.alternative, "cleave");
assert.equal(plan.entwined, true);
assert.equal(plan.affinityReduction, 1);
assert(plan.oracleText.includes("Splice effect."));
assert.equal(plan.effectiveManaCost, "{3}{U}{R}");

const before = {
  p1: {
    handIds: new Set(p1.game.hand.map((entry) => entry.id)),
    libraryIds: ["miracle"]
  },
  p2: {
    handIds: new Set(),
    libraryIds: []
  }
};
const miracle = card(
  "miracle",
  "Miracle Spell",
  "Sorcery",
  "{6}{U}",
  "Miracle {1}{U}"
);
p1.game.hand.push(miracle);
const created = _test.scanDraws(room, before, true, deps);
assert.equal(created.length, 1);
assert.equal(room.castingV50.choices[0].kind, "miracle");

room.castingV50.choices = [];
const suspendCard = card(
  "suspended",
  "Suspended Spell",
  "Creature",
  "{4}",
  "Suspend 1—{R}"
);
suspendCard.counters = { time: 1 };
p1.game.exile.push(suspendCard);
room.castingV50.suspended.push({
  id: "s1",
  status: "waiting",
  playerId: "p1",
  cardId: "suspended",
  cardName: "Suspended Spell",
  timeCounters: 1
});
room.turn.phaseIndex = deps.PHASES.indexOf("Upkeep");
room.castingV50.lastUpkeepKey = "";
const ready = _test.upkeepTimedCards(room, deps);
assert.equal(ready.length, 1);
assert.equal(suspendCard.counters.time, 0);

const engine = createCastingMechanicsEngine(deps);
const preview = engine.preview(room, p1, {
  cardId: "mechanics",
  fromZone: "hand"
});
assert.equal(preview.success, true);
assert.equal(preview.affinityReduction, 1);

console.log("Arena remaining casting mechanics engine v50 tests passed.");
