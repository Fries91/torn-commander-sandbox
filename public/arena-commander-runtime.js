/*
 * Arena Commander Stable Runtime v63.0.0
 * Permanent consolidated replacement for the v61-v62.8 browser patch files.
 * Keep source sections in this order because some install hooks before app.js.
 */

/* ===== Arena table and six-player focus ===== */
(() => {
  "use strict";

  const VERSION = "60.10.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const SETTINGS_KEY = "tornCommander.uiSettings.v20";
  const PRIVATE_HAND_PREFIX = "arenaCommander.privateHand.v60.10:";
  const originalIo = window.io;
  const privateHands = new Map();
  let lastRoom = null;

  function clone(value) {
    if (value == null) return value;
    try {
      return structuredClone(value);
    } catch {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    }
  }

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY));
      return value?.roomCode && value?.playerId && value?.sessionToken ? value : null;
    } catch {
      return null;
    }
  }

  function enableVisibleCards() {
    try {
      const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({
          ...settings,
          lowData: false,
          animations: false,
          vibration: false,
          sound: false,
          showArrows: false,
          autoPassEmpty: false
        })
      );
    } catch {}
  }

  function handCacheKey(roomCode, playerId) {
    return `${String(roomCode || "")}:${String(playerId || "")}`;
  }

  function readStoredHand(key) {
    if (privateHands.has(key)) return clone(privateHands.get(key));
    try {
      const stored = JSON.parse(sessionStorage.getItem(PRIVATE_HAND_PREFIX + key));
      if (Array.isArray(stored)) {
        privateHands.set(key, stored);
        return clone(stored);
      }
    } catch {}
    return null;
  }

  function storeHand(key, hand) {
    const safeHand = clone(hand);
    privateHands.set(key, safeHand);
    try {
      sessionStorage.setItem(PRIVATE_HAND_PREFIX + key, JSON.stringify(safeHand));
    } catch {}
  }

  function captureRoom(room) {
    if (room && typeof room === 'object') {
      lastRoom = room;
      window.__arenaCommanderRoomV610 = room;
    }
  }

  function preservePrivateHand(room, explicitPlayerId = "") {
    if (!room || typeof room !== "object") return room;

    const session = readSession();
    const playerId = explicitPlayerId || session?.playerId || "";
    if (!playerId) {
      captureRoom(room);
      return room;
    }

    const player = Array.isArray(room.players)
      ? room.players.find((entry) => String(entry?.id || "") === String(playerId))
      : null;

    if (!player?.game) {
      captureRoom(room);
      return room;
    }

    const key = handCacheKey(room.code || session?.roomCode, playerId);
    const reportedCount = Number(player.game.handCount);
    const hasHandArray = Array.isArray(player.game.hand);
    const handLooksRedacted =
      hasHandArray &&
      player.game.hand.length === 0 &&
      Number.isFinite(reportedCount) &&
      reportedCount > 0;

    if (hasHandArray && !handLooksRedacted) {
      storeHand(key, player.game.hand);
      player.game.handCount = player.game.hand.length;
    } else {
      const cached = readStoredHand(key);
      if (Array.isArray(cached)) {
        player.game.hand = cached;
        player.game.handCount = cached.length;
      }
    }

    captureRoom(room);
    return room;
  }

  function wrapResponse(response, playerId = "") {
    if (response && typeof response === "object" && response.room) {
      response.room = preservePrivateHand(response.room, response.playerId || playerId);
    }
    return response;
  }

  function installSocketProtection() {
    if (typeof originalIo !== "function") return;

    function protectedIo(...argumentsList) {
      const socket = originalIo(...argumentsList);
      const originalOn = socket.on.bind(socket);
      const originalEmit = socket.emit.bind(socket);

      socket.on = function protectedOn(eventName, handler) {
        if (eventName === "room-updated" && typeof handler === "function") {
          return originalOn(eventName, (room) => handler(preservePrivateHand(room)));
        }
        return originalOn(eventName, handler);
      };

      socket.emit = function protectedEmit(eventName, ...emitArguments) {
        const finalIndex = emitArguments.length - 1;
        if (finalIndex >= 0 && typeof emitArguments[finalIndex] === "function") {
          const acknowledgement = emitArguments[finalIndex];
          emitArguments[finalIndex] = function protectedAcknowledgement(response) {
            return acknowledgement(wrapResponse(response));
          };
        }
        return originalEmit(eventName, ...emitArguments);
      };

      return socket;
    }

    Object.assign(protectedIo, originalIo);
    Object.setPrototypeOf(protectedIo, originalIo);
    window.io = protectedIo;
  }

  function getPlayer(playerId) {
    const room = lastRoom || window.__arenaCommanderRoomV610;
    return room?.players?.find((player) => String(player.id) === String(playerId)) || null;
  }

  function cardImage(card) {
    return card?.cardData?.imageUrl || card?.imageUrl || card?.cardData?.faces?.[0]?.imageUrl || card?.cardData?.artCropUrl || card?.artCropUrl || "";
  }

  function topCard(list) {
    return Array.isArray(list) && list.length ? list[list.length - 1] : null;
  }

  function createZone(label, className, dropZone = "battlefield") {
    const section = document.createElement("section");
    section.className = `v610-mat-zone ${className}`;
    if (dropZone) section.dataset.dropZone = dropZone;

    const heading = document.createElement("div");
    heading.className = "v610-zone-label";
    heading.textContent = label;

    const row = document.createElement("div");
    row.className = "v610-card-row";
    if (dropZone) row.dataset.dropZone = dropZone;

    section.append(heading, row);
    return { section, row };
  }

  function isLandGroup(group) {
    const typeLine = group.querySelector(".arena-card-type")?.textContent || "";
    return /(^|\s|—|-)land(\s|$)/i.test(typeLine);
  }

  function repairBattlefield(board) {
    const source = board.querySelector(":scope > .arena-battlefield-cards");
    if (!source) return;

    if (!source.querySelector(":scope > .v610-playmat")) {
      const playmat = document.createElement("div");
      playmat.className = "v610-playmat";

      const battlefieldZone = createZone("BATTLEFIELD", "v610-permanent-zone", "battlefield");
      const landsZone = createZone("LANDS", "v610-land-zone", "battlefield");

      const children = Array.from(source.children);
      let permanentCount = 0;
      let landCount = 0;

      for (const child of children) {
        if (child.classList.contains("arena-card-group")) {
          if (isLandGroup(child)) {
            landsZone.row.appendChild(child);
            landCount += 1;
          } else {
            battlefieldZone.row.appendChild(child);
            permanentCount += 1;
          }
        } else if (child.classList.contains("arena-empty-board")) {
          child.classList.add("v610-empty-board");
          battlefieldZone.row.appendChild(child);
        } else {
          battlefieldZone.row.appendChild(child);
        }
      }

      if (!permanentCount && !battlefieldZone.row.children.length) {
        const empty = document.createElement("div");
        empty.className = "v610-empty-board";
        empty.textContent = "Drop permanents here";
        battlefieldZone.row.appendChild(empty);
      }

      if (!landCount) {
        const empty = document.createElement("div");
        empty.className = "v610-empty-board v610-empty-lands";
        empty.textContent = "Drop lands here";
        landsZone.row.appendChild(empty);
      }

      playmat.append(battlefieldZone.section, landsZone.section);
      source.replaceChildren(playmat);
      source.classList.add("v610-battlefield-source");
    }

    source.querySelectorAll('.v610-mat-zone, .v610-card-row').forEach((element) => {
      element.dataset.dropZone = 'battlefield';
    });
  }

  function buildZonePreview(button, player) {
    const zone = button.dataset.zone;
    if (zone === 'hand') return null;

    const preview = document.createElement('div');
    preview.className = 'v610-zone-preview';

    let card = null;
    if (zone === 'commandZone') card = topCard(player?.game?.commandZone);
    if (zone === 'graveyard') card = topCard(player?.game?.graveyard);
    if (zone === 'exile') card = topCard(player?.game?.exile);

    if (zone === 'library') {
      preview.classList.add('is-library');
      preview.innerHTML = '<div class="v610-cardback"><span>Arena</span><small>Deck</small></div>';
      return preview;
    }

    const image = cardImage(card);
    if (image) {
      const img = document.createElement('img');
      img.src = image;
      img.alt = card?.name || zone;
      img.loading = 'lazy';
      img.decoding = 'async';
      preview.appendChild(img);
    } else {
      preview.classList.add('is-empty');
      const text = document.createElement('span');
      text.textContent = zone === 'commandZone' ? '♛' : zone === 'graveyard' ? '☠' : '◇';
      preview.appendChild(text);
    }

    if (zone === 'exile') preview.classList.add('is-exile');
    if (zone === 'graveyard') preview.classList.add('is-graveyard');
    if (zone === 'commandZone') preview.classList.add('is-command');
    return preview;
  }

  function decorateZoneButton(button, player) {
    const zone = button.dataset.zone;
    let preview = button.querySelector(':scope > .v610-zone-preview');
    const desired = buildZonePreview(button, player);

    if (preview) preview.remove();
    if (desired) {
      button.insertBefore(desired, button.firstChild);
    }

    if (zone === 'graveyard') {
      button.dataset.dropZone = 'graveyard';
    } else if (zone === 'exile') {
      button.dataset.dropZone = 'exile';
    } else if (zone === 'hand') {
      button.dataset.dropZone = 'hand';
    } else if (zone === 'commandZone') {
      button.dataset.dropZone = 'commandZone';
    }
  }

  function decorateZonePiles(piles) {
    const buttons = Array.from(piles.querySelectorAll(':scope > .arena-zone-pile'));
    const playerId = buttons[0]?.dataset.playerId;
    const player = getPlayer(playerId);
    for (const button of buttons) decorateZoneButton(button, player);
  }

  function orderZonePiles(piles) {
    const order = ["commandZone", "exile", "library", "graveyard", "hand"];
    const labels = {
      commandZone: "Command",
      exile: "Exile",
      library: "Library",
      graveyard: "Graveyard",
      hand: "Hand"
    };

    const buttons = order
      .map((zone) => piles.querySelector(`[data-zone="${zone}"]`))
      .filter(Boolean);

    for (const button of buttons) {
      const zone = button.dataset.zone;
      const label = button.querySelector("small");
      if (label && labels[zone] && label.textContent !== labels[zone]) {
        label.textContent = labels[zone];
      }
    }

    const current = Array.from(piles.children).filter((child) => child.matches?.('.arena-zone-pile'));
    const alreadyOrdered = current.length === buttons.length && current.every((button, index) => button === buttons[index]);
    if (!alreadyOrdered) {
      for (const button of buttons) piles.appendChild(button);
    }

    decorateZonePiles(piles);
  }

  function repairSeat(seat) {
    if (!seat) return;

    if (seat.classList.contains('v610-seat-ready')) {
      const existingBoard = seat.querySelector('.arena-seat-board');
      const existingPiles = seat.querySelector('.arena-zone-piles');
      if (existingBoard) repairBattlefield(existingBoard);
      if (existingPiles) orderZonePiles(existingPiles);
      return;
    }

    const header = seat.querySelector(':scope > .arena-seat-header');
    const life = seat.querySelector(':scope > .seat-life');
    const secondary = seat.querySelector(':scope > .seat-secondary');
    const board = seat.querySelector(':scope > .arena-seat-board');
    const piles = seat.querySelector(':scope > .arena-zone-piles');
    if (!header || !board || !piles) return;

    repairBattlefield(board);
    orderZonePiles(piles);

    const content = document.createElement('div');
    content.className = 'v610-seat-content';

    const fieldColumn = document.createElement('div');
    fieldColumn.className = 'v610-field-column';

    const zoneColumn = document.createElement('aside');
    zoneColumn.className = 'v610-zone-column';

    fieldColumn.appendChild(board);
    if (life) zoneColumn.appendChild(life);
    zoneColumn.appendChild(piles);
    content.append(fieldColumn, zoneColumn);
    header.insertAdjacentElement('afterend', content);

    if (secondary) seat.appendChild(secondary);
    seat.classList.add('v610-seat-ready');
  }

  function markRealCards(scope) {
    for (const card of scope.querySelectorAll('.arena-card')) {
      const hasImage = card.querySelector('.arena-card-image img');
      card.classList.toggle('v610-real-card', Boolean(hasImage));
    }
  }

  function repairHandTray(tray) {
    if (!tray) return;
    tray.classList.add('v610-hand-ready');
    const label = tray.querySelector('.hand-label strong');
    if (label && label.textContent !== 'YOUR HAND') label.textContent = 'YOUR HAND';
    for (const card of tray.querySelectorAll('.hand-card-wrap')) {
      card.classList.add('v610-hand-card-visible');
    }
    markRealCards(tray);
  }

  function repairPlaymat() {
    const shell = document.querySelector('.arena-game-shell');
    document.body.classList.toggle('v610-game-visible', Boolean(shell));
    if (!shell) return;

    shell.classList.add('arena-v610', 'playmat-v610');
    for (const seat of shell.querySelectorAll('.arena-seat')) repairSeat(seat);
    repairHandTray(shell.querySelector('.arena-hand-tray'));
    markRealCards(shell);
  }

  let repairQueued = false;
  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repairPlaymat();
    });
  }

  enableVisibleCards();
  installSocketProtection();

  function startObserver() {
    const app = document.getElementById('app');
    if (!app) return;
    const observer = new MutationObserver(scheduleRepair);
    observer.observe(app, { childList: true, subtree: true });
    repairPlaymat();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }

  window.ArenaCommanderPlaymatV610 = {
    version: VERSION,
    preservePrivateHand,
    repairPlaymat,
    getRoom: () => lastRoom
  };
})();

