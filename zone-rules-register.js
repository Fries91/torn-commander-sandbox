"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectZoneRules(source) {
  if (source.includes("Arena Commander v43 zone-choice integration")) return source;

  const integration = `

// ---- Arena Commander v43 zone-choice integration ----
(() => {
  const { createZoneRulesEngine } = require("./zone-rules-engine");

  const zoneRulesEngine = createZoneRulesEngine({
    createId,
    nowIso,
    normalizeText,
    clamp,
    currentCardFace,
    currentTypeLine,
    currentOracleText,
    isCreatureCard,
    publicCard,
    findPlayer,
    resetPriority,
    addLog,
    shuffle
  });

  const zoneLegacyProcessGameAction = processGameAction;
  processGameAction = function zoneRulesProcessGameAction(room, actor, action) {
    return zoneRulesEngine.processGameAction(
      room,
      actor,
      action,
      zoneLegacyProcessGameAction
    );
  };

  const zoneLegacyApplySimpleEffect = applySimpleEffect;
  applySimpleEffect = function zoneRulesApplySimpleEffect(room, item) {
    const result = zoneLegacyApplySimpleEffect(room, item);
    zoneRulesEngine.afterResolve(room, item);
    return result;
  };

  const zoneLegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function zoneRulesCreatePublicRoom(room, viewerId) {
    const result = zoneLegacyCreatePublicRoom(room, viewerId);
    return Object.assign(result, zoneRulesEngine.publicRoomSummary(room));
  };

  app.post("/api/zone-choices/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json({
      success: true,
      version: "43.0.0",
      choices: zoneRulesEngine.pendingPublic(auth.room, auth.player.id)
    });
  });

  app.post("/api/zone-choices/resolve", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = zoneRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "resolve-zone-choice",
        choiceId: request.body?.choiceId,
        resolution: request.body?.resolution
      },
      zoneLegacyProcessGameAction
    );

    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(auth.room, auth.player.name, "Resolved private card choice");
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({
      success: true,
      version: "43.0.0",
      choices: zoneRulesEngine.pendingPublic(auth.room, auth.player.id)
    });
  });

  app.get("/api/zone-rules/status", (_request, response) => {
    response.json(zoneRulesEngine.status());
  });

  console.log("Arena Commander zone and choice engine v43.0.0 installed.");
})();
// ---- End Arena Commander v43 zone-choice integration ----
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
      "Arena Commander v43 found no safe server insertion point. The existing game will continue without zone choices."
    );
    return source;
  }

  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function zoneRulesRegister(module, filename) {
  if (path.resolve(filename) !== serverPath) {
    return previousLoader(module, filename);
  }

  Module._extensions[".js"] = previousLoader;

  const originalCompile = module._compile;
  module._compile = function compileWithZoneRules(source, compiledFilename) {
    module._compile = originalCompile;
    return originalCompile.call(
      module,
      injectZoneRules(String(source)),
      compiledFilename
    );
  };

  return previousLoader(module, filename);
};
