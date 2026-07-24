"use strict";

const path = require("path");
const Module = require("module");

const SERVER_PATH = path.resolve(__dirname, "server.js");
const META_SYNC_PATH = path.resolve(__dirname, "meta-sync.js");
const MARKER = "Arena Commander v60.2 deck validation hotfix";
const VALIDATION_SCHEMA = "60.2.0";

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
    return {
      status: "invalid",
      missing,
      illegal,
      colorIdentityIllegal,
      identityComplete
    };
  }

  if (illegal.length) {
    return {
      status: "illegal",
      missing,
      illegal,
      colorIdentityIllegal,
      identityComplete
    };
  }

  if (missing.length || !identityComplete) {
    return {
      status: "assisted",
      missing,
      illegal,
      colorIdentityIllegal,
      identityComplete
    };
  }

  return {
    status: "legal",
    missing,
    illegal,
    colorIdentityIllegal,
    identityComplete
  };
}`;

  if (!source.includes(oldLegality)) {
    throw new Error(
      "v60.2 could not locate meta-sync deckLegality()."
    );
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
    throw new Error(
      "v60.2 could not locate Meta commander data."
    );
  }

  source = source.replace(oldCommanderData, newCommanderData);

  const oldDeckFields = `    commanders,
    commanderData,
    cards,`;

  const newDeckFields = `    commanders,
    commanderData,
    commanderColorIdentity,
    deckValidationSchema: "${VALIDATION_SCHEMA}",
    cards,`;

  if (!source.includes(oldDeckFields)) {
    throw new Error(
      "v60.2 could not locate Meta deck fields."
    );
  }

  source = source.replace(oldDeckFields, newDeckFields);

  const oldMeta = `      externalId: candidate.externalId
    }`;

  const newMeta = `      externalId: candidate.externalId,
      colors: commanderColorIdentity,
      deckValidationSchema: "${VALIDATION_SCHEMA}"
    }`;

  if (!source.includes(oldMeta)) {
    throw new Error(
      "v60.2 could not locate Meta metadata."
    );
  }

  source = source.replace(oldMeta, newMeta);

  const oldCurrentVersion = `    const current = oldVersionId
      ? await client.query(\`SELECT deck_hash FROM meta_deck_versions WHERE id = $1\`, [oldVersionId])
      : { rows: [] };
    if (current.rows[0]?.deck_hash === deckHash) {
      await client.query("COMMIT");
      return { status: "unchanged", deckId, versionId: oldVersionId, title: candidate.title };
    }`;

  const newCurrentVersion = `    const current = oldVersionId
      ? await client.query(
          \`SELECT deck_hash, deck_json FROM meta_deck_versions WHERE id = $1\`,
          [oldVersionId]
        )
      : { rows: [] };

    const currentSnapshot = current.rows[0]?.deck_json;
    const currentSchema =
      currentSnapshot?.deckValidationSchema ||
      currentSnapshot?.meta?.deckValidationSchema ||
      "";

    if (
      current.rows[0]?.deck_hash === deckHash &&
      currentSchema === "${VALIDATION_SCHEMA}"
    ) {
      await client.query("COMMIT");
      return {
        status: "unchanged",
        deckId,
        versionId: oldVersionId,
        title: candidate.title
      };
    }`;

  if (!source.includes(oldCurrentVersion)) {
    throw new Error(
      "v60.2 could not locate Meta unchanged-version check."
    );
  }

  source = source.replace(
    oldCurrentVersion,
    newCurrentVersion
  );

  return source;
}

