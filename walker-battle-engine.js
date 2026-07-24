"use strict";

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function normalizeState(room) {
  room.walkersV52 =
    room.walkersV52 && typeof room.walkersV52 === "object"
      ? room.walkersV52
      : {};

  const state = room.walkersV52;
  state.choices = list(state.choices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-50);
  state.damageResolved =
    state.damageResolved && typeof state.damageResolved === "object"
      ? state.damageResolved
      : {};
  state.lastError = state.lastError || null;
  return state;
}

function typeLine(card, deps) {
  return String(deps.currentTypeLine(card) || "");
}

function oracle(card, deps) {
  return String(deps.currentOracleText(card) || "");
}

function currentFace(card, deps) {
  return deps.currentCardFace(card) || card?.cardData || {};
}

function isPlaneswalker(card, deps) {
  return /\bPlaneswalker\b/i.test(typeLine(card, deps));
}

function isBattle(card, deps) {
  return /\bBattle\b/i.test(typeLine(card, deps));
}

function isSiege(card, deps) {
  return /\bBattle\b/i.test(typeLine(card, deps)) &&
    /\bSiege\b/i.test(typeLine(card, deps));
}

function activePlayers(room) {
  return room.players.filter(
    (player) => player.game && !player.game.lost && !player.game.conceded
  );
}

function battlefieldEntries(room) {
  return room.players.flatMap((player) =>
    (player.game?.battlefield || []).map((card, index) => ({
      player,
      card,
      index
    }))
  );
}

function controlledCard(room, actor, cardId, deps) {
  const located = deps.findBattlefieldCard(room, String(cardId || ""));
  return located?.card?.controllerId === actor.id ? located : null;
}

