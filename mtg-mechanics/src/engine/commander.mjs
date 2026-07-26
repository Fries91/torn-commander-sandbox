import { assertRule } from "./errors.mjs";

export const COMMANDER_RULES = Object.freeze({
  startingLife: 40,
  deckSize: 100,
  commanderDamageToLose: 21,
  taxPerPreviousCommandZoneCast: 2
});

export function commanderTax(previousCommandZoneCasts) {
  assertRule(Number.isInteger(previousCommandZoneCasts) && previousCommandZoneCasts >= 0,
    "Previous command-zone cast count must be a nonnegative integer.");
  return previousCommandZoneCasts * COMMANDER_RULES.taxPerPreviousCommandZoneCast;
}

export function validateCommanderDeck({ commander, cards }) {
  assertRule(commander, "Commander is required.");
  assertRule(Array.isArray(cards), "Deck cards must be an array.");
  assertRule(cards.length + 1 === COMMANDER_RULES.deckSize,
    `Commander deck must contain ${COMMANDER_RULES.deckSize} total cards.`);

  const identity = new Set(commander.color_identity ?? []);
  const seen = new Map();

  for (const card of cards) {
    for (const color of card.color_identity ?? []) {
      assertRule(identity.has(color),
        `${card.name} is outside the commander's color identity.`,
        "COLOR_IDENTITY_VIOLATION",
        { card: card.name, color }
      );
    }

    const basic = /\bBasic\b/.test(card.type_line ?? "");
    if (!basic) {
      const count = (seen.get(card.name) ?? 0) + 1;
      seen.set(card.name, count);
      assertRule(count <= 1, `Commander deck contains duplicate card: ${card.name}`,
        "SINGLETON_VIOLATION", { card: card.name });
    }
  }

  return true;
}

export function recordCommanderDamage(game, { sourceCommanderId, damagedPlayerId, amount }) {
  assertRule(amount >= 0, "Damage amount cannot be negative.");
  const key = `${sourceCommanderId}:${damagedPlayerId}`;
  const next = (game.commanderDamage.get(key) ?? 0) + amount;
  game.commanderDamage.set(key, next);
  return next;
}
