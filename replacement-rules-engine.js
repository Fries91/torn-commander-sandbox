"use strict";

const COLORS = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
  colorless: "C"
};

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
  room.replacementV57 =
    room.replacementV57 &&
    typeof room.replacementV57 === "object"
      ? room.replacementV57
      : {};

  const state = room.replacementV57;
  state.shields = list(state.shields)
    .filter((shield) => shield && shield.id && shield.status !== "removed")
    .slice(-150);
  state.preferences =
    state.preferences &&
    typeof state.preferences === "object"
      ? state.preferences
      : {};
  state.redirectTargets =
    state.redirectTargets &&
    typeof state.redirectTargets === "object"
      ? state.redirectTargets
      : {};
  state.history = list(state.history).slice(-250);
  state.lastEvent =
    state.lastEvent &&
    typeof state.lastEvent === "object"
      ? state.lastEvent
      : null;
  state.settings =
    state.settings &&
    typeof state.settings === "object"
      ? state.settings
      : {
          suppressLegacyDamageText: true
        };

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

function targetKeyFor(target, kind) {
  return `${kind}:${target.id}`;
}

function sourceColors(source) {
  const data = source?.cardData || {};
  const face =
    data.faces?.[source?.activeFaceIndex || 0] ||
    data;

  const explicit = unique([
    ...list(face.colors),
    ...list(data.colors),
    ...list(face.colorIdentity),
    ...list(data.colorIdentity)
  ]).map((color) => color.toUpperCase());

  if (explicit.length) return explicit;

  const cost = String(
    face.manaCost ||
    data.manaCost ||
    ""
  ).toUpperCase();

  return unique(
    [...cost.matchAll(/\{([WUBRGC])(?:\/[^}]+)?\}/g)]
      .map((match) => match[1])
  );
}

function isCombatDamage(room, source, deps) {
  const phase =
    deps.PHASES[room.turn?.phaseIndex || 0] ||
    "";

  return Boolean(
    source?.attacking ||
    /combat damage|first-strike damage/i.test(phase)
  );
}

function damageCantBePrevented(source, deps) {
  if (!source) return false;
  if (
    source.specialState?.damageCantBePrevented ||
    source.ruleEffects?.some(
      (effect) => effect.damageCantBePrevented
    )
  ) {
    return true;
  }

  return /\bdamage (?:dealt by .* |)can'?t be prevented\b/i.test(
    oracle(source, deps)
  );
}

function protectionQualities(card, deps) {
  const text = [
    oracle(card, deps),
    ...list(card?.cardData?.keywords)
  ].join("\n");

  const qualities = [];
  for (const match of text.matchAll(
    /\bprotection from ([^.;\n]+)/gi
  )) {
    qualities.push(
      match[1]
        .replace(/\s*\([^)]*\)\s*/g, "")
        .trim()
        .toLowerCase()
    );
  }

  return qualities;
}

function protectionApplies(target, source, deps) {
  if (!target || !source) return false;

  const qualities = protectionQualities(
    target,
    deps
  );
  if (!qualities.length) return false;

  const sourceType =
    typeLine(source, deps).toLowerCase();
  const sourceName =
    String(source.name || "").toLowerCase();
  const colors = sourceColors(source);

  return qualities.some((quality) => {
    if (
      quality === "everything" ||
      quality === "all colors"
    ) {
      return true;
    }

    for (const [word, symbol] of Object.entries(COLORS)) {
      if (
        quality.includes(word) &&
        colors.includes(symbol)
      ) {
        return true;
      }
    }

    if (
      quality.includes("creatures") &&
      /\bcreature\b/.test(sourceType)
    ) {
      return true;
    }
    if (
      quality.includes("artifacts") &&
      /\bartifact\b/.test(sourceType)
    ) {
      return true;
    }
    if (
      quality.includes("instants") &&
      /\binstant\b/.test(sourceType)
    ) {
      return true;
    }
    if (
      quality.includes("sorceries") &&
      /\bsorcery\b/.test(sourceType)
    ) {
      return true;
    }
    if (
      quality.includes("planeswalkers") &&
      /\bplaneswalker\b/.test(sourceType)
    ) {
      return true;
    }
    if (
      quality.includes("commanders") &&
      source.commander
    ) {
      return true;
    }
    if (
      sourceName &&
      quality.includes(sourceName)
    ) {
      return true;
    }

    return false;
  });
}

