"use strict";

const assert = require("assert");
const {
  createCopyRulesEngine,
  _test
} = require("../copy-rules-engine");

let nextId = 0;

const deps = {
  createId: () => `id-${++nextId}`,
  nowIso: () => "2026-07-24T00:00:00.000Z",
  currentCardFace: (card) =>
    card.cardData?.faces?.[card.activeFaceIndex || 0] ||
    card.cardData ||
    {},
  currentTypeLine: (card) =>
    card.cardData?.faces?.[card.activeFaceIndex || 0]?.typeLine ||
    card.cardData?.typeLine ||
    "",
  currentOracleText: (card) =>
    card.cardData?.faces?.[card.activeFaceIndex || 0]?.oracleText ||
    card.cardData?.oracleText ||
    "",
  isCreatureCard: (card) =>
    /\bCreature\b/i.test(deps.currentTypeLine(card)),
  isPermanentCard: (card) =>
    /\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker)\b/i
      .test(deps.currentTypeLine(card)),
  effectiveStats: (card) => {
    const power = Number(
      card.power ?? deps.currentCardFace(card).power
    );
    const toughness = Number(
      card.toughness ?? deps.currentCardFace(card).toughness
    );
    return Number.isFinite(power) && Number.isFinite(toughness)
      ? { power, toughness }
      : null;
  },
  findPlayer: (room, playerId) =>
    room.players.find((player) => player.id === playerId),
  findBattlefieldCard: (room, cardId) => {
    for (const player of room.players) {
      const index = player.game.battlefield.findIndex(
        (card) => card.id === cardId
      );
      if (index >= 0) {
        return {
          player,
          card: player.game.battlefield[index],
          index,
          zone: "battlefield"
        };
      }
    }
    return null;
  },
  locateCard: (room, cardId) => {
    for (const player of room.players) {
      for (const zone of [
        "battlefield",
        "hand",
        "graveyard",
        "exile",
        "commandZone",
        "library"
      ]) {
        const index = player.game[zone].findIndex(
          (card) => card.id === cardId
        );
        if (index >= 0) {
          return {
            player,
            card: player.game[zone][index],
            index,
            zone
          };
        }
      }
    }
    return null;
  },
  migrateCard: (card) => JSON.parse(JSON.stringify(card)),
  publicCard: (card) =>
    card ? JSON.parse(JSON.stringify(card)) : null,
  resetPriority: (room, playerId) => {
    room.priority = {
      playerId,
      passedPlayerIds: []
    };
  },
  queueSuggestedTriggers: (room, event, context) => {
    room.triggerEvents.push({ event, context });
  },
  runStateBasedActions: (room, reason) => {
    room.stateChecks.push(reason);
    return [];
  },
  addLog: (room, text, type) => {
    room.log.push({ text, type });
  }
};

function makeCard(
  id,
  name,
  typeLine,
  oracleText = "",
  extras = {}
) {
  return {
    id,
    name,
    ownerId: extras.ownerId || "p1",
    controllerId:
      extras.controllerId ||
      extras.ownerId ||
      "p1",
    tapped: Boolean(extras.tapped),
    counters: extras.counters || {},
    damageMarked: Number(extras.damageMarked) || 0,
    deathtouchMarked: false,
    token: Boolean(extras.token),
    commander: Boolean(extras.commander),
    attacking: Boolean(extras.attacking),
    defendingPlayerId: extras.defendingPlayerId || null,
    blockingCardId: extras.blockingCardId || null,
    attachedToId: extras.attachedToId || null,
    summoningSick: Boolean(extras.summoningSick),
    activeFaceIndex: 0,
    manualKeywords: extras.manualKeywords || [],
    temporaryEffects: extras.temporaryEffects || [],
    ruleEffects: [],
    judgeOverrides: {},
    specialState: extras.specialState || {},
    power: extras.power,
    toughness: extras.toughness,
    loyalty: extras.loyalty,
    defense: extras.defense,
    objectType: extras.objectType || "card",
    cardData: {
      name,
      typeLine,
      oracleText,
      manaCost: extras.manaCost || "",
      manaValue: extras.manaValue || 0,
      power: extras.power,
      toughness: extras.toughness,
      loyalty: extras.loyalty,
      defense: extras.defense,
      keywords: extras.keywords || [],
      imageUrl: "",
      faces: extras.faces || []
    }
  };
}

