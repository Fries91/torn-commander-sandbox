"use strict";

const assert = require("assert");
const { _test } = require("../hidden-search-engine");

let parsed = _test.parseSearchInstruction(
  "Search your library for a basic land card, put it onto the battlefield tapped, then shuffle."
);
assert(parsed);
assert.equal(parsed.libraryReference, "your");
assert.equal(parsed.amount, 1);
assert.equal(parsed.filter.basic, true);
assert.equal(parsed.filter.land, true);
assert.equal(parsed.destination.zone, "battlefield");
assert.equal(parsed.destination.tapped, true);
assert.equal(parsed.shuffleAfter, true);

parsed = _test.parseSearchInstruction(
  "Look through your library for a creature card, reveal it, put it into your hand, then shuffle."
);
assert(parsed);
assert.equal(parsed.filter.creature, true);
assert.equal(parsed.revealFound, true);
assert.equal(parsed.destination.zone, "hand");

parsed = _test.parseSearchInstruction(
  "Look at your deck and choose a card. Put it into your hand, then shuffle."
);
assert(parsed);
assert.equal(parsed.amount, 1);
assert.equal(parsed.filter.hasStatedQuality, false);

parsed = _test.parseSearchInstruction(
  "Choose up to two artifact cards from your library, reveal them, put them into your hand, then shuffle."
);
assert(parsed);
assert.equal(parsed.amount, 2);
assert.equal(parsed.upTo, true);
assert.equal(parsed.filter.artifact, true);

assert.equal(
  _test.parseSearchInstruction("Look at the top three cards of your library."),
  null
);

console.log("Arena Commander v62.5 library choice parser tests passed.");
