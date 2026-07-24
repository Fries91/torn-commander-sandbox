"use strict";

const assert = require("assert");
const {
  createHiddenSearchEngine,
  _test
} = require("../hidden-search-engine");

let nextId = 0;
let randomStep = 0;

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
  },
  randomInt: (max) => {
    const value = randomStep % max;
    randomStep += 1;
    return value;
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
    tapped: false,
    counters: {},
    token: false,
    commander: false,
    summoningSick: false,
    specialState: {},
    power:
      extras.power || "",
    toughness:
      extras.toughness || "",
    cardData: {
      name,
      typeLine,
      oracleText:
        extras.oracleText || "",
      manaValue:
        extras.manaValue || 0,
      manaCost:
        extras.manaCost || "",
      colors:
        extras.colors || [],
      colorIdentity:
        extras.colorIdentity || [],
      imageUrl: "",
      faces: []
    }
  };
}

const p1 = makePlayer("p1");
const p2 = makePlayer("p2");

p1.game.library = [
  makeCard(
    "forest",
    "Forest",
    "Basic Land — Forest",
    {
      ownerId: "p1"
    }
  ),
  makeCard(
    "elf",
    "Elvish Mystic",
    "Creature — Elf Druid",
    {
      ownerId: "p1",
      manaValue: 1,
      colors: ["G"]
    }
  ),
  makeCard(
    "artifact",
    "Mana Rock",
    "Artifact",
    {
      ownerId: "p1",
      manaValue: 2
    }
  ),
  makeCard(
    "dragon",
    "Large Dragon",
    "Creature — Dragon",
    {
      ownerId: "p1",
      manaValue: 6,
      colors: ["R"]
    }
  ),
  makeCard(
    "island",
    "Island",
    "Basic Land — Island",
    {
      ownerId: "p1"
    }
  )
];

const room = {
  players: [p1, p2],
  hostId: "p1",
  turn: {
    number: 4,
    phaseIndex: 3,
    activePlayerId: "p1"
  },
  hiddenV59: {},
  triggerEvents: [],
  stateChecks: [],
  log: []
};

const basicFilter =
  _test.parseQuality(
    "basic land card"
  );

assert.equal(
  basicFilter.basic,
  true
);
assert.equal(
  basicFilter.land,
  true
);
assert.equal(
  _test.cardMatchesFilter(
    p1.game.library[0],
    basicFilter,
    deps
  ),
  true
);
assert.equal(
  _test.cardMatchesFilter(
    p1.game.library[1],
    basicFilter,
    deps
  ),
  false
);

const mvFilter =
  _test.parseQuality(
    "creature card with mana value 2 or less"
  );
assert.equal(
  _test.cardMatchesFilter(
    p1.game.library[1],
    mvFilter,
    deps
  ),
  true
);
assert.equal(
  _test.cardMatchesFilter(
    p1.game.library[3],
    mvFilter,
    deps
  ),
  false
);

let result =
  _test.createSearchSession(
    room,
    {
      searcherId: "p1",
      libraryOwnerId: "p1",
      sourceName: "Ramp Search",
      quality: "basic land card",
      min: 1,
      max: 1,
      revealFound: true,
      shuffleAfter: true,
      destination: {
        zone: "hand"
      }
    },
    deps
  );

assert.equal(result.success, true);

const firstSession =
  room.hiddenV59.sessions[0];
const candidates =
  _test.candidateCards(
    room,
    firstSession,
    deps
  );

assert.equal(candidates.length, 2);

result =
  _test.resolveSearchSession(
    room,
    p1,
    {
      sessionId:
        firstSession.id,
      selectedCardIds: [
        "forest"
      ]
    },
    deps
  );

assert.equal(result.success, true);
assert(
  p1.game.hand.some(
    (card) =>
      card.id === "forest"
  )
);
assert.equal(
  room.hiddenV59.shuffleCounts.p1,
  1
);

result =
  _test.createSearchSession(
    room,
    {
      searcherId: "p1",
      libraryOwnerId: "p1",
      sourceName:
        "Quality fail search",
      quality:
        "white creature card",
      min: 1,
      max: 1,
      revealFound: false,
      shuffleAfter: false,
      destination: {
        zone: "hand"
      }
    },
    deps
  );

assert.equal(result.success, true);
const failSession =
  room.hiddenV59.sessions[0];

result =
  _test.resolveSearchSession(
    room,
    p1,
    {
      sessionId:
        failSession.id,
      selectedCardIds: []
    },
    deps
  );

