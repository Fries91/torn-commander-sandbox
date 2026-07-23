(() => {
  "use strict";

  const VERSION = "40.1.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const SETTINGS_KEY = "arenaCommander.gameplayHotfix.v40.1";
  const helperSocket = typeof io === "function" ? io({ transports: ["websocket", "polling"] }) : null;
  let passTimer = null;
  let lastPassedSignature = "";
  let linkImportBusy = false;

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function settings() {
    return { autoPassStack: true, ...readJson(SETTINGS_KEY, {}) };
  }

  function updateSettings(patch) {
    writeJson(SETTINGS_KEY, { ...settings(), ...patch });
  }

  function session() {
    const value = readJson(SESSION_KEY, null);
    return value?.roomCode && value?.playerId && value?.sessionToken ? value : null;
  }

  function emitAction(action) {
    const current = session();
    if (!helperSocket || !current) return Promise.resolve({ success: false, error: "No saved player session." });
    return new Promise((resolve) => {
      let done = false;
      const timeout = setTimeout(() => {
        if (done) return;
        done = true;
        resolve({ success: false, error: "The table did not respond." });
      }, 12000);
      helperSocket.emit("game-action", { ...current, action }, (response) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        resolve(response || { success: false, error: "No response received." });
      });
    });
  }

  function toast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const element = document.createElement("div");
    element.className = `toast ${type}`;
    element.textContent = message;
    region.appendChild(element);
    setTimeout(() => element.remove(), 4200);
  }

  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function cleanName(value) {
    return String(value || "").replace(/\bAI\b/g, "").replace(/\s+/g, " ").trim();
  }

  function myName() {
    const seat = document.querySelector(".arena-seat.is-self .seat-name strong");
    if (seat) return cleanName(seat.textContent);
    const card = document.querySelector(".player-card.is-self h3");
    return cleanName(card?.childNodes?.[0]?.textContent || card?.textContent);
  }

  function priorityName() {
    return cleanName(
      document.querySelector(".priority-label strong")?.textContent ||
      document.querySelector(".priority-orb")?.textContent
    );
  }

  function stackCount() {
    const label = document.querySelector(".center-stack:not(.empty) span")?.textContent || "";
    const match = label.match(/(\d+)/);
    if (match) return Number(match[1]);
    return document.querySelectorAll(".arena-stack-item").length;
  }

  function modalIsOpen() {
    const backdrop = document.getElementById("modalBackdrop");
    return Boolean(backdrop && !backdrop.classList.contains("is-hidden"));
  }

  function refreshAutoButton() {
    const button = document.getElementById("arenaAutoStackToggle");
    if (!button) return;
    const enabled = settings().autoPassStack !== false;
    button.classList.toggle("is-holding", !enabled);
    button.innerHTML = enabled
      ? "<span>⚡</span><small>Auto stack</small>"
      : "<span>✋</span><small>Hold priority</small>";
    button.title = enabled
      ? "Automatically pass priority so the stack resolves when you have no response."
      : "Priority is being held for manual responses.";
  }

  function injectGameControls() {
    const topActions = document.querySelector(".arena-game-topbar .arena-top-actions");
    if (!topActions) return;

    if (!document.getElementById("arenaAutoStackToggle")) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "arenaAutoStackToggle";
      button.className = "arena-hotfix-control";
      topActions.prepend(button);
      refreshAutoButton();
    }

    if (!document.getElementById("arenaLeaveMatch")) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = "arenaLeaveMatch";
      button.className = "arena-hotfix-control arena-leave-match";
      button.dataset.action = "leave-room";
      button.innerHTML = "<span>↩</span><small>Leave match</small>";
      button.title = "Leave this table and return to the home screen.";
      topActions.append(button);
    }
  }

  function scheduleAutoPass() {
    clearTimeout(passTimer);
    const current = session();
    if (!current || settings().autoPassStack === false || modalIsOpen() || document.getElementById("arenaTargetChooser")) return;

    const mine = myName();
    const priority = priorityName();
    const count = stackCount();
    if (!mine || !priority || mine.toLocaleLowerCase() !== priority.toLocaleLowerCase() || count < 1) {
      lastPassedSignature = "";
      return;
    }

    const topName = cleanName(document.querySelector(".center-stack strong")?.textContent);
    const signature = `${current.roomCode}:${count}:${topName}:${priority}`;
    if (signature === lastPassedSignature) return;

    passTimer = setTimeout(async () => {
      if (settings().autoPassStack === false || modalIsOpen()) return;
      if (myName().toLocaleLowerCase() !== priorityName().toLocaleLowerCase() || stackCount() < 1) return;
      lastPassedSignature = signature;
      const response = await emitAction({ type: "pass-priority" });
      if (!response.success) {
        lastPassedSignature = "";
        toast(response.error || "Unable to pass priority.", "warning");
      }
    }, 900);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cardTargets(triggerText) {
    const text = triggerText.toLocaleLowerCase();
    const wantsOpponent = /target opponent|opponent controls/.test(text);
    const cards = [];
    const seen = new Set();

    for (const element of document.querySelectorAll(".arena-seat-board [data-card-id]")) {
      if (!visible(element)) continue;
      const id = element.dataset.cardId;
      if (!id || seen.has(id)) continue;
      const seat = element.closest(".arena-seat");
      if (wantsOpponent && seat?.classList.contains("is-self")) continue;
      seen.add(id);
      const name =
        element.querySelector(".arena-card-name, .card-name, strong")?.textContent ||
        element.querySelector("img")?.alt ||
        element.textContent ||
        "Permanent";
      cards.push({ id, name: cleanName(name).slice(0, 90), kind: "card" });
    }
    return cards;
  }

  function playerTargets(triggerText) {
    const text = triggerText.toLocaleLowerCase();
    const wantsOpponent = /target opponent/.test(text);
    const result = [];
    for (const seat of document.querySelectorAll("[data-player-seat-id]")) {
      if (!visible(seat)) continue;
      if (wantsOpponent && seat.classList.contains("is-self")) continue;
      const id = seat.dataset.playerSeatId;
      const name = cleanName(seat.querySelector(".seat-name strong")?.textContent || "Player");
      if (id) result.push({ id, name, kind: "player" });
    }
    return result;
  }

  function targetKind(triggerText) {
    const text = triggerText.toLocaleLowerCase();
    if (/target opponent|target player/.test(text)) return "player";
    if (/any target/.test(text)) return "any";
    if (/target creature|target permanent|target artifact|target enchantment|target planeswalker/.test(text)) return "card";
    return "";
  }

  function closeTargetChooser() {
    document.getElementById("arenaTargetChooser")?.remove();
  }

  function openTargetChooser(triggerId, triggerText) {
    const kind = targetKind(triggerText);
    const targets = [
      ...(kind === "player" || kind === "any" ? playerTargets(triggerText) : []),
      ...(kind === "card" || kind === "any" ? cardTargets(triggerText) : [])
    ];

    if (!targets.length) {
      toast("No legal-looking target is visible. Use Judge Mode for this unusual target.", "warning");
      return;
    }

    closeTargetChooser();
    const overlay = document.createElement("div");
    overlay.id = "arenaTargetChooser";
    overlay.className = "arena-target-chooser";
    overlay.innerHTML = `
      <section>
        <header><div><small>Assisted card mechanic</small><h2>Choose a target</h2></div><button type="button" data-hotfix-close-target>×</button></header>
        <p>${escapeHtml(triggerText)}</p>
        <div class="arena-target-choice-list">
          ${targets.map((target) => `<button type="button" data-hotfix-target-kind="${target.kind}" data-hotfix-target-id="${escapeHtml(target.id)}"><span>${target.kind === "player" ? "Player" : "Permanent"}</span><strong>${escapeHtml(target.name || target.kind)}</strong></button>`).join("")}
        </div>
        <button type="button" class="arena-target-cancel" data-hotfix-close-target>Cancel</button>
      </section>`;
    overlay.dataset.triggerId = triggerId;
    document.body.appendChild(overlay);
  }

  async function submitTriggerTarget(targetButton) {
    const overlay = targetButton.closest("#arenaTargetChooser");
    const triggerId = overlay?.dataset.triggerId;
    const id = targetButton.dataset.hotfixTargetId;
    const kind = targetButton.dataset.hotfixTargetKind;
    if (!triggerId || !id || !kind) return;
    targetButton.disabled = true;
    const response = await emitAction({
      type: "trigger-to-stack",
      triggerId,
      targets: [`${kind}:${id}`]
    });
    if (!response.success) {
      targetButton.disabled = false;
      toast(response.error || "Unable to put that trigger on the stack.", "error");
      return;
    }
    closeTargetChooser();
    toast("Target selected and trigger placed on the stack.", "success");
  }

  function injectDeckLinkImporter() {
    const form = document.getElementById("deckForm");
    if (!form || form.querySelector("[data-deck-link-importer]")) return;
    const deckList = form.elements.namedItem("deckList");
    if (!deckList) return;

    const section = document.createElement("section");
    section.className = "deck-link-importer";
    section.dataset.deckLinkImporter = "1";
    section.innerHTML = `
      <strong>Import from a public deck link</strong>
      <p>Paste a public Archidekt or Moxfield link. The cards will fill this form, then the normal card identifier will verify them.</p>
      <div><input type="url" data-deck-link-url placeholder="https://archidekt.com/decks/... or https://www.moxfield.com/decks/..."><button type="button" data-load-deck-link>Load link</button></div>`;
    form.insertBefore(section, deckList.closest("label"));
  }

  async function importDeckLink(form, url) {
    if (linkImportBusy) return false;
    linkImportBusy = true;
    const button = form.querySelector("[data-load-deck-link]");
    const original = button?.textContent || "Load link";
    if (button) {
      button.disabled = true;
      button.textContent = "Loading…";
    }
    try {
      const response = await fetch("/api/decks/import-link", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({ url })
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "Deck-link import failed.");

      const nameInput = form.elements.namedItem("deckName");
      const commanderInput = form.elements.namedItem("commanders");
      const listInput = form.elements.namedItem("deckList");
      if (nameInput && !nameInput.value.trim()) nameInput.value = payload.deckName || "";
      if (commanderInput) commanderInput.value = (payload.commanders || []).join(" / ");
      if (listInput) listInput.value = payload.deckList || "";
      toast(`${payload.source}: loaded ${payload.totalCards} cards.`, "success");
      return true;
    } catch (error) {
      toast(error?.message || "Unable to import that public deck link.", "error");
      return false;
    } finally {
      linkImportBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }

  document.addEventListener("click", async (event) => {
    const close = event.target.closest("[data-hotfix-close-target]");
    if (close) {
      event.preventDefault();
      closeTargetChooser();
      return;
    }

    const targetButton = event.target.closest("[data-hotfix-target-id]");
    if (targetButton) {
      event.preventDefault();
      await submitTriggerTarget(targetButton);
      return;
    }

    const toggle = event.target.closest("#arenaAutoStackToggle");
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      const enabled = settings().autoPassStack === false;
      updateSettings({ autoPassStack: enabled });
      lastPassedSignature = "";
      refreshAutoButton();
      toast(enabled ? "Automatic stack passing enabled." : "Priority will be held manually.", "info");
      scheduleAutoPass();
      return;
    }

    const leave = event.target.closest("#arenaLeaveMatch");
    if (leave && !window.confirm("Leave this match and return to Arena Commander home?")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    const triggerButton = event.target.closest("[data-action='trigger-to-stack']");
    if (triggerButton) {
      const triggerItem = triggerButton.closest(".trigger-item");
      const text = triggerItem?.querySelector("p")?.textContent || triggerItem?.textContent || "";
      if (targetKind(text)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openTargetChooser(triggerButton.dataset.triggerId, cleanName(text));
        return;
      }
    }

    const loadLink = event.target.closest("[data-load-deck-link]");
    if (loadLink) {
      event.preventDefault();
      const form = loadLink.closest("#deckForm");
      const url = form?.querySelector("[data-deck-link-url]")?.value.trim();
      if (!url) return toast("Paste a public deck link first.", "warning");
      await importDeckLink(form, url);
    }
  }, true);

  document.addEventListener("submit", async (event) => {
    const form = event.target?.closest?.("#deckForm");
    if (!form || form.dataset.hotfixLinkReady === "1") return;
    const list = String(form.elements.namedItem("deckList")?.value || "").trim();
    if (!/^https?:\/\//i.test(list)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const imported = await importDeckLink(form, list);
    if (!imported) return;
    form.dataset.hotfixLinkReady = "1";
    setTimeout(() => {
      form.requestSubmit();
      delete form.dataset.hotfixLinkReady;
    }, 50);
  }, true);

  const observer = new MutationObserver(() => {
    injectGameControls();
    injectDeckLinkImporter();
    scheduleAutoPass();
  });

  const app = document.getElementById("app");
  if (app) observer.observe(app, { childList: true, subtree: true });
  const modalBody = document.getElementById("modalBody");
  if (modalBody) observer.observe(modalBody, { childList: true, subtree: true });

  window.addEventListener("load", () => {
    injectGameControls();
    injectDeckLinkImporter();
    scheduleAutoPass();
  }, { once: true });

  window.ArenaCommanderGameplayHotfix = {
    version: VERSION,
    emitAction,
    scheduleAutoPass,
    importDeckLink
  };
})();
