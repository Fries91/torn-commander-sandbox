"use strict";

const fs = require("fs/promises");
const path = require("path");
const { fetchJson, normalizeCandidate, splitEnvList } = require("./common");
const { fetchArchidektDeck, archidektDeckId } = require("./archidekt");
const { fetchMoxfieldDeck, moxfieldDeckId } = require("./moxfield");

async function expandCatalogEntry(entry, defaults = {}) {
  if (!entry || typeof entry !== "object") return null;
  const deckUrl = entry.deckUrl || entry.deck_url || entry.url;
  if (deckUrl && !(entry.cards || entry.deck || entry.mainboard)) {
    if (archidektDeckId(deckUrl)) return fetchArchidektDeck(deckUrl, { ...defaults, ...entry, sourceUrl: entry.sourceUrl || deckUrl });
    if (moxfieldDeckId(deckUrl)) return fetchMoxfieldDeck(deckUrl, { ...defaults, ...entry, sourceUrl: entry.sourceUrl || deckUrl });
  }
  return normalizeCandidate(entry, defaults);
}

async function loadCatalogObject(value, defaults = {}) {
  const entries = Array.isArray(value) ? value : Array.isArray(value?.decks) ? value.decks : [];
  const output = [];
  for (const entry of entries) {
    try {
      const candidate = await expandCatalogEntry(entry, defaults);
      if (candidate) output.push(candidate);
    } catch (error) {
      console.warn(`Meta catalog entry skipped: ${error.message}`);
    }
  }
  return output;
}

async function discoverCatalogDecks() {
  const output = [];
  const seedPath = process.env.META_SEED_FILE || path.join(__dirname, "..", "data", "meta-seed.json");
  try {
    const local = JSON.parse(await fs.readFile(seedPath, "utf8"));
    output.push(...await loadCatalogObject(local, { source: "seed", sourceLabel: "Arena Curated" }));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Meta seed could not be loaded: ${error.message}`);
  }
  for (const url of splitEnvList("META_CATALOG_URLS")) {
    try {
      const data = await fetchJson(url, { timeoutMs: 45000 });
      output.push(...await loadCatalogObject(data, { source: "catalog", sourceLabel: "Curated Feed" }));
    } catch (error) {
      console.warn(`Meta catalog ${url} failed: ${error.message}`);
    }
  }
  for (const url of splitEnvList("META_ARCHIDEKT_DECK_URLS")) {
    try {
      output.push(await fetchArchidektDeck(url, { source: "archidekt", sourceLabel: "Archidekt", category: "curated" }));
    } catch (error) {
      console.warn(`Archidekt meta deck ${url} failed: ${error.message}`);
    }
  }
  for (const url of splitEnvList("META_MOXFIELD_DECK_URLS")) {
    try {
      output.push(await fetchMoxfieldDeck(url, { source: "moxfield", sourceLabel: "Moxfield", category: "curated" }));
    } catch (error) {
      console.warn(`Moxfield meta deck ${url} failed: ${error.message}`);
    }
  }
  return output.filter(Boolean);
}

module.exports = { discoverCatalogDecks, loadCatalogObject, expandCatalogEntry };
