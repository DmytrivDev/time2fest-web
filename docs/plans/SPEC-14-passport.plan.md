# Implementation plan: Passport and presence — beats in Redis with a proof of presence outside it, the beat-intake health log, stamp claims with honest codes, acceptance during downtime and for an old moment, achievements and streaks, guest stamp merge, author path and card, the subject-data handler (SPEC-14)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-14-passport.md` (Status: approved; 0 `[NEEDS CLARIFICATION]` markers). AC-1 … AC-66 (`:90-306`), edge cases EC-1 … EC-20 (`:310-329`), NFR-1 … NFR-8 (`:333-355`), owner decisions В1–В8 (`:18-25`), default [Q1] (`:29`), session decisions [А1]–[А17] (`:35-51`), decision table and proposed contract (`:357-423`). Open questions (`:547-554`) block nothing: 1 is the accepted default [Q1]; 2 is a SPEC-22b/23 hand-off (here only the internal edge-report entry and its door); 3 is settled below in Assumptions; 4 is for the orchestrator.
This plan implements those requirements; it does not define or change them.
**Execution mode** — **single conductor, sequential phases, two lanes with disjoint files** (as SPEC-11): Lane A = server (one implementer at a time), Lane B = rules, contracts, web client, suites, docs. Parallel pairs: P1∥P2, P5∥P13, P11∥P12 (see `Execution`). Reason: `server/src/registries/{routes,ops}.ts`, `server/src/presence/{stamps,ports}.ts` and `server/src/test-doors/registry.ts` are touched by several Lane-A phases, so Lane A serializes; the machine allows ≤2 heavy processes (`docs/backend/sdd-routing.md` §7).
**Out of scope** — the spec's Non-goals (`:61-70`): toasts (В1); FR-STAMP-13 at 30 k clients / 2 000 beats/s (SPEC-23); `stamp`/`goal`/`streak` notifications and the rating's "has a stamp" interface (SPEC-19 — only the internal "Stamp granted" event and the data here); the `chat` http adapter and wiring `authorPath` into the card (SPEC-15/16 — only the route and the wire schema here); automatic edge-failure reports from the Worker (SPEC-22b/23); continents / "all zones" on the passport page (client-side); past seasons via `?season=`; a `mergeGuest` route; new visible states and board re-shoots (В6). Architecture review and `security-reviewer` are separate agents (`security-reviewer` mandatory: proof of presence, stamp issuing, test doors, personal data, opaque author ids).

