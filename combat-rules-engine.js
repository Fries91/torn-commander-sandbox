"use strict";

const COLORS = ["W", "U", "B", "R", "G", "C"];

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function normalizeState(room) {
  room.combatV51 =
    room.combatV51 && typeof room.combatV51 === "object"
      ? room.combatV51
      : {};

  const state = room.combatV51;
  state.choices = list(state.choices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-50);
  state.myriadTokenIds = unique(state.myriadTokenIds).slice(-100);
  state.damageResolved =
    state.damageResolved && typeof state.damageResolved === "object"
      ? state.damageResolved
      : {};
  state.lastCombatTurn = Number(state.lastCombatTurn) || 0;
  state.blockersLocked = Boolean(state.blockersLocked);
  state.lastError = state.lastError || null;
  return state;
}

function oracle(card, deps) {
  return String(deps.currentOracleText(card) || "");
}

function typeLine(card, deps) {
  return String(deps.currentTypeLine(card) || "");
}

function keywordNumber(card, keyword, deps) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = oracle(card, deps).match(
    new RegExp(`\\b${escaped}\\s+(\\d+)\\b`, "i")
  );
  return match ? Math.max(0, Number(match[1])) : 0;
}

function hasKeyword(card, keyword, deps) {
  return Boolean(deps.hasKeyword(card, keyword));
}

function numericPower(card, deps) {
  const stats = deps.effectiveStats(card);
  return stats && Number.isFinite(Number(stats.power))
    ? Math.max(0, Number(stats.power))
    : 0;
}

function numericToughness(card, deps) {
  const stats = deps.effectiveStats(card);
  return stats && Number.isFinite(Number(stats.toughness))
    ? Math.max(0, Number(stats.toughness))
    : 0;
}

function activePlayers(room) {
  return room.players.filter(
    (player) => player.game && !player.game.lost && !player.game.conceded
  );
}

function battlefieldCards(room) {
  return room.players.flatMap((player) =>
    (player.game?.battlefield || []).map((card) => ({ player, card }))
  );
}

function controlledCard(room, actor, cardId, deps) {
  const located = deps.findBattlefieldCard(room, String(cardId || ""));
  return located?.card?.controllerId === actor.id ? located : null;
}

function cleanupExpiredGoad(room) {
  const turn = Number(room.turn?.number) || 0;
  for (const { card } of battlefieldCards(room)) {
    const records = list(card.specialState?.goadedByV51).filter(
      (entry) => Number(entry.expiresTurnNumber) >= turn
    );
    card.specialState = card.specialState || {};
    card.specialState.goadedByV51 = records;
  }
}

function goadRecords(card, room) {
  cleanupExpiredGoad(room);
  return list(card.specialState?.goadedByV51);
}

function legalPlayerDefenders(room, attackerControllerId, card, deps) {
  const base = deps.legalDefenderIds(room, attackerControllerId)
    .filter((id) => id !== attackerControllerId)
    .filter((id) => {
      const player = deps.findPlayer(room, id);
      return player?.game && !player.game.lost && !player.game.conceded;
    });

  const goaders = new Set(goadRecords(card, room).map((entry) => entry.playerId));
  const awayFromGoaders = base.filter((id) => !goaders.has(id));
  return awayFromGoaders.length ? awayFromGoaders : base;
}

