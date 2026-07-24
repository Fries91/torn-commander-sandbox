"use strict";

const ZONES = [
  "library",
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "commandZone"
];

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
  room.commanderV55 =
    room.commanderV55 && typeof room.commanderV55 === "object"
      ? room.commanderV55
      : {};

  const state = room.commanderV55;
  state.choices = list(state.choices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-60);
  state.registry =
    state.registry && typeof state.registry === "object"
      ? state.registry
      : {};
  state.taxByCommander =
    state.taxByCommander && typeof state.taxByCommander === "object"
      ? state.taxByCommander
      : {};
  state.damageByPlayer =
    state.damageByPlayer && typeof state.damageByPlayer === "object"
      ? state.damageByPlayer
      : {};
  state.companionTaken =
    state.companionTaken && typeof state.companionTaken === "object"
      ? state.companionTaken
      : {};
  state.pairValidation =
    state.pairValidation && typeof state.pairValidation === "object"
      ? state.pairValidation
      : {};
  state.lastLocations =
    state.lastLocations && typeof state.lastLocations === "object"
      ? state.lastLocations
      : {};
  state.lastError = state.lastError || null;
  return state;
}

function currentFace(card, deps) {
  return deps.currentCardFace(card) || card?.cardData || {};
}

function typeLine(card, deps) {
  return String(deps.currentTypeLine(card) || "");
}

function oracle(card, deps) {
  return String(deps.currentOracleText(card) || "");
}

function cardName(card) {
  return String(card?.name || card?.cardData?.name || "Commander");
}

function activePlayers(room) {
  return room.players.filter(
    (player) => player.game && !player.game.lost && !player.game.conceded
  );
}

function ownerOf(room, card, deps) {
  return deps.findPlayer(room, card?.ownerId) || null;
}

function findCardEverywhere(room, cardId) {
  const wanted = String(cardId || "");

  for (const player of room.players) {
    if (!player.game) continue;

    for (const zone of ZONES) {
      const index = list(player.game[zone]).findIndex(
        (card) => card.id === wanted
      );
      if (index >= 0) {
        return {
          player,
          card: player.game[zone][index],
          zone,
          index,
          stackItem: null
        };
      }
    }

    if (player.game.companion?.id === wanted) {
      return {
        player,
        card: player.game.companion,
        zone: "companion",
        index: 0,
        stackItem: null
      };
    }
  }

  for (const stackItem of room.stack || []) {
    if (stackItem?.card?.id === wanted) {
      return {
        player:
          room.players.find(
            (entry) => entry.id === stackItem.controllerId
          ) || null,
        card: stackItem.card,
        zone: "stack",
        index: -1,
        stackItem
      };
    }
  }

  return null;
}

function allCommanderLocations(room) {
  const locations = [];

  for (const player of room.players) {
    if (!player.game) continue;

    for (const zone of ZONES) {
      for (let index = 0; index < list(player.game[zone]).length; index += 1) {
        const card = player.game[zone][index];
        if (!card.commander) continue;
        locations.push({
          player,
          card,
          zone,
          index,
          stackItem: null
        });
      }
    }
  }

  for (const stackItem of room.stack || []) {
    if (!stackItem?.card?.commander) continue;
    locations.push({
      player:
        room.players.find(
          (entry) => entry.id === stackItem.controllerId
        ) || null,
      card: stackItem.card,
      zone: "stack",
      index: -1,
      stackItem
    });
  }

  return locations;
}

function commanderProfile(card, deps) {
  const text = oracle(card, deps);
  const type = typeLine(card, deps);
  const partnerWith = text.match(/\bpartner with ([^.(\n]+)/i);

  return {
    cardId: card.id,
    name: cardName(card),
    legendary: /\bLegendary\b/i.test(type),
    creature: /\bCreature\b/i.test(type),
    planeswalker: /\bPlaneswalker\b/i.test(type),
    background:
      /\bEnchantment\b/i.test(type) &&
      /\bBackground\b/i.test(type),
    timeLordDoctor:
      /\bTime Lord\b/i.test(type) &&
      /\bDoctor\b/i.test(type),
    partner:
      /(?:^|\n)\s*Partner(?:\s*\([^)]*\))?\s*(?:\n|$)/i.test(text) &&
      !/\bpartner with\b/i.test(text),
    partnerWith: partnerWith
      ? partnerWith[1].trim()
      : "",
    friendsForever: /\bfriends forever\b/i.test(text),
    chooseBackground: /\bchoose a Background\b/i.test(text),
    doctorsCompanion: /\bDoctor'?s companion\b/i.test(text),
    canBeCommander:
      /\bcan be your commander\b/i.test(text)
  };
}

function namesMatch(first, second) {
  return String(first || "")
    .trim()
    .toLocaleLowerCase("en-US") ===
    String(second || "")
      .trim()
      .toLocaleLowerCase("en-US");
}

function validateCommanderPair(cards, deps) {
  const commanders = list(cards).filter(Boolean);

  if (!commanders.length) {
    return {
      valid: false,
      kind: "missing",
      message: "No commander is registered."
    };
  }

  if (commanders.length === 1) {
    return {
      valid: true,
      kind: "single",
      message: "Single commander."
    };
  }

  if (commanders.length !== 2) {
    return {
      valid: false,
      kind: "too-many",
      message: "Official Commander normally allows one commander or one legal two-commander pair."
    };
  }

  const first = commanderProfile(commanders[0], deps);
  const second = commanderProfile(commanders[1], deps);

  if (first.partner && second.partner) {
    return {
      valid: true,
      kind: "partner",
      message: "Both commanders have Partner."
    };
  }

  if (first.friendsForever && second.friendsForever) {
    return {
      valid: true,
      kind: "friends-forever",
      message: "Both commanders have Friends forever."
    };
  }

  if (
    (first.chooseBackground && second.background) ||
    (second.chooseBackground && first.background)
  ) {
    return {
      valid: true,
      kind: "background",
      message: "Choose a Background pair."
    };
  }

  if (
    (first.doctorsCompanion && second.timeLordDoctor) ||
    (second.doctorsCompanion && first.timeLordDoctor)
  ) {
    return {
      valid: true,
      kind: "doctors-companion",
      message: "Doctor's companion paired with a Time Lord Doctor."
    };
  }

  if (
    (first.partnerWith &&
      namesMatch(first.partnerWith, second.name)) ||
    (second.partnerWith &&
      namesMatch(second.partnerWith, first.name))
  ) {
    return {
      valid: true,
      kind: "partner-with",
      message: "Named Partner with pair."
    };
  }

  return {
    valid: false,
    kind: "invalid-pair",
    message:
      "These two commanders do not form a supported Partner, Partner with, Friends forever, Choose a Background, or Doctor's companion pair."
  };
}

