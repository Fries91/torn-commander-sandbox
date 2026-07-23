(() => {
  "use strict";

  const STORAGE = {
    decks: "tornCommander.decks.v5",
    session: "tornCommander.session.v5",
    spectator: "tornCommander.spectator.v20",
    playerName: "tornCommander.playerName.v5",
    uiSettings: "tornCommander.uiSettings.v20"
  };

  const DEFAULT_UI_SETTINGS = {
    sound: true,
    vibration: true,
    animations: true,
    lowData: false,
    highContrast: false,
    largeText: false,
    autoPassEmpty: false,
    showArrows: true,
    groupCards: true
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
  const settingsButton = document.getElementById("settingsButton");
  const fullscreenButton = document.getElementById("fullscreenButton");
  const reconnectOverlay = document.getElementById("reconnectOverlay");

  const state = {
    view: "home",
    room: null,
    previousRoom: null,
    session: loadJson(STORAGE.session, null),
    spectator: loadJson(STORAGE.spectator, null),
    decks: loadJson(STORAGE.decks, []),
    uiSettings: { ...DEFAULT_UI_SETTINGS, ...loadJson(STORAGE.uiSettings, {}) },
    activeGameTab: "table",
    activeDrawer: null,
    targetMode: null,
    dragSource: null,
    expandedGroups: {},
    fullControl: false,
    replayFrameId: null,
    deferredInstallPrompt: null,
    toolResult: "—",
    autoPassTimer: null,
    audioContext: null
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
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (error) { console.warn(`Unable to save ${key}`, error); }
  }

  function removeStored(key) {
    try { localStorage.removeItem(key); } catch (error) { console.warn(`Unable to remove ${key}`, error); }
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
    try { return localStorage.getItem(STORAGE.playerName) || ""; }
    catch { return ""; }
  }

  function rememberPlayerName(name) {
    try { localStorage.setItem(STORAGE.playerName, String(name || "").trim()); }
    catch (error) { console.warn("Unable to remember player name", error); }
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
    state.spectator = null;
    removeStored(STORAGE.spectator);
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

  function setSpectator(response, name) {
    state.session = null;
    removeStored(STORAGE.session);
    state.spectator = { roomCode: response.room.code, name: String(name || "Spectator").trim(), spectatorId: response.spectatorId };
    saveJson(STORAGE.spectator, state.spectator);
    state.room = response.room;
    state.view = "game";
    state.targetMode = null;
  }

  function clearSession() {
    state.session = null;
    state.spectator = null;
    state.room = null;
    state.targetMode = null;
    state.activeDrawer = null;
    removeStored(STORAGE.session);
    removeStored(STORAGE.spectator);
    state.view = "home";
    state.activeGameTab = "table";
  }

  function currentPlayer() {
    return state.room?.players.find((player) => player.id === state.session?.playerId) || null;
  }

  function isSpectator() {
    return Boolean(state.spectator && !state.session);
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

  function applyUiSettings() {
    document.documentElement.classList.toggle("low-data", Boolean(state.uiSettings.lowData));
    document.documentElement.classList.toggle("reduce-motion", !state.uiSettings.animations);
    document.documentElement.classList.toggle("high-contrast", Boolean(state.uiSettings.highContrast));
    document.documentElement.classList.toggle("large-text", Boolean(state.uiSettings.largeText));
    document.body.classList.toggle("in-game", Boolean(state.room?.status === "started"));
  }

  function render() {
    applyUiSettings();
    if (state.room) {
      setActiveNav("game");
      app.innerHTML = state.room.status === "waiting"
        ? (isSpectator() ? renderSpectatorWaiting() : renderLobby())
        : state.room.status === "rolloff"
          ? (isSpectator() ? renderSpectatorRollOff() : renderRollOff())
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
    window.requestAnimationFrame(() => {
      drawArenaLines();
      observeCardImages();
      updateTurnClock();
    });
    if (state.room?.status === "started" && state.activeGameTab === "chat") {
      const messages = document.querySelector(".chat-messages");
      if (messages) messages.scrollTop = messages.scrollHeight;
    }
  }

  function renderHome() {
    const savedRoom = state.session?.roomCode;
    const savedSpectator = state.spectator?.roomCode;
    return `
      <section class="hero-panel arena-hero">
        <div><p class="eyebrow">Arena Commander v35 • 2–6 Players</p><h1>A full digital Commander table built for phones, tablets and desktop.</h1><p>Real cards, shared stack and priority, assisted combat, clockwise turns, drag-and-drop, spectators, replays and persistent games.</p></div>
        <div class="hero-orb">♛</div>
      </section>
      ${savedRoom ? `<section class="notice-row"><strong>Saved player room ${escapeHtml(savedRoom)}</strong><div class="button-row"><button class="primary-button" data-action="rejoin">Rejoin</button><button class="ghost-button" data-action="forget-session">Forget</button></div></section>` : ""}
      ${savedSpectator ? `<section class="notice-row"><strong>Saved spectator room ${escapeHtml(savedSpectator)}</strong><div class="button-row"><button class="primary-button" data-action="rejoin-spectator">Watch again</button><button class="ghost-button" data-action="forget-session">Forget</button></div></section>` : ""}
      <section class="home-grid three">
        <form id="createRoomForm" class="panel">
          <p class="eyebrow">Host</p><h2>Create game</h2>
          <label>Player name<input name="playerName" maxlength="24" required value="${escapeHtml(playerName())}" placeholder="Fries91"></label>
          <div class="form-grid two"><label>Players<select name="maxPlayers">${[2,3,4,5,6].map((n) => `<option value="${n}" ${n === 6 ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Starting life<select name="startingLife">${[25,30,40].map((n) => `<option value="${n}" ${n === 40 ? "selected" : ""}>${n}</option>`).join("")}</select></label></div>
          <button class="primary-button" type="submit">Create private room</button>
        </form>
        <form id="joinRoomForm" class="panel">
          <p class="eyebrow">Player</p><h2>Join game</h2>
          <label>Player name<input name="playerName" maxlength="24" required value="${escapeHtml(playerName())}" placeholder="Your Torn name"></label>
          <label>Room code<input name="roomCode" maxlength="6" required autocomplete="off" autocapitalize="characters" placeholder="ABC234"></label>
          <button class="secondary-button" type="submit">Join room</button>
        </form>
        <form id="spectatorForm" class="panel spectator-panel">
          <p class="eyebrow">Spectator</p><h2>Watch a table</h2>
          <label>Display name<input name="name" maxlength="24" required value="${escapeHtml(playerName() || "Spectator")}" placeholder="Spectator"></label>
          <label>Room code<input name="roomCode" maxlength="6" required autocomplete="off" autocapitalize="characters" placeholder="ABC234"></label>
          <button class="ghost-button" type="submit">Enter spectator mode</button>
        </form>
      </section>
      <section class="panel ai-test-lab-panel">
        <div class="section-heading"><div><p class="eyebrow">Solo Test Lab</p><h2>Your deck vs an AI Commander deck</h2><p>Import two decks, choose a bot level, then test opening hands, sequencing, combat and responses without waiting for another player.</p></div><span class="badge info">v35 AI</span></div>
        ${state.decks.length >= 2 ? `<form id="createTestLabForm" class="ai-test-form"><div class="form-grid two"><label>Your deck<select name="playerDeckId" required><option value="">Choose your deck…</option>${state.decks.map((deck)=>`<option value="${escapeAttribute(deck.id)}">${escapeHtml(deck.name)} — ${escapeHtml(deck.commanders.join(" / "))}</option>`).join("")}</select></label><label>Bot deck<select name="botDeckId" required><option value="">Choose opponent deck…</option>${state.decks.map((deck)=>`<option value="${escapeAttribute(deck.id)}">${escapeHtml(deck.name)} — ${escapeHtml(deck.commanders.join(" / "))}</option>`).join("")}</select></label><label>Bot difficulty<select name="difficulty"><option value="beginner">Beginner</option><option value="skilled">Skilled</option><option value="competitive">Competitive</option><option value="expert" selected>Expert</option></select></label><label>Starting life<select name="startingLife">${[25,30,40].map((n)=>`<option value="${n}" ${n===40?"selected":""}>${n}</option>`).join("")}</select></label><label>Starting player<select name="startingPlayer"><option value="random">Random</option><option value="human">You</option><option value="bot">Bot</option></select></label><label>Bot action speed<select name="speedMs"><option value="250">Very fast</option><option value="500">Fast</option><option value="900" selected>Normal</option><option value="1400">Slow</option><option value="2200">Study mode</option></select></label></div><input type="hidden" name="playerName" value="${escapeAttribute(playerName() || "Fries91")}"><button class="primary-button" type="submit">Launch Solo Test Lab</button></form>` : `<div class="empty-state"><p>Import at least two Commander decks to launch a test.</p><button class="primary-button" data-action="import-deck">Import a deck</button></div>`}
      </section>
      <section class="panel"><div class="section-heading"><div><p class="eyebrow">Saved on this device</p><h2>My decks</h2></div><div class="button-row"><button class="ghost-button" data-action="open-ui-settings">Display settings</button><button class="primary-button" data-action="import-deck">Import deck</button></div></div>${state.decks.length ? `<div class="deck-grid">${state.decks.slice(0, 4).map(renderDeckCard).join("")}</div>` : `<div class="empty-state">No decks imported yet.</div>`}</section>
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
    const settings = state.room.settings || {};
    return `
      <section class="panel lobby-top"><div><p class="eyebrow">Private Arena Commander lobby</p><h1>Room <span class="room-code">${escapeHtml(state.room.code)}</span></h1><p>${state.room.players.length}/${state.room.maxPlayers} players • ${state.room.startingLife} life • ${state.room.spectatorCount || 0} watching</p><div>${persistenceBadge()}</div></div><div class="button-row"><button class="secondary-button" data-action="copy-room-code">Copy code</button><button class="ghost-button" data-action="leave-room">Leave</button></div></section>
      <section class="lobby-grid">
        <div class="panel"><div class="section-heading"><h2>Clockwise seats</h2><span class="badge ${allReady ? "success" : "warning"}">${allReady ? "Ready" : "Waiting"}</span></div><div class="player-list">${state.room.players.map(renderLobbyPlayer).join("")}</div>${state.room.spectators?.length ? `<div class="spectator-list"><strong>Spectators</strong><span>${state.room.spectators.map((entry) => escapeHtml(entry.name)).join(", ")}</span></div>` : ""}</div>
        <div class="panel"><h2>Your setup</h2><label>Commander deck<select id="lobbyDeckSelect"><option value="">Choose a deck…</option>${state.decks.map((deck) => `<option value="${escapeHtml(deck.id)}" ${deck.id === selectedDeckId ? "selected" : ""}>${escapeHtml(deck.name)} — ${escapeHtml(deck.commanders.join(" / "))}</option>`).join("")}</select></label><div class="button-row"><button class="secondary-button" data-action="import-deck">Import deck</button><button class="primary-button" data-action="toggle-ready" ${!me?.deck ? "disabled" : ""}>${me?.ready ? "Mark not ready" : "Mark ready"}</button></div>${isHost() ? `<div class="divider"></div><form id="roomSettingsForm"><div class="form-grid two"><label>Maximum players<select name="maxPlayers">${[2,3,4,5,6].map((n) => `<option value="${n}" ${n === state.room.maxPlayers ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Starting life<select name="startingLife">${[25,30,40].map((n) => `<option value="${n}" ${n === state.room.startingLife ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Turn timer<select name="turnTimerSeconds">${[[0,"Off"],[60,"1 minute"],[90,"90 seconds"],[120,"2 minutes"],[180,"3 minutes"],[300,"5 minutes"]].map(([value,label]) => `<option value="${value}" ${Number(settings.turnTimerSeconds || 0) === value ? "selected" : ""}>${label}</option>`).join("")}</select></label><label class="check-row"><input type="checkbox" name="allowSpectators" value="1" ${settings.allowSpectators !== false ? "checked" : ""}> Allow spectators</label><label class="check-row"><input type="checkbox" name="enforceDeckRules" value="1" ${settings.enforceDeckRules !== false ? "checked" : ""}> Enforce Commander validation</label><label class="check-row"><input type="checkbox" name="autoStateBasedActions" value="1" ${settings.autoStateBasedActions !== false ? "checked" : ""}> Automatic state-based actions</label><label class="check-row"><input type="checkbox" name="freeCommanderMulligan" value="1" ${settings.freeCommanderMulligan !== false ? "checked" : ""}> Free first multiplayer mulligan</label><label class="check-row"><input type="checkbox" name="allowInvalidDecks" value="1" ${settings.allowInvalidDecks ? "checked" : ""}> Judge override: allow invalid decks</label></div><div class="button-row"><button class="secondary-button" type="submit">Save settings</button><button class="primary-button" type="button" data-action="start-game" ${allReady ? "" : "disabled"}>Start d20 roll-off</button></div></form>` : ""}</div>
      </section>
      ${isHost() && state.room.players.length < state.room.maxPlayers ? `<section class="panel lobby-bot-panel"><div class="section-heading"><div><p class="eyebrow">Optional AI seats</p><h2>Add a Commander bot</h2><p>Mix human and bot seats in any combination up to the room limit.</p></div><span class="badge info">${state.room.players.filter((player)=>player.isBot).length} bots</span></div>${state.decks.length ? `<form id="addBotForm"><div class="form-grid two"><label>Bot deck<select name="deckId" required><option value="">Choose a deck…</option>${state.decks.map((deck)=>`<option value="${escapeAttribute(deck.id)}">${escapeHtml(deck.name)} — ${escapeHtml(deck.commanders.join(" / "))}</option>`).join("")}</select></label><label>Difficulty<select name="difficulty"><option value="beginner">Beginner</option><option value="skilled">Skilled</option><option value="competitive">Competitive</option><option value="expert" selected>Expert</option></select></label><label>Bot name<input name="name" maxlength="24" placeholder="Commander Bot"></label></div><button class="secondary-button" type="submit">Add AI seat</button></form>` : `<div class="empty-state">Import a deck before adding a bot seat.</div>`}</section>` : ""}
    `;
  }

  function renderSpectatorWaiting() {
    return `<section class="panel spectator-waiting"><p class="eyebrow">Spectator mode</p><h1>Watching room ${escapeHtml(state.room.code)}</h1><p>The game is still in the lobby. You will enter the Arena table automatically when it starts.</p><div class="player-list">${state.room.players.map(renderLobbyPlayer).join("")}</div><button class="ghost-button" data-action="leave-spectator">Leave spectator mode</button></section>`;
  }

  function renderLobbyPlayer(player) {
    const self = player.id === state.session?.playerId;
    return `<article class="lobby-player ${player.isBot ? "is-bot" : ""}"><div><strong>${escapeHtml(player.name)}</strong> ${player.id === state.room.hostId ? `<span class="badge info">Host</span>` : ""} ${self ? `<span class="badge">You</span>` : ""} ${player.isBot ? `<span class="badge ai-badge">AI ${escapeHtml(player.botState?.difficulty || "skilled")}</span>` : ""}<p>${player.deck ? `${escapeHtml(player.deck.name)} • ${escapeHtml(player.deck.commanders.join(" / "))}` : "No deck selected"}</p></div><div><span class="status-dot ${player.connected ? "online" : "offline"}"></span>${player.isBot ? "AI ready" : player.connected ? (player.ready ? "Ready" : "Waiting") : "Offline"}${isHost() && !self ? `<button class="small-button danger-button" data-action="kick-player" data-player-id="${player.id}">Remove</button>` : ""}</div></article>`;
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
          <button class="primary-button roll-d20-button" data-action="roll-starting-d20" ${!eligible || hasRolled || !me.connected || me.game?.mulliganBottomRequired ? "disabled" : ""}>🎲 Roll d20</button>
          <div class="divider"></div><h3>Opening hand</h3><p>${me.game?.mulliganCount ? `Mulligans taken: ${me.game.mulliganCount}` : "Commander multiplayer gives one free mulligan."}</p>${me.game?.mulliganBottomRequired ? `<form id="finishMulliganForm"><p>Choose exactly ${me.game.mulliganBottomRequired} card(s) for the bottom.</p><div class="mulligan-card-list">${(me.game.hand || []).map((card)=>`<label><input type="checkbox" name="cardIds" value="${card.id}"> ${escapeHtml(card.name)}</label>`).join("")}</div><button class="primary-button" type="submit">Finish mulligan</button></form>` : `<button class="secondary-button" data-action="game" data-game-type="take-mulligan">Take mulligan</button>`}
          <div class="divider"></div>
          <h3>Previous rounds</h3>
          <div class="roll-history">${previousRounds || `<div class="empty-state">No completed round yet.</div>`}</div>
        </div>
      </section>
    `;
  }

  function renderSpectatorRollOff() {
    const rollOff = state.room.rollOff;
    return `<section class="rolloff-shell spectator-rolloff"><div class="rolloff-hero"><p class="eyebrow">Spectator mode • Starting-player roll</p><h1>d20 roll-off</h1><p>Waiting for all players to roll. Tied highest players automatically reroll.</p></div><div class="dice-player-grid">${orderedPlayers().map((player) => { const roll = latestStartingRoll(player.id); return `<article class="dice-player-card"><strong>${escapeHtml(player.name)}</strong><div class="d20-face ${roll ? "has-roll" : ""}">${roll ?? "?"}</div><span>${roll ? `Rolled ${roll}` : "Waiting"}</span></article>`; }).join("")}</div><button class="ghost-button" data-action="leave-spectator">Leave spectator mode</button></section>`;
  }

  function saveUiSettings() {
    saveJson(STORAGE.uiSettings, state.uiSettings);
    applyUiSettings();
  }

  function openUiSettings() {
    const setting = (key, label, help) => `<label class="arena-setting"><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(help)}</small></span><input type="checkbox" name="${key}" ${state.uiSettings[key] ? "checked" : ""}></label>`;
    openModal("Arena display settings", `<form id="uiSettingsForm"><div class="settings-list">${setting("sound","Sound cues","Your turn, priority, damage and spells.")}${setting("vibration","Vibration","Short haptic alerts on supported phones.")}${setting("animations","Animations","Card movement, glows and transitions.")}${setting("lowData","Low-data mode","Hide card artwork and reduce network use.")}${setting("highContrast","High contrast","Stronger borders and brighter readable text.")}${setting("largeText","Larger text","Increase interface and card label sizes.")}${setting("autoPassEmpty","Auto-pass empty priority","Automatically pass when the stack is empty and it is not your turn.")}${setting("showArrows","Targeting arrows","Show attacks, blocks and attachments as arrows.")}${setting("groupCards","Group similar cards","Stack identical lands and simple tokens together.")}</div><button class="primary-button" type="submit">Save settings</button></form>`);
  }

  function manaSymbolHtml(cost) {
    const parts = String(cost || "").match(/\{[^}]+\}/g) || [];
    return parts.map((part) => `<span class="mana-symbol mana-${escapeAttribute(part.slice(1,-1).toLowerCase().replace(/\//g,"-"))}">${escapeHtml(part.slice(1,-1))}</span>`).join("");
  }

  function playerById(id) {
    return state.room?.players.find((player) => player.id === id) || null;
  }

  function recentEmote(playerId) {
    const cutoff = Date.now() - 9000;
    return [...(state.room?.emotes || [])].reverse().find((entry) => entry.playerId === playerId && Date.parse(entry.time) >= cutoff) || null;
  }

  function turnSecondsRemaining() {
    const deadline = Date.parse(state.room?.turn?.deadlineAt || "");
    if (!Number.isFinite(deadline)) return null;
    return Math.ceil((deadline - Date.now()) / 1000);
  }

  function formatClock(seconds) {
    if (seconds == null) return "";
    const overdue = seconds < 0;
    const value = Math.abs(seconds);
    const minutes = Math.floor(value / 60);
    const remainder = String(value % 60).padStart(2, "0");
    return `${overdue ? "−" : ""}${minutes}:${remainder}`;
  }

  function updateTurnClock() {
    const element = document.getElementById("turnClock");
    if (!element) return;
    const remaining = turnSecondsRemaining();
    element.textContent = remaining == null ? "No timer" : formatClock(remaining);
    element.classList.toggle("is-low", remaining != null && remaining <= 20);
    element.classList.toggle("is-overdue", remaining != null && remaining < 0);
  }

  function renderPhaseBar() {
    const current = state.room.turn?.phaseIndex || 0;
    return `<div class="arena-phase-bar">${state.room.phases.map((phase,index) => `<button type="button" class="arena-phase ${index === current ? "is-current" : ""} ${index < current ? "is-past" : ""}" data-action="phase-step" data-phase-index="${index}" ${isSpectator() || (index !== current + 1 && index !== current) ? "disabled" : ""}><span>${index + 1}</span>${escapeHtml(phase.replace("Beginning ","").replace("Declare ",""))}</button>`).join("")}</div>`;
  }

  function combatPreview() {
    const attacks = [];
    const outcomes = new Map();
    for (const attackerPlayer of state.room.players) {
      for (const attacker of attackerPlayer.game?.battlefield || []) {
        if (!attacker.attacking || attacker.phasedOut) continue;
        const defender = playerById(attacker.defendingPlayerId);
        if (!defender) continue;
        const blockers = state.room.players.flatMap((player) => (player.game?.battlefield || []).filter((card) => card.blockingCardId === attacker.id));
        const power = Number(attacker.effectiveStats?.power);
        const amount = Number.isFinite(power) ? Math.max(0,power) : 0;
        attacks.push({ attacker, attackerPlayer, defender, blockers, amount });
        if (!blockers.length) outcomes.set(defender.id, (outcomes.get(defender.id) || 0) + amount);
      }
    }
    if (!attacks.length) return `<div class="combat-empty"><span>⚔</span><strong>No attackers declared</strong><small>Drag a creature to an opponent or use its action menu.</small></div>`;
    return `<div class="combat-preview"><strong>Combat preview</strong>${[...outcomes.entries()].map(([id,amount]) => `<span>${escapeHtml(playerById(id)?.name || "Player")}: approximately ${amount} unblocked damage</span>`).join("")}${attacks.map((entry) => `<small>${escapeHtml(entry.attacker.name)} → ${escapeHtml(entry.defender.name)}${entry.blockers.length ? ` • blocked by ${entry.blockers.map((card) => escapeHtml(card.name)).join(", ")}` : " • unblocked"}</small>`).join("")}</div>`;
  }

  function simpleGroupKey(card) {
    const type = cardTypeLine(card);
    const groupable = card.token || /\bLand\b/i.test(type);
    if (!groupable || card.damageMarked || card.attacking || card.blockingCardId || card.attachedToId || card.lethal || Object.keys(card.counters || {}).length || card.temporaryEffects?.length) return `single:${card.id}`;
    return `${card.name}|${card.tapped ? 1 : 0}|${card.faceDown ? 1 : 0}|${card.phasedOut ? 1 : 0}`;
  }

  function groupedBattlefieldCards(cards) {
    if (!state.uiSettings.groupCards) return cards.map((card) => ({ key: `single:${card.id}`, cards: [card] }));
    const groups = new Map();
    for (const card of cards) {
      if (card.attachedToId) continue;
      const key = simpleGroupKey(card);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(card);
    }
    return [...groups.entries()].map(([key,entries]) => ({ key, cards: entries }));
  }

  function renderBattlefield(player, self = false) {
    const battlefield = player.game?.battlefield || [];
    const attachmentsByTarget = new Map();
    for (const card of battlefield) {
      if (!card.attachedToId) continue;
      if (!attachmentsByTarget.has(card.attachedToId)) attachmentsByTarget.set(card.attachedToId, []);
      attachmentsByTarget.get(card.attachedToId).push(card);
    }
    const groups = groupedBattlefieldCards(battlefield);
    if (!groups.length) return `<div class="arena-empty-board">No permanents</div>`;
    return `<div class="arena-battlefield-cards">${groups.map((group) => {
      const expanded = state.expandedGroups[group.key];
      const shown = expanded ? group.cards : group.cards.slice(0,1);
      return `<div class="arena-card-group ${group.cards.length > 1 ? "is-stack" : ""}" data-group-key="${escapeAttribute(group.key)}">${shown.map((card,index) => renderCard(card,"battlefield",player.id,self,{ stackCount: index === 0 ? group.cards.length : 1, attachments: attachmentsByTarget.get(card.id) || [] })).join("")}${group.cards.length > 1 ? `<button class="card-stack-count" data-action="toggle-card-group" data-group-key="${escapeAttribute(group.key)}">${expanded ? "Collapse" : `×${group.cards.length}`}</button>` : ""}</div>`;
    }).join("")}</div>`;
  }

  function renderZonePiles(player, self) {
    const game = player.game;
    const pile = (zone,label,count,symbol) => `<button class="arena-zone-pile zone-${zone}" data-action="open-zone-drawer" data-zone="${zone}" data-player-id="${player.id}" ${!self && zone === "hand" ? "disabled" : ""} data-drop-zone="${self ? zone : ""}"><span>${symbol}</span><strong>${count}</strong><small>${label}</small></button>`;
    return `<div class="arena-zone-piles">${pile("library","Library",game.libraryCount,"▤")}${pile("graveyard","Grave",game.graveyard.length,"☠")}${pile("exile","Exile",game.exile.length,"◇")}${pile("commandZone","Command",game.commandZone.length,"♛")}${pile("hand","Hand",game.handCount ?? game.hand?.length ?? 0,"▱")}</div>`;
  }

  function renderCommanderDamageMini(player) {
    const entries = Object.entries(player.game?.commanderDamage || {}).filter(([,amount]) => amount > 0);
    if (!entries.length) return "";
    return `<div class="commander-damage-mini">${entries.map(([sourceId,amount]) => `<span title="Commander damage from ${escapeAttribute(playerById(sourceId)?.name || "Player")}">♛${amount}</span>`).join("")}</div>`;
  }

  function renderArenaSeat(player, self = false, spectatorFocus = false) {
    const game = player.game;
    if (!game) return "";
    const active = player.id === state.room.turn?.activePlayerId;
    const priority = player.id === state.room.priority?.playerId;
    const emote = recentEmote(player.id);
    const canAdjust = !isSpectator();
    return `<section class="arena-seat ${self ? "is-self" : "is-opponent"} ${spectatorFocus ? "is-spectator-focus" : ""} ${active ? "is-active" : ""} ${priority ? "has-priority" : ""} ${game.conceded ? "is-conceded" : ""}" data-player-seat-id="${player.id}" data-drop-player-id="${player.id}">
      ${emote ? `<div class="seat-emote">${escapeHtml(emote.emoji)}</div>` : ""}
      <header class="arena-seat-header"><div class="seat-avatar">${escapeHtml(player.name.slice(0,2).toUpperCase())}</div><div class="seat-name"><strong>${escapeHtml(player.name)} ${player.isBot ? `<span class="seat-ai-mark">AI</span>` : ""}</strong><small>${escapeHtml(player.deck?.commanders.join(" / ") || "Commander")}</small></div><div class="seat-status">${active ? `<span>TURN</span>` : ""}${priority ? `<span>PRIORITY</span>` : ""}${player.isBot && player.botState?.thinking ? `<span>THINKING</span>` : ""}${!player.connected ? `<span>OFFLINE</span>` : ""}</div></header>
      <div class="seat-life"><button ${canAdjust ? "" : "disabled"} data-action="game" data-game-type="life" data-target-player-id="${player.id}" data-amount="-1">−</button><div><strong>${game.life}</strong><small>life</small></div><button ${canAdjust ? "" : "disabled"} data-action="game" data-game-type="life" data-target-player-id="${player.id}" data-amount="1">+</button></div>
      <div class="seat-secondary"><span>☠ ${game.poison}</span><span>♛ tax ${game.commanderTax}</span><span>▱ ${game.handCount ?? game.hand?.length ?? 0}</span>${renderCommanderDamageMini(player)}</div>
      <div class="arena-seat-board">${renderBattlefield(player,self)}</div>
      ${renderZonePiles(player,self)}
    </section>`;
  }

  function renderHandTray(me) {
    if (!me?.game?.hand) return "";
    const cards = me.game.hand;
    return `<section class="arena-hand-tray ${state.uiSettings.lowData ? "low-data-hand" : ""}" data-drop-zone="hand"><div class="hand-label"><strong>Your hand</strong><span>${cards.length}</span></div><div class="arena-hand-fan">${cards.map((card,index) => { const delta = index - (cards.length - 1) / 2; return `<div class="hand-card-wrap" style="--hand-rotate:${delta * 2.4}deg;--hand-lift:${Math.abs(delta) * 1.4}px">${renderCard(card,"hand",me.id,true)}</div>`; }).join("")}</div></section>`;
  }

  function renderTargetBanner() {
    return `<div class="arena-target-banner"><strong>${escapeHtml(state.targetMode.sourceName)}</strong><span>${state.targetMode.type === "fight" ? "Choose a creature to fight" : state.targetMode.type === "block" ? "Choose an attacking creature" : "Choose a permanent to attach to"}</span><button data-action="cancel-target">Cancel</button></div>`;
  }

  function renderStackPreview() {
    const top = state.room.stack.at(-1);
    if (!top) return `<button class="center-stack empty" data-action="open-arena-drawer" data-drawer="mechanics"><span>STACK</span><strong>Empty</strong></button>`;
    return `<button class="center-stack" data-action="open-arena-drawer" data-drawer="mechanics"><span>STACK • ${state.room.stack.length}</span><strong>${escapeHtml(top.name)}</strong><small>${escapeHtml(playerById(top.controllerId)?.name || "Unknown")}</small></button>`;
  }

  function renderArenaDrawer() {
    const drawer = state.activeDrawer || (state.activeGameTab !== "table" ? state.activeGameTab : null);
    if (!drawer) return "";
    let title = "Table drawer";
    let content = "";
    if (drawer === "zones") { title = "Your zones"; content = isSpectator() ? `<div class="empty-state">Spectators cannot view hidden hands.</div>` : renderZonesTab(); }
    if (drawer === "mechanics") { title = "Stack, priority & triggers"; content = renderMechanicsTab(); }
    if (drawer === "tools") { title = "Table tools"; content = renderToolsTab(); }
    if (drawer === "chat") { title = "Table chat"; content = renderChatTab(); }
    if (drawer === "replay") { title = "Replay timeline"; content = renderReplayDrawer(); }
    if (drawer === "rules") { title = "Rules & Judge Mode"; content = renderRulesDrawer(); }
    return `<aside class="arena-drawer drawer-${drawer}"><header><h2>${escapeHtml(title)}</h2><button class="icon-button" data-action="close-arena-drawer">×</button></header><div class="arena-drawer-body">${content}</div></aside><button class="drawer-scrim" data-action="close-arena-drawer" aria-label="Close drawer"></button>`;
  }

  function renderReplayDrawer() {
    const frames = [...(state.room.replayFrames || [])].reverse();
    return frames.length ? `<div class="replay-list">${frames.map((frame,index) => `<button class="replay-frame-button" data-action="view-replay-frame" data-frame-id="${frame.id}"><span>${frames.length-index}</span><div><strong>${escapeHtml(frame.label)}</strong><small>${escapeHtml(frame.actorName || "Table")} • ${formatTime(frame.time)} • ${escapeHtml(frame.phase || "")}</small></div></button>`).join("")}</div>` : `<div class="empty-state">Replay frames appear after game actions.</div>`;
  }

  function renderArenaBottomBar(me) {
    const priorityMine = state.room.priority?.playerId === me?.id;
    const activeMine = state.room.turn?.activePlayerId === me?.id;
    return `<nav class="arena-action-bar">
      <button data-action="open-arena-drawer" data-drawer="zones"><span>▱</span>Zones</button>
      <button data-action="open-arena-drawer" data-drawer="mechanics"><span>⚡</span>Stack${state.room.stack.length ? `<b>${state.room.stack.length}</b>` : ""}</button>
      <button data-action="open-arena-drawer" data-drawer="chat"><span>●</span>Chat</button>
      ${isSpectator() ? `<div class="spectator-action"><strong>SPECTATING</strong><button data-action="leave-spectator">Leave</button></div>` : `<button class="full-control-button ${state.fullControl ? "active" : ""}" data-action="toggle-full-control"><span>◎</span>Full control</button><button class="priority-button ${priorityMine ? "is-ready" : ""}" data-action="game" data-game-type="pass-priority" ${priorityMine ? "" : "disabled"}><span>${priorityMine ? "PASS" : "WAIT"}</span><small>${priorityMine ? "Priority" : escapeHtml(playerById(state.room.priority?.playerId)?.name || "")}</small></button><button class="turn-button ${activeMine ? "is-ready" : ""}" data-action="game" data-game-type="end-turn" ${activeMine || isHost() ? "" : "disabled"}><span>END</span><small>Turn</small></button>`}
      <button data-action="open-emotes" ${isSpectator() ? "disabled" : ""}><span>☺</span>Emote</button>
      <button data-action="open-arena-drawer" data-drawer="rules"><span>⚖</span>Rules${(state.room.rules?.decisions || []).filter((entry) => entry.status === "open").length ? `<b>${(state.room.rules.decisions || []).filter((entry) => entry.status === "open").length}</b>` : ""}</button>
      <button data-action="open-arena-drawer" data-drawer="replay"><span>↶</span>Replay</button>
    </nav>`;
  }

  function renderGame() {
    const players = orderedPlayers();
    const me = currentPlayer();
    const active = playerById(state.room.turn?.activePlayerId);
    const priority = playerById(state.room.priority?.playerId);
    const opponents = me ? players.filter((player) => player.id !== me.id) : players;
    const phase = state.room.phases[state.room.turn?.phaseIndex || 0] || "Untap";
    return `<div class="arena-game-shell player-count-${players.length} ${isSpectator() ? "spectator-mode" : ""}">
      ${state.targetMode ? renderTargetBanner() : ""}
      <header class="arena-game-topbar"><div class="arena-room-meta"><button class="room-pill" data-action="copy-room-code">${escapeHtml(state.room.code)}</button>${state.room.mode === "test-lab" ? `<span class="badge ai-badge">SOLO TEST LAB</span>` : state.room.players.some((player)=>player.isBot) ? `<span class="badge ai-badge">AI TABLE</span>` : ""}<span>Turn ${state.room.turn?.number || 1}</span><strong>${escapeHtml(active?.name || "Player")}</strong><span>${escapeHtml(phase)}</span>${persistenceBadge()}</div><div class="arena-top-actions"><span class="priority-label">Priority: <strong>${escapeHtml(priority?.name || "—")}</strong></span><span id="turnClock" class="turn-clock">${formatClock(turnSecondsRemaining())}</span><button data-action="open-ui-settings">⚙</button><button data-action="toggle-fullscreen">⛶</button></div></header>
      ${renderPhaseBar()}
      <main class="arena-stage">
        <svg id="arenaLines" class="arena-lines" aria-hidden="true"><defs><marker id="arrowAttack" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z"></path></marker><marker id="arrowLink" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z"></path></marker></defs></svg>
        <div class="arena-opponent-ring count-${opponents.length}">${opponents.map((player,index) => `<div class="opponent-slot slot-${index+1}">${renderArenaSeat(player,false,!me && index === 0)}</div>`).join("")}</div>
        <section class="arena-center-zone">${renderStackPreview()}${state.room.settings?.showCombatPreview !== false ? combatPreview() : ""}<div class="arena-center-controls">${!isSpectator() ? `<button data-action="game" data-game-type="next-phase">Next phase</button><button data-action="combat-damage" data-pass="first">First strike</button><button data-action="combat-damage" data-pass="normal">Combat damage</button>` : ""}</div></section>
        ${me ? `<div class="self-slot">${renderArenaSeat(me,true)}</div>${renderHandTray(me)}` : ""}
      </main>
      ${renderArenaBottomBar(me)}
      ${renderArenaDrawer()}
    </div>`;
  }


  function renderPlayerCard(player) {
    const game = player.game;
    const self = player.id === state.session.playerId;
    const active = player.id === state.room.turn?.activePlayerId;
    const sources = state.room.players.filter((source) => source.id !== player.id);
    return `<article class="player-card ${self ? "is-self" : ""} ${active ? "is-active" : ""} ${game.conceded ? "is-conceded" : ""}"><header><div><h3>${escapeHtml(player.name)} ${self ? `<span class="badge">You</span>` : ""}</h3><small>${escapeHtml(player.deck?.commanders.join(" / ") || "No commander")}</small></div>${active ? `<span class="badge warning">Active</span>` : ""}</header><div class="player-stats"><div><small>Life</small><strong>${game.life}</strong></div><div><small>Poison</small><strong>${game.poison}</strong></div><div><small>Tax</small><strong>${game.commanderTax}</strong></div></div><div class="mana-summary">${Object.entries(game.manaPool || {}).map(([symbol,value]) => `<span class="mana-chip">${symbol}:${value}</span>`).join("")}</div><div class="counter-row">${[-5,-1,1,5].map((amount) => `<button data-action="game" data-game-type="life" data-target-player-id="${player.id}" data-amount="${amount}">${amount > 0 ? "+" : ""}${amount}</button>`).join("")}</div><div class="mini-controls"><span>Poison</span><button data-action="game" data-game-type="poison" data-target-player-id="${player.id}" data-amount="-1">−</button><button data-action="game" data-game-type="poison" data-target-player-id="${player.id}" data-amount="1">+</button><span>Tax</span><button data-action="game" data-game-type="commander-tax" data-target-player-id="${player.id}" data-amount="-2">−2</button><button data-action="game" data-game-type="commander-tax" data-target-player-id="${player.id}" data-amount="2">+2</button></div><details><summary>Commander damage</summary>${sources.map((source) => `<div class="damage-row"><span>From ${escapeHtml(source.name)}: <strong>${game.commanderDamage[source.id] || 0}</strong>/21</span><span><button data-action="game" data-game-type="commander-damage" data-target-player-id="${player.id}" data-source-player-id="${source.id}" data-amount="-1">−</button><button data-action="game" data-game-type="commander-damage" data-target-player-id="${player.id}" data-source-player-id="${source.id}" data-amount="1">+</button></span></div>`).join("")}</details>${isHost() && !active && !game.conceded ? `<button class="small-button" data-action="game" data-game-type="set-active-player" data-target-player-id="${player.id}">Make active</button>` : ""}</article>`;
  }

  function renderGameTab() {
    if (state.activeGameTab === "zones") return renderZonesTab();
    if (state.activeGameTab === "mechanics") return renderMechanicsTab();
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
    return Object.entries(card.counters || {}).map(([name, amount]) => `<span class="arena-counter" title="${escapeAttribute(name)} counter">${escapeHtml(name)} <b>${amount}</b></span>`).join("");
  }

  function renderCard(card, zone, ownerId, canControl, options = {}) {
    const targetEligible = state.targetMode && zone === "battlefield" && card.id !== state.targetMode.sourceCardId && (state.targetMode.type !== "block" || card.attacking);
    const stats = card.effectiveStats || ((card.power || card.toughness) ? { power: card.power || "?", toughness: card.toughness || "?" } : null);
    const image = card.faceDown || state.uiSettings.lowData ? "" : (cardArtCrop(card) || cardImage(card));
    const art = image;
    const defender = playerById(card.defendingPlayerId);
    const keywords = (card.keywords || []).slice(0,3);
    const stackCount = Number(options.stackCount || 1);
    const attachments = options.attachments || [];
    const draggable = canControl && !isSpectator();
    return `<div class="arena-card-nest ${attachments.length ? "has-attachments" : ""}">
      ${attachments.map((attached,index) => `<div class="attachment-peek" style="--attachment-index:${index}" data-card-id="${attached.id}" data-action="open-card" data-zone="battlefield" data-owner-id="${ownerId}" data-can-control="${canControl ? 1 : 0}"><span>${escapeHtml(attached.name)}</span></div>`).join("")}
      <article class="arena-card ${zone === "hand" ? "in-hand" : "on-board"} ${card.tapped ? "is-tapped" : ""} ${card.commander ? "is-commander" : ""} ${card.token ? "is-token" : ""} ${card.attacking ? "is-attacking" : ""} ${card.blockingCardId ? "is-blocking" : ""} ${card.lethal ? "is-lethal" : ""} ${targetEligible ? "target-eligible" : ""} ${card.faceDown ? "is-face-down" : ""} ${card.phasedOut ? "is-phased" : ""}" data-action="open-card" data-card-id="${card.id}" data-zone="${zone}" data-owner-id="${ownerId}" data-can-control="${canControl ? "1" : "0"}" draggable="${draggable ? "true" : "false"}" tabindex="0">
        <div class="arena-card-frame">
          <header><strong>${escapeHtml(card.name)}</strong><span class="card-mana">${manaSymbolHtml(manaCost(card))}</span></header>
          <div class="arena-card-image">${image ? `<img src="${escapeAttribute(image)}" alt="${escapeAttribute(card.name)}" loading="lazy" decoding="async">` : art ? `<div class="arena-card-artcrop" style="background-image:url('${escapeAttribute(art)}')"></div>` : `<div class="card-placeholder">${card.faceDown ? "?" : card.commander ? "♛" : card.token ? "◈" : "✦"}</div>`}</div>
          <div class="arena-card-type">${escapeHtml(card.faceDown ? "Face-down 2/2 creature" : cardTypeLine(card) || (card.token ? "Token" : "Card"))}</div>
          <div class="arena-card-badges">${counterBadges(card)}${card.damageMarked ? `<span class="damage-badge">${card.damageMarked}</span>` : ""}${card.attacking ? `<span class="attack-badge">→ ${escapeHtml(defender?.name || "attack")}</span>` : ""}${card.blockingCardId ? `<span class="block-badge">BLOCK</span>` : ""}${card.summoningSick ? `<span class="sick-badge">SICK</span>` : ""}${card.lethal ? `<span class="lethal-badge">LETHAL</span>` : ""}${stackCount > 1 ? `<span class="group-badge">×${stackCount}</span>` : ""}</div>
          <footer>${keywords.length ? `<span class="keyword-mini">${keywords.map(escapeHtml).join(" • ")}</span>` : `<span></span>`}${stats ? `<strong>${escapeHtml(stats.power)}/${escapeHtml(stats.toughness)}</strong>` : card.loyalty ? `<strong>◆${escapeHtml(card.loyalty)}</strong>` : ""}</footer>
        </div>
      </article>
    </div>`;
  }


  function renderTargetOptions() {
    const players = state.room.players.map((player) => `<label class="target-option"><input type="checkbox" name="targets" value="player:${player.id}"><span>Player: ${escapeHtml(player.name)}</span></label>`).join("");
    const cards = state.room.players.flatMap((player) => player.game.battlefield.map((card) => `<label class="target-option"><input type="checkbox" name="targets" value="card:${card.id}"><span>${escapeHtml(player.name)} — ${escapeHtml(card.name)}</span></label>`)).join("");
    return `<div class="target-options"><strong>Optional targets</strong>${players}${cards}</div>`;
  }

  function renderMechanicsTab() {
    const me = currentPlayer();
    const priority = playerById(state.room.priority?.playerId);
    const stack = [...state.room.stack].reverse().map((item,index) => `<article class="stack-item arena-stack-item"><div class="stack-art">${item.card && !state.uiSettings.lowData && cardImage(item.card) ? `<img src="${escapeAttribute(cardImage(item.card))}" alt="" loading="lazy">` : `<span>${item.kind === "spell" ? "✦" : item.kind === "trigger" ? "!" : "⚡"}</span>`}</div><div class="stack-copy"><small>#${state.room.stack.length-index} • ${escapeHtml(item.kind)}</small><strong>${escapeHtml(item.name)}</strong><p>${renderOracleText(item.text || "Manual resolution")}</p><div class="target-summary">${(item.targets || []).map((target) => `<span>${escapeHtml(target.replace(/^player:/,"Player: ").replace(/^card:/,"Card: "))}</span>`).join("")}</div></div>${!isSpectator() ? `<div class="stack-actions">${index === 0 ? `<button class="primary-button" data-action="game" data-game-type="resolve-stack-top">Resolve</button>` : ""}<button class="danger-button" data-action="counter-stack" data-stack-item-id="${item.id}">Counter</button></div>` : ""}</article>`).join("") || `<div class="empty-state">The stack is empty.</div>`;
    const triggers = state.room.triggerQueue.map((item) => `<article class="trigger-item"><div><strong>${escapeHtml(item.sourceName)}</strong><small>${escapeHtml(item.event || "Trigger")}</small><p>${renderOracleText(item.text)}</p></div>${!isSpectator() ? `<div class="button-row"><button class="primary-button" data-action="trigger-to-stack" data-trigger-id="${item.id}">Put on stack</button><button class="ghost-button" data-action="dismiss-trigger" data-trigger-id="${item.id}">Dismiss</button></div>` : ""}</article>`).join("") || `<div class="empty-state">No triggers waiting.</div>`;
    const mana = me ? `<section class="drawer-section"><div class="section-heading"><h3>Mana pool</h3><button class="ghost-button" data-action="game" data-game-type="clear-mana">Empty</button></div><div class="mana-control-grid">${["W","U","B","R","G","C"].map((symbol) => `<div class="mana-control mana-${symbol.toLowerCase()}"><strong>${symbol}</strong><button data-action="mana" data-symbol="${symbol}" data-amount="-1">−</button><span>${me.game.manaPool?.[symbol] || 0}</span><button data-action="mana" data-symbol="${symbol}" data-amount="1">+</button></div>`).join("")}</div></section>` : "";
    const history = [...(state.room.actionHistory || [])].reverse().slice(0,40).map((entry) => `<article class="history-item"><strong>${escapeHtml(entry.actorName)}</strong><span>${escapeHtml(entry.type)}</span><small>${formatTime(entry.time)}</small></article>`).join("") || `<div class="empty-state">No structured actions yet.</div>`;
    return `<div class="arena-mechanics"><section class="drawer-section"><div class="section-heading"><div><p class="eyebrow">Live priority</p><h3>Stack</h3></div><span class="priority-orb ${priority?.id === me?.id ? "is-mine" : ""}">${escapeHtml(priority?.name || "—")}</span></div>${!isSpectator() ? `<div class="button-row"><button class="primary-button" data-action="game" data-game-type="pass-priority">Pass priority</button><button class="secondary-button" data-action="open-custom-stack">Add custom item</button></div>` : ""}<div class="stack-list">${stack}</div></section><section class="drawer-section"><div class="section-heading"><h3>Trigger queue</h3><span class="badge">${state.room.triggerQueue.length}</span></div>${triggers}</section>${mana}<details class="drawer-section"><summary>Action history</summary><div class="history-list">${history}</div></details>${isHost() && state.room.canUndo ? `<button class="danger-button wide-button" data-action="game" data-game-type="undo-last">Undo last shared action</button>` : ""}</div>`;
  }

  function allPublicCards() {
    return state.room.players.flatMap((player) => ["battlefield","graveyard","exile","commandZone", ...(player.id === state.session?.playerId ? ["hand"] : [])].flatMap((zone) => (player.game?.[zone] || []).map((card) => ({ player, zone, card }))));
  }

  function renderAiLabPanel() {
    if (!state.room?.ai?.enabled && !state.room?.players?.some((player) => player.isBot)) return "";
    const ai = state.room.ai || {};
    const bots = state.room.players.filter((player) => player.isBot);
    const decisions = [...(ai.decisions || [])].reverse().slice(0, 30);
    const speedOptions = [[250,"Very fast"],[500,"Fast"],[900,"Normal"],[1400,"Slow"],[2200,"Study mode"]];
    return `<section class="drawer-section ai-control-section"><div class="section-heading"><div><p class="eyebrow">AI Test Lab</p><h3>Bot controls & explanations</h3></div><span class="badge ${ai.paused ? "warning" : "success"}">${ai.paused ? "Paused" : "Running"}</span></div>${isHost() ? `<div class="button-row"><button class="${ai.paused ? "primary-button" : "secondary-button"}" data-action="ai-control" data-ai-mode="${ai.paused ? "resume" : "pause"}">${ai.paused ? "Resume AI" : "Pause AI"}</button><button class="secondary-button" data-action="ai-control" data-ai-mode="step">Step one action</button>${state.room.mode === "test-lab" ? `<button class="ghost-button" data-action="ai-control" data-ai-mode="restart">Restart same decks</button><button class="ghost-button" data-action="ai-control" data-ai-mode="swap-decks">Swap decks</button>` : ""}</div><form id="aiSettingsForm"><div class="form-grid two"><label>Action speed<select name="speedMs">${speedOptions.map(([value,label])=>`<option value="${value}" ${Number(ai.speedMs||900)===value?"selected":""}>${label}</option>`).join("")}</select></label><label class="check-row"><input type="checkbox" name="revealBotHands" ${ai.revealBotHands ? "checked" : ""}> Reveal bot hands for testing</label></div><button class="secondary-button" type="submit">Save AI settings</button></form>` : ""}<div class="ai-bot-grid">${bots.map((bot)=>`<article class="ai-bot-card"><div><strong>${escapeHtml(bot.name)}</strong><span class="badge ai-badge">${escapeHtml(bot.botState?.difficulty || "skilled")}</span></div><p><b>${escapeHtml(bot.botState?.profile?.archetype || "midrange")}</b> • ${escapeHtml(bot.deck?.name || "Deck")}</p><small>Avg MV ${bot.botState?.profile?.averageManaValue ?? "?"} • ${bot.botState?.profile?.landCount ?? "?"} lands • ${bot.botState?.profile?.interactionCount ?? "?"} interaction</small>${isHost() ? `<form class="bot-difficulty-form" data-bot-id="${bot.id}"><label>Difficulty<select name="difficulty">${["beginner","skilled","competitive","expert"].map((level)=>`<option value="${level}" ${bot.botState?.difficulty===level?"selected":""}>${level}</option>`).join("")}</select></label><button class="small-button" type="submit">Apply</button></form>` : ""}</article>`).join("")}</div><details open><summary>Why the bot acted</summary><div class="ai-decision-list">${decisions.length ? decisions.map((entry)=>`<article><div><strong>${escapeHtml(entry.botName)}</strong><span>${escapeHtml(entry.action)}</span><small>${formatTime(entry.time)}</small></div><p>${escapeHtml(entry.explanation || "No explanation recorded.")}</p>${entry.cardName ? `<small>Card: ${escapeHtml(entry.cardName)}${entry.targetName ? ` → ${escapeHtml(entry.targetName)}` : ""}</small>` : ""}</article>`).join("") : `<div class="empty-state">AI decisions will appear here.</div>`}</div></details>${ai.testResult ? `<div class="notice success"><strong>Test complete:</strong> ${escapeHtml((ai.testResult.winnerNames || []).join(", ") || "Draw")} after ${ai.testResult.turns || 0} turns.</div>` : ""}</section>`;
  }

  function renderRulesDrawer() {
    const rules = state.room.rules || {};
    const open = (rules.decisions || []).filter((entry) => entry.status === "open");
    const roles = `<div class="rule-role-grid"><div><small>Monarch</small><strong>${escapeHtml(playerById(rules.monarchPlayerId)?.name || "None")}</strong></div><div><small>Initiative</small><strong>${escapeHtml(playerById(rules.initiativePlayerId)?.name || "None")}</strong></div><div><small>Day / Night</small><strong>${escapeHtml(rules.dayNight || "Not set")}</strong></div><div><small>Rules version</small><strong>${escapeHtml(rules.version || "35.0")}</strong></div></div>`;
    const decisions = open.length ? open.map((decision) => {
      const mine = decision.playerIds?.includes(state.session?.playerId) || isHost();
      return `<article class="rule-decision"><div><span class="badge warning">${escapeHtml(decision.type)}</span><strong>${escapeHtml(decision.prompt)}</strong></div>${mine ? `<form class="decision-form" data-decision-id="${decision.id}">${(decision.options || []).map((option) => `<label><input type="${decision.maximum === 1 ? "radio" : "checkbox"}" name="selections" value="${escapeAttribute(option.id)}"> ${escapeHtml(option.label)}</label>`).join("")}<button class="primary-button" type="submit">Submit choice</button></form>` : `<small>Waiting for the chosen player.</small>`}</article>`;
    }).join("") : `<div class="empty-state">No rule decisions are waiting.</div>`;
    const effectCard = (effect, group) => `<article class="rule-effect"><div><span class="badge">${escapeHtml(effect.kind)}</span><strong>${escapeHtml(effect.label)}</strong><small>${escapeHtml(effect.notes || [effect.operation,effect.keyword].filter(Boolean).join(" • "))}</small></div>${isHost() ? `<button class="danger-button" data-action="remove-rule-effect" data-effect-id="${effect.id}">Remove</button>` : ""}</article>`;
    const effects = [...(rules.continuousEffects || []), ...(rules.replacementEffects || []), ...(rules.emblems || [])];
    const me = currentPlayer();
    return `<div class="rules-drawer">${renderAiLabPanel()}<section class="drawer-section"><div class="section-heading"><div><p class="eyebrow">Final assisted engine</p><h3>Game rules</h3></div><span class="badge ${rules.gameOver ? "danger" : "success"}">${rules.gameOver ? "Game over" : "Active"}</span></div>${roles}<div class="button-row">${!isSpectator() ? `<button class="secondary-button" data-action="game" data-game-type="check-state-based">Check state</button>` : ""}${isHost() ? `<button class="primary-button" data-action="open-judge-mode">Open Judge Mode</button>` : ""}</div>${rules.gameOver ? `<div class="notice danger"><strong>Winner:</strong> ${(rules.winnerPlayerIds || []).map((id) => escapeHtml(playerById(id)?.name || id)).join(", ") || "Draw"}</div>` : ""}</section><section class="drawer-section"><div class="section-heading"><h3>Player counters</h3></div>${me ? `<div class="special-counter-grid">${["energy","experience","radiation"].map((field) => `<div><strong>${field[0].toUpperCase()+field.slice(1)}</strong><button data-action="game" data-game-type="player-counter" data-target-player-id="${me.id}" data-field="${field}" data-amount="-1">−</button><span>${me.game?.[field] || 0}</span><button data-action="game" data-game-type="player-counter" data-target-player-id="${me.id}" data-field="${field}" data-amount="1">+</button></div>`).join("")}</div>` : ""}</section><section class="drawer-section"><div class="section-heading"><h3>Pending decisions</h3><span class="badge">${open.length}</span></div>${decisions}</section><section class="drawer-section"><div class="section-heading"><h3>Continuous, replacement & emblem effects</h3><span class="badge">${effects.length}</span></div>${effects.length ? effects.map(effectCard).join("") : `<div class="empty-state">No persistent rule effects.</div>`}</section><section class="drawer-section"><h3>Coverage model</h3><p class="muted">Core setup, mulligans, payment, priority, combat and state-based actions are automatic. Complex Oracle interactions remain assisted, and Judge Mode guarantees every tabletop action is still possible.</p></section></div>`;
  }

  function judgePlayerOptions(selected="") { return state.room.players.map((player) => `<option value="${player.id}" ${selected===player.id?"selected":""}>${escapeHtml(player.name)}</option>`).join(""); }
  function judgeCardOptions() { return allPublicCards().map(({player,zone,card}) => `<option value="${card.id}">${escapeHtml(player.name)} — ${escapeHtml(card.name)} (${zone})</option>`).join(""); }

  function openJudgeMode() {
    if (!isHost()) return showToast("Only the host can use shared Judge Mode.", "warning");
    const playerOptions=judgePlayerOptions(); const cardOptions=judgeCardOptions();
    openModal("Judge Mode — universal tabletop controls", `<div class="judge-tabs"><details open><summary>Move any card</summary><form id="judgeMoveForm"><label>Card<select name="cardId">${cardOptions}</select></label><label>Destination<select name="destination">${["hand","battlefield","graveyard","exile","commandZone","library"].map((zone)=>`<option value="${zone}">${zone}</option>`).join("")}</select></label><button class="primary-button" type="submit">Move card</button></form></details><details><summary>Set player value</summary><form id="judgePlayerForm"><label>Player<select name="targetPlayerId">${playerOptions}</select></label><div class="form-grid two"><label>Field<select name="field"><option value="life">Life</option><option value="poison">Poison</option><option value="commanderTax">Commander tax</option><option value="energy">Energy</option><option value="experience">Experience</option><option value="radiation">Radiation</option><option value="maxHandSize">Maximum hand size</option></select></label><label>Value<input type="number" name="value" value="0"></label></div><button class="primary-button" type="submit">Set value</button></form></details><details><summary>Set card state or characteristics</summary><form id="judgeCardForm"><label>Card<select name="cardId">${cardOptions}</select></label><div class="form-grid two"><label>Field<select name="field"><option value="tapped">Tapped</option><option value="faceDown">Face down</option><option value="phasedOut">Phased out</option><option value="revealed">Revealed</option><option value="power">Power override</option><option value="toughness">Toughness override</option><option value="typeLine">Type-line override</option><option value="oracleText">Rules-text override</option><option value="damageMarked">Marked damage</option><option value="lore">Lore counters</option><option value="level">Level</option></select></label><label>Value<input name="value" maxlength="2500" value="1"></label></div><button class="primary-button" type="submit">Change card</button></form></details><details><summary>Create token, copy, emblem or custom object</summary><form id="judgeObjectForm"><label>Controller<select name="targetPlayerId">${playerOptions}</select></label><div class="form-grid two"><label>Name<input name="name" value="Custom Token" required></label><label>Object type<select name="objectType"><option value="token">Token</option><option value="copy">Copy marker</option><option value="emblem">Emblem</option><option value="custom">Custom object</option></select></label><label>Power<input name="power" value="1"></label><label>Toughness<input name="toughness" value="1"></label></div><label>Notes<textarea name="notes" rows="3"></textarea></label><button class="primary-button" type="submit">Create object</button></form></details><details><summary>Add continuous, replacement or prevention effect</summary><form id="judgeEffectForm"><div class="form-grid two"><label>Kind<select name="kind"><option value="continuous">Continuous</option><option value="replacement">Replacement</option><option value="prevention">Prevention</option><option value="delayed">Delayed trigger</option></select></label><label>Layer<select name="layer">${[1,2,3,4,5,6,7].map((n)=>`<option value="${n}" ${n===7?"selected":""}>${n}</option>`).join("")}</select></label></div><label>Label<input name="label" required placeholder="Anthem +1/+1"></label><label>Target card<select name="targetId"><option value="">Global / notes only</option>${cardOptions}</select></label><div class="form-grid two"><label>Power<input type="number" name="power" value="0"></label><label>Toughness<input type="number" name="toughness" value="0"></label><label>Keyword<input name="keyword" placeholder="Flying"></label><label>Expires<select name="expires"><option value="until-removed">Until removed</option><option value="end-of-turn">End of turn</option><option value="end-of-combat">End of combat</option></select></label></div><label>Replacement event / operation<input name="event" placeholder="DAMAGE"><input name="operation" placeholder="PREVENT or DOUBLE"></label><label>Notes<textarea name="notes" rows="3"></textarea></label><button class="primary-button" type="submit">Add rule effect</button></form></details><details><summary>Set monarch, initiative or day/night</summary><form id="judgeRoleForm"><label>Role<select name="role"><option value="monarch">Monarch</option><option value="initiative">Initiative</option><option value="day">Day</option><option value="night">Night</option><option value="none-day-night">Clear day/night</option></select></label><label>Player<select name="targetPlayerId"><option value="">None</option>${playerOptions}</select></label><button class="primary-button" type="submit">Set role</button></form></details><details><summary>Declare loop or shortcut result</summary><form id="judgeLoopForm"><label>Loop / shortcut<textarea name="text" rows="3" required placeholder="Repeat this sequence 1,000 times"></textarea></label><label>Result<textarea name="result" rows="2" required placeholder="Create 1,000 Treasure tokens"></textarea></label><button class="primary-button" type="submit">Record result</button></form></details></div>`);
  }

  function renderToolsTab() {
    const me = currentPlayer();
    return `<div class="tool-grid arena-tools"><article class="tool-card"><h3>Dice & coin</h3><div class="tool-result">${escapeHtml(state.toolResult)}</div><div class="button-row">${[6,10,20,100].map((sides) => `<button class="secondary-button" data-action="roll" data-sides="${sides}">d${sides}</button>`).join("")}<button class="secondary-button" data-action="coin">Coin</button></div></article>${me ? `<article class="tool-card"><h3>Deck controls</h3><div class="button-row"><button class="secondary-button" data-action="game" data-game-type="draw" data-amount="1">Draw 1</button><button class="secondary-button" data-action="game" data-game-type="draw" data-amount="7">Draw 7</button><button class="ghost-button" data-action="game" data-game-type="mill" data-amount="1">Mill 1</button><button class="ghost-button" data-action="game" data-game-type="shuffle">Shuffle</button><button class="danger-button" data-action="game" data-game-type="mulligan">Mulligan</button></div></article><form id="tokenForm" class="tool-card"><h3>Create token</h3><label>Name<input name="name" maxlength="80" value="Soldier" required></label><div class="form-grid two"><label>Power<input name="power" maxlength="12" value="1"></label><label>Toughness<input name="toughness" maxlength="12" value="1"></label></div><button class="primary-button" type="submit">Create token</button></form><article class="tool-card"><h3>Board tools</h3><div class="button-row"><button class="secondary-button" data-action="game" data-game-type="untap-all">Untap mine</button><button class="secondary-button" data-action="game" data-game-type="clear-combat">Clear combat</button><button class="ghost-button" data-action="game" data-game-type="clear-all-damage">Clear damage</button><button class="ghost-button" data-action="export-board-snapshot">Export board snapshot</button>${!me.game.conceded ? `<button class="danger-button" data-action="game" data-game-type="concede">Concede</button>` : ""}${isHost() ? `<button class="danger-button" data-action="reset-game">New game lobby</button>` : ""}</div></article>` : `<article class="tool-card"><h3>Spectator tools</h3><button class="ghost-button" data-action="export-board-snapshot">Export public board snapshot</button></article>`}</div>`;
  }

  function renderChatTab() {
    const chat = state.room.chat || [];
    const log = state.room.log || [];
    return `<div class="chat-layout"><section class="chat-panel"><div class="panel-heading"><h3>Table chat</h3><div class="emote-row">${["👍","👏","🔥","😮","😂","🤔","⚔️","☠️"].map((emoji) => `<button data-action="send-emote" data-emoji="${emoji}" ${isSpectator() ? "disabled" : ""}>${emoji}</button>`).join("")}</div></div><div class="chat-messages">${chat.length ? chat.map((message) => `<article class="chat-message ${message.playerId === state.session?.playerId ? "is-self" : ""}"><div class="chat-meta"><strong>${escapeHtml(message.playerName)}</strong><span>${formatTime(message.time)}</span></div><p>${escapeHtml(message.message)}</p></article>`).join("") : `<div class="empty-state">No messages yet.</div>`}</div>${!isSpectator() ? `<form id="chatForm" class="chat-form"><input name="message" maxlength="500" autocomplete="off" placeholder="Send a table message…"><button class="primary-button" type="submit">Send</button></form>` : `<div class="notice">Spectator chat is read-only.</div>`}</section><section class="log-panel"><div class="panel-heading"><h3>Game log</h3></div><div class="log-entries">${log.length ? [...log].reverse().slice(0,100).map((entry) => `<article class="log-entry"><div class="log-meta"><span>${escapeHtml(entry.type)}</span><span>${formatTime(entry.time)}</span></div><p>${escapeHtml(entry.text)}</p></article>`).join("") : `<div class="empty-state">No game activity yet.</div>`}</div></section></div>`;
  }

  function renderHelp() {
    return `<section class="panel"><div class="section-heading"><div><p class="eyebrow">Arena Commander v35</p><h1>How the digital table works</h1></div></div><div class="help-grid"><article class="help-card"><h3>Full-screen table</h3><p>Your seat stays at the bottom while opponents are arranged clockwise around the battlefield. Spectators see the whole public table without hidden hands.</p></article><article class="help-card"><h3>Drag or tap</h3><p>Drag cards between your zones, drag creatures to opponents to attack, or use the card action sheet on touch devices.</p></article><article class="help-card"><h3>Stack & priority</h3><p>The priority holder glows. Pass clockwise; when everyone passes, the top stack item resolves.</p></article><article class="help-card"><h3>Combat</h3><p>Attack and block arrows, damage previews and assisted keyword handling make multiplayer combat easier to follow.</p></article><article class="help-card"><h3>Performance</h3><p>Low-data, reduced-animation, high-contrast and large-text options are stored on each device.</p></article><article class="help-card"><h3>AI Test Lab</h3><p>Choose two imported decks to test against Beginner, Skilled, Competitive or Expert AI. Pause, step, reveal the bot hand, restart or swap decks from the Rules drawer.</p></article><article class="help-card"><h3>Optional bot seats</h3><p>Room hosts can mix human and AI seats in normal 2–6 player Commander games. Bots roll, pass priority, develop mana, cast, attack and block through the shared rules engine.</p></article><article class="help-card"><h3>Sandbox fallback</h3><p>Complex replacement effects and difficult layer interactions remain manually adjustable so unusual cards never lock the game.</p></article></div></section>`;
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
      const cast = zone === "hand" || zone === "commandZone" ? `<button class="primary-button" data-action="open-cast-card" data-card-id="${card.id}" data-from-zone="${zone}">Cast to stack</button>` : "";
      const actions = zone === "hand" ? `${moveAction("Play directly", card, zone, "battlefield")}${moveAction("Discard", card, zone, "graveyard")}${moveAction("Exile", card, zone, "exile")}` : `${moveAction("Battlefield", card, zone, "battlefield")}${moveAction("Hand", card, zone, "hand")}${moveAction("Graveyard", card, zone, "graveyard")}${moveAction("Exile", card, zone, "exile")}`;
      return `<div class="sheet-grid">${cast}${actions}${card.commander ? moveAction("Command zone", card, zone, "commandZone") : ""}</div>`;
    }
    const hasAttacker = state.room.players.some((player) => player.id !== state.session.playerId && player.game.battlefield.some((entry) => entry.attacking && entry.defendingPlayerId === state.session.playerId));
    const opponents = state.room.players.filter((player) => player.id !== state.session.playerId && !player.game.conceded);
    const transformButton = (card.cardData?.faces?.length || 0) > 1 ? `<button class="secondary-button" data-action="card-game" data-game-type="transform-card" data-card-id="${card.id}">Transform / next face</button>` : "";
    return `<div class="sheet-section"><h3>Game actions</h3><div class="sheet-grid"><button class="primary-button" data-action="card-game" data-game-type="tap-card" data-card-id="${card.id}">${card.tapped ? "Untap" : "Tap"}</button><button class="secondary-button" data-action="open-counter-menu" data-card-id="${card.id}">Counters</button><button class="secondary-button" data-action="open-stats-menu" data-card-id="${card.id}">Power / toughness</button><button class="secondary-button" data-action="open-ability" data-card-id="${card.id}">Activate ability</button><button class="secondary-button" data-action="create-card-trigger" data-card-id="${card.id}">Create trigger</button><button class="secondary-button" data-action="open-temp-effect" data-card-id="${card.id}">Temporary effect</button><button class="secondary-button" data-action="start-attach" data-card-id="${card.id}">Attach to…</button>${card.attachedToId ? `<button class="ghost-button" data-action="card-game" data-game-type="detach-card" data-card-id="${card.id}">Detach</button>` : ""}<button class="secondary-button" data-action="open-control-change" data-card-id="${card.id}">Change controller</button>${card.ownerId !== card.controllerId ? `<button class="ghost-button" data-action="card-game" data-game-type="return-control" data-card-id="${card.id}">Return to owner</button>` : ""}${transformButton}<button class="ghost-button" data-action="card-game" data-game-type="toggle-face-down" data-card-id="${card.id}">${card.faceDown ? "Turn face up" : "Turn face down"}</button><button class="ghost-button" data-action="card-game" data-game-type="toggle-phased" data-card-id="${card.id}">${card.phasedOut ? "Phase in" : "Phase out"}</button><button class="secondary-button" data-action="card-game" data-game-type="copy-card" data-card-id="${card.id}">Create copy</button><button class="secondary-button" data-action="open-choice" data-card-id="${card.id}">Set chosen value</button></div></div><div class="sheet-section"><h3>Combat & damage</h3><div class="sheet-grid"><button class="secondary-button" data-action="card-game" data-game-type="mark-damage" data-card-id="${card.id}" data-amount="1">+1 damage</button><button class="secondary-button" data-action="card-game" data-game-type="mark-damage" data-card-id="${card.id}" data-amount="-1">−1 damage</button><button class="ghost-button" data-action="card-game" data-game-type="clear-card-damage" data-card-id="${card.id}">Clear damage</button><button class="combat-button" data-action="start-fight" data-card-id="${card.id}">Fight creature</button>${card.attacking ? `<button class="combat-button" data-action="card-game" data-game-type="clear-attacker" data-card-id="${card.id}">Stop attacking</button>` : opponents.map((player) => `<button class="combat-button" data-action="declare-attacker" data-card-id="${card.id}" data-defender-player-id="${player.id}">Attack ${escapeHtml(player.name)}</button>`).join("")}${hasAttacker ? `<button class="combat-button" data-action="start-block" data-card-id="${card.id}">Block attacker</button>` : ""}${card.blockingCardId ? `<button class="ghost-button" data-action="card-game" data-game-type="clear-block" data-card-id="${card.id}">Stop blocking</button>` : ""}${card.lethal ? `<button class="danger-button" data-action="card-game" data-game-type="resolve-lethal" data-card-id="${card.id}">Resolve lethal</button>` : ""}</div></div>${isHost() ? `<div class="sheet-section"><h3>Judge controls</h3><button class="secondary-button" data-action="open-judge-mode">Open universal Judge Mode</button></div>` : ""}<div class="sheet-section"><h3>Move card</h3><div class="sheet-grid">${moveAction("Graveyard", card, zone, "graveyard")}${moveAction("Exile", card, zone, "exile")}${moveAction("Hand", card, zone, "hand")}${card.commander ? moveAction("Command zone", card, zone, "commandZone") : ""}</div></div>`;
  }

  function openCastCard(cardId, fromZone) {
    const found = findCard(cardId); if (!found) return;
    openModal(`Cast ${found.card.name}`, `<form id="castCardForm"><input type="hidden" name="cardId" value="${cardId}"><input type="hidden" name="fromZone" value="${fromZone}"><p class="oracle-text">${renderOracleText(cardOracleText(found.card))}</p><div class="form-grid two"><label>X value<input type="number" name="xValue" min="0" max="999" value="0"></label><label>Modes / choices<input name="modes" placeholder="Mode 1; Mode 2"></label></div><label>Additional costs<input name="additionalCosts" placeholder="Sacrifice a creature; discard a card"></label><label class="check-row"><input type="checkbox" name="enforcePayment"> Validate and spend mana payment</label><div class="mana-payment-grid">${["W","U","B","R","G","C"].map((symbol)=>`<label>${symbol}<input type="number" name="pay${symbol}" value="0" min="0" max="999"></label>`).join("")}</div>${renderTargetOptions()}<p class="form-help">Standard colored, generic, hybrid-like and commander-tax payments can be checked. Unusual alternative costs remain assisted.</p><button class="primary-button" type="submit">Pay and put spell on stack</button></form>`);
  }

  function openAbility(cardId) {
    const found = findCard(cardId); if (!found) return;
    openModal(`${found.card.name} ability`, `<form id="abilityForm"><input type="hidden" name="cardId" value="${cardId}"><label>Ability text<textarea name="text" rows="5" maxlength="2500">${escapeHtml(cardOracleText(found.card))}</textarea></label><label class="check-row"><input type="checkbox" name="tapCost" value="1"> Tap this permanent as a cost</label>${renderTargetOptions()}<button class="primary-button" type="submit">Put ability on stack</button></form>`);
  }

  function openCustomStack() {
    openModal("Custom stack item", `<form id="customStackForm"><label>Name<input name="name" maxlength="180" required placeholder="Triggered or activated effect"></label><label>Rules note<textarea name="text" rows="4" maxlength="2500" placeholder="Describe what should happen"></textarea></label><div class="form-grid two"><label>Automatic effect<select name="effectAction"><option value="">Manual resolution</option><option value="draw">Draw cards</option><option value="gain-life">Gain life</option><option value="lose-life">Lose life</option><option value="damage">Deal damage</option><option value="tap">Tap target</option><option value="untap">Untap target</option><option value="counter">Add counter</option><option value="destroy">Destroy</option><option value="exile">Exile</option><option value="token">Create token</option></select></label><label>Amount<input type="number" name="amount" value="1" min="-99" max="999"></label></div><label>Counter/token name<input name="effectName" maxlength="80" placeholder="+1/+1 or Soldier"></label>${renderTargetOptions()}<button class="primary-button" type="submit">Add to stack</button></form>`);
  }

  function openTempEffect(cardId) {
    const found = findCard(cardId); if (!found) return;
    openModal(`${found.card.name} temporary effect`, `<form id="tempEffectForm"><input type="hidden" name="cardId" value="${cardId}"><label>Label<input name="label" maxlength="100" placeholder="Giant Growth"></label><div class="form-grid two"><label>Power change<input type="number" name="power" value="0" min="-99" max="99"></label><label>Toughness change<input type="number" name="toughness" value="0" min="-99" max="99"></label></div><label>Keyword<input name="keyword" maxlength="60" placeholder="Trample"></label><label>Duration<select name="expires"><option value="end-of-turn">Until end of turn</option><option value="until-removed">Until manually removed</option></select></label><button class="primary-button" type="submit">Add effect</button></form>`);
  }

  function openControlChange(cardId) {
    const found = findCard(cardId); if (!found) return;
    openModal(`Change controller`, `<form id="controlChangeForm"><input type="hidden" name="cardId" value="${cardId}"><label>New controller<select name="newControllerId">${state.room.players.map((player) => `<option value="${player.id}">${escapeHtml(player.name)}</option>`).join("")}</select></label><button class="primary-button" type="submit">Change controller</button></form>`);
  }

  function openChoice(cardId) {
    const found = findCard(cardId); if (!found) return;
    openModal(`Chosen value — ${found.card.name}`, `<form id="choiceForm"><input type="hidden" name="cardId" value="${cardId}"><label>Choice name<input name="key" maxlength="60" required placeholder="Chosen creature type"></label><label>Value<input name="value" maxlength="180" required placeholder="Zombie"></label><button class="primary-button" type="submit">Save choice</button></form>`);
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
    const actionType = state.targetMode.type === "fight" ? "fight-card" : state.targetMode.type === "block" ? "block-card" : "attach-card";
    const title = state.targetMode.type === "fight" ? "Confirm fight" : state.targetMode.type === "block" ? "Confirm block" : "Confirm attachment";
    openModal(title, `<div class="target-confirm"><article><strong>${escapeHtml(source.name)}</strong><span>${escapeHtml(source.effectiveStats?.power ?? source.power ?? "?")}/${escapeHtml(source.effectiveStats?.toughness ?? source.toughness ?? "?")}</span></article><div class="versus">${state.targetMode.type === "fight" ? "FIGHTS" : state.targetMode.type === "block" ? "BLOCKS" : "ATTACHES TO"}</div><article><strong>${escapeHtml(targetCard.name)}</strong><span>${escapeHtml(targetCard.effectiveStats?.power ?? targetCard.power ?? "?")}/${escapeHtml(targetCard.effectiveStats?.toughness ?? targetCard.toughness ?? "?")}</span></article></div><div class="button-row"><button class="ghost-button" data-action="cancel-target">Cancel</button><button class="primary-button" data-action="confirm-target" data-game-type="${actionType}" data-source-card-id="${source.id}" data-target-card-id="${targetCard.id}">Confirm</button></div>`);
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

  function openEmotes() {
    openModal("Table emote", `<div class="large-emote-grid">${["👍","👏","🔥","😮","😂","🤔","⚔️","☠️","GG","Nice!"].map((emoji) => `<button data-action="send-emote" data-emoji="${escapeAttribute(emoji)}">${escapeHtml(emoji)}</button>`).join("")}</div>`);
  }

  function viewReplayFrame(frameId) {
    const frame = (state.room.replayFrames || []).find((entry) => entry.id === frameId);
    if (!frame) return showToast("That replay frame is no longer available.", "warning");
    const playerRows = frame.players.map((player) => `<article class="replay-player"><header><strong>${escapeHtml(player.name)}</strong><span>${player.life} life • ${player.poison} poison</span></header><div class="replay-card-list">${(player.battlefield || []).map((card) => `<span class="${card.tapped ? "tapped" : ""} ${card.attacking ? "attacking" : ""}">${escapeHtml(card.name)}${card.damageMarked ? ` (${card.damageMarked} dmg)` : ""}</span>`).join("") || `<small>Empty battlefield</small>`}</div></article>`).join("");
    openModal(`Replay — ${frame.label}`, `<div class="replay-frame-view"><div class="replay-meta"><strong>${escapeHtml(frame.actorName || "Table")}</strong><span>${formatTime(frame.time)}</span><span>${escapeHtml(frame.phase || "")}</span></div><div class="replay-stack"><strong>Stack</strong>${(frame.stack || []).map((item) => `<span>${escapeHtml(item.name)}</span>`).join("") || `<small>Empty</small>`}</div>${playerRows}</div>`);
  }

  function exportBoardSnapshot() {
    if (!state.room) return;
    const snapshot = {
      exportedAt: new Date().toISOString(),
      roomCode: state.room.code,
      turn: state.room.turn,
      phase: state.room.phases[state.room.turn?.phaseIndex || 0],
      stack: state.room.stack,
      players: state.room.players.map((player) => ({
        id: player.id,
        name: player.name,
        life: player.game?.life,
        poison: player.game?.poison,
        commanderTax: player.game?.commanderTax,
        commanderDamage: player.game?.commanderDamage,
        handCount: player.game?.handCount ?? player.game?.hand?.length,
        libraryCount: player.game?.libraryCount,
        battlefield: player.game?.battlefield,
        graveyard: player.game?.graveyard,
        exile: player.game?.exile,
        commandZone: player.game?.commandZone
      }))
    };
    const blob = new Blob([JSON.stringify(snapshot,null,2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `commander-${state.room.code}-turn-${state.room.turn?.number || 0}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("Board snapshot exported.", "success");
  }

  function ensureAudioContext() {
    if (state.audioContext) return state.audioContext;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return null;
    state.audioContext = new Context();
    return state.audioContext;
  }

  function playCue(kind = "info") {
    if (!state.uiSettings.sound) return;
    const context = ensureAudioContext();
    if (!context) return;
    const map = { turn: [520, 760], priority: [660, 880], spell: [420, 620], damage: [180, 120], emote: [740, 740], info: [440, 520] };
    const frequencies = map[kind] || map.info;
    const start = context.currentTime;
    frequencies.forEach((frequency,index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "damage" ? "square" : "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001,start + index * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.08,start + index * 0.09 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001,start + index * 0.09 + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start + index * 0.09);
      oscillator.stop(start + index * 0.09 + 0.14);
    });
  }

  function vibrate(pattern) {
    if (state.uiSettings.vibration && navigator.vibrate) navigator.vibrate(pattern);
  }

  function processRoomTransition(previous, next) {
    if (!previous || !next || isSpectator()) return;
    const me = state.session?.playerId;
    if (previous.turn?.activePlayerId !== next.turn?.activePlayerId && next.turn?.activePlayerId === me) { playCue("turn"); vibrate([80,40,120]); showToast("Your turn.", "success"); }
    if (previous.priority?.playerId !== next.priority?.playerId && next.priority?.playerId === me) { playCue("priority"); vibrate(60); showToast("You have priority.", "info"); }
    if ((next.stack?.length || 0) > (previous.stack?.length || 0)) playCue("spell");
    const oldMe = previous.players?.find((player) => player.id === me);
    const newMe = next.players?.find((player) => player.id === me);
    if (oldMe?.game && newMe?.game && oldMe.game.life !== newMe.game.life) { playCue("damage"); vibrate(40); }
    if ((next.emotes?.length || 0) > (previous.emotes?.length || 0)) playCue("emote");
  }

  function maybeAutoPass() {
    window.clearTimeout(state.autoPassTimer);
    if (!state.uiSettings.autoPassEmpty || state.fullControl || isSpectator() || !state.room || state.room.stack.length || state.room.priority?.playerId !== state.session?.playerId || state.room.turn?.activePlayerId === state.session?.playerId) return;
    state.autoPassTimer = window.setTimeout(() => gameAction({ type: "pass-priority" }), 1400);
  }

  function observeCardImages() {
    if (state.uiSettings.lowData || !("IntersectionObserver" in window)) return;
    const images = document.querySelectorAll(".arena-card-image img[loading='lazy']");
    const observer = new IntersectionObserver((entries,instance) => {
      for (const entry of entries) if (entry.isIntersecting) { entry.target.classList.add("is-visible"); instance.unobserve(entry.target); }
    }, { rootMargin: "200px" });
    images.forEach((image) => observer.observe(image));
  }

  function cssEscape(value) {
    if (globalThis.CSS?.escape) return globalThis.CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (character) => `\${character}`);
  }

  function linePoint(element) {
    const stage = document.querySelector(".arena-stage")?.getBoundingClientRect();
    const rect = element?.getBoundingClientRect();
    if (!stage || !rect) return null;
    return { x: rect.left - stage.left + rect.width / 2, y: rect.top - stage.top + rect.height / 2 };
  }

  function appendArenaLine(svg, from, to, type, label = "") {
    if (!from || !to) return;
    const dx = Math.max(35, Math.abs(to.x-from.x) * 0.35);
    const path = document.createElementNS("http://www.w3.org/2000/svg","path");
    path.setAttribute("d",`M ${from.x} ${from.y} C ${from.x} ${from.y-dx/2}, ${to.x} ${to.y+dx/2}, ${to.x} ${to.y}`);
    path.setAttribute("class",`arena-line line-${type}`);
    path.setAttribute("marker-end",type === "attack" || type === "block" ? "url(#arrowAttack)" : "url(#arrowLink)");
    svg.appendChild(path);
    if (label) {
      const text = document.createElementNS("http://www.w3.org/2000/svg","text");
      text.setAttribute("x",String((from.x+to.x)/2)); text.setAttribute("y",String((from.y+to.y)/2)); text.setAttribute("class","arena-line-label"); text.textContent=label; svg.appendChild(text);
    }
  }

  function drawArenaLines() {
    const svg = document.getElementById("arenaLines");
    if (!svg || !state.uiSettings.showArrows || !state.room) return;
    [...svg.querySelectorAll(".arena-line,.arena-line-label")].forEach((node) => node.remove());
    for (const player of state.room.players) {
      for (const card of player.game?.battlefield || []) {
        const source = document.querySelector(`[data-card-id="${cssEscape(card.id)}"] .arena-card-frame`) || document.querySelector(`[data-card-id="${cssEscape(card.id)}"]`);
        if (card.attacking && card.defendingPlayerId) {
          const target = document.querySelector(`[data-player-seat-id="${cssEscape(card.defendingPlayerId)}"] .seat-life`);
          appendArenaLine(svg,linePoint(source),linePoint(target),"attack","");
        }
        if (card.blockingCardId) {
          const target = document.querySelector(`[data-card-id="${cssEscape(card.blockingCardId)}"] .arena-card-frame`) || document.querySelector(`[data-card-id="${cssEscape(card.blockingCardId)}"]`);
          appendArenaLine(svg,linePoint(source),linePoint(target),"block","BLOCK");
        }
        if (card.attachedToId) {
          const target = document.querySelector(`[data-card-id="${cssEscape(card.attachedToId)}"] .arena-card-frame`) || document.querySelector(`[data-card-id="${cssEscape(card.attachedToId)}"]`);
          appendArenaLine(svg,linePoint(source),linePoint(target),"attach","");
        }
      }
    }
  }

  async function rejoinSpectator() {
    if (!state.spectator || !socket.connected) return;
    const response = await emitAck("join-spectator", { roomCode: state.spectator.roomCode, name: state.spectator.name }, false);
    if (!response.success) { clearSession(); render(); showToast(response.error,"error"); }
    else { setSpectator(response,state.spectator.name); render(); }
  }

  function cardFromElement(element) {
    const cardElement = element?.closest?.("[data-card-id]");
    if (!cardElement) return null;
    const found = findCard(cardElement.dataset.cardId);
    return found ? { ...found, cardElement } : null;
  }


  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button, [data-action]");
    if (!button) return;
    const action = button.dataset.action;

    if (action === "ai-control") {
      const response = await emitAck("ai-control", { mode: button.dataset.aiMode });
      if (!response.success) showToast(response.error, "error");
      else { state.room = response.room; render(); }
      return;
    }
    if (action === "open-ui-settings") return openUiSettings();
    if (action === "toggle-fullscreen") {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => undefined);
      else await document.exitFullscreen?.().catch(() => undefined);
      return;
    }
    if (action === "open-arena-drawer") { state.activeDrawer = button.dataset.drawer; state.activeGameTab = button.dataset.drawer; render(); return; }
    if (action === "close-arena-drawer") { state.activeDrawer = null; state.activeGameTab = "table"; render(); return; }
    if (action === "toggle-card-group") { state.expandedGroups[button.dataset.groupKey] = !state.expandedGroups[button.dataset.groupKey]; render(); return; }
    if (action === "toggle-full-control") { state.fullControl = !state.fullControl; render(); return; }
    if (action === "open-emotes") return openEmotes();
    if (action === "send-emote") { const response = await emitAck("send-emote", { emoji: button.dataset.emoji }); if (!response.success) showToast(response.error,"error"); else closeModal(); return; }
    if (action === "view-replay-frame") return viewReplayFrame(button.dataset.frameId);
    if (action === "export-board-snapshot") return exportBoardSnapshot();
    if (action === "phase-step") { const targetIndex = Number(button.dataset.phaseIndex); if (targetIndex === (state.room.turn?.phaseIndex || 0) + 1) return gameAction({ type: "next-phase" }); return; }
    if (action === "leave-spectator") { await emitAck("leave-spectator", {}, false); clearSession(); render(); return; }
    if (action === "rejoin-spectator") return rejoinSpectator();
    if (action === "open-zone-drawer") {
      const player = playerById(button.dataset.playerId);
      const zone = button.dataset.zone;
      if (!player?.game) return;
      if (player.id === state.session?.playerId) { state.activeDrawer = "zones"; state.activeGameTab = "zones"; render(); return; }
      const cards = ["graveyard","exile","commandZone"].includes(zone) ? player.game[zone] || [] : [];
      return openModal(`${player.name} — ${zone}`, cards.length ? `<div class="zone-cards">${cards.map((card) => renderCard(card,zone,player.id,false)).join("")}</div>` : `<div class="empty-state">This public zone is empty or hidden.</div>`);
    }

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
      return gameAction({ type: button.dataset.gameType, targetPlayerId: button.dataset.targetPlayerId, sourcePlayerId: button.dataset.sourcePlayerId, field: button.dataset.field, amount: Number(button.dataset.amount || 0) });
    }
    if (action === "card-game") {
      return gameAction({ type: button.dataset.gameType, cardId: button.dataset.cardId, targetCardId: button.dataset.cardId, amount: Number(button.dataset.amount || 0) });
    }
    if (action === "declare-attacker") return gameAction({ type: "declare-attacker", cardId: button.dataset.cardId, defenderPlayerId: button.dataset.defenderPlayerId });
    if (action === "combat-damage") return gameAction({ type: "resolve-combat-damage", pass: button.dataset.pass });
    if (action === "mana") return gameAction({ type: "mana", symbol: button.dataset.symbol, amount: Number(button.dataset.amount) });
    if (action === "counter-stack") return gameAction({ type: "counter-stack-item", stackItemId: button.dataset.stackItemId });
    if (action === "trigger-to-stack") return gameAction({ type: "trigger-to-stack", triggerId: button.dataset.triggerId });
    if (action === "dismiss-trigger") return gameAction({ type: "dismiss-trigger", triggerId: button.dataset.triggerId });
    if (action === "open-custom-stack") return openCustomStack();
    if (action === "open-judge-mode") return openJudgeMode();
    if (action === "remove-rule-effect") return gameAction({ type:"judge-action", mode:"remove-effect", effectId:button.dataset.effectId });
    if (action === "open-cast-card") return openCastCard(button.dataset.cardId, button.dataset.fromZone);
    if (action === "open-ability") return openAbility(button.dataset.cardId);
    if (action === "create-card-trigger") return gameAction({ type: "create-trigger", cardId: button.dataset.cardId });
    if (action === "open-temp-effect") return openTempEffect(button.dataset.cardId);
    if (action === "open-control-change") return openControlChange(button.dataset.cardId);
    if (action === "open-choice") return openChoice(button.dataset.cardId);
    if (action === "start-attach") return beginTarget("attach", button.dataset.cardId);
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
      return gameAction({ type, sourceCardId: button.dataset.sourceCardId, cardId: button.dataset.sourceCardId, targetCardId: button.dataset.targetCardId });
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

    if (form.id === "createTestLabForm") {
      const playerDeck = deckById(data.get("playerDeckId"));
      const botDeck = deckById(data.get("botDeckId"));
      const chosenName = String(data.get("playerName") || playerName() || "Fries91").trim();
      rememberPlayerName(chosenName);
      if (!playerDeck || !botDeck) return showToast("Choose both decks first.", "error");
      if (playerDeck.id === botDeck.id) showToast("Testing a mirror match with the same deck.", "info");
      const response = await emitAck("create-test-lab", { playerName: chosenName, playerDeck, botDeck, difficulty: data.get("difficulty"), startingLife: Number(data.get("startingLife")), startingPlayer: data.get("startingPlayer"), speedMs: Number(data.get("speedMs")) }, false);
      if (!response.success) showToast(response.error, "error");
      else { setSession(response); state.activeDrawer = "rules"; render(); }
      return;
    }
    if (form.id === "addBotForm") {
      const deck = deckById(data.get("deckId"));
      const response = await emitAck("add-bot", { deck, difficulty: data.get("difficulty"), name: data.get("name") });
      if (!response.success) showToast(response.error, "error");
      else { state.room = response.room; render(); }
      return;
    }
    if (form.id === "aiSettingsForm") {
      const speed = await emitAck("ai-control", { mode: "speed", speedMs: Number(data.get("speedMs")) });
      if (!speed.success) return showToast(speed.error, "error");
      const reveal = await emitAck("ai-control", { mode: "reveal", enabled: data.get("revealBotHands") === "on" });
      if (!reveal.success) return showToast(reveal.error, "error");
      state.room = reveal.room;
      render();
      return;
    }
    if (form.classList.contains("bot-difficulty-form")) {
      const response = await emitAck("ai-control", { mode: "difficulty", botId: form.dataset.botId, difficulty: data.get("difficulty") });
      if (!response.success) showToast(response.error, "error");
      else { state.room = response.room; render(); }
      return;
    }

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
    if (form.id === "spectatorForm") {
      const name = String(data.get("name") || "Spectator").trim();
      const response = await emitAck("join-spectator", { name, roomCode: data.get("roomCode") }, false);
      if (!response.success) showToast(response.error, "error");
      else { setSpectator(response, name); render(); }
    }
    if (form.id === "uiSettingsForm") {
      for (const key of Object.keys(DEFAULT_UI_SETTINGS)) state.uiSettings[key] = data.get(key) === "on";
      saveUiSettings(); closeModal(); render(); return;
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
      const response = await emitAck("update-room-settings", { maxPlayers: Number(data.get("maxPlayers")), startingLife: Number(data.get("startingLife")), turnTimerSeconds: Number(data.get("turnTimerSeconds") || 0), allowSpectators: data.get("allowSpectators") === "1", enforceDeckRules: data.get("enforceDeckRules") === "1", allowInvalidDecks: data.get("allowInvalidDecks") === "1", autoStateBasedActions: data.get("autoStateBasedActions") === "1", freeCommanderMulligan: data.get("freeCommanderMulligan") === "1" });
      if (!response.success) showToast(response.error, "error");
      else { state.room = response.room; render(); }
    }
    if (form.id === "tokenForm") return gameAction({ type: "create-token", name: data.get("name"), power: data.get("power"), toughness: data.get("toughness") });
    if (form.id === "castCardForm") return gameAction({ type: "cast-card", cardId: data.get("cardId"), fromZone: data.get("fromZone"), targets: data.getAll("targets"), xValue:Number(data.get("xValue")||0), modes:String(data.get("modes")||"").split(";").map((v)=>v.trim()).filter(Boolean), additionalCosts:String(data.get("additionalCosts")||"").split(";").map((v)=>v.trim()).filter(Boolean), enforcePayment:data.get("enforcePayment")==="on", manaPayment:Object.fromEntries(["W","U","B","R","G","C"].map((symbol)=>[symbol,Number(data.get(`pay${symbol}`)||0)])) });
    if (form.id === "abilityForm") return gameAction({ type: "activate-card", cardId: data.get("cardId"), text: data.get("text"), tapCost: data.get("tapCost") === "1", targets: data.getAll("targets") });
    if (form.id === "customStackForm") return gameAction({ type: "push-stack-item", kind: "custom", name: data.get("name"), text: data.get("text"), targets: data.getAll("targets"), effect: { action: data.get("effectAction"), amount: Number(data.get("amount") || 0), counterName: data.get("effectName"), tokenName: data.get("effectName"), power: "1", toughness: "1" } });
    if (form.id === "tempEffectForm") return gameAction({ type: "add-temp-effect", cardId: data.get("cardId"), label: data.get("label"), power: Number(data.get("power") || 0), toughness: Number(data.get("toughness") || 0), keyword: data.get("keyword"), expires: data.get("expires") });
    if (form.id === "controlChangeForm") return gameAction({ type: "change-controller", cardId: data.get("cardId"), newControllerId: data.get("newControllerId") });
    if (form.id === "choiceForm") return gameAction({ type: "set-chosen-value", cardId: data.get("cardId"), key: data.get("key"), value: data.get("value") });
    if (form.id === "finishMulliganForm") return gameAction({ type:"finish-mulligan", cardIds:data.getAll("cardIds") });
    if (form.classList.contains("decision-form")) return gameAction({ type:"resolve-decision", decisionId:form.dataset.decisionId, selections:data.getAll("selections") });
    if (form.id === "judgeMoveForm") return gameAction({type:"judge-action",mode:"move-card",cardId:data.get("cardId"),destination:data.get("destination")});
    if (form.id === "judgePlayerForm") return gameAction({type:"judge-action",mode:"set-player",targetPlayerId:data.get("targetPlayerId"),field:data.get("field"),value:data.get("value")});
    if (form.id === "judgeCardForm") return gameAction({type:"judge-action",mode:"set-card",cardId:data.get("cardId"),field:data.get("field"),value:data.get("value")});
    if (form.id === "judgeObjectForm") return gameAction({type:"judge-action",mode:"create-object",targetPlayerId:data.get("targetPlayerId"),name:data.get("name"),objectType:data.get("objectType"),power:data.get("power"),toughness:data.get("toughness"),notes:data.get("notes")});
    if (form.id === "judgeEffectForm") return gameAction({type:"judge-action",mode:"add-effect",kind:data.get("kind"),label:data.get("label"),targetIds:data.get("targetId")?[`card:${data.get("targetId")}`]:[],power:Number(data.get("power")||0),toughness:Number(data.get("toughness")||0),keyword:data.get("keyword"),layer:Number(data.get("layer")||7),expires:data.get("expires"),event:data.get("event"),operation:data.get("operation"),notes:data.get("notes")});
    if (form.id === "judgeRoleForm") return gameAction({type:"judge-action",mode:"role",role:data.get("role"),targetPlayerId:data.get("targetPlayerId")});
    if (form.id === "judgeLoopForm") return gameAction({type:"judge-action",mode:"loop",text:data.get("text"),result:data.get("result")});
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

  document.addEventListener("dragstart", (event) => {
    const cardElement = event.target.closest(".arena-card[draggable='true']");
    if (!cardElement || isSpectator()) return;
    state.dragSource = { cardId: cardElement.dataset.cardId, zone: cardElement.dataset.zone, ownerId: cardElement.dataset.ownerId };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", cardElement.dataset.cardId);
    document.body.classList.add("is-dragging-card");
  });

  document.addEventListener("dragend", () => {
    state.dragSource = null;
    document.body.classList.remove("is-dragging-card");
    document.querySelectorAll(".drag-over").forEach((element) => element.classList.remove("drag-over"));
  });

  document.addEventListener("dragover", (event) => {
    const target = event.target.closest("[data-drop-player-id],[data-drop-zone],.arena-card[data-card-id]");
    if (!target || !state.dragSource) return;
    event.preventDefault();
    target.classList.add("drag-over");
  });

  document.addEventListener("dragleave", (event) => event.target.closest(".drag-over")?.classList.remove("drag-over"));

  document.addEventListener("drop", async (event) => {
    const source = state.dragSource;
    if (!source) return;
    event.preventDefault();
    const playerTarget = event.target.closest("[data-drop-player-id]");
    const zoneTarget = event.target.closest("[data-drop-zone]");
    const cardTarget = event.target.closest(".arena-card[data-card-id]");
    state.dragSource = null;
    document.body.classList.remove("is-dragging-card");
    if (cardTarget && cardTarget.dataset.cardId !== source.cardId) {
      const target = findCard(cardTarget.dataset.cardId)?.card;
      const sourceCard = findCard(source.cardId)?.card;
      if (!target || !sourceCard) return;
      const blockOption = target.attacking && target.defendingPlayerId === state.session?.playerId;
      openModal("Choose card interaction", `<div class="drag-choice"><p><strong>${escapeHtml(sourceCard.name)}</strong> → <strong>${escapeHtml(target.name)}</strong></p><button class="combat-button" data-action="confirm-target" data-game-type="fight-card" data-source-card-id="${sourceCard.id}" data-target-card-id="${target.id}">Fight</button>${blockOption ? `<button class="combat-button" data-action="confirm-target" data-game-type="block-card" data-source-card-id="${sourceCard.id}" data-target-card-id="${target.id}">Block</button>` : ""}<button class="secondary-button" data-action="confirm-target" data-game-type="attach-card" data-source-card-id="${sourceCard.id}" data-target-card-id="${target.id}">Attach</button></div>`);
      return;
    }
    if (zoneTarget?.dataset.dropZone && zoneTarget.dataset.dropZone !== source.zone) {
      return gameAction({ type: "move-card", cardId: source.cardId, fromZone: source.zone, toZone: zoneTarget.dataset.dropZone });
    }
    if (playerTarget && source.zone === "battlefield" && playerTarget.dataset.dropPlayerId !== state.session?.playerId) {
      return gameAction({ type: "declare-attacker", cardId: source.cardId, defenderPlayerId: playerTarget.dataset.dropPlayerId });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { state.targetMode = null; state.activeDrawer = null; closeModal(); render(); }
    if ((event.key === " " || event.key === "Enter") && event.target.matches(".arena-card")) event.target.click();
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
    reconnectOverlay?.classList.add("is-hidden");
    if (state.session) rejoinSavedRoom();
    else if (state.spectator) rejoinSpectator();
  });
  socket.on("disconnect", () => { setConnection("offline", "Reconnecting…"); if (state.room) reconnectOverlay?.classList.remove("is-hidden"); });
  socket.on("connect_error", () => { setConnection("offline", "Connection error"); if (state.room) reconnectOverlay?.classList.remove("is-hidden"); });
  socket.on("room-updated", (room) => { const previous = state.room; state.previousRoom = previous; state.room = room; processRoomTransition(previous, room); render(); maybeAutoPass(); });
  socket.on("removed-from-room", (payload) => { clearSession(); closeModal(); render(); showToast(payload?.message || "You left the room.", "warning"); });
  socket.on("server-message", (payload) => { if (payload?.message) showToast(payload.message, payload.type); });

  modalBackdrop.addEventListener("click", (event) => { if (event.target === modalBackdrop) closeModal(); });
  brandButton.addEventListener("click", () => { if (!state.room) { state.view = "home"; render(); } });
  settingsButton?.addEventListener("click", openUiSettings);
  fullscreenButton?.addEventListener("click", async () => { if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.().catch(() => undefined); else await document.exitFullscreen?.().catch(() => undefined); });
  window.addEventListener("resize", () => window.requestAnimationFrame(drawArenaLines));
  window.setInterval(updateTurnClock, 1000);

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
