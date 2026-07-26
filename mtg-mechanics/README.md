# MTG Arena Mechanics Starter

This package gives your Commander sandbox a safe, maintainable starting point for Magic rules support.

## What is included

- A complete index of the keyword actions and keyword abilities in the official Comprehensive Rules dated June 19, 2026.
- Original engine-oriented summaries of Arena-only systems such as seek, conjure, perpetual, spellbooks, intensity, specialize, double team, boons, and heist.
- A script that downloads the current official rules and separates every keyword rule into a local searchable JSON file.
- A script that downloads Scryfall's current Oracle bulk data and creates an Arena-only card database.
- A multiplayer/Commander engine foundation with zones, turns, priority, stack handling, events, triggers, replacement effects, state-based actions, and Commander damage.
- No copied MTG Arena program code, art, animations, audio, or private files.

## Fast setup

```bash
npm install
npm run sync
npm test
```

Generated files will appear in `generated/`:

- `official-mechanics-rule-sections.json`
- `arena-cards.json`
- `arena-keywords.json`
- `runtime-mechanics-index.json`
- `sync-metadata.json`

`npm run sync` should be run during deployment or from a scheduled backend job, not every time a player opens the page.

## Important limitation

A mechanics list is not the same thing as a fully rules-enforcing game. Magic cards combine targets, costs, choices, linked abilities, replacement effects, continuous-effect layers, hidden information, and unusual card-specific exceptions. The included engine is a foundation and registry. Each supported card still needs either:

1. structured ability data that the engine can interpret, or
2. a tested card script registered by card-definition ID.

For maximum existing coverage, study an open-source engine such as XMage, Forge, or phase-rs and follow its license. Do not paste GPL code into a closed-source project without complying with the GPL.

## Suggested integration with your existing app

Keep your current frontend and multiplayer room system. Run rules and hidden information on the backend.

```text
browser UI
   -> sends player intent
authoritative game server
   -> validates intent
   -> runs costs, stack, priority, triggers, replacement effects and state-based actions
   -> returns a player-specific sanitized state
browser UI
   -> renders only the state that player may see
```

Never let the browser decide random results, library contents, target legality, or whether a spell resolves.

## Card data

`src/sync-arena-cards.mjs` uses Scryfall bulk data. It filters card objects whose `games` list contains `arena`, then retains fields useful to a rules engine and deck importer.

Card images are not downloaded by this package. Use returned image URLs according to Scryfall's image guidelines, and cache responsibly.

## Updating for new sets

Run:

```bash
npm run sync
```

The official rules link can change when Wizards publishes a new rules document. Update `RULES_TXT_URL` in `src/sync-official-rules.mjs` when necessary.

## Recommended next implementation order

1. Basic lands and mana.
2. Vanilla creatures.
3. Evergreen keywords.
4. Casting, targets, stack, and responses.
5. Combat.
6. Triggered and activated abilities.
7. Replacement/prevention effects and layers.
8. Commander rules.
9. Tokens and counters.
10. Set mechanics and card-specific scripts.
11. Arena-only digital mechanics.

## Unofficial notice

This project is an unofficial development starter and is not approved, endorsed, or sponsored by Wizards of the Coast. Magic: The Gathering, MTG Arena, card names, rules text, symbols, and artwork are property of their respective owners.
