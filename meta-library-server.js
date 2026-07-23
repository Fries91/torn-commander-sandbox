"use strict";

const crypto = require("crypto");
const { createPool, initializeMetaDatabase, syncMetaDecks, syncCandidates } = require("./meta-sync");
const { fetchArchidektDeck, archidektDeckId } = require("./meta-sources/archidekt");
const { fetchMoxfieldDeck, moxfieldDeckId } = require("./meta-sources/moxfield");
const { normalizeCandidate, normalizeText, parseDeckText } = require("./meta-sources/common");

let pool = null;
let readyPromise = null;
let syncPromise = null;

function ensurePool() {
  if (!pool) pool = createPool();
  if (!readyPromise) readyPromise = initializeMetaDatabase(pool).catch((error) => {
    readyPromise = null;
    throw error;
  });
  return readyPromise.then(() => pool);
}

function adminAuthorized(request) {
  const expected = String(process.env.META_ADMIN_TOKEN || "").trim();
  if (!expected) return false;
  const bearer = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  const supplied = bearer || String(request.headers["x-meta-admin-token"] || request.body?.adminToken || "").trim();
  if (!supplied || supplied.length !== expected.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected)); }
  catch { return false; }
}

function requireAdmin(request, response, next) {
  if (!process.env.META_ADMIN_TOKEN) {
    return response.status(503).json({ success: false, error: "META_ADMIN_TOKEN is not configured on the server." });
  }
  if (!adminAuthorized(request)) return response.status(401).json({ success: false, error: "Admin token required." });
  return next();
}

function cleanQuery(value, max = 100) {
  return normalizeText(value, max);
}

function rowToSummary(row) {
  return {
    id: row.id,
    title: row.title,
    commanders: row.commander_names || [],
    colors: row.colors || [],
    category: row.category,
    format: row.format,
    archetype: row.archetype,
    powerTier: row.power_tier,
    source: row.source,
    sourceLabel: row.source_label,
    sourceUrl: row.source_url,
    authorName: row.author_name,
    status: row.status,
    featured: row.featured,
    popularityScore: Number(row.popularity_score || 0),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    versionId: row.current_version_id,
    importedAt: row.imported_at,
    legalityStatus: row.legality_status,
    aiSupportScore: Number(row.ai_support_score || 0),
    aiProfile: row.ai_profile_json || {},
    commanderImage: row.deck_json?.commanderData?.[0]?.artCropUrl || row.deck_json?.commanderData?.[0]?.imageUrl || ""
  };
}

async function listDecks(request, response) {
  try {
    const db = await ensurePool();
    const category = cleanQuery(request.query.category, 40);
    const source = cleanQuery(request.query.source, 80);
    const archetype = cleanQuery(request.query.archetype, 100);
    const color = cleanQuery(request.query.color, 4).toUpperCase();
    const search = cleanQuery(request.query.search, 160);
    const status = request.query.includeHidden === "1" && adminAuthorized(request) ? "" : "active";
    const limit = Math.max(1, Math.min(100, Number(request.query.limit || 36)));
    const offset = Math.max(0, Number(request.query.offset || 0));
    const values = [];
    const where = [];
    const add = (sql, value) => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
    if (status) add("d.status = ?", status);
    if (category) add("d.category = ?", category);
    if (source) add("d.source = ?", source);
    if (archetype) add("LOWER(d.archetype) = LOWER(?)", archetype);
    if (color) add("? = ANY(d.colors)", color);
    if (search) {
      values.push(`%${search}%`);
      where.push(`(d.title ILIKE $${values.length} OR d.commander_names::text ILIKE $${values.length} OR d.archetype ILIKE $${values.length})`);
    }
    values.push(limit, offset);
    const result = await db.query(`
      SELECT d.*, v.imported_at, v.legality_status, v.ai_support_score, v.ai_profile_json, v.deck_json
      FROM meta_decks d
      LEFT JOIN meta_deck_versions v ON v.id = d.current_version_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY d.featured DESC, d.popularity_score DESC, d.last_seen_at DESC, d.title ASC
      LIMIT $${values.length - 1} OFFSET $${values.length}
    `, values);
    const countValues = values.slice(0, -2);
    const count = await db.query(`SELECT COUNT(*)::int AS count FROM meta_decks d ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`, countValues);
    const filters = await db.query(`
      SELECT
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT category), NULL) AS categories,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT source), NULL) AS sources,
        ARRAY_REMOVE(ARRAY_AGG(DISTINCT archetype), NULL) AS archetypes
      FROM meta_decks WHERE status = 'active'
    `);
    return response.json({
      success: true,
      decks: result.rows.map(rowToSummary),
      total: count.rows[0]?.count || 0,
      filters: filters.rows[0] || { categories: [], sources: [], archetypes: [] },
      limit,
      offset
    });
  } catch (error) {
    console.error("Meta list failed:", error);
    return response.status(503).json({ success: false, error: "The Meta Deck Library is temporarily unavailable." });
  }
}

