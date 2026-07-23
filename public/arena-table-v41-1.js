(() => {
  "use strict";

  const VERSION = "41.1.0";
  const SESSION_KEY = "tornCommander.session.v5";
  const IMAGE_CACHE_KEY = "arenaCommander.fullCardFaces.v41.1";
  const MAX_CACHE_CARDS = 600;
  const IMAGE_BATCH_SIZE = 80;

  let imageTimer = null;
  let imageRequestRunning = false;
  let drag = null;
  let suppressClickUntil = 0;

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function key(value) {
    return clean(value).toLocaleLowerCase("en-US");
  }

  function readJson(storageKey, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey));
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function writeJson(storageKey, value) {
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {}
  }

  function session() {
    const value = readJson(SESSION_KEY, null);
    if (!value?.roomCode || !value?.playerId || !value?.sessionToken) return null;
    return value;
  }

  function imageCache() {
    const value = readJson(IMAGE_CACHE_KEY, {});
    return value && typeof value === "object" ? value : {};
  }

  function saveImageCache(cache) {
    const entries = Object.entries(cache)
      .sort((a, b) => Number(b[1]?.savedAt || 0) - Number(a[1]?.savedAt || 0))
      .slice(0, MAX_CACHE_CARDS);
    writeJson(IMAGE_CACHE_KEY, Object.fromEntries(entries));
  }

  function toast(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const element = document.createElement("div");
    element.className = `toast ${type}`;
    element.textContent = message;
    region.appendChild(element);
    window.setTimeout(() => element.remove(), 4200);
  }

  function currentPhase() {
    const phase = document.querySelector(".arena-phase.is-current");
    return clean(phase?.textContent?.replace(/^\d+/, "")).toLocaleLowerCase("en-US");
  }

  function isMyTurn() {
    return Boolean(document.querySelector(".arena-seat.is-self.is-active"));
  }

  function hasPriority() {
    return Boolean(document.querySelector(".arena-seat.is-self.has-priority"));
  }

  function stackCount() {
    const label = document.querySelector(".center-stack:not(.empty) span")?.textContent || "";
    const match = label.match(/(\d+)/);
    return match ? Number(match[1]) : document.querySelectorAll(".arena-stack-item").length;
  }

  function isMainPhase() {
    return currentPhase().includes("main");
  }

  function proxyClick(dataset) {
    const button = document.createElement("button");
    button.type = "button";
    button.hidden = true;
    button.dataset.v41Forward = "1";
    button.dataset.v411Forward = "1";
    for (const [name, value] of Object.entries(dataset)) {
      if (value != null) button.dataset[name] = String(value);
    }
    document.body.appendChild(button);
    button.click();
    button.remove();
  }

  function fullImageUrl(card) {
    if (!card || typeof card !== "object") return "";
    const direct =
      card.imageUrl ||
      card.normalImageUrl ||
      card.largeImageUrl ||
      card.imageUris?.normal ||
      card.image_uris?.normal ||
      card.images?.normal ||
      "";
    if (direct) return String(direct);

    const faces = card.faces || card.cardFaces || card.card_faces || [];
    for (const face of faces) {
      const faceUrl =
        face?.imageUrl ||
        face?.normalImageUrl ||
        face?.imageUris?.normal ||
        face?.image_uris?.normal ||
        face?.images?.normal ||
        "";
      if (faceUrl) return String(faceUrl);
    }
    return "";
  }

  function normalizedMetadata(card) {
    const keywords = Array.isArray(card?.keywords)
      ? card.keywords.map(clean).filter(Boolean)
      : [];
    const oracleText = clean(
      card?.oracleText ||
      card?.oracle_text ||
      card?.faces?.map((face) => face?.oracleText || face?.oracle_text || "").join(" // ") ||
      ""
    );

    return {
      name: clean(card?.name),
      imageUrl: fullImageUrl(card),
      typeLine: clean(card?.typeLine || card?.type_line),
      oracleText,
      keywords,
      flash: keywords.some((entry) => /^flash$/i.test(entry)) || /\bflash\b/i.test(oracleText),
      savedAt: Date.now()
    };
  }

  function visibleCardName(element) {
    return clean(
      element.querySelector(".arena-card-frame header strong")?.textContent ||
      element.querySelector(".arena-card-image img")?.alt ||
      element.getAttribute("aria-label") ||
      ""
    );
  }

  function applyMetadataToCard(element, metadata) {
    if (!element || !metadata) return;

    if (metadata.typeLine) element.dataset.v411Type = metadata.typeLine;
    if (metadata.flash) element.dataset.v411Flash = "1";

    const image = element.querySelector(".arena-card-image img");
    if (!image || !metadata.imageUrl) return;

    if (image.dataset.v411FullUrl !== metadata.imageUrl) {
      image.dataset.v411FullUrl = metadata.imageUrl;
      image.src = metadata.imageUrl;
      image.removeAttribute("srcset");
    }

    image.loading = "eager";
    image.decoding = "async";
    image.classList.add("is-visible");
    image.style.opacity = "1";
    element.classList.add("v411-full-card");
  }

  function applyCachedImages(root = document) {
    const cache = imageCache();
    for (const element of root.querySelectorAll(".arena-card")) {
      const name = visibleCardName(element);
      const metadata = cache[key(name)];
      if (metadata) applyMetadataToCard(element, metadata);
    }
  }

  async function requestCardMetadata(names) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 18000);

    try {
      const response = await fetch("/api/cards/resolve", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({ names })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(payload?.error || `Card lookup returned HTTP ${response.status}.`);
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function loadFullCardImages() {
    if (imageRequestRunning) return;
    imageRequestRunning = true;

    try {
      const cache = imageCache();
      const cardElements = [...document.querySelectorAll(".arena-card")];
      const missingNames = [...new Set(
        cardElements
          .map(visibleCardName)
          .filter(Boolean)
          .filter((name) => !cache[key(name)]?.imageUrl)
      )];

      for (let index = 0; index < missingNames.length; index += IMAGE_BATCH_SIZE) {
        const batch = missingNames.slice(index, index + IMAGE_BATCH_SIZE);
        const payload = await requestCardMetadata(batch);

        for (const entry of payload.resolved || []) {
          const card = entry?.card || entry;
          const metadata = normalizedMetadata(card);
          const requestedName = clean(entry?.requestedName || entry?.requested || metadata.name);
          if (!metadata.imageUrl) continue;
          if (requestedName) cache[key(requestedName)] = metadata;
          if (metadata.name) cache[key(metadata.name)] = metadata;
        }
      }

      saveImageCache(cache);
      applyCachedImages();
    } catch (error) {
      console.warn("Arena Commander full-card image lookup:", error);
    } finally {
      imageRequestRunning = false;
    }
  }

  function scheduleFullCardImages() {
    window.clearTimeout(imageTimer);
    imageTimer = window.setTimeout(() => {
      applyCachedImages();
      loadFullCardImages();
    }, 60);
  }

  function cardInfo(element) {
    const card = element?.closest?.(".arena-card");
    if (!card) return null;

    const type = clean(
      card.dataset.v411Type ||
      card.querySelector(".arena-card-type")?.textContent ||
      ""
    );

    return {
      element: card,
      cardId: card.dataset.cardId,
      zone: card.dataset.zone,
      ownerId: card.dataset.ownerId,
      canControl: card.dataset.canControl === "1",
      name: visibleCardName(card) || "Card",
      type,
      isLand: /\bland\b/i.test(type),
      isInstant: /\binstant\b/i.test(type),
      hasFlash: card.dataset.v411Flash === "1",
      imageUrl:
        card.querySelector(".arena-card-image img")?.dataset.v411FullUrl ||
        card.querySelector(".arena-card-image img")?.src ||
        ""
    };
  }

  function legalDrop(card) {
    if (!card?.canControl || card.zone !== "hand" || !hasPriority()) return false;
    if (card.isLand) return isMyTurn() && isMainPhase() && stackCount() === 0;
    if (card.isInstant || card.hasFlash) return true;
    return isMyTurn() && isMainPhase() && stackCount() === 0;
  }

  function legalDropMessage(card) {
    if (!hasPriority()) return "Wait until you have priority.";
    if (card?.isLand && !(isMyTurn() && isMainPhase() && stackCount() === 0)) {
      return "Lands can be played during your main phase while the stack is empty.";
    }
    if (!card?.isInstant && !card?.hasFlash && !(isMyTurn() && isMainPhase() && stackCount() === 0)) {
      return "That spell normally needs your main phase and an empty stack.";
    }
    return "That card cannot be dragged from this zone.";
  }

  function battlefieldDropZone() {
    return document.querySelector(".self-slot .arena-seat-board");
  }

  function isPointOverDropZone(x, y) {
    const zone = battlefieldDropZone();
    if (!zone) return false;
    const rect = zone.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function clearDropClasses() {
    document.documentElement.classList.remove("v411-dragging-card");
    battlefieldDropZone()?.classList.remove("v411-drop-active", "v411-drop-hover");
  }

  function createGhost(card, x, y) {
    const ghost = document.createElement("div");
    ghost.className = "v411-card-drag-ghost";
    ghost.innerHTML = card.imageUrl
      ? `<img src="${card.imageUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}" alt="">`
      : `<div><strong>${card.name}</strong><span>♛</span></div>`;
    document.body.appendChild(ghost);
    positionGhost(ghost, x, y);
    return ghost;
  }

  function positionGhost(ghost, x, y) {
    if (!ghost) return;
    ghost.style.transform = `translate3d(${Math.round(x - 70)}px, ${Math.round(y - 98)}px, 0) rotate(3deg)`;
  }

  function beginDrag(pointerEvent, card) {
    const zone = battlefieldDropZone();
    if (!zone) return;

    drag.started = true;
    drag.card = card;
    drag.ghost = createGhost(card, pointerEvent.clientX, pointerEvent.clientY);
    drag.source.classList.add("v411-drag-source");
    document.documentElement.classList.add("v411-dragging-card");
    zone.classList.add("v411-drop-active");
    drag.source.setPointerCapture?.(pointerEvent.pointerId);
    if (navigator.vibrate) navigator.vibrate(25);
  }

  function cancelDrag() {
    if (!drag) return;
    drag.ghost?.remove();
    drag.source?.classList.remove("v411-drag-source");
    clearDropClasses();
    drag = null;
  }

  function performDrop(card) {
    if (card.isLand) {
      proxyClick({
        action: "move-card",
        cardId: card.cardId,
        fromZone: "hand",
        toZone: "battlefield"
      });
      toast(`${card.name} played to the battlefield.`, "success");
      return;
    }

    proxyClick({
      action: "open-cast-card",
      cardId: card.cardId,
      fromZone: "hand"
    });
    toast(`Choose payment and targets for ${card.name}.`, "info");
  }

  function finishDrag(pointerEvent) {
    if (!drag) return;

    const activeDrag = drag;
    const overZone = isPointOverDropZone(pointerEvent.clientX, pointerEvent.clientY);
    const allowed = legalDrop(activeDrag.card);

    activeDrag.ghost?.remove();
    activeDrag.source?.classList.remove("v411-drag-source");
    clearDropClasses();
    drag = null;

    if (!activeDrag.started) return;

    suppressClickUntil = Date.now() + 650;
    document.getElementById("arenaV41CardSheet")?.remove();

    if (!overZone) {
      toast("Drag the card into your battlefield area to play it.", "warning");
      return;
    }

    if (!allowed) {
      toast(legalDropMessage(activeDrag.card), "warning");
      return;
    }

    performDrop(activeDrag.card);
  }

  document.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    const source = event.target.closest(".arena-hand-tray .arena-card");
    if (!source) return;

    const card = cardInfo(source);
    if (!card?.canControl || card.zone !== "hand") return;

    drag = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      source,
      card,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      started: false,
      ghost: null
    };
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;

    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (!drag.started && distance >= 10) beginDrag(event, drag.card);
    if (!drag.started) return;

    event.preventDefault();
    positionGhost(drag.ghost, event.clientX, event.clientY);
    battlefieldDropZone()?.classList.toggle(
      "v411-drop-hover",
      isPointOverDropZone(event.clientX, event.clientY)
    );
  }, { capture: true, passive: false });

  document.addEventListener("pointerup", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishDrag(event);
  }, true);

  document.addEventListener("pointercancel", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    cancelDrag();
  }, true);

  document.addEventListener("dragstart", (event) => {
    if (event.target.closest(".arena-hand-tray .arena-card")) event.preventDefault();
  }, true);

  // Register before the v41 click handler in index.html. This prevents a drag
  // release from also opening the ordinary card sheet.
  document.addEventListener("click", (event) => {
    if (Date.now() >= suppressClickUntil) return;
    if (!event.target.closest(".arena-card")) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }, true);

  const observer = new MutationObserver(scheduleFullCardImages);
  const app = document.getElementById("app");
  if (app) observer.observe(app, { childList: true, subtree: true });

  window.addEventListener("load", scheduleFullCardImages, { once: true });
  scheduleFullCardImages();

  window.ArenaCommanderFullCardsAndDrag = {
    version: VERSION,
    refresh: scheduleFullCardImages,
    clearImageCache() {
      localStorage.removeItem(IMAGE_CACHE_KEY);
      scheduleFullCardImages();
    }
  };
})();
