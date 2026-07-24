"use strict";

function list(value) {
  return Array.isArray(value) ? value : [];
}

function unique(value) {
  return [...new Set(list(value).map(String).filter(Boolean))];
}

function normalizeState(room) {
  room.triggersV48 =
    room.triggersV48 && typeof room.triggersV48 === "object"
      ? room.triggersV48
      : {};

  const state = room.triggersV48;
  state.batches = list(state.batches)
    .filter((batch) => batch && batch.id && batch.status === "open")
    .slice(-40);
  state.mayChoices = list(state.mayChoices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-40);
  state.delayed = list(state.delayed)
    .filter((entry) => entry && entry.id && entry.status === "waiting")
    .slice(-100);
  state.oncePerTurn =
    state.oncePerTurn && typeof state.oncePerTurn === "object"
      ? state.oncePerTurn
      : {};
  state.eventCounts =
    state.eventCounts && typeof state.eventCounts === "object"
      ? state.eventCounts
      : {};
  state.stackMeta =
    state.stackMeta && typeof state.stackMeta === "object"
      ? state.stackMeta
      : {};
  state.lastError = state.lastError || null;
  return state;
}

function activeOrder(room, deps) {
  const ids = deps.activePlayerIds(room);
  if (!ids.length) return [];
  const activeId = room.turn?.activePlayerId;
  const start = Math.max(0, ids.indexOf(activeId));
  return [...ids.slice(start), ...ids.slice(0, start)];
}

function normalizedText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function triggerNeedsTarget(trigger) {
  return /\btarget(?:s)?\b/i.test(String(trigger?.text || ""));
}

function triggerIsOptional(trigger) {
  const text = String(trigger?.text || "");
  return /\byou may\b/i.test(text) || /\bthat player may\b/i.test(text);
}

function oncePerTurnTrigger(trigger) {
  return /\b(?:only once each turn|only once per turn|triggers only once each turn)\b/i.test(
    String(trigger?.text || "")
  );
}

function conditionClause(trigger) {
  const text = normalizedText(trigger?.text);
  const match = text.match(
    /^(?:when|whenever|at)\b[^,]*,\s*if\s+([^,]+),/i
  );
  return match ? match[1].trim() : "";
}

function cardTypeMatches(card, phrase, deps) {
  const type = String(deps.currentTypeLine(card) || "");
  const lower = String(phrase || "").toLowerCase();

  if (/\bcreature\b/.test(lower) && !/\bCreature\b/i.test(type)) return false;
  if (/\bartifact\b/.test(lower) && !/\bArtifact\b/i.test(type)) return false;
  if (/\benchantment\b/.test(lower) && !/\bEnchantment\b/i.test(type)) return false;
  if (/\bland\b/.test(lower) && !/\bLand\b/i.test(type)) return false;
  if (/\bplaneswalker\b/.test(lower) && !/\bPlaneswalker\b/i.test(type)) return false;
  if (/\btoken\b/.test(lower) && !card.token) return false;
  if (/\bnonland\b/.test(lower) && /\bLand\b/i.test(type)) return false;
  if (/\bnoncreature\b/.test(lower) && /\bCreature\b/i.test(type)) return false;
  return true;
}

function evaluateCondition(room, controllerId, trigger, deps) {
  const clause = conditionClause(trigger);
  if (!clause) return { known: true, result: true, clause: "" };

  const controller = deps.findPlayer(room, controllerId);
  if (!controller?.game) {
    return { known: true, result: false, clause };
  }

  let match = clause.match(
    /^you control (?:a|an|one or more) (.+)$/i
  );
  if (match) {
    return {
      known: true,
      result: controller.game.battlefield.some((card) =>
        cardTypeMatches(card, match[1], deps)
      ),
      clause
    };
  }

  match = clause.match(/^you control no (.+)$/i);
  if (match) {
    return {
      known: true,
      result: !controller.game.battlefield.some((card) =>
        cardTypeMatches(card, match[1], deps)
      ),
      clause
    };
  }

  match = clause.match(/^an opponent controls (?:a|an|one or more) (.+)$/i);
  if (match) {
    return {
      known: true,
      result: room.players.some(
        (player) =>
          player.id !== controllerId &&
          player.game?.battlefield?.some((card) =>
            cardTypeMatches(card, match[1], deps)
          )
      ),
      clause
    };
  }

  match = clause.match(/^your life total is (\d+) or less$/i);
  if (match) {
    return {
      known: true,
      result: Number(controller.game.life) <= Number(match[1]),
      clause
    };
  }

  match = clause.match(/^your life total is (\d+) or greater$/i);
  if (match) {
    return {
      known: true,
      result: Number(controller.game.life) >= Number(match[1]),
      clause
    };
  }

  match = clause.match(/^you have (\d+) or (?:more|greater) cards? in hand$/i);
  if (match) {
    return {
      known: true,
      result: controller.game.hand.length >= Number(match[1]),
      clause
    };
  }

  match = clause.match(/^you have (\d+) or fewer cards? in hand$/i);
  if (match) {
    return {
      known: true,
      result: controller.game.hand.length <= Number(match[1]),
      clause
    };
  }

  return { known: false, result: true, clause };
}

