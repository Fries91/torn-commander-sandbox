"use strict";

const COLORS = ["W", "U", "B", "R", "G", "C"];
const COLOR_NAMES = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless"
};
const BASIC_TYPES = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
  Wastes: "C"
};
const MAX_COST_VARIANTS = 96;
const MAX_DP_STATES = 6500;

function emptyMana() {
  return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
}

function cloneMana(value) {
  const output = emptyMana();
  for (const color of COLORS) output[color] = Math.max(0, Math.floor(Number(value?.[color]) || 0));
  return output;
}

function addMana(target, source) {
  for (const color of COLORS) target[color] += Math.max(0, Math.floor(Number(source?.[color]) || 0));
  return target;
}

function manaTotal(value) {
  return COLORS.reduce((sum, color) => sum + (Number(value?.[color]) || 0), 0);
}

function manaLabel(value) {
  const parts = [];
  for (const color of COLORS) {
    const amount = Math.max(0, Math.floor(Number(value?.[color]) || 0));
    if (amount) parts.push(`${amount}${color}`);
  }
  return parts.join(" ") || "0";
}

function manaCostForCard(card, currentCardFace) {
  return String(
    currentCardFace(card)?.manaCost ||
    card?.cardData?.manaCost ||
    card?.manaCost ||
    ""
  ).trim();
}

function cloneRequirement(value = null) {
  return {
    W: Number(value?.W) || 0,
    U: Number(value?.U) || 0,
    B: Number(value?.B) || 0,
    R: Number(value?.R) || 0,
    G: Number(value?.G) || 0,
    C: Number(value?.C) || 0,
    generic: Number(value?.generic) || 0,
    life: Number(value?.life) || 0,
    notes: Array.isArray(value?.notes) ? [...value.notes] : []
  };
}

function requirementKey(requirement) {
  return [
    ...COLORS.map((color) => requirement[color]),
    requirement.generic,
    requirement.life
  ].join(":");
}

function dedupeRequirements(requirements) {
  const unique = new Map();
  for (const requirement of requirements) {
    const key = requirementKey(requirement);
    if (!unique.has(key)) unique.set(key, requirement);
  }
  return [...unique.values()].slice(0, MAX_COST_VARIANTS);
}

function expandCostToken(variants, token, xValue, allowLifePayment) {
  const value = token.toUpperCase();

  if (/^\d+$/.test(value)) {
    for (const variant of variants) variant.generic += Number(value);
    return variants;
  }

  if (value === "X") {
    for (const variant of variants) variant.generic += Math.max(0, Math.floor(Number(xValue) || 0));
    return variants;
  }

  if (COLORS.includes(value)) {
    for (const variant of variants) variant[value] += 1;
    return variants;
  }

  if (value === "S") {
    for (const variant of variants) variant.notes.push("Snow mana is not auto-selected yet.");
    return [];
  }

  if (!value.includes("/")) {
    for (const variant of variants) variant.notes.push(`Unsupported mana symbol {${value}}.`);
    return [];
  }

  const parts = value.split("/");
  const expanded = [];

  for (const variant of variants) {
    if (parts.includes("P")) {
      const color = parts.find((part) => COLORS.includes(part));
      if (color) {
        const colored = cloneRequirement(variant);
        colored[color] += 1;
        expanded.push(colored);
      }
      if (allowLifePayment) {
        const life = cloneRequirement(variant);
        life.life += 2;
        life.notes.push(`Pay 2 life for {${value}}.`);
        expanded.push(life);
      }
      continue;
    }

    for (const part of parts) {
      const option = cloneRequirement(variant);
      if (COLORS.includes(part)) {
        option[part] += 1;
        expanded.push(option);
      } else if (/^\d+$/.test(part)) {
        option.generic += Number(part);
        expanded.push(option);
      }
    }
  }

  return dedupeRequirements(expanded);
}

