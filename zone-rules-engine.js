"use strict";

const NUMBER_WORDS = {
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
  eleven: 11,
  twelve: 12
};

const ZONE_DESTINATIONS = new Set([
  "hand",
  "battlefield",
  "graveyard",
  "exile",
  "library-top",
  "library-bottom"
]);

function numberFrom(value, fallback = 1) {
  const text = String(value || "").trim().toLocaleLowerCase("en-US");
  if (/^\d+$/.test(text)) return Math.max(0, Number(text));
  return NUMBER_WORDS[text] ?? fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueIds(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function normalizeChoiceState(room) {
  room.zoneChoices = list(room.zoneChoices)
    .filter((choice) => choice && choice.id && choice.playerId && choice.status !== "resolved")
    .slice(-40);
  return room.zoneChoices;
}

function pendingChoices(room) {
  return normalizeChoiceState(room).filter((choice) => choice.status === "open");
}

function pendingForPlayer(room, playerId) {
  return pendingChoices(room).filter((choice) => choice.playerId === playerId);
}

function manaValue(card) {
  const direct =
    card?.cardData?.manaValue ??
    card?.cardData?.cmc ??
    card?.manaValue ??
    card?.cmc;
  const numeric = Number(direct);
  if (Number.isFinite(numeric)) return numeric;

  const cost = String(card?.cardData?.manaCost || "");
  let total = 0;
  for (const token of cost.match(/\{([^}]+)\}/g) || []) {
    const value = token.slice(1, -1).toUpperCase();
    if (/^\d+$/.test(value)) total += Number(value);
    else if (value === "X") total += 0;
    else total += 1;
  }
  return total;
}

function colorIdentity(card) {
  const direct = card?.cardData?.colorIdentity || card?.colorIdentity || [];
  return Array.isArray(direct)
    ? direct.map((entry) => String(entry).toUpperCase()).filter((entry) => "WUBRG".includes(entry))
    : [];
}

function cardName(card) {
  return String(card?.cardData?.name || card?.name || "").trim();
}

function qualifierText(value) {
  return String(value || "")
    .replace(/\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|up to)\b/gi, " ")
    .replace(/\bcards?\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesQualifier(card, rawQualifier, deps) {
  const qualifier = qualifierText(rawQualifier);
  if (!qualifier || /^(?:any|a)?\s*$/i.test(qualifier)) return true;

  const typeLine = String(deps.currentTypeLine(card) || "");
  const oracle = String(deps.currentOracleText(card) || "");
  const name = cardName(card);
  const colors = colorIdentity(card);
  const lower = qualifier.toLocaleLowerCase("en-US");

  const named = qualifier.match(/\bnamed\s+["“]?([^"”]+)["”]?/i);
  if (named && name.toLocaleLowerCase("en-US") !== named[1].trim().toLocaleLowerCase("en-US")) {
    return false;
  }

  const valueLess = qualifier.match(/\bmana value\s+(\d+)\s+or less/i);
  if (valueLess && manaValue(card) > Number(valueLess[1])) return false;

  const valueGreater = qualifier.match(/\bmana value\s+(\d+)\s+or greater/i);
  if (valueGreater && manaValue(card) < Number(valueGreater[1])) return false;

  const valueExact = qualifier.match(/\bmana value\s+(?:equal to\s+)?(\d+)\b/i);
  if (valueExact && !/or less|or greater/i.test(qualifier) && manaValue(card) !== Number(valueExact[1])) {
    return false;
  }

  if (/\bnonland\b/i.test(qualifier) && /\bLand\b/i.test(typeLine)) return false;
  if (/\bnoncreature\b/i.test(qualifier) && /\bCreature\b/i.test(typeLine)) return false;
  if (/\bnonartifact\b/i.test(qualifier) && /\bArtifact\b/i.test(typeLine)) return false;

  const typeTests = [
    ["basic land", /\bBasic\b/i.test(typeLine) && /\bLand\b/i.test(typeLine)],
    ["land", /\bLand\b/i.test(typeLine)],
    ["creature", /\bCreature\b/i.test(typeLine)],
    ["artifact", /\bArtifact\b/i.test(typeLine)],
    ["enchantment", /\bEnchantment\b/i.test(typeLine)],
    ["instant", /\bInstant\b/i.test(typeLine)],
    ["sorcery", /\bSorcery\b/i.test(typeLine)],
    ["planeswalker", /\bPlaneswalker\b/i.test(typeLine)],
    ["battle", /\bBattle\b/i.test(typeLine)],
    ["aura", /\bAura\b/i.test(typeLine)],
    ["equipment", /\bEquipment\b/i.test(typeLine)],
    ["vehicle", /\bVehicle\b/i.test(typeLine)],
    ["legendary", /\bLegendary\b/i.test(typeLine)],
    ["snow", /\bSnow\b/i.test(typeLine)],
    [
      "permanent",
      /\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/i.test(typeLine)
    ],
    [
      "historic",
      /\bArtifact\b/i.test(typeLine) ||
        /\bLegendary\b/i.test(typeLine) ||
        /\bSaga\b/i.test(typeLine)
    ]
  ];

  for (const [word, passed] of typeTests) {
    const wanted = new RegExp(`\\b${word.replace(/\s+/g, "\\s+")}\\b`, "i").test(qualifier);
    if (wanted && !passed) return false;
  }

  const colorTests = {
    white: "W",
    blue: "U",
    black: "B",
    red: "R",
    green: "G"
  };
  for (const [word, symbol] of Object.entries(colorTests)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(qualifier) && !colors.includes(symbol)) return false;
  }

  if (/\bcolorless\b/i.test(qualifier) && colors.length !== 0) return false;
  if (/\bmulticolou?red\b/i.test(qualifier) && colors.length < 2) return false;
  if (/\bmonocolou?red\b/i.test(qualifier) && colors.length !== 1) return false;

  const subtypePhrase = qualifier.match(/\b(?:a|an)?\s*([A-Z][A-Za-z'-]+)\s+(?:creature|card)\b/);
  if (
    subtypePhrase &&
    !new RegExp(`\\b${subtypePhrase[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(typeLine)
  ) {
    return false;
  }

  if (/\bwith flying\b/i.test(qualifier) && !/\bflying\b/i.test(oracle)) return false;
  if (/\bwith defender\b/i.test(qualifier) && !/\bdefender\b/i.test(oracle)) return false;

  return true;
}

function destinationFromText(text, fallback = "hand") {
  const value = String(text || "");
  if (/onto (?:the )?battlefield/i.test(value)) return "battlefield";
  if (/into (?:your|its owner'?s|the) graveyard/i.test(value)) return "graveyard";
  if (/\bexile\b/i.test(value) && /put|move/i.test(value)) return "exile";
  if (/on top of (?:your|the) library/i.test(value)) return "library-top";
  if (/on the bottom of (?:your|the) library/i.test(value)) return "library-bottom";
  if (/into (?:your|its owner'?s|the) hand/i.test(value)) return "hand";
  return fallback;
}

function createChoice(room, player, raw, deps) {
  normalizeChoiceState(room);

  const choice = {
    id: deps.createId(),
    status: "open",
    createdAt: deps.nowIso(),
    playerId: player.id,
    sourceName: deps.normalizeText(raw.sourceName || "Card effect", 150),
    kind: deps.normalizeText(raw.kind, 40),
    prompt: deps.normalizeText(raw.prompt, 500),
    minimum: deps.clamp(Math.floor(Number(raw.minimum) || 0), 0, 100),
    maximum: deps.clamp(Math.floor(Number(raw.maximum) || 1), 0, 100),
    cardIds: uniqueIds(raw.cardIds),
    eligibleCardIds: uniqueIds(raw.eligibleCardIds),
    destination: ZONE_DESTINATIONS.has(raw.destination) ? raw.destination : "hand",
    restDestination: ZONE_DESTINATIONS.has(raw.restDestination)
      ? raw.restDestination
      : "library-bottom",
    reveal: Boolean(raw.reveal),
    shuffleAfter: Boolean(raw.shuffleAfter),
    entersTapped: Boolean(raw.entersTapped),
    mayChooseNone: Boolean(raw.mayChooseNone),
    qualifier: deps.normalizeText(raw.qualifier, 300),
    notes: deps.normalizeText(raw.notes, 500)
  };

  room.zoneChoices.push(choice);
  if (room.zoneChoices.length > 40) room.zoneChoices.splice(0, room.zoneChoices.length - 40);

  if (player.isBot) {
    const resolution = autoResolution(choice);
    resolveChoice(room, player, choice.id, resolution, deps);
  }

  return choice;
}

function autoResolution(choice) {
  if (choice.kind === "search") {
    return {
      selectedCardIds: choice.eligibleCardIds.slice(0, choice.maximum)
    };
  }

  if (choice.kind === "look-select") {
    return {
      selectedCardIds: choice.eligibleCardIds.slice(0, choice.maximum),
      orderedRestCardIds: choice.cardIds.filter(
        (id) => !choice.eligibleCardIds.slice(0, choice.maximum).includes(id)
      )
    };
  }

  if (choice.kind === "scry") {
    return { topCardIds: [...choice.cardIds], bottomCardIds: [] };
  }

  if (choice.kind === "surveil") {
    return { topCardIds: [...choice.cardIds], graveyardCardIds: [] };
  }

  return { selectedCardIds: [] };
}

function currentTopMatches(player, cardIds) {
  const current = player.game.library.slice(0, cardIds.length).map((card) => card.id);
  return current.length === cardIds.length && current.every((id, index) => id === cardIds[index]);
}

function cardsByIds(cards, ids) {
  const byId = new Map(cards.map((card) => [card.id, card]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function removeCardsById(cards, ids) {
  const selected = new Set(ids);
  const removed = [];
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    if (!selected.has(cards[index].id)) continue;
    removed.unshift(cards.splice(index, 1)[0]);
  }
  return removed;
}

function moveSelectedCards(player, cards, destination, choice, deps) {
  if (!cards.length) return;

  for (const card of cards) {
    card.attacking = false;
    card.blockingCardId = null;
    card.defendingPlayerId = null;
    card.attachedToId = null;

    if (destination === "battlefield") {
      card.controllerId = player.id;
      card.summoningSick = deps.isCreatureCard(card);
      card.tapped = Boolean(choice.entersTapped);
      player.game.battlefield.unshift(card);
    } else if (destination === "hand") {
      card.tapped = false;
      player.game.hand.push(card);
    } else if (destination === "graveyard") {
      card.tapped = false;
      player.game.graveyard.unshift(card);
    } else if (destination === "exile") {
      card.tapped = false;
      player.game.exile.unshift(card);
    } else if (destination === "library-top") {
      card.tapped = false;
      player.game.library.unshift(card);
    } else if (destination === "library-bottom") {
      card.tapped = false;
      player.game.library.push(card);
    }
  }
}

function validatePartition(allIds, groups) {
  const expected = [...allIds].sort();
  const actual = groups.flat().map(String);
  if (new Set(actual).size !== actual.length) return false;
  return actual.sort().join("|") === expected.join("|");
}

function resolveChoice(room, actor, choiceId, resolution, deps) {
  const choice = pendingChoices(room).find((entry) => entry.id === choiceId);
  if (!choice) return { success: false, error: "That card choice is no longer available." };
  if (choice.playerId !== actor.id && room.hostId !== actor.id) {
    return { success: false, error: "That private card choice belongs to another player." };
  }

  const player = deps.findPlayer(room, choice.playerId);
  if (!player?.game) return { success: false, error: "The choosing player is unavailable." };

  if (choice.kind === "search") {
    const selected = uniqueIds(resolution?.selectedCardIds);
    if (selected.length < choice.minimum || selected.length > choice.maximum) {
      return {
        success: false,
        error: `Choose between ${choice.minimum} and ${choice.maximum} card${
          choice.maximum === 1 ? "" : "s"
        }.`
      };
    }

    if (selected.some((id) => !choice.eligibleCardIds.includes(id))) {
      return { success: false, error: "One selected card does not match the search." };
    }

    const removed = removeCardsById(player.game.library, selected);
    if (removed.length !== selected.length) {
      return { success: false, error: "The library changed before the search finished." };
    }

    moveSelectedCards(player, removed, choice.destination, choice, deps);
    if (choice.shuffleAfter) player.game.library = deps.shuffle(player.game.library);

    if (choice.reveal && removed.length) {
      deps.addLog(
        room,
        `${player.name} revealed ${removed.map(cardName).join(", ")}.`,
        "reveal"
      );
    } else {
      deps.addLog(
        room,
        `${player.name} completed a private library search${
          removed.length ? ` and found ${removed.length} card${removed.length === 1 ? "" : "s"}` : ""
        }.`,
        "search"
      );
    }
  } else if (choice.kind === "scry") {
    const topIds = uniqueIds(resolution?.topCardIds);
    const bottomIds = uniqueIds(resolution?.bottomCardIds);

    if (!validatePartition(choice.cardIds, [topIds, bottomIds])) {
      return { success: false, error: "Every looked-at card must be placed on top or bottom." };
    }
    if (!currentTopMatches(player, choice.cardIds)) {
      return { success: false, error: "The top of the library changed before scry finished." };
    }

    const looked = player.game.library.splice(0, choice.cardIds.length);
    const byId = new Map(looked.map((card) => [card.id, card]));
    player.game.library = [
      ...topIds.map((id) => byId.get(id)),
      ...player.game.library,
      ...bottomIds.map((id) => byId.get(id))
    ].filter(Boolean);

    deps.addLog(
      room,
      `${player.name} scried ${choice.cardIds.length}.`,
      "scry"
    );
  } else if (choice.kind === "surveil") {
    const topIds = uniqueIds(resolution?.topCardIds);
    const graveyardIds = uniqueIds(resolution?.graveyardCardIds);

    if (!validatePartition(choice.cardIds, [topIds, graveyardIds])) {
      return { success: false, error: "Every looked-at card must stay on top or go to the graveyard." };
    }
    if (!currentTopMatches(player, choice.cardIds)) {
      return { success: false, error: "The top of the library changed before surveil finished." };
    }

    const looked = player.game.library.splice(0, choice.cardIds.length);
    const byId = new Map(looked.map((card) => [card.id, card]));
    player.game.library = [
      ...topIds.map((id) => byId.get(id)),
      ...player.game.library
    ].filter(Boolean);
    player.game.graveyard.unshift(
      ...graveyardIds.map((id) => byId.get(id)).filter(Boolean)
    );

    deps.addLog(
      room,
      `${player.name} surveilled ${choice.cardIds.length}.`,
      "surveil"
    );
  } else if (choice.kind === "look-select") {
    const selected = uniqueIds(resolution?.selectedCardIds);
    const restIds = uniqueIds(resolution?.orderedRestCardIds);

    if (selected.length < choice.minimum || selected.length > choice.maximum) {
      return {
        success: false,
        error: `Choose between ${choice.minimum} and ${choice.maximum} card${
          choice.maximum === 1 ? "" : "s"
        }.`
      };
    }
    if (selected.some((id) => !choice.eligibleCardIds.includes(id))) {
      return { success: false, error: "One selected card does not match the effect." };
    }
    if (!validatePartition(choice.cardIds, [selected, restIds])) {
      return { success: false, error: "Every looked-at card must be accounted for." };
    }
    if (!currentTopMatches(player, choice.cardIds)) {
      return { success: false, error: "The top of the library changed before the choice finished." };
    }

    const looked = player.game.library.splice(0, choice.cardIds.length);
    const byId = new Map(looked.map((card) => [card.id, card]));
    const chosenCards = selected.map((id) => byId.get(id)).filter(Boolean);
    const restCards = restIds.map((id) => byId.get(id)).filter(Boolean);

    moveSelectedCards(player, chosenCards, choice.destination, choice, deps);
    moveSelectedCards(player, restCards, choice.restDestination, choice, deps);

    if (choice.reveal && chosenCards.length) {
      deps.addLog(
        room,
        `${player.name} revealed ${chosenCards.map(cardName).join(", ")}.`,
        "reveal"
      );
    } else {
      deps.addLog(
        room,
        `${player.name} finished looking at the top ${choice.cardIds.length} cards.`,
        "look"
      );
    }
  } else {
    return { success: false, error: "That zone-choice type is unsupported." };
  }

  choice.status = "resolved";
  choice.resolvedAt = deps.nowIso();
  normalizeChoiceState(room);

  return { success: true, choiceId: choice.id };
}

function publicChoice(room, choice, viewerId, deps) {
  if (choice.playerId !== viewerId) return null;
  const player = deps.findPlayer(room, choice.playerId);
  if (!player?.game) return null;

  const allCards = [
    ...player.game.library,
    ...player.game.hand,
    ...player.game.graveyard,
    ...player.game.exile,
    ...player.game.battlefield,
    ...player.game.commandZone
  ];
  const byId = new Map(allCards.map((card) => [card.id, card]));

  const visibleIds =
    choice.kind === "search"
      ? choice.eligibleCardIds
      : choice.cardIds;

  return {
    ...choice,
    cards: visibleIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((card) => deps.publicCard(card))
  };
}

function drawCards(player, amount, deps) {
  let drawn = 0;
  const count = deps.clamp(Math.floor(Number(amount) || 0), 0, 50);

  while (drawn < count && player.game.library.length) {
    player.game.hand.push(player.game.library.shift());
    drawn += 1;
  }
  if (drawn < count) player.game.drawFailed = true;
  return drawn;
}

function millCards(player, amount, deps) {
  let milled = 0;
  const count = deps.clamp(Math.floor(Number(amount) || 0), 0, 100);

  while (milled < count && player.game.library.length) {
    player.game.graveyard.unshift(player.game.library.shift());
    milled += 1;
  }
  return milled;
}

function parseSearchEffect(text) {
  const match = String(text).match(
    /search your library for\s+(up to\s+)?(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?(.+?)\s+cards?(?=,|\.| and | then )/i
  );
  if (!match) return null;

  const amount = numberFrom(match[2], 1);
  const sentenceEnd = String(text).slice(match.index).split(/\.(?:\s|$)/)[0];
  const qualifier = match[3]
    .replace(/\b(?:card|cards)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    amount,
    qualifier,
    minimum: match[1] || /\bmay search\b/i.test(sentenceEnd) ? 0 : amount,
    maximum: amount,
    destination: destinationFromText(sentenceEnd, "hand"),
    reveal: /\breveal (?:it|them|that card|those cards)\b/i.test(sentenceEnd),
    shuffleAfter: /\bshuffle\b/i.test(sentenceEnd) || /\bthen shuffle\b/i.test(text),
    entersTapped: /onto (?:the )?battlefield tapped/i.test(sentenceEnd),
    sentence: sentenceEnd
  };
}

function parseLookEffect(text) {
  const source = String(text);
  const match = source.match(
    /look at the top\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards? of your library/i
  );
  if (!match) return null;

  const amount = numberFrom(match[1], 1);
  const after = source.slice(match.index + match[0].length);
  const nextSentence = after.split(/\.(?:\s|$)/).slice(0, 3).join(". ");

  const choose = nextSentence.match(
    /(?:you may\s+)?(?:reveal\s+)?(?:one|a|an|up to one)\s+(.+?)\s+card from among them/i
  );
  const genericOne = /put one of them into your hand/i.test(nextSentence);
  if (!choose && !genericOne) return null;

  return {
    amount,
    qualifier: choose ? choose[1] : "",
    minimum: /\byou may\b|up to one/i.test(nextSentence) ? 0 : 1,
    maximum: 1,
    destination: destinationFromText(nextSentence, "hand"),
    restDestination: /rest.*graveyard/i.test(nextSentence)
      ? "graveyard"
      : /rest.*top/i.test(nextSentence)
        ? "library-top"
        : "library-bottom",
    reveal: /\breveal\b/i.test(nextSentence),
    notes: nextSentence
  };
}

function deterministicRevealTop(room, player, text, sourceName, deps) {
  const match = String(text).match(
    /reveal the top\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards? of your library/i
  );
  if (!match) return false;

  const amount = numberFrom(match[1], 1);
  const sentenceBlock = String(text).slice(match.index).split(/\.(?:\s|$)/).slice(0, 3).join(". ");
  const putAll = sentenceBlock.match(
    /put all\s+(.+?)\s+cards? revealed this way into your hand/i
  );
  if (!putAll || !/rest.*graveyard/i.test(sentenceBlock)) return false;

  const revealed = player.game.library.splice(0, amount);
  const matched = revealed.filter((card) => matchesQualifier(card, putAll[1], deps));
  const rest = revealed.filter((card) => !matched.includes(card));
  player.game.hand.push(...matched);
  player.game.graveyard.unshift(...rest);

  deps.addLog(
    room,
    `${player.name} revealed ${revealed.map(cardName).join(", ") || "no cards"} from ${
      sourceName || "a card effect"
    }.`,
    "reveal"
  );
  return true;
}

function afterResolve(room, item, deps) {
  const controller = deps.findPlayer(room, item?.controllerId);
  if (!controller?.game) return [];

  const text = String(item?.text || deps.currentOracleText(item?.card) || "");
  if (!text.trim()) return [];

  if (/choose (?:one|two|three)|^[^]*•/im.test(text)) {
    deps.addLog(
      room,
      `${item?.name || "A card"} has modal text and remains assisted until its chosen mode is supplied.`,
      "assisted"
    );
    return [];
  }

  const created = [];
  const legacyAction = String(item?.effect?.action || "");

  if (legacyAction !== "draw") {
    for (const match of text.matchAll(
      /\bdraw\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/gi
    )) {
      const sentenceStart = Math.max(text.lastIndexOf(".", match.index), 0);
      const lead = text.slice(sentenceStart, match.index);
      if (/\bmay\b/i.test(lead)) continue;
      const amount = numberFrom(match[1], 1);
      const drawn = drawCards(controller, amount, deps);
      deps.addLog(
        room,
        `${controller.name} drew ${drawn} card${drawn === 1 ? "" : "s"}.`,
        "draw"
      );
    }
  }

  if (legacyAction !== "mill") {
    for (const match of text.matchAll(
      /\bmill\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/gi
    )) {
      const amount = numberFrom(match[1], 1);
      const milled = millCards(controller, amount, deps);
      deps.addLog(
        room,
        `${controller.name} milled ${milled} card${milled === 1 ? "" : "s"}.`,
        "mill"
      );
    }
  }

  const search = parseSearchEffect(text);
  if (search) {
    const eligible = controller.game.library
      .filter((card) => matchesQualifier(card, search.qualifier, deps))
      .map((card) => card.id);

    const choice = createChoice(
      room,
      controller,
      {
        kind: "search",
        sourceName: item?.name,
        prompt: `Search your library for ${
          search.maximum > 1 ? `up to ${search.maximum}` : search.minimum === 0 ? "up to one" : "one"
        } ${search.qualifier || "card"}.`,
        minimum: search.minimum,
        maximum: search.maximum,
        cardIds: [],
        eligibleCardIds: eligible,
        destination: search.destination,
        reveal: search.reveal,
        shuffleAfter: search.shuffleAfter,
        entersTapped: search.entersTapped,
        mayChooseNone: search.minimum === 0,
        qualifier: search.qualifier,
        notes: search.sentence
      },
      deps
    );
    created.push(choice);
  }

  const look = parseLookEffect(text);
  if (look) {
    const topCards = controller.game.library.slice(0, look.amount);
    const eligible = topCards
      .filter((card) => matchesQualifier(card, look.qualifier, deps))
      .map((card) => card.id);

    const choice = createChoice(
      room,
      controller,
      {
        kind: "look-select",
        sourceName: item?.name,
        prompt: `Look at the top ${look.amount} card${
          look.amount === 1 ? "" : "s"
        } and choose ${look.qualifier || "one card"}.`,
        minimum: look.minimum,
        maximum: look.maximum,
        cardIds: topCards.map((card) => card.id),
        eligibleCardIds: eligible,
        destination: look.destination,
        restDestination: look.restDestination,
        reveal: look.reveal,
        mayChooseNone: look.minimum === 0,
        qualifier: look.qualifier,
        notes: look.notes
      },
      deps
    );
    created.push(choice);
  }

  for (const match of text.matchAll(
    /\bscry\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/gi
  )) {
    const amount = numberFrom(match[1], 1);
    const cards = controller.game.library.slice(0, amount);
    if (!cards.length) continue;

    const choice = createChoice(
      room,
      controller,
      {
        kind: "scry",
        sourceName: item?.name,
        prompt: `Scry ${amount}. Put any number on the bottom and the rest on top in any order.`,
        minimum: 0,
        maximum: amount,
        cardIds: cards.map((card) => card.id),
        eligibleCardIds: cards.map((card) => card.id),
        destination: "library-top",
        restDestination: "library-bottom"
      },
      deps
    );
    created.push(choice);
  }

  for (const match of text.matchAll(
    /\bsurveil\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/gi
  )) {
    const amount = numberFrom(match[1], 1);
    const cards = controller.game.library.slice(0, amount);
    if (!cards.length) continue;

    const choice = createChoice(
      room,
      controller,
      {
        kind: "surveil",
        sourceName: item?.name,
        prompt: `Surveil ${amount}. Put any number into your graveyard and the rest on top in any order.`,
        minimum: 0,
        maximum: amount,
        cardIds: cards.map((card) => card.id),
        eligibleCardIds: cards.map((card) => card.id),
        destination: "library-top",
        restDestination: "graveyard"
      },
      deps
    );
    created.push(choice);
  }

  deterministicRevealTop(room, controller, text, item?.name, deps);

  if (
    /\bshuffle your library\b/i.test(text) &&
    !search &&
    !/search your library/i.test(text)
  ) {
    controller.game.library = deps.shuffle(controller.game.library);
    deps.addLog(room, `${controller.name} shuffled their library.`, "shuffle");
  }

  return created;
}

function createZoneRulesEngine(dependencies) {
  const deps = dependencies;

  return {
    version: "43.0.0",

    afterResolve(room, item) {
      return afterResolve(room, item, deps);
    },

    processGameAction(room, actor, action, legacy) {
      const type = String(action?.type || "");
      const pending = pendingChoices(room);

      if (type === "resolve-zone-choice") {
        return resolveChoice(room, actor, String(action?.choiceId || ""), action?.resolution || {}, deps);
      }

      if (
        pending.length &&
        !["judge-action", "check-state-based", "undo-last"].includes(type)
      ) {
        const owner = deps.findPlayer(room, pending[0].playerId);
        return {
          success: false,
          error: `${owner?.name || "A player"} must finish a private card choice before the game continues.`
        };
      }

      return legacy(room, actor, action);
    },

    pendingPublic(room, viewerId) {
      return pendingForPlayer(room, viewerId)
        .map((choice) => publicChoice(room, choice, viewerId, deps))
        .filter(Boolean);
    },

    publicRoomSummary(room) {
      return {
        pendingZoneChoices: pendingChoices(room).map((choice) => ({
          id: choice.id,
          playerId: choice.playerId,
          sourceName: choice.sourceName,
          kind: choice.kind
        }))
      };
    },

    status() {
      return {
        success: true,
        version: "43.0.0",
        automatic: [
          "fixed-number card draw",
          "fixed-number mill",
          "library shuffle",
          "deterministic reveal-top effects",
          "private library searches with type and mana-value filters",
          "reveal searched cards",
          "put searched cards into hand, battlefield, graveyard or exile",
          "battlefield-tapped search results",
          "scry with top/bottom ordering",
          "surveil with top/graveyard ordering",
          "look at top cards and choose a matching card",
          "private hidden-information APIs",
          "server pause while a private choice is unresolved",
          "basic bot choice resolution"
        ],
        assisted: [
          "optional draw effects",
          "modal cards until the chosen mode is supplied",
          "search restrictions involving dynamic game values",
          "reordering large groups with complex instructions",
          "impulse-play permissions",
          "cascade, discover and similar recursive casting",
          "replacement effects that modify drawing or searching",
          "cards with multiple linked searches"
        ]
      };
    }
  };
}

module.exports = {
  createZoneRulesEngine,
  _test: {
    numberFrom,
    matchesQualifier,
    parseSearchEffect,
    parseLookEffect,
    afterResolve,
    resolveChoice,
    publicChoice,
    drawCards,
    millCards
  }
};