function availableAttacker(room, actor, card, deps) {
  if (!card || card.controllerId !== actor.id) return false;
  if (!deps.isCreatureCard(card) || card.phasedOut || card.tapped) return false;
  if (card.summoningSick && !hasKeyword(card, "haste", deps)) return false;
  if (hasKeyword(card, "defender", deps)) return false;
  if (/\bcan'?t attack\b/i.test(oracle(card, deps))) return false;
  return legalPlayerDefenders(room, actor.id, card, deps).length > 0;
}

function blockerCanBlock(blocker, attacker, deps) {
  if (!blocker || !attacker) return { success: false, error: "Missing combat creature." };
  if (!deps.isCreatureCard(blocker) || blocker.phasedOut) {
    return { success: false, error: "Only an available creature can block." };
  }
  if (/\bcan'?t block\b/i.test(oracle(blocker, deps))) {
    return { success: false, error: `${blocker.name} cannot block.` };
  }
  if (/\bcan'?t be blocked\b/i.test(oracle(attacker, deps))) {
    return { success: false, error: `${attacker.name} cannot be blocked.` };
  }

  const attackerFlying = hasKeyword(attacker, "flying", deps);
  const blockerFlying = hasKeyword(blocker, "flying", deps);
  const blockerReach = hasKeyword(blocker, "reach", deps);
  if (attackerFlying && !blockerFlying && !blockerReach) {
    return { success: false, error: "A flying attacker needs flying or reach to block it." };
  }

  const attackerShadow = hasKeyword(attacker, "shadow", deps);
  const blockerShadow = hasKeyword(blocker, "shadow", deps);
  if (attackerShadow !== blockerShadow) {
    return { success: false, error: "Shadow creatures can block only creatures with shadow." };
  }

  return { success: true };
}

function attackers(room, controllerId = null) {
  return battlefieldCards(room)
    .filter(({ card }) => card.attacking)
    .filter(({ card }) => !controllerId || card.controllerId === controllerId);
}

function blockersFor(room, attackerId) {
  return battlefieldCards(room)
    .filter(({ card }) => card.blockingCardId === attackerId)
    .map(({ card }) => card);
}

function markBlocked(attacker) {
  attacker.specialState = attacker.specialState || {};
  attacker.specialState.wasBlockedV51 = true;
}

function orderedBlockers(room, attacker) {
  const current = blockersFor(room, attacker.id);
  const byId = new Map(current.map((card) => [card.id, card]));
  const saved = unique(attacker.specialState?.damageOrderV51)
    .map((id) => byId.get(id))
    .filter(Boolean);
  const missing = current.filter((card) => !saved.some((entry) => entry.id === card.id));
  return [...saved, ...missing];
}

function validateMenace(room, deps) {
  for (const { card: attacker } of attackers(room)) {
    if (!hasKeyword(attacker, "menace", deps)) continue;
    const count = blockersFor(room, attacker.id).length;
    if (count === 1) {
      return {
        success: false,
        error: `${attacker.name} has menace and must be blocked by at least two creatures.`
      };
    }
  }
  return { success: true };
}

function validateGoadAttackRequirements(room, actor, deps) {
  for (const card of actor.game.battlefield || []) {
    const goaded = goadRecords(card, room).length > 0;
    if (!goaded || !availableAttacker(room, actor, card, deps)) continue;
    if (!card.attacking) {
      return {
        success: false,
        error: `${card.name} is goaded and must attack if able.`
      };
    }
    if (!legalPlayerDefenders(room, actor.id, card, deps).includes(card.defendingPlayerId)) {
      return {
        success: false,
        error: `${card.name} must attack a legal player other than its goader if able.`
      };
    }
  }
  return { success: true };
}

function createChoice(room, raw, deps) {
  const choice = {
    id: deps.createId(),
    status: "open",
    createdAt: deps.nowIso(),
    playerId: raw.playerId,
    kind: raw.kind,
    sourceCardId: raw.sourceCardId || null,
    sourceName: raw.sourceName || "Combat ability",
    amount: Math.max(0, Number(raw.amount) || 0),
    candidateIds: unique(raw.candidateIds),
    metadata: raw.metadata || {}
  };
  normalizeState(room).choices.push(choice);
  return choice;
}

function annihilatorOnAttack(room, attacker, deps) {
  const amount = keywordNumber(attacker, "annihilator", deps);
  if (!amount) return null;
  const defender = deps.findPlayer(room, attacker.defendingPlayerId);
  if (!defender?.game) return null;

  const candidates = defender.game.battlefield.map((card) => card.id);
  return createChoice(
    room,
    {
      playerId: defender.id,
      kind: "annihilator",
      sourceCardId: attacker.id,
      sourceName: attacker.name,
      amount: Math.min(amount, candidates.length),
      candidateIds: candidates,
      metadata: { attackerControllerId: attacker.controllerId }
    },
    deps
  );
}

function myriadOnAttack(room, attacker, deps) {
  if (!hasKeyword(attacker, "myriad", deps)) return [];
  const controller = deps.findPlayer(room, attacker.controllerId);
  if (!controller?.game) return [];

  const opponentIds = deps.legalDefenderIds(room, controller.id)
    .filter((id) => id !== attacker.defendingPlayerId)
    .filter((id) => {
      const player = deps.findPlayer(room, id);
      return player?.game && !player.game.lost && !player.game.conceded;
    });

  const created = [];
  const state = normalizeState(room);
  for (const defenderId of opponentIds) {
    const copy = deps.migrateCard(
      {
        ...JSON.parse(JSON.stringify(attacker)),
        id: deps.createId(),
        ownerId: controller.id,
        controllerId: controller.id,
        token: true,
        commander: false,
        attacking: true,
        defendingPlayerId: defenderId,
        blockingCardId: null,
        tapped: true,
        summoningSick: false,
        attachedToId: null,
        damageMarked: 0,
        deathtouchMarked: false,
        copiedFromCardId: attacker.id,
        specialState: {
          ...(attacker.specialState || {}),
          myriadTokenV51: true,
          attackTriggersCreatedV51: true,
          damageOrderV51: []
        }
      },
      controller.id
    );
    controller.game.battlefield.unshift(copy);
    state.myriadTokenIds.push(copy.id);
    created.push(copy);
  }

  if (created.length) {
    deps.addLog(
      room,
      `${attacker.name}'s myriad created ${created.length} attacking token${created.length === 1 ? "" : "s"}.`,
      "combat"
    );
  }
  return created;
}

function createAttackAbilities(room, attacker, deps) {
  attacker.specialState = attacker.specialState || {};
  if (attacker.specialState.attackTriggersCreatedV51) return;
  attacker.specialState.attackTriggersCreatedV51 = true;
  annihilatorOnAttack(room, attacker, deps);
  myriadOnAttack(room, attacker, deps);
}

function clearAttackTriggerMarker(card) {
  card.specialState = card.specialState || {};
  delete card.specialState.attackTriggersCreatedV51;
  delete card.specialState.wasBlockedV51;
  delete card.specialState.damageOrderV51;
}

function cleanupMyriad(room, deps) {
  const state = normalizeState(room);
  const ids = new Set(state.myriadTokenIds);
  for (const player of room.players) {
    for (let index = player.game?.battlefield?.length - 1; index >= 0; index -= 1) {
      const card = player.game.battlefield[index];
      if (ids.has(card.id) || card.specialState?.myriadTokenV51) {
        player.game.battlefield.splice(index, 1);
      }
    }
  }
  state.myriadTokenIds = [];
}

function sacrificePermanent(room, player, cardId, deps) {
  const located = deps.findBattlefieldCard(room, String(cardId || ""));
  if (!located || located.card.controllerId !== player.id) return null;
  const [card] = located.player.game.battlefield.splice(located.index, 1);
  if (!card.token) {
    const owner = deps.findPlayer(room, card.ownerId) || located.player;
    owner.game.graveyard.unshift(card);
  }
  return card;
}

function resolveChoice(room, actor, action, deps) {
  const state = normalizeState(room);
  const choice = state.choices.find(
    (entry) => entry.id === action?.choiceId && entry.status === "open"
  );
  if (!choice) return { success: false, error: "That combat choice is unavailable." };
  if (choice.playerId !== actor.id && room.hostId !== actor.id) {
    return { success: false, error: "That combat choice belongs to another player." };
  }

  if (choice.kind === "annihilator") {
    const required = Math.min(choice.amount, choice.candidateIds.length);
    const selected = unique(action?.cardIds);
    if (selected.length !== required) {
      return {
        success: false,
        error: `Choose exactly ${required} permanent${required === 1 ? "" : "s"} to sacrifice.`
      };
    }
    if (selected.some((id) => !choice.candidateIds.includes(id))) {
      return { success: false, error: "A selected permanent is not legal for Annihilator." };
    }

    for (const cardId of selected) {
      sacrificePermanent(room, actor, cardId, deps);
    }
    deps.addLog(
      room,
      `${actor.name} sacrificed ${selected.length} permanent${selected.length === 1 ? "" : "s"} to annihilator.`,
      "combat"
    );
  } else {
    return { success: false, error: "Unsupported combat choice." };
  }

  choice.status = "resolved";
  state.choices = state.choices.filter((entry) => entry.status === "open");
  return { success: true };
}

function parseNinjutsu(card, deps) {
  const match = oracle(card, deps).match(
    /\b(?:commander )?ninjutsu\s*((?:\{[^}]+\})+)/i
  );
  return match ? { manaCost: match[1] } : null;
}

