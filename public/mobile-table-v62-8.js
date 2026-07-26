(() => {
  "use strict";

  const VERSION = "62.8.0";
  const MOBILE_QUERY = "(max-width: 820px)";
  const BODY_CLASS = "v627-mobile-table";
  const OPPONENT_CLASS = "v627-opponent-open";
  const FOCUS_CLASS = "v628-focus-visible";
  let observer = null;
  let repairQueued = false;
  let collapsedForMatch = false;

  function shell() {
    return document.querySelector(".arena-game-shell");
  }

  function isMobile() {
    return window.matchMedia?.(MOBILE_QUERY)?.matches ?? window.innerWidth <= 820;
  }

  function playerIdForSlot(slot) {
    return String(
      slot?.querySelector(".arena-seat")?.dataset.playerSeatId ||
      slot?.dataset.dropPlayerId ||
      ""
    );
  }

  function ensureOpponentFocus(game) {
    const slots = Array.from(game.querySelectorAll(".arena-opponent-ring > .opponent-slot"));
    if (!slots.length) return null;

    const requestedId = String(game.dataset.focusPlayerId || "");
    let selected = requestedId
      ? slots.find((slot) => playerIdForSlot(slot) === requestedId)
      : null;
    if (!selected) selected = slots.find((slot) => slot.classList.contains("v61-focus-visible"));
    if (!selected) selected = slots.find((slot) => slot.classList.contains(FOCUS_CLASS));
    if (!selected) selected = slots[0];

    for (const slot of slots) {
      const active = slot === selected;
      slot.classList.toggle(FOCUS_CLASS, active);
      slot.classList.toggle("v61-focus-visible", active);
      slot.classList.toggle("v61-focus-hidden", !active);
      slot.setAttribute("aria-hidden", active ? "false" : "true");
    }

    const selectedId = playerIdForSlot(selected);
    if (selectedId) game.dataset.focusPlayerId = selectedId;
    return selected;
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

  function repairCastButtons() {
    document.querySelectorAll('button[data-action="open-cast-card"]').forEach((button) => {
      button.textContent = "PLAY ON STACK";
      button.classList.add("v628-play-stack-button");
    });
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
      clearMobileState();
      repairCastButtons();
      return;
    }

    document.body.classList.add(BODY_CLASS);
    document.documentElement.classList.add(BODY_CLASS);
    game.classList.add("arena-v627", "arena-v628");

    collapseHandOnce();
    ensureOpponentFocus(game);
    repairCastButtons();
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
    const game = shell();
    if (game) ensureOpponentFocus(game);
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
      window.setTimeout(scheduleRepair, 40);
    }
  }

  function onHandToggle(event) {
    if (!shell() || !isMobile()) return;
    if (!event.target.closest?.("[data-v626-hand-toggle]")) return;
    window.setTimeout(scheduleRepair, 20);
  }

  function start() {
    // Replace the older v62.7 board-switch behavior rather than stacking another UI.
    document.addEventListener("click", onBoardControl, false);
    document.addEventListener("click", onHandToggle, false);

    const root = document.getElementById("app") || document.body;
    observer = new MutationObserver(scheduleRepair);
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-focus-player-id"] });

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

  window.ArenaCommanderMobileTableV628 = {
    version: VERSION,
    repair,
    showMine: () => setOpponentOpen(false),
    showOpponent: () => setOpponentOpen(true)
  };
})();
