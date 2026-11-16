---
name: seed-and-fixtures
description: Builds and checks Time2Fest backend data for local work and tests — idempotent seed of Payload collections from web/data (countries, schedule, streams, chat script, demo seed) and fixtures for every reference-board state, with exactly the values the sim adapters show. Use when a plan answers yes to "Seed and fixtures", when a collection or a web/data source changes, and when layout-fidelity needs a board state reproduced on the server.
---

# seed-and-fixtures

Layout fidelity is impossible unless the server shows the same data as `sim`. **Status:** built by SPEC-02: registry and CLI in `server/src/seed/{registry,index,cli}.ts` (`pnpm --dir server seed`), test doors `reset` and `fixtures` in `server/src/test-doors/` (`POST /api/_test/reset`, `POST /api/_test/fixtures`). The seed translator `BT/http-seeds.mjs` and the per-collection seeders arrive with the waves that add the collections.

## 1. Seed (all environments except production data)
Sources — read them, never invent parallel copies:
| Source (in `web/`) | Goes to |
|---|---|
| `data/countries.json` (246 countries; `howTo`, `illustrationId`, cities), `scripts/seed/countries.seed.json`, `scripts/seed/howto.seed.json` | `countries` with content slots (`howTo`, `stamp`, `postcard`, `share.square`, `share.wide`, `scenePlaceholder`; status `empty/draft/review/published`) |
| `data/schedule.json` (+ `schedule.schema.json`; events as UTC instants from tzdb, constitution II) | events / zones |
| `data/streams.json`, `data/streams.demo.json` | `stream_sources` (role, status, embeddable) |
| `data/chat-script.json` | demo chat history (test/demo only) |
| `lib/demo/seed.ts` | demo-build defaults (test/demo only) |
Rules: idempotent (upsert by natural key: ISO, event id, videoId); prints counts; the production database gets catalog data only via the catalog path, never demo data. `data/streams.candidates.json` (gitignored scout output) is never seeded.

## 2. Fixtures for board states (test environment only)
- Fixtures are named after manifest seeds in `BT/manifests/_common.json` and `batch-*.json` (`guest`, `user`, `pass`, `authOther`, `nick`, …), where `BT = D:/Work/Pets/Time2Fest/docs/bmad/planning-artifacts/ux-designs/ux-Time2Fest-2026-10-21/board-tools`. One fixture = the server-side equivalent of that localStorage seed: same email, nick, flag, pass ids, stamp list, order states (`demo-paid`, `demo-pending`, `demo-declined`, `demo-expired`, `demo-cancelled`, `demo-open`, `demo-toast-paid` — `frontend-seam.md` §6.3), notification counts.
- Values are copied from the sim seed/state, not retyped; a unit test compares the fixture with the sim store for each name.
- Time comes from the test clock door, never from `Date.now()` in fixtures.
- Fixtures are applied through `POST /api/_test/fixtures` (test flag only) and reset with `POST /api/_test/reset`.

## 3. Privacy
Only invented data. Never read or copy anything from `research_data/` (real visitors' cities and messages) or production databases; emails use `example.com` / the existing demo addresses; chat lines come only from `data/chat-script.json`.

## 4. Check
`pnpm --dir server seed` twice → same counts; fixture-vs-sim unit test green; `grep -ri research_data server tests` → nothing.
