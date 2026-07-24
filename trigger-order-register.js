"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectTriggerOrder(source) {
  if (source.includes("Arena Commander v48 trigger-order integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v48 trigger-order integration ----
(() => {
  const { createTriggerOrderEngine } = require("./trigger-order-engine");

  const triggerOrderEngine = createTriggerOrderEngine({
    PHASES,
    createId,
    nowIso,
    currentTypeLine,
    currentOracleText,
    isCreatureCard,
    findPlayer,
    locateCard,
    activePlayerIds,
    resetPriority,
    queueTrigger,
    publicCard,
    addLog
  });

  const v48LegacyProcessGameAction = processGameAction;
  processGameAction = function triggerOrderProcessGameAction(room, actor, action) {
    return triggerOrderEngine.processGameAction(
      room,
      actor,
      action,
      v48LegacyProcessGameAction
    );
  };

  const v48LegacyQueueSuggestedTriggers = queueSuggestedTriggers;
  queueSuggestedTriggers = function triggerOrderQueueSuggestedTriggers(
    room,
    event,
    context
  ) {
    const beforeIds = new Set((room.triggerQueue || []).map((trigger) => trigger.id));
    const result = v48LegacyQueueSuggestedTriggers(room, event, context);
    const added = (room.triggerQueue || []).filter(
      (trigger) => !beforeIds.has(trigger.id)
    );
    if (added.length) {
      triggerOrderEngine.captureSuggested(room, event, added, context || {});
    }
    return result;
  };

  const v48LegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function triggerOrderResolveStackTop(room, resolverName) {
    const prepared = triggerOrderEngine.beforeResolve(room);
    if (prepared.handled) return prepared.result;

    const item = room.stack?.at(-1) || null;
    const result = v48LegacyResolveStackTop(room, resolverName);
    if (result) {
      triggerOrderEngine.afterResolve(
        room,
        item,
        v48LegacyProcessGameAction
      );
    }
    return result;
  };

  const v48LegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function triggerOrderCreatePublicRoom(room, viewerId) {
    return Object.assign(
      v48LegacyCreatePublicRoom(room, viewerId),
      triggerOrderEngine.publicSummary(room)
    );
  };

  app.post("/api/triggers/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      triggerOrderEngine.pending(auth.room, auth.player.id)
    );
  });

  app.post("/api/triggers/order", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = triggerOrderEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "resolve-trigger-order",
        batchId: request.body?.batchId,
        orderedTriggerIds: request.body?.orderedTriggerIds,
        targetsByTrigger: request.body?.targetsByTrigger
      },
      v48LegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(auth.room, auth.player.name, "Ordered simultaneous triggers");
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({
      success: true,
      version: "48.0.0",
      pending: triggerOrderEngine.pending(auth.room, auth.player.id)
    });
  });

  app.post("/api/triggers/may", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = triggerOrderEngine.resolveMay(
      auth.room,
      auth.player,
      request.body?.choiceId,
      Boolean(request.body?.useAbility),
      v48LegacyResolveStackTop,
      v48LegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(
      auth.room,
      auth.player.name,
      request.body?.useAbility
        ? "Accepted optional trigger"
        : "Declined optional trigger"
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({
      success: true,
      version: "48.0.0",
      pending: triggerOrderEngine.pending(auth.room, auth.player.id)
    });
  });

  app.get("/api/triggers/status", (_request, response) => {
    response.json(triggerOrderEngine.status());
  });

  console.log(
    "Arena Commander trigger order and APNAP engine v48.0.0 installed."
  );
})();
// ---- End Arena Commander v48 trigger-order integration ----
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
      "Arena Commander v48 found no safe server insertion point."
    );
    return source;
  }

  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function triggerOrderRegister(module, filename) {
  if (path.resolve(filename) !== serverPath) {
    return previousLoader(module, filename);
  }

  Module._extensions[".js"] = previousLoader;

  const originalCompile = module._compile;
  module._compile = function compileWithTriggerOrder(source, compiledFilename) {
    module._compile = originalCompile;
    return originalCompile.call(
      module,
      injectTriggerOrder(String(source)),
      compiledFilename
    );
  };

  return previousLoader(module, filename);
};
