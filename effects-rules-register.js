"use strict";

const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const previousLoader = Module._extensions[".js"];

function injectEffectsRules(source) {
  if (source.includes("Arena Commander v45 effects integration")) return source;

  const integration = `

// ---- Arena Commander v45 effects integration ----
(() => {
  const { createEffectsRulesEngine } = require("./effects-rules-engine");

  const effectsRulesEngine = createEffectsRulesEngine({
    createId,
    nowIso,
    currentCardFace,
    currentTypeLine,
    currentOracleText,
    isCreatureCard,
    findPlayer,
    getCardFromZone,
    migrateCard,
    addLog
  });

  const effectsLegacyEffectiveStats = effectiveStats;
  effectiveStats = function effectsEffectiveStats(card) {
    const room = [...rooms.values()].find((entry) =>
      entry.players.some((player) => player.game?.battlefield?.some((permanent) => permanent.id === card?.id))
    );
    return room
      ? effectsRulesEngine.effectiveStats(room, card, effectsLegacyEffectiveStats)
      : effectsLegacyEffectiveStats(card);
  };

  const effectsLegacyHasKeyword = hasKeyword;
  hasKeyword = function effectsHasKeyword(card, keyword) {
    const room = [...rooms.values()].find((entry) =>
      entry.players.some((player) => player.game?.battlefield?.some((permanent) => permanent.id === card?.id))
    );
    return room
      ? effectsRulesEngine.hasKeyword(room, card, keyword, effectsLegacyHasKeyword)
      : effectsLegacyHasKeyword(card, keyword);
  };

  const effectsLegacyDealPlayerDamage = dealPlayerDamage;
  dealPlayerDamage = function effectsDealPlayerDamage(room, source, target, amount) {
    const phase = PHASES[room.turn?.phaseIndex || 0] || "";
    return effectsRulesEngine.playerDamage(
      room, source, target, amount, /combat|attack|block/i.test(phase),
      effectsLegacyDealPlayerDamage
    );
  };

  const effectsLegacyDealCreatureDamage = dealCreatureDamage;
  dealCreatureDamage = function effectsDealCreatureDamage(room, source, target, amount) {
    const phase = PHASES[room.turn?.phaseIndex || 0] || "";
    return effectsRulesEngine.creatureDamage(
      room, source, target, amount, /combat|attack|block/i.test(phase),
      effectsLegacyDealCreatureDamage
    );
  };

  const effectsLegacyProcessGameAction = processGameAction;
  processGameAction = function effectsProcessGameAction(room, actor, action) {
    return effectsRulesEngine.processGameAction(
      room, actor, action, effectsLegacyProcessGameAction
    );
  };

  const effectsLegacyResolveStackTop = resolveStackTop;
  resolveStackTop = function effectsResolveStackTop(room, resolverName) {
    const beforeIds = room.players.flatMap((player) =>
      (player.game?.battlefield || []).map((card) => card.id)
    );
    const result = effectsLegacyResolveStackTop(room, resolverName);
    return effectsRulesEngine.afterResolveStack(room, beforeIds, result);
  };

  const effectsLegacyApplySimpleEffect = applySimpleEffect;
  applySimpleEffect = function effectsApplySimpleEffect(room, item) {
    return effectsRulesEngine.applySimpleEffect(room, item, effectsLegacyApplySimpleEffect);
  };

  app.post("/api/effects/pending", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json({
      success: true,
      version: "45.0.0",
      choices: effectsRulesEngine.pending(auth.room, auth.player.id)
    });
  });

  app.post("/api/effects/resolve", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    const result = effectsRulesEngine.processGameAction(
      auth.room,
      auth.player,
      {
        type: "resolve-replacement",
        choiceId: request.body?.choiceId,
        payLife: request.body?.payLife
      },
      effectsLegacyProcessGameAction
    );
    if (!result.success) return response.status(400).json(result);
    recordReplayFrame(auth.room, auth.player.name, "Resolved replacement effect");
    queueRoomSave(auth.room, true);
    emitRoomUpdate(auth.room);
    scheduleBots(auth.room, true);
    return response.json({ success: true, result });
  });

  app.post("/api/effects/snapshot", (request, response) => {
    const auth = authenticationFrom(request.body);
    if (!auth.success) return response.status(401).json(auth);
    response.setHeader("Cache-Control", "no-store");
    return response.json({
      success: true,
      version: "45.0.0",
      ...effectsRulesEngine.snapshot(auth.room, auth.player.id)
    });
  });

  app.get("/api/effects/status", (_request, response) => {
    response.json(effectsRulesEngine.status());
  });

  console.log("Arena Commander effects and layers foundation v45.0.0 installed.");
})();
// ---- End Arena Commander v45 effects integration ----
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
    console.error("Arena Commander v45 found no safe server insertion point.");
    return source;
  }
  return source.slice(0, insertAt) + integration + source.slice(insertAt);
}

Module._extensions[".js"] = function effectsRulesRegister(module, filename) {
  if (path.resolve(filename) !== serverPath) return previousLoader(module, filename);
  Module._extensions[".js"] = previousLoader;
  const originalCompile = module._compile;
  module._compile = function compileWithEffectsRules(source, compiledFilename) {
    module._compile = originalCompile;
    return originalCompile.call(module, injectEffectsRules(String(source)), compiledFilename);
  };
  return previousLoader(module, filename);
};
