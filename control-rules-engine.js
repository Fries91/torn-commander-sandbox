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
  room.controlV58 =
    room.controlV58 && typeof room.controlV58 === "object"
      ? room.controlV58
      : {};

  const state = room.controlV58;
  state.effects = list(state.effects)
    .filter((effect) => effect && effect.id && effect.status !== "removed")
    .slice(-250);
  state.registry =
    state.registry && typeof state.registry === "object"
      ? state.registry
      : {};
  state.leaveProcessed =
    state.leaveProcessed && typeof state.leaveProcessed === "object"
      ? state.leaveProcessed
      : {};
  state.history = list(state.history).slice(-300);
  state.timestamp = Math.max(0, Number(state.timestamp) || 0);
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

function activePlayers(room) {
  return room.players.filter(
    (player) =>
      player.game &&
      !player.game.lost &&
      !player.game.conceded
  );
}

function playerById(room, playerId, deps) {
  return deps.findPlayer(room, String(playerId || "")) || null;
}

function battlefieldLocations(room) {
  return room.players.flatMap((player) =>
    (player.game?.battlefield || []).map((card, index) => ({
      player,
      card,
      index,
      zone: "battlefield"
    }))
  );
}

function findBattlefield(room, cardId, deps) {
  return deps.findBattlefieldCard(room, String(cardId || "")) || null;
}

function ensureCardIdentity(room, card, fallbackControllerId) {
  const state = normalizeState(room);
  const existing = state.registry[card.id];

  if (!existing) {
    state.registry[card.id] = {
      cardId: card.id,
      name: card.name,
      ownerId: card.ownerId || fallbackControllerId,
      baseControllerId:
        card.controllerId ||
        fallbackControllerId ||
        card.ownerId,
      registeredAt: new Date().toISOString()
    };
  } else {
    card.ownerId = existing.ownerId;
    existing.name = card.name || existing.name;
  }

  card.ownerId = state.registry[card.id].ownerId;
  card.controllerId =
    card.controllerId ||
    state.registry[card.id].baseControllerId ||
    card.ownerId;

  card.specialState = card.specialState || {};
  card.specialState.ownerLockedV58 =
    state.registry[card.id].ownerId;

  return state.registry[card.id];
}

function ensureRegistry(room) {
  for (const { player, card } of battlefieldLocations(room)) {
    ensureCardIdentity(room, card, player.id);
  }

  for (const player of room.players) {
    if (!player.game) continue;

    for (const zone of [
      "library",
      "hand",
      "graveyard",
      "exile",
      "commandZone"
    ]) {
      for (const card of player.game[zone] || []) {
        const state = normalizeState(room);
        if (!state.registry[card.id]) {
          state.registry[card.id] = {
            cardId: card.id,
            name: card.name,
            ownerId: card.ownerId || player.id,
            baseControllerId: card.ownerId || player.id,
            registeredAt: new Date().toISOString()
          };
        }
        card.ownerId = state.registry[card.id].ownerId;
      }
    }
  }

  return normalizeState(room).registry;
}

function nextTimestamp(room) {
  const state = normalizeState(room);
  state.timestamp += 1;
  return state.timestamp;
}

function removeFromBattlefield(room, cardId) {
  for (const player of room.players) {
    const index = (player.game?.battlefield || []).findIndex(
      (card) => card.id === cardId
    );

    if (index >= 0) {
      const [card] = player.game.battlefield.splice(index, 1);
      return { player, card, index };
    }
  }

  return null;
}

function putOnControllerBattlefield(room, card, controllerId, deps) {
  const controller = playerById(room, controllerId, deps);
  if (!controller?.game) return false;

  const existing = findBattlefield(room, card.id, deps);
  if (existing?.player.id !== controller.id) {
    removeFromBattlefield(room, card.id);
    controller.game.battlefield.unshift(card);
  } else if (!existing) {
    controller.game.battlefield.unshift(card);
  }

  card.controllerId = controller.id;
  return true;
}

function clearCombatState(card) {
  card.attacking = false;
  card.defendingPlayerId = null;
  card.defendingPermanentId = null;
  card.blockingCardId = null;
}

