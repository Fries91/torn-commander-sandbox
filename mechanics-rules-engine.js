"use strict";

const COLORS = ["W", "U", "B", "R", "G", "C"];

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function normalizeState(room) {
  room.mechanicsV46 = room.mechanicsV46 && typeof room.mechanicsV46 === "object"
    ? room.mechanicsV46
    : {};
  room.mechanicsV46.choices = list(room.mechanicsV46.choices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-30);
  return room.mechanicsV46;
}

function manaValue(card, deps) {
  const face = deps.currentCardFace(card) || {};
  const direct = face.manaValue ?? face.cmc ?? card?.cardData?.manaValue ?? card?.cardData?.cmc;
  if (Number.isFinite(Number(direct))) return Number(direct);

  const cost = String(face.manaCost || card?.cardData?.manaCost || "");
  let total = 0;
  for (const match of cost.matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1].toUpperCase();
    if (/^\d+$/.test(symbol)) total += Number(symbol);
    else if (symbol !== "X") total += 1;
  }
  return total;
}

function parseManaCost(cost) {
  const requirement = {
    W: 0, U: 0, B: 0, R: 0, G: 0, C: 0,
    generic: 0,
    x: 0,
    unsupported: []
  };

  for (const match of String(cost || "").matchAll(/\{([^}]+)\}/g)) {
    const symbol = match[1].toUpperCase();
    if (/^\d+$/.test(symbol)) requirement.generic += Number(symbol);
    else if (COLORS.includes(symbol)) requirement[symbol] += 1;
    else if (symbol === "X") requirement.x += 1;
    else requirement.unsupported.push(symbol);
  }
  return requirement;
}

function addRequirement(target, addition, multiplier = 1) {
  for (const color of COLORS) target[color] += (addition[color] || 0) * multiplier;
  target.generic += (addition.generic || 0) * multiplier;
  target.x += (addition.x || 0) * multiplier;
  target.unsupported.push(...(addition.unsupported || []));
  return target;
}

function requirementToCost(requirement, xValue = 0) {
  const parts = [];
  const generic = Math.max(
    0,
    Math.floor(Number(requirement.generic) || 0) +
      Math.max(0, Math.floor(Number(xValue) || 0)) * (requirement.x || 0)
  );
  if (generic) parts.push(`{${generic}}`);
  for (const color of COLORS) {
    for (let index = 0; index < (requirement[color] || 0); index += 1) {
      parts.push(`{${color}}`);
    }
  }
  return parts.join("") || "{0}";
}

function extractCost(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text || "").match(
    new RegExp(`\\b${escaped}\\b\\s*(?:—|-)?\\s*((?:\\{[^}]+\\})+)`, "i")
  );
  return match ? match[1] : "";
}

function parseMechanics(card, deps) {
  const oracle = String(deps.currentOracleText(card) || "");
  const face = deps.currentCardFace(card) || {};
  const keywords = list(face.keywords || card?.cardData?.keywords).map((entry) => String(entry).toLowerCase());

  const kicker = extractCost(oracle, "Kicker");
  const multikicker = extractCost(oracle, "Multikicker");
  const overload = extractCost(oracle, "Overload");
  const buyback = extractCost(oracle, "Buyback");
  const flashback = extractCost(oracle, "Flashback");
  const escape = extractCost(oracle, "Escape");
  const escapeExile = oracle.match(/escape[^.\n]*exile\s+(\d+)\s+other cards? from your graveyard/i);
  const discover = oracle.match(/\bdiscover\s+(\d+)\b/i);
  const cascadeCount = (oracle.match(/\bcascade\b/gi) || []).length;

  return {
    baseManaCost: String(face.manaCost || card?.cardData?.manaCost || ""),
    kicker,
    multikicker,
    overload,
    buyback,
    flashback,
    escape,
    escapeExileCount: escapeExile ? Number(escapeExile[1]) : 0,
    convoke: keywords.includes("convoke") || /\bconvoke\b/i.test(oracle),
    delve: keywords.includes("delve") || /\bdelve\b/i.test(oracle),
    improvise: keywords.includes("improvise") || /\bimprovise\b/i.test(oracle),
    cascadeCount,
    discoverValue: discover ? Number(discover[1]) : 0
  };
}

