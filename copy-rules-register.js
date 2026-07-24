"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectCopyRules(source) {
  if (source.includes("Arena Commander v54 copy-rules integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v54 copy-rules integration ----
(() => {
  const { createCopyRulesEngine } = require("./copy-rules-engine");

  const copyRulesEngine = createCopyRulesEngine({
    createId,
    nowIso,
    currentCardFace,
    currentTypeLine,
    currentOracleText,
    isCreatureCard,
    isPermanentCard,
    effectiveStats,
    findPlayer,
    findBattlefieldCard,
    locateCard,
    migrateCard,
    publicCard,
    resetPriority,
    queueSuggestedTriggers,
    runStateBasedActions,
    addLog
  });

  const v54LegacyProcessGameAction = processGameAction;
  processGameAction = function copyRulesProcessGameAction(
    room,
    actor,
    action
  ) {
    return copyRulesEngine.processGameAction(
      room,
      actor,
      action,
      v54LegacyProcessGameAction
    );
  };

  const v54LegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function copyRulesResolveStackTop(
    room,
    resolverName
  ) {
    const item = room.stack?.at(-1) || null;
    const gate = copyRulesEngine.beforeResolve(room, item);

    if (gate?.blocked) {
      return null;
    }

    const result = v54LegacyResolveStackTop(
      room,
      resolverName
    );

    if (result) {
      copyRulesEngine.afterResolve(room, item);
    }
    return result;
  };

  const v54LegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function copyRulesCreatePublicRoom(
    room,
    viewerId
  ) {
    const publicRoom = v54LegacyCreatePublicRoom(
      room,
      viewerId
    );
    publicRoom.copiesV54 = copyRulesEngine.summary(room);
    return publicRoom;
  };

  app.post("/api/copies-v54/state", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    response.setHeader("Cache-Control", "no-store");
    return response.json(
      copyRulesEngine.state(auth.room, auth.player.id)
    );
  });

  app.post("/api/copies-v54/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    response.setHeader("Cache-Control", "no-store");
    return response.json(
      copyRulesEngine.pending(auth.room, auth.player.id)
    );
  });

  app.post("/api/copies-v54/action", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const allowed = new Set([
      "copies-v54-token-copy",
      "copies-v54-stack-copy",
      "copies-v54-become-copy",
      "copies-v54-restore"
    ]);
    const type = String(request.body?.type || "");

    if (!allowed.has(type)) {
      return response.status(400).json({
        success: false,
        error: "Unsupported v54 copy action."
      });
    }

    const result = copyRulesEngine.processGameAction(
      auth.room,
      auth.player,
      request.body,
      v54LegacyProcessGameAction
    );
    if (!result.success) {
      return response.status(400).json(result);
    }

    recordReplayFrame(auth.room, auth.player.name, type);
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({
      success: true,
      result
    });
  });

  app.post("/api/copies-v54/resolve-clone", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = copyRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "copies-v54-resolve-clone",
        choiceId: request.body?.choiceId,
        sourceCardId: request.body?.sourceCardId,
        skip: Boolean(request.body?.skip)
      },
      v54LegacyProcessGameAction
    );
    if (!result.success) {
      return response.status(400).json(result);
    }

    recordReplayFrame(
      auth.room,
      auth.player.name,
      "Resolved Clone copy choice"
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({
      success: true,
      result
    });
  });

  app.get("/api/copies-v54/status", (_request, response) => {
    response.json(copyRulesEngine.status());
  });

  console.log(
    "Arena Commander copies, Clones and copyable-values engine v54.0.0 installed."
  );
})();
// ---- End Arena Commander v54 copy-rules integration ----
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
      "Arena Commander v54 found no safe server insertion point."
    );
    return source;
  }

  return source.slice(0, insertAt) +
    integration +
    source.slice(insertAt);
}

Module._extensions[".js"] = function copyRulesRegister(
  module,
  filename
) {
  if (path.resolve(filename) !== serverPath) {
    return previousLoader(module, filename);
  }

  Module._extensions[".js"] = previousLoader;
  const originalCompile = module._compile;

  module._compile = function compileWithCopyRules(
    source,
    compiledFilename
  ) {
    module._compile = originalCompile;
    return originalCompile.call(
      module,
      injectCopyRules(String(source)),
      compiledFilename
    );
  };

  return previousLoader(module, filename);
};
