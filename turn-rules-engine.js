"use strict";

const BASE_PHASES = [
  "Untap",
  "Upkeep",
  "Draw",
  "Main 1",
  "Beginning Combat",
  "Declare Attackers",
  "Declare Blockers",
  "First-Strike Damage",
  "Combat Damage",
  "End Combat",
  "Main 2",
  "End",
  "Cleanup"
];

const PHASE_INDEX = Object.fromEntries(
  BASE_PHASES.map((name, index) => [name, index])
);

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
  room.turnV60 =
    room.turnV60 && typeof room.turnV60 === "object"
      ? room.turnV60
      : {};

  const state = room.turnV60;
  state.extraTurns = list(state.extraTurns)
    .filter((entry) => entry && entry.id && entry.status === "queued")
    .slice(-100);
  state.skippedTurns =
    state.skippedTurns && typeof state.skippedTurns === "object"
      ? state.skippedTurns
      : {};
  state.phaseInsertions = list(state.phaseInsertions)
    .filter((entry) => entry && entry.id && entry.status === "queued")
    .slice(-150);
  state.skippedPhases = list(state.skippedPhases)
    .filter((entry) => entry && entry.id && entry.status === "queued")
    .slice(-150);
  state.history = list(state.history).slice(-350);
  state.sequence = Math.max(0, Number(state.sequence) || 0);
  state.turnInstance =
    state.turnInstance && typeof state.turnInstance === "object"
      ? state.turnInstance
      : null;
  state.endedTurn =
    state.endedTurn && typeof state.endedTurn === "object"
      ? state.endedTurn
      : null;
  state.cleanupPasses =
    state.cleanupPasses && typeof state.cleanupPasses === "object"
      ? state.cleanupPasses
      : {};

  for (const player of room.players || []) {
    state.skippedTurns[player.id] =
      Math.max(0, Number(state.skippedTurns[player.id]) || 0);
  }

  return state;
}

function nextSequence(room) {
  const state = normalizeState(room);
  state.sequence += 1;
  return state.sequence;
}

function activePlayers(room) {
  return room.players.filter(
    (player) =>
      player.game &&
      !player.game.lost &&
      !player.game.conceded
  );
}

function findPlayer(room, playerId, deps) {
  return deps.findPlayer(room, String(playerId || "")) || null;
}

function activePlayer(room, deps) {
  return findPlayer(room, room.turn?.activePlayerId, deps);
}

function phaseName(room, deps) {
  return (
    deps.PHASES?.[room.turn?.phaseIndex || 0] ||
    BASE_PHASES[room.turn?.phaseIndex || 0] ||
    ""
  );
}

function normalizedTurnOrder(room) {
  const activeIds = activePlayers(room).map((player) => player.id);
  const configured = list(room.turn?.order).filter((id) => activeIds.includes(id));

  for (const id of activeIds) {
    if (!configured.includes(id)) configured.push(id);
  }

  return configured;
}

function nextNormalPlayerId(room, fromPlayerId) {
  const order = normalizedTurnOrder(room);
  if (!order.length) return null;

  const index = order.indexOf(fromPlayerId);
  if (index < 0) return order[0];

  return order[(index + 1) % order.length];
}

function ensureTurnInstance(room, deps, kind = "normal", sourceId = null) {
  const state = normalizeState(room);
  const playerId = room.turn?.activePlayerId || null;
  const turnNumber = Number(room.turn?.number) || 0;

  if (
    !state.turnInstance ||
    state.turnInstance.turnNumber !== turnNumber ||
    state.turnInstance.playerId !== playerId
  ) {
    state.turnInstance = {
      id: deps.createId(),
      turnNumber,
      playerId,
      kind,
      sourceId,
      startedAt: deps.nowIso()
    };
  }

  return state.turnInstance;
}

function queueExtraTurn(room, playerId, options, deps) {
  const player = findPlayer(room, playerId, deps);
  if (!player?.game || player.game.lost || player.game.conceded) {
    return {
      success: false,
      error: "That player cannot receive an extra turn."
    };
  }

  const amount = Math.max(1, Math.min(20, Number(options?.amount) || 1));
  const created = [];

  for (let index = 0; index < amount; index += 1) {
    const entry = {
      id: deps.createId(),
      status: "queued",
      playerId: player.id,
      sourceCardId: String(options?.sourceCardId || ""),
      sourceName: String(options?.sourceName || "Extra turn").slice(0, 180),
      createdByPlayerId:
        String(options?.createdByPlayerId || player.id),
      createdDuringTurn:
        Number(room.turn?.number) || 0,
      sequence: nextSequence(room),
      createdAt: deps.nowIso()
    };

    normalizeState(room).extraTurns.push(entry);
    created.push(entry);
  }

  deps.addLog(
    room,
    `${player.name} received ${amount} extra turn${amount === 1 ? "" : "s"} after this one.`,
    "turn"
  );

  deps.queueSuggestedTriggers(room, "EXTRA_TURN_CREATED", {
    playerId: player.id,
    amount,
    entries: clone(created)
  });

  return {
    success: true,
    extraTurnIds: created.map((entry) => entry.id)
  };
}