function registerCommanders(room, deps) {
  const state = normalizeState(room);

  for (const location of allCommanderLocations(room)) {
    const card = location.card;
    const owner = ownerOf(room, card, deps) || location.player;
    if (!owner) continue;

    state.registry[card.id] = {
      cardId: card.id,
      ownerId: owner.id,
      name: cardName(card),
      printedName:
        card.cardData?.name ||
        cardName(card),
      registeredAt:
        state.registry[card.id]?.registeredAt ||
        deps.nowIso()
    };

    if (!state.taxByCommander[card.id]) {
      const increment = Math.max(
        0,
        Number(room.formatRules?.commanderTaxIncrement) || 2
      );
      const legacyCasts =
        owner.game?.commandZone?.filter(
          (entry) => entry.commander
        ).length === 1
          ? Math.floor(
              (Number(owner.game.commanderTax) || 0) /
              Math.max(1, increment)
            )
          : 0;

      state.taxByCommander[card.id] = {
        cardId: card.id,
        ownerId: owner.id,
        name: cardName(card),
        castsFromCommandZone: Math.max(0, legacyCasts),
        tax: Math.max(0, legacyCasts * increment)
      };
    }

    for (const player of room.players) {
      if (!player.game) continue;
      state.damageByPlayer[player.id] =
        state.damageByPlayer[player.id] &&
        typeof state.damageByPlayer[player.id] === "object"
          ? state.damageByPlayer[player.id]
          : {};

      state.damageByPlayer[player.id][card.id] = Math.max(
        0,
        Number(state.damageByPlayer[player.id][card.id]) || 0
      );
    }
  }

  for (const player of room.players) {
    if (!player.game) continue;

    const commanders = allCommanderLocations(room)
      .filter(({ card }) => card.ownerId === player.id)
      .map(({ card }) => card)
      .filter(
        (card, index, collection) =>
          collection.findIndex((entry) => entry.id === card.id) === index
      );

    state.pairValidation[player.id] =
      validateCommanderPair(commanders, deps);
  }

  return state;
}

function taxRecord(room, card, deps) {
  registerCommanders(room, deps);
  const state = normalizeState(room);
  const increment = Math.max(
    0,
    Number(room.formatRules?.commanderTaxIncrement) || 2
  );

  const record =
    state.taxByCommander[card.id] ||
    {
      cardId: card.id,
      ownerId: card.ownerId,
      name: cardName(card),
      castsFromCommandZone: 0,
      tax: 0
    };

  record.castsFromCommandZone = Math.max(
    0,
    Number(record.castsFromCommandZone) || 0
  );
  record.tax = room.formatRules?.commanderTaxEnabled === false
    ? 0
    : record.castsFromCommandZone * increment;
  state.taxByCommander[card.id] = record;
  return record;
}

function commandZoneCastInfo(room, actor, action, deps) {
  const type = String(action?.type || "");
  const supported = new Set([
    "cast-card",
    "auto-cast-card",
    "mechanic-auto-cast",
    "casting-v50-cast",
    "attachments-v53-cast-aura"
  ]);

  if (!supported.has(type) || action?.fromZone !== "commandZone") {
    return null;
  }

  const located = deps.getCardFromZone(
    actor.game,
    "commandZone",
    String(action?.cardId || "")
  );
  if (!located?.card?.commander) return null;

  return {
    card: located.card,
    record: taxRecord(room, located.card, deps)
  };
}

function commanderPairError(room, actor, deps) {
  const validation =
    registerCommanders(room, deps).pairValidation[actor.id];

  if (
    validation?.valid ||
    room.format === "custom" &&
      (
        room.settings?.allowInvalidDecks ||
        room.formatRules?.allowInvalidDecks
      )
  ) {
    return "";
  }

  return validation?.message || "The commander configuration is invalid.";
}

function castCommander(
  room,
  actor,
  action,
  legacy,
  castInfo,
  deps
) {
  const pairError = commanderPairError(room, actor, deps);
  if (pairError) {
    return {
      success: false,
      error: pairError
    };
  }

  const previousLegacyTax =
    Number(actor.game.commanderTax) || 0;
  actor.game.commanderTax = castInfo.record.tax;

  let result;
  try {
    result = legacy(room, actor, action);
  } finally {
    actor.game.commanderTax = previousLegacyTax;
  }

  if (!result?.success) return result;

  const stillInCommandZone = actor.game.commandZone.some(
    (card) => card.id === castInfo.card.id
  );
  const onStack = room.stack?.some(
    (item) =>
      item.sourceCardId === castInfo.card.id ||
      item.card?.id === castInfo.card.id
  );

  if (!stillInCommandZone || onStack) {
    castInfo.record.castsFromCommandZone += 1;
    castInfo.record.tax =
      room.formatRules?.commanderTaxEnabled === false
        ? 0
        : castInfo.record.castsFromCommandZone *
          Math.max(
            0,
            Number(room.formatRules?.commanderTaxIncrement) || 2
          );

    const stackItem = room.stack?.find(
      (item) =>
        item.sourceCardId === castInfo.card.id ||
        item.card?.id === castInfo.card.id
    );
    if (stackItem) {
      stackItem.commanderV55 = {
        commanderCardId: castInfo.card.id,
        taxPaid:
          Math.max(
            0,
            castInfo.record.tax -
            Math.max(
              0,
              Number(room.formatRules?.commanderTaxIncrement) || 2
            )
          ),
        castNumber: castInfo.record.castsFromCommandZone
      };
    }

    deps.addLog(
      room,
      `${actor.name} cast ${cardName(castInfo.card)} from the command zone. Its next commander tax is {${castInfo.record.tax}}.`,
      "commander"
    );
  }

  return result;
}

