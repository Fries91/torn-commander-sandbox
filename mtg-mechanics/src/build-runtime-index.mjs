import { mkdir, readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const outputDir = new URL("../generated/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const baseIndex = JSON.parse(
  await readFile(new URL("data/mechanics-index.json", root), "utf8")
);
const digital = JSON.parse(
  await readFile(new URL("data/arena-digital-mechanics.json", root), "utf8")
);

let observed = { keywords: [] };
try {
  observed = JSON.parse(await readFile(new URL("arena-keywords.json", outputDir), "utf8"));
} catch {
  console.warn("arena-keywords.json is missing; run npm run sync:cards for observed Arena usage.");
}

const normalized = new Map();
for (const mechanic of baseIndex.mechanics) {
  normalized.set(mechanic.name.toLocaleLowerCase(), mechanic);
}

const mappedObserved = observed.keywords.map((entry) => {
  const match = normalized.get(entry.name.toLocaleLowerCase());
  return {
    ...entry,
    officialRule: match?.official_rule ?? null,
    handlerKey: match?.handler_key ?? entry.name
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, ""),
    indexed: Boolean(match)
  };
});

const result = {
  generatedAt: new Date().toISOString(),
  rulesBaseline: baseIndex.generated_from,
  counts: {
    comprehensiveRulesMechanics: baseIndex.mechanics.length,
    digitalMechanics: digital.mechanics.length,
    observedArenaKeywords: mappedObserved.length,
    observedKeywordsMissingFromRulesIndex: mappedObserved.filter((item) => !item.indexed).length
  },
  comprehensiveRulesMechanics: baseIndex.mechanics,
  digitalMechanics: digital.mechanics,
  observedArenaKeywords: mappedObserved
};

await writeFile(
  new URL("runtime-mechanics-index.json", outputDir),
  JSON.stringify(result, null, 2),
  "utf8"
);
console.log("Built generated/runtime-mechanics-index.json");
