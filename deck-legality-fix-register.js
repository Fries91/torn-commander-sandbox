"use strict";

const path = require("path");
const Module = require("module");

const SERVER_PATH = path.resolve(__dirname, "server.js");
const META_SYNC_PATH = path.resolve(__dirname, "meta-sync.js");
const MARKER = "Arena Commander v60.1 deck validation hotfix";

function patchMetaSyncSource(input) {
  let source = String(input || "");
  if (source.includes(`${MARKER} meta`)) return source;

  const oldLegality = `function deckLegality(candidate, cardEntries, lookup) {
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
}`;

  const newLegality = `function deckLegality(candidate, cardEntries, lookup) {
  // ${MARKER} meta
  const total = cardEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const commanders = candidate.commanders || [];
  const commanderData = commanders
    .map((name) => lookup.get(cardKey(name)))
    .filter(Boolean);
  const commanderIdentity = new Set(
    commanderData.flatMap((card) => card?.colorIdentity || [])
  );
  const identityComplete =
    commanders.length > 0 &&
    commanderData.length === commanders.length;

  const missing = cardEntries
    .filter((entry) => !lookup.get(cardKey(entry.name)))
    .map((entry) => entry.name);

  const formatIllegal = cardEntries
    .filter((entry) => {
      const data = lookup.get(cardKey(entry.name));
      const status = data?.legalities?.commander;
      return status && !["legal", "restricted"].includes(status);
    })
    .map((entry) => entry.name);

  const colorIdentityIllegal = identityComplete
    ? cardEntries
        .filter((entry) => {
          const data = lookup.get(cardKey(entry.name));
          return (data?.colorIdentity || []).some(
            (color) => !commanderIdentity.has(color)
          );
        })
        .map((entry) => entry.name)
    : [];

  const illegal = [...new Set([
    ...formatIllegal,
    ...colorIdentityIllegal
  ])];

  if (!commanders.length || total !== 100) {
    return { status: "invalid", missing, illegal, colorIdentityIllegal, identityComplete };
  }
  if (illegal.length) {
    return { status: "illegal", missing, illegal, colorIdentityIllegal, identityComplete };
  }
  if (missing.length || !identityComplete) {
    return { status: "assisted", missing, illegal, colorIdentityIllegal, identityComplete };
  }
  return { status: "legal", missing, illegal, colorIdentityIllegal, identityComplete };
}`;

  if (!source.includes(oldLegality)) {
    throw new Error("v60.1 could not locate meta-sync deckLegality().");
  }
  source = source.replace(oldLegality, newLegality);

  const oldCommanderData = `  const commanderData = commanders.map((name) => lookup.get(cardKey(name))).filter(Boolean);
  const intelligenceCount = cards.filter((entry) => entry.cardData?.scryfallId).length;
  const deck = {`;

  const newCommanderData = `  const commanderData = commanders.map((name) => lookup.get(cardKey(name))).filter(Boolean);
  const commanderColorIdentity = uniqueBy(
    commanderData.flatMap((card) => card?.colorIdentity || []),
    (color) => color
  );
  const intelligenceCount = cards.filter((entry) => entry.cardData?.scryfallId).length;
  const deck = {`;

  if (!source.includes(oldCommanderData)) {
    throw new Error("v60.1 could not locate Meta commander data.");
  }
  source = source.replace(oldCommanderData, newCommanderData);

  if (!source.includes(`    commanders,
    commanderData,
    cards,`)) {
    throw new Error("v60.1 could not locate Meta deck fields.");
  }
  source = source.replace(
    `    commanders,
    commanderData,
    cards,`,
    `    commanders,
    commanderData,
    commanderColorIdentity,
    cards,`
  );

  if (!source.includes(`      externalId: candidate.externalId
    }`)) {
    throw new Error("v60.1 could not locate Meta metadata.");
  }
  source = source.replace(
    `      externalId: candidate.externalId
    }`,
    `      externalId: candidate.externalId,
      colors: commanderColorIdentity
    }`
  );

  return source;
}