function skipNextTurn(room, playerId, amount, options, deps) {
  const player = findPlayer(room, playerId, deps);
  if (!player) {
    return {
      success: false,
      error: "That player is unavailable."
    };
  }

  const count = Math.max(1, Math.min(20, Number(amount) || 1));
  const state = normalizeState(room);
  state.skippedTurns[player.id] =
    (Number(state.skippedTurns[player.id]) || 0) + count;

  state.history.push({
    id: deps.createId(),
    type: "skip-turn-added",
    playerId: player.id,
    amount: count,
    sourceCardId: String(options?.sourceCardId || ""),
    sourceName: String(options?.sourceName || "Skip turn").slice(0, 180),
    createdAt: deps.nowIso()
  });

  deps.addLog(
    room,
    `${player.name} will skip ${count} upcoming turn${count === 1 ? "" : "s"}.`,
    "turn"
  );

  return {
    success: true,
    skippedTurns: state.skippedTurns[player.id]
  };
}

function phasePath(kind) {
  if (kind === "beginning") return [0, 1, 2];
  if (kind === "upkeep") return [1];
  if (kind === "draw") return [2];
  if (kind === "main") return [10];
  if (kind === "combat") return [4, 5, 6, 7, 8, 9];
  if (kind === "combat-main") return [4, 5, 6, 7, 8, 9, 10];
  if (kind === "end") return [11];
  return [];
}

function queueAdditionalPhase(room, playerId, kind, options, deps) {
  const player = findPlayer(room, playerId, deps);
  const path = phasePath(kind);

  if (!player || !path.length) {
    return {
      success: false,
      error: "Choose a supported player and phase sequence."
    };
  }

  const anchorPhaseIndex =
    Number.isInteger(Number(options?.anchorPhaseIndex))
      ? Math.max(0, Math.min(12, Number(options.anchorPhaseIndex)))
      : Number(room.turn?.phaseIndex) || 0;

  const amount = Math.max(1, Math.min(12, Number(options?.amount) || 1));
  const created = [];

  for (let index = 0; index < amount; index += 1) {
    const entry = {
      id: deps.createId(),
      status: "queued",
      playerId: player.id,
      turnNumber: Number(room.turn?.number) || 0,
      anchorPhaseIndex,
      kind,
      path: [...path],
      sequence: nextSequence(room),
      sourceCardId: String(options?.sourceCardId || ""),
      sourceName: String(options?.sourceName || "Additional phase").slice(0, 180),
      createdAt: deps.nowIso()
    };

    normalizeState(room).phaseInsertions.push(entry);
    created.push(entry);
  }

  deps.addLog(
    room,
    `${amount} additional ${kind.replace("-", " ")} phase sequence${amount === 1 ? "" : "s"} were added to ${player.name}'s turn.`,
    "turn"
  );

  return {
    success: true,
    insertionIds: created.map((entry) => entry.id)
  };
}

function queueSkipPhase(room, playerId, phase, amount, options, deps) {
  const player = findPlayer(room, playerId, deps);
  const index =
    typeof phase === "number"
      ? phase
      : PHASE_INDEX[String(phase || "")];

  if (!player || !Number.isInteger(index) || index < 0 || index > 12) {
    return {
      success: false,
      error: "Choose a valid player and phase or step."
    };
  }

  const count = Math.max(1, Math.min(20, Number(amount) || 1));
  const created = [];

  for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
    const entry = {
      id: deps.createId(),
      status: "queued",
      playerId: player.id,
      phaseIndex: index,
      phaseName: BASE_PHASES[index],
      notBeforeTurn:
        Math.max(
          Number(room.turn?.number) || 0,
          Number(options?.notBeforeTurn) ||
            Number(room.turn?.number) ||
            0
        ),
      sequence: nextSequence(room),
      sourceCardId: String(options?.sourceCardId || ""),
      sourceName: String(options?.sourceName || "Skip phase").slice(0, 180),
      createdAt: deps.nowIso()
    };

    normalizeState(room).skippedPhases.push(entry);
    created.push(entry);
  }

  deps.addLog(
    room,
    `${player.name} will skip ${count} ${BASE_PHASES[index]} step${count === 1 ? "" : "s"}.`,
    "turn"
  );

  return {
    success: true,
    skipIds: created.map((entry) => entry.id)
  };
}