async function getDeck(request, response) {
  try {
    const db = await ensurePool();
    const result = await db.query(`
      SELECT d.*, v.id AS version_id, v.deck_json, v.ai_profile_json, v.legality_status,
        v.ai_support_score, v.imported_at, v.source_updated_at
      FROM meta_decks d
      JOIN meta_deck_versions v ON v.id = d.current_version_id
      WHERE d.id = $1 AND (d.status = 'active' OR $2::boolean)
    `, [request.params.id, adminAuthorized(request)]);
    if (!result.rows.length) return response.status(404).json({ success: false, error: "Meta deck not found." });
    const row = result.rows[0];
    return response.json({
      success: true,
      deck: rowToSummary(row),
      playableDeck: row.deck_json,
      aiProfile: row.ai_profile_json || {},
      versionId: row.version_id,
      legalityStatus: row.legality_status,
      aiSupportScore: Number(row.ai_support_score || 0),
      importedAt: row.imported_at,
      sourceUpdatedAt: row.source_updated_at
    });
  } catch (error) {
    return response.status(503).json({ success: false, error: "Unable to load that meta deck." });
  }
}

async function getVersions(request, response) {
  try {
    const db = await ensurePool();
    const result = await db.query(`
      SELECT id, deck_hash, legality_status, ai_support_score, source_updated_at, imported_at
      FROM meta_deck_versions WHERE meta_deck_id = $1 ORDER BY imported_at DESC LIMIT 30
    `, [request.params.id]);
    return response.json({ success: true, versions: result.rows.map((row) => ({
      id: row.id,
      deckHash: row.deck_hash,
      legalityStatus: row.legality_status,
      aiSupportScore: Number(row.ai_support_score || 0),
      sourceUpdatedAt: row.source_updated_at,
      importedAt: row.imported_at
    })) });
  } catch {
    return response.status(503).json({ success: false, error: "Version history is unavailable." });
  }
}

async function getStatus(request, response) {
  try {
    const db = await ensurePool();
    const stats = await db.query(`
      SELECT COUNT(*) FILTER (WHERE status = 'active')::int AS active,
        COUNT(*) FILTER (WHERE featured)::int AS featured,
        MAX(last_seen_at) AS newest
      FROM meta_decks
    `);
    const run = await db.query(`SELECT * FROM meta_sync_runs ORDER BY started_at DESC LIMIT 1`);
    return response.json({ success: true, version: "39.0.0", library: stats.rows[0], lastSync: run.rows[0] || null });
  } catch (error) {
    return response.status(503).json({ success: false, version: "39.0.0", error: error.message });
  }
}

async function runSync(request, response) {
  if (syncPromise) return response.status(409).json({ success: false, error: "A meta sync is already running." });
  try {
    const db = await ensurePool();
    syncPromise = syncMetaDecks({ pool: db }).finally(() => { syncPromise = null; });
    const result = await syncPromise;
    return response.json({ success: true, result });
  } catch (error) {
    return response.status(500).json({ success: false, error: error.message });
  }
}

