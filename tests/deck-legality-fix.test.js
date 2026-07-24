"use strict";

const assert = require("assert");

process.env.ARENA_V602_TEST_MODE = "1";

const {
  patchServerSource,
  patchMetaSyncSource
} = require("../deck-legality-fix-register");

const serverFixture = `"use strict";
const app={get(){}};
function normalizeDeck(value) {
  const id = "id";
  const name = "Deck";
  const commanders = value.commanders || [];
  const commanderData = value.commanderData || [];
  const cards = value.cards || [];
  const totalCards = 100;
  const intelligenceCount = 100;
  return {
    id, name, commanders, commanderData, cards, totalCards, uniqueCards: cards.length,
    intelligenceCount,
    validation: totalCards === 100 ? "valid" : "warning"
  };
}
function validateDeckForFormat(deck, format = "commander", formatRules = null) {
  const normalized = normalizeDeck(deck);
  const normalizedFormat = normalizeGameFormat(format);
  const rules = normalizeFormatRules(formatRules, normalizedFormat);
  if (!normalized) return { valid: false, errors: ["Deck data is incomplete."], warnings: [], colorIdentity: [], format: normalizedFormat };
  const errors = [];
  const warnings = [];
  const commanderColors = new Set();
  for (const commander of normalized.commanders) {
    const data = commanderCardData(normalized, commander);
    if (data) for (const color of data.colorIdentity || []) commanderColors.add(color);
    const eligibility = commanderEligibilityError(data, rules);
    if (eligibility) errors.push(eligibility);
  }
  if (rules.colorIdentity && normalized.commanders.length && !(normalized.commanderData || []).length) warnings.push("Commander color identity could not be fully verified because commander data is missing.");
  for (const entry of normalized.cards) {
    if (rules.colorIdentity) {
      for (const color of entry.cardData?.colorIdentity || []) {
        if (commanderColors.size && !commanderColors.has(color)) errors.push(\`\${entry.name} is outside the commander's color identity.\`);
      }
    }
  }
}
const socket={on(){}};
  socket.on("create-test-lab", (payload, callback) => {
    try {
      const playerDeck = normalizeDeck(payload?.playerDeck);
      const botDeck = normalizeDeck(payload?.botDeck);
      if (!playerDeck || !botDeck) return fail(callback, "Choose two complete decks first.");
      const format = normalizeGameFormat(payload?.format);
      const human={deckValidation:{valid:false,errors:["Bad human"]}};
      const bot={deckValidation:{valid:false,errors:["Bad bot"]}};
      const room={formatRules:{allowInvalidDecks:false}};
      if (!room.formatRules.allowInvalidDecks && (!human.deckValidation.valid || !bot.deckValidation.valid)) {
        return fail(callback, human.deckValidation.errors[0] || bot.deckValidation.errors[0] || "A deck is not legal for the selected format.");
      }
    } catch (error) {}
});
app.get("*",()=>{});
`;

const patchedServer =
  patchServerSource(serverFixture);

assert(
  patchedServer.includes(
    "refreshDeckCommanderIdentityV602"
  )
);
assert(
  patchedServer.includes(
    'socket.on("create-test-lab", async'
  )
);
assert(
  patchedServer.includes(
    "commanderColorIdentity"
  )
);
assert(
  patchedServer.includes(
    "commanderIdentityComplete"
  )
);
assert(
  patchedServer.includes(
    "Your deck:"
  )
);
assert(
  patchedServer.includes(
    "Meta bot deck:"
  )
);
assert(
  patchedServer.includes(
    "/api/deck-validation-v60-2/status"
  )
);
assert(
  !patchedServer.includes(
    "commanderColors.size && !commanderColors.has"
  )
);

