"use strict";

const COLORS = ["W", "U", "B", "R", "G", "C"];
const ROMAN = {
  I: 1, II: 2, III: 3, IV: 4, V: 5,
  VI: 6, VII: 7, VIII: 8, IX: 9, X: 10
};

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function normalizeState(room) {
  room.formsV49 =
    room.formsV49 && typeof room.formsV49 === "object"
      ? room.formsV49
      : {};

  const state = room.formsV49;
  state.battleChoices = list(state.battleChoices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-30);
  state.sagaStack =
    state.sagaStack && typeof state.sagaStack === "object"
      ? state.sagaStack
      : {};
  state.spellCounts =
    state.spellCounts && typeof state.spellCounts === "object"
      ? state.spellCounts
      : {};
  state.lastDayNightCheckTurn = Number(state.lastDayNightCheckTurn) || 0;
  state.lastSagaAdvanceKey = String(state.lastSagaAdvanceKey || "");
  state.lastError = state.lastError || null;
  return state;
}

function cardFaces(card) {
  return list(card?.cardData?.faces).filter(Boolean);
}

function cardLayout(card) {
  return String(card?.cardData?.layout || "").toLowerCase();
}

function faceAt(card, index) {
  return cardFaces(card)[Math.max(0, Number(index) || 0)] || null;
}

function faceName(face, fallback = "Card face") {
  return String(face?.name || fallback);
}

function faceType(face, card, deps) {
  return String(face?.typeLine || deps.currentTypeLine(card) || "");
}

function faceOracle(face, card, deps) {
  return String(face?.oracleText || deps.currentOracleText(card) || "");
}

function faceManaCost(face, card) {
  return String(face?.manaCost || card?.cardData?.manaCost || "");
}

function setFace(card, index) {
  const faces = cardFaces(card);
  if (!faces.length) return false;
  const next = Math.max(0, Math.min(faces.length - 1, Number(index) || 0));
  card.activeFaceIndex = next;
  return true;
}

function isPermanentType(typeLine) {
  return /\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/i.test(
    String(typeLine || "")
  );
}

function isLandType(typeLine) {
  return /\bLand\b/i.test(String(typeLine || ""));
}

function isInstantSorcery(typeLine) {
  return /\b(?:Instant|Sorcery)\b/i.test(String(typeLine || ""));
}

function isSaga(card, deps) {
  return /\bSaga\b/i.test(String(deps.currentTypeLine(card) || ""));
}

function isBattle(card, deps) {
  return /\bBattle\b/i.test(String(deps.currentTypeLine(card) || ""));
}

function isTransformLayout(card) {
  return ["transform", "double_faced_token"].includes(cardLayout(card));
}

function isModalDfc(card) {
  return cardLayout(card) === "modal_dfc";
}

function isAdventure(card) {
  return cardLayout(card) === "adventure";
}

function isPrototype(card, deps) {
  return (
    cardLayout(card) === "prototype" ||
    /\bprototype\b/i.test(String(deps.currentOracleText(card) || ""))
  );
}

function originalOracle(card) {
  return [
    String(card?.cardData?.oracleText || ""),
    ...cardFaces(card).map((face) => String(face.oracleText || ""))
  ]
    .filter(Boolean)
    .join("\n");
}

function hasDaybound(card) {
  return /\bdaybound\b/i.test(originalOracle(card));
}

function hasNightbound(card) {
  return /\bnightbound\b/i.test(originalOracle(card));
}

function parsePrototype(card, deps) {
  const text = originalOracle(card) || String(deps.currentOracleText(card) || "");
  const match = text.match(
    /\bprototype\s*((?:\{[^}]+\})+)\s*[—-]\s*([*0-9]+)\s*\/\s*([*0-9]+)/i
  );
  if (!match) return null;
  return {
    manaCost: match[1],
    power: match[2],
    toughness: match[3]
  };
}

function parseMorph(card) {
  const text = originalOracle(card);
  const match = text.match(/\b(morph|disguise)\s*((?:\{[^}]+\})+)/i);
  return match
    ? {
        kind: match[1].toLowerCase(),
        manaCost: match[2]
      }
    : null;
}

function parseMutate(card) {
  const text = originalOracle(card);
  const match = text.match(/\bmutate\s*((?:\{[^}]+\})+)/i);
  return match ? { manaCost: match[1] } : null;
}

function battleDefense(card) {
  const face = faceAt(card, card.activeFaceIndex || 0) || {};
  const value =
    face.defense ??
    card?.cardData?.defense ??
    card?.defense ??
    card?.cardData?.faces?.[0]?.defense;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function romanNumbers(label) {
  return String(label || "")
    .split(/\s*,\s*/)
    .map((part) => ROMAN[String(part || "").trim().toUpperCase()])
    .filter(Number.isFinite);
}

function parseSagaChapters(card, deps) {
  const text = String(deps.currentOracleText(card) || originalOracle(card));
  const chapters = [];
  const pattern = /(?:^|\n)\s*((?:I|II|III|IV|V|VI|VII|VIII|IX|X)(?:\s*,\s*(?:I|II|III|IV|V|VI|VII|VIII|IX|X))*)\s*[—-]\s*([^\n]+)/g;

  let match;
  while ((match = pattern.exec(text))) {
    chapters.push({
      numbers: romanNumbers(match[1]),
      text: String(match[2] || "").trim()
    });
  }

  return chapters;
}

function finalSagaChapter(card, deps) {
  const chapters = parseSagaChapters(card, deps);
  return chapters.reduce(
    (maximum, chapter) =>
      Math.max(maximum, ...chapter.numbers, 0),
    0
  );
}

function parseManaCost(cost) {
  const requirement = {
    W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0
  };

  for (const match of String(cost || "").matchAll(/\{([^}]+)\}/g)) {
    const symbol = String(match[1] || "").toUpperCase();
    if (/^\d+$/.test(symbol)) requirement.generic += Number(symbol);
    else if (COLORS.includes(symbol)) requirement[symbol] += 1;
    else if (symbol.includes("/")) {
      const choice = symbol
        .split("/")
        .find((entry) => COLORS.includes(entry));
      if (choice) requirement[choice] += 1;
      else requirement.generic += 1;
    } else if (symbol === "X") {
      requirement.generic += 0;
    }
  }
  return requirement;
}