function parseCostVariants(card, options, deps) {
  const manaCost = manaCostForCard(card, deps.currentCardFace);
  let variants = [cloneRequirement()];
  const tokens = manaCost.match(/\{([^}]+)\}/g) || [];

  for (const rawToken of tokens) {
    const token = rawToken.slice(1, -1);
    variants = expandCostToken(
      variants,
      token,
      options.xValue,
      options.allowLifePayment
    );
    if (!variants.length) break;
  }

  for (const variant of variants) {
    variant.generic += Math.max(0, Math.floor(Number(options.commanderTax) || 0));
  }

  return {
    manaCost,
    variants: dedupeRequirements(variants)
  };
}

function commanderColors(actor) {
  const colors = new Set();

  for (const card of actor?.deck?.commanderData || []) {
    for (const color of card?.colorIdentity || []) {
      if ("WUBRG".includes(color)) colors.add(color);
    }
  }

  for (const commanderName of actor?.deck?.commanders || []) {
    const entry = (actor?.deck?.cards || []).find(
      (card) => String(card?.name || "").toLocaleLowerCase("en-US") ===
        String(commanderName || "").toLocaleLowerCase("en-US")
    );
    for (const color of entry?.cardData?.colorIdentity || []) {
      if ("WUBRG".includes(color)) colors.add(color);
    }
  }

  return colors.size ? [...colors] : ["W", "U", "B", "R", "G"];
}

function manaVector(symbols) {
  const mana = emptyMana();
  for (const symbol of symbols) {
    if (COLORS.includes(symbol)) mana[symbol] += 1;
  }
  return mana;
}

function uniqueOptions(options) {
  const unique = new Map();
  for (const option of options) {
    const key = [
      ...COLORS.map((color) => option.mana[color] || 0),
      option.lifeCost || 0,
      option.sacrifice ? 1 : 0
    ].join(":");
    const previous = unique.get(key);
    if (!previous || option.penalty < previous.penalty) unique.set(key, option);
  }
  return [...unique.values()];
}

function anyColorOptions(colors, count = 1, details = {}) {
  return colors.map((color) => ({
    mana: manaVector(Array(count).fill(color)),
    label: `${count > 1 ? count + " " : ""}${COLOR_NAMES[color] || color}`,
    lifeCost: details.lifeCost || 0,
    sacrifice: Boolean(details.sacrifice),
    penalty: Number(details.penalty) || 0
  }));
}

function anyCombinationOptions(colors, count, details = {}) {
  const results = [];

  function build(prefix, startIndex) {
    if (prefix.length >= count) {
      results.push({
        mana: manaVector(prefix),
        label: prefix.join(""),
        lifeCost: details.lifeCost || 0,
        sacrifice: Boolean(details.sacrifice),
        penalty: Number(details.penalty) || 0
      });
      return;
    }

    for (let index = startIndex; index < colors.length; index += 1) {
      build([...prefix, colors[index]], index);
    }
  }

  build([], 0);
  return results.slice(0, 64);
}

function outputOptionsFromText(output, actorColors, details = {}) {
  const text = String(output || "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  if (/for each|equal to|where x|that much|an amount of/i.test(text)) {
    return [];
  }

  if (/two mana in any combination of colors/i.test(text)) {
    return anyCombinationOptions(["W", "U", "B", "R", "G"], 2, details);
  }

  if (/three mana in any combination of colors/i.test(text)) {
    return anyCombinationOptions(["W", "U", "B", "R", "G"], 3, details);
  }

  const anyOneMatch = text.match(/(one|two|three)\s+mana of any one color/i);
  if (anyOneMatch) {
    const count = { one: 1, two: 2, three: 3 }[anyOneMatch[1].toLowerCase()] || 1;
    return anyColorOptions(["W", "U", "B", "R", "G"], count, details);
  }

  if (/one mana of any color in your commander'?s color identity/i.test(text)) {
    return anyColorOptions(actorColors, 1, details);
  }

  if (/one mana of any color/i.test(text)) {
    return anyColorOptions(["W", "U", "B", "R", "G"], 1, details);
  }

  if (/one mana of any type/i.test(text)) {
    return anyColorOptions(COLORS, 1, details);
  }

  const symbols = [...text.matchAll(/\{([WUBRGC])\}/gi)].map((match) => match[1].toUpperCase());
  if (!symbols.length) return [];

  if (/\bor\b/i.test(text)) {
    return uniqueOptions(symbols.map((symbol) => ({
      mana: manaVector([symbol]),
      label: COLOR_NAMES[symbol] || symbol,
      lifeCost: details.lifeCost || 0,
      sacrifice: Boolean(details.sacrifice),
      penalty: Number(details.penalty) || 0
    })));
  }

  return [{
    mana: manaVector(symbols),
    label: symbols.join(""),
    lifeCost: details.lifeCost || 0,
    sacrifice: Boolean(details.sacrifice),
    penalty: Number(details.penalty) || 0
  }];
}