function addTemporaryHaste(card, room, deps) {
  card.temporaryEffects = list(card.temporaryEffects);
  card.temporaryEffects.push({
    id: deps.createId(),
    source: "control-v58",
    keyword: "haste",
    expires: "end-of-turn",
    createdTurn: Number(room.turn?.number) || 0
  });
  card.manualKeywords = unique([
    ...list(card.manualKeywords),
    "Haste"
  ]);
  card.specialState = card.specialState || {};
  card.specialState.hasteFromControlV58 = {
    expiresTurn: Number(room.turn?.number) || 0
  };
}

function activeEffectsFor(room, cardId) {
  return normalizeState(room).effects
    .filter(
      (effect) =>
        effect.status === "active" &&
        effect.targetCardId === cardId
    )
    .sort(
      (first, second) =>
        Number(first.timestamp) - Number(second.timestamp)
    );
}

function sourceDependencyValid(room, effect, deps) {
  if (!effect.sourceCardId) return true;

  const located = findBattlefield(room, effect.sourceCardId, deps);
  if (!located) return false;

  if (
    effect.sourceRequiredControllerId &&
    located.card.controllerId !== effect.sourceRequiredControllerId
  ) {
    return false;
  }

  return true;
}

function effectExpired(room, effect, deps) {
  if (effect.status !== "active") return true;

  if (
    effect.duration === "end-of-turn" &&
    (
      Number(room.turn?.number) >
        Number(effect.createdTurn) ||
      (
        Number(room.turn?.number) ===
          Number(effect.createdTurn) &&
        (deps.PHASES[room.turn?.phaseIndex || 0] || "") === "Cleanup"
      )
    )
  ) {
    return true;
  }

  if (
    effect.duration === "until-turn" &&
    Number(room.turn?.number) >= Number(effect.expiresTurn)
  ) {
    return true;
  }

  if (
    effect.duration === "source" &&
    !sourceDependencyValid(room, effect, deps)
  ) {
    return true;
  }

  const controller = playerById(room, effect.controllerId, deps);
  if (!controller?.game || controller.game.conceded) {
    return true;
  }

  return false;
}

function expireEffects(room, deps) {
  const state = normalizeState(room);
  const affected = new Set();

  for (const effect of state.effects) {
    if (effectExpired(room, effect, deps)) {
      effect.status = "expired";
      affected.add(effect.targetCardId);
      state.history.push({
        id: deps.createId(),
        type: "effect-expired",
        effectId: effect.id,
        targetCardId: effect.targetCardId,
        label: effect.label,
        createdAt: deps.nowIso()
      });
    }
  }

  state.effects = state.effects.filter(
    (effect) => effect.status === "active"
  );

  return affected;
}

function expectedController(room, card, deps) {
  ensureCardIdentity(room, card, card.controllerId || card.ownerId);

  const state = normalizeState(room);
  const registry = state.registry[card.id];
  const effects = activeEffectsFor(room, card.id).filter(
    (effect) => !effectExpired(room, effect, deps)
  );

  const winning = effects.at(-1);
  const desired =
    winning?.controllerId ||
    registry.baseControllerId ||
    registry.ownerId;

  const player = playerById(room, desired, deps);
  if (player?.game && !player.game.conceded) {
    return {
      controllerId: desired,
      effect: winning || null
    };
  }

  return {
    controllerId: registry.ownerId,
    effect: null
  };
}

function recomputeController(room, cardId, deps, reason = "recompute") {
  const located = findBattlefield(room, cardId, deps);
  if (!located) return { success: false, error: "Permanent is unavailable." };

  const card = located.card;
  const previousControllerId = card.controllerId || located.player.id;
  const outcome = expectedController(room, card, deps);

  if (!putOnControllerBattlefield(room, card, outcome.controllerId, deps)) {
    return {
      success: false,
      error: "The expected controller is unavailable."
    };
  }

  if (previousControllerId !== card.controllerId) {
    clearCombatState(card);
    card.summoningSick = deps.isCreatureCard(card);
    card.specialState = card.specialState || {};
    card.specialState.controlledSinceTurnV58 =
      Number(room.turn?.number) || 0;

    deps.queueSuggestedTriggers(room, "CONTROL_CHANGED", {
      card,
      previousControllerId,
      controllerId: card.controllerId,
      reason,
      effectId: outcome.effect?.id || null
    });

    deps.addLog(
      room,
      `${card.name} changed control from ${
        playerById(room, previousControllerId, deps)?.name ||
        previousControllerId
      } to ${
        playerById(room, card.controllerId, deps)?.name ||
        card.controllerId
      }.`,
      "control"
    );
  }

  return {
    success: true,
    controllerId: card.controllerId,
    effectId: outcome.effect?.id || null
  };
}

