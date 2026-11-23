# Implementation plan: Live air — one cached chains address with a version, source statuses polled from the YouTube Data API within quota, hide / main / override / zone-live / replace, dead-source replacement, stale-status alarm, admin «Ефір» slice, viewers (countries ≥3 and people on Time2Fest), `import chains`, YouTube fake, ≤30-day retention (SPEC-12)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-12-live.md` (Status: approved; checker `check-specs.mjs --dir docs/specs`: 0 markers in SPEC-12; its one violation is `SPEC-12-live.pass1.md` having no `Status:` — a notes file, not a spec). AC-1 … AC-78 (`:133-407`), NFR-1 … NFR-7 (`:441-466`), contracts `:530-555`, owner decisions В1–В4 and the quota table (`:16-30`), session decisions [А1]–[А22] (`:32-62`). Open questions 1 and 3 are for the plan and are resolved below ([П-1], [П-2], [П-3]); Open question 2 (Made for Kids) is deferred and blocks nothing.
This plan implements those requirements; it does not define or change them.
**Execution mode** — ACCELERATED, **single lane**: one conductor session with a small context, one fresh `sdd-engineering:implementer` per phase at a time (16 GB machine shared with other worktrees), dispatched with this plan's path and the phase id; model per phase from the `Execution` table. Phases ≤6 items / ~12 files. During phases only targeted checks; ONE full verify in phase L. Chosen by the orchestrator for the owner (brief of 2026-11-23).
**Out of scope** — the spec's Non-goals (`:86-95`): channel list, candidates queue, `search.list` calls, playlists, agent publish (SPEC-21a/b) — only the search-bucket counter and the refusal above its ceiling are built here; **any call to the real YouTube Data API** and any real key anywhere (В1; smoke test, production key and production R2 prefix → SPEC-22b); `concurrentViewers` / `viewCount`; oEmbed / RSS / thumbnails; alarm delivery channels (SPEC-13b); rooms, multiview, chat, stamps (SPEC-14/15/19); a per-room people count; any new design (only the q4 line text); Made for Kids (Open question 2). No Cloudflare zone change, no `wrangler deploy`, no real purge. Architecture review and `security-reviewer` are separate agents (`security-reviewer` mandatory: public cacheable route, untrusted player reports, owner/operator writes, a new subscription-token route, presence, test doors, an API-key variable).

