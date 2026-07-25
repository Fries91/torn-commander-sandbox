"use strict";

const path = require("path");
const Module = require("module");

const SERVER_PATH = path.resolve(__dirname, "server.js");
const VERSION = "62.2.0";
const MARKER = "Arena Commander v62 automated gameplay integration";

function injectGameplayAutomationV62(sourceInput) {
  const source = String(sourceInput || "");
  if (source.includes(MARKER)) return source;

  const integration = String.raw`

// ---- ${MARKER} ----
(() => {
  const {
    analyzeOracleText: v62AnalyzeOracleText,
    normalizeAutomation: v62NormalizeAutomation
  } = require("./card-automation-engine");

  const V62_VERSION = "${VERSION}";
  const V62_EVENT_LIMIT = 80;
  const V62_PHASES = Array.isArray(PHASES) ? PHASES : [];
  const V62_KEYWORDS = [
    "deathtouch", "defender", "double strike", "first strike", "flying",
    "haste", "hexproof", "indestructible", "lifelink", "menace", "reach",
    "trample", "vigilance"
  ];

  function v62State(room) {
    room.gameplayV62 = room.gameplayV62 && typeof room.gameplayV62 === "object"
      ? room.gameplayV62
      : {};
    const state = room.gameplayV62;
    state.version = V62_VERSION;
    state.events = Array.isArray(state.events) ? state.events : [];
    state.autoPass = state.autoPass && typeof state.autoPass === "object" ? state.autoPass : {};
    state.recentKeys = state.recentKeys && typeof state.recentKeys === "object" ? state.recentKeys : {};
    state.phaseHistory = Array.isArray(state.phaseHistory) ? state.phaseHistory : [];
    return state;
  }

  function v62PhaseName(room) {
    return String(V62_PHASES[Number(room?.turn?.phaseIndex || 0)] || "");
  }

  function v62Clean(value, limit = 2500) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function v62CardOracle(card) {
    const faces = card?.cardData?.faces || [];
    const raw = String(
      currentOracleText(card) ||
      card?.cardData?.oracleText ||
      faces.map((face) => face?.oracleText || "").filter(Boolean).join("\n")
    ).replace(/\r/g, "");
    return raw.split(/\n+/).map((line) => v62Clean(line)).filter(Boolean).join("\n");
  }

  function v62CurrentType(card) {
    return String(currentTypeLine(card) || "");
  }

  function v62RoomForCard(card) {
    if (!card?.id) return null;
    for (const room of rooms.values()) {
      for (const player of room.players || []) {
        if ((player.game?.battlefield || []).some((entry) => entry.id === card.id)) return room;
      }
    }
    return null;
  }

  function v62EventKey(room, type, context = {}) {
    return [
      Number(room?.turn?.number || 0),
      Number(room?.turn?.phaseIndex || 0),
      type,
      context?.card?.id || context?.sourceCardId || "",
      context?.targetCard?.id || context?.targetCardId || "",
      context?.targetPlayerId || context?.controllerId || "",
      context?.amount || ""
    ].join(":");
  }

  function v62RecordEvent(room, type, context = {}, dedupe = true) {
    const state = v62State(room);
    const key = v62EventKey(room, type, context);
    const now = Date.now();
    for (const [oldKey, timestamp] of Object.entries(state.recentKeys)) {
      if (now - Number(timestamp || 0) > 3500) delete state.recentKeys[oldKey];
    }
    if (dedupe && state.recentKeys[key]) return false;
    state.recentKeys[key] = now;
    state.events.push({
      id: createId(),
      time: nowIso(),
      type,
      turn: Number(room?.turn?.number || 0),
      phase: v62PhaseName(room),
      controllerId: context?.controllerId || context?.card?.controllerId || null,
      cardId: context?.card?.id || context?.sourceCardId || null,
      cardName: context?.card?.name || context?.sourceName || null,
      targetPlayerId: context?.targetPlayerId || null,
      targetCardId: context?.targetCard?.id || context?.targetCardId || null,
      amount: Number(context?.amount || 0) || 0
    });
    if (state.events.length > V62_EVENT_LIMIT) {
      state.events.splice(0, state.events.length - V62_EVENT_LIMIT);
    }
    return true;
  }

  function v62Snapshot(room) {
    const players = new Map();
    for (const player of room?.players || []) {
      players.set(String(player.id), {
        life: Number(player.game?.life || 0),
        hand: Number(player.game?.hand?.length || 0),
        battlefield: new Map((player.game?.battlefield || []).map((card) => [card.id, JSON.parse(JSON.stringify(card))])),
        graveyard: new Set((player.game?.graveyard || []).map((card) => card.id)),
        exile: new Set((player.game?.exile || []).map((card) => card.id))
      });
    }
    return players;
  }

  function v62AbilityEffectText(line) {
    const text = String(line || "");
    const comma = text.indexOf(",");
    return v62Clean(comma >= 0 ? text.slice(comma + 1) : text);
  }

  function v62AutomationForEffect(effectText, needsChoice = false) {
    const analysis = v62AnalyzeOracleText(effectText);
    const abilities = Array.isArray(analysis?.abilities) ? analysis.abilities : [];
    const actions = abilities.flatMap((ability) => ability.actions || []);
    const level = actions.length && abilities.every((ability) => ability.level === "full") && !needsChoice
      ? "full"
      : actions.length
        ? "assisted"
        : "manual";
    return v62NormalizeAutomation({
      level,
      sourceText: effectText,
      event: "V62",
      actions,
      needsChoice: needsChoice || abilities.some((ability) => ability.needsChoice)
    });
  }

  function v62ExtendedEventForLine(line) {
    const text = String(line || "").toLowerCase();
    if (/^at the beginning of combat/.test(text)) return "BEGIN_COMBAT";
    if (/^(when|whenever) .*draws? (a|one) card/.test(text) || /^whenever you draw/.test(text)) return "CARD_DRAWN";
    if (/^whenever .*gain[s]? life/.test(text)) return "LIFE_GAINED";
    if (/^whenever .*lose[s]? life/.test(text)) return "LIFE_LOST";
    if (/^(when|whenever) .*blocks?\b/.test(text)) return "BLOCKS";
    if (/^(when|whenever) .*becomes blocked/.test(text)) return "BECOMES_BLOCKED";
    if (/^(when|whenever) .*deals combat damage to (a player|an opponent)/.test(text)) return "COMBAT_DAMAGE_PLAYER";
    if (/^(when|whenever) .*deals damage/.test(text)) return "DAMAGE_DEALT";
    if (/^(when|whenever) .*leaves the battlefield/.test(text)) return "LEAVES_BATTLEFIELD";
    return null;
  }

  function v62ExtendedTriggerMatches(line, event, source, context, room) {
    const text = String(line || "").toLowerCase();
    if (event === "BEGIN_COMBAT") {
      if (/your turn/.test(text)) return source.controllerId === room.turn?.activePlayerId;
      if (/an opponent'?s turn/.test(text)) return source.controllerId !== room.turn?.activePlayerId;
      return true;
    }
    if (event === "CARD_DRAWN") {
      if (/you draw/.test(text)) return source.controllerId === context.controllerId;
      if (/opponent draws/.test(text)) return source.controllerId !== context.controllerId;
      return true;
    }
    if (event === "LIFE_GAINED" || event === "LIFE_LOST") {
      if (/you gain|you lose/.test(text)) return source.controllerId === context.controllerId;
      if (/opponent gains|opponent loses/.test(text)) return source.controllerId !== context.controllerId;
      return true;
    }
    if (event === "BLOCKS") {
      if (!context.card) return false;
      if (/this creature blocks|whenever [^,]+ blocks/.test(text) && !/a creature|one or more/.test(text)) return source.id === context.card.id;
      if (/you control/.test(text)) return source.controllerId === context.card.controllerId;
      return true;
    }
    if (event === "BECOMES_BLOCKED") {
      if (!context.card) return false;
      if (/this creature becomes blocked|whenever [^,]+ becomes blocked/.test(text)) return source.id === context.card.id;
      return true;
    }
    if (event === "COMBAT_DAMAGE_PLAYER" || event === "DAMAGE_DEALT") {
      if (!context.card) return false;
      if (/this creature|whenever [^,]+ deals/.test(text) && !/a creature|one or more|creatures you control/.test(text)) return source.id === context.card.id;
      if (/you control/.test(text)) return source.controllerId === context.card.controllerId;
      return true;
    }
    if (event === "LEAVES_BATTLEFIELD") {
      if (!context.card) return false;
      if (/this permanent|this creature|when [^,]+ leaves/.test(text) && !/another|a permanent|a creature/.test(text)) return source.id === context.card.id;
      return true;
    }
    return true;
  }

  function v62QueueExtendedTriggers(room, event, context = {}) {
    const dedupe = ["BEGIN_COMBAT", "BLOCKS", "BECOMES_BLOCKED", "LEAVES_BATTLEFIELD"].includes(event);
    if (!v62RecordEvent(room, event, context, dedupe)) return 0;
    let queued = 0;
    for (const player of room.players || []) {
      for (const source of player.game?.battlefield || []) {
        if (source.phasedOut) continue;
        const lines = v62CardOracle(source).split(/\n+/).map((line) => line.trim()).filter(Boolean);
        for (const line of lines) {
          if (v62ExtendedEventForLine(line) !== event) continue;
          if (!v62ExtendedTriggerMatches(line, event, source, context, room)) continue;
          const effectText = v62AbilityEffectText(line);
          const needsChoice = /\bmay\b|\btarget\b|\bchoose\b|\bscry\b|\bsurveil\b|\bsearch\b|\breveal\b|\bunless\b|\bfor each\b|\bx\b/i.test(effectText);
          const automation = v62AutomationForEffect(effectText, needsChoice);
          const triggerData = {
            controllerId: source.controllerId,
            sourceCardId: source.id,
            sourceName: source.name,
            event,
            text: line,
            targets: [],
            automation,
            createdAt: nowIso()
          };
          if (automation?.level === "full" && automation.actions?.length && !automation.needsChoice) {
            pushStack(room, {
              kind: "trigger",
              name: source.name + " trigger",
              controllerId: source.controllerId,
              sourceCardId: source.id,
              text: line,
              targets: [],
              automation
            }, source.controllerId);
            addLog(room, source.name + " triggered automatically.", "trigger");
          } else {
            queueTrigger(room, triggerData);
            addLog(room, source.name + " has a choice or target waiting.", "trigger");
          }
          queued += 1;
        }
      }
    }
    return queued;
  }

  function v62DetectChanges(room, before, reason) {
    if (!before) return;
    for (const player of room.players || []) {
      const old = before.get(String(player.id));
      if (!old || !player.game) continue;
      const handDifference = player.game.hand.length - old.hand;
      if (handDifference > 0) {
        v62QueueExtendedTriggers(room, "CARD_DRAWN", {
          controllerId: player.id,
          amount: handDifference,
          reason
        });
      }
      const lifeDifference = Number(player.game.life || 0) - old.life;
      if (lifeDifference > 0) {
        v62QueueExtendedTriggers(room, "LIFE_GAINED", {
          controllerId: player.id,
          amount: lifeDifference,
          reason
        });
      }
      if (lifeDifference < 0) {
        v62QueueExtendedTriggers(room, "LIFE_LOST", {
          controllerId: player.id,
          amount: Math.abs(lifeDifference),
          reason
        });
      }

      const newBattlefield = new Map((player.game.battlefield || []).map((card) => [card.id, card]));
      for (const [cardId, card] of newBattlefield) {
        if (!old.battlefield.has(cardId)) {
          if (v62RecordEvent(room, "PERMANENT_ENTERED", { card, controllerId: card.controllerId }, true)) {
            queueSuggestedTriggers(room, "PERMANENT_ENTERED", { card, controllerId: card.controllerId });
          }
        }
      }
      for (const [cardId, card] of old.battlefield) {
        if (newBattlefield.has(cardId)) continue;
        v62QueueExtendedTriggers(room, "LEAVES_BATTLEFIELD", { card, controllerId: card.controllerId, reason });
        const nowInGraveyard = (player.game.graveyard || []).some((entry) => entry.id === cardId);
        if (nowInGraveyard && isCreatureCard(card)) {
          if (v62RecordEvent(room, "CREATURE_DIED", { card, controllerId: card.controllerId }, true)) {
            queueSuggestedTriggers(room, "CREATURE_DIED", { card, controllerId: card.controllerId });
          }
        }
      }
    }
  }

  function v62ApnapOrder(room) {
    const ids = activePlayerIds(room);
    const activeId = room.turn?.activePlayerId;
    const start = Math.max(0, ids.indexOf(activeId));
    return ids.slice(start).concat(ids.slice(0, start));
  }

  function v62ReorderNewObjects(room, stackStart, triggerStart) {
    const newStack = room.stack.splice(stackStart);
    const newTriggers = room.triggerQueue.splice(triggerStart);
    if (!newStack.length && !newTriggers.length) return;
    const rank = new Map(v62ApnapOrder(room).map((id, index) => [id, index]));
    const stableSort = (items) => items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (rank.get(a.item.controllerId) ?? 999) - (rank.get(b.item.controllerId) ?? 999) || a.index - b.index)
      .map((entry) => entry.item);
    room.stack.push(...stableSort(newStack));
    room.triggerQueue.push(...stableSort(newTriggers));
    if (newStack.length) resetPriority(room, room.turn?.activePlayerId);
  }

  function v62ParseManaSymbols(text) {
    const result = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, generic: 0, unsupported: [] };
    for (const symbol of String(text || "").match(/\{[^}]+\}/g) || []) {
      const value = symbol.slice(1, -1).toUpperCase();
      if (Object.prototype.hasOwnProperty.call(result, value) && value !== "generic" && value !== "unsupported") result[value] += 1;
      else if (/^\d+$/.test(value)) result.generic += Number(value);
      else if (!["T", "Q"].includes(value)) result.unsupported.push(value);
    }
    return result;
  }

  function v62TargetMode(actions) {
    const modes = (actions || []).map((action) => action.target).filter(Boolean);
    return modes.find((mode) => /^target-|any-target$/.test(mode)) || "";
  }

  function v62ParseActivatedAbilities(card) {
    const lines = v62CardOracle(card).split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const abilities = [];
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon <= 0) continue;
      const costText = v62Clean(line.slice(0, colon), 500);
      const effectText = v62Clean(line.slice(colon + 1), 1800);
      if (!effectText) continue;
      const analysis = v62AnalyzeOracleText(effectText);
      const parsed = Array.isArray(analysis?.abilities) ? analysis.abilities : [];
      const actions = parsed.flatMap((ability) => ability.actions || []);
      const mana = v62ParseManaSymbols(costText);
      const tapCost = /\{T\}|\btap\b/i.test(costText);
      const untapCost = /\{Q\}/i.test(costText);
      const lifeMatch = costText.match(/pay\s+(\d+)\s+life/i);
      const discardCost = /discard\s+(a|one)\s+card/i.test(costText);
      const sacrificeSelf = /sacrifice\s+(this permanent|this creature|this artifact|this enchantment|~)/i.test(costText) ||
        (card?.name && costText.toLowerCase().includes("sacrifice " + String(card.name).toLowerCase()));
      const sacrificeOther = /sacrifice\s+(a|another)\s+(creature|permanent|artifact|land|enchantment)/i.test(costText);
      const addSymbols = effectText.match(/add\s+((?:\{[WUBRGC]\})+)/i);
      const fixedManaAbility = Boolean(addSymbols) && !/target/i.test(effectText);
      const addMana = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      if (addSymbols) {
        for (const symbol of addSymbols[1].match(/\{[WUBRGC]\}/gi) || []) addMana[symbol.slice(1, -1).toUpperCase()] += 1;
      }
      const needsChoice = parsed.some((ability) => ability.needsChoice) || discardCost || sacrificeOther || mana.unsupported.length > 0 || /\bchoose\b|\bany color\b|\bX\b/.test(effectText);
      const level = actions.length && !needsChoice ? "full" : actions.length || fixedManaAbility ? "assisted" : "manual";
      abilities.push({
        id: "ability-" + abilities.length,
        index: abilities.length,
        text: line,
        costText,
        effectText,
        actions,
        automation: v62NormalizeAutomation({ level, sourceText: effectText, event: "ACTIVATED", actions, needsChoice }),
        level,
        tapCost,
        untapCost,
        lifeCost: lifeMatch ? Number(lifeMatch[1]) : 0,
        discardCost,
        sacrificeSelf,
        sacrificeOther,
        manaCost: mana,
        manaAbility: fixedManaAbility,
        addMana,
        targetMode: v62TargetMode(actions),
        needsChoice
      });
    }
    return abilities;
  }

  function v62PayManaCost(player, manaCost) {
    const pool = player?.game?.manaPool;
    if (!pool) return { success: false, error: "Mana pool is unavailable." };
    if ((manaCost?.unsupported || []).length) return { success: false, error: "That ability has a mana symbol requiring an assisted choice." };
    const next = { ...pool };
    for (const symbol of ["W", "U", "B", "R", "G", "C"]) {
      const needed = Number(manaCost?.[symbol] || 0);
      if (Number(next[symbol] || 0) < needed) return { success: false, error: "Not enough " + symbol + " mana." };
      next[symbol] -= needed;
    }
    let generic = Number(manaCost?.generic || 0);
    for (const symbol of ["C", "W", "U", "B", "R", "G"]) {
      const used = Math.min(generic, Number(next[symbol] || 0));
      next[symbol] -= used;
      generic -= used;
    }
    if (generic > 0) return { success: false, error: "Not enough mana for the generic cost." };
    player.game.manaPool = next;
    return { success: true };
  }

  function v62AbilityTargetsSatisfied(ability, targets) {
    if (!ability?.targetMode) return true;
    const list = Array.isArray(targets) ? targets : [];
    if (ability.targetMode.startsWith("target-player") || ability.targetMode === "target-opponent") return list.some((target) => String(target).startsWith("player:"));
    return list.some((target) => String(target).startsWith("card:"));
  }

  function v62ActivateAbility(room, actor, payload) {
    const located = locateCard(room, String(payload?.cardId || ""));
    if (!located || located.zone !== "battlefield" || located.card.controllerId !== actor.id) return { success: false, error: "You no longer control that permanent." };
    const abilities = v62ParseActivatedAbilities(located.card);
    const ability = abilities[Number(payload?.abilityIndex)];
    if (!ability) return { success: false, error: "That activated ability was not found." };
    if (ability.untapCost) return { success: false, error: "Untap-symbol costs remain assisted." };
    if (ability.tapCost) {
      if (located.card.tapped) return { success: false, error: "That permanent is already tapped." };
      if (isCreatureCard(located.card) && located.card.summoningSick && !hasKeyword(located.card, "haste")) return { success: false, error: "That creature has summoning sickness." };
    }
    if (ability.lifeCost > 0 && Number(actor.game.life || 0) <= ability.lifeCost) return { success: false, error: "You cannot pay that life cost." };
    if (ability.discardCost) {
      const discard = getCardFromZone(actor.game, "hand", String(payload?.discardCardId || ""));
      if (!discard) return { success: false, error: "Choose a card to discard for the cost." };
    }
    if (ability.sacrificeOther) {
      const sacrifice = controlledBattlefieldCard(room, actor, String(payload?.sacrificeCardId || ""));
      if (!sacrifice || sacrifice.card.id === located.card.id) return { success: false, error: "Choose another permanent to sacrifice." };
    }
    if (!v62AbilityTargetsSatisfied(ability, payload?.targets)) return { success: false, error: "Choose a legal target for that ability." };

    const paidMana = v62PayManaCost(actor, ability.manaCost);
    if (!paidMana.success) return paidMana;
    if (ability.lifeCost > 0) actor.game.life = clamp(actor.game.life - ability.lifeCost, -999, 9999);
    if (ability.tapCost) located.card.tapped = true;
    if (ability.discardCost) moveCard(actor, "hand", "graveyard", String(payload.discardCardId));
    if (ability.sacrificeOther) {
      const sacrifice = controlledBattlefieldCard(room, actor, String(payload.sacrificeCardId));
      if (sacrifice) {
        const [card] = sacrifice.player.game.battlefield.splice(sacrifice.index, 1);
        if (!card.token) (findPlayer(room, card.ownerId) || sacrifice.player).game.graveyard.unshift(card);
        if (isCreatureCard(card)) queueSuggestedTriggers(room, "CREATURE_DIED", { card, controllerId: card.controllerId });
      }
    }

    if (ability.manaAbility) {
      for (const symbol of ["W", "U", "B", "R", "G", "C"]) actor.game.manaPool[symbol] = clamp(Number(actor.game.manaPool[symbol] || 0) + Number(ability.addMana[symbol] || 0), 0, 999);
      addLog(room, actor.name + " activated " + located.card.name + " as a mana ability.", "mana");
    } else {
      pushStack(room, {
        kind: "ability",
        name: located.card.name + " ability",
        controllerId: actor.id,
        sourceCardId: located.card.id,
        text: ability.text,
        targets: validateTargets(room, payload?.targets),
        automation: ability.automation,
        createdAt: nowIso()
      }, actor.id);
      addLog(room, actor.name + " activated " + located.card.name + ".", "stack");
    }

    if (ability.sacrificeSelf) {
      const current = controlledBattlefieldCard(room, actor, located.card.id);
      if (current) {
        const [card] = current.player.game.battlefield.splice(current.index, 1);
        if (!card.token) (findPlayer(room, card.ownerId) || current.player).game.graveyard.unshift(card);
        if (isCreatureCard(card)) queueSuggestedTriggers(room, "CREATURE_DIED", { card, controllerId: card.controllerId });
      }
    }
    return { success: true, manaAbility: ability.manaAbility, ability: ability.text };
  }

  function v62TargetCardMatches(card, descriptor) {
    const type = v62CurrentType(card).toLowerCase();
    if (descriptor === "target-creature") return isCreatureCard(card);
    if (descriptor === "target-permanent" || descriptor === "any-target") return true;
    if (descriptor.includes("artifact")) return /artifact/.test(type);
    if (descriptor.includes("enchantment")) return /enchantment/.test(type);
    return true;
  }

  function v62ResolveTriggerChoice(room, actor, payload) {
    const index = room.triggerQueue.findIndex((trigger) => trigger.id === payload?.triggerId);
    if (index < 0) return { success: false, error: "That trigger is no longer waiting." };
    const trigger = room.triggerQueue[index];
    if (trigger.controllerId !== actor.id && room.hostId !== actor.id) return { success: false, error: "Only its controller or host can make that choice." };
    if (payload?.declined) {
      room.triggerQueue.splice(index, 1);
      addLog(room, actor.name + " declined " + trigger.sourceName + "'s optional trigger.", "trigger");
      return { success: true, declined: true };
    }
    const targets = validateTargets(room, payload?.targets);
    const actions = trigger.automation?.actions || [];
    const targetModes = actions.map((action) => action.target).filter((target) => /^target-|any-target$/.test(target || ""));
    if (targetModes.length && !targets.length && !payload?.manual) return { success: false, error: "Choose a target before putting that trigger on the stack." };
    if (targets.length) {
      for (const target of targets) {
        if (!target.startsWith("card:")) continue;
        const located = locateCard(room, target.slice(5));
        if (!located || !targetModes.every((mode) => v62TargetCardMatches(located.card, mode))) return { success: false, error: "That card is not a legal target." };
      }
    }
    room.triggerQueue.splice(index, 1);
    pushStack(room, {
      kind: "trigger",
      name: trigger.sourceName + " trigger",
      controllerId: trigger.controllerId,
      sourceCardId: trigger.sourceCardId,
      text: trigger.text,
      targets,
      automation: payload?.manual ? null : trigger.automation,
      createdAt: nowIso()
    }, trigger.controllerId);
    addLog(room, actor.name + " put " + trigger.sourceName + "'s trigger on the stack.", "trigger");
    return { success: true };
  }

  function v62StaticRuleSources(room, targetCard) {
    const result = [];
    for (const player of room?.players || []) {
      for (const source of player.game?.battlefield || []) {
        if (!source.phasedOut) result.push(source);
      }
    }
    return result;
  }

  function v62StaticTargetMatches(source, target, line) {
    const lower = line.toLowerCase();
    if (/you control/.test(lower) && source.controllerId !== target.controllerId) return false;
    if (/your opponents control/.test(lower) && source.controllerId === target.controllerId) return false;
    if (/other/.test(lower) && source.id === target.id) return false;
    if (/creatures?/.test(lower) && !isCreatureCard(target)) return false;
    const subtype = lower.match(/(?:other\s+)?([a-z][a-z-]+) creatures? (?:you|your opponents)/);
    if (subtype && !v62CurrentType(target).toLowerCase().includes(subtype[1])) return false;
    return true;
  }

  const v62LegacyEffectiveStats = effectiveStats;
  effectiveStats = function gameplayV62EffectiveStats(card) {
    const base = v62LegacyEffectiveStats(card);
    if (!base) return base;
    const room = v62RoomForCard(card);
    if (!room) return base;
    let power = Number(base.power || 0);
    let toughness = Number(base.toughness || 0);
    for (const source of v62StaticRuleSources(room, card)) {
      for (const line of v62CardOracle(source).split(/\n+/)) {
        const match = line.match(/(?:other\s+)?(?:[A-Za-z-]+\s+)?creatures? (?:you|your opponents) control get ([+-]\d+)\/([+-]\d+)/i);
        if (!match || !v62StaticTargetMatches(source, card, line)) continue;
        power += Number(match[1]);
        toughness += Number(match[2]);
      }
    }
    return { power: clamp(power, -99, 999), toughness: clamp(toughness, -99, 999) };
  };

  const v62LegacyKeywordSet = keywordSet;
  keywordSet = function gameplayV62KeywordSet(card) {
    const result = new Set(v62LegacyKeywordSet(card));
    const room = v62RoomForCard(card);
    if (!room) return result;
    for (const source of v62StaticRuleSources(room, card)) {
      for (const line of v62CardOracle(source).split(/\n+/)) {
        if (!/(?:other\s+)?(?:[A-Za-z-]+\s+)?creatures? (?:you|your opponents) control (?:have|gain)/i.test(line)) continue;
        if (!v62StaticTargetMatches(source, card, line)) continue;
        const lower = line.toLowerCase();
        for (const keyword of V62_KEYWORDS) if (lower.includes(keyword)) result.add(keyword);
      }
    }
    return result;
  };

  const v62LegacyPublicCard = publicCard;
  publicCard = function gameplayV62PublicCard(card) {
    const result = v62LegacyPublicCard(card);
    result.v62Abilities = v62ParseActivatedAbilities(card).map((ability) => ({
      id: ability.id,
      index: ability.index,
      text: ability.text,
      costText: ability.costText,
      effectText: ability.effectText,
      level: ability.level,
      tapCost: ability.tapCost,
      lifeCost: ability.lifeCost,
      discardCost: ability.discardCost,
      sacrificeSelf: ability.sacrificeSelf,
      sacrificeOther: ability.sacrificeOther,
      manaCost: ability.manaCost,
      manaAbility: ability.manaAbility,
      targetMode: ability.targetMode,
      needsChoice: ability.needsChoice
    }));
    return result;
  };

  const v62LegacyQueueSuggestedTriggers = queueSuggestedTriggers;
  queueSuggestedTriggers = function gameplayV62QueueSuggestedTriggers(room, event, context = {}) {
    const stackStart = room.stack.length;
    const triggerStart = room.triggerQueue.length;
    v62RecordEvent(room, event, context, true);
    const result = v62LegacyQueueSuggestedTriggers(room, event, context);
    v62ReorderNewObjects(room, stackStart, triggerStart);
    return result;
  };

  const v62LegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function gameplayV62ResolveStackTop(room, resolverName = "Table") {
    const before = v62Snapshot(room);
    const item = room.stack?.at(-1) || null;
    const result = v62LegacyResolveStackTop(room, resolverName);
    if (result) {
      v62RecordEvent(room, "STACK_RESOLVED", {
        sourceCardId: item?.sourceCardId,
        sourceName: item?.name,
        controllerId: item?.controllerId
      }, false);
      v62DetectChanges(room, before, "stack-resolution");
      runStateBasedActions(room, "v62-stack-resolution");
    }
    return result;
  };

  const v62LegacyProcessGameAction = processGameAction;
  processGameAction = function gameplayV62ProcessGameAction(room, actor, action) {
    const before = v62Snapshot(room);
    const oldPhase = Number(room?.turn?.phaseIndex || 0);
    const oldTurn = Number(room?.turn?.number || 0);

    // v62.1: when the last active player passes on an empty stack, the
    // priority round is complete and the active player advances the phase.
    // The legacy handler only reset priority, which left Upkeep stuck.
    const v621ActiveIds = action?.type === "pass-priority"
      ? activePlayerIds(room)
      : [];
    const v621PassedBefore = new Set(room?.priority?.passedPlayerIds || []);
    if (action?.type === "pass-priority") v621PassedBefore.add(actor.id);
    const v621AdvanceEmptyPhase =
      action?.type === "pass-priority" &&
      v621ActiveIds.length > 0 &&
      v621PassedBefore.size >= v621ActiveIds.length &&
      !(room?.stack || []).length &&
      !(room?.triggerQueue || []).length;

    const result = v62LegacyProcessGameAction(room, actor, action);
    if (!result?.success) return result;

    if (
      v621AdvanceEmptyPhase &&
      !(room?.stack || []).length &&
      !(room?.triggerQueue || []).length
    ) {
      const v621ActivePlayer = findPlayer(room, room?.turn?.activePlayerId);
      if (v621ActivePlayer?.game) {
        const v621PhaseResult = v62LegacyProcessGameAction(
          room,
          v621ActivePlayer,
          { type: "next-phase" }
        );
        if (!v621PhaseResult?.success) return v621PhaseResult;
        result.phaseAdvanced = true;
      }
    }

    if (action?.type === "block-card") {
      const blocker = locateCard(room, String(action?.sourceCardId || ""))?.card;
      const attacker = locateCard(room, String(action?.targetCardId || ""))?.card;
      if (blocker) v62QueueExtendedTriggers(room, "BLOCKS", { card: blocker, targetCard: attacker, controllerId: blocker.controllerId });
      if (attacker) v62QueueExtendedTriggers(room, "BECOMES_BLOCKED", { card: attacker, targetCard: blocker, controllerId: attacker.controllerId });
    }

    const newPhase = Number(room?.turn?.phaseIndex || 0);
    const newTurn = Number(room?.turn?.number || 0);
    if (newPhase !== oldPhase || newTurn !== oldTurn) {
      const state = v62State(room);
      state.phaseHistory.push({ id: createId(), time: nowIso(), turn: newTurn, phaseIndex: newPhase, phase: v62PhaseName(room), activePlayerId: room.turn?.activePlayerId || null });
      if (state.phaseHistory.length > 40) state.phaseHistory.splice(0, state.phaseHistory.length - 40);
      v62RecordEvent(room, "PHASE_ENTERED", { controllerId: room.turn?.activePlayerId }, false);
      if (v62PhaseName(room) === "Beginning Combat") v62QueueExtendedTriggers(room, "BEGIN_COMBAT", { controllerId: room.turn?.activePlayerId });
    }

    v62DetectChanges(room, before, action?.type || "action");
    return result;
  };

  const v62LegacyAdvanceTurn = advanceTurn;
  advanceTurn = function gameplayV62AdvanceTurn(room) {
    const result = v62LegacyAdvanceTurn(room);
    v62RecordEvent(room, "TURN_STARTED", { controllerId: room.turn?.activePlayerId }, false);
    return result;
  };

  const v62LegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function gameplayV62CreatePublicRoom(room, viewerId) {
    const publicRoom = v62LegacyCreatePublicRoom(room, viewerId);
    const state = v62State(room);
    publicRoom.gameplayV62 = {
      version: V62_VERSION,
      phaseName: v62PhaseName(room),
      activePlayerId: room.turn?.activePlayerId || null,
      priorityPlayerId: room.priority?.playerId || null,
      passedPlayerIds: [...(room.priority?.passedPlayerIds || [])],
      events: state.events.slice(-30),
      phaseHistory: state.phaseHistory.slice(-20),
      viewerAutoPass: { ...(state.autoPass?.[viewerId] || {}) },
      automaticPhases: ["Untap", "Draw", "First-Strike Damage", "Combat Damage", "Cleanup"],
      triggerOrdering: "APNAP stable order",
      replacementEngine: "existing v57 engine plus assisted fallback",
      automationLevels: ["full", "assisted", "manual"]
    };
    return publicRoom;
  };

  function v62FinishAction(auth, response, result, label) {
    if (!result?.success) return response.status(400).json(result || { success: false, error: "The action failed." });
    runStateBasedActions(auth.room, "v62-action");
    recordReplayFrame(auth.room, auth.player.name, label || "v62 automation");
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);
    return response.json({
      success: true,
      result,
      room: createPublicRoom(auth.room, auth.player.id)
    });
  }

  app.post("/api/gameplay-v62/action", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    const type = String(request.body?.type || "");
    if (type === "resolve-trigger-choice") {
      return v62FinishAction(auth, response, v62ResolveTriggerChoice(auth.room, auth.player, request.body), "Trigger choice");
    }
    if (type === "activate-ability") {
      return v62FinishAction(auth, response, v62ActivateAbility(auth.room, auth.player, request.body), "Activated ability");
    }
    if (type === "set-auto-pass") {
      const state = v62State(auth.room);
      state.autoPass[auth.player.id] = {
        phaseKey: v62Clean(request.body?.phaseKey, 120),
        stackKey: v62Clean(request.body?.stackKey, 500),
        updatedAt: nowIso()
      };
      return v62FinishAction(auth, response, { success: true }, "Auto-pass preference");
    }
    if (type === "pass-priority") {
      return v62FinishAction(auth, response, processGameAction(auth.room, auth.player, { type: "pass-priority" }), "Pass priority");
    }
    if (type === "next-phase") {
      return v62FinishAction(auth, response, processGameAction(auth.room, auth.player, { type: "next-phase" }), "Automatic next phase");
    }
    if (type === "end-turn") {
      return v62FinishAction(auth, response, processGameAction(auth.room, auth.player, { type: "end-turn" }), "Automatic end turn");
    }
    if (type === "combat-damage") {
      return v62FinishAction(auth, response, processGameAction(auth.room, auth.player, { type: "resolve-combat-damage", pass: request.body?.pass === "first" ? "first" : "normal" }), "Automatic combat damage");
    }
    if (type === "move-card") {
      const zones = new Set(["hand", "battlefield", "graveyard", "exile", "commandZone"]);
      const fromZone = String(request.body?.fromZone || "");
      const toZone = String(request.body?.toZone || "");
      if (!zones.has(fromZone) || !zones.has(toZone) || fromZone === toZone) {
        return response.status(400).json({ success: false, error: "Choose a valid different card zone." });
      }
      return v62FinishAction(
        auth,
        response,
        processGameAction(auth.room, auth.player, {
          type: "move-card",
          cardId: String(request.body?.cardId || ""),
          fromZone,
          toZone
        }),
        "Move card"
      );
    }
    if (type === "declare-attacker") {
      return v62FinishAction(
        auth,
        response,
        processGameAction(auth.room, auth.player, {
          type: "declare-attacker",
          cardId: String(request.body?.cardId || ""),
          defenderPlayerId: String(request.body?.defenderPlayerId || "")
        }),
        "Declare attacker"
      );
    }
    return response.status(400).json({ success: false, error: "Unsupported v62 gameplay action." });
  });

  app.get("/api/gameplay-v62/status", (_request, response) => {
    response.json({
      success: true,
      version: V62_VERSION,
      automatic: [
        "normal draw step",
        "untap-to-upkeep progression",
        "draw-to-main progression",
        "combat damage steps",
        "cleanup-to-next-turn progression",
        "safe triggered abilities onto the stack",
        "APNAP stable trigger ordering",
        "supported card effect resolution",
        "fixed mana abilities",
        "simple activated ability costs",
        "simple static power/toughness bonuses",
        "simple granted creature keywords",
        "state-based actions and new-trigger checks",
        "phase advancement after every player passes on an empty stack",
        "direct mobile card movement between public zones",
        "direct mobile attack declaration"
      ],
      assisted: [
        "may choices",
        "targets",
        "discard and sacrifice costs",
        "scry, surveil, search and reveal",
        "hybrid, Phyrexian, X and choose-a-color mana",
        "unusual replacement and continuous effects",
        "card-specific corner cases"
      ]
    });
  });

  console.log("Arena Commander automated gameplay engine v" + V62_VERSION + " installed.");
})();
// ---- End ${MARKER} ----
`;

  const patterns = [
    /\napp\.get\(\s*["']\*["']\s*,/,
    /\napp\.use\(\s*["']\/api["']\s*,/,
    /\nasync\s+function\s+start\s*\(/,
    /\n\s*server\.listen\s*\(/
  ];

  let insertAt = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) {
      insertAt = match.index;
      break;
    }
  }
  if (insertAt < 0) throw new Error("Arena Commander v62 could not find a safe server insertion point.");
  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

const previousLoader = Module._extensions[".js"];
if (process.env.ARENA_V62_TEST_MODE !== "1") {
  Module._extensions[".js"] = function gameplayAutomationV62Register(module, filename) {
    if (path.resolve(filename) !== SERVER_PATH) return previousLoader(module, filename);
    Module._extensions[".js"] = previousLoader;
    const originalCompile = module._compile;
    module._compile = function compileWithGameplayAutomationV62(source, compiledFilename) {
      module._compile = originalCompile;
      return originalCompile.call(module, injectGameplayAutomationV62(source), compiledFilename);
    };
    return previousLoader(module, filename);
  };
}

module.exports = {
  version: VERSION,
  marker: MARKER,
  injectGameplayAutomationV62
};