Repository root for every path = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-14` (branch `spec-14-passport`, base = spec commit `c118f16f`).

- **Port slot: 28** — derived, do NOT set `T2F_SLOT` (`server/scripts/lib/worktree.mjs:66-77`: `spec-NN-*` → `2·NN`; server 4280, web 4281); databases `t2f_spec_14_passport` / `…_test`, Redis DB 28. Shared compose services (Postgres 5433, Redis 6380, Centrifugo, Mailpit) are reused; this wave adds none.
- **Do not commit, never push** (the conductor commits after each phase). Never stage `tsconfig.json`. `server/src/migrations/**` is touched only in P3.
- **Never read** (`sdd-routing.md` §6): `research_data/**`, `dashboard/secrets/**`, `.env*` other than `*.env.example`, `**/reference-boards/**`, `out*/`, `.next*/`, `docs/archive/**`, `Old Project/**`, `graphify-out/graph.json`, `pnpm-lock.yaml`, `docs/decision.md` whole.
- **No new dependency in this wave.** (The rule "dependencies only in P1" holds trivially: P1 adds none; `pnpm install` is not run.)
- **Videos only muted** if any page is opened in a browser (root `CLAUDE.md`).
- Machine: Vitest `--maxWorkers=2`; integration files serially under the shared lock; one heavy process at a time besides one implementer (`serve`, `build:int`, exclusive lock, server `next build`).
- Paths marked **(to confirm)** were not opened by the planner; the implementer checks them with Grep / `graphify explain` before editing and keeps the plan's intent.
- Phase ids P1 … P17 (+ L); work items W1 … W50. Every phase brief: plan header, own `Execution` row, own items, the `Affected surface` rows of its files, the ACs its items cite (`sdd-routing.md` §5).

### Command shorthands used in `Verify` lines
- **server files** = config `server` → `files` (in `server/`): `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`.
- **contracts files** = config `contracts` → `files` (in `packages/contracts/`) plus `node ../../scripts/contract-surface.mjs --check`.
- **rules files** = config `rules` → `files` (in `packages/rules/`).
- **web files** = config `web` → `files` (repo root).
- **one int file** = in `server/`: `node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts --maxWorkers=1 test/integration/<file>` (stack up per skill `local-stack`, slot 28, DB migrated and seeded; never `pnpm` after `--` on Windows).
- **one exclusive file** = in `server/`: `npx cross-env T2F_EXCLUSIVE=1 node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.integration.config.ts --maxWorkers=1 test/exclusive/<file>` (same as `test:int:exclusive`, `server/package.json:14`, narrowed to one file).
- **migcheck** = in `server/`: `node scripts/db.mjs migcheck up` → `pnpm migrate` → `pnpm migrate:down` → `pnpm migrate` → `node scripts/db.mjs migcheck drop`; then `node scripts/verify-schema.mjs`.
- **contract run** = repo root, worktree server served (`node server/scripts/stack.mjs serve`, slot 28): `node scripts/contract-run.mjs` (`passport` must be green on both columns). Without the server: `node scripts/contract-run.mjs --sim-only`.

## Planner decisions

- **[П-1] Storage: raw SQL tables on the rights pool, one migration.** Like SPEC-11 [П-1] (`server/src/migrations/20261125_224924_spec11_rights.ts`), the tables are not Payload collections: they need composite unique keys as the invariant (one proof per subject × event × moment, one stamp per subject × season × event), subject ids are text with no FK, and the records are personal data that must get no Payload REST surface. Reached through `rightsDbOf(deps)` (`server/src/auth/pool.ts:68`, `RightsDb` port `server/src/rights/ports.ts`). Tables (all times = server-clock ms, `bigint`):
  - `presence_proofs (subject_id, season, event_id, moment_ms, first_received_at, last_received_at NULL, source, PRIMARY KEY (subject_id, season, event_id, moment_ms))` + index `(season)` — the proof [А1];
  - `presence_event_moments (season, event_id, moment_ms, first_seen_at, PRIMARY KEY (season, event_id, moment_ms))` — every moment the server has seen for an event (base and each correction) [П-4];
  - `presence_samples (node_id, at, fast_reachable, fast_run_id NULL, fast_uptime_s NULL, accepted, failed, PRIMARY KEY (node_id, at))` + index `(at)` — no subject column (AC-14, NFR-5);
  - `presence_window_health (season, event_id, moment_ms, state CHECK IN ('healthy','downtime'), signs text[], recorded_by 'system', recorded_at, alarmed_at NULL, UNIQUE (season, event_id, moment_ms))` — exactly one system record per window (AC-15);
  - `presence_downtimes (id bigserial, season, kind CHECK IN ('manual','edge-region'), event_id NULL, from_ms, to_ms, region NULL, reason NULL CHECK (length ≤ 200), recorded_by CHECK IN ('owner','system'), created_at, alarmed_at NULL)` — append-only manual and edge records (AC-19, AC-21);
  - `stamps (subject_id, season, event_id, granted_at, presence_source, grant_kind CHECK IN ('presence','downtime','old-moment'), issued_at, PRIMARY KEY (subject_id, season, event_id))` [А10];
  - `passport_achievements (subject_id, season, key, achieved_at, PRIMARY KEY (subject_id, key))` [А11];
  - `stamp_old_moment_log (id bigserial, subject_id, season, event_id, old_moment_ms, new_moment_ms, at)` [А9];
  - `author_ids (subject_id PRIMARY KEY, author_id UNIQUE, created_at)` [П-9].
  One migration `<ts>_spec14_presence` (P3) holds all DDL; created with `pnpm --dir server migrate:create spec14_presence` (blank — no collection changed; non-interactive accept as in SPEC-11 W8), then `node scripts/fix-migration-down.mjs <file>`, then DDL as `db.execute(sql.raw(...))` in `up`/`down` (pattern of `20261125_224924_spec11_rights.ts`). `migration-safety` check 1 is reported as "hand-written DDL, named in W8" (the reviewed SPEC-10/11 deviation). Expand-only.
- **[П-2] Module layout (onion).** Pure rules in `server/src/domain/presence/**` (beat schedule, window membership, source priority, health signs, claim decision) and `server/src/domain/passport/**` (stamp view, author path), no I/O, `now` injected; application services and ports in `server/src/presence/**` (`ports.ts`, `proofs.ts`, `moments.ts`, `intake.ts`, `beats.ts`, `samples.ts`, `health.ts`, `downtime.ts`, `stamps.ts`, `achievements.ts`, `events.ts`, `links.ts`, `subjectData.ts`, `retention.ts`, `authorIds.ts`, `authorPath.ts`, `faults.ts`); routes in `server/src/endpoints/{presence,stamps,chatAuthors}.ts`; getter `presenceOf(deps)` in `server/src/endpoints/deps.ts` (pattern `rightsOf`, `deps.ts:69-155`, cached per deps, lazy).
- **[П-3] Proof write path** [А1], [А3]. Per in-window beat and event: Redis marker `pr:mk:<season>:<event>:<moment>:<subject>` = best source so far, TTL 48 h (AC-56). `setIfAbsent` succeeds → `INSERT … ON CONFLICT DO NOTHING` into `presence_proofs` **before** answering `ok` (AC-3). Marker exists with a lower-priority source → `set` the higher one and `UPDATE presence_proofs SET source=$s WHERE … AND <priority(source) lower>` (AC-9, priority from rules `presence.ts:51`). Redis throws `DependencyUnavailable` → the same `INSERT … ON CONFLICT DO NOTHING` (plus the conditional source update) straight in Postgres, answer `ok`, alarm `presence/fast-store-down` throttled to once a minute per node (AC-6). Postgres also fails → `unavailable`, `retryAfterMs: 5000`, failed counter +1 (AC-7). The beat route has `needs: ['db']` only; Redis failures are handled inside the service, never mapped to 503 by the pipeline (`pipeline.ts:115-121`).
- **[П-4] Moments and the old moment** [А9]. The server has no correction history store (`corrections/service.ts:271-296` gives only the current patch). The presence module records every effective moment it sees per event in `presence_event_moments` (upsert on each read of `momentsWithPatches`, cached 30 s per deps like `scheduleCatalogOf`; also on every catalog/patch recompute). A beat counts toward every known moment of the event whose window contains its receipt time and that is still accepted (current moment always; an older one until the celebration end + Δ, `celebration.ts:9` / `CELEBRATION_TAIL`); a claim considers old windows only until that end (AC-32, AC-33). Event validity (catalog of the current season, `slot === 'midnight'`, not hidden after patches) is one domain predicate used by beats (skip, AC-8) and claims (`unknown-event`, AC-28).
- **[П-5] Health log** [А4], [А5]. Each node runs a 5 s sampler (`setInterval` on the server clock's tick, started with the background jobs in `server/src/container.ts`; in `test` the sampler is off and `presence-tick` drives it). The sample reads `FastStore.info()` — a **new optional port method** `info(): Promise<{runId: string; uptimeS: number}>` (`server/src/ports.ts:29`, RedisStore `INFO server` in `adapters/redis.ts:72-119`, memory store returns a fixed per-process run id). Counters: per-node in-process `accepted`/`failed` since the last sample; per event × moment distinct-subject counters in Redis (`pr:pre:<…>:<subject>` / `pr:in:<…>:<subject>` via `setIfAbsent` + `incrWindow` counters `pr:cnt:pre|in:<…>`; an in-window subject is counted in `in` only if its `pre` marker exists — AC-17). Finalisation = pure `healthOf(window, samples, counters, downtimes, nodes)` → `{state, signs}`; run (a) on the sampler tick for every window whose end + 10 s has passed and has no record, and (b) by a moments-registry row `presence-finalise` (`kinds: ['event-stamp']`, `late: 'always'`, idempotent by `consequenceId`) so a server that was down finalises within 30 s of boot (AC-15, EC-4). Missing counters → `downtime` (`beat-rate-drop`); a failed sample/finalise write raises `presence/finalise-failed` and never writes `healthy` (AC-22). A window without a record after end + 2 min counts as downtime for claims (AC-18). A `downtime` record or a downtime row overlapping `[m − 10 min; m + 10 min]` of any event raises `presence/downtime` (`page`) and publishes internal event `presence.downtime-recorded` once, guarded by `UPDATE … SET alarmed_at = now WHERE alarmed_at IS NULL RETURNING` (AC-20).
- **[П-6] Claim** [А7]. Pure `claimDecision(input)` implements the spec's flowchart (`:389-406`) exactly, in that order, returning `{kind:'ok', grant}` or an `ApiError` shape with `retryAfterMs` (until m + 15 s; until the expected finalisation clamped to 1 000…30 000; 5 000 on DB fault). The service reads stamp → event → proofs (current + accepted old moments) → health record → downtimes in one transaction and inserts `stamps … ON CONFLICT DO NOTHING RETURNING`; zero rows → re-read and return the existing stamp (AC-23, AC-30). `grantedAt = stampGrantedAt(moment)`; `old-moment` writes one `stamp_old_moment_log` row in the same transaction. The client's `at`/`openedAt` never enter the decision (AC-11). Consequences (achievements, `stamp` envelope, internal event) run only when this call inserted the row (AC-40).
- **[П-7] Stamp view** [А10], AC-36. The stamp composer is extracted Dataset-free into `packages/rules/src/passport/stamp.ts` (`stampOf(event, lookups)` where `lookups = {cityName(cityId), countryIso, illustrationOfUnit(event)}`), the same move SPEC-11 [П-10] made for the schedule rule. `lib/engine/stamp.ts` stays unchanged (SPEC-19 may switch it); a web parity test proves `stampOf` over a Dataset adapter equals `buildStamp` for every dataset event, and a server unit test proves the server wrapper over `StoredCatalog` equals `stampOf` for every seeded event. Illustration = one lookup "illustration of the event's unit" (today the country row's `illustrationId`, `collections/catalog/countries.ts:40`), composed at read time.
- **[П-8] Achievements** [А11]. One pure function `achievementsOf(stamps, zoneOrder, season)` in `packages/rules/src/passport/achievements.ts` → keys `goal:<season>:countries:<3|5|10>`, `goal:<season>:zones:<3|5|10>`, `streak:<season>:<3|5>`; streak = run of adjacent catalog zone orders ending at the highest order among the stamps. Parity with `lib/api/sim/NotificationsGenerator.tsx:25-46,68-73` — its pure helpers are exported (no behaviour change) so the parity test can call them. The server stores new keys with `INSERT … ON CONFLICT DO NOTHING` (never revoked, AC-43).
- **[П-9] Author ids** [А14]. `author_ids` maps a subject to a random 128-bit base64url `author_id` created on first need (`INSERT … ON CONFLICT (subject_id) DO NOTHING` + re-read); `authorIdOf(subject)` and `subjectOfAuthor(authorId)` are the internal interface for SPEC-15. Merge (`stamps` authLinks row) does not move the guest's author id (the account keeps or gets its own).
- **[П-10] Faults for tests.** `server/src/presence/faults.ts` holds a process-local switch `{fastStore: 'ok'|'down', dbWrite: 'ok'|'fail', beatErrorRate: 0..1}` read by `proofs`, `samples`, `health` (defaults `ok`, `0`); only the `presence-fault` door writes it (test class). In-process integration tests can also inject a Redis-down `FastStore` (pattern `test/integration/rights-bans.int.test.ts:28-60`).
- **[П-11] Retention** [А16]. Beat keys TTL 48 h; proofs deleted by a new ops job `presence-retention` (`server/src/ops/runner.ts:151-152` job map pattern) when `now > ratingCloseAt(season) + 24 h` (`bounds.ts:13`); samples and health records kept with the season (no subject data).

## Spec follow-ups
1. **AC-10 "the server runs `boundaries.shared.test.ts` unchanged"** — no server harness does that today (no server test imports it). W12 adds `server/test/unit/presence-rules-shared.test.ts` that imports the shared file as is; if the server Vitest `include` cannot reach `packages/rules/test/**`, the implementer adds the narrowest include and reports it.
2. **AC-32 "the server knows every moment of the event"** — there is no correction history in code; [П-4] makes the presence module record moments it has seen. A correction made while no server process read the moments (impossible in practice: recompute subscribers fire on every patch) would be missed; spec-creator may want to state the source.
3. **AC-63 "door count 36 in all four assertions"** — the four places are `test-doors/registry.ts:3` (comment), `test/integration/streams-doors.int.test.ts:111`, `test/unit/doors-gating.test.ts:106`, `test/e2e/doors-404.e2e.ts:69` (plus its `DOORS` list).
4. **AC-15 timing vs the `event-stamp` moment** — the moment fires at m + 15 s, before the window end + 10 s; [П-5] finalises on the sampler tick and uses the moments row for the after-boot guarantee. Behaviour is as specified.
5. **NFR-1 / NFR-2 / NFR-3** are load measurements; their scripts are written in P16 and run once by the conductor in L (with AC-65), not in a phase.
6. **AC-14 "Redis run id and uptime"** need `INFO`, which the `FastStore` port lacks; [П-5] adds an optional `info()` method (port change, both stores).

## Requirements traceability
| Req | Requirement (cited) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | `POST /api/presence` strict body, guest on first beat | spec:92 | W5, W14, W15 | W16 `presence-beats.int` |
| AC-2 | `nextBeatMs` schedule | spec:95 | W1, W11, W14 | W11 unit, W16 |
| AC-3 | one proof row before `ok` | spec:98 | W8, W13, W14 | W16 |
| AC-4 | out-of-window beat → counters only | spec:101 | W11, W13 | W16 |
| AC-5 | `presence-beat` 12/min, memory fallback | spec:104 | W15 | W16 |
| AC-6 | Redis down → DB proof, `ok`, throttled alarm | spec:107 | W13, W14, W15 | W16 |
| AC-7 | both down → `unavailable` 5000, failed +1 | spec:110 | W13, W14 | W16 |
| AC-8 | unknown/non-midnight/hidden event skipped | spec:113 | W11, W14 | W16 |
| AC-9 | best source kept | spec:116 | W11, W13 | W11 unit, W16 |
| AC-10 | window only via rules, no copy | spec:121 | W1, W11, W12 | W12 unit, server eslint |
| AC-11 | `openedAt`/`at` never count | spec:124 | W11, W24 | W16, W27 `presence-claim.int` |
| AC-12 | Redis flushed → stamp from DB proof | spec:127 | W13, W25 | W27 |
| AC-13 | rules constant I = 20 000 | spec:130 | W1 | W1 unit |
| AC-14 | 5 s samples, no subject column | spec:135 | W13, W18 | W20 `presence-health.int` |
| AC-15 | one record ≤30 s after end + 10 s; after boot | spec:138 | W19 | W20 |
| AC-16 | each sign → `downtime` | spec:141 | W17, W19, W21 | W17 unit, W23 `presence-signs.int` |
| AC-17 | `beat-rate-drop` thresholds | spec:144 | W13, W17 | W17 unit, W23 |
| AC-18 | no record after end + 2 min → downtime | spec:147 | W24 | W27 |
| AC-19 | owner slice `37-presence`, append-only | spec:150 | W19, W38, W39 | W39 `presence-admin.int` |
| AC-20 | `presence/downtime` page + internal event once | spec:153 | W19 | W20 `presence-alarms.int` |
| AC-21 | edge report → `edge-region` for overlapping windows | spec:156 | W19, W21 | W23 |
| AC-22 | write fault → `finalise-failed`, never `healthy` | spec:159 | W19 | W20 |
| AC-23 | `POST /api/me/stamps`, idempotent | spec:164 | W5, W25, W26 | W27 |
| AC-24 | proof + ≥ m+15 s → `presence` at once | spec:167 | W24, W25 | W27 |
| AC-25 | `no-presence` only with healthy record, no downtime, no proof | spec:170 | W24 | W24 unit, W27 |
| AC-26 | `unavailable` cases and `retryAfterMs` ranges | spec:173 | W24, W25 | W24 unit, W27 |
| AC-27 | `claim-closed` after close + Δ | spec:176 | W24 | W27 |
| AC-28 | `unknown-event` | spec:179 | W11, W24 | W27 |
| AC-29 | any downtime → `downtime` grant | spec:182 | W24 | W23 (door kinds), W27 |
| AC-30 | parallel claims → one row | spec:185 | W8, W25 | W27 |
| AC-31 | one stamp per event | spec:188 | W3, W25 | W3 unit, W27 |
| AC-32 | `old-moment` grant + journal | spec:191 | W13, W24, W25 | W27 `presence-old-moment.int` |
| AC-33 | after celebration end only current window | spec:194 | W24 | W27 |
| AC-34 | stamps only via claim/merge, pass irrelevant | spec:197 | W24, W26 | W27, security review |
| AC-35 | `stamp-claim` 60/min | spec:200 | W15, W26 | W27 |
| AC-36 | `Stamp` composed at read from catalog | spec:203 | W3, W4, W25 | W4, W27 unit+int |
| AC-37 | `GET /api/me/stamps` ordered; no cookie → `[]` | spec:208 | W26 | W27 |
| AC-38 | season switch → empty passport, old rows kept | spec:211 | W28 | W30 `presence-grant.int` |
| AC-39 | `stamp` `granted` ≤3 s; publish fault ok | spec:214 | W5, W29 | W30 |
| AC-40 | one internal "Stamp granted" event | spec:217 | W29 | W30 |
| AC-41 | achievements computed and stored | spec:222 | W2, W28 | W2 unit, W30 |
| AC-42 | one rules function = generator | spec:225 | W2, W4 | W4 parity |
| AC-43 | never revoked, per season | spec:228 | W28 | W30 |
| AC-44 | authLinks `stamps` merge, earlier kept, idempotent | spec:233 | W31 | W34 `presence-merge.int` |
| AC-45 | merge event only new, one per kind | spec:236 | W31 | W34 |
| AC-46 | `snapshot` after merge | spec:239 | W31 | W34 |
| AC-47 | handler fault → retry row, alarm, sign-in done | spec:242 | W31 | W34 |
| AC-48 | http adapter has no `mergeGuest` | spec:245 | W40 | W43 `passport-http` unit |
| AC-49 | author path route + wire schema | spec:250 | W6, W36 | W37 `chat-author-path.int` |
| AC-50 | pass + `showPath` rules, own always | spec:253 | W36 | W37 |
| AC-51 | stamps + future scheduled points | spec:256 | W36 | W37 |
| AC-52 | unknown id → `not_found`; id ≠ subject | spec:259 | W35 | W37 |
| AC-53 | banned author → hidden | spec:262 | W36 | W37 |
| AC-54 | `author-path` 60/min per device | spec:265 | W15, W36 | W37 |
| AC-55 | subject-data `stamps` export/erase/anonymise | spec:270 | W32 | W34 `presence-subject-data.int` |
| AC-56 | declarative `presence-beats`; TTL ≤48 h | spec:273 | W13, W32 | W16 (TTL), W34 (row) |
| AC-57 | proofs deleted 24 h after close | spec:276 | W33 | W34 |
| AC-58 | contracts additive: `no-presence`, schemas, `stamp` event, guard | spec:281 | W5, W6, W7 | W5–W7 unit, `contract-surface --check` |
| AC-59 | `passport` in `HTTP_DOMAINS`; adapter feeds surfaces | spec:284 | W40, W41 | W43 unit, W46 e2e |
| AC-60 | claimer: remove only on `no-presence`, honour `retryAfterMs` | spec:287 | W42 | W43 `stamp-claims` unit |
| AC-61 | sim refusals; suite green on sim and http | spec:290 | W42, W44, W45 | W45 contract run |
| AC-62 | no new visible states (boards) | spec:293 | — | L `layout-fidelity` |
| AC-63 | 4 doors (36), 404 outside test, reset clears | spec:296 | W21, W22 | W23 `presence-doors.int` |
| AC-64 | ops domain `presence` real; 3 alarms in test channel | spec:299 | W15, W19 | W20 `presence-alarms.int`, ops registry tests |
| AC-65 | 1 500 clients, Redis restart at midnight, 0 `no-presence` | spec:302 | W47 | W47 (N=100), L (N=1500) |
| AC-66 | docs patch | spec:305 | W49, W50 | manual (orchestrator) |
| EC-1 … EC-20 | edge cases (spec:310-329) | spec | as their ACs | as their ACs; EC-20 non-goal |
| NFR-1 | beat ≤50 ms p95 @200/s | spec:333 | W48 | L (k6 60 s) |
| NFR-2 | claim ≤100 ms p95 @100/s | spec:336 | W48 | L (k6 60 s) |
| NFR-3 | ≥99.5 % confirmed ≤ m + 60 s | spec:339 | W47 | L (AC-65 control run) |
| NFR-4 | bodies ≤1 KB → 413 | spec:342 | W14, W26 | W16, W27 |
| NFR-5 | no IP/email/subject id in logs and samples | spec:345 | W8, W14, W25 | W16, W27 (log capture), W10 (no column) |
| NFR-6 | no proof lost on non-persistent Redis restart | spec:348 | W47 | W47, L |
| NFR-7 | `Cache-Control: private, no-store` | spec:351 | W14, W26, W36 | W16, W27, W37 |
| NFR-8 | time only from `deps.clock` | spec:354 | W11, W24 | W27 (`presence-no-wallclock` unit) |

## Affected surface
| File | New/Mod | Package | Home (ring / radius) | Skills that will govern it | Constraint to respect |
|---|---|---|---|---|---|
| `packages/rules/src/time/{constants,index}.ts`, `packages/rules/eslint/no-time-rule-copy.mjs` | Mod | rules | shared pure rules | gap (`packages/rules/**` unrouted) — onion by analogy | new `PULSE_INTERVAL_MS = 20_000` next to `STAMP_DELAY` (`constants.ts:7`); added to the rule's constant list (`no-time-rule-copy.mjs:14`) |
| `packages/rules/src/passport/{achievements,stamp,index}.ts`, `packages/rules/package.json` | New/Mod | rules | shared pure rules | gap — onion by analogy | Dataset-free; export path `./passport` next to `./schedule` (`package.json:6-11`) |
| `packages/rules/test/{exports,boundaries.shared,achievements,stamp}.test.ts` | Mod/New | rules | tests | gap | every export has a row in the `calls` map (`boundaries.shared.test.ts:240-300`) and `exports.test.ts` |
| `lib/api/sim/NotificationsGenerator.tsx` | Mod | web | sim | react-best-practices (`**/*.tsx`) | export the pure helpers of `:25-46,68-73` only; behaviour unchanged |
| `tests/unit/passport/rules-parity.test.ts` | New | web | test | gap | parity over the full dataset |
| `packages/contracts/src/{passport,passport.schemas,passportGuard,authorPath,authorPath.schemas,schemas,index}.ts`, `packages/contracts/test/{passport,authorPath}.test.ts` | New/Mod | contracts | contracts | onion, contract-conformance | additive only; zod only in `*.schemas.ts` (`schemas.ts:1`); guard import-free (pattern `profileGuard.ts:87`) |
| `scripts/contract-surface.baseline.json` | Mod | web | script data | contract-conformance | additions only |
| `lib/api/contracts/passport.ts`, `tests/unit/api/seam-vocabulary.test.ts` | Mod | web | client contract | contract-conformance | `PassportClaimReason` += `no-presence` (`passport.ts:12-16`); vocab list `seam-vocabulary.test.ts:14,35` |
| `server/src/migrations/{<ts>_spec14_presence.ts,.json,index.ts}` | New/Mod | server | migrations | migration-safety | one migration [П-1]; `fix-migration-down.mjs`; expand-only; up/down/up |
| `server/src/ports.ts`, `server/src/adapters/redis.ts` | Mod | server | port / adapter | onion | optional `FastStore.info()` in both RedisStore and memory store (`ports.ts:29-42`, `redis.ts:72-128`) |
| `server/src/domain/presence/{beatSchedule,window,source,eventValidity,healthSigns,claimDecision}.ts`, `server/src/domain/passport/{stampView,authorPath}.ts` | New | server | domain (pure) | onion | no I/O, injected `now`; window only via `isPresentByPulses`/`stampAcceptUntil`/`stampGrantedAt` (`presence.ts:73-106`) |
| `server/src/presence/*.ts` (see [П-2]) | New | server | application + ports | onion | SQL via `RightsDb`; never logs subject id outside proof/stamp rows, IP, email (NFR-5); time from `deps.clock` (NFR-8) |
| `server/src/endpoints/{presence,stamps,chatAuthors,deps}.ts` | New/Mod | server | driving adapter | onion, security, contract-conformance | strict zod bodies from contracts; `maxBodyBytes: 1024`; `subject:'required'` on writes; `Cache-Control: private, no-store` |
| `server/src/registries/{routes,rateLimits,ops,moments,authLinks,subjectData,adminSlots}.ts` | Mod | server | registries | onion | one line per row, sorted, `assertRegistry`; every `raise` code has an ops row (`docs/knowledge/gotchas.md:24`) |
| `server/src/container.ts`, `server/src/ops/runner.ts` | Mod | server | composition / ops | onion, security (`container.ts`) | sampler started with background jobs, off in `test`; job `presence-retention` |
| `server/src/admin/{PresenceSlice,PresenceView}.tsx`, `server/src/admin/{presenceEndpoints,cmsEndpoints,messages}.ts` | New/Mod | server | Payload admin glue | gap for `admin/**/*.tsx`; owner-only per `cmsHttp.ts` | pattern `BansSlice`/`BansView`/`bansEndpoints.ts`; audit via `resolveActor` (`admin/opsEndpoints.ts:18`) |
| `server/src/test-doors/{presence,registry}.ts` | New/Mod | server | test doors | security (`server/src/test-doors/**`) | test class + `T2F_TEST_DOORS=1` only; header count 36 |
| `server/scripts/k6.mjs`, `server/load/presence/{beats,claims}.js` | Mod/New | server | load scripts | security (`server/scripts/**`, `server/load/**`) | `SERVER_SCENARIOS` + `loadDirFor`/`scriptFor` (`k6.mjs:34-39`); hits loopback only |
| `lib/api/http/{passport,domains,index}.ts` | New/Mod | web | client adapters | frontend-ui-architecture, security, contract-conformance | recipe = `lib/api/http/profile.ts` (`call` `:84-109`, `subscribe` `:132-186`); zod-free; no `mergeGuest` |
| `lib/passport/stampClaims.ts`, `lib/api/hooks/passport.ts` (to confirm whether it changes) | Mod | web | lib / hooks | gap (`lib/passport/**`); frontend-ui-architecture (hooks) | remove only on `forbidden/no-presence` (`stampClaims.ts:36-38,137`); honour `retryAfterMs` |
| `lib/api/sim/passport.ts` | Mod | web | sim adapter | gap — contract-conformance by suite | refusals equal the server (AC-61) |
| `tests/contract/{passport.suite,passport.http.test}.ts`, `tests/unit/api/{passport-contract,passport-http,integration-build,live-http}.test.*`, `tests/unit/passport/stamp-claims.test.ts` | New/Mod | web | tests | contract-conformance, react-testing-library | one suite, two adapters (pattern `profile.suite.ts`) |
| `tests/e2e/server-clock/passport-stamp.spec.ts` | New | web | e2e | gap | runs in project `server-clock` (`playwright.http.config.ts:36-53`), `--workers=1` |
| `server/test/unit/*.test.ts`, `server/test/integration/presence-*.int.test.ts`, `chat-author-path.int.test.ts`, `admin-slots.int.test.ts`, `streams-doors.int.test.ts`, `server/test/unit/doors-gating.test.ts`, `server/test/e2e/doors-404.e2e.ts`, `server/test/exclusive/presence-restart.exclusive.test.ts` (+ `support/virtualClients.ts`) | New/Mod | server | tests | gap (`server/test/**`) | serial integration; exclusive file only under the exclusive lock |
| `docs/knowledge/gotchas.md`; side notes `…/spec-14/docs-patch.md` | Mod/New | docs | docs | gap (`**/*.md`) | Ukrainian; root docs changed only by the orchestrator |

**Coverage gaps:** `packages/rules/**`, `lib/passport/**`, `lib/api/sim/**`, `server/test/**`, `server/src/admin/**/*.tsx`, `tests/e2e/**`, `docs/**` — named, not governed by a routed skill.

## Contract changes
- **Shared contracts / schemas:** yes → new `packages/contracts/src/passport.ts` (`PASSPORT_REASONS = ['claim-closed','no-presence','unknown-event'] as const`, `PRESENCE_SOURCES`, `GRANT_KINDS`, wire `Stamp` type equal to `lib/data/types.ts:228-235`, `StampEvent = {type:'stamp', id, data: {kind:'granted', stamp} | {kind:'snapshot', stamps}}`), `passport.schemas.ts` (`presenceBeatBody` strict `{eventIds: string≤64 [1..8], source, openedAt?: number}`, `presenceBeatResponse {nextBeatMs: number|null}`, `stampClaimBody` strict `{eventId ≤64, source, at: number}`, `stampSchema`, `stampListSchema`, `stampEventSchema`, door bodies `presenceFaultDoor {fastStore?, dbWrite?, beatErrorRate?}`, `presenceDowntimeDoor {kind:'manual', eventId?|from,to, reason} | {kind:'edge-region', region, from, to}`, `presenceTickDoor {}`, `presenceHealthDoor {eventId}`, admin body `presenceDowntimeAdd`), zod-free `passportGuard.ts` (`isStampEvent`, `isStamp`, `isStampList`, `isBeatResponse`), `authorPath.ts` + `authorPath.schemas.ts` (`{points: {eventId, planned}[], hidden}`); exports via `schemas.ts` / `index.ts`. Client `lib/api/contracts/passport.ts` `PassportClaimReason` += `no-presence`. Order: P2 lands before any server or web phase imports it. Baseline gains entries only.
- **Migration:** yes → one migration `<ts>_spec14_presence` [П-1] (nine new tables, no change to existing tables — expand-only, compatible with the previous image, migration-safety check 9). Commands: `pnpm --dir server migrate:create spec14_presence` (`server/package.json:21`), `node scripts/fix-migration-down.mjs <file>`, migcheck.
- **Seed / fixture data:** no seed rows (all data is per subject); test state is built through doors (`presence-*`, `rights-*`, `clock`) — skill `seed-and-fixtures` not triggered (no seed source changes). The catalog seed already holds the events the tests use.
- **Build-only failures:** yes → (1) `passport` joins `HTTP_DOMAINS`, pulling `lib/api/http/passport.ts` into the integration build: zod must not enter the site bundle (guard only) — `next build` + `scripts/check-bundle.mjs` in L, and `build:int` in P15; (2) `next.config.ts:5,30` reads `HTTP_DOMAINS` — same builds; (3) `server/src/admin/*.tsx` enter the server Next build — server build once in P12 (`node scripts/lock.mjs --mode exclusive -- npx next build` in `server/`, stop `serve` first).
- **Wire contract:** yes → routes `POST /api/presence`, `POST|GET /api/me/stamps`, `GET /api/chat/authors/:authorId/path`, reason `no-presence`, event `stamp`. Check: skill contract-conformance — `passport` suite on sim and http (W44–W45); docs patch carries the `frontend-seam.md` rows (W50).
- **Layout fidelity:** yes → `passport` switches to `http`; skill `layout-fidelity` on the passport, country, room and TV boards with the integration build — conductor in L, `--workers=2`.
- **Payload migration:** yes (DDL migration, no collection change) → skill `migration-safety` checks in W10 (check 1 reported as the named DDL deviation).
- **Test doors:** yes → W21–W23; the production-build test `server/test/e2e/doors-404.e2e.ts` walks the door list and proves 404 outside `test`.
- **Agent write surface:** no → no agent role or key changes.
- **Seed and fixtures:** no → see above.

## Work items

### P1 — Shared rules: beat interval, achievements, stamp composer (Lane B, sonnet)

### W1 — Beat interval constant
- **Serves:** AC-13; enables AC-2, AC-10.
- **Do:** `PULSE_INTERVAL_MS = 20_000` in `packages/rules/src/time/constants.ts`, re-exported from `time/index.ts`; row in `exports.test.ts` and in the `calls`/constants map of `boundaries.shared.test.ts:240-300`; name added to `RULE_CONSTANT_NAMES` in `packages/rules/eslint/no-time-rule-copy.mjs:14`.
- **Files:** `packages/rules/src/time/{constants,index}.ts`, `packages/rules/eslint/no-time-rule-copy.mjs`, `packages/rules/test/{exports,boundaries.shared}.test.ts`.
- **Done means:** tests list the constant with value 20000; root and server eslint still load the rule.
- **Verify:** rules files; web files on `eslint.config.mjs` (lint only).
- **Rules that apply:** no copy of time rules outside the package.
- **Risk:** low.

### W2 — `achievementsOf`
- **Serves:** AC-41, AC-42.
- **Do:** `packages/rules/src/passport/achievements.ts` [П-8]: input `stamps: readonly {eventId, countryIso, zoneId}[]`, `zoneOrder(zoneId): number`, `season` → sorted list of keys reached; `packages/rules/src/passport/index.ts`; `package.json` export `./passport`. Fixtures in `packages/rules/test/achievements.test.ts`: 3 countries, 5 zones, 10/10, adjacent run of 5 ending at the highest order, a gap breaks the run, run not ending at the highest order does not count.
- **Files:** `packages/rules/src/passport/{achievements,index}.ts`, `packages/rules/package.json`, `packages/rules/test/achievements.test.ts`.
- **Done means:** fixtures green; export listed in `exports.test.ts`.
- **Verify:** rules files.
- **Rules that apply:** pure, no data import.
- **Risk:** low.

### W3 — `stampOf`
- **Serves:** AC-36, AC-31.
- **Do:** `packages/rules/src/passport/stamp.ts` [П-7] — same output fields and rules as `lib/engine/stamp.ts:16-22` (`buildStamp`), Dataset-free; unit test with two events of one country → two distinct stamps.
- **Files:** `packages/rules/src/passport/stamp.ts`, `packages/rules/test/stamp.test.ts`.
- **Done means:** green; export listed.
- **Verify:** rules files.
- **Rules that apply:** pure.
- **Risk:** `buildStamp` may read zone data beyond city/country — mirror exactly what it reads.

### W4 — Parity with the site
- **Serves:** AC-42, AC-36.
- **Do:** export the pure helpers of `lib/api/sim/NotificationsGenerator.tsx:25-46,68-73` (no behaviour change); `tests/unit/passport/rules-parity.test.ts`: (a) for shared fixtures and for random subsets of dataset events, `achievementsOf` keys equal the generator's outcomes (mapped to keys); (b) for every dataset event, `stampOf(datasetLookups, e)` deep-equals `buildStamp(...)`.
- **Files:** `lib/api/sim/NotificationsGenerator.tsx`, `tests/unit/passport/rules-parity.test.ts`.
- **Done means:** green.
- **Verify:** web files on the two files.
- **Rules that apply:** react-best-practices — exports only, no render change.
- **Risk:** low.

### P2 — Contracts and client vocabulary (Lane B, sonnet)

### W5 — Passport wire contract
- **Serves:** AC-58, AC-1, AC-23, AC-39, NFR-4.
- **Do:** as `Contract changes` → `passport.ts`, `passport.schemas.ts`, `passportGuard.ts`, exports. Tests: strict bodies reject `playerState`, 9 ids, 65-char id, unknown source; guard agrees with zod on valid/invalid envelopes.
- **Files:** `packages/contracts/src/{passport,passport.schemas,passportGuard,schemas,index}.ts`, `packages/contracts/test/passport.test.ts`.
- **Done means:** tests green.
- **Verify:** contracts files.
- **Rules that apply:** contract-conformance §1, §4; zod only in `*.schemas.ts`.
- **Risk:** low.

### W6 — Author-path schema
- **Serves:** AC-49.
- **Do:** `authorPath.ts` (type) + `authorPath.schemas.ts` (`authorPathResponse` strict), exported; test.
- **Files:** `packages/contracts/src/{authorPath,authorPath.schemas}.ts`, `packages/contracts/test/authorPath.test.ts`.
- **Done means:** green.
- **Verify:** contracts files.
- **Rules that apply:** owned by SPEC-14; no chat adapter.
- **Risk:** low.

### W7 — Client reason and baseline
- **Serves:** AC-58.
- **Do:** `PassportClaimReason` += `'no-presence'` (`lib/api/contracts/passport.ts:12-16`, comment: `forbidden`); `seam-vocabulary.test.ts` lists it; `node scripts/contract-surface.mjs --update` (additions only — inspect the diff).
- **Files:** `lib/api/contracts/passport.ts`, `tests/unit/api/seam-vocabulary.test.ts`, `scripts/contract-surface.baseline.json`.
- **Done means:** `contract-surface --check` green, baseline diff has only additions.
- **Verify:** web files on the two `.ts` files; `node scripts/contract-surface.mjs --check`.
- **Rules that apply:** additive only.
- **Risk:** low.

### P3 — Tables and the migration (Lane A, sonnet)

### W8 — Migration `spec14_presence`
- **Serves:** AC-3, AC-30, NFR-5 (no subject column in samples); enables all server ACs.
- **Do:** [П-1] tables and constraints exactly; `migrate:create` → `fix-migration-down.mjs` → DDL in `up`, reverse `DROP TABLE` in `down`; add to `migrations/index.ts`.
- **Files:** `server/src/migrations/{<ts>_spec14_presence.ts,<ts>_spec14_presence.json,index.ts}`.
- **Done means:** migcheck clean.
- **Verify:** migcheck.
- **Rules that apply:** skill `migration-safety` (all checks; check 1 = named DDL deviation).
- **Risk:** blank-migration prompt — use the non-interactive accept (SPEC-11 W8).

### W9 — Ports
- **Serves:** enables P4–P12.
- **Do:** `server/src/presence/ports.ts` — row types and store interfaces (`ProofStore`, `MomentStore`, `SampleStore`, `HealthStore`, `DowntimeStore`, `StampStore`, `AchievementStore`, `AuthorIdStore`) over `RightsDb`; `PresenceFaults` type [П-10].
- **Files:** `server/src/presence/ports.ts`.
- **Done means:** compiles.
- **Verify:** server files.
- **Rules that apply:** onion — ports only, no SQL here.
- **Risk:** low.

### W10 — Schema test
- **Serves:** NFR-5, AC-30 (constraint).
- **Do:** `server/test/integration/presence-schema.int.test.ts`: the nine tables exist; duplicate proof/stamp/health key → `23505`; `presence_samples` has no subject column; `reason` > 200 rejected.
- **Files:** `server/test/integration/presence-schema.int.test.ts`.
- **Done means:** green; `node scripts/verify-schema.mjs` green.
- **Verify:** one int file; `node scripts/verify-schema.mjs`.
- **Rules that apply:** —
- **Risk:** low.

### P4 — Presence domain and proof store (Lane A, opus — presence proof)

### W11 — Pure presence rules
- **Serves:** AC-2, AC-4, AC-8, AC-9, AC-10, AC-11, AC-28, NFR-8.
- **Do:** `domain/presence/beatSchedule.ts` (`nextBeatMs(now, moments)` per [А2] with `PULSE_INTERVAL_MS`, 900 000 cap, `null` after m + 15 s + Δ for all), `window.ts` (`windowOf(m)`, `inWindow(receivedAt, m)` via `isPresentByPulses({moment, pulses:[{receivedAt}], intervalMs, delta})`), `source.ts` (priority from rules), `eventValidity.ts` (season catalog, `slot==='midnight'`, not hidden after patch) [П-4]; `server/test/unit/presence-domain.test.ts` (AC-2 table: m − 1 h, m − 4 min, m − 30 s, m + 20 s → 900000, 60000, 20000, null; `openedAt` ignored).
- **Files:** `server/src/domain/presence/{beatSchedule,window,source,eventValidity}.ts`, `server/test/unit/presence-domain.test.ts`.
- **Done means:** green; no time constant re-declared (eslint).
- **Verify:** server files.
- **Rules that apply:** onion ring 1; `no-time-rule-copy`.
- **Risk:** low.

### W12 — Shared boundary cases on the server
- **Serves:** AC-10.
- **Do:** `server/test/unit/presence-rules-shared.test.ts` imports `packages/rules/test/boundaries.shared.test.ts` unchanged (Spec follow-up 1).
- **Files:** `server/test/unit/presence-rules-shared.test.ts` (+ server vitest include only if needed — report).
- **Done means:** FR-STAMP-03 cases run in the server suite and pass.
- **Verify:** server files.
- **Rules that apply:** —
- **Risk:** import path resolution from `server/`.

### W13 — Proof, moments, intake counters, `FastStore.info`
- **Serves:** AC-3, AC-4, AC-6, AC-7, AC-9, AC-12, AC-14, AC-17, AC-32, AC-56.
- **Do:** `presence/proofs.ts` [П-3] (marker keys TTL 48 h, insert-if-absent, source upgrade, DB fallback, `unavailable` outcome, faults); `presence/moments.ts` [П-4] (upsert seen moments, list accepted moments for an event at `now`); `presence/intake.ts` [П-5] (per-node accepted/failed counters; per window `pre`/`in` distinct counters); `presence/faults.ts` [П-10]; optional `FastStore.info()` in `server/src/ports.ts` and both stores in `adapters/redis.ts`. Unit `server/test/unit/presence-proofs.test.ts` with the memory store and a throwing store.
- **Files:** `server/src/presence/{proofs,moments,intake,faults}.ts`, `server/src/ports.ts`, `server/src/adapters/redis.ts`, `server/test/unit/presence-proofs.test.ts`.
- **Done means:** unit green: first beat inserts once, tenth does not; `tv` then `country` → `country`; throwing store → DB insert; both failing → `unavailable` + failed +1; every key written with TTL ≤ 172 800 s.
- **Verify:** server files.
- **Rules that apply:** onion; NFR-5 (no subject id in logs).
- **Risk:** `FastStore` is shared by every domain — the new method is optional so no other caller changes.

### P5 — Beat route (Lane A, opus — presence proof)

### W14 — Beat service and route
- **Serves:** AC-1, AC-2, AC-3, AC-6, AC-7, AC-8, NFR-4, NFR-5, NFR-7.
- **Do:** `presence/beats.ts` (per valid event: record moments, in-window → proof; counters; `nextBeatMs` from valid events only); `endpoints/presence.ts` row `presence-beat`: `POST /api/presence`, body `presenceBeatBody`, `subject:'required'` (guest created, [А15]), `needs:['db']`, `maxBodyBytes: 1024`, `rateLimit:'presence-beat'`, `Cache-Control: private, no-store`; `presenceOf(deps)` in `endpoints/deps.ts`.
- **Files:** `server/src/presence/beats.ts`, `server/src/endpoints/{presence,deps}.ts`.
- **Done means:** covered by W16.
- **Verify:** server files.
- **Rules that apply:** security — subject only from session; never 503 on Redis down [П-3].
- **Risk:** low.

### W15 — Registry rows
- **Serves:** AC-5, AC-35, AC-54, AC-6, AC-64.
- **Do:** `registries/routes.ts` += presence rows; `registries/rateLimits.ts` += `author-path` (60/min, device, memory), `presence-beat` (12/min, subject, memory), `stamp-claim` (60/min, subject, memory) — one line each, sorted; `registries/ops.ts` domain `presence`: drop `reserved`, add `presence/fast-store-down` (`log`); metrics `presence.beatsPerSecond`, `presence.beatErrorShare`, `presence.claims`, `presence.downtimeWindows`; `presence.rooms`/`presence.realtimeConnections` re-labelled to SPEC-15 (Assumptions).
- **Files:** `server/src/registries/{routes,rateLimits,ops}.ts`.
- **Done means:** startup checks pass; `test/unit/ops-registry.test.ts` green; no metric with `pendingNote` naming SPEC-14.
- **Verify:** server files (+ `npx vitest run test/unit/ops-registry.test.ts test/unit/ops-alarm-domain.test.ts`).
- **Rules that apply:** registries one line per row, sorted.
- **Risk:** low.

### W16 — Beat integration test
- **Serves:** AC-1–AC-9, AC-11 (beat side), AC-56 (TTL), NFR-4, NFR-5, NFR-7.
- **Do:** `server/test/integration/presence-beats.int.test.ts` on the test clock: each Verify line of AC-1…AC-9; AC-11 beat at m − 5 min with `openedAt` = m − 30 s → no proof; 1.1 KB body → 413; headers; log capture has no IP/email/subject id; Redis-down fake (pattern `rights-bans.int.test.ts:28-60`) → one proof, `ok`, one alarm row per minute; Redis-down + DB fault → `unavailable` 5000; `TTL` of every `pr:*` key ≤ 172 800.
- **Files:** `server/test/integration/presence-beats.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file.
- **Rules that apply:** test clock reset in `afterAll`.
- **Risk:** low.

### P6 — Health log and finalisation (Lane A, opus — intake health log, finalisation)

### W17 — Pure health signs
- **Serves:** AC-16, AC-17.
- **Do:** `domain/presence/healthSigns.ts` `healthOf(...)` [П-5] with all seven signs of [А5]; unit `server/test/unit/presence-health-signs.test.ts`: one case per sign; errors 0.5 % → healthy, 2 % → `beat-errors`; rate drop 40/15 → sign, 40/25 and 10/2 → healthy; missing counters → `beat-rate-drop`; gap >10 s for a live node → `sample-gap`; run id change / uptime < window age → `fast-store-restart`.
- **Files:** `server/src/domain/presence/healthSigns.ts`, `server/test/unit/presence-health-signs.test.ts`.
- **Done means:** green.
- **Verify:** server files.
- **Rules that apply:** pure.
- **Risk:** low.

### W18 — Sampler
- **Serves:** AC-14.
- **Do:** `presence/samples.ts` (`sampleOnce(now)`: node id, `info()`, reachability, counters since last; write row; on failure raise `presence/finalise-failed`); start in `server/src/container.ts` with the background jobs, not in `test` (doors drive it).
- **Files:** `server/src/presence/samples.ts`, `server/src/container.ts`.
- **Done means:** covered by W20.
- **Verify:** server files.
- **Rules that apply:** security (`container.ts`); time from `deps.clock`.
- **Risk:** timer leaks in tests — sampler is off in `test`.

### W19 — Finaliser, downtime records, alarms
- **Serves:** AC-15, AC-16, AC-19 (service), AC-20, AC-21, AC-22, AC-64.
- **Do:** `presence/health.ts` (finalise windows due on the tick; one record per window; never `healthy` on incomplete data); `presence/downtime.ts` (append manual record, internal `reportEdgeFailure({region, from, to})` — overlapping windows get `edge-region`; list for season; alarm once + internal event `presence.downtime-recorded` [П-5]); `registries/moments.ts` row `presence-finalise` (`capability:'SPEC-14'`, `kinds:['event-stamp']`, `late:'always'`); `registries/ops.ts` += `presence/downtime` (`page`), `presence/finalise-failed` (`log`). Internal event publish API: `deps.events.publish(tx, topic, payload)` (`events/ports.ts:30`) — how a raw-SQL service obtains a `Tx` (to confirm; else publish after commit in its own Payload transaction).
- **Files:** `server/src/presence/{health,downtime}.ts`, `server/src/registries/{moments,ops}.ts`.
- **Done means:** covered by W20.
- **Verify:** server files.
- **Rules that apply:** moments row idempotent by `consequenceId`, time only from `group.now`.
- **Risk:** double finalisation from tick and moment row — the unique key makes the second a no-op.

### W20 — Health and alarm integration tests
- **Serves:** AC-14, AC-15, AC-18 (record absence), AC-20, AC-22, AC-64.
- **Do:** `presence-health.int.test.ts` (in-process harness): 30 s of test clock with 6 sample calls → 6 rows with the listed fields; record ≤ 30 s after end + 10 s (scheduler night-run support `test/integration/scheduler-support.ts`); restart harness after the window → record ≤ 30 s after boot; second run → one record; DB write fault → `finalise-failed` alarm row, no `healthy`; internal event count 1 per downtime. `presence-alarms.int.test.ts`: `expectAlarmInTestChannel` (`test/support/expectAlarmInTestChannel.ts:23`) for `presence/downtime`, `presence/fast-store-down`, `presence/finalise-failed` with `startTelegramFake` — test channel only.
- **Files:** `server/test/integration/{presence-health,presence-alarms}.int.test.ts`.
- **Done means:** both green.
- **Verify:** one int file each.
- **Rules that apply:** no live Telegram.
- **Risk:** scheduler timing flake — use the night-run harness, not wall time.

### P7 — Test doors (Lane A, opus — test doors)

### W21 — Presence doors
- **Serves:** AC-63, AC-16, AC-21, AC-29.
- **Do:** `server/src/test-doors/presence.ts`: `presence-fault` (writes [П-10] switch), `presence-downtime` (manual or edge report via `presence/downtime.ts`), `presence-tick` (`sampleOnce` + finalise at current clock), `presence-health` (records, samples, downtimes for an event); `clearPresenceTables` (nine tables) — `pr:*` keys go with the prefix wipe.
- **Files:** `server/src/test-doors/presence.ts`.
- **Done means:** covered by W23.
- **Verify:** server files.
- **Rules that apply:** security → registered only with `T2F_ENV=test` + `T2F_TEST_DOORS=1`; bodies from W5.
- **Risk:** low.

### W22 — Registry, reset, counts
- **Serves:** AC-63.
- **Do:** rows sorted into `test-doors/registry.ts` (header 32 → 36), `reset` calls `clearPresenceTables` and resets faults; counts 36 in `test/integration/streams-doors.int.test.ts:111`, `test/unit/doors-gating.test.ts:106`, `test/e2e/doors-404.e2e.ts:69` (+ its `DOORS` list).
- **Files:** `server/src/test-doors/registry.ts`, `server/test/integration/streams-doors.int.test.ts`, `server/test/unit/doors-gating.test.ts`, `server/test/e2e/doors-404.e2e.ts`.
- **Done means:** the four places say 36.
- **Verify:** server files; one int file (`streams-doors`).
- **Rules that apply:** contractCheck «Test doors».
- **Risk:** low.

### W23 — Doors and signs tests
- **Serves:** AC-63, AC-16, AC-17, AC-21, AC-29 (kinds).
- **Do:** `presence-doors.int.test.ts`: each door works; 404 identical to unknown path without `T2F_TEST_DOORS`; after `reset` the nine tables are empty. `presence-signs.int.test.ts` (HTTP + doors + clock): one test per sign (fault down / restart / errors 2 %, no ticks 15 s, rate drop 40→15, edge report overlapping two windows → both `edge-region` `recordedBy: system`, manual) → `downtime` with that sign; errors 0.5 % → `healthy`.
- **Files:** `server/test/integration/{presence-doors,presence-signs}.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file each.
- **Rules that apply:** —
- **Risk:** `fast-store-restart` simulated by the fault switch here; the real restart is P16.

### P8 — Claim decision (Lane A, opus — claim decision: codes, downtime, old moment)

### W24 — `claimDecision`
- **Serves:** AC-11, AC-18, AC-24–AC-29, AC-32–AC-34, NFR-8.
- **Do:** `domain/presence/claimDecision.ts` [П-6]; unit `server/test/unit/presence-claim-decision.test.ts` covering every branch, the `retryAfterMs` ranges, close + Δ ± 1 ms, old window before/after celebration end, pass flag absent from the input type.
- **Files:** `server/src/domain/presence/claimDecision.ts`, `server/test/unit/presence-claim-decision.test.ts`.
- **Done means:** green.
- **Verify:** server files.
- **Rules that apply:** pure; `ratingCloseAt` from rules.
- **Risk:** low.

### W25 — Stamp service and view
- **Serves:** AC-12, AC-23, AC-24, AC-30, AC-31, AC-32, AC-36, NFR-5.
- **Do:** `presence/stamps.ts` (transaction, insert-if-absent, re-read, `old-moment` journal row, consequences hook only on insert); `domain/passport/stampView.ts` (server lookups over `StoredCatalog` → rules `stampOf`); unit `server/test/unit/presence-stamp-view.test.ts` (every seeded event: server view = `stampOf` with dataset lookups — seed source to confirm in `server/src/seed/`).
- **Files:** `server/src/presence/stamps.ts`, `server/src/domain/passport/stampView.ts`, `server/test/unit/presence-stamp-view.test.ts`.
- **Done means:** unit green.
- **Verify:** server files.
- **Rules that apply:** onion; no subject id in logs.
- **Risk:** low.

### W26 — Stamp routes
- **Serves:** AC-23, AC-34, AC-35, AC-37, NFR-4, NFR-7.
- **Do:** `endpoints/stamps.ts`: `stamp-claim` (`POST /api/me/stamps`, `subject:'required'`, `maxBodyBytes: 1024`, `rateLimit:'stamp-claim'`), `stamps-list` (`GET /api/me/stamps`, no `subject:'required'`, no subject → `[]`, ordered by `grantedAt`, current season); both `private, no-store`; rows in `registries/routes.ts`. No other code path writes `stamps` (AC-34).
- **Files:** `server/src/endpoints/stamps.ts`, `server/src/registries/routes.ts`.
- **Done means:** covered by W27.
- **Verify:** server files.
- **Rules that apply:** security, contract-conformance.
- **Risk:** low.

### W27 — Claim integration tests
- **Serves:** AC-11, AC-12, AC-18, AC-23–AC-37, NFR-4, NFR-5, NFR-7, NFR-8.
- **Do:** `presence-claim.int.test.ts`: Verify lines of AC-11, AC-12 (`FLUSHDB` of the worktree Redis DB), AC-18, AC-23–AC-31, AC-34 (pass via `rights/pass-grant`, no proof, healthy → `no-presence`), AC-35, AC-36 (int: change the country illustration → stamp changes), AC-37; log capture; headers. `presence-old-moment.int.test.ts`: AC-32, AC-33 (correction via the corrections door/fixture used by SPEC-08 tests — to confirm). `server/test/unit/presence-no-wallclock.test.ts`: no `Date.now(` in `server/src/{domain/presence,domain/passport,presence}/**`.
- **Files:** `server/test/integration/{presence-claim,presence-old-moment}.int.test.ts`, `server/test/unit/presence-no-wallclock.test.ts`.
- **Done means:** green.
- **Verify:** one int file each; server files.
- **Rules that apply:** test clock only.
- **Risk:** low.

### P9 — Grant consequences (Lane A, sonnet)

### W28 — Achievements store and seasons
- **Serves:** AC-38, AC-41, AC-43.
- **Do:** `presence/achievements.ts` (on insert: `achievementsOf` over the season's stamps, insert new keys); stamp reads filter by the current catalog season key.
- **Files:** `server/src/presence/achievements.ts`, `server/src/presence/stamps.ts`.
- **Done means:** covered by W30.
- **Verify:** server files.
- **Rules that apply:** never delete achievements.
- **Risk:** low.

### W29 — Events on grant
- **Serves:** AC-39, AC-40.
- **Do:** `presence/events.ts`: `stamp` `granted` envelope on `user:#<subject>` via `publisherOf(deps)` (never throws, logs result — pattern `rights/events.ts:72-90`); internal event `passport.stamp-granted {subject, season, eventId, grantKind, newKeys}` once per inserted stamp.
- **Files:** `server/src/presence/events.ts`.
- **Done means:** covered by W30.
- **Verify:** server files.
- **Rules that apply:** publish failure never fails the claim.
- **Risk:** low.

### W30 — Grant integration test
- **Serves:** AC-38–AC-41, AC-43.
- **Do:** `presence-grant.int.test.ts` (Centrifugo): second tab gets `granted` ≤ 3 s; publish fault → claim `ok` + log line; one internal event per stamp, repeat claim → none; 3rd country writes `goal:2026-27:countries:3`; season switch → `[]`, old stamps and achievements remain; new season → empty achievements.
- **Files:** `server/test/integration/presence-grant.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file.
- **Rules that apply:** —
- **Risk:** season switch fixture — use the catalog door used by SPEC-04/08 tests (to confirm).

### P10 — Merge, subject data, retention (Lane A, opus — guest merge authLinks row)

### W31 — authLinks row `stamps`
- **Serves:** AC-44–AC-47.
- **Do:** `presence/links.ts` (pattern `rights/links.ts:66-101`: `db.tx`, lock guest rows, move proofs/stamps/achievements, keep the earlier `issued_at` per event, recompute achievements, after commit: `snapshot` to `user:#<account>`, internal event `passport.merged` with only new keys, highest threshold per kind, none if empty); row in `registries/authLinks.ts`.
- **Files:** `server/src/presence/links.ts`, `server/src/registries/authLinks.ts`.
- **Done means:** covered by W34.
- **Verify:** server files.
- **Rules that apply:** idempotent for (from, to); may throw → existing retry path.
- **Risk:** stamp row conflict on move — resolve with `ON CONFLICT` keeping the earlier issued.

### W32 — Subject-data rows
- **Serves:** AC-55, AC-56.
- **Do:** `presence/subjectData.ts` handler `stamps` (export stamps of all seasons, achievements, proofs, old-moment journal; erase/anonymise delete them) — pattern `rights/subjectData.ts`; `registries/subjectData.ts` += declarative `presence-beats` (retention "≤ 48 h") and handler `stamps`, sorted.
- **Files:** `server/src/presence/subjectData.ts`, `server/src/registries/subjectData.ts`.
- **Done means:** covered by W34.
- **Verify:** server files (+ `test/unit/subject-data-registry.test.ts` if it lists rows).
- **Rules that apply:** handlers hold no deps (`requireSubjectDataDeps`).
- **Risk:** low.

### W33 — Proof retention job
- **Serves:** AC-57.
- **Do:** `presence/retention.ts` [П-11] and job `presence-retention` in `server/src/ops/runner.ts` (+ ops job row if the runner needs one — to confirm).
- **Files:** `server/src/presence/retention.ts`, `server/src/ops/runner.ts`.
- **Done means:** covered by W34.
- **Verify:** server files.
- **Rules that apply:** time from the passed `now`.
- **Risk:** low.

### W34 — Merge and subject-data tests
- **Serves:** AC-44–AC-47, AC-55–AC-57.
- **Do:** `presence-merge.int.test.ts` (Verify lines of AC-44–AC-47; door `rights/link-fault {handler:'stamps'}`); `presence-subject-data.int.test.ts` (`runSubjectDataInScope` export lists four groups, erase leaves none; registry row `presence-beats`; close + 24 h + 1 min → no proofs, stamps remain).
- **Files:** `server/test/integration/{presence-merge,presence-subject-data}.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file each.
- **Rules that apply:** —
- **Risk:** low.

### P11 — Author path (Lane A, sonnet)

### W35 — Opaque author ids
- **Serves:** AC-52.
- **Do:** `presence/authorIds.ts` [П-9] (`authorIdOf`, `subjectOfAuthor`).
- **Files:** `server/src/presence/authorIds.ts`.
- **Done means:** covered by W37.
- **Verify:** server files.
- **Rules that apply:** id never derived from the subject id.
- **Risk:** low.

### W36 — Path rule and route
- **Serves:** AC-49, AC-50, AC-51, AC-53, AC-54, NFR-7.
- **Do:** `domain/passport/authorPath.ts` (pure: pass, `showPath`, own, banned → shape; points = stamps `planned:false` + scheduled future events without a stamp `planned:true`); `presence/authorPath.ts` (reads `rightsOf(deps).passes`, `profiles.settings` via `settingsOf` (`domain/rights/settings.ts:10`), schedule, `bans.isBlocked`); `endpoints/chatAuthors.ts` `GET /api/chat/authors/:authorId/path` (`rateLimit:'author-path'`, `private, no-store`); row in `registries/routes.ts`.
- **Files:** `server/src/domain/passport/authorPath.ts`, `server/src/presence/authorPath.ts`, `server/src/endpoints/chatAuthors.ts`, `server/src/registries/routes.ts`.
- **Done means:** covered by W37.
- **Verify:** server files.
- **Rules that apply:** security — data of others only by pass + `showPath`.
- **Risk:** guest pass by device (CAP-ID) — use `passes.hasPass(subject, device)` of the **author** (the author's device is not the caller's: use `passes.view({accountId, device:null})` for accounts and the guest's own device record — to confirm in `rights/passes.ts:54-62`).

### W37 — Author path test
- **Serves:** AC-49–AC-54.
- **Do:** `chat-author-path.int.test.ts`: wire schema; four cases; 2 stamps + 3 scheduled (1 past) → 4 points, 2 planned; random id → `not_found`; `authorIdOf` stable and ≠ subject id; `rights/ban` → hidden; 61st request → `rate_limited`; headers.
- **Files:** `server/test/integration/chat-author-path.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file.
- **Rules that apply:** —
- **Risk:** low.

### P12 — Owner slice `37-presence` (Lane A, sonnet)

### W38 — Slice and endpoints
- **Serves:** AC-19.
- **Do:** `admin/presenceEndpoints.ts` under `/cms-api/presence/*` (owner-only, list season records + samples summary, add downtime with audit; no update/delete handlers → `forbidden`); wire in `admin/cmsEndpoints.ts`; `admin/PresenceSlice.tsx` + `PresenceView.tsx` (pattern `BansSlice`, poll 5 s while visible), texts in `admin/messages.ts`; `registries/adminSlots.ts` row `37-presence`.
- **Files:** `server/src/admin/{presenceEndpoints,cmsEndpoints,messages}.ts`, `server/src/admin/{PresenceSlice,PresenceView}.tsx`, `server/src/registries/adminSlots.ts`.
- **Done means:** server build once succeeds.
- **Verify:** server files; server build (`node scripts/lock.mjs --mode exclusive -- npx next build` in `server/`, alone).
- **Rules that apply:** owner checks per `cmsHttp.ts`; audit via `resolveActor`.
- **Risk:** HEAVY build — never with another heavy process.

### W39 — Slice tests
- **Serves:** AC-19.
- **Do:** `admin-slots.int.test.ts:36` list += `37-presence`; `presence-admin.int.test.ts`: owner adds → `recordedBy: owner` + audit row; delete/edit → `forbidden`; non-owner → `unauthorized`.
- **Files:** `server/test/integration/{admin-slots,presence-admin}.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file each.
- **Rules that apply:** —
- **Risk:** low.

### P13 — Web client (Lane B, sonnet)

### W40 — http adapter `passport`
- **Serves:** AC-48, AC-59.
- **Do:** `lib/api/http/passport.ts` `createHttpPassport({fetch?, transport})`: `stamps`, `peek` (last list), `subscribe` (`user:#<subject>`, `isStampEvent`), `beat`, `claim` (errors via `errorOf` keep `reason`/`retryAfterMs`), `trackPresence(surface, clock)` = `registerSurface` exactly as sim (`lib/api/sim/passport.ts:53-96`) **plus** a beat loop: first beat on register, then after `nextBeatMs` (stop on `null`, re-arm on surface change); no `mergeGuest`.
- **Files:** `lib/api/http/passport.ts`.
- **Done means:** covered by W43.
- **Verify:** web files.
- **Rules that apply:** frontend-ui-architecture; zod-free; one timer per surface.
- **Risk:** beat timer must use the passed `PresenceClock`, not `Date.now`.

### W41 — Switch the domain
- **Serves:** AC-59.
- **Do:** `HTTP_DOMAINS` += `'passport'` (`lib/api/http/domains.ts:7`); factory in `lib/api/http/index.ts:30-38` (`transport: realtimeLoader`); `HTTP_NOW` in `tests/unit/api/integration-build.test.tsx:17`; `tests/unit/api/live-http.test.ts:88`.
- **Files:** `lib/api/http/{domains,index}.ts`, `tests/unit/api/{integration-build.test.tsx,live-http.test.ts}`.
- **Done means:** both tests green with `passport` as http.
- **Verify:** web files.
- **Rules that apply:** —
- **Risk:** low.

### W42 — Claimer and sim
- **Serves:** AC-60, AC-61.
- **Do:** `lib/passport/stampClaims.ts`: remove only on `forbidden` + `reason:'no-presence'`; wait ≥ `retryAfterMs` when present (else fixed backoff); other non-retryable → mark "settled" (persisted in `t2f:stamp-claims:v1`), keep the stamp, no further calls after `resume()`; `lib/api/sim/passport.ts`: claim without device presence → `forbidden/no-presence`, unknown event → `not_found/unknown-event`, after rating close → `conflict/claim-closed`.
- **Files:** `lib/passport/stampClaims.ts`, `lib/api/sim/passport.ts`, `lib/api/hooks/passport.ts` (only if the claimer API changes).
- **Done means:** covered by W43; existing `passport-sim.test.tsx`, `passport-patched.test.tsx` green.
- **Verify:** web files.
- **Rules that apply:** constitution III (stamp stays on the device).
- **Risk:** persisted format change — keep reading v1 entries.

### W43 — Client unit tests
- **Serves:** AC-48, AC-59, AC-60.
- **Do:** `tests/unit/api/passport-http.test.ts` (`mergeGuest` undefined; beat loop follows `nextBeatMs`, stops on `null`; surfaces registered); `tests/unit/passport/stamp-claims.test.ts` (`claim-closed`, `unknown-event`, `validation` → kept, no calls after resume; `retryAfterMs` 9000 → next attempt ≥ 9 s; `no-presence` → removed).
- **Files:** `tests/unit/api/passport-http.test.ts`, `tests/unit/passport/stamp-claims.test.ts`.
- **Done means:** green.
- **Verify:** web files.
- **Rules that apply:** react-testing-library where hooks are rendered.
- **Risk:** low.

### P14 — Contract suite (Lane B, sonnet)

### W44 — `passport` suite
- **Serves:** AC-61.
- **Do:** `tests/contract/passport.suite.ts` `describeDomain(name, makeService, ctx)`: empty list; beat → `nextBeatMs`; presence then claim → stamp, repeat identical; healthy window without presence → `no-presence`; unknown event → `unknown-event`; after close → `claim-closed`; `granted` via `subscribe`. Ctx: `clockTo(ms)`, `markHealthy(eventId)`, `closeRating()` — sim via store helpers in `tests/unit/api/passport-contract.test.ts`, http via doors (`clock`, `presence-tick`) in `tests/contract/passport.http.test.ts` (pattern `profile.http.test.ts`: `Jar`, `door`).
- **Files:** `tests/contract/{passport.suite,passport.http.test}.ts`, `tests/unit/api/passport-contract.test.ts`.
- **Done means:** `node scripts/contract-run.mjs --sim-only` → `passport` green.
- **Verify:** web files on the three files.
- **Rules that apply:** contract-conformance §2; file names match `contract-run.mjs:23-35`.
- **Risk:** low.

### W45 — Both columns green
- **Serves:** AC-61.
- **Do:** serve the worktree server (slot 28); contract run; fix only W44 wiring; behaviour mismatch → back to the owning phase file (report).
- **Files:** (none new).
- **Done means:** `passport` green on sim and http.
- **Verify:** contract run.
- **Rules that apply:** one heavy process.
- **Risk:** low.

### P15 — Browser e2e "rewind to midnight → stamp from the server" (Lane B, sonnet)

### W46 — e2e
- **Serves:** AC-59.
- **Do:** `tests/e2e/server-clock/passport-stamp.spec.ts`: integration build (`pnpm build:int`), worktree server (`node server/scripts/stack.mjs serve`, `T2F_E2E_SERVER`); open a country page (video muted), move the server clock to m − 30 s, wait past m + 15 s, assert the stamp shows and `GET /api/me/stamps` (same cookies) contains it with grant kind from the server; stamp not shown as "unconfirmed" after 1 min.
- **Files:** `tests/e2e/server-clock/passport-stamp.spec.ts`.
- **Done means:** `npx playwright test -c playwright.http.config.ts --project=server-clock --workers=1 tests/e2e/server-clock/passport-stamp.spec.ts` green once.
- **Verify:** that command.
- **Rules that apply:** test port, never 3000; HEAVY (build + serve) — alone.
- **Risk:** disk space for `out-int` — check free space first.

### P16 — FR-STAMP-13 small-scale restart test and load scripts (Lane A, opus — FR-STAMP-13)

### W47 — Exclusive restart test
- **Serves:** AC-65, NFR-3, NFR-6.
- **Do:** `server/test/exclusive/presence-restart.exclusive.test.ts` + `support/virtualClients.ts`: N = `T2F_PRESENCE_N` (default 1500) cookie-jar clients beat from m − 3 min per `nextBeatMs`; at test-clock m run `docker compose -p t2f -f docker-compose.yml restart redis` (pattern `deps-down.exclusive.test.ts:79-97`, wait healthy); all claim from m + 15 s with retry on `unavailable`; assert 0 `no-presence`, N/N stamps ≤ m + 15 s + 5 min, kinds ⊂ `presence|downtime`, all proofs present after restart; control run without restart: 100 non-beating subjects → `no-presence`, share confirmed ≤ m + 60 s ≥ 99.5 %.
- **Files:** `server/test/exclusive/presence-restart.exclusive.test.ts`, `server/test/exclusive/support/virtualClients.ts`.
- **Done means:** green once with `T2F_PRESENCE_N=100` (control with 100 + 20 non-beating).
- **Verify:** one exclusive file (N=100).
- **Rules that apply:** exclusive lock; restart only the shared Redis, finally ensure it is up.
- **Risk:** other worktrees' tests blocked during the run — exclusive lock handles it; keep it short.

### W48 — Load scripts
- **Serves:** NFR-1, NFR-2.
- **Do:** scenario `presence` in `server/scripts/k6.mjs` (`SERVER_SCENARIOS`, `loadDirFor`, `scriptFor`); `server/load/presence/beats.js` (200 beats/s, 60 s, p95 threshold 50 ms), `claims.js` (100 claims/s, p95 100 ms); subjects prepared via doors.
- **Files:** `server/scripts/k6.mjs`, `server/load/presence/{beats,claims}.js`.
- **Done means:** 10 s smoke of each runs and reports p95.
- **Verify:** `pnpm --dir server k6 --scenario presence` with a 10 s duration override (to confirm flag).
- **Rules that apply:** security (`server/load/**`) — loopback only.
- **Risk:** low.

### P17 — Docs (Lane B, sonnet)

### W49 — Gotchas
- **Serves:** AC-66 (repo part).
- **Do:** `docs/knowledge/gotchas.md` section «Паспорт і присутність (SPEC-14, <date>)» (Ukrainian): only facts met in this wave (e.g. Redis-down handled inside the beat service, `FastStore.info`, finaliser tick vs moment row, author ids).
- **Files:** `docs/knowledge/gotchas.md`.
- **Done means:** entries present, one line fact + remedy each.
- **Verify:** manual (conductor).
- **Rules that apply:** skill `docs-sync`.
- **Risk:** low.

### W50 — Docs patch for root docs
- **Serves:** AC-66.
- **Do:** write `C:/Users/ADMIN/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/side-session-notes/local_359ad0f2-bcef-4e10-835b-0930d88a93eb/spec-14/docs-patch.md` (Ukrainian): `docs/backend/frontend-seam.md` (row `passport` on http, reason `no-presence`, routes incl. author path, §3.11 rows); `docs/site/passport.md` «Код» and «Відомі межі»; `docs/backend/alarms.md` (three `presence/*` codes); `docs/backend/night-runbook.md` (manual downtime in `37-presence`, what a `page` means); `docs/backend/code-map.md` (`server/src/presence/**`, `domain/presence/**`, `domain/passport/**`, `packages/rules/src/passport`); `docs/backend/README.md` command rows (exclusive restart test with `T2F_PRESENCE_N`, k6 scenario `presence`); hand-offs: SPEC-15 (`authorIdOf`, chat http adapter + `authorPath` wiring, metrics `presence.rooms`/`realtimeConnections`), SPEC-16 (card wiring), SPEC-19 (`passport.stamp-granted`, `passport.merged`, achievements data, site switch to `achievementsOf`/`stampOf`), SPEC-20 (subject-data `stamps` row in export/erase UI), SPEC-22a/b (edge report entry `reportEdgeFailure`, signed call), SPEC-23 (30 k scale of AC-65, NFR-03); one `docs/process.md` line; Spec follow-ups 1–6 and open question 4 for the orchestrator.
- **Files:** the side-notes file (outside the repo).
- **Done means:** orchestrator compares with route rows, ops rows and `HTTP_DOMAINS` (manual).
- **Verify:** manual (orchestrator).
- **Rules that apply:** root docs changed only by the orchestrator.
- **Risk:** low.

## Execution

Single conductor; each dispatch is `sdd-engineering:implementer` with this plan's path, the phase id and `model` from the table; ~80 tool calls; out of budget → `PARTIAL` with the tree green after the last finished item. The conductor commits after each phase. Every phase ends with its targeted checks only (tsc/eslint/related vitest of touched packages, the int files it names); the full `verify` runs once in L.

| Lane / phase | Executor | Model | Work items | Files (disjoint across a parallel pair) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — shared rules (Lane B) | implementer | sonnet | W1–W4 | `packages/rules/src/time/{constants,index}.ts`, `packages/rules/eslint/no-time-rule-copy.mjs`, `packages/rules/src/passport/**`, `packages/rules/package.json`, `packages/rules/test/{exports,boundaries.shared,achievements,stamp}.test.ts`, `lib/api/sim/NotificationsGenerator.tsx`, `tests/unit/passport/rules-parity.test.ts` | — | P2 | unit only |
| P2 — contracts, vocab (Lane B) | implementer | sonnet | W5–W7 | `packages/contracts/src/{passport,passport.schemas,passportGuard,authorPath,authorPath.schemas,schemas,index}.ts`, `packages/contracts/test/{passport,authorPath}.test.ts`, `scripts/contract-surface.baseline.json`, `lib/api/contracts/passport.ts`, `tests/unit/api/seam-vocabulary.test.ts` | — | P1 | unit only |
| P3 — tables + migration | implementer | sonnet | W8–W10 | `server/src/migrations/**`, `server/src/presence/ports.ts`, `server/test/integration/presence-schema.int.test.ts` | P1, P2 | — | generator alone; migcheck DB |
| P4 — presence domain + proof store | implementer | **opus** — presence proof, Redis-down path | W11–W13 | `server/src/domain/presence/{beatSchedule,window,source,eventValidity}.ts`, `server/src/presence/{proofs,moments,intake,faults}.ts`, `server/src/ports.ts`, `server/src/adapters/redis.ts`, `server/test/unit/{presence-domain,presence-rules-shared,presence-proofs}.test.ts` | P3 | — | unit only |
| P5 — beat route | implementer | **opus** — presence proof end to end | W14–W16 | `server/src/presence/beats.ts`, `server/src/endpoints/{presence,deps}.ts`, `server/src/registries/{routes,rateLimits,ops}.ts`, `server/test/integration/presence-beats.int.test.ts` | P4 | P13 | shared lock |
| P13 — web client (Lane B) | implementer | sonnet | W40–W43 | `lib/api/http/{passport,domains,index}.ts`, `lib/passport/stampClaims.ts`, `lib/api/sim/passport.ts`, `lib/api/hooks/passport.ts`, `tests/unit/api/{passport-http.test.ts,integration-build.test.tsx,live-http.test.ts}`, `tests/unit/passport/stamp-claims.test.ts` | P2 | P5 | unit only |
| P6 — health log + finalisation | implementer | **opus** — intake health log, finalisation | W17–W20 | `server/src/domain/presence/healthSigns.ts`, `server/src/presence/{samples,health,downtime}.ts`, `server/src/container.ts`, `server/src/registries/{moments,ops}.ts`, `server/test/unit/presence-health-signs.test.ts`, `server/test/integration/{presence-health,presence-alarms}.int.test.ts` | P5 | — | shared lock |
| P7 — test doors | implementer | **opus** — test doors (security-routed) | W21–W23 | `server/src/test-doors/{presence,registry}.ts`, `server/test/integration/{streams-doors,presence-doors,presence-signs}.int.test.ts`, `server/test/unit/doors-gating.test.ts`, `server/test/e2e/doors-404.e2e.ts` | P6 | — | shared lock |
| P8 — claim decision | implementer | **opus** — claim codes, downtime, old moment | W24–W27 | `server/src/domain/presence/claimDecision.ts`, `server/src/domain/passport/stampView.ts`, `server/src/presence/stamps.ts`, `server/src/endpoints/stamps.ts`, `server/src/registries/routes.ts`, `server/test/unit/{presence-claim-decision,presence-stamp-view,presence-no-wallclock}.test.ts`, `server/test/integration/{presence-claim,presence-old-moment}.int.test.ts` | P7 | — | shared lock |
| P9 — grant consequences | implementer | sonnet | W28–W30 | `server/src/presence/{achievements,events,stamps}.ts`, `server/test/integration/presence-grant.int.test.ts` | P8 | — | shared lock; Centrifugo up |
| P10 — merge, subject data, retention | implementer | **opus** — guest merge `authLinks` row | W31–W34 | `server/src/presence/{links,subjectData,retention}.ts`, `server/src/registries/{authLinks,subjectData}.ts`, `server/src/ops/runner.ts`, `server/test/integration/{presence-merge,presence-subject-data}.int.test.ts` | P9 | — | shared lock |
| P11 — author path | implementer | sonnet | W35–W37 | `server/src/presence/{authorIds,authorPath}.ts`, `server/src/domain/passport/authorPath.ts`, `server/src/endpoints/chatAuthors.ts`, `server/src/registries/routes.ts`, `server/test/integration/chat-author-path.int.test.ts` | P10 | P12 | shared lock |
| P12 — owner slice `37-presence` | implementer | sonnet | W38, W39 | `server/src/admin/{presenceEndpoints,cmsEndpoints,messages}.ts`, `server/src/admin/{PresenceSlice,PresenceView}.tsx`, `server/src/registries/adminSlots.ts`, `server/test/integration/{admin-slots,presence-admin}.int.test.ts` | P10 | P11 | shared lock; server build HEAVY once — after P11's int file, never with another heavy process |
| P14 — contract suite (Lane B) | implementer | sonnet | W44, W45 | `tests/contract/{passport.suite,passport.http.test}.ts`, `tests/unit/api/passport-contract.test.ts` | P11, P12, P13 | — | http column needs `serve` (HEAVY) |
| P15 — browser e2e (Lane B) | implementer | sonnet | W46 | `tests/e2e/server-clock/passport-stamp.spec.ts` | P14 | — | `build:int` + `serve` HEAVY, alone |
| P16 — FR-STAMP-13 small scale + load scripts | implementer | **opus** — real Redis restart at test midnight | W47, W48 | `server/test/exclusive/presence-restart.exclusive.test.ts`, `server/test/exclusive/support/virtualClients.ts`, `server/scripts/k6.mjs`, `server/load/presence/{beats,claims}.js` | P15 | — | EXCLUSIVE lock (N=100 once); k6 smoke |
| P17 — docs (Lane B) | implementer | sonnet | W49, W50 | `docs/knowledge/gotchas.md`, side-notes `spec-14/docs-patch.md` | P16 | — | text only |
| L — integration pass | conductor | — | — | none | P17 + rebase on master | — | full `verify.yml`-equivalent once; migration-safety check 5 after rebase; AC-65 with `T2F_PRESENCE_N=1500` + control run (NFR-3, NFR-6) under the exclusive lock; k6 `presence` 60 s (NFR-1, NFR-2); `layout-fidelity` on passport, country, room, TV boards with the integration build (AC-62); then `security-reviewer`, architecture review |

Order: (P1 ∥ P2) → P3 → P4 → (P5 ∥ P13) → P6 → P7 → P8 → P9 → P10 → (P11 ∥ P12) → P14 → P15 → P16 → P17 → L. Files touched by several Lane-A phases (`server/src/registries/routes.ts`: P5, P8, P11; `server/src/registries/ops.ts`: P5, P6; `server/src/presence/stamps.ts`: P8, P9; `server/src/presence/ports.ts`: P3 only — later phases add types in their own files) are sequential by construction; no file appears in both members of a parallel pair (P1/P2, P5/P13, P11/P12 checked). 17 phases: 7 opus (P4, P5, P6, P7, P8, P10, P16), 10 sonnet. At most two implementers at once; int files serialize on the shared lock; the exclusive file runs alone.

## Verification plan
| Command | Directory | Passing means |
|---|---|---|
| server files (per item) | `server/` | tsc, eslint, related unit tests green |
| contracts files + `node ../../scripts/contract-surface.mjs --check` | `packages/contracts/` | compiles, tests green, surface additive |
| rules files | `packages/rules/` | compiles, rules tests green |
| web files (per item) | repo root | tsc, eslint, related unit tests green |
| one int file (per listed file) | `server/` | green under the shared lock |
| migcheck + `node scripts/verify-schema.mjs` | `server/` | up/down/up clean; schema check green |
| server build (once, W38) | `server/` | `next build` succeeds |
| contract run (`node scripts/contract-run.mjs`, server served) | repo root | `passport` green on sim and http |
| e2e `passport-stamp.spec.ts` (once, W46) | repo root | green against `build:int` + `serve` |
| one exclusive file `presence-restart` N=100 (once, W47); N=1500 + control in L | `server/` | 0 `no-presence`, all stamps, proofs survive restart |
| k6 `presence` smoke (W48); 60 s in L | `server/` | p95 within NFR-1/NFR-2 thresholds |
| Full `verify` (config `full` per package = `verify.yml` steps) | per config | once, in L only — not in any phase |

## Assumptions
- Raw SQL tables on the rights pool instead of Payload collections [П-1]; times as `bigint` ms of the server clock.
- Redis failures in the beat path are handled inside the service ([П-3]); the route declares `needs: ['db']` only.
- Rate-limit rows use `onStoreDown: 'memory'` (AC-5, AC-35 name the memory fallback; `author-path` follows).
- `FastStore.info()` is optional; other domains are untouched.
- Finalisation runs on the sampler tick and on a moments-registry row (after-boot guarantee) [П-5].
- Metrics `presence.rooms` / `presence.realtimeConnections` (`ops.ts:569-570`) keep their rows with `pendingNote` naming SPEC-15 (spec Open question 3: AC-64 only forbids a SPEC-14 label).
- Moment history is recorded by the presence module [П-4].
- Achievement and stamp-composer rules live in `packages/rules` [П-7], [П-8]; the site keeps its own code until SPEC-19.
- Author ids are random and stored [П-9]; a merge does not move the guest's author id.

## Open questions
(none — spec gaps are listed under Spec follow-ups and are planned as written)

## Research used
- `…/side-session-notes/…/spec-14/research-code.md` — repo facts with file:line (client seam, suites, rules, server patterns, Redis/infra, admin slot, catalog/corrections).
- Planner reads: `docs/specs/SPEC-14-passport.md` (whole), `.claude/sdd-engineering.json`, `docs/plans/SPEC-11-rights-profile.plan.md` (format), `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1–2, `server/package.json:13-21`, `server/src/registries/subscribers.ts:1-40`, `server/src/events/ports.ts:7-51`, `server/src/ops/runner.ts:96-200` (job map), `server/src/auth/pool.ts`, `server/src/test-doors/registry.ts:1-104` (header, reset), door count assertions (`streams-doors.int.test.ts:109-111`, `doors-gating.test.ts:105-106`, `doors-404.e2e.ts:68-69`), `scripts/contract-run.mjs:15-40`, `playwright.http.config.ts:19-69`, `packages/rules/package.json:6-14`, `server/eslint.config.mjs:4`.

## Rollback / blast radius
- Revert the branch: the migration only adds nine tables; `down` drops them; SPEC-13a rollback swaps the image and never runs `down` — the old image ignores the tables.
- Behaviour changes in production: the site's `passport` domain switches to `http` (beats near midnight, server-confirmed stamps; visible only through the existing states — `layout-fidelity` in L); new routes `/api/presence`, `/api/me/stamps`, `/api/chat/authors/:id/path`, `/cms-api/presence/*`; a 5 s sampler writes one row per node; a `page` alarm on downtime windows near midnight.
- Shared local resources: the exclusive test restarts the shared dev Redis (all worktrees) under the machine's exclusive lock.