/* ===== Full card artwork and leave match ===== */
(() => {
  "use strict";

  const VERSION = "61.2.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const CARD_QUERY = ".arena-game-shell .arena-card";
  let observer = null;
  let repairQueued = false;

  function currentSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
    } catch {
      return null;
    }
  }

  function roomSnapshot() {
    return (
      window.ArenaCommanderPlaymatV610?.getRoom?.() ||
      window.ArenaCommanderFinalV61?.getRoom?.() ||
      window.__arenaCommanderRoomV610 ||
      null
    );
  }

  function cardRecord(cardId) {
    const room = roomSnapshot();
    if (!room || !cardId) return null;

    for (const player of room.players || []) {
      const game = player?.game || {};
      const zones = [
        game.hand,
        game.battlefield,
        game.graveyard,
        game.exile,
        game.commandZone,
        game.library
      ];

      for (const zone of zones) {
        if (!Array.isArray(zone)) continue;
        const found = zone.find((card) => String(card?.id || "") === String(cardId));
        if (found) return found;
      }
    }

    return null;
  }

  function imageCandidates(card) {
    if (!card) return [];
    const activeFace = Number(card.activeFace || card.currentFace || 0);
    const faces = card.cardData?.faces || card.faces || [];
    const face = faces[activeFace] || faces[0] || null;

    return [
      face?.imageUrl,
      face?.normalImageUrl,
      face?.largeImageUrl,
      card.cardData?.imageUrl,
      card.imageUrl,
      card.normalImageUrl,
      card.largeImageUrl
    ].filter(Boolean);
  }

  function forceCompleteArtwork(element) {
    if (!element) return;
    const cardId = element.dataset.cardId || "";
    const image = element.querySelector(".arena-card-image img");
    if (!image) return;

    const record = cardRecord(cardId);
    const candidate = imageCandidates(record)[0];
    if (candidate && image.src !== candidate) image.src = candidate;

    element.classList.add("v612-full-card-art");
    image.draggable = false;
    image.setAttribute("loading", "eager");
    image.setAttribute("decoding", "async");
  }

  function leaveButton() {
    const existing = document.querySelector(".arena-leave-button, [data-v612-leave-match]");
    if (existing) return existing;

    const shell = document.querySelector(".arena-game-shell");
    const topbar = shell?.querySelector(".arena-topbar, .arena-game-topbar, .arena-room-code")?.parentElement;
    if (!shell || !topbar) return null;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "small-button arena-leave-button";
    button.dataset.v612LeaveMatch = "true";
    button.textContent = "↩ LEAVE";
    button.setAttribute("aria-label", "Leave match and keep reconnect seat");
    topbar.appendChild(button);
    return button;
  }

  function repair() {
    const shell = document.querySelector(".arena-game-shell");
    if (!shell) return;

    shell.classList.add("artwork-v612");
    for (const card of document.querySelectorAll(CARD_QUERY)) forceCompleteArtwork(card);
    leaveButton();
  }

  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repair();
    });
  }

  function onClick(event) {
    const button = event.target.closest("[data-v612-leave-match]");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();

    if (!window.confirm("Leave this match? Your seat will remain available for reconnecting.")) return;

    const session = currentSession();
    try {
      localStorage.setItem("tornCommander.lastLeftRoom.v61.2", JSON.stringify(session || {}));
    } catch {}

    document.body.classList.remove("in-game", "v610-game-visible", "v61-focus-mode");
    const homeButton = document.getElementById("brandButton") || document.querySelector('[data-nav="home"]');
    if (homeButton) {
      homeButton.click();
    } else {
      location.assign("/");
    }
  }

  function start() {
    document.addEventListener("click", onClick, true);
    const app = document.getElementById("app");
    if (app) {
      observer = new MutationObserver(scheduleRepair);
      observer.observe(app, { childList: true, subtree: true });
    }
    repair();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.ArenaCommanderArtworkV612 = { version: VERSION, repair };
})();