function makePlayer(id, isBot = false) {
  return {
    id,
    name: id,
    isBot,
    game: {
      life: 40,
      lost: false,
      conceded: false,
      hand: [],
      library: [],
      battlefield: [],
      graveyard: [],
      exile: [],
      commandZone: []
    }
  };
}

const p1 = makePlayer("p1");
const p2 = makePlayer("p2");
const room = {
  players: [p1, p2],
  hostId: "p1",
  stack: [],
  priority: {
    playerId: "p1",
    passedPlayerIds: []
  },
  copiesV54: {},
  triggerEvents: [],
  stateChecks: [],
  log: []
};

const source = makeCard(
  "source",
  "Source Legend",
  "Legendary Creature — Shapeshifter",
  "Flying",
  {
    ownerId: "p2",
    controllerId: "p2",
    tapped: true,
    counters: { "+1/+1": 3 },
    damageMarked: 2,
    attachedToId: "equipment",
    power: "4",
    toughness: "4",
    manaValue: 5,
    keywords: ["Flying"],
    temporaryEffects: [
      { power: 8, toughness: 8, expires: "end-of-turn" }
    ]
  }
);
p2.game.battlefield.push(source);

const blueprint = _test.copyableBlueprint(source, deps);
assert.equal(blueprint.name, "Source Legend");
assert.equal(blueprint.power, "4");
assert.equal(blueprint.toughness, "4");
assert(!Object.prototype.hasOwnProperty.call(blueprint, "counters"));
assert(!Object.prototype.hasOwnProperty.call(blueprint, "tapped"));

const modified = _test.applyCopyModifications(
  blueprint,
  {
    nonlegendary: true,
    addArtifact: true,
    power: "1",
    toughness: "1",
    addKeywords: ["Haste"]
  }
);
assert(!/\bLegendary\b/i.test(
  modified.cardData.typeLine
));
assert(/\bArtifact\b/i.test(
  modified.cardData.typeLine
));
assert.equal(modified.power, "1");
assert.equal(modified.toughness, "1");
assert(modified.cardData.keywords.includes("Haste"));

const token = _test.createTokenCopy(
  room,
  p1,
  source,
  { nonlegendary: true },
  deps
);
assert.equal(token.token, true);
assert.equal(token.tapped, false);
assert.deepEqual(token.counters, {});
assert.equal(token.attachedToId, null);
assert.equal(token.damageMarked, 0);
assert.equal(token.copiedFromCardId, "source");

const existing = makeCard(
  "existing",
  "Existing",
  "Creature — Human",
  "",
  {
    tapped: true,
    counters: { shield: 1 },
    damageMarked: 1,
    attachedToId: "sword",
    power: "2",
    toughness: "2"
  }
);
p1.game.battlefield.push(existing);

let result = _test.becomeCopy(
  room,
  p1,
  "existing",
  "source",
  {},
  deps
);
assert.equal(result.success, true);
assert.equal(existing.name, "Source Legend");
assert.equal(existing.tapped, true);
assert.deepEqual(existing.counters, { shield: 1 });
assert.equal(existing.damageMarked, 1);
assert.equal(existing.attachedToId, "sword");

result = _test.restoreOriginalCopy(
  room,
  p1,
  "existing",
  deps
);
assert.equal(result.success, true);
assert.equal(existing.name, "Existing");
assert.equal(existing.tapped, true);