function snapshotCommanderLocations(room) {
  const snapshot = {};

  for (const location of allCommanderLocations(room)) {
    snapshot[location.card.id] = {
      cardId: location.card.id,
      ownerId: location.card.ownerId,
      controllerId: location.card.controllerId,
      zone: location.zone,
      playerId: location.player?.id || null,
      name: cardName(location.card)
    };
  }

  return snapshot;
}

function removeCardFromLocation(location) {
  if (!location) return null;

  if (location.zone === "stack") {
    return null;
  }

  if (location.zone === "companion") {
    const card = location.player.game.companion;
    location.player.game.companion = null;
    return card;
  }

  const [card] = location.player.game[location.zone].splice(
    location.index,
    1
  );
  return card || null;
}

function resetCommanderForCommandZone(card) {
  card.controllerId = card.ownerId;
  card.tapped = false;
  card.counters = {};
  card.damageMarked = 0;
  card.deathtouchMarked = false;
  card.attacking = false;
  card.defendingPlayerId = null;
  card.defendingPermanentId = null;
  card.blockingCardId = null;
  card.attachedToId = null;
  card.summoningSick = false;
  card.phasedOut = false;
  card.faceDown = false;
  card.temporaryEffects = [];
  card.ruleEffects = [];
  card.manualKeywords = [];
  card.judgeOverrides = {};
  card.specialState = card.specialState || {};
  delete card.specialState.pendingCommanderZoneV55;
  return card;
}

function moveCommanderToCommandZone(room, cardId, deps) {
  const location = findCardEverywhere(room, cardId);
  if (!location?.card?.commander) {
    return {
      success: false,
      error: "That commander is no longer available."
    };
  }

  if (location.zone === "commandZone") {
    return {
      success: true,
      card: location.card
    };
  }

  if (location.zone === "stack") {
    const index = room.stack.findIndex(
      (item) =>
        item.id === location.stackItem?.id
    );
    if (index >= 0) room.stack.splice(index, 1);
  }

  const card =
    location.zone === "stack"
      ? location.stackItem.card
      : removeCardFromLocation(location);

  if (!card) {
    return {
      success: false,
      error: "The commander could not be moved."
    };
  }

  const owner = ownerOf(room, card, deps);
  if (!owner?.game) {
    return {
      success: false,
      error: "The commander's owner is unavailable."
    };
  }

  resetCommanderForCommandZone(card);

  if (
    !owner.game.commandZone.some(
      (entry) => entry.id === card.id
    )
  ) {
    owner.game.commandZone.unshift(card);
  }

  deps.addLog(
    room,
    `${cardName(card)} was moved to its owner's command zone.`,
    "commander"
  );

  return {
    success: true,
    card
  };
}

function existingZoneChoice(room, cardId) {
  return normalizeState(room).choices.find(
    (choice) =>
      choice.kind === "command-zone" &&
      choice.commanderCardId === cardId &&
      choice.status === "open"
  );
}

function createZoneChoice(
  room,
  card,
  destinationZone,
  timing,
  raw,
  deps
) {
  const existing = existingZoneChoice(room, card.id);
  if (existing) return existing;

  const owner = ownerOf(room, card, deps);
  if (!owner?.game) return null;

  const choice = {
    id: deps.createId(),
    status: "open",
    kind: "command-zone",
    playerId: owner.id,
    commanderCardId: card.id,
    commanderName: cardName(card),
    destinationZone,
    timing,
    currentZone: raw?.currentZone || null,
    pendingAction: raw?.pendingAction
      ? clone(raw.pendingAction)
      : null,
    pendingActorId: raw?.pendingActorId || null,
    createdAt: deps.nowIso()
  };

  normalizeState(room).choices.push(choice);
  card.specialState = card.specialState || {};
  card.specialState.pendingCommanderZoneV55 = choice.id;

  if (owner.isBot) {
    moveCommanderToCommandZone(room, card.id, deps);
    choice.status = "resolved";
    normalizeState(room).choices =
      normalizeState(room).choices.filter(
        (entry) => entry.status === "open"
      );
  }

  return choice;
}

function relevantDestination(zone) {
  return [
    "hand",
    "library",
    "graveyard",
    "exile"
  ].includes(zone);
}

function scanCommanderTransitions(
  room,
  before,
  deps
) {
  registerCommanders(room, deps);
  const after = snapshotCommanderLocations(room);

  for (const [cardId, location] of Object.entries(after)) {
    if (!relevantDestination(location.zone)) continue;
    if (before?.[cardId]?.zone === location.zone) continue;
    if (existingZoneChoice(room, cardId)) continue;

    const found = findCardEverywhere(room, cardId);
    if (!found?.card?.commander) continue;

    createZoneChoice(
      room,
      found.card,
      location.zone,
      ["graveyard", "exile"].includes(location.zone)
        ? "state-based"
        : "replacement-after-effect",
      {
        currentZone: location.zone
      },
      deps
    );
  }

  normalizeState(room).lastLocations = after;
  return after;
}