/* ===== Automatic turn, stack and priority UI ===== */
(() => {
  "use strict";

  const VERSION = "62.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const SETTINGS_KEY = "arenaCommander.automation.v62";
  const POLL_MS = 1600;

  let state = null;
  let timer = null;
  let requestPending = false;
  let overlay = null;
  let eventCursor = "";
  let hiddenChoices = [];

  function session() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SESSION_KEY));
      return parsed?.roomCode && parsed?.playerId && parsed?.sessionToken ? parsed : null;
    } catch {
      return null;
    }
  }

  function preferences() {
    try {
      return {
        passUntilChange: false,
        autoPassPhase: false,
        yields: {},
        ...(JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {})
      };
    } catch {
      return { passUntilChange: false, autoPassPhase: false, yields: {} };
    }
  }

  function savePreferences(next) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); }
    catch {}
  }

  function hasGame() {
    return Boolean(document.querySelector(".arena-game-shell"));
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function toast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => item.remove(), 3300);
  }

  async function request(path, payload = {}) {
    const active = session();
    if (!active) throw new Error("No active table session.");

    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...active, ...payload })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success === false) {
      throw new Error(data.error || `Automation request failed (${response.status}).`);
    }
    return data;
  }

  function currentPlayer() {
    return state?.players?.find((player) => player.isViewer) || null;
  }

  function phaseTitle() {
    return state?.phaseLabel || state?.phase || "Game";
  }

  function automationBadge(level) {
    const normalized = String(level || "manual").toLowerCase();
    const title = normalized === "auto"
      ? "This effect can resolve automatically."
      : normalized === "assisted"
        ? "This effect needs one or more player choices."
        : "This effect needs manual table handling.";
    return `<span class="v62-auto-badge is-${escapeHtml(normalized)}" title="${escapeHtml(title)}">${escapeHtml(normalized.toUpperCase())}</span>`;
  }

  function renderPriorityStrip() {
    const players = state?.priority?.players || [];
    return `
      <div class="v62-priority-strip">
        ${players.map((player) => `
          <span class="${player.hasPriority ? "is-current" : ""} ${player.passed ? "is-passed" : ""}">
            ${escapeHtml(player.name)}
            ${player.hasPriority ? "●" : player.passed ? "✓" : ""}
          </span>
        `).join("")}
      </div>
    `;
  }

  function renderTriggerQueue() {
    const triggers = state?.triggerQueue || [];
    if (!triggers.length) return "";
    return `
      <section class="v62-trigger-list">
        <strong>Pending triggers</strong>
        ${triggers.map((trigger) => `
          <article>
            <div>
              <b>${escapeHtml(trigger.sourceName || "Triggered ability")}</b>
              <small>${escapeHtml(trigger.label || trigger.text || "Ability")}</small>
            </div>
            ${automationBadge(trigger.automation)}
          </article>
        `).join("")}
      </section>
    `;
  }

  function renderChoice(choice) {
    const options = choice.options || [];
    const multi = Number(choice.max || 1) > 1;
    return `
      <section class="v62-choice-card" data-choice-id="${escapeHtml(choice.id)}">
        <small>PLAYER CHOICE</small>
        <h3>${escapeHtml(choice.title || "Choose")}</h3>
        <p>${escapeHtml(choice.prompt || "Select an option.")}</p>
        <div class="v62-choice-options">
          ${options.map((option, index) => `
            <label>
              <input
                type="${multi ? "checkbox" : "radio"}"
                name="v62-choice-${escapeHtml(choice.id)}"
                value="${escapeHtml(option.id ?? option.value ?? index)}"
              >
              <span>
                ${option.imageUrl ? `<img src="${escapeHtml(option.imageUrl)}" alt="">` : ""}
                <b>${escapeHtml(option.label || option.name || option.value || `Option ${index + 1}`)}</b>
                ${option.detail ? `<small>${escapeHtml(option.detail)}</small>` : ""}
              </span>
            </label>
          `).join("")}
        </div>
        <div class="v62-choice-actions">
          ${choice.allowDecline ? '<button type="button" data-v62-choice-decline>Decline</button>' : ""}
          <button type="button" class="primary" data-v62-choice-submit>Confirm</button>
        </div>
      </section>
    `;
  }

  function renderPanel() {
    if (!hasGame() || !state) {
      overlay?.remove();
      overlay = null;
      return;
    }

    if (!overlay) {
      overlay = document.createElement("aside");
      overlay.id = "arenaAutomationV62";
      overlay.className = "v62-automation-panel";
      document.body.appendChild(overlay);
    }

    const prefs = preferences();
    const current = currentPlayer();
    const canPass = Boolean(state?.priority?.viewerHasPriority);
    const choices = state?.choices || [];

    overlay.innerHTML = `
      <header>
        <div>
          <small>TURN ${escapeHtml(state.turnNumber || "")}</small>
          <strong>${escapeHtml(phaseTitle())}</strong>
        </div>
        <div>
          <small>PRIORITY</small>
          <strong>${escapeHtml(state?.priority?.currentName || "—")}</strong>
        </div>
        <button type="button" data-v62-pass ${canPass ? "" : "disabled"}>PASS</button>
      </header>
      ${renderPriorityStrip()}
      <div class="v62-auto-controls">
        <button type="button" data-v62-pass-until class="${prefs.passUntilChange ? "is-on" : ""}">Pass until stack changes</button>
        <button type="button" data-v62-auto-phase class="${prefs.autoPassPhase ? "is-on" : ""}">Auto-pass this phase</button>
        <button type="button" data-v62-open-triggers>Triggers ${Number(state?.triggerQueue?.length || 0)}</button>
      </div>
      ${renderTriggerQueue()}
      ${choices.map(renderChoice).join("")}
      ${current?.automationHint ? `<p class="v62-automation-hint">${escapeHtml(current.automationHint)}</p>` : ""}
    `;
  }

  async function refresh() {
    if (requestPending || !hasGame() || !session()) return;
    requestPending = true;
    try {
      const response = await request("/api/gameplay-v62/state");
      state = response.state || null;
      hiddenChoices = state?.choices || [];
      renderPanel();
      maybeNotify();
      maybeAutoPass();
    } catch (error) {
      if (!/session|table/i.test(error.message)) console.warn(error);
    } finally {
      requestPending = false;
    }
  }

  function maybeNotify() {
    if (!state) return;
    const newest = state.events?.[0];
    const key = newest ? `${newest.id || ""}:${newest.type || ""}` : "";
    if (!key || key === eventCursor) return;
    eventCursor = key;

    if (newest.viewerNeedsAttention) {
      toast(newest.message || "You need to make a game choice.", "warning");
      try { navigator.vibrate?.([60, 40, 60]); } catch {}
    }
  }

  async function maybeAutoPass() {
    const prefs = preferences();
    if (!state?.priority?.viewerHasPriority || hiddenChoices.length) return;
    if (!prefs.autoPassPhase && !prefs.passUntilChange) return;

    if (prefs.passUntilChange && state.priority.stackSignature !== prefs.stackSignature) {
      prefs.passUntilChange = false;
      savePreferences(prefs);
      renderPanel();
      return;
    }

    try {
      await request("/api/gameplay-v62/action", { action: "pass-priority" });
      setTimeout(refresh, 80);
    } catch (error) {
      toast(error.message, "error");
    }
  }

  async function action(payload, successMessage = "") {
    if (requestPending) return;
    requestPending = true;
    try {
      await request("/api/gameplay-v62/action", payload);
      if (successMessage) toast(successMessage, "success");
    } catch (error) {
      toast(error.message, "error");
    } finally {
      requestPending = false;
      setTimeout(refresh, 80);
    }
  }

  function selectedChoiceValues(card) {
    return Array.from(card.querySelectorAll("input:checked")).map((input) => input.value);
  }

  function onClick(event) {
    const pass = event.target.closest("[data-v62-pass]");
    if (pass) {
      event.preventDefault();
      action({ action: "pass-priority" });
      return;
    }

    const passUntil = event.target.closest("[data-v62-pass-until]");
    if (passUntil) {
      event.preventDefault();
      const prefs = preferences();
      prefs.passUntilChange = !prefs.passUntilChange;
      prefs.stackSignature = state?.priority?.stackSignature || "";
      savePreferences(prefs);
      renderPanel();
      if (prefs.passUntilChange) maybeAutoPass();
      return;
    }

    const phase = event.target.closest("[data-v62-auto-phase]");
    if (phase) {
      event.preventDefault();
      const prefs = preferences();
      prefs.autoPassPhase = !prefs.autoPassPhase;
      savePreferences(prefs);
      renderPanel();
      if (prefs.autoPassPhase) maybeAutoPass();
      return;
    }

    const triggerButton = event.target.closest("[data-v62-open-triggers]");
    if (triggerButton) {
      event.preventDefault();
      overlay?.classList.toggle("show-triggers");
      return;
    }

    const submit = event.target.closest("[data-v62-choice-submit]");
    if (submit) {
      event.preventDefault();
      const card = submit.closest("[data-choice-id]");
      action({
        action: "answer-choice",
        choiceId: card?.dataset.choiceId,
        values: selectedChoiceValues(card)
      });
      return;
    }

    const decline = event.target.closest("[data-v62-choice-decline]");
    if (decline) {
      event.preventDefault();
      const card = decline.closest("[data-choice-id]");
      action({ action: "answer-choice", choiceId: card?.dataset.choiceId, decline: true });
      return;
    }

    const activate = event.target.closest("[data-v62-activate]");
    if (activate) {
      event.preventDefault();
      action({
        action: "activate-ability",
        cardId: activate.dataset.cardId,
        abilityIndex: Number(activate.dataset.abilityIndex || 0)
      });
      return;
    }

    const yieldButton = event.target.closest("[data-v62-yield]");
    if (yieldButton) {
      event.preventDefault();
      const key = yieldButton.dataset.v62Yield;
      const prefs = preferences();
      prefs.yields[key] = !prefs.yields[key];
      savePreferences(prefs);
      action({ action: "set-yield", key, enabled: prefs.yields[key] });
    }
  }

  function abilityButton(card) {
    const automation = card.dataset.automation || "";
    if (!automation) return;
    if (card.querySelector(".v62-card-automation")) return;

    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = `v62-card-automation is-${automation.toLowerCase()}`;
    badge.textContent = automation.toUpperCase();
    badge.title = card.dataset.automationReason || `${automation} card handling`;
    card.appendChild(badge);
  }

  function decorateCards() {
    document.querySelectorAll(".arena-card[data-automation]").forEach(abilityButton);
  }

  function start() {
    document.addEventListener("click", onClick, true);
    const app = document.getElementById("app");
    if (app) new MutationObserver(() => {
      decorateCards();
      if (!hasGame()) {
        overlay?.remove();
        overlay = null;
        state = null;
      }
    }).observe(app, { childList: true, subtree: true });

    decorateCards();
    timer = setInterval(refresh, POLL_MS);
    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ArenaCommanderGameplayV62 = {
    version: VERSION,
    refresh,
    getState: () => state
  };
})();

