"use strict";

const DIFFICULTIES = new Set(["beginner", "skilled", "competitive", "expert"]);

function text(card) {
  return String(card?.cardData?.oracleText || card?.cardData?.faces?.map((face) => face.oracleText || "").join("\n") || "").toLowerCase();
}

function typeLine(card) {
  return String(card?.cardData?.typeLine || "").toLowerCase();
}

function manaValue(card) {
  const value = Number(card?.cardData?.manaValue);
  return Number.isFinite(value) ? value : 0;
}

function numericStat(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cardPower(card) {
  return numericStat(card?.effectiveStats?.power ?? card?.power ?? card?.cardData?.power);
}

function cardToughness(card) {
  return numericStat(card?.effectiveStats?.toughness ?? card?.toughness ?? card?.cardData?.toughness);
}

function isLand(card) {
  return /\bland\b/.test(typeLine(card));
}

function isCreature(card) {
  return /\bcreature\b/.test(typeLine(card));
}

function isInstantSpeed(card) {
  return /\binstant\b/.test(typeLine(card)) || /\bflash\b/.test(text(card));
}

function normalizeDifficulty(value) {
  const result = String(value || "skilled").toLowerCase();
  return DIFFICULTIES.has(result) ? result : "skilled";
}

function analyzeDeckProfile(deck) {
  const cards = Array.isArray(deck?.cards) ? deck.cards : [];
  const totals = {
    lands: 0,
    creatures: 0,
    instants: 0,
    sorceries: 0,
    artifacts: 0,
    enchantments: 0,
    planeswalkers: 0,
    removal: 0,
    draw: 0,
    ramp: 0,
    tutors: 0,
    tokens: 0,
    sacrifice: 0,
    graveyard: 0,
    counters: 0,
    equipment: 0,
    spellslinger: 0,
    comboSignals: 0,
    total: 0,
    manaValue: 0
  };

  for (const entry of cards) {
    const quantity = Math.max(1, Number(entry?.quantity) || 1);
    const card = entry?.cardData || entry;
    const cardType = String(card?.typeLine || "").toLowerCase();
    const oracle = String(card?.oracleText || card?.faces?.map((face) => face.oracleText || "").join("\n") || "").toLowerCase();
    totals.total += quantity;
    totals.manaValue += (Number(card?.manaValue) || 0) * quantity;
    if (/\bland\b/.test(cardType)) totals.lands += quantity;
    if (/\bcreature\b/.test(cardType)) totals.creatures += quantity;
    if (/\binstant\b/.test(cardType)) totals.instants += quantity;
    if (/\bsorcery\b/.test(cardType)) totals.sorceries += quantity;
    if (/\bartifact\b/.test(cardType)) totals.artifacts += quantity;
    if (/\benchantment\b/.test(cardType)) totals.enchantments += quantity;
    if (/\bplaneswalker\b/.test(cardType)) totals.planeswalkers += quantity;
    if (/(destroy|exile|counter target|damage to any target|damage to target creature|return target .* to its owner)/.test(oracle)) totals.removal += quantity;
    if (/(draw (a|one|two|three|x)|draw cards|whenever .* draw)/.test(oracle)) totals.draw += quantity;
    if (/(add \{|search your library for .* land|put .* land card .* battlefield|treasure token)/.test(oracle)) totals.ramp += quantity;
    if (/search your library for (a|an|up to|any) card/.test(oracle)) totals.tutors += quantity;
    if (/create .* token/.test(oracle)) totals.tokens += quantity;
    if (/(sacrifice a|whenever .* dies|when .* dies)/.test(oracle)) totals.sacrifice += quantity;
    if (/(graveyard|return .* from your graveyard|reanimate)/.test(oracle)) totals.graveyard += quantity;
    if (/(\+1\/\+1 counter|proliferate)/.test(oracle)) totals.counters += quantity;
    if (/\bequip\b|equipment/.test(cardType + " " + oracle)) totals.equipment += quantity;
    if (/(whenever you cast an instant or sorcery|magecraft|copy target instant|copy target sorcery)/.test(oracle)) totals.spellslinger += quantity;
    if (/(you win the game|infinite|untap .* whenever|copy .* repeatedly|without paying its mana cost)/.test(oracle)) totals.comboSignals += quantity;
  }

  const nonlands = Math.max(1, totals.total - totals.lands);
  const avgManaValue = totals.manaValue / Math.max(1, totals.total);
  const scores = {
    aggro: totals.creatures * 1.35 + totals.counters + totals.equipment * 1.2 - avgManaValue * 3,
    control: totals.removal * 2 + totals.draw * 1.2 + totals.instants - totals.creatures * 0.25,
    combo: totals.tutors * 2.2 + totals.comboSignals * 3 + totals.draw - totals.creatures * 0.1,
    tokens: totals.tokens * 2 + totals.creatures * 0.4 + totals.counters,
    aristocrats: totals.sacrifice * 2 + totals.tokens + totals.graveyard,
    reanimator: totals.graveyard * 2 + totals.creatures * 0.5 + totals.tutors,
    ramp: totals.ramp * 2 + Math.max(0, avgManaValue - 3) * 5,
    spellslinger: totals.spellslinger * 3 + totals.instants + totals.sorceries + totals.draw,
    voltron: totals.equipment * 2.5 + totals.counters + totals.creatures * 0.25,
    midrange: totals.creatures + totals.removal + totals.draw + totals.ramp
  };
  const archetype = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || "midrange";
  return {
    archetype,
    averageManaValue: Number(avgManaValue.toFixed(2)),
    landCount: totals.lands,
    creatureRatio: Number((totals.creatures / nonlands).toFixed(2)),
    interactionCount: totals.removal,
    drawCount: totals.draw,
    rampCount: totals.ramp,
    tutorCount: totals.tutors,
    tokenCount: totals.tokens,
    signals: totals
  };
}

function scorePermanent(card, profile = {}) {
  const oracle = text(card);
  const type = typeLine(card);
  let score = manaValue(card) * 1.7;
  if (isCreature(card)) score += cardPower(card) * 1.3 + cardToughness(card) * 0.55;
  if (/commander/.test(String(card?.commander))) score += 6;
  if (/planeswalker/.test(type)) score += 7;
  if (/(draw|whenever you cast|at the beginning of your upkeep)/.test(oracle)) score += 4;
  if (/(you win the game|double|additional combat|extra turn)/.test(oracle)) score += 9;
  if (/indestructible|hexproof|ward/.test(oracle)) score += 2;
  if (profile.archetype === "tokens" && /token/.test(oracle)) score += 3;
  if (profile.archetype === "spellslinger" && /instant|sorcery/.test(oracle)) score += 2;
  return score;
}

function scoreCastCard(card, profile = {}, difficulty = "skilled") {
  const oracle = text(card);
  const type = typeLine(card);
  let score = manaValue(card) * 1.1;
  if (/\bland\b/.test(type)) return -1000;
  if (/destroy|exile|counter target|damage to any target/.test(oracle)) score += 7;
  if (/draw/.test(oracle)) score += 5;
  if (/create .* token/.test(oracle)) score += profile.archetype === "tokens" ? 8 : 4;
  if (/add \{|search your library for .* land|treasure/.test(oracle)) score += profile.archetype === "ramp" ? 8 : 4;
  if (/you win the game|extra turn|additional combat/.test(oracle)) score += 12;
  if (isCreature(card)) score += cardPower(card) + cardToughness(card) * 0.35;
  if (card?.commander) score += 5;
  if (difficulty === "beginner") score += Math.random() * 7;
  if (difficulty === "expert") score += scorePermanent(card, profile) * 0.35;
  return score;
}

function evaluateBoard(player, opponents, profile = {}) {
  const ownBoard = (player?.game?.battlefield || []).reduce((sum, card) => sum + scorePermanent(card, profile), 0);
  const opposingBoard = opponents.reduce((sum, opponent) => sum + (opponent?.game?.battlefield || []).reduce((inner, card) => inner + scorePermanent(card, {}), 0), 0);
  const hand = Number(player?.game?.hand?.length || 0) * 2.2;
  const life = Number(player?.game?.life || 0) * 0.45;
  return Number((ownBoard + hand + life - opposingBoard * 0.72).toFixed(2));
}

function chooseOpponent(bot, opponents) {
  return [...opponents].sort((a, b) => {
    const aScore = Number(a?.game?.life || 0) + (a?.game?.battlefield || []).reduce((sum, card) => sum + scorePermanent(card), 0);
    const bScore = Number(b?.game?.life || 0) + (b?.game?.battlefield || []).reduce((sum, card) => sum + scorePermanent(card), 0);
    return aScore - bScore;
  })[0] || null;
}

function chooseThreat(opponents) {
  const candidates = [];
  for (const opponent of opponents) {
    for (const card of opponent?.game?.battlefield || []) candidates.push({ opponent, card, score: scorePermanent(card) });
  }
  return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function inferSimpleEffect(card, bot, opponents) {
  const oracle = text(card);
  const targetOpponent = chooseOpponent(bot, opponents);
  const threat = chooseThreat(opponents);
  const amountMatch = oracle.match(/(?:deals?|lose)\s+(\d+)\s+(?:damage|life)/);
  const amount = Number(amountMatch?.[1] || 1);

  if (/exile target/.test(oracle) && threat) {
    return { effect: { action: "exile", amount: 1 }, targets: [`card:${threat.card.id}`], reason: `exile the highest-scoring opposing permanent (${threat.card.name})` };
  }
  if (/destroy target/.test(oracle) && threat) {
    return { effect: { action: "destroy", amount: 1 }, targets: [`card:${threat.card.id}`], reason: `remove the highest-scoring opposing permanent (${threat.card.name})` };
  }
  if (/(deals? \d+ damage to any target|deals? \d+ damage to target player|target opponent loses? \d+ life)/.test(oracle) && targetOpponent) {
    return { effect: { action: "damage", amount }, targets: [`player:${targetOpponent.id}`], reason: `pressure ${targetOpponent.name}'s life total` };
  }
  if (/deals? \d+ damage to target creature/.test(oracle) && threat) {
    return { effect: { action: "damage", amount }, targets: [`card:${threat.card.id}`], reason: `damage the most valuable opposing creature (${threat.card.name})` };
  }
  const drawMatch = oracle.match(/draw (?:a|one|two|three|four|five|x|up to \w+) cards?/);
  if (drawMatch) {
    const drawAmount = /two/.test(drawMatch[0]) ? 2 : /three/.test(drawMatch[0]) ? 3 : /four/.test(drawMatch[0]) ? 4 : /five/.test(drawMatch[0]) ? 5 : 1;
    return { effect: { action: "draw", amount: drawAmount }, targets: [`player:${bot.id}`], reason: "increase card advantage" };
  }
  const gainMatch = oracle.match(/gain (\d+) life/);
  if (gainMatch) return { effect: { action: "gain-life", amount: Number(gainMatch[1]) }, targets: [`player:${bot.id}`], reason: "improve survival" };
  const tokenMatch = oracle.match(/create (?:a|one|two|three|four|five|x|\d+) ([^.,]+?) token/);
  if (tokenMatch) return { effect: { action: "token", amount: 1, tokenName: tokenMatch[1].trim(), power: "1", toughness: "1" }, targets: [], reason: "develop the battlefield" };
  return { effect: null, targets: [], reason: "advance the deck's primary game plan" };
}

function explainDecision({ action, card, target, profile, boardScore, alternatives = [] }) {
  const actionName = action?.type || "pass-priority";
  const pieces = [];
  if (card) pieces.push(`${card.name} scored well for the ${profile?.archetype || "midrange"} plan`);
  if (target) pieces.push(`${target.name || target.player?.name || "the target"} was the highest-priority target`);
  if (Number.isFinite(boardScore)) pieces.push(`current board evaluation ${boardScore}`);
  if (alternatives.length) pieces.push(`considered ${alternatives.slice(0, 3).join(", ")}`);
  if (!pieces.length) pieces.push("no higher-value legal action was available");
  return `${actionName}: ${pieces.join("; ")}.`;
}

module.exports = {
  DIFFICULTIES,
  normalizeDifficulty,
  analyzeDeckProfile,
  evaluateBoard,
  scorePermanent,
  scoreCastCard,
  chooseOpponent,
  chooseThreat,
  inferSimpleEffect,
  explainDecision,
  isLand,
  isCreature,
  isInstantSpeed,
  manaValue,
  cardPower,
  cardToughness
};
