"use strict";

const assert = require("assert");
const { analyzeOracleText } = require("../card-automation-engine");

function level(text) {
  return analyzeOracleText(text).level;
}

assert.equal(level("When this creature enters, draw a card."), "full");
assert.equal(level("Whenever you cast a spell, each opponent loses 1 life and you gain 1 life."), "full");
assert.equal(level("When this creature enters, create two 1/1 white Soldier creature tokens."), "full");
assert.equal(level("When this creature enters, destroy target creature."), "assisted");
assert.equal(level("Search your library for a card, reveal it, then shuffle."), "manual");
assert.equal(level("Flying, vigilance"), "full");

const damage = analyzeOracleText("When this creature enters, it deals 3 damage to any target.");
assert.equal(damage.abilities[0].actions[0].type, "damage");
assert.equal(damage.abilities[0].actions[0].amount, 3);

console.log("Card automation engine tests passed.");
