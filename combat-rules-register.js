"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectCombatRules(source) {
  if (source.includes("Arena Commander v51 combat-rules integration")) {
    return source;
  }

  const integration = `

// ---- Arena Commander v51 combat-rules integration ----
(() => {
  const { createCombatRulesEngine } = require("./combat-rules-engine");

  const combatRulesEngine = createCombatRulesEngine({
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
    legalDefenderIds,
    dealPlayerDamage,
    dealCreatureDamage,
    queueSuggestedTriggers,
    resetPriority,
    migrateCard,
    publicCard,
    addLog
  });

  const v51LegacyProcessGameAction = processGameAction;
  processGameAction = function combatRulesProcessGameAction(
    room,
    actor,
    action
  ) {
    return combatRulesEngine.processGameAction(
      room,
      actor,
      action,
      v51LegacyProcessGameAction
    );
  };

  const v51LegacyResolveCombatDamage = resolveCombatDamage;
  resolveCombatDamage = function combatRulesResolveCombatDamage(room, pass) {
    return combatRulesEngine.resolveCombatDamage(room, pass);
  };

  const v51LegacyCreatePublicRoom = createPublicRoom;
  createPublicRoom = function combatRulesCreatePublicRoom(room, viewerId) {
    const publicRoom = v51LegacyCreatePublicRoom(room, viewerId);
    publicRoom.combatV51 = combatRulesEngine.summary(room);
    return publicRoom;
  };

  app.post("/api/combat-v51/state", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      combatRulesEngine.state(auth.room, auth.player.id)
    );
  });

  app.post("/api/combat-v51/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json(
      combatRulesEngine.pending(auth.room, auth.player.id)
    );
  });

  app.post("/api/combat-v51/action", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const allowed = new Set([
      "combat-v51-ninjutsu",
      "combat-v51-set-order",
      "combat-v51-goad",
      "combat-v51-resolve-damage"
    ]);
    const type = String(request.body?.type || "");
    if (!allowed.has(type)) {
      return response.status(400).json({
        success: false,
        error: "Unsupported v51 combat action."
      });
    }

    const result = combatRulesEngine.processGameAction(
      auth.room,
      auth.player,
      request.body,
      v51LegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(auth.room, auth.player.name, type);
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);
    return response.json({ success: true, result });
  });

  app.post("/api/combat-v51/resolve-choice", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);

    const result = combatRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "combat-v51-resolve-choice",
        choiceId: request.body?.choiceId,
        cardIds: request.body?.cardIds
      },
      v51LegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);

    recordReplayFrame(
      auth.room,
      auth.player.name,
      "Resolved v51 combat choice"
    );
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);
    return response.json({ success: true, result });
  });

  app.get("/api/combat-v51/status", (_request, response) => {
    response.json(combatRulesEngine.status());
  });

  console.log(
    "Arena Commander complete combat rules engine v51.0.0 installed."
  );
})();// ---- End Arena Commander v51 combat-rules integration ----
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
    console.error("Arena Commander v51 found no safe server insertion point.");
    return source;
  }

  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function combatRulesRegister(module, filename) {
  if (path.resolve(filename) !== serverPath) {
    return previousLoader(module, filename);
  }

  Module._extensions[".js"] = previousLoader;
  const originalCompile = module._compile;
  module._compile = function compileWithCombatRules(source, compiledFilename) {
    module._compile = originalCompile;
    return originalCompile.call(
      module,
      injectCombatRules(String(source)),
      compiledFilename
    );
  };

  return previousLoader(module, filename);
};
