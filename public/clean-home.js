(() => {
  "use strict";

  const app = document.getElementById("app");
  const bottomNav = document.getElementById("bottomNav");
  if (!app) return;

  let syncQueued = false;

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      syncInterface();
    });
  }

  function setPlayLabel() {
    const gameButton = bottomNav?.querySelector('[data-nav="game"]');
    if (gameButton && !gameButton.textContent.includes("Play")) {
      gameButton.innerHTML = "<span>♛</span>Play";
    }
  }

  function homePanels() {
    return [...app.querySelectorAll("[data-home-panel]")];
  }

  function homeLaunchers() {
    return [...app.querySelectorAll("[data-home-panel-target]")];
  }

  function closePanels() {
    homePanels().forEach((panel) => { panel.hidden = true; });
    homeLaunchers().forEach((button) => {
      button.classList.remove("is-active");
      button.setAttribute("aria-expanded", "false");
    });
  }

  function openPanel(name) {
    const panel = app.querySelector(`[data-home-panel="${CSS.escape(name)}"]`);
    if (!panel) return;
    const wasHidden = panel.hidden;
    closePanels();
    if (!wasHidden) return;

    panel.hidden = false;
    const launcher = app.querySelector(`[data-home-panel-target="${CSS.escape(name)}"]`);
    launcher?.classList.add("is-active");
    launcher?.setAttribute("aria-expanded", "true");
    setTimeout(() => panel.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
    setTimeout(() => panel.querySelector("input, select, button[type='submit']")?.focus({ preventScroll: true }), 250);
  }

  function updateTestLabFormat(form) {
    if (!form) return;
    const format = form.elements.format?.value || "commander";
    const life = form.elements.startingLife;
    if (!life) return;

    const customRules = form.querySelector("[data-test-custom-rules]");
    if (format === "commander") {
      life.value = "40";
      life.disabled = true;
      life.closest("label")?.classList.add("is-locked-setting");
      if (customRules) customRules.hidden = true;
    } else if (format === "brawl") {
      life.value = "25";
      life.disabled = true;
      life.closest("label")?.classList.add("is-locked-setting");
      if (customRules) customRules.hidden = true;
    } else {
      life.disabled = false;
      life.closest("label")?.classList.remove("is-locked-setting");
      if (customRules) customRules.hidden = false;
      updateCustomPlayerRules(form);
    }
  }

  function updateCustomPlayerRules(form) {
    if (!form) return;
    const prefix = form.id === "createTestLabForm" ? "test" : "";
    const style = form.elements[`${prefix}playStyle`]?.value || "free-for-all";
    const maxPlayers = form.elements.maxPlayers;

    const allowed = style === "duel"
      ? [2]
      : style === "teams"
        ? [4, 6]
        : ["archenemy", "limited-range"].includes(style)
          ? [3, 4, 5, 6]
          : [2, 3, 4, 5, 6];

    if (maxPlayers) {
      [...maxPlayers.options].forEach((option) => {
        option.disabled = !allowed.includes(Number(option.value));
      });
      if (!allowed.includes(Number(maxPlayers.value))) maxPlayers.value = String(allowed[0]);
    }

    const commanderDamage = form.elements[`${prefix}commanderDamageEnabled`];
    const commanderThreshold = form.elements[`${prefix}commanderDamageThreshold`];
    if (commanderThreshold) commanderThreshold.disabled = Boolean(commanderDamage && !commanderDamage.checked);

    const officialBans = form.elements[`${prefix}useOfficialBannedList`];
    const allowedBans = form.elements[`${prefix}allowedBannedCards`];
    if (allowedBans) allowedBans.disabled = Boolean(officialBans && !officialBans.checked);

    const singleton = form.elements[`${prefix}singleton`];
    const maxCopies = form.elements[`${prefix}maxCopies`];
    if (maxCopies) maxCopies.disabled = Boolean(singleton?.checked);
  }

  function syncInterface() {
    setPlayLabel();
    document.body.classList.toggle("format-home-active", Boolean(app.querySelector(".format-home-hero")));

    app.querySelectorAll("#createTestLabForm").forEach(updateTestLabFormat);
    app.querySelectorAll("#createCustomRoomForm, #roomSettingsForm").forEach(updateCustomPlayerRules);

    homeLaunchers().forEach((button) => {
      button.setAttribute("aria-controls", `format-panel-${button.dataset.homePanelTarget}`);
      button.setAttribute("aria-expanded", String(button.classList.contains("is-active")));
    });
    homePanels().forEach((panel) => {
      panel.id ||= `format-panel-${panel.dataset.homePanel}`;
    });
  }

  app.addEventListener("click", (event) => {
    const launcher = event.target.closest("[data-home-panel-target]");
    if (launcher) {
      event.preventDefault();
      openPanel(launcher.dataset.homePanelTarget);
      return;
    }

    if (event.target.closest("[data-home-panel-close]")) {
      event.preventDefault();
      closePanels();
      app.querySelector(".format-launch-grid")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const navButton = event.target.closest("button[data-nav]");
    if (navButton && navButton.closest(".compact-deck-panel")) {
      event.preventDefault();
      bottomNav?.querySelector(`[data-nav="${CSS.escape(navButton.dataset.nav)}"]`)?.click();
    }
  });

  app.addEventListener("change", (event) => {
    const form = event.target.closest("form");
    if (!form) return;
    if (form.id === "createTestLabForm" && event.target.name === "format") updateTestLabFormat(form);
    if (["createCustomRoomForm", "roomSettingsForm"].includes(form.id) || (form.id === "createTestLabForm" && form.elements.format?.value === "custom")) updateCustomPlayerRules(form);
  });

  const observer = new MutationObserver(queueSync);
  observer.observe(app, { childList: true, subtree: false });
  queueSync();
})();
