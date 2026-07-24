"use strict";

const assert = require("assert");
const {
  createReplacementRulesEngine,
  _test
} = require("../replacement-rules-engine");

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
  findPlayer: (room, playerId) =>
    room.players.find(
      (player) =>
        player.id === playerId
    ),
  findBattlefieldCard: (
    room,
    cardId
  ) => {
    for (const player of room.players) {
      const index =
        player.game.battlefield
          .findIndex(
            (card) =>
              card.id === cardId
          );

      if (index >= 0) {
        return {
          player,
          card:
            player.game
              .battlefield[index],
          index,
          zone: "battlefield"
        };
      }
    }

    return null;
  },
  publicCard: (card) =>
    card
      ? JSON.parse(
          JSON.stringify(card)
        )
      : null,
  addLog: (room, text, type) => {
    room.log.push({
      text,
      type
    });
  }
};

function makePlayer(id) {
  return {
    id,
    name: id,
    game: {
      life: 40,
      lost: false,
      conceded: false,
      battlefield: []
    }
  };
}

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
    attacking:
      Boolean(extras.attacking),
    commander: false,
    tapped: false,
    counters: {},
    damageMarked: 0,
    temporaryEffects: [],
    ruleEffects: [],
    manualKeywords: [],
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
      colors:
        extras.colors || [],
      colorIdentity:
        extras.colorIdentity || [],
      keywords:
        extras.keywords || [],
      power:
        extras.power || "2",
      toughness:
        extras.toughness || "2",
      faces: []
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
    phaseIndex: 8,
    activePlayerId: "p1"
  },
  replacementV57: {},
  log: []
};

const protector = makeCard(
  "protector",
  "Protector",
  "Creature — Cleric",
  "If a source would deal damage to you or a permanent you control, prevent 1 of that damage.",
  {
    ownerId: "p1",
    controllerId: "p1"
  }
);
p1.game.battlefield.push(protector);

const doubler = makeCard(
  "doubler",
  "Doubler",
  "Enchantment",
  "If a source you control would deal damage to an opponent or a permanent an opponent controls, it deals double that damage instead.",
  {
    ownerId: "p1",
    controllerId: "p1"
  }
);
p1.game.battlefield.push(doubler);

const redSource = makeCard(
  "red-source",
  "Red Source",
  "Creature — Warrior",
  "",
  {
    ownerId: "p1",
    controllerId: "p1",
    attacking: true,
    colors: ["R"]
  }
);
p1.game.battlefield.push(redSource);

const protectedCreature = makeCard(
  "protected",
  "Protected Creature",
  "Creature — Knight",
  "Protection from red",
  {
    ownerId: "p2",
    controllerId: "p2",
    power: "2",
    toughness: "2"
  }
);
p2.game.battlefield.push(
  protectedCreature
);

const parsed =
  _test.parseStaticEffects(
    room,
    deps
  );

assert(
  parsed.some(
    (effect) =>
      effect.kind ===
      "prevent-fixed"
  )
);
assert(
  parsed.some(
    (effect) =>
      effect.kind ===
      "multiply"
  )
);

assert.equal(
  _test.protectionApplies(
    protectedCreature,
    redSource,
    deps
  ),
  true
);

const playerLegacy = (
  _room,
  _source,
  target,
  amount
) => {
  target.game.life -= amount;
  return amount;
};

const permanentLegacy = (
  _room,
  _source,
  target,
  amount
) => {
  target.damageMarked += amount;
  return amount;
};

let dealt =
  _test.processDamageEvent(
    room,
    redSource,
    p2,
    "player",
    5,
    playerLegacy,
    permanentLegacy,
    deps
  );

assert.equal(dealt, 10);
assert.equal(p2.game.life, 30);

dealt =
  _test.processDamageEvent(
    room,
    redSource,
    protectedCreature,
    "permanent",
    4,
    playerLegacy,
    permanentLegacy,
    deps
  );

assert.equal(dealt, 0);
assert.equal(
  protectedCreature.damageMarked,
  0
);

let result =
  _test.createShield(
    room,
    p1,
    {
      kind: "prevent-fixed",
      targetKey: "player:p1",
      amount: 3,
      sourceFilter: "any",
      expires: "game",
      oneUse: true,
      label: "Prevent three"
    },
    deps
  );

assert.equal(result.success, true);

const manualPreventId =
  result.shieldId;

result =
  _test.createShield(
    room,
    p1,
    {
      kind: "multiply",
      targetKey: "player:p1",
      multiplier: 2,
      sourceFilter: "any",
      expires: "game",
      oneUse: true,
      label: "Double incoming"
    },
    deps
  );

assert.equal(result.success, true);

const manualMultiplyId =
  result.shieldId;

_test.savePreferences(
  room,
  p1,
  {
    order: [
      manualMultiplyId,
      manualPreventId
    ]
  },
  deps
);

p1.game.life = 40;

dealt =
  _test.processDamageEvent(
    room,
    redSource,
    p1,
    "player",
    5,
    playerLegacy,
    permanentLegacy,
    deps
  );

assert.equal(dealt, 6);
assert.equal(p1.game.life, 34);

const redirectCreature = makeCard(
  "redirect-creature",
  "Redirect Creature",
  "Creature — Wall",
  "",
  {
    ownerId: "p1",
    controllerId: "p1",
    power: "0",
    toughness: "8"
  }
);
p1.game.battlefield.push(
  redirectCreature
);

result =
  _test.createShield(
    room,
    p1,
    {
      kind: "redirect-all",
      targetKey: "player:p1",
      redirectTargetKey:
        "card:redirect-creature",
      sourceFilter: "any",
      expires: "game",
      oneUse: true,
      label: "Redirect to Wall"
    },
    deps
  );

assert.equal(result.success, true);
p1.game.life = 40;

dealt =
  _test.processDamageEvent(
    room,
    redSource,
    p1,
    "player",
    4,
    playerLegacy,
    permanentLegacy,
    deps
  );

assert.equal(dealt, 0);
assert.equal(p1.game.life, 40);
assert.equal(
  redirectCreature.damageMarked,
  3
);

const unpreventable = makeCard(
  "unpreventable",
  "Unpreventable",
  "Instant",
  "Damage dealt by Unpreventable can't be prevented.",
  {
    ownerId: "p2",
    controllerId: "p2",
    colors: ["R"]
  }
);

result =
  _test.createShield(
    room,
    p1,
    {
      kind: "prevent-all",
      targetKey: "player:p1",
      sourceFilter: "any",
      expires: "game",
      oneUse: true
    },
    deps
  );
assert.equal(result.success, true);

p1.game.life = 40;

dealt =
  _test.processDamageEvent(
    room,
    unpreventable,
    p1,
    "player",
    6,
    playerLegacy,
    permanentLegacy,
    deps
  );

assert.equal(dealt, 6);
assert.equal(p1.game.life, 34);

const engine =
  createReplacementRulesEngine(
    deps
  );
const status =
  engine.status();

assert.equal(status.success, true);
assert.equal(
  status.version,
  "57.0.0"
);

console.log(
  "Arena replacement, prevention and redirection engine v57 tests passed."
);
