"use strict";

const crypto = require("crypto");

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeState(room) {
  room.hiddenV59 =
    room.hiddenV59 && typeof room.hiddenV59 === "object"
      ? room.hiddenV59
      : {};

  const state = room.hiddenV59;
  state.sessions = list(state.sessions)
    .filter((session) => session && session.id && session.status === "open")
    .slice(-100);
  state.reveals = list(state.reveals)
    .filter((entry) => entry && entry.id)
    .slice(-150);
  state.shuffleCounts =
    state.shuffleCounts && typeof state.shuffleCounts === "object"
      ? state.shuffleCounts
      : {};
  state.history = list(state.history).slice(-300);
  state.lastAction =
    state.lastAction && typeof state.lastAction === "object"
      ? state.lastAction
      : null;
  state.knownTop =
    state.knownTop && typeof state.knownTop === "object"
      ? state.knownTop
      : {};

  return state;
}

function currentFace(card, deps) {
  return deps.currentCardFace(card) || card?.cardData || {};
}

function cardName(card) {
  return String(card?.name || card?.cardData?.name || "Card");
}

function typeLine(card, deps) {
  return String(deps.currentTypeLine(card) || "");
}

function oracle(card, deps) {
  return String(deps.currentOracleText(card) || "");
}

function manaValue(card, deps) {
  const face = currentFace(card, deps);
  return Math.max(
    0,
    Number(
      face.manaValue ??
      face.cmc ??
      card?.cardData?.manaValue ??
      card?.cardData?.cmc ??
      0
    ) || 0
  );
}

function colors(card, deps) {
  const face = currentFace(card, deps);
  const explicit = unique([
    ...list(face.colors),
    ...list(card?.cardData?.colors),
    ...list(face.colorIdentity),
    ...list(card?.cardData?.colorIdentity)
  ]).map((value) => String(value).toUpperCase());

  if (explicit.length) return explicit;

  const cost = String(
    face.manaCost ||
    card?.cardData?.manaCost ||
    ""
  ).toUpperCase();

  return unique(
    [...cost.matchAll(/\{([WUBRGC])(?:\/[^}]+)?\}/g)]
      .map((match) => match[1])
  );
}

function activePlayers(room) {
  return room.players.filter(
    (player) =>
      player.game &&
      !player.game.lost &&
      !player.game.conceded
  );
}

function findPlayer(room, playerId, deps) {
  return deps.findPlayer(room, String(playerId || "")) || null;
}

function wordNumber(value) {
  const words = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    x: 1
  };

  const normalized = String(value || "").trim().toLowerCase();
  return Math.max(
    0,
    Object.prototype.hasOwnProperty.call(words, normalized)
      ? words[normalized]
      : Number(normalized) || 0
  );
}

function randomIndex(max, deps) {
  if (max <= 1) return 0;

  if (typeof deps.randomInt === "function") {
    return Math.max(
      0,
      Math.min(max - 1, Number(deps.randomInt(max)) || 0)
    );
  }

  return crypto.randomInt(0, max);
}

function markNewHiddenObject(card) {
  card.specialState = card.specialState || {};
  card.specialState.hiddenObjectVersionV59 =
    (Number(card.specialState.hiddenObjectVersionV59) || 0) + 1;
}

function clearLibraryKnowledge(room, libraryOwnerId) {
  const state = normalizeState(room);

  delete state.knownTop[libraryOwnerId];

  state.reveals = state.reveals.filter(
    (entry) =>
      !(
        entry.zone === "library" &&
        entry.zoneOwnerId === libraryOwnerId
      )
  );

  for (const session of state.sessions) {
    if (
      session.libraryOwnerId === libraryOwnerId &&
      ["look", "reorder", "reveal-top"].includes(session.kind)
    ) {
      session.status = "cancelled";
    }
  }

  state.sessions = state.sessions.filter(
    (session) => session.status === "open"
  );
}

function shuffleLibrary(room, player, deps, reason = "shuffle") {
  if (!player?.game?.library) {
    return {
      success: false,
      error: "That library is unavailable."
    };
  }

  const library = player.game.library;

  for (let index = library.length - 1; index > 0; index -= 1) {
    const swap = randomIndex(index + 1, deps);
    [library[index], library[swap]] = [library[swap], library[index]];
  }

  for (const card of library) {
    markNewHiddenObject(card);
  }

  const state = normalizeState(room);
  state.shuffleCounts[player.id] =
    (Number(state.shuffleCounts[player.id]) || 0) + 1;

  clearLibraryKnowledge(room, player.id);

  state.history.push({
    id: deps.createId(),
    type: "library-shuffled",
    playerId: player.id,
    reason,
    count: state.shuffleCounts[player.id],
    createdAt: deps.nowIso()
  });

  state.lastAction = state.history.at(-1);

  deps.queueSuggestedTriggers(room, "LIBRARY_SHUFFLED", {
    playerId: player.id,
    reason
  });

  deps.addLog(
    room,
    `${player.name} shuffled their library.`,
    "hidden"
  );

  return {
    success: true,
    shuffleCount: state.shuffleCounts[player.id]
  };
}