function cardColors(card, deps) {
  const face = deps.currentCardFace(card) || {};
  const colors = list(face.colors || face.colorIdentity || card?.cardData?.colors || card?.cardData?.colorIdentity)
    .map((entry) => String(entry).toUpperCase())
    .filter((entry) => "WUBRG".includes(entry));
  return unique(colors);
}

function costPlan(card, selections, deps) {
  const mechanics = parseMechanics(card, deps);
  let baseCost = mechanics.baseManaCost;
  let alternative = "normal";

  if (selections.overload && mechanics.overload) {
    baseCost = mechanics.overload;
    alternative = "overload";
  } else if (selections.flashback && mechanics.flashback) {
    baseCost = mechanics.flashback;
    alternative = "flashback";
  } else if (selections.escape && mechanics.escape) {
    baseCost = mechanics.escape;
    alternative = "escape";
  } else if (selections.freeCast) {
    baseCost = "{0}";
    alternative = "free";
  }

  const requirement = parseManaCost(baseCost);
  const kickerCount = mechanics.multikicker
    ? Math.max(0, Math.floor(Number(selections.kickerCount) || 0))
    : selections.kicker && mechanics.kicker
      ? 1
      : 0;
  const kickerCost = mechanics.multikicker || mechanics.kicker;

  if (kickerCount && kickerCost) {
    addRequirement(requirement, parseManaCost(kickerCost), kickerCount);
  }
  if (selections.buyback && mechanics.buyback) {
    addRequirement(requirement, parseManaCost(mechanics.buyback), 1);
  }

  const convokeIds = unique(selections.convokeCardIds);
  const improviseIds = unique(selections.improviseCardIds);
  const delveIds = unique(selections.delveCardIds);
  const genericReduction = convokeIds.length + improviseIds.length + delveIds.length;
  requirement.generic = Math.max(0, requirement.generic - genericReduction);

  return {
    mechanics,
    alternative,
    requirement,
    effectiveManaCost: requirementToCost(requirement, selections.xValue),
    kickerCount,
    buyback: Boolean(selections.buyback && mechanics.buyback),
    convokeIds,
    improviseIds,
    delveIds,
    escapeExileIds: unique(selections.escapeExileCardIds)
  };
}

function locateSource(actor, action, deps) {
  const fromZone = ["hand", "commandZone", "graveyard", "exile"].includes(action?.fromZone)
    ? action.fromZone
    : "hand";
  const located = deps.getCardFromZone(actor.game, fromZone, String(action?.cardId || ""));
  return located ? { ...located, fromZone } : null;
}

function validConvokeCard(card, actorId, deps) {
  return (
    card.controllerId === actorId &&
    deps.isCreatureCard(card) &&
    !card.tapped &&
    !card.phasedOut &&
    (!card.summoningSick || deps.hasKeyword(card, "haste"))
  );
}

function validImproviseCard(card, actorId, deps) {
  return (
    card.controllerId === actorId &&
    /\bArtifact\b/i.test(String(deps.currentTypeLine(card) || "")) &&
    !card.tapped &&
    !card.phasedOut
  );
}

function validateCostSelections(actor, sourceCard, plan, deps) {
  for (const cardId of plan.convokeIds) {
    const card = actor.game.battlefield.find((entry) => entry.id === cardId);
    if (!card || !validConvokeCard(card, actor.id, deps)) {
      return { success: false, error: "A selected convoke creature is no longer available." };
    }
  }

  for (const cardId of plan.improviseIds) {
    const card = actor.game.battlefield.find((entry) => entry.id === cardId);
    if (!card || !validImproviseCard(card, actor.id, deps)) {
      return { success: false, error: "A selected improvise artifact is no longer available." };
    }
  }

  for (const cardId of plan.delveIds) {
    const card = actor.game.graveyard.find((entry) => entry.id === cardId);
    if (!card || card.id === sourceCard.id) {
      return { success: false, error: "A selected delve card is unavailable." };
    }
  }

  if (plan.alternative === "escape") {
    if (plan.escapeExileIds.length < plan.mechanics.escapeExileCount) {
      return {
        success: false,
        error: `Escape requires exiling ${plan.mechanics.escapeExileCount} other card${
          plan.mechanics.escapeExileCount === 1 ? "" : "s"
        }.`
      };
    }
    for (const cardId of plan.escapeExileIds) {
      const card = actor.game.graveyard.find((entry) => entry.id === cardId);
      if (!card || card.id === sourceCard.id) {
        return { success: false, error: "An Escape exile card is unavailable." };
      }
    }
  }

  return { success: true };
}