/* ===== Library back and focus controls ===== */
(() => {
  "use strict";

  const VERSION = "62.4.0";
  const CARD_BACK_URL = "/mtg-card-back-v62-1.png?v=62.4.0";
  const FOCUS_KEY = "arenaCommander.focusMode.v62.4";
  const SESSION_KEY = "tornCommander.session.v5";
  let repairQueued = false;
  let requestPending = false;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
    catch { return null; }
  }

  function shell() {
    return document.querySelector(".arena-game-shell");
  }

  function isGame() {
    return Boolean(shell());
  }

  function isFocusMode() {
    return document.body.classList.contains("v624-focus-mode");
  }

  function storedFocusMode() {
    try { return localStorage.getItem(FOCUS_KEY) === "1"; }
    catch { return false; }
  }

  function storeFocusMode(value) {
    try { localStorage.setItem(FOCUS_KEY, value ? "1" : "0"); }
    catch {}
  }

  function playerIdForSlot(slot) {
    return String(
      slot?.querySelector(".arena-seat")?.dataset.playerSeatId ||
      slot?.dataset.dropPlayerId ||
      ""
    );
  }

  function focusedOpponent(game) {
    const slots = Array.from(game.querySelectorAll(".arena-opponent-ring > .opponent-slot"));
    if (!slots.length) return null;

    const wanted = String(game.dataset.focusPlayerId || "");
    let selected = wanted
      ? slots.find((slot) => playerIdForSlot(slot) === wanted)
      : null;

    if (!selected) selected = slots.find((slot) => slot.classList.contains("v61-focus-visible"));
    if (!selected) selected = slots[0];

    for (const slot of slots) {
      const active = slot === selected;
      slot.classList.toggle("v624-selected-opponent", active);
      slot.classList.toggle("v61-focus-visible", active);
      slot.classList.toggle("v61-focus-hidden", !active);
    }

    if (selected) game.dataset.focusPlayerId = playerIdForSlot(selected);
    return selected;
  }

  function fixLibraryButton(button) {
    if (!button || button.dataset.zone !== "library") return;
    button.dataset.dropZone = "";

    let preview = button.querySelector(":scope > .v610-zone-preview");
    if (!preview) {
      preview = document.createElement("div");
      preview.className = "v610-zone-preview is-library";
      button.insertBefore(preview, button.firstChild);
    }

    preview.innerHTML = "";
    const image = document.createElement("img");
    image.src = CARD_BACK_URL;
    image.alt = "Magic card back";
    image.loading = "eager";
    image.decoding = "async";
    image.draggable = false;
    preview.appendChild(image);
  }

  function fixAllLibraries(game) {
    game.querySelectorAll('.arena-zone-pile[data-zone="library"]').forEach(fixLibraryButton);
  }

  function removeDuplicatePriorityMessages() {
    const seen = new Set();
    document.querySelectorAll(".toast, .arena-toast, .priority-toast").forEach((item) => {
      const text = item.textContent.trim().toLowerCase();
      if (!text.includes("you have priority")) return;
      if (seen.has(text)) item.remove();
      else seen.add(text);
    });
  }

  function toolbar(game) {
    let controls = game.querySelector(".v624-board-toolbar");
    if (controls) return controls;

    controls = document.createElement("div");
    controls.className = "v624-board-toolbar";
    controls.innerHTML = `
      <button type="button" data-v624-previous aria-label="Previous opponent">‹</button>
      <button type="button" data-v624-toggle-board>OPPONENT</button>
      <button type="button" data-v624-next aria-label="Next opponent">›</button>
      <button type="button" data-v624-table>TABLE</button>
    `;
    game.appendChild(controls);
    return controls;
  }

  function applyBoardVisibility(game) {
    const controls = toolbar(game);
    const selected = focusedOpponent(game);
    const opponentOpen = document.body.classList.contains("v624-opponent-open");
    const toggle = controls.querySelector("[data-v624-toggle-board]");
    if (toggle) toggle.textContent = opponentOpen ? "MY BOARD" : "OPPONENT";

    game.classList.toggle("v624-show-opponent", opponentOpen);
    game.classList.toggle("v624-show-self", !opponentOpen);

    if (!isFocusMode()) {
      game.classList.add("v624-normal-game");
      return;
    }

    game.classList.remove("v624-normal-game");
    const self = game.querySelector(".self-slot");
    const opponents = game.querySelector(".arena-opponent-ring");
    if (self) self.hidden = opponentOpen;
    if (opponents) opponents.hidden = !opponentOpen;
    if (selected) selected.hidden = false;
  }

  function enterFocusMode() {
    if (!isGame()) return;
    document.body.classList.add("v624-focus-mode");
    storeFocusMode(true);
    scheduleRepair();
  }

  function leaveFocusMode() {
    document.body.classList.remove("v624-focus-mode", "v624-opponent-open");
    storeFocusMode(false);
    const game = shell();
    if (game) {
      game.querySelector(".self-slot")?.removeAttribute("hidden");
      game.querySelector(".arena-opponent-ring")?.removeAttribute("hidden");
      game.querySelectorAll(".opponent-slot").forEach((slot) => slot.removeAttribute("hidden"));
    }
    scheduleRepair();
  }

  function toggleFocusMode() {
    if (!isGame()) return;
    if (isFocusMode()) leaveFocusMode();
    else enterFocusMode();
  }

  function cycleOpponent(game, direction) {
    const slots = Array.from(game.querySelectorAll(".arena-opponent-ring > .opponent-slot"));
    if (!slots.length) return;
    const currentId = String(game.dataset.focusPlayerId || "");
    let index = slots.findIndex((slot) => playerIdForSlot(slot) === currentId);
    if (index < 0) index = 0;
    index = (index + direction + slots.length) % slots.length;
    game.dataset.focusPlayerId = playerIdForSlot(slots[index]);
    document.body.classList.add("v624-opponent-open");
    scheduleRepair();
  }

  function scrollToBoard(openOpponent) {
    const game = shell();
    if (!game) return;
    document.body.classList.toggle("v624-opponent-open", openOpponent);
    applyBoardVisibility(game);

    const target = openOpponent
      ? focusedOpponent(game)?.querySelector(".arena-seat") || focusedOpponent(game)
      : game.querySelector(".self-slot .arena-seat") || game.querySelector(".self-slot");

    target?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  function repair() {
    const game = shell();
    document.body.classList.toggle("v624-has-game", Boolean(game));
    if (!game) {
      document.body.classList.remove("v624-focus-mode", "v624-opponent-open");
      return;
    }

    game.classList.add("v624-tabletop");
    fixAllLibraries(game);
    applyBoardVisibility(game);
    removeDuplicatePriorityMessages();
  }

  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repair();
    });
  }

  function onClick(event) {
    const fullscreen = event.target.closest("#fullscreenButton");
    if (fullscreen && isGame()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      toggleFocusMode();
      return;
    }

    const game = shell();
    if (!game) return;

    if (event.target.closest("[data-v624-toggle-board]")) {
      event.preventDefault();
      scrollToBoard(!document.body.classList.contains("v624-opponent-open"));
      return;
    }
    if (event.target.closest("[data-v624-previous]")) {
      event.preventDefault();
      cycleOpponent(game, -1);
      return;
    }
    if (event.target.closest("[data-v624-next]")) {
      event.preventDefault();
      cycleOpponent(game, 1);
      return;
    }
    if (event.target.closest("[data-v624-table]")) {
      event.preventDefault();
      game.querySelector('[data-v61-table-button], [data-action="table-overview"]')?.click();
      return;
    }
  }

  function start() {
    document.addEventListener("click", onClick, true);
    const app = document.getElementById("app");
    if (app) new MutationObserver(scheduleRepair).observe(app, { childList: true, subtree: true });
    window.addEventListener("pageshow", scheduleRepair);
    window.addEventListener("resize", scheduleRepair, { passive: true });
    if (storedFocusMode() && isGame()) document.body.classList.add("v624-focus-mode");
    scheduleRepair();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ArenaCommanderTabletopV624 = {
    version: VERSION,
    enterFocusMode,
    leaveFocusMode,
    showMine: () => scrollToBoard(false),
    showOpponent: () => scrollToBoard(true),
    repair
  };
})();