function manaOptions(card, deps) {
  if (!card || card.tapped || card.phasedOut) return [];
  if (
    deps.isCreatureCard(card) &&
    card.summoningSick &&
    !/\bhaste\b/i.test(originalOracle(card))
  ) {
    return [];
  }

  const typeLine = String(deps.currentTypeLine(card) || "");
  const oracle = String(deps.currentOracleText(card) || "");
  const options = [];

  const basics = {
    Plains: "W",
    Island: "U",
    Swamp: "B",
    Mountain: "R",
    Forest: "G",
    Wastes: "C"
  };

  for (const [basic, color] of Object.entries(basics)) {
    if (new RegExp(`\\b${basic}\\b`, "i").test(typeLine)) {
      options.push({ mana: { [color]: 1 } });
    }
  }

  for (const match of oracle.matchAll(
    /\{T\}[^.]*:\s*Add\s+([^.;\n]+)/gi
  )) {
    const output = match[1];
    const symbols = [
      ...output.matchAll(/\{([WUBRGC])\}/gi)
    ].map((entry) => entry[1].toUpperCase());

    if (symbols.length) {
      if (/\bor\b/i.test(output)) {
        for (const symbol of symbols) {
          options.push({ mana: { [symbol]: 1 } });
        }
      } else {
        const mana = {};
        for (const symbol of symbols) {
          mana[symbol] = (mana[symbol] || 0) + 1;
        }
        options.push({ mana });
      }
    } else if (/one mana of any color/i.test(output)) {
      for (const color of ["W", "U", "B", "R", "G"]) {
        options.push({ mana: { [color]: 1 } });
      }
    }
  }

  const seen = new Set();
  return options.filter((option) => {
    const key = COLORS.map((color) => option.mana[color] || 0).join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function autoPay(room, player, cost, deps) {
  const requirement = parseManaCost(cost);
  const snapshot = JSON.parse(JSON.stringify(player.game));
  const selected = [];

  function spendPool(color, amount) {
    const available = Number(player.game.manaPool?.[color]) || 0;
    const spent = Math.min(available, amount);
    player.game.manaPool[color] = available - spent;
    return amount - spent;
  }

  for (const color of COLORS) {
    requirement[color] = spendPool(color, requirement[color]);
  }

  const sources = [];
  for (const card of player.game.battlefield || []) {
    const options = manaOptions(card, deps);
    if (options.length) sources.push({ card, options });
  }

  for (const color of COLORS) {
    while (requirement[color] > 0) {
      const source = sources.find(
        (entry) =>
          !selected.includes(entry.card.id) &&
          entry.options.some((option) => (option.mana[color] || 0) > 0)
      );
      if (!source) {
        player.game = snapshot;
        return {
          success: false,
          error: `Auto-pay could not make enough ${color} mana.`
        };
      }

      const option = source.options.find(
        (entry) => (entry.mana[color] || 0) > 0
      );
      source.card.tapped = true;
      selected.push(source.card.id);
      for (const produced of COLORS) {
        player.game.manaPool[produced] =
          (Number(player.game.manaPool[produced]) || 0) +
          (Number(option.mana[produced]) || 0);
      }
      requirement[color] = spendPool(color, requirement[color]);
    }
  }

  let generic = Math.max(0, requirement.generic);
  for (const color of COLORS) {
    generic = spendPool(color, generic);
    if (generic <= 0) break;
  }

  while (generic > 0) {
    const source = sources.find(
      (entry) => !selected.includes(entry.card.id)
    );
    if (!source) {
      player.game = snapshot;
      return {
        success: false,
        error: "Auto-pay could not produce enough generic mana."
      };
    }

    const option = source.options[0];
    source.card.tapped = true;
    selected.push(source.card.id);
    for (const produced of COLORS) {
      player.game.manaPool[produced] =
        (Number(player.game.manaPool[produced]) || 0) +
        (Number(option.mana[produced]) || 0);
    }
    for (const color of COLORS) {
      generic = spendPool(color, generic);
      if (generic <= 0) break;
    }
  }

  return { success: true, tappedCardIds: selected };
}

function withFaceCost(card, faceIndex, costOverride, callback) {
  const previousIndex = Number(card.activeFaceIndex) || 0;
  const faces = cardFaces(card);
  const face = faces[faceIndex] || null;
  const previousFaceCost = face?.manaCost;
  const previousBaseCost = card.cardData?.manaCost;

  if (faces.length) setFace(card, faceIndex);
  if (costOverride) {
    card.cardData = card.cardData || {};
    card.cardData.manaCost = costOverride;
    if (face) face.manaCost = costOverride;
  }

  try {
    return callback();
  } finally {
    if (costOverride) {
      card.cardData.manaCost = previousBaseCost;
      if (face) face.manaCost = previousFaceCost;
    }
    if (!card.specialState?.keepSelectedFace) {
      card.activeFaceIndex = previousIndex;
    }
  }
}

function locateFromZone(actor, action, deps) {
  const zone = ["hand", "graveyard", "exile", "commandZone"].includes(
    action?.fromZone
  )
    ? action.fromZone
    : "hand";
  const located = deps.getCardFromZone(
    actor.game,
    zone,
    String(action?.cardId || "")
  );
  return located ? { ...located, zone } : null;
}

function faceOptions(card, deps) {
  const faces = cardFaces(card);
  const options = faces.map((face, index) => ({
    id: `face:${index}`,
    kind: "face",
    faceIndex: index,
    name: faceName(face, card.name),
    manaCost: faceManaCost(face, card),
    typeLine: faceType(face, card, deps),
    oracleText: faceOracle(face, card, deps),
    imageUrl: face.imageUrl || card.cardData?.imageUrl || "",
    playable:
      index === 0 ||
      isModalDfc(card) ||
      isAdventure(card)
  }));

  const prototype = parsePrototype(card, deps);
  if (prototype) {
    options.push({
      id: "prototype",
      kind: "prototype",
      name: `${card.name} — Prototype`,
      manaCost: prototype.manaCost,
      typeLine: deps.currentTypeLine(card),
      oracleText: `Prototype ${prototype.manaCost} — ${prototype.power}/${prototype.toughness}`,
      imageUrl: card.cardData?.imageUrl || faces[0]?.imageUrl || "",
      power: prototype.power,
      toughness: prototype.toughness,
      playable: true
    });
  }

  const morph = parseMorph(card);
  if (morph) {
    options.push({
      id: "face-down",
      kind: "face-down",
      name: morph.kind === "disguise" ? "Cast face down with Disguise" : "Cast face down with Morph",
      manaCost: "{3}",
      typeLine: "Creature",
      oracleText: morph.kind === "disguise" ? "Ward {2}" : "",
      imageUrl: "",
      playable: true,
      turnFaceUpCost: morph.manaCost
    });
  }

  const mutate = parseMutate(card);
  if (mutate) {
    options.push({
      id: "mutate",
      kind: "mutate",
      name: `${card.name} — Mutate`,
      manaCost: mutate.manaCost,
      typeLine: deps.currentTypeLine(card),
      oracleText: "Merge over or under a non-Human creature you own.",
      imageUrl: card.cardData?.imageUrl || faces[0]?.imageUrl || "",
      playable: true
    });
  }

  return options;
}

function preview(room, actor, action, deps) {
  const located = locateFromZone(actor, action, deps);
  if (!located) {
    return { success: false, error: "That card is no longer available." };
  }

  return {
    success: true,
    version: "49.0.0",
    cardId: located.card.id,
    cardName: located.card.name,
    fromZone: located.zone,
    layout: cardLayout(located.card),
    options: faceOptions(located.card, deps),
    mutateTargets: (actor.game.battlefield || [])
      .filter(
        (card) =>
          deps.isCreatureCard(card) &&
          !/\bHuman\b/i.test(String(deps.currentTypeLine(card) || "")) &&
          card.ownerId === actor.id &&
          card.controllerId === actor.id
      )
      .map(deps.publicCard)
  };
}

function selectedFacePlay(
  room,
  actor,
  action,
  legacyProcess,
  deps
) {
  const located = locateFromZone(actor, action, deps);
  if (!located) {
    return { success: false, error: "That card is no longer available." };
  }

  const card = located.card;
  const option = String(action?.optionId || "face:0");

  if (option === "face-down") {
    return castFaceDown(room, actor, action, legacyProcess, deps);
  }
  if (option === "mutate") {
    return mutateCard(room, actor, action, deps);
  }

  if (option === "prototype") {
    const prototype = parsePrototype(card, deps);
    if (!prototype) {
      return { success: false, error: "That card has no Prototype cost." };
    }

    card.specialState = card.specialState || {};
    card.specialState.prototype = {
      active: true,
      manaCost: prototype.manaCost,
      power: prototype.power,
      toughness: prototype.toughness
    };
    card.power = prototype.power;
    card.toughness = prototype.toughness;

    const result = withFaceCost(
      card,
      Number(card.activeFaceIndex) || 0,
      prototype.manaCost,
      () =>
        legacyProcess(room, actor, {
          ...action,
          type: "auto-cast-card",
          fromZone: located.zone,
          cardId: card.id
        })
    );

    if (!result?.success) {
      delete card.specialState.prototype;
    }
    return result;
  }

  const match = option.match(/^face:(\d+)$/);
  const faceIndex = match ? Number(match[1]) : 0;
  const face = faceAt(card, faceIndex);
  if (!face) return { success: false, error: "That face is unavailable." };

  const typeLine = faceType(face, card, deps);

  if (isAdventure(card) && isInstantSorcery(typeLine)) {
    card.specialState = card.specialState || {};
    card.specialState.adventureCast = {
      faceIndex,
      permanentFaceIndex: cardFaces(card).findIndex((entry) =>
        isPermanentType(entry.typeLine)
      )
    };
  }

  card.specialState = card.specialState || {};
  card.specialState.keepSelectedFace = true;
  setFace(card, faceIndex);

  if (isLandType(typeLine)) {
    const result = legacyProcess(room, actor, {
      type: "move-card",
      fromZone: located.zone,
      toZone: "battlefield",
      cardId: card.id
    });
    if (!result?.success) {
      card.activeFaceIndex = 0;
      delete card.specialState.keepSelectedFace;
    }
    return result;
  }

  const result = legacyProcess(room, actor, {
    ...action,
    type: "auto-cast-card",
    fromZone: located.zone,
    cardId: card.id
  });

  if (!result?.success) {
    card.activeFaceIndex = 0;
    delete card.specialState.keepSelectedFace;
    delete card.specialState.adventureCast;
  }

  return result;
}

function faceDownOverrides(mode) {
  return {
    name: "Face-down creature",
    typeLine: "Creature",
    oracleText: mode === "disguise" ? "Ward {2}" : "",
    power: "2",
    toughness: "2"
  };
}

function castFaceDown(room, actor, action, legacyProcess, deps) {
  const located = locateFromZone(actor, action, deps);
  if (!located || located.zone !== "hand") {
    return {
      success: false,
      error: "Morph and Disguise are cast face down from your hand."
    };
  }

  const morph = parseMorph(located.card);
  if (!morph) {
    return {
      success: false,
      error: "That card has neither Morph nor Disguise."
    };
  }

  const card = located.card;
  card.faceDown = true;
  card.specialState = card.specialState || {};
  card.specialState.faceDownMode = morph.kind;
  card.specialState.turnFaceUpCost = morph.manaCost;
  card.judgeOverrides = {
    ...(card.judgeOverrides || {}),
    ...faceDownOverrides(morph.kind)
  };

  const result = withFaceCost(card, 0, "{3}", () =>
    legacyProcess(room, actor, {
      ...action,
      type: "auto-cast-card",
      fromZone: "hand",
      cardId: card.id,
      text: morph.kind === "disguise" ? "Ward {2}" : ""
    })
  );

  if (!result?.success) {
    card.faceDown = false;
    delete card.specialState.faceDownMode;
    delete card.specialState.turnFaceUpCost;
    card.judgeOverrides = {};
  }
  return result;
}

function manifestTop(room, actor, deps) {
  const card = actor.game.library.shift();
  if (!card) return { success: false, error: "Your library is empty." };

  card.controllerId = actor.id;
  card.faceDown = true;
  card.tapped = false;
  card.summoningSick = true;
  card.specialState = card.specialState || {};
  card.specialState.faceDownMode = "manifest";
  card.specialState.turnFaceUpCost = String(card.cardData?.manaCost || "");
  card.judgeOverrides = {
    ...(card.judgeOverrides || {}),
    ...faceDownOverrides("manifest")
  };
  actor.game.battlefield.unshift(card);
  deps.addLog(room, `${actor.name} manifested the top card of their library.`, "card");
  return { success: true, cardId: card.id };
}

function turnFaceUp(room, actor, cardId, deps) {
  const located = deps.findBattlefieldCard(room, String(cardId || ""));
  if (!located || located.card.controllerId !== actor.id || !located.card.faceDown) {
    return {
      success: false,
      error: "Choose a face-down permanent you control."
    };
  }

  const card = located.card;
  const mode = card.specialState?.faceDownMode || "manifest";
  let cost = String(card.specialState?.turnFaceUpCost || "");

  if (mode === "manifest") {
    if (!deps.isCreatureCard(card)) {
      return {
        success: false,
        error: "A manifested noncreature card cannot be turned face up this way."
      };
    }
    cost = String(card.cardData?.manaCost || "");
  }

  const payment = autoPay(room, actor, cost, deps);
  if (!payment.success) return payment;

  card.faceDown = false;
  card.judgeOverrides = {};
  delete card.specialState.faceDownMode;
  delete card.specialState.turnFaceUpCost;

  deps.queueSuggestedTriggers(room, "TURNED_FACE_UP", {
    card,
    controllerId: actor.id
  });
  deps.addLog(room, `${actor.name} turned ${card.name} face up.`, "card");
  return { success: true };
}

function transformPermanent(room, actor, cardId, deps) {
  const located = deps.findBattlefieldCard(room, String(cardId || ""));
  if (!located || located.card.controllerId !== actor.id) {
    return {
      success: false,
      error: "Choose a permanent you control."
    };
  }

  const card = located.card;
  if (!isTransformLayout(card) || cardFaces(card).length < 2) {
    return {
      success: false,
      error: "That permanent is not a transforming double-faced card."
    };
  }

  setFace(card, Number(card.activeFaceIndex) === 0 ? 1 : 0);
  deps.queueSuggestedTriggers(room, "TRANSFORMED", {
    card,
    controllerId: actor.id
  });
  deps.addLog(
    room,
    `${actor.name} transformed ${card.name} into ${faceName(
      faceAt(card, card.activeFaceIndex),
      card.name
    )}.`,
    "card"
  );
  return { success: true, activeFaceIndex: card.activeFaceIndex };
}

function mutateCard(room, actor, action, deps) {
  const located = deps.getCardFromZone(
    actor.game,
    "hand",
    String(action?.cardId || "")
  );
  const target = deps.findBattlefieldCard(
    room,
    String(action?.targetCardId || "")
  );

  if (!located) return { success: false, error: "The mutate card is not in hand." };
  if (
    !target ||
    target.card.controllerId !== actor.id ||
    target.card.ownerId !== actor.id ||
    !deps.isCreatureCard(target.card) ||
    /\bHuman\b/i.test(String(deps.currentTypeLine(target.card) || ""))
  ) {
    return {
      success: false,
      error: "Mutate requires a non-Human creature you own and control."
    };
  }

  const mutate = parseMutate(located.card);
  if (!mutate) return { success: false, error: "That card has no Mutate cost." };

  const payment = autoPay(room, actor, mutate.manaCost, deps);
  if (!payment.success) return payment;

  const [mutating] = actor.game.hand.splice(located.index, 1);
  const root = target.card;
  root.specialState = root.specialState || {};
  root.specialState.mutateComponents = list(
    root.specialState.mutateComponents
  );

  if (!root.specialState.mutateComponents.length) {
    root.specialState.mutateComponents.push(
      JSON.parse(JSON.stringify(root))
    );
  }
  root.specialState.mutateComponents.push(
    JSON.parse(JSON.stringify(mutating))
  );
  root.mergedCardIds = unique([
    ...(root.mergedCardIds || []),
    mutating.id
  ]);

  if (action?.position === "top") {
    root.name = mutating.name;
    root.cardData = JSON.parse(JSON.stringify(mutating.cardData));
    root.power = mutating.power;
    root.toughness = mutating.toughness;
    root.loyalty = mutating.loyalty;
    root.activeFaceIndex = mutating.activeFaceIndex || 0;
  }

  deps.queueSuggestedTriggers(room, "MUTATED", {
    card: root,
    mutatingCard: mutating,
    controllerId: actor.id
  });
  deps.addLog(
    room,
    `${actor.name} mutated ${mutating.name} ${
      action?.position === "top" ? "over" : "under"
    } ${target.card.name}.`,
    "card"
  );

  return { success: true, permanentId: root.id };
}

function splitMutateMove(room, actor, action, deps) {
  const located = deps.findBattlefieldCard(room, String(action?.cardId || ""));
  if (
    !located ||
    located.card.controllerId !== actor.id ||
    !list(located.card.specialState?.mutateComponents).length
  ) {
    return null;
  }

  const destination = String(action?.toZone || "");
  if (!["graveyard", "exile", "hand", "library", "commandZone"].includes(destination)) {
    return null;
  }

  const [root] = located.player.game.battlefield.splice(located.index, 1);
  const components = list(root.specialState.mutateComponents);
  const moved = [];

  for (const component of components) {
    const owner = deps.findPlayer(room, component.ownerId) || actor;
    const next = deps.migrateCard(
      {
        ...component,
        id: component.id || deps.createId(),
        controllerId: owner.id,
        faceDown: false,
        mergedCardIds: [],
        specialState: {}
      },
      owner.id
    );
    if (destination === "library" && action?.position === "bottom") {
      owner.game.library.push(next);
    } else {
      owner.game[destination].unshift(next);
    }
    moved.push(next.id);
  }

  deps.addLog(
    room,
    `${root.name}'s mutate pile separated into ${components.length} cards in ${destination}.`,
    "card"
  );
  return { success: true, movedCardIds: moved };
}

function queueSagaChapter(room, saga, chapterNumber, deps) {
  const chapter = parseSagaChapters(saga, deps).find((entry) =>
    entry.numbers.includes(chapterNumber)
  );
  if (!chapter) return null;

  const item = deps.pushStack(
    room,
    {
      kind: "trigger",
      name: `${saga.name} — Chapter ${chapterNumber}`,
      controllerId: saga.controllerId,
      sourceCardId: saga.id,
      text: chapter.text,
      targets: [],
      createdAt: deps.nowIso()
    },
    saga.controllerId
  );

  if (item) {
    const final = chapterNumber >= finalSagaChapter(saga, deps);
    normalizeState(room).sagaStack[item.id] = {
      sagaCardId: saga.id,
      final
    };
  }
  return item;
}

function addLore(room, saga, amount, deps) {
  const previous = Number(saga.counters?.lore ?? saga.lore) || 0;
  const next = Math.max(0, previous + Number(amount || 0));
  saga.counters = saga.counters || {};
  saga.counters.lore = next;
  saga.lore = next;

  for (let chapter = previous + 1; chapter <= next; chapter += 1) {
    queueSagaChapter(room, saga, chapter, deps);
  }
  return next;
}

function initializePermanent(room, card, controller, deps) {
  card.specialState = card.specialState || {};

  if (isBattle(card, deps)) {
    const defense = battleDefense(card);
    card.counters = card.counters || {};
    if (defense > 0 && card.counters.defense == null) {
      card.counters.defense = defense;
    }
  }

  if (isSaga(card, deps)) {
    const lore = Number(card.counters?.lore ?? card.lore) || 0;
    if (lore <= 0) addLore(room, card, 1, deps);
  }

  if (hasDaybound(card) && !room.rules?.dayNight) {
    room.rules = room.rules || {};
    room.rules.dayNight = "day";
    setFace(card, 0);
    deps.addLog(room, "It became day.", "rules");
  }

  if (card.specialState.prototype?.active) {
    card.power = card.specialState.prototype.power;
    card.toughness = card.specialState.prototype.toughness;
  }

  if (card.faceDown) {
    card.judgeOverrides = {
      ...(card.judgeOverrides || {}),
      ...faceDownOverrides(card.specialState.faceDownMode)
    };
  }

  card.specialState.initializedV49 = true;
}

function initializeNewPermanents(room, beforeIds, deps) {
  const before = new Set(beforeIds);
  for (const player of room.players || []) {
    for (const card of player.game?.battlefield || []) {
      if (!before.has(card.id) || !card.specialState?.initializedV49) {
        initializePermanent(room, card, player, deps);
      }
    }
  }
}

function battleChoiceExists(room, cardId) {
  return normalizeState(room).battleChoices.some(
    (choice) => choice.battleCardId === cardId && choice.status === "open"
  );
}

function checkBattles(room, deps) {
  const state = normalizeState(room);

  for (const player of room.players || []) {
    for (let index = player.game?.battlefield?.length - 1; index >= 0; index -= 1) {
      const card = player.game.battlefield[index];
      if (!isBattle(card, deps)) continue;
      const defense = Number(card.counters?.defense) || 0;
      if (defense > 0 || battleChoiceExists(room, card.id)) continue;

      player.game.battlefield.splice(index, 1);
      player.game.exile.unshift(card);
      const faces = cardFaces(card);
      const backFaceIndex = faces.length > 1 ? 1 : -1;
      state.battleChoices.push({
        id: deps.createId(),
        status: "open",
        createdAt: deps.nowIso(),
        playerId: card.controllerId,
        battleCardId: card.id,
        battleName: card.name,
        backFaceIndex,
        canCastBackFace: backFaceIndex >= 0,
        backFaceName:
          backFaceIndex >= 0
            ? faceName(faces[backFaceIndex], "Back face")
            : ""
      });
      deps.addLog(
        room,
        `${card.name} was defeated and exiled.`,
        "battle"
      );
    }
  }
}

function resolveBattleChoice(room, actor, action, deps) {
  const state = normalizeState(room);
  const choice = state.battleChoices.find(
    (entry) => entry.id === action?.choiceId && entry.status === "open"
  );
  if (!choice) {
    return { success: false, error: "That Battle choice is no longer available." };
  }
  if (choice.playerId !== actor.id && room.hostId !== actor.id) {
    return { success: false, error: "That Battle belongs to another player." };
  }

  const located = deps.getCardFromZone(
    actor.game,
    "exile",
    choice.battleCardId
  );
  if (!located) {
    choice.status = "resolved";
    return { success: true };
  }

  if (action?.castBackFace && choice.canCastBackFace) {
    const card = located.card;
    setFace(card, choice.backFaceIndex);
    card.specialState = card.specialState || {};
    card.specialState.keepSelectedFace = true;

    room.playPermissions = list(room.playPermissions);
    room.playPermissions.push({
      id: deps.createId(),
      playerId: actor.id,
      cardId: card.id,
      zone: "exile",
      kind: "battle-defeat",
      sourceName: choice.battleName,
      createdAt: deps.nowIso(),
      expires: "until-used",
      freeCast: true,
      mayPlayLand: false,
      mayCastSpell: true
    });
  }

  choice.status = "resolved";
  state.battleChoices = state.battleChoices.filter(
    (entry) => entry.status === "open"
  );
  return { success: true };
}

function damageBattle(room, actor, action, deps) {
  const located = deps.findBattlefieldCard(
    room,
    String(action?.battleCardId || "")
  );
  if (!located || !isBattle(located.card, deps)) {
    return { success: false, error: "Choose a Battle on the battlefield." };
  }

  const amount = Math.max(0, Math.floor(Number(action?.amount) || 0));
  located.card.counters = located.card.counters || {};
  located.card.counters.defense = Math.max(
    0,
    (Number(located.card.counters.defense) || 0) - amount
  );
  deps.addLog(
    room,
    `${actor.name} dealt ${amount} damage to ${located.card.name}.`,
    "battle"
  );
  checkBattles(room, deps);
  return { success: true };
}

function resetFaceOutsideBattlefield(room) {
  for (const player of room.players || []) {
    for (const zone of ["hand", "graveyard", "library", "commandZone"]) {
      for (const card of player.game?.[zone] || []) {
        if (
          isModalDfc(card) ||
          isTransformLayout(card) ||
          isAdventure(card)
        ) {
          card.activeFaceIndex = 0;
          card.specialState = card.specialState || {};
          delete card.specialState.keepSelectedFace;
          if (zone !== "exile") delete card.specialState.adventureCast;
        }
      }
    }
  }
}

function moveAdventureToExile(room, item, deps) {
  const card = item?.card;
  const adventure = card?.specialState?.adventureCast;
  if (!card || !adventure) return false;

  const controller = deps.findPlayer(room, item.controllerId);
  if (!controller?.game) return false;
  const index = controller.game.graveyard.findIndex(
    (entry) => entry.id === card.id
  );
  if (index < 0) return false;

  const [moved] = controller.game.graveyard.splice(index, 1);
  setFace(
    moved,
    adventure.permanentFaceIndex >= 0
      ? adventure.permanentFaceIndex
      : 0
  );
  moved.specialState = moved.specialState || {};
  delete moved.specialState.adventureCast;
  moved.specialState.keepSelectedFace = true;
  controller.game.exile.unshift(moved);

  room.playPermissions = list(room.playPermissions);
  room.playPermissions.push({
    id: deps.createId(),
    playerId: controller.id,
    cardId: moved.id,
    zone: "exile",
    kind: "adventure",
    sourceName: moved.name,
    createdAt: deps.nowIso(),
    expires: "until-used",
    freeCast: false,
    mayPlayLand: false,
    mayCastSpell: true
  });

  deps.addLog(
    room,
    `${moved.name} finished its Adventure and may be cast from exile.`,
    "card"
  );
  return true;
}

function sacrificeFinalSaga(room, item, deps) {
  const state = normalizeState(room);
  const meta = state.sagaStack[item?.id];
  if (!meta) return false;
  delete state.sagaStack[item.id];

  if (!meta.final) return false;
  const located = deps.findBattlefieldCard(room, meta.sagaCardId);
  if (!located) return false;

  const [saga] = located.player.game.battlefield.splice(located.index, 1);
  const owner = deps.findPlayer(room, saga.ownerId) || located.player;
  owner.game.graveyard.unshift(saga);
  deps.addLog(
    room,
    `${saga.name} was sacrificed after its final chapter resolved.`,
    "saga"
  );
  return true;
}

function spellCount(room, turnNumber, playerId) {
  const state = normalizeState(room);
  const turn = String(Number(turnNumber) || 0);
  return Number(state.spellCounts[turn]?.[playerId]) || 0;
}

function incrementSpellCount(room, playerId) {
  const state = normalizeState(room);
  const turn = String(Number(room.turn?.number) || 0);
  state.spellCounts[turn] =
    state.spellCounts[turn] &&
    typeof state.spellCounts[turn] === "object"
      ? state.spellCounts[turn]
      : {};
  state.spellCounts[turn][playerId] =
    (Number(state.spellCounts[turn][playerId]) || 0) + 1;

  for (const oldTurn of Object.keys(state.spellCounts)) {
    if (Number(oldTurn) < Number(turn) - 3) delete state.spellCounts[oldTurn];
  }
}

function setDayNight(room, next, deps) {
  room.rules = room.rules || {};
  if (room.rules.dayNight === next) return false;
  room.rules.dayNight = next;

  for (const player of room.players || []) {
    for (const card of player.game?.battlefield || []) {
      if (next === "day" && hasDaybound(card)) setFace(card, 0);
      if (next === "night" && (hasDaybound(card) || hasNightbound(card))) {
        setFace(card, Math.min(1, cardFaces(card).length - 1));
      }
    }
  }

  deps.addLog(room, `It became ${next}.`, "rules");
  return true;
}

function checkDayNightAtUpkeep(room, deps) {
  const state = normalizeState(room);
  const turn = Number(room.turn?.number) || 0;
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";

  if (phase !== "Upkeep" || state.lastDayNightCheckTurn === turn) return false;
  state.lastDayNightCheckTurn = turn;

  if (!room.rules?.dayNight) return false;
  const previousTurn = Math.max(0, turn - 1);
  const activePlayerId = room.turn?.activePlayerId;
  const spells = spellCount(room, previousTurn, activePlayerId);

  if (room.rules.dayNight === "day" && spells === 0) {
    return setDayNight(room, "night", deps);
  }
  if (room.rules.dayNight === "night" && spells >= 2) {
    return setDayNight(room, "day", deps);
  }
  return false;
}

function advanceSagasAtMainOne(room, deps) {
  const state = normalizeState(room);
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  if (phase !== "Main 1") return false;

  const key = `${room.turn?.number}:${room.turn?.activePlayerId}`;
  if (state.lastSagaAdvanceKey === key) return false;
  state.lastSagaAdvanceKey = key;

  const active = deps.findPlayer(room, room.turn?.activePlayerId);
  if (!active?.game) return false;

  for (const card of active.game.battlefield || []) {
    if (isSaga(card, deps)) addLore(room, card, 1, deps);
  }
  return true;
}

function pending(room, viewerId, deps) {
  const state = normalizeState(room);
  const battleChoice = state.battleChoices.find(
    (choice) =>
      choice.status === "open" &&
      (choice.playerId === viewerId || room.hostId === viewerId)
  );

  return {
    success: true,
    version: "49.0.0",
    battleChoice: battleChoice || null
  };
}

function publicState(room, viewerId, deps) {
  const player = deps.findPlayer(room, viewerId);
  if (!player?.game) {
    return {
      success: true,
      version: "49.0.0",
      dayNight: room.rules?.dayNight || null,
      permanents: []
    };
  }

  return {
    success: true,
    version: "49.0.0",
    dayNight: room.rules?.dayNight || null,
    permanents: player.game.battlefield.map((card) => ({
      card: deps.publicCard(card),
      canTransform: isTransformLayout(card) && cardFaces(card).length > 1,
      canTurnFaceUp: Boolean(card.faceDown),
      isSaga: isSaga(card, deps),
      lore: Number(card.counters?.lore ?? card.lore) || 0,
      isBattle: isBattle(card, deps),
      defense: Number(card.counters?.defense) || 0,
      mutateCount: list(card.specialState?.mutateComponents).length
    })),
    canManifest: player.game.library.length > 0,
    battles: room.players.flatMap((entry) =>
      (entry.game?.battlefield || [])
        .filter((card) => isBattle(card, deps))
        .map((card) => ({
          card: deps.publicCard(card),
          controllerId: entry.id,
          defense: Number(card.counters?.defense) || 0
        }))
    )
  };
}

function processGameAction(room, actor, action, legacyProcess, deps) {
  const type = String(action?.type || "");
  const state = normalizeState(room);

  if (type === "forms-play") {
    const result = selectedFacePlay(room, actor, action, legacyProcess, deps);
    if (result?.success) incrementSpellCount(room, actor.id);
    return result;
  }

  if (type === "forms-transform") {
    return transformPermanent(room, actor, action?.cardId, deps);
  }

  if (type === "forms-manifest") {
    return manifestTop(room, actor, deps);
  }

  if (type === "forms-turn-face-up") {
    return turnFaceUp(room, actor, action?.cardId, deps);
  }

  if (type === "forms-mutate") {
    return mutateCard(room, actor, action, deps);
  }

  if (type === "forms-damage-battle") {
    return damageBattle(room, actor, action, deps);
  }

  if (type === "forms-resolve-battle") {
    return resolveBattleChoice(room, actor, action, deps);
  }

  if (
    state.battleChoices.length &&
    !["judge-action", "undo-last", "check-state-based"].includes(type)
  ) {
    const waiting = deps.findPlayer(room, state.battleChoices[0].playerId);
    return {
      success: false,
      error: `${waiting?.name || "A player"} must resolve a defeated Battle.`
    };
  }

  if (
    type === "move-card" &&
    action?.fromZone === "battlefield"
  ) {
    const split = splitMutateMove(room, actor, action, deps);
    if (split) return split;
  }

  const beforeIds = room.players.flatMap((player) =>
    (player.game?.battlefield || []).map((card) => card.id)
  );
  const previousTurn = Number(room.turn?.number) || 0;
  const previousPhase = Number(room.turn?.phaseIndex) || 0;

  const result = legacyProcess(room, actor, action);
  if (!result?.success) return result;

  if (
    ["cast-card", "auto-cast-card", "mechanic-auto-cast", "permission-play-card"].includes(type)
  ) {
    incrementSpellCount(room, actor.id);
  }

  initializeNewPermanents(room, beforeIds, deps);
  checkBattles(room, deps);
  resetFaceOutsideBattlefield(room);

  if (
    previousTurn !== Number(room.turn?.number || 0) ||
    previousPhase !== Number(room.turn?.phaseIndex || 0)
  ) {
    checkDayNightAtUpkeep(room, deps);
    advanceSagasAtMainOne(room, deps);
  }

  return result;
}

function afterResolve(room, item, deps) {
  moveAdventureToExile(room, item, deps);
  sacrificeFinalSaga(room, item, deps);

  const controller = deps.findPlayer(room, item?.controllerId);
  const resolvedPermanent = controller?.game?.battlefield?.find(
    (card) => card.id === item?.card?.id
  );
  if (resolvedPermanent) {
    initializePermanent(room, resolvedPermanent, controller, deps);
  }

  checkBattles(room, deps);
  resetFaceOutsideBattlefield(room);
}

function createPermanentFormsEngine(deps) {
  return {
    version: "49.0.0",

    preview(room, actor, action) {
      return preview(room, actor, action, deps);
    },

    processGameAction(room, actor, action, legacyProcess) {
      return processGameAction(room, actor, action, legacyProcess, deps);
    },

    afterResolve(room, item) {
      return afterResolve(room, item, deps);
    },

    pending(room, viewerId) {
      return pending(room, viewerId, deps);
    },

    state(room, viewerId) {
      return publicState(room, viewerId, deps);
    },

    status() {
      return {
        success: true,
        version: "49.0.0",
        automatic: [
          "modal double-faced card face selection",
          "transforming double-faced permanents",
          "Adventure spell face casting and exile permission",
          "Prototype alternate cost and prototype power/toughness",
          "Battle defense counters and defeated-Battle prompt",
          "free back-face permission for defeated Battles",
          "Saga lore counters and chapter stack items",
          "final Saga sacrifice after final chapter resolution",
          "Morph and Disguise face-down casting",
          "Manifest from the top of the library",
          "automatic face-up mana payment",
          "Disguise ward text while face down",
          "basic Mutate over/under merging",
          "mutate-pile separation on manual zone moves",
          "day and night spell counting",
          "automatic Daybound and Nightbound transformation"
        ],
        assisted: [
          "Mutate piles leaving through state-based actions or complex effects",
          "Battle attack declarations and protection interactions",
          "Saga read-ahead and nonstandard lore-counter changes",
          "copying face-down or merged permanents",
          "Foretell, Manifest Dread and Cloak",
          "MDFC commander-zone choices",
          "transform effects with unusual replacement instructions",
          "full hidden-information security audits"
        ]
      };
    }
  };
}

module.exports = {
  createPermanentFormsEngine,
  _test: {
    cardFaces,
    cardLayout,
    setFace,
    parsePrototype,
    parseMorph,
    parseMutate,
    parseSagaChapters,
    finalSagaChapter,
    battleDefense,
    autoPay,
    faceOptions,
    addLore,
    initializePermanent,
    checkBattles,
    resolveBattleChoice,
    incrementSpellCount,
    spellCount,
    setDayNight,
    checkDayNightAtUpkeep,
    advanceSagasAtMainOne,
    moveAdventureToExile,
    splitMutateMove
  }
};
