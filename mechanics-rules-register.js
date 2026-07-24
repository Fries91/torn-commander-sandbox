"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectMechanicsRules(source) {
  if (source.includes("Arena Commander v46 mechanics integration")) return source;

  const integration = `

// ---- Arena Commander v46 mechanics integration ----
(() => {
  const { createMechanicsRulesEngine } = require("./mechanics-rules-engine");

  const mechanicsRulesEngine = createMechanicsRulesEngine({
    createId,
    nowIso,
    currentCardFace,
    currentTypeLine,
    currentOracleText,
    hasKeyword,
    isCreatureCard,
    getCardFromZone,
    findPlayer,
    publicCard,
    shuffle,
    addLog
  });

  const mechanicsLegacyProcessGameAction = processGameAction;
  processGameAction = function mechanicsProcessGameAction(room, actor, action) {
    return mechanicsRulesEngine.processGameAction(
      room, actor, action, mechanicsLegacyProcessGameAction
    );
  };

  const mechanicsLegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function mechanicsResolveStackTop(room, resolverName) {
    const item = room.stack?.at(-1) || null;
    const result = mechanicsLegacyResolveStackTop(room, resolverName);
    mechanicsRulesEngine.afterResolve(room, item);
    return result;
  };

  app.post("/api/mechanics/preview", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(mechanicsRulesEngine.preview(auth.room, auth.player, request.body || {}));
  });

  app.post("/api/mechanics/cast", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = mechanicsRulesEngine.processGameAction(
      auth.room,
      auth.player,
      { ...request.body, type: "mechanic-auto-cast" },
      mechanicsLegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(auth.room, auth.player.name, "Cast with advanced mechanic");
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);
    return response.json({ success: true, result });
  });

  app.post("/api/mechanics/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json({
      success: true,
      version: "46.0.0",
      choices: mechanicsRulesEngine.pending(auth.room, auth.player.id)
    });
  });

  app.post("/api/mechanics/resolve", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = mechanicsRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "resolve-mechanic-choice",
        choiceId: request.body?.choiceId,
        decision: request.body?.decision
      },
      mechanicsLegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(auth.room, auth.player.name, "Resolved advanced mechanic");
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);
    return response.json({ success: true, result });
  });

  app.get("/api/mechanics/status", (_request, response) => {
    response.json(mechanicsRulesEngine.status());
  });

  console.log("Arena Commander advanced casting mechanics v46.0.0 installed.");
})();
// ---- End Arena Commander v46 mechanics integration ----
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
    if (match) { insertAt = match.index; break; }
  }
  if (insertAt < 0) {
    console.error("Arena Commander v46 found no safe server insertion point.");
    return source;
  }
  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function mechanicsRulesRegister(module, filename) {
  if (path.resolve(filename) !== serverPath) return previousLoader(module, filename);
  Module._extensions[".js"] = previousLoader;
  const originalCompile = module._compile;
  module._compile = function compileWithMechanicsRules(source, compiledFilename) {
    module._compile = originalCompile;
    return originalCompile.call(module, injectMechanicsRules(String(source)), compiledFilename);
  };
  return previousLoader(module, filename);
};
