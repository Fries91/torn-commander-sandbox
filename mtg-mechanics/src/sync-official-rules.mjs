import { mkdir, readFile, writeFile } from "node:fs/promises";

const RULES_TXT_URL =
  process.env.MTG_RULES_TXT_URL ??
  "https://media.wizards.com/2026/downloads/MagicCompRules%2020260619.txt";
const RULES_FILE = process.env.MTG_RULES_FILE;

const outputDir = new URL("../generated/", import.meta.url);
await mkdir(outputDir, { recursive: true });

async function loadRulesText() {
  if (RULES_FILE) {
    return {
      source: RULES_FILE,
      text: await readFile(RULES_FILE, "utf8")
    };
  }

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(RULES_TXT_URL, {
        headers: {
          "User-Agent": "MTG-Commander-Sandbox/0.1 rules-sync"
        }
      });
      if (!response.ok) {
        throw new Error(`Rules download failed: ${response.status} ${response.statusText}`);
      }
      return { source: RULES_TXT_URL, text: await response.text() };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(
    `Unable to download the rules after 3 attempts. Set MTG_RULES_FILE to a local TXT copy. Cause: ${lastError?.message}`
  );
}

const loaded = await loadRulesText();
const raw = loaded.text.replace(/^\uFEFF/, "");

function sectionBetween(startHeading, endHeading) {
  const startMatches = [...raw.matchAll(new RegExp(`^${escapeRegex(startHeading)}$`, "gm"))];
  if (startMatches.length === 0) throw new Error(`Missing section: ${startHeading}`);
  const start = startMatches.at(-1).index;

  const endMatches = [...raw.matchAll(new RegExp(`^${escapeRegex(endHeading)}$`, "gm"))]
    .filter((match) => match.index > start);
  if (endMatches.length === 0) throw new Error(`Missing end section: ${endHeading}`);

  return raw.slice(start, endMatches[0].index);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractNumberedEntries(section, prefix) {
  const headingRegex = new RegExp(`^(${escapeRegex(prefix)}\\.\\d+)\\. ([^\\n]+)$`, "gm");
  const headings = [...section.matchAll(headingRegex)]
    .filter((match) => !match[2].startsWith("Most "));

  return headings.map((match, index) => {
    const start = match.index;
    const end = headings[index + 1]?.index ?? section.length;
    return {
      rule: match[1],
      name: match[2].trim(),
      text: section.slice(start, end).trim()
    };
  });
}

const keywordActions = extractNumberedEntries(
  sectionBetween("701. Keyword Actions", "702. Keyword Abilities"),
  "701"
);
const keywordAbilities = extractNumberedEntries(
  sectionBetween("702. Keyword Abilities", "703. Turn-Based Actions"),
  "702"
);

const effectiveDate =
  raw.match(/These rules are effective as of ([^.]+)\./)?.[1] ?? "unknown";

const result = {
  source: loaded.source,
  effectiveDate,
  generatedAt: new Date().toISOString(),
  keywordActions,
  keywordAbilities
};

await writeFile(
  new URL("official-mechanics-rule-sections.json", outputDir),
  JSON.stringify(result, null, 2),
  "utf8"
);

await writeFile(
  new URL("sync-metadata.json", outputDir),
  JSON.stringify({
    rules: {
      source: loaded.source,
      effectiveDate,
      downloadedAt: new Date().toISOString(),
      keywordActionCount: keywordActions.length,
      keywordAbilityCount: keywordAbilities.length
    }
  }, null, 2),
  "utf8"
);

console.log(`Saved ${keywordActions.length} keyword actions and ${keywordAbilities.length} keyword abilities.`);
