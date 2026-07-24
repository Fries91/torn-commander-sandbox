"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectArenaRules(source) {
  if (source.includes("Arena Commander v42 auto-tap rules integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v42 auto-tap rules integration ----
(() => {
  const { createArenaRulesEngine } = require("./arena-rules-engine");

  const arenaRulesEngine = createArenaRulesEngine({
    PHASES,
    clamp,
    normalizeText,
    normalizeManaPool,
    currentCardFace,
    currentTypeLine,
    currentOracleText,
    hasKeyword,
    isCreatureCard,
    isInstantSpeed,
    getCardFromZone,
    findPlayer,
    activePlayerIds,
    validateTargets,
    addLog
  });

  const arenaRulesLegacyProcessGameAction = processGameAction;
  processGameAction = function arenaRulesProcessGameAction(room, actor, action) {
    return arenaRulesEngine.processGameAction(
      room,
      actor,
      action,
      arenaRulesLegacyProcessGameAction
    );
  };

  app.post("/api/arena-rules/preview", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    return response.json(
      arenaRulesEngine.preview(auth.room, auth.player, request.body || {})
    );
  });

  app.get("/api/arena-rules/status", (_request, response) => {
    response.json(arenaRulesEngine.status());
  });

  console.log("Arena Commander auto-tap rules engine v42.0.0 installed.");
})();
// ---- End Arena Commander v42 auto-tap rules integration ----
`;

  const patterns = [
    /\napp\.get\(\s*["']\*["']\s*,/,
    /\napp\.use\(\s*["']\/api["']\s*,/,
    /\nasync\s+function\s+start\s*\(/,
    /\n\s*server\.listen\s*\(/
  ];

  let insertAt = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (match) {
      insertAt = match.index;
      break;
    }
  }

  if (insertAt < 0) {
    console.error(
      "Arena Commander v42 rules integration found no safe insertion point. The existing server will continue without Auto-Tap."
    );
    return source;
  }

  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function arenaRulesRegister(module, filename) {
  if (path.resolve(filename) !== serverPath) {
    return previousLoader(module, filename);
  }

  // The v40 automation preloader runs before this preloader. It calls
  // module._compile with its already-injected server source. Wrapping _compile
  // here lets both integrations coexist without either loader bypassing the other.
  Module._extensions[".js"] = previousLoader;

  const originalCompile = module._compile;
  module._compile = function compileWithArenaRules(source, compiledFilename) {
    module._compile = originalCompile;
    return originalCompile.call(
      module,
      injectArenaRules(String(source)),
      compiledFilename
    );
  };

  return previousLoader(module, filename);
};