function parseQuality(rawQuality) {
  const raw = String(rawQuality || "")
    .replace(/\s+/g, " ")
    .trim();

  const normalized = raw
    .replace(/^(?:up to )?(?:a|an|one|two|three|four|five|\d+)\s+/i, "")
    .replace(/\bcards?\b/gi, "")
    .replace(/\bfrom your library\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  const filter = {
    raw: normalized,
    hasStatedQuality: Boolean(normalized),
    basic: /\bbasic\b/i.test(normalized),
    legendary: /\blegendary\b/i.test(normalized),
    snow: /\bsnow\b/i.test(normalized),
    land: /\bland\b/i.test(normalized),
    nonland: /\bnonland\b/i.test(normalized),
    permanent: /\bpermanent\b/i.test(normalized),
    creature: /\bcreature\b/i.test(normalized),
    artifact: /\bartifact\b/i.test(normalized),
    enchantment: /\benchantment\b/i.test(normalized),
    instant: /\binstant\b/i.test(normalized),
    sorcery: /\bsorcery\b/i.test(normalized),
    planeswalker: /\bplaneswalker\b/i.test(normalized),
    battle: /\bbattle\b/i.test(normalized),
    cardName: "",
    subtype: "",
    color: "",
    manaValueMin: null,
    manaValueMax: null,
    oracleIncludes: ""
  };

  const nameMatch = normalized.match(
    /(?:named|with the same name as)\s+["“]?([^"”.,]+)["”]?/i
  );
  if (nameMatch) {
    filter.cardName = nameMatch[1].trim();
  }

  const mvAtMost = normalized.match(
    /mana value\s+(\d+)\s+or less/i
  );
  if (mvAtMost) filter.manaValueMax = Number(mvAtMost[1]);

  const mvAtLeast = normalized.match(
    /mana value\s+(\d+)\s+or greater/i
  );
  if (mvAtLeast) filter.manaValueMin = Number(mvAtLeast[1]);

  const mvExact = normalized.match(
    /mana value\s+(?:equal to\s+)?(\d+)(?!\s+or)/i
  );
  if (mvExact && filter.manaValueMin == null && filter.manaValueMax == null) {
    filter.manaValueMin = Number(mvExact[1]);
    filter.manaValueMax = Number(mvExact[1]);
  }

  const colorWords = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G",
    colorless: "C"
  };

  for (const [word, symbol] of Object.entries(colorWords)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(normalized)) {
      filter.color = symbol;
      break;
    }
  }

  const commonSubtypes = [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
    "Wastes",
    "Elf",
    "Faerie",
    "Goblin",
    "Dragon",
    "Angel",
    "Demon",
    "Vampire",
    "Zombie",
    "Human",
    "Wizard",
    "Warrior",
    "Knight",
    "Cleric",
    "Rogue",
    "Merfolk",
    "Dinosaur",
    "Cat",
    "Dog",
    "God",
    "Shrine",
    "Aura",
    "Equipment",
    "Vehicle",
    "Saga",
    "Background"
  ];

  for (const subtype of commonSubtypes) {
    if (new RegExp(`\\b${subtype}\\b`, "i").test(normalized)) {
      filter.subtype = subtype;
      break;
    }
  }

  return filter;
}

function filterHasQuality(filter) {
  return Boolean(
    filter?.hasStatedQuality ||
    filter?.basic ||
    filter?.legendary ||
    filter?.snow ||
    filter?.land ||
    filter?.nonland ||
    filter?.permanent ||
    filter?.creature ||
    filter?.artifact ||
    filter?.enchantment ||
    filter?.instant ||
    filter?.sorcery ||
    filter?.planeswalker ||
    filter?.battle ||
    filter?.cardName ||
    filter?.subtype ||
    filter?.color ||
    filter?.manaValueMin != null ||
    filter?.manaValueMax != null ||
    filter?.oracleIncludes
  );
}

