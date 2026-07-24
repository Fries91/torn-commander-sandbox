"use strict";

const assert=require("assert");
const {createPermissionsRulesEngine,_test}=require("../permissions-rules-engine");

let id=0;
const deps={
  PHASES:["Main 1","Cleanup"],
  createId:()=>`id-${++id}`,
  nowIso:()=>"2026-07-24T00:00:00.000Z",
  currentCardFace:(card)=>card.cardData||{},
  currentTypeLine:(card)=>card.cardData?.typeLine||"",
  currentOracleText:(card)=>card.cardData?.oracleText||"",
  isCreatureCard:(card)=>/\bCreature\b/i.test(card.cardData?.typeLine||""),
  findPlayer:(room,playerId)=>room.players.find((player)=>player.id===playerId),
  locateCard:(room,cardId)=>{
    for(const player of room.players)for(const zone of ["battlefield","exile","graveyard","hand","library"]){
      const index=player.game[zone].findIndex((card)=>card.id===cardId);
      if(index>=0)return{player,zone,index,card:player.game[zone][index]};
    }
    return null;
  },
  findBattlefieldCard:(room,cardId)=>{
    for(const player of room.players){
      const index=player.game.battlefield.findIndex((card)=>card.id===cardId);
      if(index>=0)return{player,zone:"battlefield",index,card:player.game.battlefield[index]};
    }
    return null;
  },
  migrateCard:(card)=>JSON.parse(JSON.stringify(card)),
  publicCard:(card)=>card,
  resetPriority:()=>{},
  addLog:()=>{}
};

function card(id,name,typeLine,oracleText="",ownerId="p1"){
  return{id,name,ownerId,controllerId:ownerId,tapped:false,phasedOut:false,token:false,counters:{},
    cardData:{name,typeLine,oracleText,imageUrl:""}};
}

const impulse=card("impulse","Impulse Spell","Sorcery","Exile the top two cards of your library. Until end of turn, you may play those cards.");
const linkedSource=card("prison","Prison","Enchantment","When Prison enters, exile target creature until Prison leaves the battlefield.");
const victim=card("victim","Victim","Creature — Human","", "p2");
const copyTarget=card("copyme","Copy Me","Creature — Beast","");

const p1={id:"p1",name:"One",game:{library:[card("a","A","Land"),card("b","B","Creature")],hand:[],battlefield:[linkedSource,copyTarget],graveyard:[],exile:[],commandZone:[],manaPool:{}}};
const p2={id:"p2",name:"Two",game:{library:[],hand:[],battlefield:[victim],graveyard:[],exile:[],commandZone:[],manaPool:{}}};
const room={players:[p1,p2],turn:{number:3,phaseIndex:0},stack:[],playPermissions:[],permissionsV47:{},hostId:"p1"};

const granted=_test.impulseExile(room,p1,impulse.cardData.oracleText,impulse.name,deps);
assert.equal(granted.length,2);
assert.equal(room.playPermissions.length,2);
assert.equal(p1.game.exile.length,2);

const link=_test.linkedExile(room,{sourceCardId:"prison",name:"Prison trigger",targets:["card:victim"],text:"Exile target creature until Prison leaves the battlefield."},deps);
assert(link);
assert.equal(p2.game.battlefield.length,0);
assert.equal(p2.game.exile.length,1);

p1.game.battlefield=p1.game.battlefield.filter((card)=>card.id!=="prison");
_test.reconcileLinkedExile(room,deps);
assert.equal(p2.game.exile.length,0);
assert.equal(p2.game.battlefield.length,1);

let result=_test.copyPermanent(room,p1,"copyme",deps);
assert.equal(result.success,true);
assert(p1.game.battlefield.some((card)=>card.token&&card.copiedFromCardId==="copyme"));

room.stack.push({id:"stack1",name:"Spell",kind:"spell",controllerId:"p2",targets:[],effect:{action:"draw",amount:1}});
result=_test.copyStackItem(room,p1,"stack1",[],deps);
assert.equal(result.success,true);
assert(room.stack.some((item)=>item.isCopy));

const engine=createPermissionsRulesEngine(deps);
const permissions=engine.permissions(room,"p1");
assert(permissions.length>=2);

console.log("Arena permissions and copy engine v47 tests passed.");
