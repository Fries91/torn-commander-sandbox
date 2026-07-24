"use strict";

const assert = require("assert");
const { createZoneRulesEngine, _test } = require("../zone-rules-engine");

let id = 0;
const deps = {
  createId: () => `choice-${++id}`,
  nowIso: () => "2026-07-24T00:00:00.000Z",
  normalizeText: (value, max = 1000) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max),
  clamp: (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value)),
  currentCardFace: (card) => card.cardData || {},
  currentTypeLine: (card) => card.cardData?.typeLine || "",
  currentOracleText: (card) => card.cardData?.oracleText || "",
  isCreatureCard: (card) => /\bCreature\b/i.test(card.cardData?.typeLine || ""),
  publicCard: (card) => JSON.parse(JSON.stringify(card)),
  findPlayer: (room, playerId) => room.players.find((player) => player.id === playerId),
  resetPriority: () => {},
  addLog: (room, text, type) => room.log.push({ text, type }),
  shuffle: (cards) => [...cards].reverse()
};

function card(name, typeLine, manaValue = 0, oracleText = "") {
  return {
    id: name.toLowerCase().replace(/\W+/g, "-"),
    name,
    ownerId: "p1",
    controllerId: "p1",
    tapped: false,
    cardData: {
      name,
      typeLine,
      manaValue,
      oracleText,
      imageUrl: ""
    }
  };
}

const forest = card("Forest", "Basic Land — Forest");
const island = card("Island", "Basic Land — Island");
const elf = card("Llanowar Elves", "Creature — Elf Druid", 1);
const dragon = card("Ancient Dragon", "Creature — Dragon", 7);
const spell = card("Tutor", "Sorcery", 2, "Search your library for a basic land card, reveal it, put it into your hand, then shuffle.");

const player = {
  id: "p1",
  name: "Fries91",
  isBot: false,
  game: {
    library: [forest, island, elf, dragon],
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    commandZone: [],
    life: 40
  }
};

const room = {
  hostId: "p1",
  players: [player],
  zoneChoices: [],
  log: []
};

const engine = createZoneRulesEngine(deps);

engine.afterResolve(room, {
  controllerId: "p1",
  name: "Tutor",
  card: spell,
  text: spell.cardData.oracleText
});

assert.equal(room.zoneChoices.length, 1);
assert.equal(room.zoneChoices[0].kind, "search");
assert.deepEqual(room.zoneChoices[0].eligibleCardIds.sort(), [forest.id, island.id].sort());

let publicChoices = engine.pendingPublic(room, "p1");
assert.equal(publicChoices.length, 1);
assert.equal(publicChoices[0].cards.length, 2);

let result = engine.processGameAction(
  room,
  player,
  {
    type: "resolve-zone-choice",
    choiceId: room.zoneChoices[0].id,
    resolution: { selectedCardIds: [forest.id] }
  },
  () => ({ success: true })
);
assert.equal(result.success, true);
assert(player.game.hand.some((entry) => entry.id === forest.id));
assert(!player.game.library.some((entry) => entry.id === forest.id));

const scrySpell = card("Scry Spell", "Instant", 1, "Scry 2.");
engine.afterResolve(room, {
  controllerId: "p1",
  name: "Scry Spell",
  card: scrySpell,
  text: scrySpell.cardData.oracleText
});
const scry = room.zoneChoices.find((choice) => choice.status === "open");
assert(scry);
const first = scry.cardIds[0];
const second = scry.cardIds[1];

result = engine.processGameAction(
  room,
  player,
  {
    type: "resolve-zone-choice",
    choiceId: scry.id,
    resolution: {
      topCardIds: [second],
      bottomCardIds: [first]
    }
  },
  () => ({ success: true })
);
assert.equal(result.success, true);
assert.equal(player.game.library[0].id, second);
assert.equal(player.game.library.at(-1).id, first);

const lookText = "Look at the top three cards of your library. You may reveal a creature card from among them and put it into your hand. Put the rest on the bottom of your library in any order.";
const lookCard = card("Creature Look", "Sorcery", 2, lookText);
engine.afterResolve(room, {
  controllerId: "p1",
  name: "Creature Look",
  card: lookCard,
  text: lookText
});
const look = room.zoneChoices.find((choice) => choice.status === "open");
assert(look);
assert(look.eligibleCardIds.every((cardId) => {
  const found = player.game.library.find((entry) => entry.id === cardId);
  return /\bCreature\b/i.test(found.cardData.typeLine);
}));

const drawCard = card("Draw Spell", "Sorcery", 3, "Draw two cards.");
const beforeHand = player.game.hand.length;
engine.afterResolve(room, {
  controllerId: "p1",
  name: "Draw Spell",
  card: drawCard,
  text: drawCard.cardData.oracleText
});
assert.equal(player.game.hand.length, beforeHand + 2);

assert.equal(_test.matchesQualifier(dragon, "creature card with mana value 6 or greater", deps), true);
assert.equal(_test.matchesQualifier(elf, "creature card with mana value 6 or greater", deps), false);

console.log("Arena zone-choice engine v43 tests passed.");