assert.equal(result.success, true);
assert.equal(
  result.failedToFind,
  true
);

result =
  _test.createSearchSession(
    room,
    {
      searcherId: "p1",
      libraryOwnerId: "p1",
      sourceName:
        "Quantity search",
      quality: "",
      min: 0,
      max: 1,
      revealFound: false,
      shuffleAfter: false,
      destination: {
        zone: "hand"
      }
    },
    deps
  );

assert.equal(result.success, true);
const mandatorySession =
  room.hiddenV59.sessions[0];

result =
  _test.resolveSearchSession(
    room,
    p1,
    {
      sessionId:
        mandatorySession.id,
      selectedCardIds: []
    },
    deps
  );

assert.equal(result.success, false);

room.hiddenV59.sessions = [];

const mindcensor = makeCard(
  "mindcensor",
  "Mindcensor",
  "Creature — Bird Wizard",
  {
    ownerId: "p2",
    controllerId: "p2",
    oracleText:
      "If an opponent would search a library, that player searches the top four cards of that library instead."
  }
);
p2.game.battlefield.push(
  mindcensor
);

const restriction =
  _test.searchRestrictions(
    room,
    "p1",
    deps
  );
assert.equal(
  restriction.topLimit,
  4
);

const blocker = makeCard(
  "blocker",
  "Search Blocker",
  "Enchantment",
  {
    ownerId: "p2",
    controllerId: "p2",
    oracleText:
      "Your opponents can't search libraries."
  }
);
p2.game.battlefield.push(
  blocker
);

result =
  _test.createSearchSession(
    room,
    {
      searcherId: "p1",
      libraryOwnerId: "p1",
      quality: "land card",
      min: 1,
      max: 1
    },
    deps
  );

assert.equal(result.success, true);
assert.equal(result.blocked, true);

p2.game.battlefield = [];

result =
  _test.createLookSession(
    room,
    {
      viewerId: "p1",
      libraryOwnerId: "p1",
      amount: 2,
      allowBottom: true,
      allowReorder: true,
      revealToAll: false,
      sourceName: "Look Test"
    },
    deps
  );

assert.equal(result.success, true);
const lookSession =
  room.hiddenV59.sessions[0];
const looked =
  p1.game.library.slice(0, 2)
    .map((card) => card.id);

result =
  _test.resolveLookSession(
    room,
    p1,
    {
      sessionId:
        lookSession.id,
      bottomCardIds: [
        looked[0]
      ],
      topOrder: [
        looked[1]
      ]
    },
    deps
  );

assert.equal(result.success, true);
assert.equal(
  p1.game.library.at(-1).id,
  looked[0]
);

const revealCard =
  p1.game.library[0];

_test.addReveal(
  room,
  revealCard,
  {
    zone: "library",
    zoneOwnerId: "p1",
    viewers: "all",
    reason: "Reveal Test",
    expires: "persistent"
  },
  deps
);

assert(
  _test.visibleReveals(
    room,
    "p2"
  ).some(
    (entry) =>
      entry.cardId ===
      revealCard.id
  )
);

_test.shuffleLibrary(
  room,
  p1,
  deps,
  "test shuffle"
);

assert(
  !_test.visibleReveals(
    room,
    "p2"
  ).some(
    (entry) =>
      entry.cardId ===
      revealCard.id &&
      entry.zone === "library"
  )
);

const parsedSearch =
  _test.parseSearchInstruction(
    "Search your library for up to two basic land cards, reveal them, put them into your hand, then shuffle."
  );

assert.equal(
  parsedSearch.amount,
  2
);
assert.equal(
  parsedSearch.upTo,
  true
);
assert.equal(
  parsedSearch.revealFound,
  true
);
assert.equal(
  parsedSearch.shuffleAfter,
  true
);
assert.equal(
  parsedSearch.destination.zone,
  "hand"
);

const parsedLook =
  _test.parseLookInstruction(
    "Look at the top three cards of your library. Put any number of them on the bottom of your library and the rest on top in any order."
  );

assert.equal(
  parsedLook.amount,
  3
);
assert.equal(
  parsedLook.allowBottom,
  true
);
assert.equal(
  parsedLook.allowReorder,
  true
);

const engine =
  createHiddenSearchEngine(
    deps
  );
const status =
  engine.status();

assert.equal(
  status.success,
  true
);
assert.equal(
  status.version,
  "59.0.0"
);

console.log(
  "Arena hidden information, search, reveal and shuffle engine v59 tests passed."
);
