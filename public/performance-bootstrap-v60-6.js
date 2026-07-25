(() => {
  "use strict";

  const VERSION = "60.6.0";
  const SETTINGS_KEY = "tornCommander.uiSettings.v20";
  const APPLIED_KEY = "arenaCommander.performanceMode.v60.6";

  window.__ARENA_DISABLE_ADVANCED_BROWSER_ADDONS__ = true;

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    } catch {
      return {};
    }
  }

  function writeSettings(value) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    } catch {}
  }

  try {
    if (localStorage.getItem(APPLIED_KEY) !== "1") {
      writeSettings({
        ...readSettings(),
        sound: false,
        vibration: false,
        animations: false,
        lowData: true,
        autoPassEmpty: false,
        showArrows: false,
        groupCards: true
      });

      localStorage.setItem(APPLIED_KEY, "1");
    }
  } catch {}

  document.documentElement.classList.add(
    "arena-performance-mode"
  );

  window.ArenaCommanderPerformanceBootstrapV606 = {
    version: VERSION
  };
})();