function sourceOptionsForPermanent(card, actor, deps) {
  if (!card || card.tapped || card.phasedOut) return [];

  const typeLine = String(deps.currentTypeLine(card) || "");
  const oracle = String(deps.currentOracleText(card) || "");
  const actorColors = commanderColors(actor);
  const options = [];

  for (const [basicType, color] of Object.entries(BASIC_TYPES)) {
    if (new RegExp(`\\b${basicType}\\b`, "i").test(typeLine)) {
      options.push({
        mana: manaVector([color]),
        label: COLOR_NAMES[color],
        lifeCost: 0,
        sacrifice: false,
        penalty: 0
      });
    }
  }

  const addPattern = /\bAdd\s+([^.;]+(?:\{[WUBRGC]\}[^.;]*)?)/gi;
  let match;

  while ((match = addPattern.exec(oracle))) {
    const prefixStart = Math.max(
      oracle.lastIndexOf(".", match.index),
      oracle.lastIndexOf("\n", match.index),
      0
    );
    const prefix = oracle.slice(prefixStart, match.index);
    const hasTap = /\{T\}/i.test(prefix);
    const sacrifice = /\bSacrifice\b/i.test(prefix);

    if (!hasTap && !sacrifice) continue;

    const additionalManaSymbols = [...prefix.matchAll(/\{([^}]+)\}/g)]
      .map((entry) => entry[1].toUpperCase())
      .filter((symbol) => symbol !== "T");

    if (additionalManaSymbols.some((symbol) => /^\d+$/.test(symbol) || COLORS.includes(symbol))) {
      continue;
    }

    if (
      hasTap &&
      deps.isCreatureCard(card) &&
      card.summoningSick &&
      !deps.hasKeyword(card, "haste")
    ) {
      continue;
    }

    const lifeMatch = prefix.match(/Pay\s+(\d+)\s+life/i);
    const lifeCost = lifeMatch ? Math.max(0, Number(lifeMatch[1]) || 0) : 0;
    const parsed = outputOptionsFromText(match[1], actorColors, {
      lifeCost,
      sacrifice,
      penalty: lifeCost * 240 + (sacrifice ? 900 : 0)
    });
    options.push(...parsed);
  }

  const unique = uniqueOptions(options);
  const flexibilityPenalty = unique.length > 1 ? 12 : 0;

  return unique.map((option) => ({
    ...option,
    penalty: option.penalty + flexibilityPenalty
  }));
}

function buildManaSources(actor, totalNeeded, deps) {
  const sources = [];
  const pool = cloneMana(actor?.game?.manaPool);

  for (const color of COLORS) {
    const amount = Math.min(pool[color], Math.max(0, totalNeeded));
    for (let index = 0; index < amount; index += 1) {
      sources.push({
        id: `pool:${color}:${index}`,
        kind: "pool",
        cardId: null,
        name: `${COLOR_NAMES[color]} mana in pool`,
        options: [{
          mana: manaVector([color]),
          label: color,
          lifeCost: 0,
          sacrifice: false,
          penalty: 0
        }]
      });
    }
  }

  for (const card of actor?.game?.battlefield || []) {
    const options = sourceOptionsForPermanent(card, actor, deps);
    if (!options.length) continue;

    sources.push({
      id: `card:${card.id}`,
      kind: "permanent",
      cardId: card.id,
      name: card.name,
      options
    });
  }

  return sources;
}