function startingLoyalty(card, deps) {
  const face = currentFace(card, deps);
  const value =
    face.loyalty ??
    card?.cardData?.loyalty ??
    card?.loyalty;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function startingDefense(card, deps) {
  const face = currentFace(card, deps);
  const value =
    face.defense ??
    card?.cardData?.defense ??
    card?.defense;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : 0;
}

function loyaltyValue(card) {
  return Math.max(
    0,
    Number(card?.counters?.loyalty ?? card?.loyalty) || 0
  );
}

function defenseValue(card) {
  return Math.max(
    0,
    Number(card?.counters?.defense ?? card?.defense) || 0
  );
}

function setLoyalty(card, value) {
  card.counters = card.counters || {};
  card.counters.loyalty = Math.max(0, Math.floor(Number(value) || 0));
  card.loyalty = card.counters.loyalty;
  return card.counters.loyalty;
}

function setDefense(card, value) {
  card.counters = card.counters || {};
  card.counters.defense = Math.max(0, Math.floor(Number(value) || 0));
  card.defense = card.counters.defense;
  return card.counters.defense;
}

function parseLoyaltyAbilities(card, deps) {
  const text = oracle(card, deps);
  const abilities = [];

  for (const line of text.split(/\n+/)) {
    const match = String(line).match(
      /^\s*([+＋]\s*\d+|[−–—-]\s*\d+|0|[−–—-]\s*X)\s*:\s*(.+)$/i
    );
    if (!match) continue;

    const symbol = match[1]
      .replace(/[＋]/g, "+")
      .replace(/[−–—]/g, "-")
      .replace(/\s+/g, "");
    const effectText = String(match[2] || "").trim();

    let kind = "zero";
    let amount = 0;
    let variable = false;

    if (/^\+/.test(symbol)) {
      kind = "add";
      amount = Number(symbol.slice(1)) || 0;
    } else if (/^-X$/i.test(symbol)) {
      kind = "remove";
      variable = true;
    } else if (/^-/.test(symbol)) {
      kind = "remove";
      amount = Number(symbol.slice(1)) || 0;
    }

    abilities.push({
      index: abilities.length,
      costLabel: symbol,
      kind,
      amount,
      variable,
      text: effectText
    });
  }

  return abilities;
}

function targetRequirement(text) {
  const normalized = String(text || "");
  const occurrences = [...normalized.matchAll(/\btarget\b/gi)].length;
  if (!occurrences) return { minimum: 0, maximum: 0 };

  const upTo = normalized.match(/\bup to (one|two|three|\d+)\s+targets?\b/i);
  if (upTo) {
    const words = { one: 1, two: 2, three: 3 };
    const maximum =
      words[String(upTo[1]).toLowerCase()] ?? Number(upTo[1]) ?? 1;
    return { minimum: 0, maximum: Math.max(1, maximum) };
  }

  return {
    minimum: occurrences,
    maximum: occurrences
  };
}

function targetCandidates(room, controllerId, ability, deps) {
  const text = String(ability?.text || "").toLowerCase();
  const candidates = [];

  const addPlayer = (player) => {
    candidates.push({
      target: `player:${player.id}`,
      kind: "player",
      name: player.name,
      controllerId: player.id
    });
  };

  const addCard = (card, player) => {
    candidates.push({
      target: `card:${card.id}`,
      kind: "card",
      name: card.name,
      controllerId: player.id,
      typeLine: typeLine(card, deps)
    });
  };

  if (/\btarget opponent\b/.test(text)) {
    for (const player of activePlayers(room)) {
      if (player.id !== controllerId) addPlayer(player);
    }
    return candidates;
  }

  if (/\btarget player\b/.test(text)) {
    for (const player of activePlayers(room)) addPlayer(player);
    return candidates;
  }

  const wantsCreature = /\btarget (?:non\w+\s+)?creature\b/.test(text);
  const wantsPermanent = /\btarget (?:non\w+\s+)?permanent\b/.test(text);
  const wantsArtifact = /\btarget (?:non\w+\s+)?artifact\b/.test(text);
  const wantsEnchantment = /\btarget (?:non\w+\s+)?enchantment\b/.test(text);
  const wantsLand = /\btarget (?:non\w+\s+)?land\b/.test(text);
  const wantsPlaneswalker = /\btarget (?:non\w+\s+)?planeswalker\b/.test(text);
  const wantsBattle = /\btarget (?:non\w+\s+)?battle\b/.test(text);
  const ownOnly = /\btarget .+ you control\b/.test(text);
  const opponentOnly = /\btarget .+ an opponent controls\b/.test(text);

  for (const player of room.players) {
    if (!player.game) continue;
    if (ownOnly && player.id !== controllerId) continue;
    if (opponentOnly && player.id === controllerId) continue;

    for (const card of player.game.battlefield || []) {
      const cardType = typeLine(card, deps);
      if (wantsCreature && !deps.isCreatureCard(card)) continue;
      if (wantsPermanent && !cardType) continue;
      if (wantsArtifact && !/\bArtifact\b/i.test(cardType)) continue;
      if (wantsEnchantment && !/\bEnchantment\b/i.test(cardType)) continue;
      if (wantsLand && !/\bLand\b/i.test(cardType)) continue;
      if (wantsPlaneswalker && !isPlaneswalker(card, deps)) continue;
      if (wantsBattle && !isBattle(card, deps)) continue;

      if (
        wantsCreature ||
        wantsPermanent ||
        wantsArtifact ||
        wantsEnchantment ||
        wantsLand ||
        wantsPlaneswalker ||
        wantsBattle
      ) {
        addCard(card, player);
      }
    }
  }

  return candidates;
}

function validateAbilityTargets(room, controllerId, ability, targets, deps) {
  const requirement = targetRequirement(ability.text);
  const selected = unique(targets);

  if (
    selected.length < requirement.minimum ||
    selected.length > requirement.maximum
  ) {
    return {
      success: false,
      error: `Choose between ${requirement.minimum} and ${requirement.maximum} target${
        requirement.maximum === 1 ? "" : "s"
      }.`
    };
  }

  const legal = new Set(
    targetCandidates(room, controllerId, ability, deps)
      .map((entry) => entry.target)
  );

  if (selected.some((target) => !legal.has(target))) {
    return {
      success: false,
      error: "A selected loyalty-ability target is no longer legal."
    };
  }

  return {
    success: true,
    targets: deps.validateTargets(room, selected)
  };
}

function initializePermanent(room, card, controller, deps) {
  if (!card) return;
  card.specialState = card.specialState || {};

  if (isPlaneswalker(card, deps)) {
    if (card.counters?.loyalty == null && card.loyalty == null) {
      setLoyalty(card, startingLoyalty(card, deps));
    } else {
      setLoyalty(card, loyaltyValue(card));
    }
  }

  if (isBattle(card, deps)) {
    if (card.counters?.defense == null && card.defense == null) {
      setDefense(card, startingDefense(card, deps));
    } else {
      setDefense(card, defenseValue(card));
    }
    ensureBattleProtector(room, card, controller, deps);
  }

  card.specialState.initializedV52 = true;
}

function protectorCandidates(room, card, controller, deps) {
  const players = activePlayers(room).filter(
    (player) => player.id !== controller.id
  );

  if (isSiege(card, deps)) return players;

  return players;
}

function battleProtectorId(card) {
  return String(card?.specialState?.battleProtectorIdV52 || "");
}

function createProtectorChoice(room, card, controller, candidates, deps) {
  const existing = normalizeState(room).choices.find(
    (choice) =>
      choice.kind === "battle-protector" &&
      choice.sourceCardId === card.id &&
      choice.status === "open"
  );
  if (existing) return existing;

  const choice = {
    id: deps.createId(),
    status: "open",
    kind: "battle-protector",
    playerId: controller.id,
    sourceCardId: card.id,
    sourceName: card.name,
    createdAt: deps.nowIso(),
    candidateIds: candidates.map((player) => player.id)
  };
  normalizeState(room).choices.push(choice);
  return choice;
}

function ensureBattleProtector(room, card, controller, deps) {
  if (!isBattle(card, deps) || battleProtectorId(card)) return null;

  const candidates = protectorCandidates(room, card, controller, deps);
  if (!candidates.length) return null;

  if (candidates.length === 1 || controller.isBot) {
    const chosen = candidates[0];
    card.specialState = card.specialState || {};
    card.specialState.battleProtectorIdV52 = chosen.id;
    deps.addLog(
      room,
      `${chosen.name} protects ${card.name}.`,
      "battle"
    );
    return null;
  }

  return createProtectorChoice(room, card, controller, candidates, deps);
}

function initializeNewPermanents(room, beforeIds, deps) {
  const before = new Set(beforeIds);
  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      if (!before.has(card.id) || !card.specialState?.initializedV52) {
        initializePermanent(room, card, player, deps);
      }
    }
  }
}

