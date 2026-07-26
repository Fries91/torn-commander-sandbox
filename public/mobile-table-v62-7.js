(() => {
  "use strict";

  const VERSION = "62.7.0";
  const MOBILE_QUERY = "(max-width: 820px)";
  const BODY_CLASS = "v627-mobile-table";
  const OPPONENT_CLASS = "v627-opponent-open";
  let observer = null;
  let repairQueued = false;
  let hadGame = false;
  let collapsedForMatch = false;

  function shell() {
    return document.querySelector(".arena-game-shell");
  }

  function isMobile() {
    return window.matchMedia?.(MOBILE_QUERY)?.matches ?? window.innerWidth <= 820;
  }

  function updateBoardButton() {
    const open = document.body.classList.contains(OPPONENT_CLASS);
    const button = document.querySelector(
      '.v621-board-switcher [data-v621-action="toggle-board"]'
    );
    if (!button) return;
    button.textContent = open ? "MY BOARD" : "OPPONENT";
    button.setAttribute("aria-pressed", open ? "true" : "false");
    button.setAttribute(
      "aria-label",
      open ? "Return to my battlefield" : "Show selected opponent battlefield"
    );
  }

  function collapseHandOnce() {
    if (collapsedForMatch) return;
    collapsedForMatch = true;
    window.ArenaCommanderHandV626?.collapse?.();
    document.body.classList.add("v626-hand-collapsed");
  }

  function clearMobileState() {
    document.body.classList.remove(BODY_CLASS, OPPONENT_CLASS);
    document.documentElement.classList.remove(BODY_CLASS);
    collapsedForMatch = false;
  }

  function repair() {
    const game = shell();
    const mobile = Boolean(game && isMobile());

    if (!mobile) {
      if (!game) hadGame = false;
      clearMobileState();
      return;
    }

    hadGame = true;
    document.body.classList.add(BODY_CLASS);
    document.documentElement.classList.add(BODY_CLASS);
    game.classList.add("arena-v627");

    collapseHandOnce();

    const focused = document.querySelector(
      ".arena-opponent-ring .opponent-slot.v61-focus-visible"
    );
    if (!focused) {
      document.querySelector(".arena-opponent-ring .opponent-slot")
        ?.classList.add("v61-focus-visible");
    }

    updateBoardButton();
  }

  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repair();
    });
  }

  function setOpponentOpen(open) {
    document.body.classList.toggle(OPPONENT_CLASS, Boolean(open));
    updateBoardButton();
    scheduleRepair();
  }

  function onBoardControl(event) {
    if (!shell() || !isMobile()) return;
    const button = event.target.closest?.("[data-v621-action]");
    if (!button) return;

    const action = String(button.dataset.v621Action || "");
    if (action === "toggle-board") {
      setOpponentOpen(!document.body.classList.contains(OPPONENT_CLASS));
    } else if (action === "previous" || action === "next") {
      setOpponentOpen(true);
      window.setTimeout(updateBoardButton, 50);
    }
  }

  function onHandToggle(event) {
    if (!shell() || !isMobile()) return;
    if (!event.target.closest?.("[data-v626-hand-toggle]")) return;
    window.setTimeout(scheduleRepair, 20);
  }

  function start() {
    document.addEventListener("click", onBoardControl, false);
    document.addEventListener("click", onHandToggle, false);

    const root = document.getElementById("app") || document.body;
    observer = new MutationObserver(scheduleRepair);
    observer.observe(root, { childList: true, subtree: true });

    window.addEventListener("resize", scheduleRepair, { passive: true });
    window.addEventListener("orientationchange", scheduleRepair, { passive: true });
    window.addEventListener("pageshow", scheduleRepair);
    document.addEventListener("fullscreenchange", scheduleRepair);
    scheduleRepair();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.ArenaCommanderMobileTableV627 = {
    version: VERSION,
    repair,
    showMine: () => setOpponentOpen(false),
    showOpponent: () => setOpponentOpen(true)
  };
})();