function stateKey(vector, cap) {
  return COLORS.map((color) => Math.min(cap, vector[color] || 0)).join(",");
}

function stateDistance(vector, requirement) {
  let missing = 0;
  for (const color of COLORS) {
    missing += Math.max(0, requirement[color] - (vector[color] || 0));
  }
  missing += Math.max(
    0,
    COLORS.reduce((sum, color) => sum + requirement[color], 0) +
      requirement.generic -
      manaTotal(vector)
  );
  return missing;
}

function satisfies(vector, requirement) {
  for (const color of COLORS) {
    if ((vector[color] || 0) < requirement[color]) return false;
  }

  const needed =
    COLORS.reduce((sum, color) => sum + requirement[color], 0) +
    requirement.generic;

  return manaTotal(vector) >= needed;
}

function pruneStates(states, requirement) {
  if (states.size <= MAX_DP_STATES) return states;

  const ranked = [...states.entries()]
    .sort((a, b) => {
      const aPlan = a[1];
      const bPlan = b[1];
      const aRank =
        stateDistance(aPlan.mana, requirement) * 10000 +
        aPlan.score +
        aPlan.choices.length * 2;
      const bRank =
        stateDistance(bPlan.mana, requirement) * 10000 +
        bPlan.score +
        bPlan.choices.length * 2;
      return aRank - bRank;
    })
    .slice(0, MAX_DP_STATES);

  return new Map(ranked);
}

function findPlanForRequirement(requirement, sources) {
  const totalNeeded =
    COLORS.reduce((sum, color) => sum + requirement[color], 0) +
    requirement.generic;
  const cap = Math.max(1, totalNeeded + 3);

  let states = new Map([
    [
      stateKey(emptyMana(), cap),
      {
        mana: emptyMana(),
        choices: [],
        score: requirement.life * 320
      }
    ]
  ]);

  for (const source of sources) {
    const next = new Map(states);

    for (const plan of states.values()) {
      for (const option of source.options) {
        const mana = cloneMana(plan.mana);
        addMana(mana, option.mana);

        for (const color of COLORS) {
          mana[color] = Math.min(cap, mana[color]);
        }

        const permanentCost = source.kind === "permanent" ? 100 : 0;
        const score =
          plan.score +
          permanentCost +
          (Number(option.penalty) || 0);

        const candidate = {
          mana,
          score,
          choices: [
            ...plan.choices,
            {
              sourceId: source.id,
              kind: source.kind,
              cardId: source.cardId,
              name: source.name,
              mana: cloneMana(option.mana),
              label: option.label,
              lifeCost: option.lifeCost || 0,
              sacrifice: Boolean(option.sacrifice)
            }
          ]
        };

        const key = stateKey(mana, cap);
        const previous = next.get(key);
        if (!previous || candidate.score < previous.score) {
          next.set(key, candidate);
        }
      }
    }

    states = pruneStates(next, requirement);
  }

  let winner = null;

  for (const plan of states.values()) {
    if (!satisfies(plan.mana, requirement)) continue;

    const needed =
      COLORS.reduce((sum, color) => sum + requirement[color], 0) +
      requirement.generic;
    const waste = Math.max(0, manaTotal(plan.mana) - needed);
    const finalScore = plan.score + waste * 4;

    if (!winner || finalScore < winner.finalScore) {
      winner = { ...plan, finalScore, waste };
    }
  }

  return winner;
}

