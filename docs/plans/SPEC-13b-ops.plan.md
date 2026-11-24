# Implementation plan: Alarms in Telegram with an hourly «усе гаразд» and a morning digest, the «alarms and metrics» registry, one «Моніторинг» screen, encrypted database backups in R2 with a measured restore, spend counters of paid services (SPEC-13b)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-13b-ops.md` (Status: approved; 0 `[NEEDS CLARIFICATION]` markers). AC-1 … AC-70 (`:133-355`), the initial registry table (`:357-380`), NFR-1 … NFR-6 (`:412-428`), proposed contracts (`:496-520`), owner decisions В1–В3 and defaults [Q1]–[Q8] (`:15-30`), session decisions [А1]–[А18] (`:32-62`). Open questions 4 and 5 are for the plan and are resolved in [П-1] and [П-6]; 1–3 block nothing.
This plan implements those requirements; it does not define or change them.
**Execution mode** — recommended: ACCELERATED **single lane** (one conductor, one fresh `sdd-engineering:implementer` per phase, sequential), as SPEC-12 and SPEC-13a. Reason: `server/src/container.ts` is touched by five phases and `server/src/adapters/payloadOps.ts` by three, so server lanes would serialize anyway; the 16 GB machine allows ≤2 heavy processes. The one honest parallel pair is listed in `Execution` (D ∥ M). Mode to be confirmed by the orchestrator for the owner.
**Out of scope** — the spec's Non-goals (`:90-100`): any live Telegram message or call to `api.telegram.org`; the production R2 bucket/prefix and production keys (SPEC-22b); the external origin check `edge/origin-down` (SPEC-22a, reserved row only); the full FR-OPS-08 list and sleep rules (SPEC-22a); metrics of payments, chat, presence, mail, toasts (later waves add rows); a Redis backup; a DO clean-machine measurement; DigitalOcean / Cloudflare billing API calls; Prometheus/Grafana; any visible site change. Architecture review and `security-reviewer` are separate agents (`security-reviewer` mandatory: a bot token, an encryption key, backups of personal data, a new owner endpoint, a test door, operator commands that touch Docker volumes).

