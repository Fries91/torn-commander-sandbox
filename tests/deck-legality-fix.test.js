"use strict";

const assert = require("assert");
process.env.ARENA_V601_TEST_MODE = "1";

const {
  patchServerSource,
  patchMetaSyncSource
} = require("../deck-legality-fix-register");

const serverFixture = `"use strict";
const app={get(){}};
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
app.get("*",()=>{});
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
