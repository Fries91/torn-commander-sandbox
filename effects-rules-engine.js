"use strict";

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

function numberFrom(value, fallback = 1) {
  const text = String(value || "").trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text);
  return NUMBER_WORDS[text] ?? fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeState(room) {
  room.effectsV45 = room.effectsV45 && typeof room.effectsV45 === "object"
    ? room.effectsV45
    : {};
  room.effectsV45.replacementChoices = list(room.effectsV45.replacementChoices)
    .filter((choice) => choice && choice.id && choice.status === "open")
    .slice(-30);
  room.effectsV45.preventionShields = list(room.effectsV45.preventionShields)
    .filter((shield) => shield && shield.id && Number(shield.amount) > 0)
    .slice(-100);
  return room.effectsV45;
}

function allBattlefield(room) {
  const output = [];
  for (const player of room.players || []) {
    for (const card of player.game?.battlefield || []) {
      output.push({ player, card });
    }
  }
  return output;
}

function parseAnthemEffects(room, deps) {
  const effects = [];

  for (const { player, card: source } of allBattlefield(room)) {
    if (source.phasedOut) continue;
    const text = String(deps.currentOracleText(source) || "");
    const sentences = text.split(/\.(?:\s|$)|\n/).map((entry) => entry.trim()).filter(Boolean);

    for (const sentence of sentences) {
      const stats = sentence.match(
        /^(other\s+)?(.+?)\s+(you control|your opponents control|all players control)?\s*get\s*([+-]\d+)\s*\/\s*([+-]\d+)/i
      );
      if (stats) {
        const subject = stats[2].trim();
        effects.push({
          id: `static:${source.id}:stats:${effects.length}`,
          sourceCardId: source.id,
          sourceName: source.name,
          controllerId: player.id,
          kind: "stats",
          subject,
          other: Boolean(stats[1]),
          relation: (stats[3] || "all").toLowerCase(),
          power: Number(stats[4]),
          toughness: Number(stats[5]),
          text: sentence
        });

        const trailingKeywords = sentence.match(/\band\s+(?:have|has)\s+(.+)$/i);
        if (trailingKeywords) {
          const granted = trailingKeywords[1]
            .split(/,\s*|\s+and\s+/)
            .map((entry) => entry.trim().toLowerCase())
            .filter((entry) =>
              /^(flying|first strike|double strike|deathtouch|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance|ward|defender)$/.test(entry)
            );
          for (const grantedKeyword of granted) {
            effects.push({
              id: `static:${source.id}:keyword:${grantedKeyword}:${effects.length}`,
              sourceCardId: source.id,
              sourceName: source.name,
              controllerId: player.id,
              kind: "keyword",
              subject,
              other: Boolean(stats[1]),
              relation: (stats[3] || "all").toLowerCase(),
              keyword: grantedKeyword,
              text: sentence
            });
          }
        }
      }

      const keyword = sentence.match(
        /^(other\s+)?(.+?)\s+(you control|your opponents control|all players control)?\s+(?:have|has)\s+(.+)$/i
      );
      if (keyword) {
        const granted = keyword[4]
          .split(/,\s*|\s+and\s+/)
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) =>
            /^(flying|first strike|double strike|deathtouch|haste|hexproof|indestructible|lifelink|menace|reach|trample|vigilance|ward|defender)$/.test(entry)
          );

        for (const grantedKeyword of granted) {
          effects.push({
            id: `static:${source.id}:keyword:${grantedKeyword}:${effects.length}`,
            sourceCardId: source.id,
            sourceName: source.name,
            controllerId: player.id,
            kind: "keyword",
            subject: keyword[2].trim(),
            other: Boolean(keyword[1]),
            relation: (keyword[3] || "all").toLowerCase(),
            keyword: grantedKeyword,
            text: sentence
          });
        }
      }
    }
  }

  return effects;
}

