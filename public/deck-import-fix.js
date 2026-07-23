(() => {
  "use strict";

  const FIX_VERSION = "39.2.0";
  const STORAGE_KEY = "tornCommander.decks.v5";
  const MAX_NAMES_PER_LOOKUP = 150;
  const AUTO_REPAIR_COOLDOWN_MS = 6 * 60 * 60 * 1000;

  function key(value) {
    return String(value || "").trim().toLocaleLowerCase("en-US");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cleanCardName(value) {
    let name = String(value || "")
      .replace(/^\uFEFF/, "")
      .replace(/^[-•●▪◦]\s*/, "")
      .replace(/^SB:\s*/i, "")
      .replace(/\t.*$/, "")
      .trim();

    // Common deck-site annotations and commander markers.
    name = name
      .replace(/\s+(?:\*F\*|\*E\*|\*P\*|foil|etched foil|etched|showcase|borderless)\s*$/i, "")
      .replace(/\s+(?:\^+|!+|#(?:commander|cmdr)?|\{(?:commander|cmdr)\}|\[(?:commander|cmdr)\])\s*$/i, "")
      .replace(/\s+\((?:foil|etched|showcase|borderless)\)\s*$/i, "")
      .trim();

    // Moxfield / Archidekt / Arena / MTGO style set and collector suffixes.
    const suffixPatterns = [
      /\s+\([A-Z0-9_-]{2,12}\)\s+[A-Z0-9-]+(?:\s+.*)?$/i,
      /\s+\[[A-Z0-9_-]{2,12}\]\s+[A-Z0-9-]+(?:\s+.*)?$/i,
      /\s+\[[A-Z0-9_-]{2,12}[:#][A-Z0-9-]+\](?:\s+.*)?$/i,
      /\s+\([A-Z0-9_-]{2,12}\)\s*$/i,
      /\s+\[[A-Z0-9_-]{2,12}\]\s*$/i
    ];
    for (const pattern of suffixPatterns) name = name.replace(pattern, "").trim();

    // Remove price / ownership decorations sometimes appended after multiple spaces.
    name = name
      .replace(/\s{2,}(?:\$|€|£)\s*\d.*$/i, "")
      .replace(/\s{2,}(?:owned|not owned|proxy|altered)\b.*$/i, "")
      .trim();

    return name;
  }

  function isSectionHeader(line) {
    const text = String(line || "").trim();
    if (!text) return true;
    if (/^(?:commander|commanders|deck|mainboard|maindeck|sideboard|maybeboard|considering|companion|tokens?)\s*:?(?:\s*\(\d+\))?$/i.test(text)) return true;
    if (/^(?:creatures?|lands?|artifacts?|enchantments?|instants?|sorceries?|planeswalkers?|battles?|other)\s*:?(?:\s*\(\d+\))?$/i.test(text)) return true;
    if (/^\/\//.test(text)) return true;
    return false;
  }

  function parseDeckList(text) {
    const cards = new Map();
    for (const rawLine of String(text || "").split(/\r?\n/)) {
      let line = rawLine.replace(/^\uFEFF/, "").trim();
      if (isSectionHeader(line)) continue;
      line = line.replace(/^[-•●▪◦]\s*/, "");

      const match = line.match(/^(\d{1,3})\s*(?:[xX×]\s*)?(?:[-–—:]\s*)?(.+?)\s*$/);
      if (!match) continue;

      const quantity = Math.max(1, Math.min(100, Number(match[1]) || 1));
      const name = cleanCardName(match[2]);
      if (!name) continue;

      const normalizedKey = key(name);
      const existing = cards.get(normalizedKey);
      if (existing) existing.quantity = Math.min(100, existing.quantity + quantity);
      else cards.set(normalizedKey, { name, quantity });
    }
    return [...cards.values()];
  }

  function splitCommanders(value) {
    const protectedValue = String(value || "").replace(/\s+\/\/\s+/g, " __DOUBLE_SLASH__ ");
    return protectedValue
      .split(/\r?\n|\s+\+\s+|\s+&\s+|\s+\/\s+|\s*;\s*/)
      .map((name) => cleanCardName(name.replace(/__DOUBLE_SLASH__/g, "//")))
      .filter(Boolean)
      .slice(0, 6);
  }

  function uniqueNames(cards, commanders) {
    return [...new Map(
      [...cards.map((card) => card.name), ...commanders]
        .map(cleanCardName)
        .filter(Boolean)
        .map((name) => [key(name), name])
    ).values()].slice(0, MAX_NAMES_PER_LOOKUP);
  }

  async function resolveCards(names) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch("/api/cards/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({ names }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || "Card lookup failed.");
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  function buildLookup(payload) {
    const lookup = new Map();
    for (const entry of payload?.resolved || []) {
      if (!entry?.card) continue;
      if (entry.requestedName) lookup.set(key(entry.requestedName), entry.card);
      if (entry.card.name) lookup.set(key(entry.card.name), entry.card);
      for (const face of entry.card.faces || []) if (face?.name) lookup.set(key(face.name), entry.card);
    }
    return lookup;
  }

  function hydrateDeck({ deckId, deckName, cards, commanders, payload, previous = null }) {
    const lookup = buildLookup(payload);
    const hydratedCards = cards.map((entry) => {
      const cleanName = cleanCardName(entry.name);
      const cardData = lookup.get(key(cleanName)) || null;
      return {
        ...entry,
        name: cardData?.name || cleanName,
        cardData
      };
    });
    const commanderData = commanders
      .map((name) => lookup.get(key(cleanCardName(name))) || null)
      .filter(Boolean);
    const normalizedCommanders = commanders.map((name) => lookup.get(key(cleanCardName(name)))?.name || cleanCardName(name));
    const intelligenceCount = hydratedCards.filter((entry) => entry.cardData?.scryfallId).length;

    return {
      ...(previous || {}),
      id: deckId || previous?.id || globalThis.crypto?.randomUUID?.() || `deck-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: String(deckName || previous?.name || "Commander Deck").trim(),
      commanders: normalizedCommanders,
      commanderData,
      cards: hydratedCards,
      totalCards: hydratedCards.reduce((sum, card) => sum + Number(card.quantity || 0), 0),
      uniqueCards: hydratedCards.length,
      intelligenceCount,
      cardDataUpdatedAt: new Date().toISOString(),
      importFixVersion: FIX_VERSION,
      importFixAttemptedAt: Date.now(),
      importNotFound: Array.isArray(payload?.notFound) ? payload.notFound : []
    };
  }

  function readDecks() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function writeDecks(decks) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decks));
  }

  function closeDeckModal() {
    const backdrop = document.getElementById("modalBackdrop");
    const body = document.getElementById("modalBody");
    backdrop?.classList.add("is-hidden");
    backdrop?.setAttribute("aria-hidden", "true");
    if (body) body.innerHTML = "";
    document.body.style.overflow = "";
  }

  function showStatus(message, type = "info") {
    const region = document.getElementById("toastRegion");
    if (!region) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    region.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  async function handleDeckSubmit(event) {
    const form = event.target?.closest?.("#deckForm");
    if (!form) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const data = new FormData(form);
    const cards = parseDeckList(data.get("deckList"));
    const commanders = splitCommanders(data.get("commanders"));
    if (!cards.length || !commanders.length) {
      showStatus("Add a commander and a deck list with a quantity before each card.", "error");
      return;
    }

    const button = event.submitter || form.querySelector("button[type='submit']");
    const originalText = button?.textContent || "Identify and save deck";
    if (button) {
      button.disabled = true;
      button.textContent = "Cleaning and identifying cards…";
    }

    try {
      const names = uniqueNames(cards, commanders);
      const payload = await resolveCards(names);
      const decks = readDecks();
      const deckId = String(data.get("deckId") || "");
      const index = deckId ? decks.findIndex((deck) => deck.id === deckId) : -1;
      const previous = index >= 0 ? decks[index] : null;
      const deck = hydrateDeck({
        deckId,
        deckName: data.get("deckName"),
        cards,
        commanders,
        payload,
        previous
      });
      if (index >= 0) decks[index] = deck;
      else decks.unshift(deck);
      writeDecks(decks);
      closeDeckModal();

      const missing = deck.uniqueCards - deck.intelligenceCount;
      showStatus(
        missing > 0
          ? `${deck.intelligenceCount}/${deck.uniqueCards} cards recognized. ${missing} name${missing === 1 ? " needs" : "s need"} checking.`
          : `All ${deck.uniqueCards} unique cards recognized.`,
        missing > 0 ? "warning" : "success"
      );
      setTimeout(() => location.reload(), 500);
    } catch (error) {
      showStatus(error?.name === "AbortError" ? "Card lookup timed out. Try again." : error?.message || "Card lookup failed.", "error");
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  function needsRepair(deck) {
    if (!deck || !Array.isArray(deck.cards) || !deck.cards.length) return false;
    const recognized = Number(deck.intelligenceCount ?? deck.cards.filter((card) => card.cardData?.scryfallId).length) || 0;
    if (recognized > 0) return false;
    if (deck.importFixVersion === FIX_VERSION && Date.now() - Number(deck.importFixAttemptedAt || 0) < AUTO_REPAIR_COOLDOWN_MS) return false;
    return true;
  }

  async function repairSavedDecks() {
    const decks = readDecks();
    const candidates = decks.filter(needsRepair);
    if (!candidates.length) return;

    let changed = false;
    for (const candidate of candidates.slice(0, 3)) {
      const cardsMap = new Map();
      for (const rawCard of candidate.cards || []) {
        const name = cleanCardName(rawCard.name);
        if (!name) continue;
        const normalizedKey = key(name);
        const quantity = Math.max(1, Math.min(100, Number(rawCard.quantity) || 1));
        const existing = cardsMap.get(normalizedKey);
        if (existing) existing.quantity = Math.min(100, existing.quantity + quantity);
        else cardsMap.set(normalizedKey, { name, quantity });
      }
      const cards = [...cardsMap.values()];
      const commanders = (candidate.commanders || []).map(cleanCardName).filter(Boolean);
      candidate.importFixVersion = FIX_VERSION;
      candidate.importFixAttemptedAt = Date.now();
      try {
        const payload = await resolveCards(uniqueNames(cards, commanders));
        const repaired = hydrateDeck({
          deckId: candidate.id,
          deckName: candidate.name,
          cards,
          commanders,
          payload,
          previous: candidate
        });
        const index = decks.findIndex((deck) => deck.id === candidate.id);
        if (index >= 0) decks[index] = repaired;
        changed = changed || repaired.intelligenceCount > 0;
      } catch {
        // Save the attempt timestamp so a temporary outage does not cause a reload loop.
      }
    }
    writeDecks(decks);
    if (changed && !sessionStorage.getItem("arenaCommanderDeckRepairReloaded")) {
      sessionStorage.setItem("arenaCommanderDeckRepairReloaded", "1");
      setTimeout(() => location.reload(), 300);
    }
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { cleanCardName, parseDeckList, splitCommanders };
  }

  if (typeof document === "undefined") return;
  document.addEventListener("submit", handleDeckSubmit, true);
  window.addEventListener("load", () => setTimeout(repairSavedDecks, 700), { once: true });
  window.ArenaCommanderDeckImportFix = { version: FIX_VERSION, cleanCardName, parseDeckList, splitCommanders, repairSavedDecks };
})();
