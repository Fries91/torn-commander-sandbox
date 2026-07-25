(() => {
  "use strict";

  const VERSION = "62.4.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const MIN_DRAG_DISTANCE = 7;
  const HOLD_DELAY = 95;

  let drag = null;
  let requestPending = false;
  let suppressClicksUntil = 0;
  let repairQueued = false;

  function session() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; }
    catch { return null; }
  }

  function gameShell() {
    return document.querySelector(".arena-game-shell");
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

  function closestCard(target) {
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
      document.querySelectorAll('.opponent-slot.v61-focus-visible [data-drop-player-id]').forEach((element) => {
        element.classList.add("v624-drop-ready");
      });
    }
  }

  function playerTargetAt(x, y) {
    for (const slot of document.querySelectorAll(".opponent-slot.v61-focus-visible")) {
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

  function beginDrag(event) {
    if (!drag || drag.active || !gameShell()) return;
    drag.active = true;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    document.body.classList.add("v622-dragging");
    drag.card.classList.add("v622-drag-source");

    const ghost = drag.card.cloneNode(true);
    ghost.classList.add("v622-drag-ghost");
    ghost.removeAttribute("data-action");
    ghost.removeAttribute("draggable");
    ghost.style.left = `${event.clientX}px`;
    ghost.style.top = `${event.clientY}px`;
    document.body.appendChild(ghost);
    drag.ghost = ghost;

    showAvailableTargets({
      fromZone: String(drag.card.dataset.zone || "")
    });
    navigator.vibrate?.(18);
  }

  function maybeAutoScroll(event) {
    if (document.body.classList.contains("v621-fullscreen")) return;
    if (event.clientY < 92) window.scrollBy({ top: -22, behavior: "auto" });
    else if (event.clientY > window.innerHeight - 118) window.scrollBy({ top: 22, behavior: "auto" });
  }

  function updateDrag(event) {
    if (!drag?.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
    maybeAutoScroll(event);

    document.querySelectorAll(".v622-drop-target").forEach((element) => element.classList.remove("v622-drop-target"));
    const source = { fromZone: String(drag.card.dataset.zone || "") };
    drag.target = targetAt(event.clientX, event.clientY, source);
    drag.target?.classList.add("v622-drop-target");
  }

  function destroyDrag() {
    if (!drag) return;
    window.clearTimeout(drag.timer);
    drag.ghost?.remove();
    drag.card?.classList.remove("v622-drag-source");
    clearHighlights();
    drag = null;
    document.body.classList.remove("v622-dragging");
  }

  async function finishDrag(event) {
    if (!drag) return;
    window.clearTimeout(drag.timer);
    if (!drag.active) {
      drag = null;
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClicksUntil = Date.now() + 700;

    const source = {
      cardId: String(drag.card.dataset.cardId || ""),
      fromZone: String(drag.card.dataset.zone || ""),
      ownerId: String(drag.card.dataset.ownerId || "")
    };

    const x = Number.isFinite(event.clientX) && event.clientX > 0 ? event.clientX : drag.lastX;
    const y = Number.isFinite(event.clientY) && event.clientY > 0 ? event.clientY : drag.lastY;
    const target = targetAt(x, y, source) || drag.target;
    const toZone = String(target?.dataset.dropZone || "");
    const defenderPlayerId = String(target?.dataset.dropPlayerId || "");
    destroyDrag();

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

  function installReliableDrag() {
    window.addEventListener("pointerdown", (event) => {
      if (!gameShell() || !event.isPrimary || requestPending) return;
      if (!["touch", "pen", "mouse"].includes(event.pointerType)) return;
      if (event.button != null && event.button !== 0) return;
      const card = closestCard(event.target);
      if (!card || event.target.closest("button,input,textarea,select,a")) return;

      // Stop the older v61 touch-drag handler from starting a second drag at the same time.
      event.stopImmediatePropagation();

      drag = {
        pointerId: event.pointerId,
        card,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        active: false,
        target: null,
        ghost: null,
        timer: window.setTimeout(() => beginDrag(event), HOLD_DELAY)
      };
    }, { capture: true, passive: true });

    window.addEventListener("pointermove", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (!drag.active && distance >= MIN_DRAG_DISTANCE) beginDrag(event);
      if (drag.active) updateDrag(event);
    }, { capture: true, passive: false });

    window.addEventListener("pointerup", (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      finishDrag(event);
    }, { capture: true, passive: false });

    window.addEventListener("pointercancel", (event) => {
      if (drag?.pointerId === event.pointerId) destroyDrag();
    }, { capture: true });

    window.addEventListener("scroll", () => {
      if (drag && !drag.active) destroyDrag();
      if (drag?.active) {
        const source = { fromZone: String(drag.card.dataset.zone || "") };
        document.querySelectorAll(".v622-drop-target").forEach((element) => element.classList.remove("v622-drop-target"));
        drag.target = targetAt(drag.lastX, drag.lastY, source);
        drag.target?.classList.add("v622-drop-target");
      }
    }, { passive: true });

    window.addEventListener("click", (event) => {
      if (Date.now() >= suppressClicksUntil) return;
      if (!event.target.closest?.(".arena-card")) return;
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

  function clearNonGameState() {
    if (drag) destroyDrag();
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
    shell.classList.add("arena-v622", "arena-v624");
    window.ArenaCommanderPlaymatV610?.repairPlaymat?.();
    repairSwitcher();
    repairDropZones();
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
    installReliableDrag();
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