function recomputeAll(room, deps, reason = "sync") {
  ensureRegistry(room);
  const expiredTargets = expireEffects(room, deps);
  const cardIds = unique([
    ...battlefieldLocations(room).map(({ card }) => card.id),
    ...expiredTargets
  ]);

  for (const cardId of cardIds) {
    if (findBattlefield(room, cardId, deps)) {
      recomputeController(room, cardId, deps, reason);
    }
  }

  cleanAttachments(room);
}

function createEffect(room, actor, targetCard, controllerId, options, deps) {
  ensureCardIdentity(room, targetCard, targetCard.controllerId);

  const controller = playerById(room, controllerId, deps);
  if (!controller?.game || controller.game.conceded) {
    return {
      success: false,
      error: "The new controller is unavailable."
    };
  }

  const duration = [
    "permanent",
    "end-of-turn",
    "until-turn",
    "source"
  ].includes(options?.duration)
    ? options.duration
    : "permanent";

  const effect = {
    id: deps.createId(),
    status: "active",
    targetCardId: targetCard.id,
    targetName: targetCard.name,
    controllerId: controller.id,
    previousControllerId: targetCard.controllerId,
    sourcePlayerId: actor?.id || controller.id,
    sourceCardId: String(options?.sourceCardId || ""),
    sourceRequiredControllerId:
      String(options?.sourceRequiredControllerId || ""),
    duration,
    createdTurn: Number(room.turn?.number) || 0,
    expiresTurn:
      duration === "until-turn"
        ? Math.max(
            Number(room.turn?.number) + 1,
            Number(options?.expiresTurn) ||
              Number(room.turn?.number) + 1
          )
        : null,
    untap: Boolean(options?.untap),
    haste: Boolean(options?.haste),
    automatic: Boolean(options?.automatic),
    linkedExchangeId: options?.linkedExchangeId || null,
    timestamp: nextTimestamp(room),
    label:
      String(options?.label || "")
        .trim()
        .slice(0, 220) ||
      `${controller.name} controls ${targetCard.name}`,
    createdAt: deps.nowIso()
  };

  normalizeState(room).effects.push(effect);

  const result = recomputeController(
    room,
    targetCard.id,
    deps,
    options?.reason || "control effect"
  );

  const current = findBattlefield(room, targetCard.id, deps)?.card;
  if (result.success && current) {
    if (effect.untap) current.tapped = false;
    if (effect.haste) addTemporaryHaste(current, room, deps);
  }

  normalizeState(room).history.push({
    id: deps.createId(),
    type: "control-effect-created",
    effectId: effect.id,
    targetCardId: targetCard.id,
    controllerId: controller.id,
    duration,
    label: effect.label,
    createdAt: deps.nowIso()
  });

  return {
    ...result,
    effectId: effect.id
  };
}

function endEffectsForCard(room, cardId, predicate, deps) {
  const state = normalizeState(room);
  let count = 0;

  for (const effect of state.effects) {
    if (
      effect.targetCardId === cardId &&
      effect.status === "active" &&
      (!predicate || predicate(effect))
    ) {
      effect.status = "removed";
      count += 1;
    }
  }

  state.effects = state.effects.filter(
    (effect) => effect.status === "active"
  );

  if (findBattlefield(room, cardId, deps)) {
    recomputeController(room, cardId, deps, "control effect ended");
  }

  return count;
}

