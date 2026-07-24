"use strict";

const assert = require("assert");
const {
  createCommanderRulesEngine,
  _test
} = require("../commander-rules-engine");

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
  nowIso: () =>
    "2026-07-24T00:00:00.000Z",
  currentCardFace: (card) =>
    card.cardData?.faces?.[
      card.activeFaceIndex || 0
    ] ||
    card.cardData ||
    {},
  currentTypeLine: (card) =>
    card.cardData?.faces?.[
      card.activeFaceIndex || 0
    ]?.typeLine ||
    card.cardData?.typeLine ||
    "",
  currentOracleText: (card) =>
    card.cardData?.faces?.[
      card.activeFaceIndex || 0
    ]?.oracleText ||
    card.cardData?.oracleText ||
    "",
  isCreatureCard: (card) =>
    /\bCreature\b/i.test(
      deps.currentTypeLine(card)
    ),
  isPermanentCard: (card) =>
    /\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/i
      .test(deps.currentTypeLine(card)),
  effectiveStats: (card) => ({
    power: Number(card.power) || 0,
    toughness: Number(card.toughness) || 0
  }),
  findPlayer: (room, playerId) =>
    room.players.find(
      (player) => player.id === playerId
    ),
  findBattlefieldCard: (room, cardId) => {
    for (const player of room.players) {
      const index =
        player.game.battlefield.findIndex(
          (card) => card.id === cardId
        );
      if (index >= 0) {
        return {
          player,
          card:
            player.game.battlefield[index],
          index,
          zone: "battlefield"
        };
      }
    }
    return null;
  },
  getCardFromZone: (game, zone, cardId) => {
    const cards = game?.[zone];
    if (!Array.isArray(cards)) return null;
    const index = cards.findIndex(
      (card) => card.id === cardId
    );
    return index >= 0
      ? { card: cards[index], index }
      : null;
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
        const index =
          player.game[zone].findIndex(
            (card) => card.id === cardId
          );
        if (index >= 0) {
          return {
            player,
            card: player.game[zone][index],
            zone,
            index
          };
        }
      }
    }
    return null;
  },
  migrateCard: (card) =>
    JSON.parse(JSON.stringify(card)),
  publicCard: (card) =>
    card
      ? JSON.parse(JSON.stringify(card))
      : null,
  resetPriority: (room, playerId) => {
    room.priority = {
      playerId,
      passedPlayerIds: []
    };
  },
  queueSuggestedTriggers: (
    room,
    event,
    context
  ) => {
    room.triggerEvents.push({
      event,
      context
    });
  },
  runStateBasedActions: (
    room,
    reason
  ) => {
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
    ownerId:
      extras.ownerId || "p1",
    controllerId:
      extras.controllerId ||
      extras.ownerId ||
      "p1",
    tapped: Boolean(extras.tapped),
    counters:
      extras.counters || {},
    damageMarked:
      Number(extras.damageMarked) || 0,
    deathtouchMarked: false,
    token: Boolean(extras.token),
    commander:
      Boolean(extras.commander),
    attacking:
      Boolean(extras.attacking),
    defendingPlayerId: null,
    defendingPermanentId: null,
    blockingCardId: null,
    attachedToId: null,
    summoningSick:
      Boolean(extras.summoningSick),
    phasedOut: false,
    faceDown: false,
    temporaryEffects: [],
    ruleEffects: [],
    manualKeywords: [],
    judgeOverrides: {},
    specialState: {},
    power:
      extras.power || "2",
    toughness:
      extras.toughness || "2",
    cardData: {
      name,
      typeLine,
      oracleText,
      manaCost:
        extras.manaCost || "",
      manaValue:
        extras.manaValue || 0,
      power:
        extras.power || "2",
      toughness:
        extras.toughness || "2",
      keywords:
        extras.keywords || [],
      imageUrl: "",
      faces: []
    }
  };
}

