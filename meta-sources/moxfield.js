"use strict";

const { fetchJson, normalizeCandidate, normalizeText } = require("./common");

function moxfieldDeckId(url) {
  const match = String(url || "").match(/moxfield\.com\/decks\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

function cardName(value) {
  return normalizeText(value?.card?.name ?? value?.name ?? value?.cardName, 180);
}

function entriesFromSection(section) {
  const values = Array.isArray(section) ? section : section && typeof section === "object" ? Object.values(section) : [];
  return values.map((entry) => ({
    name: cardName(entry),
    quantity: Math.max(1, Number(entry?.quantity ?? entry?.amount ?? 1) || 1)
  })).filter((entry) => entry.name);
}

async function fetchMoxfieldDeck(url, defaults = {}) {
  const id = moxfieldDeckId(url);
  if (!id) throw new Error("Invalid Moxfield deck URL.");
  const data = await fetchJson(`https://api.moxfield.com/v2/decks/all/${id}`, {
    timeoutMs: 45000,
    headers: {
      Referer: `https://www.moxfield.com/decks/${id}`,
      Origin: "https://www.moxfield.com"
    }
  });
  const commanders = entriesFromSection(data.commanders).map((entry) => entry.name);
  const cards = [
    ...entriesFromSection(data.commanders),
    ...entriesFromSection(data.mainboard)
  ];
  return normalizeCandidate({
    source: defaults.source || "moxfield",
    sourceLabel: defaults.sourceLabel || "Moxfield",
    externalId: defaults.externalId || `moxfield-${id}`,
    title: defaults.title || data.name || data.publicName || `Moxfield Deck ${id}`,
    commanders: defaults.commanders?.length ? defaults.commanders : commanders,
    cards,
    category: defaults.category || "curated",
    format: defaults.format || "commander",
    archetype: defaults.archetype || data.description || "",
    powerTier: defaults.powerTier || "high-power",
    sourceUrl: defaults.sourceUrl || `https://www.moxfield.com/decks/${id}`,
    authorName: defaults.authorName || data.createdByUser?.displayName || data.createdByUser?.userName || "",
    sourceUpdatedAt: data.lastUpdatedAtUtc || data.updatedAtUtc || null,
    popularityScore: defaults.popularityScore || data.viewCount || 0,
    featured: defaults.featured,
    raw: { moxfieldId: id }
  });
}

module.exports = { moxfieldDeckId, fetchMoxfieldDeck, entriesFromSection };
