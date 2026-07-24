"use strict";

const COLORS = ["W", "U", "B", "R", "G", "C"];
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
};

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function numberFrom(value, fallback = 1) {
  const text = String(value || "").trim().toLowerCase();
  if (/^\d+$/.test(text)) return Math.max(0, Number(text));
  return NUMBER_WORDS[text] ?? fallback;
}

function normalizeState(room) {
  room.castingV50 =
    room.castingV50 && typeof room.castingV50 === "object"
      ? room.castingV50
      : {};

  const state = room.castingV50;
  state.choices = list(state.choices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-50);
  state.suspended = list(state.suspended)
    .filter((entry) => entry && entry.id && entry.cardId && entry.status === "waiting")
    .slice(-100);
  state.foretold = list(state.foretold)
    .filter((entry) => entry && entry.id && entry.cardId && entry.status === "waiting")
    .slice(-100);
  state.drawCounts =
    state.drawCounts && typeof state.drawCounts === "object"
      ? state.drawCounts
      : {};
  state.stackMeta =
    state.stackMeta && typeof state.stackMeta === "object"
      ? state.stackMeta
      : {};
  state.lastUpkeepKey = String(state.lastUpkeepKey || "");
  state.lastError = state.lastError || null;
  return state;
}

function originalOracle(card) {
  return [
    String(card?.cardData?.oracleText || ""),
    ...list(card?.cardData?.faces).map((face) => String(face?.oracleText || ""))
  ].filter(Boolean).join("\n");
}

function currentManaCost(card, deps) {
  const face = deps.currentCardFace(card) || {};
  return String(face.manaCost || card?.cardData?.manaCost || "");
}

function currentType(card, deps) {
  return String(deps.currentTypeLine(card) || "");
}

function parseKeywordCost(text, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(text || "").match(
    new RegExp(`\\b${escaped}\\b\\s*(?:—|-)?\\s*((?:\\{[^}]+\\})+)`, "i")
  );
  return match ? match[1] : "";
}

function parseSuspend(card) {
  const text = originalOracle(card);
  const match = text.match(
    /\bsuspend\s+(\d+)\s*[—-]\s*((?:\{[^}]+\})+)/i
  );
  return match
    ? { timeCounters: Number(match[1]), manaCost: match[2] }
    : null;
}

function parseForetell(card) {
  const cost = parseKeywordCost(originalOracle(card), "Foretell");
  return cost ? { manaCost: cost } : null;
}

function parseMiracle(card) {
  const cost = parseKeywordCost(originalOracle(card), "Miracle");
  return cost ? { manaCost: cost } : null;
}

function parseMadness(card) {
  const cost = parseKeywordCost(originalOracle(card), "Madness");
  return cost ? { manaCost: cost } : null;
}

function parseCasualty(card) {
  const match = originalOracle(card).match(/\bcasualty\s+(\d+)/i);
  return match ? { minimumPower: Number(match[1]) } : null;
}

function hasBargain(card) {
  return /\bbargain\b/i.test(originalOracle(card));
}

function hasExploit(card) {
  return /\bexploit\b/i.test(originalOracle(card));
}

function parseCleave(card) {
  const cost = parseKeywordCost(originalOracle(card), "Cleave");
  return cost ? { manaCost: cost } : null;
}

function parseEntwine(card) {
  const cost = parseKeywordCost(originalOracle(card), "Entwine");
  return cost ? { manaCost: cost } : null;
}

function parseEscalate(card) {
  const text = originalOracle(card);
  const mana = text.match(
    /\bescalate\s*((?:\{[^}]+\})+)/i
  );
  if (mana) return { kind: "mana", manaCost: mana[1] };

  if (/\bescalate[—\s-]+discard a card\b/i.test(text)) {
    return { kind: "discard", amount: 1 };
  }
  if (/\bescalate[—\s-]+pay\s+(\d+)\s+life\b/i.test(text)) {
    return {
      kind: "life",
      amount: Number(
        text.match(/\bescalate[—\s-]+pay\s+(\d+)\s+life\b/i)[1]
      )
    };
  }
  return null;
}