function pendingInsertion(room) {
  const state = normalizeState(room);
  const turnNumber = Number(room.turn?.number) || 0;
  const playerId = room.turn?.activePlayerId;
  const anchor = Number(room.turn?.phaseIndex) || 0;

  const candidates = state.phaseInsertions
    .filter(
      (entry) =>
        entry.status === "queued" &&
        entry.playerId === playerId &&
        entry.turnNumber === turnNumber &&
        entry.anchorPhaseIndex === anchor
    )
    .sort((first, second) => Number(second.sequence) - Number(first.sequence));

  return candidates[0] || null;
}

function skipEntryFor(room, playerId, phaseIndex) {
  const turnNumber = Number(room.turn?.number) || 0;

  return normalizeState(room).skippedPhases
    .filter(
      (entry) =>
        entry.status === "queued" &&
        entry.playerId === playerId &&
        entry.phaseIndex === phaseIndex &&
        Number(entry.notBeforeTurn) <= turnNumber
    )
    .sort((first, second) => Number(first.sequence) - Number(second.sequence))[0] || null;
}

function consumeSkip(room, entry, deps) {
  if (!entry) return;
  entry.status = "consumed";

  const state = normalizeState(room);
  state.history.push({
    id: deps.createId(),
    type: "phase-skipped",
    playerId: entry.playerId,
    phaseIndex: entry.phaseIndex,
    phaseName: entry.phaseName,
    sourceName: entry.sourceName,
    createdAt: deps.nowIso()
  });

  state.skippedPhases = state.skippedPhases.filter(
    (candidate) => candidate.status === "queued"
  );
}

function resetForPhase(room, playerId, deps) {
  deps.clearMana(room);
  deps.resetPriority(room, playerId);
  deps.resetTurnDeadline(room);
}

function beginInsertedPhase(room, insertion, deps) {
  insertion.status = "consumed";
  normalizeState(room).phaseInsertions =
    normalizeState(room).phaseInsertions.filter(
      (entry) => entry.status === "queued"
    );

  const firstIndex = insertion.path[0];
  room.turn.phaseIndex = firstIndex;

  if (firstIndex === 0) {
    const player = findPlayer(room, insertion.playerId, deps);
    for (const card of player?.game?.battlefield || []) {
      card.tapped = false;
    }
  }

  resetForPhase(room, insertion.playerId, deps);

  const state = normalizeState(room);
  state.turnInstance = {
    ...(ensureTurnInstance(room, deps)),
    insertedPhase: {
      insertionId: insertion.id,
      kind: insertion.kind,
      path: [...insertion.path],
      startedAt: deps.nowIso()
    }
  };

  state.history.push({
    id: deps.createId(),
    type: "additional-phase-started",
    insertionId: insertion.id,
    playerId: insertion.playerId,
    kind: insertion.kind,
    phaseIndex: firstIndex,
    createdAt: deps.nowIso()
  });

  deps.queueSuggestedTriggers(room, "ADDITIONAL_PHASE_STARTED", {
    playerId: insertion.playerId,
    kind: insertion.kind,
    phaseIndex: firstIndex
  });

  deps.addLog(
    room,
    `${findPlayer(room, insertion.playerId, deps)?.name || "The active player"} began an additional ${insertion.kind.replace("-", " ")} phase sequence.`,
    "turn"
  );

  return {
    success: true,
    phaseIndex: firstIndex,
    inserted: true
  };
}

function nextUnskippedPhase(room, startIndex, deps) {
  const playerId = room.turn?.activePlayerId;
  let index = startIndex;

  while (index <= 12) {
    const skip = skipEntryFor(room, playerId, index);
    if (!skip) break;
    consumeSkip(room, skip, deps);
    index += 1;
  }

  return index;
}

function customNextPhase(room, actor, deps) {
  if (room.status !== "started" || !room.turn) {
    return {
      success: false,
      error: "The game has not started."
    };
  }

  if (room.turn.activePlayerId !== actor.id) {
    return {
      success: false,
      error: "Only the active player can advance the phase."
    };
  }

  if (room.stack?.length) {
    return {
      success: false,
      error: "Resolve the stack before advancing."
    };
  }

  if (
    room.priority?.playerId &&
    room.priority.playerId !== actor.id
  ) {
    return {
      success: false,
      error: "Wait until you have priority."
    };
  }

  const insertion = pendingInsertion(room);
  if (insertion) {
    return beginInsertedPhase(room, insertion, deps);
  }

  const current = Number(room.turn.phaseIndex) || 0;
  if (current >= 12) {
    deps.advanceTurn(room);
    return {
      success: true,
      endedTurn: true
    };
  }

  let next = nextUnskippedPhase(room, current + 1, deps);

  if (next > 12) {
    deps.advanceTurn(room);
    return {
      success: true,
      endedTurn: true
    };
  }

  room.turn.phaseIndex = next;
  resetForPhase(room, actor.id, deps);

  normalizeState(room).history.push({
    id: deps.createId(),
    type: "phase-advanced",
    playerId: actor.id,
    phaseIndex: next,
    phaseName: BASE_PHASES[next],
    createdAt: deps.nowIso()
  });

  return {
    success: true,
    phaseIndex: next,
    phaseName: BASE_PHASES[next]
  };
}