function cardMatchesFilter(card, filter, deps) {
  if (!filter || !filterHasQuality(filter)) return true;

  const type = typeLine(card, deps);
  const text = oracle(card, deps);
  const name = cardName(card);

  if (filter.basic && !/\bBasic\b/i.test(type)) return false;
  if (filter.legendary && !/\bLegendary\b/i.test(type)) return false;
  if (filter.snow && !/\bSnow\b/i.test(type)) return false;
  if (filter.land && !/\bLand\b/i.test(type)) return false;
  if (filter.nonland && /\bLand\b/i.test(type)) return false;

  if (
    filter.permanent &&
    !/\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/i.test(type)
  ) {
    return false;
  }

  for (const [key, pattern] of [
    ["creature", /\bCreature\b/i],
    ["artifact", /\bArtifact\b/i],
    ["enchantment", /\bEnchantment\b/i],
    ["instant", /\bInstant\b/i],
    ["sorcery", /\bSorcery\b/i],
    ["planeswalker", /\bPlaneswalker\b/i],
    ["battle", /\bBattle\b/i]
  ]) {
    if (filter[key] && !pattern.test(type)) return false;
  }

  if (
    filter.cardName &&
    name.toLocaleLowerCase("en-US") !==
      String(filter.cardName).toLocaleLowerCase("en-US")
  ) {
    return false;
  }

  if (
    filter.subtype &&
    !new RegExp(`\\b${String(filter.subtype).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
      .test(type)
  ) {
    return false;
  }

  if (
    filter.color &&
    !colors(card, deps).includes(String(filter.color).toUpperCase())
  ) {
    return false;
  }

  const mv = manaValue(card, deps);
  if (filter.manaValueMin != null && mv < Number(filter.manaValueMin)) {
    return false;
  }
  if (filter.manaValueMax != null && mv > Number(filter.manaValueMax)) {
    return false;
  }

  if (
    filter.oracleIncludes &&
    !text.toLocaleLowerCase("en-US")
      .includes(String(filter.oracleIncludes).toLocaleLowerCase("en-US"))
  ) {
    return false;
  }

  return true;
}

function searchRestrictions(room, searcherId, deps) {
  const restrictions = {
    blocked: false,
    blockedBy: [],
    topLimit: null,
    topLimitSources: [],
    controlledByOpponentId: null
  };

  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      const text = oracle(card, deps);
      const controllerId = card.controllerId || player.id;
      const opponent = controllerId !== searcherId;

      if (/\bplayers can'?t search libraries\b/i.test(text)) {
        restrictions.blocked = true;
        restrictions.blockedBy.push({
          cardId: card.id,
          name: card.name
        });
      }

      if (
        opponent &&
        /\byour opponents can'?t search libraries\b/i.test(text)
      ) {
        restrictions.blocked = true;
        restrictions.blockedBy.push({
          cardId: card.id,
          name: card.name
        });
      }

      const topMatch = text.match(
        /\bif an opponent would search a library, that player searches the top (\w+|\d+) cards? of that library instead\b/i
      );

      if (opponent && topMatch) {
        const amount = Math.max(0, wordNumber(topMatch[1]));
        restrictions.topLimit =
          restrictions.topLimit == null
            ? amount
            : Math.min(restrictions.topLimit, amount);
        restrictions.topLimitSources.push({
          cardId: card.id,
          name: card.name,
          amount
        });
      }

      if (
        opponent &&
        /\byou control your opponents while they'?re searching their libraries\b/i.test(
          text
        )
      ) {
        restrictions.controlledByOpponentId = controllerId;
      }
    }
  }

  return restrictions;
}

function candidateCards(room, session, deps) {
  const owner = findPlayer(room, session.libraryOwnerId, deps);
  if (!owner?.game?.library) return [];

  const restrictionLimit =
    session.searchTopLimit == null
      ? owner.game.library.length
      : Math.max(0, Number(session.searchTopLimit) || 0);

  return owner.game.library
    .slice(0, restrictionLimit)
    .filter((card) => cardMatchesFilter(card, session.filter, deps))
    .map((card) => ({
      cardId: card.id,
      name: cardName(card),
      typeLine: typeLine(card, deps),
      manaValue: manaValue(card, deps),
      card: deps.publicCard(card)
    }));
}

function sessionExists(room, sourceStackItemId, kind) {
  return normalizeState(room).sessions.find(
    (session) =>
      session.status === "open" &&
      session.sourceStackItemId === sourceStackItemId &&
      (!kind || session.kind === kind)
  );
}

function destinationDefaults(zone) {
  return {
    zone: [
      "hand",
      "battlefield",
      "graveyard",
      "exile",
      "library-top",
      "library-bottom"
    ].includes(zone)
      ? zone
      : "hand",
    tapped: false,
    reveal: false,
    controllerId: null
  };
}

function createSearchSession(room, spec, deps) {
  const state = normalizeState(room);
  const searcher = findPlayer(room, spec.searcherId, deps);
  const owner = findPlayer(room, spec.libraryOwnerId, deps);

  if (!searcher?.game || !owner?.game?.library) {
    return {
      success: false,
      error: "The searcher or library is unavailable."
    };
  }

  const restrictions = searchRestrictions(room, searcher.id, deps);

  if (restrictions.blocked && !spec.ignoreRestrictions) {
    state.history.push({
      id: deps.createId(),
      type: "search-blocked",
      searcherId: searcher.id,
      libraryOwnerId: owner.id,
      blockedBy: clone(restrictions.blockedBy),
      createdAt: deps.nowIso()
    });

    deps.addLog(
      room,
      `${searcher.name} could not search ${owner.name}'s library.`,
      "hidden"
    );

    return {
      success: true,
      blocked: true,
      restrictions
    };
  }

  if (
    spec.sourceStackItemId &&
    sessionExists(room, spec.sourceStackItemId, "search")
  ) {
    return {
      success: true,
      sessionId: sessionExists(room, spec.sourceStackItemId, "search").id
    };
  }

  const filter =
    spec.filter && typeof spec.filter === "object"
      ? clone(spec.filter)
      : parseQuality(spec.quality || "");

  const max = Math.max(0, Number(spec.max) || 1);
  const min = Math.max(
    0,
    Math.min(
      max,
      Number(spec.min) || 0
    )
  );

  const hasQuality = filterHasQuality(filter);
  const allowFail =
    spec.allowFail != null
      ? Boolean(spec.allowFail)
      : hasQuality;

  const destination = {
    ...destinationDefaults(spec.destination?.zone || spec.destinationZone),
    ...clone(spec.destination || {})
  };

  const session = {
    id: deps.createId(),
    status: "open",
    kind: "search",
    playerId:
      restrictions.controlledByOpponentId && !spec.ignoreControlSearch
        ? restrictions.controlledByOpponentId
        : searcher.id,
    originalSearcherId: searcher.id,
    libraryOwnerId: owner.id,
    sourceControllerId: spec.sourceControllerId || searcher.id,
    sourceStackItemId: spec.sourceStackItemId || null,
    sourceName: String(spec.sourceName || "Library search").slice(0, 180),
    filter,
    min,
    max,
    upTo: Boolean(spec.upTo),
    allowFail,
    mandatoryQuantity: !hasQuality && !spec.upTo,
    revealFound: Boolean(spec.revealFound),
    shuffleAfter: spec.shuffleAfter !== false,
    searchTopLimit:
      spec.searchTopLimit != null
        ? Math.max(0, Number(spec.searchTopLimit) || 0)
        : restrictions.topLimit,
    restrictions,
    destination,
    destinationPlayerId:
      spec.destinationPlayerId ||
      (
        destination.zone === "hand"
          ? owner.id
          : owner.id
      ),
    createdAt: deps.nowIso(),
    private: true
  };

  state.sessions.push(session);
  state.history.push({
    id: deps.createId(),
    type: "search-started",
    sessionId: session.id,
    searcherId: searcher.id,
    chooserId: session.playerId,
    libraryOwnerId: owner.id,
    sourceName: session.sourceName,
    createdAt: deps.nowIso()
  });
  state.lastAction = state.history.at(-1);

  deps.addLog(
    room,
    `${searcher.name} began searching ${owner.name}'s library.`,
    "hidden"
  );

  return {
    success: true,
    sessionId: session.id,
    restrictions
  };
}

function createLookSession(room, spec, deps) {
  const state = normalizeState(room);
  const viewer = findPlayer(room, spec.viewerId, deps);
  const owner = findPlayer(room, spec.libraryOwnerId, deps);

  if (!viewer?.game || !owner?.game?.library) {
    return {
      success: false,
      error: "The viewer or library is unavailable."
    };
  }

  const amount = Math.max(
    0,
    Math.min(
      owner.game.library.length,
      Number(spec.amount) || 1
    )
  );

  const ids = owner.game.library
    .slice(0, amount)
    .map((card) => card.id);

  const session = {
    id: deps.createId(),
    status: "open",
    kind: spec.revealToAll ? "reveal-top" : "look",
    playerId: viewer.id,
    libraryOwnerId: owner.id,
    sourceControllerId: spec.sourceControllerId || viewer.id,
    sourceStackItemId: spec.sourceStackItemId || null,
    sourceName: String(spec.sourceName || "Look at cards").slice(0, 180),
    amount,
    cardIds: ids,
    allowReorder: Boolean(spec.allowReorder),
    allowBottom: Boolean(spec.allowBottom),
    revealToAll: Boolean(spec.revealToAll),
    createdAt: deps.nowIso(),
    private: !spec.revealToAll
  };

  state.sessions.push(session);

  if (session.revealToAll) {
    for (const cardId of ids) {
      const card = owner.game.library.find((entry) => entry.id === cardId);
      if (card) {
        addReveal(
          room,
          card,
          {
            zone: "library",
            zoneOwnerId: owner.id,
            viewers: "all",
            reason: session.sourceName,
            sourceStackItemId: session.sourceStackItemId,
            expires: "session"
          },
          deps
        );
      }
    }
  } else {
    state.knownTop[owner.id] = {
      viewerId: viewer.id,
      cardIds: ids,
      createdAt: deps.nowIso()
    };
  }

  return {
    success: true,
    sessionId: session.id
  };
}