function parseManaCost(cost) {
  const requirement = { W:0,U:0,B:0,R:0,G:0,C:0,generic:0 };
  for (const match of String(cost || "").matchAll(/\{([^}]+)\}/g)) {
    const symbol = String(match[1] || "").toUpperCase();
    if (/^\\d+$/.test(symbol)) requirement.generic += Number(symbol);
    else if (COLORS.includes(symbol)) requirement[symbol] += 1;
    else if (symbol.includes("/")) {
      const color = symbol.split("/").find((entry) => COLORS.includes(entry));
      if (color) requirement[color] += 1;
      else requirement.generic += 1;
    }
  }
  return requirement;
}

function manaOptions(card, deps) {
  if (!card || card.tapped || card.phasedOut) return [];
  const options = [];
  const type = typeLine(card, deps);
  const text = oracle(card, deps);
  const basics = { Plains:"W", Island:"U", Swamp:"B", Mountain:"R", Forest:"G", Wastes:"C" };
  for (const [basic, color] of Object.entries(basics)) {
    if (new RegExp(`\\b${basic}\\b`, "i").test(type)) options.push(color);
  }
  for (const match of text.matchAll(/\{T\}[^.]*:\s*Add\s+\{([WUBRGC])\}/gi)) {
    options.push(match[1].toUpperCase());
  }
  if (/one mana of any color/i.test(text)) options.push("W", "U", "B", "R", "G");
  return unique(options);
}

