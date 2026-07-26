import assert from "node:assert/strict";
import {
  GameState,
  commanderTax,
  registerDefaultMechanics
} from "../src/engine/index.mjs";

assert.equal(commanderTax(0), 0);
assert.equal(commanderTax(3), 6);

const game = registerDefaultMechanics(new GameState({
  format: "commander",
  players: [
    { id: "a", name: "A" },
    { id: "b", name: "B" }
  ],
  random: () => 0
}));

const card = game.createCardInstance({
  id: "bear",
  name: "Test Bear",
  type_line: "Creature — Bear",
  power: "2",
  toughness: "2",
  color_identity: ["G"]
}, {
  ownerId: "a",
  controllerId: "a",
  zone: "battlefield"
});

assert.equal(game.getPower(card.id), 2);
await game.mechanics.execute("perpetual", { game }, {
  objectId: card.id,
  modifier: { type: "modify", field: "power", amount: 2 }
});
assert.equal(game.getPower(card.id), 4);

await game.addToStack({
  controllerId: "a",
  kind: "spell",
  label: "Test damage",
  resolve: async ({ game: current }) => {
    await current.changeLife("b", -3, { damage: true });
  }
});

await game.passPriority("a");
await game.passPriority("b");
assert.equal(game.players.get("b").life, 37);

const visibleA = game.sanitizeFor("a");
assert.equal(visibleA.players.a.life, 40);
assert.equal(visibleA.players.b.life, 37);
assert.equal(visibleA.players.a.battlefield[0].power, 4);

console.log("Smoke tests passed.");
