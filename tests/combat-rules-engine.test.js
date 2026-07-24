"use strict";

const assert = require("assert");
const { createCombatRulesEngine, _test } = require("../combat-rules-engine");

let nextId = 0;
const deps = {
  PHASES: [
    "Untap", "Upkeep", "Draw", "Main 1", "Beginning Combat",
    "Declare Attackers", "Declare Blockers", "First-Strike Damage",
    "Combat Damage", "End Combat", "Main 2", "End", "Cleanup"
  ],
  createId: () => `id-${++nextId}`,
  nowIso: () => "2026-07-24T00:00:00.000Z",
  currentCardFace: (card) => card.cardData || {},
  currentTypeLine: (card) => card.cardData?.typeLine || "",
  currentOracleText: (card) => card.cardData?.oracleText || "",
  isCreatureCard: (card) => /\bCreature\b/i.test(card.cardData?.typeLine || ""),
  hasKeyword: (card, keyword) => {
    const values = new Set([
      ...(card.cardData?.keywords || []),
      ...(card.manualKeywords || [])
    ].map((entry) => String(entry).toLowerCase()));
    return values.has(String(keyword).toLowerCase()) ||
      new RegExp(`\\b${String(keyword).replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i")
        .test(card.cardData?.oracleText || "");
  },
  effectiveStats: (card) => ({
    power: Number(card.power ?? card.cardData?.power ?? 0),
    toughness: Number(card.toughness ?? card.cardData?.toughness ?? 0)
  }),
  findPlayer: (room, playerId) => room.players.find((player) => player.id === playerId),
  findBattlefieldCard: (room, cardId) => {
    for (const player of room.players) {
      const index = player.game.battlefield.findIndex((card) => card.id === cardId);
      if (index >= 0) return { player, zone: "battlefield", index, card: player.game.battlefield[index] };
    }
    return null;
  },
  legalDefenderIds: (room, attackerId) => room.players
    .filter((player) => player.id !== attackerId && !player.game.lost && !player.game.conceded)
    .map((player) => player.id),
  dealPlayerDamage: (room, source, target, amount) => {
    target.game.life -= amount;
    room.damageLog.push({ kind: "player", source: source.id, target: target.id, amount });
  },
  dealCreatureDamage: (room, source, target, amount) => {
    target.damageMarked = (Number(target.damageMarked) || 0) + amount;
    if (deps.hasKeyword(source, "deathtouch")) target.deathtouchMarked = true;
    room.damageLog.push({ kind: "creature", source: source.id, target: target.id, amount });
  },
  queueSuggestedTriggers: (room, event, context) => room.triggerEvents.push({ event, context }),
  resetPriority: (room, playerId) => { room.priority = { playerId, passedPlayerIds: [] }; },
  migrateCard: (card) => JSON.parse(JSON.stringify(card)),
  publicCard: (card) => card ? JSON.parse(JSON.stringify(card)) : null,
  addLog: (room, text, type) => room.log.push({ text, type })
};

function card(id, name, keywords = [], extras = {}) {
  return {
    id,
    name,
    ownerId: extras.ownerId || "p1",
    controllerId: extras.controllerId || extras.ownerId || "p1",
    tapped: Boolean(extras.tapped),
    token: Boolean(extras.token),
    attacking: Boolean(extras.attacking),
    defendingPlayerId: extras.defendingPlayerId || null,
    blockingCardId: extras.blockingCardId || null,
    summoningSick: Boolean(extras.summoningSick),
    phasedOut: false,
    damageMarked: 0,
    deathtouchMarked: false,
    power: extras.power ?? 2,
    toughness: extras.toughness ?? 2,
    specialState: {},
    cardData: {
      name,
      typeLine: extras.typeLine || "Creature",
      oracleText: extras.oracleText || "",
      keywords,
      imageUrl: ""
    }
  };
}

function player(id) {
  return {
    id,
    name: id,
    game: {
      life: 40,
      lost: false,
      conceded: false,
      manaPool: { W:0,U:0,B:0,R:0,G:0,C:0 },
      hand: [], library: [], battlefield: [], graveyard: [], exile: [], commandZone: []
    }
  };
}

const p1 = player("p1");
const p2 = player("p2");
const p3 = player("p3");
const room = {
  players: [p1, p2, p3],
  hostId: "p1",
  turn: { number: 3, phaseIndex: 6, activePlayerId: "p1", order: ["p1", "p2", "p3"] },
  combatV51: {},
  priority: { playerId: "p1", passedPlayerIds: [] },
  damageLog: [], triggerEvents: [], log: []
};

const menace = card("menace", "Menace", ["menace"], {
  attacking: true, defendingPlayerId: "p2", power: 3, toughness: 3
});
const blockerA = card("ba", "Blocker A", [], {
  ownerId: "p2", controllerId: "p2", blockingCardId: "menace"
});
p1.game.battlefield.push(menace);
p2.game.battlefield.push(blockerA);
assert.equal(_test.validateMenace(room, deps).success, false);
const blockerB = card("bb", "Blocker B", [], {
  ownerId: "p2", controllerId: "p2", blockingCardId: "menace"
});
p2.game.battlefield.push(blockerB);
assert.equal(_test.validateMenace(room, deps).success, true);

const flyer = card("fly", "Flyer", ["flying"]);
const ground = card("ground", "Ground");
const reach = card("reach", "Reach", ["reach"]);
assert.equal(_test.blockerCanBlock(ground, flyer, deps).success, false);
assert.equal(_test.blockerCanBlock(reach, flyer, deps).success, true);

const goaded = card("goaded", "Goaded", [], { power: 2, toughness: 2 });
goaded.specialState.goadedByV51 = [{ playerId: "p2", expiresTurnNumber: 10 }];
p1.game.battlefield.push(goaded);
assert.deepEqual(_test.legalPlayerDefenders(room, "p1", goaded, deps), ["p3"]);
assert.equal(_test.validateGoadAttackRequirements(room, p1, deps).success, false);
goaded.attacking = true;
goaded.defendingPlayerId = "p3";
assert.equal(_test.validateGoadAttackRequirements(room, p1, deps).success, true);

const trample = card("tram", "Trampler", ["trample", "deathtouch"], {
  attacking: true, defendingPlayerId: "p2", power: 5, toughness: 5
});
const tiny = card("tiny", "Tiny", [], {
  ownerId: "p2", controllerId: "p2", blockingCardId: "tram", toughness: 4
});
trample.specialState.wasBlockedV51 = true;
p1.game.battlefield.push(trample);
p2.game.battlefield.push(tiny);
_test.dealAttackerDamage(room, trample, "normal", deps);
assert.equal(tiny.damageMarked, 1);
assert.equal(p2.game.life, 36);

const first = card("first", "First", ["first strike"], {
  attacking: true, defendingPlayerId: "p3", power: 2
});
const double = card("double", "Double", ["double strike"], {
  attacking: true, defendingPlayerId: "p3", power: 2
});
p1.game.battlefield.push(first, double);
assert.equal(_test.eligibleForPass(first, "first", deps), true);
assert.equal(_test.eligibleForPass(first, "normal", deps), false);
assert.equal(_test.eligibleForPass(double, "first", deps), true);
assert.equal(_test.eligibleForPass(double, "normal", deps), true);

const annihilator = card("anni", "Annihilator", [], {
  attacking: true,
  defendingPlayerId: "p2",
  oracleText: "Annihilator 2"
});
p1.game.battlefield.push(annihilator);
const choice = _test.annihilatorOnAttack(room, annihilator, deps);
assert(choice);
assert.equal(choice.amount, 2);

const myriad = card("myriad", "Myriad", ["myriad"], {
  attacking: true, defendingPlayerId: "p2"
});
p1.game.battlefield.push(myriad);
const tokens = _test.myriadOnAttack(room, myriad, deps);
assert.equal(tokens.length, 1);
assert.equal(tokens[0].defendingPlayerId, "p3");
_test.cleanupMyriad(room, deps);
assert(!p1.game.battlefield.some((entry) => entry.specialState?.myriadTokenV51));

const ninja = card("ninja", "Ninja", [], { oracleText: "Ninjutsu {1}{U}" });
assert.deepEqual(_test.parseNinjutsu(ninja, deps), { manaCost: "{1}{U}" });

const engine = createCombatRulesEngine(deps);
const status = engine.status();
assert.equal(status.success, true);
assert.equal(status.version, "51.0.0");

console.log("Arena complete combat rules engine v51 tests passed.");
