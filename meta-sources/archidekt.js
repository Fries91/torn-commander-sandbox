"use strict";

const { fetchJson, normalizeCandidate, normalizeText } = require("./common");

function archidektDeckId(url) {
  const match = String(url || "").match(/archidekt\.com\/(?:api\/)?decks\/(\d+)/i);
  return match ? match[1] : null;
}

function cardName(entry) {
  return normalizeText(entry?.card?.oracleCard?.name ?? entry?.card?.name ?? entry?.name, 180);
}

async function fetchArchidektDeck(url, defaults = {}) {
  const id = archidektDeckId(url);
  if (!id) throw new Error("Invalid Archidekt deck URL.");
  const data = await fetchJson(`https://archidekt.com/api/decks/${id}/`, { timeoutMs: 45000 });
  const premierCategories = new Set(
    (data.categories || [])
      .filter((category) => category?.includedInDeck && category?.isPremier)
      .map((category) => category.name)
  );
  const includedCategories = new Set(
    (data.categories || [])
      .filter((category) => category?.includedInDeck)
      .map((category) => category.name)
  );
  const commanders = [];
  const cards = [];
  for (const entry of data.cards || []) {
    const name = cardName(entry);
    if (!name) continue;
    const categories = Array.isArray(entry.categories) ? entry.categories : [];
    const isIncluded = !categories.length || categories.some((nameValue) => includedCategories.has(nameValue));
    if (!isIncluded) continue;
    const isCommander = categories.some((nameValue) => premierCategories.has(nameValue));
    if (isCommander) commanders.push(name);
    cards.push({ name, quantity: Math.max(1, Number(entry.quantity || 1)) });
  }
  return normalizeCandidate({
    source: defaults.source || "archidekt",
    sourceLabel: defaults.sourceLabel || "Archidekt",
    externalId: defaults.externalId || `archidekt-${id}`,
    title: defaults.title || data.name || `Archidekt Deck ${id}`,
    commanders: defaults.commanders?.length ? defaults.commanders : commanders,
    cards,
    category: defaults.category || "curated",
    format: defaults.format || "commander",
    archetype: defaults.archetype || "",
    powerTier: defaults.powerTier || "high-power",
    sourceUrl: defaults.sourceUrl || `https://archidekt.com/decks/${id}`,
    authorName: defaults.authorName || data.owner?.username || data.owner?.displayName || "",
    sourceUpdatedAt: data.updatedAt || data.lastUpdated || null,
    popularityScore: defaults.popularityScore || data.viewCount || 0,
    featured: defaults.featured,
    raw: { archidektId: id }
  });
}

module.exports = { archidektDeckId, fetchArchidektDeck };