function numericWord(value) {
  const words = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10
  };
  const lower = String(value || "")
    .toLowerCase();

  if (Object.prototype.hasOwnProperty.call(words, lower)) {
    return words[lower];
  }

  return Math.max(
    0,
    Number(value) || 0
  );
}

function parseStaticEffects(room, deps) {
  const effects = [];

  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      const text = oracle(card, deps);
      const controllerId = card.controllerId;

      let index = 0;
      const push = (effect) => {
        effects.push({
          id: `${card.id}:${effect.kind}:${index++}`,
          sourceCardId: card.id,
          sourceName: card.name,
          controllerId,
          manual: false,
          priority: 100,
          ...effect
        });
      };

      let match = text.match(
        /\bif a source would deal damage to you or a permanent you control, prevent (one|two|three|four|five|\d+) of that damage\b/i
      );
      if (match) {
        push({
          kind: "prevent-fixed",
          amount: numericWord(match[1]),
          targetScope: "controller-group",
          sourceFilter: "any",
          label:
            `Prevent ${numericWord(match[1])} damage to you or a permanent you control`
        });
      }

      match = text.match(
        /\bif a source would deal damage to you, prevent (one|two|three|four|five|\d+) of that damage\b/i
      );
      if (match) {
        push({
          kind: "prevent-fixed",
          amount: numericWord(match[1]),
          targetScope: "controller-player",
          sourceFilter: "any",
          label:
            `Prevent ${numericWord(match[1])} damage to you`
        });
      }

      if (
        /\bprevent all combat damage that would be dealt to you\b/i.test(
          text
        )
      ) {
        push({
          kind: "prevent-all",
          amount: null,
          targetScope: "controller-player",
          sourceFilter: "combat",
          label:
            "Prevent all combat damage to you"
        });
      }

      if (
        /\bprevent all damage that would be dealt to (?:this creature|this permanent|[^\n.]+)\b/i.test(
          text
        )
      ) {
        push({
          kind: "prevent-all",
          amount: null,
          targetScope: "self",
          sourceFilter: "any",
          label:
            `Prevent all damage to ${card.name}`
        });
      }

      match = text.match(
        /\bif damage would be dealt to (?:this creature|this permanent|[^\n.,]+), prevent (one|two|three|four|five|\d+) of that damage\b/i
      );
      if (match) {
        push({
          kind: "prevent-fixed",
          amount: numericWord(match[1]),
          targetScope: "self",
          sourceFilter: "any",
          label:
            `Prevent ${numericWord(match[1])} damage to ${card.name}`
        });
      }

      match = text.match(
        /\bif a source would deal damage to you, it deals half that damage, rounded (up|down), instead\b/i
      );
      if (match) {
        push({
          kind: "half",
          rounding: match[1].toLowerCase(),
          targetScope: "controller-player",
          sourceFilter: "any",
          label:
            `Half damage to you, rounded ${match[1].toLowerCase()}`
        });
      }

      match = text.match(
        /\bif a source you control would deal damage to (?:an opponent|a permanent an opponent controls|an opponent or a permanent an opponent controls), it deals (double|triple) that damage instead\b/i
      );
      if (match) {
        push({
          kind: "multiply",
          multiplier:
            match[1].toLowerCase() === "triple"
              ? 3
              : 2,
          targetScope: "opponent-group",
          sourceScope: "controller-sources",
          sourceFilter: "any",
          label:
            `${match[1][0].toUpperCase()}${match[1].slice(1)} damage from sources you control`
        });
      }

      match = text.match(
        /\bif (?:this creature|this permanent|[^\n.,]+) would deal damage, it deals (double|triple) that damage instead\b/i
      );
      if (match) {
        push({
          kind: "multiply",
          multiplier:
            match[1].toLowerCase() === "triple"
              ? 3
              : 2,
          targetScope: "any",
          sourceScope: "self",
          sourceFilter: "any",
          label:
            `${match[1][0].toUpperCase()}${match[1].slice(1)} damage from ${card.name}`
        });
      }

      if (
        /\bif damage would be dealt to you, you may have that damage dealt to target creature you control instead\b/i.test(
          text
        )
      ) {
        push({
          kind: "redirect-all",
          targetScope: "controller-player",
          sourceFilter: "any",
          redirectScope: "creature-you-control",
          optional: true,
          label:
            "Redirect damage from you to a chosen creature you control"
        });
      }
    }
  }

  return effects;
}