function patchServerSource(input) {
  let source = String(input || "");
  if (source.includes(`${MARKER} server`)) return source;

  source = source.replace(
    `"use strict";`,
    `"use strict";

// ${MARKER} server
require("./deck-legality-fix-register.js").installMetaSyncHook();`
  );

  const oldIdentity = `  const commanderColors = new Set();
  for (const commander of normalized.commanders) {
    const data = commanderCardData(normalized, commander);
    if (data) for (const color of data.colorIdentity || []) commanderColors.add(color);
    const eligibility = commanderEligibilityError(data, rules);
    if (eligibility) errors.push(eligibility);
  }
  if (rules.colorIdentity && normalized.commanders.length && !(normalized.commanderData || []).length) warnings.push("Commander color identity could not be fully verified because commander data is missing.");`;

  const newIdentity = `  const explicitCommanderIdentity = normalizeStringArray(
    deck?.commanderColorIdentity ??
      deck?.commander_color_identity ??
      deck?.meta?.colors ??
      deck?.colors,
    10,
    4
  )
    .map((color) => String(color).toUpperCase())
    .filter((color) => /^[WUBRGC]$/.test(color));

  const commanderColors = new Set(explicitCommanderIdentity);
  let resolvedCommanderIdentities = explicitCommanderIdentity.length
    ? normalized.commanders.length
    : 0;

  for (const commander of normalized.commanders) {
    const data = commanderCardData(normalized, commander);
    const identity = Array.isArray(data?.colorIdentity)
      ? data.colorIdentity
          .map((color) => String(color).toUpperCase())
          .filter((color) => /^[WUBRGC]$/.test(color))
      : [];

    const identityResolved = Boolean(
      data &&
      (
        data.scryfallId ||
        data.oracleId ||
        identity.length
      )
    );

    if (identityResolved && !explicitCommanderIdentity.length) {
      resolvedCommanderIdentities += 1;
    }

    for (const color of identity) commanderColors.add(color);

    const eligibility = commanderEligibilityError(data, rules);
    if (eligibility) errors.push(eligibility);
  }

  const commanderIdentityComplete =
    normalized.commanders.length > 0 &&
    resolvedCommanderIdentities >= normalized.commanders.length;

  if (
    rules.colorIdentity &&
    normalized.commanders.length &&
    !commanderIdentityComplete
  ) {
    warnings.push(
      "Commander color identity is incomplete, so the app did not block cards using a partial identity."
    );
  }`;

  if (!source.includes(oldIdentity)) {
    throw new Error("v60.1 could not locate server commander identity validation.");
  }
  source = source.replace(oldIdentity, newIdentity);

  const oldCardCheck = `    if (rules.colorIdentity) {
      for (const color of entry.cardData?.colorIdentity || []) {
        if (commanderColors.size && !commanderColors.has(color)) errors.push(\`\${entry.name} is outside the commander's color identity.\`);
      }
    }`;

  const newCardCheck = `    if (rules.colorIdentity && commanderIdentityComplete) {
      const cardIdentity = (entry.cardData?.colorIdentity || [])
        .map((color) => String(color).toUpperCase())
        .filter((color) => /^[WUBRGC]$/.test(color));

      if (
        cardIdentity.some(
          (color) => !commanderColors.has(color)
        )
      ) {
        errors.push(
          \`\${entry.name} is outside the commander's color identity.\`
        );
      }
    }`;

  if (!source.includes(oldCardCheck)) {
    throw new Error("v60.1 could not locate server card identity validation.");
  }
  source = source.replace(oldCardCheck, newCardCheck);

  const statusRoute = `
app.get("/api/deck-validation-v60-1/status", (_request, response) => {
  response.json({
    success: true,
    version: "60.1.0",
    fixes: [
      "partial commander identity no longer creates false errors",
      "explicit commanderColorIdentity override supported",
      "Meta sync checks deck cards against commander identity",
      "Meta snapshots preserve commander identity"
    ]
  });
});
`;

  const match = /\napp\.get\(\s*["']\*["']\s*,/.exec(source)
    || /\nasync\s+function\s+start\s*\(/.exec(source)
    || /\n\s*server\.listen\s*\(/.exec(source);

  if (!match) throw new Error("v60.1 could not locate a route insertion point.");

  return source.slice(0, match.index) + statusRoute + source.slice(match.index);
}

let metaHookInstalled = false;

function installMetaSyncHook() {
  if (metaHookInstalled) return;
  metaHookInstalled = true;

  const previousLoader = Module._extensions[".js"];

  Module._extensions[".js"] = function v601MetaLoader(module, filename) {
    if (path.resolve(filename) !== META_SYNC_PATH) {
      return previousLoader(module, filename);
    }

    const originalCompile = module._compile;
    module._compile = function compileV601Meta(source, compiledFilename) {
      module._compile = originalCompile;
      return originalCompile.call(
        module,
        patchMetaSyncSource(source),
        compiledFilename
      );
    };

    return previousLoader(module, filename);
  };
}

function installServerHook() {
  const previousLoader = Module._extensions[".js"];

  Module._extensions[".js"] = function v601ServerLoader(module, filename) {
    if (path.resolve(filename) !== SERVER_PATH) {
      return previousLoader(module, filename);
    }

    Module._extensions[".js"] = previousLoader;
    const originalCompile = module._compile;

    module._compile = function compileV601Server(source, compiledFilename) {
      module._compile = originalCompile;
      return originalCompile.call(
        module,
        patchServerSource(source),
        compiledFilename
      );
    };

    return previousLoader(module, filename);
  };
}

module.exports = {
  version: "60.1.0",
  patchServerSource,
  patchMetaSyncSource,
  installMetaSyncHook
};

if (process.env.ARENA_V601_TEST_MODE !== "1") {
  installServerHook();
}
