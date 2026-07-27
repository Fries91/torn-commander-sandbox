# Implementation status

## Included and complete

- Comprehensive Rules mechanics index: 68 keyword actions.
- Comprehensive Rules mechanics index: 193 keyword abilities.
- Total indexed official mechanics: 261.
- Arena digital-system design records: 10.
- Rules downloader/parser.
- Scryfall Arena-card bulk-data downloader/filter.
- Runtime mechanics-index builder.
- Multiplayer game state, player-specific hidden-information views, turn order, phases/steps, stack, priority passing, event log, replacement hooks, prevention hooks, triggers, state-based-action loop, zone changes, Commander life and commander-damage tracking.
- Starter handlers for draw, destroy, sacrifice, tap, untap, conjure, perpetual changes, and seek.

## Deliberately not claimed as complete

- Every individual card script.
- Every targeting and mana-payment combination.
- Full continuous-effect dependency ordering.
- Every copy, face-down, meld, mutate, sticker, attraction, plane, scheme, dungeon, battle, and subgame corner case.
- MTG Arena's private implementation, user interface behavior, matchmaking, economy, or server protocol.

## Why card scripts are still required

Two cards can share the same keyword but differ in targets, costs, restrictions, timing, zones, linked abilities, intervening-if clauses, replacement effects, or choices. The engine therefore separates:

1. general game rules;
2. registered mechanic handlers;
3. structured per-card definitions or tested per-card scripts.

Use the generated Arena card database to select the cards you want to support first, then add tests for each card and interaction.
