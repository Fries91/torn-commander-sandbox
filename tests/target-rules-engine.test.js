"use strict";

const assert = require("assert");
const { createTargetRulesEngine, _test } = require("../target-rules-engine");

let nextId = 0;
const deps = {
  createId: () => `id-${++nextId}`,
  nowIso: () => "2026-07-24T00:00:00.000Z",
  normalizeText: (value) => String(value || ""),
  currentCardFace: (card) => card.cardData || {},
  currentTypeLine: (card) => card.cardData?.typeLine || "",
  currentOracleText: (card) => card.cardData?.oracleText || "",
  hasKeyword: (card, keyword) =>
    (card.cardData?.keywords || []).some((entry) => entry.toLowerCase() === String(keyword).toLowerCase()),
  isCreatureCard: (card) => /\bCreature\b/i.test(card.cardData?.typeLine || ""),
  findPlayer: (room, id) => room.players.find((player) => player.id === id),
  locateCard: (room, id) => {
    for (const player of room.players) {
      for (const zone of ["battlefield", "hand", "graveyard", "exile"]) {
        const index = player.game[zone].findIndex((card) => card.id === id);
        if (index >= 0) return { player, zone, index, card: player.game[zone][index] };
      }
    }
    return null;
  },
  counterStackItem: (room, id) => {
    const index = room.stack.findIndex((item) => item.id === id);
    if (index >= 0) room.stack.splice(index, 1);
  },
  publicCard: (card) => card,
  addLog: () => {}
};

function card(id, name, typeLine, oracleText = "", keywords = [], controllerId = "p2") {
  return {
    id, name, controllerId, ownerId: controllerId,
    tapped: false, attacking: false, blockingCardId: null, phasedOut: false,
    summoningSick: false,
    cardData: { name, typeLine, oracleText, keywords, colors: ["R"] }
  };
}

const source = card("bolt", "Red Spell", "Instant", "Destroy target creature.", [], "p1");
const hexproof = card("hex", "Hexproof Beast", "Creature — Beast", "", ["hexproof"], "p2");
const normal = card("normal", "Normal Beast", "Creature — Beast", "Ward {2}", [], "p2");
const shroud = card("shroud", "Shrouded Beast", "Creature — Beast", "", ["shroud"], "p1");
const protectedCard = card("protected", "Protected Beast", "Creature — Beast", "Protection from red", [], "p2");

const p1 = {
  id: "p1", name: "Caster",
  game: {
    life: 40,
    manaPool: { W:0,U:0,B:0,R:0,G:0,C:0 },
    hand: [],
    graveyard: [],
    exile: [],
    battlefield: [
      card("mountain", "Mountain", "Basic Land — Mountain", "", [], "p1"),
      card("sol", "Sol Ring", "Artifact", "{T}: Add {C}{C}.", [], "p1")
    ]
  }
};
const p2 = {
  id: "p2", name: "Opponent",
  game: { life:40, manaPool:{W:0,U:0,B:0,R:0,G:0,C:0}, hand:[], graveyard:[], exile:[], battlefield:[hexproof, normal, protectedCard] }
};
const room = { players:[p1,p2], stack:[], triggerQueue:[], wardChoices:[], hostId:"p1" };

const specs = _test.parseTargetSpecs("Destroy target creature.");
assert.equal(specs.length, 1);

let result = _test.assignTargets(room, p1, source, source.id, specs, [`card:${normal.id}`], deps);
assert.equal(result.success, true);

result = _test.assignTargets(room, p1, source, source.id, specs, [`card:${hexproof.id}`], deps);
assert.equal(result.success, false);

result = _test.assignTargets(room, p1, source, source.id, specs, [`card:${protectedCard.id}`], deps);
assert.equal(result.success, false);

p1.game.battlefield.push(shroud);
result = _test.assignTargets(room, p1, source, source.id, specs, [`card:${shroud.id}`], deps);
assert.equal(result.success, false);

const ward = _test.parseWardCosts(normal, deps);
assert.equal(ward[0].mana.generic, 2);
const payment = _test.autoPayWard(room, p1, ward[0], deps);
assert.equal(payment.success, true);
assert(p1.game.battlefield.some((entry) => entry.tapped));

const engine = createTargetRulesEngine(deps);
room.stack.push({ id:"stack-1", name:"Red Spell", kind:"spell", controllerId:"p1", card:source });
room.wardChoices.push({
  id:"ward-1", status:"open", playerId:"p1", stackItemId:"stack-1",
  target:{kind:"card",id:normal.id,name:normal.name},
  sourceName:"Red Spell",
  cost:{raw:"{2}",mana:{W:0,U:0,B:0,R:0,G:0,C:0,generic:0},life:0,discard:false,sacrifice:false,supported:true}
});
result = engine.processGameAction(room, p1, { type:"resolve-ward", choiceId:"ward-1", pay:false }, () => ({success:true}));
assert.equal(result.success, true);
assert.equal(room.stack.length, 0);

console.log("Arena target-rules engine v44 tests passed.");