function triggerSnapshot(trigger, context, deps) {
  const condition = evaluateCondition(
    context.room,
    trigger.controllerId,
    trigger,
    deps
  );

  return {
    id: trigger.id,
    controllerId: trigger.controllerId,
    sourceCardId: trigger.sourceCardId || null,
    sourceName: trigger.sourceName || "Triggered ability",
    event: trigger.event || context.event || "Triggered event",
    text: String(trigger.text || ""),
    targets: unique(trigger.targets),
    createdAt: trigger.createdAt || deps.nowIso(),
    optional: triggerIsOptional(trigger),
    oncePerTurn: oncePerTurnTrigger(trigger),
    condition: condition.clause,
    conditionKnown: condition.known,
    needsTargets: triggerNeedsTarget(trigger)
  };
}

function removeQueuedTrigger(room, triggerId) {
  const index = room.triggerQueue.findIndex((trigger) => trigger.id === triggerId);
  if (index >= 0) room.triggerQueue.splice(index, 1);
}

function countEvent(room, event, controllerId) {
  const state = normalizeState(room);
  const turn = String(Number(room.turn?.number) || 0);
  state.eventCounts[turn] =
    state.eventCounts[turn] && typeof state.eventCounts[turn] === "object"
      ? state.eventCounts[turn]
      : {};
  const key = `${event}:${controllerId || "*"}`;
  state.eventCounts[turn][key] =
    (Number(state.eventCounts[turn][key]) || 0) + 1;

  for (const oldTurn of Object.keys(state.eventCounts)) {
    if (Number(oldTurn) < Number(turn) - 2) delete state.eventCounts[oldTurn];
  }
  return state.eventCounts[turn][key];
}

function onceKey(trigger) {
  return `${trigger.sourceCardId || trigger.sourceName}:${normalizedText(
    trigger.text
  ).toLowerCase()}`;
}

function captureSuggested(room, event, addedTriggers, context, deps) {
  const state = normalizeState(room);
  const turnNumber = Number(room.turn?.number) || 0;
  const accepted = [];

  for (const trigger of addedTriggers) {
    countEvent(room, event, trigger.controllerId);

    const snapshot = triggerSnapshot(
      trigger,
      { room, event, context },
      deps
    );

    if (snapshot.oncePerTurn) {
      const key = onceKey(snapshot);
      if (Number(state.oncePerTurn[key]) === turnNumber) {
        removeQueuedTrigger(room, trigger.id);
        deps.addLog(
          room,
          `${snapshot.sourceName}'s once-per-turn trigger was not queued again.`,
          "trigger"
        );
        continue;
      }
      state.oncePerTurn[key] = turnNumber;
    }

    const condition = evaluateCondition(
      room,
      snapshot.controllerId,
      snapshot,
      deps
    );
    if (condition.known && !condition.result) {
      removeQueuedTrigger(room, trigger.id);
      deps.addLog(
        room,
        `${snapshot.sourceName}'s intervening-if condition was not true.`,
        "trigger"
      );
      continue;
    }

    accepted.push(snapshot);
  }

  if (!accepted.length) return null;

  const order = activeOrder(room, deps);
  const groups = order
    .map((playerId) => ({
      playerId,
      triggerIds: accepted
        .filter((trigger) => trigger.controllerId === playerId)
        .map((trigger) => trigger.id),
      status: "open",
      error: null
    }))
    .filter((group) => group.triggerIds.length);

  for (const trigger of accepted) {
    if (!groups.some((group) => group.playerId === trigger.controllerId)) {
      groups.push({
        playerId: trigger.controllerId,
        triggerIds: [trigger.id],
        status: "open",
        error: null
      });
    }
  }

  const batch = {
    id: deps.createId(),
    status: "open",
    event: String(event || "SIMULTANEOUS_TRIGGERS"),
    createdAt: deps.nowIso(),
    turnNumber,
    activePlayerId: room.turn?.activePlayerId || null,
    groups,
    triggers: Object.fromEntries(
      accepted.map((trigger) => [trigger.id, trigger])
    )
  };

  state.batches.push(batch);
  deps.addLog(
    room,
    `${accepted.length} simultaneous trigger${
      accepted.length === 1 ? "" : "s"
    } entered APNAP ordering.`,
    "trigger"
  );
  return batch;
}