function popExtraTurn(room, deps) {
  const state = normalizeState(room);

  while (state.extraTurns.length) {
    const entry = [...state.extraTurns]
      .sort((first, second) => Number(second.sequence) - Number(first.sequence))[0];

    state.extraTurns = state.extraTurns.filter(
      (candidate) => candidate.id !== entry.id
    );

    const player = findPlayer(room, entry.playerId, deps);
    if (
      player?.game &&
      !player.game.lost &&
      !player.game.conceded
    ) {
      entry.status = "consumed";
      return entry;
    }
  }

  return null;
}

function chooseNextTurn(room, currentPlayerId, deps) {
  const state = normalizeState(room);

  for (let guard = 0; guard < 100; guard += 1) {
    const extra = popExtraTurn(room, deps);

    if (extra) {
      const skipped = Number(state.skippedTurns[extra.playerId]) || 0;

      if (skipped > 0) {
        state.skippedTurns[extra.playerId] = skipped - 1;
        state.history.push({
          id: deps.createId(),
          type: "extra-turn-skipped",
          playerId: extra.playerId,
          extraTurnId: extra.id,
          createdAt: deps.nowIso()
        });
        continue;
      }

      return {
        playerId: extra.playerId,
        kind: "extra",
        sourceId: extra.id,
        sourceName: extra.sourceName
      };
    }

    const nextId = nextNormalPlayerId(room, currentPlayerId);
    if (!nextId) return null;

    const skipped = Number(state.skippedTurns[nextId]) || 0;
    if (skipped > 0) {
      state.skippedTurns[nextId] = skipped - 1;
      state.history.push({
        id: deps.createId(),
        type: "normal-turn-skipped",
        playerId: nextId,
        createdAt: deps.nowIso()
      });
      deps.addLog(
        room,
        `${findPlayer(room, nextId, deps)?.name || "A player"} skipped their turn.`,
        "turn"
      );
      currentPlayerId = nextId;
      continue;
    }

    return {
      playerId: nextId,
      kind: "normal",
      sourceId: null,
      sourceName: ""
    };
  }

  return null;
}

function advanceTurn(room, legacy, deps) {
  const active = activePlayers(room);
  if (!active.length || !room.turn) return;

  const previousPlayerId = room.turn.activePlayerId;
  const choice = chooseNextTurn(room, previousPlayerId, deps);

  if (!choice) {
    return legacy(room);
  }

  deps.clearCombat(room);
  deps.clearDamage(room);
  deps.clearMana(room);
  deps.expireEndOfTurnEffects(room);

  const next = findPlayer(room, choice.playerId, deps);
  if (!next?.game) {
    return legacy(room);
  }

  room.turn.activePlayerId = next.id;
  room.turn.phaseIndex = nextUnskippedPhase(room, 0, deps);
  room.turn.number = (Number(room.turn.number) || 0) + 1;

  for (const card of next.game.battlefield || []) {
    card.tapped = false;
    card.summoningSick = false;
  }

  deps.resetPriority(room, next.id);
  deps.resetTurnDeadline(room);

  const state = normalizeState(room);
  state.turnInstance = {
    id: deps.createId(),
    turnNumber: room.turn.number,
    playerId: next.id,
    kind: choice.kind,
    sourceId: choice.sourceId,
    sourceName: choice.sourceName,
    startedAt: deps.nowIso()
  };
  state.endedTurn = null;

  state.history.push({
    id: deps.createId(),
    type: "turn-started",
    playerId: next.id,
    turnNumber: room.turn.number,
    kind: choice.kind,
    sourceId: choice.sourceId,
    createdAt: deps.nowIso()
  });

  deps.queueSuggestedTriggers(room, "TURN_STARTED_V60", {
    playerId: next.id,
    turnNumber: room.turn.number,
    kind: choice.kind,
    sourceId: choice.sourceId
  });

  deps.addLog(
    room,
    `Turn ${room.turn.number}: ${next.name} is active${choice.kind === "extra" ? " for an extra turn" : ""}.`,
    "turn"
  );
}