function exchangeControl(room, actor, firstCardId, secondCardId, options, deps) {
  const first = findBattlefield(room, firstCardId, deps);
  const second = findBattlefield(room, secondCardId, deps);

  if (!first || !second || first.card.id === second.card.id) {
    return {
      success: false,
      error: "Choose two different permanents on the battlefield."
    };
  }

  const firstControllerId = first.card.controllerId || first.player.id;
  const secondControllerId = second.card.controllerId || second.player.id;

  if (firstControllerId === secondControllerId) {
    return {
      success: false,
      error: "The permanents must have different controllers."
    };
  }

  if (
    !playerById(room, firstControllerId, deps)?.game ||
    !playerById(room, secondControllerId, deps)?.game
  ) {
    return {
      success: false,
      error: "Both controllers must remain in the game."
    };
  }

  const exchangeId = deps.createId();
  const firstEffect = {
    id: deps.createId(),
    status: "active",
    targetCardId: first.card.id,
    targetName: first.card.name,
    controllerId: secondControllerId,
    previousControllerId: firstControllerId,
    sourcePlayerId: actor?.id || firstControllerId,
    sourceCardId: String(options?.sourceCardId || ""),
    sourceRequiredControllerId: "",
    duration: options?.duration || "permanent",
    createdTurn: Number(room.turn?.number) || 0,
    expiresTurn: null,
    untap: false,
    haste: false,
    automatic: Boolean(options?.automatic),
    linkedExchangeId: exchangeId,
    timestamp: nextTimestamp(room),
    label: `Exchange control of ${first.card.name}`,
    createdAt: deps.nowIso()
  };

  const secondEffect = {
    ...clone(firstEffect),
    id: deps.createId(),
    targetCardId: second.card.id,
    targetName: second.card.name,
    controllerId: firstControllerId,
    previousControllerId: secondControllerId,
    timestamp: nextTimestamp(room),
    label: `Exchange control of ${second.card.name}`
  };

  normalizeState(room).effects.push(firstEffect, secondEffect);

  recomputeController(room, first.card.id, deps, "exchange");
  recomputeController(room, second.card.id, deps, "exchange");

  deps.addLog(
    room,
    `${
      playerById(room, firstControllerId, deps)?.name || firstControllerId
    } and ${
      playerById(room, secondControllerId, deps)?.name || secondControllerId
    } exchanged control of ${first.card.name} and ${second.card.name}.`,
    "control"
  );

  return {
    success: true,
    exchangeId,
    effectIds: [firstEffect.id, secondEffect.id]
  };
}

function staticControlEffects(room, deps) {
  const effects = [];

  for (const { card } of battlefieldLocations(room)) {
    if (!card.attachedToId) continue;

    const text = oracle(card, deps);
    const controlsAttached =
      /\byou control enchanted (?:creature|permanent)\b/i.test(text) ||
      /\byou control equipped creature\b/i.test(text);

    if (!controlsAttached) continue;

    const target = findBattlefield(room, card.attachedToId, deps)?.card;
    if (!target) continue;

    card.specialState = card.specialState || {};
    card.specialState.controlTimestampV58 =
      Number(card.specialState.controlTimestampV58) ||
      nextTimestamp(room);

    effects.push({
      id: `static-control-v58:${card.id}:${target.id}`,
      status: "active",
      targetCardId: target.id,
      targetName: target.name,
      controllerId: card.controllerId,
      previousControllerId: target.controllerId,
      sourcePlayerId: card.controllerId,
      sourceCardId: card.id,
      sourceRequiredControllerId: "",
      duration: "static",
      createdTurn: Number(room.turn?.number) || 0,
      expiresTurn: null,
      untap: false,
      haste: false,
      automatic: true,
      linkedExchangeId: null,
      timestamp: Number(card.specialState.controlTimestampV58),
      label: `${card.name} controls attached ${target.name}`,
      createdAt: deps.nowIso(),
      static: true
    });
  }

  return effects;
}

function syncStaticEffects(room, deps) {
  const state = normalizeState(room);
  const oldTargets = state.effects
    .filter((effect) => effect.static)
    .map((effect) => effect.targetCardId);

  state.effects = state.effects.filter(
    (effect) => !effect.static
  );

  const fresh = staticControlEffects(room, deps);
  state.effects.push(...fresh);

  for (const cardId of unique([
    ...oldTargets,
    ...fresh.map((effect) => effect.targetCardId)
  ])) {
    if (findBattlefield(room, cardId, deps)) {
      recomputeController(room, cardId, deps, "static control effect");
    }
  }
}

function cleanAttachments(room) {
  const battlefieldIds = new Set(
    battlefieldLocations(room).map(({ card }) => card.id)
  );

  for (const { card } of battlefieldLocations(room)) {
    if (
      card.attachedToId &&
      !battlefieldIds.has(card.attachedToId)
    ) {
      card.attachedToId = null;
    }
  }
}

function cardTargets(item) {
  return unique(item?.targets)
    .filter((target) => target.startsWith("card:"))
    .map((target) => target.slice(5));
}