function manualEffects(room) {
  return normalizeState(room).shields
    .filter((shield) => shield.status !== "removed")
    .map((shield) => ({
      ...shield,
      manual: true
    }));
}

function effectTargetPlayerId(room, target, kind, deps) {
  if (kind === "player") {
    return target.id;
  }

  return (
    target.controllerId ||
    target.ownerId ||
    deps.findBattlefieldCard(
      room,
      target.id
    )?.player?.id ||
    null
  );
}

function targetMatches(
  room,
  effect,
  source,
  target,
  kind,
  affectedPlayerId,
  deps
) {
  const sourceControllerId =
    source?.controllerId ||
    source?.ownerId ||
    null;

  if (
    effect.sourceScope === "self" &&
    source?.id !== effect.sourceCardId
  ) {
    return false;
  }

  if (
    effect.sourceScope === "controller-sources" &&
    sourceControllerId !== effect.controllerId
  ) {
    return false;
  }

  const combat = isCombatDamage(
    room,
    source,
    deps
  );

  if (
    effect.sourceFilter === "combat" &&
    !combat
  ) {
    return false;
  }
  if (
    effect.sourceFilter === "noncombat" &&
    combat
  ) {
    return false;
  }

  if (effect.targetKey) {
    return (
      effect.targetKey ===
      targetKeyFor(target, kind)
    );
  }

  if (
    effect.targetScope === "controller-player"
  ) {
    return (
      kind === "player" &&
      target.id === effect.controllerId
    );
  }

  if (
    effect.targetScope === "controller-group"
  ) {
    return affectedPlayerId === effect.controllerId;
  }

  if (effect.targetScope === "self") {
    return (
      kind === "permanent" &&
      target.id === effect.sourceCardId
    );
  }

  if (
    effect.targetScope === "opponent-group"
  ) {
    return (
      affectedPlayerId !==
      effect.controllerId
    );
  }

  return (
    effect.targetScope === "any" ||
    !effect.targetScope
  );
}

function sourceMatchesManual(
  room,
  effect,
  source,
  deps
) {
  const combat = isCombatDamage(
    room,
    source,
    deps
  );

  if (
    effect.sourceFilter === "combat" &&
    !combat
  ) {
    return false;
  }
  if (
    effect.sourceFilter === "noncombat" &&
    combat
  ) {
    return false;
  }

  if (
    effect.sourceCardIdFilter &&
    source?.id !== effect.sourceCardIdFilter
  ) {
    return false;
  }

  return true;
}

function applicableEffects(
  room,
  source,
  target,
  kind,
  deps,
  visited
) {
  const affectedPlayerId =
    effectTargetPlayerId(
      room,
      target,
      kind,
      deps
    );

  const staticEffects =
    parseStaticEffects(room, deps);
  const effects = [
    ...staticEffects,
    ...manualEffects(room)
  ];

  if (
    kind === "permanent" &&
    protectionApplies(
      target,
      source,
      deps
    )
  ) {
    effects.push({
      id: `protection:${target.id}`,
      sourceCardId: target.id,
      sourceName: target.name,
      controllerId: affectedPlayerId,
      manual: false,
      kind: "prevent-all",
      amount: null,
      targetScope: "self",
      sourceFilter: "any",
      priority: 0,
      label:
        `${target.name}'s protection prevents the damage`
    });
  }

  return effects.filter((effect) => {
    if (visited.has(effect.id)) {
      return false;
    }

    if (
      effect.manual &&
      !sourceMatchesManual(
        room,
        effect,
        source,
        deps
      )
    ) {
      return false;
    }

    return targetMatches(
      room,
      effect,
      source,
      target,
      kind,
      affectedPlayerId,
      deps
    );
  });
}