function exileStackObject(room, item, deps) {
  if (!item?.card || item.card.token) return;

  const owner = findPlayer(room, item.card.ownerId, deps);
  if (!owner?.game?.exile) return;

  const alreadyExists = owner.game.exile.some(
    (card) => card.id === item.card.id
  );

  if (!alreadyExists) {
    item.card.attacking = false;
    item.card.blockingCardId = null;
    item.card.defendingPlayerId = null;
    item.card.defendingPermanentId = null;
    item.card.attachedToId = null;
    owner.game.exile.unshift(item.card);
  }
}

function endTurnNow(room, actorId, options, deps) {
  if (!room.turn) {
    return {
      success: false,
      error: "No turn is active."
    };
  }

  const state = normalizeState(room);
  const stack = [...list(room.stack)];

  for (const item of stack) {
    exileStackObject(room, item, deps);
  }

  room.stack = [];
  room.triggerQueue = [];

  deps.clearCombat(room);
  deps.clearMana(room);
  deps.runStateBasedActions(room, "end-the-turn-v60");

  room.turn.phaseIndex = PHASE_INDEX.Cleanup;
  deps.resetPriority(room, room.turn.activePlayerId);
  deps.resetTurnDeadline(room);

  state.endedTurn = {
    id: deps.createId(),
    turnNumber: Number(room.turn.number) || 0,
    playerId: room.turn.activePlayerId,
    endedByPlayerId: actorId || room.turn.activePlayerId,
    sourceCardId: String(options?.sourceCardId || ""),
    sourceName: String(options?.sourceName || "End the turn").slice(0, 180),
    exiledStackCount: stack.length,
    createdAt: deps.nowIso()
  };

  state.history.push({
    id: deps.createId(),
    type: "turn-ended-early",
    ...clone(state.endedTurn)
  });

  deps.queueSuggestedTriggers(room, "TURN_ENDED_EARLY_V60", {
    ...clone(state.endedTurn)
  });

  deps.addLog(
    room,
    `The turn ended early. ${stack.length} stack object${stack.length === 1 ? " was" : "s were"} exiled and the game moved to cleanup.`,
    "turn"
  );

  return {
    success: true,
    exiledStackCount: stack.length,
    phaseIndex: PHASE_INDEX.Cleanup
  };
}

function endCombatNow(room, actorId, options, deps) {
  if (!room.turn) {
    return {
      success: false,
      error: "No combat phase is active."
    };
  }

  const current = Number(room.turn.phaseIndex) || 0;
  if (current < 4 || current > 9) {
    return {
      success: false,
      error: "The game is not currently in combat."
    };
  }

  for (const item of list(room.stack)) {
    exileStackObject(room, item, deps);
  }
  room.stack = [];
  room.triggerQueue = [];

  deps.clearCombat(room);
  deps.clearMana(room);
  room.turn.phaseIndex = PHASE_INDEX["Main 2"];
  deps.resetPriority(room, room.turn.activePlayerId);
  deps.resetTurnDeadline(room);
  deps.runStateBasedActions(room, "end-combat-v60");

  normalizeState(room).history.push({
    id: deps.createId(),
    type: "combat-ended-early",
    turnNumber: Number(room.turn.number) || 0,
    playerId: room.turn.activePlayerId,
    endedByPlayerId: actorId || room.turn.activePlayerId,
    sourceCardId: String(options?.sourceCardId || ""),
    sourceName: String(options?.sourceName || "End combat").slice(0, 180),
    createdAt: deps.nowIso()
  });

  deps.addLog(
    room,
    "Combat ended early and the game moved to the second main phase.",
    "turn"
  );

  return {
    success: true,
    phaseIndex: PHASE_INDEX["Main 2"]
  };
}

function reverseTurnOrder(room, actorId, options, deps) {
  const order = normalizedTurnOrder(room);
  if (order.length < 2) {
    return {
      success: false,
      error: "There are not enough active players to reverse turn order."
    };
  }

  const activeId = room.turn?.activePlayerId;
  const reversed = [...order].reverse();
  const activeIndex = reversed.indexOf(activeId);

  room.turn.order =
    activeIndex >= 0
      ? [...reversed.slice(activeIndex), ...reversed.slice(0, activeIndex)]
      : reversed;

  normalizeState(room).history.push({
    id: deps.createId(),
    type: "turn-order-reversed",
    actorId,
    sourceCardId: String(options?.sourceCardId || ""),
    sourceName: String(options?.sourceName || "Reverse turn order").slice(0, 180),
    order: [...room.turn.order],
    createdAt: deps.nowIso()
  });

  deps.addLog(room, "The game's turn order was reversed.", "turn");

  return {
    success: true,
    order: [...room.turn.order]
  };
}

function numberFromText(value) {
  const words = {
    a: 1,
    an: 1,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5
  };

  const normalized = String(value || "").toLowerCase();
  return words[normalized] ?? Math.max(0, Number(normalized) || 0);
}

