(() => {
  "use strict";

  const VERSION = "62.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const PREF_KEY = "arenaCommander.gameplayV62.preferences";
  const YIELD_KEY = "arenaCommander.gameplayV62.yields";

  let repairQueued = false;
  let requestPending = false;
  let autoActionKey = "";
  let autoTimer = null;
  let passUntilStackKey = "";
  let autoPassPhaseKey = "";
  let activeOverlay = "";

  function room() {
    return window.ArenaCommanderPlaymatV610?.getRoom?.() || window.__arenaCommanderRoomV610 || null;
  }

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; }
  }

  function meId() { return String(session()?.playerId || ""); }
  function me() { return (room()?.players || []).find((player) => String(player.id) === meId()) || null; }
  function phaseName() { return room()?.gameplayV62?.phaseName || room()?.phases?.[room()?.turn?.phaseIndex || 0] || ""; }
  function activeMine() { return String(room()?.turn?.activePlayerId || "") === meId(); }
  function priorityMine() { return String(room()?.priority?.playerId || "") === meId(); }
  function stackKey() { return (room()?.stack || []).map((item) => [item.id, item.sourceCardId, item.name].join(":" )).join("|"); }
  function phaseKey() { return [room()?.turn?.number || 0, room()?.turn?.phaseIndex || 0, room()?.turn?.activePlayerId || ""].join(":"); }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function loadJson(key, fallback) {
    try { return { ...fallback, ...(JSON.parse(localStorage.getItem(key)) || {}) }; } catch { return { ...fallback }; }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function preferences() {
    return loadJson(PREF_KEY, {
      autoUntap: true,
      autoDrawAdvance: true,
      autoCombatDamage: true,
      autoCleanup: true,
      showTriggerPrompts: true
    });
  }

  function yields() {
    try { return new Set(JSON.parse(localStorage.getItem(YIELD_KEY)) || []); } catch { return new Set(); }
  }

  function saveYields(set) { saveJson(YIELD_KEY, [...set]); }

  function toast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const item = document.createElement("div");
    item.className = "toast " + type;
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => item.remove(), 3200);
  }

  async function post(action) {
    if (requestPending) return null;
    const saved = session();
    if (!saved?.roomCode || !saved?.playerId || !saved?.sessionToken) return null;
    requestPending = true;
    try {
      const response = await fetch("/api/gameplay-v62/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: saved.roomCode,
          playerId: saved.playerId,
          sessionToken: saved.sessionToken,
          ...action
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "The automated gameplay action failed.");
      scheduleRepair();
      return data;
    } catch (error) {
      toast(error?.message || "The automated gameplay action failed.", "error");
      return null;
    } finally {
      requestPending = false;
    }
  }

  function playerName(playerId) {
    return (room()?.players || []).find((player) => String(player.id) === String(playerId))?.name || "Player";
  }

  function allPublicCards() {
    const map = new Map();
    for (const player of room()?.players || []) {
      for (const zone of ["hand", "battlefield", "graveyard", "exile", "commandZone"]) {
        for (const card of player.game?.[zone] || []) if (card?.id) map.set(String(card.id), { card, player, zone });
      }
    }
    return map;
  }

  function controlledCards() {
    const player = me();
    return (player?.game?.battlefield || []).filter((card) => String(card.controllerId) === meId());
  }

  function targetCandidates(mode, sourceCardId = "") {
    const current = room();
    if (!current) return [];
    if (mode === "target-player" || mode === "target-opponent") {
      return (current.players || [])
        .filter((player) => mode !== "target-opponent" || String(player.id) !== meId())
        .filter((player) => !player.game?.conceded && !player.game?.lost)
        .map((player) => ({ value: "player:" + player.id, label: player.name + " — " + player.game.life + " life" }));
    }
    const cards = [];
    for (const player of current.players || []) {
      for (const card of player.game?.battlefield || []) {
        if (String(card.id) === String(sourceCardId)) continue;
        const type = String(card.currentFace?.typeLine || card.cardData?.typeLine || "").toLowerCase();
        if (mode === "target-creature" && !type.includes("creature")) continue;
        if (mode?.includes("artifact") && !type.includes("artifact")) continue;
        if (mode?.includes("enchantment") && !type.includes("enchantment")) continue;
        cards.push({ value: "card:" + card.id, label: player.name + ": " + card.name });
      }
    }
    return cards;
  }

  function ensureOverlay() {
    let overlay = document.getElementById("v62AutomationOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "v62AutomationOverlay";
    overlay.className = "v62-overlay is-hidden";
    overlay.innerHTML = '<button class="v62-overlay-scrim" data-v62-action="close-overlay" aria-label="Close"></button><section class="v62-sheet"><header><div><small>AUTOMATED GAMEPLAY</small><h2 id="v62OverlayTitle">Automation</h2></div><button data-v62-action="close-overlay" aria-label="Close">×</button></header><div id="v62OverlayBody" class="v62-sheet-body"></div></section>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function openOverlay(title, html, name = "custom") {
    const overlay = ensureOverlay();
    activeOverlay = name;
    overlay.querySelector("#v62OverlayTitle").textContent = title;
    overlay.querySelector("#v62OverlayBody").innerHTML = html;
    overlay.classList.remove("is-hidden");
  }

  function closeOverlay() {
    activeOverlay = "";
    document.getElementById("v62AutomationOverlay")?.classList.add("is-hidden");
  }

  function pendingTrigger() {
    return (room()?.triggerQueue || []).find((trigger) => String(trigger.controllerId) === meId()) || null;
  }

  function triggerTargetMode(trigger) {
    return (trigger?.automation?.actions || []).map((action) => action.target).find((target) => /^target-|any-target$/.test(target || "")) || "";
  }

  function renderTriggerPrompt(trigger) {
    const mode = triggerTargetMode(trigger);
    const candidates = targetCandidates(mode, trigger.sourceCardId);
    const may = /\bmay\b/i.test(trigger.text || "");
    const manual = !trigger.automation?.actions?.length || trigger.automation?.level === "manual";
    return '<div class="v62-trigger-card"><span class="v62-level ' + escapeHtml(trigger.automation?.level || "manual") + '">' + escapeHtml((trigger.automation?.level || "manual").toUpperCase()) + '</span><h3>' + escapeHtml(trigger.sourceName || "Triggered ability") + '</h3><p>' + escapeHtml(trigger.text || "Manual trigger") + '</p></div>' +
      '<form id="v62TriggerForm" data-trigger-id="' + escapeHtml(trigger.id) + '">' +
      (candidates.length ? '<fieldset><legend>Choose target</legend>' + candidates.map((candidate, index) => '<label class="v62-choice-row"><input type="radio" name="target" value="' + escapeHtml(candidate.value) + '" ' + (index === 0 ? "checked" : "") + '><span>' + escapeHtml(candidate.label) + '</span></label>').join("") + '</fieldset>' : '') +
      '<div class="v62-button-row"><button type="submit" class="primary-button">' + (manual ? "Put on stack manually" : "Put on stack") + '</button>' +
      (may ? '<button type="button" class="danger-button" data-v62-action="decline-trigger" data-trigger-id="' + escapeHtml(trigger.id) + '">Decline</button>' : '') +
      '<button type="button" class="ghost-button" data-v62-action="close-overlay">Later</button></div></form>';
  }

  function showPendingTrigger(force = false) {
    const trigger = pendingTrigger();
    if (!trigger) {
      if (activeOverlay === "trigger") closeOverlay();
      return;
    }
    if (!preferences().showTriggerPrompts && !force) return;
    const shown = document.querySelector("#v62TriggerForm")?.dataset.triggerId;
    if (activeOverlay === "trigger" && shown === String(trigger.id)) return;
    openOverlay("Trigger choice", renderTriggerPrompt(trigger), "trigger");
  }

  function abilityCardFromModal() {
    const body = document.getElementById("modalBody");
    if (!body) return null;
    const id = body.querySelector("[data-card-id]")?.dataset.cardId;
    return id ? allPublicCards().get(String(id))?.card || null : null;
  }

  function injectAbilityButtons() {
    const body = document.getElementById("modalBody");
    if (!body || body.querySelector(".v62-ability-section")) return;
    const card = abilityCardFromModal();
    if (!card?.v62Abilities?.length) return;
    const section = document.createElement("section");
    section.className = "sheet-section v62-ability-section";
    section.innerHTML = '<h3>Automated activated abilities</h3><div class="v62-ability-list">' + card.v62Abilities.map((ability) => '<button type="button" data-v62-action="open-ability" data-card-id="' + escapeHtml(card.id) + '" data-ability-index="' + ability.index + '"><span class="v62-level ' + escapeHtml(ability.level) + '">' + escapeHtml(ability.level.toUpperCase()) + '</span><strong>' + escapeHtml(ability.costText) + '</strong><small>' + escapeHtml(ability.effectText) + '</small></button>').join("") + '</div>';
    body.appendChild(section);
  }

  function renderAbilityForm(card, ability) {
    const candidates = targetCandidates(ability.targetMode, card.id);
    const hand = me()?.game?.hand || [];
    const permanents = controlledCards().filter((entry) => entry.id !== card.id);
    return '<div class="v62-trigger-card"><span class="v62-level ' + escapeHtml(ability.level) + '">' + escapeHtml(ability.level.toUpperCase()) + '</span><h3>' + escapeHtml(card.name) + '</h3><p><strong>' + escapeHtml(ability.costText) + ':</strong> ' + escapeHtml(ability.effectText) + '</p></div>' +
      '<form id="v62AbilityForm" data-card-id="' + escapeHtml(card.id) + '" data-ability-index="' + ability.index + '">' +
      (candidates.length ? '<fieldset><legend>Choose target</legend>' + candidates.map((candidate, index) => '<label class="v62-choice-row"><input type="radio" name="target" value="' + escapeHtml(candidate.value) + '" ' + (index === 0 ? "checked" : "") + '><span>' + escapeHtml(candidate.label) + '</span></label>').join("") + '</fieldset>' : '') +
      (ability.discardCost ? '<label class="v62-field">Discard for cost<select name="discardCardId" required><option value="">Choose card</option>' + hand.map((entry) => '<option value="' + escapeHtml(entry.id) + '">' + escapeHtml(entry.name) + '</option>').join("") + '</select></label>' : '') +
      (ability.sacrificeOther ? '<label class="v62-field">Sacrifice for cost<select name="sacrificeCardId" required><option value="">Choose permanent</option>' + permanents.map((entry) => '<option value="' + escapeHtml(entry.id) + '">' + escapeHtml(entry.name) + '</option>').join("") + '</select></label>' : '') +
      '<div class="v62-cost-summary">' +
      (ability.tapCost ? '<span>Tap cost</span>' : '') +
      (ability.lifeCost ? '<span>Pay ' + ability.lifeCost + ' life</span>' : '') +
      (ability.manaCost?.generic || ["W","U","B","R","G","C"].some((symbol) => ability.manaCost?.[symbol]) ? '<span>Mana cost applies</span>' : '') +
      (ability.manaAbility ? '<span>Mana ability resolves immediately</span>' : '<span>Uses the stack</span>') + '</div>' +
      '<div class="v62-button-row"><button type="submit" class="primary-button">Activate</button><button type="button" class="ghost-button" data-v62-action="close-overlay">Cancel</button></div></form>';
  }

  function openAbility(cardId, abilityIndex) {
    const card = allPublicCards().get(String(cardId))?.card;
    const ability = card?.v62Abilities?.[Number(abilityIndex)];
    if (!card || !ability) return toast("That ability is no longer available.", "error");
    openOverlay("Activate ability", renderAbilityForm(card, ability), "ability");
  }

  function ensureDock(shell) {
    let dock = shell.querySelector(".v62-dock");
    if (!dock) {
      dock = document.createElement("section");
      dock.className = "v62-dock";
      const topbar = shell.querySelector(".arena-game-topbar");
      (topbar || shell).insertAdjacentElement(topbar ? "afterend" : "afterbegin", dock);
    }
    const current = room();
    if (!current) return;
    const passed = new Set(current.priority?.passedPlayerIds || []);
    const top = current.stack?.at(-1);
    dock.innerHTML = '<div class="v62-dock-main"><button data-v62-action="open-settings" class="v62-engine-button"><span>⚙</span><strong>V62 AUTO</strong></button><div class="v62-phase"><small>TURN ' + escapeHtml(current.turn?.number || 1) + '</small><strong>' + escapeHtml(phaseName()) + '</strong></div><div class="v62-priority"><small>PRIORITY</small><strong>' + escapeHtml(playerName(current.priority?.playerId)) + '</strong></div><button data-v62-action="pass" class="v62-pass" ' + (priorityMine() ? "" : "disabled") + '>PASS</button></div>' +
      '<div class="v62-priority-track">' + (current.players || []).filter((player) => !player.game?.conceded && !player.game?.lost).map((player) => '<span class="' + (String(player.id) === String(current.priority?.playerId) ? "is-current " : "") + (passed.has(player.id) ? "is-passed" : "") + '"><b>' + escapeHtml(player.name.slice(0, 8)) + '</b><small>' + (passed.has(player.id) ? "✓" : String(player.id) === String(current.priority?.playerId) ? "●" : "…") + '</small></span>').join("") + '</div>' +
      '<div class="v62-dock-tools"><button data-v62-action="pass-stack">Pass until stack changes</button><button data-v62-action="pass-phase">Auto-pass this phase</button>' + (top ? '<button data-v62-action="toggle-yield" data-yield-key="' + escapeHtml(top.sourceCardId || top.name) + '">' + (yields().has(String(top.sourceCardId || top.name)) ? "Stop yielding" : "Always yield") + '</button>' : '') + '<button data-v62-action="show-trigger">Triggers ' + (current.triggerQueue?.filter((entry) => String(entry.controllerId) === meId()).length || 0) + '</button></div>';
  }

  function settingsHtml() {
    const prefs = preferences();
    const events = (room()?.gameplayV62?.events || []).slice().reverse();
    return '<form id="v62SettingsForm"><div class="v62-toggle-list">' + [
      ["autoUntap", "Automatically move Untap to Upkeep"],
      ["autoDrawAdvance", "Automatically move Draw to Main 1"],
      ["autoCombatDamage", "Automatically resolve combat damage steps"],
      ["autoCleanup", "Automatically finish Cleanup and start the next turn"],
      ["showTriggerPrompts", "Open assisted trigger prompts automatically"]
    ].map(([key, label]) => '<label><input type="checkbox" name="' + key + '" ' + (prefs[key] ? "checked" : "") + '><span>' + escapeHtml(label) + '</span></label>').join("") + '</div><div class="v62-button-row"><button type="submit" class="primary-button">Save automation</button><button type="button" data-v62-action="clear-yields" class="ghost-button">Clear always-yield list</button></div></form><details class="v62-events"><summary>Recent automatic events (' + events.length + ')</summary>' + (events.map((event) => '<div><strong>' + escapeHtml(event.type) + '</strong><span>Turn ' + event.turn + ' • ' + escapeHtml(event.phase || "") + '</span><small>' + escapeHtml(event.cardName || playerName(event.controllerId)) + '</small></div>').join("") || '<p>No events yet.</p>') + '</details><p class="v62-note">Full Auto resolves recognized effects. Assisted pauses for targets or choices. Manual keeps the game moving without silently guessing unusual card rules.</p>';
  }

  function runAutomaticPhase() {
    clearTimeout(autoTimer);
    const current = room();
    if (!current || !activeMine() || requestPending) return;
    if ((current.stack || []).length || (current.triggerQueue || []).length) return;
    const phase = phaseName();
    const prefs = preferences();
    const key = phaseKey() + ":" + phase;
    if (autoActionKey === key) return;

    let action = null;
    if (phase === "Untap" && prefs.autoUntap) action = { type: "next-phase" };
    if (phase === "Draw" && prefs.autoDrawAdvance) action = { type: "next-phase" };
    if (phase === "First-Strike Damage" && prefs.autoCombatDamage) action = { type: "next-phase" };
    if (phase === "Combat Damage" && prefs.autoCombatDamage) action = { type: "combat-damage", pass: "normal", thenNext: true };
    if (phase === "Cleanup" && prefs.autoCleanup) action = { type: "end-turn" };
    if (!action) return;

    autoTimer = setTimeout(async () => {
      autoActionKey = key;
      const result = await post(action);
      if (result && action.thenNext) {
        setTimeout(() => post({ type: "next-phase" }), 350);
      }
    }, phase === "Draw" ? 800 : 450);
  }

  function runAutomaticPass() {
    const current = room();
    if (!current || !priorityMine() || requestPending) return;
    const currentStackKey = stackKey();
    const currentPhaseKey = phaseKey();
    const top = current.stack?.at(-1);
    const yieldKey = String(top?.sourceCardId || top?.name || "");
    const shouldPass =
      (passUntilStackKey && passUntilStackKey === currentStackKey) ||
      (autoPassPhaseKey && autoPassPhaseKey === currentPhaseKey) ||
      (yieldKey && yields().has(yieldKey));
    if (!shouldPass) return;
    setTimeout(() => {
      if (priorityMine() && !requestPending) post({ type: "pass-priority" });
    }, 550);
  }

  function repair() {
    const shell = document.querySelector(".arena-game-shell");
    document.body.classList.toggle("v62-game-visible", Boolean(shell));
    if (!shell) return;
    shell.classList.add("arena-v62");
    ensureDock(shell);
    injectAbilityButtons();
    showPendingTrigger(false);
    runAutomaticPhase();
    runAutomaticPass();
  }

  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repair();
    });
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-v62-action]");
    if (!button) return;
    event.preventDefault();
    const action = button.dataset.v62Action;
    if (action === "close-overlay") return closeOverlay();
    if (action === "open-settings") return openOverlay("Automation settings", settingsHtml(), "settings");
    if (action === "show-trigger") return pendingTrigger() ? showPendingTrigger(true) : toast("You have no trigger choices waiting.");
    if (action === "pass") return post({ type: "pass-priority" });
    if (action === "pass-stack") {
      passUntilStackKey = stackKey();
      autoPassPhaseKey = "";
      toast("Auto-pass is active until the stack changes.");
      return runAutomaticPass();
    }
    if (action === "pass-phase") {
      autoPassPhaseKey = phaseKey();
      passUntilStackKey = "";
      toast("Auto-pass is active for this phase.");
      return runAutomaticPass();
    }
    if (action === "toggle-yield") {
      const set = yields();
      const key = String(button.dataset.yieldKey || "");
      if (set.has(key)) set.delete(key); else set.add(key);
      saveYields(set);
      scheduleRepair();
      return;
    }
    if (action === "clear-yields") {
      saveYields(new Set());
      toast("Always-yield list cleared.");
      return scheduleRepair();
    }
    if (action === "decline-trigger") {
      closeOverlay();
      return post({ type: "resolve-trigger-choice", triggerId: button.dataset.triggerId, declined: true });
    }
    if (action === "open-ability") return openAbility(button.dataset.cardId, button.dataset.abilityIndex);
  }, true);

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (form.id === "v62TriggerForm") {
      event.preventDefault();
      const data = new FormData(form);
      const trigger = pendingTrigger();
      closeOverlay();
      return post({
        type: "resolve-trigger-choice",
        triggerId: form.dataset.triggerId,
        targets: data.get("target") ? [data.get("target")] : [],
        manual: !trigger?.automation?.actions?.length || trigger?.automation?.level === "manual"
      });
    }
    if (form.id === "v62AbilityForm") {
      event.preventDefault();
      const data = new FormData(form);
      closeOverlay();
      return post({
        type: "activate-ability",
        cardId: form.dataset.cardId,
        abilityIndex: Number(form.dataset.abilityIndex),
        targets: data.get("target") ? [data.get("target")] : [],
        discardCardId: data.get("discardCardId") || "",
        sacrificeCardId: data.get("sacrificeCardId") || ""
      });
    }
    if (form.id === "v62SettingsForm") {
      event.preventDefault();
      const data = new FormData(form);
      const next = {};
      for (const key of ["autoUntap", "autoDrawAdvance", "autoCombatDamage", "autoCleanup", "showTriggerPrompts"]) next[key] = data.get(key) === "on";
      saveJson(PREF_KEY, next);
      closeOverlay();
      toast("Automation settings saved.");
      return scheduleRepair();
    }
  }, true);

  function start() {
    ensureOverlay();
    const app = document.getElementById("app");
    if (app) new MutationObserver(scheduleRepair).observe(app, { childList: true, subtree: true });
    const modal = document.getElementById("modalBody");
    if (modal) new MutationObserver(scheduleRepair).observe(modal, { childList: true, subtree: true });
    setInterval(scheduleRepair, 700);
    scheduleRepair();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ArenaCommanderGameplayV62 = {
    version: VERSION,
    repair,
    openSettings: () => openOverlay("Automation settings", settingsHtml(), "settings")
  };
})();