function autoPay(room, actor, cost, deps) {
  const snapshot = JSON.parse(JSON.stringify(actor.game));
  const requirement = parseManaCost(cost);
  const used = [];

  function spendPool(color, amount) {
    const available = Number(actor.game.manaPool?.[color]) || 0;
    const paid = Math.min(available, amount);
    actor.game.manaPool[color] = available - paid;
    return amount - paid;
  }

  for (const color of COLORS) requirement[color] = spendPool(color, requirement[color]);

  const sources = (actor.game.battlefield || [])
    .map((card) => ({ card, colors: manaOptions(card, deps) }))
    .filter((entry) => entry.colors.length);

  for (const color of COLORS) {
    while (requirement[color] > 0) {
      const source = sources.find(
        (entry) => !used.includes(entry.card.id) && entry.colors.includes(color)
      );
      if (!source) {
        actor.game = snapshot;
        return { success: false, error: `Could not produce enough ${color} mana.` };
      }
      source.card.tapped = true;
      used.push(source.card.id);
      requirement[color] -= 1;
    }
  }

  let generic = requirement.generic;
  for (const color of COLORS) {
    generic = spendPool(color, generic);
    if (generic <= 0) break;
  }
  while (generic > 0) {
    const source = sources.find((entry) => !used.includes(entry.card.id));
    if (!source) {
      actor.game = snapshot;
      return { success: false, error: "Could not produce enough generic mana." };
    }
    source.card.tapped = true;
    used.push(source.card.id);
    generic -= 1;
  }
  return { success: true };
}