function makePlayer(id, isBot = false) {
  return {
    id,
    name: id,
    isBot,
    deck: {
      cards: [],
      commanders: []
    },
    game: {
      life: 40,
      poison: 0,
      commanderTax: 0,
      commanderDamage: {},
      lost: false,
      lossReason: "",
      conceded: false,
      manaPool: {
        W: 0,
        U: 0,
        B: 0,
        R: 0,
        G: 0,
        C: 0
      },
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: [],
      companion: null
    }
  };
}

const p1 = makePlayer("p1");
const p2 = makePlayer("p2");
p1.game.commanderDamage.p2 = 0;
p2.game.commanderDamage.p1 = 0;

const room = {
  players: [p1, p2],
  hostId: "p1",
  format: "commander",
  formatRules: {
    deckSize: 100,
    commanderTaxEnabled: true,
    commanderTaxIncrement: 2,
    commanderDamageEnabled: true,
    commanderDamageThreshold: 21
  },
  settings: {
    allowInvalidDecks: false
  },
  turn: {
    number: 3,
    phaseIndex: 8,
    activePlayerId: "p1"
  },
  priority: {
    playerId: "p1",
    passedPlayerIds: []
  },
  stack: [],
  commanderV55: {},
  triggerEvents: [],
  stateChecks: [],
  log: []
};

const partnerA = makeCard(
  "partner-a",
  "Partner A",
  "Legendary Creature — Human",
  "Partner",
  {
    commander: true
  }
);
const partnerB = makeCard(
  "partner-b",
  "Partner B",
  "Legendary Creature — Elf",
  "Partner",
  {
    commander: true
  }
);
p1.game.commandZone.push(
  partnerA,
  partnerB
);

assert.equal(
  _test.validateCommanderPair(
    [partnerA, partnerB],
    deps
  ).valid,
  true
);

const backgroundLeader = makeCard(
  "leader",
  "Background Leader",
  "Legendary Creature — Human",
  "Choose a Background",
  {
    commander: true
  }
);
const background = makeCard(
  "background",
  "Background",
  "Legendary Enchantment — Background",
  "Commander creatures you own have vigilance.",
  {
    commander: true
  }
);
assert.equal(
  _test.validateCommanderPair(
    [backgroundLeader, background],
    deps
  ).kind,
  "background"
);

const doctor = makeCard(
  "doctor",
  "The Doctor",
  "Legendary Creature — Time Lord Doctor",
  "",
  {
    commander: true
  }
);
const companionCommander = makeCard(
  "doctor-companion",
  "Doctor Friend",
  "Legendary Creature — Human",
  "Doctor's companion",
  {
    commander: true
  }
);
assert.equal(
  _test.validateCommanderPair(
    [doctor, companionCommander],
    deps
  ).kind,
  "doctors-companion"
);

_test.registerCommanders(room, deps);
assert.equal(
  Object.keys(
    room.commanderV55.registry
  ).length,
  2
);

let record = _test.taxRecord(
  room,
  partnerA,
  deps
);
assert.equal(record.tax, 0);

const castAction = {
  type: "auto-cast-card",
  fromZone: "commandZone",
  cardId: partnerA.id
};

const engine =
  createCommanderRulesEngine(deps);

let legacyTaxSeen = -1;
let result = engine.processGameAction(
  room,
  p1,
  castAction,
  (testRoom, actor) => {
    legacyTaxSeen =
      actor.game.commanderTax;
    const index =
      actor.game.commandZone.findIndex(
        (card) => card.id === partnerA.id
      );
    const [card] =
      actor.game.commandZone.splice(
        index,
        1
      );
    testRoom.stack.push({
      id: "cast-stack",
      kind: "spell",
      sourceCardId: card.id,
      controllerId: actor.id,
      card
    });
    return { success: true };
  }
);
assert.equal(result.success, true);
assert.equal(legacyTaxSeen, 0);
assert.equal(
  room.commanderV55
    .taxByCommander[partnerA.id]
    .castsFromCommandZone,
  1
);
assert.equal(
  room.commanderV55
    .taxByCommander[partnerA.id]
    .tax,
  2
);
assert.equal(
  room.commanderV55
    .taxByCommander[partnerB.id]
    .tax,
  0
);