Repository root for every path = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-12-live` (branch `spec-12-live`, base `master` `c7b2546e`; SPEC-08 is merged, so `server/src/site/**`, `workers/edge/src/publicCache.ts`, `packages/contracts/src/publicRoutes.ts` exist and are the patterns to copy).
- **Do not commit, never push** (the conductor commits after each phase). Never stage `tsconfig.json`. `server/src/payload-types.ts` may show as modified after a dev server ran (gotcha `docs/knowledge/gotchas.md:10`) — regenerate it only in W7.
- **Never touch another session's files:** `lib/prelaunch/**`, `content/prelaunch/**`, `workers/prelaunch/**`, `scripts/prelaunch/**`.
- Never read: `research_data/**`, `docs/archive/**`, `Old Project/**`, `**/reference-boards/**`, `board-tools/shots/**` (except `*.diff.png` / `*.fid.png` the compare script flags), `graphify-out/graph.json`, `out*/`, `.next*/`, `node_modules` (except `.d.ts` / `package.json` lookups), `pnpm-lock.yaml`, `.env*` contents other than `*.env.example`, `dashboard/secrets/**`, `docs/decision.md` whole (grep + range only).
- **No real YouTube call, ever, in this wave** (В1). The only YouTube endpoint any process or test reaches is the fake (`fakes/youtube/server.mjs`, port 0 / loopback). The key variable exists only as a name: `T2F_YOUTUBE_API_KEY` (spec `:555`), never set in any file, CI or test (tests use the literal `test-key-not-real // check-secrets: allow test fake`, only against the fake). The root `.env.example` line `YOUTUBE_API_KEY=` belongs to the Python scout scripts (`scripts/ytapi.py:37`) and is **not** touched.
- **Quota numbers live only in `server/src/domain/live/config.ts`** (`LIVE_DEFAULTS`), overridable by the one env var `T2F_LIVE_CONFIG` (JSON, partial). No literal 10000, 1800000, 600, 100, 50, 500, 1000 elsewhere in `server/src/{domain/live,live}/**` (AC-37 grep).
- Machine: 16 GB. Vitest `--maxWorkers=2`; Playwright `--workers=2`; one heavy process at a time. Local stack per skill `local-stack` with this worktree's own slot and databases `t2f_spec_12_live` / `t2f_spec_12_live_test`. Fakes listen on port 0; no test binds port 3000.
- **No new dependency** (`jose`, `zod`, `centrifuge`, the wrangler test harness are installed). `pnpm install` is never run.
- Paths marked **(to confirm)** were not opened by the planner; the implementer checks them with Grep / `graphify explain` before editing and keeps the plan's intent.
- Phase ids: C (contracts), X (switch), S (server), E (edge), F (front-end / site), D (docs), L (integration). Work-item ids are W1 … W55 plus WE1 … WE3; **W46 is not used**.

## Planner decisions (resolving the spec's plan-level Open questions)

- **[П-1] How a browser counts once across tabs without anything stored per person (OQ-1, AC-61).** No identifier at all. Among the tabs of one browser profile, exactly one holds a **Web Locks** exclusive lock `t2f-viewer` (`navigator.locks.request`, same-origin, released by the browser when that tab closes or crashes; the next tab waiting on the lock takes over). Only the lock holder subscribes to `live:viewers` **with a subscription token** whose `info` is `{p:1, c?:"<ISO>"}`; every other tab subscribes to the same channel **without** a token (public anonymous subscribe, `server/src/registries/channels.ts:14`). The server counts the presence entries of `live:viewers` whose `chan_info.p === 1`: that number is `people`; grouped by `chan_info.c` it gives the countries (≥3). Nothing per person exists on our side: no cookie, no localStorage id, no server row; Centrifugo's presence (Redis engine, `docker-compose.yml:64`; Redis runs with `--save '' --appendonly no`, `:30`) holds the entry only while the subscription lives (removed on unsubscribe/close; ≤60 s `presence_ttl` after a crash). Browsers without `navigator.locks` count each tab — an over-count we accept. **Why:** a localStorage id would be a persistent per-browser identifier (device storage, and it would travel to the server); BroadcastChannel elections need hand-written heartbeats; Web Locks gives exactly "one per browser profile, released on close" for free. Centrifugo facts verified by research (below).
- **[П-2] How Cloudflare's IP country reaches the counter (OQ-1, AC-59).** Through the **subscription-token request**, not through the WebSocket. The lock-holder tab calls `GET /api/live/viewer-token` on the site origin; that request goes through the edge Worker, which already sets `x-t2f-client: <ip>;<cf.country>` on every forward and deletes client-sent address headers (`workers/edge/src/proxy.ts:37,43-46`); the server's edge gate exposes only `ctx.client.country` (`server/src/platform/edge.ts:25-26,63-66`: `XX`, `T1`, malformed → `unknown`; the raw address never leaves the closure). The route signs `{sub:'', channel:<live:viewers name>, info:{p:1, c?}, iat, exp}` with the existing HS256 Centrifugo secret (`server/src/adapters/centrifugoToken.ts`), omitting `c` when the country is `unknown`. **Why not the WebSocket path:** the realtime hostname is a separate tunnel straight to Centrifugo (`D:/Work/Pets/Time2Fest/docs/backend/cloudflare-notes.md:37`); taking `Cf-Ipcountry` from the upgrade request would need a Centrifugo connect proxy back into the server for every connection (a new trust boundary, the server in the connection path on the night). The token route reuses a trust path that is already secret-checked and tested (SPEC-05 AC-20 … AC-23). The country is fixed at subscribe time ("у момент підключення"); a token refresh (1 h `exp`) re-reads it.
- **[П-3] Room page (OQ-3, AC-77).** The watcher line is rendered only by `components/live/Caption.tsx:309-314,360-364`, `components/home/HomeLive.tsx:241-246`, `components/country/CountryLive.tsx:266-270` (grep `watchersFrom|watchersShort`); `Caption` receives `watchers` only from `HomeLive.tsx:216` and `CountryLive.tsx:234`. The room page does not show it, so `docs/site/room.md` is not patched.
- **[П-4] Two YouTube adapters, one port.** `adapters/youtubeData.ts` (real wire: `GET <base>/youtube/v3/videos`, key in the `X-Goog-Api-Key` header, never in the URL) and `adapters/youtubeFake.ts` (same port and path on the fake, no key). The selection function `youtubeAdapterFor(cls)` returns `'fake'` for **every** class in this wave; the real adapter is constructed only by the port suite, pointed at the fake (AC-39). Without `T2F_YOUTUBE_BASE_URL` (production) the poller is not started and statuses stay as imported. Requests use `part=snippet,status,liveStreamingDetails` with `fields=items(id,snippet/liveBroadcastContent,status(privacyStatus,embeddable),liveStreamingDetails(scheduledStartTime,actualStartTime,actualEndTime))`, so titles and statistics never reach the process (AC-75).
- **[П-5] One poller, many instances.** The poller and the viewers aggregator each hold their own row of the existing Postgres lease (`server/src/adapters/pgScheduler.ts:55` — the lease row name is a parameter): `live-poller`, `live-viewers`. Quota counters are rows updated by one atomic SQL increment per call, so an ad-hoc check from any instance is counted once.

## Requirements traceability

"int" = server integration file under the shared lock; "e2e" = Playwright on the http integration build, run in L; "L" = integration pass.

| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | zod schemas StreamSource/Chain/Event, ChainsResponse, ViewerSummary(`people?`), SourceErrorReport; additive | `:133` | W1, W2 | W2 Done |
| AC-2 | `live` contract suite same on sim and http | `:136` | W43, W55 | W43 (sim), L (http) |
| AC-3 | `GET /api/live/chains` 200 `{version,at,chains}`, `public, max-age=10`, no `Set-Cookie` | `:139` | W20, W23 | W25 (int) |
| AC-4 | `chains()` takes no params; seam §3.2 has no `eventIds` | `:142` | W1, W40, W54 | W43 (type test), W54 (grep) |
| AC-5 | version +≥1 in the tx; event ≤1 s after commit | `:145` | W15, W20, W21 | W22 (int) |
| AC-6 | rollback → no publish/purge/R2 | `:148` | W21 | W22 (int) |
| AC-7 | publish failure → change kept, one `live/publish-failed` | `:151` | W21 | W22 (int) |
| AC-8 | FR-LIVE-02 fields stored; only `youtube` public | `:154` | W6, W8 | W11 (unit) |
| AC-9 | `override` kept by poller, auto-replace, import | `:157` | W8, W16, W35 | W19, W37 (int) |
| AC-10 | `hidden` event patch → no chain, not polled | `:160` | W8, W16, W20 | W19, W25 (int) |
| AC-11 | chains address in the public list, no params | `:165` | W23, WE1 | W25 (server half), WE3 (edge half) |
| AC-12 | edge ≤10 s from cache; older → serve + one background refresh | `:168` | WE1, WE2 | WE2, WE3 |
| AC-13 | origin failure → cache ≤10 min stale, then R2, then 503 | `:171` | WE1, WE2 | WE2, WE3 |
| AC-14 | purge tag `t2f-live-chains` ≤2 s; skip line; retries 30/120 s + `log` alarm | `:174` | W21 | W22 (int) |
| AC-15 | R2 `live/chains.json` = AC-3 body; retries 30/120/300 s + `page` alarm | `:177` | W21 | W22 (int) |
| AC-16 | `live` in `HTTP_DOMAINS`; events validated, bad ignored | `:182` | W41 | W43 |
| AC-17 | older version dropped; events during load applied after | `:185` | W1, W42 | W2, W43 |
| AC-18 | `hide` removes the source | `:188` | W1, W42 | W2, W43 |
| AC-19 | poll 15 s ±1 when not connected; ≤30 s always; `onResync` | `:191` | W41 | W43 |
| AC-20 | read failure → keep last, else build chains | `:194` | W41, W42 | W43 |
| AC-21 | hide → tab with realtime p95 ≤3 s (20 hides) | `:197` | W53 | L (e2e) |
| AC-22 | no realtime + purge fails → hidden ≤30 s | `:200` | W53 | L (e2e) |
| AC-23 | realtime only with `NEXT_PUBLIC_REALTIME_URL`; prelaunch has no `centrifuge` | `:203` | W41, W45 | L (`check-bundle`) |
| AC-24 | open window → each source checked ≤30 s | `:208` | W16 | W19 (int) |
| AC-25 | one merged cycle, ⌈A/B⌉ calls per tick | `:211` | W8, W16 | W11 (unit) |
| AC-26 | off-window: every 6 h … 7 days | `:214` | W8 | W11 (unit) |
| AC-27 | YouTube → status table [А20] | `:217` | W8 | W11 (unit) |
| AC-28 | −5 min: `expected` without `startsAt` → `possible` | `:228` | W8, W16 | W19 (int) |
| AC-29 | not public / not embeddable → not public | `:231` | W8 | W19 (int) |
| AC-30 | dead → next first; all dead → `sources: []` | `:234` | W8, W16 | W19 (int) |
| AC-31 | two buckets per quota day; failed call counts ≥1 | `:237` | W9, W15 | W11 (unit) |
| AC-32 | below reserve only open-window statuses; class order | `:240` | W9 | W11 (unit) |
| AC-33 | search over ceiling → `quota-exhausted`, no request | `:243` | W9, W13 | W11, W13 |
| AC-34 | 80 % → exactly one `live/quota-80` `page` per day per bucket | `:246` | W9, W16 | W11 (unit) |
| AC-35 | 403 `quotaExceeded` → stop bucket till day end, keep statuses, one line | `:249` | W16 | W19 (int) |
| AC-36 | no fresh check >2 min in open window → `page` alarm; else `log` | `:252` | W9, W16 | W19 (int) |
| AC-37 | every quota number from config | `:255` | W9, W14 | W11 (unit + grep) |
| AC-38 | exactly one YouTube key variable, no rotation | `:258` | W14 | W14 Done (unit) |
| AC-39 | fake in test/rehearsal/CI; real adapter same port, passes the suite vs fake | `:261` | W13, W18 | W13 (suite), W19 |
| AC-40 | rehearsal + real: ≤1 000 units/day, refuse 29.12–01.01 | `:264` | W9 | W11 (unit) |
| AC-41 | player codes 2,5,100,101,150,153 → report ≤1/30 s/source | `:269` | W50 | W52 |
| AC-42 | report >1 KB / bad schema / bad code / unknown ids → 400 | `:272` | W24 | W25 (int) |
| AC-43 | valid report → ad-hoc check ≤10 s, ≤1/30 s, none if in tick | `:275` | W16, W24 | W25 (int) |
| AC-44 | ad-hoc ceiling spent → 202, no YouTube call | `:278` | W9, W16, W24 | W25 (int) |
| AC-45 | a report never changes a status | `:281` | W24 | W25 (int) |
| AC-46 | hidden/dead playing source → next ≤1 s in the same player | `:284` | W42, W53 | L (e2e) |
| AC-47 | ≤1 autoplaying player; invisible paused | `:289` | W53 | L (e2e) |
| AC-48 | nothing over the iframe; ≥200×200 | `:292` | W53 | L (e2e) |
| AC-49 | Referer passed (`strict-origin-when-cross-origin`), `origin` param | `:295` | W51 | W52 |
| AC-50 | admin slice «Ефір»: sources of current/next slot, 5 actions, 3 buckets | `:300` | W30, W33 | W34 (unit); manual at rehearsal |
| AC-51 | owner hide → removed, `hide` event, journal, one-step revert | `:303` | W29, W30 | W32 (int) |
| AC-52 | `live hide` command, actor «оператор», no reason → exit ≠0 | `:306` | W29, W31 | W32 (int) |
| AC-53 | main / override → order/status, `override`, journal, revert | `:309` | W29, W30 | W32 (int) |
| AC-54 | zone-live → `live` till window end or revert | `:312` | W16, W29 | W32 (int) |
| AC-55 | replace by videoId → `possible` + one ad-hoc check | `:315` | W29 | W32 (int) |
| AC-56 | `/cms-api/live/*` non-owner / >1 KB → refused, no change | `:318` | W30 | W32 (int) |
| AC-57 | long news only −20 min … +15 min | `:323` | W8 | W11 (unit) |
| AC-58 | non-midnight events: own `startsAt`, own window, not in slot | `:328` | W8, W16, W30 | W19 (int) |
| AC-59 | country from Cloudflare at connection; `XX`/`T1`/none not counted | `:333` | W26, W27 | W28 (int) |
| AC-60 | every 30–60 s countries with ≥3 people, no numbers | `:336` | W10, W27 | W28 (int) |
| AC-61 | `people` = browsers with live connection; tabs count once | `:339` | W10, W27, W45 | W28 (int), L (e2e) |
| AC-62 | `viewersMap` off → no countries; `viewersCount` off → no `people` | `:342` | W10, W27 | W28 (int) |
| AC-63 | nothing per person stored; memory only | `:345` | W27 | W28 (int); security review |
| AC-64 | `peopleNow`/`peopleNowShort` in the 3 places, else no line | `:348` | W42, W48 | W49 |
| AC-65 | message files: two keys ×4, old keys gone | `:351` | W47 | W49 |
| AC-66 | `switches.viewersCount` additive, default true, toggle-with-reason | `:362` | W3, W4, W5 | W5 (unit), W4 (int) |
| AC-67 | sim: `people: 12480` in test/demo build, none in production | `:365` | W40 | W43 |
| AC-68 | `import chains` dry run report, no writes | `:370` | W35 | W37 (int) |
| AC-69 | `--apply` twice idempotent; admin-edited/override kept | `:373` | W35 | W37 (int) |
| AC-70 | seed/reset = import on empty DB | `:376` | W36 | W37 (int) |
| AC-71 | fake: ≤50 ids, states via `/_control`, `quotaExceeded` per bucket, counter | `:381` | W12 | W13 (unit) |
| AC-72 | test doors: video-status, quota, viewer fixtures, hide; 404 elsewhere | `:384` | W38 | W39; L (`doors-404`) |
| AC-73 | YouTube fields with `fetchedAt`; >30 days refreshed or deleted (DB, journal, R2) | `:389` | W6, W17 | W19 (int) |
| AC-74 | unchecked 30 days → not public until a check succeeds | `:392` | W8, W17 | W19 (int) |
| AC-75 | no statistics / titles; archive without YouTube fields | `:395` | W1, W13 | W2, W13 |
| AC-76 | http look = sim look except the q4 line | `:400` | W55 | L (layout-fidelity) |
| AC-77 | docs/site: home, country, 00-overview | `:403` | W54 | W54 (manual read) |
| AC-78 | boards with the line re-captured; list in docs/site | `:406` | W55 | L |
| NFR-1 | busiest night ≤80 % per quota day by formula | `:441` | W9, W11 | W11 (unit) |
| NFR-2 | ≤64 KB per `chain` event, ≤512 KB per response (300×10) | `:450` | W2 | W2 Done |
| NFR-3 | no key in responses, events, logs, journal, bundles, repo | `:453` | W13, W14 | W14 Done; L (`check-bundle`, `check-secrets`) |
| NFR-4 | ≤10 reports/min per address → 429 | `:456` | W24 | W25 (int) |
| NFR-5 | tests fail on any request to `*.googleapis.com` / `youtube.com`; CI has no key var | `:459` | W14 | W14 Done |
| NFR-6 | aggregate 30 000 connections ≤100 ms | `:462` | W10 | W11 (unit) |
| NFR-7 | only `peopleNow`/`peopleNowShort` added, only `watchersFrom`/`watchersShort` removed | `:465` | W47 | W49 |

## Spec follow-ups

For `spec-creator` and the owner; the plan implements the spec as written and records how it reads these points. None blocks.
1. **AC-59 "the request that opens his realtime connection"** is read as the viewer subscription-token request through the edge ([П-2]); the WebSocket upgrade never carries the country to the server. Same browser, same moment, same Cloudflare lookup.
2. **Presence on namespace `live`.** Counting needs Centrifugo `presence: true` on the `live` namespace (it then also applies to `live:streams`; Redis memory only). SPEC-06 AC-3 (no `allow_presence_for_*`) still holds; SPEC-06 listed presence as not built there — this wave builds it for `live` only. The spec should name it under Module interactions, together with the new private route `GET /api/live/viewer-token`.
3. **`viewersCount` and already-open tabs.** `SiteSwitchesSchema` / `siteGuard` are strict; a tab loaded before this wave would refuse a snapshot with the new key until reload. Pre-launch (no public site reads `site` yet — prelaunch uses the build snapshot without network, SPEC-08 follow-up 7), so acceptable now; after launch such an addition needs a tolerant reader (contract-conformance §4).
4. **`GET /api/live/viewers` is not edge-cached** (not in AC-11's list); it is a normal proxied, rate-limited route answered from an in-process cache ≤30 s old.
5. **Variable names.** The spec's `T2F_YOUTUBE_API_KEY` / `T2F_YOUTUBE_BASE_URL` (`:555`) are used in the server registry and `server/.env.example`. The root `.env.example` `YOUTUBE_API_KEY` is the scout scripts' variable (`scripts/ytapi.py:37`), outside the server registry; AC-38 concerns the server registry.

## Affected surface

Routing = `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1. Abbreviations: **onion** = `engineering-paved-path:onion-architecture`, **sec** = `engineering-paved-path:security`, **cc** = `contract-conformance`, **ms** = `migration-safety`, **sf** = `seed-and-fixtures`, **fui** = `engineering-paved-path:frontend-ui-architecture`, **react** = `engineering-paved-path:react-best-practices`, **rtl** = `engineering-paved-path:react-testing-library`.

| File | New/Mod | Package | Home (ring / radius) | Skills | Constraint to respect |
|---|---|---|---|---|---|
| `packages/contracts/src/{live,liveRules,liveGuard}.ts`, `index.ts` | New/Mod | contracts | wire types / pure rules / guard | onion, cc | `index.ts` zod-free; `liveGuard.ts` import-free like `siteGuard.ts` (the site bundle has no zod) |
| `packages/contracts/src/{live.schemas,schemas}.ts` | New/Mod | contracts | wire schemas | onion, cc | zod only via `schemas.ts`; objects `.strict()`; additive vs `lib/data/types.ts:86-129` |
| `packages/contracts/src/{site,site.schemas,siteGuard,siteRules}.ts` | Mod | contracts | wire | onion, cc | `viewersCount` additive, default `true` |
| `packages/contracts/src/publicRoutes.ts` | Mod | contracts | data | onion, cc | no imports (the Worker imports it by relative path, `workers/edge/src/handler.ts:4`) |
| `packages/contracts/test/{live.test,isEnabled.table,isEnabled.test,site.test}.ts` | New/Mod | contracts | tests | gap | — |
| `scripts/contract-surface.baseline.json` | Mod | web | generated | gap | additive diff only (`--update` then `--check`) |
| `server/src/domain/site/switches.ts`, `server/src/globals/siteState.ts` | Mod | server | ring 1 / Payload | onion, ms | default `viewersCount: true` (`switches.ts:19,49-55`, `siteState.ts:19-25`) |
| `server/src/admin/{SiteStateView.tsx,messages.ts}` | Mod | server | admin UI | gap (admin tsx) | `BOOLEAN_KEYS` `SiteStateView.tsx:32`; label in `SITE_SWITCH_LABELS` `messages.ts:43` |
| `lib/api/site/buildSnapshot.ts` | Mod | web | lib | gap | `viewersCount: true` beside `viewersMap` (`:23`) |
| `server/src/collections/{streamSources,liveQuota}.ts`, `server/src/globals/liveState.ts`, `server/src/registries/{collections,globals}.ts` | New/Mod | server | ring 4 (Payload) | ms | thin; REST create/update/delete never for public roles; rules in `domain/live` (routing note "Payload is a thin layer") |
| `server/src/migrations/<ts>_live.{ts,json}`, `index.ts`, `server/src/payload-types.ts` | New/Mod | server | generated | ms, gap | `pnpm --dir server migrate:create live` + `fix-migration-down.mjs`; sorts after `20261120_165256_site_state` |
| `server/src/domain/live/{config,moment,status,chain,schedule,quota,viewers}.ts` | New | server | ring 1 | onion | pure; time and config are parameters; no `Date.now()` (`server/eslint.config.mjs`) |
| `server/src/live/{ports,poller,retention,snapshot,fanout,viewers,actions,import}.ts` | New | server | ring 2/3 | onion, sec | ports as parameters, never the container; journal in the same tx (`server/src/audit/ports.ts`) |
| `server/src/adapters/{youtubeData,youtubeFake,payloadLive}.ts` | New | server | ring 4 | onion, sec | key only from env, header not URL, never logged; Payload rows never leave the adapter |
| `server/src/adapters/{cfPurge,centrifugoToken,centrifugoApi}.ts`, `server/src/realtime/ports.ts` | Mod | server | ring 4 / 2 | onion, sec | `cfPurge` gains a `tag` option (default `SITE_CACHE_TAG`, `:11,39`); the signer gains `signSubscription`; the API gains `presence(channel)` |
| `server/src/domain/realtime/{channels,centrifugoConfig}.ts`, `server/src/registries/channels.ts` | Mod | server | ring 1 / root | onion, sec | row field `presence?: true` → namespace `presence: true`; still no `allow_presence_for_*` (SPEC-06 AC-3) |
| `server/src/endpoints/{liveChains,liveViewers,liveViewerToken,liveSourceErrors,types,deps}.ts` | New/Mod | server | ring 4 | onion, sec, cc | chains `public: true` (as `endpoints/siteState.ts`); others private; `Deps` gains optional `live` + `liveOf` (`deps.ts:46` pattern) |
| `server/src/registries/{routes,rateLimits,subscribers,revertHandlers,env,imports,adminSlots}.ts` | Mod | server | root | onion, sec | one sorted row each (`assertRegistry`) |
| `server/src/seed/registry.ts` | Mod | server | seed | sf | source `data/streams.json` only (`AllowedSource`, `:15`); never `streams.candidates.json` |
| `server/src/admin/{cmsHttp,liveEndpoints}.ts`, `server/src/admin/cmsEndpoints.ts` | New/Mod | server | ring 4 | onion, sec | helpers (`isOwner`, `boundedText`, `fail`) move to `cmsHttp.ts` to avoid a cycle; owner + Access gate + JSON + ≤1 KB as `cmsEndpoints.ts:43-60` |
| `server/src/admin/{LiveSlice,LiveView}.tsx`, `server/src/admin/messages.ts` | New/Mod | server | admin UI | gap (admin tsx, propose react) | reason rendered as text (React escaping) |
| `server/src/cli/live.ts`, `server/package.json` (script `live`) | New/Mod | server | ring 4 | sec | no secret in output; run as `pnpm run live hide …` (gotcha `gotchas.md:9`) |
| `server/src/test-doors/{live,registry}.ts` | New/Mod | server | ring 4 | sec | replaces the stub `video-status` (`registry.ts:147`); only `T2F_ENV=test` + `T2F_TEST_DOORS=1` |
| `server/src/container.ts` | Mod | server | composition root | onion, sec | additive deps; poller and viewers tickers only in `startProcessBackground` (`:628`) |
| `server/.env.example` | Mod | server | config | sec | names only: `T2F_YOUTUBE_API_KEY`, `T2F_YOUTUBE_BASE_URL`, `T2F_LIVE_CONFIG` |
| `server/vitest.config.ts`, `server/vitest.integration.config.ts`, `server/test/support/noYoutubeNetwork.ts` | Mod/New | server | test config | rtl (`vitest.config.*`) / gap | the guard is loaded by `setupFiles` of both configs |
| `fakes/youtube/{server.mjs,README.md}` | New | server | fake | gap | pattern `fakes/ai/server.mjs` (node:http only, `/_control`, not in compose) |
| `server/test/unit/*live*`, `fake-youtube`, `youtube-port`, `live-env`; `server/test/integration/live-*.int.test.ts`; `server/test/e2e/doors-404.e2e.ts` | New/Mod | server | tests | gap | literal fake keys carry `// check-secrets: allow test fake` |
| `infra/ops/test/workflow.test.mjs` (to confirm) | Mod | ops | CI test | sec | asserts `verify.yml` has no YouTube variable |
| `workers/edge/src/publicCache.ts`, `workers/edge/test/{public-cache,handler,site-cache.worker}.test.ts` | Mod | edge | edge | sec | `Cache-Tag` from the route row; red button only when the row names one; no `cf:` options; no `[cache]` |
| `lib/api/contracts/live.ts`, `lib/api/sim/live.ts`, `lib/presence/viewers.ts` | Mod | web | contract / sim | cc, gap | the interface re-exports contracts types; `chains()` without params |
| `lib/api/http/{live,domains,index}.ts`, `lib/api/http/viewerPresence.ts` | New/Mod | web | adapter | fui, sec, cc | recipe `frontend-seam.md` §6.0; never imports `lib/api/sim/**`; prelaunch → build chains, no network (as `lib/api/http/site.ts:75`) |
| `lib/api/http/realtime/{types,transport}.ts` | Mod | web | adapter | fui, sec | subscription-token option; the dynamic `import('centrifuge')` stays |
| `lib/api/hooks/live.ts` | Mod | web | hook | fui, react | version-aware reduce; `usePeopleNow()` |
| `components/live/Caption.tsx`, `components/home/HomeLive.tsx`, `components/country/CountryLive.tsx` | Mod | web | components | fui, react | only the text and its number source change; no class, token or layout change |
| `messages/{uk,en,es,fr}.json` | Mod | web | messages | gap | texts exactly as the AC-65 table |
| `lib/player/{PlayerProvider.tsx,youtubeApi.ts,sourceErrors.ts}` | Mod/New | web | lib | react (tsx), gap | one player; `loadVideoById` stays (`youtubeApi.ts:156`) |
| `tests/unit/{api,live,player,i18n}/**`, `tests/contract/live.{suite,http.test}.ts`, `tests/e2e/live/*.spec.ts` | New/Mod | web | tests | rtl (`tests/unit/**`), cc, gap | — |
| `D:/Work/Pets/Time2Fest/docs/{site/home.md,site/country.md,site/00-overview.md,backend/frontend-seam.md,backend/content-freshness.md}`, `D:/Work/Pets/Time2Fest/specs/002-backend/waves.md` | Mod | docs-patch | docs | gap | Ukrainian; skill `docs-sync`; grep + range edits only |

**Coverage gaps:** `packages/contracts/test/**`, `lib/presence/**`, `lib/api/site/**`, `lib/player/*.ts` (unrouted `.ts`: apply fui radius rules by analogy), `server/src/admin/**/*.tsx` (propose `react-best-practices`), `server/test/**`, `fakes/**`, `tests/e2e/**`, migrations and `payload-types.ts` (generated), `scripts/contract-surface.baseline.json`, `messages/*.json`, every `*.md` and the docs patch.

## Contract changes

- **Shared contracts / schemas:** yes, additive, one copy in `packages/contracts`; `lib/api/contracts/live.ts` re-exports. New: `StreamSourceSchema`, `StreamChainSchema`, `StreamEventSchema` (`chain|source|hide`, `version` required on the wire), `ChainsResponseSchema {version, at, chains}`, `ViewerSummarySchema {countries[{iso,name,flagCode}], people?, at}`, `SourceErrorReportSchema {eventId, sourceId, code ∈ SOURCE_ERROR_CODES}`, `LiveActionBodySchema` (discriminated `hide|unhide|main|override|zone-live|replace`, `reason` 1…200), `LiveDoorBodySchema`, `LiveArchiveRowSchema {videoId, label, order, decision}`; constants `LIVE_STREAMS_CLASS`, `LIVE_VIEWERS_CLASS`, `LIVE_R2_KEYS.chains = 'live/chains.json'`, `LIVE_CACHE_TAG = 't2f-live-chains'`, `SOURCE_ERROR_CODES = [2,5,100,101,150,153]`; pure `applyStreamEvent` with version and `hide` (moved from `lib/api/contracts/live.ts:58-70`); zod-free `parseChainsResponse`, `parseStreamEvent`, `parseViewerSummary`. `SiteSwitches.viewersCount` (default `true`) and `isEnabled({kind:'switch', key:'viewersCount'})`. `PublicRoute` gains `cacheTag` and `redButton` becomes optional; new row `live-chains` (`/api/live/chains`, `allowedParams: []`, `freshMs 10_000`, `staleMs 600_000`, `r2Copy 'live/chains.json'`, `cacheTag 't2f-live-chains'`, no red button); the site row gets `cacheTag 't2f-site-state'`.
- **Migration:** yes → collections `stream-sources` (natural key `sourceId` unique; `eventId` indexed; platform `youtube|iframe-official|hls|none`; kind; label; name; order; `startsAt`; status; `embeddable`; `privacyStatus`; `liveBroadcastContent`; `scheduledStartTime`, `actualStartTime`, `actualEndTime`; `ytFetchedAt`; `lastChecked`; `nextOffWindowCheckAt`; `override` select nullable; `hidden` + `hiddenReason`; `dead` + `deadReason`; `longNews`; `rights` / `evidence` text; `geo` json; `adminEditedAt`), `live-quota` (`day` PT date + `bucket` unique pair, `used` int, `alarm80At`, `exceededUntil`), global `live-state` (`version` int default 1, `at`, `lastFannedOut` int default 0, `zoneLive` json, `pendingChecks` json). Generated by `pnpm --dir server migrate:create live`, then `node server/scripts/fix-migration-down.mjs <file>` (`server/package.json:21`); CREATE only; the `siteState.switches` default change lands in the same generated file if Payload emits it. Sorts after `20261120_165256_site_state`; L re-checks numbering after the rebase.
- **Seed / fixture data:** yes → seed row `live-1-stream-sources` = `import chains --apply` on an empty DB from `data/streams.json` (AC-70); the door `reset` reseeds it; the viewers fixture door gives the integration build the sim values (people 12 480, the 140 sim countries `lib/presence/viewers.ts:13,22-27`, each ≥3) so the boards match.
- **Build-only failures:** yes, three. (1) `centrifuge` in a bundle without `NEXT_PUBLIC_REALTIME_URL` (the viewer-presence code must reach the transport only through the existing lazy path) — `check-bundle` in web `full` and the prelaunch run in L. (2) zod in the site bundle through `@time2fest/contracts/schemas` from `lib/**` — banned; use `liveGuard.ts`. (3) The Worker importing the changed `publicRoutes.ts` by relative path — caught by the workerd harness file (WE3).
- **Wire contract:** yes → public `GET /api/live/chains`; `GET /api/live/viewers`; `GET /api/live/viewer-token` (new, private, rate-limited; mechanism of [П-1]/[П-2], recorded in §3.11 of the seam); `POST /api/live/source-errors`; `/cms-api/live/{view,hide,unhide,main,override,zone-live,replace}`; events on `live:streams` (`chain`, `source`, `hide` with `version`) and `live:viewers` (`ViewerSummary`); R2 `live/chains.json`; door `POST /api/_test/live`. cc: `live` suite on sim (W43) and http (L), `contract-surface --check`, §3.11 rows in W54.
- **Layout fidelity:** yes — `live` switches sim → http in the integration build and three components render a new text. L: `layout-fidelity` on home and country live boards, http build, doors set viewers and video states; only boards showing the q4 line may differ, and those are re-captured (AC-78).
- **Payload migration:** yes (see Migration) → `migration-safety` in W7, numbering again in L.
- **Test doors:** yes → `POST /api/_test/live` (`video-status`, `quota`, `viewers`, `hide`, `reset-live`); the stub row `video-status` (`test-doors/registry.ts:147`) becomes the real door; `doors-gating.test.ts` and `doors-404.e2e.ts` gain rows; L runs the production-class `doors-404` e2e.
- **Agent write surface:** no new agent path; agents are refused on `/cms-api/live/*` and have no path to `live hide` — AC-56 covers it. `security-reviewer` runs anyway.
- **Seed and fixtures:** yes (see Seed / fixture data) → skill `seed-and-fixtures` in W37 and L.

## Work items

Conventions for every item:
- **Verify (<pkg>)** = the config `files` command of that package in its `dir` (`.claude/sdd-engineering.json`), with the item's files.
- **One integration file** = `cd server && node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>` (stack up per `local-stack`, this worktree's slot and DBs, migrated and seeded). Never `pnpm` after `--` on Windows. The fake YouTube is started by the test itself on port 0 and passed as `T2F_YOUTUBE_BASE_URL`.
- Log / alarm codes exactly as the spec: `live/publish-failed`, `live/purge-skipped`, `live/purge-failed`, `live/r2-copy-failed`, `live/override-kept`, `live/quota-80`, `live/quota-exceeded`, `live/statuses-stale`. No log line carries a key, a token, an IP, one person's country, a Centrifugo client id, or a reason longer than 200 chars.
- Time only from the injected clock (SPEC-07 test clock in int tests); never `Date.now()` in `domain/**` or `live/**`.

### W1 — Live wire types, schemas, guard, pure event rule (C1)
- **Serves:** AC-1, AC-4, AC-17, AC-18, AC-75, NFR-2 (enables AC-16).
- **Do:** `live.ts` (zod-free types and constants of Contract changes; `StreamSource` / `StreamChain` mirror `lib/data/types.ts:89-129`), `live.schemas.ts` (schemas of Contract changes; `SourceErrorReportSchema` code enum; archive row), `liveGuard.ts` (import-free parsers with the same rules), `liveRules.ts` (`applyStreamEvent(chains, event, lastVersion)` → `{chains, version}`: older version → same map; `hide` removes the source; `chain` replaces; `source` replaces by id); re-export from `schemas.ts` / `index.ts`. The `chains()` interface without a parameter lives in `lib` (W40).
- **Files:** `packages/contracts/src/{live,live.schemas,liveGuard,liveRules,schemas,index}.ts`.
- **Done means:** contracts `tsc` green; W2 tests green.
- **Verify:** contracts `files`.
- **Rules that apply:** cc → additive, one copy; onion → `index.ts` and `liveGuard.ts` import nothing with runtime weight.
- **Risk:** low.

### W2 — Contracts tests and surface baseline (C1)
- **Serves:** AC-1, AC-17, AC-18, AC-75, NFR-2.
- **Do:** `test/live.test.ts`: every chain of `data/streams.json` passes `ChainsResponseSchema` and the guard; 12 malformed cases refused identically by schema and guard; `applyStreamEvent` older version / `hide` / unknown source; `LiveArchiveRowSchema` has no YouTube field; a serialized `chain` event with 10 sources ≤65 536 bytes and a response of 300 events × 10 sources ≤524 288 bytes. Then `node scripts/contract-surface.mjs --update` and `--check`.
- **Files:** `packages/contracts/test/live.test.ts`, `scripts/contract-surface.baseline.json`.
- **Done means:** contracts `files` green; `contract-surface --check` exit 0 with only additions in the baseline diff.
- **Verify:** contracts `files`; `node scripts/contract-surface.mjs --check` (root).
- **Rules that apply:** cc §4 → additive only.
- **Risk:** low.

### W3 — `viewersCount` switch in the contract (X2)
- **Serves:** AC-66.
- **Do:** `SiteSwitches.viewersCount: boolean`; `SiteSwitchesSchema` `viewersCount: z.boolean().default(true)`; `siteGuard` fills `true` when absent; `SiteSwitchKeySchema` and `IsEnabledTarget` switch key `viewersCount`; `isEnabled` returns the value; rows in `isEnabled.table.ts`; `site.test.ts` case "snapshot without the key parses with true". Baseline `--update`.
- **Files:** `packages/contracts/src/{site,site.schemas,siteGuard,siteRules}.ts`, `packages/contracts/test/{isEnabled.table,site.test}.ts`, `scripts/contract-surface.baseline.json`.
- **Done means:** contracts `files` green; surface `--check` green.
- **Verify:** contracts `files`.
- **Rules that apply:** cc → additive (the default keeps old snapshots valid).
- **Risk:** see Spec follow-up 3.

### W4 — Server default and admin label for `viewersCount` (X2)
- **Serves:** AC-66.
- **Do:** `SWITCH_KEYS` and `DEFAULT_SWITCHES` gain `viewersCount: true` (`server/src/domain/site/switches.ts:19,49`); global default (`globals/siteState.ts:19-25`); `BOOLEAN_KEYS` (`admin/SiteStateView.tsx:32`) and the label `'Число людей біля плеєра'` in `SITE_SWITCH_LABELS` (`admin/messages.ts:43`); reading the stored `switches` json merges over the defaults so a row without the key reads `true` (to confirm where `adapters/payloadSiteState.ts` parses). Extend `site-admin.int.test.ts` with one case: toggle `viewersCount` with a reason → journal row, snapshot `false`.
- **Files:** `server/src/domain/site/switches.ts`, `server/src/globals/siteState.ts`, `server/src/adapters/payloadSiteState.ts` (if the merge is needed), `server/src/admin/{SiteStateView.tsx,messages.ts}`, `server/test/integration/site-admin.int.test.ts`.
- **Done means:** server `files` green; the int file green.
- **Verify:** server `files`; one integration file `site-admin.int.test.ts`.
- **Rules that apply:** onion; ms → the global default change goes into W7's generated migration (no hand-written SQL).
- **Risk:** low.

### W5 — Site build snapshot and test fixtures (X2)
- **Serves:** AC-66.
- **Do:** `viewersCount: true` in `lib/api/site/buildSnapshot.ts:23`; literal switch objects in `tests/unit/api/{site-hooks.test.tsx,site-http.test.ts,site-sim.test.ts}` (`:18`, `:27`, `:30`) and `tests/unit/api/site-isenabled.test.ts` gain the key; `site-isenabled.test.ts` asserts `isEnabled(…, viewersCount)` both ways.
- **Files:** `lib/api/site/buildSnapshot.ts`, those four test files.
- **Done means:** web `files` green on those files.
- **Verify:** web `files`.
- **Rules that apply:** fui → no new module.
- **Risk:** low.

### W6 — Collections `stream-sources`, `live-quota`, global `live-state` (S3)
- **Serves:** AC-8, AC-73 (enables AC-5, AC-9, AC-31, AC-54).
- **Do:** fields of Contract changes; `access`: read owner only, create/update/delete never through REST (writes go through `live/**` services with the Payload local API); `stream-sources.platform` select accepts the four types (only `youtube` is ever public, W8); registry rows sorted.
- **Files:** `server/src/collections/{streamSources,liveQuota}.ts`, `server/src/globals/liveState.ts`, `server/src/registries/{collections,globals}.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server `files`.
- **Rules that apply:** ms; onion → no rule in hooks.
- **Risk:** low.

### W7 — Generated migration, types, migration safety (S3)
- **Serves:** enables every server AC (schema).
- **Do:** `pnpm --dir server migrate:create live`; `node server/scripts/fix-migration-down.mjs <file>`; `pnpm --dir server generate:types`; `migration-safety` checks 1–4 and 6 (in `server/`: `node scripts/db.mjs migcheck up` → `migrate` → `migrate:down` → `migrate` on the migcheck DB → `node scripts/db.mjs migcheck drop`; `node scripts/verify-schema.mjs`); extend `payload-schema.int.test.ts` if it lists tables (to confirm).
- **Files:** `server/src/migrations/<ts>_live.{ts,json}`, `server/src/migrations/index.ts`, `server/src/payload-types.ts`, `server/test/integration/payload-schema.int.test.ts` (to confirm).
- **Done means:** the check lines in the phase report, all pass; grep of the new file finds no `DROP` / `ALTER … TYPE` / `TRUNCATE` / `DELETE` in `up`.
- **Verify:** server `files`; the migcheck sequence above.
- **Rules that apply:** ms 1–6.
- **Risk:** the migcheck database is the only one created/dropped; never the main DBs.

### W8 — Live domain: config, moment and windows, status mapping, public chain (S4)
- **Serves:** AC-8, AC-9, AC-10, AC-25, AC-26, AC-27, AC-29, AC-30, AC-57, AC-58, AC-74.
- **Do:** `config.ts`: `LIVE_DEFAULTS` with every number of [А8] (bucket day/minute limits, units per `list` call 1, B = 50, tick 30 s, window ±1 h, ad-hoc ceiling 500, reserve 1 000, alarm 80 %, day TZ `America/Los_Angeles`, long news −20/+15 min, off-window 6 h / 7 days, stale 2 min, retention 30 days, rehearsal sub-budget 1 000, blackout 29.12–01.01) + `parseLiveConfig(json)` (zod, partial override). `moment.ts`: event moment = `startsAt` for non-midnight slots else `midnightUtc` (`collections/catalog/events.ts:28,33-34`), with the `eventPatches` moment (SPEC-08) applied; `isWindowOpen(moment, now, cfg)` (−1 h inclusive, +1 h exclusive); `hidden` patch → excluded. `status.ts`: the [А20] table and the −5 min rule. `chain.ts`: public chain = youtube only, not hidden, not dead, embeddable, public, `ytFetchedAt` within retention, long-news window, ordered; `override` wins over the poller; zone-live wins until its `until`. `schedule.ts`: open-window ids deduplicated and batched ⌈A/B⌉; next off-window check time in [6 h, 7 days].
- **Files:** `server/src/domain/live/{config,moment,status,chain,schedule}.ts`.
- **Done means:** server `tsc` green; W11 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 1 (pure, time a parameter); AC-37 → numbers only in `config.ts`.
- **Risk:** moment rules must equal the site's (`lib/data/patched.ts`); reuse `@time2fest/rules` helpers if they cover it (check with `graphify explain` on the moment helper).

### W9 — Quota domain (S4)
- **Serves:** AC-31, AC-32, AC-33, AC-34, AC-36, AC-37, AC-40, AC-44, NFR-1.
- **Do:** `quota.ts`: `quotaDay(now, tz)` (01.01 boundary 08:00 UTC); `charge(state, bucket, units)` (a failed call counts ≥1); `allow(state, class, cfg)` with the class order open-window statuses → ad-hoc → candidates → playlists → search, only the first below the reserve; search ceiling → `quota-exhausted` decided before any request; 80 % crossing once per day per bucket; `exceededUntil` = next day boundary; rehearsal + real sub-budget and blackout refusal; stale rule (`page` in an open window after 2 min without a fresh check, `log` outside).
- **Files:** `server/src/domain/live/quota.ts`.
- **Done means:** server `tsc` green; W11 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 1.
- **Risk:** DST in `America/Los_Angeles` — compute with `Intl`, test both boundaries.

### W10 — Viewers aggregate (S4)
- **Serves:** AC-60, AC-61, AC-62, NFR-6.
- **Do:** `viewers.ts`: `aggregate(entries, switches, countries)` over presence entries `{chanInfo}`: `people` = entries with `p === 1`; countries with ≥3 such entries and a valid ISO (`XX`, `T1`, absent excluded), mapped to `{iso, name (uk), flagCode}` and ordered by catalog popularity (the same order as `simulatedViewers`, `lib/presence/viewers.ts:22-27`); `viewersMap` off → `[]`; `viewersCount` off → no `people`. One pass over the entries.
- **Files:** `server/src/domain/live/viewers.ts`.
- **Done means:** server `tsc` green; W11 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 1.
- **Risk:** low.

### W11 — Live domain unit tests (S4)
- **Serves:** AC-8, AC-25, AC-26, AC-27, AC-31 … AC-34, AC-37, AC-40, AC-57, NFR-1, NFR-6.
- **Do:** `live-domain.test.ts` (model fields; `hls` never public; batching 30 → 1, 75 → 2, a shared id once; 14-day off-window intervals within [6 h, 7 d]; the [А20] table; long news −20:01 / −20:00 / +14:59 / +15:00 with a patched moment); `live-quota.test.ts` (07:59:59 vs 08:00:00 UTC 01.01; a 400 counted; reserve 999 vs 5 000 order; search 101st refused; 8 000 → one alarm, 8 500 none, new day again; rehearsal 1 001st unit and 30.12 refused; each config key changes behaviour; a grep assertion over `src/domain/live/*.ts` except `config.ts` and over `src/live/*.ts` for the forbidden literals); `live-nfr1.test.ts` (scheduler simulation over `data/schedule.json` with seed chains multiplied to 10 ids per event, test clock: each quota day ≤8 000 and within ±1 % of the formula); `live-viewers.test.ts` (PL×3, DE×2 → PL; switches ×4; 30 000 entries <100 ms).
- **Files:** `server/test/unit/{live-domain,live-quota,live-nfr1,live-viewers}.test.ts`.
- **Done means:** the four files green via server `files`.
- **Verify:** server `files`.
- **Rules that apply:** onion → ring 1 tested without DB.
- **Risk:** NFR-1 must reuse `schedule.ts`, not a copy of the formula.

### W12 — YouTube fake (S5)
- **Serves:** AC-71 (enables AC-24 … AC-36, AC-39, AC-43 … AC-45, AC-55, AC-72 … AC-75).
- **Do:** `fakes/youtube/server.mjs` like `fakes/ai/server.mjs` (node:http, `// @ts-check`, export `startFakeYoutube({port:0})`): `GET /youtube/v3/videos?id=…&part=…&fields=…` → items per the state set through `POST /_control/videos` (`live`, `upcoming` + `scheduledStartTime`, `ended`, `none`, `private`, `deleted`, `embeddable:false`); >50 ids → 400; `POST /_control/quota {bucket:'queries'|'search', exceeded}` → 403 `quotaExceeded` for that bucket (`GET /youtube/v3/search` exists only to be refused/counted); `GET /_control/calls` → counters per path, requested ids and `part`; `POST /_control/down {on}`. README: how to start it; never in compose.
- **Files:** `fakes/youtube/server.mjs`, `fakes/youtube/README.md`.
- **Done means:** W13 fake tests green.
- **Verify:** server `files` on the W13 test files.
- **Rules that apply:** sf §3 → only video ids already in `data/streams.json`.
- **Risk:** low.

### W13 — Status port, real and fake adapters, port suite (S5)
- **Serves:** AC-33, AC-39, AC-71, AC-75, NFR-3.
- **Do:** `live/ports.ts`: `VideoStatusSource.list(ids) → {items} | {error:'quota-exceeded'|'unavailable'|'invalid'}`, `SearchSource` (counter only), `LiveStore`, `QuotaStore`, `PresenceSource`, `LiveLease`. `adapters/youtubeData.ts` ([П-4]: base URL injectable, `X-Goog-Api-Key` header, `fields` mask, timeout, maps 403 `quotaExceeded` per bucket, never logs a URL, key or body). `adapters/youtubeFake.ts` (same mapping, no key). Tests: `fake-youtube.test.ts` (every state, 51 ids, both `quotaExceeded`, counters); `youtube-port.test.ts` runs one suite against both adapters pointed at the fake (states, 50-id batch, quota error, `part` / `fields` never contain `statistics`, no title in the mapped item).
- **Files:** `server/src/live/ports.ts`, `server/src/adapters/{youtubeData,youtubeFake}.ts`, `server/test/unit/{fake-youtube,youtube-port}.test.ts`.
- **Done means:** server `files` green on these files.
- **Verify:** server `files`.
- **Rules that apply:** onion → the port names the conversation, no vendor types; sec → key from env only, in a header, never logged.
- **Risk:** low.

### W14 — Env names, config, network guard, CI check (S5)
- **Serves:** AC-37, AC-38, NFR-3, NFR-5.
- **Do:** block `live` in `registries/env.ts`: `T2F_YOUTUBE_API_KEY` (`secret: true`, optional, never required), `T2F_YOUTUBE_BASE_URL` (`z.url()` optional), `T2F_LIVE_CONFIG` (optional JSON through `parseLiveConfig`). Names in `server/.env.example`. `test/support/noYoutubeNetwork.ts`: wraps `globalThis.fetch` and `node:http(s).request` to throw on hosts matching `googleapis.com` / `youtube.com`; added to `setupFiles` of `vitest.config.ts` and `vitest.integration.config.ts`. `live-env.test.ts`: env parses in `test` / `rehearsal` / `production` without any of them; exactly one registry name matches `/YOUTUBE.*KEY/` and it is `secret`; no list/rotation names; a fetch to `https://www.googleapis.com/youtube/v3/videos` throws in tests. Workflow check: `.github/workflows/verify.yml` contains no `YOUTUBE` (in `infra/ops/test/workflow.test.mjs` if it already parses workflows — to confirm; else a case in `live-env.test.ts` reading the file).
- **Files:** `server/src/registries/env.ts`, `server/.env.example`, `server/test/support/noYoutubeNetwork.ts`, `server/vitest.config.ts`, `server/vitest.integration.config.ts`, `server/test/unit/live-env.test.ts`, (`infra/ops/test/workflow.test.mjs`).
- **Done means:** server `files` green; ops `files` green if touched.
- **Verify:** server `files`; ops `files`.
- **Rules that apply:** sec → secret flagged, names only.
- **Risk:** the guard must not block loopback fakes.

### W15 — Payload live adapter: store, quota counters, lease (S6)
- **Serves:** AC-5, AC-31 (enables AC-24 … AC-36, AC-43, AC-51 … AC-55).
- **Do:** `adapters/payloadLive.ts` implements `LiveStore` (read sources by event/ids; `applyChecks(tx, results)`; every write that changes a public chain bumps `live-state.version` under a row lock in the same tx and emits one internal event `live.changed {version, eventIds, hidden?: [{eventId, sourceId}]}` through the events outbox, like `site/service.ts`), `QuotaStore` (`charge(day, bucket, n)` = one `UPDATE … SET used = used + n … RETURNING used` with insert-if-missing; `markExceeded`, `mark80`), `pendingChecks` add/claim (conditional update), and `LiveLease` over the Postgres scheduler stores with lease names `live-poller` / `live-viewers` (`pgScheduler.ts:55`; to confirm the factory name).
- **Files:** `server/src/adapters/payloadLive.ts`.
- **Done means:** server `tsc` green; W19 proves behaviour.
- **Verify:** server `files`.
- **Rules that apply:** onion → rows never leave the adapter; one tx per change.
- **Risk:** two concurrent changes must get distinct versions (row lock on `live-state`).

### W16 — Poller tick (S6)
- **Serves:** AC-9, AC-10, AC-24, AC-25, AC-28, AC-30, AC-34, AC-35, AC-36, AC-43, AC-44, AC-54, AC-58.
- **Do:** `live/poller.ts` `tickLive(deps, now)`: only the lease holder runs; every 5 s it handles `pendingChecks` (≤10 s; skip ids already in this 30-s tick; ad-hoc ceiling); every 30 s: open-window ids (W8; hidden patches excluded) → `allow` (W9) → batches → port → [А20] mapping → `applyChecks` (override kept + one `live/override-kept` line; zone-live until window end) → the −5 min rule; off-window due ids when the reserve allows; `quota-exceeded` → stop the bucket till the day boundary, one `live/quota-exceeded`; 80 % → one `page` alarm; stale rule → `live/statuses-stale` (`page` in a window, `log` outside). Every call is charged before its response is read (failed calls count).
- **Files:** `server/src/live/poller.ts`.
- **Done means:** server `tsc` green; W19 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 3; sec → no id list or key in logs.
- **Risk:** the tick must never overlap itself (skip while the previous run is in flight).

### W17 — 30-day retention (S6)
- **Serves:** AC-73, AC-74.
- **Do:** `live/retention.ts`, a daily job under the poller lease: for every source whose `ytFetchedAt` is older than 30 days, try one `videos.list` refresh (counted, within the reserve); on failure clear every YouTube field (status inputs, times, `privacyStatus`, `embeddable`, `ytFetchedAt`) — the public chain then drops it (W8); journal rows of this wave carry only our fields (videoId, label, order, decision), never YouTube values; a resulting chain change goes through the normal fan-out, so the R2 copy is rewritten.
- **Files:** `server/src/live/retention.ts`.
- **Done means:** server `tsc` green; W19 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 3.
- **Risk:** low.

### W18 — Container wiring and the poller ticker (S6)
- **Serves:** AC-39 (enables every server live AC).
- **Do:** `Deps.live?` built in `container.ts` (store, quota, lease, adapter chosen by `youtubeAdapterFor(cls)` = fake for every class; no adapter and no poller without `T2F_YOUTUBE_BASE_URL`); `startLivePoller(deps)` with `startTicker` (`unattended/ticker.ts:21`) every 5 s, started only in `startProcessBackground` (`container.ts:628`); a failing tick → `log` alarm with a code only (as `startRebuildTicker`, `:550-563`). `endpoints/deps.ts` `liveOf`; `endpoints/types.ts` `Deps.live?`.
- **Files:** `server/src/container.ts`, `server/src/endpoints/{types,deps}.ts`.
- **Done means:** server `tsc` green; existing `scheduler-service` / `platform` unit tests green.
- **Verify:** server `files`.
- **Rules that apply:** onion → the composition root is the only place that names adapters.
- **Risk:** `container.ts` is shared by several phases — additive edits only.

### W19 — Poller, quota, retention integration tests (S6)
- **Serves:** AC-9, AC-10, AC-24, AC-28 … AC-30, AC-35, AC-36, AC-39, AC-58, AC-73, AC-74.
- **Do:** `live-poller.int.test.ts` (fake + test clock: 10 min in a window, `lastChecked` never older than 30 s; −5:30 `expected`, after −5 `possible`; `embeddable:false` → gone; main `ended` → next first, all dead → `[]`; override `live` vs fake `ended` → kept + line; `hidden` patch → no chain and the fake never asked its ids; Paris 22:50 UTC: `startsAt` equal, polled 21:50–23:50 only, not in the midnight slot; every class config selects the fake); `live-quota.int.test.ts` (`quotaExceeded` at 20:00 UTC 31.12 → zero calls until 08:00 UTC 01.01, statuses unchanged, `page` stale alarm before 20:04; no windows → `log` only); `live-retention.int.test.ts` (+31 days without checks: no YouTube field older than 30 days in DB, journal, `live/chains.json` stub; source absent; the first good check returns it).
- **Files:** `server/test/integration/{live-poller,live-quota,live-retention}.int.test.ts`.
- **Done means:** the three files green.
- **Verify:** one integration file each.
- **Rules that apply:** sf → only seed ids.
- **Risk:** clock jumps must drive the tick deterministically (call `tickLive` directly, not the real ticker).

### W20 — Public chains snapshot reader (S7)
- **Serves:** AC-3, AC-5, AC-10.
- **Do:** `live/snapshot.ts` `readChains(deps, now)` → `{version, at, chains}` built by W8 `chain.ts` over the store, events with sources only, `hidden` events excluded; used by the route, the fan-out and the R2 copy so the three are byte-identical.
- **Files:** `server/src/live/snapshot.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 3.
- **Risk:** low.

### W21 — After-commit fan-out: publish, purge, R2 (S7)
- **Serves:** AC-5, AC-6, AC-7, AC-14, AC-15.
- **Do:** `live/fanout.ts` copying `site/fanout.ts:1-60`: subscriber of `live.changed` (and of `event-patch.changed`, since a moment or `hidden` patch changes chains); claim `version > lastFannedOut` on `live-state`; publish one `chain` event per changed event and one `hide` event per hidden source on `live:streams` with the version; `unavailable` / `rejected` → one `warn` `live/publish-failed {version}`; purge via `createCfPurge({…, tag: LIVE_CACHE_TAG})` at 0/30/120 s, no settings → one `info` `live/purge-skipped`, third failure → `log` alarm `live/purge-failed`; R2 `<prefix>live/chains.json` = the `readChains` body at 0/30/120/300 s (a retry re-reads, writes only a version ≥ the one copied), fourth failure → `page` alarm `live/r2-copy-failed`. `cfPurge.ts` gains `tag` (default `SITE_CACHE_TAG`). Subscriber rows sorted in `registries/subscribers.ts`.
- **Files:** `server/src/live/fanout.ts`, `server/src/adapters/cfPurge.ts`, `server/src/registries/subscribers.ts`.
- **Done means:** server `tsc` green; W22 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** onion; sec → token never logged.
- **Risk:** AC-5's 1 s depends on the delivery loop's wake (as SPEC-08); W22 reports p95.

### W22 — Fan-out integration tests (S7)
- **Serves:** AC-5, AC-6, AC-7, AC-14, AC-15.
- **Do:** `live-fanout.int.test.ts`: a subscriber receives the new version ≤1 s after commit; two concurrent changes → two increasing versions; forced rollback → 0 publish/purge/R2; publisher refusing (or Centrifugo stopped) → the route shows the new version, one `live/publish-failed`; purge fake: one request with tag `t2f-live-chains`, no variable → the line, refusing → 3 attempts + one alarm (short schedules injected); R2 stub content = the route body, refusing → 4 attempts + one alarm.
- **Files:** `server/test/integration/live-fanout.int.test.ts`.
- **Done means:** green; AC-5 p95 in the report.
- **Verify:** one integration file.
- **Rules that apply:** —
- **Risk:** low.

### WE1 — Edge: cache tag per route, optional red button (E)
- **Serves:** AC-11, AC-12, AC-13.
- **Do:** `PublicRoute` gains `cacheTag: string` and `redButton?: string` (`packages/contracts/src/publicRoutes.ts`); the site row gets `cacheTag: 't2f-site-state'`; `publicCache.ts` stores `Cache-Tag: <route.cacheTag>` and reads the red button only when the row names one (`:78`). Freshness / stale / R2 / 503 logic unchanged — the live row's `staleMs 600_000` gives AC-13's 10 minutes.
- **Files:** `packages/contracts/src/publicRoutes.ts`, `workers/edge/src/publicCache.ts`.
- **Done means:** edge `files` and contracts `files` green; existing site-route edge tests unchanged and green.
- **Verify:** edge `files`; contracts `files`.
- **Rules that apply:** sec → no `cf:` cache options, no `[cache]`; fail-closed origin unchanged (`handler.ts:41-44`).
- **Risk:** the site route must behave exactly as before.

### WE2 — Edge tests for a live-like route (E)
- **Serves:** AC-12, AC-13.
- **Do:** in `public-cache.test.ts` (Node, injected cache/bucket/clock), with a route row equal to the planned live row (a local constant, since the row lands in W23): 100 requests in 10 s → 1 origin call; at 11 s the stale copy is served, then the new one; origin 530: at 9:59 the cache, at 10:01 R2 with `x-t2f-source: r2`, without R2 → 503; no red-button read for a row without one; `Cache-Tag` from the row.
- **Files:** `workers/edge/test/public-cache.test.ts`.
- **Done means:** edge `files` green.
- **Verify:** edge `files`.
- **Rules that apply:** sec (workers/**).
- **Risk:** low.

### W23 — Route `GET /api/live/chains` and the public-list row (S8)
- **Serves:** AC-3, AC-11.
- **Do:** `endpoints/liveChains.ts` as `endpoints/siteState.ts` (`public: true`, `needs: ['db']`, rate limit `live-read` 600/min per `ipDay`, `onStoreDown: 'memory'`), body `readChains`, `Cache-Control: public, max-age=10`, query ignored; 503 `unavailable` `no-store` when unreadable. Row `live-chains` in `PUBLIC_ROUTES` (values in Contract changes). `routes.ts` and `rateLimits.ts` rows sorted. `public-routes.test.ts` (server unit) green with the new row.
- **Files:** `server/src/endpoints/liveChains.ts`, `packages/contracts/src/publicRoutes.ts`, `server/src/registries/{routes,rateLimits}.ts`, `server/test/unit/public-routes.test.ts`.
- **Done means:** server `files` and contracts `files` green.
- **Verify:** server `files`; contracts `files`.
- **Rules that apply:** sec → the public route carries no subject data; the pipeline drops `Set-Cookie`.
- **Risk:** low.

### W24 — Route `POST /api/live/source-errors` (S8)
- **Serves:** AC-42, AC-43, AC-44, AC-45, NFR-4.
- **Do:** `endpoints/liveSourceErrors.ts`: body read bounded to 1 024 bytes, `SourceErrorReportSchema`, code in the list, event and source must exist → else 400 `invalid` with no check; rate limit `live-source-errors` 10/min per `ipDay` → 429; a valid report → added to `pendingChecks` (deduplicated per source, ≤1 per 30 s) and 202 — 202 also above the ad-hoc ceiling; never touches a status.
- **Files:** `server/src/endpoints/liveSourceErrors.ts`, `server/src/registries/{routes,rateLimits}.ts`.
- **Done means:** server `tsc` green; W25 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** sec → untrusted input validated at the boundary, size-limited, rate-limited.
- **Risk:** `ipDay` is the per-address fingerprint (SPEC-05) — the spec's "one IP".

### W25 — Route integration tests (S8)
- **Serves:** AC-3, AC-10, AC-11, AC-42 … AC-45, NFR-4.
- **Do:** `live-route.int.test.ts` (with a session cookie: body passes the schema, chains = events with sources, headers exact, no `Set-Cookie`; `hidden` patch → absent; random params ignored); `live-source-errors.int.test.ts` (the five 400 cases; 5 reports in 20 s → 1 check ≤10 s; a report on an open-window source → 0 extra calls; 100 reports with fake `live` → status `live`; ceiling spent (scaled down via `T2F_LIVE_CONFIG`) → 202 and the fake's count unchanged; the 11th report in a minute → 429).
- **Files:** `server/test/integration/{live-route,live-source-errors}.int.test.ts`.
- **Done means:** both green.
- **Verify:** one integration file each.
- **Rules that apply:** —
- **Risk:** low.

### WE3 — Edge handler and workerd harness with the real live row (E3)
- **Serves:** AC-11, AC-12, AC-13.
- **Do:** `handler.test.ts`: 20 requests to `/api/live/chains?<random>` → 1 origin request without params; `site-cache.worker.test.ts` (workerd harness bundling the real entry): the live path served from cache and from R2 `live/chains.json` with `x-t2f-source: r2`.
- **Files:** `workers/edge/test/{handler,site-cache.worker}.test.ts`.
- **Done means:** edge `files` green.
- **Verify:** edge `files`.
- **Rules that apply:** sec (workers/**).
- **Risk:** the harness cannot fake time — freshness stays in WE2.

### W26 — Presence and subscription tokens in realtime (S9)
- **Serves:** AC-59, AC-61 (enables AC-60).
- **Do:** `ChannelClassRow.presence?: true` (`domain/realtime/channels.ts:29-46`); `centrifugoConfig.ts` sets namespace `presence: true` when any row of the namespace has it (never any `allow_presence_for_*`); `registries/channels.ts` `live:viewers` row `presence: true`. `realtime/ports.ts` `TokenSigner.signSubscription({channel, info, exp})`; `centrifugoToken.ts` signs `{sub:'', channel, info, iat, exp}` HS256 with the same secret (Centrifugo uses `client.token.hmac_secret_key` for subscription tokens unless a separate key is enabled — research). `centrifugoApi.ts` gains `presence(channel)` → `{entries: {chanInfo?}[]}` (timeout as publish, `:14`; `chan_info` accepted as an object or a base64 string), never logs client ids. `realtime-config.test.ts`: `live` has `presence: true`, no namespace has `allow_presence_*`.
- **Files:** `server/src/domain/realtime/{channels,centrifugoConfig}.ts`, `server/src/registries/channels.ts`, `server/src/realtime/ports.ts`, `server/src/adapters/{centrifugoToken,centrifugoApi}.ts`, `server/test/unit/realtime-config.test.ts`.
- **Done means:** server `files` green (incl. the existing realtime tests).
- **Verify:** server `files`.
- **Rules that apply:** sec → algorithm fixed, token never logged; SPEC-06 AC-3 untouched.
- **Risk:** the generated Centrifugo config changes → regenerate the local stack's Centrifugo config (`server/src/cli/realtimeConfig.ts`, skill `local-stack`) before W28.

### W27 — Viewers aggregator and its two routes (S9)
- **Serves:** AC-59, AC-60, AC-61, AC-62, AC-63.
- **Do:** `live/viewers.ts`: lease `live-viewers`; every 30 s (within [30, 60]) reads `presence(live:viewers)` (+ test-only fixture entries, W38), runs `aggregate` (W10) with the current `site` switches, keeps the result in process memory only and publishes it on `live:viewers` (holder only); non-holders answer `GET` from their own cache refreshed on demand at most every 30 s. `endpoints/liveViewers.ts` (`GET /api/live/viewers`, private `no-store`, rate limit `live-read`). `endpoints/liveViewerToken.ts` (`GET /api/live/viewer-token`, private `no-store`, rate limit `live-viewer-token` 30/min per `ipDay`; signs per [П-2]; 503 `realtime-not-configured` without the secret, as `realtime/token.ts:44`). Wiring in `container.ts` (the ticker only in `startProcessBackground`). Nothing written to DB, journal or logs except counts.
- **Files:** `server/src/live/viewers.ts`, `server/src/endpoints/{liveViewers,liveViewerToken}.ts`, `server/src/registries/{routes,rateLimits}.ts`, `server/src/container.ts`.
- **Done means:** server `tsc` green; W28 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** sec → country only via `ctx.client.country`; onion → presence behind a port.
- **Risk:** a 30 000-entry presence reply every 30 s on one instance (a few MB) — acceptable; NFR-6 bounds the aggregation; П-RT may revisit.

### W28 — Viewers integration tests (S9)
- **Serves:** AC-59 … AC-63.
- **Do:** `live-viewers.int.test.ts` against the local Centrifugo: token requests with the edge secret and `x-t2f-client` `ip;UA`, `ip;XX`, none → three Node `centrifuge` clients subscribe with those tokens → countries count only `UA`; 3×PL + 2×DE → `[PL]`, interval of `live:viewers` events within [30, 60] s; 3 token subscriptions + 1 tokenless "second tab" → `people: 3`; close one → `2` within 60 s; four switch combinations; after 100 subscriptions a grep of DB tables, journal and the captured server log for the test IPs and client ids → none; aggregator restart → starts from zero.
- **Files:** `server/test/integration/live-viewers.int.test.ts`.
- **Done means:** green.
- **Verify:** one integration file.
- **Rules that apply:** —
- **Risk:** needs Centrifugo regenerated after W26.

### W29 — Live actions service with journal and revert (S10)
- **Serves:** AC-51, AC-52, AC-53, AC-54, AC-55.
- **Do:** `live/actions.ts`: `hide`, `unhide` (revert), `makeMain`, `override` (sets `override`), `zoneLive` (writes `zoneLive[zoneId] = {until: window end}`), `replace` (adds a `possible` youtube source with the videoId and `adminEditedAt`, enqueues one ad-hoc check); each in one tx: change + version bump + `live.changed` + journal row `{actor (owner | operator), reason ≤200, before/after}`; revert handlers `live.hide`, `live.main`, `live.override`, `live.zone-live`, `live.replace` in `registries/revertHandlers.ts` (one step). Actor kinds `owner` and `operator`; agent roles refused.
- **Files:** `server/src/live/actions.ts`, `server/src/registries/revertHandlers.ts`, `server/src/adapters/payloadRevert.ts` (if handlers live there — to confirm).
- **Done means:** server `tsc` green; W32 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 3; sec → reason is text, ≤200.
- **Risk:** the zone-live revert must restore the previous statuses exactly.

### W30 — `/cms-api/live/*` owner endpoints (S10)
- **Serves:** AC-50, AC-51, AC-53, AC-56, AC-58.
- **Do:** move `isOwner`, `boundedText`, `fail` and the JSON content-type check from `admin/cmsEndpoints.ts:43-60` into `admin/cmsHttp.ts` (no behaviour change); `admin/liveEndpoints.ts`: `GET /cms-api/live/view` (live sources of the current and next midnight slot — non-midnight events excluded per AC-58 —, the available actions, three quota buckets with used / % / reset time UTC) and `POST /cms-api/live/{hide,unhide,main,override,zone-live,replace}` with `LiveActionBodySchema`, owner only, ≤1 KB, JSON; refusals `invalid` / `forbidden` / `not-found`; `cmsEndpointsFor` appends them in every class.
- **Files:** `server/src/admin/{cmsHttp,liveEndpoints,cmsEndpoints}.ts`.
- **Done means:** server `files` green incl. `cms-endpoints.test.ts`.
- **Verify:** server `files`.
- **Rules that apply:** sec → deny by default, Access gate + role, size limit before parse.
- **Risk:** the helper move must not change SPEC-07/08 endpoints (their tests stay green).

### W31 — Operator command `live hide` (S10)
- **Serves:** AC-52.
- **Do:** `cli/live.ts`: `live hide <eventId> <sourceId> --reason <text>` → `actions.hide` with actor `{kind:'operator'}`; a missing reason or unknown ids → exit code ≠0 and a one-line message; script `"live": "tsx src/cli/live.ts"` in `server/package.json` (run as `pnpm run live hide …`).
- **Files:** `server/src/cli/live.ts`, `server/package.json`.
- **Done means:** server `tsc` green.
- **Verify:** server `files`.
- **Rules that apply:** sec → no secret in output; only on the node (no HTTP surface).
- **Risk:** low.

### W32 — Actions, endpoints and command integration tests (S10)
- **Serves:** AC-51 … AC-56.
- **Do:** `live-admin.int.test.ts`: hide → `hide` event + journal row, revert → back with a new version; main / override and their reverts; zone-live with the test clock (after the window end statuses come from the poller again; revert restores at once); replace → the fake gets exactly one request for that id ≤10 s, the source is in a `chain` event; `content-agent`, `stream-agent`, no login, a 1 025-byte body → refused, state unchanged. `live-cli.int.test.ts`: the command in class `test` → `hide` event ≤1 s, journal actor «оператор», revert through the cms endpoint returns the source; no reason → exit ≠0.
- **Files:** `server/test/integration/{live-admin,live-cli}.int.test.ts`.
- **Done means:** both green.
- **Verify:** one integration file each.
- **Rules that apply:** —
- **Risk:** low.

### W33 — Admin slice «Ефір» (S11)
- **Serves:** AC-50.
- **Do:** `LiveSlice.tsx` (loads `/cms-api/live/view`, boundary like `SiteStateSlice.tsx`), `LiveView.tsx` (sources of the current/next slot with the five actions — each asks a reason — and the three buckets with used, %, reset time UTC; reasons shown as text), Ukrainian strings in `admin/messages.ts`; slot row `{ key: '15-live', order: 15, label: 'Ефір', … }` in `registries/adminSlots.ts` (first screen, after the festival state).
- **Files:** `server/src/admin/{LiveSlice,LiveView}.tsx`, `server/src/admin/messages.ts`, `server/src/registries/adminSlots.ts`.
- **Done means:** server `tsc` green; W34 green.
- **Verify:** server `files`.
- **Rules that apply:** react (proposed for admin tsx) → derive, don't store; sec → React escaping only.
- **Risk:** low.

### W34 — Slice unit test (S11)
- **Serves:** AC-50.
- **Do:** `live-slice.test.ts` renders `LiveView` with fake-derived data: sources, five action buttons, three buckets with % and reset time; the admin-slots registry lists `15-live`.
- **Files:** `server/test/unit/live-slice.test.ts`, `server/test/integration/admin-slots.int.test.ts` (only if it pins the list — to confirm).
- **Done means:** server `files` green.
- **Verify:** server `files`.
- **Rules that apply:** rtl → user-visible assertions.
- **Risk:** low.

### W35 — `import chains` (S12)
- **Serves:** AC-9, AC-68, AC-69.
- **Do:** `live/import.ts` like `catalog/import.ts`: reads `data/streams.json` through `ctx.readSource`, plans add / change / unchanged / skipped-admin-edited (sources with `adminEditedAt` or `override`); a dry run prints the report and writes nothing (DB, journal, R2); `--apply` writes in one tx with one version bump and one `live.changed`; row `chains` in `registries/imports.ts` (sorted after `catalog`).
- **Files:** `server/src/live/import.ts`, `server/src/registries/imports.ts`.
- **Done means:** server `tsc` green; W37 proves the ACs.
- **Verify:** server `files`.
- **Rules that apply:** sf → only `data/streams.json`, never `streams.candidates.json`.
- **Risk:** low.

### W36 — Seed row (S12)
- **Serves:** AC-70.
- **Do:** seed row `live-1-stream-sources` (source `data/streams.json`, natural key `sourceId`) whose rows are the import plan's "add" set on an empty DB, so seed = `import chains --apply`; the `reset` door reseeds it (existing reset path).
- **Files:** `server/src/seed/registry.ts`.
- **Done means:** server `tsc` green; `pnpm --dir server seed` twice → same counts (W37).
- **Verify:** server `files`.
- **Rules that apply:** sf → idempotent upsert by natural key.
- **Risk:** low.

### W37 — Import and seed integration tests (S12)
- **Serves:** AC-68, AC-69, AC-70.
- **Do:** `live-import.int.test.ts`: dry run on an empty and a filled DB → 0 writes; `--apply` twice → second report 0 added / 0 changed; a source edited through the cms endpoint between runs stays; the registry has `chains`; the AC-3 body after seed equals the body after import on an empty DB.
- **Files:** `server/test/integration/live-import.int.test.ts`.
- **Done means:** green; seed twice with the same counts in the report.
- **Verify:** one integration file; `pnpm --dir server seed` ×2.
- **Rules that apply:** sf §4.
- **Risk:** low.

### W38 — Live test doors (S13)
- **Serves:** AC-72 (enables AC-21, AC-22, AC-46, AC-76).
- **Do:** `test-doors/live.ts`, one door `POST /api/_test/live` with `LiveDoorBodySchema`: `video-status` (forwards to the fake's `/_control/videos`), `quota` (set used / exceeded per bucket and day), `viewers` (fixture entries `{people?, countries:[{iso, n}]}` merged into the aggregator's input in this process, test class only), `hide` (calls `actions.hide` as the owner), `reset-live`. Replace the stub row `video-status` (`registry.ts:147`) by this door (keys sorted). Only through the door registry's dynamic import.
- **Files:** `server/src/test-doors/{live,registry}.ts`, `server/test/unit/doors-gating.test.ts`, `server/test/e2e/doors-404.e2e.ts`.
- **Done means:** server `files` green.
- **Verify:** server `files`.
- **Rules that apply:** sec → registered only with `T2F_ENV=test` and `T2F_TEST_DOORS=1`; production 404 identical to an unknown path.
- **Risk:** low.

### W39 — Doors integration test (S13)
- **Serves:** AC-72.
- **Do:** extend `doors.int.test.ts`: each live sub-action works in `test`; the viewers fixture gives `people: 12480` and the 140 sim countries in sim order.
- **Files:** `server/test/integration/doors.int.test.ts`.
- **Done means:** green.
- **Verify:** one integration file.
- **Rules that apply:** sf → the fixture equals sim (`lib/presence/viewers.ts`).
- **Risk:** low.

### W40 — Web contract, sim adapter, demo people (F1)
- **Serves:** AC-4, AC-67 (enables AC-64).
- **Do:** `lib/api/contracts/live.ts`: types re-exported from `@time2fest/contracts` (`StreamEvent` with `version`, `ViewerSummary.people?`), `chains()` without parameters, `applyStreamEvent` re-exported from `liveRules`. `lib/presence/viewers.ts`: `SIMULATED_PEOPLE = 12_480`. `lib/api/sim/live.ts`: `chains()` all; `viewers()` adds `people: SIMULATED_PEOPLE` only when `SIMULATED_PRESENCE`. Fix every caller of `chains(eventIds)` (grep).
- **Files:** `lib/api/contracts/live.ts`, `lib/presence/viewers.ts`, `lib/api/sim/live.ts`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** cc → one copy of the types; fui → no `utils`.
- **Risk:** low.

### W41 — `live` http adapter (F1)
- **Serves:** AC-16, AC-19, AC-20, AC-23.
- **Do:** `lib/api/http/live.ts` following `lib/api/http/site.ts`: `chains()` = `GET /api/live/chains` parsed by `parseChainsResponse`; `subscribeStreams` on `live:streams` through `getRealtimeTransport()`, events parsed by `parseStreamEvent`, invalid / unknown ignored; poll 15 s ±1 while not `connected` or without a transport, ≤30 s always, at once on `onResync`; failure → keep the last (resource) / build chains; `viewers()` = `GET /api/live/viewers`; `subscribeViewers` on `live:viewers` (W45 adds the counted subscription); `reportSourceError` = `POST /api/live/source-errors`; prelaunch (`NEXT_PUBLIC_PRELAUNCH=1`) → build chains, empty viewers, no network, no timers. `HTTP_DOMAINS` gains `live`; the `index.ts` factory injects the build chains (like `site`).
- **Files:** `lib/api/http/{live,domains,index}.ts`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** fui / cc → recipe §6.0, no `lib/api/sim/**` import, no zod import; sec → realtime only via the existing lazy transport.
- **Risk:** `next.config.ts` reads `HTTP_DOMAINS` (`domains.ts:2`) — the integration build changes which modules it maps.

### W42 — Hooks: versions, `hide`, people (F1)
- **Serves:** AC-17, AC-18, AC-20, AC-46, AC-64.
- **Do:** the `streamChains` resource keeps the last applied version; its reduce uses `applyStreamEvent` with the version; a `load()` result older than the applied version is dropped and events arriving during the load are applied after it (to confirm `createResource` ordering, `lib/api/resource.ts`); `usePeopleNow(): number | undefined` = summary `people` when `> 0` and `isEnabled(switches, {kind:'switch', key:'viewersCount'})`.
- **Files:** `lib/api/hooks/live.ts`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** react → derive, don't store; fui → data hooks only in `lib/api/hooks`.
- **Risk:** `useLiveData` identity must stay stable (memo deps unchanged).

### W43 — Web live tests and the contract suite (F1)
- **Serves:** AC-2 (sim), AC-4, AC-16 … AC-20, AC-67.
- **Do:** `tests/unit/api/live-http.test.ts` (fake transport: `chain`, `source`, `hide`, unknown, broken; fake timers for disconnected / absent / connected-quiet / `onResync`; network failure with and without state; prelaunch without fetch); `live-hooks.test.tsx` (older version kept, `hide`, event during load, `usePeopleNow` four cases); `live-sim.test.ts` (`IS_TEST_BUILD` true/false people); a type test that `chains('x')` does not compile (`// @ts-expect-error`); `tests/contract/live.suite.ts` + `tests/unit/api/live-contract.test.ts` (sim) + `tests/contract/live.http.test.ts` (run in L).
- **Files:** `tests/unit/api/{live-http,live-contract,live-sim}.test.ts`, `tests/unit/api/live-hooks.test.tsx`, `tests/contract/{live.suite,live.http.test}.ts`.
- **Done means:** web `files` green on the unit files.
- **Verify:** web `files`.
- **Rules that apply:** rtl; cc §2.
- **Risk:** low.

### W44 — Realtime transport: subscription with a token (F2)
- **Serves:** AC-61 (enables AC-59).
- **Do:** `RealtimeTransport.subscribe(channel, listener, opts?: { getToken?: () => Promise<string> })`; the transport creates the centrifuge subscription with `getToken` when given; one subscription per channel per client (centrifuge forbids two) — switching a channel from tokenless to tokened = remove and re-subscribe; listeners of both kinds share it.
- **Files:** `lib/api/http/realtime/{types,transport}.ts`, `tests/unit/api/realtime-transport.test.ts`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** sec → token never logged or stored; the dynamic `import('centrifuge')` unchanged.
- **Risk:** the re-subscribe must not drop `live:viewers` events for the other listeners (tested).

### W45 — Counted viewer presence with Web Locks (F2)
- **Serves:** AC-59, AC-61, AC-23.
- **Do:** `lib/api/http/viewerPresence.ts`: while a live page subscribes to viewers and `navigator.locks` exists, `request('t2f-viewer', {mode:'exclusive'}, …)` holding a promise until unsubscribe; when granted, re-subscribe `live:viewers` with `getToken` = `GET /api/live/viewer-token` (`token`, or `''` → stays tokenless); release on unsubscribe / `pagehide`; without `navigator.locks` every tab takes the counted path. Used by `subscribeViewers` of the http adapter. Nothing written to storage.
- **Files:** `lib/api/http/viewerPresence.ts`, `lib/api/http/live.ts`, `tests/unit/api/viewer-presence.test.ts`.
- **Done means:** web `files` green; the test proves one counted subscription for two "tabs" sharing a fake lock manager and the takeover after release.
- **Verify:** web `files`.
- **Rules that apply:** sec → no storage, no id; fui → an adapter module, not a component.
- **Risk:** private modes without Web Locks fall back to an over-count, never to a crash.

### W47 — Message keys in four languages (F3)
- **Serves:** AC-65, NFR-7.
- **Do:** add `player.peopleNow` and `player.peopleNowShort` with exactly the AC-65 texts to `messages/{uk,en,es,fr}.json` (`player` at `uk.json:421`, `en.json:791`, `es.json:1474`, `fr.json:1474`); remove `watchersFrom` (`uk.json:443`) and `watchersShort` (`uk.json:499`); `nav.viewersFrom` / `nav.viewersList` untouched. Edit with a UTF-8 script file (no Bash heredoc with Ukrainian text, root `CLAUDE.md`).
- **Files:** `messages/{uk,en,es,fr}.json`.
- **Done means:** the four files are valid JSON; W49 green.
- **Verify:** web `files` on the W49 tests.
- **Rules that apply:** layout-fidelity §1 → only these keys change.
- **Risk:** low.

### W48 — The line beside the player (F3)
- **Serves:** AC-64.
- **Do:** `Caption.tsx`: prop `watchers` → `people?: number`; `t('peopleNowShort', {count: people})` at `:309-314` and `t('peopleNow', {count: people})` at `:360-364`, same elements and classes; `HomeLive.tsx:216,241-246` and `CountryLive.tsx:234,266-270`: `usePeopleNow()` instead of `viewers.length`; `useViewers` stays for the country list/map.
- **Files:** `components/live/Caption.tsx`, `components/home/HomeLive.tsx`, `components/country/CountryLive.tsx`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** layout-fidelity §1 → no class, token, element or breakpoint change; react → `{people ? … : null}`, never a rendered `0`.
- **Risk:** the `uk` ICU grouping of `12 480` (narrow no-break space) must match the boards' font — L fidelity settles it.

### W49 — Line and messages tests (F3)
- **Serves:** AC-64, AC-65, NFR-7.
- **Do:** `tests/unit/live/people-line.test.tsx` (Caption, HomeLive, CountryLive with people 12 480 / 0 / absent / switch off); `tests/unit/i18n/people-now.test.ts` (four files: values equal the AC-65 table, ICU parses, `12480` → «12 480 людей», old keys absent, `nav.viewers*` unchanged; key diff vs `git show master:messages/<lang>.json`: only the two added, only the two removed).
- **Files:** `tests/unit/live/people-line.test.tsx`, `tests/unit/i18n/people-now.test.ts`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** rtl.
- **Risk:** low.

### W50 — Player source-error reports (F4)
- **Serves:** AC-41.
- **Do:** `lib/player/sourceErrors.ts`: pure throttle `shouldReport(code, sourceId, now, last)` (codes 2, 5, 100, 101, 150, 153; ≤1 per 30 s per source); in `PlayerProvider.tsx` `onError` (`:242`) call `getService('live').reportSourceError({eventId, sourceId, code})` when allowed, fire-and-forget, before `handleBreak` (the current item's event/source ids — to confirm where `PlayerProvider` keeps them).
- **Files:** `lib/player/sourceErrors.ts`, `lib/player/PlayerProvider.tsx`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** fui → the pure rule in its own module; react → no effect for an event.
- **Risk:** low.

### W51 — Referer and `origin` on the embed (F4)
- **Serves:** AC-49.
- **Do:** in `youtubeApi.ts` create the iframe ourselves with `referrerpolicy="strict-origin-when-cross-origin"`, `allow` as now, `src` = the embed URL with `enablejsapi=1&origin=<window.origin>&playsinline=1&mute=1&rel=0` (and `autoplay` as now), then `new YT.Player(iframeEl, …)` (documented existing-iframe form); same box (`100%`); confirm there is no `noreferrer` / `<meta name="referrer">` in `app/**`.
- **Files:** `lib/player/youtubeApi.ts`.
- **Done means:** web `files` green; W52 green.
- **Verify:** web `files`.
- **Rules that apply:** layout-fidelity §1 → the iframe box unchanged.
- **Risk:** `youtubeApi.test.ts` stubs `YT.Player(mount, …)` — update it, keep `loadVideoById` behaviour.

### W52 — Player unit tests (F4)
- **Serves:** AC-41, AC-49.
- **Do:** `tests/unit/player/source-errors.test.ts` (two errors in 10 s → one report; code 3 → none); `youtubeApi.test.ts` (iframe attributes and embed URL params).
- **Files:** `tests/unit/player/{source-errors,youtubeApi}.test.ts`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** rtl.
- **Risk:** low.

### W53 — E2E specs for L (F4)
- **Serves:** AC-21, AC-22, AC-46, AC-47, AC-48, AC-61.
- **Do:** `tests/e2e/live/hide-latency.spec.ts` (20 hides through the door, p95 ≤3 s), `hide-no-realtime.spec.ts` (Centrifugo stopped, Worker harness as `tests/e2e/site-state/edgeHarness.ts`, purge fake refusing, ≤30 s), `player-switch.spec.ts` (hide the playing source → next id `PLAYING`/`BUFFERING` ≤1 s, one iframe; `tests/e2e/fixtures/youtube-stub.ts`), `player-rules.spec.ts` (room with three streams: autoplay in one, invisible not `PLAYING`; `elementFromPoint` 9 points; ≥200×200 on p390/t834/d1520), `people.spec.ts` (3 browser contexts, one with 2 pages → aggregate 3). Written only; run in L.
- **Files:** `tests/e2e/live/*.spec.ts`.
- **Done means:** the specs typecheck.
- **Verify:** web `files` (typecheck part).
- **Rules that apply:** layout-fidelity §5.
- **Risk:** AC-47/48 depend on room behaviour already present; failures are reported, never fixed by layout.

### W54 — Docs patch (D)
- **Serves:** AC-4 (seam half), AC-77; hand-overs.
- **Do:** in Ukrainian, skill `docs-sync`, grep + range edits only: `docs/site/home.md` (`:16`, `:37`, `:95`, `:135` keys, `:226` limits: the line «Зараз на Time2Fest N людей», keys `player.peopleNow` / `player.peopleNowShort`, switches `viewersCount` and `viewersMap`, source = realtime presence), `docs/site/country.md` (same rows), `docs/site/00-overview.md:132`; `docs/backend/frontend-seam.md` §3.2 (`:156-159`: `chains()` without `eventIds`, routes incl. `viewer-token`, mechanism [П-1]/[П-2]) and §3.11 rows (every live route and channel); `docs/backend/content-freshness.md` row 11 (`:214`: `viewersCount`, source); hand-overs as rows in `specs/002-backend/waves.md` (SPEC-21a: search bucket counter and refusal ready; SPEC-19: stamp independent of the player; SPEC-14: multi-player rules AC-47; SPEC-15: shares the presence pattern; SPEC-13b: the alarm codes; SPEC-22b: smoke test, production key, R2 prefix, flip `youtubeAdapterFor`). The «Еталонні дошки» lists are filled in L after the re-capture.
- **Files:** the six docs files named above (outside the repo).
- **Done means:** `grep -n eventIds` in seam §3.2 → none; each AC-77 file names the line, both keys and both switches.
- **Verify:** manual read by the wave lead (AC-77 is manual).
- **Rules that apply:** docs-sync; root `CLAUDE.md` (Ukrainian docs).
- **Risk:** other sessions edit `docs/` — edit ranges only, never rewrite whole files.

### W55 — Integration pass (L, wave lead)
- **Serves:** AC-2 (http), AC-21, AC-22, AC-23, AC-46 … AC-48, AC-61 (e2e), AC-72 (production 404), AC-76, AC-78, NFR-3; closes every AC; **full verify**.
- **Do:** after the conductor's rebase, in order: (1) `migration-safety` summary + numbering vs master (regenerate per W7 if master gained a migration); (2) contract-conformance: `pnpm contracts:run --sim-only`, `node scripts/contract-surface.mjs --check`, `tests/contract/live.http.test.ts` against this worktree's server, table in the report; (3) `git add -N` the new files, `node scripts/check-secrets.mjs`; (4) **one** full verify per touched package: contracts, server (incl. `pnpm test:int`, `verify-schema`), edge, ops (if touched), web (`next build` to `out-verify` + `check-bundle` without `--allow-realtime`); (5) AC-23: `pnpm build:prelaunch:domain` (build only, never the deploy script) + `node scripts/check-bundle.mjs out-prelaunch`; the integration build with `NEXT_PUBLIC_REALTIME_URL` + `check-bundle --allow-realtime`; (6) `pnpm --dir server test:e2e -- doors-404`; (7) the W53 e2e with `-c playwright.http.config.ts --workers=2`; (8) `layout-fidelity` on home and country live boards (http build; doors: viewers fixture 12 480 + sim countries, video states as sim): every board ≤0.1 % except the boards that show the q4 line; (9) AC-78: re-capture exactly those boards per `board-tools/README.md` from the integration build and list them in the «Еталонні дошки» sections of `docs/site/home.md` / `country.md`; (10) seed twice, same counts; (11) reviews: `architecture-reviewer` (≤2 rounds), `security-reviewer` (1 + 1).
- **Files:** none in the tree (boards and docs outside).
- **Done means:** every command green; report: ms lines, cc table, AC-5 / AC-21 p95, fidelity table, list of re-captured boards, bundle-check outputs.
- **Verify:** the Verification plan rows marked L.
- **Rules that apply:** ms, cc, layout-fidelity, seed-and-fixtures.
- **Risk:** the board re-capture writes reference shots — only the ids that show the line, one capture run at a time.

## Execution

Single lane, one implementer at a time. Each dispatch: `sdd-engineering:implementer`, this plan's path, the phase id, `model` from the table; ~80 tool calls; out of budget → `PARTIAL` with the tree green after the last finished item. Escalation Sonnet → Opus by `run-plan-auto` §3. A fresh implementer reads: the plan header, its Execution row, its items, the Affected-surface rows of its files, and the ACs its items cite.

| Lane / phase | Executor | Model | Work items | Files (no two phases run at once) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| C1 — live contracts | implementer | sonnet | W1, W2 | `packages/contracts/src/{live,live.schemas,liveGuard,liveRules,schemas,index}.ts`, `packages/contracts/test/live.test.ts`, `scripts/contract-surface.baseline.json` | — | — | unit only |
| X2 — `viewersCount` switch | implementer | sonnet | W3–W5 | `packages/contracts/src/{site,site.schemas,siteGuard,siteRules}.ts`, `packages/contracts/test/{isEnabled.table,site.test}.ts`, baseline, `server/src/domain/site/switches.ts`, `server/src/globals/siteState.ts`, (`server/src/adapters/payloadSiteState.ts`), `server/src/admin/{SiteStateView.tsx,messages.ts}`, `server/test/integration/site-admin.int.test.ts`, `lib/api/site/buildSnapshot.ts`, 4 `tests/unit/api/site-*` files | C1 | — | one int file, shared lock |
| S3 — Payload model + migration | implementer | sonnet | W6, W7 | `server/src/collections/{streamSources,liveQuota}.ts`, `server/src/globals/liveState.ts`, `server/src/registries/{collections,globals}.ts`, `server/src/migrations/**`, `server/src/payload-types.ts`, (`payload-schema.int.test.ts`) | X2 | — | migcheck DB only |
| S4 — live domain | implementer | **opus** — poller core rules: quota day, class order, reserve, NFR-1 budget, windows with patched moments | W8–W11 | `server/src/domain/live/{config,moment,status,chain,schedule,quota,viewers}.ts`, `server/test/unit/{live-domain,live-quota,live-nfr1,live-viewers}.test.ts` | S3 | — | unit only |
| S5 — fake, port, adapters, env | implementer | sonnet | W12–W14 | `fakes/youtube/{server.mjs,README.md}`, `server/src/live/ports.ts`, `server/src/adapters/{youtubeData,youtubeFake}.ts`, `server/src/registries/env.ts`, `server/.env.example`, `server/test/support/noYoutubeNetwork.ts`, `server/vitest{,.integration}.config.ts`, `server/test/unit/{fake-youtube,youtube-port,live-env}.test.ts`, (`infra/ops/test/workflow.test.mjs`) | S4 | — | fake on port 0 |
| S6 — poller core | implementer | **opus** — poller core: lease, atomic quota counters, ad-hoc queue, quota-exceeded stop, stale alarms, retention | W15–W19 | `server/src/adapters/payloadLive.ts`, `server/src/live/{poller,retention}.ts`, `server/src/container.ts`, `server/src/endpoints/{types,deps}.ts`, `server/test/integration/{live-poller,live-quota,live-retention}.int.test.ts` | S5 | — | shared lock, int files one at a time |
| S7 — fan-out | implementer | **opus** — after-commit publish, exactly once per version, purge/R2 retry schedules | W20–W22 | `server/src/live/{snapshot,fanout}.ts`, `server/src/adapters/cfPurge.ts`, `server/src/registries/subscribers.ts`, `server/test/integration/live-fanout.int.test.ts` | S6 | — | shared lock |
| E — edge cache tag | implementer | **opus** — `workers/**` cache/R2 source order | WE1, WE2 | `packages/contracts/src/publicRoutes.ts`, `workers/edge/src/publicCache.ts`, `workers/edge/test/public-cache.test.ts` | S7 | — | unit only |
| S8 — public + report routes | implementer | **opus** — public cacheable route, untrusted reports, rate limits | W23–W25 | `server/src/endpoints/{liveChains,liveSourceErrors}.ts`, `packages/contracts/src/publicRoutes.ts`, `server/src/registries/{routes,rateLimits}.ts`, `server/test/unit/public-routes.test.ts`, `server/test/integration/{live-route,live-source-errors}.int.test.ts` | E | — | shared lock |
| E3 — edge with the live row | implementer | **opus** — `workers/**` real-runtime evidence | WE3 | `workers/edge/test/{handler,site-cache.worker}.test.ts` | S8 | — | harness on loopback |
| S9 — viewers | implementer | **opus** — `server/src/realtime/**`, subscription tokens, presence, privacy (AC-63) | W26–W28 | `server/src/domain/realtime/{channels,centrifugoConfig}.ts`, `server/src/registries/{channels,routes,rateLimits}.ts`, `server/src/realtime/ports.ts`, `server/src/adapters/{centrifugoToken,centrifugoApi}.ts`, `server/src/live/viewers.ts`, `server/src/endpoints/{liveViewers,liveViewerToken}.ts`, `server/src/container.ts`, `server/test/unit/realtime-config.test.ts`, `server/test/integration/live-viewers.int.test.ts` | E3 | — | regenerate local Centrifugo config before W28 |
| S10 — owner/operator actions | implementer | **opus** — security-sensitive admin and operator commands, journal + revert | W29–W32 | `server/src/live/actions.ts`, `server/src/registries/revertHandlers.ts`, (`server/src/adapters/payloadRevert.ts`), `server/src/admin/{cmsHttp,liveEndpoints,cmsEndpoints}.ts`, `server/src/cli/live.ts`, `server/package.json`, `server/test/integration/{live-admin,live-cli}.int.test.ts` | S9 | — | shared lock |
| S11 — admin slice | implementer | sonnet | W33, W34 | `server/src/admin/{LiveSlice,LiveView}.tsx`, `server/src/admin/messages.ts`, `server/src/registries/adminSlots.ts`, `server/test/unit/live-slice.test.ts`, (`admin-slots.int.test.ts`) | S10 | — | unit only |
| S12 — import + seed | implementer | sonnet | W35–W37 | `server/src/live/import.ts`, `server/src/registries/imports.ts`, `server/src/seed/registry.ts`, `server/test/integration/live-import.int.test.ts` | S11 | — | shared lock |
| S13 — test doors | implementer | **opus** — `server/src/test-doors/**` | W38, W39 | `server/src/test-doors/{live,registry}.ts`, `server/test/unit/doors-gating.test.ts`, `server/test/e2e/doors-404.e2e.ts`, `server/test/integration/doors.int.test.ts` | S12 | — | shared lock |
| F1 — web live adapter | implementer | **opus** — realtime client, versions during load, the bundle gate | W40–W43 | `lib/api/contracts/live.ts`, `lib/presence/viewers.ts`, `lib/api/sim/live.ts`, `lib/api/http/{live,domains,index}.ts`, `lib/api/hooks/live.ts`, `tests/unit/api/{live-http,live-contract,live-sim}.test.ts`, `tests/unit/api/live-hooks.test.tsx`, `tests/contract/{live.suite,live.http.test}.ts` | S13 | — | no `next build` |
| F2 — transport token + presence leader | implementer | **opus** — `lib/api/http/realtime/**`, Web Locks presence, no storage | W44, W45 | `lib/api/http/realtime/{types,transport}.ts`, `lib/api/http/{viewerPresence,live}.ts`, `tests/unit/api/{realtime-transport,viewer-presence}.test.ts` | F1 | — | no `next build` |
| F3 — the line | implementer | sonnet | W47–W49 | `messages/{uk,en,es,fr}.json`, `components/live/Caption.tsx`, `components/home/HomeLive.tsx`, `components/country/CountryLive.tsx`, `tests/unit/live/people-line.test.tsx`, `tests/unit/i18n/people-now.test.ts` | F2 | — | — |
| F4 — player + e2e specs | implementer | sonnet | W50–W53 | `lib/player/{sourceErrors.ts,PlayerProvider.tsx,youtubeApi.ts}`, `tests/unit/player/{source-errors,youtubeApi}.test.ts`, `tests/e2e/live/*.spec.ts` | F3 | — | e2e written only |
| D — docs patch | implementer | sonnet | W54 | the six docs files outside the repo | F4 | — | range edits only |
| L — integration pass (full verify) | wave lead | — | W55 | none | all phases + the conductor's rebase | — | one heavy process at a time |

Order: C1 → X2 → S3 → S4 → S5 → S6 → S7 → E → S8 → E3 → S9 → S10 → S11 → S12 → S13 → F1 → F2 → F3 → F4 → D → L. Files touched by several phases (`container.ts`: S6, S9; `registries/{routes,rateLimits}.ts`: S8, S9; `publicRoutes.ts`: E, S8; `lib/api/http/live.ts`: F1, F2; `admin/messages.ts`: X2, S11) are sequential by construction. 20 implementer phases (11 opus, 9 sonnet) + L.

## Verification plan

| Command | Directory | Passing means |
|---|---|---|
| contracts `files` (config) | `packages/contracts` | exit 0 (C1, X2, E, S8) |
| `node scripts/contract-surface.mjs --check` | `.` | exit 0 after `--update` (C1, X2, L) |
| server `files` (config) | `server` | exit 0 (X2, every S phase) |
| one integration file (lock command above) | `server` | the named `*.int.test.ts` green (X2, S6–S10, S12, S13) |
| `node scripts/db.mjs migcheck up` → `pnpm migrate` → `pnpm migrate:down` → `pnpm migrate` → `node scripts/db.mjs migcheck drop`; `node scripts/verify-schema.mjs` | `server` | all exit 0 (S3, L) |
| `pnpm --dir server seed` ×2 | `.` | same counts (S12, L) |
| edge `files` (config) | `workers/edge` | exit 0 (E, E3) |
| ops `files` (config) | `infra/ops` | exit 0 (S5, if touched) |
| web `files` (config) | `.` | exit 0 (X2, F1–F4) |
| contracts / server / edge / ops / web `full` (config) | per config | exit 0, once (L) |
| `pnpm contracts:run --sim-only`; `npx vitest run -c tests/contract/vitest.http.config.ts tests/contract/live.http.test.ts --maxWorkers=1` | `.` | both green (L) |
| `node scripts/check-secrets.mjs` (after `git add -N`) | `.` | exit 0 (L) |
| `pnpm build:prelaunch:domain`, then `node scripts/check-bundle.mjs out-prelaunch` | `.` | clean without `--allow-realtime` (L) |
| integration build with `NEXT_PUBLIC_REALTIME_URL`, then `node scripts/check-bundle.mjs <dir> --allow-realtime` | `.` | clean (L) |
| `pnpm --dir server test:e2e -- doors-404` | `.` | green (L) |
| `npx playwright test -c playwright.http.config.ts tests/e2e/live --workers=2` | `.` | green; AC-21 p95 ≤3 s, AC-22 ≤30 s, AC-46 ≤1 s reported (L) |
| `layout-fidelity` (`scripts/boards/snapshot.mjs` + `compare-live.mjs`) on home/country live boards | `.` | every board ≤0.1 % except the q4-line boards, which are re-captured (L) |

## Assumptions

Technical judgement calls (product behaviour is in the spec):
1. [П-1] … [П-5] above.
2. `T2F_LIVE_CONFIG` (one JSON env var) is "the configuration" of AC-37; its defaults equal [А8].
3. The 5-second inner tick serves AC-43's ≤10 s; the 30-second status tick is the spec's «такт».
4. `GET /api/live/viewers` uses rate limit class `live-read`; the token route has its own 30/min per `ipDay`.
5. The viewers aggregate orders countries by catalog popularity so the http integration build matches the sim boards.
6. The admin slot is `15-live` (first screen, second slot) — a placement inside the admin, not on the site.
7. Retention clears the YouTube fields rather than deleting the source row; the row keeps only our fields (videoId, label, order, decision), consistent with AC-75's archive.
8. Embedding through a pre-created iframe (W51) is the documented YT IFrame API form and leaves the player box unchanged.

## Open questions

None.

## Research used

- `research-tools:researcher` (Sonnet), 2026-11-23, Centrifugo v6.10.3: anonymous connections may use subscription tokens with empty `sub` (`internal/client/handler.go:875-878`); `disallow_anonymous_connection_tokens` checks connection tokens only (`:430`); a non-empty token takes the token path and its `info` becomes `chan_info` (`handler.go:761`, centrifugal.dev/docs/server/presence); subscription tokens default to `client.token.hmac_secret_key`; namespace `presence: true` (`internal/configtypes/types.go:193`), presence update interval 27 s, Redis `presence_ttl` 60 s; the server API needs no client presence permission (channel_permissions page); `presence_stats` counts all anonymous users as one (so full `presence` is read); centrifuge-js allows one subscription per channel. **Not established:** whether `chan_info` arrives as raw JSON or base64 in `/api/presence` (W26 accepts both), memory-engine expiry (the stack uses the Redis engine), the numeric "already subscribed" code (W44 removes before re-subscribing, so it is never hit).
- Code read by the planner: `server/src/platform/edge.ts`, `workers/edge/src/{proxy,handler}.ts`, `server/src/{endpoints/realtimeToken,realtime/token,domain/realtime/token,adapters/centrifugoToken}.ts`, `server/src/domain/realtime/channels.ts`, `server/src/registries/{channels,routes,imports,rateLimits,subscribers,adminSlots,revertHandlers}.ts`, `server/src/site/fanout.ts:1-60`, `server/src/endpoints/siteState.ts`, `server/src/admin/cmsEndpoints.ts:1-60`, `server/src/test-doors/registry.ts:120-150`, `lib/api/{contracts/live,sim/live,hooks/live,http/domains,http/index}.ts`, `lib/presence/viewers.ts`, `scripts/check-bundle.mjs`, `docker-compose.yml:27-30,64-66`, `docs/knowledge/gotchas.md`, `docs/backend/cloudflare-notes.md` (grep), `docs/plans/SPEC-08-site-state.plan.md` (format).

## Rollback / blast radius

- **Server:** new collections and a new global only (CREATE); `down` drops them. The poller does not start without `T2F_YOUTUBE_BASE_URL`, so a production image with this code is inert towards YouTube. Rollback = the previous image (SPEC-13a; never runs `down`).
- **Edge:** one new public row; removing it sends `/api/live/chains` back to the fail-closed proxy path. The `cacheTag` of the site row keeps site behaviour.
- **Realtime:** `presence: true` on namespace `live` only; removing the row field removes it at the next config generation.
- **Web:** removing `live` from `HTTP_DOMAINS` returns the integration build to sim chains; the production static site keeps the build chains when the server is down (AC-20).
- **Visible change:** the q4 line text in three places plus the re-captured boards; everything else must stay pixel-identical (AC-76).