function paymentForPlan(requirement, plan) {
  const remaining = cloneMana(plan.mana);
  const payment = emptyMana();

  for (const color of COLORS) {
    const required = requirement[color];
    if (remaining[color] < required) return null;
    payment[color] += required;
    remaining[color] -= required;
  }

  let generic = requirement.generic;
  const genericOrder = [
    "C",
    ...["W", "U", "B", "R", "G"].sort(
      (a, b) => remaining[b] - remaining[a]
    )
  ];

  for (const color of genericOrder) {
    if (generic <= 0) break;
    const spend = Math.min(generic, remaining[color]);
    payment[color] += spend;
    remaining[color] -= spend;
    generic -= spend;
  }

  return generic === 0 ? payment : null;
}

function locateOwnedCard(actor, zone, cardId, deps) {
  if (!actor?.game) return null;
  return deps.getCardFromZone(actor.game, zone, String(cardId || ""));
}

function spellTimingError(room, actor, card, deps) {
  if (room.priority?.playerId !== actor.id) {
    return `Priority belongs to ${
      deps.findPlayer(room, room.priority?.playerId)?.name || "another player"
    }.`;
  }

  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  const sorcerySpeed =
    room.turn?.activePlayerId === actor.id &&
    /^Main [12]$/i.test(phase) &&
    room.stack.length === 0;

  if (!deps.isInstantSpeed(card) && !sorcerySpeed) {
    return `${card.name} can normally be cast only during your main phase while the stack is empty.`;
  }

  return "";
}

function landPlayError(room, actor, card, deps) {
  if (room.priority?.playerId !== actor.id) {
    return "You need priority to play a land.";
  }

  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  if (room.turn?.activePlayerId !== actor.id || !/^Main [12]$/i.test(phase)) {
    return "A land can normally be played only during one of your main phases.";
  }

  if (room.stack.length) {
    return "A land cannot be played while the stack is not empty.";
  }

  const turnNumber = Number(room.turn?.number) || 0;
  const used =
    actor.game.landPlayTurnNumber === turnNumber
      ? Number(actor.game.landPlaysThisTurn) || 0
      : 0;

  if (used >= 1) return "You already played a land this turn.";
  if (!/\bLand\b/i.test(deps.currentTypeLine(card))) {
    return "That card is not a land. Cast it as a spell instead.";
  }

  return "";
}

function previewAutoCast(room, actor, action, deps) {
  const fromZone = ["hand", "commandZone", "exile", "graveyard"].includes(
    action?.fromZone
  )
    ? action.fromZone
    : "hand";

  const located = locateOwnedCard(actor, fromZone, action?.cardId, deps);
  if (!located) {
    return { success: false, error: "That card is no longer in the selected zone." };
  }

  const card = located.card;
  const timingError = spellTimingError(room, actor, card, deps);
  if (timingError) return { success: false, error: timingError };

  const commanderTax =
    fromZone === "commandZone" &&
    card.commander &&
    room.formatRules?.commanderTaxEnabled !== false
      ? Number(actor.game.commanderTax) || 0
      : 0;

  const parsed = parseCostVariants(
    card,
    {
      xValue: action?.xValue,
      commanderTax,
      allowLifePayment: action?.allowLifePayment !== false
    },
    deps
  );

  if (!parsed.variants.length) {
    return {
      success: false,
      error:
        "This cost uses a mana symbol or payment method that Auto-Tap does not support yet. Use manual payment."
    };
  }

  let best = null;

  for (const requirement of parsed.variants) {
    const totalNeeded =
      COLORS.reduce((sum, color) => sum + requirement[color], 0) +
      requirement.generic;

    const sources = buildManaSources(actor, totalNeeded, deps);
    const plan = findPlanForRequirement(requirement, sources);
    if (!plan) continue;

    const payment = paymentForPlan(requirement, plan);
    if (!payment) continue;

    const sourceLife = plan.choices.reduce(
      (sum, choice) => sum + (Number(choice.lifeCost) || 0),
      0
    );
    const totalLife = requirement.life + sourceLife;

    if (totalLife > actor.game.life) continue;

    const candidate = {
      requirement,
      plan,
      payment,
      totalLife,
      score: plan.finalScore + totalLife * 300
    };

    if (!best || candidate.score < best.score) best = candidate;
  }

  if (!best) {
    return {
      success: false,
      error:
        "No legal combination of your untapped supported mana sources can pay this spell."
    };
  }

  const permanentChoices = best.plan.choices.filter(
    (choice) => choice.kind === "permanent"
  );
  const poolChoices = best.plan.choices.filter(
    (choice) => choice.kind === "pool"
  );

  return {
    success: true,
    version: "42.0.0",
    cardId: card.id,
    cardName: card.name,
    fromZone,
    manaCost: parsed.manaCost,
    commanderTax,
    xValue: Math.max(0, Math.floor(Number(action?.xValue) || 0)),
    requirement: cloneRequirement(best.requirement),
    requirementLabel: `${parsed.manaCost || "{0}"}${
      commanderTax ? ` + {${commanderTax}} commander tax` : ""
    }`,
    payment: cloneMana(best.payment),
    paymentLabel: manaLabel(best.payment),
    lifePayment: best.totalLife,
    usesPool: poolChoices.length,
    sources: permanentChoices.map((choice) => ({
      cardId: choice.cardId,
      name: choice.name,
      mana: cloneMana(choice.mana),
      manaLabel: manaLabel(choice.mana),
      lifeCost: choice.lifeCost,
      sacrifice: choice.sacrifice
    })),
    warnings: [
      ...(best.totalLife
        ? [`Auto-Tap will pay ${best.totalLife} life.`]
        : []),
      ...(permanentChoices.some((choice) => choice.sacrifice)
        ? ["Auto-Tap will sacrifice a mana source."]
        : []),
      ...(best.requirement.notes || [])
    ]
  };
}