function textForItem(item, deps) {
  return [
    String(item?.text || ""),
    item?.card
      ? String(deps.currentOracleText(item.card) || "")
      : ""
  ].filter(Boolean).join("\n");
}

function targetPlayerIds(item) {
  return unique(item?.targets)
    .filter((target) => target.startsWith("player:"))
    .map((target) => target.slice(7));
}

function playerReferencedByText(room, item, text, deps) {
  if (/\btarget player\b/i.test(text)) {
    return findPlayer(room, targetPlayerIds(item)[0], deps);
  }

  if (/\btarget opponent\b/i.test(text)) {
    return findPlayer(room, targetPlayerIds(item)[0], deps);
  }

  return findPlayer(room, item?.controllerId, deps);
}

function parseResolvedTurnEffects(room, item, deps) {
  const text = textForItem(item, deps);
  if (!text) return [];

  const actions = [];
  const sourceName = item?.name || item?.card?.name || "Resolved effect";
  const sourceCardId = item?.sourceCardId || item?.card?.id || "";

  let match = text.match(
    /\b(?:(?:you|target player|target opponent)\s+)?take(?:s)? (an|one|two|three|\d+) extra turns? after this one\b/i
  );

  if (match) {
    const player = playerReferencedByText(room, item, text, deps);
    if (player) {
      actions.push({
        type: "extra-turn",
        playerId: player.id,
        amount: Math.max(1, numberFromText(match[1]))
      });
    }
  }

  match = text.match(
    /\b(?:(?:you|target player|target opponent)\s+)?skip(?:s)? (?:their|your|his or her) next (one|two|three|\d+)?\s*turns?\b/i
  );

  if (match) {
    const player = playerReferencedByText(room, item, text, deps);
    if (player) {
      actions.push({
        type: "skip-turn",
        playerId: player.id,
        amount: Math.max(1, numberFromText(match[1] || "one"))
      });
    }
  }

  if (
    /\bthere is an additional combat phase after this phase(?: followed by an additional main phase)?\b/i.test(text) ||
    /\bafter this main phase, there is an additional combat phase followed by an additional main phase\b/i.test(text)
  ) {
    actions.push({
      type: "additional-phase",
      playerId: item.controllerId,
      kind: /followed by an additional main phase/i.test(text)
        ? "combat-main"
        : "combat"
    });
  }

  if (/\bthere is an additional beginning phase after this phase\b/i.test(text)) {
    actions.push({
      type: "additional-phase",
      playerId: item.controllerId,
      kind: "beginning"
    });
  }

  if (/\bthere is an additional upkeep step after this step\b/i.test(text)) {
    actions.push({
      type: "additional-phase",
      playerId: item.controllerId,
      kind: "upkeep"
    });
  }

  if (/\bthere is an additional draw step after this step\b/i.test(text)) {
    actions.push({
      type: "additional-phase",
      playerId: item.controllerId,
      kind: "draw"
    });
  }

  if (/\breverse the game'?s turn order\b/i.test(text)) {
    actions.push({
      type: "reverse-order"
    });
  }

  for (const action of actions) {
    if (action.type === "extra-turn") {
      queueExtraTurn(
        room,
        action.playerId,
        {
          amount: action.amount,
          sourceName,
          sourceCardId,
          createdByPlayerId: item.controllerId
        },
        deps
      );
    } else if (action.type === "skip-turn") {
      skipNextTurn(
        room,
        action.playerId,
        action.amount,
        {
          sourceName,
          sourceCardId
        },
        deps
      );
    } else if (action.type === "additional-phase") {
      queueAdditionalPhase(
        room,
        action.playerId,
        action.kind,
        {
          anchorPhaseIndex: room.turn?.phaseIndex,
          sourceName,
          sourceCardId
        },
        deps
      );
    } else if (action.type === "reverse-order") {
      reverseTurnOrder(
        room,
        item.controllerId,
        {
          sourceName,
          sourceCardId
        },
        deps
      );
    }
  }

  return actions;
}

function shouldEndTurnBeforeResolve(item, deps) {
  const text = textForItem(item, deps);
  return /\bend the turn\b/i.test(text);
}

function shouldEndCombatBeforeResolve(item, deps) {
  const text = textForItem(item, deps);
  return /\bend the combat phase\b/i.test(text);
}

function beforeResolve(room, item, deps) {
  if (!item) return { handled: false };

  if (shouldEndTurnBeforeResolve(item, deps)) {
    const result = endTurnNow(
      room,
      item.controllerId,
      {
        sourceCardId: item.sourceCardId || item.card?.id || "",
        sourceName: item.name || item.card?.name || "End the turn"
      },
      deps
    );

    return {
      handled: true,
      result
    };
  }

  if (shouldEndCombatBeforeResolve(item, deps)) {
    const result = endCombatNow(
      room,
      item.controllerId,
      {
        sourceCardId: item.sourceCardId || item.card?.id || "",
        sourceName: item.name || item.card?.name || "End combat"
      },
      deps
    );

    return {
      handled: true,
      result
    };
  }

  return { handled: false };
}

