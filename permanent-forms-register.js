"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectPermanentForms(source) {
  if (source.includes("Arena Commander v49 permanent-forms integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v49 permanent-forms integration ----
(() => {
  const { createPermanentFormsEngine } = require("./permanent-forms-engine");

  const permanentFormsEngine = createPermanentFormsEngine({
    PHASES,
    createId,
    nowIso,
    currentTypeLine,
    currentOracleText,
    isCreatureCard,
    findPlayer,
    getCardFromZone,
    locateCard,
    findBattlefieldCard,
    migrateCard,
    publicCard,
    pushStack,
    queueSuggestedTriggers,
    addLog
  });

  const v49LegacyProcessGameAction = processGameAction;
  processGameAction = function permanentFormsProcessGameAction(
    room,
    actor,
    action
  ) {
    return permanentFormsEngine.processGameAction(
      room,
      actor,
      action,
      v49LegacyProcessGameAction
    );
  };

  const v49LegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function permanentFormsResolveStackTop(
    room,
    resolverName
  ) {
    const item = room.stack?.at(-1) || null;
    const result = v49LegacyResolveStackTop(room, resolverName);
    if (result) permanentFormsEngine.afterResolve(room, item);
    return result;
  };

  const v49LegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function permanentFormsCreatePublicRoom(
    room,
    viewerId
  ) {
    const publicRoom = v49LegacyCreatePublicRoom(room, viewerId);
    publicRoom.formsV49 = {
      version: "49.0.0",
      dayNight: room.rules?.dayNight || null,
      pendingBattleChoiceCount:
        room.formsV49?.battleChoices?.filter(
          (choice) => choice.status === "open"
        ).length || 0
    };
    return publicRoom;
  };

  app.post("/api/forms/preview", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      permanentFormsEngine.preview(auth.room, auth.player, request.body || {})
    );
  });

  app.post("/api/forms/play", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = permanentFormsEngine.processGameAction(
      auth.room,
      auth.player,
      {
        ...request.body,
        type: "forms-play"
      },
      v49LegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(
      auth.room,
      auth.player.name,
      "Played a selected card form"
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.post("/api/forms/action", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const allowed = new Set([
      "forms-transform",
      "forms-manifest",
      "forms-turn-face-up",
      "forms-mutate",
      "forms-damage-battle"
    ]);
    const type = String(request.body?.type || "");
    if (!allowed.has(type)) {
      return response.status(400).json({
        success: false,
        error: "Unsupported permanent-form action."
      });
    }

    const result = permanentFormsEngine.processGameAction(
      auth.room,
      auth.player,
      request.body,
      v49LegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(
      auth.room,
      auth.player.name,
      type
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.post("/api/forms/state", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      permanentFormsEngine.state(auth.room, auth.player.id)
    );
  });

  app.post("/api/forms/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      permanentFormsEngine.pending(auth.room, auth.player.id)
    );
  });

  app.post("/api/forms/resolve-battle", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = permanentFormsEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "forms-resolve-battle",
        choiceId: request.body?.choiceId,
        castBackFace: Boolean(request.body?.castBackFace)
      },
      v49LegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(
      auth.room,
      auth.player.name,
      "Resolved defeated Battle"
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.get("/api/forms/status", (_request, response) => {
    response.json(permanentFormsEngine.status());
  });

  console.log(
    "Arena Commander card faces and permanent forms engine v49.0.0 installed."
  );
})();
// ---- End Arena Commander v49 permanent-forms integration ----
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
      "Arena Commander v49 found no safe server insertion point."
    );
    return source;
  }

  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function permanentFormsRegister(
  module,
  filename
) {
  if (path.resolve(filename) !== serverPath) {
    return previousLoader(module, filename);
  }

  Module._extensions[".js"] = previousLoader;

  const originalCompile = module._compile;
  module._compile = function compileWithPermanentForms(
    source,
    compiledFilename
  ) {
    module._compile = originalCompile;
    return originalCompile.call(
      module,
      injectPermanentForms(String(source)),
      compiledFilename
    );
  };

  return previousLoader(module, filename);
};
