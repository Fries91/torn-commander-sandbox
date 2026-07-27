"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

process.env.MTG_MECHANICS_TEST_MODE = "1";
const bridge = require(path.resolve(__dirname, "../mtg-mechanics-adapter.js"));
const register = require(path.resolve(__dirname, "../mtg-mechanics-register.js"));

async function main() {
  const initialized = await bridge.initialize();
  assert.equal(initialized.mode, "shadow");
  assert.equal(initialized.mechanics.officialMechanics, 261);
  assert.ok(initialized.mechanics.digitalMechanics.includes("seek"));

  const room = {
    code: "TEST63",
    format: "commander",
    turn: { number: 2, phaseIndex: 2, activePlayerId: "p1" },
    priority: { playerId: "p2", passedPlayerIds: ["p1"] },
    stack: [{ id: "stack-1", controllerId: "p1", kind: "spell", name: "Test spell" }],
    players: [
      {
        id: "p1",
        name: "Fries91",
        game: {
          life: 40,
          library: [{ id: "p1-lib", name: "Forest", typeLine: "Basic Land — Forest" }],
          hand: [{ id: "p1-hand", name: "Test Bear", typeLine: "Creature — Bear", power: "2", toughness: "2" }],
          battlefield: [], graveyard: [], exile: [], commandZone: []
        }
      },
      {
        id: "p2",
        name: "Opponent",
        game: {
          life: 37,
          library: [], hand: [], battlefield: [], graveyard: [], exile: [], commandZone: []
        }
      }
    ]
  };

  const { game, cardCount } = await bridge.createShadowGame(room);
  assert.equal(cardCount, 2);
  assert.equal(game.currentStep, "draw");
  assert.equal(game.priorityPlayerId, "p2");
  const p1 = game.sanitizeFor("p1");
  const p2 = game.sanitizeFor("p2");
  assert.equal(p1.players.p1.hand.length, 1);
  assert.equal(p2.players.p1.hand.length, 0);
  assert.equal(p2.players.p1.handCount, 1);

  const status = await bridge.syncRoom(room, { reason: "test" });
  assert.equal(status.synchronized, true);
  assert.equal(status.players, 2);
  assert.equal(status.cards, 2);

  assert.deepEqual(bridge.validateCardScript({
    definitionId: "test",
    name: "Test",
    abilities: [{ kind: "activated", handler: "draw" }]
  }), { valid: true, errors: [] });

  const source = `"use strict";\nconst app = {};\nfunction processGameAction(){}\nfunction createPublicRoom(){}\nfunction emitRoomUpdate(){}\nfunction authenticationFrom(){}\nasync function start(){}\n`;
  const injected = register.injectMtgMechanicsBridge(source);
  assert.ok(injected.includes(register.marker));
  assert.ok(injected.includes("/api/mtg-mechanics/status"));

  console.log("MTG mechanics integration tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
