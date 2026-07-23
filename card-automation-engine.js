"use strict";

const ENGINE_VERSION = "40.0.0";
const FULL = "full";
const ASSISTED = "assisted";
const MANUAL = "manual";

const EVENT_ALIASES = Object.freeze({
  UPKEEP_START: "upkeep",
  END_STEP_START: "end-step",
  PERMANENT_ENTERED: "entered",
  CREATURE_DIED: "died",
  SPELL_CAST: "cast",
  ATTACKS: "attacks",
  DAMAGE_DEALT: "damage",
  COMBAT_DAMAGE_PLAYER: "combat-damage-player"
});

const SIMPLE_KEYWORDS = new Set([
  "deathtouch", "defender", "double strike", "first strike", "flying", "haste",
  "hexproof", "indestructible", "lifelink", "menace", "reach", "trample", "vigilance"
]);

function cleanText(value) {
  return String(value || "")
    .replace(/\u2212/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function lower(value) {
  return cleanText(value).toLocaleLowerCase("en-US");
}

function numericWord(value, fallback = 1) {
  const text = lower(value);
  const table = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  if (Object.prototype.hasOwnProperty.call(table, text)) return table[text];
  const number = Number(text);
  return Number.isFinite(number) ? number : fallback;
}

function oracleLines(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n+/)
    .map(cleanText)
    .filter(Boolean);
}

function triggerEventForLine(line) {
  const text = lower(line);
  if (/^at the beginning of .*upkeep/.test(text)) return "UPKEEP_START";
  if (/^at the beginning of .*end step/.test(text)) return "END_STEP_START";
  if (/^(when|whenever) .*\b(enters the battlefield|enters)\b/.test(text)) return "PERMANENT_ENTERED";
  if (/^(when|whenever) .*\b(dies|is put into a graveyard from the battlefield)\b/.test(text)) return "CREATURE_DIED";
  if (/^whenever .*\bcast(s)?\b/.test(text)) return "SPELL_CAST";
  if (/^(when|whenever) .*\battacks\b/.test(text)) return "ATTACKS";
  if (/^(when|whenever) .*deals combat damage to (a player|an opponent)/.test(text)) return "COMBAT_DAMAGE_PLAYER";
  if (/^(when|whenever) .*deals damage/.test(text)) return "DAMAGE_DEALT";
  return null;
}

function effectPartFromTriggeredLine(line) {
  const comma = String(line).indexOf(",");
  return comma >= 0 ? cleanText(String(line).slice(comma + 1)) : cleanText(line);
}

function targetModeFromText(text) {
  const value = lower(text);
  if (/each opponent/.test(value)) return "each-opponent";
  if (/each player/.test(value)) return "each-player";
  if (/each creature you control/.test(value)) return "each-creature-you-control";
  if (/target opponent/.test(value)) return "target-opponent";
  if (/target player/.test(value)) return "target-player";
  if (/target creature/.test(value)) return "target-creature";
  if (/target permanent/.test(value)) return "target-permanent";
  if (/any target/.test(value)) return "any-target";
  if (/\byou\b|your life total/.test(value)) return "controller";
  return "controller";
}

function parseActions(effectText) {
  const text = cleanText(effectText);
  const normalized = lower(text);
  const actions = [];
  const reasons = [];
  let needsChoice = false;

  if (!text) return { actions, level: MANUAL, reasons: ["No rules text was available."], needsChoice: true };

  if (/\b(may|unless|choose|chosen|vote|secretly|search your library|shuffle|reveal|look at the top|exile .* until|for each|equal to|where x|\bx\b)\b/i.test(text)) {
    needsChoice = true;
    reasons.push("The ability contains a choice, variable amount, search, reveal, or conditional instruction.");
  }

  const draw = normalized.match(/draw (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/);
  if (draw) actions.push({ type: "draw", amount: numericWord(draw[1]), target: targetModeFromText(text) });

  for (const match of normalized.matchAll(/(you|target player|target opponent|each opponent|each player) (gain|gains|lose|loses) (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) life/g)) {
    actions.push({
      type: match[2].startsWith("gain") ? "gain-life" : "lose-life",
      amount: numericWord(match[3]),
      target: targetModeFromText(match[1])
    });
  }

  const damage = normalized.match(/deals? (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) damage to ([^.]+)/);
  if (damage) {
    actions.push({ type: "damage", amount: numericWord(damage[1]), target: targetModeFromText(damage[2]) });
    if (/target|any target/.test(damage[2])) needsChoice = true;
  }

  const token = normalized.match(/create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([+-]?\d+)\/([+-]?\d+) ([^.]*?) creature tokens?/);
  if (token) {
    const descriptor = cleanText(token[4]).replace(/\b(colorless|white|blue|black|red|green)\b/gi, "").trim();
    actions.push({
      type: "token",
      amount: numericWord(token[1]),
      power: token[2],
      toughness: token[3],
      tokenName: descriptor ? `${descriptor} Token` : "Creature Token",
      target: "controller"
    });
  }

  const counters = normalized.match(/put (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) ([+\-]\d+\/[+\-]\d+|[a-z][a-z -]*?) counters? on ([^.]+)/);
  if (counters) {
    const counterName = counters[2].includes("/") ? counters[2] : cleanText(counters[2]);
    const target = targetModeFromText(counters[3]);
    actions.push({ type: "counter", amount: numericWord(counters[1]), counterName, target });
    if (/target/.test(counters[3])) needsChoice = true;
  }

  const mill = normalized.match(/mills? (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?/);
  if (mill) actions.push({ type: "mill", amount: numericWord(mill[1]), target: targetModeFromText(text) });

  const scry = normalized.match(/scry (\d+)/);
  if (scry) {
    actions.push({ type: "scry", amount: Number(scry[1]), target: "controller" });
    needsChoice = true;
  }

  const surveil = normalized.match(/surveil (\d+)/);
  if (surveil) {
    actions.push({ type: "surveil", amount: Number(surveil[1]), target: "controller" });
    needsChoice = true;
  }

  if (/destroy target (creature|permanent|artifact|enchantment)/.test(normalized)) {
    actions.push({ type: "destroy", target: targetModeFromText(text) });
    needsChoice = true;
  }
  if (/exile target (creature|permanent|artifact|enchantment|card)/.test(normalized)) {
    actions.push({ type: "exile", target: targetModeFromText(text) });
    needsChoice = true;
  }
  if (/tap target (creature|permanent|artifact)/.test(normalized)) {
    actions.push({ type: "tap", target: targetModeFromText(text) });
    needsChoice = true;
  }
  if (/untap target (creature|permanent|artifact)/.test(normalized)) {
    actions.push({ type: "untap", target: targetModeFromText(text) });
    needsChoice = true;
  }

  const meaningful = normalized
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(flying|vigilance|trample|haste|lifelink|deathtouch|first strike|double strike|reach|menace|hexproof|indestructible|defender)\b[,.]?/g, "")
    .trim();

  if (!actions.length && meaningful) reasons.push("No safe automatic effect pattern matched this Oracle text.");
  const level = !actions.length ? MANUAL : needsChoice ? ASSISTED : FULL;
  return { actions, level, reasons, needsChoice };
}

function analyzeOracleText(text) {
  const lines = oracleLines(text);
  const abilities = [];
  for (const line of lines) {
    const event = triggerEventForLine(line);
    const effectText = event ? effectPartFromTriggeredLine(line) : line;
    const parsed = parseActions(effectText);
    const isKeywordOnly = line
      .split(/[,;]/)
      .map(lower)
      .filter(Boolean)
      .every((part) => SIMPLE_KEYWORDS.has(part));
    abilities.push({
      text: line,
      event,
      effectText,
      actions: parsed.actions,
      level: isKeywordOnly ? FULL : parsed.level,
      reasons: isKeywordOnly ? [] : parsed.reasons,
      needsChoice: isKeywordOnly ? false : parsed.needsChoice
    });
  }

  if (!abilities.length) {
    return { level: MANUAL, label: "Manual", abilities: [], summary: "No Oracle text loaded." };
  }
  const levels = abilities.map((ability) => ability.level);
  const level = levels.every((entry) => entry === FULL)
    ? FULL
    : levels.some((entry) => entry === FULL || entry === ASSISTED)
      ? ASSISTED
      : MANUAL;
  return {
    level,
    label: level === FULL ? "Full Auto" : level === ASSISTED ? "Assisted" : "Manual",
    abilities,
    supportedAbilities: abilities.filter((ability) => ability.level === FULL).length,
    assistedAbilities: abilities.filter((ability) => ability.level === ASSISTED).length,
    manualAbilities: abilities.filter((ability) => ability.level === MANUAL).length,
    events: [...new Set(abilities.map((ability) => ability.event).filter(Boolean))]
  };
}

function cardOracle(card) {
  const faces = card?.cardData?.faces || [];
  return cleanText(card?.cardData?.oracleText || faces.map((face) => face.oracleText || "").filter(Boolean).join("\n"));
}

function profileForCard(card) {
  const analysis = analyzeOracleText(cardOracle(card));
  return {
    version: ENGINE_VERSION,
    level: analysis.level,
    label: analysis.label,
    supportedAbilities: analysis.supportedAbilities || 0,
    assistedAbilities: analysis.assistedAbilities || 0,
    manualAbilities: analysis.manualAbilities || 0,
    events: analysis.events || []
  };
}

function normalizeAutomation(value) {
  if (!value || typeof value !== "object") return null;
  return {
    version: ENGINE_VERSION,
    level: [FULL, ASSISTED, MANUAL].includes(value.level) ? value.level : ASSISTED,
    sourceText: cleanText(value.sourceText).slice(0, 2500),
    event: cleanText(value.event).slice(0, 80),
    actions: Array.isArray(value.actions) ? value.actions.slice(0, 20).map((action) => ({
      type: cleanText(action?.type).slice(0, 40),
      amount: Number.isFinite(Number(action?.amount)) ? Number(action.amount) : 1,
      target: cleanText(action?.target).slice(0, 60),
      counterName: cleanText(action?.counterName).slice(0, 60),
      tokenName: cleanText(action?.tokenName).slice(0, 100),
      power: cleanText(action?.power).slice(0, 20),
      toughness: cleanText(action?.toughness).slice(0, 20)
    })).filter((action) => action.type) : [],
    needsChoice: Boolean(value.needsChoice)
  };
}

function targetPlayers(room, controller, mode, targets, helpers) {
  const selected = (targets || [])
    .filter((target) => String(target).startsWith("player:"))
    .map((target) => helpers.findPlayer(room, String(target).slice(7)))
    .filter(Boolean);
  if (selected.length) return selected;
  if (mode === "each-opponent") return room.players.filter((player) => player.id !== controller?.id && player.game && !player.game.lost && !player.game.conceded);
  if (mode === "each-player") return room.players.filter((player) => player.game && !player.game.lost && !player.game.conceded);
  if (mode === "target-opponent") return [];
  return controller ? [controller] : [];
}

function targetCards(room, controller, mode, targets, helpers) {
  const selected = (targets || [])
    .filter((target) => String(target).startsWith("card:"))
    .map((target) => helpers.locateCard(room, String(target).slice(5)))
    .filter(Boolean);
  if (selected.length) return selected;
  if (mode === "each-creature-you-control") {
    return (controller?.game?.battlefield || [])
      .filter((card) => helpers.isCreatureCard(card))
      .map((card) => helpers.locateCard(room, card.id))
      .filter(Boolean);
  }
  return [];
}

function applyActions(room, item, automation, helpers) {
  const controller = helpers.findPlayer(room, item.controllerId);
  const actions = automation?.actions || [];
  if (!controller?.game || !actions.length) return { handled: false, assisted: true };
  let assisted = false;
  let applied = 0;

  for (const action of actions) {
    const amount = Math.max(0, Math.min(100, Math.floor(Number(action.amount) || 1)));
    const players = targetPlayers(room, controller, action.target, item.targets, helpers);
    const cards = targetCards(room, controller, action.target, item.targets, helpers);

    switch (action.type) {
      case "draw":
        for (const player of players) {
          for (let index = 0; index < amount && player.game.library.length; index += 1) player.game.hand.push(player.game.library.shift());
        }
        applied += 1;
        break;
      case "gain-life":
        for (const player of players) player.game.life = helpers.clamp(player.game.life + amount, -999, 9999);
        applied += 1;
        break;
      case "lose-life":
        for (const player of players) player.game.life = helpers.clamp(player.game.life - amount, -999, 9999);
        applied += 1;
        break;
      case "damage":
        if (!players.length && !cards.length) { assisted = true; break; }
        for (const player of players) player.game.life = helpers.clamp(player.game.life - amount, -999, 9999);
        for (const located of cards) located.card.damageMarked = helpers.clamp(located.card.damageMarked + amount, 0, 999);
        applied += 1;
        break;
      case "token":
        for (let index = 0; index < Math.max(1, amount); index += 1) {
          controller.game.battlefield.unshift(helpers.createCard(action.tokenName || "Creature Token", controller.id, {
            token: true,
            power: action.power || "1",
            toughness: action.toughness || "1",
            summoningSick: true
          }));
        }
        applied += 1;
        break;
      case "counter":
        if (!cards.length) { assisted = true; break; }
        for (const located of cards) {
          const name = action.counterName || "+1/+1";
          located.card.counters[name] = helpers.clamp((Number(located.card.counters[name]) || 0) + amount, -99, 999);
        }
        applied += 1;
        break;
      case "mill":
        for (const player of players) {
          for (let index = 0; index < amount && player.game.library.length; index += 1) {
            const card = player.game.library.shift();
            if (!card.token) player.game.graveyard.unshift(card);
          }
        }
        applied += 1;
        break;
      case "tap":
      case "untap":
        if (!cards.length) { assisted = true; break; }
        for (const located of cards) located.card.tapped = action.type === "tap";
        applied += 1;
        break;
      case "destroy":
      case "exile":
        if (!cards.length) { assisted = true; break; }
        for (const located of [...cards].sort((a, b) => b.index - a.index)) {
          if (action.type === "destroy" && helpers.hasKeyword(located.card, "indestructible")) continue;
          const [card] = located.player.game[located.zone].splice(located.index, 1);
          if (!card.token) located.player.game[action.type === "destroy" ? "graveyard" : "exile"].unshift(card);
        }
        applied += 1;
        break;
      case "scry":
      case "surveil":
        assisted = true;
        break;
      default:
        assisted = true;
        break;
    }
  }
  return { handled: applied > 0 && !assisted, partiallyHandled: applied > 0, assisted };
}

function triggerMatches(ability, event, source, context, room, helpers) {
  if (ability.event !== event) return false;
  const line = lower(ability.text);
  const eventCard = context?.card || null;
  const activePlayerId = room.turn?.activePlayerId;

  if (event === "UPKEEP_START" || event === "END_STEP_START") {
    if (/your (upkeep|end step)/.test(line)) return source.controllerId === activePlayerId;
    if (/each opponent'?s (upkeep|end step)/.test(line)) return source.controllerId !== activePlayerId;
    return true;
  }

  if (event === "PERMANENT_ENTERED") {
    if (!eventCard) return false;
    if (/\bthis creature enters\b|\bwhen [^,]+ enters\b/.test(line) && !/another|a creature|one or more/.test(line)) return source.id === eventCard.id;
    if (/another/.test(line) && source.id === eventCard.id) return false;
    if (/you control/.test(line) && source.controllerId !== eventCard.controllerId) return false;
    if (/creature/.test(line) && !helpers.isCreatureCard(eventCard)) return false;
    return true;
  }

  if (event === "CREATURE_DIED") {
    if (!eventCard) return false;
    if (/\bthis creature dies\b|\bwhen [^,]+ dies\b/.test(line) && !/another|a creature|one or more/.test(line)) return source.id === eventCard.id;
    if (/another/.test(line) && source.id === eventCard.id) return false;
    if (/you control/.test(line) && source.controllerId !== eventCard.controllerId) return false;
    return helpers.isCreatureCard(eventCard);
  }

  if (event === "SPELL_CAST") {
    if (/you cast/.test(line) && context?.controllerId !== source.controllerId) return false;
    if (/opponent casts/.test(line) && context?.controllerId === source.controllerId) return false;
    return true;
  }

  if (event === "ATTACKS") {
    if (!eventCard) return false;
    if (/whenever [^,]+ attacks/.test(line) && !/a creature|one or more|creatures you control/.test(line)) return source.id === eventCard.id;
    if (/you control/.test(line) && eventCard.controllerId !== source.controllerId) return false;
    return true;
  }

  if (event === "COMBAT_DAMAGE_PLAYER" || event === "DAMAGE_DEALT") {
    if (!eventCard) return false;
    if (/this creature|whenever [^,]+ deals/.test(line) && !/a creature|one or more|creatures you control/.test(line)) return source.id === eventCard.id;
    if (/you control/.test(line) && eventCard.controllerId !== source.controllerId) return false;
    return true;
  }

  return true;
}

function installCardAutomation(context) {
  const { legacy } = context;
  const helpers = context;

  function roomForPlayer(player) {
    for (const room of context.rooms.values()) if (room.players.some((entry) => entry.id === player.id)) return room;
    return null;
  }

  function queueAutomationEvent(room, event, eventContext = {}) {
    let queued = 0;
    const seen = new Set();
    for (const player of room.players) {
      for (const source of player.game?.battlefield || []) {
        if (source.phasedOut) continue;
        const analysis = analyzeOracleText(cardOracle(source));
        for (const ability of analysis.abilities || []) {
          if (!triggerMatches(ability, event, source, eventContext, room, helpers)) continue;
          const key = `${source.id}:${event}:${ability.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const automation = normalizeAutomation({
            level: ability.level,
            sourceText: ability.effectText,
            event,
            actions: ability.actions,
            needsChoice: ability.needsChoice
          });

          if (ability.level === FULL && automation.actions.length && !automation.needsChoice) {
            context.pushStack(room, {
              kind: "trigger",
              name: `${source.name} trigger`,
              controllerId: source.controllerId,
              sourceCardId: source.id,
              text: ability.text,
              targets: [],
              automation
            }, source.controllerId);
            context.addLog(room, `${source.name} triggered automatically.`, "trigger");
          } else {
            context.queueTrigger(room, {
              controllerId: source.controllerId,
              sourceCardId: source.id,
              sourceName: source.name,
              event,
              text: ability.text,
              targets: [],
              automation
            });
            context.addLog(room, `${source.name} has an assisted trigger waiting for its controller.`, "trigger");
          }
          queued += 1;
        }
      }
    }
    return queued;
  }

  const patches = {};

  patches.normalizeStackItem = function automationNormalizeStackItem(value) {
    const normalized = legacy.normalizeStackItem(value);
    if (normalized && value?.automation) normalized.automation = normalizeAutomation(value.automation);
    return normalized;
  };

  patches.normalizeTriggerItem = function automationNormalizeTriggerItem(value) {
    const normalized = legacy.normalizeTriggerItem(value);
    if (normalized && value?.automation) normalized.automation = normalizeAutomation(value.automation);
    return normalized;
  };

  patches.publicCard = function automationPublicCard(card) {
    return { ...legacy.publicCard(card), automation: profileForCard(card) };
  };

  patches.queueSuggestedTriggers = function automationQueueSuggestedTriggers(room, event, eventContext = {}) {
    const queued = queueAutomationEvent(room, event, eventContext);
    if (!queued) return legacy.queueSuggestedTriggers(room, event, eventContext);
    return queued;
  };

  patches.applySimpleEffect = function automationApplySimpleEffect(room, item) {
    let automation = normalizeAutomation(item?.automation);
    if (!automation) {
      const sourceCard = item?.card || (item?.sourceCardId ? context.locateCard(room, item.sourceCardId)?.card : null);
      const oracle = sourceCard ? cardOracle(sourceCard) : cleanText(item?.text);
      const nonTriggered = analyzeOracleText(oracle).abilities?.filter((ability) => !ability.event) || [];
      const actions = nonTriggered.flatMap((ability) => ability.actions || []);
      const level = nonTriggered.length && nonTriggered.every((ability) => ability.level === FULL) ? FULL : ASSISTED;
      if (actions.length) automation = normalizeAutomation({ level, sourceText: oracle, actions, needsChoice: level !== FULL });
    }

    if (automation?.actions?.length) {
      const result = applyActions(room, item, automation, helpers);
      if (result.partiallyHandled) context.addLog(room, `${item.name} applied ${automation.actions.length} recognized card action(s).`, "automation");
      if (result.handled) return;
      if (result.assisted) context.addLog(room, `${item.name} still needs a target or player choice.`, "warning");
    }
    return legacy.applySimpleEffect(room, item);
  };

  patches.moveCard = function automationMoveCard(player, fromZone, toZone, cardId, position = "top") {
    const room = roomForPlayer(player);
    const before = room ? context.locateCard(room, cardId)?.card : null;
    const result = legacy.moveCard(player, fromZone, toZone, cardId, position);
    if (room && result?.card) {
      if (toZone === "battlefield") queueAutomationEvent(room, "PERMANENT_ENTERED", { card: result.card, controllerId: result.card.controllerId });
      if (fromZone === "battlefield" && toZone === "graveyard" && before && context.isCreatureCard(before)) queueAutomationEvent(room, "CREATURE_DIED", { card: before, controllerId: before.controllerId });
    }
    return result;
  };

  patches.dealPlayerDamage = function automationDealPlayerDamage(room, source, player, amount) {
    const result = legacy.dealPlayerDamage(room, source, player, amount);
    if (Number(amount) > 0) {
      queueAutomationEvent(room, "DAMAGE_DEALT", { card: source, controllerId: source.controllerId, targetPlayerId: player.id, amount: Number(amount) });
      if (source.attacking) queueAutomationEvent(room, "COMBAT_DAMAGE_PLAYER", { card: source, controllerId: source.controllerId, targetPlayerId: player.id, amount: Number(amount) });
    }
    return result;
  };

  patches.dealCreatureDamage = function automationDealCreatureDamage(room, source, target, amount) {
    const result = legacy.dealCreatureDamage(room, source, target, amount);
    if (Number(amount) > 0) queueAutomationEvent(room, "DAMAGE_DEALT", { card: source, targetCard: target, controllerId: source.controllerId, amount: Number(amount) });
    return result;
  };

  patches.runStateBasedActions = function automationStateBasedActions(room, reason) {
    const before = new Map();
    for (const player of room.players) {
      for (const card of player.game?.battlefield || []) before.set(card.id, { card: JSON.parse(JSON.stringify(card)), controllerId: card.controllerId });
    }
    const result = legacy.runStateBasedActions(room, reason);
    const after = new Set(room.players.flatMap((player) => (player.game?.battlefield || []).map((card) => card.id)));
    for (const [id, entry] of before) {
      if (!after.has(id) && context.isCreatureCard(entry.card)) queueAutomationEvent(room, "CREATURE_DIED", { card: entry.card, controllerId: entry.controllerId });
    }
    return result;
  };

  context.app.get("/api/cards/automation/status", (_request, response) => {
    response.json({
      success: true,
      version: ENGINE_VERSION,
      levels: [FULL, ASSISTED, MANUAL],
      events: Object.keys(EVENT_ALIASES),
      automaticActions: ["draw", "gain-life", "lose-life", "damage", "token", "counter", "mill", "tap", "untap", "destroy", "exile"]
    });
  });

  context.app.post("/api/cards/automation/analyze", async (request, response) => {
    const names = Array.isArray(request.body?.names) ? request.body.names.slice(0, 100) : [];
    try {
      const resolved = await context.resolveCardNames(names);
      const cards = resolved.resolved.map(({ requestedName, card }) => ({ requestedName, cardName: card.name, automation: profileForCard({ cardData: card }) }));
      response.json({ success: true, version: ENGINE_VERSION, cards, notFound: resolved.notFound });
    } catch (error) {
      response.status(502).json({ success: false, error: cleanText(error?.message) || "Card automation analysis failed." });
    }
  });

  console.log(`Arena Commander card automation v${ENGINE_VERSION} installed.`);
  return patches;
}

module.exports = {
  ENGINE_VERSION,
  analyzeOracleText,
  profileForCard,
  normalizeAutomation,
  installCardAutomation
};