function orderedEffects(
  room,
  effects,
  affectedPlayerId
) {
  const state = normalizeState(room);
  const order = list(
    state.preferences[affectedPlayerId]
  );
  const rank = new Map(
    order.map((id, index) => [id, index])
  );

  return [...effects].sort((first, second) => {
    const firstRank =
      rank.has(first.id)
        ? rank.get(first.id)
        : 10000 +
          (Number(first.priority) || 100);
    const secondRank =
      rank.has(second.id)
        ? rank.get(second.id)
        : 10000 +
          (Number(second.priority) || 100);

    return (
      firstRank - secondRank ||
      String(first.id).localeCompare(
        String(second.id)
      )
    );
  });
}

function redirectTargetFor(
  room,
  effect,
  deps
) {
  const state = normalizeState(room);
  const configured =
    effect.redirectTargetKey ||
    state.redirectTargets[effect.id] ||
    "";

  if (!configured) return null;

  const [kind, id] =
    String(configured).split(":");

  if (kind === "player") {
    const player = deps.findPlayer(room, id);
    if (
      player?.game &&
      !player.game.lost &&
      !player.game.conceded
    ) {
      return {
        kind: "player",
        target: player
      };
    }
  }

  if (kind === "card") {
    const located =
      deps.findBattlefieldCard(room, id);
    if (located) {
      return {
        kind: "permanent",
        target: located.card
      };
    }
  }

  return null;
}

function consumeEffect(room, effect, amount) {
  if (!effect.manual) return;

  const state = normalizeState(room);
  const shield = state.shields.find(
    (entry) => entry.id === effect.id
  );
  if (!shield) return;

  if (
    Number.isFinite(Number(shield.remaining))
  ) {
    shield.remaining = Math.max(
      0,
      Number(shield.remaining) -
      Math.max(0, Number(amount) || 0)
    );
  }

  if (
    shield.oneUse ||
    Number(shield.remaining) <= 0
  ) {
    shield.status = "removed";
  }

  state.shields = state.shields.filter(
    (entry) => entry.status !== "removed"
  );
}

function cleanExpiredShields(room) {
  const state = normalizeState(room);
  const currentTurn =
    Number(room.turn?.number) || 0;

  state.shields = state.shields.filter(
    (shield) => {
      if (
        shield.expires === "turn" &&
        Number(shield.createdTurn) <
          currentTurn
      ) {
        return false;
      }
      return shield.status !== "removed";
    }
  );
}

function damageTextPattern(line) {
  return (
    /\bprevent\b.*\bdamage\b/i.test(line) ||
    /\bwould deal damage\b.*\b(?:double|triple|half|instead)\b/i.test(
      line
    ) ||
    /\bif damage would be dealt\b.*\binstead\b/i.test(
      line
    )
  );
}

function suppressLegacyDamageText(
  room,
  fn
) {
  const state = normalizeState(room);
  if (
    state.settings
      .suppressLegacyDamageText === false
  ) {
    return fn();
  }

  const saved = [];

  for (const player of room.players) {
    for (const card of player.game?.battlefield || []) {
      const data = card.cardData || {};
      if (
        typeof data.oracleText === "string"
      ) {
        saved.push({
          object: data,
          key: "oracleText",
          value: data.oracleText
        });
        data.oracleText =
          data.oracleText
            .split(/\n/)
            .filter(
              (line) =>
                !damageTextPattern(line)
            )
            .join("\n");
      }

      for (const face of list(data.faces)) {
        if (
          typeof face.oracleText === "string"
        ) {
          saved.push({
            object: face,
            key: "oracleText",
            value: face.oracleText
          });
          face.oracleText =
            face.oracleText
              .split(/\n/)
              .filter(
                (line) =>
                  !damageTextPattern(line)
              )
              .join("\n");
        }
      }
    }
  }

  try {
    return fn();
  } finally {
    for (const entry of saved) {
      entry.object[entry.key] =
        entry.value;
    }
  }
}