function afterResolve(room, item, result, deps) {
  if (!result || !item) return result;

  parseResolvedTurnEffects(room, item, deps);
  ensureTurnInstance(room, deps);
  return result;
}

function processGameAction(room, actor, action, legacy, deps) {
  normalizeState(room);
  ensureTurnInstance(room, deps);

  const type = String(action?.type || "");

  if (type === "turn-v60-extra-turn") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can add a manual extra turn."
      };
    }

    return queueExtraTurn(
      room,
      action?.playerId,
      {
        amount: action?.amount,
        sourceName: action?.sourceName || "Manual extra turn",
        createdByPlayerId: actor.id
      },
      deps
    );
  }

  if (type === "turn-v60-skip-turn") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can add a skipped turn."
      };
    }

    return skipNextTurn(
      room,
      action?.playerId,
      action?.amount,
      {
        sourceName: action?.sourceName || "Manual skipped turn"
      },
      deps
    );
  }

  if (type === "turn-v60-add-phase") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can add a manual phase."
      };
    }

    return queueAdditionalPhase(
      room,
      action?.playerId || room.turn?.activePlayerId,
      action?.kind,
      {
        amount: action?.amount,
        anchorPhaseIndex:
          action?.anchorPhaseIndex != null
            ? Number(action.anchorPhaseIndex)
            : room.turn?.phaseIndex,
        sourceName: action?.sourceName || "Manual additional phase"
      },
      deps
    );
  }

  if (type === "turn-v60-skip-phase") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can add a skipped phase."
      };
    }

    return queueSkipPhase(
      room,
      action?.playerId,
      action?.phase,
      action?.amount,
      {
        notBeforeTurn: action?.notBeforeTurn,
        sourceName: action?.sourceName || "Manual skipped phase"
      },
      deps
    );
  }

  if (type === "turn-v60-end-turn") {
    if (
      room.hostId !== actor.id &&
      room.turn?.activePlayerId !== actor.id
    ) {
      return {
        success: false,
        error: "Only the host or active player can end the turn manually."
      };
    }

    return endTurnNow(
      room,
      actor.id,
      {
        sourceName: "Manual end turn"
      },
      deps
    );
  }

  if (type === "turn-v60-end-combat") {
    if (
      room.hostId !== actor.id &&
      room.turn?.activePlayerId !== actor.id
    ) {
      return {
        success: false,
        error: "Only the host or active player can end combat manually."
      };
    }

    return endCombatNow(
      room,
      actor.id,
      {
        sourceName: "Manual end combat"
      },
      deps
    );
  }

  if (type === "turn-v60-reverse-order") {
    if (room.hostId !== actor.id) {
      return {
        success: false,
        error: "Only the host can reverse turn order manually."
      };
    }

    return reverseTurnOrder(
      room,
      actor.id,
      {
        sourceName: "Manual turn-order reversal"
      },
      deps
    );
  }

  if (type === "next-phase") {
    const insertion = pendingInsertion(room);
    const nextIndex =
      (Number(room.turn?.phaseIndex) || 0) + 1;
    const skip = skipEntryFor(
      room,
      room.turn?.activePlayerId,
      nextIndex
    );

    if (insertion || skip) {
      return customNextPhase(room, actor, deps);
    }
  }

  if (type === "end-turn") {
    if (room.turn?.activePlayerId !== actor.id) {
      return legacy(room, actor, action);
    }

    deps.advanceTurn(room);
    return {
      success: true,
      endedTurn: true
    };
  }

  const result = legacy(room, actor, action);
  if (!result?.success) return result;

  ensureTurnInstance(room, deps);
  return result;
}