async function importDeck(request, response) {
  try {
    const db = await ensurePool();
    const url = normalizeText(request.body?.url, 800);
    let candidate;
    if (archidektDeckId(url) || moxfieldDeckId(url)) {
      const loader = archidektDeckId(url) ? fetchArchidektDeck : fetchMoxfieldDeck;
      candidate = await loader(url, {
        source: "admin",
        sourceLabel: request.body?.sourceLabel || "Admin Curated",
        category: request.body?.category || "curated",
        powerTier: request.body?.powerTier || "high-power",
        featured: Boolean(request.body?.featured)
      });
    } else {
      candidate = normalizeCandidate({
        source: "admin",
        sourceLabel: request.body?.sourceLabel || "Admin Curated",
        externalId: request.body?.externalId || crypto.randomUUID(),
        title: request.body?.title,
        commanders: String(request.body?.commanders || "").split(/[\n,+/]/).map((entry) => entry.trim()).filter(Boolean),
        cards: parseDeckText(request.body?.deckList),
        category: request.body?.category || "curated",
        powerTier: request.body?.powerTier || "high-power",
        sourceUrl: url,
        authorName: request.body?.authorName || "",
        featured: Boolean(request.body?.featured)
      });
    }
    if (!candidate) return response.status(400).json({ success: false, error: "Provide a public Archidekt URL or a complete deck list." });
    const result = await syncCandidates({ pool: db, candidates: [candidate], source: "admin" });
    return response.json({ success: true, result });
  } catch (error) {
    return response.status(400).json({ success: false, error: error.message });
  }
}

async function updateDeck(request, response) {
  try {
    const db = await ensurePool();
    const fields = [];
    const values = [];
    const allowed = {
      status: ["active", "hidden", "retired"],
      category: null,
      archetype: null,
      powerTier: null,
      featured: null,
      title: null
    };
    const column = { powerTier: "power_tier" };
    for (const [key, accepted] of Object.entries(allowed)) {
      if (!(key in (request.body || {}))) continue;
      let value = request.body[key];
      if (accepted && !accepted.includes(value)) continue;
      if (key === "featured") value = Boolean(value);
      else value = normalizeText(value, key === "title" ? 240 : 120);
      values.push(value);
      fields.push(`${column[key] || key} = $${values.length}`);
    }
    if (!fields.length) return response.status(400).json({ success: false, error: "No valid changes supplied." });
    values.push(request.params.id);
    const result = await db.query(`UPDATE meta_decks SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
    if (!result.rows.length) return response.status(404).json({ success: false, error: "Meta deck not found." });
    return response.json({ success: true, deck: result.rows[0] });
  } catch (error) {
    return response.status(400).json({ success: false, error: error.message });
  }
}

async function recordResult(request, response) {
  try {
    const db = await ensurePool();
    const resultValue = ["win", "loss", "draw"].includes(request.body?.result) ? request.body.result : "loss";
    await db.query(`
      INSERT INTO meta_game_results (id, meta_deck_id, meta_version_id, result, turns, bot_difficulty)
      VALUES ($1,$2,$3,$4,$5,$6)
    `, [crypto.randomUUID(), request.body?.metaDeckId || null, request.body?.versionId || null, resultValue, Math.max(0, Number(request.body?.turns || 0)) || null, normalizeText(request.body?.difficulty, 30)]);
    return response.json({ success: true });
  } catch {
    return response.status(400).json({ success: false, error: "Result could not be recorded." });
  }
}

function installMetaLibrary({ app }) {
  if (!app || app.locals.metaLibraryInstalled) return;
  app.locals.metaLibraryInstalled = true;
  app.get("/api/meta/status", getStatus);
  app.get("/api/meta/decks", listDecks);
  app.get("/api/meta/decks/:id", getDeck);
  app.get("/api/meta/decks/:id/versions", getVersions);
  app.post("/api/meta/results", recordResult);
  app.post("/api/meta/admin/sync", requireAdmin, runSync);
  app.post("/api/meta/admin/import", requireAdmin, importDeck);
  app.patch("/api/meta/admin/decks/:id", requireAdmin, updateDeck);
  ensurePool().then(() => console.log("Meta Deck Library v39 ready.")).catch((error) => console.error("Meta Deck Library database failed:", error));
}

module.exports = { installMetaLibrary, adminAuthorized, ensurePool };