function applyAutoPayment(room, actor, action, preview, legacy, deps) {
  const gameSnapshot = JSON.parse(JSON.stringify(actor.game));

  try {
    for (const source of preview.sources) {
      const index = actor.game.battlefield.findIndex(
        (card) => card.id === source.cardId
      );
      if (index < 0) {
        throw new Error(`${source.name} is no longer on your battlefield.`);
      }

      const card = actor.game.battlefield[index];
      card.tapped = true;

      if (source.lifeCost) {
        actor.game.life -= source.lifeCost;
      }

      addMana(actor.game.manaPool, source.mana);

      if (source.sacrifice) {
        const [sacrificed] = actor.game.battlefield.splice(index, 1);
        if (!sacrificed.token) actor.game.graveyard.unshift(sacrificed);
      }
    }

    const phyrexianLife = Math.max(
      0,
      preview.lifePayment -
        preview.sources.reduce(
          (sum, source) => sum + (Number(source.lifeCost) || 0),
          0
        )
    );
    actor.game.life -= phyrexianLife;

    for (const color of COLORS) {
      const spend = Math.max(0, Math.floor(Number(preview.payment[color]) || 0));
      if ((actor.game.manaPool[color] || 0) < spend) {
        throw new Error(`The ${color} mana pool changed before Auto-Tap completed.`);
      }
      actor.game.manaPool[color] -= spend;
    }

    const result = legacy(room, actor, {
      ...action,
      type: "cast-card",
      enforcePayment: false,
      manaPayment: preview.payment
    });

    if (!result?.success) {
      actor.game = gameSnapshot;
      return result || { success: false, error: "The spell could not be cast." };
    }

    const stackItem = room.stack?.at(-1);
    if (stackItem?.sourceCardId === preview.cardId) {
      stackItem.autoPayment = {
        version: "42.0.0",
        payment: cloneMana(preview.payment),
        sources: preview.sources.map((source) => ({
          cardId: source.cardId,
          name: source.name,
          mana: cloneMana(source.mana)
        })),
        lifePayment: preview.lifePayment
      };
    }

    deps.addLog(
      room,
      `${actor.name} auto-tapped ${
        preview.sources.length
      } mana source${preview.sources.length === 1 ? "" : "s"} to cast ${
        preview.cardName
      }${preview.lifePayment ? ` and paid ${preview.lifePayment} life` : ""}.`,
      "mana"
    );

    return {
      success: true,
      autoPayment: preview
    };
  } catch (error) {
    actor.game = gameSnapshot;
    return {
      success: false,
      error: String(error?.message || "Auto-Tap could not complete the payment.")
    };
  }
}

