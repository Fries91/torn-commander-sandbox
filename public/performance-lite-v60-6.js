(() => {
  "use strict";

  const VERSION = "60.6.0";
  let inspectTimer = null;

  function addPerformanceBadge() {
    const actions = document.querySelector(
      ".arena-game-topbar .arena-top-actions"
    );

    if (
      !actions ||
      document.getElementById("v606PerformanceBadge")
    ) {
      return;
    }

    const badge = document.createElement("span");
    badge.id = "v606PerformanceBadge";
    badge.className = "v606-performance-badge";
    badge.textContent = "Performance mode";
    badge.title =
      "Advanced browser add-ons are paused. The server rules engines remain active.";
    actions.appendChild(badge);
  }

  function inspect() {
    addPerformanceBadge();
  }

  const app = document.getElementById("app");

  if (app) {
    const observer = new MutationObserver(() => {
      clearTimeout(inspectTimer);
      inspectTimer = setTimeout(inspect, 250);
    });

    observer.observe(app, {
      childList: true,
      subtree: false
    });
  }

  window.addEventListener("error", (event) => {
    console.error(
      "Arena Commander browser error:",
      event.error || event.message
    );
  });

  window.addEventListener(
    "unhandledrejection",
    (event) => {
      console.error(
        "Arena Commander rejected operation:",
        event.reason
      );
    }
  );

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      inspect,
      { once: true }
    );
  } else {
    inspect();
  }

  window.ArenaCommanderPerformanceV606 = {
    version: VERSION
  };
})();
