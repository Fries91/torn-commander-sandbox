(() => {
  "use strict";

  const VERSION = "60.3.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const META_PENDING_KEY = "arenaCommander.pendingMetaMatch.v60.3";

  let attempts = 0;
  let retryTimer = null;
  let observer = null;
  let stopped = false;

  function readSession() {
    try {
      const value = JSON.parse(
        localStorage.getItem(SESSION_KEY)
      );

      return value?.roomCode &&
        value?.playerId &&
        value?.sessionToken
        ? value
        : null;
    } catch {
      return null;
    }
  }

  function visible(element) {
    if (!element) return false;

    return (
      !element.classList.contains("is-hidden") &&
      element.getAttribute("aria-hidden") !== "true"
    );
  }

  function unlockStaleLayers() {
    const body = document.body;
    if (!body) return;

    const metaOverlay =
      document.getElementById("metaLibraryOverlay");

    const modalBackdrop =
      document.getElementById("modalBackdrop");

    const reconnectOverlay =
      document.getElementById("reconnectOverlay");

    if (!visible(metaOverlay)) {
      body.classList.remove("meta-library-open");

      if (metaOverlay) {
        metaOverlay.classList.add("is-hidden");
        metaOverlay.setAttribute("aria-hidden", "true");
        metaOverlay.style.pointerEvents = "none";
      }
    } else if (metaOverlay) {
      metaOverlay.style.removeProperty("pointer-events");
    }

    if (!visible(modalBackdrop)) {
      if (modalBackdrop) {
        modalBackdrop.classList.add("is-hidden");
        modalBackdrop.setAttribute("aria-hidden", "true");
        modalBackdrop.style.pointerEvents = "none";
      }

      if (!visible(metaOverlay)) {
        body.style.removeProperty("overflow");
      }
    } else if (modalBackdrop) {
      modalBackdrop.style.removeProperty("pointer-events");
    }

    if (!visible(reconnectOverlay) && reconnectOverlay) {
      reconnectOverlay.classList.add("is-hidden");
      reconnectOverlay.style.pointerEvents = "none";
    }

    const toastRegion =
      document.getElementById("toastRegion");

    if (toastRegion) {
      toastRegion.style.pointerEvents = "none";
    }
  }

  function inGame() {
    return (
      document.body?.classList.contains("in-game") ||
      Boolean(
        document.querySelector(
          ".arena-game-shell, .arena-stage, [data-game-room]"
        )
      )
    );
  }

  function rejoinButton() {
    return document.querySelector(
      'button[data-action="rejoin"]'
    );
  }

  function stopRetrying() {
    stopped = true;
    window.clearTimeout(retryTimer);
    retryTimer = null;
    observer?.disconnect();
    observer = null;

    try {
      sessionStorage.removeItem(META_PENDING_KEY);
    } catch {}
  }

  function scheduleRetry(delay = 700) {
    if (stopped) return;

    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(
      tryResume,
      delay
    );
  }

  function tryResume() {
    unlockStaleLayers();

    if (inGame()) {
      stopRetrying();
      return;
    }

    const session = readSession();
    if (!session) {
      stopRetrying();
      return;
    }

    const button = rejoinButton();

    if (!button) {
      scheduleRetry(450);
      return;
    }

    if (attempts >= 12) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      return;
    }

    attempts += 1;
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.click();

    scheduleRetry(
      Math.min(2500, 650 + attempts * 180)
    );
  }

  function markMetaLaunch() {
    try {
      sessionStorage.setItem(
        META_PENDING_KEY,
        String(Date.now())
      );
    } catch {}

    unlockStaleLayers();
  }

  document.addEventListener(
    "submit",
    (event) => {
      if (event.target?.id !== "metaPlayForm") {
        return;
      }

      markMetaLaunch();

      const button =
        event.submitter ||
        event.target.querySelector(
          'button[type="submit"]'
        );

      if (button) {
        button.disabled = true;
        button.textContent =
          "Creating match…";
      }
    },
    true
  );

  document.addEventListener(
    "click",
    (event) => {
      if (
        event.target.closest(
          '[data-action="rejoin"]'
        )
      ) {
        unlockStaleLayers();
      }
    },
    true
  );

  window.addEventListener(
    "beforeunload",
    unlockStaleLayers,
    { capture: true }
  );

  window.addEventListener(
    "pagehide",
    unlockStaleLayers,
    { capture: true }
  );

  window.addEventListener(
    "pageshow",
    () => {
      stopped = false;
      attempts = 0;
      unlockStaleLayers();
      scheduleRetry(120);
    }
  );

  function start() {
    stopped = false;
    attempts = 0;
    unlockStaleLayers();

    observer = new MutationObserver(() => {
      unlockStaleLayers();

      if (inGame()) {
        stopRetrying();
        return;
      }

      if (readSession() && rejoinButton()) {
        scheduleRetry(80);
      }
    });

    observer.observe(
      document.documentElement,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: [
          "class",
          "aria-hidden"
        ]
      }
    );

    [
      80,
      350,
      800,
      1500,
      2800
    ].forEach((delay) => {
      window.setTimeout(
        () => {
          if (!stopped) tryResume();
        },
        delay
      );
    });
  }

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }

  window.ArenaCommanderV603 = {
    version: VERSION,
    unlock: unlockStaleLayers,
    resume: tryResume
  };
})();