function explicitMoveCommander(
  room,
  actor,
  action,
  legacy,
  deps
) {
  if (
    action?.type !== "move-card" ||
    action?.toZone === "commandZone" ||
    !relevantDestination(action?.toZone)
  ) {
    return null;
  }

  const direct =
    deps.getCardFromZone(
      actor.game,
      String(action.fromZone || ""),
      String(action.cardId || "")
    )?.card ||
    findCardEverywhere(room, action.cardId)?.card;

  if (!direct?.commander) return null;

  if (["hand", "library"].includes(action.toZone)) {
    const choice = createZoneChoice(
      room,
      direct,
      action.toZone,
      "replacement",
      {
        currentZone: action.fromZone,
        pendingAction: action,
        pendingActorId: actor.id
      },
      deps
    );

    return {
      success: true,
      pendingCommanderChoice: Boolean(choice)
    };
  }

  const before = snapshotCommanderLocations(room);
  const result = legacy(room, actor, action);
  if (!result?.success) return result;

  scanCommanderTransitions(room, before, deps);
  return result;
}

function resolveZoneChoice(
  room,
  actor,
  action,
  legacy,
  deps
) {
  const state = normalizeState(room);
  const choice = state.choices.find(
    (entry) =>
      entry.id === action?.choiceId &&
      entry.kind === "command-zone" &&
      entry.status === "open"
  );

  if (!choice) {
    return {
      success: false,
      error: "That command-zone choice is unavailable."
    };
  }

  if (
    choice.playerId !== actor.id &&
    room.hostId !== actor.id
  ) {
    return {
      success: false,
      error: "That commander belongs to another player."
    };
  }

  let result = { success: true };

  if (action?.moveToCommandZone) {
    result = moveCommanderToCommandZone(
      room,
      choice.commanderCardId,
      deps
    );
  } else if (
    choice.timing === "replacement" &&
    choice.pendingAction
  ) {
    const pendingActor = deps.findPlayer(
      room,
      choice.pendingActorId
    );

    if (!pendingActor?.game) {
      return {
        success: false,
        error: "The original zone-change actor is unavailable."
      };
    }

    result = legacy(
      room,
      pendingActor,
      choice.pendingAction
    );
  }

  if (!result?.success) return result;

  const found = findCardEverywhere(
    room,
    choice.commanderCardId
  );
  if (found?.card?.specialState) {
    delete found.card.specialState.pendingCommanderZoneV55;
  }

  choice.status = "resolved";
  state.choices = state.choices.filter(
    (entry) => entry.status === "open"
  );

  deps.runStateBasedActions(room, "commander-zone-choice-v55");
  return { success: true };
}

function combatPhase(room, deps) {
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  return /combat|attack|block/i.test(phase);
}

function recordCommanderDamage(
  room,
  source,
  target,
  amount,
  deps
) {
  if (
    !source?.commander ||
    !target?.game ||
    amount <= 0 ||
    room.formatRules?.commanderDamageEnabled === false
  ) {
    return 0;
  }

  registerCommanders(room, deps);
  const state = normalizeState(room);
  state.damageByPlayer[target.id] =
    state.damageByPlayer[target.id] || {};

  const next =
    Math.max(
      0,
      Number(state.damageByPlayer[target.id][source.id]) || 0
    ) + Math.max(0, Math.floor(Number(amount) || 0));

  state.damageByPlayer[target.id][source.id] = next;

  const threshold = Math.max(
    1,
    Number(room.formatRules?.commanderDamageThreshold) || 21
  );

  const ownerId = source.ownerId;
  const ownerCommanders = Object.values(state.registry)
    .filter((entry) => entry.ownerId === ownerId)
    .map((entry) => entry.cardId);

  if (target.game.commanderDamage) {
    target.game.commanderDamage[ownerId] = ownerCommanders.reduce(
      (maximum, commanderId) =>
        Math.max(
          maximum,
          Number(
            state.damageByPlayer[target.id][commanderId]
          ) || 0
        ),
      0
    );
  }

  deps.addLog(
    room,
    `${cardName(source)} has dealt ${next}/${threshold} commander damage to ${target.name}.`,
    "commander"
  );

  if (next >= threshold && !target.game.lost) {
    target.game.lost = true;
    target.game.lossReason =
      `${target.name} was dealt ${next} combat damage by ${cardName(source)}.`;
    deps.addLog(
      room,
      `${target.name} lost to commander damage from ${cardName(source)}.`,
      "loss"
    );
  }

  return next;
}

function actualDamage(before, target, requested) {
  const lifeLoss = Math.max(
    0,
    Number(before.life) - Number(target.game.life)
  );
  const poisonGain = Math.max(
    0,
    Number(target.game.poison) - Number(before.poison)
  );

  if (lifeLoss || poisonGain) {
    return Math.max(lifeLoss, poisonGain);
  }

  return 0;
}

function wrapPlayerDamage(
  room,
  source,
  target,
  amount,
  legacy,
  deps
) {
  const before = {
    life: Number(target?.game?.life) || 0,
    poison: Number(target?.game?.poison) || 0
  };

  const result = legacy(
    room,
    source,
    target,
    amount
  );

  if (
    source?.commander &&
    source.attacking &&
    combatPhase(room, deps)
  ) {
    recordCommanderDamage(
      room,
      source,
      target,
      actualDamage(before, target, amount),
      deps
    );
  }

  return result;
}

function deckEntries(player) {
  return list(player?.deck?.cards).map((entry) => ({
    name: String(entry?.name || ""),
    quantity: Math.max(1, Number(entry?.quantity) || 1),
    cardData: entry?.cardData || null,
    typeLine: String(
      entry?.cardData?.typeLine ||
      entry?.cardData?.faces?.[0]?.typeLine ||
      ""
    ),
    oracleText: String(
      entry?.cardData?.oracleText ||
      entry?.cardData?.faces?.[0]?.oracleText ||
      ""
    ),
    manaCost: String(
      entry?.cardData?.manaCost ||
      entry?.cardData?.faces?.[0]?.manaCost ||
      ""
    ),
    manaValue: Number(
      entry?.cardData?.manaValue ??
      entry?.cardData?.cmc ??
      0
    ) || 0
  }));
}

