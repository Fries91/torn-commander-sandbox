/*
 * Arena Commander Stable Mobile UI v63.0.0
 * Loads after app.js and owns the collapsible hand and one-screen table view.
 */

/* ===== Collapsible complete-card hand ===== */
(() => {
  "use strict";

  const VERSION = "62.6.0";
  const STORAGE_KEY = "arenaCommander.handCollapsed.v62.6";
  const BODY_CLASS = "v626-hand-collapsed";
  let observer = null;
  let queued = false;

  function readSavedState() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "1") return true;
      if (stored === "0") return false;
    } catch {}

    return window.matchMedia?.("(max-width: 820px)")?.matches ?? false;
  }

  function isCollapsed() {
    return document.body.classList.contains(BODY_CLASS);
  }

  function saveState(collapsed) {
    try {
      localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {}
  }

  function updateButton(button) {
    if (!button) return;
    const collapsed = isCollapsed();
    button.setAttribute("aria-expanded", collapsed ? "false" : "true");
    button.setAttribute(
      "aria-label",
      collapsed ? "Show full hand" : "Collapse hand"
    );

    const text = button.querySelector("span");
    if (text) text.textContent = collapsed ? "SHOW HAND" : "HIDE HAND";

    const arrow = button.querySelector("b");
    if (arrow) arrow.textContent = collapsed ? "▲" : "▼";
  }

  function setCollapsed(collapsed, persist = true) {
    document.body.classList.toggle(BODY_CLASS, Boolean(collapsed));
    document.querySelectorAll(".v626-hand-toggle").forEach(updateButton);
    if (persist) saveState(Boolean(collapsed));
  }

  function handCount(tray) {
    const visible = tray.querySelectorAll(".hand-card-wrap").length;
    const existing = Number(tray.querySelector(".hand-label > span")?.textContent);
    return Number.isFinite(existing) ? existing : visible;
  }

  function ensureToggle(tray) {
    if (!tray) return;
    tray.classList.add("v626-hand-ready");

    const label = tray.querySelector(":scope > .hand-label");
    if (!label) return;

    label.classList.add("v626-hand-label");

    let button = label.querySelector(":scope > .v626-hand-toggle");
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "v626-hand-toggle";
      button.dataset.v626HandToggle = "true";
      button.innerHTML = "<span>HIDE HAND</span><em>0</em><b>▼</b>";
      label.appendChild(button);
    }

    const count = button.querySelector("em");
    if (count) count.textContent = String(handCount(tray));
    updateButton(button);
  }

  function repairHand() {
    const shell = document.querySelector(".arena-game-shell");
    const tray = shell?.querySelector(".arena-hand-tray") || null;

    document.body.classList.toggle("v626-game-visible", Boolean(shell && tray));
    if (!tray) return;

    ensureToggle(tray);

    for (const wrap of tray.querySelectorAll(".hand-card-wrap")) {
      wrap.classList.add("v626-full-card");
    }
  }

  function scheduleRepair() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      repairHand();
    });
  }

  function onClick(event) {
    const toggle = event.target.closest("[data-v626-hand-toggle]");
    if (toggle) {
      event.preventDefault();
      event.stopPropagation();
      setCollapsed(!isCollapsed());
      return;
    }

    const handPile = event.target.closest(
      '.arena-zone-pile[data-zone="hand"]'
    );
    if (handPile && isCollapsed()) {
      event.preventDefault();
      event.stopPropagation();
      setCollapsed(false);
      document.querySelector(".arena-hand-tray")?.scrollIntoView?.({
        block: "nearest",
        behavior: "smooth"
      });
    }
  }

  function onKeydown(event) {
    if (event.key !== "h" && event.key !== "H") return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable
    ) {
      return;
    }

    if (document.querySelector(".arena-hand-tray")) {
      event.preventDefault();
      setCollapsed(!isCollapsed());
    }
  }

  function start() {
    setCollapsed(readSavedState(), false);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeydown, true);

    const root = document.getElementById("app") || document.body;
    observer = new MutationObserver(scheduleRepair);
    observer.observe(root, { childList: true, subtree: true });
    repairHand();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.ArenaCommanderHandV626 = {
    version: VERSION,
    collapse: () => setCollapsed(true),
    expand: () => setCollapsed(false),
    toggle: () => setCollapsed(!isCollapsed()),
    repair: repairHand
  };
})();

/* ===== One-screen mobile table and opponent focus ===== */
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

window.ArenaCommanderStableMobile = Object.freeze({ version: "63.0.0" });