room.stack = [];
p1.game.battlefield.push(partnerA);
partnerA.attacking = true;
room.turn.phaseIndex = 8;

engine.playerDamage(
  room,
  partnerA,
  p2,
  11,
  (_testRoom, _source, target, amount) => {
    target.game.life -= amount;
    return amount;
  }
);
engine.playerDamage(
  room,
  partnerA,
  p2,
  10,
  (_testRoom, _source, target, amount) => {
    target.game.life -= amount;
    return amount;
  }
);
assert.equal(
  room.commanderV55
    .damageByPlayer.p2[partnerA.id],
  21
);
assert.equal(p2.game.lost, true);

p2.game.lost = false;
p2.game.lossReason = "";
p2.game.life = 40;
partnerA.attacking = false;

const before =
  _test.snapshotCommanderLocations(room);

const battlefieldIndex =
  p1.game.battlefield.findIndex(
    (card) => card.id === partnerA.id
  );
const [movedCommander] =
  p1.game.battlefield.splice(
    battlefieldIndex,
    1
  );
p1.game.graveyard.push(
  movedCommander
);

_test.scanCommanderTransitions(
  room,
  before,
  deps
);
assert.equal(
  room.commanderV55.choices.length,
  1
);

const choice =
  room.commanderV55.choices[0];
result = _test.resolveZoneChoice(
  room,
  p1,
  {
    choiceId: choice.id,
    moveToCommandZone: true
  },
  () => ({ success: true }),
  deps
);
assert.equal(result.success, true);
assert(
  p1.game.commandZone.some(
    (card) => card.id === partnerA.id
  )
);

const lurrusData = {
  name: "Lurrus of the Dream-Den",
  typeLine:
    "Legendary Creature — Cat Nightmare",
  oracleText:
    "Companion — Each permanent card in your starting deck has mana value 2 or less.",
  manaCost: "{1}{W/B}{W/B}",
  manaValue: 3,
  power: "3",
  toughness: "2",
  keywords: ["Companion"]
};

p1.deck.cards = [
  {
    name: "Lurrus of the Dream-Den",
    quantity: 1,
    cardData: lurrusData
  },
  {
    name: "Small Creature",
    quantity: 1,
    cardData: {
      name: "Small Creature",
      typeLine: "Creature",
      oracleText: "",
      manaCost: "{1}",
      manaValue: 1
    }
  },
  {
    name: "Basic Land",
    quantity: 98,
    cardData: {
      name: "Basic Land",
      typeLine: "Basic Land — Plains",
      oracleText: "",
      manaCost: "",
      manaValue: 0
    }
  }
];

const validation =
  _test.validateCompanion(
    room,
    p1,
    "Lurrus of the Dream-Den"
  );
assert.equal(validation.valid, true);

result = _test.designateCompanion(
  room,
  p1,
  {
    name:
      "Lurrus of the Dream-Den"
  },
  deps
);
assert.equal(result.success, true);
assert.equal(
  p1.game.companion.name,
  "Lurrus of the Dream-Den"
);

p1.game.manaPool.C = 3;
room.turn.phaseIndex = 3;
room.turn.activePlayerId = "p1";
room.priority.playerId = "p1";

result = _test.takeCompanion(
  room,
  p1,
  deps
);
assert.equal(result.success, true);
assert.equal(
  p1.game.companion,
  null
);
assert(
  p1.game.hand.some(
    (card) =>
      card.name ===
      "Lurrus of the Dream-Den"
  )
);
assert.equal(
  room.commanderV55
    .companionTaken.p1,
  true
);

const status = engine.status();
assert.equal(status.success, true);
assert.equal(status.version, "55.0.0");

console.log(
  "Arena complete Commander rules engine v55 tests passed."
);