function companionCandidates(player) {
  const candidates = [];
  const add = (name, cardData, source) => {
    const normalized = String(name || "").trim();
    if (!normalized) return;
    if (
      !/\bCompanion\b/i.test(
        String(
          cardData?.oracleText ||
          cardData?.faces?.[0]?.oracleText ||
          ""
        )
      ) &&
      !list(cardData?.keywords)
        .map(String)
        .some((keyword) => /^companion$/i.test(keyword))
    ) {
      return;
    }

    if (
      candidates.some(
        (entry) =>
          entry.name.toLocaleLowerCase("en-US") ===
          normalized.toLocaleLowerCase("en-US")
      )
    ) {
      return;
    }

    candidates.push({
      name: normalized,
      cardData: cardData || null,
      source
    });
  };

  add(
    player?.deck?.companion,
    player?.deck?.companionData,
    "deck-companion"
  );

  for (const entry of list(player?.deck?.companions)) {
    add(
      entry?.name || entry,
      entry?.cardData,
      "deck-companions"
    );
  }

  for (const entry of list(player?.deck?.cards)) {
    add(
      entry?.name,
      entry?.cardData,
      "deck-list"
    );
  }

  return candidates;
}

function expandedStartingDeck(player, excludedName = "") {
  const entries = [];

  for (const entry of deckEntries(player)) {
    let quantity = entry.quantity;

    if (
      excludedName &&
      entry.name.toLocaleLowerCase("en-US") ===
        excludedName.toLocaleLowerCase("en-US")
    ) {
      quantity = Math.max(0, quantity - 1);
    }

    for (let index = 0; index < quantity; index += 1) {
      entries.push({ ...entry });
    }
  }

  for (const location of allCommanderLocations({
    players: [player],
    stack: []
  })) {
    entries.push({
      name: cardName(location.card),
      quantity: 1,
      cardData: location.card.cardData,
      typeLine: typeLine(location.card, {
        currentTypeLine: (card) =>
          card.cardData?.typeLine ||
          card.cardData?.faces?.[0]?.typeLine ||
          ""
      }),
      oracleText:
        location.card.cardData?.oracleText ||
        location.card.cardData?.faces?.[0]?.oracleText ||
        "",
      manaCost:
        location.card.cardData?.manaCost ||
        location.card.cardData?.faces?.[0]?.manaCost ||
        "",
      manaValue:
        Number(
          location.card.cardData?.manaValue ??
          location.card.cardData?.cmc ??
          0
        ) || 0
    });
  }

  return entries;
}

function nonland(entry) {
  return !/\bLand\b/i.test(entry.typeLine);
}

function permanent(entry) {
  return /\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/i
    .test(entry.typeLine);
}

function hasActivatedAbility(entry) {
  return /(^|\n)[^:\n]+:\s*/.test(entry.oracleText);
}

function repeatedColoredSymbol(manaCost) {
  const counts = {};
  for (const match of String(manaCost || "").matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1].toUpperCase();
    for (const color of ["W", "U", "B", "R", "G"]) {
      const appearances = symbol
        .split("/")
        .filter((part) => part === color).length;
      counts[color] = (counts[color] || 0) + appearances;
      if (counts[color] > 1) return true;
    }
  }
  return false;
}

