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
