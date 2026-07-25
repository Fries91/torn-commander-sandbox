(() => {
  "use strict";

  const VERSION = "62.3.0";
  const CARD_BACK_URL = "/mtg-card-back-v62-1.png?v=62.1.0";
  let repairQueued = false;

  function gameShell() {
    return document.querySelector(".arena-game-shell");
  }

  function isFullscreenGame() {
    if (!gameShell()) return false;
    return Boolean(document.fullscreenElement) ||
      Boolean(window.matchMedia?.("(display-mode: fullscreen)")?.matches);
  }

  function clearGameOnlyClasses() {
    const body = document.body;
    if (!body) return;
    for (const name of [
      "v621-fullscreen",
      "v621-opponent-open",
      "v621-game-visible",
      "v622-game-visible",
      "v622-dragging",
      "v622-moving-card",
      "v610-game-visible",
      "v609-game-visible",
      "is-dragging-card",
      "in-game"
    ]) body.classList.remove(name);

    body.style.removeProperty("overflow");
    body.style.removeProperty("overflow-x");
    body.style.removeProperty("overflow-y");
    body.style.removeProperty("position");
    body.style.removeProperty("height");
    body.style.removeProperty("touch-action");
    document.documentElement.style.removeProperty("overflow");
    document.documentElement.style.removeProperty("overflow-y");
    document.documentElement.style.removeProperty("height");

    document.querySelectorAll(".v621-board-switcher,.v622-drag-ghost").forEach((element) => element.remove());
  }

  function syncFullscreenState() {
    const shell = gameShell();
    if (!shell) {
      clearGameOnlyClasses();
      return false;
    }

    const active = isFullscreenGame();
    document.body.classList.toggle("v621-fullscreen", active);
    if (!active) document.body.classList.remove("v621-opponent-open");
    return active;
  }

  function repairLibraryBacks(root = document) {
    for (const pile of root.querySelectorAll('.arena-zone-pile[data-zone="library"]')) {
      let preview = pile.querySelector(":scope > .v610-zone-preview");
      if (!preview) {
        preview = document.createElement("div");
        preview.className = "v610-zone-preview is-library";
        pile.insertBefore(preview, pile.firstChild);
      }

      let image = preview.querySelector(":scope > img.v621-library-back");
      if (!image) {
        preview.replaceChildren();
        image = document.createElement("img");
        image.className = "v621-library-back";
        image.alt = "Magic card back";
        image.loading = "eager";
        image.decoding = "async";
        preview.appendChild(image);
      }

      if (!image.src.includes("mtg-card-back-v62-1.png")) image.src = CARD_BACK_URL;
      preview.classList.add("is-library", "v621-real-card-back");
    }
  }

  function ensureBoardSwitcher(shell) {
    let switcher = shell.querySelector(":scope > .v621-board-switcher");
    if (!switcher) {
      switcher = document.createElement("nav");
      switcher.className = "v621-board-switcher";
      switcher.setAttribute("aria-label", "Fullscreen board selector");
      switcher.innerHTML = `
        <button type="button" data-v621-action="previous" aria-label="Previous opponent">‹</button>
        <button type="button" class="v621-board-toggle" data-v621-action="toggle-board">OPPONENT</button>
        <button type="button" data-v621-action="next" aria-label="Next opponent">›</button>
        <button type="button" class="v621-table-button" data-v621-action="table">TABLE</button>`;
      shell.appendChild(switcher);
    }

    const opponentOpen = document.body.classList.contains("v621-opponent-open");
    const toggle = switcher.querySelector('[data-v621-action="toggle-board"]');
    if (toggle) {
      toggle.textContent = opponentOpen ? "MY BOARD" : "OPPONENT";
      toggle.setAttribute("aria-pressed", opponentOpen ? "true" : "false");
    }
  }

  function dedupeToasts() {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const seen = new Set();
    for (const toast of Array.from(region.children).reverse()) {
      const text = String(toast.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (seen.has(text)) toast.remove();
      else seen.add(text);
    }
  }

  function clickV61(action) {
    document.querySelector(`[data-v61-action="${action}"]`)?.click();
    window.setTimeout(scheduleRepair, 30);
  }

  function showOpponent(open) {
    if (!gameShell()) return;
    document.body.classList.toggle("v621-opponent-open", Boolean(open));
    window.ArenaCommanderFinalV61?.repair?.();
    scheduleRepair();
  }

  function repair() {
    const shell = gameShell();
    if (!shell) {
      clearGameOnlyClasses();
      return;
    }

    syncFullscreenState();
    document.body.classList.add("v621-game-visible");
    shell.classList.add("arena-v621");
    repairLibraryBacks(shell);
    ensureBoardSwitcher(shell);
    dedupeToasts();
  }

  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repair();
    });
  }

  document.addEventListener("fullscreenchange", scheduleRepair);
  window.matchMedia?.("(display-mode: fullscreen)")?.addEventListener?.("change", scheduleRepair);
  window.addEventListener("pageshow", scheduleRepair);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) scheduleRepair();
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-v621-action]");
    if (!button || !gameShell()) return;

    const action = button.dataset.v621Action;
    if (action === "toggle-board") {
      event.preventDefault();
      showOpponent(!document.body.classList.contains("v621-opponent-open"));
    } else if (action === "previous") {
      event.preventDefault();
      showOpponent(true);
      clickV61("previous-player");
    } else if (action === "next") {
      event.preventDefault();
      showOpponent(true);
      clickV61("next-player");
    } else if (action === "table") {
      event.preventDefault();
      clickV61("open-overview");
    }
  }, true);

  function start() {
    const app = document.getElementById("app");
    if (app) new MutationObserver(scheduleRepair).observe(app, { childList: true, subtree: true });
    scheduleRepair();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.ArenaCommanderTabletopFixV621 = {
    version: VERSION,
    repair,
    showOpponent,
    clearGameOnlyClasses
  };
})();