function ninjutsu(room, actor, action, deps) {
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  const allowedPhases = new Set([
    "Declare Blockers", "First-Strike Damage", "Combat Damage", "End Combat"
  ]);
  if (!allowedPhases.has(phase)) {
    return { success: false, error: "Ninjutsu requires an unblocked attacker after blockers are declared." };
  }

  const handIndex = actor.game.hand.findIndex(
    (card) => card.id === String(action?.cardId || "")
  );
  if (handIndex < 0) return { success: false, error: "That Ninja is not in your hand." };
  const ninja = actor.game.hand[handIndex];
  const parsed = parseNinjutsu(ninja, deps);
  if (!parsed) return { success: false, error: "That card has no Ninjutsu ability." };

  const attacker = controlledCard(room, actor, action?.attackerCardId, deps);
  if (!attacker?.card.attacking || blockersFor(room, attacker.card.id).length) {
    return { success: false, error: "Choose an unblocked attacking creature you control." };
  }

  const payment = autoPay(room, actor, parsed.manaCost, deps);
  if (!payment.success) return payment;

  const returning = attacker.card;
  const defenderId = returning.defendingPlayerId;
  attacker.player.game.battlefield.splice(attacker.index, 1);
  returning.attacking = false;
  returning.defendingPlayerId = null;
  returning.blockingCardId = null;
  returning.tapped = false;
  const owner = deps.findPlayer(room, returning.ownerId) || actor;
  owner.game.hand.push(returning);

  actor.game.hand.splice(handIndex, 1);
  ninja.controllerId = actor.id;
  ninja.tapped = true;
  ninja.attacking = true;
  ninja.defendingPlayerId = defenderId;
  ninja.blockingCardId = null;
  ninja.summoningSick = false;
  ninja.specialState = {
    ...(ninja.specialState || {}),
    ninjutsuEnteredV51: true,
    attackTriggersCreatedV51: true
  };
  actor.game.battlefield.unshift(ninja);

  deps.addLog(
    room,
    `${actor.name} used Ninjutsu to return ${returning.name} and put ${ninja.name} onto the battlefield attacking.`,
    "combat"
  );
  deps.resetPriority(room, actor.id);
  return { success: true, ninjaCardId: ninja.id };
}

function eligibleForPass(card, pass, deps) {
  const first = hasKeyword(card, "first strike", deps);
  const double = hasKeyword(card, "double strike", deps);
  return pass === "first" ? first || double : !first || double;
}

function dealAttackerDamage(room, attacker, pass, deps) {
  if (!attacker.attacking || !eligibleForPass(attacker, pass, deps)) return;
  const power = numericPower(attacker, deps);
  if (power <= 0) return;

  const blockers = orderedBlockers(room, attacker);
  const wasBlocked = Boolean(attacker.specialState?.wasBlockedV51);
  const trample = hasKeyword(attacker, "trample", deps);
  const deathtouch = hasKeyword(attacker, "deathtouch", deps);
  let remaining = power;

  if (blockers.length) {
    blockers.forEach((blocker, index) => {
      if (remaining <= 0) return;
      const lethal = deathtouch
        ? 1
        : Math.max(0, numericToughness(blocker, deps) - (Number(blocker.damageMarked) || 0));
      let assigned;
      if (trample) assigned = Math.min(remaining, Math.max(1, lethal));
      else if (index === blockers.length - 1) assigned = remaining;
      else assigned = Math.min(remaining, Math.max(1, lethal));
      deps.dealCreatureDamage(room, attacker, blocker, assigned);
      remaining -= assigned;
    });

    if (trample && remaining > 0) {
      const defender = deps.findPlayer(room, attacker.defendingPlayerId);
      if (defender?.game) deps.dealPlayerDamage(room, attacker, defender, remaining);
    }
    return;
  }

  if (!wasBlocked || trample) {
    const defender = deps.findPlayer(room, attacker.defendingPlayerId);
    if (defender?.game) deps.dealPlayerDamage(room, attacker, defender, remaining);
  }
}

function dealBlockerDamage(room, blocker, pass, deps) {
  if (!blocker.blockingCardId || !eligibleForPass(blocker, pass, deps)) return;
  const attacker = deps.findBattlefieldCard(room, blocker.blockingCardId)?.card;
  if (!attacker?.attacking) return;
  const power = numericPower(blocker, deps);
  if (power > 0) deps.dealCreatureDamage(room, blocker, attacker, power);
}

