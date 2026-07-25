(() => {
  "use strict";

  const VERSION = "62.3.0";
  let queued = false;

  function hasGame() {
    return Boolean(document.querySelector(".arena-game-shell"));
  }

  function unlockHome() {
    if (hasGame()) {
      document.body.classList.add("v623-game-active");
      document.body.classList.remove("v623-home-ready");
      return;
    }

    document.body.classList.remove("v623-game-active");
    document.body.classList.add("v623-home-ready");

    window.ArenaCommanderTabletopFixV621?.clearGameOnlyClasses?.();
    window.ArenaCommanderTabletopFixV622?.clearNonGameState?.();

    const body = document.body;
    const root = document.documentElement;
    for (const element of [root, body]) {
      element.style.removeProperty("overflow");
      element.style.removeProperty("overflow-x");
      element.style.removeProperty("overflow-y");
      element.style.removeProperty("height");
      element.style.removeProperty("position");
      element.style.removeProperty("touch-action");
    }

    body.removeAttribute("data-scroll-lock");
    body.removeAttribute("data-no-scroll");

    document.querySelectorAll(".v621-board-switcher,.v622-drag-ghost,.v622-drop-target").forEach((element) => element.remove());

    const play = document.querySelector('#bottomNav [data-nav="game"]');
    if (play) {
      play.disabled = false;
      play.removeAttribute("aria-disabled");
      play.style.removeProperty("pointer-events");
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      unlockHome();
    });
  }

  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.('#bottomNav [data-nav="game"], #brandButton')) unlockHome();
  }, true);

  document.addEventListener("click", (event) => {
    if (event.target.closest?.('#bottomNav [data-nav="game"], #brandButton')) unlockHome();
  }, true);

  window.addEventListener("pageshow", schedule);
  window.addEventListener("popstate", schedule);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
  document.addEventListener("fullscreenchange", schedule);

  function start() {
    const app = document.getElementById("app");
    if (app) new MutationObserver(schedule).observe(app, { childList: true, subtree: true });
    schedule();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ArenaCommanderHomeStabilityV623 = { version: VERSION, unlockHome };
})();
