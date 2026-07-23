(() => {
  "use strict";

  const app = document.getElementById("app");
  const bottomNav = document.getElementById("bottomNav");
  const fullscreenButton = document.getElementById("fullscreenButton");
  if (!app) return;

  const actionDetails = [
    { id: "host", icon: "✦", title: "Host Game", text: "Create a private 2–6 player table." },
    { id: "join", icon: "↗", title: "Join Game", text: "Enter a room code and take your seat." },
    { id: "test", icon: "⚔", title: "Test Lab", text: "Play your deck against an AI opponent." },
    { id: "watch", icon: "◉", title: "Watch", text: "Spectate a live Commander table." }
  ];

  let syncQueued = false;

  function queueSync() {
    if (syncQueued) return;
    syncQueued = true;
    window.requestAnimationFrame(() => {
      syncQueued = false;
      syncInterface();
    });
  }

  function isHomeScreen() {
    return Boolean(
      document.getElementById("createRoomForm") &&
      document.getElementById("joinRoomForm") &&
      document.getElementById("spectatorForm") &&
      !app.querySelector(".lobby-top, .arena-shell, .rolloff-hero")
    );
  }

  function updatePersistentNavigation() {
    const gameButton = bottomNav?.querySelector('[data-nav="game"]');
    if (gameButton) gameButton.innerHTML = "<span>♛</span>Play";
  }

  function createActionButton(action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "clean-launch-card";
    button.dataset.cleanPanel = action.id;
    button.setAttribute("aria-controls", `clean-pane-${action.id}`);
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `
      <span class="clean-launch-icon" aria-hidden="true">${action.icon}</span>
      <span class="clean-launch-copy"><strong>${action.title}</strong><small>${action.text}</small></span>
      <span class="clean-launch-arrow" aria-hidden="true">›</span>
    `;
    return button;
  }

  function createPane(id, content) {
    const pane = document.createElement("section");
    pane.id = `clean-pane-${id}`;
    pane.className = "clean-action-pane";
    pane.dataset.cleanPane = id;
    pane.hidden = true;

    const close = document.createElement("button");
    close.type = "button";
    close.className = "clean-pane-close";
    close.dataset.cleanClose = "1";
    close.setAttribute("aria-label", "Close section");
    close.textContent = "×";

    pane.append(close, content);
    return pane;
  }

  function simplifyForm(form, eyebrow, title) {
    form.classList.add("clean-form-panel");
    const eyebrowNode = form.querySelector(":scope > .eyebrow");
    const titleNode = form.querySelector(":scope > h2");
    if (eyebrowNode) eyebrowNode.textContent = eyebrow;
    if (titleNode) titleNode.textContent = title;
  }

  function simplifyTestPanel(testPanel) {
    testPanel.classList.add("clean-test-panel");
    const heading = testPanel.querySelector(".section-heading");
    const eyebrow = heading?.querySelector(".eyebrow");
    const title = heading?.querySelector("h2");
    const description = heading?.querySelector("p:not(.eyebrow)");
    if (eyebrow) eyebrow.textContent = "Solo practice";
    if (title) title.textContent = "Test your deck against AI";
    if (description) description.textContent = "Choose two decks and start a private practice match.";
  }

  function enhanceDeckPanel(panel) {
    if (!panel) return;
    panel.classList.add("clean-decks-panel");
    const eyebrow = panel.querySelector(".eyebrow");
    const title = panel.querySelector("h2");
    if (eyebrow) eyebrow.textContent = "Deck library";
    if (title) title.textContent = "Your Commander decks";

    const buttonRow = panel.querySelector(".section-heading .button-row");
    if (buttonRow && !buttonRow.querySelector("[data-clean-open-decks]")) {
      const openDecks = document.createElement("button");
      openDecks.type = "button";
      openDecks.className = "secondary-button";
      openDecks.dataset.cleanOpenDecks = "1";
      openDecks.textContent = "Open decks";
      buttonRow.prepend(openDecks);
    }
  }

  function enhanceHero(hero) {
    if (!hero) return;
    hero.classList.add("clean-hero");
    hero.innerHTML = `
      <div class="clean-hero-copy">
        <p class="eyebrow">Arena Commander • 2–6 players</p>
        <h1>Choose how you want to play.</h1>
        <p>Host, join, practise against AI, or watch a table.</p>
      </div>
      <div class="clean-hero-badge" aria-hidden="true"><span>♛</span><small>v35</small></div>
    `;
  }

  function applyHomeCleanup() {
    if (app.dataset.cleanHomeApplied === "1") return;

    const hostForm = document.getElementById("createRoomForm");
    const joinForm = document.getElementById("joinRoomForm");
    const watchForm = document.getElementById("spectatorForm");
    const homeGrid = hostForm?.closest(".home-grid");
    const testPanel = app.querySelector(".ai-test-lab-panel");
    const hero = app.querySelector(".arena-hero");

    if (!hostForm || !joinForm || !watchForm || !homeGrid || !testPanel || !hero) return;

    app.dataset.cleanHomeApplied = "1";
    document.body.classList.add("clean-home-active");
    fullscreenButton?.setAttribute("tabindex", "-1");

    enhanceHero(hero);
    simplifyForm(hostForm, "Private room", "Host a game");
    simplifyForm(joinForm, "Room code", "Join a game");
    simplifyForm(watchForm, "Spectator", "Watch a table");
    simplifyTestPanel(testPanel);

    const launcher = document.createElement("section");
    launcher.className = "clean-launcher";
    launcher.innerHTML = `
      <div class="clean-section-heading">
        <div><p class="eyebrow">Quick play</p><h2>What would you like to do?</h2></div>
        <span class="clean-online-pill"><i></i> Ready</span>
      </div>
      <div class="clean-launch-grid"></div>
    `;
    const launchGrid = launcher.querySelector(".clean-launch-grid");
    actionDetails.forEach((action) => launchGrid.appendChild(createActionButton(action)));

    const panes = document.createElement("div");
    panes.className = "clean-panes";
    panes.append(
      createPane("host", hostForm),
      createPane("join", joinForm),
      createPane("test", testPanel),
      createPane("watch", watchForm)
    );

    homeGrid.replaceWith(launcher, panes);

    const directPanels = [...app.children].filter((node) => node.matches?.("section.panel"));
    const deckPanel = directPanels.find((panel) => panel.querySelector(".deck-grid") || panel.textContent.includes("My decks"));
    enhanceDeckPanel(deckPanel);

    app.querySelectorAll(".notice-row").forEach((notice) => notice.classList.add("clean-resume-card"));
    updatePersistentNavigation();
  }

  function removeHomeMode() {
    document.body.classList.remove("clean-home-active");
    app.removeAttribute("data-clean-home-applied");
    fullscreenButton?.removeAttribute("tabindex");
  }

  function syncInterface() {
    updatePersistentNavigation();
    if (isHomeScreen()) applyHomeCleanup();
    else removeHomeMode();
  }

  function togglePane(id) {
    const panes = [...app.querySelectorAll("[data-clean-pane]")];
    const buttons = [...app.querySelectorAll("[data-clean-panel]")];
    const target = panes.find((pane) => pane.dataset.cleanPane === id);
    if (!target) return;

    const willOpen = target.hidden;
    panes.forEach((pane) => { pane.hidden = true; });
    buttons.forEach((button) => {
      button.classList.remove("is-active");
      button.setAttribute("aria-expanded", "false");
    });

    if (willOpen) {
      target.hidden = false;
      const activeButton = buttons.find((button) => button.dataset.cleanPanel === id);
      activeButton?.classList.add("is-active");
      activeButton?.setAttribute("aria-expanded", "true");
      window.setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
      window.setTimeout(() => target.querySelector("input, select, button[type='submit']")?.focus({ preventScroll: true }), 260);
    }
  }

  app.addEventListener("click", (event) => {
    const launcher = event.target.closest("[data-clean-panel]");
    if (launcher) {
      event.preventDefault();
      togglePane(launcher.dataset.cleanPanel);
      return;
    }

    if (event.target.closest("[data-clean-close]")) {
      event.preventDefault();
      const pane = event.target.closest("[data-clean-pane]");
      if (pane) togglePane(pane.dataset.cleanPane);
      return;
    }

    if (event.target.closest("[data-clean-open-decks]")) {
      event.preventDefault();
      bottomNav?.querySelector('[data-nav="decks"]')?.click();
    }
  });

  const observer = new MutationObserver(queueSync);
  observer.observe(app, { childList: true });
  queueSync();
})();