room.stack.push({
  id: "spell",
  kind: "spell",
  name: "Fire Spell",
  controllerId: "p2",
  sourceCardId: "fire-card",
  card: null,
  text: "Deal X damage.",
  targets: ["player:p1"],
  effect: {
    action: "damage",
    amount: 4
  },
  selectedModes: ["damage"],
  xValue: 4,
  additionalCosts: {
    kicked: true
  },
  dividedAmounts: {
    "player:p1": 4
  },
  createdAt: deps.nowIso()
});

result = _test.copyStackItem(
  room,
  p1,
  "spell",
  ["player:p2"],
  deps
);
assert.equal(result.success, true);
const spellCopy = room.stack.find(
  (item) => item.id === result.copyId
);
assert.equal(spellCopy.isCopy, true);
assert.deepEqual(spellCopy.targets, ["player:p2"]);
assert.deepEqual(spellCopy.v54Meta.copiedModes, ["damage"]);
assert.equal(spellCopy.v54Meta.copiedXValue, 4);
assert.deepEqual(
  spellCopy.v54Meta.copiedAdditionalCosts,
  { kicked: true }
);

const permanentSpellCard = makeCard(
  "permanent-spell-card",
  "Permanent Spell",
  "Creature — Illusion",
  "",
  {
    power: "3",
    toughness: "3"
  }
);
room.stack.push({
  id: "permanent-spell",
  kind: "spell",
  name: "Permanent Spell",
  controllerId: "p2",
  sourceCardId: permanentSpellCard.id,
  card: permanentSpellCard,
  text: "",
  targets: [],
  createdAt: deps.nowIso()
});

result = _test.copyStackItem(
  room,
  p1,
  "permanent-spell",
  [],
  deps
);
assert.equal(result.success, true);
const permanentCopy = room.stack.find(
  (item) => item.id === result.copyId
);
assert.equal(permanentCopy.card.token, true);
assert.equal(
  permanentCopy.card.specialState.notCreatedTokenV54,
  true
);

const cloneSpellCard = makeCard(
  "clone-card",
  "Test Clone",
  "Creature — Shapeshifter",
  "You may have Test Clone enter the battlefield as a copy of any creature on the battlefield.",
  {
    power: "0",
    toughness: "0"
  }
);
const cloneItem = {
  id: "clone-stack",
  kind: "spell",
  name: "Test Clone",
  controllerId: "p1",
  card: cloneSpellCard,
  targets: [],
  text: cloneSpellCard.cardData.oracleText
};
room.stack.push(cloneItem);

const instruction = _test.cloneInstruction(
  cloneSpellCard,
  deps
);
assert.equal(instruction.optional, true);
assert.equal(instruction.kind, "creature");

const gate = _test.beforeResolve(
  room,
  cloneItem,
  deps
);
assert.equal(gate.blocked, true);
const choice = room.copiesV54.choices.find(
  (entry) => entry.stackItemId === cloneItem.id
);
assert(choice);

result = _test.resolveCloneChoice(
  room,
  p1,
  {
    choiceId: choice.id,
    sourceCardId: source.id
  },
  deps
);
assert.equal(result.success, true);
assert.equal(cloneItem.card.name, "Source Legend");
assert.equal(
  cloneItem.card.specialState.copyChoiceResolvedV54,
  true
);

const autoItem = {
  id: "auto-copy-effect",
  kind: "spell",
  name: "Copy Effect",
  controllerId: "p1",
  text: "Create a token that's a copy of target creature, except it isn't legendary.",
  targets: ["card:source"]
};
assert.equal(
  _test.automaticCopyPattern(autoItem.text),
  true
);
_test.suppressOlderCopyEngine(room, autoItem);
assert(!/\bcopy\b/i.test(autoItem.text));
_test.restoreSuppressedText(room, autoItem);
assert(/\bcopy\b/i.test(autoItem.text));

const engine = createCopyRulesEngine(deps);
const status = engine.status();
assert.equal(status.success, true);
assert.equal(status.version, "54.0.0");

console.log(
  "Arena copies, Clones and copyable-values engine v54 tests passed."
);
