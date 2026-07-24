"use strict";

const assert = require("assert");
const {
  createPermanentFormsEngine,
  _test
} = require("../permanent-forms-engine");

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
  currentTypeLine: (card) =>
    card.judgeOverrides?.typeLine ||
    card.cardData?.faces?.[card.activeFaceIndex || 0]?.typeLine ||
    card.cardData?.typeLine ||
    "",
  currentOracleText: (card) =>
    card.judgeOverrides?.oracleText ||
    card.cardData?.faces?.[card.activeFaceIndex || 0]?.oracleText ||
    card.cardData?.oracleText ||
    "",
  isCreatureCard: (card) =>
    /\bCreature\b/i.test(
      deps.currentTypeLine(card)
    ),
  findPlayer: (room, playerId) =>
    room.players.find((player) => player.id === playerId),
  getCardFromZone: (game, zone, cardId) => {
    const index = game[zone].findIndex((card) => card.id === cardId);
    return index < 0
      ? null
      : { card: game[zone][index], index };
  },
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
        const index = player.game[zone].findIndex(
          (card) => card.id === cardId
        );
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
  migrateCard: (card) => JSON.parse(JSON.stringify(card)),
  publicCard: (card) => JSON.parse(JSON.stringify(card)),
  pushStack: (room, item) => {
    const value = { id: deps.createId(), ...item };
    room.stack.push(value);
    return value;
  },
  queueSuggestedTriggers: (room, event, context) => {
    room.triggerEvents.push({ event, context });
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
    controllerId: extras.controllerId || extras.ownerId || "p1",
    tapped: false,
    faceDown: false,
    counters: {},
    specialState: {},
    judgeOverrides: {},
    cardData: {
      name,
      typeLine,
      oracleText,
      manaCost: extras.manaCost || "",
      layout: extras.layout || "normal",
      faces: extras.faces || [],
      defense: extras.defense,
      imageUrl: ""
    }
  };
}

