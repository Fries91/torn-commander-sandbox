"use strict";

const assert = require("assert");
const {
  createAttachmentRulesEngine,
  _test
} = require("../attachment-rules-engine");

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
      ...(card.manualKeywords || []),
      ...(card.temporaryEffects || [])
        .map((effect) => effect.keyword)
        .filter(Boolean)
    ].map((entry) => String(entry).toLowerCase());

    return values.includes(String(keyword).toLowerCase()) ||
      new RegExp(`\\b${String(keyword)}\\b`, "i")
        .test(deps.currentOracleText(card));
  },
  effectiveStats: (card) => {
    const power = Number(card.power ?? card.cardData?.power);
    const toughness = Number(card.toughness ?? card.cardData?.toughness);
    if (!Number.isFinite(power) || !Number.isFinite(toughness)) return null;

    const effects = card.temporaryEffects || [];
    return {
      power:
        power +
        effects.reduce(
          (sum, effect) => sum + (Number(effect.power) || 0),
          0
        ),
      toughness:
        toughness +
        effects.reduce(
          (sum, effect) => sum + (Number(effect.toughness) || 0),
          0
        )
    };
  },
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
  getCardFromZone: (game, zone, cardId) => {
    const index = game[zone].findIndex(
      (card) => card.id === cardId
    );
    return index >= 0
      ? { card: game[zone][index], index }
      : null;
  },
  locateCard: () => null,
  publicCard: (card) =>
    card ? JSON.parse(JSON.stringify(card)) : null,
  pushStack: (room, item) => {
    const value = { id: deps.createId(), ...item };
    room.stack.push(value);
    return value;
  },
  resetPriority: (room, playerId) => {
    room.priority = { playerId, passedPlayerIds: [] };
  },
  queueSuggestedTriggers: (room, event, context) => {
    room.triggerEvents.push({ event, context });
  },
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
    phasedOut: false,
    token: Boolean(extras.token),
    commander: Boolean(extras.commander),
    summoningSick: Boolean(extras.summoningSick),
    attachedToId: extras.attachedToId || null,
    temporaryEffects: [],
    manualKeywords: [],
    specialState: {},
    power: extras.power,
    toughness: extras.toughness,
    cardData: {
      name,
      typeLine,
      oracleText,
      manaCost: extras.manaCost || "",
      power: extras.power,
      toughness: extras.toughness,
      keywords: extras.keywords || [],
      faces: extras.faces || [],
      imageUrl: ""
    }
  };
}