function currentBatch(room) {
  return normalizeState(room).batches.find((batch) => batch.status === "open");
}

function currentGroup(batch) {
  return batch?.groups?.find((group) => group.status === "open") || null;
}

function sourceCard(room, trigger, deps) {
  if (!trigger?.sourceCardId) return null;
  return deps.locateCard(room, trigger.sourceCardId)?.card || null;
}

function basicTargetSuggestions(room, trigger, deps) {
  const text = String(trigger?.text || "").toLowerCase();
  const controllerId = trigger.controllerId;
  const suggestions = [];

  if (/\btarget opponent\b/.test(text)) {
    for (const player of room.players) {
      if (
        player.id !== controllerId &&
        player.game &&
        !player.game.lost &&
        !player.game.conceded
      ) {
        suggestions.push(`player:${player.id}`);
      }
    }
    return suggestions;
  }

  if (/\btarget player\b/.test(text)) {
    return room.players
      .filter((player) => player.game && !player.game.lost && !player.game.conceded)
      .map((player) => `player:${player.id}`);
  }

  const own = /\btarget .+ you control\b/.test(text);
  const opponent = /\btarget .+ an opponent controls\b/.test(text);

  for (const player of room.players) {
    if (own && player.id !== controllerId) continue;
    if (opponent && player.id === controllerId) continue;

    for (const card of player.game?.battlefield || []) {
      if (/\btarget creature\b/.test(text) && !deps.isCreatureCard(card)) continue;
      if (
        /\btarget artifact\b/.test(text) &&
        !/\bArtifact\b/i.test(deps.currentTypeLine(card))
      ) {
        continue;
      }
      if (
        /\btarget enchantment\b/.test(text) &&
        !/\bEnchantment\b/i.test(deps.currentTypeLine(card))
      ) {
        continue;
      }
      if (
        /\btarget land\b/.test(text) &&
        !/\bLand\b/i.test(deps.currentTypeLine(card))
      ) {
        continue;
      }
      suggestions.push(`card:${card.id}`);
    }
  }

  return suggestions;
}

function validateOrder(group, orderedTriggerIds) {
  const expected = [...group.triggerIds].sort();
  const received = unique(orderedTriggerIds);
  return (
    expected.length === received.length &&
    expected.every((id, index) => id === [...received].sort()[index])
  );
}

function stackNewItem(room, beforeIds) {
  return [...room.stack]
    .reverse()
    .find((item) => !beforeIds.has(item.id));
}

function moveGroupToStack(
  room,
  group,
  batch,
  orderedTriggerIds,
  targetsByTrigger,
  legacyProcess,
  deps
) {
  if (!validateOrder(group, orderedTriggerIds)) {
    return {
      success: false,
      error: "Every simultaneous trigger must appear exactly once in the order."
    };
  }

  const queueSnapshot = JSON.parse(JSON.stringify(room.triggerQueue));
  const stackSnapshot = JSON.parse(JSON.stringify(room.stack));
  const prioritySnapshot = JSON.parse(JSON.stringify(room.priority));

  const controller = deps.findPlayer(room, group.playerId);
  if (!controller?.game) {
    return { success: false, error: "The trigger controller is unavailable." };
  }

  const state = normalizeState(room);

  for (const triggerId of [...orderedTriggerIds].reverse()) {
    const queued = room.triggerQueue.find((entry) => entry.id === triggerId);
    const meta = batch.triggers[triggerId];
    if (!queued || !meta) {
      room.triggerQueue = queueSnapshot;
      room.stack = stackSnapshot;
      room.priority = prioritySnapshot;
      return {
        success: false,
        error: "A trigger changed before ordering was completed."
      };
    }

    const selectedTargets = unique(targetsByTrigger?.[triggerId]);
    if (selectedTargets.length) queued.targets = selectedTargets;

    const beforeIds = new Set(room.stack.map((item) => item.id));
    const result = legacyProcess(room, controller, {
      type: "trigger-to-stack",
      triggerId,
      targets: queued.targets
    });

    if (!result?.success) {
      room.triggerQueue = queueSnapshot;
      room.stack = stackSnapshot;
      room.priority = prioritySnapshot;
      group.error = result?.error || "The trigger could not move to the stack.";
      state.lastError = group.error;
      return result || { success: false, error: group.error };
    }

    const stackItem = stackNewItem(room, beforeIds);
    if (stackItem) {
      state.stackMeta[stackItem.id] = {
        triggerId,
        controllerId: meta.controllerId,
        sourceCardId: meta.sourceCardId,
        sourceName: meta.sourceName,
        text: meta.text,
        optional: meta.optional,
        condition: meta.condition,
        conditionKnown: meta.conditionKnown,
        accepted: false
      };
    }
  }

  group.status = "resolved";
  group.error = null;
  return { success: true };
}

