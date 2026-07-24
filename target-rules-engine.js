"use strict";

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};
const COLORS = ["W", "U", "B", "R", "G", "C"];
const COLOR_WORDS = {
  white: "W", blue: "U", black: "B", red: "R", green: "G"
};

function numberFrom(value, fallback = 1) {
  const text = String(value || "").trim().toLowerCase();
  if (/^\d+$/.test(text)) return Math.max(0, Number(text));
  return NUMBER_WORDS[text] ?? fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function normalizeState(room) {
  room.wardChoices = list(room.wardChoices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-40);
  return room.wardChoices;
}

function pendingWard(room) {
  return normalizeState(room);
}

function sourceProfile(card, deps) {
  const face = deps.currentCardFace(card) || {};
  const typeLine = String(deps.currentTypeLine(card) || "");
  const colors = list(face.colors || card?.cardData?.colors || card?.colors)
    .map((entry) => String(entry).toUpperCase())
    .filter((entry) => "WUBRG".includes(entry));
  const identity = list(face.colorIdentity || card?.cardData?.colorIdentity || card?.colorIdentity)
    .map((entry) => String(entry).toUpperCase())
    .filter((entry) => "WUBRG".includes(entry));
  return {
    card,
    colors: colors.length ? colors : identity,
    colorless: !colors.length && !identity.length,
    multicolored: (colors.length ? colors : identity).length > 1,
    typeLine,
    artifact: /\bArtifact\b/i.test(typeLine),
    creature: /\bCreature\b/i.test(typeLine),
    enchantment: /\bEnchantment\b/i.test(typeLine),
    instant: /\bInstant\b/i.test(typeLine),
    sorcery: /\bSorcery\b/i.test(typeLine),
    permanent: /\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/i.test(typeLine)
  };
}

function qualityMatchesSource(quality, profile) {
  const text = String(quality || "").toLowerCase().trim();
  if (!text) return false;
  if (text.includes("everything")) return true;
  for (const [word, symbol] of Object.entries(COLOR_WORDS)) {
    if (text.includes(word) && profile.colors.includes(symbol)) return true;
  }
  if (text.includes("colorless") && profile.colorless) return true;
  if (/multicolou?red/.test(text) && profile.multicolored) return true;
  if (text.includes("artifact") && profile.artifact) return true;
  if (text.includes("creature") && profile.creature) return true;
  if (text.includes("enchantment") && profile.enchantment) return true;
  if (text.includes("instant") && profile.instant) return true;
  if (text.includes("sorcery") && profile.sorcery) return true;
  if (text.includes("permanent") && profile.permanent) return true;
  return false;
}

function protectionBlocks(card, sourceCard, deps) {
  const oracle = String(deps.currentOracleText(card) || "");
  const profile = sourceProfile(sourceCard, deps);
  for (const match of oracle.matchAll(/protection from ([^.;\n]+)/gi)) {
    if (qualityMatchesSource(match[1], profile)) return true;
  }
  return false;
}

function hexproofFromBlocks(card, sourceCard, deps) {
  const oracle = String(deps.currentOracleText(card) || "");
  const profile = sourceProfile(sourceCard, deps);
  for (const match of oracle.matchAll(/hexproof from ([^.;\n]+)/gi)) {
    if (qualityMatchesSource(match[1], profile)) return true;
  }
  return false;
}

function playerHasHexproof(room, player, sourceControllerId, sourceCard, deps) {
  if (!player?.game || player.id === sourceControllerId) return false;
  for (const permanent of player.game.battlefield || []) {
    const text = String(deps.currentOracleText(permanent) || "");
    if (/\byou have hexproof\b/i.test(text) && !/hexproof from/i.test(text)) return true;
    for (const match of text.matchAll(/you have hexproof from ([^.;\n]+)/gi)) {
      if (qualityMatchesSource(match[1], sourceProfile(sourceCard, deps))) return true;
    }
  }
  return false;
}

function parseTargetSpecs(text) {
  const source = String(text || "").replace(/\s+/g, " ");
  const specs = [];
  const pattern =
    /(?:(up to)\s+)?(?:(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?target(?:s)?\s+(.+?)(?=(?:,\s*and\s+|\s+and\s+)(?:(?:up to)\s+)?(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?target|[.;]|$)/gi;

  let match;
  while ((match = pattern.exec(source))) {
    const amount = numberFrom(match[2], 1);
    specs.push({
      id: `target-${specs.length + 1}`,
      minimum: match[1] ? 0 : amount,
      maximum: amount,
      optional: Boolean(match[1]),
      clause: String(match[3] || "").trim()
    });
  }

  return specs;
}

function entityFromTarget(room, target, deps) {
  const [kind, id] = String(target || "").split(":");
  if (kind === "player") {
    const player = deps.findPlayer(room, id);
    return player ? { kind, id, player, controllerId: player.id } : null;
  }
  if (kind === "card") {
    const located = deps.locateCard(room, id);
    return located ? { kind, id, ...located, controllerId: located.card.controllerId } : null;
  }
  if (kind === "stack") {
    const item = room.stack?.find((entry) => entry.id === id);
    return item ? { kind, id, item, controllerId: item.controllerId } : null;
  }
  return null;
}

function typeMatches(card, clause, deps) {
  const typeLine = String(deps.currentTypeLine(card) || "");
  const lower = clause.toLowerCase();

  if (/\bnonland\b/.test(lower) && /\bLand\b/i.test(typeLine)) return false;
  if (/\bnoncreature\b/.test(lower) && /\bCreature\b/i.test(typeLine)) return false;
  if (/\bnonartifact\b/.test(lower) && /\bArtifact\b/i.test(typeLine)) return false;
  if (/\bnonenchantment\b/.test(lower) && /\bEnchantment\b/i.test(typeLine)) return false;

  const requested = [];
  if (/\bcreature\b/.test(lower)) requested.push(/\bCreature\b/i.test(typeLine));
  if (/\bartifact\b/.test(lower)) requested.push(/\bArtifact\b/i.test(typeLine));
  if (/\benchantment\b/.test(lower)) requested.push(/\bEnchantment\b/i.test(typeLine));
  if (/\bland\b/.test(lower) && !/\bnonland\b/.test(lower)) requested.push(/\bLand\b/i.test(typeLine));
  if (/\bplaneswalker\b/.test(lower)) requested.push(/\bPlaneswalker\b/i.test(typeLine));
  if (/\bbattle\b/.test(lower)) requested.push(/\bBattle\b/i.test(typeLine));
  if (/\bpermanent\b/.test(lower)) {
    requested.push(/\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/i.test(typeLine));
  }
  if (/\binstant\b/.test(lower)) requested.push(/\bInstant\b/i.test(typeLine));
  if (/\bsorcery\b/.test(lower)) requested.push(/\bSorcery\b/i.test(typeLine));

  if (requested.length && !requested.some(Boolean)) return false;

  const manaValue = Number(
    card?.cardData?.manaValue ??
    card?.cardData?.cmc ??
    card?.manaValue ??
    card?.cmc ??
    0
  );
  const less = clause.match(/mana value\s+(\d+)\s+or less/i);
  if (less && manaValue > Number(less[1])) return false;
  const greater = clause.match(/mana value\s+(\d+)\s+or greater/i);
  if (greater && manaValue < Number(greater[1])) return false;

  const power = Number(card?.power ?? card?.cardData?.power);
  const powerLess = clause.match(/power\s+(\d+)\s+or less/i);
  if (powerLess && Number.isFinite(power) && power > Number(powerLess[1])) return false;
  const powerGreater = clause.match(/power\s+(\d+)\s+or greater/i);
  if (powerGreater && Number.isFinite(power) && power < Number(powerGreater[1])) return false;

  if (/\battacking\b/i.test(clause) && !card.attacking) return false;
  if (/\bblocking\b/i.test(clause) && !card.blockingCardId) return false;
  if (/\btapped\b/i.test(clause) && !/\buntapped\b/i.test(clause) && !card.tapped) return false;
  if (/\buntapped\b/i.test(clause) && card.tapped) return false;

  if (/\bwith flying\b/i.test(clause) && !deps.hasKeyword(card, "flying")) return false;
  if (/\bwith defender\b/i.test(clause) && !deps.hasKeyword(card, "defender")) return false;
  if (/\blegendary\b/i.test(clause) && !/\bLegendary\b/i.test(typeLine)) return false;

  return true;
}

function legalForSpec(room, actor, sourceCard, sourceCardId, entity, spec, deps) {
  const clause = spec.clause;
  const lower = clause.toLowerCase();

  if (/\bopponent\b/.test(lower)) {
    if (entity.kind !== "player" || entity.player.id === actor.id) return false;
  } else if (/\bplayer\b/.test(lower)) {
    if (entity.kind !== "player") return false;
  }

  if (/\bspell\b/.test(lower)) {
    if (entity.kind !== "stack" || entity.item.kind !== "spell") return false;
  } else if (/\bability\b/.test(lower)) {
    if (entity.kind !== "stack" || entity.item.kind === "spell") return false;
  }

  if (/\bcard in (?:a|your|an opponent'?s) graveyard\b/i.test(clause)) {
    if (entity.kind !== "card" || entity.zone !== "graveyard") return false;
  }

  const cardLike = entity.kind === "card";
  const stackCard = entity.kind === "stack" ? entity.item.card : null;
  const targetCard = cardLike ? entity.card : stackCard;

  if (
    !/\bplayer\b|\bopponent\b|\bspell\b|\bability\b/.test(lower) &&
    !targetCard
  ) {
    return false;
  }

  if (targetCard && !typeMatches(targetCard, clause, deps)) return false;

  if (/\byou control\b/i.test(clause) && entity.controllerId !== actor.id) return false;
  if (/\b(?:an|your) opponent controls\b/i.test(clause) && entity.controllerId === actor.id) return false;
  if (/\banother\b/i.test(clause) && entity.kind === "card" && entity.id === sourceCardId) return false;

  if (entity.kind === "card" && entity.zone === "battlefield") {
    const targetController = deps.findPlayer(room, entity.controllerId);
    if (entity.controllerId !== actor.id) {
      if (deps.hasKeyword(entity.card, "shroud")) return false;
      if (deps.hasKeyword(entity.card, "hexproof")) return false;
      if (hexproofFromBlocks(entity.card, sourceCard, deps)) return false;
      if (protectionBlocks(entity.card, sourceCard, deps)) return false;
      if (targetController && playerHasHexproof(room, targetController, actor.id, sourceCard, deps)) {
        // Player hexproof does not shield their permanents; no action here.
      }
    } else if (deps.hasKeyword(entity.card, "shroud")) {
      return false;
    }
  }

  if (entity.kind === "player") {
    if (playerHasHexproof(room, entity.player, actor.id, sourceCard, deps)) return false;
  }

  return true;
}

function assignTargets(room, actor, sourceCard, sourceCardId, specs, targetIds, deps) {
  const targets = unique(targetIds);
  const minimum = specs.reduce((sum, spec) => sum + spec.minimum, 0);
  const maximum = specs.reduce((sum, spec) => sum + spec.maximum, 0);

  if (targets.length < minimum || targets.length > maximum) {
    return {
      success: false,
      error: `Choose between ${minimum} and ${maximum} legal target${maximum === 1 ? "" : "s"}.`
    };
  }

  const entities = targets.map((target) => entityFromTarget(room, target, deps));
  if (entities.some((entity) => !entity)) {
    return { success: false, error: "One selected target no longer exists." };
  }

  if (!specs.length) {
    return { success: true, targets };
  }

  if (specs.length === 1) {
    const spec = specs[0];
    if (entities.every((entity) => legalForSpec(room, actor, sourceCard, sourceCardId, entity, spec, deps))) {
      return { success: true, targets };
    }
    return { success: false, error: `One selected target does not satisfy “target ${spec.clause}”.` };
  }

  const capacities = specs.map((spec) => ({ ...spec, used: 0 }));
  const assigned = new Array(entities.length).fill(-1);

  function search(index) {
    if (index >= entities.length) {
      return capacities.every((spec) => spec.used >= spec.minimum && spec.used <= spec.maximum);
    }
    for (let specIndex = 0; specIndex < capacities.length; specIndex += 1) {
      const spec = capacities[specIndex];
      if (spec.used >= spec.maximum) continue;
      if (!legalForSpec(room, actor, sourceCard, sourceCardId, entities[index], spec, deps)) continue;
      spec.used += 1;
      assigned[index] = specIndex;
      if (search(index + 1)) return true;
      spec.used -= 1;
      assigned[index] = -1;
    }
    return false;
  }

  if (!search(0)) {
    return { success: false, error: "The selected targets do not match the card's target clauses." };
  }

  return { success: true, targets, assignments: assigned };
}

function sourceCardFromAction(room, actor, action, deps) {
  const sourceCardId = String(action?.cardId || action?.sourceCardId || "");
  if (sourceCardId) {
    const located = deps.locateCard(room, sourceCardId);
    if (located?.card) return located.card;
  }
  if (action?.triggerId) {
    const trigger = room.triggerQueue?.find((entry) => entry.id === action.triggerId);
    const located = trigger?.sourceCardId ? deps.locateCard(room, trigger.sourceCardId) : null;
    if (located?.card) return located.card;
  }
  return null;
}

function textFromAction(room, action, sourceCard, deps) {
  if (action?.text) return String(action.text);
  if (action?.triggerId) {
    const trigger = room.triggerQueue?.find((entry) => entry.id === action.triggerId);
    if (trigger?.text) return String(trigger.text);
  }
  return String(deps.currentOracleText(sourceCard) || "");
}

function stackCreatingAction(type) {
  return new Set([
    "cast-card", "auto-cast-card", "mechanic-auto-cast",
    "activate-card", "push-stack-item", "trigger-to-stack"
  ]).has(type);
}

function parseWardCosts(card, deps) {
  const oracle = String(deps.currentOracleText(card) || "");
  const results = [];

  for (const match of oracle.matchAll(/\bward\s*(?:—|-)?\s*([^.;\n]+)/gi)) {
    const raw = String(match[1] || "").trim();
    const symbols = [...raw.matchAll(/\{([^}]+)\}/g)].map((entry) => entry[1].toUpperCase());
    const mana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0 };
    let supported = false;

    for (const symbol of symbols) {
      if (/^\d+$/.test(symbol)) {
        mana.generic += Number(symbol);
        supported = true;
      } else if (COLORS.includes(symbol)) {
        mana[symbol] += 1;
        supported = true;
      }
    }

    const life = raw.match(/pay\s+(\d+)\s+life/i);
    const discard = /\bdiscard a card\b/i.test(raw);
    const sacrifice = /\bsacrifice a permanent\b/i.test(raw);

    if (life) supported = true;
    if (discard || sacrifice) supported = true;

    results.push({
      raw,
      mana,
      life: life ? Number(life[1]) : 0,
      discard,
      sacrifice,
      supported
    });
  }

  return results;
}

function manaPoolTotal(pool) {
  return COLORS.reduce((sum, color) => sum + (Number(pool?.[color]) || 0), 0);
}

function simpleManaOptions(card, deps) {
  if (!card || card.tapped || card.phasedOut) return [];
  if (deps.isCreatureCard(card) && card.summoningSick && !deps.hasKeyword(card, "haste")) return [];

  const typeLine = String(deps.currentTypeLine(card) || "");
  const oracle = String(deps.currentOracleText(card) || "");
  const options = [];

  const basics = {
    Plains: "W", Island: "U", Swamp: "B", Mountain: "R", Forest: "G", Wastes: "C"
  };
  for (const [basic, color] of Object.entries(basics)) {
    if (new RegExp(`\\b${basic}\\b`, "i").test(typeLine)) {
      options.push({ mana: { [color]: 1 }, label: color });
    }
  }

  for (const match of oracle.matchAll(/\{T\}[^.]*:\s*Add\s+([^.;\n]+)/gi)) {
    const output = match[1];
    const symbols = [...output.matchAll(/\{([WUBRGC])\}/gi)].map((entry) => entry[1].toUpperCase());
    if (symbols.length) {
      if (/\bor\b/i.test(output)) {
        for (const symbol of symbols) options.push({ mana: { [symbol]: 1 }, label: symbol });
      } else {
        const mana = {};
        for (const symbol of symbols) mana[symbol] = (mana[symbol] || 0) + 1;
        options.push({ mana, label: symbols.join("") });
      }
    } else if (/one mana of any color/i.test(output)) {
      for (const color of ["W", "U", "B", "R", "G"]) options.push({ mana: { [color]: 1 }, label: color });
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

function autoPayWard(room, actor, cost, deps) {
  const snapshot = JSON.parse(JSON.stringify(actor.game));
  const need = { ...cost.mana };
  const selected = [];

  function spendPool(color, amount) {
    const spend = Math.min(amount, actor.game.manaPool[color] || 0);
    actor.game.manaPool[color] -= spend;
    return amount - spend;
  }

  for (const color of COLORS) {
    need[color] = spendPool(color, need[color] || 0);
  }

  const sources = [];
  for (const card of actor.game.battlefield || []) {
    const options = simpleManaOptions(card, deps);
    if (options.length) sources.push({ card, options });
  }

  for (const color of COLORS) {
    while (need[color] > 0) {
      const source = sources.find((entry) =>
        !selected.some((chosen) => chosen.card.id === entry.card.id) &&
        entry.options.some((option) => (option.mana[color] || 0) > 0)
      );
      if (!source) {
        actor.game = snapshot;
        return { success: false, error: `Auto-pay could not make enough ${color} mana for ward.` };
      }
      const option = source.options.find((entry) => (entry.mana[color] || 0) > 0);
      source.card.tapped = true;
      selected.push({ card: source.card, option });
      for (const producedColor of COLORS) {
        actor.game.manaPool[producedColor] =
          (actor.game.manaPool[producedColor] || 0) + (option.mana[producedColor] || 0);
      }
      need[color] = spendPool(color, need[color]);
    }
  }

  let generic = Math.max(0, Number(need.generic) || 0);
  if (generic > 0) {
    for (const color of COLORS) {
      generic = spendPool(color, generic);
      if (generic <= 0) break;
    }
  }

  while (generic > 0) {
    const source = sources.find((entry) =>
      !selected.some((chosen) => chosen.card.id === entry.card.id)
    );
    if (!source) {
      actor.game = snapshot;
      return { success: false, error: "Auto-pay could not make enough mana for ward." };
    }
    const option = source.options[0];
    source.card.tapped = true;
    selected.push({ card: source.card, option });
    for (const producedColor of COLORS) {
      actor.game.manaPool[producedColor] =
        (actor.game.manaPool[producedColor] || 0) + (option.mana[producedColor] || 0);
    }
    for (const color of COLORS) {
      generic = spendPool(color, generic);
      if (generic <= 0) break;
    }
  }

  if (cost.life) {
    if (actor.game.life <= cost.life) {
      actor.game = snapshot;
      return { success: false, error: "You do not have enough life to pay ward." };
    }
    actor.game.life -= cost.life;
  }

  return {
    success: true,
    tapped: selected.map((entry) => entry.card.id)
  };
}

function createWardChoice(room, actor, targetEntity, stackItem, cost, deps) {
  const choice = {
    id: deps.createId(),
    status: "open",
    createdAt: deps.nowIso(),
    playerId: actor.id,
    stackItemId: stackItem.id,
    target: targetEntity.kind === "card"
      ? { kind: "card", id: targetEntity.id, name: targetEntity.card.name }
      : { kind: targetEntity.kind, id: targetEntity.id, name: targetEntity.player?.name || "Target" },
    cost,
    sourceName: stackItem.name
  };
  room.wardChoices = list(room.wardChoices);
  room.wardChoices.push(choice);
  return choice;
}

function wardForTargets(room, actor, stackItem, targets, deps) {
  const created = [];
  for (const target of targets) {
    const entity = entityFromTarget(room, target, deps);
    if (entity?.kind !== "card" || entity.zone !== "battlefield") continue;
    if (entity.card.controllerId === actor.id) continue;
    for (const cost of parseWardCosts(entity.card, deps)) {
      created.push(createWardChoice(room, actor, entity, stackItem, cost, deps));
    }
  }
  return created;
}

function resolveWard(room, actor, action, deps) {
  const choice = pendingWard(room).find((entry) => entry.id === action?.choiceId);
  if (!choice) return { success: false, error: "That ward choice is no longer available." };
  if (choice.playerId !== actor.id) return { success: false, error: "That ward payment belongs to another player." };

  const stackItem = room.stack?.find((entry) => entry.id === choice.stackItemId);
  if (!stackItem) {
    choice.status = "resolved";
    normalizeState(room);
    return { success: true };
  }

  if (!action?.pay) {
    deps.counterStackItem(room, choice.stackItemId, actor);
    for (const pending of room.wardChoices) {
      if (pending.stackItemId === choice.stackItemId) pending.status = "resolved";
    }
    normalizeState(room);
    deps.addLog(room, `${actor.name} declined ward; ${choice.sourceName} was countered.`, "ward");
    return { success: true, countered: true };
  }

  if (!choice.cost.supported) {
    return { success: false, error: "That ward cost needs manual Judge Mode support." };
  }

  const payment = autoPayWard(room, actor, choice.cost, deps);
  if (!payment.success) return payment;

  if (choice.cost.discard) {
    const cardId = String(action?.discardCardId || "");
    const index = actor.game.hand.findIndex((card) => card.id === cardId);
    if (index < 0) return { success: false, error: "Choose a card from your hand to discard." };
    actor.game.graveyard.unshift(actor.game.hand.splice(index, 1)[0]);
  }

  if (choice.cost.sacrifice) {
    const cardId = String(action?.sacrificeCardId || "");
    const index = actor.game.battlefield.findIndex((card) => card.id === cardId);
    if (index < 0) return { success: false, error: "Choose a permanent you control to sacrifice." };
    const [card] = actor.game.battlefield.splice(index, 1);
    if (!card.token) actor.game.graveyard.unshift(card);
  }

  choice.status = "resolved";
  normalizeState(room);
  deps.addLog(room, `${actor.name} paid ward for ${choice.target.name}.`, "ward");
  return { success: true };
}

function publicWardChoices(room, viewerId, deps) {
  const player = deps.findPlayer(room, viewerId);
  return pendingWard(room)
    .filter((choice) => choice.playerId === viewerId)
    .map((choice) => ({
      ...choice,
      paymentOptions: {
        hand: choice.cost.discard
          ? (player?.game?.hand || []).map((card) => deps.publicCard(card))
          : [],
        battlefield: choice.cost.sacrifice
          ? (player?.game?.battlefield || []).map((card) => deps.publicCard(card))
          : []
      }
    }));
}

function allCandidates(room, actor, sourceCard, sourceCardId, specs, deps) {
  const candidates = [];
  for (const player of room.players || []) {
    candidates.push({ target: `player:${player.id}`, name: player.name, kind: "player" });
    for (const zone of ["battlefield", "graveyard", "exile"]) {
      for (const card of player.game?.[zone] || []) {
        candidates.push({
          target: `card:${card.id}`,
          name: card.name,
          kind: "card",
          zone,
          controllerId: card.controllerId
        });
      }
    }
  }
  for (const item of room.stack || []) {
    candidates.push({ target: `stack:${item.id}`, name: item.name, kind: "stack" });
  }

  return specs.map((spec) => ({
    ...spec,
    candidates: candidates.filter((candidate) => {
      const entity = entityFromTarget(room, candidate.target, deps);
      return entity && legalForSpec(room, actor, sourceCard, sourceCardId, entity, spec, deps);
    })
  }));
}

function createTargetRulesEngine(deps) {
  return {
    version: "44.0.0",

    processGameAction(room, actor, action, legacy) {
      const type = String(action?.type || "");

      if (type === "resolve-ward") {
        return resolveWard(room, actor, action, deps);
      }

      const wards = pendingWard(room);
      if (wards.length && !["judge-action", "undo-last", "check-state-based"].includes(type)) {
        const owner = deps.findPlayer(room, wards[0].playerId);
        return {
          success: false,
          error: `${owner?.name || "A player"} must resolve ward before the game continues.`
        };
      }

      if (!stackCreatingAction(type)) return legacy(room, actor, action);

      const sourceCard = sourceCardFromAction(room, actor, action, deps);
      const sourceCardId = sourceCard?.id || String(action?.sourceCardId || action?.cardId || "");
      const text = textFromAction(room, action, sourceCard, deps);
      const specs = parseTargetSpecs(text);
      const targetResult = assignTargets(
        room,
        actor,
        sourceCard,
        sourceCardId,
        specs,
        action?.targets || [],
        deps
      );
      if (!targetResult.success) return targetResult;

      const beforeStackIds = new Set((room.stack || []).map((item) => item.id));
      const result = legacy(room, actor, action);
      if (!result?.success) return result;

      const stackItem = [...(room.stack || [])]
        .reverse()
        .find((item) => !beforeStackIds.has(item.id));

      if (stackItem) {
        stackItem.targets = targetResult.targets;
        stackItem.targetSpecs = specs;
        wardForTargets(room, actor, stackItem, targetResult.targets, deps);
      }

      return result;
    },

    candidates(room, actor, action) {
      const sourceCard = sourceCardFromAction(room, actor, action, deps);
      const sourceCardId = sourceCard?.id || String(action?.sourceCardId || action?.cardId || "");
      const text = textFromAction(room, action, sourceCard, deps);
      const specs = parseTargetSpecs(text);
      return {
        success: true,
        version: "44.0.0",
        text,
        specs: allCandidates(room, actor, sourceCard, sourceCardId, specs, deps)
      };
    },

    pending(room, viewerId) {
      return publicWardChoices(room, viewerId, deps);
    },

    status() {
      return {
        success: true,
        version: "44.0.0",
        automatic: [
          "target player and opponent restrictions",
          "target permanent and card-type restrictions",
          "you-control and opponent-controls restrictions",
          "attacking, blocking, tapped and untapped restrictions",
          "mana-value and basic power restrictions",
          "another-target exclusions",
          "hexproof, shroud and protection targeting checks",
          "target spells and abilities on the stack",
          "generic, colored, life, discard and sacrifice ward prompts",
          "server-authoritative target validation"
        ],
        assisted: [
          "ward costs with unusual actions",
          "targets defined by dynamic values",
          "protection from complex custom qualities",
          "change-target effects",
          "divided damage assignments",
          "any number of targets"
        ]
      };
    }
  };
}

module.exports = {
  createTargetRulesEngine,
  _test: {
    parseTargetSpecs,
    legalForSpec,
    assignTargets,
    parseWardCosts,
    protectionBlocks,
    hexproofFromBlocks,
    autoPayWard
  }
};
