"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectAttachmentRules(source) {
  if (source.includes("Arena Commander v53 attachment-rules integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v53 attachment-rules integration ----
(() => {
  const { createAttachmentRulesEngine } = require("./attachment-rules-engine");

  const attachmentRulesEngine = createAttachmentRulesEngine({
    PHASES,
    createId,
    nowIso,
    currentCardFace,
    currentTypeLine,
    currentOracleText,
    isCreatureCard,
    hasKeyword,
    effectiveStats,
    findPlayer,
    findBattlefieldCard,
    getCardFromZone,
    locateCard,
    publicCard,
    pushStack,
    resetPriority,
    queueSuggestedTriggers,
    runStateBasedActions,
    addLog
  });

  const v53LegacyProcessGameAction = processGameAction;
  processGameAction = function attachmentRulesProcessGameAction(
    room,
    actor,
    action
  ) {
    return attachmentRulesEngine.processGameAction(
      room,
      actor,
      action,
      v53LegacyProcessGameAction
    );
  };

  const v53LegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function attachmentRulesResolveStackTop(
    room,
    resolverName
  ) {
    const item = room.stack?.at(-1) || null;
    const beforeIds = attachmentRulesEngine.beforeResolve(room);
    const result = v53LegacyResolveStackTop(room, resolverName);
    if (result) {
      attachmentRulesEngine.afterResolve(room, item, beforeIds);
    }
    return result;
  };

  const v53LegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function attachmentRulesCreatePublicRoom(
    room,
    viewerId
  ) {
    const publicRoom = v53LegacyCreatePublicRoom(room, viewerId);
    publicRoom.attachmentsV53 = attachmentRulesEngine.summary(room);
    return publicRoom;
  };

  app.post("/api/attachments-v53/preview", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      attachmentRulesEngine.preview(
        auth.room,
        auth.player,
        request.body || {}
      )
    );
  });

  app.post("/api/attachments-v53/state", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      attachmentRulesEngine.state(auth.room, auth.player.id)
    );
  });

  app.post("/api/attachments-v53/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      attachmentRulesEngine.pending(auth.room, auth.player.id)
    );
  });

  app.post("/api/attachments-v53/action", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const allowed = new Set([
      "attachments-v53-cast-aura",
      "attachments-v53-activate",
      "attachments-v53-crew",
      "attachments-v53-saddle"
    ]);
    const type = String(request.body?.type || "");

    if (!allowed.has(type)) {
      return response.status(400).json({
        success: false,
        error: "Unsupported v53 action."
      });
    }

    const result = attachmentRulesEngine.processGameAction(
      auth.room,
      auth.player,
      request.body,
      v53LegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(auth.room, auth.player.name, type);
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.post("/api/attachments-v53/resolve-aura", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = attachmentRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "attachments-v53-resolve-aura",
        choiceId: request.body?.choiceId,
        targetKey: request.body?.targetKey
      },
      v53LegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(
      auth.room,
      auth.player.name,
      "Resolved Aura attachment choice"
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.get("/api/attachments-v53/status", (_request, response) => {
    response.json(attachmentRulesEngine.status());
  });

  console.log(
    "Arena Commander attachments, Vehicles and Mounts engine v53.0.0 installed."
  );
})();
// ---- End Arena Commander v53 attachment-rules integration ----
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
      "Arena Commander v53 found no safe server insertion point."
    );
    return source;
  }

  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function attachmentRulesRegister(
  module,
  filename
) {
  if (path.resolve(filename) !== serverPath) {
    return previousLoader(module, filename);
  }

  Module._extensions[".js"] = previousLoader;
  const originalCompile = module._compile;

  module._compile = function compileWithAttachmentRules(
    source,
    compiledFilename
  ) {
    module._compile = originalCompile;
    return originalCompile.call(
      module,
      injectAttachmentRules(String(source)),
      compiledFilename
    );
  };

  return previousLoader(module, filename);
};
