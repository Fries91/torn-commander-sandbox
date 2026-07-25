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

(() => {
  "use strict";

  const VERSION = "61.0.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const FOCUS_PREFIX = "arenaCommander.focus.v61:";
  const PIN_PREFIX = "arenaCommander.focusPinned.v61:";
  const base = window.ArenaCommanderPlaymatV610;

  let selectedOpponentId = "";
  let focusPinned = false;
  let lastRoomSignature = "";
  let previousSignals = null;
  let repairQueued = false;
  let programmaticClick = false;
  let suppressClickUntil = 0;
  let dragState = null;

  function room() {
    return base?.getRoom?.() || window.__arenaCommanderRoomV610 || null;
  }

  function readSession() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
    } catch {
      return null;
    }
  }

  function meId() {
    return String(readSession()?.playerId || "");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function attrValue(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function playerById(playerId) {
    return room()?.players?.find((player) => String(player.id) === String(playerId)) || null;
  }

  function opponents() {
    const self = meId();
    return (room()?.players || []).filter((player) => String(player.id) !== self && !player.game?.conceded);
  }

  function focusStorageKey() {
    return FOCUS_PREFIX + String(room()?.code || readSession()?.roomCode || "room");
  }

  function pinStorageKey() {
    return PIN_PREFIX + String(room()?.code || readSession()?.roomCode || "room");
  }

  function restoreFocus() {
    if (selectedOpponentId) return;
    try {
      selectedOpponentId = sessionStorage.getItem(focusStorageKey()) || "";
      focusPinned = sessionStorage.getItem(pinStorageKey()) === "1";
    } catch {}
  }

  function saveFocus() {
    try {
      sessionStorage.setItem(focusStorageKey(), selectedOpponentId || "");
      sessionStorage.setItem(pinStorageKey(), focusPinned ? "1" : "0");
    } catch {}
  }

  function chooseAutomaticOpponent() {
    const currentRoom = room();
    const opponentIds = new Set(opponents().map((player) => String(player.id)));
    if (!opponentIds.size) return "";

    const priorityId = String(currentRoom?.priority?.playerId || "");
    const activeId = String(currentRoom?.turn?.activePlayerId || "");
    if (opponentIds.has(priorityId)) return priorityId;
    if (opponentIds.has(activeId)) return activeId;
    if (opponentIds.has(selectedOpponentId)) return selectedOpponentId;
    return String(opponents()[0]?.id || "");
  }

  function ensureSelectedOpponent() {
    restoreFocus();
    const valid = opponents().some((player) => String(player.id) === String(selectedOpponentId));
    if (!valid || !focusPinned) {
      selectedOpponentId = chooseAutomaticOpponent();
      if (!valid) focusPinned = false;
      saveFocus();
    }
  }

  function initials(name) {
    const words = String(name || "?").trim().split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0]?.slice(0, 2) || "?").toUpperCase();
  }

  function statusFlags(player) {
    const currentRoom = room();
    const active = String(currentRoom?.turn?.activePlayerId || "") === String(player.id);
    const priority = String(currentRoom?.priority?.playerId || "") === String(player.id);
    const attacking = player.game?.battlefield?.some((card) => card.attacking);
    const underAttack = (currentRoom?.players || []).some((source) =>
      source.game?.battlefield?.some((card) => card.attacking && String(card.defendingPlayerId) === String(player.id))
    );
    return { active, priority, attacking, underAttack };
  }

  function playerButtonHtml(player) {
    const self = String(player.id) === meId();
    const selected = !self && String(player.id) === String(selectedOpponentId);
    const flags = statusFlags(player);
    const classes = [
      "v61-player-button",
      self ? "is-self" : "",
      selected ? "is-selected" : "",
      flags.active ? "is-active" : "",
      flags.priority ? "has-priority" : "",
      flags.underAttack ? "is-under-attack" : "",
      player.game?.conceded ? "is-conceded" : ""
    ].filter(Boolean).join(" ");

    return `<button type="button" class="${classes}" data-v61-player-id="${escapeHtml(player.id)}">
      <span class="v61-player-avatar">${escapeHtml(initials(player.name))}</span>
      <span class="v61-player-copy">
        <strong>${escapeHtml(player.name)}${self ? " · YOU" : ""}</strong>
        <small><b>${Number(player.game?.life ?? 0)}</b> life · ${Number(player.game?.handCount ?? player.game?.hand?.length ?? 0)} hand · ${Number(player.game?.poison ?? 0)} poison</small>
      </span>
      <span class="v61-player-flags">${flags.active ? "TURN" : ""}${flags.priority ? " PRIORITY" : ""}${flags.underAttack ? " ⚔" : ""}</span>
    </button>`;
  }

  function ensureFocusBar(shell) {
    const currentRoom = room();
    if (!currentRoom?.players?.length) return;

    ensureSelectedOpponent();

    let bar = shell.querySelector(":scope > .v61-focus-bar");
    if (!bar) {
      bar = document.createElement("section");
      bar.className = "v61-focus-bar";
      const topbar = shell.querySelector(":scope > .arena-game-topbar");
      if (topbar) topbar.insertAdjacentElement("afterend", bar);
      else shell.prepend(bar);
    }

    const signature = JSON.stringify({
      selectedOpponentId,
      focusPinned,
      active: currentRoom.turn?.activePlayerId,
      priority: currentRoom.priority?.playerId,
      players: currentRoom.players.map((player) => [
        player.id,
        player.name,
        player.game?.life,
        player.game?.handCount ?? player.game?.hand?.length,
        player.game?.poison,
        player.game?.conceded,
        player.connected
      ])
    });

    if (bar.dataset.signature === signature) return;
    bar.dataset.signature = signature;
    bar.innerHTML = `
      <button type="button" class="v61-focus-arrow" data-v61-action="previous-player" aria-label="Previous opponent">‹</button>
      <div class="v61-player-strip">${currentRoom.players.map(playerButtonHtml).join("")}</div>
      <button type="button" class="v61-focus-arrow" data-v61-action="next-player" aria-label="Next opponent">›</button>
      <button type="button" class="v61-auto-focus ${focusPinned ? "is-pinned" : ""}" data-v61-action="toggle-auto-focus">${focusPinned ? "PINNED" : "AUTO"}</button>
      <button type="button" class="v61-overview-button" data-v61-action="open-overview">TABLE</button>`;
  }

  function applyOpponentFocus(shell) {
    ensureSelectedOpponent();
    const slots = Array.from(shell.querySelectorAll(".arena-opponent-ring > .opponent-slot"));
    for (const slot of slots) {
      const playerId = String(slot.querySelector(".arena-seat")?.dataset.playerSeatId || "");
      slot.classList.toggle("v61-focus-hidden", Boolean(selectedOpponentId) && playerId !== String(selectedOpponentId));
      slot.classList.toggle("v61-focus-visible", playerId === String(selectedOpponentId));
    }

    shell.dataset.focusPlayerId = selectedOpponentId || "";
  }

  function focusOpponent(playerId, manual = true, shouldScroll = false) {
    const self = meId();
    if (String(playerId) === self) {
      document.querySelector(".self-slot")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    const valid = opponents().some((player) => String(player.id) === String(playerId));
    if (!valid) return;
    selectedOpponentId = String(playerId);
    if (manual) focusPinned = true;
    saveFocus();
    repairAll();

    if (shouldScroll) {
      window.setTimeout(() => {
        document.querySelector(".opponent-slot.v61-focus-visible")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 30);
    }
  }

  function cycleOpponent(direction) {
    const list = opponents();
    if (!list.length) return;
    const index = Math.max(0, list.findIndex((player) => String(player.id) === String(selectedOpponentId)));
    const nextIndex = (index + direction + list.length) % list.length;
    focusOpponent(list[nextIndex].id, true, false);
  }

  function showToast(message, type = "info") {
    const region = document.getElementById("toastRegion") || document.body;
    const toast = document.createElement("div");
    toast.className = `toast ${type} v61-toast`;
    toast.textContent = message;
    region.appendChild(toast);
    window.setTimeout(() => toast.remove(), 3800);
  }

  function attackers() {
    const result = [];
    for (const player of room()?.players || []) {
      for (const card of player.game?.battlefield || []) {
        if (!card.attacking) continue;
        result.push({ card, controller: player, defender: playerById(card.defendingPlayerId) });
      }
    }
    return result;
  }

  function ensureCombatTray(shell) {
    const center = shell.querySelector(".arena-center-zone");
    if (!center) return;

    const entries = attackers();
    let tray = center.querySelector(":scope > .v61-combat-tray");
    if (!entries.length) {
      tray?.remove();
      return;
    }

    if (!tray) {
      tray = document.createElement("section");
      tray.className = "v61-combat-tray";
      center.prepend(tray);
    }

    const signature = entries.map((entry) => `${entry.card.id}:${entry.card.defendingPlayerId}`).join("|");
    if (tray.dataset.signature === signature) return;
    tray.dataset.signature = signature;
    tray.innerHTML = `<strong>COMBAT NOW</strong><div>${entries.map((entry) => `
      <button type="button" data-v61-focus-attacker="${escapeHtml(entry.controller.id)}">
        <span>⚔ ${escapeHtml(entry.card.name)}</span>
        <small>${escapeHtml(entry.controller.name)} → ${escapeHtml(entry.defender?.name || "Player")}</small>
      </button>`).join("")}</div>`;
  }

  function commanderName(player) {
    return player.deck?.commanders?.join(" / ") || player.game?.commandZone?.[0]?.name || "Commander";
  }

  function ensureOverlay() {
    let overlay = document.getElementById("v61TableOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "v61TableOverlay";
    overlay.className = "v61-table-overlay is-hidden";
    overlay.innerHTML = `<section class="v61-table-sheet"><header><div><small>SIX-PLAYER COMMAND CENTER</small><h2>Table overview</h2></div><button type="button" data-v61-action="close-overview">×</button></header><div class="v61-overview-body"></div></section>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function openOverview() {
    const currentRoom = room();
    if (!currentRoom) return;
    const overlay = ensureOverlay();
    const connection = document.getElementById("connectionText")?.textContent || "Unknown";
    const phase = currentRoom.phases?.[currentRoom.turn?.phaseIndex || 0] || "—";
    const self = playerById(meId());

    overlay.querySelector(".v61-overview-body").innerHTML = `
      <div class="v61-overview-grid">${currentRoom.players.map((player) => {
        const flags = statusFlags(player);
        return `<article class="v61-overview-player ${String(player.id) === meId() ? "is-self" : ""} ${flags.active ? "is-active" : ""} ${flags.priority ? "has-priority" : ""}">
          <header><span>${escapeHtml(initials(player.name))}</span><div><strong>${escapeHtml(player.name)}</strong><small>${escapeHtml(commanderName(player))}</small></div></header>
          <div class="v61-overview-stats"><b>${Number(player.game?.life ?? 0)}<small>Life</small></b><b>${Number(player.game?.handCount ?? player.game?.hand?.length ?? 0)}<small>Hand</small></b><b>${Number(player.game?.poison ?? 0)}<small>Poison</small></b><b>${Number(player.game?.battlefield?.length ?? 0)}<small>Board</small></b></div>
          <div class="v61-overview-zones"><span>Grave ${Number(player.game?.graveyard?.length ?? 0)}</span><span>Exile ${Number(player.game?.exile?.length ?? 0)}</span><span>Tax ${Number(player.game?.commanderTax ?? 0)}</span></div>
          <button type="button" data-v61-view-player="${escapeHtml(player.id)}">${String(player.id) === meId() ? "View my board" : "View battlefield"}</button>
        </article>`;
      }).join("")}</div>
      <section class="v61-diagnostics">
        <h3>Live table check</h3>
        <div><span>Connection</span><strong>${escapeHtml(connection)}</strong></div>
        <div><span>Room</span><strong>${escapeHtml(currentRoom.code || "—")}</strong></div>
        <div><span>Players</span><strong>${currentRoom.players.length}/6</strong></div>
        <div><span>Turn</span><strong>${Number(currentRoom.turn?.number || 1)} · ${escapeHtml(phase)}</strong></div>
        <div><span>Stack</span><strong>${Number(currentRoom.stack?.length || 0)}</strong></div>
        <div><span>Your hand</span><strong>${Number(self?.game?.hand?.length ?? self?.game?.handCount ?? 0)}</strong></div>
        <button type="button" data-v61-action="repair-layout">Repair visible board</button>
      </section>`;

    overlay.classList.remove("is-hidden");
    document.body.classList.add("v61-overlay-open");
  }

  function closeOverview() {
    document.getElementById("v61TableOverlay")?.classList.add("is-hidden");
    document.body.classList.remove("v61-overlay-open");
  }

  function enhanceAttackButtons() {
    const modal = document.getElementById("modalBody");
    if (!modal) return;
    const buttons = Array.from(modal.querySelectorAll('button[data-action="declare-attacker"]'));
    if (!buttons.length) return;

    const parent = buttons[0].parentElement;
    parent?.classList.add("v61-defender-grid");
    if (parent && !parent.previousElementSibling?.classList.contains("v61-defender-heading")) {
      const heading = document.createElement("div");
      heading.className = "v61-defender-heading";
      heading.innerHTML = "<strong>Choose defender</strong><small>Your attacker can target any remaining opponent.</small>";
      parent.insertAdjacentElement("beforebegin", heading);
    }

    for (const button of buttons) {
      if (button.classList.contains("v61-defender-button")) continue;
      const player = playerById(button.dataset.defenderPlayerId);
      button.classList.add("v61-defender-button");
      button.innerHTML = `<span>${escapeHtml(initials(player?.name))}</span><div><strong>${escapeHtml(player?.name || "Opponent")}</strong><small>${Number(player?.game?.life ?? 0)} life · ${Number(player?.game?.handCount ?? player?.game?.hand?.length ?? 0)} hand · ${Number(player?.game?.poison ?? 0)} poison</small></div>`;
    }
  }

  function focusBlockTargetIfNeeded() {
    const banner = document.querySelector(".arena-target-banner");
    const text = banner?.textContent || "";
    if (!/Choose an attacking creature/i.test(text)) return;
    const self = meId();
    const source = (room()?.players || []).find((player) =>
      player.game?.battlefield?.some((card) => card.attacking && String(card.defendingPlayerId) === self)
    );
    if (source) focusOpponent(source.id, false, false);
  }

  function snapshotSignals(currentRoom) {
    if (!currentRoom) return null;
    const self = meId();
    return {
      priority: String(currentRoom.priority?.playerId || ""),
      active: String(currentRoom.turn?.activePlayerId || ""),
      stack: Number(currentRoom.stack?.length || 0),
      triggers: Number(currentRoom.triggerQueue?.length || 0),
      attacksOnMe: new Set(
        currentRoom.players.flatMap((player) =>
          (player.game?.battlefield || [])
            .filter((card) => card.attacking && String(card.defendingPlayerId) === self)
            .map((card) => String(card.id))
        )
      )
    };
  }

  function processSignals(currentRoom) {
    const next = snapshotSignals(currentRoom);
    if (!next) return;
    if (previousSignals) {
      if (next.priority === meId() && previousSignals.priority !== meId()) {
        showToast("You have priority.", "info");
      }
      if (next.triggers > previousSignals.triggers) {
        showToast("A trigger is waiting.", "warning");
      }
      if (next.stack > previousSignals.stack) {
        showToast("A new item was added to the stack.", "info");
      }
      const newAttack = [...next.attacksOnMe].some((id) => !previousSignals.attacksOnMe.has(id));
      if (newAttack) showToast("You are being attacked. Open the combat tray to block.", "warning");
    }
    previousSignals = next;
  }

  async function waitForSelector(selector, timeout = 1200) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const found = document.querySelector(selector);
      if (found) return found;
      await new Promise((resolve) => window.setTimeout(resolve, 30));
    }
    return null;
  }

  async function performDropAction(source, target) {
    const cardSelector = `.arena-card[data-card-id="${attrValue(source.cardId)}"][data-owner-id="${attrValue(source.ownerId)}"]`;
    const card = document.querySelector(cardSelector) || document.querySelector(`.arena-card[data-card-id="${attrValue(source.cardId)}"]`);
    if (!card) return showToast("That card moved before the drop completed.", "warning");

    let actionSelector = "";
    if (target.kind === "zone") {
      if (!target.zone || target.zone === source.zone) return;
      actionSelector = `#modalBody [data-action="move-card"][data-card-id="${attrValue(source.cardId)}"][data-to-zone="${attrValue(target.zone)}"]`;
    } else if (target.kind === "player") {
      if (source.zone !== "battlefield" || String(target.playerId) === meId()) return;
      actionSelector = `#modalBody [data-action="declare-attacker"][data-card-id="${attrValue(source.cardId)}"][data-defender-player-id="${attrValue(target.playerId)}"]`;
    }

    if (!actionSelector) return;

    programmaticClick = true;
    try {
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      const action = await waitForSelector(actionSelector);
      if (!action) {
        document.querySelector('[data-action="close-modal"]')?.click();
        return showToast("That move is not available for this card.", "warning");
      }
      action.click();
      if (target.kind === "player") {
        selectedOpponentId = String(target.playerId);
        focusPinned = true;
        saveFocus();
      }
    } finally {
      window.setTimeout(() => { programmaticClick = false; }, 50);
    }
  }

  function clearDropHighlight() {
    document.querySelectorAll(".v61-touch-drop-target").forEach((element) => element.classList.remove("v61-touch-drop-target"));
  }

  function destroyDrag() {
    if (!dragState) return;
    window.clearTimeout(dragState.timer);
    dragState.ghost?.remove();
    dragState.card?.classList.remove("v61-touch-drag-source");
    clearDropHighlight();
    dragState = null;
    document.body.classList.remove("v61-touch-dragging");
  }

  function beginTouchDrag(event, card) {
    if (!dragState || dragState.active) return;
    dragState.active = true;
    dragState.card = card;
    document.body.classList.add("v61-touch-dragging");
    card.classList.add("v61-touch-drag-source");

    const ghost = card.cloneNode(true);
    ghost.classList.add("v61-touch-drag-ghost");
    ghost.removeAttribute("data-action");
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    document.body.appendChild(ghost);
    dragState.ghost = ghost;
    navigator.vibrate?.(25);
  }

  function updateTouchDrag(event) {
    if (!dragState?.active) return;
    event.preventDefault();
    dragState.ghost.style.left = `${event.clientX}px`;
    dragState.ghost.style.top = `${event.clientY}px`;

    clearDropHighlight();
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest?.("[data-drop-zone],[data-drop-player-id]") || null;
    if (target) target.classList.add("v61-touch-drop-target");
    dragState.target = target;
  }

  function finishTouchDrag(event) {
    if (!dragState) return;
    window.clearTimeout(dragState.timer);
    if (!dragState.active) {
      dragState = null;
      return;
    }

    event.preventDefault();
    suppressClickUntil = Date.now() + 500;

    const source = {
      cardId: dragState.card.dataset.cardId,
      ownerId: dragState.card.dataset.ownerId,
      zone: dragState.card.dataset.zone
    };
    const targetElement = dragState.target;
    let target = null;

    if (targetElement?.dataset.dropZone) {
      target = { kind: "zone", zone: targetElement.dataset.dropZone };
    } else if (targetElement?.dataset.dropPlayerId) {
      target = { kind: "player", playerId: targetElement.dataset.dropPlayerId };
    }

    destroyDrag();
    if (target) performDropAction(source, target);
  }

  function installTouchDrag() {
    document.addEventListener("pointerdown", (event) => {
      if (!event.isPrimary || !["touch", "pen"].includes(event.pointerType)) return;
      const card = event.target.closest('.arena-card[data-can-control="1"]');
      if (!card || event.target.closest("button,input,textarea,select,a")) return;

      dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        active: false,
        target: null,
        card,
        timer: window.setTimeout(() => beginTouchDrag(event, card), 220)
      };
    }, { capture: true, passive: true });

    document.addEventListener("pointermove", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
      if (!dragState.active && distance > 14) {
        window.clearTimeout(dragState.timer);
        dragState = null;
        return;
      }
      updateTouchDrag(event);
    }, { capture: true, passive: false });

    document.addEventListener("pointerup", (event) => {
      if (!dragState || dragState.pointerId !== event.pointerId) return;
      finishTouchDrag(event);
    }, { capture: true, passive: false });

    document.addEventListener("pointercancel", () => destroyDrag(), { capture: true });

    document.addEventListener("click", (event) => {
      if (programmaticClick) return;
      if (Date.now() < suppressClickUntil && event.target.closest(".arena-card")) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function installSwipeNavigation() {
    let start = null;
    document.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "touch") return;
      if (!event.target.closest(".opponent-slot.v61-focus-visible")) return;
      if (event.target.closest(".arena-card,button,input,textarea,select")) return;
      start = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }, { passive: true });

    document.addEventListener("pointerup", (event) => {
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      cycleOpponent(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function installControls() {
    document.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-v61-action]");
      if (actionButton) {
        const action = actionButton.dataset.v61Action;
        if (action === "previous-player") cycleOpponent(-1);
        if (action === "next-player") cycleOpponent(1);
        if (action === "toggle-auto-focus") {
          focusPinned = !focusPinned;
          if (!focusPinned) selectedOpponentId = chooseAutomaticOpponent();
          saveFocus();
          repairAll();
        }
        if (action === "open-overview") openOverview();
        if (action === "close-overview") closeOverview();
        if (action === "repair-layout") {
          base?.repairPlaymat?.();
          repairAll();
          showToast("Visible board repaired.", "info");
        }
        return;
      }

      const playerButton = event.target.closest("[data-v61-player-id]");
      if (playerButton) {
        focusOpponent(playerButton.dataset.v61PlayerId, true, true);
        return;
      }

      const viewButton = event.target.closest("[data-v61-view-player]");
      if (viewButton) {
        closeOverview();
        focusOpponent(viewButton.dataset.v61ViewPlayer, true, true);
        return;
      }

      const combatButton = event.target.closest("[data-v61-focus-attacker]");
      if (combatButton) {
        focusOpponent(combatButton.dataset.v61FocusAttacker, true, true);
        return;
      }

      const attackButton = event.target.closest('button[data-action="declare-attacker"]');
      if (attackButton) {
        selectedOpponentId = String(attackButton.dataset.defenderPlayerId || selectedOpponentId);
        focusPinned = true;
        saveFocus();
      }

      if (event.target.id === "v61TableOverlay") closeOverview();
    }, true);
  }

  function repairAll() {
    const shell = document.querySelector(".arena-game-shell");
    if (!shell) return;
    shell.classList.add("arena-v61", "multiplayer-focus-v61");

    const currentRoom = room();
    const signature = JSON.stringify({
      code: currentRoom?.code,
      turn: currentRoom?.turn,
      priority: currentRoom?.priority,
      stack: currentRoom?.stack?.length,
      triggerQueue: currentRoom?.triggerQueue?.length,
      combat: attackers().map((entry) => [entry.card.id, entry.card.defendingPlayerId]),
      players: currentRoom?.players?.map((player) => [player.id, player.game?.life, player.game?.handCount, player.game?.poison, player.game?.battlefield?.length])
    });

    if (signature !== lastRoomSignature) {
      processSignals(currentRoom);
      lastRoomSignature = signature;
    }

    ensureFocusBar(shell);
    applyOpponentFocus(shell);
    ensureCombatTray(shell);
    enhanceAttackButtons();
    focusBlockTargetIfNeeded();

    const handLabel = shell.querySelector(".arena-hand-tray .hand-label");
    if (handLabel && !handLabel.querySelector(".v61-drag-tip")) {
      const tip = document.createElement("small");
      tip.className = "v61-drag-tip";
      tip.textContent = "Hold, then drag to a zone";
      handLabel.appendChild(tip);
    }
  }

  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repairAll();
    });
  }

  function start() {
    installControls();
    installTouchDrag();
    installSwipeNavigation();
    ensureOverlay();

    const app = document.getElementById("app");
    if (app) {
      const observer = new MutationObserver(scheduleRepair);
      observer.observe(app, { childList: true, subtree: true });
    }

    const modalBody = document.getElementById("modalBody");
    if (modalBody) {
      const modalObserver = new MutationObserver(scheduleRepair);
      modalObserver.observe(modalBody, { childList: true, subtree: true });
    }

    window.setInterval(scheduleRepair, 600);
    scheduleRepair();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  window.ArenaCommanderFinalV61 = {
    version: VERSION,
    repair: repairAll,
    openOverview,
    focusOpponent
  };
})();
