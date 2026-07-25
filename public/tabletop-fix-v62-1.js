(() => {
  "use strict";

  const VERSION = "62.1.0";
  const CARD_BACK_URL = "/mtg-card-back-v62-1.png?v=62.1.0";
  let repairQueued = false;

  function isFullscreen() {
    return Boolean(document.fullscreenElement) ||
      Boolean(window.matchMedia?.("(display-mode: fullscreen)")?.matches);
  }

  function syncFullscreenState() {
    const active = isFullscreen();
    document.body.classList.toggle("v621-fullscreen", active);
    if (!active) document.body.classList.remove("v621-opponent-open");
  }

  function repairLibraryBacks(root = document) {
    for (const pile of root.querySelectorAll('.arena-zone-pile[data-zone="library"]')) {
      let preview = pile.querySelector(':scope > .v610-zone-preview');
      if (!preview) {
        preview = document.createElement("div");
        preview.className = "v610-zone-preview is-library";
        pile.insertBefore(preview, pile.firstChild);
      }

      let image = preview.querySelector(':scope > img.v621-library-back');
      if (!image) {
        preview.replaceChildren();
        image = document.createElement("img");
        image.className = "v621-library-back";
        image.alt = "Magic card back";
        image.loading = "eager";
        image.decoding = "async";
        preview.appendChild(image);
      }

      if (!image.src.includes("mtg-card-back-v62-1.png")) {
        image.src = CARD_BACK_URL;
      }
      preview.classList.add("is-library", "v621-real-card-back");
    }
  }

  function ensureBoardSwitcher(shell) {
    let switcher = shell.querySelector(':scope > .v621-board-switcher');
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
    const button = document.querySelector(`[data-v61-action="${action}"]`);
    button?.click();
    window.setTimeout(scheduleRepair, 30);
  }

  function showOpponent(open) {
    document.body.classList.toggle("v621-opponent-open", Boolean(open));
    window.ArenaCommanderFinalV61?.repair?.();
    scheduleRepair();
  }

  function repair() {
    syncFullscreenState();
    const shell = document.querySelector(".arena-game-shell");
    document.body.classList.toggle("v621-game-visible", Boolean(shell));
    if (!shell) return;

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

  document.addEventListener("fullscreenchange", () => {
    syncFullscreenState();
    scheduleRepair();
  });

  window.matchMedia?.("(display-mode: fullscreen)")?.addEventListener?.("change", scheduleRepair);

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-v621-action]");
    if (!button) return;

    const action = button.dataset.v621Action;
    if (action === "toggle-board") {
      event.preventDefault();
      showOpponent(!document.body.classList.contains("v621-opponent-open"));
      return;
    }

    if (action === "previous") {
      event.preventDefault();
      showOpponent(true);
      clickV61("previous-player");
      return;
    }

    if (action === "next") {
      event.preventDefault();
      showOpponent(true);
      clickV61("next-player");
      return;
    }

    if (action === "table") {
      event.preventDefault();
      clickV61("open-overview");
    }
  }, true);

  function start() {
    syncFullscreenState();
    const app = document.getElementById("app");
    if (app) new MutationObserver(scheduleRepair).observe(app, { childList: true, subtree: true });
    const toastRegion = document.getElementById("toastRegion");
    if (toastRegion) new MutationObserver(scheduleRepair).observe(toastRegion, { childList: true });
    window.setInterval(scheduleRepair, 500);
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
    showOpponent
  };
})();