function stateForViewer(room, viewerId, deps) {
  const state = normalizeState(room);
  ensureTurnInstance(room, deps);

  const order = normalizedTurnOrder(room);

  return {
    success: true,
    version: "60.0.0",
    isHost: room.hostId === viewerId,
    turnNumber: Number(room.turn?.number) || 0,
    activePlayerId: room.turn?.activePlayerId || null,
    activePlayerName: activePlayer(room, deps)?.name || null,
    phaseIndex: Number(room.turn?.phaseIndex) || 0,
    phaseName: phaseName(room, deps),
    order: order.map((playerId) => ({
      playerId,
      playerName: findPlayer(room, playerId, deps)?.name || playerId
    })),
    players: room.players.map((player) => ({
      playerId: player.id,
      playerName: player.name,
      active:
        player.game &&
        !player.game.lost &&
        !player.game.conceded,
      skippedTurns:
        Number(state.skippedTurns[player.id]) || 0
    })),
    extraTurns: [...state.extraTurns]
      .sort((first, second) => Number(second.sequence) - Number(first.sequence))
      .map((entry) => ({
        ...clone(entry),
        playerName: findPlayer(room, entry.playerId, deps)?.name || entry.playerId
      })),
    phaseInsertions: [...state.phaseInsertions]
      .sort((first, second) => Number(second.sequence) - Number(first.sequence))
      .map((entry) => ({
        ...clone(entry),
        playerName: findPlayer(room, entry.playerId, deps)?.name || entry.playerId,
        anchorPhaseName: BASE_PHASES[entry.anchorPhaseIndex]
      })),
    skippedPhases: [...state.skippedPhases]
      .sort((first, second) => Number(first.sequence) - Number(second.sequence))
      .map((entry) => ({
        ...clone(entry),
        playerName: findPlayer(room, entry.playerId, deps)?.name || entry.playerId
      })),
    turnInstance: clone(state.turnInstance),
    endedTurn: clone(state.endedTurn),
    history: state.history.slice(-60).reverse()
  };
}

function summary(room) {
  const state = normalizeState(room);

  return {
    version: "60.0.0",
    queuedExtraTurns: state.extraTurns.length,
    queuedAdditionalPhases: state.phaseInsertions.length,
    queuedSkippedPhases: state.skippedPhases.length,
    queuedSkippedTurns: Object.values(state.skippedTurns)
      .reduce((sum, value) => sum + Number(value || 0), 0),
    turnOrderReversed:
      Boolean(room.turn?.order?.length) &&
      room.turn.order.join("|") !== room.players
        .filter((player) => player.game && !player.game.lost && !player.game.conceded)
        .map((player) => player.id)
        .join("|")
  };
}

function createTurnRulesEngine(deps) {
  return {
    version: "60.0.0",

    processGameAction(room, actor, action, legacy) {
      return processGameAction(room, actor, action, legacy, deps);
    },

    advanceTurn(room, legacy) {
      return advanceTurn(room, legacy, deps);
    },

    beforeResolve(room, item) {
      return beforeResolve(room, item, deps);
    },

    afterResolve(room, item, result) {
      return afterResolve(room, item, result, deps);
    },

    state(room, viewerId) {
      return stateForViewer(room, viewerId, deps);
    },

    summary(room) {
      return summary(room);
    },

    status() {
      return {
        success: true,
        version: "60.0.0",
        automatic: [
          "extra turns queued one at a time",
          "most recently created extra turn taken first",
          "extra turns assigned to any active player",
          "skipped normal turns",
          "skipped extra turns",
          "additional beginning phases",
          "additional upkeep steps",
          "additional draw steps",
          "additional combat phases",
          "additional combat followed by main phase",
          "additional main phases",
          "additional end steps",
          "most recently created phase insertion at the same point starts first",
          "skipped phases and steps",
          "turn-order reversal",
          "active-player and priority reset at phase boundaries",
          "untapping during an additional beginning phase without clearing new summoning sickness",
          "ending the turn by exiling stack objects and moving to cleanup",
          "ending combat and moving to the second main phase",
          "combat-state, damage, mana and end-of-turn cleanup at turn changes",
          "common extra-turn Oracle wording",
          "common skip-next-turn Oracle wording",
          "common additional combat/main wording",
          "common additional beginning, upkeep and draw wording",
          "common reverse-turn-order wording",
          "common end-the-turn wording",
          "turn and phase timeline history"
        ],
        assisted: [
          "cleanup-step repetition when state-based actions or triggers create new priority",
          "multiple simultaneous turn-control replacement effects",
          "controlling another player's turn",
          "Grand Melee turn markers",
          "team shared turns",
          "restart-the-game effects",
          "extra phases with card-specific untap restrictions",
          "effects that add a phase at a dynamically chosen point",
          "effects that end only a step while preserving a remaining phase",
          "cards whose earlier automation already changes the turn before v60 sees the resolved text"
        ]
      };
    }
  };
}

module.exports = {
  BASE_PHASES,
  PHASE_INDEX,
  createTurnRulesEngine,
  _test: {
    normalizeState,
    normalizedTurnOrder,
    nextNormalPlayerId,
    queueExtraTurn,
    skipNextTurn,
    queueAdditionalPhase,
    queueSkipPhase,
    pendingInsertion,
    skipEntryFor,
    chooseNextTurn,
    beginInsertedPhase,
    customNextPhase,
    endTurnNow,
    endCombatNow,
    reverseTurnOrder,
    parseResolvedTurnEffects,
    shouldEndTurnBeforeResolve,
    shouldEndCombatBeforeResolve,
    phasePath,
    numberFromText
  }
};
