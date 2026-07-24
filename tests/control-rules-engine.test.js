"use strict";

const assert = require("assert");
const {
  createControlRulesEngine,
  _test
} = require("../control-rules-engine");

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
  createId: () =>
    `id-${++nextId}`,
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
      library: [],
      hand: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: []
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
    tapped: Boolean(extras.tapped),
    counters:
      extras.counters || {},
    damageMarked: 0,
    token: Boolean(extras.token),
    commander: false,
    attacking:
      Boolean(extras.attacking),
    defendingPlayerId:
      extras.defendingPlayerId || null,
    defendingPermanentId: null,
    blockingCardId:
      extras.blockingCardId || null,
    attachedToId:
      extras.attachedToId || null,
    summoningSick: false,
    phasedOut: false,
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
      power:
        extras.power || "2",
      toughness:
        extras.toughness || "2",
      keywords:
        extras.keywords || [],
      faces: []
    }
  };
}

const p1 = makePlayer("p1");
const p2 = makePlayer("p2");
const p3 = makePlayer("p3");

const room = {
  players: [p1, p2, p3],
  hostId: "p1",
  turn: {
    number: 4,
    phaseIndex: 3,
    activePlayerId: "p1"
  },
  stack: [],
  controlV58: {},
  triggerEvents: [],
  stateChecks: [],
  log: []
};

const creature = makeCard(
  "creature",
  "Owned Creature",
  "Creature — Human",
  "",
  {
    ownerId: "p2",
    controllerId: "p2",
    tapped: true
  }
);
p2.game.battlefield.push(creature);

_test.ensureRegistry(room);
assert.equal(
  room.controlV58.registry.creature.ownerId,
  "p2"
);

let result =
  _test.createEffect(
    room,
    p1,
    creature,
    "p1",
    {
      duration: "permanent",
      untap: true,
      haste: true,
      label: "Steal creature"
    },
    deps
  );

assert.equal(result.success, true);
assert.equal(creature.ownerId, "p2");
assert.equal(creature.controllerId, "p1");
assert.equal(creature.tapped, false);
assert(
  p1.game.battlefield.some(
    (card) =>
      card.id === creature.id
  )
);
assert(
  !p2.game.battlefield.some(
    (card) =>
      card.id === creature.id
  )
);

result =
  _test.createEffect(
    room,
    p3,
    creature,
    "p3",
    {
      duration: "end-of-turn",
      label: "Temporary second steal"
    },
    deps
  );

assert.equal(result.success, true);
assert.equal(
  creature.controllerId,
  "p3"
);

room.turn.phaseIndex = 12;
_test.recomputeAll(
  room,
  deps,
  "cleanup"
);

assert.equal(
  creature.controllerId,
  "p1"
);

const first = makeCard(
  "first",
  "First",
  "Artifact",
  "",
  {
    ownerId: "p1",
    controllerId: "p1"
  }
);
const second = makeCard(
  "second",
  "Second",
  "Enchantment",
  "",
  {
    ownerId: "p2",
    controllerId: "p2"
  }
);
p1.game.battlefield.push(first);
p2.game.battlefield.push(second);

room.turn.phaseIndex = 3;

result =
  _test.exchangeControl(
    room,
    p1,
    first.id,
    second.id,
    {},
    deps
  );

assert.equal(result.success, true);
assert.equal(first.controllerId, "p2");
assert.equal(second.controllerId, "p1");
assert.equal(first.ownerId, "p1");
assert.equal(second.ownerId, "p2");

const aura = makeCard(
  "aura",
  "Control Aura",
  "Enchantment — Aura",
  "Enchant creature\nYou control enchanted creature.",
  {
    ownerId: "p1",
    controllerId: "p1",
    attachedToId: first.id
  }
);
p1.game.battlefield.push(aura);

_test.syncStaticEffects(room, deps);
assert(
  room.controlV58.effects.some(
    (effect) =>
      effect.static &&
      effect.targetCardId === first.id
  )
);
assert.equal(first.controllerId, "p1");

aura.attachedToId = null;
_test.syncStaticEffects(room, deps);
assert.equal(first.controllerId, "p2");

const target = makeCard(
  "auto-target",
  "Auto Target",
  "Creature — Beast",
  "",
  {
    ownerId: "p2",
    controllerId: "p2",
    tapped: true
  }
);
p2.game.battlefield.push(target);

_test.applyResolvedControlText(
  room,
  {
    id: "spell",
    controllerId: "p1",
    sourceCardId: "source",
    name: "Threaten",
    text:
      "Untap target creature and gain control of it until end of turn. It gains haste until end of turn.",
    targets: [
      `card:${target.id}`
    ]
  },
  deps
);

assert.equal(target.controllerId, "p1");
assert.equal(target.tapped, false);

const stolenFromLeaving = makeCard(
  "stolen-leaving",
  "Stolen From Leaving Player",
  "Creature — Elf",
  "",
  {
    ownerId: "p2",
    controllerId: "p2"
  }
);
p2.game.battlefield.push(stolenFromLeaving);

result =
  _test.createEffect(
    room,
    p3,
    stolenFromLeaving,
    "p3",
    {
      duration: "permanent",
      label: "Player three steals it"
    },
    deps
  );
assert.equal(result.success, true);
assert.equal(
  stolenFromLeaving.controllerId,
  "p3"
);

const ownedByLeaving = makeCard(
  "owned-leaving",
  "Owned By Leaving",
  "Artifact",
  "",
  {
    ownerId: "p3",
    controllerId: "p1"
  }
);
p1.game.battlefield.push(ownedByLeaving);

result =
  _test.cleanupLeavingPlayer(
    room,
    "p3",
    deps,
    p3
  );

assert.equal(result.success, true);
assert(
  !_test
    .ensureRegistry(room)["owned-leaving"] ||
  !deps.findBattlefieldCard(
    room,
    "owned-leaving"
  )
);
assert.equal(
  stolenFromLeaving.controllerId,
  "p2"
);
assert(
  p2.game.battlefield.some(
    (card) =>
      card.id ===
      stolenFromLeaving.id
  )
);

const engine =
  createControlRulesEngine(deps);
const status = engine.status();

assert.equal(status.success, true);
assert.equal(status.version, "58.0.0");

console.log(
  "Arena control, ownership, exchange and leave-game engine v58 tests passed."
);