/* ===== Touch card movement and card hold ===== */
(() => {
  "use strict";

  const VERSION = "62.8.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const MIN_DRAG_DISTANCE = 12;
  const LONG_PRESS_DELAY = 430;

  let gesture = null;
  let requestPending = false;
  let suppressClicksUntil = 0;
  let programmaticClick = false;
  let repairQueued = false;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
    catch { return null; }
  }

  function gameShell() {
    return document.querySelector(".arena-game-shell");
  }

  function isMobilePointer(event) {
    return ["touch", "pen"].includes(String(event.pointerType || ""));
  }

  function toast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.textContent = message;
    region.appendChild(item);
    window.setTimeout(() => item.remove(), 3200);
  }

  function zoneLabel(zone) {
    return ({
      battlefield: "Battlefield",
      hand: "Hand",
      graveyard: "Graveyard",
      exile: "Exile",
      commandZone: "Command Zone"
    })[zone] || zone;
  }

  function cardImage(card) {
    return card.querySelector(".arena-card-image img")?.currentSrc ||
      card.querySelector(".arena-card-image img")?.src || "";
  }

  function cardName(card) {
    return card.querySelector(".arena-card-frame header strong")?.textContent?.trim() ||
      card.getAttribute("aria-label") || "Card";
  }

  function cardType(card) {
    return card.querySelector(".arena-card-type")?.textContent?.trim() || "";
  }

  function clearNativeImageBehaviour(card) {
    card.draggable = false;
    card.setAttribute("draggable", "false");
    card.style.webkitUserDrag = "none";
    card.querySelectorAll("img").forEach((image) => {
      image.draggable = false;
      image.setAttribute("draggable", "false");
      image.style.webkitUserDrag = "none";
      image.style.webkitTouchCallout = "none";
      image.setAttribute("oncontextmenu", "return false");
    });
  }

  function ownCard(card) {
    return card.dataset.isSelf === "true" ||
      Boolean(card.closest(".self-slot, .arena-seat.is-self, .arena-hand-tray"));
  }

  function sourceZone(card) {
    return String(card.dataset.cardZone || card.closest("[data-zone]")?.dataset.zone || "");
  }

  function playerId(card) {
    return String(card.dataset.playerId || card.closest("[data-player-id]")?.dataset.playerId || "");
  }

  function cardId(card) {
    return String(card.dataset.cardId || card.closest("[data-card-id]")?.dataset.cardId || "");
  }

  function canPlayOnStack(card) {
    const zone = sourceZone(card);
    return ownCard(card) && ["hand", "commandZone"].includes(zone);
  }

  function findUnderlyingAction(card, action) {
    const selector = [
      `[data-card-id="${CSS.escape(cardId(card))}"][data-action="${action}"]`,
      `[data-card-id="${CSS.escape(cardId(card))}"][data-card-action="${action}"]`
    ].join(",");
    return document.querySelector(selector);
  }

  function playOnStack(card) {
    const id = cardId(card);
    if (!id) return;

    const existing = findUnderlyingAction(card, "cast-spell") ||
      findUnderlyingAction(card, "play-card") ||
      findUnderlyingAction(card, "cast");

    if (existing) {
      programmaticClick = true;
      existing.click();
      programmaticClick = false;
      closeReader();
      return;
    }

    const active = session();
    if (!active) {
      toast("No active room session.", "error");
      return;
    }

    requestPending = true;
    fetch("/api/room/action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...active,
        type: "cast-card",
        cardId: id,
        fromZone: sourceZone(card) || "hand"
      })
    })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (!response.ok || data.success === false) throw new Error(data.error || "Could not play that card.");
        toast(`${cardName(card)} was placed on the stack.`, "success");
        closeReader();
      })
      .catch((error) => toast(error.message, "error"))
      .finally(() => { requestPending = false; });
  }

  function closeReader() {
    document.getElementById("v628CardReader")?.remove();
    document.body.classList.remove("v628-reader-open");
  }

  function openReader(card) {
    if (!card?.isConnected) return;
    closeReader();
    const overlay = document.createElement("div");
    overlay.id = "v628CardReader";
    overlay.className = "v628-card-reader";
    overlay.innerHTML = `
      <section>
        <header>
          <div>
            <small>${escapeHtml(sourceZone(card) || "Card")}</small>
            <h2>${escapeHtml(cardName(card))}</h2>
          </div>
          <button type="button" data-v628-close-reader aria-label="Close card">×</button>
        </header>
        <div class="v628-reader-body">
          ${cardImage(card) ? `<img src="${escapeHtml(cardImage(card))}" alt="${escapeHtml(cardName(card))}" draggable="false">` : ""}
          <div class="v628-reader-info">
            <strong>${escapeHtml(cardType(card))}</strong>
            ${card.querySelector(".arena-card-frame footer")?.textContent?.trim() ? `<p>${escapeHtml(card.querySelector(".arena-card-frame footer").textContent.trim())}</p>` : ""}
          </div>
        </div>
        <footer>
          ${canPlayOnStack(card) ? '<button type="button" class="primary" data-v628-play-stack>PLAY ON STACK</button>' : ""}
          <button type="button" data-v628-close-reader>CLOSE</button>
        </footer>
      </section>
    `;
    overlay.__sourceCard = card;
    document.body.appendChild(overlay);
    document.body.classList.add("v628-reader-open");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function clearGesture() {
    if (!gesture) return;
    window.clearTimeout(gesture.timer);
    gesture.ghost?.remove();
    document.querySelectorAll(".v622-drop-active, .v622-drop-current")
      .forEach((element) => element.classList.remove("v622-drop-active", "v622-drop-current"));
    gesture = null;
  }

  function dropTargets(card) {
    const targets = [];
    const ownSeat = gameShell()?.querySelector(".self-slot .arena-seat, .arena-seat.is-self");
    const ownBoard = ownSeat?.querySelector(".arena-seat-board, .v610-playmat");
    if (ownBoard) {
      ownBoard.dataset.dropZone = "battlefield";
      targets.push(ownBoard);
    }

    gameShell()?.querySelectorAll(".self-slot [data-drop-zone], .arena-seat.is-self [data-drop-zone]")
      .forEach((target) => {
        if (!targets.includes(target) && target.dataset.dropZone && target.dataset.dropZone !== "library") targets.push(target);
      });

    if (sourceZone(card) === "battlefield" && ownCard(card)) {
      gameShell()?.querySelectorAll(".opponent-slot.v628-focus-visible .arena-seat, .opponent-slot.v61-focus-visible .arena-seat, .v624-selected-opponent .arena-seat")
        .forEach((target) => {
          target.dataset.dropPlayerId ||= target.dataset.playerSeatId || target.closest("[data-drop-player-id]")?.dataset.dropPlayerId || "";
          if (!targets.includes(target)) targets.push(target);
        });
    }
    return targets;
  }

  function startDrag(event) {
    if (!gesture || gesture.dragging) return;
    gesture.dragging = true;
    suppressClicksUntil = Date.now() + 800;
    closeReader();

    const rect = gesture.card.getBoundingClientRect();
    const ghost = gesture.card.cloneNode(true);
    ghost.classList.add("v622-drag-ghost");
    Object.assign(ghost.style, {
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      left: `${event.clientX - rect.width / 2}px`,
      top: `${event.clientY - rect.height / 2}px`
    });
    ghost.querySelectorAll("img").forEach((image) => image.draggable = false);
    document.body.appendChild(ghost);
    gesture.ghost = ghost;

    gesture.targets = dropTargets(gesture.card);
    gesture.targets.forEach((target) => target.classList.add("v622-drop-active"));
  }

  function pointTarget(x, y) {
    const candidates = document.elementsFromPoint(x, y);
    if (!gesture) return null;
    return gesture.targets.find((target) => candidates.includes(target) || candidates.some((item) => target.contains(item))) || null;
  }

  function updateDrag(event) {
    if (!gesture?.dragging) return;
    const rect = gesture.ghost.getBoundingClientRect();
    gesture.ghost.style.left = `${event.clientX - rect.width / 2}px`;
    gesture.ghost.style.top = `${event.clientY - rect.height / 2}px`;

    const current = pointTarget(event.clientX, event.clientY);
    gesture.targets.forEach((target) => target.classList.toggle("v622-drop-current", target === current));
    gesture.current = current;
  }

  function apiMove(card, target) {
    const active = session();
    if (!active || requestPending) return;
    const targetPlayerId = target.dataset.dropPlayerId || "";
    const destinationZone = target.dataset.dropZone || "";

    if (targetPlayerId && sourceZone(card) === "battlefield") {
      const attackButton = findUnderlyingAction(card, "declare-attacker");
      if (attackButton) {
        programmaticClick = true;
        attackButton.click();
        programmaticClick = false;
        return;
      }
    }

    if (!destinationZone) {
      toast("Drop the card inside a highlighted zone.", "warning");
      return;
    }

    requestPending = true;
    fetch("/api/room/action", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...active,
        type: "move-card",
        cardId: cardId(card),
        fromZone: sourceZone(card),
        toZone: destinationZone,
        targetPlayerId: targetPlayerId || playerId(card) || active.playerId
      })
    })
      .then((response) => response.json().then((data) => ({ response, data })))
      .then(({ response, data }) => {
        if (!response.ok || data.success === false) throw new Error(data.error || "The card could not be moved.");
        toast(`${cardName(card)} moved to ${zoneLabel(destinationZone)}.`, "success");
      })
      .catch((error) => toast(error.message, "error"))
      .finally(() => { requestPending = false; });
  }

  function onPointerDown(event) {
    if (!isMobilePointer(event) || event.button !== 0) return;
    const card = event.target.closest(".arena-game-shell .arena-card");
    if (!card || event.target.closest("button, input, select, textarea")) return;

    clearNativeImageBehaviour(card);
    clearGesture();
    gesture = {
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      dragging: false,
      ghost: null,
      targets: [],
      current: null,
      timer: window.setTimeout(() => {
        if (gesture && !gesture.dragging) {
          suppressClicksUntil = Date.now() + 700;
          openReader(gesture.card);
          clearGesture();
        }
      }, LONG_PRESS_DELAY)
    };

    card.setPointerCapture?.(event.pointerId);
  }

  function onPointerMove(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gesture.currentX = event.clientX;
    gesture.currentY = event.clientY;
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);

    if (!gesture.dragging && distance >= MIN_DRAG_DISTANCE) {
      window.clearTimeout(gesture.timer);
      startDrag(event);
    }
    if (gesture.dragging) {
      event.preventDefault();
      updateDrag(event);
    }
  }

  function onPointerUp(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    window.clearTimeout(gesture.timer);

    if (gesture.dragging) {
      event.preventDefault();
      const card = gesture.card;
      const target = pointTarget(event.clientX, event.clientY) || gesture.current;
      if (target) apiMove(card, target);
      else toast("Drop the card inside a highlighted zone.", "warning");
    }
    clearGesture();
  }

  function onContextMenu(event) {
    if (event.target.closest(".arena-game-shell .arena-card, .arena-game-shell .arena-card img")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function onDragStart(event) {
    if (event.target.closest(".arena-game-shell .arena-card, .arena-game-shell .arena-card img")) event.preventDefault();
  }

  function onClick(event) {
    if (programmaticClick) return;

    if (event.target.closest("[data-v628-close-reader]")) {
      event.preventDefault();
      closeReader();
      return;
    }

    if (event.target.closest("[data-v628-play-stack]")) {
      event.preventDefault();
      const reader = event.target.closest("#v628CardReader");
      if (reader?.__sourceCard) playOnStack(reader.__sourceCard);
      return;
    }

    if (Date.now() < suppressClicksUntil && event.target.closest(".arena-card")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function repairCards() {
    gameShell()?.querySelectorAll(".arena-card").forEach(clearNativeImageBehaviour);
  }

  function clearNonGameState() {
    if (gameShell()) return;
    clearGesture();
    closeReader();
    document.body.classList.remove("v622-dragging");
  }

  function repair() {
    clearNonGameState();
    repairCards();
  }

  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repair();
    });
  }

  function installCardInteraction() {
    document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
    document.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    document.addEventListener("pointerup", onPointerUp, { capture: true, passive: false });
    document.addEventListener("pointercancel", clearGesture, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("click", onClick, true);
  }

  function start() {
    installCardInteraction();
    const app = document.getElementById("app");
    if (app) new MutationObserver(scheduleRepair).observe(app, { childList: true, subtree: true });
    document.addEventListener("fullscreenchange", scheduleRepair);
    window.addEventListener("pageshow", scheduleRepair);
    scheduleRepair();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();

  window.ArenaCommanderTabletopFixV622 = {
    version: VERSION,
    repair,
    clearNonGameState
  };
})();

/* ===== Home and navigation stability ===== */
(() => {
  "use strict";

  const VERSION = "62.3.0";
  let queued = false;

  function gameShell() {
    return document.querySelector(".arena-game-shell");
  }

  function unlockPage() {
    const game = gameShell();
    const activeGame = Boolean(game);

    document.body.classList.toggle("v623-game-active", activeGame);
    document.documentElement.classList.toggle("v623-game-active", activeGame);

    if (activeGame) return;

    const removable = [
      "in-game",
      "v610-game-visible",
      "v61-focus-mode",
      "v61-opponent-view",
      "v621-fullscreen-mode",
      "v622-clean-fullscreen",
      "v622-dragging"
    ];

    document.body.classList.remove(...removable);
    document.documentElement.classList.remove(...removable);
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("height");
    document.documentElement.style.removeProperty("overflow");
    document.documentElement.style.removeProperty("height");

    document.querySelectorAll(
      ".v61-focus-nav, .v621-focus-nav, .v622-focus-nav, " +
      ".v61-diagnostic-panel, .v61-table-overview, .v622-drag-ghost"
    ).forEach((element) => element.remove());
  }

  function scheduleUnlock() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      unlockPage();
    });
  }

  function onClick(event) {
    const navigation = event.target.closest(
      '#brandButton, [data-nav="home"], [data-nav="decks"], [data-nav="game"], ' +
      '[data-nav="help"], [data-meta-action="open"]'
    );
    if (!navigation) return;
    setTimeout(unlockPage, 0);
    setTimeout(unlockPage, 120);
  }

  function start() {
    document.addEventListener("click", onClick, true);
    window.addEventListener("pageshow", unlockPage);
    window.addEventListener("popstate", unlockPage);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) unlockPage();
    });

    const app = document.getElementById("app");
    if (app) {
      const observer = new MutationObserver(scheduleUnlock);
      observer.observe(app, { childList: true });
    }
    unlockPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.ArenaCommanderHomeStabilityV623 = {
    version: VERSION,
    unlock: unlockPage
  };
})();

window.ArenaCommanderStableRuntime = Object.freeze({ version: "63.0.0" });
