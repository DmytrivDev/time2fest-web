# SPEC-12 «Ефір: ланцюжки, статуси, квота, глядачі» — pass 1 notes (2026-11-21)

Spec-creator (Opus) pass 1, saved by the wave conductor. Spec file to come: `docs/specs/SPEC-12-live.md` (number fixed by `specs/002-backend/waves.md:224`; Supersedes: none). Wave paused 2026-11-21 by the owner's word (machine load) — continue with pass 2 after the owner's answers and the quota figure.

YouTube policy notes: `D:/Work/Pets/Time2Fest/docs/backend/youtube-notes.md` (written by the wave researcher; pass 2 must use it and settle policy-dependent defaults).

## (a) Questions for the owner (recommended default first)
1. **Real YouTube Data API adapter.** Default: build it behind the same interface as the fake, tested only against the fake. First real call = a separate smoke test after the owner's "yes", ≤1,000 units, never 29.12–01.01 (FR-LIVE-21, spec.md:705).
2. **Where a viewer's country comes from.** Default: Cloudflare IP-country at connection time, counted in memory, never stored per person; only countries with ≥3 people are published. Nothing counts per-country today; sim invents a top-140 list (`lib/presence/viewers.ts:11-32`).
3. **"Long news only in the hour around the city event" (FR-LIVE-06).** Default: from 30 min before to 30 min after the event's `startsAt`; outside that the source is dropped from the chain.
4. **Keeping YouTube-derived data.** Default: titles, statuses and embeddable flags refreshed or deleted within 30 days; the season archive keeps only videoId plus our own labels and order (FR-LIVE-23) — confirm against youtube-notes.md.

## (b) Autonomous decisions [А]
- [А1] `chains()` without parameters: `GET /api/live/chains` returns all events at one public address with a version (ШВ-07); drops `?eventIds` from `lib/api/contracts/live.ts:39` and `frontend-seam.md` §3.2.
- [А2] `freshMs` 10 s, `staleMs` 10 min (FR-EDGE-02), R2 copy `live/chains.json`, own purge tag, retries/alarms as `server/src/site/fanout.ts`.
- [А3] Client takes the higher version, ignores older; `hide` event removes the source. Today `applyStreamEvent` ignores version and hide (`live.ts:58-70`); `lib/data/build.ts:86-89` drops `version`.
- [А4] Polling as `lib/api/http/site.ts`: 15 s without realtime, 30 s with it, immediate re-read on resync.
- [А5] Statuses stay `live | expected | possible`; "try" is published as `possible` (player treats it as playable, `chain.ts:53-68`); hidden source is removed from the chain (no new `none` status).
- [А6] Player calls `reportSourceError` on codes 2/5/100/101/150/153 (today nobody calls it).
- [А7] Server replaces a dead source with the next one (FR-LIVE-18); all dead → countdown scene as today.
- [А8] Quota figures are config: daily 10,000, `search.list` 100, ≤100 searches, out-of-turn ceiling 500/day, alarm at 80%; counted per Pacific day (FR-LIVE-11/12/20).
- [А9] Busiest night on defaults (RECALCULATE after the owner's figure): ~100 sources, ≤2 batched `videos.list` per 30 s inside ±1 h windows, ~22 h of windows → ~5,300 units; leaves ~4,700 = 47 searches, not 100 — the card's "≤100 searches" does not fit in 10,000. This wave makes no searches (SPEC-21a does).
- [А10] "Treat zone as live" marks that zone's event sources `live` until window end (+1 h) or owner revert; journal row, one-step revert (like SPEC-08 `service.ts`).
- [А11] "Replace source by videoId" adds the source as `possible` and queues one out-of-turn check; owner only, agents refused.
- [А12] Admin slice: new slot plus `/cms-api/live/*` behind Cloudflare Access and `owner` role, strict body ≤1 KB (`cmsEndpoints.ts`).
- [А13] Fake YouTube like `fakes/ai/server.mjs`: status, embeddable, live/ended, "quota exceeded" (403 `quotaExceeded`) via `/_control`; test door `video-status` (501 stub at `test-doors/registry.ts:142`) implemented.
- [А14] `import chains` = row in `registries/imports.ts`: dry run + plan add/change/same/skipped-admin-edited; admin-edited sources never overwritten.
- [А15] −5 min rule and 2-min stale rule run in the status-poller tick on server time, not in a moment row.

## (c) Gaps, corner cases, cross-module
1. `live` not on http: `HTTP_DOMAINS = ['catalog','site']` (`lib/api/http/domains.ts:7`); no live wire schemas in `packages/contracts`; `packages/contracts/test/site.test.ts:122` pins public routes.
2. Viewers http vs sim: test build shows 140 countries, http with few people shows none → layout-fidelity needs a fixture for «Зараз дивляться» boards.
3. `scripts/check-bundle.mjs` forbids `centrifuge` on pages except rehearsal build (`--allow-realtime`); live pages need the same exception.
4. R2 prefix set only for rehearsal (`waves.md:1081`); R2 copy untestable in `test` without it.
5. Hide without realtime ≤30 s holds only if purge succeeds or `freshMs` ≤15 s; purge failure: 15 s poll + 10 s fresh ≤30 s — needs an AC.
6. Quota exhausted → stop calling YouTube, keep last statuses, stale alarm ≤2 min inside a window; outside — `log` only.
7. Non-midnight events (SPEC-04 hand-over `waves.md:1036`): window ±1 h of own `startsAt`, out of the live slot (FR-LIVE-26); data has offsets (paris 22:50Z, tokyo 14:51:40Z).
8. Player reports untrusted: rate limit ≤1/30 s per source (FR-LIVE-04), event/source must exist; report only triggers an out-of-turn check.
9. `override` exists in `types.ts`, nothing reads it; automation must not overwrite an `override` source.
10. Spike 4 (≤1 s to next source after hide/dead) measured in e2e from event receipt.
11. Look unchanged; one autoplaying player; nothing over the player.

## (d) AC outline (~46 AC + 8 NFR; packages contracts, server, web, edge)
- A. Chains route, version, edge cache, R2, purge: AC 1–6.
- B. http adapter: polling, versions, hide, resync, sim/http conformance, layout-fidelity: AC 7–12.
- C. Status polling and quota: windows, batches, out-of-turn, counters, priority, 80% alarm, quota exceeded, stale alarm, −5 min → `possible`, one API project, embeddable filter: AC 13–24.
- D. Player: error report, server auto-replace, spike 4: AC 25–28.
- E. Admin slice: hide, change main, override, treat zone live, replace by videoId, slot sources, quota state, journal/revert, agents refused: AC 29–36.
- F. Viewers: 30–60 s, ≥3, `viewersMap`, privacy: AC 37–40.
- G. Non-midnight events and long news: AC 41–42.
- H. `import chains`: AC 43–44.
- I. Fake YouTube, doors, data retention: AC 45–46.
- NFR: quota budget, hide latency, payload limit, no keys in logs, bundle check, retention, doors 404 in production, no real key in CI.