function parseSplice(card) {
  const text = originalOracle(card);
  const match = text.match(
    /\bsplice onto\s+([A-Za-z][A-Za-z '-]*)\s*((?:\{[^}]+\})+)/i
  );
  return match
    ? {
        subtype: String(match[1] || "").trim(),
        manaCost: match[2]
      }
    : null;
}

function parseAffinity(card) {
  const match = originalOracle(card).match(
    /\baffinity for\s+([^.;\n]+)/i
  );
  return match ? { quality: String(match[1]).trim() } : null;
}

function parseOffering(card) {
  const match = originalOracle(card).match(
    /\b([A-Za-z][A-Za-z '-]*) offering\b/i
  );
  if (!match) return null;
  const phrase = String(match[1]).trim();
  const subtype = phrase.split(/\s+/).at(-1);
  return { subtype, manaCost: currentPrintedManaCost(card) };
}

function parseEmerge(card) {
  const text = originalOracle(card);
  let match = text.match(
    /\bemerge from artifact\s*((?:\{[^}]+\})+)/i
  );
  if (match) {
    return {
      permanentType: "artifact",
      manaCost: match[1]
    };
  }

  match = text.match(/\bemerge\s*((?:\{[^}]+\})+)/i);
  return match
    ? { permanentType: "creature", manaCost: match[1] }
    : null;
}

function currentPrintedManaCost(card) {
  return String(
    card?.cardData?.faces?.[card.activeFaceIndex || 0]?.manaCost ||
    card?.cardData?.manaCost ||
    ""
  );
}

function parseMechanics(card, deps) {
  return {
    foretell: parseForetell(card),
    suspend: parseSuspend(card),
    miracle: parseMiracle(card),
    madness: parseMadness(card),
    casualty: parseCasualty(card),
    bargain: hasBargain(card),
    exploit: hasExploit(card),
    cleave: parseCleave(card),
    entwine: parseEntwine(card),
    escalate: parseEscalate(card),
    splice: parseSplice(card),
    affinity: parseAffinity(card),
    offering: parseOffering(card),
    emerge: parseEmerge(card),
    manaCost: currentManaCost(card, deps)
  };
}

function parseManaCost(cost) {
  const requirement = {
    W: 0, U: 0, B: 0, R: 0, G: 0, C: 0,
    generic: 0,
    unsupported: []
  };

  for (const match of String(cost || "").matchAll(/\{([^}]+)\}/g)) {
    const symbol = String(match[1] || "").toUpperCase();
    if (/^\d+$/.test(symbol)) requirement.generic += Number(symbol);
    else if (COLORS.includes(symbol)) requirement[symbol] += 1;
    else if (symbol === "X") {}
    else if (symbol.includes("/")) {
      const available = symbol.split("/").find((entry) => COLORS.includes(entry));
      if (available) requirement[available] += 1;
      else requirement.generic += 1;
    } else {
      requirement.unsupported.push(symbol);
    }
  }
  return requirement;
}

function addRequirement(target, addition, multiplier = 1) {
  for (const color of COLORS) {
    target[color] += (Number(addition[color]) || 0) * multiplier;
  }
  target.generic += (Number(addition.generic) || 0) * multiplier;
  target.unsupported.push(...list(addition.unsupported));
  return target;
}

function requirementToCost(requirement) {
  const parts = [];
  if (requirement.generic > 0) parts.push(`{${requirement.generic}}`);
  for (const color of COLORS) {
    for (let index = 0; index < requirement[color]; index += 1) {
      parts.push(`{${color}}`);
    }
  }
  return parts.join("") || "{0}";
}

function manaValue(card, deps) {
  const face = deps.currentCardFace(card) || {};
  const direct =
    face.manaValue ??
    face.cmc ??
    card?.cardData?.manaValue ??
    card?.cardData?.cmc;
  if (Number.isFinite(Number(direct))) return Number(direct);

  const requirement = parseManaCost(currentPrintedManaCost(card));
  return COLORS.reduce((sum, color) => sum + requirement[color], requirement.generic);
}

function effectivePower(card) {
  const power = Number(card?.power ?? card?.cardData?.power);
  return Number.isFinite(power) ? power : 0;
}

function matchesQuality(card, quality, deps) {
  const typeLine = currentType(card, deps);
  const lower = String(quality || "").toLowerCase();

  if (lower.includes("artifact") && !/\bArtifact\b/i.test(typeLine)) return false;
  if (lower.includes("creature") && !/\bCreature\b/i.test(typeLine)) return false;
  if (lower.includes("enchantment") && !/\bEnchantment\b/i.test(typeLine)) return false;
  if (lower.includes("land") && !/\bLand\b/i.test(typeLine)) return false;
  if (lower.includes("token") && !card.token) return false;

  const subtype = lower
    .replace(
      /\b(?:artifacts?|creatures?|enchantments?|lands?|permanents?|cards?)\b/g,
      ""
    )
    .trim();
  if (subtype && !new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(typeLine)) {
    return false;
  }
  return true;
}

function affinityCount(actor, affinity, deps) {
  if (!affinity) return 0;
  return actor.game.battlefield.filter((card) =>
    matchesQuality(card, affinity.quality, deps)
  ).length;
}

function spliceCandidates(actor, sourceCard, deps) {
  const typeLine = currentType(sourceCard, deps);
  return actor.game.hand.filter((card) => {
    if (card.id === sourceCard.id) return false;
    const splice = parseSplice(card);
    return splice && new RegExp(`\\b${splice.subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(typeLine);
  });
}

function offeringCandidates(actor, offering, deps) {
  if (!offering) return [];
  return actor.game.battlefield.filter(
    (card) =>
      deps.isCreatureCard(card) &&
      new RegExp(`\\b${offering.subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(
        currentType(card, deps)
      )
  );
}

function emergeCandidates(actor, emerge, deps) {
  if (!emerge) return [];
  return actor.game.battlefield.filter((card) =>
    emerge.permanentType === "artifact"
      ? /\bArtifact\b/i.test(currentType(card, deps))
      : deps.isCreatureCard(card)
  );
}

function bargainCandidates(actor, deps) {
  return actor.game.battlefield.filter((card) =>
    card.token ||
    /\b(?:Artifact|Enchantment)\b/i.test(currentType(card, deps))
  );
}

function casualtyCandidates(actor, casualty, deps) {
  if (!casualty) return [];
  return actor.game.battlefield.filter(
    (card) =>
      deps.isCreatureCard(card) &&
      effectivePower(card) >= casualty.minimumPower
  );
}

function exploitCandidates(actor, deps) {
  return actor.game.battlefield.filter((card) => deps.isCreatureCard(card));
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

function preview(room, actor, action, deps) {
  const located = locateFromZone(actor, action, deps);
  if (!located) {
    return { success: false, error: "That card is no longer available." };
  }

  const card = located.card;
  const mechanics = parseMechanics(card, deps);
  return {
    success: true,
    version: "50.0.0",
    card: deps.publicCard(card),
    fromZone: located.zone,
    mechanics,
    affinityReduction: affinityCount(actor, mechanics.affinity, deps),
    candidates: {
      casualty: casualtyCandidates(actor, mechanics.casualty, deps).map(deps.publicCard),
      bargain: bargainCandidates(actor, deps).map(deps.publicCard),
      offering: offeringCandidates(actor, mechanics.offering, deps).map(deps.publicCard),
      emerge: emergeCandidates(actor, mechanics.emerge, deps).map(deps.publicCard),
      splice: spliceCandidates(actor, card, deps).map((entry) => ({
        card: deps.publicCard(entry),
        splice: parseSplice(entry)
      })),
      escalateDiscard: actor.game.hand
        .filter((entry) => entry.id !== card.id)
        .map(deps.publicCard)
    }
  };
}

function removeBracketedText(text) {
  return String(text || "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function spliceText(sourceText, selectedCards) {
  const appended = selectedCards
    .map((card) => {
      const text = String(card.cardData?.oracleText || originalOracle(card));
      return text
        .split(/\n/)
        .filter((line) => !/\bsplice onto\b/i.test(line))
        .join("\n")
        .trim();
    })
    .filter(Boolean);

  return [String(sourceText || "").trim(), ...appended]
    .filter(Boolean)
    .join("\n");
}

function withCardOverrides(card, overrides, callback) {
  const previousMana = card.cardData?.manaCost;
  const previousOracle = card.judgeOverrides?.oracleText;
  const previousKeywords = list(card.cardData?.keywords);

  card.cardData = card.cardData || {};
  card.judgeOverrides = card.judgeOverrides || {};

  if (overrides.manaCost != null) card.cardData.manaCost = overrides.manaCost;
  if (overrides.oracleText != null) {
    card.judgeOverrides.oracleText = overrides.oracleText;
  }
  if (overrides.flash) {
    card.cardData.keywords = unique([...previousKeywords, "Flash"]);
    card.judgeOverrides.oracleText = `${overrides.oracleText || previousOracle || originalOracle(card)}\nFlash`;
  }

  try {
    return callback();
  } finally {
    card.cardData.manaCost = previousMana;
    if (previousOracle == null) delete card.judgeOverrides.oracleText;
    else card.judgeOverrides.oracleText = previousOracle;
    card.cardData.keywords = previousKeywords;
  }
}

function sacrificePermanent(actor, cardId, predicate, error) {
  const index = actor.game.battlefield.findIndex(
    (card) => card.id === String(cardId || "")
  );
  if (index < 0 || (predicate && !predicate(actor.game.battlefield[index]))) {
    return { success: false, error };
  }

  const [card] = actor.game.battlefield.splice(index, 1);
  if (!card.token) actor.game.graveyard.unshift(card);
  return { success: true, card };
}

function discardCards(actor, cardIds, amount, excludedId) {
  const ids = unique(cardIds).filter((id) => id !== excludedId);
  if (ids.length !== amount) {
    return {
      success: false,
      error: `Choose exactly ${amount} card${amount === 1 ? "" : "s"} to discard.`
    };
  }

  const cards = ids.map((id) => actor.game.hand.find((card) => card.id === id));
  if (cards.some((card) => !card)) {
    return { success: false, error: "A selected discard card is unavailable." };
  }

  for (const id of ids) {
    const index = actor.game.hand.findIndex((card) => card.id === id);
    actor.game.graveyard.unshift(actor.game.hand.splice(index, 1)[0]);
  }
  return { success: true };
}

function reduceGeneric(requirement, amount) {
  requirement.generic = Math.max(
    0,
    requirement.generic - Math.max(0, Math.floor(Number(amount) || 0))
  );
  return requirement;
}

function buildCastPlan(actor, card, selections, deps) {
  const mechanics = parseMechanics(card, deps);
  let alternative = "normal";
  let manaCost = mechanics.manaCost;
  let oracleText = deps.currentOracleText(card);

  if (selections.cleave && mechanics.cleave) {
    alternative = "cleave";
    manaCost = mechanics.cleave.manaCost;
    oracleText = removeBracketedText(oracleText);
  } else if (selections.offeringCardId && mechanics.offering) {
    alternative = "offering";
    manaCost = mechanics.offering.manaCost;
  } else if (selections.emergeCardId && mechanics.emerge) {
    alternative = "emerge";
    manaCost = mechanics.emerge.manaCost;
  }

  const requirement = parseManaCost(manaCost);
  const modes = unique(selections.modes);

  if (selections.entwine && mechanics.entwine) {
    addRequirement(requirement, parseManaCost(mechanics.entwine.manaCost));
  }

  const extraModes = Math.max(0, modes.length - 1);
  if (
    extraModes &&
    mechanics.escalate?.kind === "mana"
  ) {
    addRequirement(
      requirement,
      parseManaCost(mechanics.escalate.manaCost),
      extraModes
    );
  }

  const spliceIds = unique(selections.spliceCardIds);
  const selectedSpliceCards = spliceIds
    .map((id) => actor.game.hand.find((entry) => entry.id === id))
    .filter(Boolean);

  for (const spliceCard of selectedSpliceCards) {
    const splice = parseSplice(spliceCard);
    if (splice) {
      addRequirement(requirement, parseManaCost(splice.manaCost));
    }
  }

  const affinityReduction = affinityCount(actor, mechanics.affinity, deps);
  reduceGeneric(requirement, affinityReduction);

  let sacrificedManaValue = 0;
  if (alternative === "offering") {
    const offered = actor.game.battlefield.find(
      (entry) => entry.id === selections.offeringCardId
    );
    sacrificedManaValue = offered ? manaValue(offered, deps) : 0;
    reduceGeneric(requirement, sacrificedManaValue);
  }

  if (alternative === "emerge") {
    const emerged = actor.game.battlefield.find(
      (entry) => entry.id === selections.emergeCardId
    );
    sacrificedManaValue = emerged ? manaValue(emerged, deps) : 0;
    reduceGeneric(requirement, sacrificedManaValue);
  }

  return {
    mechanics,
    alternative,
    requirement,
    effectiveManaCost: requirementToCost(requirement),
    oracleText: spliceText(oracleText, selectedSpliceCards),
    modes:
      selections.entwine && mechanics.entwine
        ? unique([...modes, "all"])
        : modes,
    selectedSpliceCards,
    spliceIds,
    affinityReduction,
    sacrificedManaValue,
    extraModes,
    casualtyCardId: String(selections.casualtyCardId || ""),
    bargainCardId: String(selections.bargainCardId || ""),
    offeringCardId: String(selections.offeringCardId || ""),
    emergeCardId: String(selections.emergeCardId || ""),
    escalateDiscardIds: unique(selections.escalateDiscardIds),
    casualtyPaid: false,
    bargained: false,
    entwined: Boolean(selections.entwine && mechanics.entwine),
    cleaved: alternative === "cleave"
  };
}

function validateAndPayAdditionalCosts(actor, card, plan, deps) {
  if (plan.casualtyCardId) {
    const result = sacrificePermanent(
      actor,
      plan.casualtyCardId,
      (entry) =>
        deps.isCreatureCard(entry) &&
        effectivePower(entry) >= plan.mechanics.casualty?.minimumPower,
      "Casualty requires a creature with enough power."
    );
    if (!result.success) return result;
    plan.casualtyPaid = true;
  }

  if (plan.bargainCardId) {
    const result = sacrificePermanent(
      actor,
      plan.bargainCardId,
      (entry) =>
        entry.token ||
        /\b(?:Artifact|Enchantment)\b/i.test(currentType(entry, deps)),
      "Bargain requires an artifact, enchantment, or token."
    );
    if (!result.success) return result;
    plan.bargained = true;
  }

  if (plan.offeringCardId) {
    const offering = plan.mechanics.offering;
    const result = sacrificePermanent(
      actor,
      plan.offeringCardId,
      (entry) =>
        deps.isCreatureCard(entry) &&
        new RegExp(
          `\\b${offering.subtype.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i"
        ).test(currentType(entry, deps)),
      `Offering requires a ${offering.subtype} creature.`
    );
    if (!result.success) return result;
  }

  if (plan.emergeCardId) {
    const emerge = plan.mechanics.emerge;
    const result = sacrificePermanent(
      actor,
      plan.emergeCardId,
      (entry) =>
        emerge.permanentType === "artifact"
          ? /\bArtifact\b/i.test(currentType(entry, deps))
          : deps.isCreatureCard(entry),
      `Emerge requires sacrificing ${
        emerge.permanentType === "artifact" ? "an artifact" : "a creature"
      }.`
    );
    if (!result.success) return result;
  }

  if (plan.extraModes && plan.mechanics.escalate?.kind === "discard") {
    const result = discardCards(
      actor,
      plan.escalateDiscardIds,
      plan.extraModes,
      card.id
    );
    if (!result.success) return result;
  }

  if (plan.extraModes && plan.mechanics.escalate?.kind === "life") {
    const life = plan.mechanics.escalate.amount * plan.extraModes;
    if (actor.game.life <= life) {
      return { success: false, error: "You do not have enough life for Escalate." };
    }
    actor.game.life -= life;
  }

  return { success: true };
}

function stackNewItem(room, beforeIds) {
  return [...room.stack]
    .reverse()
    .find((item) => !beforeIds.has(item.id));
}

function copyStackItem(room, actor, stackItem, deps) {
  const copy = {
    ...JSON.parse(JSON.stringify(stackItem)),
    id: deps.createId(),
    name: `${stackItem.name} copy`,
    controllerId: actor.id,
    card: null,
    isCopy: true,
    copiedFromStackItemId: stackItem.id,
    createdAt: deps.nowIso()
  };
  room.stack.push(copy);
  deps.resetPriority(room, actor.id);
  return copy;
}

function advancedCast(room, actor, action, legacyProcess, deps) {
  const located = locateFromZone(actor, action, deps);
  if (!located) {
    return { success: false, error: "That card is no longer available." };
  }

  const card = located.card;
  const plan = buildCastPlan(actor, card, action, deps);
  const gameSnapshot = JSON.parse(JSON.stringify(actor.game));
  const stackSnapshot = JSON.parse(JSON.stringify(room.stack));

  const paid = validateAndPayAdditionalCosts(actor, card, plan, deps);
  if (!paid.success) {
    actor.game = gameSnapshot;
    return paid;
  }

  const beforeIds = new Set(room.stack.map((item) => item.id));
  const flash =
    plan.alternative === "offering" ||
    Boolean(action.castAsThoughFlash);

  const result = withCardOverrides(
    card,
    {
      manaCost: plan.effectiveManaCost,
      oracleText: plan.oracleText,
      flash
    },
    () =>
      legacyProcess(room, actor, {
        ...action,
        type: "auto-cast-card",
        fromZone: located.zone,
        cardId: card.id,
        modes: plan.modes,
        text: plan.oracleText,
        castingV50: true
      })
  );

  if (!result?.success) {
    actor.game = gameSnapshot;
    room.stack = stackSnapshot;
    return result || { success: false, error: "Advanced casting failed." };
  }

  const stackItem = stackNewItem(room, beforeIds);
  if (stackItem) {
    const meta = {
      version: "50.0.0",
      alternative: plan.alternative,
      casualtyPaid: plan.casualtyPaid,
      bargained: plan.bargained,
      entwined: plan.entwined,
      cleaved: plan.cleaved,
      extraModes: plan.extraModes,
      spliceCardIds: plan.spliceIds,
      affinityReduction: plan.affinityReduction,
      sacrificedManaValue: plan.sacrificedManaValue
    };
    stackItem.castingV50 = meta;
    normalizeState(room).stackMeta[stackItem.id] = meta;

    if (plan.casualtyPaid) {
      copyStackItem(room, actor, stackItem, deps);
    }
  }

  deps.addLog(
    room,
    `${actor.name} cast ${card.name}${
      plan.alternative !== "normal" ? ` using ${plan.alternative}` : ""
    }${plan.casualtyPaid ? " with casualty" : ""}${
      plan.bargained ? " and bargained it" : ""
    }.`,
    "casting"
  );

  return {
    success: true,
    castingV50: stackItem?.castingV50 || null
  };
}

function paySimpleMana(room, actor, cost, deps) {
  if (typeof deps.autoPayMana === "function") {
    return deps.autoPayMana(room, actor, cost);
  }

  const requirement = parseManaCost(cost);
  const snapshot = JSON.parse(JSON.stringify(actor.game));
  const selected = [];

  function spend(color, amount) {
    const available = Number(actor.game.manaPool?.[color]) || 0;
    const paid = Math.min(available, amount);
    actor.game.manaPool[color] = available - paid;
    return amount - paid;
  }

  for (const color of COLORS) requirement[color] = spend(color, requirement[color]);

  const sources = actor.game.battlefield
    .filter((card) => !card.tapped)
    .map((card) => {
      const type = currentType(card, deps);
      const text = String(deps.currentOracleText(card) || "");
      const choices = [];
      const basics = {
        Plains: "W", Island: "U", Swamp: "B",
        Mountain: "R", Forest: "G", Wastes: "C"
      };
      for (const [basic, color] of Object.entries(basics)) {
        if (new RegExp(`\\b${basic}\\b`, "i").test(type)) choices.push(color);
      }
      for (const match of text.matchAll(/\{T\}[^.]*:\s*Add\s+\{([WUBRGC])\}/gi)) {
        choices.push(match[1].toUpperCase());
      }
      if (/one mana of any color/i.test(text)) choices.push("W", "U", "B", "R", "G");
      return { card, choices: unique(choices) };
    })
    .filter((entry) => entry.choices.length);

  for (const color of COLORS) {
    while (requirement[color] > 0) {
      const source = sources.find(
        (entry) => !selected.includes(entry.card.id) && entry.choices.includes(color)
      );
      if (!source) {
        actor.game = snapshot;
        return { success: false, error: `Could not produce enough ${color} mana.` };
      }
      source.card.tapped = true;
      selected.push(source.card.id);
      requirement[color] -= 1;
    }
  }

  let generic = requirement.generic;
  for (const color of COLORS) {
    generic = spend(color, generic);
    if (generic <= 0) break;
  }
  while (generic > 0) {
    const source = sources.find((entry) => !selected.includes(entry.card.id));
    if (!source) {
      actor.game = snapshot;
      return { success: false, error: "Could not produce enough generic mana." };
    }
    source.card.tapped = true;
    selected.push(source.card.id);
    generic -= 1;
  }
  return { success: true, tappedCardIds: selected };
}

function foretellCard(room, actor, cardId, deps) {
  const located = deps.getCardFromZone(actor.game, "hand", String(cardId || ""));
  if (!located) return { success: false, error: "That card is not in your hand." };

  const foretell = parseForetell(located.card);
  if (!foretell) return { success: false, error: "That card has no Foretell cost." };
  if (room.turn?.activePlayerId !== actor.id) {
    return { success: false, error: "You may foretell only during your turn." };
  }

  const payment = paySimpleMana(room, actor, "{2}", deps);
  if (!payment.success) return payment;

  const [card] = actor.game.hand.splice(located.index, 1);
  card.faceDown = true;
  actor.game.exile.unshift(card);

  const state = normalizeState(room);
  const entry = {
    id: deps.createId(),
    status: "waiting",
    playerId: actor.id,
    cardId: card.id,
    cardName: card.name,
    manaCost: foretell.manaCost,
    foretoldTurn: Number(room.turn?.number) || 0,
    availableTurn: (Number(room.turn?.number) || 0) + 1,
    createdAt: deps.nowIso()
  };
  state.foretold.push(entry);

  deps.addLog(room, `${actor.name} foretold a card.`, "foretell");
  return { success: true };
}

function suspendCard(room, actor, cardId, deps) {
  const located = deps.getCardFromZone(actor.game, "hand", String(cardId || ""));
  if (!located) return { success: false, error: "That card is not in your hand." };

  const suspend = parseSuspend(located.card);
  if (!suspend) return { success: false, error: "That card has no Suspend ability." };

  const payment = paySimpleMana(room, actor, suspend.manaCost, deps);
  if (!payment.success) return payment;

  const [card] = actor.game.hand.splice(located.index, 1);
  card.faceDown = false;
  card.counters = card.counters || {};
  card.counters.time = suspend.timeCounters;
  actor.game.exile.unshift(card);

  normalizeState(room).suspended.push({
    id: deps.createId(),
    status: "waiting",
    playerId: actor.id,
    cardId: card.id,
    cardName: card.name,
    timeCounters: suspend.timeCounters,
    createdAt: deps.nowIso()
  });

  deps.addLog(
    room,
    `${actor.name} suspended ${card.name} with ${suspend.timeCounters} time counter${
      suspend.timeCounters === 1 ? "" : "s"
    }.`,
    "suspend"
  );
  return { success: true };
}

function permission(room, raw, deps) {
  room.playPermissions = list(room.playPermissions);
  const value = {
    id: deps.createId(),
    playerId: raw.playerId,
    cardId: raw.cardId,
    zone: raw.zone,
    kind: raw.kind,
    sourceName: raw.sourceName,
    createdAt: deps.nowIso(),
    expires: raw.expires || "until-used",
    freeCast: Boolean(raw.freeCast),
    mayPlayLand: false,
    mayCastSpell: true,
    costOverride: raw.costOverride || "",
    faceDown: false
  };
  room.playPermissions.push(value);
  return value;
}

function timedEntryCard(actor, entry) {
  return actor.game.exile.find((card) => card.id === entry.cardId) || null;
}

function castTimed(room, actor, action, legacyProcess, deps) {
  const state = normalizeState(room);
  const kind = String(action?.kind || "");
  const entry =
    kind === "foretell"
      ? state.foretold.find((item) => item.id === action?.entryId)
      : state.suspended.find((item) => item.id === action?.entryId);

  if (!entry || entry.playerId !== actor.id) {
    return { success: false, error: "That timed card is unavailable." };
  }

  const card = timedEntryCard(actor, entry);
  if (!card) return { success: false, error: "That card left exile." };

  if (kind === "foretell") {
    if ((Number(room.turn?.number) || 0) < entry.availableTurn) {
      return { success: false, error: "A foretold card cannot be cast during the turn it was foretold." };
    }
    card.faceDown = false;
  } else if ((Number(card.counters?.time) || 0) > 0) {
    return { success: false, error: "That suspended card still has time counters." };
  }

  const granted = permission(
    room,
    {
      playerId: actor.id,
      cardId: card.id,
      zone: "exile",
      kind,
      sourceName: card.name,
      freeCast: kind === "suspend",
      costOverride: kind === "foretell" ? entry.manaCost : ""
    },
    deps
  );

  const result = withCardOverrides(
    card,
    {
      flash: true,
      oracleText: deps.currentOracleText(card)
    },
    () =>
      legacyProcess(room, actor, {
        type: "permission-play-card",
        permissionId: granted.id,
        cardId: card.id,
        fromZone: "exile",
        targets: action?.targets || [],
        modes: action?.modes || []
      })
  );

  if (!result?.success) {
    room.playPermissions = room.playPermissions.filter(
      (item) => item.id !== granted.id
    );
    if (kind === "foretell") card.faceDown = true;
    return result;
  }

  entry.status = "resolved";
  if (kind === "foretell") {
    state.foretold = state.foretold.filter((item) => item.status === "waiting");
  } else {
    state.suspended = state.suspended.filter((item) => item.status === "waiting");
    const stackItem = room.stack?.at(-1);
    if (stackItem && deps.isCreatureCard(card)) {
      stackItem.castingV50 = {
        ...(stackItem.castingV50 || {}),
        suspendHaste: true
      };
    }
  }
  return { success: true };
}

function upkeepTimedCards(room, deps) {
  const state = normalizeState(room);
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  const activeId = room.turn?.activePlayerId;
  const key = `${room.turn?.number}:${activeId}:${phase}`;

  if (phase !== "Upkeep" || state.lastUpkeepKey === key) return [];
  state.lastUpkeepKey = key;

  const ready = [];
  for (const entry of state.suspended) {
    if (entry.playerId !== activeId) continue;
    const player = deps.findPlayer(room, entry.playerId);
    const card = player ? timedEntryCard(player, entry) : null;
    if (!card) {
      entry.status = "resolved";
      continue;
    }

    card.counters = card.counters || {};
    card.counters.time = Math.max(0, (Number(card.counters.time) || 0) - 1);
    entry.timeCounters = card.counters.time;

    deps.addLog(
      room,
      `${card.name} has ${entry.timeCounters} time counter${
        entry.timeCounters === 1 ? "" : "s"
      } remaining.`,
      "suspend"
    );

    if (entry.timeCounters === 0) ready.push(entry);
  }

  state.suspended = state.suspended.filter((entry) => entry.status === "waiting");
  return ready;
}

function snapshotZones(room) {
  return Object.fromEntries(
    room.players.map((player) => [
      player.id,
      {
        handIds: new Set((player.game?.hand || []).map((card) => card.id)),
        libraryIds: (player.game?.library || []).map((card) => card.id)
      }
    ])
  );
}

function drawContext(action, item, beforePhase, afterPhase) {
  if (item && /\bdraw\b/i.test(String(item.text || item.card?.cardData?.oracleText || ""))) {
    return true;
  }
  if (action?.type && /\bdraw\b/i.test(String(action.type))) return true;
  return beforePhase !== afterPhase && afterPhase === "Draw";
}

function incrementDraw(room, playerId) {
  const state = normalizeState(room);
  const turn = String(Number(room.turn?.number) || 0);
  state.drawCounts[turn] =
    state.drawCounts[turn] && typeof state.drawCounts[turn] === "object"
      ? state.drawCounts[turn]
      : {};
  state.drawCounts[turn][playerId] =
    (Number(state.drawCounts[turn][playerId]) || 0) + 1;

  for (const oldTurn of Object.keys(state.drawCounts)) {
    if (Number(oldTurn) < Number(turn) - 2) delete state.drawCounts[oldTurn];
  }
  return state.drawCounts[turn][playerId];
}

function createChoice(room, raw, deps) {
  const choice = {
    id: deps.createId(),
    status: "open",
    createdAt: deps.nowIso(),
    playerId: raw.playerId,
    kind: raw.kind,
    cardId: raw.cardId || null,
    sourceCardId: raw.sourceCardId || null,
    cardName: raw.cardName || "Card",
    sourceName: raw.sourceName || raw.cardName || "Ability",
    text: raw.text || "",
    manaCost: raw.manaCost || "",
    candidateIds: unique(raw.candidateIds),
    metadata: raw.metadata || {}
  };
  normalizeState(room).choices.push(choice);
  return choice;
}

function scanDraws(room, before, likelyDraw, deps) {
  if (!likelyDraw) return [];

  const created = [];
  for (const player of room.players) {
    const previous = before[player.id];
    if (!previous || !player.game) continue;

    const newHand = player.game.hand.filter(
      (card) => !previous.handIds.has(card.id)
    );
    const libraryOrder = new Map(
      previous.libraryIds.map((id, index) => [id, index])
    );
    const drawn = newHand
      .filter((card) => libraryOrder.has(card.id))
      .sort((a, b) => libraryOrder.get(a.id) - libraryOrder.get(b.id));

    for (const card of drawn) {
      const count = incrementDraw(room, player.id);
      const miracle = parseMiracle(card);
      if (count === 1 && miracle) {
        created.push(
          createChoice(
            room,
            {
              playerId: player.id,
              kind: "miracle",
              cardId: card.id,
              cardName: card.name,
              sourceName: "Miracle",
              text: originalOracle(card),
              manaCost: miracle.manaCost
            },
            deps
          )
        );
      }
    }
  }
  return created;
}

function discardWithMadness(room, actor, action, deps) {
  const located = deps.getCardFromZone(
    actor.game,
    "hand",
    String(action?.cardId || "")
  );
  if (!located) return null;

  const madness = parseMadness(located.card);
  if (!madness) return null;

  const [card] = actor.game.hand.splice(located.index, 1);
  actor.game.exile.unshift(card);
  createChoice(
    room,
    {
      playerId: actor.id,
      kind: "madness",
      cardId: card.id,
      cardName: card.name,
      sourceName: "Madness",
      text: originalOracle(card),
      manaCost: madness.manaCost
    },
    deps
  );
  deps.addLog(room, `${actor.name} discarded ${card.name} into exile with Madness.`, "madness");
  return { success: true, pendingMadness: true };
}

function exploitChoice(room, card, controller, deps) {
  if (!hasExploit(card)) return null;
  const candidates = exploitCandidates(controller, deps);
  return createChoice(
    room,
    {
      playerId: controller.id,
      kind: "exploit",
      sourceCardId: card.id,
      cardName: card.name,
      sourceName: card.name,
      text: originalOracle(card),
      candidateIds: candidates.map((entry) => entry.id)
    },
    deps
  );
}

function permissionCastChoice(room, actor, choice, useAbility, legacyProcess, deps) {
  const zone = choice.kind === "miracle" ? "hand" : "exile";
  const located = deps.getCardFromZone(actor.game, zone, choice.cardId);

  if (!located) {
    return { success: false, error: "The card for that choice is unavailable." };
  }

  if (!useAbility) {
    if (choice.kind === "madness") {
      actor.game.graveyard.unshift(actor.game.exile.splice(located.index, 1)[0]);
    }
    return { success: true, declined: true };
  }

  const granted = permission(
    room,
    {
      playerId: actor.id,
      cardId: located.card.id,
      zone,
      kind: choice.kind,
      sourceName: choice.cardName,
      freeCast: false,
      costOverride: choice.manaCost
    },
    deps
  );

  const result = withCardOverrides(
    located.card,
    {
      flash: true,
      oracleText: deps.currentOracleText(located.card)
    },
    () =>
      legacyProcess(room, actor, {
        type: "permission-play-card",
        permissionId: granted.id,
        cardId: located.card.id,
        fromZone: zone,
        targets: choice.metadata?.targets || []
      })
  );

  if (!result?.success) {
    room.playPermissions = room.playPermissions.filter(
      (entry) => entry.id !== granted.id
    );
    return result;
  }
  return { success: true, cast: true };
}

function resolveChoice(room, actor, action, legacyProcess, deps) {
  const state = normalizeState(room);
  const choice = state.choices.find(
    (entry) => entry.id === action?.choiceId && entry.status === "open"
  );
  if (!choice) return { success: false, error: "That casting choice is unavailable." };
  if (choice.playerId !== actor.id && room.hostId !== actor.id) {
    return { success: false, error: "That choice belongs to another player." };
  }

  let result;
  if (choice.kind === "miracle" || choice.kind === "madness") {
    choice.metadata = {
      ...(choice.metadata || {}),
      targets: unique(action?.targets)
    };
    result = permissionCastChoice(
      room,
      actor,
      choice,
      Boolean(action?.useAbility),
      legacyProcess,
      deps
    );
  } else if (choice.kind === "exploit") {
    if (!action?.useAbility) {
      result = { success: true, declined: true };
    } else {
      const cardId = String(action?.sacrificeCardId || "");
      if (!choice.candidateIds.includes(cardId)) {
        return { success: false, error: "Choose a legal creature to exploit." };
      }
      const sacrificed = sacrificePermanent(
        actor,
        cardId,
        (card) => deps.isCreatureCard(card),
        "Exploit requires a creature."
      );
      if (!sacrificed.success) return sacrificed;

      const source = deps.findBattlefieldCard(room, choice.sourceCardId)?.card;
      if (source) {
        source.specialState = source.specialState || {};
        source.specialState.exploitedThisEntry = true;
      }
      deps.queueSuggestedTriggers(room, "EXPLOITED", {
        card: source,
        sacrificedCard: sacrificed.card,
        controllerId: actor.id
      });
      result = { success: true, exploited: true };
    }
  } else {
    return { success: false, error: "Unsupported casting choice." };
  }

  if (!result?.success) return result;
  choice.status = "resolved";
  state.choices = state.choices.filter((entry) => entry.status === "open");
  return result;
}

function stateForPlayer(room, viewerId, deps) {
  const state = normalizeState(room);
  const player = deps.findPlayer(room, viewerId);
  if (!player?.game) {
    return {
      success: true,
      version: "50.0.0",
      handActions: [],
      foretold: [],
      suspended: []
    };
  }

  return {
    success: true,
    version: "50.0.0",
    handActions: player.game.hand
      .map((card) => {
        const mechanics = parseMechanics(card, deps);
        return mechanics.foretell || mechanics.suspend
          ? {
              card: deps.publicCard(card),
              foretell: mechanics.foretell,
              suspend: mechanics.suspend
            }
          : null;
      })
      .filter(Boolean),
    foretold: state.foretold
      .filter((entry) => entry.playerId === viewerId)
      .map((entry) => ({
        ...entry,
        available: (Number(room.turn?.number) || 0) >= entry.availableTurn,
        card: deps.publicCard(timedEntryCard(player, entry))
      })),
    suspended: state.suspended
      .filter((entry) => entry.playerId === viewerId)
      .map((entry) => ({
        ...entry,
        available: entry.timeCounters <= 0,
        card: deps.publicCard(timedEntryCard(player, entry))
      }))
  };
}

function pendingForPlayer(room, viewerId, deps) {
  const choice = normalizeState(room).choices.find(
    (entry) =>
      entry.status === "open" &&
      (entry.playerId === viewerId || room.hostId === viewerId)
  );
  if (!choice) {
    return { success: true, version: "50.0.0", choice: null };
  }

  const player = deps.findPlayer(room, choice.playerId);
  return {
    success: true,
    version: "50.0.0",
    choice: {
      ...choice,
      card:
        choice.cardId && player
          ? deps.publicCard(
              player.game.hand.find((card) => card.id === choice.cardId) ||
              player.game.exile.find((card) => card.id === choice.cardId)
            )
          : null,
      candidates:
        choice.kind === "exploit" && player
          ? choice.candidateIds
              .map((id) => player.game.battlefield.find((card) => card.id === id))
              .filter(Boolean)
              .map(deps.publicCard)
          : []
    }
  };
}

function processGameAction(room, actor, action, legacyProcess, deps) {
  const type = String(action?.type || "");
  const state = normalizeState(room);

  if (type === "casting-v50-cast") {
    return advancedCast(room, actor, action, legacyProcess, deps);
  }
  if (type === "casting-v50-foretell") {
    return foretellCard(room, actor, action?.cardId, deps);
  }
  if (type === "casting-v50-suspend") {
    return suspendCard(room, actor, action?.cardId, deps);
  }
  if (type === "casting-v50-cast-timed") {
    return castTimed(room, actor, action, legacyProcess, deps);
  }
  if (type === "casting-v50-resolve-choice") {
    return resolveChoice(room, actor, action, legacyProcess, deps);
  }

  if (
    state.choices.length &&
    !["judge-action", "undo-last", "check-state-based"].includes(type)
  ) {
    const waiting = deps.findPlayer(room, state.choices[0].playerId);
    return {
      success: false,
      error: `${waiting?.name || "A player"} must finish a casting choice.`
    };
  }

  if (
    type === "move-card" &&
    action?.fromZone === "hand" &&
    action?.toZone === "graveyard"
  ) {
    const madness = discardWithMadness(room, actor, action, deps);
    if (madness) return madness;
  }

  const before = snapshotZones(room);
  const beforePhase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  const result = legacyProcess(room, actor, action);
  if (!result?.success) return result;

  const afterPhase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  scanDraws(
    room,
    before,
    drawContext(action, null, beforePhase, afterPhase),
    deps
  );
  upkeepTimedCards(room, deps);
  return result;
}

function afterResolve(room, item, beforeZones, deps) {
  const afterPhase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  scanDraws(
    room,
    beforeZones,
    drawContext(null, item, afterPhase, afterPhase),
    deps
  );

  const controller = deps.findPlayer(room, item?.controllerId);
  const permanent = controller?.game?.battlefield?.find(
    (card) => card.id === item?.card?.id
  );
  if (permanent) {
    if (item?.castingV50?.suspendHaste) {
      permanent.temporaryEffects = list(permanent.temporaryEffects);
      permanent.temporaryEffects.push({
        id: deps.createId(),
        type: "keyword",
        keyword: "haste",
        expires: "lose-control"
      });
    }
    exploitChoice(room, permanent, controller, deps);
  }

  if (item?.id) delete normalizeState(room).stackMeta[item.id];
}

function createCastingMechanicsEngine(deps) {
  return {
    version: "50.0.0",

    preview(room, actor, action) {
      return preview(room, actor, action, deps);
    },

    processGameAction(room, actor, action, legacyProcess) {
      return processGameAction(room, actor, action, legacyProcess, deps);
    },

    beforeResolve(room) {
      return snapshotZones(room);
    },

    afterResolve(room, item, beforeZones) {
      return afterResolve(room, item, beforeZones, deps);
    },

    state(room, viewerId) {
      return stateForPlayer(room, viewerId, deps);
    },

    pending(room, viewerId) {
      return pendingForPlayer(room, viewerId, deps);
    },

    status() {
      return {
        success: true,
        version: "50.0.0",
        automatic: [
          "Foretell face-down exile and later-turn alternative casting",
          "Suspend costs, upkeep time-counter removal and free casting",
          "first-draw Miracle prompts",
          "Madness discard replacement and immediate casting prompt",
          "Casualty sacrifice and spell copy",
          "Bargain sacrifice and bargained spell metadata",
          "Exploit enter-the-battlefield sacrifice prompt",
          "Cleave alternative cost and bracketed-text removal",
          "Entwine additional cost and all-mode selection",
          "mana, discard and life Escalate costs",
          "Splice onto matching spell subtypes",
          "Affinity generic cost reduction",
          "Offering sacrifice, mana-value reduction and flash timing",
          "Emerge and emerge-from-artifact sacrifice reductions",
          "server rollback when advanced additional costs fail",
          "Arena-style timed-card and casting-choice panels"
        ],
        assisted: [
          "Miracle detection for card draws performed by unknown card-specific scripts",
          "Madness discards performed outside normal zone-move actions",
          "new target selection for Casualty copies",
          "nonmana Splice costs",
          "Offering granted by continuous effects",
          "Affinity for unusual dynamic qualities",
          "multiple instances of Casualty",
          "Suspend cards with variable or unusual time-counter instructions",
          "Exploit triggers with card-specific intervening conditions"
        ]
      };
    }
  };
}

module.exports = {
  createCastingMechanicsEngine,
  _test: {
    parseForetell,
    parseSuspend,
    parseMiracle,
    parseMadness,
    parseCasualty,
    hasBargain,
    hasExploit,
    parseCleave,
    parseEntwine,
    parseEscalate,
    parseSplice,
    parseAffinity,
    parseOffering,
    parseEmerge,
    parseManaCost,
    requirementToCost,
    affinityCount,
    removeBracketedText,
    spliceText,
    buildCastPlan,
    scanDraws,
    incrementDraw,
    upkeepTimedCards,
    stateForPlayer
  }
};