function makePlayer(id) {
  return {
    id,
    name: id,
    game: {
      life: 40,
      lost: false,
      conceded: false,
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

const p1 = makePlayer("p1");
const p2 = makePlayer("p2");

const room = {
  players: [p1, p2],
  hostId: "p1",
  turn: {
    number: 4,
    phaseIndex: 3,
    activePlayerId: "p1",
    order: ["p1", "p2"]
  },
  priority: { playerId: "p1", passedPlayerIds: [] },
  stack: [],
  attachmentsV53: {},
  triggerEvents: [],
  stateChecks: [],
  log: []
};

const creature = makeCard(
  "creature",
  "Creature",
  "Creature — Human",
  "",
  {
    power: 2,
    toughness: 2
  }
);
const opponentCreature = makeCard(
  "opponent",
  "Opponent Creature",
  "Creature — Elf",
  "",
  {
    ownerId: "p2",
    controllerId: "p2",
    power: 3,
    toughness: 3
  }
);
p1.game.battlefield.push(creature);
p2.game.battlefield.push(opponentCreature);

const aura = makeCard(
  "aura",
  "Flight Aura",
  "Enchantment — Aura",
  "Enchant creature you control\nEnchanted creature gets +1/+2 and has flying."
);
p1.game.hand.push(aura);

assert.equal(_test.isAura(aura, deps), true);
assert.deepEqual(_test.parseEnchant(aura, deps), {
  phrase: "creature you control",
  lower: "creature you control",
  zone: "battlefield",
  player: false,
  creature: true,
  artifact: false,
  enchantment: false,
  land: false,
  planeswalker: false,
  battle: false,
  permanent: false,
  nonland: false,
  noncreature: false,
  youControl: true,
  opponentControls: false,
  tapped: false,
  untapped: false
});
assert.equal(
  _test.auraTargetLegal(
    room,
    "p1",
    aura,
    "card:creature",
    deps
  ),
  true
);
assert.equal(
  _test.auraTargetLegal(
    room,
    "p1",
    aura,
    "card:opponent",
    deps
  ),
  false
);

const equipment = makeCard(
  "equipment",
  "Sword",
  "Artifact — Equipment",
  "Equipped creature gets +2/+1 and has vigilance.\nEquip {2}"
);
p1.game.battlefield.push(equipment);

assert.deepEqual(_test.parseEquip(equipment, deps), {
  manaCost: "{2}",
  qualifier: ""
});
assert.equal(
  _test.activationTargetLegal(
    room,
    "p1",
    equipment,
    creature,
    "equip",
    deps
  ),
  true
);

let result = _test.attachCard(
  room,
  equipment,
  "card:creature",
  "equip",
  deps
);
assert.equal(result.success, true);
assert.equal(equipment.attachedToId, "creature");
assert.deepEqual(deps.effectiveStats(creature), {
  power: 4,
  toughness: 3
});
assert.equal(deps.hasKeyword(creature, "vigilance"), true);

const fortification = makeCard(
  "fort",
  "Fort",
  "Artifact — Fortification",
  "Fortified land has indestructible.\nFortify {3}"
);
const land = makeCard(
  "land",
  "Land",
  "Land — Forest",
  ""
);
p1.game.battlefield.push(fortification, land);
assert.deepEqual(_test.parseFortify(fortification, deps), {
  manaCost: "{3}",
  qualifier: ""
});
assert.equal(
  _test.activationTargetLegal(
    room,
    "p1",
    fortification,
    land,
    "fortify",
    deps
  ),
  true
);

const vehicle = makeCard(
  "vehicle",
  "Vehicle",
  "Artifact — Vehicle",
  "Crew 3",
  {
    power: 4,
    toughness: 4
  }
);
p1.game.battlefield.push(vehicle);
assert.deepEqual(_test.parseCrew(vehicle, deps), { power: 3 });
_test.setVehicleCreatureType(vehicle, true);
assert(/\bCreature\b/i.test(deps.currentTypeLine(vehicle)));
_test.setVehicleCreatureType(vehicle, false);
assert(!/\bCreature\b/i.test(deps.currentTypeLine(vehicle)));

const mount = makeCard(
  "mount",
  "Mount",
  "Creature — Horse Mount",
  "Saddle 2",
  {
    power: 3,
    toughness: 3
  }
);
p1.game.battlefield.push(mount);
assert.deepEqual(_test.parseSaddle(mount, deps), { power: 2 });

const reconfigure = makeCard(
  "reconfigure",
  "Reconfigure",
  "Artifact Creature — Equipment",
  "Reconfigure {1}",
  {
    power: 2,
    toughness: 2
  }
);
p1.game.battlefield.push(reconfigure);
assert.deepEqual(_test.parseReconfigure(reconfigure, deps), {
  manaCost: "{1}",
  qualifier: ""
});
_test.setReconfiguredType(reconfigure, true);
assert(!/\bCreature\b/i.test(deps.currentTypeLine(reconfigure)));
_test.setReconfiguredType(reconfigure, false);
assert(/\bCreature\b/i.test(deps.currentTypeLine(reconfigure)));

assert.equal(
  _test.totalSelectedPower(
    [creature, opponentCreature],
    deps
  ),
  7
);

aura.controllerId = "p1";
p1.game.hand = p1.game.hand.filter((card) => card.id !== "aura");
p1.game.battlefield.unshift(aura);
result = _test.attachCard(
  room,
  aura,
  "card:creature",
  "aura",
  deps
);
assert.equal(result.success, true);
assert.equal(aura.attachedToId, "creature");

p1.game.battlefield = p1.game.battlefield.filter(
  (card) => card.id !== "creature"
);
_test.enforceAttachmentState(room, deps);
assert(
  p1.game.graveyard.some((card) => card.id === "aura")
);
assert.equal(equipment.attachedToId, null);

const stackItem = {
  id: "crew-stack"
};
room.attachmentsV53.stackMeta = {
  "crew-stack": {
    kind: "crew",
    sourceCardId: "vehicle",
    controllerId: "p1"
  }
};
assert.equal(
  _test.resolveStackMeta(room, stackItem, deps),
  true
);
assert.equal(vehicle.specialState.crewedV53, true);

const engine = createAttachmentRulesEngine(deps);
const status = engine.status();
assert.equal(status.success, true);
assert.equal(status.version, "53.0.0");

console.log("Arena attachments, Vehicles and Mounts engine v53 tests passed.");
