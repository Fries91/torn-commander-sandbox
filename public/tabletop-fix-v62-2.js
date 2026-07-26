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

  async function post(action) {
    if (requestPending) return null;
    const saved = session();
    if (!saved?.roomCode || !saved?.playerId || !saved?.sessionToken) {
      toast("Your saved match session is missing. Reconnect to the match.", "error");
      return null;
    }

    requestPending = true;
    document.body.classList.add("v622-moving-card");
    try {
      const response = await fetch("/api/gameplay-v62/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomCode: saved.roomCode,
          playerId: saved.playerId,
          sessionToken: saved.sessionToken,
          ...action
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "The card could not be moved.");
      window.ArenaCommanderPlaymatV610?.repairPlaymat?.();
      window.ArenaCommanderFinalV61?.repair?.();
      window.ArenaCommanderTabletopFixV621?.repair?.();
      window.ArenaCommanderMobileTableV628?.repair?.();
      scheduleRepair();
      return data;
    } catch (error) {
      toast(error?.message || "The card could not be moved.", "error");
      return null;
    } finally {
      requestPending = false;
      document.body.classList.remove("v622-moving-card");
    }
  }

  function closestAnyCard(target) {
    return target?.closest?.('.arena-card[data-card-id][data-zone]') || null;
  }

  function closestControlledCard(target) {
    return target?.closest?.('.arena-card[data-can-control="1"][data-card-id][data-zone]') || null;
  }

  function rectContains(element, x, y) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function clearHighlights() {
    document.querySelectorAll(".v622-drop-target,.v624-drop-ready").forEach((element) => {
      element.classList.remove("v622-drop-target", "v624-drop-ready");
    });
  }

  function showAvailableTargets(source) {
    const selfSeat = document.querySelector(".arena-seat.is-self");
    if (!selfSeat) return;

    if (source.fromZone !== "battlefield") {
      selfSeat.querySelectorAll('[data-drop-zone="battlefield"]').forEach((element) => {
        element.classList.add("v624-drop-ready");
      });
    }

    selfSeat.querySelectorAll('[data-drop-zone="graveyard"],[data-drop-zone="exile"],[data-drop-zone="hand"],[data-drop-zone="commandZone"]').forEach((element) => {
      if (element.dataset.dropZone !== source.fromZone) element.classList.add("v624-drop-ready");
    });

    if (source.fromZone === "battlefield") {
      document.querySelectorAll('.opponent-slot.v628-focus-visible [data-drop-player-id],.opponent-slot.v61-focus-visible [data-drop-player-id]').forEach((element) => {
        element.classList.add("v624-drop-ready");
      });
    }
  }

  function playerTargetAt(x, y) {
    const slots = document.querySelectorAll(
      ".opponent-slot.v628-focus-visible,.opponent-slot.v61-focus-visible"
    );
    for (const slot of slots) {
      const seat = slot.querySelector(".arena-seat.is-opponent") || slot.querySelector(".arena-seat");
      const playerId = seat?.dataset.playerSeatId || slot.dataset.dropPlayerId || "";
      if (!playerId) continue;
      const target = seat?.querySelector(".arena-seat-board") || seat || slot;
      if (rectContains(target, x, y)) {
        target.dataset.dropPlayerId = playerId;
        return target;
      }
    }
    return null;
  }

  function zoneTargetAt(x, y) {
    const elements = document.elementsFromPoint?.(x, y) || [];
    for (const element of elements) {
      if (element.classList?.contains("v622-drag-ghost")) continue;
      const zone = element.closest?.('[data-drop-zone][data-v624-drop-owner="self"]');
      if (zone?.dataset.dropZone) return zone;
    }

    const selfBoard = document.querySelector(".arena-seat.is-self .arena-seat-board");
    if (rectContains(selfBoard, x, y)) {
      selfBoard.dataset.dropZone = "battlefield";
      selfBoard.dataset.v624DropOwner = "self";
      return selfBoard;
    }

    for (const zone of document.querySelectorAll('.arena-seat.is-self [data-drop-zone][data-v624-drop-owner="self"],.arena-hand-tray[data-drop-zone="hand"]')) {
      if (rectContains(zone, x, y)) return zone;
    }
    return null;
  }

  function targetAt(x, y, source) {
    if (source?.fromZone === "battlefield") {
      const player = playerTargetAt(x, y);
      if (player) return player;
    }
    return zoneTargetAt(x, y);
  }

  function fireCardClick(card) {
    if (!card?.isConnected) return;
    programmaticClick = true;
    suppressClicksUntil = Date.now() + 650;
    try {
      card.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    } finally {
      programmaticClick = false;
    }
  }

  function openLongPressPreview() {
    if (!gesture || gesture.dragging || gesture.longPressed || !gesture.card?.isConnected) return;
    gesture.longPressed = true;
    gesture.card.classList.add("v628-card-hold-active");
    navigator.vibrate?.(18);
    fireCardClick(gesture.card);
    window.setTimeout(() => gesture?.card?.classList.remove("v628-card-hold-active"), 250);
  }

  function beginDrag(event) {
    if (!gesture || gesture.dragging || gesture.longPressed || !gesture.controlledCard || !gameShell()) return;
    window.clearTimeout(gesture.timer);
    gesture.dragging = true;
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    document.body.classList.add("v622-dragging");
    gesture.controlledCard.classList.add("v622-drag-source");

    const ghost = gesture.controlledCard.cloneNode(true);
    ghost.classList.add("v622-drag-ghost");
    ghost.removeAttribute("data-action");
    ghost.removeAttribute("draggable");
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    document.body.appendChild(ghost);
    gesture.ghost = ghost;

    showAvailableTargets({ fromZone: String(gesture.controlledCard.dataset.zone || "") });
    navigator.vibrate?.(12);
  }

  function updateDrag(event) {
    if (!gesture?.dragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    gesture.lastX = event.clientX;
    gesture.lastY = event.clientY;
    gesture.ghost.style.left = `${event.clientX}px`;
    gesture.ghost.style.top = `${event.clientY}px`;

    document.querySelectorAll(".v622-drop-target").forEach((element) => element.classList.remove("v622-drop-target"));
    const source = { fromZone: String(gesture.controlledCard.dataset.zone || "") };
    gesture.target = targetAt(event.clientX, event.clientY, source);
    gesture.target?.classList.add("v622-drop-target");
  }

  function destroyGesture() {
    if (!gesture) return;
    window.clearTimeout(gesture.timer);
    gesture.ghost?.remove();
    gesture.controlledCard?.classList.remove("v622-drag-source");
    gesture.card?.classList.remove("v628-card-hold-active");
    clearHighlights();
    gesture = null;
    document.body.classList.remove("v622-dragging");
  }

  async function finishDrag(event) {
    if (!gesture?.dragging) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClicksUntil = Date.now() + 700;

    const source = {
      cardId: String(gesture.controlledCard.dataset.cardId || ""),
      fromZone: String(gesture.controlledCard.dataset.zone || ""),
      ownerId: String(gesture.controlledCard.dataset.ownerId || "")
    };

    const x = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : gesture.lastX;
    const y = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : gesture.lastY;
    const target = targetAt(x, y, source) || gesture.target;
    const toZone = String(target?.dataset.dropZone || "");
    const defenderPlayerId = String(target?.dataset.dropPlayerId || "");
    destroyGesture();

    if (defenderPlayerId && source.fromZone === "battlefield") {
      const result = await post({ type: "declare-attacker", cardId: source.cardId, defenderPlayerId });
      if (result) toast("Attacker declared.", "success");
      return;
    }

    if (toZone) {
      if (toZone === source.fromZone) {
        toast(`That card is already in ${zoneLabel(toZone)}.`, "warning");
        return;
      }
      const result = await post({
        type: "move-card",
        cardId: source.cardId,
        fromZone: source.fromZone,
        toZone
      });
      if (result) toast(`Moved card to ${zoneLabel(toZone)}.`, "success");
      return;
    }

    toast("Release the card inside your highlighted battlefield or another highlighted zone.", "warning");
  }

  function installCardInteraction() {
    window.addEventListener("pointerdown", (event) => {
      if (!gameShell() || !event.isPrimary || requestPending) return;
      if (!["touch", "pen", "mouse"].includes(String(event.pointerType || ""))) return;
      if (event.button != null && event.button !== 0) return;
      const card = closestAnyCard(event.target);
      if (!card || event.target.closest("button,input,textarea,select,a")) return;

      // Window capture runs before the older document-level drag handler.
      event.stopImmediatePropagation();

      const controlledCard = closestControlledCard(event.target);
      gesture = {
        pointerId: event.pointerId,
        card,
        controlledCard,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        dragging: false,
        longPressed: false,
        target: null,
        ghost: null,
        timer: window.setTimeout(openLongPressPreview, LONG_PRESS_DELAY)
      };
    }, { capture: true, passive: true });

    window.addEventListener("pointermove", (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      const distance = Math.hypot(dx, dy);
      if (gesture.longPressed) {
        event.preventDefault();
        return;
      }

      if (!gesture.dragging && distance >= MIN_DRAG_DISTANCE) {
        const fromHand = String(gesture.card.dataset.zone || "") === "hand";
        // Horizontal movement in the hand remains a normal sideways hand scroll.
        if (fromHand && Math.abs(dx) > Math.abs(dy) * 1.15) {
          window.clearTimeout(gesture.timer);
          gesture = null;
          return;
        }
        if (gesture.controlledCard) beginDrag(event);
        else {
          window.clearTimeout(gesture.timer);
          gesture = null;
          return;
        }
      }
      if (gesture?.dragging) updateDrag(event);
    }, { capture: true, passive: false });

    window.addEventListener("pointerup", (event) => {
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      window.clearTimeout(gesture.timer);
      if (gesture.dragging) {
        finishDrag(event);
        return;
      }
      if (gesture.longPressed) {
        event.preventDefault();
        event.stopImmediatePropagation();
        destroyGesture();
        return;
      }
      // A normal short tap is left to the app's regular card click handler.
      gesture = null;
    }, { capture: true, passive: false });

    window.addEventListener("pointercancel", (event) => {
      if (gesture?.pointerId === event.pointerId) destroyGesture();
    }, { capture: true });

    window.addEventListener("click", (event) => {
      if (programmaticClick || Date.now() >= suppressClicksUntil) return;
      if (!event.target.closest?.(".arena-card")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);

    window.addEventListener("contextmenu", (event) => {
      const card = closestAnyCard(event.target);
      if (!card) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!document.getElementById("modalBackdrop")?.classList.contains("is-hidden")) return;
      fireCardClick(card);
    }, { capture: true });

    window.addEventListener("dragstart", (event) => {
      if (!event.target.closest?.(".arena-card,.arena-card img")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  function repairSwitcher() {
    const switcher = document.querySelector(".v621-board-switcher");
    if (!switcher) return;
    switcher.classList.add("v622-board-switcher", "v624-board-switcher");
    const toggle = switcher.querySelector('[data-v621-action="toggle-board"]');
    if (toggle) toggle.setAttribute("title", "Show the selected opponent or return to your battlefield");
  }

  function setSelfDropZone(element, zone) {
    if (!element) return;
    element.dataset.dropZone = zone;
    element.dataset.v624DropOwner = "self";
    element.classList.add("v624-valid-drop-zone");
  }

  function repairDropZones() {
    const selfSeat = document.querySelector(".arena-seat.is-self");
    if (selfSeat) {
      for (const element of selfSeat.querySelectorAll(
        ".arena-seat-board,.arena-battlefield-cards,.v610-playmat,.v610-permanent-zone,.v610-land-zone,.v610-card-row"
      )) setSelfDropZone(element, "battlefield");

      for (const [zone, selector] of [
        ["graveyard", '.arena-zone-pile[data-zone="graveyard"]'],
        ["exile", '.arena-zone-pile[data-zone="exile"]'],
        ["hand", '.arena-zone-pile[data-zone="hand"]'],
        ["commandZone", '.arena-zone-pile[data-zone="commandZone"]']
      ]) {
        selfSeat.querySelectorAll(selector).forEach((element) => setSelfDropZone(element, zone));
      }
    }

    const handTray = document.querySelector(".arena-hand-tray");
    setSelfDropZone(handTray, "hand");

    for (const slot of document.querySelectorAll(".arena-opponent-ring > .opponent-slot")) {
      const seat = slot.querySelector(".arena-seat");
      const playerId = String(seat?.dataset.playerSeatId || "");
      if (!playerId) continue;
      slot.dataset.dropPlayerId = playerId;
      for (const element of slot.querySelectorAll(
        ".arena-seat,.arena-seat-board,.arena-battlefield-cards,.v610-playmat,.v610-permanent-zone,.v610-land-zone,.v610-card-row"
      )) {
        element.removeAttribute("data-drop-zone");
        element.removeAttribute("data-v624-drop-owner");
        element.dataset.dropPlayerId = playerId;
        element.classList.add("v624-opponent-attack-zone");
      }
    }
  }

  function repairCardElements() {
    document.querySelectorAll(".arena-card,.arena-card img").forEach((element) => {
      element.setAttribute("draggable", "false");
    });
  }

  function clearNonGameState() {
    if (gesture) destroyGesture();
    document.body.classList.remove("v622-game-visible", "v622-dragging", "v622-moving-card");
    document.querySelectorAll(".v622-drag-ghost").forEach((element) => element.remove());
    clearHighlights();
  }

  function repair() {
    const shell = gameShell();
    if (!shell) {
      clearNonGameState();
      return;
    }
    document.body.classList.add("v622-game-visible");
    shell.classList.add("arena-v622", "arena-v624", "arena-v628-interaction");
    window.ArenaCommanderPlaymatV610?.repairPlaymat?.();
    repairSwitcher();
    repairDropZones();
    repairCardElements();
  }

  function scheduleRepair() {
    if (repairQueued) return;
    repairQueued = true;
    requestAnimationFrame(() => {
      repairQueued = false;
      repair();
    });
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