const metaFixture = `"use strict";
function deckLegality(candidate, cardEntries, lookup) {
  const total = cardEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const commanders = candidate.commanders || [];
  const missing = cardEntries.filter((entry) => !lookup.get(cardKey(entry.name))).map((entry) => entry.name);
  const illegal = cardEntries.filter((entry) => {
    const data = lookup.get(cardKey(entry.name));
    const status = data?.legalities?.commander;
    return status && !["legal", "restricted"].includes(status);
  }).map((entry) => entry.name);
  if (!commanders.length || total !== 100) return { status: "invalid", missing, illegal };
  if (illegal.length) return { status: "illegal", missing, illegal };
  if (missing.length) return { status: "assisted", missing, illegal };
  return { status: "legal", missing, illegal };
}
function buildPlayableDeck(candidate, lookup) {
  const entries=[];
  const cards=[];
  const commanders = candidate.commanders.map((name) => lookup.get(cardKey(name))?.name || name);
  const commanderData = commanders.map((name) => lookup.get(cardKey(name))).filter(Boolean);
  const intelligenceCount = cards.filter((entry) => entry.cardData?.scryfallId).length;
  const deck = {
    commanders,
    commanderData,
    cards,
    meta: {
      externalId: candidate.externalId
    }
  };
  return deck;
}
async function updateVersion(client, oldVersionId, deckHash) {
    const current = oldVersionId
      ? await client.query(\`SELECT deck_hash FROM meta_deck_versions WHERE id = $1\`, [oldVersionId])
      : { rows: [] };
    if (current.rows[0]?.deck_hash === deckHash) {
      await client.query("COMMIT");
      return { status: "unchanged", deckId, versionId: oldVersionId, title: candidate.title };
    }
}
`;

const patchedMeta =
  patchMetaSyncSource(metaFixture);

assert(
  patchedMeta.includes(
    "colorIdentityIllegal"
  )
);
assert(
  patchedMeta.includes(
    "commanderColorIdentity"
  )
);
assert(
  patchedMeta.includes(
    'deckValidationSchema: "60.2.0"'
  )
);
assert(
  patchedMeta.includes(
    "SELECT deck_hash, deck_json"
  )
);
assert(
  patchedMeta.includes(
    'currentSchema === "60.2.0"'
  )
);

console.log(
  "Arena Commander v60.2 Test Lab validation tests passed."
);
`;

const patchedServer = patchServerSource(serverFixture);
assert(patchedServer.includes("commanderIdentityComplete"));
assert(patchedServer.includes("explicitCommanderIdentity"));
assert(patchedServer.includes("/api/deck-validation-v60-1/status"));
assert(!patchedServer.includes("commanderColors.size && !commanderColors.has"));

const metaFixture = `"use strict";
function deckLegality(candidate, cardEntries, lookup) {
  const total = cardEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const commanders = candidate.commanders || [];
  const missing = cardEntries.filter((entry) => !lookup.get(cardKey(entry.name))).map((entry) => entry.name);
  const illegal = cardEntries.filter((entry) => {
    const data = lookup.get(cardKey(entry.name));
    const status = data?.legalities?.commander;
    return status && !["legal", "restricted"].includes(status);
  }).map((entry) => entry.name);
  if (!commanders.length || total !== 100) return { status: "invalid", missing, illegal };
  if (illegal.length) return { status: "illegal", missing, illegal };
  if (missing.length) return { status: "assisted", missing, illegal };
  return { status: "legal", missing, illegal };
}
function buildPlayableDeck(candidate, lookup) {
  const entries=[];
  const cards=[];
  const commanders = candidate.commanders.map((name) => lookup.get(cardKey(name))?.name || name);
  const commanderData = commanders.map((name) => lookup.get(cardKey(name))).filter(Boolean);
  const intelligenceCount = cards.filter((entry) => entry.cardData?.scryfallId).length;
  const deck = {
    commanders,
    commanderData,
    cards,
    meta: {
      externalId: candidate.externalId
    }
  };
  return deck;
}
`;

const patchedMeta = patchMetaSyncSource(metaFixture);
assert(patchedMeta.includes("colorIdentityIllegal"));
assert(patchedMeta.includes("commanderColorIdentity"));
assert(patchedMeta.includes("colors: commanderColorIdentity"));

console.log("Arena Commander v60.1 deck-validation hotfix tests passed.");
