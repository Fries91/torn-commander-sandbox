"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectWalkerBattle(source) {
  if (source.includes("Arena Commander v52 walker-battle integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v52 walker-battle integration ----
(() => {
  const { createWalkerBattleEngine } = require("./walker-battle-engine");

  const walkerBattleEngine = createWalkerBattleEngine({
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
    locateCard,
    legalDefenderIds,
    dealCreatureDamage,
    queueSuggestedTriggers,
    resetPriority,
    migrateCard,
    publicCard,
    pushStack,
    validateTargets,
    runStateBasedActions,
    addLog
  });

  const v52LegacyProcessGameAction = processGameAction;
  processGameAction = function walkerBattleProcessGameAction(
    room,
    actor,
    action
  ) {
    return walkerBattleEngine.processGameAction(
      room,
      actor,
      action,
      v52LegacyProcessGameAction
    );
  };

  const v52LegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function walkerBattleResolveStackTop(
    room,
    resolverName
  ) {
    const beforeIds = walkerBattleEngine.beforeResolve(room);
    const result = v52LegacyResolveStackTop(room, resolverName);
    if (result) walkerBattleEngine.afterResolve(room, beforeIds);
    return result;
  };

  const v52LegacyResolveCombatDamage = resolveCombatDamage;
  resolveCombatDamage = function walkerBattleResolveCombatDamage(room, pass) {
    return walkerBattleEngine.resolveCombatDamage(
      room,
      pass,
      v52LegacyResolveCombatDamage
    );
  };

  const v52LegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function walkerBattleCreatePublicRoom(room, viewerId) {
    const publicRoom = v52LegacyCreatePublicRoom(room, viewerId);
    publicRoom.walkersV52 = walkerBattleEngine.summary(room);
    return publicRoom;
  };

  app.post("/api/combat-v52/state", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      walkerBattleEngine.state(auth.room, auth.player.id)
    );
  });

  app.post("/api/combat-v52/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      walkerBattleEngine.pending(auth.room, auth.player.id)
    );
  });

  app.post("/api/combat-v52/action", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const allowed = new Set([
      "combat-v52-declare-attack",
      "combat-v52-activate-loyalty",
      "combat-v52-damage-permanent"
    ]);
    const type = String(request.body?.type || "");
    if (!allowed.has(type)) {
      return response.status(400).json({
        success: false,
        error: "Unsupported v52 action."
      });
    }

    const result = walkerBattleEngine.processGameAction(
      auth.room,
      auth.player,
      request.body,
      v52LegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(auth.room, auth.player.name, type);
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.post("/api/combat-v52/resolve-protector", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = walkerBattleEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "combat-v52-resolve-protector",
        choiceId: request.body?.choiceId,
        protectorPlayerId: request.body?.protectorPlayerId
      },
      v52LegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(
      auth.room,
      auth.player.name,
      "Selected Battle protector"
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);

    return response.json({ success: true, result });
  });

  app.get("/api/combat-v52/status", (_request, response) => {
    response.json(walkerBattleEngine.status());
  });

  console.log(
    "Arena Commander planeswalker, Battle and loyalty engine v52.0.0 installed."
  );
})();
// ---- End Arena Commander v52 walker-battle integration ----
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
      "Arena Commander v52 found no safe server insertion point."
    );
    return source;
  }

  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function walkerBattleRegister(module, filename) {
  if (path.resolve(filename) !== serverPath) {
    return previousLoader(module, filename);
  }

  Module._extensions[".js"] = previousLoader;
  const originalCompile = module._compile;

  module._compile = function compileWithWalkerBattle(
    source,
    compiledFilename
  ) {
    module._compile = originalCompile;
    return originalCompile.call(
      module,
      injectWalkerBattle(String(source)),
      compiledFilename
    );
  };

  return previousLoader(module, filename);
};
