"use strict";

const { fetchJson, fetchText, normalizeCandidate, normalizeText, slugify, splitEnvList, uniqueBy } = require("./common");

function walk(value, visit, depth = 0) {
  if (depth > 20 || value == null) return;
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, visit, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  visit(value);
  for (const entry of Object.values(value)) walk(entry, visit, depth + 1);
}

function extractNextData(html) {
  const match = String(html || "").match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function extractCommanderRankingFromJson(value, limit = 20) {
  const found = [];
  walk(value, (object) => {
    const href = normalizeText(object.href ?? object.url ?? object.path, 500);
    const name = normalizeText(object.name ?? object.cardName ?? object.card_name ?? object.label, 180);
    const slug = href.match(/\/commanders\/([^/?#]+)/i)?.[1] || normalizeText(object.slug, 180);
    if (!name || !slug || /\/commanders\/(week|month|year|all)$/i.test(href)) return;
    const rank = Number(object.rank ?? object.position ?? object.order ?? 0) || 0;
    const decks = Number(object.num_decks ?? object.deckCount ?? object.count ?? object.decks ?? 0) || 0;
    found.push({ name, slug, rank, decks });
  });
  return uniqueBy(found, (entry) => entry.slug)
    .sort((a, b) => (a.rank || 9999) - (b.rank || 9999) || b.decks - a.decks)
    .slice(0, limit);
}

function extractCommanderRankingFromHtml(html, limit = 20) {
  const output = [];
  const regex = /<a[^>]+href=["']\/commanders\/([^"'/?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(String(html || "")))) {
    const text = match[2].replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
    if (!text || ["week", "month", "year", "commanders"].includes(match[1].toLowerCase())) continue;
    output.push({ name: text, slug: match[1], rank: output.length + 1, decks: 0 });
    if (output.length >= limit) break;
  }
  return uniqueBy(output, (entry) => entry.slug).slice(0, limit);
}

function cardMetric(object) {
  return Number(object.num_decks ?? object.deckCount ?? object.inclusion ?? object.inclusion_rate ?? object.synergy ?? object.score ?? 0) || 0;
}

function extractAverageCards(json, commanderNames) {
  const commanders = new Set((commanderNames || []).map((name) => name.toLowerCase()));
  const found = [];
  walk(json, (object) => {
    const name = normalizeText(object.name ?? object.cardName ?? object.card_name, 180);
    if (!name || commanders.has(name.toLowerCase())) return;
    const url = normalizeText(object.url ?? object.href, 500);
    const appearsCardLike = Boolean(
      object.num_decks != null || object.inclusion != null || object.synergy != null ||
      object.cardName != null || object.card_name != null || /\/cards\//i.test(url)
    );
    if (!appearsCardLike) return;
    found.push({ name, quantity: 1, metric: cardMetric(object) });
  });
  return uniqueBy(found.sort((a, b) => b.metric - a.metric), (entry) => entry.name.toLowerCase())
    .map(({ name, quantity }) => ({ name, quantity }));
}

async function fetchCommanderAverage(entry) {
  const slug = entry.slug || slugify(entry.name);
  const urls = [
    `https://json.edhrec.com/pages/commanders/${slug}.json`,
    `https://json.edhrec.com/pages/commanders/${slug}/average-deck.json`
  ];
  let json = null;
  let lastError = null;
  for (const url of urls) {
    try { json = await fetchJson(url, { timeoutMs: 45000 }); break; }
    catch (error) { lastError = error; }
  }
  if (!json) throw lastError || new Error(`EDHREC data unavailable for ${entry.name}`);
  const cards = extractAverageCards(json, [entry.name]).slice(0, 140);
  return normalizeCandidate({
    source: "edhrec",
    sourceLabel: "EDHREC Weekly",
    externalId: `edhrec-${slug}`,
    title: `${entry.name} — Weekly Meta Average`,
    commanders: [entry.name],
    cards,
    category: "trending",
    format: "commander",
    powerTier: "high-power",
    sourceUrl: `https://edhrec.com/commanders/${slug}`,
    popularityScore: Math.max(entry.decks || 0, 1000 - (entry.rank || 999)),
    sourceUpdatedAt: new Date().toISOString(),
    notes: `Generated from EDHREC weekly popularity and average-card data. Rank ${entry.rank || "—"}.`
  });
}

async function discoverEdhrecDecks() {
  if (String(process.env.META_EDHREC_ENABLED || "true").toLowerCase() === "false") return [];
  const limit = Math.max(1, Math.min(50, Number(process.env.META_EDHREC_LIMIT || 12)));
  const explicit = splitEnvList("META_EDHREC_COMMANDERS").map((name, index) => ({ name, slug: slugify(name), rank: index + 1, decks: 0 }));
  let ranking = explicit;
  if (!ranking.length) {
    const html = await fetchText("https://edhrec.com/commanders/week", { timeoutMs: 45000 });
    const nextData = extractNextData(html);
    ranking = nextData ? extractCommanderRankingFromJson(nextData, limit) : [];
    if (!ranking.length) ranking = extractCommanderRankingFromHtml(html, limit);
  }
  const output = [];
  for (const entry of ranking.slice(0, limit)) {
    try {
      const deck = await fetchCommanderAverage(entry);
      if (deck?.cards?.length) output.push(deck);
    } catch (error) {
      console.warn(`EDHREC ${entry.name} skipped: ${error.message}`);
    }
  }
  return output;
}

module.exports = {
  discoverEdhrecDecks,
  extractNextData,
  extractCommanderRankingFromJson,
  extractCommanderRankingFromHtml,
  extractAverageCards
};