function playerTargets(item) {
  return unique(item?.targets)
    .filter((target) => target.startsWith("player:"))
    .map((target) => target.slice(7));
}

function controlText(item, deps) {
  return [
    String(item?.text || ""),
    item?.card ? oracle(item.card, deps) : ""
  ].filter(Boolean).join("\n");
}

function applyResolvedControlText(room, item, deps) {
  if (!item?.controllerId) return;

  const actor = playerById(room, item.controllerId, deps);
  if (!actor?.game) return;

  const text = controlText(item, deps);
  const cards = cardTargets(item);
  const players = playerTargets(item);

  if (
    /\beach player gains control of all permanents they own\b/i.test(text) ||
    /\beach player gains control of all creatures they own\b/i.test(text)
  ) {
    for (const { card } of battlefieldLocations(room)) {
      const owner = playerById(room, card.ownerId, deps);
      if (!owner) continue;

      endEffectsForCard(room, card.id, null, deps);
      const registry = normalizeState(room).registry[card.id];
      if (registry) registry.baseControllerId = owner.id;
      recomputeController(room, card.id, deps, "return to owner");
    }
    return;
  }

  if (
    /\bexchange control of (?:two target|target .* and target)/i.test(text) ||
    /\bthose players exchange control of those (?:creatures|permanents)\b/i.test(text)
  ) {
    if (cards.length >= 2) {
      exchangeControl(
        room,
        actor,
        cards[0],
        cards[1],
        {
          automatic: true,
          sourceCardId: item.sourceCardId || item.card?.id || ""
        },
        deps
      );
    }
    return;
  }

  if (
    /\btarget opponent gains control of target (?:creature|permanent|artifact|land) you control\b/i.test(text)
  ) {
    const target = findBattlefield(room, cards[0], deps)?.card;
    const receivingPlayer = playerById(room, players[0], deps);

    if (target && receivingPlayer) {
      createEffect(
        room,
        actor,
        target,
        receivingPlayer.id,
        {
          duration: "permanent",
          automatic: true,
          sourceCardId: item.sourceCardId || item.card?.id || "",
          label: `${receivingPlayer.name} gains control of ${target.name}`
        },
        deps
      );
    }
    return;
  }

  const allControlled = text.match(
    /\bgain control of all (creatures|permanents|artifacts|enchantments|lands) target player controls\b/i
  );

  if (allControlled && players[0]) {
    const sourcePlayer = playerById(room, players[0], deps);
    const typePattern = {
      creatures: /\bCreature\b/i,
      permanents: /./,
      artifacts: /\bArtifact\b/i,
      enchantments: /\bEnchantment\b/i,
      lands: /\bLand\b/i
    }[allControlled[1].toLowerCase()];

    for (const card of [...(sourcePlayer?.game?.battlefield || [])]) {
      if (!typePattern.test(typeLine(card, deps))) continue;

      createEffect(
        room,
        actor,
        card,
        actor.id,
        {
          duration: "permanent",
          automatic: true,
          sourceCardId: item.sourceCardId || item.card?.id || "",
          label: `${actor.name} gains control of ${card.name}`
        },
        deps
      );
    }
    return;
  }

  const gainTarget =
    /\bgain control of (?:target (?:creature|permanent|artifact|enchantment|land|planeswalker)|it|that creature|that permanent)\b/i.test(text);

  if (!gainTarget || !cards[0]) return;

  const target = findBattlefield(room, cards[0], deps)?.card;
  if (!target) return;

  const untilEnd =
    /\buntil end of turn\b/i.test(text);
  const sourceDuration =
    /\bfor as long as you control\b/i.test(text);
  const untap =
    /\buntap (?:target creature|target permanent|it|that creature|that permanent)\b/i.test(text);
  const haste =
    /\b(?:it|that creature) gains haste\b/i.test(text);

  createEffect(
    room,
    actor,
    target,
    actor.id,
    {
      duration:
        untilEnd
          ? "end-of-turn"
          : sourceDuration
            ? "source"
            : "permanent",
      sourceCardId:
        item.sourceCardId ||
        item.card?.id ||
        "",
      sourceRequiredControllerId:
        sourceDuration
          ? actor.id
          : "",
      untap,
      haste,
      automatic: true,
      label:
        `${actor.name} gains control of ${target.name}${
          untilEnd ? " until end of turn" : ""
        }`
    },
    deps
  );
}