function autoTargetsForTrigger(room, trigger, deps) {
  if (!trigger.needsTargets || trigger.targets?.length) return trigger.targets || [];
  return basicTargetSuggestions(room, trigger, deps).slice(0, 1);
}

function autoAdvance(room, legacyProcess, deps) {
  let safety = 0;

  while (safety++ < 100) {
    const batch = currentBatch(room);
    if (!batch) return { success: true };

    const group = currentGroup(batch);
    if (!group) {
      batch.status = "resolved";
      normalizeState(room).batches = normalizeState(room).batches.filter(
        (entry) => entry.status === "open"
      );
      deps.resetPriority(room, room.turn?.activePlayerId || null);
      continue;
    }

    const controller = deps.findPlayer(room, group.playerId);
    const triggers = group.triggerIds.map((id) => batch.triggers[id]).filter(Boolean);
    const humanChoiceNeeded =
      !controller?.isBot &&
      (triggers.length > 1 || triggers.some((trigger) => trigger.needsTargets));

    if (humanChoiceNeeded) return { success: true, waiting: true };

    const targetsByTrigger = {};
    for (const trigger of triggers) {
      targetsByTrigger[trigger.id] = autoTargetsForTrigger(room, trigger, deps);
    }

    const result = moveGroupToStack(
      room,
      group,
      batch,
      group.triggerIds,
      targetsByTrigger,
      legacyProcess,
      deps
    );

    if (!result.success) return result;
  }

  return {
    success: false,
    error: "Trigger auto-order exceeded its safety limit."
  };
}

function resolveOrder(
  room,
  actor,
  batchId,
  orderedTriggerIds,
  targetsByTrigger,
  legacyProcess,
  deps
) {
  const batch = currentBatch(room);
  if (!batch || batch.id !== batchId) {
    return { success: false, error: "That trigger batch is no longer available." };
  }

  const group = currentGroup(batch);
  if (!group) return { success: false, error: "The trigger batch is already complete." };
  if (group.playerId !== actor.id && room.hostId !== actor.id) {
    return { success: false, error: "Another player must order these triggers." };
  }

  const result = moveGroupToStack(
    room,
    group,
    batch,
    orderedTriggerIds,
    targetsByTrigger,
    legacyProcess,
    deps
  );
  if (!result.success) return result;

  const advanced = autoAdvance(room, legacyProcess, deps);
  return advanced.success ? { success: true } : advanced;
}

function mayChoiceForStack(room, stackItem, meta, deps) {
  const state = normalizeState(room);
  let choice = state.mayChoices.find(
    (entry) => entry.stackItemId === stackItem.id && entry.status === "open"
  );
  if (choice) return choice;

  choice = {
    id: deps.createId(),
    status: "open",
    createdAt: deps.nowIso(),
    playerId: meta.controllerId,
    stackItemId: stackItem.id,
    sourceName: meta.sourceName,
    text: meta.text
  };
  state.mayChoices.push(choice);
  return choice;
}