function resolveCombatDamage(room, pass, deps) {
  const state = normalizeState(room);
  const key = `${room.turn?.number || 0}:${pass}`;
  if (state.damageResolved[key]) return false;

  const menace = validateMenace(room, deps);
  if (!menace.success) {
    state.lastError = menace.error;
    return false;
  }

  if (battlefieldCards(room).some(({ card }) =>
    (card.attacking || card.blockingCardId) && hasKeyword(card, "banding", deps)
  )) {
    state.lastError = "Banding combat requires Judge Mode in v51.";
    return false;
  }

  const attackingCards = attackers(room).map(({ card }) => card);
  const blockingCards = battlefieldCards(room)
    .map(({ card }) => card)
    .filter((card) => card.blockingCardId);

  for (const attacker of attackingCards) dealAttackerDamage(room, attacker, pass, deps);
  for (const blocker of blockingCards) dealBlockerDamage(room, blocker, pass, deps);

  state.damageResolved[key] = true;
  deps.queueSuggestedTriggers(room, "COMBAT_DAMAGE_DEALT", { pass });
  deps.addLog(
    room,
    `${pass === "first" ? "First-strike" : "Regular"} combat damage resolved.`,
    "combat"
  );
  return true;
}

function resetCombatState(room, deps) {
  const state = normalizeState(room);
  cleanupMyriad(room, deps);
  for (const { card } of battlefieldCards(room)) clearAttackTriggerMarker(card);
  state.damageResolved = {};
  state.blockersLocked = false;
  state.lastCombatTurn = Number(room.turn?.number) || 0;
}

function declareAttacker(room, actor, action, legacyProcess, deps) {
  const located = controlledCard(room, actor, action?.cardId, deps);
  if (!located) return { success: false, error: "You do not control that creature." };
  const legal = legalPlayerDefenders(room, actor.id, located.card, deps);
  if (!legal.includes(String(action?.defenderPlayerId || ""))) {
    return { success: false, error: "Choose a legal defending player." };
  }

  const result = legacyProcess(room, actor, action);
  if (!result?.success) return result;
  createAttackAbilities(room, located.card, deps);
  return result;
}

function setDamageOrder(room, actor, action, deps) {
  const located = controlledCard(room, actor, action?.attackerCardId, deps);
  if (!located?.card.attacking) {
    return { success: false, error: "Choose one of your attacking creatures." };
  }
  const current = blockersFor(room, located.card.id).map((card) => card.id).sort();
  const received = unique(action?.blockerIds);
  if (
    current.length !== received.length ||
    current.some((id, index) => id !== [...received].sort()[index])
  ) {
    return { success: false, error: "The blocker order no longer matches combat." };
  }
  located.card.specialState = located.card.specialState || {};
  located.card.specialState.damageOrderV51 = received;
  return { success: true };
}

function goadCreature(room, actor, action, deps) {
  const located = deps.findBattlefieldCard(room, String(action?.cardId || ""));
  if (!located || !deps.isCreatureCard(located.card)) {
    return { success: false, error: "Choose a creature to goad." };
  }
  located.card.specialState = located.card.specialState || {};
  const records = list(located.card.specialState.goadedByV51)
    .filter((entry) => entry.playerId !== actor.id);
  records.push({
    playerId: actor.id,
    expiresTurnNumber: (Number(room.turn?.number) || 0) + Math.max(1, activePlayers(room).length)
  });
  located.card.specialState.goadedByV51 = records;
  deps.addLog(room, `${actor.name} goaded ${located.card.name}.`, "combat");
  return { success: true };
}

function phaseTransitionChecks(room, actor, action, deps) {
  if (action?.type !== "next-phase") return { success: true };
  const phase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  if (phase === "Declare Attackers") {
    return validateGoadAttackRequirements(room, actor, deps);
  }
  if (phase === "Declare Blockers") {
    const menace = validateMenace(room, deps);
    if (menace.success) normalizeState(room).blockersLocked = true;
    return menace;
  }
  return { success: true };
}