function patchServerSource(input) {
  let source = String(input || "");
  if (source.includes(`${MARKER} server`)) return source;

  source = source.replace(
    `"use strict";`,
    `"use strict";

// ${MARKER} server`
  );

  const oldNormalizeReturn = `  return {
    id, name, commanders, commanderData, cards, totalCards, uniqueCards: cards.length,
    intelligenceCount,
    validation: totalCards === 100 ? "valid" : "warning"
  };
}`;

  const newNormalizeReturn = `  const commanderColorIdentity = normalizeStringArray(
    value.commanderColorIdentity ??
      value.commander_color_identity ??
      value.meta?.colors ??
      value.colors,
    10,
    4
  )
    .map((color) => String(color).toUpperCase())
    .filter((color) => /^[WUBRGC]$/.test(color));

  return {
    id,
    name,
    commanders,
    commanderData,
    commanderColorIdentity,
    deckValidationSchema:
      normalizeText(value.deckValidationSchema, 30) || "",
    cards,
    totalCards,
    uniqueCards: cards.length,
    intelligenceCount,
    validation: totalCards === 100 ? "valid" : "warning"
  };
}

function commanderRecordResolvedV602(data) {
  return Boolean(
    data &&
    (
      data.scryfallId ||
      data.oracleId ||
      (Array.isArray(data.colorIdentity) &&
        data.colorIdentity.length)
    )
  );
}

async function refreshDeckCommanderIdentityV602(deck) {
  const names = Array.isArray(deck?.commanders)
    ? deck.commanders
    : [];

  if (!names.length) {
    return {
      complete: false,
      notFound: []
    };
  }

  let payload = {
    resolved: [],
    notFound: []
  };

  try {
    payload = await resolveCardNames(names);
  } catch (error) {
    console.warn(
      "Commander identity refresh failed:",
      error?.message || error
    );
  }

  const lookup = new Map();

  for (const entry of payload.resolved || []) {
    if (!entry?.card) continue;

    if (entry.requestedName) {
      lookup.set(
        cardCacheKey(entry.requestedName),
        entry.card
      );
    }

    if (entry.card.name) {
      lookup.set(
        cardCacheKey(entry.card.name),
        entry.card
      );
    }

    for (const face of entry.card.faces || []) {
      if (face?.name) {
        lookup.set(
          cardCacheKey(face.name),
          entry.card
        );
      }
    }
  }

  const refreshedData = names
    .map(
      (name) =>
        lookup.get(cardCacheKey(name)) ||
        commanderCardData(deck, name) ||
        null
    )
    .filter(Boolean);

  if (refreshedData.length) {
    deck.commanderData = refreshedData;
  }

  const complete =
    refreshedData.length === names.length &&
    refreshedData.every(
      commanderRecordResolvedV602
    );

  if (complete) {
    deck.commanderColorIdentity = [
      ...new Set(
        refreshedData.flatMap(
          (card) => card?.colorIdentity || []
        )
      )
    ]
      .map((color) => String(color).toUpperCase())
      .filter((color) => /^[WUBRGC]$/.test(color));
  }

  deck.deckValidationSchema =
    "${VALIDATION_SCHEMA}";

  return {
    complete,
    notFound: payload.notFound || [],
    colorIdentity: [
      ...(deck.commanderColorIdentity || [])
    ]
  };
}`;

  if (!source.includes(oldNormalizeReturn)) {
    throw new Error(
      "v60.2 could not locate normalizeDeck() return."
    );
  }

  source = source.replace(
    oldNormalizeReturn,
    newNormalizeReturn
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

  const commanderColors = new Set(
    explicitCommanderIdentity
  );

  let resolvedCommanderIdentities =
    explicitCommanderIdentity.length
      ? normalized.commanders.length
      : 0;

  for (const commander of normalized.commanders) {
    const data = commanderCardData(
      normalized,
      commander
    );

    const identity = Array.isArray(
      data?.colorIdentity
    )
      ? data.colorIdentity
          .map(
            (color) =>
              String(color).toUpperCase()
          )
          .filter(
            (color) =>
              /^[WUBRGC]$/.test(color)
          )
      : [];

    const identityResolved = Boolean(
      data &&
      (
        data.scryfallId ||
        data.oracleId ||
        identity.length
      )
    );

    if (
      identityResolved &&
      !explicitCommanderIdentity.length
    ) {
      resolvedCommanderIdentities += 1;
    }

    for (const color of identity) {
      commanderColors.add(color);
    }

    const eligibility =
      commanderEligibilityError(
        data,
        rules
      );

    if (eligibility) {
      errors.push(eligibility);
    }
  }

  const commanderIdentityComplete =
    normalized.commanders.length > 0 &&
    resolvedCommanderIdentities >=
      normalized.commanders.length;

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
    throw new Error(
      "v60.2 could not locate server commander identity validation."
    );
  }

  source = source.replace(oldIdentity, newIdentity);

  const oldCardCheck = `    if (rules.colorIdentity) {
      for (const color of entry.cardData?.colorIdentity || []) {
        if (commanderColors.size && !commanderColors.has(color)) errors.push(\`\${entry.name} is outside the commander's color identity.\`);
      }
    }`;

  const newCardCheck = `    if (
      rules.colorIdentity &&
      commanderIdentityComplete
    ) {
      const cardIdentity = (
        entry.cardData?.colorIdentity || []
      )
        .map(
          (color) =>
            String(color).toUpperCase()
        )
        .filter(
          (color) =>
            /^[WUBRGC]$/.test(color)
        );

      if (
        cardIdentity.some(
          (color) =>
            !commanderColors.has(color)
        )
      ) {
        errors.push(
          \`\${entry.name} is outside the commander's color identity.\`
        );
      }
    }`;

  if (!source.includes(oldCardCheck)) {
    throw new Error(
      "v60.2 could not locate server card identity validation."
    );
  }

  source = source.replace(oldCardCheck, newCardCheck);

  const oldTestLabStart =
    `  socket.on("create-test-lab", (payload, callback) => {`;

  const newTestLabStart =
    `  socket.on("create-test-lab", async (payload, callback) => {`;

  if (!source.includes(oldTestLabStart)) {
    throw new Error(
      "v60.2 could not locate create-test-lab handler."
    );
  }

  source = source.replace(
    oldTestLabStart,
    newTestLabStart
  );

  const oldDeckLoad = `      const playerDeck = normalizeDeck(payload?.playerDeck);
      const botDeck = normalizeDeck(payload?.botDeck);
      if (!playerDeck || !botDeck) return fail(callback, "Choose two complete decks first.");
      const format = normalizeGameFormat(payload?.format);`;

  const newDeckLoad = `      const playerDeck = normalizeDeck(payload?.playerDeck);
      const botDeck = normalizeDeck(payload?.botDeck);

      if (!playerDeck || !botDeck) {
        return fail(
          callback,
          "Choose two complete decks first."
        );
      }

      const [
        playerCommanderRefresh,
        botCommanderRefresh
      ] = await Promise.all([
        refreshDeckCommanderIdentityV602(
          playerDeck
        ),
        refreshDeckCommanderIdentityV602(
          botDeck
        )
      ]);

      const format = normalizeGameFormat(payload?.format);`;

  if (!source.includes(oldDeckLoad)) {
    throw new Error(
      "v60.2 could not locate Test Lab deck loading."
    );
  }

  source = source.replace(
    oldDeckLoad,
    newDeckLoad
  );

  const oldValidationFailure = `      if (!room.formatRules.allowInvalidDecks && (!human.deckValidation.valid || !bot.deckValidation.valid)) {
        return fail(callback, human.deckValidation.errors[0] || bot.deckValidation.errors[0] || "A deck is not legal for the selected format.");
      }`;

  const newValidationFailure = `      if (
        !room.formatRules.allowInvalidDecks &&
        (
          !human.deckValidation.valid ||
          !bot.deckValidation.valid
        )
      ) {
        const humanError =
          human.deckValidation.errors[0];

        const botError =
          bot.deckValidation.errors[0];

        if (humanError) {
          return fail(
            callback,
            \`Your deck: \${humanError}\`
          );
        }

        if (botError) {
          return fail(
            callback,
            \`Meta bot deck: \${botError}\`
          );
        }

        return fail(
          callback,
          "A deck is not legal for the selected format."
        );
      }

      if (
        !playerCommanderRefresh.complete ||
        !botCommanderRefresh.complete
      ) {
        addLog(
          room,
          "One commander identity could not be refreshed. The game used the saved identity without applying partial-color blocking.",
          "rules"
        );
      }`;

  if (!source.includes(oldValidationFailure)) {
    throw new Error(
      "v60.2 could not locate Test Lab validation failure."
    );
  }

  source = source.replace(
    oldValidationFailure,
    newValidationFailure
  );

  const statusRoute = `
app.get(
  "/api/deck-validation-v60-2/status",
  (_request, response) => {
    response.json({
      success: true,
      version: "${VALIDATION_SCHEMA}",
      fixes: [
        "Solo Test Lab refreshes both commanders before validation",
        "normalizeDeck preserves commanderColorIdentity",
        "errors identify your deck or the Meta bot deck",
        "Meta sync validates combined commander identity",
        "old Meta snapshots are rebuilt once under schema ${VALIDATION_SCHEMA}"
      ]
    });
  }
);
`;

  const match =
    /\napp\.get\(\s*["']\*["']\s*,/.exec(
      source
    ) ||
    /\nasync\s+function\s+start\s*\(/.exec(
      source
    ) ||
    /\n\s*server\.listen\s*\(/.exec(
      source
    );

  if (!match) {
    throw new Error(
      "v60.2 could not locate a status-route insertion point."
    );
  }

  return (
    source.slice(0, match.index) +
    statusRoute +
    source.slice(match.index)
  );
}

let metaHookInstalled = false;
let serverHookInstalled = false;

function installMetaSyncHook() {
  if (metaHookInstalled) return;
  metaHookInstalled = true;

  const previousLoader =
    Module._extensions[".js"];

  Module._extensions[".js"] =
    function v602MetaLoader(
      module,
      filename
    ) {
      if (
        path.resolve(filename) !==
        META_SYNC_PATH
      ) {
        return previousLoader(
          module,
          filename
        );
      }

      const originalCompile =
        module._compile;

      module._compile =
        function compileV602Meta(
          source,
          compiledFilename
        ) {
          module._compile =
            originalCompile;

          return originalCompile.call(
            module,
            patchMetaSyncSource(source),
            compiledFilename
          );
        };

      return previousLoader(
        module,
        filename
      );
    };
}

function installServerHook() {
  if (serverHookInstalled) return;
  serverHookInstalled = true;

  const previousLoader =
    Module._extensions[".js"];

  Module._extensions[".js"] =
    function v602ServerLoader(
      module,
      filename
    ) {
      if (
        path.resolve(filename) !==
        SERVER_PATH
      ) {
        return previousLoader(
          module,
          filename
        );
      }

      Module._extensions[".js"] =
        previousLoader;

      const originalCompile =
        module._compile;

      module._compile =
        function compileV602Server(
          source,
          compiledFilename
        ) {
          module._compile =
            originalCompile;

          return originalCompile.call(
            module,
            patchServerSource(source),
            compiledFilename
          );
        };

      return previousLoader(
        module,
        filename
      );
    };
}

module.exports = {
  version: VALIDATION_SCHEMA,
  patchServerSource,
  patchMetaSyncSource,
  installMetaSyncHook,
  installServerHook
};

if (
  process.env.ARENA_V602_TEST_MODE !==
  "1"
) {
  installServerHook();
}
