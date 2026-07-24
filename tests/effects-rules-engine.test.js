"use strict";

const assert = require("assert");
const { createEffectsRulesEngine, _test } = require("../effects-rules-engine");

let id = 0;
const deps = {
  createId: () => `id-${++id}`,
  nowIso: () => "2026-07-24T00:00:00.000Z",
  currentCardFace: (card) => card.cardData || {},
  currentTypeLine: (card) => card.cardData?.typeLine || "",
  currentOracleText: (card) => card.cardData?.oracleText || "",
  isCreatureCard: (card) => /\bCreature\b/i.test(card.cardData?.typeLine || ""),
  findPlayer: (room, playerId) => room.players.find((player) => player.id === playerId),
  getCardFromZone: (game, zone, cardId) => {
    const index = game[zone].findIndex((card) => card.id === cardId);
    return index < 0 ? null : { card: game[zone][index], index };
  },
  migrateCard: (card) => JSON.parse(JSON.stringify(card)),
  addLog: () => {}
};

function card(id, name, typeLine, oracleText = "", controllerId = "p1") {
  return {
    id, name, controllerId, ownerId: controllerId,
    tapped:false, phasedOut:false, token:false, counters:{},
    cardData:{name,typeLine,oracleText}
  };
}

const lord = card("lord", "Elf Lord", "Creature — Elf", "Other creatures you control get +1/+1 and have flying.");
const elf = card("elf", "Elf", "Creature — Elf", "");
const preventer = card("shield", "Shield", "Artifact", "If a source would deal damage to you, prevent 1 of that damage.");
const doubler = card("double", "Damage Doubler", "Enchantment", "If a source you control would deal damage, it deals double that damage instead.");

const p1 = {
  id:"p1", name:"One",
  game:{life:40,hand:[],battlefield:[lord,elf,doubler],graveyard:[],exile:[],library:[],manaPool:{}}
};
const p2 = {
  id:"p2", name:"Two",
  game:{life:40,hand:[],battlefield:[preventer],graveyard:[],exile:[],library:[],manaPool:{}}
};
const room = {players:[p1,p2],hostId:"p1",effectsV45:{},turn:{phaseIndex:4}};

const effects = _test.parseAnthemEffects(room,deps);
assert(effects.some((effect)=>effect.kind==="stats"));
assert(effects.some((effect)=>effect.kind==="keyword"));

const stats = _test.modifyStats(room, elf, {power:2,toughness:2}, deps);
assert.equal(stats.power,3);
assert.equal(stats.toughness,3);
assert.equal(_test.grantsKeyword(room, elf, "flying", deps), true);
assert.equal(_test.grantsKeyword(room, lord, "flying", deps), false);

const damage = _test.replaceDamage(room, elf, p2, 3, "player", false, deps);
assert.equal(damage,5);

const shock = card("pool","Breeding Pool","Land — Forest Island","As Breeding Pool enters the battlefield, you may pay 2 life. If you don't, it enters tapped.");
assert.equal(_test.shockLifeChoice(shock,deps),2);

const engine = createEffectsRulesEngine(deps);
p1.game.hand.push(shock);
let legacyCalls = 0;
let result = engine.processGameAction(room,p1,{
  type:"move-card",fromZone:"hand",toZone:"battlefield",cardId:"pool"
},()=>{legacyCalls+=1;return{success:true};});
assert.equal(result.success,true);
assert.equal(result.pendingReplacement,true);
assert.equal(legacyCalls,0);

console.log("Arena effects engine v45 tests passed.");