function addReveal(room, card, options, deps) {
  const state = normalizeState(room);
  const reveal = {
    id: deps.createId(),
    cardId: card.id,
    cardName: cardName(card),
    card: deps.publicCard(card),
    zone: options.zone || "unknown",
    zoneOwnerId: options.zoneOwnerId || card.ownerId,
    viewers: options.viewers || "all",
    reason: options.reason || "Reveal",
    sourceStackItemId: options.sourceStackItemId || null,
    expires: options.expires || "brief",
    createdAt: deps.nowIso()
  };

  state.reveals.push(reveal);
  state.history.push({
    id: deps.createId(),
    type: "card-revealed",
    revealId: reveal.id,
    cardId: card.id,
    cardName: reveal.cardName,
    zone: reveal.zone,
    zoneOwnerId: reveal.zoneOwnerId,
    createdAt: deps.nowIso()
  });
  state.lastAction = state.history.at(-1);

  deps.queueSuggestedTriggers(room, "CARD_REVEALED", {
    card,
    zone: reveal.zone,
    zoneOwnerId: reveal.zoneOwnerId
  });

  return reveal;
}

function removeSelectedFromLibrary(owner, selectedIds) {
  const selected = [];
  const wanted = new Set(selectedIds);

  owner.game.library = owner.game.library.filter((card) => {
    if (wanted.has(card.id)) {
      selected.push(card);
      return false;
    }
    return true;
  });

  return selected;
}

function destinationPlayer(room, session, card, deps) {
  const wanted =
    session.destination?.controllerId ||
    session.destinationPlayerId ||
    card.ownerId ||
    session.libraryOwnerId;

  return (
    findPlayer(room, wanted, deps) ||
    findPlayer(room, card.ownerId, deps) ||
    findPlayer(room, session.libraryOwnerId, deps)
  );
}

function moveFoundCard(room, session, card, deps) {
  const destination = session.destination || destinationDefaults("hand");
  const player = destinationPlayer(room, session, card, deps);

  if (!player?.game) {
    return {
      success: false,
      error: "The destination player is unavailable."
    };
  }

  markNewHiddenObject(card);

  if (destination.zone === "hand") {
    card.controllerId = card.ownerId;
    player.game.hand.push(card);
  } else if (destination.zone === "battlefield") {
    card.controllerId = destination.controllerId || player.id;
    card.tapped = Boolean(destination.tapped);
    card.summoningSick = deps.isCreatureCard(card);
    player.game.battlefield.unshift(card);
  } else if (destination.zone === "graveyard") {
    const owner = findPlayer(room, card.ownerId, deps) || player;
    card.controllerId = card.ownerId;
    owner.game.graveyard.unshift(card);
  } else if (destination.zone === "exile") {
    const owner = findPlayer(room, card.ownerId, deps) || player;
    card.controllerId = card.ownerId;
    owner.game.exile.unshift(card);
  } else if (destination.zone === "library-top") {
    const owner = findPlayer(room, session.libraryOwnerId, deps) || player;
    owner.game.library.unshift(card);
  } else if (destination.zone === "library-bottom") {
    const owner = findPlayer(room, session.libraryOwnerId, deps) || player;
    owner.game.library.push(card);
  } else {
    return {
      success: false,
      error: "Unsupported search destination."
    };
  }

  deps.queueSuggestedTriggers(room, "CARD_MOVED_FROM_LIBRARY", {
    card,
    libraryOwnerId: session.libraryOwnerId,
    destination: destination.zone,
    destinationPlayerId: player.id
  });

  return { success: true };
}

function resolveSearchSession(room, actor, action, deps) {
  const state = normalizeState(room);
  const session = state.sessions.find(
    (entry) =>
      entry.id === String(action?.sessionId || "") &&
      entry.kind === "search" &&
      entry.status === "open"
  );

  if (!session) {
    return {
      success: false,
      error: "That library search is unavailable."
    };
  }

  if (
    session.playerId !== actor.id &&
    room.hostId !== actor.id
  ) {
    return {
      success: false,
      error: "That search belongs to another player."
    };
  }

  const owner = findPlayer(room, session.libraryOwnerId, deps);
  const originalSearcher = findPlayer(room, session.originalSearcherId, deps);

  if (!owner?.game?.library || !originalSearcher?.game) {
    return {
      success: false,
      error: "The searcher or library is unavailable."
    };
  }

  const candidates = candidateCards(room, session, deps);
  const legalIds = new Set(candidates.map((entry) => entry.cardId));
  const selectedIds = unique(action?.selectedCardIds).filter(
    (id) => legalIds.has(id)
  );

  if (selectedIds.length > session.max) {
    return {
      success: false,
      error: `Choose no more than ${session.max} card(s).`
    };
  }

  const required = session.mandatoryQuantity
    ? Math.min(session.max, candidates.length)
    : session.min;

  if (
    selectedIds.length < required &&
    !(
      session.allowFail &&
      selectedIds.length === 0
    )
  ) {
    return {
      success: false,
      error: `Choose at least ${required} card(s), or legally fail to find when allowed.`
    };
  }

  if (
    !session.allowFail &&
    selectedIds.length === 0 &&
    candidates.length
  ) {
    return {
      success: false,
      error: "This search requires a card to be found."
    };
  }

  const selected = removeSelectedFromLibrary(owner, selectedIds);

  for (const card of selected) {
    if (session.revealFound) {
      addReveal(
        room,
        card,
        {
          zone: "library",
          zoneOwnerId: owner.id,
          viewers: "all",
          reason: session.sourceName,
          sourceStackItemId: session.sourceStackItemId,
          expires: "brief"
        },
        deps
      );
    }

    const moved = moveFoundCard(room, session, card, deps);
    if (!moved.success) return moved;
  }

  if (session.shuffleAfter) {
    shuffleLibrary(
      room,
      owner,
      deps,
      `after ${session.sourceName}`
    );
  }

  session.status = "resolved";
  session.selectedCardIds = selectedIds;
  session.resolvedAt = deps.nowIso();

  state.sessions = state.sessions.filter(
    (entry) => entry.status === "open"
  );

  state.history.push({
    id: deps.createId(),
    type: "search-resolved",
    sessionId: session.id,
    searcherId: originalSearcher.id,
    chooserId: actor.id,
    libraryOwnerId: owner.id,
    found: selected.map((card) => ({
      cardId: card.id,
      name: cardName(card)
    })),
    failedToFind: selected.length === 0,
    destination: session.destination?.zone || "hand",
    createdAt: deps.nowIso()
  });
  state.lastAction = state.history.at(-1);

  deps.queueSuggestedTriggers(room, "LIBRARY_SEARCHED", {
    searcherId: originalSearcher.id,
    chooserId: actor.id,
    libraryOwnerId: owner.id,
    foundCards: selected,
    failedToFind: selected.length === 0
  });

  deps.addLog(
    room,
    selected.length
      ? `${originalSearcher.name} found ${selected.length} card(s) in ${owner.name}'s library.`
      : `${originalSearcher.name} finished searching ${owner.name}'s library without finding a card.`,
    "hidden"
  );

  deps.runStateBasedActions(room, "hidden-search-v59");

  return {
    success: true,
    selectedCardIds: selectedIds,
    failedToFind: selected.length === 0
  };
}

