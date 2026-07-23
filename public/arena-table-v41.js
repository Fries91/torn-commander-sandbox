(() => {
  "use strict";

  const VERSION = "41.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const UI_KEY = "arenaCommander.table.v41";
  const helperSocket = typeof io === "function"
    ? io({ transports: ["websocket", "polling"] })
    : null;

  let updateTimer = null;
  let actionSheetCard = null;

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  function session() {
    const value = readJson(SESSION_KEY, null);
    if (!value?.roomCode || !value?.playerId || !value?.sessionToken) return null;
    return value;
  }

  function preferences() {
    return {
      quickActions: true,
      enlargedCards: true,
      ...readJson(UI_KEY, {})
    };
  }

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function toast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const element = document.createElement("div");
    element.className = `toast ${type}`;
    element.textContent = message;
    region.appendChild(element);
    window.setTimeout(() => element.remove(), 4200);
  }

  function currentPhase() {
    const active = document.querySelector(".arena-phase.is-current");
    if (!active) return "";
    return clean(active.textContent.replace(/^\d+/, "")).toLocaleLowerCase("en-US");
  }

  function mySeat() {
    return document.querySelector(".arena-seat.is-self");
  }

  function isMyTurn() {
    return Boolean(mySeat()?.classList.contains("is-active"));
  }

  function hasPriority() {
    return Boolean(mySeat()?.classList.contains("has-priority"));
  }

  function stackCount() {
    const label = document.querySelector(".center-stack:not(.empty) span")?.textContent || "";
    const match = label.match(/(\d+)/);
    if (match) return Number(match[1]);
    return document.querySelectorAll(".arena-stack-item").length;
  }

  function roomCode() {
    return clean(document.querySelector(".room-pill")?.textContent);
  }

  function emitGameAction(action) {
    const auth = session();
    if (!helperSocket || !auth) {
      return Promise.resolve({ success: false, error: "No active Arena Commander session." });
    }

    return new Promise((resolve) => {
      let finished = false;
      const timeout = window.setTimeout(() => {
        if (finished) return;
        finished = true;
        resolve({ success: false, error: "The table did not respond." });
      }, 12000);

      helperSocket.emit("game-action", { ...auth, action }, (response) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timeout);
        resolve(response || { success: false, error: "No response received." });
      });
    });
  }

  function proxyClick(dataset) {
    const button = document.createElement("button");
    button.type = "button";
    button.hidden = true;
    button.dataset.v41Forward = "1";
    for (const [key, value] of Object.entries(dataset)) {
      if (value != null) button.dataset[key] = String(value);
    }
    document.body.appendChild(button);
    button.click();
    button.remove();
  }

  function revealImages(root = document) {
    for (const image of root.querySelectorAll(".arena-card-image img")) {
      image.classList.add("is-visible");
      image.loading = "eager";
      image.style.opacity = "1";
    }
  }

  function labelCard(card) {
    const type = clean(card.querySelector(".arena-card-type")?.textContent).toLocaleLowerCase("en-US");
    card.classList.toggle("v41-land", /\bland\b/.test(type));
    card.classList.toggle("v41-creature", /\bcreature\b/.test(type));
    card.classList.toggle("v41-instant", /\binstant\b/.test(type));
    card.classList.toggle("v41-sorcery", /\bsorcery\b/.test(type));
    card.classList.toggle("v41-permanent", /\b(artifact|battle|creature|enchantment|land|planeswalker)\b/.test(type));
    card.dataset.v41Type = type;
  }

  function upgradeCards(root = document) {
    revealImages(root);
    for (const card of root.querySelectorAll(".arena-card")) labelCard(card);
  }

  function primaryActionState() {
    const phase = currentPhase();
    const myTurn = isMyTurn();
    const priority = hasPriority();
    const count = stackCount();

    if (!priority) {
      return {
        label: "WAIT",
        detail: "Opponent has priority",
        disabled: true,
        action: null,
        tone: "waiting"
      };
    }

    if (count > 0) {
      return {
        label: "PASS",
        detail: "Pass priority",
        disabled: false,
        action: { action: "game", gameType: "pass-priority" },
        tone: "priority"
      };
    }

    if (!myTurn) {
      return {
        label: "PASS",
        detail: "No response",
        disabled: false,
        action: { action: "game", gameType: "pass-priority" },
        tone: "priority"
      };
    }

    if (phase.includes("cleanup")) {
      return {
        label: "END",
        detail: "End turn",
        disabled: false,
        action: { action: "game", gameType: "end-turn" },
        tone: "end"
      };
    }

    const guidance =
      phase.includes("main") ? "Play a land or cast a spell" :
      phase.includes("attack") ? "Choose attackers first" :
      phase.includes("block") ? "Choose blockers first" :
      phase.includes("combat damage") ? "Resolve combat damage" :
      "Advance phase";

    return {
      label: "NEXT",
      detail: guidance,
      disabled: false,
      action: { action: "game", gameType: "next-phase" },
      tone: "next"
    };
  }

  function promptMessage() {
    const phase = currentPhase();
    const count = stackCount();

    if (hasPriority() && count > 0) return "Respond to the stack or pass priority.";
    if (!isMyTurn()) return hasPriority() ? "You may respond at instant speed." : "Waiting for the active player.";
    if (phase.includes("main")) return "Tap a card in your hand to play or cast it.";
    if (phase.includes("attack")) return "Tap one of your creatures to attack.";
    if (phase.includes("block")) return "Tap a creature, then choose what it blocks.";
    if (phase.includes("combat damage")) return "Confirm combat damage, then continue.";
    if (phase.includes("end")) return "Use abilities now or continue to cleanup.";
    return "Continue when you are ready.";
  }

  function installPrompt() {
    const shell = document.querySelector(".arena-game-shell");
    if (!shell) return;

    let prompt = shell.querySelector("#arenaV41Prompt");
    if (!prompt) {
      prompt = document.createElement("section");
      prompt.id = "arenaV41Prompt";
      prompt.className = "arena-v41-prompt";
      prompt.innerHTML = `
        <div class="arena-v41-guidance">
          <span class="arena-v41-phase-name"></span>
          <strong class="arena-v41-message"></strong>
        </div>
        <button type="button" class="arena-v41-primary-action">
          <span></span><small></small>
        </button>`;
      shell.appendChild(prompt);
    }

    const state = primaryActionState();
    prompt.dataset.tone = state.tone;
    prompt.querySelector(".arena-v41-phase-name").textContent =
      currentPhase().toUpperCase() || "GAME";
    prompt.querySelector(".arena-v41-message").textContent = promptMessage();

    const button = prompt.querySelector(".arena-v41-primary-action");
    button.disabled = state.disabled;
    button.querySelector("span").textContent = state.label;
    button.querySelector("small").textContent = state.detail;
    button.dataset.proxyAction = state.action?.action || "";
    button.dataset.proxyGameType = state.action?.gameType || "";
  }

  function removeActionSheet() {
    document.getElementById("arenaV41CardSheet")?.remove();
    actionSheetCard = null;
  }

  function cardInfo(cardElement) {
    const article = cardElement.closest(".arena-card");
    if (!article) return null;
    return {
      article,
      cardId: article.dataset.cardId,
      zone: article.dataset.zone,
      ownerId: article.dataset.ownerId,
      canControl: article.dataset.canControl === "1",
      name: clean(article.querySelector(".arena-card-frame header strong")?.textContent || "Card"),
      type: clean(article.querySelector(".arena-card-type")?.textContent || "Card"),
      image: article.querySelector(".arena-card-image img")?.src || "",
      tapped: article.classList.contains("is-tapped"),
      sick: Boolean(article.querySelector(".sick-badge"))
    };
  }

  function opponentSeats() {
    return [...document.querySelectorAll(".arena-seat.is-opponent[data-player-seat-id]")]
      .map((seat) => ({
        id: seat.dataset.playerSeatId,
        name: clean(seat.querySelector(".seat-name strong")?.textContent || "Opponent")
      }))
      .filter((entry) => entry.id);
  }

  function openOpponentChooser(card) {
    removeActionSheet();
    const opponents = opponentSeats();
    if (!opponents.length) return toast("No legal opponent is visible.", "warning");

    const overlay = document.createElement("div");
    overlay.id = "arenaV41CardSheet";
    overlay.className = "arena-v41-card-sheet";
    overlay.innerHTML = `
      <section>
        <header><div><small>DECLARE ATTACKER</small><h2>${escapeHtml(card.name)}</h2></div><button type="button" data-v41-close>×</button></header>
        <p>Choose the player this creature attacks.</p>
        <div class="arena-v41-choice-grid">
          ${opponents.map((opponent) => `<button type="button" data-v41-attack-player="${escapeHtml(opponent.id)}"><span>⚔</span><strong>${escapeHtml(opponent.name)}</strong></button>`).join("")}
        </div>
      </section>`;
    overlay.dataset.cardId = card.cardId;
    document.body.appendChild(overlay);
  }

  function cardActionButtons(card) {
    const phase = currentPhase();
    const mainPhase = isMyTurn() && hasPriority() && phase.includes("main");
    const attackPhase = isMyTurn() && hasPriority() && phase.includes("attack");
    const isLand = /\bland\b/i.test(card.type);
    const isCreature = /\bcreature\b/i.test(card.type);

    const actions = [];

    if (card.zone === "hand" && card.canControl && mainPhase) {
      if (isLand) {
        actions.push(`<button type="button" class="arena-v41-action-primary" data-v41-play-land><span>⬇</span><strong>Play land</strong><small>Move directly to battlefield</small></button>`);
      } else {
        actions.push(`<button type="button" class="arena-v41-action-primary" data-v41-cast><span>✦</span><strong>Cast spell</strong><small>Choose mana, modes and targets</small></button>`);
      }
    }

    if (card.zone === "battlefield" && card.canControl && attackPhase && isCreature) {
      actions.push(`<button type="button" class="arena-v41-action-primary" data-v41-attack><span>⚔</span><strong>Attack</strong><small>Choose a defending player</small></button>`);
    }

    if (card.zone === "battlefield" && card.canControl) {
      actions.push(`<button type="button" data-v41-tap><span>${card.tapped ? "↶" : "↷"}</span><strong>${card.tapped ? "Untap" : "Tap"}</strong><small>Change permanent state</small></button>`);
    }

    actions.push(`<button type="button" data-v41-view><span>⌕</span><strong>Card details</strong><small>Rules text and all actions</small></button>`);
    return actions.join("");
  }

  function openCardSheet(card) {
    removeActionSheet();
    actionSheetCard = card;

    const overlay = document.createElement("div");
    overlay.id = "arenaV41CardSheet";
    overlay.className = "arena-v41-card-sheet";
    overlay.innerHTML = `
      <section>
        <header>
          <div><small>${escapeHtml(card.type)}</small><h2>${escapeHtml(card.name)}</h2></div>
          <button type="button" data-v41-close>×</button>
        </header>
        <div class="arena-v41-card-sheet-body">
          ${card.image ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}">` : `<div class="arena-v41-card-back">♛</div>`}
          <div class="arena-v41-card-actions">${cardActionButtons(card)}</div>
        </div>
      </section>`;
    document.body.appendChild(overlay);
  }

  function shouldUseQuickSheet(card) {
    if (!preferences().quickActions || !card?.canControl) return false;
    if (card.zone === "hand") return true;
    if (card.zone === "battlefield" && isMyTurn() && currentPhase().includes("attack")) return true;
    return false;
  }

  function forwardView(card) {
    proxyClick({
      action: "open-card",
      cardId: card.cardId,
      zone: card.zone,
      ownerId: card.ownerId,
      canControl: card.canControl ? "1" : "0"
    });
  }

  function updateArena() {
    document.documentElement.classList.add("arena-v41");
    upgradeCards();
    installPrompt();

    const shell = document.querySelector(".arena-game-shell");
    document.body.classList.toggle("arena-v41-active", Boolean(shell));
    if (shell) shell.dataset.arenaVersion = VERSION;
  }

  function scheduleUpdate() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateArena, 20);
  }

  document.addEventListener("click", async (event) => {
    const forwarded = event.target.closest("[data-v41-forward='1']");
    if (forwarded) return;

    const promptButton = event.target.closest(".arena-v41-primary-action");
    if (promptButton) {
      event.preventDefault();
      event.stopPropagation();
      if (promptButton.disabled) return;
      proxyClick({
        action: promptButton.dataset.proxyAction,
        gameType: promptButton.dataset.proxyGameType
      });
      return;
    }

    if (event.target.closest("[data-v41-close]")) {
      event.preventDefault();
      removeActionSheet();
      return;
    }

    const attackPlayer = event.target.closest("[data-v41-attack-player]");
    if (attackPlayer) {
      event.preventDefault();
      const overlay = attackPlayer.closest("#arenaV41CardSheet");
      const cardId = overlay?.dataset.cardId;
      const defenderPlayerId = attackPlayer.dataset.v41AttackPlayer;
      removeActionSheet();
      proxyClick({
        action: "declare-attacker",
        cardId,
        defenderPlayerId
      });
      return;
    }

    if (event.target.closest("[data-v41-play-land]") && actionSheetCard) {
      event.preventDefault();
      const card = actionSheetCard;
      removeActionSheet();
      proxyClick({
        action: "move-card",
        cardId: card.cardId,
        fromZone: card.zone,
        toZone: "battlefield"
      });
      return;
    }

    if (event.target.closest("[data-v41-cast]") && actionSheetCard) {
      event.preventDefault();
      const card = actionSheetCard;
      removeActionSheet();
      proxyClick({
        action: "open-cast-card",
        cardId: card.cardId,
        fromZone: card.zone
      });
      return;
    }

    if (event.target.closest("[data-v41-attack]") && actionSheetCard) {
      event.preventDefault();
      const card = actionSheetCard;
      const opponents = opponentSeats();
      if (opponents.length === 1) {
        removeActionSheet();
        proxyClick({
          action: "declare-attacker",
          cardId: card.cardId,
          defenderPlayerId: opponents[0].id
        });
      } else {
        openOpponentChooser(card);
      }
      return;
    }

    if (event.target.closest("[data-v41-tap]") && actionSheetCard) {
      event.preventDefault();
      const card = actionSheetCard;
      removeActionSheet();
      proxyClick({
        action: "card-game",
        gameType: "tap-card",
        cardId: card.cardId
      });
      return;
    }

    if (event.target.closest("[data-v41-view]") && actionSheetCard) {
      event.preventDefault();
      const card = actionSheetCard;
      removeActionSheet();
      forwardView(card);
      return;
    }

    const cardElement = event.target.closest(".arena-card");
    if (cardElement) {
      const card = cardInfo(cardElement);
      if (shouldUseQuickSheet(card)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        openCardSheet(card);
      }
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") removeActionSheet();
  });

  const observer = new MutationObserver(scheduleUpdate);
  const app = document.getElementById("app");
  if (app) observer.observe(app, { childList: true, subtree: true });
  const modalBody = document.getElementById("modalBody");
  if (modalBody) observer.observe(modalBody, { childList: true, subtree: true });

  window.addEventListener("load", scheduleUpdate, { once: true });
  window.addEventListener("resize", scheduleUpdate);
  scheduleUpdate();

  window.ArenaCommanderTableV41 = {
    version: VERSION,
    update: updateArena,
    preferences,
    setPreferences(patch) {
      writeJson(UI_KEY, { ...preferences(), ...patch });
      scheduleUpdate();
    },
    emitGameAction
  };
})();