function processGameAction(room, actor, action, legacyProcess, deps) {
  const type = String(action?.type || "");
  const state = normalizeState(room);

  if (type === "combat-v51-resolve-choice") {
    return resolveChoice(room, actor, action, deps);
  }
  if (type === "combat-v51-ninjutsu") {
    return ninjutsu(room, actor, action, deps);
  }
  if (type === "combat-v51-set-order") {
    return setDamageOrder(room, actor, action, deps);
  }
  if (type === "combat-v51-goad") {
    return goadCreature(room, actor, action, deps);
  }
  if (type === "combat-v51-resolve-damage") {
    const pass = action?.pass === "first" ? "first" : "normal";
    const resolved = resolveCombatDamage(room, pass, deps);
    return resolved
      ? { success: true }
      : { success: false, error: state.lastError || "Combat damage was already resolved." };
  }

  if (
    state.choices.length &&
    !["judge-action", "undo-last", "check-state-based"].includes(type)
  ) {
    const waiting = deps.findPlayer(room, state.choices[0].playerId);
    return {
      success: false,
      error: `${waiting?.name || "A player"} must finish a combat choice.`
    };
  }

  const transition = phaseTransitionChecks(room, actor, action, deps);
  if (!transition.success) return transition;

  if (type === "declare-attacker") {
    return declareAttacker(room, actor, action, legacyProcess, deps);
  }

  if (type === "block-card") {
    const blocker = controlledCard(room, actor, action?.sourceCardId, deps);
    const attacker = deps.findBattlefieldCard(room, String(action?.targetCardId || ""));
    if (!blocker || !attacker?.card.attacking) {
      return { success: false, error: "Choose a legal blocker and attacker." };
    }
    const legal = blockerCanBlock(blocker.card, attacker.card, deps);
    if (!legal.success) return legal;
    const result = legacyProcess(room, actor, action);
    if (result?.success) markBlocked(attacker.card);
    return result;
  }

  const previousPhase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  const previousTurn = Number(room.turn?.number) || 0;
  const result = legacyProcess(room, actor, action);
  if (!result?.success) return result;

  const nextPhase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  if (previousPhase !== nextPhase || previousTurn !== Number(room.turn?.number || 0)) {
    if (nextPhase === "Beginning Combat") resetCombatState(room, deps);
    if (nextPhase === "End Combat") cleanupMyriad(room, deps);
    if (nextPhase === "Cleanup" || previousTurn !== Number(room.turn?.number || 0)) {
      resetCombatState(room, deps);
      cleanupExpiredGoad(room);
    }
  }
  return result;
}

function stateForPlayer(room, viewerId, deps) {
  const player = deps.findPlayer(room, viewerId);
  if (!player?.game) {
    return { success: true, version: "51.0.0", attackers: [], ninjutsu: [] };
  }

  return {
    success: true,
    version: "51.0.0",
    phase: deps.PHASES[room.turn?.phaseIndex || 0] || "",
    activePlayerId: room.turn?.activePlayerId || null,
    legalAttackers: (player.game.battlefield || [])
      .filter((card) => availableAttacker(room, player, card, deps))
      .map((card) => ({
        card: deps.publicCard(card),
        defenderIds: legalPlayerDefenders(room, player.id, card, deps),
        goadedBy: goadRecords(card, room).map((entry) => entry.playerId)
      })),
    defenders: deps.legalDefenderIds(room, player.id)
      .map((id) => deps.findPlayer(room, id))
      .filter((entry) => entry?.game && !entry.game.lost && !entry.game.conceded)
      .map((entry) => ({ id: entry.id, name: entry.name, life: entry.game.life })),
    attackers: attackers(room).map(({ card }) => ({
      card: deps.publicCard(card),
      defenderId: card.defendingPlayerId,
      blockers: orderedBlockers(room, card).map(deps.publicCard),
      wasBlocked: Boolean(card.specialState?.wasBlockedV51),
      trample: hasKeyword(card, "trample", deps),
      deathtouch: hasKeyword(card, "deathtouch", deps),
      firstStrike: hasKeyword(card, "first strike", deps),
      doubleStrike: hasKeyword(card, "double strike", deps),
      menace: hasKeyword(card, "menace", deps)
    })),
    ninjutsu: (player.game.hand || [])
      .map((card) => {
        const parsed = parseNinjutsu(card, deps);
        return parsed ? { card: deps.publicCard(card), manaCost: parsed.manaCost } : null;
      })
      .filter(Boolean),
    unblockedAttackers: attackers(room, player.id)
      .map(({ card }) => card)
      .filter((card) => blockersFor(room, card.id).length === 0)
      .map(deps.publicCard),
    damageResolved: normalizeState(room).damageResolved,
    blockersLocked: normalizeState(room).blockersLocked,
    lastError: normalizeState(room).lastError
  };
}

