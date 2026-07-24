"use strict";

const assert = require("assert");
const { createMechanicsRulesEngine, _test } = require("../mechanics-rules-engine");

let id=0;
const deps={
  createId:()=>`id-${++id}`,
  nowIso:()=>"2026-07-24T00:00:00.000Z",
  currentCardFace:(card)=>card.cardData||{},
  currentTypeLine:(card)=>card.cardData?.typeLine||"",
  currentOracleText:(card)=>card.cardData?.oracleText||"",
  hasKeyword:(card,keyword)=>(card.cardData?.keywords||[]).some((entry)=>entry.toLowerCase()===String(keyword).toLowerCase()),
  isCreatureCard:(card)=>/\bCreature\b/i.test(card.cardData?.typeLine||""),
  getCardFromZone:(game,zone,cardId)=>{
    const index=game[zone].findIndex((card)=>card.id===cardId);
    return index<0?null:{card:game[zone][index],index};
  },
  findPlayer:(room,playerId)=>room.players.find((player)=>player.id===playerId),
  publicCard:(card)=>card,
  shuffle:(cards)=>[...cards].reverse(),
  addLog:()=>{}
};

function card(id,name,typeLine,manaCost,oracleText="",keywords=[]){
  return {id,name,ownerId:"p1",controllerId:"p1",tapped:false,phasedOut:false,summoningSick:false,
    cardData:{name,typeLine,manaCost,oracleText,keywords,manaValue:3}};
}

const spell=card(
  "spell","Mechanic Spell","Sorcery","{3}{U}",
  "Kicker {1}{G}\nOverload {4}{U}\nBuyback {2}\nCascade\nDiscover 2.",
  ["Convoke","Delve"]
);
const mechanics=_test.parseMechanics(spell,deps);
assert.equal(mechanics.kicker,"{1}{G}");
assert.equal(mechanics.overload,"{4}{U}");
assert.equal(mechanics.buyback,"{2}");
assert.equal(mechanics.cascadeCount,1);
assert.equal(mechanics.discoverValue,2);

let plan=_test.costPlan(spell,{
  kicker:true,buyback:true,xValue:0,
  convokeCardIds:["c1"],delveCardIds:["g1"]
},deps);
assert.equal(plan.kickerCount,1);
assert.equal(plan.buyback,true);
assert.equal(plan.requirement.generic,4);
assert.equal(plan.requirement.U,1);
assert.equal(plan.requirement.G,1);

plan=_test.costPlan(spell,{overload:true},deps);
assert.equal(plan.alternative,"overload");
assert.equal(plan.effectiveManaCost,"{4}{U}");
assert(!/\btarget\b/i.test(_test.overloadedText("Return target creature and target player.")));

const landCard=card("land","Land","Land","", ""); landCard.cardData.manaValue=0;
const bigCard=card("big","Big","Creature","{5}",""); bigCard.cardData.manaValue=5;
const smallCard=card("small","Small","Creature","{1}",""); smallCard.cardData.manaValue=1;
const player={
  id:"p1",name:"Tester",
  game:{library:[landCard,bigCard,smallCard],hand:[spell],battlefield:[],graveyard:[],exile:[],manaPool:{}}
};
const room={players:[player],mechanicsV46:{choices:[]},playPermissions:[],stack:[]};
const choice=_test.discover(room,player,"Discover Spell",2,deps);
assert(choice);
assert.equal(choice.kind,"discover");
assert.equal(choice.candidateCardId,"small");

let result=_test.resolveChoice(room,player,{choiceId:choice.id,decision:"hand"},deps);
assert.equal(result.success,true);
assert(player.game.hand.some((entry)=>entry.id==="small"));

const engine=createMechanicsRulesEngine(deps);
const preview=engine.preview(room,player,{cardId:"spell",fromZone:"hand"});
assert.equal(preview.success,true);

console.log("Arena advanced mechanics engine v46 tests passed.");
