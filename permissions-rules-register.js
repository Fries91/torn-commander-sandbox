"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectPermissionsRules(source) {
  if (source.includes("Arena Commander v47 permissions integration")) return source;

  const integration = `

// ---- Arena Commander v47 permissions integration ----
(() => {
  const { createPermissionsRulesEngine } = require("./permissions-rules-engine");

  const permissionsRulesEngine = createPermissionsRulesEngine({
    PHASES,
    createId,
    nowIso,
    currentCardFace,
    currentTypeLine,
    currentOracleText,
    isCreatureCard,
    findPlayer,
    locateCard,
    findBattlefieldCard,
    migrateCard,
    publicCard,
    resetPriority,
    addLog
  });

  const permissionsLegacyProcessGameAction = processGameAction;
  processGameAction = function permissionsProcessGameAction(room, actor, action) {
    return permissionsRulesEngine.processGameAction(
      room, actor, action, permissionsLegacyProcessGameAction
    );
  };

  const permissionsLegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function permissionsResolveStackTop(room, resolverName) {
    const item = room.stack?.at(-1) || null;
    const result = permissionsLegacyResolveStackTop(room, resolverName);
    permissionsRulesEngine.afterResolve(room, item);
    return result;
  };

  app.post("/api/permissions/list", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json({
      success: true,
      version: "47.0.0",
      permissions: permissionsRulesEngine.permissions(auth.room, auth.player.id)
    });
  });

  app.post("/api/permissions/play", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = permissionsRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        ...request.body,
        type: "permission-play-card"
      },
      permissionsLegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(auth.room, auth.player.name, "Played a permitted card");
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);
    return response.json({ success: true, result });
  });

  app.post("/api/permissions/copy-candidates", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json({
      success: true,
      version: "47.0.0",
      ...permissionsRulesEngine.copyCandidates(auth.room)
    });
  });

  app.post("/api/permissions/copy-stack", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    const result = permissionsRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "copy-stack-item",
        stackItemId: request.body?.stackItemId,
        targets: request.body?.targets
      },
      permissionsLegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    return response.json({ success: true, result });
  });

  app.post("/api/permissions/copy-permanent", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    const result = permissionsRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "copy-permanent",
        targetCardId: request.body?.targetCardId
      },
      permissionsLegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    return response.json({ success: true, result });
  });

  app.get("/api/permissions/status", (_request, response) => {
    response.json(permissionsRulesEngine.status());
  });

  console.log("Arena Commander permissions, copying and linked-exile engine v47.0.0 installed.");
})();
// ---- End Arena Commander v47 permissions integration ----
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
    console.error("Arena Commander v47 found no safe server insertion point.");
    return source;
  }
  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function permissionsRulesRegister(module, filename) {
  if (path.resolve(filename) !== serverPath) return previousLoader(module, filename);
  Module._extensions[".js"] = previousLoader;
  const originalCompile = module._compile;
  module._compile = function compileWithPermissionsRules(source, compiledFilename) {
    module._compile = originalCompile;
    return originalCompile.call(module, injectPermissionsRules(String(source)), compiledFilename);
  };
  return previousLoader(module, filename);
};
