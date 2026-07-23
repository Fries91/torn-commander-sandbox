automation-register.js — v40.0.1 startup fix
Replace the complete contents of automation-register.js with the code below.

"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

const serverPath = path.resolve(__dirname, "server.js");
const originalLoader = Module._extensions[".js"];

Module._extensions[".js"] = function arenaAutomationLoader(module, filename) {
  if (path.resolve(filename) !== serverPath) {
    return originalLoader(module, filename);
  }

  // Restore Node's normal loader before compiling server.js so every other
  // JavaScript module continues to load normally.
  Module._extensions[".js"] = originalLoader;

  let source = fs.readFileSync(filename, "utf8");

  // Do not inject twice if the integration was later added directly to server.js.
  if (source.includes("Arena Commander v40 card automation integration")) {
    module._compile(source, filename);
    return;
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

  // Install before the SPA catch-all and API 404 middleware so the automation
  // status/analyze endpoints are reachable. Fall back to the start function,
  // then to any server.listen call for compatibility with older server files.
  const insertionPatterns = [
    /\napp\.get\(\s*["']\*["']\s*,/,
    /\napp\.use\(\s*["']\/api["']\s*,/,
    /\nasync\s+function\s+start\s*\(/,
    /\n\s*server\.listen\s*\(/
  ];

  let insertAt = -1;
  for (const pattern of insertionPatterns) {
    const match = pattern.exec(source);
    if (match) {
      insertAt = match.index;
      break;
    }
  }

  // Never take the whole app offline because a future server layout changed.
  // The server will start normally, with automation disabled, and log the cause.
  if (insertAt < 0) {
    console.error(
      "Arena Commander automation was not injected because no safe insertion point was found. The main server will continue without v40 automation."
    );
    module._compile(source, filename);
    return;
  }

  source = source.slice(0, insertAt) + integration + source.slice(insertAt);
  module._compile(source, filename);
};