function removeOwnedCardsFromZone(player, zone, leavingPlayerId, removedIds) {
  if (!Array.isArray(player.game?.[zone])) return;

  player.game[zone] = player.game[zone].filter((card) => {
    if (
      card.ownerId === leavingPlayerId ||
      card.token && card.ownerId === leavingPlayerId
    ) {
      removedIds.add(card.id);
      return false;
    }
    return true;
  });
}

function snapshotPlayers(room) {
  return new Map(
    room.players.map((player) => [
      player.id,
      {
        player,
        conceded: Boolean(player.game?.conceded),
        lost: Boolean(player.game?.lost)
      }
    ])
  );
}

function cleanupLeavingPlayer(room, leavingPlayerId, deps, snapshotPlayer = null) {
  const state = normalizeState(room);
  if (state.leaveProcessed[leavingPlayerId]) {
    return { success: true, alreadyProcessed: true };
  }

  const leaving =
    playerById(room, leavingPlayerId, deps) ||
    snapshotPlayer;

  const removedIds = new Set();
  const affectedTargets = new Set();

  for (const player of room.players) {
    if (!player.game) continue;

    for (const zone of [
      "library",
      "hand",
      "battlefield",
      "graveyard",
      "exile",
      "commandZone"
    ]) {
      removeOwnedCardsFromZone(
        player,
        zone,
        leavingPlayerId,
        removedIds
      );
    }
  }

  if (leaving?.game) {
    for (const zone of [
      "library",
      "hand",
      "battlefield",
      "graveyard",
      "exile",
      "commandZone"
    ]) {
      const remaining = [...(leaving.game[zone] || [])];
      leaving.game[zone] = [];

      for (const card of remaining) {
        if (card.ownerId === leavingPlayerId) {
          removedIds.add(card.id);
          continue;
        }

        const owner = playerById(room, card.ownerId, deps);
        if (!owner?.game) continue;

        if (zone === "battlefield") {
          clearCombatState(card);
          owner.game.battlefield.unshift(card);
          affectedTargets.add(card.id);
        } else {
          owner.game[zone].unshift(card);
        }
      }
    }
  }

  room.stack = list(room.stack).filter((item) => {
    const remove =
      item.controllerId === leavingPlayerId ||
      item.card?.ownerId === leavingPlayerId ||
      item.sourceCardId && removedIds.has(item.sourceCardId);

    if (remove && item.card?.id) removedIds.add(item.card.id);
    return !remove;
  });

  for (const effect of state.effects) {
    if (
      effect.controllerId === leavingPlayerId ||
      effect.sourcePlayerId === leavingPlayerId ||
      removedIds.has(effect.sourceCardId)
    ) {
      effect.status = "removed";
      affectedTargets.add(effect.targetCardId);
    }
  }

  state.effects = state.effects.filter(
    (effect) => effect.status === "active"
  );

  for (const { card } of battlefieldLocations(room)) {
    if (
      card.controllerId === leavingPlayerId ||
      affectedTargets.has(card.id)
    ) {
      affectedTargets.add(card.id);
    }

    if (
      card.attachedToId &&
      removedIds.has(card.attachedToId)
    ) {
      card.attachedToId = null;
    }

    clearCombatState(card);
  }

  for (const cardId of affectedTargets) {
    if (findBattlefield(room, cardId, deps)) {
      recomputeController(
        room,
        cardId,
        deps,
        "player left the game"
      );
    }
  }

  for (const item of room.stack || []) {
    item.targets = unique(item.targets).filter((target) => {
      if (target === `player:${leavingPlayerId}`) return false;
      if (
        target.startsWith("card:") &&
        removedIds.has(target.slice(5))
      ) {
        return false;
      }
      return true;
    });
  }

  state.leaveProcessed[leavingPlayerId] = deps.nowIso();
  state.history.push({
    id: deps.createId(),
    type: "player-left-cleanup",
    playerId: leavingPlayerId,
    removedCardIds: [...removedIds],
    affectedTargetIds: [...affectedTargets],
    createdAt: deps.nowIso()
  });

  deps.addLog(
    room,
    `${leaving?.name || leavingPlayerId}'s owned objects left the game and their control effects ended.`,
    "control"
  );

  cleanAttachments(room);
  return {
    success: true,
    removedCardIds: [...removedIds],
    affectedTargetIds: [...affectedTargets]
  };
}