function subjectMatches(card, subject, deps) {
  const typeLine = String(deps.currentTypeLine(card) || "");
  const lower = String(subject || "").toLowerCase();

  if (/\bnonland\b/.test(lower) && /\bLand\b/i.test(typeLine)) return false;
  if (/\bnoncreature\b/.test(lower) && /\bCreature\b/i.test(typeLine)) return false;

  const tests = [];
  if (/\bcreature/.test(lower)) tests.push(/\bCreature\b/i.test(typeLine));
  if (/\bartifact/.test(lower)) tests.push(/\bArtifact\b/i.test(typeLine));
  if (/\benchantment/.test(lower)) tests.push(/\bEnchantment\b/i.test(typeLine));
  if (/\bland/.test(lower) && !/\bnonland/.test(lower)) tests.push(/\bLand\b/i.test(typeLine));
  if (/\bplaneswalker/.test(lower)) tests.push(/\bPlaneswalker\b/i.test(typeLine));
  if (/\bpermanent/.test(lower)) {
    tests.push(/\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/i.test(typeLine));
  }

  if (tests.length && !tests.some(Boolean)) return false;
  if (/\btoken/.test(lower) && !card.token) return false;
  if (/\bnontoken/.test(lower) && card.token) return false;
  if (/\blegendary/.test(lower) && !/\bLegendary\b/i.test(typeLine)) return false;

  return true;
}

function relationMatches(effect, card) {
  if (effect.relation === "you control") return card.controllerId === effect.controllerId;
  if (effect.relation === "your opponents control") return card.controllerId !== effect.controllerId;
  return true;
}

function applies(effect, card, deps) {
  if (!card || card.phasedOut) return false;
  if (effect.other && effect.sourceCardId === card.id) return false;
  if (!relationMatches(effect, card)) return false;
  return subjectMatches(card, effect.subject, deps);
}

function continuousForCard(room, card, deps) {
  return parseAnthemEffects(room, deps).filter((effect) => applies(effect, card, deps));
}

function modifyStats(room, card, base, deps) {
  const output = base ? { ...base } : null;
  if (!output) return output;

  for (const effect of continuousForCard(room, card, deps)) {
    if (effect.kind !== "stats") continue;
    output.power += effect.power;
    output.toughness += effect.toughness;
  }
  return output;
}

function grantsKeyword(room, card, keyword, deps) {
  return continuousForCard(room, card, deps).some(
    (effect) => effect.kind === "keyword" && effect.keyword === String(keyword || "").toLowerCase()
  );
}

function damageCannotBePrevented(source, deps) {
  return /\bdamage can'?t be prevented\b/i.test(String(deps.currentOracleText(source) || ""));
}

function sourceDamageMultiplier(room, source, targetPlayerId, deps) {
  if (!source) return 1;
  let multiplier = 1;

  for (const { player, card } of allBattlefield(room)) {
    if (card.phasedOut || player.id !== source.controllerId) continue;
    const text = String(deps.currentOracleText(card) || "");

    if (
      /if (?:a source|a permanent|a creature) you control would deal damage[^.]*it deals double that damage instead/i.test(text) ||
      /if you would deal damage[^.]*deal double that damage instead/i.test(text)
    ) {
      multiplier *= 2;
    }
    if (
      /if (?:a source|a permanent|a creature) you control would deal damage[^.]*it deals triple that damage instead/i.test(text)
    ) {
      multiplier *= 3;
    }
    if (
      targetPlayerId &&
      targetPlayerId !== player.id &&
      /if a source you control would deal damage to an opponent[^.]*double/i.test(text)
    ) {
      multiplier *= 2;
    }
  }

  return Math.min(multiplier, 64);
}

function preventionFromBattlefield(room, targetPlayer, combat, deps) {
  let prevent = 0;
  let all = false;

  for (const { player, card } of allBattlefield(room)) {
    if (card.phasedOut || player.id !== targetPlayer.id) continue;
    const text = String(deps.currentOracleText(card) || "");

    if (combat && /prevent all combat damage that would be dealt to you/i.test(text)) all = true;
    if (/prevent all damage that would be dealt to you/i.test(text)) all = true;

    for (const match of text.matchAll(
      /if (?:a source|a creature|an artifact) would deal damage to you[^.]*prevent\s+(\d+)\s+of that damage/gi
    )) {
      prevent += Number(match[1]) || 0;
    }
  }

  return { prevent, all };
}