function validateCompanion(
  room,
  player,
  companionName
) {
  const name = String(companionName || "").trim();
  const cards = expandedStartingDeck(player, name);
  const lower = name.toLocaleLowerCase("en-US");
  const errors = [];

  if (lower.includes("gyruda")) {
    const invalid = cards.filter(
      (entry) => Math.floor(entry.manaValue) % 2 !== 0
    );
    if (invalid.length) {
      errors.push(
        `${invalid[0].name} has an odd mana value.`
      );
    }
  } else if (lower.includes("jegantha")) {
    const invalid = cards.find(
      (entry) => repeatedColoredSymbol(entry.manaCost)
    );
    if (invalid) {
      errors.push(
        `${invalid.name} repeats a colored mana symbol in its mana cost.`
      );
    }
  } else if (lower.includes("kaheera")) {
    const allowed = /\b(?:Cat|Elemental|Nightmare|Dinosaur|Beast)\b/i;
    const invalid = cards.find(
      (entry) =>
        /\bCreature\b/i.test(entry.typeLine) &&
        !allowed.test(entry.typeLine)
    );
    if (invalid) {
      errors.push(
        `${invalid.name} is not an allowed Kaheera creature type.`
      );
    }
  } else if (lower.includes("keruga")) {
    const invalid = cards.find(
      (entry) =>
        nonland(entry) &&
        Math.floor(entry.manaValue) < 3
    );
    if (invalid) {
      errors.push(
        `${invalid.name} has mana value below 3.`
      );
    }
  } else if (lower.includes("lurrus")) {
    const invalid = cards.find(
      (entry) =>
        permanent(entry) &&
        !/\bLand\b/i.test(entry.typeLine) &&
        Math.floor(entry.manaValue) > 2
    );
    if (invalid) {
      errors.push(
        `${invalid.name} is a permanent card with mana value above 2.`
      );
    }
  } else if (lower.includes("lutri")) {
    const seen = new Set();
    const invalid = cards.find((entry) => {
      if (!nonland(entry)) return false;
      const key = entry.name.toLocaleLowerCase("en-US");
      if (seen.has(key)) return true;
      seen.add(key);
      return false;
    });
    if (invalid) {
      errors.push(
        `${invalid.name} is a repeated nonland card.`
      );
    }
  } else if (lower.includes("obosh")) {
    const invalid = cards.find(
      (entry) =>
        nonland(entry) &&
        Math.floor(entry.manaValue) % 2 !== 1
    );
    if (invalid) {
      errors.push(
        `${invalid.name} does not have an odd mana value.`
      );
    }
  } else if (lower.includes("umori")) {
    const typeSets = cards
      .filter(nonland)
      .map((entry) => {
        const result = new Set();
        for (const type of [
          "Artifact",
          "Battle",
          "Creature",
          "Enchantment",
          "Instant",
          "Planeswalker",
          "Sorcery"
        ]) {
          if (new RegExp(`\\b${type}\\b`, "i").test(entry.typeLine)) {
            result.add(type);
          }
        }
        return result;
      });

    const shared = [
      "Artifact",
      "Battle",
      "Creature",
      "Enchantment",
      "Instant",
      "Planeswalker",
      "Sorcery"
    ].filter((type) =>
      typeSets.every((types) => types.has(type))
    );

    if (!shared.length) {
      errors.push(
        "The nonland cards do not all share one card type."
      );
    }
  } else if (lower.includes("yorion")) {
    const minimum = Math.max(
      0,
      Number(room.formatRules?.deckSize) || 100
    );
    if (cards.length < minimum + 20) {
      errors.push(
        `The starting deck has ${cards.length} cards; Yorion needs at least ${minimum + 20}.`
      );
    }
  } else if (lower.includes("zirda")) {
    const invalid = cards.find(
      (entry) =>
        permanent(entry) &&
        !/\bLand\b/i.test(entry.typeLine) &&
        !hasActivatedAbility(entry)
    );
    if (invalid) {
      errors.push(
        `${invalid.name} is a nonland permanent card without an activated ability.`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    checkedCards: cards.length
  };
}

function companionCardFromCandidate(
  actor,
  candidate,
  deps
) {
  const cardData = clone(candidate.cardData || {});
  const card = deps.migrateCard(
    {
      id: deps.createId(),
      name: candidate.name,
      ownerId: actor.id,
      controllerId: actor.id,
      tapped: false,
      counters: {},
      damageMarked: 0,
      token: false,
      commander: false,
      power:
        cardData.power ||
        cardData.faces?.[0]?.power ||
        "",
      toughness:
        cardData.toughness ||
        cardData.faces?.[0]?.toughness ||
        "",
      specialState: {
        companionV55: true,
        designatedAtV55: deps.nowIso()
      },
      cardData
    },
    actor.id
  );

  return card;
}

function removeImportedCompanionCopy(actor, name) {
  const lower = String(name || "")
    .toLocaleLowerCase("en-US");

  for (const zone of ["hand", "library"]) {
    const index = actor.game[zone].findIndex(
      (card) =>
        card.name.toLocaleLowerCase("en-US") === lower &&
        !card.commander
    );

    if (index >= 0) {
      actor.game[zone].splice(index, 1);
      return true;
    }
  }

  return false;
}

function designateCompanion(
  room,
  actor,
  action,
  deps
) {
  const state = normalizeState(room);

  if (state.companionTaken[actor.id]) {
    return {
      success: false,
      error: "The companion special action was already used."
    };
  }

  const candidate = companionCandidates(actor).find(
    (entry) =>
      entry.name.toLocaleLowerCase("en-US") ===
      String(action?.name || "").toLocaleLowerCase("en-US")
  );

  if (!candidate) {
    return {
      success: false,
      error: "That companion was not found in the imported deck data."
    };
  }

  const validation = validateCompanion(
    room,
    actor,
    candidate.name
  );

  const allowInvalid =
    room.format === "custom" &&
    (
      room.settings?.allowInvalidDecks ||
      room.formatRules?.allowInvalidDecks
    );

  if (!validation.valid && !allowInvalid) {
    return {
      success: false,
      error:
        validation.errors[0] ||
        "The companion restriction is not satisfied."
    };
  }

  actor.game.companion = companionCardFromCandidate(
    actor,
    candidate,
    deps
  );

  removeImportedCompanionCopy(
    actor,
    candidate.name
  );

  actor.game.companion.specialState.companionValidationV55 =
    validation;

  deps.addLog(
    room,
    `${actor.name} revealed ${candidate.name} as a companion.`,
    "commander"
  );

  return {
    success: true,
    validation
  };
}

function manaOutput(card, deps) {
  if (card.tapped || card.phasedOut) return 0;

  if (
    deps.isCreatureCard(card) &&
    card.summoningSick &&
    !/\bhaste\b/i.test(oracle(card, deps))
  ) {
    return 0;
  }

  const type = typeLine(card, deps);
  const text = oracle(card, deps);
  let maximum = 0;

  for (const basic of [
    "Plains",
    "Island",
    "Swamp",
    "Mountain",
    "Forest",
    "Wastes"
  ]) {
    if (new RegExp(`\\b${basic}\\b`, "i").test(type)) {
      maximum = Math.max(maximum, 1);
    }
  }

  for (const match of text.matchAll(
    /\{T\}[^.]*:\s*Add\s+([^.;\n]+)/gi
  )) {
    const output = String(match[1] || "");
    const symbols = [
      ...output.matchAll(/\{([WUBRGC])\}/gi)
    ];

    if (symbols.length) {
      maximum = Math.max(
        maximum,
        /\bor\b/i.test(output)
          ? 1
          : symbols.length
      );
    } else if (
      /one mana of any color/i.test(output)
    ) {
      maximum = Math.max(maximum, 1);
    }
  }

  return maximum;
}

function payCompanionThree(room, actor, deps) {
  const snapshot = clone(actor.game);
  let remaining = 3;

  for (const color of ["W", "U", "B", "R", "G", "C"]) {
    const available =
      Number(actor.game.manaPool?.[color]) || 0;
    const spent = Math.min(available, remaining);
    actor.game.manaPool[color] = available - spent;
    remaining -= spent;
    if (remaining <= 0) break;
  }

  const selected = (actor.game.battlefield || [])
    .map((card) => ({
      card,
      output: manaOutput(card, deps)
    }))
    .filter((entry) => entry.output > 0)
    .sort((first, second) => second.output - first.output);

  for (const source of selected) {
    if (remaining <= 0) break;
    source.card.tapped = true;
    remaining -= source.output;
  }

  if (remaining > 0) {
    actor.game = snapshot;
    return {
      success: false,
      error: "Auto-pay could not produce {3} for the companion special action."
    };
  }

  return {
    success: true
  };
}

function companionTimingError(room, actor, deps) {
  const phase =
    deps.PHASES[room.turn?.phaseIndex || 0] || "";

  if (room.turn?.activePlayerId !== actor.id) {
    return "The companion special action requires your turn.";
  }
  if (!["Main 1", "Main 2"].includes(phase)) {
    return "The companion special action requires one of your main phases.";
  }
  if (room.stack?.length) {
    return "The companion special action requires an empty stack.";
  }
  if (
    room.priority?.playerId &&
    room.priority.playerId !== actor.id
  ) {
    return "You do not currently have priority.";
  }

  return "";
}

function takeCompanion(
  room,
  actor,
  deps
) {
  const state = normalizeState(room);
  const timingError = companionTimingError(
    room,
    actor,
    deps
  );
  if (timingError) {
    return {
      success: false,
      error: timingError
    };
  }

  if (state.companionTaken[actor.id]) {
    return {
      success: false,
      error: "The companion special action can be taken only once per game."
    };
  }

  const companion = actor.game.companion;
  if (!companion) {
    return {
      success: false,
      error: "No companion is currently revealed."
    };
  }

  const validation =
    companion.specialState?.companionValidationV55 ||
    validateCompanion(
      room,
      actor,
      companion.name
    );

  const allowInvalid =
    room.format === "custom" &&
    (
      room.settings?.allowInvalidDecks ||
      room.formatRules?.allowInvalidDecks
    );

  if (!validation.valid && !allowInvalid) {
    return {
      success: false,
      error:
        validation.errors[0] ||
        "The companion restriction is not satisfied."
    };
  }

  const payment = payCompanionThree(
    room,
    actor,
    deps
  );
  if (!payment.success) return payment;

  actor.game.companion = null;
  companion.controllerId = actor.id;
  companion.specialState = companion.specialState || {};
  companion.specialState.companionTakenV55 = true;
  companion.specialState.companionTakenAtV55 =
    deps.nowIso();
  actor.game.hand.push(companion);

  state.companionTaken[actor.id] = true;

  deps.addLog(
    room,
    `${actor.name} paid {3} and put ${companion.name} into their hand from outside the game.`,
    "commander"
  );

  return {
    success: true,
    cardId: companion.id
  };
}

function commandZoneCardsForPlayer(room, playerId) {
  return allCommanderLocations(room)
    .filter(({ card }) => card.ownerId === playerId)
    .map(({ card }) => card)
    .filter(
      (card, index, collection) =>
        collection.findIndex(
          (entry) => entry.id === card.id
        ) === index
    );
}

function stateForViewer(
  room,
  viewerId,
  deps
) {
  const state = registerCommanders(room, deps);
  const viewer = deps.findPlayer(room, viewerId);

  if (!viewer?.game) {
    return {
      success: true,
      version: "55.0.0",
      commanders: [],
      damageMatrix: [],
      companion: null
    };
  }

  const commanders = Object.values(state.registry)
    .map((entry) => {
      const location = findCardEverywhere(
        room,
        entry.cardId
      );
      const record = state.taxByCommander[entry.cardId];

      return {
        ...entry,
        zone: location?.zone || "unknown",
        controllerId:
          location?.card?.controllerId ||
          entry.ownerId,
        card:
          location?.card
            ? deps.publicCard(location.card)
            : null,
        castsFromCommandZone:
          Number(record?.castsFromCommandZone) || 0,
        tax: Number(record?.tax) || 0
      };
    })
    .sort((a, b) =>
      a.ownerId.localeCompare(b.ownerId) ||
      a.name.localeCompare(b.name)
    );

  const damageMatrix = room.players.map((target) => ({
    playerId: target.id,
    playerName: target.name,
    lost: Boolean(target.game?.lost),
    damage: commanders.map((commander) => ({
      commanderCardId: commander.cardId,
      commanderName: commander.name,
      ownerId: commander.ownerId,
      amount:
        Number(
          state.damageByPlayer[target.id]?.[
            commander.cardId
          ]
        ) || 0
    }))
  }));

  const companion =
    viewer.game.companion
      ? {
          card: deps.publicCard(viewer.game.companion),
          validation:
            viewer.game.companion.specialState
              ?.companionValidationV55 ||
            validateCompanion(
              room,
              viewer,
              viewer.game.companion.name
            ),
          taken: Boolean(
            state.companionTaken[viewer.id]
          )
        }
      : null;

  return {
    success: true,
    version: "55.0.0",
    phase:
      deps.PHASES[room.turn?.phaseIndex || 0] || "",
    activePlayerId:
      room.turn?.activePlayerId || null,
    commanderDamageThreshold: Math.max(
      1,
      Number(
        room.formatRules?.commanderDamageThreshold
      ) || 21
    ),
    commanders,
    playerPairValidation:
      clone(state.pairValidation),
    viewerPairValidation:
      clone(state.pairValidation[viewer.id]),
    damageMatrix,
    companion,
    companionCandidates: companionCandidates(viewer).map(
      (candidate) => ({
        name: candidate.name,
        source: candidate.source,
        cardData: candidate.cardData,
        validation: validateCompanion(
          room,
          viewer,
          candidate.name
        )
      })
    ),
    companionActionUsed: Boolean(
      state.companionTaken[viewer.id]
    )
  };
}

function pendingForViewer(
  room,
  viewerId,
  deps
) {
  const choice = normalizeState(room).choices.find(
    (entry) =>
      entry.status === "open" &&
      (
        entry.playerId === viewerId ||
        room.hostId === viewerId
      )
  );

  if (!choice) {
    return {
      success: true,
      version: "55.0.0",
      choice: null
    };
  }

  const location = findCardEverywhere(
    room,
    choice.commanderCardId
  );

  return {
    success: true,
    version: "55.0.0",
    choice: {
      ...choice,
      card:
        location?.card
          ? deps.publicCard(location.card)
          : null
    }
  };
}

function processGameAction(
  room,
  actor,
  action,
  legacy,
  deps
) {
  registerCommanders(room, deps);
  const state = normalizeState(room);
  const type = String(action?.type || "");

  if (type === "commander-v55-resolve-zone") {
    return resolveZoneChoice(
      room,
      actor,
      action,
      legacy,
      deps
    );
  }

  if (type === "commander-v55-designate-companion") {
    return designateCompanion(
      room,
      actor,
      action,
      deps
    );
  }

  if (type === "commander-v55-take-companion") {
    return takeCompanion(
      room,
      actor,
      deps
    );
  }

  if (type === "commander-v55-return") {
    const cardId = String(action?.cardId || "");
    const location = findCardEverywhere(room, cardId);

    if (
      !location?.card?.commander ||
      location.card.ownerId !== actor.id
    ) {
      return {
        success: false,
        error: "Choose one of your commanders."
      };
    }

    return moveCommanderToCommandZone(
      room,
      cardId,
      deps
    );
  }

  if (
    state.choices.length &&
    ![
      "judge-action",
      "undo-last",
      "check-state-based"
    ].includes(type)
  ) {
    const waiting = deps.findPlayer(
      room,
      state.choices[0].playerId
    );
    return {
      success: false,
      error: `${waiting?.name || "A player"} must finish a command-zone choice.`
    };
  }

  const castInfo = commandZoneCastInfo(
    room,
    actor,
    action,
    deps
  );
  if (castInfo) {
    return castCommander(
      room,
      actor,
      action,
      legacy,
      castInfo,
      deps
    );
  }

  const explicit = explicitMoveCommander(
    room,
    actor,
    action,
    legacy,
    deps
  );
  if (explicit) return explicit;

  const before = snapshotCommanderLocations(room);
  const result = legacy(room, actor, action);
  if (!result?.success) return result;

  scanCommanderTransitions(room, before, deps);
  registerCommanders(room, deps);
  return result;
}

function afterResolve(
  room,
  before,
  result,
  deps
) {
  if (!result) return result;

  scanCommanderTransitions(
    room,
    before,
    deps
  );
  registerCommanders(room, deps);
  return result;
}

function summary(room, deps) {
  const state = registerCommanders(room, deps);

  return {
    version: "55.0.0",
    registeredCommanders:
      Object.keys(state.registry).length,
    pendingCommandZoneChoices:
      state.choices.length,
    companionsTaken:
      Object.values(state.companionTaken)
        .filter(Boolean).length,
    invalidCommanderPairs:
      Object.values(state.pairValidation)
        .filter((entry) => !entry.valid).length
  };
}

function createCommanderRulesEngine(deps) {
  return {
    version: "55.0.0",

    processGameAction(room, actor, action, legacy) {
      return processGameAction(
        room,
        actor,
        action,
        legacy,
        deps
      );
    },

    snapshot(room) {
      registerCommanders(room, deps);
      return snapshotCommanderLocations(room);
    },

    afterResolve(room, before, result) {
      return afterResolve(
        room,
        before,
        result,
        deps
      );
    },

    playerDamage(
      room,
      source,
      target,
      amount,
      legacy
    ) {
      return wrapPlayerDamage(
        room,
        source,
        target,
        amount,
        legacy,
        deps
      );
    },

    state(room, viewerId) {
      return stateForViewer(
        room,
        viewerId,
        deps
      );
    },

    pending(room, viewerId) {
      return pendingForViewer(
        room,
        viewerId,
        deps
      );
    },

    summary(room) {
      return summary(room, deps);
    },

    status() {
      return {
        success: true,
        version: "55.0.0",
        automatic: [
          "stable commander identity across control and zone changes",
          "separate commander-tax history for every commander card",
          "Partner commanders receiving separate commander taxes",
          "commander tax added to normal, alternative and free command-zone casts",
          "hand and library command-zone replacement prompts",
          "graveyard and exile state-based command-zone prompts",
          "commander damage tracked by individual physical commander card",
          "21-damage loss using the room's configured threshold",
          "commander damage preserved across control and copy changes",
          "Partner pair validation",
          "Partner with named-pair validation",
          "Friends forever validation",
          "Choose a Background validation",
          "Doctor's companion and Time Lord Doctor validation",
          "companion pregame designation from imported companion data",
          "known companion starting-deck restriction checks",
          "once-per-game companion special action",
          "sorcery timing and automatic {3} companion payment"
        ],
        assisted: [
          "Commander Draft partner rules",
          "Rule Zero pairs outside official Partner variants",
          "companions with future or card-specific deck restrictions",
          "outside-the-game cards other than companions",
          "command-zone replacement effects combined with unusual zone-change replacements",
          "commander damage after uncommon damage-to-resource replacement effects",
          "effects that make a noncommander card become a commander during the game",
          "Background granted abilities requiring card-specific scripts"
        ]
      };
    }
  };
}

module.exports = {
  createCommanderRulesEngine,
  _test: {
    commanderProfile,
    validateCommanderPair,
    registerCommanders,
    taxRecord,
    commandZoneCastInfo,
    snapshotCommanderLocations,
    moveCommanderToCommandZone,
    createZoneChoice,
    scanCommanderTransitions,
    resolveZoneChoice,
    recordCommanderDamage,
    validateCompanion,
    companionCandidates,
    designateCompanion,
    manaOutput,
    takeCompanion,
    stateForViewer
  }
};
