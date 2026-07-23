"use strict";

const crypto = require("crypto");

const DEFAULT_USER_AGENT = process.env.META_USER_AGENT || "ArenaCommanderMeta/38.0 (+https://torn-commander-sandbox.onrender.com)";

function normalizeText(value, max = 300) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function slugify(value) {
  return normalizeText(value, 180)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizePublicUrl(value) {
  const raw = normalizeText(value, 800);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function uniqueBy(values, keyFn) {
  const seen = new Set();
  const output = [];
  for (const value of values || []) {
    const key = keyFn(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function normalizeCardEntry(value) {
  if (typeof value === "string") return { name: normalizeText(value, 180), quantity: 1 };
  if (!value || typeof value !== "object") return null;
  const name = normalizeText(
    value.name ?? value.cardName ?? value.card_name ?? value.card?.oracleCard?.name ?? value.card?.name,
    180
  );
  if (!name) return null;
  const quantity = Math.max(1, Math.min(99, Math.floor(Number(value.quantity ?? value.amount ?? value.qty ?? 1) || 1)));
  return { name, quantity };
}

function normalizeCandidate(value, defaults = {}) {
  if (!value || typeof value !== "object") return null;
  const cards = (value.cards || value.deck || value.mainboard || [])
    .map(normalizeCardEntry)
    .filter(Boolean);
  const commanders = (value.commanders || value.commanderNames || value.commander_names || [])
    .map((entry) => normalizeText(typeof entry === "string" ? entry : entry?.name, 180))
    .filter(Boolean)
    .slice(0, 6);
  const externalId = normalizeText(value.externalId ?? value.external_id ?? value.id ?? value.deckId, 180)
    || slugify(`${defaults.source || value.source || "meta"}-${value.title || value.name || commanders.join("-")}`);
  const title = normalizeText((value.title ?? value.name ?? commanders.join(" / ")) || "Meta Deck", 200);
  if (!title || !externalId) return null;
  return {
    source: normalizeText(value.source ?? defaults.source ?? "manual", 60).toLowerCase(),
    sourceLabel: normalizeText(value.sourceLabel ?? defaults.sourceLabel ?? value.source ?? "Curated", 100),
    externalId,
    title,
    commanders,
    cards,
    category: normalizeText(value.category ?? defaults.category ?? "trending", 40).toLowerCase(),
    format: normalizeText(value.format ?? defaults.format ?? "commander", 40).toLowerCase(),
    archetype: normalizeText(value.archetype ?? value.theme ?? "", 100),
    powerTier: normalizeText(value.powerTier ?? value.power_tier ?? defaults.powerTier ?? "high-power", 40),
    sourceUrl: normalizePublicUrl(value.sourceUrl ?? value.source_url ?? value.url ?? ""),
    authorName: normalizeText(value.authorName ?? value.author ?? value.owner ?? "", 120),
    sourceUpdatedAt: value.sourceUpdatedAt ?? value.updatedAt ?? value.updated_at ?? null,
    popularityScore: Math.max(0, Number(value.popularityScore ?? value.popularity ?? value.deckCount ?? 0) || 0),
    featured: Boolean(value.featured ?? defaults.featured),
    notes: normalizeText(value.notes ?? "", 1000),
    raw: value.raw && typeof value.raw === "object" ? value.raw : null
  };
}

function canonicalDeckHash(candidate) {
  const payload = {
    commanders: [...(candidate.commanders || [])].map((name) => name.toLowerCase()).sort(),
    cards: (candidate.cards || [])
      .map((entry) => [entry.name.toLowerCase(), Number(entry.quantity || 1)])
      .sort((a, b) => a[0].localeCompare(b[0]))
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function fetchWithTimeout(url, options = {}) {
  const timeoutMs = Math.max(1000, Math.min(120000, Number(options.timeoutMs || 30000)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: options.accept || "application/json,text/html;q=0.9,*/*;q=0.8",
        ...(options.headers || {})
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} from ${url}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetchWithTimeout(url, { ...options, accept: "application/json" });
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, { ...options, accept: "text/html,text/plain;q=0.9,*/*;q=0.8" });
  return response.text();
}

function splitEnvList(name) {
  return String(process.env[name] || "")
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDeckText(text) {
  const cards = [];
  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = line.match(/^(\d+)\s*[xX]?\s+(.+?)(?:\s+\([A-Z0-9]+\)\s+\d+)?$/);
    if (match) cards.push({ name: normalizeText(match[2], 180), quantity: Math.max(1, Number(match[1]) || 1) });
    else cards.push({ name: normalizeText(line, 180), quantity: 1 });
  }
  return cards.filter((entry) => entry.name);
}

module.exports = {
  DEFAULT_USER_AGENT,
  normalizeText,
  normalizePublicUrl,
  slugify,
  uniqueBy,
  normalizeCardEntry,
  normalizeCandidate,
  canonicalDeckHash,
  fetchWithTimeout,
  fetchJson,
  fetchText,
  splitEnvList,
  parseDeckText
};
