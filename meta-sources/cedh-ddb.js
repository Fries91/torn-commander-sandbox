"use strict";

const { fetchText, normalizeText, splitEnvList, uniqueBy } = require("./common");
const { fetchArchidektDeck, archidektDeckId } = require("./archidekt");
const { fetchMoxfieldDeck, moxfieldDeckId } = require("./moxfield");

function discoverDeckLinks(html) {
  const links = [];
  const regex = /https?:\/\/(?:www\.)?(?:archidekt\.com\/decks\/\d+|moxfield\.com\/decks\/[A-Za-z0-9_-]+)[^"'\s<]*/gi;
  for (const match of String(html || "").matchAll(regex)) {
    const url = match[0].replace(/[),.;]+$/, "");
    if (archidektDeckId(url) || moxfieldDeckId(url)) links.push(url);
  }
  return uniqueBy(links, (url) => archidektDeckId(url) || moxfieldDeckId(url));
}

async function discoverCedhDdbDecks() {
  if (String(process.env.META_CEDH_DDB_ENABLED || "true").toLowerCase() === "false") return [];
  const limit = Math.max(1, Math.min(100, Number(process.env.META_CEDH_LIMIT || 20)));
  const configured = splitEnvList("META_CEDH_DECK_URLS");
  let links = configured;
  if (!links.length) {
    try {
      const html = await fetchText("https://cedh-decklist-database.com/", { timeoutMs: 45000 });
      links = discoverDeckLinks(html);
    } catch (error) {
      console.warn(`cEDH DDB discovery failed: ${error.message}`);
    }
  }
  const output = [];
  for (const url of links.slice(0, limit)) {
    try {
      const loader = archidektDeckId(url) ? fetchArchidektDeck : fetchMoxfieldDeck;
      const deck = await loader(url, {
        source: "cedh-ddb",
        sourceLabel: "cEDH Decklist Database",
        category: "competitive",
        powerTier: "cedh",
        sourceUrl: url,
        featured: true
      });
      if (deck) {
        deck.title = normalizeText(deck.title, 200);
        output.push(deck);
      }
    } catch (error) {
      console.warn(`cEDH deck ${url} skipped: ${error.message}`);
    }
  }
  return output;
}

module.exports = { discoverCedhDdbDecks, discoverDeckLinks };
