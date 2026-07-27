import { GameState, registerDefaultMechanics } from "../src/engine/index.mjs";

const game = registerDefaultMechanics(new GameState({
  format: "commander",
  players: [
    { id: "p1", name: "Fries91" },
    { id: "p2", name: "Opponent" }
  ],
  random: () => 0
}));

const creature = game.createCardInstance({
  id: "sample-creature",
  name: "Sample Creature",
  type_line: "Creature — Example",
  power: "2",
  toughness: "2",
  color_identity: ["G"]
}, {
  ownerId: "p1",
  controllerId: "p1",
  zone: "battlefield"
});

await game.mechanics.execute("perpetual", { game }, {
  objectId: creature.id,
  modifier: { type: "modify", field: "power", amount: 1 }
});

await game.addToStack({
  controllerId: "p1",
  sourceId: creature.id,
  kind: "activated_ability",
  label: "Deal 2 damage",
  resolve: async ({ game: current }) => {
    await current.changeLife("p2", -2, { sourceId: creature.id, damage: true });
  }
});

await game.passPriority("p1");
await game.passPriority("p2");

console.log(JSON.stringify(game.sanitizeFor("p1"), null, 2));