function makePlayer(id, name) {
  return {
    id,
    name,
    game: {
      life: 40,
      manaPool: { W:0,U:0,B:0,R:0,G:0,C:0 },
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
const room = {
  players: [p1, p2],
  hostId: "p1",
  turn: {
    number: 3,
    phaseIndex: 3,
    activePlayerId: "p1",
    order: ["p1", "p2"]
  },
  rules: { dayNight: null },
  playPermissions: [],
  stack: [],
  triggerQueue: [],
  triggerEvents: [],
  log: [],
  formsV49: {}
};

const mdfc = makeCard(
  "mdfc",
  "Pathway",
  "Land",
  "",
  {
    layout: "modal_dfc",
    faces: [
      {
        name: "Bright Pathway",
        typeLine: "Land",
        oracleText: "{T}: Add {W}.",
        manaCost: ""
      },
      {
        name: "Dark Pathway",
        typeLine: "Land",
        oracleText: "{T}: Add {B}.",
        manaCost: ""
      }
    ]
  }
);
assert.equal(_test.cardFaces(mdfc).length, 2);
assert.equal(_test.setFace(mdfc, 1), true);
assert.equal(mdfc.activeFaceIndex, 1);
assert(
  _test.faceOptions(mdfc, deps).some(
    (option) => option.id === "face:1"
  )
);

const prototype = makeCard(
  "proto",
  "Prototype Creature",
  "Artifact Creature",
  "Prototype {1}{U} — 2/2",
  { manaCost: "{5}{U}" }
);
assert.deepEqual(_test.parsePrototype(prototype, deps), {
  manaCost: "{1}{U}",
  power: "2",
  toughness: "2"
});

const morph = makeCard(
  "morph",
  "Morph Creature",
  "Creature",
  "Morph {2}{G}"
);
assert.deepEqual(_test.parseMorph(morph), {
  kind: "morph",
  manaCost: "{2}{G}"
});

const mutate = makeCard(
  "mutate",
  "Mutate Creature",
  "Creature — Beast",
  "Mutate {1}{G}"
);
assert.deepEqual(_test.parseMutate(mutate), {
  manaCost: "{1}{G}"
});

const saga = makeCard(
  "saga",
  "Test Saga",
  "Enchantment — Saga",
  "I — Draw a card.\nII, III — Create a token."
);
const chapters = _test.parseSagaChapters(saga, deps);
assert.equal(chapters.length, 2);
assert.deepEqual(chapters[1].numbers, [2, 3]);
assert.equal(_test.finalSagaChapter(saga, deps), 3);

p1.game.battlefield.push(saga);
_test.initializePermanent(room, saga, p1, deps);
assert.equal(saga.counters.lore, 1);
assert.equal(room.stack.length, 1);

room.turn.phaseIndex = deps.PHASES.indexOf("Main 1");
room.formsV49.lastSagaAdvanceKey = "";
_test.advanceSagasAtMainOne(room, deps);
assert.equal(saga.counters.lore, 2);

const battle = makeCard(
  "battle",
  "Test Battle",
  "Battle — Siege",
  "",
  {
    defense: 3,
    layout: "transform",
    faces: [
      {
        name: "Test Battle",
        typeLine: "Battle — Siege",
        oracleText: "",
        defense: 3
      },
      {
        name: "Victory Creature",
        typeLine: "Creature",
        oracleText: "",
        manaCost: "{4}"
      }
    ]
  }
);
p1.game.battlefield.push(battle);
_test.initializePermanent(room, battle, p1, deps);
assert.equal(battle.counters.defense, 3);
battle.counters.defense = 0;
_test.checkBattles(room, deps);
assert.equal(
  room.formsV49.battleChoices.length,
  1
);
assert(
  p1.game.exile.some((card) => card.id === "battle")
);

let result = _test.resolveBattleChoice(
  room,
  p1,
  {
    choiceId: room.formsV49.battleChoices[0].id,
    castBackFace: true
  },
  deps
);
assert.equal(result.success, true);
assert(
  room.playPermissions.some(
    (permission) =>
      permission.cardId === "battle" &&
      permission.freeCast
  )
);

const adventure = makeCard(
  "adventure",
  "Adventure Card",
  "Creature",
  "",
  {
    layout: "adventure",
    faces: [
      {
        name: "Adventure Creature",
        typeLine: "Creature",
        oracleText: "",
        manaCost: "{2}{G}"
      },
      {
        name: "Journey",
        typeLine: "Sorcery — Adventure",
        oracleText: "Draw a card.",
        manaCost: "{1}{G}"
      }
    ]
  }
);
adventure.specialState.adventureCast = {
  faceIndex: 1,
  permanentFaceIndex: 0
};
p1.game.graveyard.push(adventure);
result = _test.moveAdventureToExile(
  room,
  {
    controllerId: "p1",
    card: adventure,
    name: "Journey"
  },
  deps
);
assert.equal(result, true);
assert(
  p1.game.exile.some((card) => card.id === "adventure")
);
assert(
  room.playPermissions.some(
    (permission) =>
      permission.cardId === "adventure" &&
      permission.kind === "adventure"
  )
);

const dayCard = makeCard(
  "day",
  "Day Creature",
  "Creature",
  "Daybound",
  {
    layout: "transform",
    faces: [
      {
        name: "Day Creature",
        typeLine: "Creature",
        oracleText: "Daybound"
      },
      {
        name: "Night Creature",
        typeLine: "Creature",
        oracleText: "Nightbound"
      }
    ]
  }
);
p1.game.battlefield.push(dayCard);
room.rules.dayNight = "day";
room.turn.number = 7;
room.turn.phaseIndex = deps.PHASES.indexOf("Upkeep");
room.turn.activePlayerId = "p1";
room.formsV49.lastDayNightCheckTurn = 0;
_test.checkDayNightAtUpkeep(room, deps);
assert.equal(room.rules.dayNight, "night");
assert.equal(dayCard.activeFaceIndex, 1);

_test.incrementSpellCount(room, "p1");
_test.incrementSpellCount(room, "p1");
room.turn.number = 8;
room.turn.phaseIndex = deps.PHASES.indexOf("Upkeep");
room.formsV49.lastDayNightCheckTurn = 0;
_test.checkDayNightAtUpkeep(room, deps);
assert.equal(room.rules.dayNight, "day");
assert.equal(dayCard.activeFaceIndex, 0);

const engine = createPermanentFormsEngine(deps);
const preview = engine.preview(
  room,
  p1,
  {
    cardId: "mdfc",
    fromZone: "hand"
  }
);
assert.equal(preview.success, false);

console.log("Arena card faces and permanent forms engine v49 tests passed.");