Repository root for every path = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-13b` (branch `spec-13b-ops`, base `master` after SPEC-12 merge, HEAD `6a729a3d`).
- **Do not commit, never push** (the conductor commits after each phase). Never stage `tsconfig.json`. `server/src/payload-types.ts` may show as modified after a dev server ran (gotcha `docs/knowledge/gotchas.md`, "Локальний dev-сервер переписує…") — regenerate it only in W6.
- **Never touch another session's files:** `lib/prelaunch/**`, `content/prelaunch/**`, `workers/prelaunch/**`, `scripts/prelaunch/**`, anything under `app/`, `components/`, `lib/`, `messages/` (AC-70).
- Never read: `research_data/**`, `docs/archive/**`, `Old Project/**`, `**/reference-boards/**`, `graphify-out/graph.json`, `out*/`, `.next*/`, `node_modules` (except `.d.ts` / `package.json` lookups), `pnpm-lock.yaml`, `.env*` contents other than `*.env.example`, `dashboard/secrets/**`, `infra/ops/.local/**` contents, `docs/decision.md` whole (grep + range only).
- **No live Telegram, ever, in this wave** (В3, [Q1]). The only Telegram endpoint any process or test reaches is the fake (`fakes/telegram/server.mjs`, port 0, `127.0.0.1`). Test token literal: `test-telegram-token-not-real // check-secrets: allow test fake`; test backup key: a fixed 32-byte base64 literal with the same `check-secrets: allow` marker. No `T2F_TELEGRAM_*` / `T2F_BACKUP_KEY` in CI.
- **No production resource, no paid resource.** Rehearsal R2 (`time2fest-rehearsal`) is touched only in phase M by the orchestrator through existing commands.
- **No new dependency.** Multipart upload uses `@aws-sdk/client-s3` (already `server/package.json`, `3.1169.0`) commands `CreateMultipartUpload` / `UploadPart` / `CompleteMultipartUpload` / `AbortMultipartUpload` directly — **not** `@aws-sdk/lib-storage`. Encryption is Node `crypto`. `infra/ops` stays zero-dependency. `pnpm install` is never run.
- Machine: 16 GB. Vitest `--maxWorkers=2`; Playwright `--workers=2`; one heavy process at a time (image build, node tests, the 10× load measurement are HEAVY and run under the exclusive lock). Local stack per skill `local-stack` with this worktree's own slot and databases `t2f_spec_13b_ops` / `t2f_spec_13b_ops_test`. Fakes listen on port 0; no test binds port 3000.
- Paths marked **(to confirm)** were not opened by the planner; the implementer checks them with Grep / `graphify explain` before editing and keeps the plan's intent.
- Phase ids: C (contracts/env), S (server), I (infra/image), M (measurement), D (docs), L (integration). Work items W1 … W50.

### Command shorthands used in `Verify` lines
- **server files** = config `verify` entry `server` → `files` (in `server/`): `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`.
- **one int file** = in `server/`: `node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts --maxWorkers=1 test/integration/<file>` (stack up per `local-stack`, worktree slot, DB migrated and seeded). Never `pnpm` after `--` on Windows.
- **one exclusive file** = in `server/`: `npx cross-env T2F_EXCLUSIVE=1 node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.integration.config.ts --maxWorkers=1 test/exclusive/<file>` (HEAVY; never in CI, `server/vitest.integration.config.ts:8`).
- **ops files** = config `ops` → `files` (in `infra/ops/`): `node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs related --run --maxWorkers=2 --passWithNoTests {files}`.
- **node int file** = in repo root: `node server/scripts/lock.mjs --mode exclusive -- node node_modules/vitest/vitest.mjs run -c infra/ops/vitest.node.config.mjs infra/ops/test/node/<file>` (HEAVY, Docker; pattern of SPEC-13a W32).
- **migcheck** = in `server/`: `node scripts/db.mjs migcheck up` → `pnpm migrate` → `pnpm migrate:down` → `pnpm migrate` → `node scripts/db.mjs migcheck drop`; `node scripts/verify-schema.mjs`.

## Planner decisions (resolving the plan-level Open questions and the "на розсуд плану" points)

- **[П-1] PostgreSQL 17 client in the server image (OQ-4, [А13], AC-47).** In the server image, not a sidecar: `server/Dockerfile` runtime stage, as `root` before `USER node`, installs `postgresql-client-17` from the PGDG apt repository (`apt.postgresql.org`, `bookworm-pgdg`, keyring under `/usr/share/postgresql-common/pgdg/`), `--no-install-recommends`, then `rm -rf /var/lib/apt/lists/*`. Cost ≈ +15 MB on a Next/Payload image of several hundred MB; the alpine `postgres:17.12` binaries cannot be copied (musl vs glibc). The sidecar alternative would need a second scheduler, lease and alarm path — rejected. `nice` is in coreutils already.
- **[П-2] Leases.** A separate type `OpsLeaseName = 'ops-telegram' | 'ops-heartbeat' | 'ops-backup' | 'ops-spend'` in `server/src/ops/ports.ts` and an adapter `createPgOpsLease` in `server/src/adapters/payloadOps.ts` that copies `createPgLiveLease` (`server/src/adapters/payloadLive.ts:418-445`) over the same scheduler lease table (`createPgScheduler`, `server/src/adapters/pgScheduler.ts`). `LiveLeaseName` is not touched (the spec allows either, `:506`).
- **[П-3] One outbox for everything sent to Telegram.** `alarm-deliveries` rows have `kind: 'alarm' | 'heartbeat' | 'digest' | 'storm-summary'` and a nullable **unique** `slotKey` (`hb:<UTC yyyy-mm-ddThh>`, `digest:<Kyiv yyyy-mm-dd>`, `storm:<window start>`). Heartbeats and the digest therefore get the same retry/lease/exactly-once path as alarms (AC-21 "один на слот" = unique insert). Coalescing (AC-6) is a row update on the latest delivered row of the same kind within 10 min (`repeatCount += 1`), never a new row.
- **[П-4] Delivery wrapper.** `createDeliveringAlarm(base: Alarm, deps)` in `server/src/alarms/delivery.ts` wraps the unchanged `createAlarm` (`server/src/platform/logger.ts:83`): calls `base.raise(a)` first (stdout line + throttle + existing `alarms` save unchanged → AC-1 snapshot), then, fire-and-forget: `log` → `log-alarms` insert; `page` → outbox insert (sanitized details, pre-built text); outbox insert failure → stdout `alarm_outbox_failed` + direct in-memory send through the sink, ≤1 per 10 min per kind per process (AC-9). `ops/telegram-*` codes are **never** routed to the outbox (AC-5): the wrapper checks `source==='ops' && code.startsWith('telegram-')`. `details` are passed to `AlarmStore.save` (new optional field) so `alarms.details` is filled.
- **[П-5] Ops runner.** One ticker `startOpsTicker` (`server/src/unattended/ticker.ts` `startTicker`, 5 s) started in `startProcessBackground` (`server/src/container.ts`, ~`:800-830`), never in CLI/build. Each tick, independently and each under its own lease: sender (`ops-telegram`, every tick), heartbeat/digest planner (`ops-heartbeat`), backup scheduler + stale check every 10 min + retention after each success (`ops-backup`), spend evaluation every 60 s (`ops-spend`), `log-alarms` prune once per hour. All time from an injected **wall clock** (`realClock`, `server/src/clock/index.ts:21`), never `clockFor` (AC-22); the door `ops-tick` passes a substitute `now`.
- **[П-6] Night sizes into the `server` spend row (OQ-5).** `pnpm capacity -- --env <env> night|back` (`infra/ops/lib/capacity/**`), after a successful resize, runs `pnpm run ops spend-record server --hours <h> --usd-per-hour <r> --reason "capacity <step>"` on the node through the existing transport (`infra/ops/lib/exec.mjs` / `node.mjs` `composeArgv`); `night` records 0 h with the hourly rate, `back` records the measured hours since `night` from the capacity journal. Rate = the size's price already known to the capacity plan (to confirm in `infra/ops/lib/capacity/**`). Design review 9 ("not at :00"): `night`/`back` print one warning line when started between :50 and :10 `Europe/Kyiv` inside the hourly backup window; `backups.md` states the rule. No refusal (no new product behaviour).
- **[П-7] Restore runs the decryption inside the manifest's image.** `pnpm restore:env -- --env rehearsal --from <key|latest> --target local` (`infra/ops/lib/restore.mjs`): (1) argument and target guards (AC-54) before any network call; (2) creates a fresh Compose project `t2f-restore-<utc>` from `infra/ops/node/compose.restore.yml` (postgres `17.12-alpine` + redis, new volumes); (3) reads the manifest through a one-shot container of `t2f-server:<manifest commit>` running `pnpm run ops restore-pull --manifest-only`, builds that image locally with the existing `infra/ops/lib/image.mjs` if absent; (4) one-shot `restore-pull --key <k>` in that image (env: the source env's `T2F_R2_*` + `T2F_BACKUP_KEY` from `.local/<env>/server.env`, `DATABASE_URI` of the clean stack, `T2F_RESTORE_TMP` on a bind-mounted temp dir under the target project) which downloads to the temp dir, verifies sha256 and key id, then streams decrypt → `pg_restore --no-owner --exit-on-error`; (5) starts the server of that commit against the clean stack, checks `migrate:status` (no pending ≤ manifest migration), `/api/health` 200, row counts = manifest, catalog version present; (6) prints duration and the loss window (AC-57); (7) `ops restore-record` on the source env's node (or local server for `--target local` test runs); (8) removes the temp dir in `finally` and on SIGINT. This keeps ONE implementation of the `T2FB1` format and of the S3 client (the server), so `infra/ops` stays zero-dependency with no hand-written SigV4. `restore-pull` validates only the variables it needs (not the full `env.check`). This adds the internal subcommand `restore-pull` to [А17]'s list (Spec follow-up 4).
- **[П-8] `pg_dump` in tests.** A port `DumpRunner { version(): Promise<number>; dump(): Readable; serverVersion(): Promise<number> }`; production adapter `server/src/adapters/pgDump.ts` spawns `nice -n 10 pg_dump --format=custom --no-owner <DATABASE_URI>` (`nice` skipped on win32). Integration tests on Windows/CI use `server/test/support/pgDumpRunner.ts`: local `pg_dump` if its major is 17, else `docker run --rm -i postgres:17.12-alpine pg_dump …` against the stack (host `host.docker.internal` on Docker Desktop, `--network host` on Linux). The password never goes on the command line: `PGPASSWORD` env of the child only.
- **[П-9] R2 metering.** `createMeteredObjectStore(inner, meter, prefixOf)` in `server/src/adapters/meteredObjectStore.ts` wraps every `ObjectStore` the container builds (`catalogCopyDepsOf`, site, live, backups); the meter is in-process counters flushed every 60 s by the spend ticker into `spend-counters` (`cloudflare:<yyyy-mm>` row, columns `classA`, `classB`) and last ok/failed per prefix in memory + the same row's JSON. Lower bound by design ("нижня межа: без читань краю", AC-64).
- **[П-10] Wire contract.** `/cms-api/ops/overview` is an admin endpoint, not a site contract domain: its zod schema lives in `server/src/ops/overviewSchema.ts` (used by the endpoint test and by `ops status`, AC-38); `packages/contracts`, `lib/api/contracts`, `scripts/contract-surface.baseline.json` are not touched (spec `:496`).

## Requirements traceability

| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | stdout line unchanged, throttle, never throws with sinks down | `:133` | W12 | W12 (unit snapshot) |
| AC-2 | `page` → outbox row (kind, level, sanitized details, text) → fake ≤60 s, `deliveredAt` | `:136` | W12, W13, W14 | W15 (int) |
| AC-3 | undelivered survives restart, delivered once ≤60 s after start | `:139` | W13, W14 | W15 (int) |
| AC-4 | retries 5/10/20 s, then 60 s to 10 min; 429 `retry_after`; 400/403 no retry | `:142` | W7, W13 | W8 (unit) |
| AC-5 | final failure → `failed`, journal line, `log` `ops/telegram-delivery-failed` ≤1/10 min, not in outbox | `:145` | W12, W13 | W15 (int) |
| AC-6 | same kind within 10 min → counter; next message «повторилось N разів» | `:148` | W7, W12 | W8 (unit) |
| AC-7 | 20 per 10 min ceiling → one summary with domains | `:151` | W7, W13 | W8 (unit) |
| AC-8 | two instances, 30 alarms → 30 messages, 0 duplicates | `:154` | W13, W14 | W15 (exclusive) |
| AC-9 | outbox write fails → direct send ≤1/10 min/kind, `alarm_outbox_failed` | `:157` | W12 | W15 (exclusive deps-down) |
| AC-10 | plain Ukrainian text, no `parse_mode`, ≤1 000 chars, fixed parts | `:160` | W7 | W8 (unit snapshots) |
| AC-11 | allow-listed keys only, numbers/codes ≤64; no email/IP/nick/text/token | `:163` | W7, W12 | W8 (unit) |
| AC-12 | `log` → `log-alarms`, 30-day prune, no message | `:166` | W12, W16 | W15 (int) |
| AC-13 | recipient by class; rehearsal ignores owner chat with one warning; test non-loopback → off | `:169` | W7, W10 | W8 (unit) |
| AC-14 | not configured → sink off, one `ops/telegram-not-configured`, monitor says so; production env check requires vars | `:172` | W1, W10, W14 | W1 (unit), W11 (unit) |
| AC-15 | real adapter: POST `/bot<token>/sendMessage`, exact body, 10 s, token never logged | `:175` | W10 | W11 (unit vs fake) |
| AC-16 | fake: 200/400/403/429/5xx, `/_control/{calls,down,mode,reset}`, loopback, no deps | `:178` | W9 | W11 (fake suite) |
| AC-17 | tests fail on `api.telegram.org`; CI has no `T2F_TELEGRAM_*` | `:181` | W10 | W11 (unit + workflow test) |
| AC-18 | hourly heartbeat at :00 UTC + window start, text by snapshot | `:186` | W16, W17 | W19 (unit) |
| AC-19 | no catalog zones → fallback window + line | `:189` | W16 | W19 (unit) |
| AC-20 | digest 09:00 Kyiv: log counts by domain (top 10), open page, backup age, spend >50 % | `:192` | W17 | W19 (int) |
| AC-21 | one heartbeat per slot cluster-wide; missed ≤10 min catch-up, else skip + journal line | `:195` | W17, W18 | W19 (exclusive + int) |
| AC-22 | ops schedules on real time regardless of SPEC-07 test clock | `:198` | W16, W18 | W19 (unit) |
| AC-23 | monitor shows last heartbeat; >70 min in window → red | `:201` | W31, W32 | W34 (unit) |
| AC-24 | registry `registries/ops.ts`, row per domain + reserved, sorted, `assertRegistry` | `:206` | W3 | W4 (unit) |
| AC-25 | registry holds every raised kind with the table's levels | `:209` | W3 | W4 (unit vs table) |
| AC-26 | scanner of literal codes → fails with `file:line` | `:212` | W38 | W38 (unit) |
| AC-27 | unregistered kind → domain «невідомо», in `test` marker `ops/unregistered-alarm`, checked at suite end | `:215` | W12, W39 | W40 (int) |
| AC-28 | helper `expectAlarmInTestChannel`; listed kinds green | `:218` | W39 | W40 (int) |
| AC-29 | `site/publish-failed`, `live/publish-failed` = `log`; `*-skipped` etc. info; `edge/origin-down` reserved | `:221` | W3 | W4 (unit), W40 (int) |
| AC-30 | slot `50-ops`, owner only, agents 403 on `/cms-api/ops/*` | `:226` | W33 | W34 (int) |
| AC-31 | overview blocks; one provider failing → `errors:[block]` | `:229` | W31 | W34 (int) |
| AC-32 | open `page` alarms ≤100 + acknowledge via existing endpoint, visible ≤5 s | `:232` | W31, W32 | W34 (int) |
| AC-33 | `log` alarms 24 h grouped by domain/kind | `:235` | W31, W32 | W34 (unit) |
| AC-34 | metrics of merged waves equal their own slices | `:238` | W31 | W34 (int) |
| AC-35 | «немає даних» rows with owner wave from reserved rows | `:241` | W3, W31, W32 | W34 (unit) |
| AC-36 | ≤64 KB, `no-store`, no secret values, poll 5 s visible tab | `:244` | W31, W33 | W34 (unit + int) |
| AC-37 | texts in `admin/messages.ts`, pure `OpsView` with `data-testid` | `:247` | W32 | W34 (unit + grep) |
| AC-38 | `ops status` prints overview JSON (same schema), read-only | `:250` | W35 | W37 (int) |
| AC-39 | R2 class A/B counters, last ok/failed per prefix | `:253` | W22 | W23 (unit + int) |
| AC-40 | backup 03:00 UTC daily, hourly in window (Kyiv), one per cluster | `:258` | W16, W25 | W19 (unit), W27 (exclusive) |
| AC-41 | `pg_dump -Fc` → AES-256-GCM chunks, no plaintext on disk / R2 | `:261` | W20, W24 | W23 (unit 200 MB), W27 (int) |
| AC-42 | pg_dump major ≠ server major → no start, `page` `ops/backup-failed` `stage:'version'` | `:264` | W24 | W26 (unit) |
| AC-43 | object `<prefix>backups/db/<ts>.dump.enc` (multipart >16 MB) then manifest with fields | `:267` | W21, W24 | W27 (int) |
| AC-44 | any step fails → abort multipart, no manifest, `page` with stage, journal line | `:270` | W24 | W27 (exclusive r2-down) |
| AC-45 | stale >26 h / >2 h in window → `page` `ops/backup-stale`, check every 10 min | `:273` | W16, W25 | W19, W26 (unit) |
| AC-46 | retention 30 daily + 72 hourly, own pattern only, never newest, journal per delete | `:276` | W25 | W26 (unit) |
| AC-47 | image has pg client 17; `/api/health` 200 during backup | `:279` | W42, W46 | W46 (HEAVY) |
| AC-48 | own bucket/prefix, denylist guards, test = loopback s3mock, no key → no start + one `ops/backup-not-configured` | `:282` | W1, W24 | W26 (unit) |
| AC-49 | Redis not copied; `redisCopyFilter` drops `*edge:salt:*` | `:285` | W20 | W23 (unit) |
| AC-50 | S3 adapter additive `get`, `head`, `list`, multipart; `put`/`delete` unchanged | `:288` | W2, W21 | W23 (unit), existing catalog/site/live suites |
| AC-51 | `backup-runs` row after each run | `:291` | W24 | W27 (int) |
| AC-52 | `backup:env --now` / `ops backup-now` → key + manifest printed | `:294` | W35, W43 | W37 (int), W45 (ops unit) |
| AC-53 | `restore:env … --target local` full sequence + report | `:299` | W36, W44 | W46 (node int) |
| AC-54 | non-clean target or production → refuse before download | `:302` | W44 | W45 (unit) |
| AC-55 | sha256 / key id / auth failure → stop before `pg_restore`, temp cleaned | `:305` | W20, W36, W44 | W46 (node int) |
| AC-56 | `ops restore-record`; monitor «останнє відновлення» | `:308` | W35, W31, W44 | W37 (int), W46 |
| AC-57 | smoke success rules; loss window = largest gap in 24 h | `:311` | W25, W44 | W26, W45 (unit), W46 (node int) |
| AC-58 | real rehearsal copy → clean local stack ≤60 min, loss ≤1 h, recorded in `backups.md` | `:314` | W47 | W47 (manual) |
| AC-59 | decrypted dump only in target temp dir, removed on success/failure/interrupt | `:317` | W36, W44 | W46 (node int) |
| AC-60 | spend rows `ai`, `mail`, `server`, `cloudflare`, `youtube` with fields; monitor % | `:322` | W3, W28, W32 | W4, W30, W34 (unit) |
| AC-61 | `ai` row reads `ai_spend` night+month, no new alarms | `:325` | W29 | W30 (int) |
| AC-62 | `server`/`cloudflare`/`mail` 50 % `log` / 80 % `page` once per period cluster-wide | `:328` | W28, W29 | W30 (exclusive) |
| AC-63 | `server` = base $12/mo pro-rata + recorded hours; `spend-record`; capacity records hours | `:331` | W28, W35, W43 | W30 (unit), W37 (int), W45 (ops unit) |
| AC-64 | `cloudflare` formula, parameters, «нижня межа» label | `:334` | W28, W22 | W30 (unit) |
| AC-65 | `mail` «немає провайдера», no alarms | `:337` | W28, W32 | W30, W34 (unit) |
| AC-66 | ceilings, prices, heartbeat/digest times in global `ops-settings`; owner only, tx + journal | `:340` | W5, W33 | W34 (int) |
| AC-67 | env rows, example, `env-example.test.mjs`, `check-secrets` green | `:345` | W1 | W1 (unit) |
| AC-68 | new collections + global only by new migration; `alarms.details` the only change | `:348` | W5, W6 | W6 (migcheck) |
| AC-69 | docs: `secrets.md`, `services/telegram.md`, `backups.md`, `alarms.md` | `:351` | W48 | W48 (manual read) |
| AC-70 | no visible site change; diff outside allowed dirs = 0 | `:354` | W49 | W49 (git diff check) |
| NFR-1 | ≤60 s per `page` under 50 raises/min of 10 kinds | `:412` | W13, W39 | W40 (int) |
| NFR-2 | backup ≤5 min on 10× seed; gap ≤60 min in window | `:415` | W16, W46 | W19 (unit), W46 (HEAVY) |
| NFR-3 | ≤100 MB extra RSS, `nice`, health p95 ≤2× during backup | `:418` | W24, W46 | W46 (HEAVY) |
| NFR-4 | no token / key values anywhere | `:421` | W10, W24, W31, W49 | W11, W34 (unit), W49 (check-secrets, log grep) |
| NFR-5 | no live Telegram, no `time2fest-prod`, no paid resource | `:424` | W10, W47 | W47, W49 (manual journals) |
| NFR-6 | backups storage estimate ≤10 GB | `:427` | W28 | W30 (unit) |

## Spec follow-ups

Addressed to `spec-creator` and the owner; the plan implements the spec as written, with the reading stated.
1. **AC-14 vs AC-67.** AC-14 requires `T2F_TELEGRAM_BOT_TOKEN` and `T2F_TELEGRAM_CHAT_ID` in `production` ("env check shall вимагати обидві змінні"); AC-67 lists only `T2F_BACKUP_KEY` as `requiredIn production`. Plan: all three `requiredIn: ['production']` (AC-14 is the more specific criterion). AC-67 should say so.
2. **AC-70 allowed paths** omit `docs/plans/` (this file) and `docs/knowledge/` (gotchas added by W48 if any). Plan: W49's diff check also allows `docs/plans/SPEC-13b-ops.plan.md` and `docs/knowledge/gotchas.md`. AC-70's list should include them.
3. **AC-28 kind names** `catalog-r2-copy-failed` and `spend_80` lack the source; read as `catalog/catalog-r2-copy-failed` and `mod/spend_80`.
4. **[А17] command list** — the plan adds the internal server subcommand `ops restore-pull` used by `restore:env` inside the manifest commit's image ([П-7]).
5. **AC-26 scope** — dynamic codes (`mod/spend_${level}` in `server/src/moderation/spend.ts:294-297`, the poller helper `raise(level, code)` with a variable at `server/src/live/poller.ts:174`) cannot be found by a literal scanner; the scanner covers literal codes in `raise({...})` and in the known helpers' literal call sites, and the template-generated kinds are covered by the AC-25 table test. Spec could state this.

## Affected surface

Skills by `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1: **onion** = `engineering-paved-path:onion-architecture`, **sec** = `engineering-paved-path:security`, **ms** = `migration-safety`, **sf** = `seed-and-fixtures`, **rtl** = `react-testing-library` (vitest configs), **next** = `next-best-practices`, **gap** = no routing row.

| File | New/Mod | Package | Home (ring / radius) | Skills | Constraint to respect |
|---|---|---|---|---|---|
| `server/src/registries/env.ts`, `server/src/platform/env.ts`, `server/.env.example` | Mod | server | root / platform | onion, sec | rows sorted, `assertRegistry`; `T2F_TELEGRAM_BOT_TOKEN`, `T2F_BACKUP_KEY` `secret: true`; `T2F_TELEGRAM_API_BASE` url; keep `PRODUCTION_DENYLIST` / `PRODUCTION_NAMES` (`platform/env.ts:40,59`) unchanged |
| `infra/ops/node/server.env.example`, `infra/ops/test/env-example.test.mjs` | Mod | ops | node config / test | sec (infra/**) | names only, empty values |
| `server/src/alarms/ports.ts`, `server/src/catalog/ports.ts`, `server/src/ops/ports.ts` | Mod/New | server | ring 2 ports | onion | additive only: `AlarmStore.save` gains optional `details`, `listLog`, `pruneLog`; `ObjectStore` gains optional `get`, `head`, `list`, `putMultipart` (`catalog/ports.ts:48-53` keeps `put`, `delete?`) |
| `server/src/registries/ops.ts`, `server/src/registries/spend.ts` | New | server | root (registries) | onion | sorted + `assertRegistry` like `registries/adminSlots.ts`; Ukrainian texts only here and in `admin/messages.ts` |
| `server/src/collections/{alarmDeliveries,logAlarms,backupRuns,restoreRuns,spendCounters,alarms}.ts`, `server/src/globals/opsSettings.ts`, `server/src/registries/{collections,globals}.ts` | New/Mod | server | Payload | ms | REST create/update/delete closed to every role except via services; `ops-settings` update owner only with journal row in the same tx (pattern `globals/moderationSettings.ts`, to confirm) |
| `server/src/migrations/<ts>_ops.{ts,json}`, `server/src/migrations/index.ts`, `server/src/payload-types.ts` | New/Mod | server | generated | ms, gap | `pnpm --dir server migrate:create ops` + `node scripts/fix-migration-down.mjs`; sorts after `20261123_105845_live`; only CREATE + `ALTER TABLE alarms ADD COLUMN details jsonb` |
| `server/src/domain/ops/{alarmText,alarmDetails,delivery,route,schedule,spend,lossWindow,retention,redisFilter}.ts` | New | server | ring 1 | onion | pure; time and config are parameters; no `Date.now()` (`server/eslint.config.mjs`) |
| `fakes/telegram/{server.mjs,README.md}` | New | server (int suite) | test fake | gap | zero deps, `127.0.0.1`, port 0; copy `fakes/youtube/server.mjs` shape |
| `server/src/adapters/telegram.ts` | New | server | ring 4 | onion, sec | token only in the path built at call time; errors mapped to `'ok' / 'retry' / 'fatal'` + `retryAfterSec` (≤300); never log URL or body |
| `server/test/support/{noTelegramNetwork,pgDumpRunner,expectAlarmInTestChannel,fakeTelegram}.ts`, `server/vitest.config.ts`, `server/vitest.integration.config.ts` | New/Mod | server | test support / config | rtl (`vitest.config.*`), gap | guard via `setupFiles` of both configs beside `noYoutubeNetwork.ts` |
| `server/src/alarms/{delivery,sender}.ts` | New | server | ring 3 | onion | wrapper never throws; sender takes ports, not the container |
| `server/src/adapters/{payloadAlarms,payloadOps}.ts` | Mod/New | server | ring 4 | onion | Payload rows never leave the adapter; conditional updates for claims (pattern `adapters/pgAiSpend.ts:71-78`) |
| `server/src/ops/{runner,heartbeat,digest,backup,retention,spend,overview,overviewSchema,meter,restoreRecord}.ts` | New | server | ring 3 | onion | wall clock injected; each job under its own lease |
| `server/src/adapters/{s3,meteredObjectStore,pgDump}.ts` | Mod/New | server | ring 4 | onion, sec (`s3.ts`) | `s3.ts` additive; path-style only for loopback stays; `pgDump` passes the password via child env only |
| `server/src/ops/backupFormat.ts` | New | server | ring 3 (node crypto streams) | onion | format `T2FB1` exactly as spec `:512` |
| `server/src/container.ts` | Mod | server | composition root | onion, sec | additive; ops ticker only in `startProcessBackground` (never CLI/build, `instrumentation.ts`) |
| `server/src/test-doors/{ops,registry}.ts` | New/Mod | server | test door | sec | only `T2F_ENV=test` + `T2F_TEST_DOORS=1`; registry count 19 → 20 (`server/test/unit/doors-gating.test.ts:106`) |
| `server/src/admin/{opsEndpoints,cmsEndpoints}.ts` | New/Mod | server | ring 4 | onion | owner + Access gate + `NO_STORE` from `admin/cmsHttp.ts`; registered like `liveEndpoints` (`cmsEndpoints.ts:40,160`) |
| `server/src/admin/{OpsSlice,OpsView}.tsx`, `server/src/admin/messages.ts`, `server/src/registries/adminSlots.ts` | New/Mod | server | admin UI | gap (admin tsx) | pattern `LiveSlice.tsx` / `LiveView.tsx`: poll 5 s visible tab, pure view, `data-testid` per block |
| `server/src/cli/ops.ts`, `server/package.json` (script `ops`) | New/Mod | server | ring 4 CLI | sec | no secret in output; run as `pnpm run ops …` (gotcha `pnpm import`) |
| `server/Dockerfile` | Mod | server (image) | infra | gap (security reviewer reads it) | runtime stage only; PGDG `postgresql-client-17`; `USER node` restored |
| `infra/ops/lib/{backup,restore}.mjs`, `infra/ops/ops.mjs`, `infra/ops/lib/capacity/**` (to confirm the step file), `infra/ops/lib/secrets/generate.mjs`, `infra/ops/node/compose.restore.yml`, `package.json` (root scripts) | New/Mod | ops | operator tooling | sec | zero deps; `assertArgv`/`shq` (`lib/exec.mjs:74,103`); `production` refused; secrets only via env files / stdin |
| `infra/ops/test/{backup,restore,capacity-spend,secrets,workflow}.test.mjs`, `infra/ops/test/node/restore.int.test.mjs` | New/Mod | ops | tests | sec (infra/**) | node test HEAVY, own Compose project `t2f-restore-*`, never `-p t2f` |
| `server/test/unit/*.test.ts`, `server/test/integration/*.int.test.ts`, `server/test/exclusive/*.exclusive.test.ts`, `server/test/stack/backup-load.stack.test.ts` | New/Mod | server | tests | gap | named per item |
| docs outside the repo (W48) | Mod/New | docs-patch | docs | gap | range edits only |

**Coverage gaps:** `fakes/telegram/**`, `server/src/admin/{OpsSlice,OpsView}.tsx` (routing table proposes a `server/src/admin/**/*.tsx` → react row, not yet added), `server/Dockerfile`, `server/src/migrations/**` generated files, `server/src/payload-types.ts`, `server/test/**`, all docs.

## Contract changes

- **Shared contracts / schemas:** no site contract. New server-internal shapes only: `AlarmSink`, additive `AlarmStore`, additive `ObjectStore`, `OpsLeaseName`, the overview zod schema `server/src/ops/overviewSchema.ts` (one copy, used by endpoint + CLI). `packages/contracts`, `lib/api/**`, `scripts/contract-surface.baseline.json` unchanged.
- **Migration:** yes → collections `alarm-deliveries`, `log-alarms`, `backup-runs`, `restore-runs`, `spend-counters`, global `ops-settings`, column `alarms.details` (jsonb, nullable). ONE migration generated by `pnpm --dir server migrate:create ops` (W6), `fix-migration-down.mjs`, types regenerated. Never hand-written.
- **Seed / fixture data:** no new seed source. `ops-settings` defaults come from the global's field defaults (a fresh DB reads defaults without a row). Tests seed their own `log-alarms` / `ai_spend` rows through helpers, never through `server/src/seed/**`.
- **Build-only failures:** yes → (1) the server image: PGDG apt install can fail only in `docker build` — W42 runs the HEAVY image build; (2) `server/src/admin/*.tsx` + `next build` of the server: W34 relies on server `tsc`; L runs `pnpm --dir server build` once.
- **Wire contract:** no (admin endpoint `/cms-api/ops/overview` and admin slot only; no service method, HTTP route of the site, Centrifugo channel, ApiError code, wire schema in `packages/contracts` / `lib/api/contracts`). `contract-conformance` is not run.
- **Layout fidelity:** no (nothing under `web/` renders differently; AC-70). Skipped per `sdd-routing.md` §4.
- **Payload migration:** yes → `migration-safety` in W6 and L (generated, up/down/up on the migcheck copy, types regenerated, `verify-schema`).
- **Test doors:** yes → new door `POST /api/_test/ops-tick` (W18); gated by `shouldLoadDoors` (`T2F_ENV=test` + `T2F_TEST_DOORS=1`); `doors-404` e2e in L proves the production build returns 404 for it.
- **Agent write surface:** no (agent roles get 403 on `/cms-api/ops/*` and `ops-settings`; no agent write path is added).
- **Seed and fixtures:** no (see above).

## Work items

### W1 — Env names, production requirements, examples (C1)
- **Serves:** AC-67, AC-14 (env half), AC-48 (class matrix half), NFR-4.
- **Do:** block `ops` in `registries/env.ts`, sorted: `T2F_BACKUP_KEY` (`secret: true`, base64 that decodes to 32 bytes, `requiredIn: ['production']`), `T2F_TELEGRAM_API_BASE` (`z.url()` optional), `T2F_TELEGRAM_BOT_TOKEN` (`secret: true`, optional, `requiredIn: ['production']`), `T2F_TELEGRAM_CHAT_ID` (optional, `requiredIn: ['production']`), `T2F_TELEGRAM_TEST_CHAT_ID` (optional). In `platform/env.ts`: class `test` with `T2F_TELEGRAM_API_BASE` not loopback → flag `telegramDisabledReason='non-loopback'` (no refusal); nothing else changes in the guards. Names (empty) in `server/.env.example` and `infra/ops/node/server.env.example`; `env-example.test.mjs` updated. Unit `server/test/unit/ops-env.test.ts`: production without the three → refusal naming each; rehearsal/test without them → start; secrets masked by `createLogger(secrets)`.
- **Files:** `server/src/registries/env.ts`, `server/src/platform/env.ts`, `server/.env.example`, `infra/ops/node/server.env.example`, `infra/ops/test/env-example.test.mjs`, `server/test/unit/ops-env.test.ts`.
- **Done means:** `assertRegistry` green; production env check without `T2F_TELEGRAM_BOT_TOKEN` fails with that name in the message; `env-example.test.mjs` green; `node scripts/check-secrets.mjs` exit 0 after `git add -N`.
- **Verify:** server files; ops files (`test/env-example.test.mjs`); `node scripts/check-secrets.mjs` (root).
- **Rules that apply:** sec → secrets from env only, masked in logs; onion → env registry is the root.
- **Risk:** adding `requiredIn: production` makes any future production deploy fail until the owner provides the values — intended (SPEC-22b); `docs/backend/secrets.md` says so (W48).

### W2 — Ports: alarm sink and store, object store, ops leases (C1)
- **Serves:** enables AC-2 … AC-9, AC-12, AC-39, AC-50 (contracts `:500-506`).
- **Do:** `alarms/ports.ts`: `AlarmSink { deliver(msg: {text; chatId}): Promise<{result:'ok'|'retry'|'fatal'; retryAfterSec?: number; status?: number}> }`; `AlarmStore.save(a: {source; code; details?})`; new `listLog(sinceMs)`, `pruneLog(beforeMs)` on a new `LogAlarmStore` (to keep `AlarmStore` consumers untouched) — both additive. `catalog/ports.ts`: optional `get(key): Promise<Readable|null>`, `head(key): Promise<{size; etag}|null>`, `list(prefix): Promise<{key; size; lastModified}[]>`, `putMultipart(key, body: Readable, contentType, partBytes): Promise<{size}>`. `ops/ports.ts`: `OpsLeaseName`, `OpsLease`, `Outbox` (insert, claimDue(limit, now), markDelivered, markRetry(nextAt), markFailed, latestDeliveredOfKind(kind, sinceMs), incrementRepeat), `BackupRunStore`, `RestoreRunStore`, `SpendCounterStore`, `WallClock`, `DumpRunner`.
- **Files:** `server/src/alarms/ports.ts`, `server/src/catalog/ports.ts`, `server/src/ops/ports.ts`.
- **Done means:** server `tsc` green with no change to any existing implementation file (types are additive/optional).
- **Verify:** server files.
- **Rules that apply:** onion → ports in ring 2, no Payload or AWS types in ports.
- **Risk:** low.

### W3 — Registries: alarms and metrics, spend rows (C1)
- **Serves:** AC-24, AC-25, AC-29, AC-35 (data), AC-60 (data).
- **Do:** `registries/ops.ts`: `OpsDomainRow { domain; title; ownerWave; reserved?: true; alarms: { source; code; level: 'page'|'log'|'info'; levelNote?; meaning; action; detailKeys: string[] }[]; metrics: { key; title; pendingNote? }[] }` with every row of the spec table `:357-380` (exact source/code as raised in code, research notes §1; mixed styles accepted), `site/publish-failed` and `live/publish-failed` as `log`, `*-skipped`, `rebuild-frozen`, `rebuild-disabled`, `rebuild-not-configured` as `info`, reserved rows `edge` (with `edge/origin-down` page, SPEC-22a), `payments`, `chat`, `presence`, `mail`, `toasts` with owner waves and the FR-OPS-01 pending metrics of AC-35; `live/statuses-stale` with `levelNote` describing both levels; `assertOpsRegistry` (sorted by domain, unique `source/code`, non-empty Ukrainian `meaning`/`action`, detail keys `[a-zA-Z]{1,32}`); `findKind(source, code)`. `registries/spend.ts`: rows `ai`, `cloudflare`, `mail`, `server`, `youtube` (sorted) with title, unit, period (`month` / `night+month` for ai / `day` for youtube), ceiling key in `ops-settings`, number source, owner wave.
- **Files:** `server/src/registries/ops.ts`, `server/src/registries/spend.ts`.
- **Done means:** W4 green.
- **Verify:** server files.
- **Rules that apply:** onion → registry rows are data, no imports of adapters.
- **Risk:** a missed code makes W38's scanner red later — W4 compares to the table, W38 to the code.

### W4 — Registry tests (C1)
- **Serves:** AC-24, AC-25, AC-29 (unit), AC-60 (unit).
- **Do:** `server/test/unit/ops-registry.test.ts`: `assertOpsRegistry` passes; failing fixtures (unsorted, duplicate kind, empty text) throw; every kind of the spec table present with its level (table copied into the test as data); reserved rows have `ownerWave`; `assertSpendRegistry` passes.
- **Files:** `server/test/unit/ops-registry.test.ts`.
- **Done means:** the test file green.
- **Verify:** server files.
- **Rules that apply:** —
- **Risk:** low.

### W5 — Collections and global (S2)
- **Serves:** AC-68, AC-66 (model), enables AC-2, AC-12, AC-21, AC-51, AC-56, AC-62.
- **Do:** `alarm-deliveries` ([П-3]: `kind`, `slotKey` unique nullable, `source`, `code`, `level`, `domain`, `text` ≤1000, `details` json, `status` `pending|delivered|failed`, `attempts`, `nextAttemptAt` (indexed), `deliveredAt`, `failedAt`, `lastStatus` int, `repeatCount`, `raisedAt`); `log-alarms` (`source`, `code`, `domain`, `details` json, `raisedAt` indexed); `backup-runs` (`key`, `kind` daily|hourly|manual, `result` ok|failed, `stage`, `size`, `sha256`, `durationMs`, `snapshotAt`, `keyId`); `restore-runs` (`at`, `key`, `durationMs`, `lossWindowMs`, `result`, `target`); `spend-counters` (`row`, `period` unique per row, `amountMicros` numeric, `classA`, `classB`, `storageBytes`, `alarm50At`, `alarm80At`, `meta` json); field `details` (json, optional) on `alarms`; global `ops-settings` with defaults: ceilings `server` $12/month base, `cloudflare` prices 4.50 / 0.36 / 0.015 and free tiers 1 000 000 / 10 000 000 / 10 GB, `mail` ceiling placeholder, heartbeat minute `0`, digest `09:00` Kyiv; update access owner only through a `beforeChange` that writes the journal row in the same tx (pattern of `globals/moderationSettings.ts`, to confirm). All new collections: no public REST, read owner only, writes only via adapters. Register in `registries/{collections,globals}.ts` (`resettable` / `audited` flags as `alarms`, `registries/collections.ts:40`).
- **Files:** `server/src/collections/{alarmDeliveries,logAlarms,backupRuns,restoreRuns,spendCounters,alarms}.ts`, `server/src/globals/opsSettings.ts`, `server/src/registries/{collections,globals}.ts`.
- **Done means:** server `tsc` green; registries' `assertRegistry` green.
- **Verify:** server files.
- **Rules that apply:** ms → additive only; Payload thin layer (routing note).
- **Risk:** low.

### W6 — Generated migration, types, migration safety (S2)
- **Serves:** AC-68.
- **Do:** `pnpm --dir server migrate:create ops`; `node server/scripts/fix-migration-down.mjs <file>`; `pnpm --dir server generate:types`; migcheck sequence; extend `server/test/integration/payload-schema.int.test.ts` if it lists tables (to confirm).
- **Files:** `server/src/migrations/<ts>_ops.{ts,json}`, `server/src/migrations/index.ts`, `server/src/payload-types.ts`, (`server/test/integration/payload-schema.int.test.ts`).
- **Done means:** migcheck all exit 0; `up` contains no `DROP` / `ALTER … TYPE` / `TRUNCATE` / `DELETE`, and its only `ALTER TABLE` adds `alarms.details`.
- **Verify:** server files; migcheck; one int file `payload-schema.int.test.ts`.
- **Rules that apply:** ms 1–6.
- **Risk:** the migcheck DB is the only one created/dropped.

### W7 — Alarm domain rules (S3)
- **Serves:** AC-4, AC-6, AC-7, AC-10, AC-11, AC-13.
- **Do:** pure modules in `server/src/domain/ops/`: `alarmDetails.ts` `sanitizeDetails(details, allowKeys)` → only allow-listed keys, values number or `/^[A-Za-z0-9_.:\-/]{1,64}$/`, and additionally rejects values matching email, IPv4/IPv6, `bot\d+:` token shapes, URLs; `alarmText.ts` `buildAlarmText({row|unknown, cls, details, raisedAt, repeatCount})` → plain text: «ТРИВОГА», class, domain title, meaning, action, Kyiv + UTC time, details, «повторилось N разів» when N>0, «Підтвердити: адмінка → Моніторинг», cut to 1 000 chars; also `buildStormSummary(n, domains)`, `buildHeartbeatText(...)`, `buildDigestText(...)` (used in W17); `delivery.ts` `nextAttemptAt(raisedAt, attempt, response)` (5, 10, 20 s then every 60 s, stop at 10 min; 429 → max(next, now + retry_after ≤300 s); 400/403 → fatal) and `coalesce` / `stormGate(deliveredInLast10Min)` (20 per 10 min); `route.ts` `telegramRoute(cls, env)` → `{chatId}` or `{disabled: reason, warn?}` per AC-13 / AC-14.
- **Files:** `server/src/domain/ops/{alarmDetails,alarmText,delivery,route}.ts`.
- **Done means:** server `tsc` green; W8 proves the ACs.
- **Verify:** server files.
- **Rules that apply:** onion ring 1 → no I/O, no `Date.now()`.
- **Risk:** low.

### W8 — Alarm domain tests (S3)
- **Serves:** AC-4, AC-6, AC-7, AC-10, AC-11, AC-13.
- **Do:** `server/test/unit/ops-alarm-domain.test.ts`: attempt times exact (5/10/20/80/140 … ≤600 s), 429 honours `retry_after`, 400 → one attempt; 50 raises of `scheduler/lag` in 10 min → 1 message, raise at 11 min → text contains «повторилось 49 разів»; 40 kinds in a minute → 20 + 1 summary listing domains; snapshots of 3 kinds (`scheduler/lag`, `ops/backup-failed` with `stage`, `live/quota-80`); long details cut to 1 000; email, IPv4, IPv6, free text, the test token value → absent from text and from sanitized details; route matrix (test/rehearsal/production × vars), rehearsal with owner chat → test chat + one warn, test + non-loopback base → disabled.
- **Files:** `server/test/unit/ops-alarm-domain.test.ts`.
- **Done means:** green.
- **Verify:** server files.
- **Rules that apply:** —
- **Risk:** low.

### W9 — Telegram fake (S4)
- **Serves:** AC-16.
- **Do:** `fakes/telegram/server.mjs` (zero deps, `node:http`, `127.0.0.1`, `startFakeTelegram({port:0})`): `POST /bot<token>/sendMessage` JSON → per mode `ok` (200 `{ok:true,result:{message_id}}`), `chat-not-found` (400), `forbidden` (403), `rate-limit` (429 `{parameters:{retry_after:N}}`), `error` (502), `down` (socket destroyed); `/_control/calls` (GET list `{token-suffix-free path, chat_id, text, disable_web_page_preview, at}`), `/_control/down`, `/_control/mode` (POST `{mode, retryAfter?, times?}`), `/_control/reset`; CLI start for manual use. `README.md` as `fakes/youtube/README.md`.
- **Files:** `fakes/telegram/server.mjs`, `fakes/telegram/README.md`, `server/test/unit/fake-telegram.test.ts`.
- **Done means:** `fake-telegram.test.ts` covers every mode and `calls` and is green.
- **Verify:** server files.
- **Rules that apply:** no external network; the fake never logs the token.
- **Risk:** low.

### W10 — Real Telegram adapter, sink selection, network guard (S4)
- **Serves:** AC-13, AC-14, AC-15, AC-17, NFR-4, NFR-5.
- **Do:** `adapters/telegram.ts` `createTelegramSink({apiBase, token, fetch, timeoutMs:10_000})`: `POST ${apiBase}/bot${token}/sendMessage` body `{chat_id, text, disable_web_page_preview:true}` (no `parse_mode`), `AbortSignal.timeout`; maps 200 → ok, 429 → retry + `retry_after` (≤300), 400/403 → fatal, 5xx / network → retry; errors rethrown never — returns results with `status` only; the URL is never put into an `Error` message or log. `selectTelegramSink(cls, env, deps)` uses `telegramRoute` (W7) → sink or `null` + one log line `ops/telegram-not-configured` (raised later by W14 wiring). `test/support/noTelegramNetwork.ts` throws on `api.telegram.org` for `fetch` and `node:http(s).request`; added to `setupFiles` of both vitest configs. `infra/ops/test/workflow.test.mjs`: `.github/workflows/*.yml` contain no `T2F_TELEGRAM_` and no `T2F_BACKUP_KEY`.
- **Files:** `server/src/adapters/telegram.ts`, `server/test/support/noTelegramNetwork.ts`, `server/vitest.config.ts`, `server/vitest.integration.config.ts`, `infra/ops/test/workflow.test.mjs`.
- **Done means:** W11 green; a `fetch('https://api.telegram.org/…')` inside a test throws.
- **Verify:** server files; ops files (`test/workflow.test.mjs`).
- **Rules that apply:** sec → secret never in logs/errors; outbound host fixed by env, loopback in test.
- **Risk:** low.

### W11 — Telegram port tests (S4)
- **Serves:** AC-13, AC-14, AC-15, AC-16, AC-17.
- **Do:** `server/test/unit/telegram-port.test.ts`: the real adapter against the fake: exact body, `disable_web_page_preview:true`, no `parse_mode`; each fake mode → expected result; forced network error → captured logger output and thrown/returned values contain no token value and no `/bot` URL; network guard throws for `api.telegram.org`; `selectTelegramSink` matrix.
- **Files:** `server/test/unit/telegram-port.test.ts`.
- **Done means:** green.
- **Verify:** server files.
- **Rules that apply:** —
- **Risk:** low.

### W12 — Delivering alarm wrapper (S5)
- **Serves:** AC-1, AC-2, AC-5, AC-6, AC-9, AC-11, AC-12, AC-27 (routing half).
- **Do:** `alarms/delivery.ts` `createDeliveringAlarm(base, {outbox, logStore, sink|null, registry, cls, now, logger})` per [П-4]: `base.raise(a)` first; unknown kind → domain «невідомо» and, in class `test`, an extra `log-alarms` row `ops/unregistered-alarm` with `{source, code}`; `page` → sanitize with row allow-list → if a delivered row of the same kind exists within 10 min → `incrementRepeat` (AC-6) else insert row with text; insert failure → stdout `alarm_outbox_failed` + direct `sink.deliver` ≤1/10 min/kind (in-memory map); `log` → `log-alarms` insert; `ops/telegram-*` → `log-alarms` only; every async path caught (never throws, never awaits in `raise`). `AlarmStore.save` gets `details` (sanitized). Unit `server/test/unit/alarm-delivery.test.ts`: sinks that throw and hang → `raise` returns synchronously; stdout line equals the pre-wave snapshot (record the snapshot from `createAlarm` alone in the same test); outbox-failure path sends directly once per 10 min.
- **Files:** `server/src/alarms/delivery.ts`, `server/src/adapters/payloadAlarms.ts`, `server/test/unit/alarm-delivery.test.ts`.
- **Done means:** unit green; `createAlarm` (`platform/logger.ts`) unchanged (`git diff` empty for that file).
- **Verify:** server files.
- **Rules that apply:** onion → wrapper depends on ports; never throws (SPEC-02 AC-56).
- **Risk:** recursion — guarded by the `ops/telegram-*` rule and by the sender raising only `log`.

### W13 — Outbox store, sender, leases (S5)
- **Serves:** AC-2, AC-3, AC-4, AC-5, AC-7, AC-8, NFR-1.
- **Do:** `adapters/payloadOps.ts`: `createPayloadOutbox` (`claimDue` = `UPDATE … SET nextAttemptAt = now()+30s … WHERE status='pending' AND nextAttemptAt<=now() … RETURNING` limited, so a crashed claim retries), `createPayloadLogAlarms`, `createPgOpsLease` ([П-2]). `alarms/sender.ts` `runSenderTick({lease, outbox, sink, now, alarm, journal})`: holds `ops-telegram` (ttl 15 s); storm gate: count delivered in the last 10 min; ≥20 → hold rows of `kind:'alarm'` and on the next 10-min boundary insert one `storm-summary` (slot `storm:<start>`) and mark held rows delivered-in-summary; else deliver up to 20 per tick in `raisedAt` order; on result apply `nextAttemptAt` (W7); after 10 min or fatal → `failed`, journal line `ops.telegram-delivery-failed`, `alarm.raise({level:'log', source:'ops', code:'telegram-delivery-failed'})` throttled 10 min.
- **Files:** `server/src/adapters/payloadOps.ts`, `server/src/alarms/sender.ts`.
- **Done means:** server `tsc` green; W15 proves the ACs.
- **Verify:** server files.
- **Rules that apply:** onion; claims are single SQL statements (pattern `pgAiSpend.ts:71-78`).
- **Risk:** double delivery on lease handover — the claim column makes a row claimable by one holder at a time; exactly-once is "at most one successful `sendMessage` per row" given the fake; a crash between Telegram 200 and `markDelivered` can duplicate one message (accepted; noted in `alarms.md`).

### W14 — Container wiring (S5)
- **Serves:** AC-2, AC-3, AC-14.
- **Do:** in `container.ts` (`:212-213`): `alarm = overrides.alarm ?? createDeliveringAlarm(createAlarm(log, alarmStore), …)`; sink via `selectTelegramSink`; when null → one `ops/telegram-not-configured` `log` alarm at start and `telegramStatus='not-configured'` exposed for the overview; start the ops ticker (`server/src/ops/runner.ts` skeleton with the sender job only; W18 adds jobs) in `startProcessBackground` on a `globalThis` symbol like the live poller.
- **Files:** `server/src/container.ts`, `server/src/ops/runner.ts`.
- **Done means:** server `tsc` green; existing `alarms.int.test.ts` green.
- **Verify:** server files; one int file `alarms.int.test.ts`.
- **Rules that apply:** onion/sec → composition root only wires.
- **Risk:** every alarm path in the process now goes through the wrapper — W15 + existing suites.

### W15 — Delivery integration and exclusive tests (S5)
- **Serves:** AC-2, AC-3, AC-5, AC-8, AC-9, AC-12.
- **Do:** `server/test/support/fakeTelegram.ts` (start fake, pass `T2F_TELEGRAM_API_BASE`, test chat id, test token to the server under test). `server/test/integration/alarm-delivery.int.test.ts`: `POST /api/_test/alarm` `page` → one `sendMessage` ≤60 s, row `deliveredAt`; fake down → alarm → stop server process → fake up → new process → exactly one message ≤60 s after start (process pattern of `scheduler-*.int.test.ts`, to confirm helper); fake down 11 min via the `ops-tick` door's substitute `now` (W18 lands later → this case is added in W19 if the door is not yet present; mark it `it.todo` here and complete in W19) → one `log` alarm, journal line, no new outbox row from it; `log` alarm → `log-alarms` row, zero messages. `server/test/exclusive/alarm-two-instances.exclusive.test.ts`: two processes, 30 alarms of 30 kinds spread under the storm ceiling over time-substituted windows → 30 messages, 0 duplicates. Extend `server/test/exclusive/deps-down.exclusive.test.ts`: Postgres stopped, `page` → fake gets the message ≤60 s.
- **Files:** `server/test/support/fakeTelegram.ts`, `server/test/integration/alarm-delivery.int.test.ts`, `server/test/exclusive/alarm-two-instances.exclusive.test.ts`, `server/test/exclusive/deps-down.exclusive.test.ts`.
- **Done means:** the int file green; both exclusive files green (HEAVY, sequential).
- **Verify:** one int file; one exclusive file ×2.
- **Rules that apply:** —
- **Risk:** timing flakiness — use the door's `now` for windows, real time only for the ≤60 s bound.

### W16 — Ops schedule rules (S6)
- **Serves:** AC-18, AC-19, AC-22, AC-40, AC-45, NFR-2 (gap), AC-12 (prune boundary).
- **Do:** `domain/ops/schedule.ts`: `celebrationWindow(zones|null)` (from `isCelebrating` bounds, `packages/rules/src/time/celebration.ts:9`; fallback 31.12 08:00 UTC – 01.01 14:00 UTC with `fallback:true`); `heartbeatSlotAt(now, window)` (`:00` UTC slots + the window start instant; returns slot key + due time); `missedSlotDecision(slot, now)` (≤10 min → send, else skip); `digestSlotAt(now, tz='Europe/Kyiv', '09:00')`; `inHourlyBackupWindow(now)` (26.12 00:00 … 02.01 23:59 Kyiv, the year of `now`); `backupSlotAt(now)` (03:00 UTC daily outside, `:00` Kyiv hourly inside; slot key); `staleThresholdMs(now)` (26 h / 2 h); `logPruneBefore(now)` (30 days). Kyiv conversion through `Intl.DateTimeFormat` (as `domain/unattended`, to confirm helper).
- **Files:** `server/src/domain/ops/schedule.ts`.
- **Done means:** server `tsc` green; W19 proves the ACs.
- **Verify:** server files.
- **Rules that apply:** onion ring 1; wall time is a parameter.
- **Risk:** DST is not an issue in Kyiv in late December, but use `Intl` anyway.

### W17 — Heartbeat and digest jobs (S6)
- **Serves:** AC-18, AC-20, AC-21.
- **Do:** `ops/heartbeat.ts` `runHeartbeatJob({lease 'ops-heartbeat', outbox, catalogZones, openPageCount, lastBackup, deliveryState, now, journal})`: in window, insert `kind:'heartbeat'` with unique `slotKey` (insert conflict = already planned → no-op), text «Усе гаразд» / «Зв'язок працює; відкритих тривог: N» + class, open `page` count, last backup age, delivery state; missed slot >10 min → journal line `ops.heartbeat-skipped` and no insert; zones unavailable → fallback window + one `log` alarm `ops/heartbeat-fallback-window` per window. `ops/digest.ts` at 09:00 Kyiv: `log-alarms` of 24 h grouped by domain with top-10 kinds, open `page`, last backup age, spend rows >50 % (from W29 via a port; until W29 lands the provider returns `[]`), slot `digest:<date>`.
- **Files:** `server/src/ops/heartbeat.ts`, `server/src/ops/digest.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** onion ring 3 → ports only.
- **Risk:** low.

### W18 — Runner jobs and the `ops-tick` door (S6)
- **Serves:** AC-21, AC-22, enables AC-5, AC-20, AC-40, AC-45, AC-62 tests.
- **Do:** `ops/runner.ts`: jobs per [П-5] (sender, heartbeat, digest, log prune hourly; backup/stale/spend hooks as no-op placeholders filled by W25/W29); `WallClock` injected (default `realClock`); `runOpsTick(now)` exported for the door. `test-doors/ops.ts`: `POST /api/_test/ops-tick` body `{now: ISO, jobs?: string[]}` → runs one tick of the named jobs with that wall time, returns job outcomes; registered in `test-doors/registry.ts` (sorted; count 19 → 20 in `doors-gating.test.ts:106` and `doors.int.test.ts` if counted). `container.ts`: pass zones provider (catalog store, to confirm accessor), open page count (`alarmStoreOf`), journal.
- **Files:** `server/src/ops/runner.ts`, `server/src/test-doors/{ops,registry}.ts`, `server/src/container.ts`, `server/test/unit/doors-gating.test.ts`.
- **Done means:** `doors-gating.test.ts` green with 20 rows; door absent outside `test` + `T2F_TEST_DOORS=1`.
- **Verify:** server files.
- **Rules that apply:** sec → door registration only via `shouldLoadDoors`; never in production build.
- **Risk:** low.

### W19 — Schedule unit, heartbeat/digest integration, two-instance tests (S6)
- **Serves:** AC-18, AC-19, AC-20, AC-21, AC-22, AC-40 (unit), AC-45 (unit), NFR-2 (gap unit), AC-5 (the 11-min case left `todo` in W15).
- **Do:** `server/test/unit/ops-schedule.test.ts`: seed zones, wall time 31.12 07:00 … 01.01 15:00 UTC → heartbeats exactly 08:00 … 14:00 (and window start); text snapshots; zones throw → fallback window; SPEC-07 test clock ×60 and shifted to 31.12 → `ops` schedule unchanged (call the modules with `realClock`-like injected wall time while `clockFor('test')` is altered); backup slots 25.12 … 03.01 → 1/day outside, 24/day inside; stale boundaries 26 h / 2 h exact; gap between consecutive hourly snapshots ≤60 min. `server/test/integration/ops-heartbeat.int.test.ts`: 7 `log-alarms` of three domains + door tick at 09:00 Kyiv → one digest with exact numbers; restart then tick at :05 → caught up, at :15 → skipped + journal line; complete the AC-5 11-min case in `alarm-delivery.int.test.ts`. `server/test/exclusive/ops-heartbeat-two.exclusive.test.ts`: two instances → one heartbeat per slot.
- **Files:** `server/test/unit/ops-schedule.test.ts`, `server/test/integration/ops-heartbeat.int.test.ts`, `server/test/integration/alarm-delivery.int.test.ts`, `server/test/exclusive/ops-heartbeat-two.exclusive.test.ts`.
- **Done means:** all four green.
- **Verify:** server files; one int file ×2; one exclusive file.
- **Rules that apply:** —
- **Risk:** low.

### W20 — Backup format and Redis filter (S7)
- **Serves:** AC-41, AC-49, AC-55 (decrypt half).
- **Do:** `ops/backupFormat.ts`: `encryptStream(key32, keyId)` / `decryptStream(key32, expectedKeyId)` Transforms of format `T2FB1`: header (30 bytes, version 0x02 after review S-4) = magic `T2FB1` + version byte + key id (first 8 hex of sha256(key)) + 16-byte random file id; chunks ≤64 KiB plaintext, each `[len u32][nonce 12][ciphertext][tag 16]`, nonce random per chunk, AAD = `header || u64 chunkIndex || u8 last`; decrypt fails on bad header, wrong key id, auth failure, a missing final chunk, data after final, reordering; `keyIdOf(key)`. `domain/ops/redisFilter.ts` `redisCopyFilter(key)` → false for `/edge:salt:/`.
- **Files:** `server/src/ops/backupFormat.ts`, `server/src/domain/ops/redisFilter.ts`.
- **Done means:** server `tsc` green; W23 proves.
- **Verify:** server files.
- **Rules that apply:** sec → key never logged; AES-256-GCM via `node:crypto` only.
- **Risk:** nonce reuse — random 96-bit per chunk with ≤2^32 chunks per key-lifetime is within NIST bound for this volume; noted in `backups.md`.

### W21 — S3 adapter additions (S7)
- **Serves:** AC-50, AC-43 (multipart).
- **Do:** `adapters/s3.ts`: add `get` (`GetObject` → `Readable`, 404 → null), `head` (`HeadObject`), `list(prefix)` (`ListObjectsV2` paginated), `putMultipart(key, body, contentType, partBytes=16 MiB)` (buffer up to 16 MiB: if the stream ends first → single `PutObject`; else `CreateMultipartUpload` + `UploadPart` per 16 MiB + `Complete`; any error → `AbortMultipartUpload`, rethrow), `delete` unchanged, `put` unchanged.
- **Files:** `server/src/adapters/s3.ts`.
- **Done means:** server `tsc` green; existing `catalog-r2.int.test.ts`, `site-fanout.int.test.ts`, `live-fanout.int.test.ts` green unchanged.
- **Verify:** server files; one int file `catalog-r2.int.test.ts`.
- **Rules that apply:** sec (`s3.ts` routed) → credentials only from config; loopback path-style unchanged.
- **Risk:** s3mock multipart quirks — `r2-helpers.ts` (to confirm) already used by tests.

### W22 — R2 metering (S7)
- **Serves:** AC-39, AC-64 (counts).
- **Do:** `adapters/meteredObjectStore.ts` per [П-9] (class A: put, putMultipart parts + create/complete, list, delete; class B: get, head; last ok/failed per prefix `catalog|site|live|backups`); `ops/meter.ts` `R2Meter` in-process; `container.ts`: wrap the stores built in `catalogCopyDepsOf` and the site/live stores, and the backup store.
- **Files:** `server/src/adapters/meteredObjectStore.ts`, `server/src/ops/meter.ts`, `server/src/container.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** onion → decorator in ring 4.
- **Risk:** low.

### W23 — Format, adapter, meter tests (S7)
- **Serves:** AC-39, AC-41 (unit), AC-49, AC-50.
- **Do:** `server/test/unit/backup-format.test.ts`: 200 MB streamed round-trip (generated, not stored) equal by sha256; truncated, reordered, flipped-byte, wrong-key → reject; first bytes are `T2FB1`, not `PGDMP`. `server/test/unit/redis-filter.test.ts`. `server/test/unit/s3-store.test.ts`: fake `S3Client.send` → method/command map, multipart abort on error, `ObjectStore` type has the old members. `server/test/unit/r2-meter.test.ts`: counters and times exact. Extend `server/test/integration/catalog-r2.int.test.ts`: one catalog copy → class A +1.
- **Files:** `server/test/unit/{backup-format,redis-filter,s3-store,r2-meter}.test.ts`, `server/test/integration/catalog-r2.int.test.ts`.
- **Done means:** all green; 200 MB test ≤60 s and memory bounded (stream).
- **Verify:** server files; one int file `catalog-r2.int.test.ts`.
- **Rules that apply:** —
- **Risk:** test time — mark the 200 MB case with a generous timeout.

### W24 — Backup job (S8)
- **Serves:** AC-41, AC-42, AC-43, AC-44, AC-48, AC-51, NFR-3 (`nice`, streaming), NFR-4.
- **Do:** `adapters/pgDump.ts` per [П-8]. `ops/backup.ts` `runBackup({dump, store, key, keyId, prefix, cls, now, journal, alarm, runs, commit, lastMigration, rowCounts})`: guards first — no key → (rehearsal/production) one `page` `ops/backup-not-configured` per process and return; class `test` with non-loopback R2 endpoint → refuse; version: `dump.version()` major ≠ `serverVersion()` major → `page` `ops/backup-failed` `{stage:'version'}`; snapshot time = spawn time; stream `pg_dump` → `encryptStream` → sha256 + size tap → `putMultipart(<prefix>backups/db/<yyyymmddThhmmssZ>.dump.enc)`; then `put(<…>.manifest.json)` with `{size, sha256, keyId, snapshotAt, durationMs, pgVersion, lastMigration, rowCounts:{users?, passports?, stamps?, orders? — the key collections present today, to confirm names}, commit, format:'T2FB1'}`; any failure → abort (adapter aborts multipart), no manifest, `page` `ops/backup-failed` `{stage}` (`dump|encrypt|upload|manifest`), journal line `ops.backup-failed`; every run → `backup-runs` row. Nothing written to disk. Env: `T2F_R2_BUCKET`/`T2F_R2_PREFIX` only (existing guards in `platform/env.ts` reject `time2fest-prod` outside production).
- **Files:** `server/src/adapters/pgDump.ts`, `server/src/ops/backup.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** sec → password via child env, never argv/log; key never in manifest; onion.
- **Risk:** memory — the stream pipeline must use `pipeline()` with back-pressure; NFR-3 measured in W46.

### W25 — Retention, stale check, runner hooks (S8)
- **Serves:** AC-40, AC-45, AC-46, AC-57 (loss window function).
- **Do:** `domain/ops/retention.ts` `retentionPlan(objects, now)` → keys to delete: only names matching `^<prefix>backups/db/\d{8}T\d{6}Z\.(dump\.enc|manifest\.json)$`, pairs only, keep 30 newest daily (03:00 UTC slot names) and 72 newest hourly, never the newest successful (manifest present); `domain/ops/lossWindow.ts` `lossWindow(manifests, now)` = largest gap between consecutive successful `snapshotAt` in 24 h. `ops/retention.ts` executes with one journal line per deleted pair. `ops/runner.ts`: backup job under `ops-backup` at `backupSlotAt`, unique slot via `backup-runs.key`; stale check every 10 min → `page` `ops/backup-stale`; retention after each success. `container.ts`: backup deps (store with prefix, key from env, `pgDump`).
- **Files:** `server/src/domain/ops/{retention,lossWindow}.ts`, `server/src/ops/retention.ts`, `server/src/ops/runner.ts`, `server/src/container.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** onion; deletions only under own prefix.
- **Risk:** a wrong regex could delete catalog objects — W26 includes a foreign object.

### W26 — Backup unit tests (S8)
- **Serves:** AC-42, AC-45, AC-46, AC-48, AC-57 (unit).
- **Do:** `server/test/unit/ops-backup.test.ts`: versions 16/17 → alarm `stage:'version'`, 17/17 → proceeds (fake dump runner); class matrix (no key → one `backup-not-configured`, test + non-loopback → refuse; `rehearsal` with bucket `time2fest-prod` → existing env refusal); stale 26 h / 2 h exact; retention 40 daily + 100 hourly + `catalog/x.json` → 10 + 28 pairs deleted, foreign kept, newest kept; loss window on hand-built manifests.
- **Files:** `server/test/unit/ops-backup.test.ts`.
- **Done means:** green.
- **Verify:** server files.
- **Rules that apply:** —
- **Risk:** low.

### W27 — Backup integration and exclusive tests (S8)
- **Serves:** AC-40 (int), AC-41 (int), AC-43, AC-44, AC-51.
- **Do:** `server/test/support/pgDumpRunner.ts` per [П-8]. `server/test/integration/ops-backup.int.test.ts`: door tick at a backup slot → s3mock has `.dump.enc` (first bytes `T2FB1`) and `.manifest.json`; sha256/size equal actual; `backup-runs` row; force >16 MB via a seeded padding table in the test DB (or a `partBytes` override) to exercise multipart. Extend `server/test/exclusive/r2-down.exclusive.test.ts`: s3mock stopped → `page` `stage:'upload'`, no manifest, `ListMultipartUploads` empty after restart. `server/test/exclusive/ops-backup-two.exclusive.test.ts`: two instances → one backup per slot.
- **Files:** `server/test/support/pgDumpRunner.ts`, `server/test/integration/ops-backup.int.test.ts`, `server/test/exclusive/{r2-down,ops-backup-two}.exclusive.test.ts`.
- **Done means:** all green.
- **Verify:** one int file; one exclusive file ×2.
- **Rules that apply:** —
- **Risk:** pg_dump availability on Windows — the runner falls back to the `postgres:17.12-alpine` container.

### W28 — Spend domain (S9)
- **Serves:** AC-60, AC-62 (levels), AC-63 (math), AC-64, AC-65, NFR-6.
- **Do:** `domain/ops/spend.ts`: `serverCost(month, now, baseUsd, records)` (base × elapsed days / days in month + Σ hours × rate); `cloudflareCost({classA, classB, storageGb}, prices)` per AC-64 with free tiers; `percent(amount, ceiling)`; `levelsCrossed(prev, next)` → `[50, 80]` subset; `backupStorageEstimate(manifests)` (Σ sizes, used for NFR-6 and `storageGb`); `mailRow()` → `{state:'no-provider'}`; period keys `month:YYYY-MM` UTC.
- **Files:** `server/src/domain/ops/spend.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** onion ring 1.
- **Risk:** low.

### W29 — Spend counters job and providers (S9)
- **Serves:** AC-61, AC-62, AC-63 (store), AC-64 (inputs).
- **Do:** `adapters/payloadOps.ts`: `createPayloadSpendCounters` (`upsert`, `addServerHours`, `claimLevel(row, period, level)` conditional update `alarm50At/alarm80At IS NULL` like `pgAiSpend.ts:71-78`). `ops/spend.ts`: providers per spend registry row — `ai` reads the existing AI spend store (night + month, SPEC-09 thresholds, no new alarms), `youtube` reads the live quota view percent (SPEC-12), `server`/`cloudflare` computed from counters + `ops-settings`, `mail` → no provider; evaluation every 60 s under `ops-spend`: for `server`, `cloudflare`, `mail` raise `spend/<row>-50` (`log`) / `spend/<row>-80` (`page`) only when `claimLevel` wins. Meter flush (W22) into the `cloudflare` row. Runner hook in `ops/runner.ts`; digest provider of W17 now real.
- **Files:** `server/src/adapters/payloadOps.ts`, `server/src/ops/spend.ts`, `server/src/ops/runner.ts`, `server/src/container.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** onion; one conditional update per claim.
- **Risk:** low.

### W30 — Spend tests (S9)
- **Serves:** AC-60, AC-61, AC-62, AC-63 (unit), AC-64, AC-65, NFR-6.
- **Do:** `server/test/unit/ops-spend.test.ts`: `assertSpendRegistry`; 24 h × $0.0833 + base pro-rata exact; Cloudflare formula exact and $0 within free tier; mail row; 102 backups × size estimate vs 10 GB. `server/test/integration/ops-spend.int.test.ts`: `ai_spend` seeded at 85 % → `ai` row 85 %, zero new `spend/*` alarms. `server/test/exclusive/ops-spend-two.exclusive.test.ts`: two instances, `server` counter crosses 80 % → one `spend/server-80`; next month (door `now`) → possible again.
- **Files:** `server/test/unit/ops-spend.test.ts`, `server/test/integration/ops-spend.int.test.ts`, `server/test/exclusive/ops-spend-two.exclusive.test.ts`.
- **Done means:** all green.
- **Verify:** server files; one int file; one exclusive file.
- **Rules that apply:** —
- **Risk:** low.

### W31 — Overview providers and schema (S10)
- **Serves:** AC-31, AC-32, AC-33, AC-34, AC-35, AC-36 (size/secrets), AC-23 (data), AC-56 (block), NFR-4.
- **Do:** `ops/overviewSchema.ts` (zod `{at, env, blocks:{alarms, logAlarms, time, scheduler, catalog, site, live, moderation, backups, telegram, spend, pending}, errors: string[]}`). `ops/overview.ts` `buildOverview(deps)`: each block from its own provider in `Promise.allSettled` (pattern `scheduler/festival.ts:92`): `alarms` = `listOpenPage` ≤100 newest + details; `logAlarms` = 24 h grouped domain/kind with count and last; `time` = edge/server divergence (SPEC-07 timekeeping status, threshold 250 ms); `scheduler` = `SchedulerHandle.status()` lag and lease (threshold 2 s); `catalog` = version + last R2 ok/failed (`catalog` prefix meter); `site` = site view state + switches; `live` = quota percent + stale statuses (live view); `moderation` = providers state + AI spend night/month; `backups` = last run, age, size, last restore (`restore-runs`); `telegram` = configured/not, last delivered heartbeat, `red` when in window and >70 min; `spend` = rows with percent and labels («нижня межа: без читань краю» for cloudflare); `pending` = reserved registry rows' metrics with owner wave. Failure → `errors:[block]`. Response trimmed to ≤64 KB (truncate lists).
- **Files:** `server/src/ops/{overview,overviewSchema}.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** onion; providers via ports/handles passed in.
- **Risk:** reaching into other domains' internals — use the same accessors their slices use (`liveView`, `festivalState`, `aiSpend`, site view).

### W32 — `OpsView` and texts (S10)
- **Serves:** AC-23, AC-32, AC-33, AC-35, AC-37, AC-60 (view), AC-65 (view).
- **Do:** `admin/OpsView.tsx` pure (props → markup), `data-testid` per block (`ops-alarms`, `ops-log-alarms`, `ops-time`, …, `ops-pending`) and per alarm row; acknowledge button calls a prop; red marker class for Telegram >70 min; «немає даних» rows. `admin/OpsSlice.tsx` client: `callApi('GET','/ops/overview')` every 5 s while `document.visibilityState==='visible'`; acknowledge → existing `POST /cms-api/alarms/:id/acknowledge` then refetch. Texts in `admin/messages.ts` (`OPS_*`).
- **Files:** `server/src/admin/{OpsView,OpsSlice}.tsx`, `server/src/admin/messages.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** react-best-practices (proposed row for admin tsx); text rendered as text.
- **Risk:** low.

### W33 — Endpoints, slot, settings access (S10)
- **Serves:** AC-30, AC-36, AC-66.
- **Do:** `admin/opsEndpoints.ts`: `GET /cms-api/ops/overview` (owner + Access gate from `cmsHttp.ts`, `NO_STORE`, agents → 403 `forbidden`); registered in `cmsEndpoints.ts` like `liveEndpoints`. Slot `{key:'50-ops', order:50, label:'Моніторинг', load: () => import('../admin/OpsSlice')…}` in `registries/adminSlots.ts`. `ops-settings` update: owner only, journal in the same tx (W5 hook), agents 403.
- **Files:** `server/src/admin/{opsEndpoints,cmsEndpoints}.ts`, `server/src/registries/adminSlots.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** onion; owner gate identical to `liveEndpoints.ts`.
- **Risk:** low.

### W34 — Monitoring tests (S10)
- **Serves:** AC-23, AC-30, AC-31, AC-32, AC-33, AC-34, AC-35, AC-36, AC-37, AC-60, AC-65, AC-66.
- **Do:** `server/test/unit/ops-view.test.ts` (render `OpsView` with fixture data: every `data-testid`, red Telegram >70 min, grouped log alarms, pending = reserved rows, spend rows and labels; serialized sample ≤64 KB; grep test: no Cyrillic string literals in `OpsView.tsx`/`OpsSlice.tsx`/`ops/overview.ts` outside `messages.ts`). `server/test/integration/ops-overview.int.test.ts`: `content-agent`, `stream-agent` → 403; owner → 200 `no-store`; `live` provider forced to throw (door or injected) → 200 with `errors:['live']`; seed 2 page alarms, acknowledge one → next poll shows one; each metric equals its slice's endpoint (`/cms-api/festival-state`, `/cms-api/live/view`, `/cms-api/site/view`, moderation view); response contains none of the test secret values; `ops-settings` change by owner → journal row, by agent → 403. Extend `admin-slots.int.test.ts` with `50-ops`.
- **Files:** `server/test/unit/ops-view.test.ts`, `server/test/integration/{ops-overview,admin-slots}.int.test.ts`.
- **Done means:** all green.
- **Verify:** server files; one int file ×2.
- **Rules that apply:** —
- **Risk:** low.

### W35 — Server CLI `ops` (S11)
- **Serves:** AC-38, AC-52 (node side), AC-56 (record), AC-63 (record).
- **Do:** `cli/ops.ts` subcommands: `status` → `buildOverview` JSON validated by `overviewSchema`, writes nothing; `backup-now` → `runBackup` with kind `manual` (same guards and lease), prints key + manifest; `restore-record --at --key --duration-ms --loss-ms --result --target` → `restore-runs` row + journal line; `spend-record server --hours N --usd-per-hour R --reason <≤200>` → counter + journal line; `restore-pull` per [П-7] (`--manifest-only` | `--key <k>|latest`, needs only `T2F_R2_*`, `T2F_BACKUP_KEY`, `DATABASE_URI`, `T2F_RESTORE_TMP`; downloads to the temp dir, verifies sha256 and key id, then decrypt → `pg_restore --no-owner --exit-on-error -d <DATABASE_URI>` via child env; deletes temp in `finally` and on SIGINT/SIGTERM). Script `"ops": "tsx src/cli/ops.ts"` in `server/package.json`. Args validated (enums, numbers, `--reason` ≤200).
- **Files:** `server/src/cli/ops.ts`, `server/package.json`.
- **Done means:** server `tsc` green; `pnpm --dir server run ops status` prints JSON against the local stack.
- **Verify:** server files.
- **Rules that apply:** sec → no secret in stdout/stderr; argv validated; temp dir mode 0700.
- **Risk:** `restore-pull` writes the decrypted stream only into `pg_restore`'s stdin — never to disk; the encrypted download is on disk in the temp dir.

### W36 — `restore-pull` verification helpers (S11)
- **Serves:** AC-53 (download/verify), AC-55, AC-59 (server half).
- **Do:** `ops/restorePull.ts` (used by the CLI): `verifyDownloaded(file, manifest, key)` → sha256 + size + key id check before any `pg_restore` spawn; failure → exit code 3 with a reason code (`sha256|key-id|auth|size`), temp cleaned; auth failure mid-stream kills `pg_restore` and cleans up.
- **Files:** `server/src/ops/restorePull.ts`, `server/src/cli/ops.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** sec.
- **Risk:** a partially restored DB after an auth failure mid-stream — the target is a throw-away clean stack, and the command reports failure (AC-55 says "stop before `pg_restore`": sha256 is verified on the whole file first, so a tampered file never reaches `pg_restore`; the mid-stream case only arises with a wrong-but-same-id key, which the key id check prevents).

### W37 — CLI integration tests (S11)
- **Serves:** AC-38, AC-52, AC-56, AC-63 (int), AC-55 (server half).
- **Do:** `server/test/integration/ops-cli.int.test.ts` (pattern `live-cli.int.test.ts`): `ops status` JSON passes `overviewSchema` and DB row counts unchanged; `backup-now` against s3mock prints key + manifest, objects present; `restore-record` → row + journal, `status` shows «останнє відновлення»; `spend-record` → journal line and `server` row changed; `restore-pull` against a second test DB `t2f_spec_13b_ops_restore` (created/dropped by the test through `scripts/db.mjs`, to confirm helper): flipped byte → exit 3 `sha256`, other key → `key-id`, temp dir empty after each; good copy → restore succeeds.
- **Files:** `server/test/integration/ops-cli.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file.
- **Rules that apply:** —
- **Risk:** needs `pg_restore` 17 — same runner fallback as [П-8] (`server/test/support/pgDumpRunner.ts` exposes `restore` too).

### W38 — Registry scanner (S12)
- **Serves:** AC-26.
- **Do:** `server/test/unit/ops-registry-scan.test.ts`: walk `server/src/**/*.ts(x)` (excluding tests), find `raise({ … source: '<lit>' … code: '<lit>' … })` object literals in any order, plus literal call sites of known helpers (`live/poller.ts` `raise(level, '<code>', …)` with source `live`, moderation helpers — list kept in the test), and fail with `file:line source/code` for kinds missing from `registries/ops.ts`; a fixture string `raise({source:'x', code:'y'})` → failure naming the fixture file. Fix any missing rows in `registries/ops.ts`.
- **Files:** `server/test/unit/ops-registry-scan.test.ts`, `server/src/registries/ops.ts`.
- **Done means:** green on the tree; fixture case red as expected.
- **Verify:** server files.
- **Rules that apply:** —
- **Risk:** regex scanner misses multi-line objects — parse with the TypeScript compiler API (`typescript` is a dev dependency, to confirm) rather than regex.

### W39 — Test helper and suite-end check (S12)
- **Serves:** AC-27, AC-28, AC-29 (int), NFR-1.
- **Do:** `server/test/support/expectAlarmInTestChannel.ts` `expectAlarmInTestChannel({source, code}, trigger)`: reset fake `calls`, run `trigger()`, poll fake `calls` ≤60 s for a message containing the registry domain title and `meaning`; returns the elapsed ms. Integration global teardown (`server/test/integration/global-setup.ts` returned teardown): query `log-alarms` for `ops/unregistered-alarm` created during the run → fail if >0 (with a skip list for the one test that raises it deliberately, which deletes its row).
- **Files:** `server/test/support/expectAlarmInTestChannel.ts`, `server/test/integration/global-setup.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server files.
- **Rules that apply:** —
- **Risk:** low.