function sessionCards(room, session, deps) {
  const owner = findPlayer(room, session.libraryOwnerId, deps);
  if (!owner?.game?.library) return [];

  const byId = new Map(
    owner.game.library.map((card) => [card.id, card])
  );

  return session.cardIds
    .map((id) => byId.get(id))
    .filter(Boolean);
}

function resolveLookSession(room, actor, action, deps) {
  const state = normalizeState(room);
  const session = state.sessions.find(
    (entry) =>
      entry.id === String(action?.sessionId || "") &&
      ["look", "reveal-top"].includes(entry.kind) &&
      entry.status === "open"
  );

  if (!session) {
    return {
      success: false,
      error: "That look/reveal session is unavailable."
    };
  }

  if (
    session.playerId !== actor.id &&
    room.hostId !== actor.id
  ) {
    return {
      success: false,
      error: "That hidden-information choice belongs to another player."
    };
  }

  const owner = findPlayer(room, session.libraryOwnerId, deps);
  if (!owner?.game?.library) {
    return {
      success: false,
      error: "The library is unavailable."
    };
  }

  const cards = sessionCards(room, session, deps);
  const availableIds = cards.map((card) => card.id);
  const bottomIds = unique(action?.bottomCardIds).filter(
    (id) => availableIds.includes(id)
  );

  if (!session.allowBottom && bottomIds.length) {
    return {
      success: false,
      error: "This effect does not allow cards to be put on the bottom."
    };
  }

  const topOrder = unique(action?.topOrder).filter(
    (id) =>
      availableIds.includes(id) &&
      !bottomIds.includes(id)
  );

  const missingTop = availableIds.filter(
    (id) =>
      !bottomIds.includes(id) &&
      !topOrder.includes(id)
  );

  const finalTop = session.allowReorder
    ? [...topOrder, ...missingTop]
    : availableIds.filter((id) => !bottomIds.includes(id));

  const extracted = new Map();

  owner.game.library = owner.game.library.filter((card) => {
    if (availableIds.includes(card.id)) {
      extracted.set(card.id, card);
      return false;
    }
    return true;
  });

  owner.game.library.unshift(
    ...finalTop
      .map((id) => extracted.get(id))
      .filter(Boolean)
  );

  owner.game.library.push(
    ...bottomIds
      .map((id) => extracted.get(id))
      .filter(Boolean)
  );

  for (const card of cards) markNewHiddenObject(card);

  session.status = "resolved";
  state.sessions = state.sessions.filter(
    (entry) => entry.status === "open"
  );

  delete state.knownTop[owner.id];

  if (session.revealToAll) {
    state.reveals = state.reveals.filter(
      (entry) =>
        entry.sourceStackItemId !== session.sourceStackItemId ||
        entry.expires !== "session"
    );
  }

  state.history.push({
    id: deps.createId(),
    type: session.revealToAll ? "top-cards-revealed" : "top-cards-looked",
    sessionId: session.id,
    playerId: actor.id,
    libraryOwnerId: owner.id,
    amount: cards.length,
    bottomCardIds: bottomIds,
    topOrder: finalTop,
    createdAt: deps.nowIso()
  });
  state.lastAction = state.history.at(-1);

  deps.queueSuggestedTriggers(room, "LIBRARY_REORDERED", {
    playerId: actor.id,
    libraryOwnerId: owner.id,
    topOrder: finalTop,
    bottomCardIds: bottomIds
  });

  return { success: true };
}

function revealHand(room, actor, action, deps) {
  const target = findPlayer(room, action?.playerId || actor.id, deps);
  if (!target?.game?.hand) {
    return {
      success: false,
      error: "That hand is unavailable."
    };
  }

  if (
    target.id !== actor.id &&
    room.hostId !== actor.id
  ) {
    return {
      success: false,
      error: "You may reveal only your own hand."
    };
  }

  for (const card of target.game.hand) {
    addReveal(
      room,
      card,
      {
        zone: "hand",
        zoneOwnerId: target.id,
        viewers: "all",
        reason: String(action?.reason || "Hand revealed").slice(0, 180),
        expires: action?.persistent ? "persistent" : "brief"
      },
      deps
    );
  }

  deps.addLog(
    room,
    `${target.name} revealed their hand.`,
    "hidden"
  );

  return {
    success: true,
    revealed: target.game.hand.length
  };
}

function clearReveal(room, actor, action) {
  const state = normalizeState(room);
  const reveal = state.reveals.find(
    (entry) => entry.id === String(action?.revealId || "")
  );

  if (!reveal) {
    return {
      success: false,
      error: "That reveal is unavailable."
    };
  }

  if (
    reveal.zoneOwnerId !== actor.id &&
    room.hostId !== actor.id
  ) {
    return {
      success: false,
      error: "That reveal belongs to another player."
    };
  }

  state.reveals = state.reveals.filter(
    (entry) => entry.id !== reveal.id
  );

  return { success: true };
}