function resolveProtectorChoice(room, actor, action, deps) {
  const state = normalizeState(room);
  const choice = state.choices.find(
    (entry) =>
      entry.id === action?.choiceId &&
      entry.kind === "battle-protector" &&
      entry.status === "open"
  );

  if (!choice) {
    return { success: false, error: "That Battle-protector choice is unavailable." };
  }
  if (choice.playerId !== actor.id && room.hostId !== actor.id) {
    return { success: false, error: "That Battle belongs to another player." };
  }

  const protectorId = String(action?.protectorPlayerId || "");
  if (!choice.candidateIds.includes(protectorId)) {
    return { success: false, error: "Choose a legal Battle protector." };
  }

  const located = deps.findBattlefieldCard(room, choice.sourceCardId);
  const protector = deps.findPlayer(room, protectorId);
  if (!located || !protector?.game) {
    return { success: false, error: "The Battle or protector is no longer available." };
  }

  located.card.specialState = located.card.specialState || {};
  located.card.specialState.battleProtectorIdV52 = protector.id;
  choice.status = "resolved";
  state.choices = state.choices.filter((entry) => entry.status === "open");

  deps.addLog(
    room,
    `${protector.name} protects ${located.card.name}.`,
    "battle"
  );
  return { success: true };
}

function legalPlayerIds(room, attackerId, deps) {
  return deps.legalDefenderIds(room, attackerId)
    .filter((id) => {
      const player = deps.findPlayer(room, id);
      return player?.game && !player.game.lost && !player.game.conceded;
    });
}

function legalAttackTargets(room, actor, deps) {
  const legalPlayers = new Set(legalPlayerIds(room, actor.id, deps));
  const targets = [];

  for (const playerId of legalPlayers) {
    const player = deps.findPlayer(room, playerId);
    targets.push({
      targetKey: `player:${player.id}`,
      kind: "player",
      id: player.id,
      name: player.name,
      defendingPlayerId: player.id,
      controllerId: player.id
    });
  }

  for (const { player, card } of battlefieldEntries(room)) {
    if (isPlaneswalker(card, deps)) {
      if (player.id === actor.id || !legalPlayers.has(player.id)) continue;
      targets.push({
        targetKey: `card:${card.id}`,
        kind: "planeswalker",
        id: card.id,
        name: card.name,
        defendingPlayerId: player.id,
        controllerId: player.id,
        counters: loyaltyValue(card),
        card: deps.publicCard(card)
      });
      continue;
    }

    if (isBattle(card, deps)) {
      const protectorId = battleProtectorId(card);
      if (
        !protectorId ||
        protectorId === actor.id ||
        !legalPlayers.has(protectorId)
      ) {
        continue;
      }

      targets.push({
        targetKey: `card:${card.id}`,
        kind: "battle",
        id: card.id,
        name: card.name,
        defendingPlayerId: protectorId,
        controllerId: player.id,
        protectorId,
        protectorName: deps.findPlayer(room, protectorId)?.name || "Protector",
        counters: defenseValue(card),
        card: deps.publicCard(card)
      });
    }
  }

  return targets;
}

