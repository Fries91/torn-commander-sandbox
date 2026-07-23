"use strict";

const fs = require("fs");
const path = require("path");
const Module = require("module");

const HOTFIX_VERSION = "40.1.0";
const serverPath = path.resolve(__dirname, "server.js");
const originalLoader = Module._extensions[".js"];

Module._extensions[".js"] = function arenaAutomationLoader(module, filename) {
  if (path.resolve(filename) !== serverPath) {
    return originalLoader(module, filename);
  }

  Module._extensions[".js"] = originalLoader;
  let source = fs.readFileSync(filename, "utf8");

  if (source.includes("Arena Commander v40.1 gameplay integration")) {
    module._compile(source, filename);
    return;
  }

  const integration = `

// ---- Arena Commander v40.1 gameplay integration ----
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

  // Assisted trigger targeting:
  // The original trigger-to-stack action copied only trigger.targets. The client
  // can now submit selected targets and this wrapper stores them first.
  const gameplayProcessGameAction = processGameAction;
  processGameAction = function arenaGameplayProcessGameAction(room, actor, action) {
    if (action?.type === "trigger-to-stack" && Array.isArray(action.targets)) {
      const trigger = room?.triggerQueue?.find((entry) => entry.id === action.triggerId);
      if (trigger && (trigger.controllerId === actor.id || room.hostId === actor.id)) {
        trigger.targets = validateTargets(room, action.targets);
      }
    }
    return gameplayProcessGameAction(room, actor, action);
  };

  // Immediate AI balance pass. Expert bots cast more available spells but attack
  // less recklessly into developed boards.
  botCastLimit = function arenaBotCastLimit(difficulty) {
    const level = normalizeDifficulty(difficulty);
    return { beginner: 1, skilled: 3, competitive: 4, expert: 6 }[level] || 3;
  };
  botAttackRatio = function arenaBotAttackRatio(difficulty) {
    const level = normalizeDifficulty(difficulty);
    return { beginner: 0.40, skilled: 0.58, competitive: 0.68, expert: 0.76 }[level] || 0.58;
  };

  const deckLinkRate = new Map();
  function deckLinkAllowed(request) {
    const key = String(request.ip || request.socket?.remoteAddress || "unknown");
    const now = Date.now();
    const current = deckLinkRate.get(key);
    if (!current || now - current.startedAt > 300000) {
      deckLinkRate.set(key, { startedAt: now, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= 12;
  }

  function safeQuantity(value) {
    return Math.max(1, Math.min(100, Math.floor(Number(value) || 1)));
  }

  function deckLineMap() {
    return new Map();
  }

  function addDeckLine(map, name, quantity) {
    const clean = normalizeText(name, 150);
    if (!clean) return;
    const key = clean.toLocaleLowerCase("en-US");
    const previous = map.get(key);
    if (previous) previous.quantity = Math.min(100, previous.quantity + safeQuantity(quantity));
    else map.set(key, { name: clean, quantity: safeQuantity(quantity) });
  }

  function categoryNames(value) {
    if (!Array.isArray(value)) return [];
    return value.map((entry) => normalizeText(
      typeof entry === "string" ? entry : entry?.name || entry?.category?.name,
      80
    )).filter(Boolean);
  }

  function parseArchidektDeck(payload) {
    const lines = deckLineMap();
    const commanders = [];
    const cards = Array.isArray(payload?.cards) ? payload.cards : [];
    for (const entry of cards) {
      const name =
        entry?.card?.oracleCard?.name ||
        entry?.card?.name ||
        entry?.oracleCard?.name ||
        entry?.name;
      if (!name) continue;
      addDeckLine(lines, name, entry?.quantity || entry?.qty || entry?.count || 1);
      const categories = categoryNames(entry?.categories);
      if (categories.some((category) => /commander|partner|background/i.test(category))) {
        commanders.push(normalizeText(name, 150));
      }
    }
    for (const entry of Array.isArray(payload?.commanders) ? payload.commanders : []) {
      const name = entry?.card?.oracleCard?.name || entry?.card?.name || entry?.name || entry;
      if (name) commanders.push(normalizeText(name, 150));
    }
    return {
      name: normalizeText(payload?.name || payload?.deck?.name || "Archidekt Deck", 60),
      commanders: [...new Set(commanders.filter(Boolean))].slice(0, 6),
      cards: [...lines.values()]
    };
  }

  function parseMoxfieldDeck(payload) {
    const lines = deckLineMap();
    const commanders = [];
    const sections = [
      ["commanders", true],
      ["mainboard", false],
      ["companions", false]
    ];
    for (const [section, commanderSection] of sections) {
      const source = payload?.[section];
      if (!source || typeof source !== "object") continue;
      for (const [fallbackName, entry] of Object.entries(source)) {
        const name = entry?.card?.name || entry?.name || fallbackName;
        if (!name) continue;
        addDeckLine(lines, name, entry?.quantity || entry?.qty || entry?.count || 1);
        if (commanderSection) commanders.push(normalizeText(name, 150));
      }
    }
    return {
      name: normalizeText(payload?.name || "Moxfield Deck", 60),
      commanders: [...new Set(commanders.filter(Boolean))].slice(0, 6),
      cards: [...lines.values()]
    };
  }

  async function fetchDeckJson(url, headers = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "ArenaCommander/40.1 public-deck-import",
          ...headers
        },
        signal: controller.signal
      });
      if (!response.ok) throw new Error("Deck provider returned HTTP " + response.status + ".");
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function completeImportedDeck(result, source, sourceUrl) {
    if (!result?.cards?.length) throw new Error("No cards were found in that public deck.");
    return {
      success: true,
      version: "40.1.0",
      source,
      sourceUrl,
      deckName: result.name || source + " Deck",
      commanders: result.commanders || [],
      deckList: result.cards.map((entry) => String(entry.quantity) + " " + entry.name).join("\\n"),
      uniqueCards: result.cards.length,
      totalCards: result.cards.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0)
    };
  }

  app.post("/api/decks/import-link", async (request, response) => {
    if (!deckLinkAllowed(request)) {
      return response.status(429).json({ success: false, error: "Too many deck-link imports. Try again shortly." });
    }

    let parsed;
    try {
      parsed = new URL(String(request.body?.url || "").trim());
    } catch {
      return response.status(400).json({ success: false, error: "Enter a valid public Archidekt or Moxfield deck link." });
    }

    const host = parsed.hostname.toLocaleLowerCase("en-US");
    try {
      if (host === "archidekt.com" || host === "www.archidekt.com") {
        const match = parsed.pathname.match(/\\/decks\\/(\\d+)/i);
        if (!match) return response.status(400).json({ success: false, error: "That Archidekt link does not contain a deck ID." });
        const payload = await fetchDeckJson("https://archidekt.com/api/decks/" + match[1] + "/");
        return response.json(completeImportedDeck(parseArchidektDeck(payload), "Archidekt", parsed.toString()));
      }

      if (host === "moxfield.com" || host === "www.moxfield.com") {
        const match = parsed.pathname.match(/\\/decks\\/([^/?#]+)/i);
        if (!match) return response.status(400).json({ success: false, error: "That Moxfield link does not contain a deck ID." });
        const id = encodeURIComponent(match[1]);
        let payload;
        let lastError;
        for (const endpoint of [
          "https://api2.moxfield.com/v3/decks/all/" + id,
          "https://api2.moxfield.com/v2/decks/all/" + id
        ]) {
          try {
            payload = await fetchDeckJson(endpoint, { Referer: "https://www.moxfield.com/" });
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!payload) throw lastError || new Error("Moxfield did not return the deck.");
        return response.json(completeImportedDeck(parseMoxfieldDeck(payload), "Moxfield", parsed.toString()));
      }

      return response.status(400).json({
        success: false,
        error: "Only public Archidekt and Moxfield deck links are supported in this release."
      });
    } catch (error) {
      return response.status(502).json({
        success: false,
        error: normalizeText(error?.name === "AbortError" ? "The deck provider timed out." : error?.message, 240) || "Unable to import that public deck."
      });
    }
  });

  app.get("/api/gameplay-hotfix/status", (_request, response) => {
    response.json({
      success: true,
      version: "40.1.0",
      features: [
        "assisted trigger target forwarding",
        "automatic client stack passing",
        "leave-match control",
        "public Archidekt and Moxfield importing",
        "AI cast and combat tuning"
      ]
    });
  });

  console.log("Arena Commander gameplay hotfix v40.1.0 installed.");
})();
// ---- End Arena Commander v40.1 gameplay integration ----
`;

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

  if (insertAt < 0) {
    console.error(
      "Arena Commander v40.1 gameplay integration was not injected because no safe insertion point was found. The main server will continue without the hotfix."
    );
    module._compile(source, filename);
    return;
  }

  source = source.slice(0, insertAt) + integration + source.slice(insertAt);
  module._compile(source, filename);
};