function pendingForPlayer(room, viewerId, deps) {
  const choice = normalizeState(room).choices.find(
    (entry) =>
      entry.status === "open" &&
      (entry.playerId === viewerId || room.hostId === viewerId)
  );
  if (!choice) return { success: true, version: "51.0.0", choice: null };

  const player = deps.findPlayer(room, choice.playerId);
  return {
    success: true,
    version: "51.0.0",
    choice: {
      ...choice,
      candidates: choice.candidateIds
        .map((id) => player?.game?.battlefield?.find((card) => card.id === id))
        .filter(Boolean)
        .map(deps.publicCard)
    }
  };
}

function publicSummary(room) {
  const state = normalizeState(room);
  return {
    version: "51.0.0",
    pendingCombatChoices: state.choices.length,
    myriadTokenCount: state.myriadTokenIds.length,
    blockersLocked: state.blockersLocked,
    lastError: state.lastError
  };
}

function createCombatRulesEngine(deps) {
  return {
    version: "51.0.0",

    processGameAction(room, actor, action, legacyProcess) {
      return processGameAction(room, actor, action, legacyProcess, deps);
    },

    resolveCombatDamage(room, pass) {
      return resolveCombatDamage(room, pass === "first" ? "first" : "normal", deps);
    },

    state(room, viewerId) {
      return stateForPlayer(room, viewerId, deps);
    },

    pending(room, viewerId) {
      return pendingForPlayer(room, viewerId, deps);
    },

    summary(room) {
      return publicSummary(room);
    },

    status() {
      return {
        success: true,
        version: "51.0.0",
        automatic: [
          "first-strike combat damage step",
          "double-strike damage in both combat damage steps",
          "menace blocker-count enforcement",
          "flying, reach and shadow block legality",
          "attacker-selected blocker damage order",
          "trample excess damage to the defending player",
          "deathtouch lethal assignment of one damage",
          "blocked-with-no-blocker handling",
          "goad attack and defender requirements",
          "myriad attacking token copies and end-combat cleanup",
          "Ninjutsu from hand using an unblocked attacker",
          "Annihilator permanent-sacrifice prompts",
          "explicit multiplayer defending-player selection",
          "combat-damage trigger event hooks"
        ],
        assisted: [
          "Banding and bands with other",
          "planeswalker and Battle attack targets",
          "damage assignment that intentionally overassigns before later blockers",
          "multiple simultaneous Ninjutsu timing windows",
          "protection-based blocking restrictions with dynamic qualities",
          "combat damage replacement and redirection beyond v45 coverage",
          "Myriad legend-rule and enter-trigger corner cases",
          "Goad durations changed by extra turns or player control changes"
        ]
      };
    }
  };
}

module.exports = {
  createCombatRulesEngine,
  _test: {
    keywordNumber,
    legalPlayerDefenders,
    availableAttacker,
    blockerCanBlock,
    blockersFor,
    orderedBlockers,
    validateMenace,
    validateGoadAttackRequirements,
    annihilatorOnAttack,
    myriadOnAttack,
    parseNinjutsu,
    eligibleForPass,
    dealAttackerDamage,
    dealBlockerDamage,
    resolveCombatDamage,
    setDamageOrder,
    cleanupMyriad
  }
};