function legalAttacker(room, actor, card, deps) {
  if (!card || card.controllerId !== actor.id) return false;
  if (!deps.isCreatureCard(card) || card.phasedOut || card.tapped) return false;
  if (card.summoningSick && !deps.hasKeyword(card, "haste")) return false;
  if (deps.hasKeyword(card, "defender")) return false;
  if (/\bcan'?t attack\b/i.test(oracle(card, deps))) return false;
  return legalAttackTargets(room, actor, deps).length > 0;
}

function declareAttackTarget(room, actor, action, legacyProcess, deps) {
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  if (room.turn?.activePlayerId !== actor.id || phase !== "Declare Attackers") {
    return {
      success: false,
      error: "Planeswalkers and Battles are attacked during your Declare Attackers step."
    };
  }

  const attacker = controlledCard(room, actor, action?.cardId, deps);
  if (!attacker || !legalAttacker(room, actor, attacker.card, deps)) {
    return { success: false, error: "Choose a creature that can attack." };
  }

  const targetKey = String(action?.targetKey || "");
  const target = legalAttackTargets(room, actor, deps).find(
    (entry) => entry.targetKey === targetKey
  );
  if (!target) return { success: false, error: "Choose a legal attack target." };

  const result = legacyProcess(room, actor, {
    type: "declare-attacker",
    cardId: attacker.card.id,
    defenderPlayerId: target.defendingPlayerId
  });
  if (!result?.success) return result;

  attacker.card.defendingPermanentId =
    target.kind === "player" ? null : target.id;
  attacker.card.specialState = attacker.card.specialState || {};
  attacker.card.specialState.defendingObjectKindV52 = target.kind;

  if (target.kind !== "player") {
    deps.addLog(
      room,
      `${actor.name}'s ${attacker.card.name} is attacking ${target.name}.`,
      "combat"
    );
  }

  return { success: true };
}

function maximumLoyaltyActivations(room, actor, card, deps) {
  let maximum = 1;

  for (const permanent of actor.game.battlefield || []) {
    const text = oracle(permanent, deps);
    if (
      /\bactivate loyalty abilities of planeswalkers you control twice each turn\b/i.test(text)
    ) {
      maximum = Math.max(maximum, 2);
    }
    if (
      /\bactivate loyalty abilities of planeswalkers you control an additional time\b/i.test(text)
    ) {
      maximum += 1;
    }
  }

  maximum += Math.max(
    0,
    Number(actor.game?.extraLoyaltyActivationsV52) || 0
  );
  maximum += Math.max(
    0,
    Number(card.specialState?.extraLoyaltyActivationsV52) || 0
  );
  return Math.max(1, maximum);
}

function loyaltyActivationsThisTurn(card, room) {
  const turn = Number(room.turn?.number) || 0;
  const state = card.specialState?.loyaltyV52;
  return state?.turnNumber === turn
    ? Math.max(0, Number(state.activations) || 0)
    : 0;
}

function loyaltyTimingError(room, actor) {
  const phase = depsPhase(room);
  if (room.turn?.activePlayerId !== actor.id) {
    return "Loyalty abilities can normally be activated only during your turn.";
  }
  if (!["Main 1", "Main 2"].includes(phase)) {
    return "Loyalty abilities require one of your main phases.";
  }
  if (room.stack?.length) {
    return "Loyalty abilities require an empty stack.";
  }
  if (room.priority?.playerId && room.priority.playerId !== actor.id) {
    return "You do not currently have priority.";
  }
  return "";
}

function depsPhase(room) {
  return list(room._v52Phases)[room.turn?.phaseIndex || 0] || "";
}

function payLoyaltyCost(card, ability, action) {
  let amount = ability.amount;
  if (ability.variable) {
    amount = Math.max(0, Math.floor(Number(action?.xValue) || 0));
  }

  const current = loyaltyValue(card);
  if (ability.kind === "remove" && current < amount) {
    return {
      success: false,
      error: `That ability needs ${amount} loyalty, but ${card.name} has ${current}.`
    };
  }

  if (ability.kind === "add") setLoyalty(card, current + amount);
  else if (ability.kind === "remove") setLoyalty(card, current - amount);

  return {
    success: true,
    paidAmount: amount
  };
}

function moveToOwnerGraveyard(room, located, deps) {
  const [card] = located.player.game.battlefield.splice(located.index, 1);
  card.attacking = false;
  card.blockingCardId = null;
  card.defendingPlayerId = null;
  card.defendingPermanentId = null;
  const owner = deps.findPlayer(room, card.ownerId) || located.player;
  if (!card.token) owner.game.graveyard.unshift(card);
  return card;
}

function removeZeroLoyaltyPlaneswalkers(room, deps) {
  const removed = [];
  for (const player of room.players) {
    for (let index = player.game?.battlefield?.length - 1; index >= 0; index -= 1) {
      const card = player.game.battlefield[index];
      if (!isPlaneswalker(card, deps) || loyaltyValue(card) > 0) continue;
      removed.push(
        moveToOwnerGraveyard(
          room,
          { player, card, index, zone: "battlefield" },
          deps
        )
      );
    }
  }

  for (const card of removed) {
    deps.addLog(room, `${card.name} was put into its owner's graveyard with no loyalty.`, "planeswalker");
  }
  return removed;
}

function activateLoyalty(room, actor, action, deps) {
  room._v52Phases = deps.PHASES;
  const timingError = loyaltyTimingError(room, actor);
  if (timingError) return { success: false, error: timingError };

  const located = controlledCard(room, actor, action?.cardId, deps);
  if (!located || !isPlaneswalker(located.card, deps)) {
    return { success: false, error: "Choose a planeswalker you control." };
  }

  const card = located.card;
  const abilities = parseLoyaltyAbilities(card, deps);
  const ability = abilities.find(
    (entry) => entry.index === Number(action?.abilityIndex)
  );
  if (!ability) {
    return { success: false, error: "That loyalty ability is unavailable." };
  }

  const used = loyaltyActivationsThisTurn(card, room);
  const maximum = maximumLoyaltyActivations(room, actor, card, deps);
  if (used >= maximum) {
    return {
      success: false,
      error: `${card.name} has already used all allowed loyalty activations this turn.`
    };
  }

  const targetResult = validateAbilityTargets(
    room,
    actor.id,
    ability,
    action?.targets,
    deps
  );
  if (!targetResult.success) return targetResult;

  const payment = payLoyaltyCost(card, ability, action);
  if (!payment.success) return payment;

  card.specialState = card.specialState || {};
  card.specialState.loyaltyV52 = {
    turnNumber: Number(room.turn?.number) || 0,
    activations: used + 1
  };

  const item = deps.pushStack(
    room,
    {
      kind: "ability",
      name: `${card.name} ${ability.costLabel}`,
      controllerId: actor.id,
      sourceCardId: card.id,
      text: ability.text,
      targets: targetResult.targets,
      effect: null,
      createdAt: deps.nowIso(),
      loyaltyV52: {
        abilityIndex: ability.index,
        costLabel: ability.costLabel,
        paidAmount: payment.paidAmount,
        variable: ability.variable
      }
    },
    actor.id
  );

  if (!item) {
    return { success: false, error: "The loyalty ability could not be placed on the stack." };
  }

  deps.queueSuggestedTriggers(room, "LOYALTY_ABILITY_ACTIVATED", {
    card,
    ability,
    controllerId: actor.id
  });
  deps.resetPriority(room, actor.id);
  deps.addLog(
    room,
    `${actor.name} activated ${card.name}'s ${ability.costLabel} loyalty ability.`,
    "planeswalker"
  );

  removeZeroLoyaltyPlaneswalkers(room, deps);
  return { success: true, stackItemId: item.id };
}

function abilityState(room, actor, card, deps) {
  const abilities = parseLoyaltyAbilities(card, deps);
  const used = loyaltyActivationsThisTurn(card, room);
  const maximum = maximumLoyaltyActivations(room, actor, card, deps);

  return {
    card: deps.publicCard(card),
    loyalty: loyaltyValue(card),
    activationsUsed: used,
    activationsMaximum: maximum,
    abilities: abilities.map((ability) => {
      const candidates = targetCandidates(room, actor.id, ability, deps);
      return {
        ...ability,
        targetRequirement: targetRequirement(ability.text),
        targetCandidates: candidates,
        canPay:
          ability.kind !== "remove" ||
          ability.variable ||
          loyaltyValue(card) >= ability.amount
      };
    })
  };
}

function eligibilityForDamagePass(card, pass, deps) {
  const first = deps.hasKeyword(card, "first strike");
  const double = deps.hasKeyword(card, "double strike");
  return pass === "first" ? first || double : !first || double;
}

function blockersFor(room, attackerId) {
  return battlefieldEntries(room)
    .map((entry) => entry.card)
    .filter((card) => card.blockingCardId === attackerId);
}

function orderedBlockers(room, attacker) {
  const current = blockersFor(room, attacker.id);
  const byId = new Map(current.map((card) => [card.id, card]));
  const ordered = unique(attacker.specialState?.damageOrderV51)
    .map((id) => byId.get(id))
    .filter(Boolean);
  return [
    ...ordered,
    ...current.filter((card) => !ordered.some((entry) => entry.id === card.id))
  ];
}

function power(card, deps) {
  const stats = deps.effectiveStats(card);
  return Math.max(0, Number(stats?.power) || 0);
}

function toughness(card, deps) {
  const stats = deps.effectiveStats(card);
  return Math.max(0, Number(stats?.toughness) || 0);
}

function applyDamageToDefendedPermanent(room, source, target, amount, deps) {
  const damage = Math.max(0, Math.floor(Number(amount) || 0));
  if (!damage) return 0;

  if (isPlaneswalker(target, deps)) {
    setLoyalty(target, loyaltyValue(target) - damage);
    deps.addLog(
      room,
      `${source.name} dealt ${damage} combat damage to ${target.name}; it has ${loyaltyValue(target)} loyalty.`,
      "planeswalker"
    );
    return damage;
  }

  if (isBattle(target, deps)) {
    setDefense(target, defenseValue(target) - damage);
    deps.addLog(
      room,
      `${source.name} dealt ${damage} combat damage to ${target.name}; it has ${defenseValue(target)} defense.`,
      "battle"
    );
    return damage;
  }

  return 0;
}

function permanentTargetAttackers(room) {
  return battlefieldEntries(room)
    .map((entry) => entry.card)
    .filter((card) => card.attacking && card.defendingPermanentId);
}

function validatePermanentMenace(room, attackers, deps) {
  for (const attacker of attackers) {
    if (!deps.hasKeyword(attacker, "menace")) continue;
    if (blockersFor(room, attacker.id).length === 1) {
      return {
        success: false,
        error: `${attacker.name} has menace and must be blocked by at least two creatures.`
      };
    }
  }
  return { success: true };
}

function dealPermanentAttackerDamage(room, attacker, pass, deps) {
  if (!eligibilityForDamagePass(attacker, pass, deps)) return;
  const targetLocated = deps.findBattlefieldCard(
    room,
    String(attacker.defendingPermanentId || "")
  );
  if (!targetLocated || (!isPlaneswalker(targetLocated.card, deps) && !isBattle(targetLocated.card, deps))) {
    return;
  }

  let remaining = power(attacker, deps);
  if (remaining <= 0) return;

  const blockers = orderedBlockers(room, attacker);
  const wasBlocked = Boolean(attacker.specialState?.wasBlockedV51);
  const trample = deps.hasKeyword(attacker, "trample");
  const deathtouch = deps.hasKeyword(attacker, "deathtouch");

  if (blockers.length) {
    blockers.forEach((blocker, index) => {
      if (remaining <= 0) return;
      const lethal = deathtouch
        ? 1
        : Math.max(
            0,
            toughness(blocker, deps) - (Number(blocker.damageMarked) || 0)
          );

      const assigned =
        trample
          ? Math.min(remaining, Math.max(1, lethal))
          : index === blockers.length - 1
            ? remaining
            : Math.min(remaining, Math.max(1, lethal));

      deps.dealCreatureDamage(room, attacker, blocker, assigned);
      remaining -= assigned;
    });

    if (trample && remaining > 0) {
      applyDamageToDefendedPermanent(
        room,
        attacker,
        targetLocated.card,
        remaining,
        deps
      );
    }
    return;
  }

  if (!wasBlocked || trample) {
    applyDamageToDefendedPermanent(
      room,
      attacker,
      targetLocated.card,
      remaining,
      deps
    );
  }
}

function dealPermanentBlockerDamage(room, blocker, pass, deps) {
  if (!blocker.blockingCardId || !eligibilityForDamagePass(blocker, pass, deps)) {
    return;
  }
  const attacker = deps.findBattlefieldCard(room, blocker.blockingCardId)?.card;
  if (!attacker?.attacking || !attacker.defendingPermanentId) return;
  const amount = power(blocker, deps);
  if (amount > 0) deps.dealCreatureDamage(room, blocker, attacker, amount);
}

function defeatBattle(room, located, deps) {
  const [battle] = located.player.game.battlefield.splice(located.index, 1);
  battle.attacking = false;
  battle.blockingCardId = null;
  battle.defendingPlayerId = null;
  battle.defendingPermanentId = null;

  const controller = deps.findPlayer(room, battle.controllerId) || located.player;
  controller.game.exile.unshift(battle);

  const faces = list(battle.cardData?.faces);
  const backFaceIndex = faces.length > 1 ? 1 : -1;
  room.formsV49 =
    room.formsV49 && typeof room.formsV49 === "object"
      ? room.formsV49
      : {};
  room.formsV49.battleChoices = list(room.formsV49.battleChoices);

  if (
    !room.formsV49.battleChoices.some(
      (choice) =>
        choice.status === "open" &&
        choice.battleCardId === battle.id
    )
  ) {
    room.formsV49.battleChoices.push({
      id: deps.createId(),
      status: "open",
      createdAt: deps.nowIso(),
      playerId: battle.controllerId,
      battleCardId: battle.id,
      battleName: battle.name,
      backFaceIndex,
      canCastBackFace: backFaceIndex >= 0,
      backFaceName:
        backFaceIndex >= 0
          ? String(faces[backFaceIndex]?.name || "Back face")
          : ""
    });
  }

  deps.addLog(room, `${battle.name} was defeated and exiled.`, "battle");
  return battle;
}

function handleDefeatedBattles(room, deps) {
  const defeated = [];
  for (const player of room.players) {
    for (let index = player.game?.battlefield?.length - 1; index >= 0; index -= 1) {
      const card = player.game.battlefield[index];
      if (!isBattle(card, deps) || defenseValue(card) > 0) continue;
      defeated.push(
        defeatBattle(
          room,
          { player, card, index, zone: "battlefield" },
          deps
        )
      );
    }
  }
  return defeated;
}

function resolveCombatDamage(room, pass, legacyResolve, deps) {
  const state = normalizeState(room);
  const normalizedPass = pass === "first" ? "first" : "normal";
  const key = `${room.turn?.number || 0}:${normalizedPass}`;
  if (state.damageResolved[key]) {
    state.lastError = "That permanent-target combat damage step was already resolved.";
    return false;
  }

  const permanentAttackers = permanentTargetAttackers(room);
  const menace = validatePermanentMenace(room, permanentAttackers, deps);
  if (!menace.success) {
    state.lastError = menace.error;
    return false;
  }

  if (
    battlefieldEntries(room).some(
      ({ card }) =>
        (card.attacking || card.blockingCardId) &&
        deps.hasKeyword(card, "banding")
    )
  ) {
    state.lastError = "Banding combat requires Judge Mode.";
    return false;
  }

  const hidden = permanentAttackers.map((card) => ({
    card,
    attacking: card.attacking
  }));
  hidden.forEach((entry) => {
    entry.card.attacking = false;
  });

  let legacyResult = true;
  try {
    legacyResult = legacyResolve(room, normalizedPass);
  } finally {
    hidden.forEach((entry) => {
      entry.card.attacking = entry.attacking;
    });
  }

  for (const attacker of permanentAttackers) {
    dealPermanentAttackerDamage(room, attacker, normalizedPass, deps);
  }

  for (const { card: blocker } of battlefieldEntries(room)) {
    dealPermanentBlockerDamage(room, blocker, normalizedPass, deps);
  }

  handleDefeatedBattles(room, deps);
  removeZeroLoyaltyPlaneswalkers(room, deps);
  deps.runStateBasedActions(room, `combat-v52-${normalizedPass}`);
  deps.queueSuggestedTriggers(room, "COMBAT_DAMAGE_TO_PERMANENT", {
    pass: normalizedPass,
    attackerIds: permanentAttackers.map((card) => card.id)
  });

  state.damageResolved[key] = true;
  state.lastError = null;
  return legacyResult !== false || permanentAttackers.length > 0;
}

function damagePermanent(room, actor, action, deps) {
  const located = deps.findBattlefieldCard(
    room,
    String(action?.targetCardId || "")
  );
  if (!located || (!isPlaneswalker(located.card, deps) && !isBattle(located.card, deps))) {
    return {
      success: false,
      error: "Choose a planeswalker or Battle."
    };
  }

  const amount = Math.max(0, Math.floor(Number(action?.amount) || 0));
  const source =
    deps.findBattlefieldCard(room, String(action?.sourceCardId || ""))?.card ||
    { name: actor.name };

  applyDamageToDefendedPermanent(
    room,
    source,
    located.card,
    amount,
    deps
  );
  handleDefeatedBattles(room, deps);
  removeZeroLoyaltyPlaneswalkers(room, deps);
  deps.runStateBasedActions(room, "damage-permanent-v52");
  return { success: true };
}

function clearDefendingPermanentMarkers(room) {
  for (const { card } of battlefieldEntries(room)) {
    if (!card.attacking) card.defendingPermanentId = null;
    if (!card.attacking) {
      card.specialState = card.specialState || {};
      delete card.specialState.defendingObjectKindV52;
    }
  }
}

function pendingForViewer(room, viewerId, deps) {
  const choice = normalizeState(room).choices.find(
    (entry) =>
      entry.status === "open" &&
      (entry.playerId === viewerId || room.hostId === viewerId)
  );

  if (!choice) {
    return { success: true, version: "52.0.0", choice: null };
  }

  return {
    success: true,
    version: "52.0.0",
    choice: {
      ...choice,
      candidates: choice.candidateIds
        .map((id) => deps.findPlayer(room, id))
        .filter((player) => player?.game)
        .map((player) => ({
          id: player.id,
          name: player.name,
          life: player.game.life
        }))
    }
  };
}

function stateForViewer(room, viewerId, deps) {
  room._v52Phases = deps.PHASES;
  const player = deps.findPlayer(room, viewerId);
  if (!player?.game) {
    return {
      success: true,
      version: "52.0.0",
      phase: "",
      legalAttackers: [],
      attackTargets: [],
      planeswalkers: [],
      battles: []
    };
  }

  return {
    success: true,
    version: "52.0.0",
    phase: deps.PHASES[room.turn?.phaseIndex || 0] || "",
    activePlayerId: room.turn?.activePlayerId || null,
    legalAttackers: player.game.battlefield
      .filter((card) => legalAttacker(room, player, card, deps))
      .map(deps.publicCard),
    attackTargets: legalAttackTargets(room, player, deps),
    planeswalkers: player.game.battlefield
      .filter((card) => isPlaneswalker(card, deps))
      .map((card) => abilityState(room, player, card, deps)),
    battles: battlefieldEntries(room)
      .filter(({ card }) => isBattle(card, deps))
      .map(({ player: controller, card }) => ({
        card: deps.publicCard(card),
        controllerId: controller.id,
        controllerName: controller.name,
        protectorId: battleProtectorId(card) || null,
        protectorName:
          deps.findPlayer(room, battleProtectorId(card))?.name || null,
        defense: defenseValue(card)
      })),
    damageResolved: normalizeState(room).damageResolved,
    lastError: normalizeState(room).lastError
  };
}

function processGameAction(room, actor, action, legacyProcess, deps) {
  room._v52Phases = deps.PHASES;
  const type = String(action?.type || "");
  const state = normalizeState(room);

  if (type === "combat-v52-resolve-protector") {
    return resolveProtectorChoice(room, actor, action, deps);
  }
  if (type === "combat-v52-declare-attack") {
    return declareAttackTarget(room, actor, action, legacyProcess, deps);
  }
  if (type === "combat-v52-activate-loyalty") {
    return activateLoyalty(room, actor, action, deps);
  }
  if (type === "combat-v52-damage-permanent") {
    return damagePermanent(room, actor, action, deps);
  }

  if (
    state.choices.length &&
    !["judge-action", "undo-last", "check-state-based"].includes(type)
  ) {
    const waiting = deps.findPlayer(room, state.choices[0].playerId);
    return {
      success: false,
      error: `${waiting?.name || "A player"} must choose a Battle protector.`
    };
  }

  const beforeIds = battlefieldEntries(room).map((entry) => entry.card.id);
  const result = legacyProcess(room, actor, action);
  if (!result?.success) return result;

  initializeNewPermanents(room, beforeIds, deps);

  if (
    ["clear-attacker", "clear-combat", "end-turn", "set-active-player"].includes(type)
  ) {
    clearDefendingPermanentMarkers(room);
  }

  if (type === "next-phase") {
    const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
    if (["End Combat", "Cleanup", "Untap"].includes(phase)) {
      clearDefendingPermanentMarkers(room);
      state.damageResolved = {};
    }
  }

  return result;
}

function afterResolve(room, beforeIds, deps) {
  initializeNewPermanents(room, beforeIds, deps);
  handleDefeatedBattles(room, deps);
  removeZeroLoyaltyPlaneswalkers(room, deps);
}

function summary(room) {
  const state = normalizeState(room);
  return {
    version: "52.0.0",
    pendingProtectorChoices: state.choices.length,
    permanentTargetDamageSteps: Object.keys(state.damageResolved).length,
    lastError: state.lastError
  };
}

function createWalkerBattleEngine(deps) {
  return {
    version: "52.0.0",

    processGameAction(room, actor, action, legacyProcess) {
      return processGameAction(room, actor, action, legacyProcess, deps);
    },

    beforeResolve(room) {
      return battlefieldEntries(room).map((entry) => entry.card.id);
    },

    afterResolve(room, beforeIds) {
      return afterResolve(room, beforeIds, deps);
    },

    resolveCombatDamage(room, pass, legacyResolve) {
      return resolveCombatDamage(room, pass, legacyResolve, deps);
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
        version: "52.0.0",
        automatic: [
          "planeswalker starting loyalty counters",
          "Battle starting defense counters",
          "Siege protector selection as the Battle enters",
          "player, planeswalker and Battle attack targets",
          "Battle protector as defending player",
          "planeswalker controller blocking for attacked planeswalkers",
          "Battle protector blocking for attacked Battles",
          "first strike, double strike, trample and deathtouch against permanent targets",
          "planeswalker combat damage removing loyalty",
          "Battle combat damage removing defense",
          "zero-loyalty planeswalker state handling",
          "defeated-Battle exile and v49 transformed-cast prompt",
          "loyalty ability parsing",
          "loyalty costs paid when activated",
          "sorcery timing and empty-stack loyalty checks",
          "one loyalty activation per planeswalker each turn",
          "basic additional loyalty-activation permissions",
          "basic loyalty target selection"
        ],
        assisted: [
          "variable -X loyalty abilities",
          "loyalty abilities granted by unusual continuous effects",
          "complex multi-target and divided loyalty abilities",
          "non-Siege Battle protector restrictions",
          "planeswalker and Battle damage prevention or redirection",
          "attacks against Battles outside ordinary play-style range",
          "Battle back faces with unusual cast permissions",
          "planeswalker copy and control-change timestamp corner cases"
        ]
      };
    }
  };
}

module.exports = {
  createWalkerBattleEngine,
  _test: {
    isPlaneswalker,
    isBattle,
    isSiege,
    startingLoyalty,
    startingDefense,
    loyaltyValue,
    defenseValue,
    setLoyalty,
    setDefense,
    parseLoyaltyAbilities,
    targetRequirement,
    targetCandidates,
    initializePermanent,
    protectorCandidates,
    battleProtectorId,
    legalAttackTargets,
    legalAttacker,
    maximumLoyaltyActivations,
    loyaltyActivationsThisTurn,
    payLoyaltyCost,
    applyDamageToDefendedPermanent,
    handleDefeatedBattles,
    resolveCombatDamage
  }
};