function applyAdditionalCosts(actor, plan) {
  for (const cardId of [...plan.convokeIds, ...plan.improviseIds]) {
    const card = actor.game.battlefield.find((entry) => entry.id === cardId);
    if (card) card.tapped = true;
  }

  const exileIds = unique([
    ...plan.delveIds,
    ...(plan.alternative === "escape" ? plan.escapeExileIds : [])
  ]);
  for (const cardId of exileIds) {
    const index = actor.game.graveyard.findIndex((card) => card.id === cardId);
    if (index >= 0) actor.game.exile.unshift(actor.game.graveyard.splice(index, 1)[0]);
  }
}

function overloadedText(text) {
  return String(text || "")
    .replace(/\btarget creature\b/gi, "each creature")
    .replace(/\btarget permanent\b/gi, "each permanent")
    .replace(/\btarget opponent\b/gi, "each opponent")
    .replace(/\btarget player\b/gi, "each player")
    .replace(/\btarget\b/gi, "each");
}

function temporaryCost(card, cost, callback) {
  card.cardData = card.cardData || {};
  const previous = card.cardData.manaCost;
  card.cardData.manaCost = cost;
  try {
    return callback();
  } finally {
    card.cardData.manaCost = previous;
  }
}

function preview(room, actor, action, deps) {
  const located = locateSource(actor, action, deps);
  if (!located) return { success: false, error: "That card is no longer available." };

  const mechanics = parseMechanics(located.card, deps);
  return {
    success: true,
    version: "46.0.0",
    cardId: located.card.id,
    cardName: located.card.name,
    fromZone: located.fromZone,
    mechanics,
    candidates: {
      convoke: mechanics.convoke
        ? actor.game.battlefield.filter((card) => validConvokeCard(card, actor.id, deps)).map(deps.publicCard)
        : [],
      improvise: mechanics.improvise
        ? actor.game.battlefield.filter((card) => validImproviseCard(card, actor.id, deps)).map(deps.publicCard)
        : [],
      delve: mechanics.delve
        ? actor.game.graveyard.filter((card) => card.id !== located.card.id).map(deps.publicCard)
        : [],
      escape: mechanics.escape
        ? actor.game.graveyard.filter((card) => card.id !== located.card.id).map(deps.publicCard)
        : []
    }
  };
}

function bottomRandom(player, cards, deps) {
  player.game.library.push(...deps.shuffle(cards));
}

function createMechanicChoice(room, player, raw, deps) {
  const state = normalizeState(room);
  const choice = {
    id: deps.createId(),
    status: "open",
    createdAt: deps.nowIso(),
    playerId: player.id,
    kind: raw.kind,
    sourceName: raw.sourceName,
    candidateCardId: raw.candidateCardId || null,
    exiledCardIds: unique(raw.exiledCardIds),
    restCardIds: unique(raw.restCardIds),
    value: Number(raw.value) || 0
  };
  state.choices.push(choice);
  return choice;
}

function revealUntil(room, player, predicate, kind, sourceName, value, deps) {
  const exiled = [];
  let candidate = null;

  while (player.game.library.length) {
    const card = player.game.library.shift();
    player.game.exile.unshift(card);
    exiled.push(card);
    if (predicate(card)) {
      candidate = card;
      break;
    }
  }

  if (!candidate) {
    for (const card of exiled) {
      const index = player.game.exile.findIndex((entry) => entry.id === card.id);
      if (index >= 0) player.game.exile.splice(index, 1);
    }
    bottomRandom(player, exiled, deps);
    deps.addLog(room, `${player.name} found no eligible card for ${kind}.`, kind);
    return null;
  }

  const rest = exiled.filter((card) => card.id !== candidate.id);
  return createMechanicChoice(room, player, {
    kind,
    sourceName,
    candidateCardId: candidate.id,
    exiledCardIds: exiled.map((card) => card.id),
    restCardIds: rest.map((card) => card.id),
    value
  }, deps);
}

function cascade(room, player, sourceCard, count, deps) {
  const sourceValue = manaValue(sourceCard, deps);
  const choices = [];
  for (let index = 0; index < count; index += 1) {
    const choice = revealUntil(
      room,
      player,
      (card) =>
        !/\bLand\b/i.test(String(deps.currentTypeLine(card) || "")) &&
        manaValue(card, deps) < sourceValue,
      "cascade",
      sourceCard.name,
      sourceValue,
      deps
    );
    if (choice) choices.push(choice);
  }
  return choices;
}