function detectNewLeavers(room, beforePlayers, action, actor, deps) {
  const beforeIds = new Set(beforePlayers.keys());
  const afterIds = new Set(room.players.map((player) => player.id));

  for (const [playerId, before] of beforePlayers) {
    const after = playerById(room, playerId, deps);
    const removed = !afterIds.has(playerId);
    const newlyConceded =
      !before.conceded &&
      Boolean(after?.game?.conceded);

    if (removed || newlyConceded) {
      cleanupLeavingPlayer(
        room,
        playerId,
        deps,
        before.player
      );
    }
  }

  if (
    ["leave-match", "concede", "leave-room"].includes(String(action?.type || "")) &&
    actor
  ) {
    cleanupLeavingPlayer(
      room,
      actor.id,
      deps,
      beforePlayers.get(actor.id)?.player || actor
    );
  }

  for (const playerId of beforeIds) {
    if (!afterIds.has(playerId)) {
      normalizeState(room).leaveProcessed[playerId] =
        normalizeState(room).leaveProcessed[playerId] || deps.nowIso();
    }
  }
}

function processGameAction(room, actor, action, legacy, deps) {
  ensureRegistry(room);
  syncStaticEffects(room, deps);
  recomputeAll(room, deps, "pre-action");

  const type = String(action?.type || "");

  if (type === "control-v58-gain") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can create manual control effects."
      };
    }

    const target = findBattlefield(room, action?.cardId, deps)?.card;
    if (!target) {
      return { success: false, error: "Choose a permanent." };
    }

    return createEffect(
      room,
      actor,
      target,
      action?.controllerId,
      {
        duration: action?.duration,
        expiresTurn: action?.expiresTurn,
        sourceCardId: action?.sourceCardId,
        sourceRequiredControllerId: action?.sourceRequiredControllerId,
        untap: action?.untap,
        haste: action?.haste,
        automatic: false,
        label: action?.label,
        reason: "manual host control"
      },
      deps
    );
  }

  if (type === "control-v58-exchange") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can create a manual exchange."
      };
    }

    return exchangeControl(
      room,
      actor,
      action?.firstCardId,
      action?.secondCardId,
      {
        duration: "permanent",
        automatic: false
      },
      deps
    );
  }

  if (type === "control-v58-return") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can end control effects manually."
      };
    }

    const count = endEffectsForCard(
      room,
      String(action?.cardId || ""),
      null,
      deps
    );

    return {
      success: true,
      removedEffects: count
    };
  }

  if (type === "control-v58-cleanup-player") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can run leave-game cleanup."
      };
    }

    return cleanupLeavingPlayer(
      room,
      String(action?.playerId || ""),
      deps,
      playerById(room, action?.playerId, deps)
    );
  }

  const beforePlayers = snapshotPlayers(room);
  const result = legacy(room, actor, action);
  if (!result?.success) return result;

  detectNewLeavers(
    room,
    beforePlayers,
    action,
    actor,
    deps
  );

  syncStaticEffects(room, deps);
  recomputeAll(room, deps, "post-action");
  return result;
}

function afterResolve(room, item, result, deps) {
  if (!result) return result;

  ensureRegistry(room);
  applyResolvedControlText(room, item, deps);
  syncStaticEffects(room, deps);
  recomputeAll(room, deps, "stack resolution");
  deps.runStateBasedActions(room, "control-v58");
  return result;
}

