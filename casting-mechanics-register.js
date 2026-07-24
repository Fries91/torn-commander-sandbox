"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectCastingMechanics(source) {
  if (source.includes("Arena Commander v50 casting-mechanics integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v50 casting-mechanics integration ----
(() => {
  const { createCastingMechanicsEngine } = require("./casting-mechanics-engine");

  const castingMechanicsEngine = createCastingMechanicsEngine({
    PHASES,
    createId,
    nowIso,
    currentCardFace,
    currentTypeLine,
    currentOracleText,
    isCreatureCard,
    findPlayer,
    getCardFromZone,
    findBattlefieldCard,
    publicCard,
    resetPriority,
    queueSuggestedTriggers,
    addLog
  });

  const v50LegacyProcessGameAction = processGameAction;
  processGameAction = function castingMechanicsProcessGameAction(
    room,
    actor,
    action
  ) {
    return castingMechanicsEngine.processGameAction(
      room,
      actor,
      action,
      v50LegacyProcessGameAction
    );
  };

  const v50LegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function castingMechanicsResolveStackTop(
    room,
    resolverName
  ) {
    const item = room.stack?.at(-1) || null;
    const beforeZones = castingMechanicsEngine.beforeResolve(room);
    const result = v50LegacyResolveStackTop(room, resolverName);
    if (result) {
      castingMechanicsEngine.afterResolve(room, item, beforeZones);
    }
    return result;
  };

  const v50LegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function castingMechanicsCreatePublicRoom(
    room,
    viewerId
  ) {
    const publicRoom = v50LegacyCreatePublicRoom(room, viewerId);
    publicRoom.castingV50 = {
      version: "50.0.0",
      pendingChoiceCount:
        room.castingV50?.choices?.filter(
          (choice) => choice.status === "open"
        ).length || 0,
      suspendedCount:
        room.castingV50?.suspended?.filter(
          (entry) => entry.status === "waiting"
        ).length || 0,
      foretoldCount:
        room.castingV50?.foretold?.filter(
          (entry) => entry.status === "waiting"
        ).length || 0
    };
    return publicRoom;
  };

  app.post("/api/casting-v50/preview", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      castingMechanicsEngine.preview(auth.room, auth.player, request.body || {})
    );
  });

  app.post("/api/casting-v50/cast", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = castingMechanicsEngine.processGameAction(
      auth.room,
      auth.player,
      {
        ...request.body,
        type: "casting-v50-cast"
      },
      v50LegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(
      auth.room,
      auth.player.name,
      "Cast with v50 mechanic"
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.post("/api/casting-v50/action", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const allowed = new Set([
      "casting-v50-foretell",
      "casting-v50-suspend",
      "casting-v50-cast-timed"
    ]);
    const type = String(request.body?.type || "");
    if (!allowed.has(type)) {
      return response.status(400).json({
        success: false,
        error: "Unsupported v50 casting action."
      });
    }

    const result = castingMechanicsEngine.processGameAction(
      auth.room,
      auth.player,
      request.body,
      v50LegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(auth.room, auth.player.name, type);
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.post("/api/casting-v50/state", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      castingMechanicsEngine.state(auth.room, auth.player.id)
    );
  });

  app.post("/api/casting-v50/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      castingMechanicsEngine.pending(auth.room, auth.player.id)
    );
  });

  app.post("/api/casting-v50/resolve", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = castingMechanicsEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "casting-v50-resolve-choice",
        choiceId: request.body?.choiceId,
        useAbility: Boolean(request.body?.useAbility),
        sacrificeCardId: request.body?.sacrificeCardId,
        targets: request.body?.targets
      },
      v50LegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(
      auth.room,
      auth.player.name,
      "Resolved v50 casting choice"
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.get("/api/casting-v50/status", (_request, response) => {
    response.json(castingMechanicsEngine.status());
  });

  console.log(
    "Arena Commander remaining casting mechanics engine v50.0.0 installed."
  );
})();
// ---- End Arena Commander v50 casting-mechanics integration ----
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
      "Arena Commander v50 found no safe server insertion point."
    );
    return source;
  }

  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function castingMechanicsRegister(
  module,
  filename
) {
  if (path.resolve(filename) !== serverPath) {
    return previousLoader(module, filename);
  }

  Module._extensions[".js"] = previousLoader;
  const originalCompile = module._compile;

  module._compile = function compileWithCastingMechanics(
    source,
    compiledFilename
  ) {
    module._compile = originalCompile;
    return originalCompile.call(
      module,
      injectCastingMechanics(String(source)),
      compiledFilename
    );
  };

  return previousLoader(module, filename);
};