### W40 — Helper integration test (S12)
- **Serves:** AC-27, AC-28, AC-29, NFR-1.
- **Do:** `server/test/integration/ops-alarms.int.test.ts`: helper green for `clock/edge-divergence`, `scheduler/lag`, `catalog/catalog-r2-copy-failed`, `site/rebuild-failed`, `live/quota-80`, `mod/spend_80`, `ops/backup-failed`, `ops/backup-stale`, `spend/cloudflare-80` (trigger = `POST /api/_test/alarm` with that kind; real triggers stay in each domain's own suite — Assumption 3); unregistered kind via the door → marker row present, then deleted; realtime publish failure (existing site/live publish failure path, to confirm trigger) → exactly one `log` alarm `site/publish-failed` or `live/publish-failed` in `log-alarms`; storm: 50 raises of 10 kinds in one minute → every first-of-kind message ≤60 s (max reported).
- **Files:** `server/test/integration/ops-alarms.int.test.ts`.
- **Done means:** green; NFR-1 max latency printed and ≤60 s.
- **Verify:** one int file.
- **Rules that apply:** —
- **Risk:** low.

### W41 — (unused id)

### W42 — Server image with the PostgreSQL 17 client (I1)
- **Serves:** AC-47 (image half).
- **Do:** `server/Dockerfile` runtime stage per [П-1]; a comment with the resolved date; `USER node` after. No change to the build stage.
- **Files:** `server/Dockerfile`.
- **Done means:** HEAVY `git archive HEAD | docker build -f server/Dockerfile --build-arg T2F_COMMIT=<40 hex> -t t2f-server:13bcheck -` exit 0 (uncommitted work: the conductor commits the phase before this check, or `docker build` from a temp `git stash create` tree — to confirm with the conductor), then `docker run --rm --entrypoint pg_dump t2f-server:13bcheck --version` prints `17.`.
- **Verify:** the two commands above under the exclusive lock.
- **Rules that apply:** sec → no secret in layers; apt lists removed.
- **Risk:** PGDG reachability at build time; pin `postgresql-client-17` (major) only.

### W43 — Operator `backup:env`, capacity → spend, key generation (I1)
- **Serves:** AC-52, AC-63 (capacity half), AC-48 (key provisioning).
- **Do:** `infra/ops/lib/backup.mjs`: `ops backup --env <rehearsal|prelaunch|production> [--target local|<host>] --now` → runs `pnpm run ops backup-now` in the server container on the node through the existing transport (`node.mjs` `composeArgv`, `exec.mjs`), prints key + manifest, journal entry (`lib/journal.mjs`); `production` allowed only with `--confirm production` (same as deploy). `ops.mjs`: subcommands `backup`, `restore` in `SUBCOMMANDS` (`:49`) and `NODE_SECRET_SUBS` (`:53`). Root `package.json`: `"backup:env": "node infra/ops/ops.mjs backup"`, `"restore:env": "node infra/ops/ops.mjs restore"`. `lib/capacity/**`: after `night` / `back` success → `pnpm run ops spend-record server …` per [П-6] + the :50–:10 warning. `lib/secrets/generate.mjs`: `fill('server.env', 'T2F_BACKUP_KEY', newSecret)` (32 random bytes base64, `envFile.mjs:6-9`).
- **Files:** `infra/ops/lib/backup.mjs`, `infra/ops/ops.mjs`, `package.json`, `infra/ops/lib/capacity/<step file>` (to confirm), `infra/ops/lib/secrets/generate.mjs`.
- **Done means:** ops `tsc` green.
- **Verify:** ops files.
- **Rules that apply:** sec → argv through `assertArgv`/`shq`; secrets only in env files.
- **Risk:** low.

### W44 — Operator `restore:env` (I1)
- **Serves:** AC-53, AC-54, AC-55, AC-56, AC-57, AC-59.
- **Do:** `infra/ops/lib/restore.mjs` per [П-7]: parse `--env` (enum without `production`), `--from <key|latest>`, `--target local` only (other targets refused in this wave); refuse `production` in either before any call; clean check: `docker compose -p t2f-restore-<utc> ls`/`docker volume ls --filter label=com.docker.compose.project=…` empty, and (when a `--project` is reused) zero rows → else refuse; `infra/ops/node/compose.restore.yml` (postgres `17.12-alpine`, redis, isolated network, no published ports except loopback health of the server); build/obtain the manifest commit's image (`lib/image.mjs`); one-shot containers `restore-pull`; start server, check `migrate:status`, `/api/health`, row counts = manifest, catalog version; compute and print duration + loss window (`--from` manifests of last 24 h); `ops restore-record` on the source env node (for rehearsal through the existing transport; `--no-record` for tests); temp dir under the project's bind mount removed in `finally` + `SIGINT` handler; `--keep` leaves the stack up for inspection (default: down with volumes after the report).
- **Files:** `infra/ops/lib/restore.mjs`, `infra/ops/node/compose.restore.yml`, `infra/ops/ops.mjs`.
- **Done means:** ops `tsc` green.
- **Verify:** ops files.
- **Rules that apply:** sec → never touches non-`t2f-restore-*` projects/volumes; `production` refused.
- **Risk:** destroying the wrong volumes — the only `down -v` is for the project this run created (name generated, checked against `t2f-restore-` prefix).

### W45 — Operator unit tests (I1)
- **Serves:** AC-52, AC-54, AC-57, AC-63.
- **Do:** `infra/ops/test/restore.test.mjs` (args matrix: `--env production`, `--target production`, `--target <host>` → refusal with no transport call; fake "volume exists" → refusal; loss window from fixture manifests; temp cleanup on thrown step with fake exec). `infra/ops/test/backup.test.mjs` (argv sent to the node equals `pnpm run ops backup-now`, journal entry, production needs `--confirm`). `infra/ops/test/capacity-spend.test.mjs` (after `night`/`back` the spend-record argv; warning window). `infra/ops/test/secrets.test.mjs` extended: `T2F_BACKUP_KEY` filled once, never regenerated.
- **Files:** `infra/ops/test/{restore,backup,capacity-spend,secrets}.test.mjs`.
- **Done means:** all green.
- **Verify:** ops files.
- **Rules that apply:** —
- **Risk:** low.

### W46 — Local clean-stack restore + load measurement (I2, HEAVY)
- **Serves:** AC-47 (health during backup), AC-53, AC-55, AC-56, AC-57, AC-59, NFR-2, NFR-3.
- **Do:** `infra/ops/test/node/restore.int.test.mjs` (pattern `deploy.int.test.mjs`, `support.mjs`): local s3mock + a backup made by `t2f-server:13bcheck` against this worktree's stack → `restore:env --env test-local --target local --no-record` (a test-only env name accepted only when `T2F_OPS_TEST=1`, to confirm the existing node-test convention) → steps green, report printed; flipped byte / other key → refusal before `pg_restore`, temp dir absent; SIGINT during `pg_restore` → temp dir absent; row-count mismatch → refusal. `server/test/stack/backup-load.stack.test.ts`: seed ×10 (multiply seed rows of key collections into the stack test DB), run a backup with the image's `pg_dump` while polling `/api/health` every 1 s → no 503, p95 ≤2× baseline, process RSS delta ≤100 MB, duration ≤5 min; prints numbers.
- **Files:** `infra/ops/test/node/restore.int.test.mjs`, `infra/ops/test/node/support.mjs`, `server/test/stack/backup-load.stack.test.ts`.
- **Done means:** both green; numbers in the phase report.
- **Verify:** node int file `restore.int.test.mjs`; in `server/`: `node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.stack.config.ts --maxWorkers=1 test/stack/backup-load.stack.test.ts`.
- **Rules that apply:** never `-p t2f`; one heavy process at a time.
- **Risk:** Docker Desktop memory on 16 GB — stop other worktrees' stacks first (conductor).

### W47 — Rehearsal restore measurement (M — orchestrator + wave lead, not an implementer)
- **Serves:** AC-58, NFR-5.
- **Do:** after L1 is green and the branch is committed: **the orchestrator** runs (with the owner's standing approval of the wave; no production, no live Telegram — rehearsal has no `T2F_TELEGRAM_*`, so the sink is disabled by AC-14 —, no paid resource) `pnpm edge:secret -- --env rehearsal --generate --target <rehearsal host>` (fills only the empty `T2F_BACKUP_KEY`), `pnpm deploy:env -- --env rehearsal --commit <branch sha>` (existing SPEC-13a path; respects freeze/locks), then `pnpm backup:env -- --env rehearsal --now`. The wave lead then runs on this machine `pnpm restore:env -- --env rehearsal --from latest --target local` into a fresh `t2f-restore-*` project, records duration (≤60 min), loss window (≤1 h; with one copy the window is reported as "n/a — one copy", and a second `--now` copy ≥1 h later gives the measured gap), copy size, commit, date in the docs patch for `docs/backend/backups.md`; writes the actions in `docs/services/{cloudflare,server}.md` journals the same day.
- **Files:** none in the repo (docs patch W48).
- **Done means:** the numbers are in `spec-13b/docs-patch.md`; `docs/services/*` journals list no Telegram send, no `time2fest-prod` write, no paid resource.
- **Verify:** manual.
- **Rules that apply:** `docs/services/README.md` (rehearsal deploy is already approved practice; anything paid or production → stop and ask the owner).
- **Risk:** rehearsal node off (capacity) — if so, the orchestrator decides; not an implementer step.

### W48 — Docs patch (D)
- **Serves:** AC-69, AC-58 (record), Design review 3 (key rotation text).
- **Do:** draft `spec-13b/docs-patch.md` in the side notes folder: `docs/backend/secrets.md` (five names, classes, production requirement, who holds the offline key copy), `docs/services/telegram.md` (state, owner task: token, chat ids, test channel; first live message only on the owner's word; how to point rehearsal at the test channel), `docs/backend/backups.md` (schedule, `T2FB1` format, key id, key rotation, retention 30/72, restore command, capacity :50–:10 rule, the W46 and W47 numbers), `docs/backend/alarms.md` (registry table generated from `registries/ops.ts`, delivery semantics incl. the one-duplicate window of W13, heartbeat silence rule, how a wave adds a row and uses the helper); a gotcha line if one was found.
- **Files:** side notes `spec-13b/docs-patch.md`; (`docs/knowledge/gotchas.md` if needed).
- **Done means:** the four sections exist with the names and numbers; no secret values.
- **Verify:** manual read by the wave lead.
- **Rules that apply:** docs in Ukrainian.
- **Risk:** low.

### W49 — Integration pass (L)
- **Serves:** AC-68, AC-70, NFR-4, NFR-5, all ACs (full suites).
- **Do:** after the conductor's rebase, mirroring `.github/workflows/verify.yml`: (1) `migration-safety` summary + numbering vs master (regenerate per W6 if master gained a migration); (2) `git add -N` new files, `node scripts/check-secrets.mjs`, `node scripts/check-research-data.mjs`; (3) one full verify per touched package from `.claude/sdd-engineering.json`: server (`tsc`, `eslint .`, `vitest run`, `pnpm test:int`, `verify-schema`), ops (`tsc`, `vitest run`), web `full` (unchanged code, but CI runs it: `tsc`, `contract-surface --check`, `eslint .`, `vitest run`, `sync_tokens --check`, `next build` to `out-verify`, `check-bundle`); `pnpm contracts:run --sim-only`; (4) `pnpm --dir server build` (admin tsx build-only failures); (5) `pnpm --dir server test:e2e -- doors-404` (the new `ops-tick` door 404s in production build); (6) the exclusive files of this wave once each (`alarm-two-instances`, `deps-down`, `ops-heartbeat-two`, `r2-down`, `ops-backup-two`, `ops-spend-two`); (7) AC-70: `git diff --name-only master...HEAD` → every path starts with `server/`, `infra/`, `fakes/`, `docs/specs/`, `docs/plans/SPEC-13b-ops.plan.md`, `docs/knowledge/gotchas.md`, `package.json`, `.github/` (Spec follow-up 2); (8) NFR-4: grep the integration log output and `log-alarms`/`alarm-deliveries`/manifests of the test DB for the test token and test key values → zero; (9) reviews: `architecture-reviewer` (≤2 rounds), `security-reviewer` (1 + 1).
- **Files:** none (fixes go back to the owning phase's files).
- **Done means:** every command exit 0; diff check zero foreign paths; reviews closed.
- **Verify:** as listed.
- **Rules that apply:** `sdd-routing.md` §4 (one full verify here).
- **Risk:** CI has Postgres 17 service but no `pg_dump` 17 on the runner — the int tests use `pgDumpRunner` fallback via `docker run`; confirm in L that `ops-backup.int.test.ts` passes in CI or is skipped there with an explicit reason (it is not in the "no skip" list; prefer the docker fallback).

## Execution

Single lane, one implementer at a time (16 GB, `sdd-routing.md` §7). Each dispatch: `sdd-engineering:implementer`, this plan's path, the phase id, `model` from the table; ~80 tool calls; out of budget → `PARTIAL` with the tree green after the last finished item. A fresh implementer reads: the plan header, its Execution row, its items, the Affected-surface rows of its files, and the ACs its items cite. The conductor commits after each phase.

| Lane / phase | Executor | Model | Work items | Files (no two phases run at once) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| C1 — env names, ports, registries | implementer | **opus** — `server/src/platform/env.ts` and the env registry are security-routed (production requirements, secret masking) | W1–W4 | `server/src/registries/{env,ops,spend}.ts`, `server/src/platform/env.ts`, `server/.env.example`, `infra/ops/node/server.env.example`, `infra/ops/test/env-example.test.mjs`, `server/src/{alarms,catalog,ops}/ports.ts`, `server/test/unit/{ops-env,ops-registry}.test.ts` | — | — | unit only |
| S2 — collections + one migration | implementer | sonnet | W5, W6 | `server/src/collections/{alarmDeliveries,logAlarms,backupRuns,restoreRuns,spendCounters,alarms}.ts`, `server/src/globals/opsSettings.ts`, `server/src/registries/{collections,globals}.ts`, `server/src/migrations/**`, `server/src/payload-types.ts`, (`payload-schema.int.test.ts`) | C1 | — | migcheck DB only; generator runs alone |
| S3 — alarm domain rules | implementer | **opus** — retry/coalesce/storm semantics and the redaction rules that keep personal data out of Telegram | W7, W8 | `server/src/domain/ops/{alarmDetails,alarmText,delivery,route}.ts`, `server/test/unit/ops-alarm-domain.test.ts` | S2 | — | unit only |
| S4 — Telegram fake, adapter, guard | implementer | **opus** — bot token handling (never in URL logs/errors) and the network guard | W9–W11 | `fakes/telegram/{server.mjs,README.md}`, `server/src/adapters/telegram.ts`, `server/test/support/noTelegramNetwork.ts`, `server/vitest{,.integration}.config.ts`, `infra/ops/test/workflow.test.mjs`, `server/test/unit/{fake-telegram,telegram-port}.test.ts` | S3 | — | fake on port 0 |
| S5 — outbox, sender, wiring | implementer | **opus** — alarm delivery outbox: exactly-once under lease, restart, Postgres down, no recursion; `container.ts` | W12–W15 | `server/src/alarms/{delivery,sender}.ts`, `server/src/adapters/{payloadAlarms,payloadOps}.ts`, `server/src/ops/runner.ts`, `server/src/container.ts`, `server/test/unit/alarm-delivery.test.ts`, `server/test/support/fakeTelegram.ts`, `server/test/integration/alarm-delivery.int.test.ts`, `server/test/exclusive/{alarm-two-instances,deps-down}.exclusive.test.ts` | S4 | — | shared lock; exclusive files HEAVY, sequential |
| S6 — heartbeat, digest, door | implementer | **opus** — lease + unique slots on wall clock (not the season clock), test door | W16–W19 | `server/src/domain/ops/schedule.ts`, `server/src/ops/{heartbeat,digest,runner}.ts`, `server/src/test-doors/{ops,registry}.ts`, `server/src/container.ts`, `server/test/unit/{ops-schedule,doors-gating}.test.ts`, `server/test/integration/{ops-heartbeat,alarm-delivery}.int.test.ts`, `server/test/exclusive/ops-heartbeat-two.exclusive.test.ts` | S5 | — | shared lock; one exclusive file |
| S7 — backup format, S3 additions, metering | implementer | **opus** — AES-256-GCM chunked format (truncation/reorder safety), `adapters/s3.ts` security-routed | W20–W23 | `server/src/ops/{backupFormat,meter}.ts`, `server/src/domain/ops/redisFilter.ts`, `server/src/adapters/{s3,meteredObjectStore}.ts`, `server/src/container.ts`, `server/test/unit/{backup-format,redis-filter,s3-store,r2-meter}.test.ts`, `server/test/integration/catalog-r2.int.test.ts` | S6 | — | shared lock |
| S8 — backup job, retention, stale | implementer | **opus** — streaming dump → encrypt → multipart with abort, deletion under a shared bucket, password handling | W24–W27 | `server/src/adapters/pgDump.ts`, `server/src/ops/{backup,retention,runner}.ts`, `server/src/domain/ops/{retention,lossWindow}.ts`, `server/src/container.ts`, `server/test/unit/ops-backup.test.ts`, `server/test/support/pgDumpRunner.ts`, `server/test/integration/ops-backup.int.test.ts`, `server/test/exclusive/{r2-down,ops-backup-two}.exclusive.test.ts` | S7 | — | shared lock; exclusive HEAVY |
| S9 — spend counters | implementer | sonnet | W28–W30 | `server/src/domain/ops/spend.ts`, `server/src/ops/{spend,runner}.ts`, `server/src/adapters/payloadOps.ts`, `server/src/container.ts`, `server/test/unit/ops-spend.test.ts`, `server/test/integration/ops-spend.int.test.ts`, `server/test/exclusive/ops-spend-two.exclusive.test.ts` | S8 | — | shared lock |
| S10 — monitoring slice + overview | implementer | sonnet | W31–W34 | `server/src/ops/{overview,overviewSchema}.ts`, `server/src/admin/{OpsView,OpsSlice}.tsx`, `server/src/admin/{messages,opsEndpoints,cmsEndpoints}.ts`, `server/src/registries/adminSlots.ts`, `server/test/unit/ops-view.test.ts`, `server/test/integration/{ops-overview,admin-slots}.int.test.ts` | S9 | — | shared lock |
| S11 — server CLI `ops` | implementer | **opus** — `server/src/cli/**` security-routed; restore-pull decrypt → `pg_restore`, temp cleanup | W35–W37 | `server/src/cli/ops.ts`, `server/src/ops/restorePull.ts`, `server/package.json`, `server/test/integration/ops-cli.int.test.ts`, `server/test/support/pgDumpRunner.ts` | S10 | — | shared lock; own restore DB |
| S12 — registry completeness + helper | implementer | sonnet | W38–W40 | `server/test/unit/ops-registry-scan.test.ts`, `server/src/registries/ops.ts`, `server/test/support/expectAlarmInTestChannel.ts`, `server/test/integration/{global-setup.ts,ops-alarms.int.test.ts}` | S11 | — | shared lock |
| I1 — image, backup/restore commands | implementer | **opus** — `server/Dockerfile`, `infra/**`: volume-destroying restore guards, production refusal, secret files | W42–W45 | `server/Dockerfile`, `infra/ops/lib/{backup,restore}.mjs`, `infra/ops/lib/capacity/<step>`, `infra/ops/lib/secrets/generate.mjs`, `infra/ops/node/compose.restore.yml`, `infra/ops/ops.mjs`, `package.json`, `infra/ops/test/{restore,backup,capacity-spend,secrets}.test.mjs` | S12 | — | image build HEAVY under exclusive lock |
| I2 — local clean-stack restore + load | implementer | **opus** — first real Docker restore; red means a bug to fix in I1/S11 files limited to the failing behaviour | W46 | `infra/ops/test/node/{restore.int.test.mjs,support.mjs}`, `server/test/stack/backup-load.stack.test.ts` (+ fixes in `infra/ops/lib/restore.mjs`, `server/src/ops/{backup,restorePull}.ts`) | I1, all committed | — | HEAVY, exclusive; project `t2f-restore-*`; never `-p t2f` |
| L1 — integration pass | wave lead | — | W49 | none | I2 + rebase | — | heavy runs one at a time |
| M — rehearsal restore measurement | **orchestrator** (deploy, backup on rehearsal) + wave lead (local restore) | — | W47 | none (numbers → docs patch) | L1 | D | rehearsal only; existing `pnpm deploy:env`; no production, no live Telegram, no paid resource |
| D — docs patch | implementer | sonnet | W48 | side notes `spec-13b/docs-patch.md`, (`docs/knowledge/gotchas.md`) | L1 (numbers from M added at the end) | M | text only |

Order: C1 → S2 → S3 → S4 → S5 → S6 → S7 → S8 → S9 → S10 → S11 → S12 → I1 → I2 → L1 → (M ∥ D) → D adds M's numbers. Files touched by several phases (`container.ts`: S5, S6, S7, S8, S9; `ops/runner.ts`: S5, S6, S8, S9; `adapters/payloadOps.ts`: S5, S9; `registries/ops.ts`: C1, S12; `alarm-delivery.int.test.ts`: S5, S6; `pgDumpRunner.ts`: S8, S11) are sequential by construction. 14 implementer phases (10 opus, 4 sonnet + D sonnet) + L1 + M.

## Verification plan

| Command | Directory | Passing means |
|---|---|---|
| server `files` (config) | `server` | exit 0 (every S phase, C1, I2 fixes) |
| ops `files` (config) | `infra/ops` | exit 0 (C1, S4, I1) |
| one int file (shorthand above) | `server` | the named `*.int.test.ts` green (S2, S5–S12) |
| one exclusive file (shorthand above) | `server` | green (S5, S6, S8, S9; L1 once each) |
| migcheck sequence | `server` | all exit 0 (S2, L1) |
| HEAVY `docker build` of the server image + `pg_dump --version` | `.` | exit 0, prints `17.` (I1) |
| node int file `restore.int.test.mjs` | `.` | green (I2) |
| `node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.stack.config.ts --maxWorkers=1 test/stack/backup-load.stack.test.ts` | `server` | green; ≤5 min, no 503, p95 ≤2×, RSS ≤+100 MB (I2) |
| `node scripts/check-secrets.mjs` (after `git add -N`), `node scripts/check-research-data.mjs` | `.` | exit 0 (C1, L1) |
| server / ops / web `full` (config), `pnpm contracts:run --sim-only` | per config | exit 0, once (L1) |
| `pnpm --dir server build` | `.` | exit 0 (L1) |
| `pnpm --dir server test:e2e -- doors-404` | `.` | green (L1) |
| `git diff --name-only master...HEAD` filter (W49 step 7) | `.` | zero foreign paths (L1) |
| `pnpm restore:env -- --env rehearsal --from latest --target local` | `.` | report ≤60 min, loss ≤1 h (M, manual) |

## Assumptions

Technical judgement calls (product behaviour is in the spec):
1. [П-1] … [П-10] above.
2. "Ключові колекції" of the manifest (AC-43, AC-57) = the collections holding passports, stamps, orders and users that exist on master at implementation time (to confirm names); collections added by later waves are added to the list by those waves.
3. AC-28's helper checks the delivery path and the registry text; the trigger for the listed kinds is the existing `POST /api/_test/alarm` door with that exact kind. Each domain's real trigger is already proven by its own suite.
4. Heartbeats, digests and storm summaries share the alarm outbox and its retries ([П-3]); a heartbeat that cannot be delivered within 10 min is marked failed like an alarm.
5. The 70-min red marker (AC-23) is computed server-side in the `telegram` block so `ops status` shows the same.
6. AC-3/AC-8 "exactly once" is delivered as "at most one successful send per row except a crash between Telegram's 200 and the DB update" (documented in `alarms.md`); the tests use the fake, where this window does not occur.
7. `restore:env --target local` supports only `local` in this wave; a remote target (DO clean machine) is SPEC-22b ([Q6]).
8. The `cloudflare` storage term uses Σ sizes of existing backup objects from `list` (once per hour), not manifest history.

## Open questions

None.

## Research used

- No researcher dispatched: the stack is described in `D:/Work/Pets/Time2Fest/docs/backend/code-map.md` and earlier plans (`sdd-routing.md` §4 allows skipping), and the caller's code research `spec-13b/research-code.md` (side notes, 2026-11-24) was used with its `file:line` citations; citations the plan changes were spot-checked by the planner: `server/src/platform/logger.ts:70-125`, `server/src/catalog/ports.ts:48-53`, `server/src/adapters/payloadLive.ts:410-445`, `server/src/adapters/pgAiSpend.ts:7-80`, `server/src/live/ports.ts:177-183`, `server/src/clock/index.ts:19-55`, `packages/rules/src/time/celebration.ts:1-20`, `server/Dockerfile`, `server/package.json`, `server/vitest.integration.config.ts:8-12`, `server/src/registries/env.ts:58-68`, `infra/ops/ops.mjs:38-53`, `infra/ops/lib/secrets/{generate,envFile,files}.mjs`, `docker-compose.yml:5-6,100`, `docs/knowledge/gotchas.md`.
- **Not established (verify during implementation, no AC depends on the answer):** PGDG repository availability for `bookworm` at build time (W42 checks it by building); s3mock 5.2.3 behaviour on `ListMultipartUploads` (W27 asserts through it; fallback: assert no incomplete upload via `AbortMultipartUpload` call count); whether `typescript` compiler API is importable in server unit tests (W38, fallback: a tolerant multi-line regex).

## Rollback / blast radius

- **Server:** new collections, a global and one nullable column (CREATE / ADD COLUMN); `down` drops them. Without `T2F_TELEGRAM_*` the sink is off and nothing leaves the process; without `T2F_BACKUP_KEY` no backup starts (one `page` in rehearsal/production). The delivery wrapper calls the unchanged `createAlarm` first, so the stdout contract holds even if every new sink fails. Rollback = the previous image (SPEC-13a; never runs `down`).
- **Image:** +PostgreSQL 17 client only.
- **infra/ops:** new subcommands; `restore` only creates and removes its own `t2f-restore-*` Compose project; `capacity` gains a post-step record call that can fail without failing the resize (logged).
- **R2:** writes only under `<T2F_R2_PREFIX>backups/db/` of the env's own bucket; retention deletes only names matching the backup pattern there.
- **Visible change:** none on the site; a new admin slot «Моніторинг» for the owner.
