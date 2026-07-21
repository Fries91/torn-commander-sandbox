(() => {
  "use strict";

  const STORAGE = {
    decks: "tornCommander.decks.v5",
    session: "tornCommander.session.v5",
    playerName: "tornCommander.playerName.v5"
  };

  const app = document.getElementById("app");
  const bottomNav = document.getElementById("bottomNav");
  const connectionStatus = document.getElementById("connectionStatus");
  const connectionText = document.getElementById("connectionText");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalTitle = document.getElementById("modalTitle");
  const modalBody = document.getElementById("modalBody");
  const toastRegion = document.getElementById("toastRegion");
  const installButton = document.getElementById("installButton");
  const brandButton = document.getElementById("brandButton");

  const state = {
    view: "home",
    room: null,
    session: loadJson(STORAGE.session, null),
    decks: loadJson(STORAGE.decks, []),
    activeGameTab: "table",
    reconnecting: false,
    deferredInstallPrompt: null,
    toolResult: "—",
    chatDraft: "",
    tokenDraft: { name: "Soldier", power: "1", toughness: "1" }
  };

  const socket = io({ transports: ["websocket", "polling"] });

  function loadJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value === null ? fallback : value;
    } catch (error) {
      console.warn(`Unable to read ${key}`, error);
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function playerName() {
    return localStorage.getItem(STORAGE.playerName) || "";
  }

  function rememberPlayerName(name) {
    localStorage.setItem(STORAGE.playerName, String(name || "").trim());
  }

  function uid() {
    if (crypto && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    return `deck-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3600);
  }

  function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalBackdrop.classList.remove("is-hidden");
    modalBackdrop.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    const firstInput = modalBody.querySelector("input, textarea, select, button");
    window.setTimeout(() => firstInput && firstInput.focus(), 30);
  }

  function closeModal() {
    modalBackdrop.classList.add("is-hidden");
    modalBackdrop.setAttribute("aria-hidden", "true");
    modalBody.innerHTML = "";
    document.body.style.overflow = "";
  }

  function authPayload(extra = {}) {
    return {
      roomCode: state.session && state.session.roomCode,
      playerId: state.session && state.session.playerId,
      sessionToken: state.session && state.session.sessionToken,
      ...extra
    };
  }

  function emitAck(eventName, payload = {}, includeAuth = true) {
    return new Promise((resolve) => {
      let finished = false;
      const timer = window.setTimeout(() => {
        if (finished) return;
        finished = true;
        resolve({ success: false, error: "The server did not respond. Check your connection." });
      }, 12000);

      socket.emit(eventName, includeAuth ? authPayload(payload) : payload, (response) => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        resolve(response || { success: false, error: "No response received." });
      });
    });
  }

  function setSession(response) {
    state.session = {
      roomCode: response.room.code,
      playerId: response.playerId,
      sessionToken: response.sessionToken
    };
    saveJson(STORAGE.session, state.session);
    state.room = response.room;
    state.view = "game";
  }

  function clearSession() {
    state.session = null;
    state.room = null;
    localStorage.removeItem(STORAGE.session);
    state.view = "home";
    state.activeGameTab = "table";
  }

  function currentPlayer() {
    if (!state.room || !state.session) return null;
    return state.room.players.find((player) => player.id === state.session.playerId) || null;
  }

  function isHost() {
    return Boolean(state.room && state.session && state.room.hostId === state.session.playerId);
  }

  function deckById(id) {
    return state.decks.find((deck) => deck.id === id) || null;
  }

  function saveDecks() {
    saveJson(STORAGE.decks, state.decks);
  }

  function setConnection(mode, text) {
    connectionStatus.className = `connection-status ${mode}`;
    connectionText.textContent = text;
  }

  function persistenceBadge() {
    const persistence = state.room && state.room.persistence;
    if (persistence && persistence.ready && persistence.mode === "postgresql") {
      return `<span class="badge success" title="This room is automatically saved to PostgreSQL after every change.">☁ Database autosave</span>`;
    }
    return `<span class="badge warning" title="This room is currently using temporary server memory.">⚠ Temporary memory</span>`;
  }

  function setActiveNav(name) {
    bottomNav.querySelectorAll("[data-nav]").forEach((button) => {
      button.classList.toggle("active", button.dataset.nav === name);
    });
  }

  function render() {
    if (state.room) {
      setActiveNav("game");
      app.innerHTML = state.room.status === "waiting" ? renderLobby() : renderGame();
    } else if (state.view === "decks") {
      setActiveNav("decks");
      app.innerHTML = renderDecks();
    } else if (state.view === "help") {
      setActiveNav("help");
      app.innerHTML = renderHelp();
    } else {
      setActiveNav("home");
      app.innerHTML = renderHome();
    }

    if (state.room && state.room.status === "started" && state.activeGameTab === "chat") {
      window.requestAnimationFrame(() => {
        const messages = document.querySelector(".chat-messages");
        if (messages) messages.scrollTop = messages.scrollHeight;
      });
    }
  }

  function renderHome() {
    const savedRoom = state.session && state.session.roomCode;
    const deckPreview = state.decks.slice(0, 3).map(renderDeckCard).join("");
    return `
      <section class="hero-panel">
        <div class="hero-content">
          <p class="eyebrow">MTG Commander • 2–6 Players</p>
          <h1>Your complete shared Commander table.</h1>
          <p class="hero-copy">Import decks, create a private room, track life and commander damage, move cards between zones, create tokens, chat and reconnect from your phone.</p>
        </div>
      </section>

      ${savedRoom ? `
        <section class="rejoin-banner">
          <div class="section-heading">
            <div>
              <strong>Saved room ${escapeHtml(savedRoom)}</strong>
              <p class="form-help">Your browser has a reconnect session for this room.</p>
            </div>
            <div class="button-row">
              <button class="primary-button" type="button" data-action="rejoin">Rejoin</button>
              <button class="ghost-button" type="button" data-action="forget-session">Forget</button>
            </div>
          </div>
        </section>
      ` : ""}

      <section class="home-actions">
        <form id="createRoomForm" class="panel">
          <div class="panel-heading">
            <div><p class="eyebrow">Host</p><h2>Create game</h2></div>
            <span class="badge info">Private code</span>
          </div>
          <div class="form-group">
            <label for="createPlayerName">Player name</label>
            <input id="createPlayerName" name="playerName" maxlength="24" required value="${escapeHtml(playerName())}" placeholder="Fries91">
          </div>
          <div class="form-grid two">
            <div class="form-group">
              <label for="createMaxPlayers">Players</label>
              <select id="createMaxPlayers" name="maxPlayers">
                ${[2,3,4,5,6].map((number) => `<option value="${number}" ${number === 6 ? "selected" : ""}>${number}</option>`).join("")}
              </select>
            </div>
            <div class="form-group">
              <label for="createStartingLife">Starting life</label>
              <select id="createStartingLife" name="startingLife">
                ${[20,30,40,50,60].map((number) => `<option value="${number}" ${number === 40 ? "selected" : ""}>${number}</option>`).join("")}
              </select>
            </div>
          </div>
          <button class="primary-button" type="submit">Create private room</button>
        </form>

        <form id="joinRoomForm" class="panel">
          <div class="panel-heading">
            <div><p class="eyebrow">Guest</p><h2>Join game</h2></div>
            <span class="badge">6-character code</span>
          </div>
          <div class="form-group">
            <label for="joinPlayerName">Player name</label>
            <input id="joinPlayerName" name="playerName" maxlength="24" required value="${escapeHtml(playerName())}" placeholder="Your Torn name">
          </div>
          <div class="form-group">
            <label for="joinRoomCode">Room code</label>
            <input id="joinRoomCode" name="roomCode" maxlength="6" required autocomplete="off" autocapitalize="characters" placeholder="ABC234">
          </div>
          <button class="secondary-button" type="submit">Join room</button>
        </form>
      </section>

      <section class="panel">
        <div class="section-heading">
          <div><p class="eyebrow">Saved locally</p><h2>My decks</h2></div>
          <div class="button-row">
            <button class="primary-button" type="button" data-action="import-deck">Import deck</button>
            <button class="ghost-button" type="button" data-nav="decks">View all</button>
          </div>
        </div>
        ${state.decks.length ? `<div class="deck-grid">${deckPreview}</div>` : `
          <div class="empty-state">
            <div><h3>No decks imported yet</h3><p>Paste a deck list from Moxfield, Archidekt, MTGGoldfish or a plain text list.</p><button class="primary-button" type="button" data-action="import-deck">Import your first deck</button></div>
          </div>
        `}
      </section>
    `;
  }

  function renderDecks() {
    return `
      <section class="panel">
        <div class="section-heading">
          <div><p class="eyebrow">Browser deck library</p><h1>My Commander decks</h1><p class="muted">Decks stay on this device until you delete browser storage.</p></div>
          <button class="primary-button" type="button" data-action="import-deck">Import deck</button>
        </div>
        ${state.decks.length ? `<div class="deck-grid">${state.decks.map(renderDeckCard).join("")}</div>` : `
          <div class="empty-state"><div><h3>Your deck library is empty</h3><p>Import a common text deck list to begin.</p><button class="primary-button" type="button" data-action="import-deck">Import deck</button></div></div>
        `}
      </section>
    `;
  }

  function renderDeckCard(deck) {
    const valid = deck.totalCards === 100;
    return `
      <article class="deck-card">
        <div class="deck-card-header">
          <div>
            <h3>${escapeHtml(deck.name)}</h3>
            <p class="deck-commanders">${escapeHtml(deck.commanders.join(" / "))}</p>
          </div>
          <span class="badge ${valid ? "success" : "warning"}">${deck.totalCards} cards</span>
        </div>
        <div class="deck-meta">
          <span class="badge">${deck.uniqueCards} unique</span>
          <span class="badge ${valid ? "success" : "warning"}">${valid ? "Commander ready" : "Sandbox allowed"}</span>
        </div>
        <div class="button-row">
          <button class="small-button" type="button" data-action="edit-deck" data-deck-id="${escapeHtml(deck.id)}">Edit</button>
          <button class="small-button" type="button" data-action="export-deck" data-deck-id="${escapeHtml(deck.id)}">Copy list</button>
          <button class="small-button danger-button" type="button" data-action="delete-deck" data-deck-id="${escapeHtml(deck.id)}">Delete</button>
        </div>
      </article>
    `;
  }

  function renderLobby() {
    const me = currentPlayer();
    const selectedDeckId = me && me.deck ? me.deck.id : "";
    const allReady = state.room.players.length >= 2 && state.room.players.every((player) => player.ready && player.connected && player.deck);

    return `
      <section class="lobby-card">
        <div class="lobby-heading">
          <div>
            <p class="eyebrow">Private Commander lobby</p>
            <h1>Room <span class="room-code">${escapeHtml(state.room.code)}</span></h1>
            <p class="muted">${state.room.players.length}/${state.room.maxPlayers} players • ${state.room.startingLife} starting life</p>
            <div class="button-row" style="margin-top:10px">${persistenceBadge()}</div>
          </div>
          <div class="button-row">
            <button class="secondary-button" type="button" data-action="copy-room-code">Copy code</button>
            <button class="ghost-button" type="button" data-action="leave-room">Leave</button>
          </div>
        </div>
      </section>

      <section class="lobby-layout">
        <div class="lobby-card">
          <div class="panel-heading"><div><p class="eyebrow">Players</p><h2>Ready check</h2></div><span class="badge ${allReady ? "success" : "warning"}">${allReady ? "Ready to start" : "Waiting"}</span></div>
          <div class="player-list">
            ${state.room.players.map((player) => renderLobbyPlayer(player)).join("")}
          </div>
        </div>

        <div class="lobby-card">
          <div class="panel-heading"><div><p class="eyebrow">Your setup</p><h2>Select deck</h2></div></div>
          ${state.decks.length ? `
            <div class="form-group">
              <label for="lobbyDeckSelect">Commander deck</label>
              <select id="lobbyDeckSelect">
                <option value="">Choose a deck…</option>
                ${state.decks.map((deck) => `<option value="${escapeHtml(deck.id)}" ${deck.id === selectedDeckId ? "selected" : ""}>${escapeHtml(deck.name)} — ${escapeHtml(deck.commanders.join(" / "))} (${deck.totalCards})</option>`).join("")}
              </select>
            </div>
          ` : `<div class="notice"><strong>No local decks found.</strong><p>Import a deck, then select it for this room.</p></div>`}
          <div class="button-row" style="margin-top:12px">
            <button class="secondary-button" type="button" data-action="import-deck">Import deck</button>
            <button class="primary-button" type="button" data-action="toggle-ready" ${!me || !me.deck ? "disabled" : ""}>${me && me.ready ? "Mark not ready" : "Mark ready"}</button>
          </div>

          ${isHost() ? `
            <div class="divider"></div>
            <form id="roomSettingsForm">
              <div class="panel-heading"><div><p class="eyebrow">Host controls</p><h3>Room settings</h3></div></div>
              <div class="form-grid two">
                <div class="form-group">
                  <label for="roomMaxPlayers">Maximum players</label>
                  <select id="roomMaxPlayers" name="maxPlayers">${[2,3,4,5,6].map((number) => `<option value="${number}" ${number === state.room.maxPlayers ? "selected" : ""}>${number}</option>`).join("")}</select>
                </div>
                <div class="form-group">
                  <label for="roomStartingLife">Starting life</label>
                  <select id="roomStartingLife" name="startingLife">${[20,30,40,50,60].map((number) => `<option value="${number}" ${number === state.room.startingLife ? "selected" : ""}>${number}</option>`).join("")}</select>
                </div>
              </div>
              <div class="button-row">
                <button class="secondary-button" type="submit">Save settings</button>
                <button class="primary-button" type="button" data-action="start-game" ${allReady ? "" : "disabled"}>Start game</button>
              </div>
            </form>
          ` : `
            <div class="divider"></div>
            <div class="notice"><strong>${escapeHtml(state.room.players.find((player) => player.id === state.room.hostId)?.name || "The host")}</strong> controls the room settings and starts the game.</div>
          `}
        </div>
      </section>
    `;
  }

  function renderLobbyPlayer(player) {
    const host = player.id === state.room.hostId;
    const self = player.id === state.session.playerId;
    const statusClass = !player.connected ? "offline" : player.ready ? "ready" : "waiting";
    const statusText = !player.connected ? "Offline" : player.ready ? "Ready" : "Waiting";
    return `
      <article class="lobby-player">
        <div class="lobby-player-main">
          <div class="lobby-player-name">
            <strong>${escapeHtml(player.name)}</strong>
            ${host ? `<span class="badge info">Host</span>` : ""}
            ${self ? `<span class="badge">You</span>` : ""}
          </div>
          <div class="lobby-player-deck">${player.deck ? `${escapeHtml(player.deck.name)} • ${escapeHtml(player.deck.commanders.join(" / "))}` : "No deck selected"}</div>
        </div>
        <div class="inline-actions">
          <span class="status-badge ${statusClass}">${statusText}</span>
          ${isHost() && !self ? `<button class="small-button danger-button" type="button" data-action="kick-player" data-player-id="${player.id}">Remove</button>` : ""}
        </div>
      </article>
    `;
  }

  function renderGame() {
    const active = state.room.players.find((player) => player.id === state.room.turn?.activePlayerId);
    const phase = state.room.phases[state.room.turn?.phaseIndex || 0] || "Untap";
    return `
      <div class="game-shell">
        <section class="turn-banner">
          <div>
            <p class="eyebrow">Room ${escapeHtml(state.room.code)} • Turn ${state.room.turn?.number || 1}</p>
            <h2>${escapeHtml(active?.name || "Unknown")} is active</h2>
            <span class="phase-badge">${escapeHtml(phase)}</span>
            ${persistenceBadge()}
          </div>
          <div class="turn-actions">
            <button class="secondary-button" type="button" data-action="next-phase">Next phase</button>
            <button class="primary-button" type="button" data-action="end-turn">End turn</button>
          </div>
        </section>

        <div class="tab-bar" role="tablist">
          ${[
            ["table", "Table"], ["zones", "My Zones"], ["tools", "Tools"], ["chat", `Chat${state.room.chat.length ? ` (${state.room.chat.length})` : ""}`]
          ].map(([id, label]) => `<button class="tab-button ${state.activeGameTab === id ? "active" : ""}" type="button" data-action="game-tab" data-tab="${id}">${label}</button>`).join("")}
        </div>

        <section class="player-grid">
          ${state.room.players.map(renderPlayerCard).join("")}
        </section>

        ${renderGameTab()}
      </div>
    `;
  }

  function renderPlayerCard(player) {
    const game = player.game;
    const isActive = player.id === state.room.turn?.activePlayerId;
    const self = player.id === state.session.playerId;
    const sourcePlayers = state.room.players.filter((source) => source.id !== player.id);
    return `
      <article class="player-card ${isActive ? "is-active" : ""} ${self ? "is-self" : ""} ${game.conceded ? "is-conceded" : ""}">
        <header class="player-card-header">
          <div>
            <h3>${escapeHtml(player.name)} ${self ? `<span class="badge">You</span>` : ""}</h3>
            <small>${escapeHtml(player.deck?.commanders.join(" / ") || "No commander")}</small>
          </div>
          <div class="inline-actions">
            ${isActive ? `<span class="badge warning">Active</span>` : ""}
            ${game.conceded ? `<span class="badge danger">Conceded</span>` : ""}
            ${isHost() && !isActive && !game.conceded ? `<button class="small-button" type="button" data-action="game" data-game-type="set-active-player" data-target-player-id="${player.id}">Make active</button>` : ""}
          </div>
        </header>
        <div class="player-stats">
          <div class="stat-box life-stat"><small>Life</small><span class="stat-value">${game.life}</span><span class="muted">${game.life <= 0 ? "Defeated?" : ""}</span></div>
          <div class="stat-box"><small>Poison</small><span class="stat-value">${game.poison}</span><span class="muted">/ 10</span></div>
          <div class="stat-box"><small>Tax</small><span class="stat-value">${game.commanderTax}</span><span class="muted">mana</span></div>
        </div>
        <div class="player-card-controls">
          <div class="life-controls">
            ${[-5,-1,1,5].map((amount) => `<button class="counter-button" type="button" data-action="game" data-game-type="life" data-target-player-id="${player.id}" data-amount="${amount}">${amount > 0 ? "+" : ""}${amount}</button>`).join("")}
          </div>
          <div class="counter-controls">
            <span class="field-label">Poison</span>
            <button class="counter-button" type="button" data-action="game" data-game-type="poison" data-target-player-id="${player.id}" data-amount="-1">−</button>
            <button class="counter-button" type="button" data-action="game" data-game-type="poison" data-target-player-id="${player.id}" data-amount="1">+</button>
            <span class="field-label">Tax</span>
            <button class="counter-button" type="button" data-action="game" data-game-type="commander-tax" data-target-player-id="${player.id}" data-amount="-2">−2</button>
            <button class="counter-button" type="button" data-action="game" data-game-type="commander-tax" data-target-player-id="${player.id}" data-amount="2">+2</button>
          </div>
          ${sourcePlayers.length ? `<div class="commander-damage-grid">
            ${sourcePlayers.map((source) => {
              const damage = game.commanderDamage[source.id] || 0;
              return `<div class="commander-damage-row"><span>From ${escapeHtml(source.name)}: <strong>${damage}</strong>/21</span><span><button class="counter-button" type="button" data-action="game" data-game-type="commander-damage" data-target-player-id="${player.id}" data-source-player-id="${source.id}" data-amount="-1">−</button> <button class="counter-button" type="button" data-action="game" data-game-type="commander-damage" data-target-player-id="${player.id}" data-source-player-id="${source.id}" data-amount="1">+</button></span></div>`;
            }).join("")}
          </div>` : ""}
        </div>
      </article>
    `;
  }

  function renderGameTab() {
    if (state.activeGameTab === "zones") return renderZonesTab();
    if (state.activeGameTab === "tools") return renderToolsTab();
    if (state.activeGameTab === "chat") return renderChatTab();
    return renderTableTab();
  }

  function renderTableTab() {
    const me = currentPlayer();
    return `
      <section class="table-board">
        <div class="zone-heading">
          <div><p class="eyebrow">Shared battlefield</p><h2>Table</h2></div>
          <div class="button-row">
            <button class="secondary-button" type="button" data-action="game" data-game-type="untap-all">Untap mine</button>
            <button class="secondary-button" type="button" data-action="game" data-game-type="draw" data-amount="1">Draw</button>
          </div>
        </div>
        <div class="battlefields">
          ${state.room.players.map((player) => `
            <section class="battlefield">
              <div class="battlefield-title"><strong>${escapeHtml(player.name)}'s battlefield</strong><span class="zone-count">${player.game.battlefield.length} permanents</span></div>
              ${player.game.battlefield.length ? `<div class="card-strip">${player.game.battlefield.map((card) => renderCard(card, "battlefield", player.id, player.id === state.session.playerId)).join("")}</div>` : `<div class="empty-state"><span>No permanents</span></div>`}
            </section>
          `).join("")}
        </div>
      </section>

      <section class="zone-panel">
        <div class="zone-heading">
          <div><p class="eyebrow">Hidden from opponents</p><h2>Your hand</h2></div>
          <span class="zone-count">${me.game.hand?.length || 0} cards</span>
        </div>
        ${me.game.hand?.length ? `<div class="hand-strip">${me.game.hand.map((card) => renderCard(card, "hand", me.id, true)).join("")}</div>` : `<div class="empty-state"><span>Your hand is empty.</span></div>`}
      </section>
    `;
  }

  function renderZonesTab() {
    const me = currentPlayer();
    const game = me.game;
    return `
      <section class="zone-panel">
        <div class="zone-heading">
          <div><p class="eyebrow">Your deck state</p><h2>Zones</h2></div>
          <div class="button-row">
            <button class="secondary-button" type="button" data-action="game" data-game-type="draw" data-amount="1">Draw 1</button>
            <button class="secondary-button" type="button" data-action="game" data-game-type="mill" data-amount="1">Mill 1</button>
            <button class="ghost-button" type="button" data-action="game" data-game-type="shuffle">Shuffle</button>
          </div>
        </div>
        <div class="zone-summary-grid">
          <div class="zone-summary"><strong>${game.libraryCount}</strong><small>Library</small></div>
          <div class="zone-summary"><strong>${game.hand?.length || 0}</strong><small>Hand</small></div>
          <div class="zone-summary"><strong>${game.graveyard.length}</strong><small>Graveyard</small></div>
          <div class="zone-summary"><strong>${game.exile.length}</strong><small>Exile</small></div>
        </div>
      </section>

      ${renderZoneSection("Command zone", "commandZone", game.commandZone, me.id)}
      ${renderZoneSection("Graveyard", "graveyard", game.graveyard, me.id)}
      ${renderZoneSection("Exile", "exile", game.exile, me.id)}
      ${renderZoneSection("Hand", "hand", game.hand || [], me.id)}
    `;
  }

  function renderZoneSection(title, zone, cards, ownerId) {
    return `
      <section class="zone-panel">
        <div class="zone-heading"><h3>${escapeHtml(title)}</h3><span class="zone-count">${cards.length}</span></div>
        ${cards.length ? `<div class="zone-cards wrap">${cards.map((card) => renderCard(card, zone, ownerId, true)).join("")}</div>` : `<div class="empty-state"><span>No cards in ${escapeHtml(title.toLowerCase())}.</span></div>`}
      </section>
    `;
  }

  function renderCard(card, zone, ownerId, canControl) {
    const flags = [
      card.commander ? `<span class="card-flag">Commander</span>` : "",
      card.token ? `<span class="card-flag">Token</span>` : "",
      card.tapped ? `<span class="card-flag">Tapped</span>` : "",
      card.power || card.toughness ? `<span class="card-flag">${escapeHtml(card.power || "?")}/${escapeHtml(card.toughness || "?")}</span>` : ""
    ].filter(Boolean).join("");

    const actions = canControl ? renderCardActions(card, zone) : "";
    return `
      <article class="mtg-card ${card.tapped ? "is-tapped" : ""} ${card.commander ? "is-commander" : ""} ${card.token ? "is-token" : ""}" title="${escapeHtml(card.name)}">
        ${card.counters ? `<span class="card-counter">${card.counters}</span>` : ""}
        <header class="mtg-card-header"><p class="mtg-card-name">${escapeHtml(card.name)}</p></header>
        <div class="mtg-card-art" aria-hidden="true">${card.commander ? "♛" : card.token ? "◈" : "✦"}</div>
        <footer class="mtg-card-footer">
          <div class="card-flags">${flags || `<span class="card-flag">Permanent</span>`}</div>
          ${actions}
        </footer>
      </article>
    `;
  }

  function moveButton(label, card, from, to, className = "small-button") {
    return `<button class="${className}" type="button" data-action="move-card" data-card-id="${card.id}" data-from-zone="${from}" data-to-zone="${to}">${label}</button>`;
  }

  function renderCardActions(card, zone) {
    if (zone === "battlefield") {
      return `<div class="card-actions">
        <button class="small-button" type="button" data-action="game" data-game-type="tap-card" data-card-id="${card.id}">${card.tapped ? "Untap" : "Tap"}</button>
        <button class="small-button" type="button" data-action="game" data-game-type="card-counter" data-card-id="${card.id}" data-amount="-1">C−</button>
        <button class="small-button" type="button" data-action="game" data-game-type="card-counter" data-card-id="${card.id}" data-amount="1">C+</button>
        ${moveButton("Grave", card, zone, "graveyard")}
        ${moveButton("Exile", card, zone, "exile")}
        ${card.commander ? moveButton("Command", card, zone, "commandZone") : ""}
      </div>`;
    }
    if (zone === "hand") {
      return `<div class="card-actions">${moveButton("Play", card, zone, "battlefield", "small-button primary-button")}${moveButton("Discard", card, zone, "graveyard")}${moveButton("Exile", card, zone, "exile")}${card.commander ? moveButton("Command", card, zone, "commandZone") : ""}</div>`;
    }
    if (zone === "graveyard") {
      return `<div class="card-actions">${moveButton("Field", card, zone, "battlefield")}${moveButton("Hand", card, zone, "hand")}${moveButton("Exile", card, zone, "exile")}${card.commander ? moveButton("Command", card, zone, "commandZone") : ""}</div>`;
    }
    if (zone === "exile") {
      return `<div class="card-actions">${moveButton("Field", card, zone, "battlefield")}${moveButton("Hand", card, zone, "hand")}${moveButton("Grave", card, zone, "graveyard")}${card.commander ? moveButton("Command", card, zone, "commandZone") : ""}</div>`;
    }
    if (zone === "commandZone") {
      return `<div class="card-actions">${moveButton("Cast", card, zone, "battlefield", "small-button primary-button")}${moveButton("Hand", card, zone, "hand")}${moveButton("Grave", card, zone, "graveyard")}</div>`;
    }
    return "";
  }

  function renderToolsTab() {
    const me = currentPlayer();
    return `
      <section class="zone-panel">
        <div class="zone-heading"><div><p class="eyebrow">Sandbox utilities</p><h2>Tools</h2></div></div>
        <div class="tool-grid">
          <article class="tool-card">
            <h3>Draw and deck</h3>
            <p class="muted">Your library currently has ${me.game.libraryCount} cards.</p>
            <div class="button-row">
              <button class="secondary-button" type="button" data-action="game" data-game-type="draw" data-amount="1">Draw 1</button>
              <button class="secondary-button" type="button" data-action="game" data-game-type="draw" data-amount="7">Draw 7</button>
              <button class="ghost-button" type="button" data-action="game" data-game-type="mill" data-amount="1">Mill 1</button>
              <button class="ghost-button" type="button" data-action="game" data-game-type="shuffle">Shuffle</button>
              <button class="danger-button" type="button" data-action="mulligan">Mulligan to 7</button>
            </div>
          </article>

          <article class="tool-card">
            <h3>Dice and coin</h3>
            <div class="tool-result">${escapeHtml(state.toolResult)}</div>
            <div class="button-row">
              ${[6,10,20,100].map((sides) => `<button class="secondary-button" type="button" data-action="roll" data-sides="${sides}">d${sides}</button>`).join("")}
              <button class="secondary-button" type="button" data-action="coin">Coin</button>
            </div>
          </article>

          <form id="tokenForm" class="tool-card">
            <h3>Create token</h3>
            <div class="form-group"><label for="tokenName">Token name</label><input id="tokenName" name="name" maxlength="80" value="${escapeHtml(state.tokenDraft.name)}" required></div>
            <div class="form-grid two">
              <div class="form-group"><label for="tokenPower">Power</label><input id="tokenPower" name="power" maxlength="12" value="${escapeHtml(state.tokenDraft.power)}"></div>
              <div class="form-group"><label for="tokenToughness">Toughness</label><input id="tokenToughness" name="toughness" maxlength="12" value="${escapeHtml(state.tokenDraft.toughness)}"></div>
            </div>
            <button class="primary-button" type="submit">Create on battlefield</button>
          </form>

          <article class="tool-card">
            <h3>Game controls</h3>
            <p class="muted">Conceding leaves your board visible. The host can return everyone to a fresh lobby.</p>
            <div class="button-row">
              ${!me.game.conceded ? `<button class="danger-button" type="button" data-action="concede">Concede</button>` : `<span class="badge danger">You conceded</span>`}
              ${isHost() ? `<button class="secondary-button" type="button" data-action="reset-game">New game lobby</button>` : ""}
            </div>
          </article>
        </div>
      </section>
    `;
  }

  function renderChatTab() {
    const chat = state.room.chat;
    const log = state.room.log;
    return `
      <section class="chat-layout">
        <div class="chat-panel">
          <div class="panel-heading"><div><p class="eyebrow">Room messages</p><h2>Chat</h2></div></div>
          <div class="chat-messages">
            ${chat.length ? chat.map((message) => `<article class="chat-message ${message.playerId === state.session.playerId ? "is-self" : ""}"><div class="chat-meta"><strong>${escapeHtml(message.playerName)}</strong><span>${formatTime(message.time)}</span></div><p>${escapeHtml(message.message)}</p></article>`).join("") : `<div class="empty-state"><span>No messages yet.</span></div>`}
          </div>
          <form id="chatForm" class="chat-form"><input id="chatInput" name="message" maxlength="500" autocomplete="off" value="${escapeHtml(state.chatDraft)}" placeholder="Send a table message…"><button class="primary-button" type="submit">Send</button></form>
        </div>
        <div class="log-panel">
          <div class="panel-heading"><div><p class="eyebrow">Automatic history</p><h2>Game log</h2></div></div>
          <div class="log-entries">
            ${log.length ? [...log].reverse().map((entry) => `<article class="log-entry"><div class="log-meta"><span>${escapeHtml(entry.type)}</span><span>${formatTime(entry.time)}</span></div><p>${escapeHtml(entry.text)}</p></article>`).join("") : `<div class="empty-state"><span>No game activity yet.</span></div>`}
          </div>
        </div>
      </section>
    `;
  }

  function renderHelp() {
    return `
      <section class="panel">
        <div class="section-heading"><div><p class="eyebrow">Finished app guide</p><h1>How to play</h1></div></div>
        <div class="help-grid">
          <article class="help-card"><h3>1. Import decks</h3><ol><li>Open Decks.</li><li>Paste a text deck list.</li><li>Enter one or two commanders.</li><li>Save it on your device.</li></ol></article>
          <article class="help-card"><h3>2. Open a room</h3><ol><li>One player creates a private room.</li><li>Share the six-character code.</li><li>Each player selects a deck and marks ready.</li><li>The host starts the game.</li></ol></article>
          <article class="help-card"><h3>3. Use the table</h3><ul><li>Your hand is only sent to your browser.</li><li>Play cards to your battlefield and move them to other zones.</li><li>Tap permanents and add generic counters.</li><li>Life, poison, tax and commander damage update live.</li></ul></article>
          <article class="help-card"><h3>4. Autosave and reconnect</h3><p>Your private session stays in this browser, while the complete room is automatically saved to PostgreSQL. After a Render restart or redeploy, reopen the app and it will rejoin the same saved game.</p></article>
          <article class="help-card"><h3>Sandbox rules</h3><p>This app does not enforce every Magic rule or card ability. Players control card effects, priority, targets and legality just like a physical tabletop.</p></article>
          <article class="help-card"><h3>Install on phone</h3><p>Use the install button when shown, or use your browser menu and choose “Add to Home screen.” It also works inside compatible in-app browsers.</p></article>
        </div>
      </section>
    `;
  }

  function openDeckEditor(deck = null) {
    const deckList = deck ? deck.cards.map((card) => `${card.quantity} ${card.name}`).join("\n") : "";
    openModal(deck ? "Edit deck" : "Import Commander deck", `
      <form id="deckForm">
        <input type="hidden" name="deckId" value="${escapeHtml(deck?.id || "")}">
        <div class="form-group">
          <label for="deckName">Deck name</label>
          <input id="deckName" name="deckName" maxlength="60" required value="${escapeHtml(deck?.name || "")}" placeholder="Toxic Control">
        </div>
        <div class="form-group">
          <label for="deckCommanders">Commander name(s)</label>
          <input id="deckCommanders" name="commanders" maxlength="310" required value="${escapeHtml(deck?.commanders.join(" / ") || "")}" placeholder="Atraxa, Praetors' Voice">
          <p class="form-help">For partners, separate the two names with a slash.</p>
        </div>
        <div class="form-group">
          <label for="deckList">Deck list</label>
          <textarea id="deckList" name="deckList" required spellcheck="false" placeholder="1 Sol Ring&#10;1 Command Tower&#10;1 Arcane Signet">${escapeHtml(deckList)}</textarea>
          <p class="form-help">Supports “1 Card Name”, “1x Card Name” and common set-code text. If the commander is missing from a 99-card list, it is added automatically.</p>
        </div>
        <div class="button-row">
          <button class="primary-button" type="submit">Save deck</button>
          <button class="ghost-button" type="button" data-close-modal>Cancel</button>
        </div>
      </form>
    `);
  }

  function parseDeckList(text, commanders) {
    const map = new Map();
    const skippedHeadings = /^(commander|commanders|deck|mainboard|sideboard|maybeboard|companion|creatures?|lands?|artifacts?|enchantments?|instants?|sorceries?|planeswalkers?|other)$/i;

    String(text || "").split(/\r?\n/).forEach((rawLine) => {
      let line = rawLine.trim();
      if (!line || line.startsWith("//") || line.startsWith("#") || skippedHeadings.test(line.replace(/:$/, ""))) return;
      line = line.replace(/^SB:\s*/i, "");
      const match = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
      let quantity = 1;
      let name = line;
      if (match) {
        quantity = Math.max(1, Math.min(100, Number(match[1]) || 1));
        name = match[2];
      }
      name = name
        .replace(/\s+\([A-Z0-9]{2,8}\)(?:\s+[A-Za-z0-9-]+)?\s*$/i, "")
        .replace(/\s+\[[A-Z0-9]{2,8}[^\]]*\]\s*$/i, "")
        .replace(/\s+\*F\*\s*$/i, "")
        .trim();
      if (!name) return;
      const key = name.toLowerCase();
      const existing = map.get(key);
      if (existing) existing.quantity += quantity;
      else map.set(key, { name, quantity });
    });

    let cards = Array.from(map.values());
    let total = cards.reduce((sum, card) => sum + card.quantity, 0);
    commanders.forEach((commander) => {
      const exists = cards.some((card) => card.name.toLowerCase() === commander.toLowerCase());
      if (!exists && total < 100) {
        cards.push({ name: commander, quantity: 1 });
        total += 1;
      }
    });
    cards = cards.sort((a, b) => a.name.localeCompare(b.name));
    return cards;
  }

  async function handleCreateRoom(form) {
    const data = new FormData(form);
    const payload = {
      playerName: data.get("playerName"),
      maxPlayers: Number(data.get("maxPlayers")),
      startingLife: Number(data.get("startingLife"))
    };
    rememberPlayerName(payload.playerName);
    const response = await emitAck("create-room", payload, false);
    if (!response.success) return showToast(response.error, "error");
    setSession(response);
    render();
    showToast(`Room ${response.room.code} created.`, "success");
  }

  async function handleJoinRoom(form) {
    const data = new FormData(form);
    const payload = {
      playerName: data.get("playerName"),
      roomCode: String(data.get("roomCode") || "").toUpperCase().replace(/[^A-Z0-9]/g, "")
    };
    rememberPlayerName(payload.playerName);
    const response = await emitAck("join-room", payload, false);
    if (!response.success) return showToast(response.error, "error");
    setSession(response);
    render();
    showToast(`Joined room ${response.room.code}.`, "success");
  }

  async function rejoinRoom(showErrors = true) {
    if (!state.session || state.reconnecting || !socket.connected) return;
    state.reconnecting = true;
    const response = await emitAck("rejoin-room", {}, true);
    state.reconnecting = false;
    if (!response.success) {
      if (showErrors) showToast(response.error, "error");
      if (/no longer exists|could not be verified/i.test(response.error || "")) clearSession();
      render();
      return;
    }
    setSession(response);
    render();
    if (showErrors) showToast(`Rejoined room ${response.room.code}.`, "success");
  }

  async function setLobbyDeck(deckId) {
    const deck = deckById(deckId);
    const response = await emitAck("set-player-deck", { deck: deck || null });
    if (!response.success) return showToast(response.error, "error");
    state.room = response.room;
    render();
    showToast(deck ? `${deck.name} selected.` : "Deck cleared.", "success");
  }

  async function sendGameAction(action, quiet = false) {
    const response = await emitAck("game-action", { action });
    if (!response.success) {
      showToast(response.error, "error");
      return false;
    }
    if (!quiet) showToast("Game updated.", "success");
    return true;
  }

  async function handleClick(button) {
    const action = button.dataset.action;
    if (!action) return;

    if (action === "import-deck") return openDeckEditor();
    if (action === "edit-deck") return openDeckEditor(deckById(button.dataset.deckId));
    if (action === "delete-deck") {
      const deck = deckById(button.dataset.deckId);
      if (!deck || !window.confirm(`Delete ${deck.name}?`)) return;
      state.decks = state.decks.filter((entry) => entry.id !== deck.id);
      saveDecks();
      render();
      return showToast("Deck deleted.", "success");
    }
    if (action === "export-deck") {
      const deck = deckById(button.dataset.deckId);
      if (!deck) return;
      const text = [`Deck: ${deck.name}`, `Commander: ${deck.commanders.join(" / ")}`, "", ...deck.cards.map((card) => `${card.quantity} ${card.name}`)].join("\n");
      await copyText(text);
      return showToast("Deck list copied.", "success");
    }
    if (action === "forget-session") {
      clearSession();
      render();
      return showToast("Saved room session removed.", "success");
    }
    if (action === "rejoin") return rejoinRoom(true);
    if (action === "copy-room-code") {
      await copyText(state.room.code);
      return showToast("Room code copied.", "success");
    }
    if (action === "toggle-ready") {
      const response = await emitAck("toggle-ready");
      if (!response.success) return showToast(response.error, "error");
      state.room = response.room;
      render();
      return;
    }
    if (action === "start-game") {
      const response = await emitAck("start-game");
      if (!response.success) return showToast(response.error, "error");
      state.room = response.room;
      state.activeGameTab = "table";
      render();
      return showToast("Game started.", "success");
    }
    if (action === "kick-player") {
      const target = state.room.players.find((player) => player.id === button.dataset.playerId);
      if (!target || !window.confirm(`Remove ${target.name} from the room?`)) return;
      const response = await emitAck("remove-player", { targetPlayerId: target.id });
      if (!response.success) return showToast(response.error, "error");
      return showToast(`${target.name} removed.`, "success");
    }
    if (action === "leave-room") {
      if (!window.confirm("Leave this room?")) return;
      const response = await emitAck("leave-room");
      if (!response.success) return showToast(response.error, "error");
      clearSession();
      render();
      return showToast("You left the room.", "success");
    }
    if (action === "game-tab") {
      state.activeGameTab = button.dataset.tab;
      return render();
    }
    if (action === "move-card") {
      return sendGameAction({ type: "move-card", cardId: button.dataset.cardId, fromZone: button.dataset.fromZone, toZone: button.dataset.toZone }, true);
    }
    if (action === "game") {
      const gameAction = {
        type: button.dataset.gameType,
        targetPlayerId: button.dataset.targetPlayerId,
        sourcePlayerId: button.dataset.sourcePlayerId,
        cardId: button.dataset.cardId,
        amount: button.dataset.amount === undefined ? undefined : Number(button.dataset.amount)
      };
      return sendGameAction(gameAction, true);
    }
    if (action === "next-phase") return sendGameAction({ type: "next-phase" }, true);
    if (action === "end-turn") return sendGameAction({ type: "end-turn" }, true);
    if (action === "roll") {
      const response = await emitAck("roll-tool", { tool: "die", sides: Number(button.dataset.sides) });
      if (!response.success) return showToast(response.error, "error");
      state.toolResult = `d${button.dataset.sides}: ${response.result}`;
      render();
      return;
    }
    if (action === "coin") {
      const response = await emitAck("roll-tool", { tool: "coin" });
      if (!response.success) return showToast(response.error, "error");
      state.toolResult = response.result;
      render();
      return;
    }
    if (action === "mulligan") {
      if (!window.confirm("Return your hand, shuffle and draw seven?")) return;
      return sendGameAction({ type: "mulligan" }, true);
    }
    if (action === "concede") {
      if (!window.confirm("Concede this game? Your board will remain visible.")) return;
      return sendGameAction({ type: "concede" }, true);
    }
    if (action === "reset-game") {
      if (!window.confirm("Return every player to a new lobby? Current game state will be cleared.")) return;
      const response = await emitAck("reset-game");
      if (!response.success) return showToast(response.error, "error");
      state.room = response.room;
      state.activeGameTab = "table";
      render();
      return showToast("New lobby opened.", "success");
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
  }

  app.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id === "createRoomForm") return handleCreateRoom(form);
    if (form.id === "joinRoomForm") return handleJoinRoom(form);
    if (form.id === "roomSettingsForm") {
      const data = new FormData(form);
      const response = await emitAck("update-room-settings", { maxPlayers: Number(data.get("maxPlayers")), startingLife: Number(data.get("startingLife")) });
      if (!response.success) return showToast(response.error, "error");
      state.room = response.room;
      render();
      return showToast("Room settings saved.", "success");
    }
    if (form.id === "tokenForm") {
      const data = new FormData(form);
      state.tokenDraft = { name: data.get("name"), power: data.get("power"), toughness: data.get("toughness") };
      const success = await sendGameAction({ type: "create-token", ...state.tokenDraft }, true);
      if (success) showToast("Token created.", "success");
      return;
    }
    if (form.id === "chatForm") {
      const data = new FormData(form);
      const message = String(data.get("message") || "").trim();
      if (!message) return;
      const response = await emitAck("send-chat", { message });
      if (!response.success) return showToast(response.error, "error");
      state.chatDraft = "";
      return;
    }
  });

  modalBody.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    if (form.id !== "deckForm") return;
    const data = new FormData(form);
    const commanders = String(data.get("commanders") || "")
      .split(/\s*\/\s*|\s*\|\s*|\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, 2);
    const name = String(data.get("deckName") || "").trim();
    if (!name || !commanders.length) return showToast("Enter a deck name and commander.", "error");
    const cards = parseDeckList(data.get("deckList"), commanders);
    const totalCards = cards.reduce((sum, card) => sum + card.quantity, 0);
    if (totalCards < 10) return showToast("The deck list did not contain enough cards.", "error");
    if (totalCards > 250) return showToast("The deck list is too large for this sandbox.", "error");

    const deckId = String(data.get("deckId") || "") || uid();
    const deck = {
      id: deckId,
      name,
      commanders,
      cards,
      totalCards,
      uniqueCards: cards.length,
      validation: totalCards === 100 ? "valid" : "warning",
      updatedAt: new Date().toISOString()
    };
    const existingIndex = state.decks.findIndex((entry) => entry.id === deckId);
    if (existingIndex >= 0) state.decks[existingIndex] = deck;
    else state.decks.unshift(deck);
    saveDecks();
    closeModal();
    render();
    showToast(`${deck.name} saved with ${totalCards} cards.`, totalCards === 100 ? "success" : "info");
  });

  app.addEventListener("click", (event) => {
    const nav = event.target.closest("[data-nav]");
    if (nav) {
      const destination = nav.dataset.nav;
      if (state.room && destination !== "game") {
        showToast("Leave the current room before opening another section.", "info");
        return;
      }
      state.view = destination === "game" ? (state.room ? "game" : "home") : destination;
      render();
      return;
    }
    const button = event.target.closest("[data-action]");
    if (button) handleClick(button);
  });

  app.addEventListener("change", (event) => {
    if (event.target.id === "lobbyDeckSelect") setLobbyDeck(event.target.value);
  });

  app.addEventListener("input", (event) => {
    if (event.target.id === "chatInput") state.chatDraft = event.target.value;
    if (event.target.id === "tokenName") state.tokenDraft.name = event.target.value;
    if (event.target.id === "tokenPower") state.tokenDraft.power = event.target.value;
    if (event.target.id === "tokenToughness") state.tokenDraft.toughness = event.target.value;
    if (event.target.id === "joinRoomCode") event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });

  bottomNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-nav]");
    if (!button) return;
    if (state.room && button.dataset.nav !== "game") return showToast("Leave the current room before opening another section.", "info");
    state.view = button.dataset.nav === "game" ? (state.room ? "game" : "home") : button.dataset.nav;
    render();
  });

  modalBackdrop.addEventListener("click", (event) => {
    if (event.target === modalBackdrop || event.target.closest("[data-close-modal]")) closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modalBackdrop.classList.contains("is-hidden")) closeModal();
  });

  brandButton.addEventListener("click", () => {
    if (state.room) return showToast(`You are currently in room ${state.room.code}.`, "info");
    state.view = "home";
    render();
  });

  socket.on("connect", () => {
    setConnection("is-online", "Online");
    if (state.session) rejoinRoom(false);
  });

  socket.on("disconnect", () => setConnection("is-offline", "Offline"));
  socket.on("connect_error", () => setConnection("is-offline", "Offline"));

  socket.on("room-updated", (room) => {
    state.room = room;
    state.view = "game";
    render();
  });

  socket.on("game-started", ({ room }) => {
    state.room = room;
    state.activeGameTab = "table";
    render();
    showToast("The Commander game has started.", "success");
  });

  socket.on("removed-from-room", ({ message }) => {
    clearSession();
    render();
    showToast(message || "You were removed from the room.", "error");
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    installButton.classList.remove("is-hidden");
  });

  installButton.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    installButton.classList.add("is-hidden");
  });

  window.addEventListener("appinstalled", () => {
    installButton.classList.add("is-hidden");
    showToast("Commander Sandbox installed.", "success");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Service worker registration failed", error)));
  }

  render();
})();