function directDamage(
  room,
  source,
  target,
  kind,
  amount,
  legacyPlayer,
  legacyPermanent
) {
  const value = Math.max(
    0,
    Math.floor(Number(amount) || 0)
  );
  if (!value) return 0;

  return suppressLegacyDamageText(
    room,
    () =>
      kind === "player"
        ? legacyPlayer(
            room,
            source,
            target,
            value
          )
        : legacyPermanent(
            room,
            source,
            target,
            value
          )
  );
}

function processDamageEvent(
  room,
  source,
  target,
  kind,
  requested,
  legacyPlayer,
  legacyPermanent,
  deps,
  inherited = {}
) {
  cleanExpiredShields(room);

  const state = normalizeState(room);
  const eventId =
    inherited.eventId ||
    deps.createId();
  const visited =
    inherited.visited ||
    new Set();

  let amount = Math.max(
    0,
    Math.floor(Number(requested) || 0)
  );

  const affectedPlayerId =
    effectTargetPlayerId(
      room,
      target,
      kind,
      deps
    );

  const effects = orderedEffects(
    room,
    applicableEffects(
      room,
      source,
      target,
      kind,
      deps,
      visited
    ),
    affectedPlayerId
  );

  const steps = [];
  const redirects = [];
  const cannotPrevent =
    damageCantBePrevented(source, deps);

  for (const effect of effects) {
    if (amount <= 0) break;

    visited.add(effect.id);
    const before = amount;

    if (effect.kind === "multiply") {
      amount = Math.max(
        0,
        Math.floor(
          amount *
          Math.max(
            0,
            Number(effect.multiplier) || 1
          )
        )
      );
      consumeEffect(
        room,
        effect,
        before
      );
    } else if (effect.kind === "half") {
      const divided = amount / 2;
      amount =
        effect.rounding === "down"
          ? Math.floor(divided)
          : Math.ceil(divided);
      consumeEffect(
        room,
        effect,
        before
      );
    } else if (
      effect.kind === "prevent-fixed" &&
      !cannotPrevent
    ) {
      const available =
        Number.isFinite(
          Number(effect.remaining)
        )
          ? Math.min(
              Number(effect.amount) || 0,
              Number(effect.remaining)
            )
          : Number(effect.amount) || 0;

      const prevented = Math.min(
        amount,
        Math.max(0, available)
      );
      amount -= prevented;
      consumeEffect(
        room,
        effect,
        prevented
      );
    } else if (
      effect.kind === "prevent-all" &&
      !cannotPrevent
    ) {
      const prevented = amount;
      amount = 0;
      consumeEffect(
        room,
        effect,
        prevented
      );
    } else if (
      effect.kind === "redirect-all" ||
      effect.kind === "redirect-fixed"
    ) {
      const redirect =
        redirectTargetFor(
          room,
          effect,
          deps
        );

      if (redirect) {
        const redirected =
          effect.kind === "redirect-all"
            ? amount
            : Math.min(
                amount,
                Math.max(
                  0,
                  Number(effect.amount) || 0
                )
              );

        if (redirected > 0) {
          amount -= redirected;
          redirects.push({
            effect,
            target: redirect.target,
            kind: redirect.kind,
            amount: redirected
          });
          consumeEffect(
            room,
            effect,
            redirected
          );
        }
      }
    }

    if (before !== amount) {
      steps.push({
        effectId: effect.id,
        label: effect.label,
        kind: effect.kind,
        before,
        after: amount,
        preventedOrMoved:
          Math.max(0, before - amount)
      });
    }
  }

  const dealt = directDamage(
    room,
    source,
    target,
    kind,
    amount,
    legacyPlayer,
    legacyPermanent
  );

  for (const redirect of redirects) {
    processDamageEvent(
      room,
      source,
      redirect.target,
      redirect.kind,
      redirect.amount,
      legacyPlayer,
      legacyPermanent,
      deps,
      {
        eventId,
        visited: new Set(visited)
      }
    );
  }

  const historyEntry = {
    id: deps.createId(),
    eventId,
    sourceCardId: source?.id || null,
    sourceName:
      source?.name ||
      "Unknown source",
    targetKey:
      targetKeyFor(target, kind),
    targetName:
      target?.name ||
      target?.game?.name ||
      "Target",
    targetKind: kind,
    requested: Math.max(
      0,
      Number(requested) || 0
    ),
    finalAmount: amount,
    legacyResult:
      Number(dealt) || 0,
    damageCantBePrevented:
      cannotPrevent,
    combat:
      isCombatDamage(
        room,
        source,
        deps
      ),
    steps,
    redirects: redirects.map(
      (entry) => ({
        effectId: entry.effect.id,
        targetKey:
          targetKeyFor(
            entry.target,
            entry.kind
          ),
        amount: entry.amount
      })
    ),
    createdAt: deps.nowIso()
  };

  state.history.push(historyEntry);
  state.lastEvent = historyEntry;

  if (steps.length || redirects.length) {
    deps.addLog(
      room,
      `${historyEntry.sourceName}'s ${historyEntry.requested} damage became ${historyEntry.finalAmount} damage after replacement and prevention effects.`,
      "replacement"
    );
  }

  return dealt;
}

