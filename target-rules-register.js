"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectTargetRules(source) {
  if (source.includes("Arena Commander v44 targeting integration")) return source;

  const integration = `

// ---- Arena Commander v44 targeting integration ----
(() => {
  const { createTargetRulesEngine } = require("./target-rules-engine");

  const targetRulesEngine = createTargetRulesEngine({
    createId,
    nowIso,
    normalizeText,
    currentCardFace,
    currentTypeLine,
    currentOracleText,
    hasKeyword,
    isCreatureCard,
    findPlayer,
    locateCard,
    counterStackItem,
    publicCard,
    addLog
  });

  const targetLegacyProcessGameAction = processGameAction;
  processGameAction = function targetRulesProcessGameAction(room, actor, action) {
    return targetRulesEngine.processGameAction(
      room,
      actor,
      action,
      targetLegacyProcessGameAction
    );
  };

  app.post("/api/target-rules/candidates", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(targetRulesEngine.candidates(auth.room, auth.player, request.body || {}));
  });

  app.post("/api/target-rules/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json({
      success: true,
      version: "44.0.0",
      choices: targetRulesEngine.pending(auth.room, auth.player.id)
    });
  });

  app.post("/api/target-rules/resolve-ward", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = targetRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "resolve-ward",
        choiceId: request.body?.choiceId,
        pay: request.body?.pay,
        discardCardId: request.body?.discardCardId,
        sacrificeCardId: request.body?.sacrificeCardId
      },
      targetLegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);
    recordReplayFrame(auth.room, auth.player.name, "Resolved ward");
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);
    return response.json({ success: true, result });
  });

  app.get("/api/target-rules/status", (_request, response) => {
    response.json(targetRulesEngine.status());
  });

  console.log("Arena Commander targeting and ward engine v44.0.0 installed.");
})();
// ---- End Arena Commander v44 targeting integration ----
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
    console.error("Arena Commander v44 found no safe server insertion point.");
    return source;
  }
  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function targetRulesRegister(module, filename) {
  if (path.resolve(filename) !== serverPath) return previousLoader(module, filename);
  Module._extensions[".js"] = previousLoader;

  const originalCompile = module._compile;
  module._compile = function compileWithTargetRules(source, compiledFilename) {
    module._compile = originalCompile;
    return originalCompile.call(module, injectTargetRules(String(source)), compiledFilename);
  };
  return previousLoader(module, filename);
};