function beforeResolve(room, deps) {
  const item = room.stack?.at(-1);
  if (!item) return { handled: false, item: null };

  const state = normalizeState(room);
  const meta = state.stackMeta[item.id];
  if (!meta) return { handled: false, item };

  if (meta.condition) {
    const condition = evaluateCondition(
      room,
      meta.controllerId,
      {
        text: meta.text,
        controllerId: meta.controllerId
      },
      deps
    );

    if (condition.known && !condition.result) {
      room.stack.pop();
      delete state.stackMeta[item.id];
      deps.resetPriority(room, room.turn?.activePlayerId || null);
      deps.addLog(
        room,
        `${meta.sourceName}'s intervening-if condition was no longer true, so the trigger did not resolve.`,
        "trigger"
      );
      return { handled: true, item, result: item };
    }
  }

  if (meta.optional && !meta.accepted) {
    const controller = deps.findPlayer(room, meta.controllerId);
    if (controller?.isBot) {
      meta.accepted = true;
      return { handled: false, item };
    }

    mayChoiceForStack(room, item, meta, deps);
    return { handled: true, item, result: null, waiting: true };
  }

  return { handled: false, item };
}

function resolveMay(
  room,
  actor,
  choiceId,
  useAbility,
  legacyResolve,
  legacyProcess,
  deps
) {
  const state = normalizeState(room);
  const choice = state.mayChoices.find(
    (entry) => entry.id === choiceId && entry.status === "open"
  );
  if (!choice) return { success: false, error: "That optional trigger choice is gone." };
  if (choice.playerId !== actor.id && room.hostId !== actor.id) {
    return { success: false, error: "That optional trigger belongs to another player." };
  }

  const item = room.stack.find((entry) => entry.id === choice.stackItemId);
  if (!item) {
    choice.status = "resolved";
    state.mayChoices = state.mayChoices.filter((entry) => entry.status === "open");
    return { success: true };
  }

  const meta = state.stackMeta[item.id];

  if (!useAbility) {
    const index = room.stack.findIndex((entry) => entry.id === item.id);
    if (index >= 0) room.stack.splice(index, 1);
    delete state.stackMeta[item.id];
    choice.status = "resolved";
    state.mayChoices = state.mayChoices.filter((entry) => entry.status === "open");
    deps.resetPriority(room, room.turn?.activePlayerId || null);
    deps.addLog(
      room,
      `${actor.name} declined ${choice.sourceName}'s optional trigger.`,
      "trigger"
    );
    autoAdvance(room, legacyProcess, deps);
    return { success: true, declined: true };
  }

  if (meta) meta.accepted = true;
  choice.status = "resolved";
  state.mayChoices = state.mayChoices.filter((entry) => entry.status === "open");

  const resolvingItem = room.stack.at(-1);
  const result = legacyResolve(room, actor.name);
  if (!result) return { success: false, error: "The optional trigger could not resolve." };

  delete state.stackMeta[resolvingItem?.id];
  registerDelayedFromItem(room, resolvingItem, deps);
  autoAdvance(room, legacyProcess, deps);
  return { success: true, accepted: true };
}

function phaseIndex(name, deps) {
  return deps.PHASES.findIndex(
    (phase) => phase.toLowerCase() === String(name || "").toLowerCase()
  );
}

function delayedTextAfter(matchText) {
  const comma = String(matchText || "").indexOf(",");
  return comma >= 0
    ? String(matchText).slice(comma + 1).trim()
    : String(matchText).trim();
}

function registerDelayedFromItem(room, item, deps) {
  if (!item) return [];
  const text = normalizedText(item.text || deps.currentOracleText(item.card));
  if (!text) return [];

  const state = normalizeState(room);
  const created = [];
  const currentTurn = Number(room.turn?.number) || 0;
  const currentPhase = Number(room.turn?.phaseIndex) || 0;

  const patterns = [
    {
      regex: /at the beginning of the next end step,\s*([^.]*)/gi,
      phase: "End",
      controllerOnly: false,
      dueTurn:
        currentPhase >= phaseIndex("End", deps)
          ? currentTurn + 1
          : currentTurn
    },
    {
      regex: /at the beginning of your next upkeep,\s*([^.]*)/gi,
      phase: "Upkeep",
      controllerOnly: true,
      dueTurn: currentTurn + 1
    },
    {
      regex: /at the beginning of the next upkeep,\s*([^.]*)/gi,
      phase: "Upkeep",
      controllerOnly: false,
      dueTurn:
        currentPhase >= phaseIndex("Upkeep", deps)
          ? currentTurn + 1
          : currentTurn
    },
    {
      regex: /at the beginning of the next combat,\s*([^.]*)/gi,
      phase: "Beginning Combat",
      controllerOnly: false,
      dueTurn:
        currentPhase >= phaseIndex("Beginning Combat", deps)
          ? currentTurn + 1
          : currentTurn
    }
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      const delayed = {
        id: deps.createId(),
        status: "waiting",
        createdAt: deps.nowIso(),
        controllerId: item.controllerId,
        sourceCardId: item.sourceCardId || null,
        sourceName: item.name || "Delayed trigger",
        phase: pattern.phase,
        controllerOnly: pattern.controllerOnly,
        dueTurn: pattern.dueTurn,
        text: String(match[1] || delayedTextAfter(match[0])).trim()
      };
      state.delayed.push(delayed);
      created.push(delayed);
    }
  }

  return created;
}