function parseDestination(text) {
  const source = String(text || "");

  if (/\bonto the battlefield\b/i.test(source)) {
    return {
      zone: "battlefield",
      tapped: /\bonto the battlefield tapped\b/i.test(source),
      reveal: false,
      controllerId: null
    };
  }

  if (/\b(?:put|puts?|move|moves?)\b[^.]{0,90}\b(?:into|in) (?:their|your|its owner'?s|that player'?s|a) graveyard\b/i.test(source)) {
    return destinationDefaults("graveyard");
  }

  if (/\b(?:exile|put[^.]{0,60}into exile)\b/i.test(source)) {
    return destinationDefaults("exile");
  }

  if (/\b(?:on|onto) top of (?:your|that player'?s|their|its owner'?s) (?:library|deck)\b/i.test(source)) {
    return destinationDefaults("library-top");
  }

  if (/\b(?:on|onto) the bottom of (?:your|that player'?s|their|its owner'?s) (?:library|deck)\b/i.test(source)) {
    return destinationDefaults("library-bottom");
  }

  return destinationDefaults("hand");
}

function normalizeSearchQuality(value) {
  let quality = String(value || "card")
    .replace(/\s+/g, " ")
    .replace(/^(?:a|an|one)\s+/i, "")
    .replace(/\s+(?:and|then)\s+(?:put|reveal|exile|shuffle).*$/i, "")
    .replace(/[,.]+$/g, "")
    .trim();

  if (!quality || /^(?:one|a|an)$/i.test(quality)) quality = "card";
  if (!/\bcards?\b/i.test(quality)) quality += " card";
  return quality;
}

function searchAmount(value) {
  if (/any number/i.test(String(value || ""))) return 99;
  return Math.max(1, wordNumber(value));
}

function parseSearchInstruction(text) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return null;

  // Top-N look/reveal effects belong to the separate look/reorder session.
  if (/\b(?:look at|reveal) the top\b/i.test(source)) return null;

  const reference = "(your|target player'?s|target opponent'?s|an opponent'?s|that player'?s|their)";
  const amount = "(any number of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)";
  let match = source.match(new RegExp(
    "\\b(?:search|look through)\\s+" + reference +
    "\\s+(?:library|deck)\\s+for\\s+(up to\\s+)?" + amount +
    "\\s+(.+?)(?=,|\\.|\\bthen\\b|\\band\\s+(?:put|reveal|exile|shuffle)\\b|$)",
    "i"
  ));

  let libraryReference = "";
  let upTo = false;
  let amountValue = 1;
  let quality = "card";

  if (match) {
    libraryReference = match[1].toLowerCase();
    upTo = Boolean(match[2]) || /any number/i.test(match[3]);
    amountValue = searchAmount(match[3]);
    quality = normalizeSearchQuality(match[4]);
  } else {
    match = source.match(new RegExp(
      "\\b(?:choose|select|find)\\s+(up to\\s+)?" + amount +
      "?\\s*(.+?)\\s+from\\s+" + reference +
      "\\s+(?:library|deck)(?=,|\\.|\\bthen\\b|\\band\\s+(?:put|reveal|exile|shuffle)\\b|$)",
      "i"
    ));

    if (match) {
      upTo = Boolean(match[1]) || /any number/i.test(match[2]);
      amountValue = searchAmount(match[2] || "one");
      quality = normalizeSearchQuality(match[3]);
      libraryReference = match[4].toLowerCase();
    } else {
      // Broad/custom wording such as “look through your library” or
      // “look at your deck and choose a card” opens the entire legal library.
      match = source.match(new RegExp(
        "\\b(?:search|look through|look at)\\s+" + reference +
        "\\s+(?:library|deck)\\b",
        "i"
      ));
      if (!match) return null;

      libraryReference = match[1].toLowerCase();
      const choice = source.match(
        /\b(?:choose|select|find)\s+(up to\s+)?(any number of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)?\s*([^,.]*?\bcards?\b)?/i
      );
      if (choice) {
        upTo = Boolean(choice[1]) || /any number/i.test(choice[2] || "");
        amountValue = searchAmount(choice[2] || "one");
        quality = normalizeSearchQuality(choice[3] || "card");
      }
    }
  }

  return {
    libraryReference,
    upTo,
    amount: amountValue,
    quality,
    filter: parseQuality(quality),
    revealFound: /\breveal (?:it|that card|them|those cards|the chosen card)\b/i.test(source),
    shuffleAfter: /\bshuffle\b/i.test(source),
    destination: parseDestination(source),
    fullLibraryBrowse: true
  };
}