function stateForViewer(room, viewerId, deps) {
  ensureRegistry(room);
  syncStaticEffects(room, deps);
  recomputeAll(room, deps, "state");

  const state = normalizeState(room);
  const players = room.players.map((player) => ({
    id: player.id,
    name: player.name,
    lost: Boolean(player.game?.lost),
    conceded: Boolean(player.game?.conceded)
  }));

  const permanents = battlefieldLocations(room).map(({ player, card }) => {
    const registry = state.registry[card.id];
    const owner = playerById(room, registry?.ownerId || card.ownerId, deps);
    const controller = playerById(room, card.controllerId || player.id, deps);
    const effects = activeEffectsFor(room, card.id);

    return {
      card: deps.publicCard(card),
      cardId: card.id,
      name: card.name,
      typeLine: typeLine(card, deps),
      ownerId: registry?.ownerId || card.ownerId,
      ownerName: owner?.name || registry?.ownerId || card.ownerId,
      controllerId: card.controllerId || player.id,
      controllerName: controller?.name || card.controllerId || player.id,
      baseControllerId: registry?.baseControllerId || card.ownerId,
      activeEffects: effects.map((effect) => ({
        id: effect.id,
        controllerId: effect.controllerId,
        controllerName:
          playerById(room, effect.controllerId, deps)?.name ||
          effect.controllerId,
        duration: effect.duration,
        label: effect.label,
        sourceCardId: effect.sourceCardId,
        timestamp: effect.timestamp,
        static: Boolean(effect.static)
      }))
    };
  });

  return {
    success: true,
    version: "58.0.0",
    phase: deps.PHASES[room.turn?.phaseIndex || 0] || "",
    turnNumber: Number(room.turn?.number) || 0,
    isHost: room.hostId === viewerId,
    players,
    permanents,
    effects: state.effects.map((effect) => ({
      ...clone(effect),
      controllerName:
        playerById(room, effect.controllerId, deps)?.name ||
        effect.controllerId
    })),
    history: state.history.slice(-50).reverse(),
    leaveProcessed: clone(state.leaveProcessed)
  };
}

function summary(room, deps) {
  ensureRegistry(room);
  syncStaticEffects(room, deps);
  const state = normalizeState(room);

  return {
    version: "58.0.0",
    registeredObjects: Object.keys(state.registry).length,
    activeControlEffects: state.effects.length,
    controlledByNonOwner: battlefieldLocations(room).filter(
      ({ card }) => card.controllerId !== card.ownerId
    ).length,
    processedLeavingPlayers: Object.keys(state.leaveProcessed).length
  };
}

function createControlRulesEngine(deps) {
  return {
    version: "58.0.0",

    processGameAction(room, actor, action, legacy) {
      return processGameAction(room, actor, action, legacy, deps);
    },

    afterResolve(room, item, result) {
      return afterResolve(room, item, result, deps);
    },

    state(room, viewerId) {
      return stateForViewer(room, viewerId, deps);
    },

    summary(room) {
      return summary(room, deps);
    },

    status() {
      return {
        success: true,
        version: "58.0.0",
        automatic: [
          "immutable ownership tracking across zones and control changes",
          "battlefield cards physically moved to their current controller's battlefield collection",
          "timestamp-ordered chained control-changing effects",
          "reversion to the previous applicable control effect when a newer effect ends",
          "permanent control effects",
          "until-end-of-turn control effects",
          "until-turn control effects",
          "control for as long as a source remains controlled",
          "untap and temporary haste on common steal effects",
          "summoning-sickness reset after control changes",
          "combat-state cleanup after control changes",
          "exchange control of two permanents",
          "common gain-control-of-target wording",
          "common mass gain-control wording",
          "common Donate-style target-opponent wording",
          "common Homeward Path-style return-to-owner wording",
          "You control enchanted creature and permanent static effects",
          "automatic ending of source-dependent and attachment control effects",
          "owned objects leaving the game with their owner",
          "control effects from a leaving player ending",
          "stolen permanents returning through remaining control effects or base control",
          "stack-object and target cleanup when a player leaves",
          "attachment and combat cleanup after a player leaves"
        ],
        assisted: [
          "continuous control effects dependent on complex characteristic conditions",
          "control effects created in earlier layers by copy effects with dependencies",
          "effects that exchange control of players, turns, teams, emblems, or nonpermanent objects",
          "effects that cause a player to control another player",
          "control changes during simultaneous combat damage before all damage events finish",
          "multiplayer range-of-influence and shared-team control rules",
          "cards whose printed wording creates a control effect without common gain-control language",
          "effects that temporarily let another player make decisions without changing control"
        ]
      };
    }
  };
}

module.exports = {
  createControlRulesEngine,
  _test: {
    normalizeState,
    ensureCardIdentity,
    ensureRegistry,
    activeEffectsFor,
    effectExpired,
    expectedController,
    recomputeController,
    recomputeAll,
    createEffect,
    endEffectsForCard,
    exchangeControl,
    staticControlEffects,
    syncStaticEffects,
    applyResolvedControlText,
    cleanupLeavingPlayer,
    detectNewLeavers,
    snapshotPlayers,
    cleanAttachments
  }
};
