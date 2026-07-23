"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const originalLoader = Module._extensions[".js"];

Module._extensions[".js"] = function arenaAutomationLoader(module, filename) {
  if (path.resolve(filename) !== serverPath) return originalLoader(module, filename);

  // Restore the normal loader before compiling server.js so every other module
  // continues to use Node's standard loader.
  Module._extensions[".js"] = originalLoader;

  let source = fs.readFileSync(filename, "utf8");
  const marker = "\nserver.listen(";
  const insertAt = source.lastIndexOf(marker);
  if (insertAt < 0) {
    throw new Error("Arena Commander automation could not locate server.listen() in server.js.");
  }

  const integration = `

// ---- Arena Commander v40 card automation integration ----
(() => {
  const { installCardAutomation } = require("./card-automation-engine");
  const legacy = {
    queueSuggestedTriggers,
    applySimpleEffect,
    normalizeStackItem,
    normalizeTriggerItem,
    publicCard,
    moveCard,
    dealPlayerDamage,
    dealCreatureDamage,
    runStateBasedActions
  };

  const patches = installCardAutomation({
    app,
    rooms,
    PHASES,
    nowIso,
    createId,
    normalizeText,
    clamp,
    findPlayer,
    locateCard,
    currentOracleText,
    currentTypeLine,
    isCreatureCard,
    isPermanentCard,
    hasKeyword,
    createCard,
    pushStack,
    resetPriority,
    addLog,
    queueTrigger,
    validateTargets,
    resolveCardNames,
    legacy
  });

  if (patches.queueSuggestedTriggers) queueSuggestedTriggers = patches.queueSuggestedTriggers;
  if (patches.applySimpleEffect) applySimpleEffect = patches.applySimpleEffect;
  if (patches.normalizeStackItem) normalizeStackItem = patches.normalizeStackItem;
  if (patches.normalizeTriggerItem) normalizeTriggerItem = patches.normalizeTriggerItem;
  if (patches.publicCard) publicCard = patches.publicCard;
  if (patches.moveCard) moveCard = patches.moveCard;
  if (patches.dealPlayerDamage) dealPlayerDamage = patches.dealPlayerDamage;
  if (patches.dealCreatureDamage) dealCreatureDamage = patches.dealCreatureDamage;
  if (patches.runStateBasedActions) runStateBasedActions = patches.runStateBasedActions;
})();
// ---- End Arena Commander v40 card automation integration ----
`;

  source = source.slice(0, insertAt) + integration + source.slice(insertAt);
  module._compile(source, filename);
};