function targetOptions(room, viewerId, deps) {
  const options = [];

  for (const player of activePlayers(room)) {
    options.push({
      targetKey: `player:${player.id}`,
      kind: "player",
      id: player.id,
      name: player.name,
      controllerId: player.id
    });

    for (const card of player.game?.battlefield || []) {
      options.push({
        targetKey: `card:${card.id}`,
        kind: "permanent",
        id: card.id,
        name: card.name,
        controllerId:
          card.controllerId ||
          player.id,
        typeLine:
          typeLine(card, deps),
        card:
          deps.publicCard(card)
      });
    }
  }

  return options;
}

function createShield(
  room,
  actor,
  action,
  deps
) {
  const kind = String(
    action?.kind || ""
  );
  if (
    ![
      "prevent-fixed",
      "prevent-all",
      "redirect-fixed",
      "redirect-all",
      "multiply",
      "half"
    ].includes(kind)
  ) {
    return {
      success: false,
      error:
        "Choose a supported replacement or prevention effect."
    };
  }

  const targetKey =
    String(action?.targetKey || "");
  const options =
    targetOptions(
      room,
      actor.id,
      deps
    );
  const target =
    options.find(
      (entry) =>
        entry.targetKey === targetKey
    );

  if (!target) {
    return {
      success: false,
      error: "Choose an available target."
    };
  }

  const host =
    room.hostId === actor.id;
  if (
    !host &&
    target.controllerId !== actor.id
  ) {
    return {
      success: false,
      error:
        "You can create shields only for yourself or permanents you control."
    };
  }

  let redirectTargetKey =
    String(
      action?.redirectTargetKey || ""
    );
  if (
    kind.startsWith("redirect") &&
    !options.some(
      (entry) =>
        entry.targetKey ===
        redirectTargetKey
    )
  ) {
    return {
      success: false,
      error:
        "Choose a legal redirection destination."
    };
  }

  const amount =
    kind === "prevent-fixed" ||
    kind === "redirect-fixed"
      ? Math.max(
          1,
          Math.floor(
            Number(action?.amount) || 1
          )
        )
      : 0;

  const multiplier =
    kind === "multiply"
      ? Math.max(
          0,
          Number(action?.multiplier) || 2
        )
      : 1;

  const shield = {
    id: deps.createId(),
    status: "active",
    manual: true,
    ownerPlayerId: actor.id,
    controllerId: target.controllerId,
    sourceCardId: null,
    sourceName: "Manual v57 effect",
    kind,
    targetKey,
    targetScope: null,
    sourceFilter:
      ["combat", "noncombat"].includes(
        action?.sourceFilter
      )
        ? action.sourceFilter
        : "any",
    sourceCardIdFilter:
      String(
        action?.sourceCardIdFilter || ""
      ),
    amount,
    remaining:
      kind === "prevent-fixed" ||
      kind === "redirect-fixed"
        ? amount
        : null,
    multiplier,
    rounding:
      action?.rounding === "down"
        ? "down"
        : "up",
    redirectTargetKey:
      kind.startsWith("redirect")
        ? redirectTargetKey
        : "",
    oneUse:
      action?.oneUse !== false,
    expires:
      action?.expires === "game"
        ? "game"
        : "turn",
    createdTurn:
      Number(room.turn?.number) || 0,
    createdAt: deps.nowIso(),
    label:
      String(action?.label || "")
        .trim()
        .slice(0, 180) ||
      (
        kind === "prevent-all"
          ? "Prevent all damage"
          : kind === "prevent-fixed"
            ? `Prevent the next ${amount} damage`
            : kind === "redirect-all"
              ? "Redirect all damage"
              : kind === "redirect-fixed"
                ? `Redirect the next ${amount} damage`
                : kind === "half"
                  ? "Half the damage"
                  : `Multiply damage by ${multiplier}`
      )
  };

  normalizeState(room).shields.push(
    shield
  );

  deps.addLog(
    room,
    `${actor.name} created a replacement/prevention effect: ${shield.label}.`,
    "replacement"
  );

  return {
    success: true,
    shieldId: shield.id
  };
}