function createArenaRulesEngine(dependencies) {
  const deps = {
    ...dependencies,
    PHASES: dependencies.PHASES || []
  };

  function preview(room, actor, action) {
    if (!room || !actor?.game) {
      return { success: false, error: "The game is unavailable." };
    }
    return previewAutoCast(room, actor, action, deps);
  }

  function processGameAction(room, actor, action, legacy) {
    const type = String(action?.type || "");

    if (type === "auto-cast-card") {
      const previewResult = preview(room, actor, action);
      if (!previewResult.success) return previewResult;
      return applyAutoPayment(
        room,
        actor,
        action,
        previewResult,
        legacy,
        deps
      );
    }

    if (type === "cast-card") {
      const fromZone = ["hand", "commandZone", "exile", "graveyard"].includes(
        action?.fromZone
      )
        ? action.fromZone
        : "hand";
      const located = locateOwnedCard(actor, fromZone, action?.cardId, deps);
      if (!located) {
        return {
          success: false,
          error: "That card is no longer in the selected zone."
        };
      }
      const error = spellTimingError(room, actor, located.card, deps);
      if (error) return { success: false, error };
    }

    if (
      type === "move-card" &&
      action?.fromZone === "hand" &&
      action?.toZone === "battlefield"
    ) {
      const located = locateOwnedCard(actor, "hand", action?.cardId, deps);
      if (!located) {
        return { success: false, error: "That card is no longer in your hand." };
      }

      const error = landPlayError(room, actor, located.card, deps);
      if (error) return { success: false, error };

      const result = legacy(room, actor, action);
      if (!result?.success) return result;

      actor.game.landPlayTurnNumber = Number(room.turn?.number) || 0;
      actor.game.landPlaysThisTurn =
        (Number(actor.game.landPlaysThisTurn) || 0) + 1;

      const battlefieldCard = actor.game.battlefield.find(
        (card) => card.id === action.cardId
      );
      const oracle = battlefieldCard
        ? String(deps.currentOracleText(battlefieldCard) || "")
        : "";

      if (
        battlefieldCard &&
        /\benters(?: the battlefield)? tapped\b/i.test(oracle) &&
        !/\bunless\b|\byou may pay\b|\bif you don'?t\b/i.test(oracle)
      ) {
        battlefieldCard.tapped = true;
      }

      return result;
    }

    return legacy(room, actor, action);
  }

  return {
    version: "42.0.0",
    preview,
    processGameAction,
    status() {
      return {
        success: true,
        version: "42.0.0",
        automatic: [
          "sorcery-speed and priority validation",
          "one land play per turn",
          "basic land-type mana",
          "simple land mana abilities",
          "simple mana rocks and mana creatures",
          "commander color-identity mana",
          "multi-mana sources such as Sol Ring",
          "colored, generic, hybrid and X costs",
          "commander tax",
          "optional Phyrexian life payment",
          "server-authoritative source tapping"
        ],
        assisted: [
          "targets, modes and optional additional costs",
          "shock-land life choice",
          "cost reducers and increasers",
          "alternative costs",
          "convoke, delve and improvise",
          "snow mana",
          "filter sources that require mana",
          "variable-output sources",
          "restricted mana and replacement effects"
        ]
      };
    }
  };
}

module.exports = {
  createArenaRulesEngine,
  _test: {
    parseCostVariants,
    sourceOptionsForPermanent,
    buildManaSources,
    findPlanForRequirement,
    paymentForPlan,
    previewAutoCast,
    emptyMana,
    manaLabel
  }
};