function discover(room, player, sourceName, value, deps) {
  return revealUntil(
    room,
    player,
    (card) =>
      !/\bLand\b/i.test(String(deps.currentTypeLine(card) || "")) &&
      manaValue(card, deps) <= value,
    "discover",
    sourceName,
    value,
    deps
  );
}

function findExileCard(player, cardId) {
  const index = player.game.exile.findIndex((card) => card.id === cardId);
  return index < 0 ? null : { card: player.game.exile[index], index };
}

function resolveChoice(room, actor, action, deps) {
  const state = normalizeState(room);
  const choice = state.choices.find((entry) => entry.id === action?.choiceId);
  if (!choice) return { success: false, error: "That mechanic choice is no longer available." };
  if (choice.playerId !== actor.id) return { success: false, error: "That mechanic choice belongs to another player." };

  const candidate = findExileCard(actor, choice.candidateCardId);
  const rest = choice.restCardIds
    .map((id) => findExileCard(actor, id))
    .filter(Boolean)
    .map((entry) => entry.card);

  for (const card of rest) {
    const index = actor.game.exile.findIndex((entry) => entry.id === card.id);
    if (index >= 0) actor.game.exile.splice(index, 1);
  }
  bottomRandom(actor, rest, deps);

  if (action?.decision === "hand" && choice.kind === "discover" && candidate) {
    actor.game.hand.push(actor.game.exile.splice(candidate.index, 1)[0]);
  } else if (action?.decision === "cast" && candidate) {
    room.playPermissions = list(room.playPermissions);
    room.playPermissions.push({
      id: deps.createId(),
      playerId: actor.id,
      cardId: candidate.card.id,
      zone: "exile",
      kind: "free-cast",
      sourceName: choice.sourceName,
      createdAt: deps.nowIso(),
      expires: "until-used",
      freeCast: true
    });
  } else if (candidate) {
    actor.game.exile.splice(candidate.index, 1);
    bottomRandom(actor, [candidate.card], deps);
  }

  choice.status = "resolved";
  state.choices = state.choices.filter((entry) => entry.status === "open");
  deps.addLog(room, `${actor.name} resolved ${choice.kind} from ${choice.sourceName}.`, choice.kind);
  return { success: true };
}

function publicChoices(room, viewerId, deps) {
  const player = deps.findPlayer(room, viewerId);
  return normalizeState(room).choices
    .filter((choice) => choice.playerId === viewerId)
    .map((choice) => {
      const candidate = player?.game?.exile?.find((card) => card.id === choice.candidateCardId);
      return {
        ...choice,
        candidate: candidate ? deps.publicCard(candidate) : null
      };
    });
}