function usePreventionShield(room, targetKey, amount) {
  const state = normalizeState(room);
  let remaining = amount;

  for (const shield of state.preventionShields) {
    if (shield.targetKey !== targetKey || remaining <= 0) continue;
    const prevented = Math.min(remaining, shield.amount);
    remaining -= prevented;
    shield.amount -= prevented;
  }

  state.preventionShields = state.preventionShields.filter((shield) => shield.amount > 0);
  return remaining;
}

function replaceDamage(room, source, target, amount, kind, combat, deps) {
  let next = Math.max(0, Number(amount) || 0);
  const targetPlayer = kind === "player"
    ? target
    : deps.findPlayer(room, target?.controllerId);

  next *= sourceDamageMultiplier(room, source, kind === "player" ? target.id : targetPlayer?.id, deps);
  if (damageCannotBePrevented(source, deps)) return Math.max(0, Math.floor(next));

  if (targetPlayer) {
    const prevention = preventionFromBattlefield(room, targetPlayer, combat, deps);
    if (prevention.all) next = 0;
    else next = Math.max(0, next - prevention.prevent);
  }

  const targetKey = kind === "player" ? `player:${target.id}` : `card:${target.id}`;
  next = usePreventionShield(room, targetKey, next);
  return Math.max(0, Math.floor(next));
}

function tokenMultiplier(room, controllerId, deps) {
  let multiplier = 1;
  for (const { player, card } of allBattlefield(room)) {
    if (player.id !== controllerId || card.phasedOut) continue;
    const text = String(deps.currentOracleText(card) || "");
    if (
      /if one or more tokens would be created under your control[^.]*twice that many/i.test(text) ||
      /create twice that many of those tokens instead/i.test(text)
    ) {
      multiplier *= 2;
    }
  }
  return Math.min(multiplier, 16);
}

function lifeGainMultiplier(room, playerId, deps) {
  let multiplier = 1;
  for (const { player, card } of allBattlefield(room)) {
    if (player.id !== playerId || card.phasedOut) continue;
    const text = String(deps.currentOracleText(card) || "");
    if (/if you would gain life[^.]*gain twice that much/i.test(text)) multiplier *= 2;
    if (/if you would gain life[^.]*gain three times that much/i.test(text)) multiplier *= 3;
  }
  return Math.min(multiplier, 64);
}

function applyEntryEffects(room, card, controller, deps) {
  const oracle = String(deps.currentOracleText(card) || "");

  if (
    /\benters(?: the battlefield)? tapped\b/i.test(oracle) &&
    !/\bunless\b|\byou may pay\b|\bif you don'?t\b/i.test(oracle)
  ) {
    card.tapped = true;
  }

  for (const match of oracle.matchAll(
    /enters(?: the battlefield)? with\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\+1\/\+1 counters?/gi
  )) {
    const amount = numberFrom(match[1], 1);
    card.counters = card.counters || {};
    card.counters["+1/+1"] = (Number(card.counters["+1/+1"]) || 0) + amount;
  }

  for (const { player, card: source } of allBattlefield(room)) {
    if (source.id === card.id || source.phasedOut) continue;
    const text = String(deps.currentOracleText(source) || "");

    if (
      player.id !== controller.id &&
      /\bcreatures your opponents control enter(?: the battlefield)? tapped\b/i.test(text) &&
      deps.isCreatureCard(card)
    ) {
      card.tapped = true;
    }
  }
}

function shockLifeChoice(card, deps) {
  const oracle = String(deps.currentOracleText(card) || "");
  const match = oracle.match(
    /as [^.]+ enters(?: the battlefield)?, you may pay\s+(\d+)\s+life\. if you don'?t, it enters tapped/i
  );
  return match ? Number(match[1]) : 0;
}