function removeShield(
  room,
  actor,
  action
) {
  const state = normalizeState(room);
  const shield = state.shields.find(
    (entry) =>
      entry.id ===
      String(action?.shieldId || "")
  );

  if (!shield) {
    return {
      success: false,
      error: "That effect is unavailable."
    };
  }

  if (
    shield.ownerPlayerId !== actor.id &&
    room.hostId !== actor.id
  ) {
    return {
      success: false,
      error:
        "That effect belongs to another player."
    };
  }

  shield.status = "removed";
  state.shields = state.shields.filter(
    (entry) => entry.status !== "removed"
  );
  return { success: true };
}

function savePreferences(
  room,
  actor,
  action,
  deps
) {
  const state = normalizeState(room);
  const available = new Set(
    [
      ...parseStaticEffects(room, deps),
      ...manualEffects(room)
    ]
      .filter(
        (effect) =>
          effect.controllerId === actor.id ||
          effect.ownerPlayerId === actor.id
      )
      .map((effect) => effect.id)
  );

  state.preferences[actor.id] =
    unique(action?.order)
      .filter((id) => available.has(id));

  const redirects =
    action?.redirectTargets &&
    typeof action.redirectTargets === "object"
      ? action.redirectTargets
      : {};

  for (
    const [effectId, targetKey]
    of Object.entries(redirects)
  ) {
    if (
      available.has(effectId) &&
      targetOptions(room, actor.id, deps)
        .some(
          (entry) =>
            entry.targetKey ===
            targetKey
        )
    ) {
      state.redirectTargets[effectId] =
        targetKey;
    }
  }

  return { success: true };
}

function processGameAction(
  room,
  actor,
  action,
  legacy,
  deps
) {
  const type = String(
    action?.type || ""
  );

  if (
    type ===
    "replacement-v57-create"
  ) {
    return createShield(
      room,
      actor,
      action,
      deps
    );
  }

  if (
    type ===
    "replacement-v57-remove"
  ) {
    return removeShield(
      room,
      actor,
      action
    );
  }

  if (
    type ===
    "replacement-v57-preferences"
  ) {
    return savePreferences(
      room,
      actor,
      action,
      deps
    );
  }

  const result = legacy(
    room,
    actor,
    action
  );

  if (result?.success) {
    cleanExpiredShields(room);
  }
  return result;
}

function stateForViewer(
  room,
  viewerId,
  deps
) {
  cleanExpiredShields(room);
  const state = normalizeState(room);
  const allEffects = [
    ...parseStaticEffects(room, deps),
    ...manualEffects(room)
  ];

  const visibleEffects =
    allEffects.filter((effect) => {
      if (effect.manual) {
        return (
          effect.ownerPlayerId ===
            viewerId ||
          room.hostId === viewerId
        );
      }

      return (
        effect.controllerId ===
        viewerId ||
        room.hostId === viewerId
      );
    });

  const order =
    list(
      state.preferences[viewerId]
    );

  visibleEffects.sort(
    (first, second) => {
      const firstRank =
        order.indexOf(first.id);
      const secondRank =
        order.indexOf(second.id);

      if (
        firstRank >= 0 ||
        secondRank >= 0
      ) {
        return (
          (firstRank < 0
            ? 10000
            : firstRank) -
          (secondRank < 0
            ? 10000
            : secondRank)
        );
      }

      return String(
        first.label
      ).localeCompare(
        String(second.label)
      );
    }
  );

  return {
    success: true,
    version: "57.0.0",
    phase:
      deps.PHASES[
        room.turn?.phaseIndex || 0
      ] || "",
    effects: visibleEffects.map(
      (effect) => ({
        ...clone(effect),
        redirectTargetKey:
          effect.redirectTargetKey ||
          state.redirectTargets[
            effect.id
          ] ||
          ""
      })
    ),
    order: visibleEffects.map(
      (effect) => effect.id
    ),
    targets:
      targetOptions(
        room,
        viewerId,
        deps
      ),
    lastEvent:
      clone(state.lastEvent),
    history:
      state.history.slice(-40).reverse(),
    suppressLegacyDamageText:
      state.settings
        .suppressLegacyDamageText !== false
  };
}

