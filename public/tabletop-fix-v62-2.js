(() => {
  "use strict";

  const VERSION = "62.3.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const MIN_DRAG_DISTANCE = 10;
  const HOLD_DELAY = 135;

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
    return ({ battlefield: "Battlefield", hand: "Hand", graveyard: "Graveyard", exile: "Exile", commandZone: "Command Zone" })[zone] || zone;
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
        body: JSON.stringify({ roomCode: saved.roomCode, playerId: saved.playerId, sessionToken: saved.sessionToken, ...action })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.error || "The card could not be moved.");
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

  function clearHighlights() {
    document.querySelectorAll(".v622-drop-target").forEach((element) => element.classList.remove("v622-drop-target"));
  }

  function targetAt(x, y) {
    const elements = document.elementsFromPoint?.(x, y) || [];
    for (const element of elements) {
      if (element.classList?.contains("v622-drag-ghost")) continue;
      const zone = element.closest?.("[data-drop-zone]");
      if (zone?.dataset.dropZone) return zone;
      const player = element.closest?.("[data-drop-player-id]");
      if (player?.dataset.dropPlayerId) return player;
    }
    return null;
  }

  function beginDrag(event) {
    if (!drag || drag.active || !gameShell()) return;
    drag.active = true;
    try { drag.card.setPointerCapture?.(drag.pointerId); } catch {}
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
    navigator.vibrate?.(18);
  }

  function updateDrag(event) {
    if (!drag?.active) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    drag.ghost.style.left = `${event.clientX}px`;
    drag.ghost.style.top = `${event.clientY}px`;
    clearHighlights();
    drag.target = targetAt(event.clientX, event.clientY);
    drag.target?.classList.add("v622-drop-target");
  }

  function destroyDrag() {
    if (!drag) return;
    window.clearTimeout(drag.timer);
    try { drag.card?.releasePointerCapture?.(drag.pointerId); } catch {}
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
    suppressClicksUntil = Date.now() + 650;

    const source = {
      cardId: String(drag.card.dataset.cardId || ""),
      fromZone: String(drag.card.dataset.zone || ""),
      ownerId: String(drag.card.dataset.ownerId || "")
    };
    const target = drag.target;
    const toZone = String(target?.dataset.dropZone || "");
    const defenderPlayerId = String(target?.dataset.dropPlayerId || "");
    destroyDrag();

    if (toZone) {
      if (toZone === source.fromZone) return;
      const result = await post({ type: "move-card", cardId: source.cardId, fromZone: source.fromZone, toZone });
      if (result) toast(`Moved card to ${zoneLabel(toZone)}.`, "success");
      return;
    }

    if (defenderPlayerId && source.fromZone === "battlefield") {
      const result = await post({ type: "declare-attacker", cardId: source.cardId, defenderPlayerId });
      if (result) toast("Attacker declared.", "success");
      return;
    }

    toast("Drop the card inside a highlighted zone.", "warning");
  }

  function installReliableDrag() {
    window.addEventListener("pointerdown", (event) => {
      if (!gameShell() || !event.isPrimary || requestPending) return;
      if (!["touch", "pen", "mouse"].includes(event.pointerType)) return;
      if (event.button != null && event.button !== 0) return;
      const card = closestCard(event.target);
      if (!card || event.target.closest("button,input,textarea,select,a")) return;

      drag = {
        pointerId: event.pointerId,
        card,
        startX: event.clientX,
        startY: event.clientY,
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
    switcher.classList.add("v622-board-switcher");
    const toggle = switcher.querySelector('[data-v621-action="toggle-board"]');
    if (toggle) toggle.setAttribute("title", "Switch between your battlefield and the selected opponent");
  }

  function repairDropZones() {
    document.querySelectorAll(".v610-permanent-zone,.v610-land-zone,.v610-card-row").forEach((zone) => { zone.dataset.dropZone = "battlefield"; });
    document.querySelectorAll('.arena-zone-pile[data-zone="graveyard"]').forEach((zone) => zone.dataset.dropZone = "graveyard");
    document.querySelectorAll('.arena-zone-pile[data-zone="exile"]').forEach((zone) => zone.dataset.dropZone = "exile");
    document.querySelectorAll('.arena-zone-pile[data-zone="hand"]').forEach((zone) => zone.dataset.dropZone = "hand");
    document.querySelectorAll('.arena-zone-pile[data-zone="commandZone"]').forEach((zone) => zone.dataset.dropZone = "commandZone");
  }

  function clearNonGameState() {
    if (drag) destroyDrag();
    document.body.classList.remove("v622-game-visible", "v622-dragging", "v622-moving-card");
    document.querySelectorAll(".v622-drag-ghost").forEach((element) => element.remove());
  }

  function repair() {
    const shell = gameShell();
    if (!shell) {
      clearNonGameState();
      return;
    }
    document.body.classList.add("v622-game-visible");
    shell.classList.add("arena-v622");
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

  window.ArenaCommanderTabletopFixV622 = { version: VERSION, repair, clearNonGameState };
})();