function parseLookInstruction(text) {
  const source = String(text || "").replace(/\s+/g, " ");

  let match = source.match(
    /\blook at the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of (your|target player'?s|that player'?s|their) library\b/i
  );

  if (match) {
    return {
      revealToAll: false,
      amount: Math.max(0, wordNumber(match[1])),
      libraryReference: match[2].toLowerCase(),
      allowBottom: /\bput any number of them on the bottom\b/i.test(source),
      allowReorder:
        /\bin any order\b/i.test(source) ||
        /\bput the rest on top\b/i.test(source)
    };
  }

  match = source.match(
    /\breveal the top (one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of (your|target player'?s|that player'?s|their) library\b/i
  );

  if (match) {
    return {
      revealToAll: true,
      amount: Math.max(0, wordNumber(match[1])),
      libraryReference: match[2].toLowerCase(),
      allowBottom: /\bput (?:the rest|any number of them) on the bottom\b/i.test(source),
      allowReorder: /\bin any order\b/i.test(source)
    };
  }

  return null;
}

function targetPlayerIds(item) {
  return unique(item?.targets)
    .filter((target) => target.startsWith("player:"))
    .map((target) => target.slice(7));
}

function referencedLibraryOwner(room, item, reference, deps) {
  if (reference === "your") {
    return findPlayer(room, item?.controllerId, deps);
  }

  const targetId = targetPlayerIds(item)[0];
  return (
    findPlayer(room, targetId, deps) ||
    findPlayer(room, item?.controllerId, deps)
  );
}

function snapshotZones(room) {
  return Object.fromEntries(
    room.players.map((player) => [
      player.id,
      {
        library: player.game?.library?.length || 0,
        hand: player.game?.hand?.length || 0,
        battlefield: player.game?.battlefield?.length || 0,
        graveyard: player.game?.graveyard?.length || 0,
        exile: player.game?.exile?.length || 0
      }
    ])
  );
}

function relevantZoneChanged(before, after, playerId) {
  const first = before?.[playerId];
  const second = after?.[playerId];
  if (!first || !second) return false;

  return Object.keys(first).some(
    (zone) => Number(first[zone]) !== Number(second[zone])
  );
}

function afterResolve(room, item, beforeZones, result, deps) {
  if (!result || !item || item.v59HiddenHandled) return result;

  const text = [
    String(item.text || ""),
    item.card ? oracle(item.card, deps) : ""
  ].filter(Boolean).join("\n");

  const afterZones = snapshotZones(room);
  const search = parseSearchInstruction(text);

  if (search) {
    const owner = referencedLibraryOwner(
      room,
      item,
      search.libraryReference,
      deps
    );
    const searcher = findPlayer(room, item.controllerId, deps);

    if (
      owner &&
      searcher &&
      !relevantZoneChanged(beforeZones, afterZones, owner.id)
    ) {
      createSearchSession(
        room,
        {
          searcherId: searcher.id,
          libraryOwnerId: owner.id,
          sourceControllerId: searcher.id,
          sourceStackItemId: item.id,
          sourceName: item.name || item.card?.name || "Search effect",
          filter: search.filter,
          min: search.upTo ? 0 : search.amount,
          max: search.amount,
          upTo: search.upTo,
          revealFound: search.revealFound,
          shuffleAfter: search.shuffleAfter,
          destination: search.destination,
          destinationPlayerId:
            /\b(?:into|in) your hand\b|\bunder your control\b/i.test(text)
              ? searcher.id
              : owner.id
        },
        deps
      );

      item.v59HiddenHandled = true;
    }
  } else {
    const look = parseLookInstruction(text);
    if (look) {
      const owner = referencedLibraryOwner(
        room,
        item,
        look.libraryReference,
        deps
      );
      const viewer = findPlayer(room, item.controllerId, deps);

      if (
        owner &&
        viewer &&
        !relevantZoneChanged(beforeZones, afterZones, owner.id)
      ) {
        createLookSession(
          room,
          {
            viewerId: viewer.id,
            libraryOwnerId: owner.id,
            sourceControllerId: viewer.id,
            sourceStackItemId: item.id,
            sourceName: item.name || item.card?.name || "Look effect",
            amount: look.amount,
            allowBottom: look.allowBottom,
            allowReorder: look.allowReorder,
            revealToAll: look.revealToAll
          },
          deps
        );

        item.v59HiddenHandled = true;
      }
    }
  }

  return result;
}

function pendingForViewer(room, viewerId, deps) {
  const state = normalizeState(room);
  const session = state.sessions.find(
    (entry) =>
      entry.status === "open" &&
      (
        entry.playerId === viewerId ||
        room.hostId === viewerId
      )
  );

  if (!session) {
    return {
      success: true,
      version: "62.5.0",
      session: null
    };
  }

  if (session.kind === "search") {
    return {
      success: true,
      version: "62.5.0",
      session: {
        id: session.id,
        kind: session.kind,
        playerId: session.playerId,
        originalSearcherId: session.originalSearcherId,
        libraryOwnerId: session.libraryOwnerId,
        sourceName: session.sourceName,
        filter: clone(session.filter),
        min: session.min,
        max: session.max,
        upTo: session.upTo,
        allowFail: session.allowFail,
        mandatoryQuantity: session.mandatoryQuantity,
        revealFound: session.revealFound,
        shuffleAfter: session.shuffleAfter,
        searchTopLimit: session.searchTopLimit,
        destination: clone(session.destination),
        destinationPlayerId: session.destinationPlayerId,
        libraryCount:
          findPlayer(room, session.libraryOwnerId, deps)?.game?.library?.length || 0,
        candidates: candidateCards(room, session, deps)
      }
    };
  }

  return {
    success: true,
    version: "62.5.0",
    session: {
      id: session.id,
      kind: session.kind,
      playerId: session.playerId,
      libraryOwnerId: session.libraryOwnerId,
      sourceName: session.sourceName,
      amount: session.amount,
      allowReorder: session.allowReorder,
      allowBottom: session.allowBottom,
      revealToAll: session.revealToAll,
      cards: sessionCards(room, session, deps).map((card) => ({
        cardId: card.id,
        name: cardName(card),
        typeLine: typeLine(card, deps),
        card: deps.publicCard(card)
      }))
    }
  };
}

function visibleReveals(room, viewerId) {
  const now = Date.now();

  return normalizeState(room).reveals.filter((entry) => {
    if (
      entry.expires === "brief" &&
      now - Date.parse(entry.createdAt) > 30000
    ) {
      return false;
    }

    return (
      entry.viewers === "all" ||
      entry.viewers === viewerId ||
      list(entry.viewers).includes(viewerId)
    );
  });
}

function stateForViewer(room, viewerId, deps) {
  const state = normalizeState(room);

  state.reveals = state.reveals.filter((entry) => {
    if (entry.expires !== "brief") return true;
    return Date.now() - Date.parse(entry.createdAt) <= 30000;
  });

  return {
    success: true,
    version: "62.5.0",
    phase: deps.PHASES[room.turn?.phaseIndex || 0] || "",
    isHost: room.hostId === viewerId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      libraryCount: player.game?.library?.length || 0,
      handCount: player.game?.hand?.length || 0,
      shuffleCount: Number(state.shuffleCounts[player.id]) || 0,
      searchRestrictions: searchRestrictions(room, player.id, deps)
    })),
    reveals: visibleReveals(room, viewerId).map((entry) => clone(entry)),
    openSessions: state.sessions.map((session) => ({
      id: session.id,
      kind: session.kind,
      playerId: session.playerId,
      originalSearcherId: session.originalSearcherId,
      libraryOwnerId: session.libraryOwnerId,
      sourceName: session.sourceName,
      createdAt: session.createdAt
    })),
    history: state.history.slice(-50).reverse()
  };
}