function summary(room, deps) {
  const state = normalizeState(room);

  return {
    version: "57.0.0",
    activeManualEffects:
      state.shields.length,
    discoveredStaticEffects:
      parseStaticEffects(
        room,
        deps
      ).length,
    processedDamageEvents:
      state.history.length,
    legacyDamageTextSuppressed:
      state.settings
        .suppressLegacyDamageText !== false
  };
}

function createReplacementRulesEngine(
  deps
) {
  return {
    version: "57.0.0",

    processGameAction(
      room,
      actor,
      action,
      legacy
    ) {
      return processGameAction(
        room,
        actor,
        action,
        legacy,
        deps
      );
    },

    playerDamage(
      room,
      source,
      target,
      amount,
      legacyPlayer,
      legacyPermanent
    ) {
      return processDamageEvent(
        room,
        source,
        target,
        "player",
        amount,
        legacyPlayer,
        legacyPermanent,
        deps
      );
    },

    permanentDamage(
      room,
      source,
      target,
      amount,
      legacyPlayer,
      legacyPermanent
    ) {
      return processDamageEvent(
        room,
        source,
        target,
        "permanent",
        amount,
        legacyPlayer,
        legacyPermanent,
        deps
      );
    },

    state(room, viewerId) {
      return stateForViewer(
        room,
        viewerId,
        deps
      );
    },

    summary(room) {
      return summary(room, deps);
    },

    status() {
      return {
        success: true,
        version: "57.0.0",
        automatic: [
          "ordered damage replacement and prevention pipeline",
          "affected-player replacement preference order",
          "fixed prevention effects",
          "prevent-all effects",
          "combat-only and noncombat-only prevention",
          "damage multipliers",
          "half-damage replacements with rounding",
          "fixed and full damage redirection",
          "redirection through the replacement pipeline at the new destination",
          "damage that cannot be prevented",
          "protection preventing damage from common protected qualities",
          "common battlefield prevention wording",
          "common source-controller double and triple damage wording",
          "common self-source double and triple damage wording",
          "common damage-to-player redirection wording",
          "one-shot and turn-duration manual shields",
          "per-effect redirection target preferences",
          "legacy v45 damage-text suppression to avoid duplicate common replacements",
          "damage event history and transformation breakdown"
        ],
        assisted: [
          "replacement loops with mandatory choices that cannot be represented by a saved preference",
          "effects that redirect damage to a target chosen only as the event occurs",
          "effects that convert damage into counters, cards, life, poison, mill, or another resource",
          "prevention effects with variable values based on hidden information",
          "prevention shields divided among multiple simultaneous recipients",
          "protection from unusual characteristics, chosen values, or player identities",
          "simultaneous combat-damage ordering across several replacement effects",
          "card-specific replacement effects that also trigger follow-up actions"
        ]
      };
    }
  };
}

module.exports = {
  createReplacementRulesEngine,
  _test: {
    normalizeState,
    sourceColors,
    isCombatDamage,
    damageCantBePrevented,
    protectionQualities,
    protectionApplies,
    parseStaticEffects,
    targetMatches,
    applicableEffects,
    orderedEffects,
    createShield,
    removeShield,
    savePreferences,
    processDamageEvent,
    suppressLegacyDamageText,
    cleanExpiredShields
  }
};
