"use strict";

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
  room.copiesV54 =
    room.copiesV54 && typeof room.copiesV54 === "object"
      ? room.copiesV54
      : {};

  const state = room.copiesV54;
  state.choices = list(state.choices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-50);
  state.stackMeta =
    state.stackMeta && typeof state.stackMeta === "object"
      ? state.stackMeta
      : {};
  state.suppressedText =
    state.suppressedText && typeof state.suppressedText === "object"
      ? state.suppressedText
      : {};
  state.copyLog = list(state.copyLog).slice(-120);
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

function manaValue(card, deps) {
  const face = currentFace(card, deps);
  const value =
    face.manaValue ??
    face.cmc ??
    card?.cardData?.manaValue ??
    card?.cardData?.cmc;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function battlefieldEntries(room) {
  return room.players.flatMap((player) =>
    (player.game?.battlefield || []).map((card, index) => ({
      player,
      card,
      index,
      zone: "battlefield"
    }))
  );
}

function copyableBlueprint(source, deps) {
  const stored = source?.specialState?.copyBlueprintV54;
  if (stored && typeof stored === "object") return clone(stored);

  const face = clone(currentFace(source, deps));
  const originalData = clone(source?.cardData || {});
  const faces = list(originalData.faces);
  const activeFaceIndex = Math.max(
    0,
    Math.floor(Number(source?.activeFaceIndex) || 0)
  );

  let cardData;
  if (faces.length && face) {
    cardData = {
      ...clone(face),
      name: face.name || source.name,
      faces: [clone(face)],
      layout: "v54-copied-face"
    };
  } else {
    cardData = originalData;
  }

  cardData.name = cardData.name || source?.name || "Copy";
  cardData.typeLine =
    cardData.typeLine || typeLine(source, deps);
  cardData.oracleText =
    cardData.oracleText || oracle(source, deps);
  cardData.power =
    cardData.power ?? source?.power ?? "";
  cardData.toughness =
    cardData.toughness ?? source?.toughness ?? "";
  cardData.loyalty =
    cardData.loyalty ?? source?.loyalty ?? "";
  cardData.defense =
    cardData.defense ?? source?.defense ?? "";
  cardData.keywords = unique(cardData.keywords);

  return {
    version: "54.0.0",
    sourceCardId: source?.id || null,
    sourceName: source?.name || cardData.name,
    name: cardData.name,
    cardData,
    activeFaceIndex: faces.length ? 0 : activeFaceIndex,
    power: String(cardData.power ?? ""),
    toughness: String(cardData.toughness ?? ""),
    loyalty: String(cardData.loyalty ?? ""),
    defense: String(cardData.defense ?? ""),
    modifications: []
  };
}

function setCurrentFaceValue(cardData, key, value) {
  cardData[key] = value;
  if (list(cardData.faces).length) {
    cardData.faces[0] = cardData.faces[0] || {};
    cardData.faces[0][key] = value;
  }
}

function currentBlueprintType(blueprint) {
  return String(
    blueprint.cardData?.faces?.[0]?.typeLine ||
    blueprint.cardData?.typeLine ||
    ""
  );
}

function currentBlueprintOracle(blueprint) {
  return String(
    blueprint.cardData?.faces?.[0]?.oracleText ||
    blueprint.cardData?.oracleText ||
    ""
  );
}

function applyCopyModifications(rawBlueprint, rawModifiers = {}) {
  const blueprint = clone(rawBlueprint);
  const modifiers =
    rawModifiers && typeof rawModifiers === "object"
      ? rawModifiers
      : {};

  let copiedType = currentBlueprintType(blueprint);
  let copiedOracle = currentBlueprintOracle(blueprint);
  const applied = [];

  if (modifiers.nonlegendary) {
    copiedType = copiedType
      .replace(/\bLegendary\b\s*/i, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    applied.push("not legendary");
  }

  if (modifiers.addArtifact && !/\bArtifact\b/i.test(copiedType)) {
    copiedType = `Artifact ${copiedType}`.trim();
    applied.push("artifact in addition");
  }

  if (modifiers.addCreature && !/\bCreature\b/i.test(copiedType)) {
    copiedType = copiedType.replace(
      /\bArtifact\b/i,
      "Artifact Creature"
    );
    if (!/\bCreature\b/i.test(copiedType)) {
      copiedType = `Creature ${copiedType}`.trim();
    }
    applied.push("creature in addition");
  }

  if (String(modifiers.name || "").trim()) {
    const name = String(modifiers.name).trim().slice(0, 150);
    blueprint.name = name;
    setCurrentFaceValue(blueprint.cardData, "name", name);
    applied.push(`named ${name}`);
  }

  const power = String(modifiers.power ?? "").trim();
  const toughness = String(modifiers.toughness ?? "").trim();
  if (power || toughness) {
    if (power) {
      blueprint.power = power;
      setCurrentFaceValue(blueprint.cardData, "power", power);
    }
    if (toughness) {
      blueprint.toughness = toughness;
      setCurrentFaceValue(blueprint.cardData, "toughness", toughness);
    }
    applied.push(`${power || blueprint.power}/${toughness || blueprint.toughness}`);
  }

  const addKeywords = unique(modifiers.addKeywords)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  if (addKeywords.length) {
    const keywords = unique([
      ...list(blueprint.cardData.keywords),
      ...addKeywords
    ]);
    blueprint.cardData.keywords = keywords;
    if (list(blueprint.cardData.faces).length) {
      blueprint.cardData.faces[0].keywords = unique([
        ...list(blueprint.cardData.faces[0].keywords),
        ...addKeywords
      ]);
    }
    copiedOracle = [
      copiedOracle,
      addKeywords.join(", ")
    ].filter(Boolean).join("\n");
    applied.push(`has ${addKeywords.join(", ")}`);
  }

  if (String(modifiers.appendOracle || "").trim()) {
    const extra = String(modifiers.appendOracle).trim().slice(0, 1200);
    copiedOracle = [copiedOracle, extra].filter(Boolean).join("\n");
    applied.push("additional rules text");
  }

  setCurrentFaceValue(blueprint.cardData, "typeLine", copiedType);
  setCurrentFaceValue(blueprint.cardData, "oracleText", copiedOracle);
  blueprint.modifications = unique([
    ...list(blueprint.modifications),
    ...applied
  ]);
  return blueprint;
}

function parseExceptModifications(text) {
  const normalized = String(text || "");
  const modifiers = {
    nonlegendary: /\bexcept (?:it|the token) isn'?t legendary\b/i.test(normalized),
    addArtifact:
      /\bexcept (?:it|the token) is an artifact in addition to its other types\b/i.test(normalized),
    addCreature:
      /\bexcept (?:it|the token) is a creature in addition to its other types\b/i.test(normalized),
    power: "",
    toughness: "",
    addKeywords: []
  };

  const stats = normalized.match(
    /\bexcept (?:it|the token)(?:'s base power and toughness are| is)\s+([*+\-\d]+)\s*\/\s*([*+\-\d]+)/i
  );
  if (stats) {
    modifiers.power = stats[1];
    modifiers.toughness = stats[2];
  }

  const name = normalized.match(
    /\bexcept (?:its|the token'?s) name is ([^.,\n]+)/i
  );
  if (name) modifiers.name = name[1].trim();

  const keywordBlock = normalized.match(
    /\bexcept (?:it|the token) (?:has|gains) ([^.\n]+)/i
  );
  if (keywordBlock) {
    modifiers.addKeywords = keywordBlock[1]
      .split(/\s*,\s*|\s+and\s+/i)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return modifiers;
}

function prepareCopiedCard(
  original,
  blueprint,
  options,
  deps
) {
  const entering = options?.entering !== false;
  const preserveRuntime = Boolean(options?.preserveRuntime);
  const previous = preserveRuntime
    ? {
        tapped: original.tapped,
        counters: clone(original.counters || {}),
        damageMarked: Number(original.damageMarked) || 0,
        deathtouchMarked: Boolean(original.deathtouchMarked),
        attacking: Boolean(original.attacking),
        defendingPlayerId: original.defendingPlayerId || null,
        defendingPermanentId: original.defendingPermanentId || null,
        blockingCardId: original.blockingCardId || null,
        attachedToId: original.attachedToId || null,
        summoningSick: Boolean(original.summoningSick),
        manualKeywords: clone(original.manualKeywords || []),
        temporaryEffects: clone(original.temporaryEffects || []),
        ruleEffects: clone(original.ruleEffects || []),
        judgeOverrides: clone(original.judgeOverrides || {})
      }
    : null;

  const identity = {
    id: original.id,
    ownerId: original.ownerId,
    controllerId: original.controllerId,
    token: Boolean(options?.token ?? original.token),
    commander: Boolean(options?.commander ?? original.commander),
    objectType: options?.objectType || original.objectType || "card"
  };

  original.name = blueprint.name;
  original.cardData = clone(blueprint.cardData);
  original.activeFaceIndex = Number(blueprint.activeFaceIndex) || 0;
  original.power = String(blueprint.power ?? "");
  original.toughness = String(blueprint.toughness ?? "");
  original.loyalty = String(blueprint.loyalty ?? "");
  original.defense = String(blueprint.defense ?? "");
  original.copiedFromCardId =
    blueprint.sourceCardId || original.copiedFromCardId || null;
  original.specialState = original.specialState || {};
  original.specialState.copyBlueprintV54 = clone(blueprint);
  original.specialState.copyAppliedV54 = true;
  original.specialState.copyAppliedAtV54 =
    options?.now || new Date().toISOString();

  Object.assign(original, identity);

  if (preserveRuntime && previous) {
    Object.assign(original, previous);
  } else {
    original.tapped = false;
    original.counters = {};
    original.damageMarked = 0;
    original.deathtouchMarked = false;
    original.attacking = false;
    original.defendingPlayerId = null;
    original.defendingPermanentId = null;
    original.blockingCardId = null;
    original.attachedToId = null;
    original.manualKeywords = [];
    original.temporaryEffects = [];
    original.ruleEffects = [];
    original.judgeOverrides = {};
    original.summoningSick =
      entering && deps.isCreatureCard(original);
  }

  return original;
}

function createTokenCopy(
  room,
  actor,
  source,
  rawModifiers,
  deps
) {
  const blueprint = applyCopyModifications(
    copyableBlueprint(source, deps),
    rawModifiers
  );

  const card = deps.migrateCard(
    {
      id: deps.createId(),
      name: blueprint.name,
      ownerId: actor.id,
      controllerId: actor.id,
      token: true,
      commander: false,
      objectType: "token",
      cardData: clone(blueprint.cardData),
      activeFaceIndex: blueprint.activeFaceIndex,
      power: blueprint.power,
      toughness: blueprint.toughness,
      loyalty: blueprint.loyalty,
      defense: blueprint.defense,
      specialState: {
        copyBlueprintV54: clone(blueprint),
        copyAppliedV54: true,
        copiedAsTokenV54: true
      }
    },
    actor.id
  );

  prepareCopiedCard(
    card,
    blueprint,
    {
      entering: true,
      token: true,
      commander: false,
      objectType: "token",
      now: deps.nowIso()
    },
    deps
  );

  actor.game.battlefield.unshift(card);
  deps.queueSuggestedTriggers(room, "PERMANENT_ENTERED", {
    card,
    controllerId: actor.id,
    copiedPermanentV54: true
  });

  normalizeState(room).copyLog.push({
    id: deps.createId(),
    type: "token-permanent",
    sourceId: source.id,
    copyId: card.id,
    playerId: actor.id,
    modifications: list(blueprint.modifications),
    createdAt: deps.nowIso()
  });

  deps.addLog(
    room,
    `${actor.name} created a token copy of ${source.name}.`,
    "copy"
  );
  return card;
}

function becomeCopy(
  room,
  actor,
  copyCardId,
  sourceCardId,
  rawModifiers,
  deps
) {
  const copyLocated = deps.findBattlefieldCard(
    room,
    String(copyCardId || "")
  );
  const sourceLocated = deps.findBattlefieldCard(
    room,
    String(sourceCardId || "")
  );

  if (
    !copyLocated ||
    copyLocated.card.controllerId !== actor.id
  ) {
    return {
      success: false,
      error: "Choose a permanent you control to become the copy."
    };
  }
  if (!sourceLocated || sourceLocated.card.id === copyLocated.card.id) {
    return {
      success: false,
      error: "Choose another permanent to copy."
    };
  }

  const blueprint = applyCopyModifications(
    copyableBlueprint(sourceLocated.card, deps),
    rawModifiers
  );

  if (!copyLocated.card.specialState?.originalBlueprintV54) {
    copyLocated.card.specialState =
      copyLocated.card.specialState || {};
    copyLocated.card.specialState.originalBlueprintV54 =
      copyableBlueprint(copyLocated.card, deps);
  }

  prepareCopiedCard(
    copyLocated.card,
    blueprint,
    {
      entering: false,
      preserveRuntime: true,
      now: deps.nowIso()
    },
    deps
  );

  normalizeState(room).copyLog.push({
    id: deps.createId(),
    type: "become-copy",
    sourceId: sourceLocated.card.id,
    copyId: copyLocated.card.id,
    playerId: actor.id,
    modifications: list(blueprint.modifications),
    createdAt: deps.nowIso()
  });

  deps.runStateBasedActions(room, "become-copy-v54");
  deps.addLog(
    room,
    `${actor.name}'s permanent became a copy of ${sourceLocated.card.name}.`,
    "copy"
  );

  return {
    success: true,
    copyId: copyLocated.card.id
  };
}

function restoreOriginalCopy(room, actor, cardId, deps) {
  const located = deps.findBattlefieldCard(room, String(cardId || ""));
  if (
    !located ||
    located.card.controllerId !== actor.id ||
    !located.card.specialState?.originalBlueprintV54
  ) {
    return {
      success: false,
      error: "That permanent has no saved original copyable values."
    };
  }

  const blueprint = clone(
    located.card.specialState.originalBlueprintV54
  );
  delete located.card.specialState.originalBlueprintV54;

  prepareCopiedCard(
    located.card,
    blueprint,
    {
      entering: false,
      preserveRuntime: true,
      now: deps.nowIso()
    },
    deps
  );
  delete located.card.specialState.copyAppliedV54;
  delete located.card.specialState.copyBlueprintV54;

  deps.runStateBasedActions(room, "restore-copy-v54");
  deps.addLog(
    room,
    `${actor.name} restored ${located.card.name}'s original copyable values.`,
    "copy"
  );
  return { success: true };
}

function isPermanentSpellItem(item, deps) {
  return Boolean(
    item?.kind === "spell" &&
    item.card &&
    deps.isPermanentCard(item.card)
  );
}

function validTarget(room, target, deps) {
  const [kind, id] = String(target || "").split(":");

  if (kind === "player") return Boolean(deps.findPlayer(room, id));
  if (kind === "card") return Boolean(deps.locateCard(room, id));
  if (kind === "stack") {
    return Boolean(room.stack?.some((item) => item.id === id));
  }
  return false;
}

function validateCopiedTargets(room, source, targets, deps) {
  const sourceTargets = unique(source?.targets);
  const requested = unique(targets);

  if (!requested.length) return {
    success: true,
    targets: [...sourceTargets]
  };

  if (requested.length !== sourceTargets.length) {
    return {
      success: false,
      error: `The copy needs ${sourceTargets.length} target${
        sourceTargets.length === 1 ? "" : "s"
      }.`
    };
  }

  if (requested.some((target) => !validTarget(room, target, deps))) {
    return {
      success: false,
      error: "A requested new target is unavailable."
    };
  }

  return {
    success: true,
    targets: requested
  };
}

function permanentSpellCopyCard(sourceItem, actor, deps) {
  const sourceCard = sourceItem.card;
  const blueprint = copyableBlueprint(sourceCard, deps);

  const card = deps.migrateCard(
    {
      id: deps.createId(),
      name: blueprint.name,
      ownerId: actor.id,
      controllerId: actor.id,
      token: true,
      commander: false,
      objectType: "token",
      cardData: clone(blueprint.cardData),
      activeFaceIndex: blueprint.activeFaceIndex,
      power: blueprint.power,
      toughness: blueprint.toughness,
      loyalty: blueprint.loyalty,
      defense: blueprint.defense,
      specialState: {
        copyBlueprintV54: clone(blueprint),
        copyAppliedV54: true,
        permanentSpellCopyV54: true,
        notCreatedTokenV54: true
      }
    },
    actor.id
  );

  prepareCopiedCard(
    card,
    blueprint,
    {
      entering: true,
      token: true,
      commander: false,
      objectType: "token",
      now: deps.nowIso()
    },
    deps
  );

  card.specialState.permanentSpellCopyV54 = true;
  card.specialState.notCreatedTokenV54 = true;
  return card;
}

function sourceStackMetadata(room, source) {
  return {
    ...(clone(source?.v54Meta || {}) || {}),
    ...(clone(normalizeState(room).stackMeta[source?.id]) || {})
  };
}

function copyStackItem(
  room,
  actor,
  stackItemId,
  newTargets,
  deps
) {
  const source = room.stack?.find(
    (item) => item.id === String(stackItemId || "")
  );
  if (!source) {
    return {
      success: false,
      error: "Choose a spell or ability on the stack to copy."
    };
  }

  const targetResult = validateCopiedTargets(
    room,
    source,
    newTargets,
    deps
  );
  if (!targetResult.success) return targetResult;

  const sourceMeta = sourceStackMetadata(room, source);
  const copyItem = {
    ...clone(source),
    id: deps.createId(),
    name: `${source.name} copy`,
    controllerId: actor.id,
    targets: targetResult.targets,
    copiedFromStackItemId: source.id,
    isCopy: true,
    createdAt: deps.nowIso(),
    v54Meta: {
      ...sourceMeta,
      copiedFromStackItemId: source.id,
      copiedModes: clone(
        sourceMeta.modes ??
        source.modes ??
        source.selectedModes ??
        []
      ),
      copiedXValue:
        sourceMeta.xValue ??
        source.xValue ??
        source.chosenX ??
        0,
      copiedAdditionalCosts: clone(
        sourceMeta.additionalCosts ??
        source.additionalCosts ??
        source.costChoices ??
        {}
      ),
      copiedDivision: clone(
        sourceMeta.division ??
        source.division ??
        source.dividedAmounts ??
        {}
      )
    }
  };

  if (isPermanentSpellItem(source, deps)) {
    copyItem.card = permanentSpellCopyCard(
      source,
      actor,
      deps
    );
    copyItem.sourceZone = "stack-copy";
  } else {
    copyItem.card = null;
  }

  room.stack.push(copyItem);
  normalizeState(room).stackMeta[copyItem.id] = clone(
    copyItem.v54Meta
  );
  deps.resetPriority(room, actor.id);

  normalizeState(room).copyLog.push({
    id: deps.createId(),
    type: "stack",
    sourceId: source.id,
    copyId: copyItem.id,
    playerId: actor.id,
    targets: clone(copyItem.targets),
    createdAt: deps.nowIso()
  });

  deps.addLog(
    room,
    `${actor.name} copied ${source.name} on the stack.`,
    "copy"
  );
  return {
    success: true,
    copyId: copyItem.id,
    permanentSpellCopy: Boolean(copyItem.card)
  };
}

function cloneInstruction(card, deps) {
  const text = oracle(card, deps);
  const hasCopyLanguage =
    /\b(?:you may have )?(?:this|[^.\n]{0,80}) enter(?:s)? (?:the battlefield )?as a copy of\b/i.test(text) ||
    /\bas [^.\n]{0,80} enters(?: the battlefield)?, (?:you may have )?it become a copy of\b/i.test(text);

  if (!hasCopyLanguage) return null;

  const lower = text.toLowerCase();
  let kind = "permanent";
  if (/\bcopy of (?:any |a |target )?creature\b/i.test(text)) {
    kind = "creature";
  } else if (/\bcopy of (?:any |an |target )?artifact\b/i.test(text)) {
    kind = "artifact";
  } else if (/\bcopy of (?:any |a |target )?planeswalker\b/i.test(text)) {
    kind = "planeswalker";
  }

  return {
    optional:
      /\byou may have\b/i.test(text) ||
      /\bmay enter\b/i.test(text),
    kind,
    youControl:
      /\bcopy of (?:a|target|any) [^.\n]* you control\b/i.test(text),
    opponentControls:
      /\bcopy of (?:a|target|any) [^.\n]* an opponent controls\b/i.test(text),
    modifiers: parseExceptModifications(text)
  };
}

function cloneCandidates(room, controllerId, instruction, deps) {
  return battlefieldEntries(room)
    .filter(({ card }) => {
      if (instruction.youControl && card.controllerId !== controllerId) {
        return false;
      }
      if (
        instruction.opponentControls &&
        card.controllerId === controllerId
      ) {
        return false;
      }
      if (
        instruction.kind === "creature" &&
        !deps.isCreatureCard(card)
      ) {
        return false;
      }
      if (
        instruction.kind === "artifact" &&
        !/\bArtifact\b/i.test(typeLine(card, deps))
      ) {
        return false;
      }
      if (
        instruction.kind === "planeswalker" &&
        !/\bPlaneswalker\b/i.test(typeLine(card, deps))
      ) {
        return false;
      }
      return true;
    })
    .map(({ player, card }) => ({
      playerId: player.id,
      playerName: player.name,
      card: deps.publicCard(card),
      score:
        manaValue(card, deps) * 10 +
        Math.max(
          0,
          Number(deps.effectiveStats(card)?.power) || 0
        )
    }))
    .sort((a, b) => b.score - a.score);
}

function createCloneChoice(room, item, instruction, deps) {
  const state = normalizeState(room);
  const existing = state.choices.find(
    (choice) =>
      choice.kind === "clone-enter" &&
      choice.stackItemId === item.id &&
      choice.status === "open"
  );
  if (existing) return existing;

  const candidates = cloneCandidates(
    room,
    item.controllerId,
    instruction,
    deps
  );

  const choice = {
    id: deps.createId(),
    status: "open",
    kind: "clone-enter",
    playerId: item.controllerId,
    stackItemId: item.id,
    sourceCardId: item.card?.id || null,
    sourceName: item.card?.name || item.name,
    optional: instruction.optional,
    modifiers: clone(instruction.modifiers),
    candidateIds: candidates.map((entry) => entry.card.id),
    createdAt: deps.nowIso()
  };
  state.choices.push(choice);
  return choice;
}

function chooseCloneForBot(room, item, choice, deps) {
  const actor = deps.findPlayer(room, item.controllerId);
  if (!actor?.isBot) return false;

  const instruction = cloneInstruction(item.card, deps);
  const candidates = cloneCandidates(
    room,
    item.controllerId,
    instruction,
    deps
  );
  const selected = candidates[0]?.card?.id || "";

  if (!selected && !choice.optional) return false;

  return resolveCloneChoice(
    room,
    actor,
    {
      choiceId: choice.id,
      sourceCardId: selected,
      skip: !selected
    },
    deps
  ).success;
}

function resolveCloneChoice(room, actor, action, deps) {
  const state = normalizeState(room);
  const choice = state.choices.find(
    (entry) =>
      entry.id === action?.choiceId &&
      entry.kind === "clone-enter" &&
      entry.status === "open"
  );

  if (!choice) {
    return {
      success: false,
      error: "That Clone choice is unavailable."
    };
  }
  if (choice.playerId !== actor.id && room.hostId !== actor.id) {
    return {
      success: false,
      error: "That Clone choice belongs to another player."
    };
  }

  const item = room.stack?.find(
    (entry) => entry.id === choice.stackItemId
  );
  if (!item?.card) {
    choice.status = "resolved";
    state.choices = state.choices.filter(
      (entry) => entry.status === "open"
    );
    return { success: true };
  }

  if (action?.skip) {
    if (!choice.optional) {
      return {
        success: false,
        error: "This copy replacement is not optional."
      };
    }

    item.card.specialState = item.card.specialState || {};
    item.card.specialState.copyChoiceResolvedV54 = true;
    item.card.specialState.copyChoiceSkippedV54 = true;
  } else {
    const sourceCardId = String(action?.sourceCardId || "");
    if (!choice.candidateIds.includes(sourceCardId)) {
      return {
        success: false,
        error: "Choose a legal permanent to copy."
      };
    }

    const source = deps.findBattlefieldCard(
      room,
      sourceCardId
    )?.card;
    if (!source) {
      return {
        success: false,
        error: "The selected permanent is no longer on the battlefield."
      };
    }

    const originalBlueprint = copyableBlueprint(
      item.card,
      deps
    );
    const copiedBlueprint = applyCopyModifications(
      copyableBlueprint(source, deps),
      choice.modifiers
    );

    item.card.specialState = item.card.specialState || {};
    item.card.specialState.originalBlueprintV54 =
      originalBlueprint;

    prepareCopiedCard(
      item.card,
      copiedBlueprint,
      {
        entering: true,
        preserveRuntime: false,
        now: deps.nowIso()
      },
      deps
    );
    item.card.specialState.copyChoiceResolvedV54 = true;
    item.card.specialState.cloneSourceCardIdV54 = source.id;

    normalizeState(room).copyLog.push({
      id: deps.createId(),
      type: "clone-enter",
      sourceId: source.id,
      copyId: item.card.id,
      playerId: item.controllerId,
      modifications: list(copiedBlueprint.modifications),
      createdAt: deps.nowIso()
    });
  }

  choice.status = "resolved";
  state.choices = state.choices.filter(
    (entry) => entry.status === "open"
  );
  deps.resetPriority(room, item.controllerId);
  return { success: true };
}

function automaticCopyPattern(text) {
  return (
    /\bcreate (?:a|one) token that'?s a copy of target (?:artifact|creature|permanent)/i.test(text) ||
    /\bcopy target (?:instant or sorcery )?spell\b/i.test(text) ||
    /\bcopy target (?:activated or triggered )?ability\b/i.test(text)
  );
}

function suppressOlderCopyEngine(room, item) {
  if (!item || !automaticCopyPattern(item.text || "")) return;
  const state = normalizeState(room);
  if (state.suppressedText[item.id]) return;

  state.suppressedText[item.id] = item.text;
  item.text = String(item.text).replace(/\bcopy\b/gi, "duplicate");
}

function restoreSuppressedText(room, item) {
  if (!item) return;
  const state = normalizeState(room);
  if (!state.suppressedText[item.id]) return;

  item.text = state.suppressedText[item.id];
  delete state.suppressedText[item.id];
}

function locateTargetPermanent(room, targets, deps) {
  for (const target of unique(targets)) {
    if (!target.startsWith("card:")) continue;
    const located = deps.findBattlefieldCard(
      room,
      target.slice(5)
    );
    if (located) return located.card;
  }
  return null;
}

function locateTargetStack(room, targets) {
  for (const target of unique(targets)) {
    const id = target.startsWith("stack:")
      ? target.slice(6)
      : target;
    const item = room.stack?.find((entry) => entry.id === id);
    if (item) return item;
  }
  return null;
}

function automaticCopies(room, item, deps) {
  const text = String(item?.text || "");
  const actor = deps.findPlayer(room, item?.controllerId);
  if (!actor?.game) return;

  if (
    /\bcreate (?:a|one) token that'?s a copy of target (?:artifact|creature|permanent)/i.test(text)
  ) {
    const source = locateTargetPermanent(
      room,
      item.targets,
      deps
    );
    if (source) {
      createTokenCopy(
        room,
        actor,
        source,
        parseExceptModifications(text),
        deps
      );
    }
  }

  if (
    /\bcopy target (?:instant or sorcery )?spell\b/i.test(text) ||
    /\bcopy target (?:activated or triggered )?ability\b/i.test(text)
  ) {
    const source = locateTargetStack(room, item.targets);
    if (source) {
      copyStackItem(
        room,
        actor,
        source.id,
        item.newTargets || [],
        deps
      );
    }
  }
}

function beforeResolve(room, item, deps) {
  if (!item) return { success: true, blocked: false };

  if (
    isPermanentSpellItem(item, deps) &&
    !item.card.specialState?.copyChoiceResolvedV54
  ) {
    const instruction = cloneInstruction(item.card, deps);

    if (instruction) {
      const candidates = cloneCandidates(
        room,
        item.controllerId,
        instruction,
        deps
      );

      if (!candidates.length && instruction.optional) {
        item.card.specialState =
          item.card.specialState || {};
        item.card.specialState.copyChoiceResolvedV54 = true;
        item.card.specialState.copyChoiceSkippedV54 = true;
      } else {
        const choice = createCloneChoice(
          room,
          item,
          instruction,
          deps
        );

        if (chooseCloneForBot(room, item, choice, deps)) {
          return { success: true, blocked: false };
        }

        return {
          success: true,
          blocked: true,
          choiceId: choice.id
        };
      }
    }
  }

  suppressOlderCopyEngine(room, item);
  return { success: true, blocked: false };
}

function afterResolve(room, item, deps) {
  if (!item) return;

  restoreSuppressedText(room, item);
  automaticCopies(room, item, deps);

  const state = normalizeState(room);
  delete state.stackMeta[item.id];
  state.choices = state.choices.filter(
    (choice) => choice.stackItemId !== item.id
  );

  deps.runStateBasedActions(room, "copies-v54");
}

function copyPermanentAction(room, actor, action, deps) {
  const located = deps.findBattlefieldCard(
    room,
    String(action?.sourceCardId || action?.targetCardId || "")
  );
  if (!located) {
    return {
      success: false,
      error: "Choose a permanent on the battlefield to copy."
    };
  }

  const card = createTokenCopy(
    room,
    actor,
    located.card,
    action?.modifiers,
    deps
  );
  deps.runStateBasedActions(room, "token-copy-v54");
  return {
    success: true,
    copyId: card.id
  };
}

function processGameAction(room, actor, action, legacy, deps) {
  const type = String(action?.type || "");

  if (type === "copies-v54-token-copy" || type === "copy-permanent") {
    return copyPermanentAction(room, actor, action, deps);
  }

  if (type === "copies-v54-stack-copy" || type === "copy-stack-item") {
    return copyStackItem(
      room,
      actor,
      action?.stackItemId,
      action?.targets,
      deps
    );
  }

  if (type === "copies-v54-become-copy") {
    return becomeCopy(
      room,
      actor,
      action?.copyCardId,
      action?.sourceCardId,
      action?.modifiers,
      deps
    );
  }

  if (type === "copies-v54-restore") {
    return restoreOriginalCopy(
      room,
      actor,
      action?.cardId,
      deps
    );
  }

  if (type === "copies-v54-resolve-clone") {
    return resolveCloneChoice(
      room,
      actor,
      action,
      deps
    );
  }

  const result = legacy(room, actor, action);
  normalizeState(room);
  return result;
}

function stateForViewer(room, viewerId, deps) {
  const player = deps.findPlayer(room, viewerId);
  if (!player?.game) {
    return {
      success: true,
      version: "54.0.0",
      stack: [],
      permanents: [],
      controlledPermanents: [],
      copyLog: []
    };
  }

  return {
    success: true,
    version: "54.0.0",
    stack: (room.stack || []).map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      controllerId: item.controllerId,
      targets: unique(item.targets),
      permanentSpell: isPermanentSpellItem(item, deps),
      isCopy: Boolean(item.isCopy),
      metadata: sourceStackMetadata(room, item)
    })),
    permanents: battlefieldEntries(room).map(
      ({ player: controller, card }) => ({
        playerId: controller.id,
        playerName: controller.name,
        card: deps.publicCard(card),
        copyable: true,
        isCopy: Boolean(card.specialState?.copyBlueprintV54),
        blueprintModifications: list(
          card.specialState?.copyBlueprintV54?.modifications
        )
      })
    ),
    controlledPermanents: player.game.battlefield.map((card) => ({
      card: deps.publicCard(card),
      isCopy: Boolean(card.specialState?.copyBlueprintV54),
      canRestore: Boolean(
        card.specialState?.originalBlueprintV54
      )
    })),
    copyLog: normalizeState(room).copyLog.slice(-25)
  };
}

function pendingForViewer(room, viewerId, deps) {
  const choice = normalizeState(room).choices.find(
    (entry) =>
      entry.status === "open" &&
      (entry.playerId === viewerId || room.hostId === viewerId)
  );

  if (!choice) {
    return {
      success: true,
      version: "54.0.0",
      choice: null
    };
  }

  const item = room.stack?.find(
    (entry) => entry.id === choice.stackItemId
  );
  const instruction = item?.card
    ? cloneInstruction(item.card, deps)
    : null;

  const candidates =
    item && instruction
      ? cloneCandidates(
          room,
          item.controllerId,
          instruction,
          deps
        ).filter((entry) =>
          choice.candidateIds.includes(entry.card.id)
        )
      : [];

  return {
    success: true,
    version: "54.0.0",
    choice: {
      ...choice,
      candidates
    }
  };
}

function summary(room) {
  const state = normalizeState(room);
  return {
    version: "54.0.0",
    pendingCloneChoices: state.choices.length,
    copiedStackItems: (room.stack || []).filter(
      (item) => item.isCopy
    ).length,
    copiedPermanents: battlefieldEntries(room).filter(
      ({ card }) => card.specialState?.copyBlueprintV54
    ).length,
    copyLogEntries: state.copyLog.length
  };
}

function createCopyRulesEngine(deps) {
  return {
    version: "54.0.0",

    processGameAction(room, actor, action, legacy) {
      return processGameAction(
        room,
        actor,
        action,
        legacy,
        deps
      );
    },

    beforeResolve(room, item) {
      return beforeResolve(room, item, deps);
    },

    afterResolve(room, item) {
      return afterResolve(room, item, deps);
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
        version: "54.0.0",
        automatic: [
          "printed and previously established copyable-value snapshots",
          "copies excluding tapped status, counters, damage, attachments and ordinary continuous effects",
          "copies of permanents that are already copying something else",
          "Clone-style copy choices before permanent spells resolve",
          "optional Clone choices",
          "token copies of permanents",
          "existing permanents becoming copies while retaining counters, damage, tapped status and attachments",
          "copy modifications for nonlegendary, artifact addition, creature addition, base power/toughness, names and keywords",
          "spell and ability copies on the stack",
          "copied modes, X values, additional-cost choices and divided amounts",
          "legal new target validation with the same target count",
          "copies of permanent spells resolving as token permanents",
          "automatic common create-a-token-copy effects",
          "automatic common copy-target-spell and copy-target-ability effects",
          "suppression of the older v47 generic copy handler to prevent duplicate copies",
          "copy history and multiplayer copy controls"
        ],
        assisted: [
          "copy effects with linked characteristic-defining exceptions not represented in Oracle text",
          "face-down objects and copy effects involving hidden information",
          "copying merged or melded permanents",
          "copying spells with targets whose legal target count changes",
          "choosing different modes for effects that specifically permit it",
          "complex distributed damage or counters",
          "copy-layer dependency and timestamp loops",
          "copying objects outside the battlefield or stack without explicit card scripts",
          "card-specific replacement effects that modify how a copy enters"
        ]
      };
    }
  };
}

module.exports = {
  createCopyRulesEngine,
  _test: {
    copyableBlueprint,
    applyCopyModifications,
    parseExceptModifications,
    prepareCopiedCard,
    createTokenCopy,
    becomeCopy,
    restoreOriginalCopy,
    validateCopiedTargets,
    permanentSpellCopyCard,
    copyStackItem,
    cloneInstruction,
    cloneCandidates,
    createCloneChoice,
    resolveCloneChoice,
    automaticCopyPattern,
    suppressOlderCopyEngine,
    restoreSuppressedText,
    beforeResolve,
    afterResolve
  }
};