function createMechanicsRulesEngine(deps) {
  return {
    version: "46.0.0",

    preview(room, actor, action) {
      return preview(room, actor, action, deps);
    },

    processGameAction(room, actor, action, legacy) {
      const type = String(action?.type || "");

      if (type === "resolve-mechanic-choice") {
        return resolveChoice(room, actor, action, deps);
      }

      const pending = normalizeState(room).choices;
      if (pending.length && !["judge-action", "undo-last", "check-state-based"].includes(type)) {
        const player = deps.findPlayer(room, pending[0].playerId);
        return {
          success: false,
          error: `${player?.name || "A player"} must finish ${pending[0].kind}.`
        };
      }

      if (type !== "mechanic-auto-cast") {
        const beforeStackIds = new Set((room.stack || []).map((item) => item.id));
        const result = legacy(room, actor, action);
        if (!result?.success) return result;

        if (["cast-card", "auto-cast-card"].includes(type)) {
          const stackItem = [...(room.stack || [])].reverse().find((item) => !beforeStackIds.has(item.id));
          const mechanics = stackItem?.card ? parseMechanics(stackItem.card, deps) : null;
          if (stackItem && mechanics?.cascadeCount) {
            cascade(room, actor, stackItem.card, mechanics.cascadeCount, deps);
          }
        }
        return result;
      }

      const located = locateSource(actor, action, deps);
      if (!located) return { success: false, error: "That card is no longer available." };

      const plan = costPlan(located.card, action, deps);
      const validation = validateCostSelections(actor, located.card, plan, deps);
      if (!validation.success) return validation;

      const gameSnapshot = JSON.parse(JSON.stringify(actor.game));
      const beforeStackIds = new Set((room.stack || []).map((item) => item.id));

      applyAdditionalCosts(actor, plan);
      const text = plan.alternative === "overload"
        ? overloadedText(deps.currentOracleText(located.card))
        : String(deps.currentOracleText(located.card) || "");

      const result = temporaryCost(located.card, plan.effectiveManaCost, () =>
        legacy(room, actor, {
          ...action,
          type: "auto-cast-card",
          text,
          targets: plan.alternative === "overload" ? [] : action.targets,
          fromZone: located.fromZone,
          mechanicSelections: {
            alternative: plan.alternative,
            kickerCount: plan.kickerCount,
            buyback: plan.buyback,
            convokeIds: plan.convokeIds,
            improviseIds: plan.improviseIds,
            delveIds: plan.delveIds
          }
        })
      );

      if (!result?.success) {
        actor.game = gameSnapshot;
        return result || { success: false, error: "Mechanic casting failed." };
      }

      const stackItem = [...(room.stack || [])]
        .reverse()
        .find((item) => !beforeStackIds.has(item.id));

      if (stackItem) {
        stackItem.mechanics = {
          version: "46.0.0",
          alternative: plan.alternative,
          kickerCount: plan.kickerCount,
          buyback: plan.buyback,
          flashback: plan.alternative === "flashback",
          escape: plan.alternative === "escape",
          convokeIds: plan.convokeIds,
          improviseIds: plan.improviseIds,
          delveIds: plan.delveIds,
          effectiveManaCost: plan.effectiveManaCost
        };

        if (plan.mechanics.cascadeCount) {
          cascade(room, actor, stackItem.card, plan.mechanics.cascadeCount, deps);
        }
      }

      deps.addLog(
        room,
        `${actor.name} cast ${located.card.name} using ${
          plan.alternative === "normal" ? "normal cost" : plan.alternative
        }${plan.kickerCount ? `, kicked ${plan.kickerCount} time${plan.kickerCount === 1 ? "" : "s"}` : ""}.`,
        "mechanic"
      );

      return { success: true, mechanics: stackItem?.mechanics };
    },

    afterResolve(room, item, depsOverride = deps) {
      if (!item) return;
      const controller = deps.findPlayer(room, item.controllerId);
      if (!controller?.game || !item.card) return;

      const mechanics = item.mechanics || {};
      const cardId = item.card.id;
      const graveIndex = controller.game.graveyard.findIndex((card) => card.id === cardId);

      if (graveIndex >= 0 && mechanics.buyback) {
        controller.game.hand.push(controller.game.graveyard.splice(graveIndex, 1)[0]);
      } else if (graveIndex >= 0 && (mechanics.flashback || mechanics.escape)) {
        controller.game.exile.unshift(controller.game.graveyard.splice(graveIndex, 1)[0]);
      }

      const parsed = parseMechanics(item.card, depsOverride);
      if (parsed.discoverValue) {
        discover(room, controller, item.name, parsed.discoverValue, depsOverride);
      }
    },

    pending(room, viewerId) {
      return publicChoices(room, viewerId, deps);
    },

    status() {
      return {
        success: true,
        version: "46.0.0",
        automatic: [
          "Kicker and Multikicker mana additions",
          "Overload alternative costs and target-to-each text conversion",
          "Buyback return to hand",
          "Flashback alternative costs and exile after resolution",
          "Escape costs and graveyard exile",
          "Convoke creature tapping and generic reduction",
          "Improvise artifact tapping and generic reduction",
          "Delve graveyard exile and generic reduction",
          "Cascade reveal sequence",
          "Discover reveal sequence",
          "free-cast permissions passed to v47",
          "server rollback when an additional cost fails"
        ],
        assisted: [
          "colored convoke assignment",
          "nonmana Kicker and additional costs",
          "Splice, Entwine and Escalate",
          "Madness and Miracle timing",
          "Suspend and time counters",
          "Casualty, Bargain and Exploit",
          "Mutate and prototype faces",
          "complex Cascade and Discover target choices"
        ]
      };
    }
  };
}

module.exports = {
  createMechanicsRulesEngine,
  _test: {
    parseMechanics,
    parseManaCost,
    requirementToCost,
    costPlan,
    overloadedText,
    revealUntil,
    cascade,
    discover,
    resolveChoice
  }
};
