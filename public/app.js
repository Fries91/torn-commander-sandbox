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
    targetMode: null,
    deferredInstallPrompt: null,
    toolResult: "—"
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


  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function cardLookupKey(value) {
    return String(value || "").trim().toLocaleLowerCase("en-US");
  }

  function cardImage(card) {
    return card?.cardData?.imageUrl || card?.imageUrl || card?.cardData?.faces?.[0]?.imageUrl || "";
  }

  function cardArtCrop(card) {
    return card?.cardData?.artCropUrl || card?.artCropUrl || card?.cardData?.faces?.[0]?.artCropUrl || "";
  }

  function cardTypeLine(card) {
    return card?.cardData?.typeLine || "";
  }

  function cardOracleText(card) {
    return card?.cardData?.oracleText || card?.cardData?.faces?.map((face) => `${face.name}\n${face.oracleText || ""}`).join("\n\n") || "";
  }

  function manaCost(card) {
    return card?.cardData?.manaCost || "";
  }

  function renderOracleText(value) {
    return escapeHtml(value || "No Oracle text loaded.").replace(/\n/g, "<br>");
  }

  async function resolveCardIntelligence(names) {
    const unique = [...new Map(names.map((name) => String(name || "").trim()).filter(Boolean).map((name) => [cardLookupKey(name), name])).values()];
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch("/api/cards/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ names: unique }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "Card lookup failed.");
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function uid() {
    return globalThis.crypto?.randomUUID?.() || `deck-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function formatTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function playerName() {
    return localStorage.getItem(STORAGE.playerName) || "";
  }

  function rememberPlayerName(name) {
    localStorage.setItem(STORAGE.playerName, String(name || "").trim());
  }

  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastRegion.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3800);
  }

  function openModal(title, html) {
    modalTitle.textContent = title;
    modalBody.innerHTML = html;
    modalBackdrop.classList.remove("is-hidden");
    modalBackdrop.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    window.setTimeout(() => modalBody.querySelector("input, textarea, select, button")?.focus(), 30);
  }

  function closeModal() {
    modalBackdrop.classList.add("is-hidden");
    modalBackdrop.setAttribute("aria-hidden", "true");
    modalBody.innerHTML = "";
    document.body.style.overflow = "";
  }

  function authPayload(extra = {}) {
    return {
      roomCode: state.session?.roomCode,
      playerId: state.session?.playerId,
      sessionToken: state.session?.sessionToken,
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
      }, 15000);
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
    state.targetMode = null;
  }

  function clearSession() {
    state.session = null;
    state.room = null;
    state.targetMode = null;
    localStorage.removeItem(STORAGE.session);
    state.view = "home";
    state.activeGameTab = "table";
  }

  function currentPlayer() {
    return state.room?.players.find((player) => player.id === state.session?.playerId) || null;
  }

  function isHost() {
    return Boolean(state.room && state.room.hostId === state.session?.playerId);
  }

  function saveDecks() {
    saveJson(STORAGE.decks, state.decks);
  }

  function deckById(id) {
    return state.decks.find((deck) => deck.id === id) || null;
  }

  function setConnection(mode, text) {
    connectionStatus.className = `connection-status ${mode}`;
    connectionText.textContent = text;
  }

  function persistenceBadge() {
    const persistence = state.room?.persistence;
    return persistence?.ready && persistence.mode === "postgresql"
      ? `<span class="badge success">☁ Database autosave</span>`
      : `<span class="badge warning">⚠ Temporary memory</span>`;
  }

  function setActiveNav(name) {
    bottomNav.querySelectorAll("[data-nav]").forEach((button) => {
      button.classList.toggle("active", button.dataset.nav === name);
    });
  }

  function render() {
    if (state.room) {
      setActiveNav("game");
      app.innerHTML = state.room.status === "waiting"
        ? renderLobby()
        : state.room.status === "rolloff"
          ? renderRollOff()
          : renderGame();
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
    if (state.room?.status === "started" && state.activeGameTab === "chat") {
      window.requestAnimationFrame(() => {
        const messages = document.querySelector(".chat-messages");
        if (messages) messages.scrollTop = messages.scrollHeight;
      });
    }
  }

  function renderHome() {
    const savedRoom = state.session?.roomCode;
    return `
      <section class="hero-panel">
        <p class="eyebrow">MTG Commander • 2–6 Players</p>
        <h1>Shared Commander table with intelligent cards and Arena-style actions.</h1>
        <p>Import a deck to load real card images, Oracle text, types, mana costs and printed stats, then roll a server-side d20 and play clockwise.</p>
      </section>
      ${savedRoom ? `<section class="notice-row"><strong>Saved room ${escapeHtml(savedRoom)}</strong><div class="button-row"><button class="primary-button" data-action="rejoin">Rejoin</button><button class="ghost-button" data-action="forget-session">Forget</button></div></section>` : ""}
      <section class="home-grid">
        <form id="createRoomForm" class="panel">
          <p class="eyebrow">Host</p><h2>Create game</h2>
          <label>Player name<input name="playerName" maxlength="24" required value="${escapeHtml(playerName())}" placeholder="Fries91"></label>
          <div class="form-grid two">
            <label>Players<select name="maxPlayers">${[2,3,4,5,6].map((n) => `<option value="${n}" ${n === 6 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
            <label>Starting life<select name="startingLife">${[20,30,40,50,60].map((n) => `<option value="${n}" ${n === 40 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          </div>
          <button class="primary-button" type="submit">Create private room</button>
        </form>
        <form id="joinRoomForm" class="panel">
          <p class="eyebrow">Guest</p><h2>Join game</h2>
          <label>Player name<input name="playerName" maxlength="24" required value="${escapeHtml(playerName())}" placeholder="Your Torn name"></label>
          <label>Room code<input name="roomCode" maxlength="6" required autocomplete="off" autocapitalize="characters" placeholder="ABC234"></label>
          <button class="secondary-button" type="submit">Join room</button>
        </form>
      </section>
      <section class="panel">
        <div class="section-heading"><div><p class="eyebrow">Saved on this device</p><h2>My decks</h2></div><button class="primary-button" data-action="import-deck">Import deck</button></div>
        ${state.decks.length ? `<div class="deck-grid">${state.decks.slice(0, 4).map(renderDeckCard).join("")}</div>` : `<div class="empty-state">No decks imported yet.</div>`}
      </section>
    `;
  }

  function renderDecks() {
    return `<section class="panel"><div class="section-heading"><div><p class="eyebrow">Deck library</p><h1>My Commander decks</h1></div><button class="primary-button" data-action="import-deck">Import deck</button></div>${state.decks.length ? `<div class="deck-grid">${state.decks.map(renderDeckCard).join("")}</div>` : `<div class="empty-state">Your deck library is empty.</div>`}</section>`;
  }

  function renderDeckCard(deck) {
    const recognized = deck.intelligenceCount ?? deck.cards?.filter((card) => card.cardData?.scryfallId).length ?? 0;
    const commanderImage = deck.commanderData?.[0]?.artCropUrl || deck.commanderData?.[0]?.imageUrl || deck.cards?.find((card) => deck.commanders?.some((name) => cardLookupKey(name) === cardLookupKey(card.name)))?.cardData?.artCropUrl || "";
    return `<article class="deck-card smart-deck-card">${commanderImage ? `<div class="deck-card-art" style="background-image:url('${escapeAttribute(commanderImage)}')"></div>` : ""}<div class="deck-card-content"><div><h3>${escapeHtml(deck.name)}</h3><p>${escapeHtml(deck.commanders.join(" / "))}</p></div><div class="card-intelligence-progress"><span style="width:${deck.uniqueCards ? Math.round((recognized / deck.uniqueCards) * 100) : 0}%"></span></div><small>${recognized}/${deck.uniqueCards || 0} unique cards recognized</small><div class="button-row"><span class="badge ${deck.totalCards === 100 ? "success" : "warning"}">${deck.totalCards} cards</span><span class="badge ${recognized === deck.uniqueCards ? "success" : "info"}">🧠 Card data</span><button class="small-button" data-action="edit-deck" data-deck-id="${escapeHtml(deck.id)}">Edit</button><button class="small-button danger-button" data-action="delete-deck" data-deck-id="${escapeHtml(deck.id)}">Delete</button></div></div></article>`;
  }

  function renderLobby() {
    const me = currentPlayer();
    const selectedDeckId = me?.deck?.id || "";
    const allReady = state.room.players.length >= 2 && state.room.players.every((player) => player.ready && player.connected && player.deck);
    return `
      <section class="panel lobby-top"><div><p class="eyebrow">Private lobby</p><h1>Room <span class="room-code">${escapeHtml(state.room.code)}</span></h1><p>${state.room.players.length}/${state.room.maxPlayers} players • ${state.room.startingLife} life</p><div>${persistenceBadge()}</div></div><div class="button-row"><button class="secondary-button" data-action="copy-room-code">Copy code</button><button class="ghost-button" data-action="leave-room">Leave</button></div></section>
      <section class="lobby-grid">
        <div class="panel"><div class="section-heading"><h2>Players</h2><span class="badge ${allReady ? "success" : "warning"}">${allReady ? "Ready" : "Waiting"}</span></div><div class="player-list">${state.room.players.map(renderLobbyPlayer).join("")}</div></div>
        <div class="panel"><h2>Your setup</h2><label>Commander deck<select id="lobbyDeckSelect"><option value="">Choose a deck…</option>${state.decks.map((deck) => `<option value="${escapeHtml(deck.id)}" ${deck.id === selectedDeckId ? "selected" : ""}>${escapeHtml(deck.name)} — ${escapeHtml(deck.commanders.join(" / "))}</option>`).join("")}</select></label><div class="button-row"><button class="secondary-button" data-action="import-deck">Import deck</button><button class="primary-button" data-action="toggle-ready" ${!me?.deck ? "disabled" : ""}>${me?.ready ? "Mark not ready" : "Mark ready"}</button></div>${isHost() ? `<div class="divider"></div><form id="roomSettingsForm"><div class="form-grid two"><label>Maximum players<select name="maxPlayers">${[2,3,4,5,6].map((n) => `<option value="${n}" ${n === state.room.maxPlayers ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Starting life<select name="startingLife">${[20,30,40,50,60].map((n) => `<option value="${n}" ${n === state.room.startingLife ? "selected" : ""}>${n}</option>`).join("")}</select></label></div><div class="button-row"><button class="secondary-button" type="submit">Save</button><button class="primary-button" type="button" data-action="start-game" ${allReady ? "" : "disabled"}>Start game</button></div></form>` : ""}</div>
      </section>
    `;
  }

  function renderLobbyPlayer(player) {
    const self = player.id === state.session.playerId;
    return `<article class="lobby-player"><div><strong>${escapeHtml(player.name)}</strong> ${player.id === state.room.hostId ? `<span class="badge info">Host</span>` : ""} ${self ? `<span class="badge">You</span>` : ""}<p>${player.deck ? `${escapeHtml(player.deck.name)} • ${escapeHtml(player.deck.commanders.join(" / "))}` : "No deck selected"}</p></div><div><span class="status-dot ${player.connected ? "online" : "offline"}"></span>${player.connected ? (player.ready ? "Ready" : "Waiting") : "Offline"}${isHost() && !self ? `<button class="small-button danger-button" data-action="kick-player" data-player-id="${player.id}">Remove</button>` : ""}</div></article>`;
  }

  function orderedPlayers() {
    if (!state.room) return [];
    const rawOrder = Array.isArray(state.room.turn?.order) && state.room.turn.order.length
      ? state.room.turn.order
      : state.room.players.map((player) => player.id);
    const byId = new Map(state.room.players.map((player) => [player.id, player]));
    const ordered = rawOrder.map((id) => byId.get(id)).filter(Boolean);
    for (const player of state.room.players) {
      if (!ordered.some((entry) => entry.id === player.id)) ordered.push(player);
    }
    return ordered;
  }

  function latestStartingRoll(playerId) {
    const rollOff = state.room?.rollOff;
    if (!rollOff) return null;
    if (Object.prototype.hasOwnProperty.call(rollOff.currentRolls || {}, playerId)) {
      return rollOff.currentRolls[playerId];
    }
    for (let index = (rollOff.rounds || []).length - 1; index >= 0; index -= 1) {
      const rolls = rollOff.rounds[index]?.rolls || {};
      if (Object.prototype.hasOwnProperty.call(rolls, playerId)) return rolls[playerId];
    }
    return null;
  }

  function renderRollOff() {
    const rollOff = state.room.rollOff;
    const me = currentPlayer();
    const eligible = rollOff.currentEligiblePlayerIds.includes(me.id);
    const hasRolled = Object.prototype.hasOwnProperty.call(rollOff.currentRolls, me.id);
    const myRoll = hasRolled ? rollOff.currentRolls[me.id] : null;
    const waitingNames = rollOff.currentEligiblePlayerIds
      .filter((id) => !Object.prototype.hasOwnProperty.call(rollOff.currentRolls, id))
      .map((id) => state.room.players.find((player) => player.id === id)?.name)
      .filter(Boolean);
    const previousRounds = (rollOff.rounds || []).map((round) => {
      const results = state.room.players
        .filter((player) => Object.prototype.hasOwnProperty.call(round.rolls || {}, player.id))
        .map((player) => `<span class="roll-history-result"><strong>${escapeHtml(player.name)}</strong> ${round.rolls[player.id]}</span>`)
        .join("");
      return `<article class="roll-history-round"><span>Round ${round.round}</span><div>${results}</div></article>`;
    }).join("");

    return `
      <section class="panel rolloff-hero">
        <div>
          <p class="eyebrow">Starting player • d20 roll-off</p>
          <h1>${rollOff.round > 1 ? `Tie reroll — Round ${rollOff.round}` : "Everyone roll a d20"}</h1>
          <p>The highest roll takes the first turn. The seated order then continues clockwise.</p>
          <div class="button-row">${persistenceBadge()}<span class="badge info">Server-generated rolls</span></div>
        </div>
        <div class="dice-stage ${myRoll ? "has-roll" : ""}"><span>d20</span><strong>${myRoll || "?"}</strong></div>
      </section>
      <section class="rolloff-grid">
        <div class="panel">
          <div class="section-heading"><div><p class="eyebrow">Room ${escapeHtml(state.room.code)}</p><h2>Roll results</h2></div><span class="badge warning">Round ${rollOff.round}</span></div>
          <div class="roll-player-list">
            ${state.room.players.map((player, seatIndex) => {
              const isEligible = rollOff.currentEligiblePlayerIds.includes(player.id);
              const rolledNow = Object.prototype.hasOwnProperty.call(rollOff.currentRolls, player.id);
              const shownRoll = rolledNow ? rollOff.currentRolls[player.id] : latestStartingRoll(player.id);
              let status = "Waiting";
              if (!player.connected) status = "Offline";
              else if (rolledNow) status = `Rolled ${shownRoll}`;
              else if (!isEligible && rollOff.round > 1) status = `Previous ${shownRoll ?? "—"}`;
              else if (isEligible) status = "Needs roll";
              return `<article class="roll-player ${player.id === me.id ? "is-self" : ""} ${rolledNow ? "has-rolled" : ""}"><span class="seat-number">${seatIndex + 1}</span><div><strong>${escapeHtml(player.name)}</strong><small>Clockwise seat ${seatIndex + 1}${player.id === me.id ? " • You" : ""}</small></div><span class="roll-value">${shownRoll ?? "—"}</span><span class="status-badge ${rolledNow ? "ready" : isEligible ? "waiting" : "offline"}">${escapeHtml(status)}</span></article>`;
            }).join("")}
          </div>
        </div>
        <div class="panel roll-control-card">
          <p class="eyebrow">Your roll</p>
          <h2>${eligible ? hasRolled ? `You rolled ${myRoll}` : "Ready to roll?" : "Waiting for the tied players"}</h2>
          <p>${waitingNames.length ? `Still waiting on: ${escapeHtml(waitingNames.join(", "))}` : "All required rolls are in. Resolving the result…"}</p>
          <button class="primary-button roll-d20-button" data-action="roll-starting-d20" ${!eligible || hasRolled || !me.connected ? "disabled" : ""}>🎲 Roll d20</button>
          <div class="divider"></div>
          <h3>Previous rounds</h3>
          <div class="roll-history">${previousRounds || `<div class="empty-state">No completed round yet.</div>`}</div>
        </div>
      </section>
    `;
  }

  function renderGame() {
    const players = orderedPlayers();
    const activeIndex = players.findIndex((player) => player.id === state.room.turn?.activePlayerId);
    const active = players[activeIndex] || null;
    const living = players.filter((player) => !player.game?.conceded);
    const livingIndex = living.findIndex((player) => player.id === active?.id);
    const next = living.length ? living[(livingIndex + 1 + living.length) % living.length] : null;
    const phase = state.room.phases[state.room.turn?.phaseIndex || 0] || "Untap";
    return `
      ${state.targetMode ? renderTargetBanner() : ""}
      <section class="turn-banner"><div><p class="eyebrow">Room ${escapeHtml(state.room.code)} • Turn ${state.room.turn?.number || 1}</p><h2>${escapeHtml(active?.name || "Unknown")} is active</h2><div class="button-row"><span class="phase-badge">${escapeHtml(phase)}</span>${persistenceBadge()}${next ? `<span class="badge info">Next clockwise: ${escapeHtml(next.name)}</span>` : ""}</div></div><div class="button-row"><button class="secondary-button" data-action="game" data-game-type="next-phase">Next phase</button><button class="primary-button" data-action="game" data-game-type="end-turn">End turn</button></div></section>
      <section class="clockwise-order"><strong>Clockwise order</strong><div>${players.map((player, index) => `<span class="turn-order-seat ${player.id === active?.id ? "is-active" : ""} ${player.game?.conceded ? "is-conceded" : ""}"><b>${index + 1}</b>${escapeHtml(player.name)}</span>${index < players.length - 1 ? `<span class="order-arrow">→</span>` : ""}`).join("")}</div></section>
      <div class="tab-bar">${[["table","Table"],["zones","My Zones"],["tools","Tools"],["chat",`Chat (${state.room.chat.length})`]].map(([id,label]) => `<button class="tab-button ${state.activeGameTab === id ? "active" : ""}" data-action="game-tab" data-tab="${id}">${label}</button>`).join("")}</div>
      <section class="player-grid">${players.map(renderPlayerCard).join("")}</section>
      ${renderGameTab()}
    `;
  }

  function renderPlayerCard(player) {
    const game = player.game;
    const self = player.id === state.session.playerId;
    const active = player.id === state.room.turn?.activePlayerId;
    const sources = state.room.players.filter((source) => source.id !== player.id);
    return `<article class="player-card ${self ? "is-self" : ""} ${active ? "is-active" : ""} ${game.conceded ? "is-conceded" : ""}"><header><div><h3>${escapeHtml(player.name)} ${self ? `<span class="badge">You</span>` : ""}</h3><small>${escapeHtml(player.deck?.commanders.join(" / ") || "No commander")}</small></div>${active ? `<span class="badge warning">Active</span>` : ""}</header><div class="player-stats"><div><small>Life</small><strong>${game.life}</strong></div><div><small>Poison</small><strong>${game.poison}</strong></div><div><small>Tax</small><strong>${game.commanderTax}</strong></div></div><div class="counter-row">${[-5,-1,1,5].map((amount) => `<button data-action="game" data-game-type="life" data-target-player-id="${player.id}" data-amount="${amount}">${amount > 0 ? "+" : ""}${amount}</button>`).join("")}</div><div class="mini-controls"><span>Poison</span><button data-action="game" data-game-type="poison" data-target-player-id="${player.id}" data-amount="-1">−</button><button data-action="game" data-game-type="poison" data-target-player-id="${player.id}" data-amount="1">+</button><span>Tax</span><button data-action="game" data-game-type="commander-tax" data-target-player-id="${player.id}" data-amount="-2">−2</button><button data-action="game" data-game-type="commander-tax" data-target-player-id="${player.id}" data-amount="2">+2</button></div><details><summary>Commander damage</summary>${sources.map((source) => `<div class="damage-row"><span>From ${escapeHtml(source.name)}: <strong>${game.commanderDamage[source.id] || 0}</strong>/21</span><span><button data-action="game" data-game-type="commander-damage" data-target-player-id="${player.id}" data-source-player-id="${source.id}" data-amount="-1">−</button><button data-action="game" data-game-type="commander-damage" data-target-player-id="${player.id}" data-source-player-id="${source.id}" data-amount="1">+</button></span></div>`).join("")}</details>${isHost() && !active && !game.conceded ? `<button class="small-button" data-action="game" data-game-type="set-active-player" data-target-player-id="${player.id}">Make active</button>` : ""}</article>`;
  }

  function renderGameTab() {
    if (state.activeGameTab === "zones") return renderZonesTab();
    if (state.activeGameTab === "tools") return renderToolsTab();
    if (state.activeGameTab === "chat") return renderChatTab();
    return renderTableTab();
  }

  function renderTableTab() {
    const me = currentPlayer();
    return `<section class="table-board"><div class="section-heading"><div><p class="eyebrow">Shared battlefield</p><h2>Table</h2></div><div class="button-row"><button class="secondary-button" data-action="game" data-game-type="untap-all">Untap mine</button><button class="secondary-button" data-action="game" data-game-type="draw" data-amount="1">Draw</button></div></div><div class="battlefields">${orderedPlayers().map((player) => `<section class="battlefield"><div class="battlefield-title"><strong>${escapeHtml(player.name)}'s battlefield</strong><span>${player.game.battlefield.length} permanents</span></div>${player.game.battlefield.length ? `<div class="card-strip">${player.game.battlefield.map((card) => renderCard(card, "battlefield", player.id, player.id === state.session.playerId)).join("")}</div>` : `<div class="empty-state">No permanents</div>`}</section>`).join("")}</div></section><section class="zone-panel"><div class="section-heading"><div><p class="eyebrow">Hidden from opponents</p><h2>Your hand</h2></div><span class="badge">${me.game.hand?.length || 0} cards</span></div>${me.game.hand?.length ? `<div class="hand-strip">${me.game.hand.map((card) => renderCard(card, "hand", me.id, true)).join("")}</div>` : `<div class="empty-state">Your hand is empty.</div>`}</section>`;
  }

  function renderZonesTab() {
    const me = currentPlayer();
    const game = me.game;
    return `<section class="zone-panel"><div class="section-heading"><div><p class="eyebrow">Your deck state</p><h2>Zones</h2></div><div class="button-row"><button class="secondary-button" data-action="game" data-game-type="draw" data-amount="1">Draw 1</button><button class="secondary-button" data-action="game" data-game-type="mill" data-amount="1">Mill 1</button><button class="ghost-button" data-action="game" data-game-type="shuffle">Shuffle</button></div></div><div class="zone-summary-grid"><div><strong>${game.libraryCount}</strong><small>Library</small></div><div><strong>${game.hand?.length || 0}</strong><small>Hand</small></div><div><strong>${game.graveyard.length}</strong><small>Graveyard</small></div><div><strong>${game.exile.length}</strong><small>Exile</small></div></div></section>${renderZoneSection("Command zone", "commandZone", game.commandZone, me.id)}${renderZoneSection("Graveyard", "graveyard", game.graveyard, me.id)}${renderZoneSection("Exile", "exile", game.exile, me.id)}${renderZoneSection("Hand", "hand", game.hand || [], me.id)}`;
  }

  function renderZoneSection(title, zone, cards, ownerId) {
    return `<section class="zone-panel"><div class="section-heading"><h3>${escapeHtml(title)}</h3><span class="badge">${cards.length}</span></div>${cards.length ? `<div class="zone-cards">${cards.map((card) => renderCard(card, zone, ownerId, true)).join("")}</div>` : `<div class="empty-state">No cards in ${escapeHtml(title.toLowerCase())}.</div>`}</section>`;
  }

  function counterBadges(card) {
    return Object.entries(card.counters || {}).map(([name, amount]) => `<span class="counter-chip">${escapeHtml(name)} ${amount}</span>`).join("");
  }

  function renderCard(card, zone, ownerId, canControl) {
    const targetEligible = state.targetMode && zone === "battlefield" && card.id !== state.targetMode.sourceCardId && (state.targetMode.type !== "block" || card.attacking);
    const stats = card.effectiveStats || ((card.power || card.toughness) ? { power: card.power || "?", toughness: card.toughness || "?" } : null);
    const blockerText = card.blockingCardId ? "Blocking" : "";
    const art = cardArtCrop(card) || cardImage(card);
    const typeLine = cardTypeLine(card);
    return `<article class="mtg-card ${card.tapped ? "is-tapped" : ""} ${card.commander ? "is-commander" : ""} ${card.token ? "is-token" : ""} ${card.attacking ? "is-attacking" : ""} ${card.lethal ? "is-lethal" : ""} ${targetEligible ? "target-eligible" : ""} ${art ? "has-real-art" : ""}" data-action="open-card" data-card-id="${card.id}" data-zone="${zone}" data-owner-id="${ownerId}" data-can-control="${canControl ? "1" : "0"}"><header><strong>${escapeHtml(card.name)}</strong>${manaCost(card) ? `<span class="mana-cost">${escapeHtml(manaCost(card))}</span>` : ""}</header><div class="card-art ${art ? "real-card-art" : ""}" ${art ? `style="background-image:url('${escapeAttribute(art)}')"` : ""}>${art ? "" : card.commander ? "♛" : card.token ? "◈" : "✦"}</div>${typeLine ? `<div class="card-type-line">${escapeHtml(typeLine)}</div>` : ""}<div class="card-status-row">${stats ? `<span class="pt-badge">${escapeHtml(stats.power)}/${escapeHtml(stats.toughness)}</span>` : ""}${card.loyalty ? `<span class="pt-badge">Loyalty ${escapeHtml(card.loyalty)}</span>` : ""}${card.damageMarked ? `<span class="damage-chip">${card.damageMarked} damage</span>` : ""}${card.attacking ? `<span class="attack-chip">Attacking</span>` : ""}${blockerText ? `<span class="block-chip">${blockerText}</span>` : ""}${card.lethal ? `<span class="lethal-chip">LETHAL</span>` : ""}</div><div class="card-counters">${counterBadges(card)}</div><footer><span>${card.cardData?.scryfallId ? "Card data loaded" : "Manual card"} • Tap for actions</span></footer></article>`;
  }

  function renderToolsTab() {
    const me = currentPlayer();
    return `<section class="tool-grid"><article class="tool-card"><h3>Draw and deck</h3><p>${me.game.libraryCount} cards in library.</p><div class="button-row"><button class="secondary-button" data-action="game" data-game-type="draw" data-amount="1">Draw 1</button><button class="secondary-button" data-action="game" data-game-type="draw" data-amount="7">Draw 7</button><button class="ghost-button" data-action="game" data-game-type="mill" data-amount="1">Mill 1</button><button class="ghost-button" data-action="game" data-game-type="shuffle">Shuffle</button><button class="danger-button" data-action="game" data-game-type="mulligan">Mulligan to 7</button></div></article><article class="tool-card"><h3>Combat cleanup</h3><div class="button-row"><button class="secondary-button" data-action="game" data-game-type="clear-combat">Clear attack/block</button><button class="secondary-button" data-action="game" data-game-type="clear-all-damage">Clear all damage</button></div></article><form id="tokenForm" class="tool-card"><h3>Create token</h3><label>Name<input name="name" maxlength="80" value="Soldier" required></label><div class="form-grid two"><label>Power<input name="power" maxlength="12" value="1"></label><label>Toughness<input name="toughness" maxlength="12" value="1"></label></div><button class="primary-button" type="submit">Create token</button></form><article class="tool-card"><h3>Dice and coin</h3><div class="tool-result">${escapeHtml(state.toolResult)}</div><div class="button-row">${[6,10,20,100].map((sides) => `<button class="secondary-button" data-action="roll" data-sides="${sides}">d${sides}</button>`).join("")}<button class="secondary-button" data-action="coin">Coin</button></div></article><article class="tool-card"><h3>Game controls</h3><div class="button-row">${!me.game.conceded ? `<button class="danger-button" data-action="game" data-game-type="concede">Concede</button>` : `<span class="badge danger">Conceded</span>`}${isHost() ? `<button class="secondary-button" data-action="reset-game">New game lobby</button>` : ""}</div></article></section>`;
  }

  function renderChatTab() {
    return `<section class="chat-layout"><div class="chat-panel"><h2>Chat</h2><div class="chat-messages">${state.room.chat.length ? state.room.chat.map((message) => `<article class="chat-message ${message.playerId === state.session.playerId ? "is-self" : ""}"><div><strong>${escapeHtml(message.playerName)}</strong><span>${formatTime(message.time)}</span></div><p>${escapeHtml(message.message)}</p></article>`).join("") : `<div class="empty-state">No messages yet.</div>`}</div><form id="chatForm" class="chat-form"><input name="message" maxlength="500" autocomplete="off" placeholder="Send a table message…"><button class="primary-button" type="submit">Send</button></form></div><div class="log-panel"><h2>Game log</h2><div class="log-entries">${state.room.log.length ? [...state.room.log].reverse().map((entry) => `<article><div><span>${escapeHtml(entry.type)}</span><span>${formatTime(entry.time)}</span></div><p>${escapeHtml(entry.text)}</p></article>`).join("") : `<div class="empty-state">No activity yet.</div>`}</div></div></section>`;
  }

  function renderHelp() {
    return `<section class="panel"><p class="eyebrow">v9 guide</p><h1>Intelligent cards, roll-off and clockwise play</h1><div class="help-grid"><article><h3>Smart deck import</h3><p>Saving a deck identifies each card and stores its image, Oracle text, type, mana cost, keywords and printed stats.</p></article><article><h3>Card details</h3><p>Tap any card to read its full Oracle text and view the current counters, damage and effective stats.</p></article><article><h3>Existing mechanics</h3><p>Counters, fights, attacking, blocking, d20 roll-off and clockwise turns continue to work.</p></article><article><h3>Manual fallback</h3><p>If a name is not recognized, the card remains playable with manual power, toughness, notes and movement controls.</p></article><article><h3>API care</h3><p>Card lookups are batched and cached so repeated deck imports do not overload the card-data service.</p></article><article><h3>Autosave</h3><p>Card intelligence is stored inside each deck and game object, while active rooms remain saved to PostgreSQL.</p></article></div></section>`;
  }

  function findCard(cardId) {
    if (!state.room) return null;
    for (const player of state.room.players) {
      if (!player.game) continue;
      for (const zone of ["battlefield", "graveyard", "exile", "commandZone", "hand"]) {
        const card = player.game[zone]?.find((entry) => entry.id === cardId);
        if (card) return { player, zone, card };
      }
    }
    return null;
  }

  function openCardActions(cardId, zone, ownerId, canControl) {
    const found = findCard(cardId);
    if (!found) return showToast("That card is no longer available.", "error");
    const card = found.card;
    if (state.targetMode && zone === "battlefield") return chooseTarget(card);
    const stats = card.effectiveStats || { power: card.power || "?", toughness: card.toughness || "?" };
    const counterList = Object.entries(card.counters || {}).map(([name, amount]) => `<span class="counter-chip">${escapeHtml(name)} ${amount}</span>`).join("") || "No counters";
    const owned = canControl && ownerId === state.session.playerId;
    const image = cardImage(card);
    const details = card.cardData;
    const faces = details?.faces?.length > 1 ? `<div class="card-face-tabs">${details.faces.map((face) => `<article><strong>${escapeHtml(face.name)}</strong><small>${escapeHtml(face.typeLine || "")}</small><p>${renderOracleText(face.oracleText)}</p></article>`).join("")}</div>` : "";
    openModal(card.name, `<div class="intelligent-card-sheet">${image ? `<img class="card-detail-image" src="${escapeAttribute(image)}" alt="${escapeAttribute(card.name)} card image" loading="lazy">` : `<div class="large-card-symbol">${card.commander ? "♛" : card.token ? "◈" : "✦"}</div>`}<div class="card-detail-copy"><div class="card-detail-title"><strong>${escapeHtml(manaCost(card))}</strong><span>${escapeHtml(cardTypeLine(card) || (card.token ? "Token" : "Card data unavailable"))}</span></div><p class="oracle-text">${renderOracleText(cardOracleText(card))}</p>${details?.keywords?.length ? `<div class="keyword-row">${details.keywords.map((keyword) => `<span class="counter-chip">${escapeHtml(keyword)}</span>`).join("")}</div>` : ""}<div class="current-card-state"><strong>${escapeHtml(stats.power)}/${escapeHtml(stats.toughness)}</strong><span>${card.damageMarked || 0} damage ${card.lethal ? "• LETHAL" : ""}</span><div>${counterList}</div></div><small class="scryfall-credit">Card data and images supplied by Scryfall.</small></div></div>${faces}${owned ? renderOwnedCardActions(card, zone) : `<div class="notice">You can view this card but only its controller can change it.</div>`}`);
  }

  function moveAction(label, card, from, to, className = "secondary-button") {
    return `<button class="${className}" data-action="move-card" data-card-id="${card.id}" data-from-zone="${from}" data-to-zone="${to}">${label}</button>`;
  }

  function renderOwnedCardActions(card, zone) {
    if (zone !== "battlefield") {
      const actions = zone === "hand"
        ? `${moveAction("Play", card, zone, "battlefield", "primary-button")}${moveAction("Discard", card, zone, "graveyard")}${moveAction("Exile", card, zone, "exile")}`
        : `${moveAction("Battlefield", card, zone, "battlefield")}${moveAction("Hand", card, zone, "hand")}${moveAction("Graveyard", card, zone, "graveyard")}${moveAction("Exile", card, zone, "exile")}`;
      return `<div class="sheet-grid">${actions}${card.commander ? moveAction("Command zone", card, zone, "commandZone") : ""}</div>`;
    }
    const hasAttacker = state.room.players.some((player) => player.id !== state.session.playerId && player.game.battlefield.some((entry) => entry.attacking));
    return `<div class="sheet-section"><h3>Card actions</h3><div class="sheet-grid"><button class="primary-button" data-action="card-game" data-game-type="tap-card" data-card-id="${card.id}">${card.tapped ? "Untap" : "Tap"}</button><button class="secondary-button" data-action="open-counter-menu" data-card-id="${card.id}">Counters</button><button class="secondary-button" data-action="open-stats-menu" data-card-id="${card.id}">Power / toughness</button><button class="secondary-button" data-action="card-game" data-game-type="mark-damage" data-card-id="${card.id}" data-amount="1">+1 damage</button><button class="secondary-button" data-action="card-game" data-game-type="mark-damage" data-card-id="${card.id}" data-amount="-1">−1 damage</button><button class="ghost-button" data-action="card-game" data-game-type="clear-card-damage" data-card-id="${card.id}">Clear damage</button><button class="combat-button" data-action="start-fight" data-card-id="${card.id}">Fight creature</button><button class="combat-button" data-action="card-game" data-game-type="toggle-attacking" data-card-id="${card.id}">${card.attacking ? "Stop attacking" : "Mark attacking"}</button>${hasAttacker ? `<button class="combat-button" data-action="start-block" data-card-id="${card.id}">Block attacker</button>` : ""}${card.blockingCardId ? `<button class="ghost-button" data-action="card-game" data-game-type="clear-block" data-card-id="${card.id}">Stop blocking</button>` : ""}${card.lethal ? `<button class="danger-button" data-action="card-game" data-game-type="resolve-lethal" data-card-id="${card.id}">Resolve lethal</button>` : ""}</div></div><div class="sheet-section"><h3>Move card</h3><div class="sheet-grid">${moveAction("Graveyard", card, zone, "graveyard")}${moveAction("Exile", card, zone, "exile")}${moveAction("Hand", card, zone, "hand")}${card.commander ? moveAction("Command zone", card, zone, "commandZone") : ""}</div></div>`;
  }

  function openCounterMenu(cardId) {
    const found = findCard(cardId);
    if (!found) return;
    const quick = ["+1/+1", "-1/-1", "Shield", "Stun", "Charge", "Loyalty"];
    openModal(`${found.card.name} counters`, `<div class="counter-picker">${quick.map((name) => `<div class="counter-picker-row"><strong>${escapeHtml(name)}</strong><button data-action="apply-counter" data-card-id="${cardId}" data-counter-name="${escapeHtml(name)}" data-amount="-1">−</button><span>${found.card.counters?.[name] || 0}</span><button data-action="apply-counter" data-card-id="${cardId}" data-counter-name="${escapeHtml(name)}" data-amount="1">+</button></div>`).join("")}</div><form id="customCounterForm"><input type="hidden" name="cardId" value="${cardId}"><label>Custom counter name<input name="counterName" maxlength="30" required placeholder="Experience"></label><div class="button-row"><button class="secondary-button" type="submit" name="amount" value="-1">Remove one</button><button class="primary-button" type="submit" name="amount" value="1">Add one</button></div></form>`);
  }

  function openStatsMenu(cardId) {
    const found = findCard(cardId);
    if (!found) return;
    openModal(`${found.card.name} stats`, `<form id="cardStatsForm"><input type="hidden" name="cardId" value="${cardId}"><div class="form-grid two"><label>Base power<input name="power" maxlength="12" value="${escapeHtml(found.card.power || "")}" placeholder="2"></label><label>Base toughness<input name="toughness" maxlength="12" value="${escapeHtml(found.card.toughness || "")}" placeholder="2"></label></div><label>Notes<textarea name="notes" maxlength="300" rows="3" placeholder="Temporary effects, keywords or reminders">${escapeHtml(found.card.notes || "")}</textarea></label><p class="form-help">Use whole numbers for automatic fight and lethal calculations. +1/+1 and -1/-1 counters are included automatically.</p><button class="primary-button" type="submit">Save stats</button></form>`);
  }

  function beginTarget(type, sourceCardId) {
    const found = findCard(sourceCardId);
    if (!found) return;
    state.targetMode = { type, sourceCardId, sourceName: found.card.name };
    closeModal();
    state.activeGameTab = "table";
    render();
  }

  function chooseTarget(targetCard) {
    const source = findCard(state.targetMode.sourceCardId)?.card;
    if (!source || targetCard.id === source.id) return;
    if (state.targetMode.type === "block" && !targetCard.attacking) return showToast("Choose a card marked attacking.", "warning");
    const actionType = state.targetMode.type === "fight" ? "fight-card" : "block-card";
    const title = state.targetMode.type === "fight" ? "Confirm fight" : "Confirm block";
    openModal(title, `<div class="target-confirm"><article><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(source.effectiveStats?.power ?? source.power ?? "?")}/${escapeHtml(source.effectiveStats?.toughness ?? source.toughness ?? "?")}</span></article><div class="versus">${state.targetMode.type === "fight" ? "FIGHTS" : "BLOCKS"}</div><article><strong>${escapeHtml(targetCard.name)}</strong><span>${escapeHtml(targetCard.effectiveStats?.power ?? targetCard.power ?? "?")}/${escapeHtml(targetCard.effectiveStats?.toughness ?? targetCard.toughness ?? "?")}</span></article></div><div class="button-row"><button class="ghost-button" data-action="cancel-target">Cancel</button><button class="primary-button" data-action="confirm-target" data-game-type="${actionType}" data-source-card-id="${source.id}" data-target-card-id="${targetCard.id}">Confirm</button></div>`);
  }

  function openDeckEditor(deck = null) {
    const list = deck ? deck.cards.map((card) => `${card.quantity} ${card.name}`).join("\n") : "";
    openModal(deck ? "Edit deck" : "Import Commander deck", `<form id="deckForm"><input type="hidden" name="deckId" value="${escapeHtml(deck?.id || "")}"><label>Deck name<input name="deckName" maxlength="60" required value="${escapeHtml(deck?.name || "")}" placeholder="Toxic Control"></label><label>Commander name(s)<input name="commanders" maxlength="310" required value="${escapeHtml(deck?.commanders.join(" / ") || "")}" placeholder="Atraxa, Praetors' Voice"></label><label>Deck list<textarea name="deckList" rows="15" required placeholder="1 Sol Ring\n1 Command Tower">${escapeHtml(list)}</textarea></label><p class="form-help">Use one line per card: quantity followed by card name. Saving will identify the cards and load images, Oracle text, types, mana costs and printed stats.</p><button class="primary-button" type="submit">🧠 Identify and save deck</button></form>`);
  }

  function parseDeckList(text) {
    const map = new Map();
    for (const rawLine of String(text || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || /^(commander|deck|sideboard|maybeboard|companion)$/i.test(line)) continue;
      const match = line.match(/^(\d+)\s*[xX]?\s+(.+?)\s*$/);
      if (!match) continue;
      const quantity = Math.max(1, Math.min(100, Number(match[1])));
      const name = match[2].replace(/\s+\([^)]*\)\s+\d+\s*$/, "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = map.get(key);
      if (existing) existing.quantity += quantity;
      else map.set(key, { name, quantity });
    }
    return [...map.values()];
  }

  async function gameAction(action) {
    const response = await emitAck("game-action", { action });
    if (!response.success) return showToast(response.error, "error");
    if (response.room) state.room = response.room;
    closeModal();
    render();
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button, [data-action]");
    if (!button) return;
    const action = button.dataset.action;

    if (button.dataset.nav) {
      if (state.room && button.dataset.nav !== "game") return showToast("Leave the room before changing sections.", "warning");
      state.view = button.dataset.nav;
      render();
      return;
    }

    if (action === "close-modal") return closeModal();
    if (action === "import-deck") return openDeckEditor();
    if (action === "edit-deck") return openDeckEditor(deckById(button.dataset.deckId));
    if (action === "delete-deck") {
      state.decks = state.decks.filter((deck) => deck.id !== button.dataset.deckId);
      saveDecks(); render(); return;
    }
    if (action === "forget-session") { clearSession(); render(); return; }
    if (action === "rejoin") return rejoinSavedRoom();
    if (action === "copy-room-code") {
      await navigator.clipboard.writeText(state.room.code).catch(() => undefined);
      return showToast(`Room code ${state.room.code} copied.`, "success");
    }
    if (action === "leave-room") {
      await emitAck("leave-room"); clearSession(); render(); return;
    }
    if (action === "toggle-ready") {
      const response = await emitAck("toggle-ready");
      if (!response.success) showToast(response.error, "error");
      else { state.room = response.room; render(); }
      return;
    }
    if (action === "roll-starting-d20") {
      const response = await emitAck("roll-starting-d20");
      if (!response.success) showToast(response.error, "error");
      else {
        state.room = response.room;
        showToast(`You rolled ${response.roll}.`, response.completed ? "success" : "info");
        render();
      }
      return;
    }
    if (action === "start-game") {
      const response = await emitAck("start-game");
      if (!response.success) showToast(response.error, "error");
      else { state.room = response.room; render(); }
      return;
    }
    if (action === "kick-player") {
      const response = await emitAck("remove-player", { targetPlayerId: button.dataset.playerId });
      if (!response.success) showToast(response.error, "error");
      return;
    }
    if (action === "game-tab") { state.activeGameTab = button.dataset.tab; render(); return; }
    if (action === "game") {
      return gameAction({ type: button.dataset.gameType, targetPlayerId: button.dataset.targetPlayerId, sourcePlayerId: button.dataset.sourcePlayerId, amount: Number(button.dataset.amount || 0) });
    }
    if (action === "card-game") {
      return gameAction({ type: button.dataset.gameType, cardId: button.dataset.cardId, amount: Number(button.dataset.amount || 0) });
    }
    if (action === "move-card") {
      return gameAction({ type: "move-card", cardId: button.dataset.cardId, fromZone: button.dataset.fromZone, toZone: button.dataset.toZone });
    }
    if (action === "open-card") return openCardActions(button.dataset.cardId, button.dataset.zone, button.dataset.ownerId, button.dataset.canControl === "1");
    if (action === "open-counter-menu") return openCounterMenu(button.dataset.cardId);
    if (action === "open-stats-menu") return openStatsMenu(button.dataset.cardId);
    if (action === "apply-counter") return gameAction({ type: "card-counter", cardId: button.dataset.cardId, counterName: button.dataset.counterName, amount: Number(button.dataset.amount) });
    if (action === "start-fight") return beginTarget("fight", button.dataset.cardId);
    if (action === "start-block") return beginTarget("block", button.dataset.cardId);
    if (action === "cancel-target") { state.targetMode = null; closeModal(); render(); return; }
    if (action === "confirm-target") {
      const type = button.dataset.gameType;
      state.targetMode = null;
      return gameAction({ type, sourceCardId: button.dataset.sourceCardId, targetCardId: button.dataset.targetCardId });
    }
    if (action === "roll") { state.toolResult = `d${button.dataset.sides}: ${1 + Math.floor(Math.random() * Number(button.dataset.sides))}`; render(); return; }
    if (action === "coin") { state.toolResult = Math.random() < 0.5 ? "Heads" : "Tails"; render(); return; }
    if (action === "reset-game") {
      const response = await emitAck("reset-game");
      if (!response.success) showToast(response.error, "error");
      return;
    }
  });

  document.addEventListener("change", async (event) => {
    if (event.target.id !== "lobbyDeckSelect") return;
    const deck = deckById(event.target.value);
    const response = await emitAck("set-player-deck", { deck });
    if (!response.success) showToast(response.error, "error");
    else { state.room = response.room; render(); }
  });

  document.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);

    if (form.id === "createRoomForm") {
      rememberPlayerName(data.get("playerName"));
      const response = await emitAck("create-room", { playerName: data.get("playerName"), maxPlayers: Number(data.get("maxPlayers")), startingLife: Number(data.get("startingLife")) }, false);
      if (!response.success) showToast(response.error, "error");
      else { setSession(response); render(); }
    }
    if (form.id === "joinRoomForm") {
      rememberPlayerName(data.get("playerName"));
      const response = await emitAck("join-room", { playerName: data.get("playerName"), roomCode: data.get("roomCode") }, false);
      if (!response.success) showToast(response.error, "error");
      else { setSession(response); render(); }
    }
    if (form.id === "deckForm") {
      const cards = parseDeckList(data.get("deckList"));
      const commanders = String(data.get("commanders") || "").split(/\s*\/\s*|\s*\+\s*/).map((entry) => entry.trim()).filter(Boolean).slice(0, 2);
      const totalCards = cards.reduce((sum, card) => sum + card.quantity, 0);
      if (!cards.length || !commanders.length) return showToast("Add a commander and a valid deck list.", "error");
      const submitButton = event.submitter;
      if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Identifying cards…"; }
      try {
        const lookup = await resolveCardIntelligence([...cards.map((card) => card.name), ...commanders]);
        const lookupMap = new Map(lookup.resolved.map((entry) => [cardLookupKey(entry.requestedName), entry.card]));
        const intelligentCards = cards.map((entry) => {
          const cardData = lookupMap.get(cardLookupKey(entry.name)) || null;
          return { ...entry, name: cardData?.name || entry.name, cardData };
        });
        const commanderData = commanders.map((name) => lookupMap.get(cardLookupKey(name)) || null).filter(Boolean);
        const intelligenceCount = intelligentCards.filter((entry) => entry.cardData?.scryfallId).length;
        const deck = {
          id: data.get("deckId") || uid(),
          name: String(data.get("deckName") || "Commander Deck").trim(),
          commanders: commanders.map((name) => lookupMap.get(cardLookupKey(name))?.name || name),
          commanderData,
          cards: intelligentCards,
          totalCards,
          uniqueCards: intelligentCards.length,
          intelligenceCount,
          cardDataUpdatedAt: new Date().toISOString()
        };
        const existing = state.decks.findIndex((entry) => entry.id === deck.id);
        if (existing >= 0) state.decks[existing] = deck; else state.decks.unshift(deck);
        saveDecks(); closeModal(); render();
        if (lookup.notFound?.length) showToast(`${lookup.notFound.length} card name${lookup.notFound.length === 1 ? " was" : "s were"} not recognized. They remain playable manually.`, "warning");
        else showToast(`Card intelligence loaded for ${intelligenceCount} unique cards.`, "success");
      } catch (error) {
        showToast(error.name === "AbortError" ? "Card lookup timed out. Try saving again." : error.message, "error");
        if (submitButton) { submitButton.disabled = false; submitButton.textContent = "🧠 Identify and save deck"; }
      }
    }
    if (form.id === "roomSettingsForm") {
      const response = await emitAck("update-room-settings", { maxPlayers: Number(data.get("maxPlayers")), startingLife: Number(data.get("startingLife")) });
      if (!response.success) showToast(response.error, "error");
      else { state.room = response.room; render(); }
    }
    if (form.id === "tokenForm") return gameAction({ type: "create-token", name: data.get("name"), power: data.get("power"), toughness: data.get("toughness") });
    if (form.id === "chatForm") {
      const response = await emitAck("send-chat", { message: data.get("message") });
      if (!response.success) showToast(response.error, "error");
      else form.reset();
    }
    if (form.id === "cardStatsForm") return gameAction({ type: "set-card-stats", cardId: data.get("cardId"), power: data.get("power"), toughness: data.get("toughness"), notes: data.get("notes") });
    if (form.id === "customCounterForm") {
      const submitter = event.submitter;
      return gameAction({ type: "card-counter", cardId: data.get("cardId"), counterName: data.get("counterName"), amount: Number(submitter?.value || 1) });
    }
  });

  async function rejoinSavedRoom() {
    if (!state.session || !socket.connected) return;
    const response = await emitAck("rejoin-room");
    if (!response.success) {
      clearSession(); render(); showToast(response.error, "error");
    } else {
      setSession(response); render();
    }
  }

  socket.on("connect", () => {
    setConnection("online", "Online");
    if (state.session) rejoinSavedRoom();
  });
  socket.on("disconnect", () => setConnection("offline", "Reconnecting…"));
  socket.on("connect_error", () => setConnection("offline", "Connection error"));
  socket.on("room-updated", (room) => { state.room = room; render(); });
  socket.on("removed-from-room", (payload) => { clearSession(); closeModal(); render(); showToast(payload?.message || "You left the room.", "warning"); });
  socket.on("server-message", (payload) => { if (payload?.message) showToast(payload.message, payload.type); });

  modalBackdrop.addEventListener("click", (event) => { if (event.target === modalBackdrop) closeModal(); });
  brandButton.addEventListener("click", () => { if (!state.room) { state.view = "home"; render(); } });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstallPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!state.deferredInstallPrompt) return;
    state.deferredInstallPrompt.prompt();
    await state.deferredInstallPrompt.userChoice;
    state.deferredInstallPrompt = null;
    installButton.hidden = true;
  });

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch((error) => console.warn("Service worker failed", error));
  render();
})();