function createReplacementChoice(room, actor, action, card, lifeCost, deps) {
  const state = normalizeState(room);
  const choice = {
    id: deps.createId(),
    status: "open",
    createdAt: deps.nowIso(),
    playerId: actor.id,
    kind: "pay-life-or-tapped",
    sourceName: card.name,
    lifeCost,
    deferredAction: JSON.parse(JSON.stringify(action))
  };
  state.replacementChoices.push(choice);
  return choice;
}

function pendingChoices(room) {
  return normalizeState(room).replacementChoices;
}

function resolveReplacement(room, actor, action, legacy, deps) {
  const state = normalizeState(room);
  const choice = state.replacementChoices.find((entry) => entry.id === action?.choiceId);
  if (!choice) return { success: false, error: "That replacement choice is no longer available." };
  if (choice.playerId !== actor.id) return { success: false, error: "That replacement choice belongs to another player." };

  if (action?.payLife) {
    if (actor.game.life <= choice.lifeCost) return { success: false, error: "You do not have enough life." };
    actor.game.life -= choice.lifeCost;
  }

  const result = legacy(room, actor, choice.deferredAction);
  if (!result?.success) return result;

  const card = actor.game.battlefield.find(
    (entry) => entry.id === choice.deferredAction.cardId
  );
  if (card) {
    if (!action?.payLife) card.tapped = true;
    applyEntryEffects(room, card, actor, deps);
  }

  choice.status = "resolved";
  state.replacementChoices = state.replacementChoices.filter((entry) => entry.status === "open");
  deps.addLog(
    room,
    `${actor.name} ${action?.payLife ? `paid ${choice.lifeCost} life` : "let the permanent enter tapped"} for ${choice.sourceName}.`,
    "replacement"
  );
  return { success: true };
}

function effectsSnapshot(room, viewerId, deps) {
  const effects = parseAnthemEffects(room, deps);
  return {
    effects,
    preventionShields: normalizeState(room).preventionShields.filter((shield) =>
      shield.ownerId === viewerId || room.hostId === viewerId
    ),
    affectedCards: allBattlefield(room).map(({ card }) => ({
      cardId: card.id,
      effects: effects.filter((effect) => applies(effect, card, deps)).map((effect) => effect.id)
    }))
  };
}

