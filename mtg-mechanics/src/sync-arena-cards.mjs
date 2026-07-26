import { mkdir, readFile, writeFile } from "node:fs/promises";

const BULK_INDEX_URL = "https://api.scryfall.com/bulk-data/oracle-cards";
const outputDir = new URL("../generated/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const headers = {
  "User-Agent": "MTG-Commander-Sandbox/0.1 card-sync",
  "Accept": "application/json"
};

const indexResponse = await fetch(BULK_INDEX_URL, { headers });
if (!indexResponse.ok) {
  throw new Error(`Scryfall bulk index failed: ${indexResponse.status}`);
}
const bulk = await indexResponse.json();
if (!bulk.download_uri) throw new Error("Scryfall response did not include download_uri.");

const cardResponse = await fetch(bulk.download_uri, { headers });
if (!cardResponse.ok) {
  throw new Error(`Scryfall card download failed: ${cardResponse.status}`);
}
const allCards = await cardResponse.json();

function compactFace(face) {
  return {
    name: face.name,
    mana_cost: face.mana_cost,
    type_line: face.type_line,
    oracle_text: face.oracle_text,
    colors: face.colors,
    power: face.power,
    toughness: face.toughness,
    loyalty: face.loyalty,
    defense: face.defense,
    image_uris: face.image_uris
  };
}

function compactCard(card) {
  return {
    id: card.id,
    oracle_id: card.oracle_id,
    arena_id: card.arena_id,
    name: card.name,
    layout: card.layout,
    mana_cost: card.mana_cost,
    cmc: card.cmc,
    type_line: card.type_line,
    oracle_text: card.oracle_text,
    colors: card.colors,
    color_identity: card.color_identity,
    keywords: card.keywords ?? [],
    produced_mana: card.produced_mana ?? [],
    power: card.power,
    toughness: card.toughness,
    loyalty: card.loyalty,
    defense: card.defense,
    legalities: card.legalities,
    games: card.games,
    set: card.set,
    set_name: card.set_name,
    collector_number: card.collector_number,
    rarity: card.rarity,
    digital: card.digital,
    reprint: card.reprint,
    image_uris: card.image_uris,
    card_faces: card.card_faces?.map(compactFace)
  };
}

const arenaCards = allCards
  .filter((card) => Array.isArray(card.games) && card.games.includes("arena"))
  .map(compactCard)
  .sort((a, b) => a.name.localeCompare(b.name));

const keywordCounts = new Map();
for (const card of arenaCards) {
  for (const keyword of card.keywords ?? []) {
    keywordCounts.set(keyword, (keywordCounts.get(keyword) ?? 0) + 1);
  }
}
const keywords = [...keywordCounts.entries()]
  .map(([name, cardCount]) => ({ name, cardCount }))
  .sort((a, b) => a.name.localeCompare(b.name));

await writeFile(
  new URL("arena-cards.json", outputDir),
  JSON.stringify({
    source: bulk.download_uri,
    sourceUpdatedAt: bulk.updated_at,
    generatedAt: new Date().toISOString(),
    cardCount: arenaCards.length,
    cards: arenaCards
  }),
  "utf8"
);

await writeFile(
  new URL("arena-keywords.json", outputDir),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    keywordCount: keywords.length,
    keywords
  }, null, 2),
  "utf8"
);

// Merge card metadata into any existing sync metadata.
let metadata = {};
try {
  metadata = JSON.parse(await readFile(new URL("sync-metadata.json", outputDir), "utf8"));
} catch {}
metadata.cards = {
  source: bulk.download_uri,
  sourceUpdatedAt: bulk.updated_at,
  downloadedAt: new Date().toISOString(),
  arenaCardCount: arenaCards.length,
  observedKeywordCount: keywords.length
};
await writeFile(
  new URL("sync-metadata.json", outputDir),
  JSON.stringify(metadata, null, 2),
  "utf8"
);

console.log(`Saved ${arenaCards.length} Arena card records and ${keywords.length} observed keywords.`);