function delayedIsDue(room, entry, deps) {
  const currentPhase = deps.PHASES[room.turn?.phaseIndex || 0] || "";
  const turn = Number(room.turn?.number) || 0;

  if (currentPhase !== entry.phase || turn < entry.dueTurn) return false;
  if (
    entry.controllerOnly &&
    room.turn?.activePlayerId !== entry.controllerId
  ) {
    return false;
  }
  return true;
}

function fireDelayedForCurrentPhase(room, deps) {
  const state = normalizeState(room);
  const due = state.delayed.filter((entry) => delayedIsDue(room, entry, deps));
  if (!due.length) return [];

  const added = [];
  for (const entry of due) {
    const trigger = deps.queueTrigger(room, {
      controllerId: entry.controllerId,
      sourceCardId: entry.sourceCardId,
      sourceName: entry.sourceName,
      event: `DELAYED_${entry.phase.toUpperCase().replace(/\s+/g, "_")}`,
      text: entry.text,
      targets: [],
      createdAt: deps.nowIso()
    });
    if (trigger) added.push(trigger);
    entry.status = "fired";
  }

  state.delayed = state.delayed.filter((entry) => entry.status === "waiting");
  if (added.length) {
    captureSuggested(
      room,
      `DELAYED_${(deps.PHASES[room.turn?.phaseIndex || 0] || "PHASE")
        .toUpperCase()
        .replace(/\s+/g, "_")}`,
      added,
      {},
      deps
    );
  }
  return added;
}

function cleanupTurnState(room) {
  const state = normalizeState(room);
  const current = Number(room.turn?.number) || 0;
  for (const [key, turn] of Object.entries(state.oncePerTurn)) {
    if (Number(turn) < current - 1) delete state.oncePerTurn[key];
  }
}

function processGameAction(room, actor, action, legacyProcess, deps) {
  const type = String(action?.type || "");

  if (type === "resolve-trigger-order") {
    return resolveOrder(
      room,
      actor,
      String(action?.batchId || ""),
      action?.orderedTriggerIds,
      action?.targetsByTrigger || {},
      legacyProcess,
      deps
    );
  }

  if (type === "resolve-may-trigger") {
    return {
      success: false,
      error: "Optional triggers must be resolved through the private trigger endpoint."
    };
  }

  const batch = currentBatch(room);
  const mayChoice = normalizeState(room).mayChoices[0];
  if (
    (batch || mayChoice) &&
    !["judge-action", "undo-last", "check-state-based"].includes(type)
  ) {
    const waitingPlayerId =
      currentGroup(batch)?.playerId || mayChoice?.playerId || null;
    const player = deps.findPlayer(room, waitingPlayerId);
    return {
      success: false,
      error: `${player?.name || "A player"} must finish a trigger choice before the game continues.`
    };
  }

  const previousTurn = Number(room.turn?.number) || 0;
  const previousPhase = Number(room.turn?.phaseIndex) || 0;
  const result = legacyProcess(room, actor, action);
  if (!result?.success) return result;

  if (
    previousTurn !== Number(room.turn?.number || 0) ||
    previousPhase !== Number(room.turn?.phaseIndex || 0)
  ) {
    cleanupTurnState(room);
    fireDelayedForCurrentPhase(room, deps);
  }

  const advanced = autoAdvance(room, legacyProcess, deps);
  return advanced.success ? result : advanced;
}

function publicTrigger(trigger, room, deps) {
  const card = sourceCard(room, trigger, deps);
  return {
    ...trigger,
    sourceCard: card ? deps.publicCard(card) : null,
    targetSuggestions: basicTargetSuggestions(room, trigger, deps)
  };
}