function createEffectsRulesEngine(deps) {
  return {
    version: "45.0.0",

    effectiveStats(room, card, legacy) {
      return modifyStats(room, card, legacy(card), deps);
    },

    hasKeyword(room, card, keyword, legacy) {
      return legacy(card, keyword) || grantsKeyword(room, card, keyword, deps);
    },

    playerDamage(room, source, target, amount, combat, legacy) {
      return legacy(room, source, target, replaceDamage(room, source, target, amount, "player", combat, deps));
    },

    creatureDamage(room, source, target, amount, combat, legacy) {
      return legacy(room, source, target, replaceDamage(room, source, target, amount, "card", combat, deps));
    },

    processGameAction(room, actor, action, legacy) {
      const type = String(action?.type || "");

      if (type === "resolve-replacement") {
        return resolveReplacement(room, actor, action, legacy, deps);
      }

      const pending = pendingChoices(room);
      if (pending.length && !["judge-action", "undo-last", "check-state-based"].includes(type)) {
        const player = deps.findPlayer(room, pending[0].playerId);
        return {
          success: false,
          error: `${player?.name || "A player"} must finish an enters-the-battlefield choice.`
        };
      }

      if (
        type === "move-card" &&
        action?.toZone === "battlefield" &&
        action?.fromZone === "hand"
      ) {
        const located = deps.getCardFromZone(actor.game, "hand", String(action?.cardId || ""));
        const lifeCost = located?.card ? shockLifeChoice(located.card, deps) : 0;
        if (located?.card && lifeCost > 0 && !action?.replacementResolved) {
          createReplacementChoice(room, actor, { ...action, replacementResolved: true }, located.card, lifeCost, deps);
          return { success: true, pendingReplacement: true };
        }
      }

      const beforeTokens = actor.game?.battlefield?.filter((card) => card.token).map((card) => card.id) || [];
      const result = legacy(room, actor, action);
      if (!result?.success) return result;

      if (type === "move-card" && action?.toZone === "battlefield") {
        const card = actor.game.battlefield.find((entry) => entry.id === action.cardId);
        if (card) applyEntryEffects(room, card, actor, deps);
      }

      if (type === "create-token") {
        const multiplier = tokenMultiplier(room, actor.id, deps);
        if (multiplier > 1) {
          const newTokens = actor.game.battlefield.filter(
            (card) => card.token && !beforeTokens.includes(card.id)
          );
          for (const token of newTokens) {
            for (let index = 1; index < multiplier; index += 1) {
              const copy = deps.migrateCard({
                ...JSON.parse(JSON.stringify(token)),
                id: deps.createId(),
                copiedFromCardId: token.id
              }, actor.id);
              actor.game.battlefield.unshift(copy);
            }
          }
        }
      }

      return result;
    },

    afterResolveStack(room, beforeIds, legacyResult) {
      const before = new Set(beforeIds);
      for (const player of room.players || []) {
        for (const card of player.game?.battlefield || []) {
          if (!before.has(card.id)) applyEntryEffects(room, card, player, deps);
        }
      }
      return legacyResult;
    },

    applySimpleEffect(room, item, legacy) {
      const effect = item?.effect;
      if (effect?.action === "gain-life") {
        const controller = deps.findPlayer(room, item.controllerId);
        const original = Number(effect.amount) || 1;
        effect.amount = original * lifeGainMultiplier(room, controller?.id, deps);
        const result = legacy(room, item);
        effect.amount = original;
        return result;
      }

      if (effect?.action === "token") {
        const controller = deps.findPlayer(room, item.controllerId);
        const before = controller?.game?.battlefield?.filter((card) => card.token).map((card) => card.id) || [];
        const result = legacy(room, item);
        const multiplier = tokenMultiplier(room, controller?.id, deps);
        if (controller && multiplier > 1) {
          const newTokens = controller.game.battlefield.filter(
            (card) => card.token && !before.includes(card.id)
          );
          for (const token of newTokens) {
            for (let index = 1; index < multiplier; index += 1) {
              controller.game.battlefield.unshift(
                deps.migrateCard({
                  ...JSON.parse(JSON.stringify(token)),
                  id: deps.createId(),
                  copiedFromCardId: token.id
                }, controller.id)
              );
            }
          }
        }
        return result;
      }

      return legacy(room, item);
    },

    pending(room, viewerId) {
      return pendingChoices(room)
        .filter((choice) => choice.playerId === viewerId)
        .map((choice) => ({
          id: choice.id,
          kind: choice.kind,
          sourceName: choice.sourceName,
          lifeCost: choice.lifeCost
        }));
    },

    snapshot(room, viewerId) {
      return effectsSnapshot(room, viewerId, deps);
    },

    status() {
      return {
        success: true,
        version: "45.0.0",
        automatic: [
          "creature anthem power and toughness effects",
          "common static keyword-grant effects",
          "other-creature and controller relationships",
          "double and triple damage replacement effects",
          "common player damage prevention",
          "prevention shields",
          "unconditional enters-tapped text",
          "enters with +1/+1 counters",
          "opponents' creatures enter tapped",
          "shock-land pay-life or enter-tapped prompt",
          "common token-doubling effects",
          "common life-gain doubling effects"
        ],
        assisted: [
          "full Magic continuous-effect layer ordering",
          "dependency and timestamp conflicts",
          "copy effects inside layers",
          "draw replacement effects",
          "complex prevention redirection",
          "replacement effects with multiple affected players",
          "choice-based static effects"
        ]
      };
    }
  };
}

module.exports = {
  createEffectsRulesEngine,
  _test: {
    parseAnthemEffects,
    continuousForCard,
    modifyStats,
    grantsKeyword,
    replaceDamage,
    shockLifeChoice,
    applyEntryEffects,
    tokenMultiplier,
    lifeGainMultiplier
  }
};
