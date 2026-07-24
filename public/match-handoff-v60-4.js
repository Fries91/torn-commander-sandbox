(() => {
  "use strict";

  const SESSION_KEY = "tornCommander.session.v5";
  const PENDING_KEY = "arenaCommander.pendingMetaMatch.v60.4";

  let attempts = 0;
  let timer = null;
  let busy = false;

  function hasSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      return Boolean(value?.roomCode && value?.playerId && value?.sessionToken);
    } catch {
      return false;
    }
  }

  function markPending() {
    try {
      sessionStorage.setItem(PENDING_KEY, String(Date.now()));
    } catch {}
  }

  function pending() {
    try {
      const created = Number(sessionStorage.getItem(PENDING_KEY));
      return Number.isFinite(created) && Date.now() - created < 120000;
    } catch {
      return false;
    }
  }

  function clearPending() {
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch {}
  }

  function unlockPage() {
    const body = document.body;
    if (!body) return;

    const meta = document.getElementById("metaLibraryOverlay");
    const modal = document.getElementById("modalBackdrop");
    const reconnect = document.getElementById("reconnectOverlay");

    if (!meta || meta.classList.contains("is-hidden")) {
      body.classList.remove("meta-library-open");
      body.style.removeProperty("overflow");
    }

    for (const element of [meta, modal, reconnect]) {
      if (!element || !element.classList.contains("is-hidden")) continue;
      element.style.pointerEvents = "none";
    }

    const toasts = document.getElementById("toastRegion");
    if (toasts) toasts.style.pointerEvents = "none";
  }

  function connected() {
    const status = document.getElementById("connectionStatus");
    const text = document.getElementById("connectionText");
    return Boolean(
      status?.classList.contains("online") ||
      /\bconnected\b/i.test(text?.textContent || "")
    );
  }

  function inGame() {
    return Boolean(
      document.body?.classList.contains("in-game") ||
      document.querySelector(".arena-game-shell, .arena-stage, [data-game-room]")
    );
  }

  function schedule(delay = 800) {
    clearTimeout(timer);
    timer = setTimeout(resume, delay);
  }

  function resume() {
    unlockPage();

    if (inGame()) {
      clearPending();
      clearTimeout(timer);
      return;
    }

    if (!pending() || !hasSession()) return;
    if (!connected()) return schedule(900);

    const button = document.querySelector('button[data-action="rejoin"]');
    if (!button) return schedule(500);
    if (busy || attempts >= 3) return;

    attempts += 1;
    busy = true;
    button.disabled = false;
    button.click();

    setTimeout(() => {
      busy = false;
      if (inGame()) {
        clearPending();
      } else if (pending()) {
        schedule(5000);
      }
    }, 3500);
  }

  document.addEventListener("submit", (event) => {
    if (event.target?.id !== "metaPlayForm") return;
    attempts = 0;
    busy = false;
    markPending();
    unlockPage();
  }, true);

  window.addEventListener("online", () => schedule(100));
  window.addEventListener("pageshow", () => {
    attempts = 0;
    busy = false;
    unlockPage();
    schedule(250);
  });

  document.addEventListener("DOMContentLoaded", () => {
    unlockPage();

    const status = document.getElementById("connectionStatus");
    if (status) {
      new MutationObserver(() => {
        if (connected()) schedule(100);
      }).observe(status, {
        attributes: true,
        attributeFilter: ["class"]
      });
    }

    schedule(500);
  }, { once: true });
})();