function pendingForViewer(room, viewerId, deps) {
  const state = normalizeState(room);
  const batch = currentBatch(room);
  const group = currentGroup(batch);
  const mayChoice = state.mayChoices.find(
    (choice) => choice.playerId === viewerId && choice.status === "open"
  );

  const ordering =
    batch &&
    group &&
    (group.playerId === viewerId || room.hostId === viewerId)
      ? {
          batchId: batch.id,
          event: batch.event,
          activePlayerId: batch.activePlayerId,
          groupPlayerId: group.playerId,
          groupPlayerName:
            deps.findPlayer(room, group.playerId)?.name || "Player",
          apnapPosition:
            batch.groups.findIndex((entry) => entry.playerId === group.playerId) +
            1,
          apnapTotal: batch.groups.length,
          error: group.error,
          triggers: group.triggerIds
            .map((id) => batch.triggers[id])
            .filter(Boolean)
            .map((trigger) => publicTrigger(trigger, room, deps))
        }
      : null;

  return {
    success: true,
    version: "48.0.0",
    ordering,
    mayChoice: mayChoice
      ? {
          id: mayChoice.id,
          sourceName: mayChoice.sourceName,
          text: mayChoice.text,
          stackItemId: mayChoice.stackItemId
        }
      : null
  };
}

function publicSummary(room) {
  const state = normalizeState(room);
  const batch = currentBatch(room);
  return {
    pendingTriggerBatch: batch
      ? {
          id: batch.id,
          event: batch.event,
          playerId: currentGroup(batch)?.playerId || null,
          remainingGroups: batch.groups.filter((group) => group.status === "open")
            .length
        }
      : null,
    pendingMayTriggerCount: state.mayChoices.length,
    delayedTriggerCount: state.delayed.length
  };
}

function createTriggerOrderEngine(deps) {
  return {
    version: "48.0.0",

    captureSuggested(room, event, addedTriggers, context) {
      return captureSuggested(room, event, addedTriggers, context, deps);
    },

    processGameAction(room, actor, action, legacyProcess) {
      return processGameAction(room, actor, action, legacyProcess, deps);
    },

    autoAdvance(room, legacyProcess) {
      return autoAdvance(room, legacyProcess, deps);
    },

    beforeResolve(room) {
      return beforeResolve(room, deps);
    },

    afterResolve(room, item, legacyProcess) {
      const state = normalizeState(room);
      if (item?.id) delete state.stackMeta[item.id];
      registerDelayedFromItem(room, item, deps);
      fireDelayedForCurrentPhase(room, deps);
      return autoAdvance(room, legacyProcess, deps);
    },

    resolveMay(room, actor, choiceId, useAbility, legacyResolve, legacyProcess) {
      return resolveMay(
        room,
        actor,
        choiceId,
        useAbility,
        legacyResolve,
        legacyProcess,
        deps
      );
    },

    pending(room, viewerId) {
      return pendingForViewer(room, viewerId, deps);
    },

    publicSummary(room) {
      return publicSummary(room);
    },

    status() {
      return {
        success: true,
        version: "48.0.0",
        automatic: [
          "simultaneous trigger batching",
          "active-player/nonactive-player ordering",
          "clockwise multiplayer APNAP groups",
          "player-controlled trigger order",
          "reverse stack placement so the chosen first trigger resolves first",
          "single mandatory trigger auto-stacking",
          "basic bot trigger ordering",
          "optional 'you may' trigger prompts at resolution",
          "simple intervening-if checks at creation and resolution",
          "once-per-turn trigger suppression",
          "next end-step delayed triggers",
          "next-upkeep delayed triggers",
          "next-combat delayed triggers",
          "server pause while trigger choices are unresolved"
        ],
        assisted: [
          "intervening-if clauses using complex game values",
          "target selection still uses the v44 targeting engine",
          "trigger ownership changes",
          "secret simultaneous choices",
          "reflexive triggers",
          "nested delayed triggers with unusual timing",
          "manual host resolution when a bot trigger has no legal target"
        ]
      };
    }
  };
}

module.exports = {
  createTriggerOrderEngine,
  _test: {
    activeOrder,
    triggerIsOptional,
    oncePerTurnTrigger,
    conditionClause,
    evaluateCondition,
    captureSuggested,
    currentBatch,
    currentGroup,
    moveGroupToStack,
    autoAdvance,
    beforeResolve,
    resolveMay,
    registerDelayedFromItem,
    fireDelayedForCurrentPhase,
    publicSummary
  }
};
