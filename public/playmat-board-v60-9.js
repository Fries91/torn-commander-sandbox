(() => {
  "use strict";

  const VERSION = "60.9.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const SETTINGS_KEY = "tornCommander.uiSettings.v20";
  const PRIVATE_HAND_PREFIX = "arenaCommander.privateHand.v60.9:";
  const originalIo = window.io;
  const privateHands = new Map();

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
      return value?.roomCode && value?.playerId && value?.sessionToken
        ? value
        : null;
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

  function preservePrivateHand(room, explicitPlayerId = "") {
    if (!room || typeof room !== "object") return room;

    const session = readSession();
    const playerId = explicitPlayerId || session?.playerId || "";
    if (!playerId) return room;

    const player = Array.isArray(room.players)
      ? room.players.find(
          (entry) => String(entry?.id || "") === String(playerId)
        )
      : null;
    if (!player?.game) return room;

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

    return room;
  }

  function wrapResponse(response, playerId = "") {
    if (response && typeof response === "object" && response.room) {
      response.room = preservePrivateHand(
        response.room,
        response.playerId || playerId
      );
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
        if (
          finalIndex >= 0 &&
          typeof emitArguments[finalIndex] === "function"
        ) {
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

  function createZone(label, className) {
    const section = document.createElement("section");
    section.className = `v609-mat-zone ${className}`;

    const heading = document.createElement("div");
    heading.className = "v609-zone-label";
    heading.textContent = label;

    const row = document.createElement("div");
    row.className = "v609-card-row";

    section.append(heading, row);
    return { section, row };
  }

  function isLandGroup(group) {
    const typeLine = group.querySelector(".arena-card-type")?.textContent || "";
    return /(^|\s|—|-)land(\s|$)/i.test(typeLine);
  }

  function repairBattlefield(board) {
    const source = board.querySelector(":scope > .arena-battlefield-cards");
    if (!source || source.querySelector(":scope > .v609-playmat")) return;

    const playmat = document.createElement("div");
    playmat.className = "v609-playmat";

    const battlefieldZone = createZone("BATTLEFIELD", "v609-permanent-zone");
    const landsZone = createZone("LANDS", "v609-land-zone");

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
        child.classList.add("v609-empty-board");
        battlefieldZone.row.appendChild(child);
      } else {
        battlefieldZone.row.appendChild(child);
      }
    }

    if (!permanentCount && !battlefieldZone.row.children.length) {
      const empty = document.createElement("div");
      empty.className = "v609-empty-board";
      empty.textContent = "Play permanents here";
      battlefieldZone.row.appendChild(empty);
    }

    if (!landCount) {
      const empty = document.createElement("div");
      empty.className = "v609-empty-board v609-empty-lands";
      empty.textContent = "Play lands here";
      landsZone.row.appendChild(empty);
    }

    playmat.append(battlefieldZone.section, landsZone.section);
    source.replaceChildren(playmat);
    source.classList.add("v609-battlefield-source");
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

    const current = Array.from(piles.children).filter((child) =>
      child.matches?.(".arena-zone-pile")
    );
    const alreadyOrdered =
      current.length === buttons.length &&
      current.every((button, index) => button === buttons[index]);

    if (!alreadyOrdered) {
      for (const button of buttons) piles.appendChild(button);
    }
  }

  function repairSeat(seat) {
    if (!seat) return;

    if (seat.classList.contains("v609-seat-ready")) {
      const existingBoard = seat.querySelector(".arena-seat-board");
      const existingPiles = seat.querySelector(".arena-zone-piles");
      if (existingBoard) repairBattlefield(existingBoard);
      if (existingPiles) orderZonePiles(existingPiles);
      return;
    }

    const header = seat.querySelector(":scope > .arena-seat-header");
    const life = seat.querySelector(":scope > .seat-life");
    const secondary = seat.querySelector(":scope > .seat-secondary");
    const board = seat.querySelector(":scope > .arena-seat-board");
    const piles = seat.querySelector(":scope > .arena-zone-piles");

    if (!header || !board || !piles) return;

    repairBattlefield(board);
    orderZonePiles(piles);

    const content = document.createElement("div");
    content.className = "v609-seat-content";

    const fieldColumn = document.createElement("div");
    fieldColumn.className = "v609-field-column";

    const zoneColumn = document.createElement("aside");
    zoneColumn.className = "v609-zone-column";

    fieldColumn.appendChild(board);
    if (life) zoneColumn.appendChild(life);
    zoneColumn.appendChild(piles);

    content.append(fieldColumn, zoneColumn);
    header.insertAdjacentElement("afterend", content);

    if (secondary) seat.appendChild(secondary);
    seat.classList.add("v609-seat-ready");
  }

  function repairHandTray(tray) {
    if (!tray) return;
    tray.classList.add("v609-hand-ready");
    const label = tray.querySelector(".hand-label strong");
    if (label && label.textContent !== "YOUR HAND") {
      label.textContent = "YOUR HAND";
    }
    for (const card of tray.querySelectorAll(".hand-card-wrap")) {
      card.classList.add("v609-hand-card-visible");
    }
  }

  function repairPlaymat() {
    const shell = document.querySelector(".arena-game-shell");
    document.body.classList.toggle("v609-game-visible", Boolean(shell));
    if (!shell) return;

    shell.classList.add("arena-v609", "playmat-v609");

    for (const seat of shell.querySelectorAll(".arena-seat")) {
      repairSeat(seat);
    }

    repairHandTray(shell.querySelector(".arena-hand-tray"));
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
    const app = document.getElementById("app");
    if (!app) return;

    const observer = new MutationObserver(scheduleRepair);
    observer.observe(app, { childList: true, subtree: true });
    repairPlaymat();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  } else {
    startObserver();
  }

  window.ArenaCommanderPlaymatV609 = {
    version: VERSION,
    preservePrivateHand,
    repairPlaymat
  };
})();