function processGameAction(room, actor, action, legacy, deps) {
  const state = normalizeState(room);
  const type = String(action?.type || "");

  if (type === "hidden-v59-resolve-search") {
    return resolveSearchSession(room, actor, action, deps);
  }

  if (type === "hidden-v59-resolve-look") {
    return resolveLookSession(room, actor, action, deps);
  }

  if (type === "hidden-v59-create-search") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can create a manual library search."
      };
    }

    return createSearchSession(
      room,
      {
        searcherId: action?.searcherId,
        libraryOwnerId: action?.libraryOwnerId,
        sourceControllerId: actor.id,
        sourceName: action?.sourceName || "Manual search",
        filter: parseQuality(action?.quality || ""),
        min: Math.max(0, Number(action?.min) || 0),
        max: Math.max(0, Number(action?.max) || 1),
        upTo: Boolean(action?.upTo),
        revealFound: Boolean(action?.revealFound),
        shuffleAfter: action?.shuffleAfter !== false,
        destination: {
          zone: action?.destinationZone || "hand",
          tapped: Boolean(action?.tapped),
          controllerId: action?.destinationControllerId || null
        },
        destinationPlayerId:
          action?.destinationPlayerId ||
          action?.libraryOwnerId,
        ignoreRestrictions: Boolean(action?.ignoreRestrictions),
        ignoreControlSearch: Boolean(action?.ignoreControlSearch)
      },
      deps
    );
  }

  if (type === "hidden-v59-create-look") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can create a manual look/reveal session."
      };
    }

    return createLookSession(
      room,
      {
        viewerId: action?.viewerId,
        libraryOwnerId: action?.libraryOwnerId,
        sourceControllerId: actor.id,
        sourceName: action?.sourceName || "Manual look",
        amount: Math.max(0, Number(action?.amount) || 1),
        allowBottom: Boolean(action?.allowBottom),
        allowReorder: Boolean(action?.allowReorder),
        revealToAll: Boolean(action?.revealToAll)
      },
      deps
    );
  }

  if (type === "hidden-v59-shuffle") {
    const target = findPlayer(room, action?.playerId || actor.id, deps);

    if (!target) {
      return {
        success: false,
        error: "That library is unavailable."
      };
    }

    if (
      target.id !== actor.id &&
      room.hostId !== actor.id
    ) {
      return {
        success: false,
        error: "You may shuffle only your own library."
      };
    }

    return shuffleLibrary(
      room,
      target,
      deps,
      action?.reason || "manual shuffle"
    );
  }

  if (type === "hidden-v59-reveal-hand") {
    return revealHand(room, actor, action, deps);
  }

  if (type === "hidden-v59-clear-reveal") {
    return clearReveal(room, actor, action);
  }

  if (
    state.sessions.length &&
    ![
      "judge-action",
      "undo-last",
      "check-state-based"
    ].includes(type)
  ) {
    const waiting = findPlayer(room, state.sessions[0].playerId, deps);
    return {
      success: false,
      error: `${waiting?.name || "A player"} must finish a hidden-information choice.`
    };
  }

  return legacy(room, actor, action);
}

function summary(room) {
  const state = normalizeState(room);

  return {
    version: "62.5.0",
    openHiddenSessions: state.sessions.length,
    activeReveals: state.reveals.length,
    totalShuffles: Object.values(state.shuffleCounts)
      .reduce((sum, value) => sum + Number(value || 0), 0),
    historyEntries: state.history.length
  };
}

function createHiddenSearchEngine(deps) {
  return {
    version: "62.5.0",

    processGameAction(room, actor, action, legacy) {
      return processGameAction(room, actor, action, legacy, deps);
    },

    beforeZones(room) {
      return snapshotZones(room);
    },

    afterResolve(room, item, beforeZones, result) {
      return afterResolve(room, item, beforeZones, result, deps);
    },

    state(room, viewerId) {
      return stateForViewer(room, viewerId, deps);
    },

    pending(room, viewerId) {
      return pendingForViewer(room, viewerId, deps);
    },

    summary(room) {
      return summary(room);
    },

    status() {
      return {
        success: true,
        version: "62.5.0",
        automatic: [
          "private per-player library search sessions",
          "library-owner and searcher separation",
          "searching another player's library",
          "search restrictions that prohibit all library searches",
          "opponent-only search prohibitions",
          "Aven Mindcensor-style top-card search limits",
          "Opposition Agent-style search-choice control foundation",
          "legal fail-to-find handling for hidden-zone searches with a stated quality",
          "mandatory quantity searches when no quality is stated",
          "up-to-N searches",
          "card-name, type, supertype, subtype, color and mana-value filters",
          "basic-land, nonland, permanent and legendary filters",
          "search destinations including hand, battlefield, graveyard, exile, top and bottom",
          "tapped battlefield entry from a search",
          "revealing found cards to all players",
          "private look-at-top-card sessions",
          "public reveal-top-card sessions",
          "top and bottom placement",
          "top-card reordering",
          "secure Fisher-Yates library shuffling",
          "shuffle counters and replay history",
          "clearing known-top and revealed-library information after a shuffle",
          "manual hand reveal",
          "common Oracle search-text detection after stack resolution",
          "common look-at-top and reveal-top text detection",
          "hidden candidate data withheld from public room state"
        ],
        assisted: [
          "search effects with several independent search instructions in one resolution",
          "searches for cards outside the game",
          "search taxes requiring mana payment before the search",
          "Opposition Agent exile-and-play permissions after cards are found",
          "Panglacial Wurm-style casting while a library is being searched",
          "search filters based on dynamic characteristics or information outside Oracle text",
          "effects that reveal cards until a condition is met",
          "complex Fact or Fiction-style piles and opponent-separated hidden choices",
          "simultaneous hidden-zone choices by several players",
          "cards whose older automation already performs a search without exposing a detectable zone change"
        ]
      };
    }
  };
}

module.exports = {
  createHiddenSearchEngine,
  _test: {
    normalizeState,
    parseQuality,
    filterHasQuality,
    cardMatchesFilter,
    searchRestrictions,
    candidateCards,
    shuffleLibrary,
    createSearchSession,
    createLookSession,
    resolveSearchSession,
    resolveLookSession,
    addReveal,
    revealHand,
    parseDestination,
    parseSearchInstruction,
    parseLookInstruction,
    snapshotZones,
    afterResolve,
    visibleReveals
  }
};
