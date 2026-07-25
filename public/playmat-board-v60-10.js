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
