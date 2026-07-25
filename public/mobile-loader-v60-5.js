(() => {
  "use strict";

  const VERSION = "60.5.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const BACKUP_KEY = "arenaCommander.savedRoom.v60.5";

  const CORE_SCRIPTS = [
    "/card-automation-ui.js?v=40.0.0",
    "/gameplay-hotfix.js?v=40.1.0",
    "/arena-table-v41-1.js?v=41.1.0",
    "/arena-table-v41.js?v=41.0.0",
    "/arena-autotap-v42.js?v=42.0.0",
    "/zone-choices-v43.js?v=43.0.0",
    "/targeting-v44.js?v=44.0.0",
    "/effects-v45.js?v=45.0.0",
    "/mechanics-v46.js?v=46.0.0",
    "/permissions-v47.js?v=47.0.0",
    "/triggers-v48.js?v=48.0.0",
    "/forms-v49.js?v=49.0.0",
    "/casting-v50.js?v=50.0.0",
    "/combat-v51.js?v=51.0.0",
    "/walkers-v52.js?v=52.0.0",
    "/attachments-v53.js?v=53.0.0",
    "/copies-v54.js?v=54.0.0",
    "/commander-v55.js?v=55.0.0"
  ];

  const OPTIONAL_SCRIPTS = [
    "/multiplayer-v56.js?v=56.0.0",
    "/replacement-v57.js?v=57.0.0",
    "/control-v58.js?v=58.0.0",
    "/hidden-v59.js?v=59.0.0",
    "/turn-v60.js?v=60.0.0"
  ];

  const loaded = new Set(
    [...document.scripts]
      .map((script) => script.getAttribute("src"))
      .filter(Boolean)
  );

  let coreLoading = false;
  let coreLoaded = false;
  let optionalLoading = false;
  let optionalLoaded = false;
  let inspectTimer = null;

  function backupSession() {
    try {
      return sessionStorage.getItem(BACKUP_KEY);
    } catch {
      return null;
    }
  }

  function clearBackup() {
    try {
      sessionStorage.removeItem(BACKUP_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  function restoreAndResume() {
    const backup = backupSession();
    if (!backup) return;

    try {
      localStorage.setItem(SESSION_KEY, backup);
    } catch {
      return;
    }

    const url = new URL(location.href);
    url.searchParams.set("resumeRoom", "1");
    location.replace(url.toString());
  }

  function installRecoveryCard() {
    const existing = document.getElementById("v605RecoveryCard");
    const backup = backupSession();

    if (!backup || document.body.classList.contains("in-game")) {
      existing?.remove();
      return;
    }

    if (existing) return;

    const card = document.createElement("section");
    card.id = "v605RecoveryCard";
    card.className = "v605-recovery-card";
    card.innerHTML = `
      <div>
        <small>SAFE START v60.5</small>
        <strong>Saved match paused</strong>
        <p>The app did not automatically open the saved room, preventing the startup freeze.</p>
      </div>
      <div class="v605-recovery-actions">
        <button type="button" data-v605-resume>Enter saved match</button>
        <button type="button" data-v605-forget>Forget saved match</button>
      </div>
    `;

    document.getElementById("app")?.prepend(card);
  }

  function loadScript(source) {
    return new Promise((resolve) => {
      if (loaded.has(source)) {
        resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = source;
      script.async = true;
      script.dataset.v605Lazy = "1";
      script.onload = () => {
        loaded.add(source);
        resolve();
      };
      script.onerror = () => resolve();
      document.head.appendChild(script);
    });
  }

  function idleDelay(milliseconds = 220) {
    return new Promise((resolve) => {
      if ("requestIdleCallback" in window) {
        requestIdleCallback(resolve, { timeout: milliseconds + 600 });
      } else {
        setTimeout(resolve, milliseconds);
      }
    });
  }

  async function loadSequentially(sources) {
    for (const source of sources) {
      await loadScript(source);
      await idleDelay();
    }
  }

  async function loadCore() {
    if (coreLoaded || coreLoading) return;
    coreLoading = true;

    await idleDelay(500);
    await loadSequentially(CORE_SCRIPTS);

    coreLoaded = true;
    coreLoading = false;
    installAdvancedButton();
  }

  async function loadOptional() {
    if (optionalLoaded || optionalLoading) return;
    optionalLoading = true;

    const button = document.getElementById("v605AdvancedButton");
    if (button) {
      button.disabled = true;
      button.textContent = "Loading tools…";
    }

    await loadSequentially(OPTIONAL_SCRIPTS);

    optionalLoaded = true;
    optionalLoading = false;

    if (button) {
      button.textContent = "Advanced tools loaded";
    }
  }

  function installAdvancedButton() {
    if (!coreLoaded || optionalLoaded) return;

    const actions = document.querySelector(
      ".arena-game-topbar .arena-top-actions"
    );

    if (!actions || document.getElementById("v605AdvancedButton")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "v605AdvancedButton";
    button.className = "arena-hotfix-control v605-advanced-button";
    button.textContent = "Load advanced tools";
    button.addEventListener("click", loadOptional);
    actions.appendChild(button);
  }

  function gameVisible() {
    return Boolean(
      document.body.classList.contains("in-game") ||
      document.querySelector(".arena-game-shell, .arena-stage, [data-game-room]")
    );
  }

  function inspectPage() {
    installRecoveryCard();

    if (gameVisible()) {
      loadCore();
      installAdvancedButton();
    }
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-v605-resume]")) {
      restoreAndResume();
      return;
    }

    if (event.target.closest("[data-v605-forget]")) {
      clearBackup();
      document.getElementById("v605RecoveryCard")?.remove();
    }
  });

  const observer = new MutationObserver(() => {
    clearTimeout(inspectTimer);
    inspectTimer = setTimeout(inspectPage, 150);
  });

  observer.observe(document.getElementById("app") || document.body, {
    childList: true,
    subtree: true
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inspectPage, { once: true });
  } else {
    inspectPage();
  }

  window.ArenaCommanderV605 = {
    version: VERSION,
    loadCore,
    loadAdvancedTools: loadOptional
  };
})();
