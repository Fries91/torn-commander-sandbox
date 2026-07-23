"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");
const { analyzeDeckProfile } = require("./ai-engine");
const { discoverCatalogDecks } = require("./meta-sources/catalog");
const { discoverEdhrecDecks } = require("./meta-sources/edhrec");
const { discoverCedhDdbDecks } = require("./meta-sources/cedh-ddb");
const {
  DEFAULT_USER_AGENT,
  canonicalDeckHash,
  normalizeCandidate,
  normalizeText,
  uniqueBy
} = require("./meta-sources/common");

const SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
const SCRYFALL_BATCH_SIZE = 75;
const BASIC_LANDS = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest"
};

function createPool(connectionString = process.env.DATABASE_URL) {
  const value = String(connectionString || "").trim();
  if (!value) throw new Error("DATABASE_URL is required for the Meta Deck Library.");
  return new Pool({
    connectionString: value,
    max: Math.max(1, Math.min(5, Number(process.env.META_DB_POOL_SIZE || 3))),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
  });
}

async function initializeMetaDatabase(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_decks (
      id TEXT PRIMARY KEY,
      source VARCHAR(80) NOT NULL,
      source_label VARCHAR(120) NOT NULL,
      external_id VARCHAR(220) NOT NULL,
      title VARCHAR(240) NOT NULL,
      commander_names JSONB NOT NULL DEFAULT '[]'::jsonb,
      colors TEXT[] NOT NULL DEFAULT '{}',
      category VARCHAR(60) NOT NULL DEFAULT 'trending',
      format VARCHAR(40) NOT NULL DEFAULT 'commander',
      archetype VARCHAR(120) NOT NULL DEFAULT '',
      power_tier VARCHAR(60) NOT NULL DEFAULT 'high-power',
      source_url TEXT NOT NULL DEFAULT '',
      author_name VARCHAR(160) NOT NULL DEFAULT '',
      status VARCHAR(40) NOT NULL DEFAULT 'active',
      featured BOOLEAN NOT NULL DEFAULT FALSE,
      popularity_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      current_version_id TEXT,
      UNIQUE(source, external_id)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_deck_versions (
      id TEXT PRIMARY KEY,
      meta_deck_id TEXT NOT NULL REFERENCES meta_decks(id) ON DELETE CASCADE,
      deck_hash VARCHAR(64) NOT NULL,
      deck_json JSONB NOT NULL,
      ai_profile_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      legality_status VARCHAR(40) NOT NULL DEFAULT 'legal',
      ai_support_score INTEGER NOT NULL DEFAULT 0,
      source_updated_at TIMESTAMPTZ,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(meta_deck_id, deck_hash)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_sync_runs (
      id TEXT PRIMARY KEY,
      source VARCHAR(80) NOT NULL DEFAULT 'all',
      status VARCHAR(40) NOT NULL DEFAULT 'running',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      decks_found INTEGER NOT NULL DEFAULT 0,
      decks_added INTEGER NOT NULL DEFAULT 0,
      decks_updated INTEGER NOT NULL DEFAULT 0,
      decks_unchanged INTEGER NOT NULL DEFAULT 0,
      decks_failed INTEGER NOT NULL DEFAULT 0,
      error_log JSONB NOT NULL DEFAULT '[]'::jsonb
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meta_game_results (
      id TEXT PRIMARY KEY,
      meta_deck_id TEXT REFERENCES meta_decks(id) ON DELETE SET NULL,
      meta_version_id TEXT REFERENCES meta_deck_versions(id) ON DELETE SET NULL,
      result VARCHAR(30) NOT NULL,
      turns INTEGER,
      bot_difficulty VARCHAR(30),
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS meta_decks_category_idx ON meta_decks(category, status, featured);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS meta_decks_last_seen_idx ON meta_decks(last_seen_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS meta_versions_deck_idx ON meta_deck_versions(meta_deck_id, imported_at DESC);`);
}

function cardKey(name) {
  return normalizeText(name, 180).toLocaleLowerCase("en-US");
}

function scryfallCardData(card) {
  if (!card || typeof card !== "object") return null;
  const faces = (card.card_faces || []).map((face) => ({
    name: face.name || "",
    manaCost: face.mana_cost || "",
    typeLine: face.type_line || "",
    oracleText: face.oracle_text || "",
    power: face.power || "",
    toughness: face.toughness || "",
    loyalty: face.loyalty || "",
    imageUrl: face.image_uris?.normal || face.image_uris?.large || "",
    artCropUrl: face.image_uris?.art_crop || ""
  }));
  return {
    scryfallId: card.id || "",
    oracleId: card.oracle_id || "",
    name: card.name || "",
    manaCost: card.mana_cost || "",
    manaValue: Number(card.cmc || 0),
    typeLine: card.type_line || "",
    oracleText: card.oracle_text || "",
    keywords: card.keywords || [],
    colors: card.colors || [],
    colorIdentity: card.color_identity || [],
    power: card.power || "",
    toughness: card.toughness || "",
    loyalty: card.loyalty || "",
    layout: card.layout || "",
    imageUrl: card.image_uris?.normal || card.image_uris?.large || faces[0]?.imageUrl || "",
    artCropUrl: card.image_uris?.art_crop || faces[0]?.artCropUrl || "",
    setCode: card.set || "",
    collectorNumber: card.collector_number || "",
    rarity: card.rarity || "",
    legalities: card.legalities || {},
    games: card.games || [],
    faces
  };
}

async function resolveScryfallCards(names) {
  const uniqueNames = uniqueBy(names.map((name) => normalizeText(name, 180)).filter(Boolean), (name) => name.toLowerCase());
  const resolved = new Map();
  for (let index = 0; index < uniqueNames.length; index += SCRYFALL_BATCH_SIZE) {
    const batch = uniqueNames.slice(index, index + SCRYFALL_BATCH_SIZE);
    const response = await fetch(SCRYFALL_COLLECTION_URL, {
      method: "POST",
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ identifiers: batch.map((name) => ({ name })) })
    });
    if (!response.ok) throw new Error(`Scryfall card collection failed with ${response.status}.`);
    const payload = await response.json();
    for (const card of payload.data || []) {
      const data = scryfallCardData(card);
      if (!data) continue;
      resolved.set(cardKey(data.name), data);
      for (const face of data.faces || []) resolved.set(cardKey(face.name), data);
    }
    if (index + SCRYFALL_BATCH_SIZE < uniqueNames.length) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  return resolved;
}

function expandCardEntries(entries) {
  const output = [];
  for (const entry of entries || []) {
    const quantity = Math.max(1, Math.min(99, Number(entry.quantity || 1)));
    for (let index = 0; index < quantity; index += 1) output.push(normalizeText(entry.name, 180));
  }
  return output.filter(Boolean);
}

function determineBasics(commanderData) {
  const identity = new Set((commanderData || []).flatMap((card) => card?.colorIdentity || []));
  const basics = [...identity].map((color) => BASIC_LANDS[color]).filter(Boolean);
  return basics.length ? basics : ["Wastes"];
}

function completeToOneHundred(candidate, lookup) {
  const commanderNames = uniqueBy(candidate.commanders || [], (name) => cardKey(name)).slice(0, 2);
  let expanded = expandCardEntries(candidate.cards);
  for (const commander of commanderNames) {
    if (!expanded.some((name) => cardKey(name) === cardKey(commander))) expanded.unshift(commander);
  }
  const commanderData = commanderNames.map((name) => lookup.get(cardKey(name))).filter(Boolean);
  const basics = determineBasics(commanderData);
  let basicIndex = 0;
  while (expanded.length < 100) {
    expanded.push(basics[basicIndex % basics.length]);
    basicIndex += 1;
  }
  if (expanded.length > 100) {
    const commanderKeys = new Set(commanderNames.map(cardKey));
    const keptCommanders = expanded.filter((name) => commanderKeys.has(cardKey(name)));
    const others = expanded.filter((name) => !commanderKeys.has(cardKey(name))).slice(0, Math.max(0, 100 - keptCommanders.length));
    expanded = [...keptCommanders, ...others];
  }
  const quantityMap = new Map();
  for (const name of expanded) quantityMap.set(name, (quantityMap.get(name) || 0) + 1);
  return [...quantityMap.entries()].map(([name, quantity]) => ({ name, quantity }));
}

function deckLegality(candidate, cardEntries, lookup) {
  const total = cardEntries.reduce((sum, entry) => sum + entry.quantity, 0);
  const commanders = candidate.commanders || [];
  const missing = cardEntries.filter((entry) => !lookup.get(cardKey(entry.name))).map((entry) => entry.name);
  const illegal = cardEntries.filter((entry) => {
    const data = lookup.get(cardKey(entry.name));
    const status = data?.legalities?.commander;
    return status && !["legal", "restricted"].includes(status);
  }).map((entry) => entry.name);
  if (!commanders.length || total !== 100) return { status: "invalid", missing, illegal };
  if (illegal.length) return { status: "illegal", missing, illegal };
  if (missing.length) return { status: "assisted", missing, illegal };
  return { status: "legal", missing, illegal };
}

function buildPlayableDeck(candidate, lookup) {
  const entries = completeToOneHundred(candidate, lookup);
  const cards = entries.map((entry) => ({
    name: lookup.get(cardKey(entry.name))?.name || entry.name,
    quantity: entry.quantity,
    cardData: lookup.get(cardKey(entry.name)) || null
  }));
  const commanders = candidate.commanders.map((name) => lookup.get(cardKey(name))?.name || name);
  const commanderData = commanders.map((name) => lookup.get(cardKey(name))).filter(Boolean);
  const intelligenceCount = cards.filter((entry) => entry.cardData?.scryfallId).length;
  const deck = {
    id: `meta-${candidate.source}-${candidate.externalId}`.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 180),
    name: candidate.title,
    commanders,
    commanderData,
    cards,
    totalCards: cards.reduce((sum, entry) => sum + entry.quantity, 0),
    uniqueCards: cards.length,
    intelligenceCount,
    cardDataUpdatedAt: new Date().toISOString(),
    meta: {
      source: candidate.source,
      sourceLabel: candidate.sourceLabel,
      category: candidate.category,
      sourceUrl: candidate.sourceUrl,
      authorName: candidate.authorName,
      externalId: candidate.externalId
    }
  };
  return deck;
}

function aiSupportScore(deck, profile, legality) {
  const recognition = deck.uniqueCards ? Math.round((deck.intelligenceCount / deck.uniqueCards) * 70) : 0;
  const strategy = profile?.archetype ? 15 : 0;
  const commander = deck.commanderData?.length === deck.commanders?.length ? 10 : 0;
  const legal = legality.status === "legal" ? 5 : legality.status === "assisted" ? 2 : 0;
  return Math.max(0, Math.min(100, recognition + strategy + commander + legal));
}

async function upsertCandidate(pool, rawCandidate) {
  const candidate = normalizeCandidate(rawCandidate);
  if (!candidate || !candidate.commanders.length || !candidate.cards.length) throw new Error("Deck candidate is incomplete.");
  const names = [...candidate.commanders, ...candidate.cards.map((entry) => entry.name), ...Object.values(BASIC_LANDS), "Wastes"];
  const lookup = await resolveScryfallCards(names);
  const deck = buildPlayableDeck(candidate, lookup);
  const legality = deckLegality(candidate, deck.cards, lookup);
  const profile = analyzeDeckProfile(deck);
  const support = aiSupportScore(deck, profile, legality);
  const colors = uniqueBy(deck.commanderData.flatMap((card) => card?.colorIdentity || []), (color) => color);
  const finalCandidate = { ...candidate, cards: deck.cards.map(({ name, quantity }) => ({ name, quantity })) };
  const deckHash = canonicalDeckHash(finalCandidate);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id, current_version_id FROM meta_decks WHERE source = $1 AND external_id = $2 FOR UPDATE`,
      [candidate.source, candidate.externalId]
    );
    const deckId = existing.rows[0]?.id || crypto.randomUUID();
    const oldVersionId = existing.rows[0]?.current_version_id || null;
    await client.query(`
      INSERT INTO meta_decks (
        id, source, source_label, external_id, title, commander_names, colors, category, format,
        archetype, power_tier, source_url, author_name, status, featured, popularity_score, last_seen_at
      ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,'active',$14,$15,NOW())
      ON CONFLICT (source, external_id) DO UPDATE SET
        source_label = EXCLUDED.source_label,
        title = EXCLUDED.title,
        commander_names = EXCLUDED.commander_names,
        colors = EXCLUDED.colors,
        category = EXCLUDED.category,
        format = EXCLUDED.format,
        archetype = EXCLUDED.archetype,
        power_tier = EXCLUDED.power_tier,
        source_url = EXCLUDED.source_url,
        author_name = EXCLUDED.author_name,
        status = CASE WHEN meta_decks.status = 'hidden' THEN 'hidden' ELSE 'active' END,
        featured = meta_decks.featured OR EXCLUDED.featured,
        popularity_score = EXCLUDED.popularity_score,
        last_seen_at = NOW()
    `, [
      deckId, candidate.source, candidate.sourceLabel, candidate.externalId, candidate.title,
      JSON.stringify(deck.commanders), colors, candidate.category, candidate.format,
      candidate.archetype || profile.archetype || "midrange", candidate.powerTier,
      candidate.sourceUrl, candidate.authorName, candidate.featured, candidate.popularityScore
    ]);
    const current = oldVersionId
      ? await client.query(`SELECT deck_hash FROM meta_deck_versions WHERE id = $1`, [oldVersionId])
      : { rows: [] };
    if (current.rows[0]?.deck_hash === deckHash) {
      await client.query("COMMIT");
      return { status: "unchanged", deckId, versionId: oldVersionId, title: candidate.title };
    }
    const versionId = crypto.randomUUID();
    await client.query(`
      INSERT INTO meta_deck_versions (
        id, meta_deck_id, deck_hash, deck_json, ai_profile_json, legality_status,
        ai_support_score, source_updated_at
      ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8)
    `, [
      versionId, deckId, deckHash, JSON.stringify(deck), JSON.stringify(profile), legality.status,
      support, candidate.sourceUpdatedAt ? new Date(candidate.sourceUpdatedAt) : null
    ]);
    await client.query(`UPDATE meta_decks SET current_version_id = $1 WHERE id = $2`, [versionId, deckId]);
    await client.query("COMMIT");
    return { status: oldVersionId ? "updated" : "added", deckId, versionId, title: candidate.title };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function discoverAllCandidates() {
  const groups = await Promise.allSettled([
    discoverCatalogDecks(),
    discoverEdhrecDecks(),
    discoverCedhDdbDecks()
  ]);
  const candidates = [];
  const errors = [];
  for (const group of groups) {
    if (group.status === "fulfilled") candidates.push(...group.value);
    else errors.push(group.reason?.message || String(group.reason));
  }
  return {
    candidates: uniqueBy(candidates.filter(Boolean), (deck) => `${deck.source}:${deck.externalId}`),
    errors
  };
}

async function syncCandidates({ pool, candidates, source = "all", discoveryErrors = [] }) {
  await initializeMetaDatabase(pool);
  const runId = crypto.randomUUID();
  await pool.query(`INSERT INTO meta_sync_runs (id, source, decks_found, error_log) VALUES ($1,$2,$3,$4::jsonb)`, [
    runId, source, candidates.length, JSON.stringify(discoveryErrors)
  ]);
  const counts = { added: 0, updated: 0, unchanged: 0, failed: 0 };
  const errors = [...discoveryErrors];
  for (const candidate of candidates) {
    try {
      const result = await upsertCandidate(pool, candidate);
      counts[result.status] += 1;
      console.log(`[meta] ${result.status}: ${result.title}`);
    } catch (error) {
      counts.failed += 1;
      errors.push(`${candidate?.title || candidate?.externalId || "Unknown deck"}: ${error.message}`);
      console.warn(`[meta] failed: ${errors.at(-1)}`);
    }
  }
  await pool.query(`
    UPDATE meta_sync_runs SET status = $2, finished_at = NOW(), decks_added = $3, decks_updated = $4,
      decks_unchanged = $5, decks_failed = $6, error_log = $7::jsonb WHERE id = $1
  `, [runId, counts.failed && !counts.added && !counts.updated && !counts.unchanged ? "failed" : "completed", counts.added, counts.updated, counts.unchanged, counts.failed, JSON.stringify(errors.slice(-100))]);
  return { runId, found: candidates.length, ...counts, errors };
}

async function syncMetaDecks(options = {}) {
  const ownedPool = !options.pool;
  const pool = options.pool || createPool(options.databaseUrl);
  try {
    await initializeMetaDatabase(pool);
    const discovery = options.candidates
      ? { candidates: options.candidates, errors: [] }
      : await discoverAllCandidates();
    return await syncCandidates({
      pool,
      candidates: discovery.candidates,
      source: options.source || "all",
      discoveryErrors: discovery.errors
    });
  } finally {
    if (ownedPool) await pool.end();
  }
}

module.exports = {
  createPool,
  initializeMetaDatabase,
  resolveScryfallCards,
  completeToOneHundred,
  buildPlayableDeck,
  deckLegality,
  aiSupportScore,
  upsertCandidate,
  discoverAllCandidates,
  syncCandidates,
  syncMetaDecks
};
