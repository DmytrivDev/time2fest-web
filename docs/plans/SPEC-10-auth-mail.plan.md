# Implementation plan: Sign-in and mail — persistent device cookie, guest on first write, email-code and Google sign-in, season-long session, session events, mail module with fallback provider, counters and alarms, the «subject data» handler (SPEC-10)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-10-auth-mail.md` (Status: approved; 0 `[NEEDS CLARIFICATION]` markers). AC-1 … AC-59 (`:79-268`), NFR-1 … NFR-7 (`:284-305`), edge cases EC-1 … EC-11 (`:270-282`), owner decisions В1–В5 and defaults [Q1]–[Q5] (`:15-29`), session decisions [А1]–[А13] (`:31-47`), proposed contract (`:333`). Open question 3 (`:438`, delete hooks) is for the plan: resolved by the spike (P1, outcome S1). Open questions 1–2 block nothing (owner tasks after merge).
This plan implements those requirements; it does not define or change them.
**Execution mode** — recommended (to be confirmed by the orchestrator for the owner): **single conductor, sequential phases, two lanes with disjoint files** — Lane A = server sign-in core (one implementer at a time), Lane B = contracts, mail domain and web client. Four optional parallel pairs are listed in `Execution` (P2∥P3, P5∥P6, P12∥P14, P13∥P15). Reason: `server/src/container.ts`, `server/src/auth/instance.ts` and `server/src/auth/forward.ts` are touched by several Lane-A phases, so Lane A serializes; the 16 GB machine allows ≤2 heavy processes (`docs/backend/sdd-routing.md` §7).
**Out of scope** — the spec's Non-goals (`:57-62`): profile, nickname, flag, schedule, pass attach, bans, the full guest → account merge rules A-3, change of email, `linkGoogle` / `google-taken`, account deletion (SPEC-11 / SPEC-20); switching the `auth` domain default to `http` (SPEC-11 — `lib/api/http/domains.ts` is NOT changed); reminder mails (SPEC-19) and refund mails (SPEC-17); live mails, DNS (SPF/DKIM/DMARC, Cloudflare onboarding), the production Google client (owner, AC-59); the Resend HTTP API. Architecture review and `security-reviewer` are separate agents (`security-reviewer` mandatory: sessions, cookies, OAuth, test doors, secrets, personal data).

Repository root for every path = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-10` (branch `spec-10-auth-mail`, base `master` `4fb36717` + spec commit `e6efa7c6`).

- **Port slot: 20** — derived, do NOT set `T2F_SLOT`. `server/scripts/lib/worktree.mjs:66-79`: a `spec-NN-*` branch maps to `2·NN` → `spec-10-auth-mail` = 20; ports `4000 + 10·20` = server 4200, web 4201, fakes 4202–4205 (`:86-89`); databases `t2f_spec_10_auth_mail` / `t2f_spec_10_auth_mail_test`, Redis DB 20. Live worktrees (`git worktree list`, 2026-11-25): spec-06 → 12, spec-08 → 16, spec-12 → 24, spec-13a → 26, spec-21a → 42 (explicit), main → 0; country-kit/prelaunch branches run no stack. Slot 10 was not taken: it is the derived slot of a `spec-05-*` branch and choosing it would require an explicit `T2F_SLOT` for no gain.
- **Shared fixed ports added by this wave** (compose services shared by all worktrees, like Mailpit): `mailpit-chaos` 127.0.0.1:1026 (SMTP) / 127.0.0.1:8026 (API); `oidc` (mock-oauth2-server) 127.0.0.1:8091 → container 8080; `fake-smtp` 127.0.0.1:2525 (stack only; tests start it in-process on port 0). None collides with 5433, 6380, 8000, 1025, 8025, 9090 or the slot range 4000–4475.
- **Do not commit, never push** (the conductor commits after each phase). Never stage `tsconfig.json`. `server/src/payload-types.ts` is regenerated only in P4.
- **Never read** (`sdd-routing.md` §6): `research_data/**`, `docs/archive/**`, `Old Project/**`, `**/reference-boards/**`, `graphify-out/graph.json`, `out*/`, `.next*/`, `node_modules` (except `package.json` / `.d.ts` lookups of `better-auth`, `nodemailer`), `pnpm-lock.yaml`, `.env*` contents other than `*.env.example`, `dashboard/secrets/**`, `docs/decision.md` whole (grep + range only).
- **No live mail, no live Google, ever, in this wave** (В5, NFR-6). The only SMTP hosts any process or test reaches are `127.0.0.1:1025` (Mailpit), `127.0.0.1:1026` (Mailpit chaos), the in-process fake SMTP (port 0) and `127.0.0.1:2525`; the only OIDC issuer is `http://127.0.0.1:8091/google`. Test secrets are literals with the marker `// check-secrets: allow test fake`.
- **New dependencies only in P1.** `pnpm install` is run only in P1. No `kysely` direct dependency (Better Auth bundles it; we pass a `pg.Pool`); no `smtp-server` (the fake SMTP is zero-dependency `node:net`).
- Machine: Vitest `--maxWorkers=2`; integration files serially under the shared lock; Playwright `--workers=2`; one heavy process at a time (server `next build`, e2e). Local stack per skill `local-stack`.
- Paths marked **(to confirm)** were not opened by the planner; the implementer checks them with Grep / `graphify explain` before editing and keeps the plan's intent.
- Phase ids P1 … P17; work items W1 … W45. Every phase brief: plan header, own `Execution` row, own items, the `Affected surface` rows of its files, the ACs its items cite (`sdd-routing.md` §5).

### Command shorthands used in `Verify` lines
- **server files** = config `verify` entry `server` → `files` (in `server/`): `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`.
- **contracts files** = config `contracts` → `files` (in `packages/contracts/`): `npx tsc --noEmit -p . && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`; plus `node ../../scripts/contract-surface.mjs --check`.
- **web files** = config `web` → `files` (in repo root): `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`.
- **one int file** = in `server/`: `node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts --maxWorkers=1 test/integration/<file>` (stack up per `local-stack`, slot 20, DB migrated and seeded; never `pnpm` after `--` on Windows).
- **one e2e file** = in `server/`: `npx playwright test --workers=2 test/e2e/<file>` with the worktree server served per `local-stack` (`node scripts/stack.mjs serve`, slot 20) (to confirm the server Playwright config's `webServer` / base URL in `server/playwright.config.ts`).
- **auth http suite** = in repo root, server served: `node scripts/contract-run.mjs` (runs sim + http per domain; the `auth` row must be green on both columns) (to confirm whether `contract-run.mjs` also accepts a domain filter; if not, run all).
- **migcheck** = in `server/`: `node scripts/db.mjs migcheck up` → `pnpm migrate` → `pnpm migrate:down` → `pnpm migrate` → `node scripts/db.mjs migcheck drop`; then `node scripts/verify-schema.mjs`.
- **server build** (HEAVY, once in P5) = stop any `serve` of this worktree, then in `server/`: `node scripts/lock.mjs --mode exclusive -- npx next build`.

## Planner decisions

- **[П-1] Better Auth is mounted as exact route rows, not a prefix.** The dispatcher matches `METHOD path` exactly (`server/src/endpoints/pipeline.ts:256`), so `server/src/endpoints/auth.ts` declares one `RouteRow` per allowed path and every row's handler calls `forwardToAuth(ctx)`. Anything else under `/api/auth/*` is the dispatcher's single 404 (AC-34) with no extra code. Rows (none `public`, so cookies survive `finalize`, `pipeline.ts:96-101`; `maxBodyBytes` 4096): `GET /api/auth/get-session`, `POST /api/auth/email-otp/send-verification-otp`, `POST /api/auth/sign-in/email-otp`, `POST /api/auth/sign-in/social`, `GET /api/auth/callback/google`, `POST /api/auth/sign-out`, `POST /api/auth/sign-in/anonymous` (rate-limited by the guest row of [П-6]). POST rows go through the existing `10-origin` middleware (`pipeline.ts:154-170`, `T2F_ALLOWED_ORIGINS`) → a foreign `Origin` is 403 (AC-33) before Better Auth sees it; Better Auth's own origin check stays on (`trustedOrigins` = `T2F_ALLOWED_ORIGINS`). The auth rows do NOT use the generic `body` schema (its refusal is `invalid-input`, not `validation/email`); the code flow validates with the contracts schemas itself (W24).
- **[П-2] Request/response rewrite in one module** `server/src/auth/forward.ts`: builds a new `Request` for `auth.handler` with `x-forwarded-for`, `x-real-ip`, `forwarded` and every `x-t2f-*` header removed and one header `x-t2f-ip` added from `ctx.client` (value form per spike outcome S4; never the raw address — `ClientContext` exposes none, `platform/edge.ts:26-35`) (AC-32); strips a dead session cookie on session-starting paths per S3 (AC-25, [А11]); on JSON responses removes `token` and `session.token` (AC-14, [А13]); maps Better Auth errors to `ApiError` (W24); re-shapes `get-session` to the contracts `Session` (AC-35). Better Auth's own IP detection is pointed only at `x-t2f-ip` (`advanced.ipAddress.ipAddressHeaders`).
- **[П-3] Device cookie in the pipeline.** `Ctx.device` (string) is resolved when `Ctx` is built (`pipeline.ts:260`) from a valid `t2f_device` cookie (22-char base64url of 128 random bits, `platform/device.ts`) or freshly generated; `finalize` appends `Set-Cookie: t2f_device=<id>; Max-Age=34560000; Path=/; Secure; HttpOnly; SameSite=Lax` (no `Domain`) on every non-public response when the request had no valid cookie (AC-1). Not under Better Auth's cookie prefix, so sign-out never touches it (AC-2). Better Auth reads it in `databaseHooks.session.create.before` from the request cookies and stores it in `user_sessions.device_id` (AC-2) and, for anonymous users, `users.device_id` (AC-4).
- **[П-4] Tables.** Better Auth (Kysely adapter, own `pg.Pool` max 5 on `DATABASE_URI`) with `user.modelName 'users'`, `session 'user_sessions'`, `account 'user_accounts'`, `verification 'auth_verifications'`, snake_case `fields`, `advanced.database.generateId: 'uuid'`; additional fields `session.deviceId` and `user.deviceId` (`input:false`). The merge-retry queue of AC-24 is a Payload collection `auth-link-retries` (so its DDL is generated by Payload, skill `migration-safety` check 1). One migration `<ts>_spec10_auth`: Payload's generated `up`/`down` for `auth-link-retries` + the verbatim SQL of `npx auth@1.7.28 generate` appended to `up` and the reverse `DROP TABLE IF EXISTS … ` (sessions, accounts, verifications, users) prepended to `down`. `users` is never registered as a Payload collection ([А1], В5 of SPEC-04: `admins` stays separate).
- **[П-5] Session events.** Publish `session` (`{type:'session', id:<uuid>, data:{reason}}`) to `user:#<subjectId>` via `publisherOf(deps).publish('user', id, env)` and call `invalidatorOf(deps).invalidateSubject(id)` for the old and new subject (AC-29; SPEC-06 handoff, `realtime/invalidate.ts`). Trigger points depend on spike outcome **S1**: if `databaseHooks.session.delete.after` fires on `sign-out`, `revokeSessions` and `internalAdapter.deleteUser`, publish `signed-out` there; otherwise publish explicitly from the `/sign-out` after-hook, from the erase handler (W40) and from the guest merge (W30). `signed-in` is published from `databaseHooks.session.create.after` for non-anonymous users. A failed publish is logged (`queued`/`unavailable`) and never fails sign-in.
- **[П-6] Guest on first write.** New optional `RouteRow.subject?: 'required'` (`endpoints/types.ts`). A middleware `25-subject` (`registries/middleware.ts`, between `validate` and `30-rate-limit`) sets `ctx.subject` from the session for every row (AC-30) and, for rows with `subject: 'required'` and no session, creates a guest through `auth.api.signInAnonymous({ headers, returnHeaders: true })` (mechanism per spike S8), binds it to `ctx.device`, copies the guest session `Set-Cookie` onto the outcome, after a limit row `auth-guest-create` (`limit 60, windowMs 600_000, keys ['ipDay'], onStoreDown 'fail-closed'`) (AC-4, [Q2]). `30-rate-limit` passes `device: ctx.device` (AC-30). No product route is marked `subject: 'required'` in this wave except a test-class route `POST /api/_test/auth/write-probe` (W27) used by AC-4/AC-5/AC-23 tests; SPEC-11+ mark their routes.
- **[П-7] Mail.** One `MailService` (`server/src/mail/service.ts`) over two `MailTransport`s built by `adapters/smtpMail.ts` (Nodemailer pooled: `maxConnections 5`, `rateLimit 8`, `rateDelta 1000` (NFR-3), `connectionTimeout 3000`, `greetingTimeout 3000`, `socketTimeout 5000`, `dnsTimeout 2000`, `secure = port === 465`, plus an outer 4 s race per attempt). Classification in the pure `domain/mail/classify.ts` from `{ code, responseCode, command, response }` (research notes mail §2): connection/timeout/socket/DNS/TLS/auth, any 4xx, 5xx with `quota|rate|too many|limit|not verified` (case-insensitive) → `fallback`; 5xx on `RCPT TO` without such text → `recipient` (AC-38). Breaker state in Redis (`mail:broken:<provider>` with TTL = to 00:00 UTC for quota/limit, 5 min otherwise) (AC-39). Day counters `mail:sent:<provider>:<yyyymmdd>` (`incrWindow`, window to 00:00 UTC). Same `Message-ID` and `Resend-Idempotency-Key` (= verification id hash) on both attempts (AC-37, EC-4). Once-per-period alarms claimed with `setIfAbsent` keys (`mail:alarm:<code>:<provider>:<period>`).
- **[П-8] Code limits commit after the mail outcome.** Limits for the code request ([А4], AC-8…AC-10): the 30 s gap is an atomic `setIfAbsent('auth:gap:<sha256(email)>', 30 s)` (EC-1); the 5/10 min counters (email hash, `ipDay`, `ip48Day`) and the 10/day email counter are **read** before sending and **incremented** (`incrWindow`) only after the mail service returned success; on `unavailable` the gap key is deleted and the Better Auth verification row is deleted, so the retry is not counted (AC-40, [А8]). Redis unreachable → `unavailable` (NFR-4). Keys never contain the address (sha256 of the normalized email).
- **[П-9] Clocks.** Our own time logic (session clamp, code windows, breaker, day counters, reminder) takes an injected wall clock (`deps.clock` is the season clock — use the wall clock the ops runner uses, `realClock`, `server/src/clock/index.ts` (to confirm export)); integration tests pass a substitute through `testDeps(overrides, env)` (`server/test/integration/helpers.ts:18`). Better Auth's internal expiry (OTP 10 min) uses `Date.now`; AC-13 is driven by the expire-code door (W26).
- **[П-10] Fakes.** Fake OIDC = compose service `oidc` (`ghcr.io/navikt/mock-oauth2-server:7.0.2`, `JSON_CONFIG` with `interactiveLogin: true`); a test logs in by POSTing the mock's login form with `username` and `claims` (field names per spike S5). The door `auth-google-user` validates a fake user `{sub, email, emailVerified, name?}` and returns the exact form fields; `server/test/support/fakeOidc.ts` performs the POST. Second Mailpit `mailpit-chaos` (`MP_ENABLE_CHAOS=true`, triggers 0 by default) is the only instance whose chaos is ever changed; chaos tests take a cross-worktree Redis lock `t2f:test:mailpit-chaos` (`setIfAbsent`, 60 s) and reset triggers in `finally`. Fake SMTP `fakes/smtp/server.mjs` behaves by recipient tag (W3).
- **[П-11] Plan-free reminder** is an ops-runner job `mail-plan` (`server/src/ops/runner.ts` `OPS_JOBS`, `:43`), not a season moment ([А10]); due when `T2F_MAIL_PLAN=free` and the `Europe/Kyiv` date is 30.12 or 31.12 and time ≥ 09:00, claimed once per Kyiv date.

## Spec follow-ups
1. **AC-31** says e2e through the site; the site's `auth` domain stays `sim` until SPEC-11, so this wave proves it with a transport unit test plus a node-level check inside the `auth` http suite (W43, W44). The browser e2e belongs to SPEC-11's domain switch.
2. **AC-2, AC-17 … AC-19, AC-25** are e2e at the server level (Playwright against the slot-20 server and the fake OIDC, no site UI) for the same reason.
3. **AC-22** "фейк OIDC зупинено": stopping the shared `oidc` container would break other worktrees; the test points the discovery URL at a closed loopback port through `testDeps` env instead — same observable behaviour.
4. **AC-37/AC-38/AC-40** "Mailpit основного з хаосом": chaos is set on the second instance `mailpit-chaos`, never on the shared main Mailpit.
5. **AC-53**: in CI a service container cannot mount repo files, so the fake SMTP runs in-process in tests (port 0); the compose service `fake-smtp` exists for the stack and its health check.
6. Spec `:437` owner tasks (DNS, keys, real Resend SMTP texts, production Google client, Pro) are recorded in the docs patch (W45), not built.

## Requirements traceability
| Req | Requirement (cited) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | `t2f_device` set with attributes when missing | spec:81 | W14 | W16 `auth-session.int` |
| AC-2 | same device id across in → out → in as another account | spec:84 | W14, W15, W31 | W31 `auth-device.e2e` |
| AC-3 | `get-session`/public routes create no guest/account | spec:87 | W15, W28 | W16, W31 `auth-guest.int` (100 requests) |
| AC-4 | guest on first write; 61st per ipDay in 10 min → `rate_limited` | spec:90 | W28 | W31 `auth-guest.int` |
| AC-5 | guest without data after 30 days removed with sessions | spec:93 | W41 | W42 `auth-guest-prune.int` |
| AC-6 | `CodeInfo` same form for new/existing, no account created | spec:98 | W6, W23, W24 | W25 `auth-code.int` |
| AC-7 | bad email → `validation/email`, no mail | spec:101 | W24 | W25 |
| AC-8 | <30 s → `rate_limited/wait` + `retryAfterMs` | spec:104 | W22, W23 | W25 |
| AC-9 | 5/10 min per email, ipDay, /48 → `too-many` | spec:107 | W22, W23 | W25 |
| AC-10 | 10/day per email → `too-many` until 00:00 UTC | spec:110 | W23 | W25 |
| AC-11 | wrong code → `validation/wrong-code`, attemptsLeft −1 | spec:113 | W24 | W25 |
| AC-12 | 5th wrong → `too-many-attempts`, code burnt | spec:116 | W24 | W25 |
| AC-13 | code older than 10 min → `conflict/expired` | spec:119 | W24, W26 | W25 (door) |
| AC-14 | sign-in sets cookie, `SignInOutcome`, no token in body | spec:122 | W15, W24 | W25 |
| AC-15 | new code invalidates the previous | spec:125 | W10, W24 | W25 |
| AC-16 | codes stored only hashed | spec:128 | W10 | W25 |
| AC-17 | Google returns to `returnPath` + `signin=google`, `new=1`, hash kept | spec:133 | W13, W33 | W35 `auth-google.e2e` |
| AC-18 | unsafe `returnPath` → `/` | spec:136 | W13, W33 | W16 unit, W35 e2e |
| AC-19 | cancel → `error=cancelled` | spec:139 | W33 | W35 e2e |
| AC-20 | verified email of existing account → same user, Google linked | spec:142 | W33 | W34 `auth-google.int` |
| AC-21 | unverified email of existing account → no rows, `error=failed` | spec:145 | W33 | W34 |
| AC-22 | discovery/token exchange down → `unavailable` / `error=failed` | spec:148 | W33 | W34 |
| AC-23 | guest merge: device + registered handlers, idempotent | spec:151 | W30, W33 | W31 `auth-merge.int`, W34 |
| AC-24 | merge handler throws → sign-in completes, retry job, `log` `auth/link-retry` | spec:154 | W30 | W31 `auth-merge.int` |
| AC-25 | revoked cookie on sign-in → new session cookie survives | spec:157 | W5, W15 | W31 `auth-device.e2e` |
| AC-26 | `__Secure-` cookie attrs, expiry `min(now+60 d, season end)` | spec:162 | W13, W15 | W16 |
| AC-27 | revoked session → next request as no session | spec:165 | W15 | W16 |
| AC-28 | sign-out on A keeps B | spec:168 | W15 | W16 |
| AC-29 | `session` event to `user:#<id>` + `invalidateSubject` ≤3 s | spec:171 | W29 | W31 `auth-events.int` |
| AC-30 | subject from session cookie; `subject` and `device` keys to limits | spec:174 | W28 | W31 `auth-guest.int` |
| AC-31 | client transport asks for a new token on subject change | spec:177 | W43 | W44 (unit + http suite) |
| AC-32 | IP only from `x-t2f-client`; client IP headers stripped | spec:180 | W15 | W16 |
| AC-33 | foreign `Origin` on POST → 403 | spec:183 | W15 | W16 |
| AC-34 | non-listed `/api/auth/*` → 404 | spec:186 | W15 | W16 |
| AC-35 | `get-session` → contracts `Session` with neutral pass fields | spec:189 | W6, W15 | W16 |
| AC-36 | code mail ≤5 s, sender, Ukrainian text+HTML, no links, headers | spec:194 | W17, W20 | W18 unit, W21 `mail-failover.int` |
| AC-37 | primary failure → fallback once, same code, success | spec:197 | W17, W19, W20 | W21 |
| AC-38 | recipient 5xx → no failover, `validation/email` | spec:200 | W17, W20, W24 | W18, W21 |
| AC-39 | broken primary skipped until 00:00 UTC / 5 min | spec:203 | W17, W20 | W18, W21 |
| AC-40 | both fail → `unavailable`, not counted, `page` `mail/all-providers-down` | spec:206 | W20, W23 | W21 (alarm), W25 (not counted) |
| AC-41 | failover alarm once per broken period | spec:209 | W20 | W21 |
| AC-42 | `mail/daily-70` once a day | spec:212 | W20 | W21 |
| AC-43 | `mail/ceiling-80` per provider once a day | spec:215 | W17, W20 | W21 |
| AC-44 | ≥80 % refuse class «other»; codes to 100 %, then fallback | spec:218 | W17, W20 | W18, W21 |
| AC-45 | `mail/plan-free` 30.12/31.12 09:00 Kyiv while `free` | spec:221 | W36, W37 | W38 |
| AC-46 | `mail` domain unreserved with rows + `mail.sent`; monitoring shows day counter | spec:224 | W20, W37 | W21 + `ops-registry-scan` unit, W38 |
| AC-47 | `test` class refuses non-loopback SMTP/fallback/discovery | spec:227 | W8 | W9 `auth-env` unit |
| AC-48 | no emails/codes in logs, alarms, audit, error details | spec:230 | W19, W20, W24 | W39 `auth-logs.int` |
| AC-49 | export: email, Google name, methods w/o tokens, sessions, devices | spec:235 | W40 | W42 `auth-subject-data.int` |
| AC-50 | erase rows + `session` event; registry rows `auth`, `auth-codes` | spec:238 | W40 | W42 int + unit |
| AC-51 | contracts additive: `AUTH_REASONS`, bodies, `session` event | spec:243 | W6 | W7 |
| AC-52 | doors: last code, expire code, fake Google user, mail counter | spec:246 | W26 | W27 `auth-doors.int` |
| AC-53 | stack: fake OIDC, second Mailpit with chaos, fake SMTP | spec:249 | W2, W3 | W2 (stack health), W3 unit |
| AC-54 | `auth` http adapter green on code + Google rows | spec:252 | W43 | W44 `auth http suite` |
| AC-55 | tests only to Mailpit / fake SMTP / fake OIDC | spec:255 | W8, W39 | W9, W39 |
| AC-56 | unique test recipients (worktree id + random) | spec:258 | W26 | W27 unit |
| AC-57 | schema check red when Better Auth expects a missing table/column | spec:261 | W12 | W12 `auth-schema.int` |
| AC-58 | docs patch: secrets, alarms, services mail/google, night peak | spec:264 | W45 | manual (orchestrator) |
| AC-59 | SPF/DKIM/DMARC + Gmail/Outlook inbox | spec:267 | W45 (owner task recorded) | manual (owner) |
| NFR-1 | code mail to provider ≤5 s p95 at 20 req/s | spec:286 | W20 | W39 `mail-load.int` |
| NFR-2 | `get-session` ≤50 ms p95 | spec:289 | W15 | W39 `auth-perf.int` |
| NFR-3 | ≤8 mails/s per primary | spec:292 | W19 | W21 `smtp-mail` unit |
| NFR-4 | Redis down → code request `unavailable` | spec:295 | W23 | W25 |
| NFR-5 | no raw IP; user-agent ≤128 | spec:298 | W15 | W16 |
| NFR-6 | no live mail/Google in test and CI | spec:301 | W8, W39 | W9, W39 |
| NFR-7 | ≤10 code mails per email per day | spec:304 | W23 | W25 |

Open question 3 (`:438`) → W5 outcome S1 → W29.

## Affected surface
| File | New/Mod | Package | Home (ring / radius) | Skills that will govern it | Constraint to respect |
|---|---|---|---|---|---|
| `server/package.json`, `pnpm-lock.yaml` | Mod | server | manifest | security (`**/package.json`); lockfile unrouted | exact pins: `better-auth` `1.7.28`, `nodemailer` `10.6.1` (+ `@types/nodemailer` exact only if `nodemailer` ships no types); no other new deps in the wave |
| `docker-compose.yml`, `server/scripts/stack.mjs` | Mod | infra/server | stack | security (`**/docker-compose*.yml`, `server/scripts/**`) | 127.0.0.1-only port bindings; pinned images; health checks like mailpit (`stack.mjs:212-214`); start list `stack.mjs:61` |
| `.github/workflows/verify.yml` | Mod | CI | CI | security (`.github/workflows/**`) | add services `mailpit`, `mailpit-chaos`, `oidc` (same images/env as compose); no secrets; no network to real providers |
| `fakes/smtp/{server.mjs,README.md}`, `fakes/oidc/README.md` | New | fakes | fakes | gap (`fakes/**` unrouted) | zero-dependency `node:net`; pattern `fakes/telegram/server.mjs`; binds 127.0.0.1 only |
| `server/test/support/{fakeOidc,mailpit,mailChaos,testEmail}.ts` | New | server | test support | gap (`server/test/**` unrouted) | chaos only on `mailpit-chaos`, under the Redis lock [П-10]; unique recipients (AC-56) |
| `server/test/integration/auth-spike.int.test.ts` | New | server | test | gap | own Postgres schema `auth_spike`, dropped in `afterAll`; stays as a library-behaviour regression test |
| `packages/contracts/src/{auth,auth.schemas}.ts`, `packages/contracts/src/{schemas,index}.ts` | New/Mod | contracts | contracts | onion, contract-conformance | additive only (skill contract-conformance §4); reasons pattern `CATALOG_REASONS` (`catalog.ts:7`), `REALTIME_REASONS` (`realtime.ts:26`); types zod-free in `auth.ts`, zod in `auth.schemas.ts` |
| `scripts/contract-surface.baseline.json` | Mod | web | script data | contract-conformance | additions only; regenerate with the script's own update mode (to confirm flag in `scripts/contract-surface.mjs`) |
| `server/src/registries/env.ts`, `server/src/platform/env.ts` | Mod | server | registries / platform | onion, security (`platform/env.ts`) | block per capability (`registries/env.ts:2-3`); secrets `secret: true`; refusal pattern `aiUrlAllowed` / `isLoopbackUrl` (`platform/env.ts`) |
| `server/.env.example`, `infra/ops/node/server.env.example`, `server/scripts/db.mjs` | Mod | server/infra | config | security (`**/.env*`, `server/scripts/**`) | names only, no values for secrets; `db.mjs:79-80` writes test SMTP — add fallback/OIDC/auth test values |
| `server/src/auth/{options,cli.config,instance,forward,codeFlow,codeLimits,google,merge,events,subjectData}.ts` | New | server | adapter ring (driving + driven glue) | onion, security (`server/src/auth/**`) | Better Auth only here; no Payload import; secrets never logged; emails/codes never in logs (AC-48) |
| `server/src/domain/auth/{email,returnPath,sessionExpiry,guestPrune}.ts` | New | server | domain (pure) | onion | pure functions, no I/O, injected `now` |
| `server/src/platform/device.ts`, `server/src/platform/{fingerprint,edge,rateLimit}.ts` | New/Mod | server | platform | onion; security (`platform/edge.ts` via routes? — no row; onion only) | `ClientContext` never exposes the raw address (`edge.ts:26-35`); `ipDay` windows ≤24 h (`registries/middleware.ts:20-24`) |
| `server/src/endpoints/{auth,types,pipeline,deps}.ts` | New/Mod | server | driving adapter | onion, security, contract-conformance (`server/src/endpoints/**`) | one file per route group, alphabetical in `registries/routes.ts`; `finalize` cookie policy (`pipeline.ts:96-101`) |
| `server/src/registries/{routes,middleware,rateLimits,collections,subjectData,ops,spend}.ts` | Mod | server | registries | onion | sorted + `assertRegistry`; every literal `raise({source,code})` has an ops row in the same phase (`test/unit/ops-registry-scan.test.ts`) |
| `server/src/collections/authLinkRetries.ts` | New | server | Payload collection | migration-safety | `resettable: true`; thin collection |
| `server/src/migrations/{<ts>_spec10_auth.ts,.json,index.ts}`, `server/src/payload-types.ts` | New/Mod | server | migrations | migration-safety | generated by `migrate:create` + verbatim `npx auth@1.7.28 generate` SQL [П-4]; `node scripts/fix-migration-down.mjs <file>`; up/down/up on migcheck |
| `server/src/cli/authSchemaCheck.ts`, `server/scripts/verify-schema.mjs` | New/Mod | server | CLI | security (`server/src/cli/**`, `server/scripts/**`) | uses `getMigrations` from `better-auth/db/migration`; prints table/column names only |
| `server/src/mail/{ports,service}.ts`, `server/src/mail/templates/signInCode.ts`, `server/src/domain/mail/{classify,breaker,ceiling,day,planReminder}.ts`, `server/src/adapters/smtpMail.ts` | New | server | port / application / domain / driven adapter | onion | SMTP texts only classified, never logged with address (AC-48); passwords via env `secret: true` |
| `server/src/container.ts`, `server/src/endpoints/deps.ts` | Mod | server | composition root | security (`container.ts`) | replace `noSessionSubjects` at `container.ts:300`; `Deps.auth?`, `Deps.mail?` + getters (`endpoints/deps.ts:35-38` pattern) |
| `server/src/adapters/sessionSubjects.ts` | New | server | driven adapter | onion | implements `SubjectResolver` (`realtime/ports.ts:19`); ids satisfy `SUBJECT_ID` |
| `server/src/test-doors/{auth,registry}.ts`, test reset in `test-doors/registry.ts` | New/Mod | server | test doors | security (`server/src/test-doors/**`) | only with `T2F_ENV=test` + `T2F_TEST_DOORS=1`; header row count updated (`registry.ts:3`); strict zod bodies from contracts |
| `server/src/ops/{runner,mailPlan,spend}.ts`, `server/src/domain/ops/spend.ts` | Mod/New | server | ops jobs | onion | wall clock, lease per job (`ops/runner.ts:43`); `mailRow()` (`domain/ops/spend.ts:92`) replaced by the counter |
| `lib/api/http/auth.ts` | New | web | client adapter | frontend-ui-architecture, security, contract-conformance (`lib/api/http/**`) | recipe `frontend-seam.md` §6.0; not added to `HTTP_DOMAINS` (`lib/api/http/domains.ts:7`) |
| `lib/api/http/realtime/transport.ts` | Mod | web | client transport | frontend-ui-architecture, security, contract-conformance | token never stored/logged (`transport.ts:5`); additive method |
| `tests/contract/{auth.suite,auth.http.test}.ts`, `tests/unit/api/auth-contract.test.ts`, `tests/unit/api/auth-sim.test.ts` | New/Mod | web | tests | contract-conformance | rows moved from `auth-sim.test.ts:25-94` into the suite; sim-only internals stay |
| `tests/unit/api/realtime-transport.test.ts` | Mod | web | test | contract-conformance (`tests/unit/api/*-contract…` no) — gap | new rows only |
| `server/test/unit/*.test.ts`, `server/test/integration/auth-*.int.test.ts`, `mail-*.int.test.ts`, `server/test/e2e/auth-*.e2e.ts` | New | server | tests | gap (`server/test/**`) | serial integration; unique recipients |
| side notes `…/spec-10/docs-patch.md` | New | docs | docs | gap (`**/*.md`) | Ukrainian text for docs outside the repo |

**Coverage gaps:** `fakes/**`, `server/test/**`, `docs/plans/**`, `pnpm-lock.yaml`, `server/src/payload-types.ts`, the docs patch — named, not reviewed by a routed skill.

## Contract changes
- **Shared contracts / schemas:** yes → `packages/contracts/src/auth.ts` (`AUTH_REASONS = ['cancelled','email','expired','too-many','too-many-attempts','wait','wrong-code'] as const`, types `SessionEvent`, `AuthCodeIntent`) and `auth.schemas.ts` (`requestCodeBody {email ≤254, intent 'signin'|'signup'}`, `verifyCodeBody {email, otp: /^\d{6}$/}`, `googleBody {returnPath ≤512}`, `codeInfoSchema`, `signInOutcomeSchema`, `sessionSchema` (matching `lib/api/contracts/auth.ts` `Session`), `googleRedirectSchema {kind:'redirect', url}`, `sessionEventSchema`, door bodies), exported through `schemas.ts` / `index.ts`; all `.strict()`. Additive only; `scripts/contract-surface.baseline.json` gains entries. The client `lib/api/contracts/auth.ts` is NOT changed; the adapter (W43) validates responses with the shared schemas. Order: P2 lands before any server or web phase imports it.
- **Migration:** yes → one migration `<ts>_spec10_auth` [П-4]: Payload-generated DDL for `auth-link-retries`, plus the generated Better Auth SQL (`users`, `user_sessions`, `user_accounts`, `auth_verifications` with `device_id` columns and FKs `ON DELETE CASCADE` as generated). Commands: `pnpm --dir server migrate:create spec10_auth` (`server/package.json:21`), `npx auth@1.7.28 generate --config src/auth/cli.config.ts --output <scratch>/auth.sql` (in `server/`), `node scripts/fix-migration-down.mjs <file>`. Forward-only, compatible with the previous image (new tables only).
- **Seed / fixture data:** no — sign-in state is created per test through doors; no seed row needed (the site's `auth` stays `sim`).
- **Build-only failures:** yes → Better Auth (ESM, `better-call`, `jose` 6) inside the server's Next build: typecheck and vitest do not exercise Next's server bundling. P5 runs the **server build** once (HEAVY). Web: `lib/api/http/auth.ts` must not import `server/**` or `@time2fest/contracts/schemas` values beyond what other adapters import; the full `verify` run (web `next build` + `check-bundle.mjs`) covers it at integration.
- **Wire contract (contractChecks):** yes → new routes `/api/auth/*` (7 rows), new event `session` on `user:#<id>`, new reasons. Check: skill contract-conformance — `auth` suite on sim and http (W44); the docs patch carries the `frontend-seam.md` §3.6 / §3.11 rows (W45).
- **Layout fidelity (contractChecks):** no → no rendered change: `HTTP_DOMAINS` unchanged, the site keeps the `sim` auth adapter; skill `layout-fidelity` may be skipped (`sdd-routing.md` §4).

## Work items

### P1 — Dependencies, fakes, spike (Lane A, opus)

### W1 — Pin the new dependencies
- **Serves:** enables AC-6 … AC-50 (Better Auth), AC-36 … AC-44 (Nodemailer).
- **Do:** `server/package.json` dependencies: `"better-auth": "1.7.28"`, `"nodemailer": "10.6.1"`; devDependency `@types/nodemailer` (exact) only if `node_modules/nodemailer/package.json` has no `types`/`exports.types`. Run `pnpm install` once from the repo root. Nothing else is added in the wave.
- **Files:** `server/package.json`, `pnpm-lock.yaml`.
- **Done means:** `pnpm --dir server exec node -e "import('better-auth').then(m=>console.log(!!m.betterAuth))"` prints `true`; `npm ls` shows exactly 1.7.28 and 10.6.1.
- **Verify:** server files on `package.json` (tsc only meaningful).
- **Rules that apply:** security → pinned exact versions, no install scripts added.
- **Risk:** lockfile churn; jose 6 next to jose 5 (separate copies, research notes BA §0).

### W2 — Compose services and CI services for the fakes
- **Serves:** AC-53, AC-55, NFR-6.
- **Do:** `docker-compose.yml`: service `oidc` (`ghcr.io/navikt/mock-oauth2-server:7.0.2`, `127.0.0.1:8091:8080`, env `JSON_CONFIG='{"interactiveLogin":true}'`, health `GET /google/.well-known/openid-configuration`); `mailpit-chaos` (`axllent/mailpit:v1.33.1`, `127.0.0.1:1026:1025`, `127.0.0.1:8026:8025`, `MP_ENABLE_CHAOS=true`, 256 MB like `mailpit` at `:82-97`); `fake-smtp` (`node:22-alpine` (to confirm the node image tag used in `server/Dockerfile`), bind mount `./fakes/smtp:/app:ro`, `node /app/server.mjs --port 2525 --host 0.0.0.0`, `127.0.0.1:2525:2525`). `server/scripts/stack.mjs`: add the three to the `up` list (`:61`) and health checks next to `mailpit info` (`:212-214`): oidc discovery 200, `http://127.0.0.1:8026/api/v1/info` 200, TCP banner `220` on 2525. `.github/workflows/verify.yml` `services:` add `mailpit` (ports `1025:1025`, `8025:8025`), `mailpit-chaos` (`1026:1025`, `8026:8025`, `MP_ENABLE_CHAOS: 'true'`), `oidc` (`8091:8080`, same `JSON_CONFIG`).
- **Files:** `docker-compose.yml`, `server/scripts/stack.mjs`, `.github/workflows/verify.yml`, `fakes/oidc/README.md`.
- **Done means:** `node server/scripts/stack.mjs up` (skill local-stack) reports the three new health checks green; `docker compose -p t2f ps` shows them healthy.
- **Verify:** the stack health check above (manual run of the existing script).
- **Rules that apply:** security → loopback bindings only, pinned images.
- **Risk:** mock-oauth2-server 7.x is two weeks old (research BA §5) → if it fails, pin the last 6.x and note it in the run report.

### W3 — Fake SMTP server
- **Serves:** AC-37, AC-38, AC-53, AC-55.
- **Do:** `fakes/smtp/server.mjs` (zero-dependency `node:net`, ESM): exports `startFakeSmtp({port=0, host='127.0.0.1'}) → {port, close(), connections(), messages()}` and runs standalone with `--port/--host`. Minimal ESMTP (`EHLO/HELO`, `AUTH PLAIN|LOGIN` (user `bad` → `535 5.7.8`), `MAIL FROM`, `RCPT TO`, `DATA`, `RSET`, `QUIT`; no TLS). Behaviour by recipient local-part tag: `+q451@` → `451 4.7.1 Daily sending quota exceeded` after DATA; `+q550@` → `550 5.7.1 daily quota exceeded` after DATA; `+rate@` → `451 4.7.1 Too many requests` after DATA; `+rcpt550@` → `550 5.1.1 No such user` at `RCPT TO`; `+slow@` → no reply to DATA for 10 s; otherwise `250` and the message is kept in memory (recipient hashed in `connections()` log, never printed). `fakes/smtp/README.md` lists the tags. Unit test drives it with a Nodemailer transport.
- **Files:** `fakes/smtp/server.mjs`, `fakes/smtp/README.md`, `server/test/unit/fake-smtp.test.ts`.
- **Done means:** the unit test shows each tag yields the expected Nodemailer `err.code`/`responseCode`/`command` (`EMESSAGE` 451 / 550 after `DATA`, `EENVELOPE` 550 on `RCPT TO`, `ETIMEDOUT` for `+slow` with a 1 s socket timeout, `EAUTH` 535).
- **Verify:** server files on `test/unit/fake-smtp.test.ts`.
- **Rules that apply:** pattern `fakes/telegram/server.mjs` (port 0, 127.0.0.1).
- **Risk:** low.

### W4 — Fake OIDC test helper
- **Serves:** AC-17 … AC-22 (test means), AC-52.
- **Do:** `server/test/support/fakeOidc.ts`: `fakeGoogleLogin(authorizeUrl, form)` follows the mock's authorize URL, POSTs the login form (`username`, `claims` JSON — names confirmed by W5 S5) and returns the redirect `Location` to our callback; `fakeGoogleCancel(callbackBase, state)` builds `…/api/auth/callback/google?error=access_denied&state=<state>`; a tiny cookie jar for Node fetch (sets and sends cookies by name).
- **Files:** `server/test/support/fakeOidc.ts`.
- **Done means:** used green by W5 S2.
- **Verify:** server files on the file (tsc + eslint).
- **Rules that apply:** test support only.
- **Risk:** low.

### W5 — SPIKE: prove the open points on Better Auth 1.7.28 (stays as a real test)
- **Serves:** OQ-3 (spec:438), enables AC-14, AC-20, AC-21, AC-23, AC-25, AC-29, AC-32, AC-11, AC-4.
- **Do:** `server/test/integration/auth-spike.int.test.ts` — a minimal Better Auth instance inside the test (Kysely on a `pg.Pool` to the worktree test DB with `options: '-c search_path=auth_spike'`; `CREATE SCHEMA` + `getMigrations(opts).runMigrations()` in `beforeAll`, `DROP SCHEMA … CASCADE` in `afterAll`), plugins `anonymous`, `emailOTP` (`storeOTP:'hashed'`, OTP captured in memory), `genericOAuth` (`providerId:'google'`, discovery `http://127.0.0.1:8091/google/.well-known/openid-configuration`, `pkce:true`), `accountLinking {enabled:true, trustedProviders:[], allowDifferentEmails:false}`, `cookieCache` off; requests through `auth.handler(new Request(...))` with a cookie jar. One `it` per point, each asserting the observed behaviour (so a Better Auth upgrade that changes it turns the test red):
  - **S1 (OQ-3)** count `databaseHooks.session.delete.after` calls on `/sign-out`, `auth.api.revokeSessions`, `internalAdapter.deleteUser`.
  - **S2** anonymous → `/sign-in/social` (google) → mock login with `email_verified: true` → `/callback/google`: `onLinkAccount` called once, anonymous user deleted; with `email_verified: false` → what `emailVerified` is stored and whether implicit linking to an existing same-email user happens (decides `mapProfileToUser`).
  - **S3 (#11533)** sign in → revoke the session server-side → sign in again with the dead cookie still sent: is the final `set-cookie` a delete? Then the same with the workaround (drop the session cookie from the request when `getSession` returns null) → cookie survives.
  - **S4** `advanced.ipAddress.ipAddressHeaders:['x-t2f-ip']` with value `fp:<hex>` — does Better Auth accept it as the limiter key, or does it need a syntactically valid IP (then use `fd00::/8` + 120 bits of sha256 of the `ipDay` string)?
  - **S5** mock-oauth2-server 7.0.2 login form field names and the `claims` JSON shape that yields `email`, `email_verified`, `name`, `sub` in the id_token.
  - **S6** `get-session` / `sign-in/email-otp` JSON contains `token` (#12947).
  - **S7** where `attemptsLeft` can be read after a wrong OTP with `storeOTP:'hashed'` (verification row `value` = `<hash>:<attempts>`?).
  - **S8** `auth.api.signInAnonymous({ headers, returnHeaders: true })` returns a usable `set-cookie` for server-side guest creation; anonymous → `/sign-in/email-otp` also fires `onLinkAccount`.
  The header comment of the file records the outcome table `S1 … S8 → observed → branch taken`; the implementer copies the same table into its phase report (the conductor writes it to the run ledger).
- **Files:** `server/test/integration/auth-spike.int.test.ts`.
- **Done means:** the file is green on the local stack and its header lists S1 … S8 outcomes; later phases branch only on S1 (W29, W40), S2 (W33), S3 (W15), S4 (W15), S5 (W4, W26), S7 (W24), S8 (W28).
- **Verify:** one int file `auth-spike.int.test.ts`.
- **Rules that apply:** security → no real hosts; test secret literal with `check-secrets: allow` marker.
- **Risk:** if S2 shows genericOAuth cannot link anonymous → Google on 1.7.28, STOP and report to the conductor (the spec's [А3] would need a revision) — the only outcome that blocks later phases.

### P2 — Wire contracts (Lane B, sonnet)

### W6 — `auth` wire types and schemas
- **Serves:** AC-51, AC-6, AC-35.
- **Do:** as `Contract changes` → shared contracts. `sessionSchema` mirrors `lib/api/contracts/auth.ts` `Session` (`user|null {id, email, via:'google'|'email', signedInAt, name?}`, `guestId`, `hasPass`, `passOn`, `passSince`, `passNight?`, `devicePass`, `code`). Door body schemas: `authLastCodeDoor {to}`, `authExpireCodeDoor {email}`, `authGoogleUserDoor {sub, email, emailVerified, name?}`, `mailCounterDoor {provider:'primary'|'fallback', count:int≥0}`.
- **Files:** `packages/contracts/src/auth.ts`, `packages/contracts/src/auth.schemas.ts`, `packages/contracts/src/schemas.ts`, `packages/contracts/src/index.ts`, `scripts/contract-surface.baseline.json`.
- **Done means:** `node scripts/contract-surface.mjs --check` green with only additions in the baseline diff.
- **Verify:** contracts files on the four `src` files.
- **Rules that apply:** contract-conformance §1 (types `z.infer`), §4 (additive only).
- **Risk:** low.

### W7 — Contract tests
- **Serves:** AC-51.
- **Do:** `packages/contracts/test/auth.test.ts`: each body schema rejects extra fields and out-of-range values (`a@`, empty, 255 chars, `otp` `12345a`, `returnPath` 513 chars); `AUTH_REASONS` members; a sample `Session` with neutral pass fields parses.
- **Files:** `packages/contracts/test/auth.test.ts`.
- **Done means:** the test file is green.
- **Verify:** contracts files on `test/auth.test.ts`.
- **Rules that apply:** contract-conformance.
- **Risk:** low.

### P3 — Environment and test-class refusal (Lane A, opus)

### W8 — Env block `auth` and `mail`, loopback refusal in `test`
- **Serves:** AC-47, AC-55, NFR-6, enables everything.
- **Do:** `server/src/registries/env.ts` new block(s) sorted by key: `T2F_AUTH_SECRET` (min 32, `secret`, `requiredIn: ['rehearsal','production']`), `T2F_SEASON_END` (ISO datetime, default `2027-01-15T00:00:00Z`), `T2F_GOOGLE_CLIENT_ID`, `T2F_GOOGLE_CLIENT_SECRET` (`secret`), `T2F_GOOGLE_DISCOVERY_URL` (url, `isolated`, default unset → Google disabled), `SMTP_USER`, `SMTP_PASSWORD` (`secret`), `SMTP_FALLBACK_HOST` (`isolated`), `SMTP_FALLBACK_PORT`, `SMTP_FALLBACK_USER`, `SMTP_FALLBACK_PASSWORD` (`secret`), `T2F_MAIL_FROM` (default `Time2Fest <code@mail.time2fest.com>`), `T2F_MAIL_PLAN` (`free|pro`, default `free`), `T2F_MAIL_DAILY_CEILING` (int, default 100), `SMTP_FALLBACK_DAILY_CEILING` (int, default 100); existing `SMTP_HOST`/`SMTP_PORT` (`:167-168`) stay. `server/src/platform/env.ts`: in class `test`, `SMTP_HOST`, `SMTP_FALLBACK_HOST` and the host of `T2F_GOOGLE_DISCOVERY_URL` must be loopback (`isLoopbackUrl`/a host check like `aiUrlAllowed`) or `loadEnv` throws `"<NAME> must be a loopback host in the test class"` (value never printed). Outside `test`, `T2F_GOOGLE_DISCOVERY_URL` must be `https:`.
- **Files:** `server/src/registries/env.ts`, `server/src/platform/env.ts`.
- **Done means:** W9's unit test green.
- **Verify:** server files on both files + `test/unit/auth-env.test.ts`.
- **Rules that apply:** security → secret masking (`platform/logger.ts` `createLogger(secrets)`), production deny-list untouched.
- **Risk:** existing env tests enumerate blocks (to confirm `server/test/unit/*env*.test.ts`) — update their expectations in the same item.

### W9 — Examples, local env writer, unit test
- **Serves:** AC-47, NFR-6.
- **Do:** `server/.env.example` and `infra/ops/node/server.env.example`: the new names without values (secrets) / with defaults. `server/scripts/db.mjs` env writer (`:71-80`): `SMTP_FALLBACK_HOST=127.0.0.1`, `SMTP_FALLBACK_PORT=1026`, `T2F_GOOGLE_DISCOVERY_URL=http://127.0.0.1:8091/google/.well-known/openid-configuration`, `T2F_GOOGLE_CLIENT_ID=t2f-test`, `T2F_GOOGLE_CLIENT_SECRET=<literal> // check-secrets: allow test fake`, `T2F_AUTH_SECRET=<random 48 chars generated per env write>`. Unit test `server/test/unit/auth-env.test.ts`: `SMTP_HOST=smtp.resend.com` in `test` → throws naming `SMTP_HOST`; same for `SMTP_FALLBACK_HOST=smtp.mx.cloudflare.net` and a Google discovery URL; `SMTP_PASSWORD` value appears masked in a logger line. If `infra/ops/test/env-example.test.mjs` enumerates example names (to confirm), update it.
- **Files:** `server/.env.example`, `infra/ops/node/server.env.example`, `server/scripts/db.mjs`, `server/test/unit/auth-env.test.ts`, (`infra/ops/test/env-example.test.mjs`).
- **Done means:** unit test green; `node server/scripts/db.mjs env` writes the new lines for slot 20.
- **Verify:** server files on `test/unit/auth-env.test.ts`, `scripts/db.mjs`; ops files on the example test if touched.
- **Rules that apply:** security → names only in examples.
- **Risk:** low.

### P4 — Better Auth options, migration, schema check (Lane A, sonnet)

### W10 — Static Better Auth options
- **Serves:** AC-15, AC-16, AC-57, enables AC-6 … AC-35.
- **Do:** `server/src/auth/options.ts` `authStaticOptions(input)` returning the schema-relevant options: model names and snake_case fields [П-4], `session.additionalFields.deviceId`, `user.additionalFields.deviceId` (`input:false`), plugins `anonymous()`, `emailOTP({ otpLength:6, expiresIn:600, allowedAttempts:5, storeOTP:'hashed', disableSignUp:false, sendVerificationOTP: input.sendOtp })`, `genericOAuth({ config:[{ providerId:'google', discoveryUrl, clientId, clientSecret, scopes:['openid','email','profile'], pkce:true }] })`, `emailAndPassword` disabled, `telemetry:{enabled:false}`. Runtime callbacks are injected later (W15) — they do not change the schema. `server/src/auth/cli.config.ts` exports `auth = betterAuth({...authStaticOptions(dummy), database: new Pool(...)})` for the CLI only (never imported by runtime code).
- **Files:** `server/src/auth/options.ts`, `server/src/auth/cli.config.ts`.
- **Done means:** `npx auth@1.7.28 generate --config src/auth/cli.config.ts --output <scratchpad>/auth.sql` (in `server/`) prints SQL with the four tables and both `device_id` columns.
- **Verify:** server files on both files.
- **Rules that apply:** onion → adapter ring; security → no secret defaults outside test literals.
- **Risk:** CLI needs a reachable DB only for `migrate`, not for `generate` (to confirm; if it connects, run against the slot-20 test DB).

### W11 — Collection `auth-link-retries` and the migration
- **Serves:** AC-24, AC-57; [А1].
- **Do:** `server/src/collections/authLinkRetries.ts` (fields: `userId` text indexed, `fromSubject` text, `handler` text, `attempts` number, `nextAt` date, `lastErrorCode` text ≤64; access: none from REST; `resettable: true` in `registries/collections.ts`). `pnpm --dir server migrate:create spec10_auth`, then `node scripts/fix-migration-down.mjs <file>`, then append the W10 SQL verbatim inside `up` (`db.execute(sql.raw(...))` like existing migrations — to confirm the helper used in `20261124_060324_ops.ts`) and prepend `DROP TABLE IF EXISTS "user_sessions", "user_accounts", "auth_verifications", "users"` (in FK-safe order) to `down`. Register in `migrations/index.ts`; `pnpm --dir server generate:types`.
- **Files:** `server/src/collections/authLinkRetries.ts`, `server/src/registries/collections.ts`, `server/src/migrations/<ts>_spec10_auth.ts`, `server/src/migrations/<ts>_spec10_auth.json`, `server/src/migrations/index.ts`, `server/src/payload-types.ts`.
- **Done means:** migcheck up/down/up green; `migration-safety` checks 1–6 reported one line each (check 1 note: Better Auth SQL is generator output of `npx auth`, not hand-written).
- **Verify:** migcheck; server files on the collection and registry.
- **Rules that apply:** migration-safety (all 9 checks), skill `seed-and-fixtures` not applicable.
- **Risk:** regenerate if master gains a migration before merge (migration-safety check 5).

### W12 — Schema check covers Better Auth
- **Serves:** AC-57.
- **Do:** `server/src/cli/authSchemaCheck.ts`: builds `authStaticOptions` with a `pg.Pool` on `DATABASE_URI`, calls `getMigrations(options)` from `better-auth/db/migration`, exits 1 printing `missing table <t>` / `missing column <t>.<c>` when `toBeCreated`/`toBeAdded` are non-empty, else 0. `server/scripts/verify-schema.mjs` runs it (`npx tsx src/cli/authSchemaCheck.ts`) after its current checks. `server/test/integration/auth-schema.int.test.ts`: on the migrated test DB → exit 0; on the migcheck DB with `ALTER TABLE user_sessions DROP COLUMN device_id` → exit 1 and output contains `user_sessions.device_id`; restores the column.
- **Files:** `server/src/cli/authSchemaCheck.ts`, `server/scripts/verify-schema.mjs`, `server/test/integration/auth-schema.int.test.ts`.
- **Done means:** the int test green; `node scripts/verify-schema.mjs` green on the slot-20 DB.
- **Verify:** one int file `auth-schema.int.test.ts`; server files on the CLI.
- **Rules that apply:** security (`server/src/cli/**`) → prints names only.
- **Risk:** low.

### P5 — Mount, sessions, cookies (Lane A, opus — sign-in surface, cookies, IP handling)

### W13 — Pure auth rules
- **Serves:** AC-17, AC-18, AC-26, EC-8, EC-9.
- **Do:** `server/src/domain/auth/email.ts` `normalizeEmail` (trim, lowercase, ≤254, format) and `emailKey(email)` (sha256 hex); `returnPath.ts` `safeReturnPath(raw)` → path or `/` (absolute, `//`, `\`, control chars, `%2F`/`%5C`/`%2E%2E` encoded separators → `/`) and `withSignInMarks(path, {isNew})` → `?…&signin=google[&new=1]#hash` (same as sim `googleReturnUrl`, `lib/api/sim/auth.ts`); `sessionExpiry.ts` `sessionExpiresAt(now, seasonEnd)` = `now < seasonEnd ? min(now+60 d, seasonEnd) : now+60 d`.
- **Files:** `server/src/domain/auth/{email,returnPath,sessionExpiry}.ts`, `server/test/unit/auth-domain.test.ts`.
- **Done means:** unit test covers AC-17 example (`/countries/ua?x=1#a` → `/countries/ua?x=1&signin=google&new=1#a`), AC-18 examples (`https://evil.example/`, `//evil.example`, `/%2F%2Fevil` → `/`), AC-26 before/after season end, EC-8.
- **Verify:** server files on the four files.
- **Rules that apply:** onion → domain pure, no I/O.
- **Risk:** low.

### W14 — Device cookie in the pipeline
- **Serves:** AC-1, AC-2.
- **Do:** as [П-3]: `server/src/platform/device.ts` (`readDevice(req)`, `newDevice()`, `deviceCookie(id)`), `Ctx.device` in `server/src/endpoints/types.ts`, set in `createDispatcher` and appended in `finalize` (`server/src/endpoints/pipeline.ts`) for non-public routes when the request had no valid cookie.
- **Files:** `server/src/platform/device.ts`, `server/src/endpoints/types.ts`, `server/src/endpoints/pipeline.ts`.
- **Done means:** W16 asserts AC-1 attributes and "second request with the cookie gets none".
- **Verify:** server files on the three files (+ existing `test/unit/pipeline*.test.ts` stay green).
- **Rules that apply:** security → `Secure; HttpOnly; SameSite=Lax; Path=/`, no `Domain`.
- **Risk:** public routes must still emit no `Set-Cookie` (`pipeline.ts:96-101`) — keep the append inside the non-public branch.

### W15 — Better Auth instance, forwarder, route rows, wiring
- **Serves:** AC-3, AC-14, AC-25, AC-26 … AC-28, AC-32 … AC-35, NFR-2, NFR-5.
- **Do:** `server/src/auth/instance.ts` `createAuth(deps, env)`: `betterAuth({ ...authStaticOptions, database: new Pool({connectionString: DATABASE_URI, max:5}), basePath:'/api/auth', baseURL: <first T2F_ALLOWED_ORIGINS entry, or the loopback server URL in test>, secret: T2F_AUTH_SECRET, trustedOrigins: T2F_ALLOWED_ORIGINS, session:{ expiresIn: 60 d, updateAge: 1 d, cookieCache:{enabled:false} }, advanced:{ cookiePrefix:'t2f', useSecureCookies:true, defaultCookieAttributes:{sameSite:'lax', httpOnly:true, secure:true}, ipAddress:{ ipAddressHeaders:['x-t2f-ip'], ipv6Subnet:48 } }, rateLimit:{ enabled:true, customStorage over deps.redis }, databaseHooks:{ session:{ create:{ before: deviceId from request cookie, ipAddress:'' , userAgent slice(0,128), expiresAt = sessionExpiresAt(now, T2F_SEASON_END) }, update:{ before: re-clamp expiresAt } } } })`; Google provider present only when the three Google vars are set. `server/src/auth/forward.ts` per [П-2] (S3 workaround on `/sign-in/*` and `/callback/google`; S4 value form; S6 strip; `get-session` → `sessionSchema` shape with `hasPass:false, passOn:null, passSince:null, devicePass:null, code:null`, `user.via` from the account provider, `guestId` = anonymous user id or null). `server/src/endpoints/auth.ts` rows of [П-1]; `server/src/registries/routes.ts` (alphabetical); `Deps.auth?` + `authOf` getter in `server/src/endpoints/deps.ts`; `server/src/container.ts` builds it in `createDeps` (no timers).
- **Files:** `server/src/auth/{instance,forward}.ts`, `server/src/endpoints/{auth,deps}.ts`, `server/src/registries/routes.ts`, `server/src/container.ts`.
- **Done means:** W16 green; **server build** green.
- **Verify:** server files on the six files; server build (HEAVY, once).
- **Rules that apply:** security → origin check kept (never `disableOriginCheck`/`disableCSRFCheck`), cookie cache off ([А6]), no token in JSON ([А13]); onion → Better Auth only under `server/src/auth/**`.
- **Risk:** Better Auth inside the Next server bundle (build-only); `baseURL` in test is `http://127.0.0.1:4200` while cookies are `Secure` — Node fetch tests carry cookies manually; browser behaviour checked in W31/W35.

### W16 — Session integration tests
- **Serves:** AC-1, AC-3, AC-18, AC-26 … AC-28, AC-32 … AC-35, NFR-5.
- **Do:** `server/test/integration/auth-session.int.test.ts` (in-process `testDeps` with a captured `sendOtp` until P9): AC-1 cookie attributes; AC-3 `get-session` without cookie ×100 → `users` count unchanged; sign in via captured OTP → AC-26 cookie `__Secure-t2f.session_token` attributes and `expires_at` with a substitute wall clock before/after `T2F_SEASON_END`; AC-27 revoke → `get-session` `user:null`; AC-28 two sessions, sign-out A, B valid; AC-32 forged `X-Forwarded-For` does not change the Better Auth limiter key / our `ipDay`; AC-33 `Origin: https://evil.example` → 403; AC-34 `POST /api/auth/sign-up/email`, `/delete-user`, `/change-email` → 404; AC-35 body parses with `sessionSchema`; NFR-5 `user_sessions.ip_address` empty, `user_agent` ≤128 with a 300-char UA.
- **Files:** `server/test/integration/auth-session.int.test.ts`.
- **Done means:** the file is green.
- **Verify:** one int file `auth-session.int.test.ts`.
- **Rules that apply:** unique emails via `testEmail()` (W26 support file; until then a local `crypto.randomUUID()` address on `@t2f.test`).
- **Risk:** low.

### P6 — Mail domain and template (Lane B, sonnet)

### W17 — Mail ports and pure rules
- **Serves:** AC-36 … AC-39, AC-43, AC-44.
- **Do:** `server/src/mail/ports.ts`: `MailMessage {id, to, subject, text, html, headers, class:'code'|'other'}`, `MailTransport.send(msg) → {ok:true} | {ok:false, err:{code?, responseCode?, command?, response?}}`, `MailService.send(msg) → {ok:true, provider} | {ok:false, reason:'recipient'|'unavailable'}`. `server/src/domain/mail/classify.ts` per [П-7]; `breaker.ts` `brokenUntil(kind:'quota'|'other', now)` (00:00 UTC next / now+5 min); `ceiling.ts` `admit({class, primaryCount, primaryCeiling, fallbackCount, fallbackCeiling})` → `'primary'|'fallback'|'refuse'` (≥80 % primary refuses `other`; codes to 100 % primary, then fallback to its ceiling; both full → refuse) and `levelsCrossed(before, after, ceiling)` for 80 %; `day.ts` `utcDayKey(now)`, `msToUtcMidnight(now)`.
- **Files:** `server/src/mail/ports.ts`, `server/src/domain/mail/{classify,breaker,ceiling,day}.ts`.
- **Done means:** W18 green.
- **Verify:** server files on the five files.
- **Rules that apply:** onion → domain pure; classification never returns or stores the response text.
- **Risk:** low.

### W18 — Code mail template and unit tests
- **Serves:** AC-36, AC-38, AC-39, AC-44.
- **Do:** `server/src/mail/templates/signInCode.ts` `signInCodeMail({code, id, from}) → MailMessage`: Ukrainian subject and text+HTML, the code, «дійсний 10 хвилин», «якщо це не ви — проігноруйте», no `http`/`https` anywhere, headers `Auto-Submitted: auto-generated`, `Resend-Idempotency-Key: <id>`, `X-Entity-Ref-ID: <id>`, `Message-ID: <<id>@mail.time2fest.com>`. Unit tests `server/test/unit/mail-domain.test.ts` (classify table incl. `EENVELOPE`+550 `RCPT TO` → recipient, `EMESSAGE` 451 after DATA → fallback, 5xx `daily quota` → fallback quota kind, `EAUTH` → fallback; breaker windows; `admit` table of AC-44 with ceiling 10) and `server/test/unit/mail-template.test.ts`.
- **Files:** `server/src/mail/templates/signInCode.ts`, `server/test/unit/mail-domain.test.ts`, `server/test/unit/mail-template.test.ts`.
- **Done means:** both unit files green; template test asserts no `http` and the four headers.
- **Verify:** server files on the three files.
- **Rules that apply:** FR-MAIL-04 (no sign-in links).
- **Risk:** low.

### P7 — Mail transport and failover (Lane A, opus — "no lost code" orchestration, provider secrets, alarms)

### W19 — SMTP adapter
- **Serves:** AC-37, AC-48, NFR-3.
- **Do:** `server/src/adapters/smtpMail.ts` `createSmtpTransport({host, port, user?, password?})` per [П-7]; maps Nodemailer errors to `{code, responseCode, command, response}` (response kept only for classification, never logged); logs only `{event:'mail-send', provider, outcome, code, responseCode}`.
- **Files:** `server/src/adapters/smtpMail.ts`, `server/test/unit/smtp-mail.test.ts`.
- **Done means:** unit test (fake SMTP from W3 in-process): 30 messages queued in 1 s → ≤8 reach the server per second (NFR-3); `+slow` returns a timeout error in ≤4.5 s.
- **Verify:** server files on both files.
- **Rules that apply:** security → password from env only, masked.
- **Risk:** pool queueing hides the 4 s budget — the outer race is the guard.

### W20 — Mail service, counters, alarms, ops rows, wiring
- **Serves:** AC-36 … AC-44, AC-46, AC-48, NFR-1.
- **Do:** `server/src/mail/service.ts` `createMailService({primary, fallback, store: deps.redis, alarm: deps.alarm, clock, ceilings})`: `admit` → primary unless broken → on `fallback` classification mark broken (W17 windows), raise `page` `mail/provider-failover` once per broken period, send the SAME message via fallback once → success; `recipient` → `{ok:false, reason:'recipient'}` without fallback; both fail → `page` `mail/all-providers-down` (once per 5 min) and `unavailable`. After each success `incrWindow('mail:sent:<provider>:<day>')`; primary count reaching 70 → `page` `mail/daily-70` once a day; a provider crossing 80 % of its ceiling → `page` `mail/ceiling-80` with `details {provider}` once a day per provider. `server/src/registries/ops.ts`: `mail` domain (`:237-243`) loses `reserved`, `ownerWave: 'SPEC-10'`, alarm rows `daily-70`, `ceiling-80` (`detailKeys:['provider']`), `provider-failover`, `all-providers-down`, `plan-free` (meaning/action in Ukrainian like the other rows), metric `mail.sent` without `pendingNote`, split by provider (title note). `Deps.mail?` + `mailOf` getter; `container.ts` builds both transports from env (fallback optional: absent → failover = `unavailable`).
- **Files:** `server/src/mail/service.ts`, `server/src/registries/ops.ts`, `server/src/endpoints/deps.ts`, `server/src/container.ts`.
- **Done means:** W21 green and `test/unit/ops-registry-scan.test.ts` green.
- **Verify:** server files on the four files + `test/unit/ops-registry-scan.test.ts`.
- **Rules that apply:** alarm details allow-list (`domain/ops/alarmDetails.ts`): `provider` only, never an address; `raise` never throws.
- **Risk:** the `plan-free` row is added here without a raise yet — the registry scan must allow rows without a raise (to confirm; otherwise add the row in W37).

### W21 — Failover integration tests
- **Serves:** AC-36 … AC-44.
- **Do:** `server/test/support/mailpit.ts` (`waitForMessage(api, to, ≤5 s)` via `GET /api/v1/search?query=to:<addr>&limit=1`), `server/test/support/mailChaos.ts` ([П-10] lock + `PUT /api/v1/chaos` on 8026 + reset). `server/test/integration/mail-failover.int.test.ts` builds the service in-process with chosen transports: AC-36 primary Mailpit 1025 → message ≤5 s with the content/headers of W18; AC-37 (a) primary = `mailpit-chaos` with `Sender:451:100`, fallback = Mailpit 1025 → exactly one message with the same code in 1025; (b) primary = fake SMTP `+q451` / `+q550` → fallback once; AC-38 primary chaos `Recipient:550:100` → `recipient`, fallback not called (fake transport spy); AC-39 after failover the next send skips the primary (spy), substitute clock past 00:00 UTC → primary again; AC-40 both transports failing → `unavailable` + `page` `mail/all-providers-down` in the alarm store; AC-41 10 failovers in 5 min → one alarm; AC-42 counter seeded to 69 → one alarm at 70, none at 71; AC-43 ceiling 10 → alarm on the 8th with `provider`; AC-44 ceiling 10 table.
- **Files:** `server/test/support/{mailpit,mailChaos}.ts`, `server/test/integration/mail-failover.int.test.ts`.
- **Done means:** the file is green; chaos triggers are 0 after the run (`GET /api/v1/chaos`).
- **Verify:** one int file `mail-failover.int.test.ts`.
- **Rules that apply:** unique recipients; chaos only on 8026.
- **Risk:** cross-worktree chaos interference → the Redis lock.

### P8 — Test doors (Lane A, opus — test doors)

### W26 — Auth and mail doors
- **Serves:** AC-52, AC-56, AC-13.
- **Do:** `server/src/test-doors/auth.ts` rows (strict bodies from W6): `POST /api/_test/auth/last-code {to}` → Mailpit search by exact recipient (base URL `http://127.0.0.1:8025`, test class only) → `{code}` (regex `\b\d{6}\b` on `Text`) or 404; `POST /api/_test/auth/expire-code {email}` → sets `expires_at` of `sign-in-otp-<normalized>` in `auth_verifications` to the past; `POST /api/_test/auth/google-user {sub,email,emailVerified,name?}` → returns the mock login form fields (S5); `POST /api/_test/mail/counter {provider,count}` → sets today's counter key. Registry rows in `server/src/test-doors/registry.ts` (sorted, header count updated); `reset` door also deletes rows of `user_sessions`, `user_accounts`, `auth_verifications`, `users` and `auth:*`, `mail:*` keys of this slot's prefix. `server/test/support/testEmail.ts` `testEmail(tag?)` = `t2f-<slug>-<random8>[+tag]@t2f.test` (worktree slug from env `T2F_SLUG`).
- **Files:** `server/src/test-doors/auth.ts`, `server/src/test-doors/registry.ts`, `server/test/support/testEmail.ts`, `server/test/unit/test-email.test.ts`.
- **Done means:** W27 green.
- **Verify:** server files on the four files.
- **Rules that apply:** security → doors exist only with `T2F_ENV=test` + `T2F_TEST_DOORS=1` (`shouldLoadDoors`); the last-code door never returns anything for a recipient it did not match exactly.
- **Risk:** `@t2f.test` must pass the email format rule (W13) — confirm.

### W27 — Doors integration test and write probe
- **Serves:** AC-52, AC-56; enables AC-4, AC-5, AC-23.
- **Do:** add test-class route `POST /api/_test/auth/write-probe` (`subject: 'required'`, returns `{subject}`) to the same doors file (registered only in test). `server/test/integration/auth-doors.int.test.ts`: each door works in `test` and is 404 with doors off (pattern `doors.int.test.ts`); unit `test-email.test.ts` asserts slug + random suffix and uniqueness over 1000 calls.
- **Files:** `server/src/test-doors/auth.ts`, `server/test/integration/auth-doors.int.test.ts`.
- **Done means:** both files green (the write-probe row is exercised in P10).
- **Verify:** one int file `auth-doors.int.test.ts`; server files on the unit test.
- **Rules that apply:** as W26.
- **Risk:** low.

### P9 — Code engine and limits (Lane A, opus — sign-in)

### W22 — /48 key and keyed limits
- **Serves:** AC-8, AC-9, EC-6, EC-7.
- **Do:** `server/src/platform/fingerprint.ts` `network48Of(ip)` (IPv6 /48; IPv4 unchanged); `server/src/platform/edge.ts` `ClientContext.ip48Day()` (`fp48:<hex>` or the same `noaddr:<day>` bucket); `server/src/platform/rateLimit.ts` additive `checkKeyedLimit(row, key, stores)` / `peekKeyedLimit` for targets outside `subject|device|ipDay`; `server/src/registries/rateLimits.ts` rows `auth-code-email` (5 / 600 000), `auth-code-ip` (5 / 600 000, ipDay), `auth-code-ip48` (5 / 600 000), `auth-guest-create` ([П-6]), all `fail-closed`.
- **Files:** `server/src/platform/{fingerprint,edge,rateLimit}.ts`, `server/src/registries/rateLimits.ts`, `server/test/unit/auth-limits.test.ts`.
- **Done means:** unit test: two IPv6 addresses differing in /64 within one /48 share `ip48Day`; keyed limit returns `rate_limited` + `retryAfterMs` on the 6th.
- **Verify:** server files on the five files.
- **Rules that apply:** `ipDay` windows ≤24 h; keys hold hashes only.
- **Risk:** low.

### W23 — Code request flow
- **Serves:** AC-6, AC-8 … AC-10, AC-40 (not counted), NFR-4, NFR-7, EC-1.
- **Do:** `server/src/auth/codeLimits.ts` per [П-8] (gap via `setIfAbsent`; email/ip/ip48 peeks; day counter `auth:day:<emailKey>:<utcDay>` with `retryAfterMs = msToUtcMidnight`; commit after mail success; release on `unavailable`; store error → `unavailable`). `server/src/auth/codeFlow.ts`: `before` hook on `/email-otp/send-verification-otp` (validate `requestCodeBody`, normalize, limits) and the `sendOtp` callback for `type === 'sign-in'` → `signInCodeMail` → `mailOf(deps).send` (awaited); `recipient` → `validation/email`; `unavailable` → delete the verification row, release, throw → `unavailable`. Response rewrite → `CodeInfo` from the server's wall clock (`resendAt = sentAt + 30 s`, `expiresAt = sentAt + 10 min`, `attemptsLeft = 5`), identical for new and existing emails. Wire the hooks in `server/src/auth/instance.ts`.
- **Files:** `server/src/auth/{codeLimits,codeFlow,instance}.ts`.
- **Done means:** W25 rows for AC-6, AC-8 … AC-10, AC-40 (retry not `wait`), NFR-4, NFR-7 green.
- **Verify:** server files on the three files.
- **Rules that apply:** security → enumeration-safe same response; address never in keys/logs.
- **Risk:** Better Auth's own emailOTP limiter (3 / 60 s per IP) is stricter than ours for the same IP → override via `emailOTP({ rateLimit })` to `window 60, max 20` (safety net only, [А4]).

### W24 — Verify flow and error mapping
- **Serves:** AC-7, AC-11 … AC-15, AC-38, AC-48.
- **Do:** in `server/src/auth/forward.ts`: Better Auth `INVALID_OTP` → `validation/wrong-code` + `attemptsLeft` (read per S7 from the verification row; 0 when no row), `OTP_EXPIRED` → `conflict/expired`, `TOO_MANY_ATTEMPTS` → `rate_limited/too-many-attempts`, its limiter 429 → `rate_limited/too-many` + `retryAfterMs`; schema failure → `validation/email`. `sign-in/email-otp` success → `SignInOutcome {isNew, email}` (`isNew` from a per-request flag set in `databaseHooks.user.create.after`), no `token`. No log line carries the email or the OTP (log the `emailKey` prefix 8 chars at most).
- **Files:** `server/src/auth/forward.ts`, `server/src/auth/codeFlow.ts`.
- **Done means:** W25 rows for AC-7, AC-11 … AC-16 green.
- **Verify:** server files on both files.
- **Rules that apply:** contract-conformance → reasons exactly `AUTH_REASONS`.
- **Risk:** S7 may show `attemptsLeft` is not readable → compute it from our own failure counter `auth:fail:<emailKey>` reset on new code (decided in the phase by S7).

### W25 — Code integration tests
- **Serves:** AC-6 … AC-16, AC-40, NFR-4, NFR-7, EC-1, EC-6, EC-8.
- **Do:** `server/test/integration/auth-code.int.test.ts` over HTTP to the in-process dispatcher with real Mailpit and the `last-code` / `expire-code` doors: every Verify line of AC-6 … AC-16 (AC-9 three keys separately: email; ipDay via forged edge header with the test edge secret; /48 with two IPv6 /64s), AC-10 via substitute wall clock, AC-16 the six digits absent from `auth_verifications`, AC-40 both transports failing → `unavailable` and an immediate repeat is not `wait`, NFR-4 `deps.redis` replaced by a failing store → `unavailable`, NFR-7 11th → `too-many` and 10 messages in Mailpit, EC-1 two parallel requests → one `wait`.
- **Files:** `server/test/integration/auth-code.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file `auth-code.int.test.ts`.
- **Rules that apply:** unique recipients.
- **Risk:** low.

### P10 — Subject, guest, session events, merge (Lane A, opus — guest merge, sessions)

### W28 — Session subject resolver, `ctx.subject`, guest creation
- **Serves:** AC-3, AC-4, AC-30.
- **Do:** `server/src/adapters/sessionSubjects.ts` (`SubjectResolver` via `auth.api.getSession({headers})` → `{id, kind:'account'|'guest'}`); `container.ts:300` default becomes it (`noSessionSubjects` stays for tests that pass it). `RouteRow.subject?: 'required'` (`endpoints/types.ts`); middleware `25-subject` per [П-6] (S8 mechanism) in `server/src/registries/middleware.ts`; `30-rate-limit` passes `{subject, device, ipDay}`.
- **Files:** `server/src/adapters/sessionSubjects.ts`, `server/src/endpoints/types.ts`, `server/src/registries/middleware.ts`, `server/src/container.ts`.
- **Done means:** W31 `auth-guest.int` green.
- **Verify:** server files on the four files.
- **Rules that apply:** SPEC-06 `SUBJECT_ID` (`^[A-Za-z0-9_-]{1,64}$`) — uuid without braces passes.
- **Risk:** one `getSession` per request adds a DB read → NFR-2 checked in W39.

### W29 — Session events and invalidation
- **Serves:** AC-29.
- **Do:** `server/src/auth/events.ts` per [П-5], branch on S1; hooks registered in `instance.ts`. Publication failures logged (`event:'session-publish', result`), never thrown.
- **Files:** `server/src/auth/events.ts`, `server/src/auth/instance.ts`.
- **Done means:** W31 `auth-events.int` green.
- **Verify:** server files on both files.
- **Rules that apply:** never publish to multi-subject names (SPEC-06 handoff).
- **Risk:** S1 "does not fire" doubles the call sites — keep all in `events.ts`.

### W30 — Guest merge with an extension point
- **Serves:** AC-23, AC-24, EC-2.
- **Do:** `server/src/auth/merge.ts`: `onLinkAccount` guarded (same id or anonymous target → return); moves `deviceId` to the account; runs registered handlers `registries/authLinks.ts` (new, sorted, empty in production; a test handler injected through `testDeps`) each idempotent by `(fromSubject, toSubject, handler)`; any throw → insert `auth-link-retries` row + `log` alarm `auth/link-retry` (`details {handler}`), sign-in continues; then invalidates both subjects (W29). Ops row `auth` domain with `link-retry` (`log`) in `registries/ops.ts`. A retry worker is not required by the spec (only "записати задачу повтору") — no runner job in this wave.
- **Files:** `server/src/auth/merge.ts`, `server/src/registries/authLinks.ts`, `server/src/registries/ops.ts`, `server/src/auth/instance.ts`.
- **Done means:** W31 `auth-merge.int` green; registry scan unit green.
- **Verify:** server files on the four files + `test/unit/ops-registry-scan.test.ts`.
- **Rules that apply:** onion → handlers as a registry, not imports of other capabilities.
- **Risk:** Better Auth deletes the anonymous user only after `onLinkAccount` returns; a throw escaping our guard would leave a session and an error — keep the try/catch total.

### W31 — Integration and e2e tests of subject, events, merge, device
- **Serves:** AC-2 … AC-4, AC-23 … AC-25, AC-29, AC-30.
- **Do:** `server/test/integration/auth-guest.int.test.ts` (AC-3 100 public/get-session requests → no `users` rows; AC-4 write-probe creates one guest bound to the device, 61st from one ipDay → `rate_limited`; AC-30 realtime token door/`/api/realtime/token` carries the subject id; a `device`-keyed test limit row counts two devices separately); `auth-events.int.test.ts` (Centrifugo subscriber on `user:#<id>` gets `session` ≤3 s after sign-in and after sign-out); `auth-merge.int.test.ts` (guest with a test handler row → after code sign-in row on the account, guest gone, second call no change; throwing handler → session exists, retry row, `log-alarms` row `auth/link-retry`). `server/test/e2e/auth-device.e2e.ts` (Playwright `request` context against the served slot-20 server: AC-2 in A → out → in B, same `device_id` in both session rows via a test door read or the export of W40… use `GET /api/_test/auth/sessions?email=` only if added — otherwise compare the `t2f_device` cookie and `user_sessions.device_id` through a direct DB read in the test; AC-25 sign in, revoke from another context, sign in again → `get-session` has the user).
- **Files:** `server/test/integration/{auth-guest,auth-events,auth-merge}.int.test.ts`, `server/test/e2e/auth-device.e2e.ts`.
- **Done means:** all four green.
- **Verify:** one int file each (three runs); one e2e file `auth-device.e2e.ts`.
- **Rules that apply:** unique recipients; Centrifugo channel prefix of this slot.
- **Risk:** Chromium vs `Secure` cookies on `http://127.0.0.1` — the `request` context keeps cookies regardless of scheme in Playwright (to confirm in the phase; if not, use `http://localhost:4200`).

### P11 — Google (Lane A, opus — OAuth)

### W33 — Google sign-in, return path, linking rules
- **Serves:** AC-17 … AC-23.
- **Do:** `server/src/auth/google.ts`: `sign-in/social` before-hook — validate `googleBody`, `safeReturnPath`, pass `callbackURL` = `withSignInMarks(path,{isNew:false})`, `newUserCallbackURL` = `withSignInMarks(path,{isNew:true})`, `errorCallbackURL` = path; rewrite the JSON answer to `{kind:'redirect', url}`; the callback's error redirect maps `access_denied` → `?error=cancelled`, anything else → `?error=failed` (append to the return path, hash kept). Linking per [А12]: `accountLinking {enabled:true, trustedProviders:[], allowDifferentEmails:false, updateUserInfoOnLink:false}`; S2 branch: if `email_verified` is not mapped, `mapProfileToUser: p => ({ emailVerified: p.email_verified === true, name: p.name })`; an `email_verified=false` id_token whose email matches an existing user → refused before any row (`account.create.before` or callback before-hook returns `error=failed`) (AC-21). Discovery/token timeouts → `unavailable` on `sign-in/social` (AC-22). Register in `instance.ts`.
- **Files:** `server/src/auth/google.ts`, `server/src/auth/instance.ts`, `server/src/auth/forward.ts`.
- **Done means:** W34 and W35 green.
- **Verify:** server files on the three files.
- **Rules that apply:** security → PKCE on, id_token verified against the discovered JWKS/issuer (`requireIdTokenVerification` if the option exists on 1.7.28 — confirm in `node_modules/better-auth` types), never `disableOriginCheck`.
- **Risk:** Better Auth may reject `errorCallbackURL` with a query string → build it without the query and append in our redirect rewrite.

### W34 — Google integration tests
- **Serves:** AC-20 … AC-23.
- **Do:** `server/test/integration/auth-google.int.test.ts` (Node fetch + `fakeOidc.ts` + `google-user` door): AC-20 account by code, then Google with the same verified email → one `users` row, two `user_accounts`; AC-21 `email_verified=false` with existing email → no new rows, `error=failed`; AC-22 discovery URL on a closed loopback port (`testDeps` env) → `sign-in/social` `unavailable` (Spec follow-up 3); AC-23 guest → Google → guest data moved.
- **Files:** `server/test/integration/auth-google.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file `auth-google.int.test.ts`.
- **Rules that apply:** fake OIDC only.
- **Risk:** Better Auth discovery is cached at init → AC-22 builds its own instance.

### W35 — Google e2e
- **Serves:** AC-17 … AC-19.
- **Do:** `server/test/e2e/auth-google.e2e.ts` (Playwright browser against the slot-20 server and the `oidc` service): `/countries/ua?x=1#a` → final URL `…/countries/ua?x=1&signin=google&new=1#a` (the page itself may 404 on the server — assert the URL); `https://evil.example/`, `//evil.example`, `/%2F%2Fevil` → `/`; cancel (`fakeGoogleCancel`) → `?error=cancelled`.
- **Files:** `server/test/e2e/auth-google.e2e.ts`.
- **Done means:** green.
- **Verify:** one e2e file `auth-google.e2e.ts`.
- **Rules that apply:** `--workers=2`.
- **Risk:** see W31 cookie note.

### P12 — Mail ops: monitoring row and plan-free reminder (Lane A, sonnet)

### W36 — Reminder rule
- **Serves:** AC-45.
- **Do:** `server/src/domain/mail/planReminder.ts` `planReminderDue(now, plan)` → `{dueKey:'2026-12-30'}|null` (Kyiv date 30.12/31.12, time ≥09:00, `plan==='free'`) via `Intl.DateTimeFormat` like `domain/ops/schedule.ts`.
- **Files:** `server/src/domain/mail/planReminder.ts`, `server/test/unit/mail-plan.test.ts`.
- **Done means:** unit: 30.12 09:00 Kyiv → due; 08:59 → null; 29.12 → null; `pro` → null; 31.12 → due with its own key.
- **Verify:** server files on both files.
- **Rules that apply:** onion → pure.
- **Risk:** low.

### W37 — Runner job and monitoring row
- **Serves:** AC-45, AC-46.
- **Do:** `server/src/ops/mailPlan.ts` job: lease (new `OpsLeaseName` `'ops-mail'` in `server/src/ops/ports.ts`), `setIfAbsent('mail:alarm:plan-free:<dueKey>')` → `page` `mail/plan-free`; add `'mail-plan'` to `OPS_JOBS` (`ops/runner.ts:43`). `server/src/registries/spend.ts` `mail` row: `ownerWave 'SPEC-10'`, source note «лічильник листів за добу UTC»; `server/src/domain/ops/spend.ts` `mailRow()` → `{state:'counted', sentToday, ceiling}`; `server/src/ops/spend.ts:133-134` reads today's counters through `mailOf(deps)` (new read method `countsToday()` on the service).
- **Files:** `server/src/ops/{mailPlan,runner,ports,spend}.ts`, `server/src/domain/ops/spend.ts`, `server/src/registries/spend.ts`, `server/src/mail/service.ts`.
- **Done means:** W38 green; `test/unit/ops-registry-scan.test.ts` green.
- **Verify:** server files on the seven files.
- **Rules that apply:** wall clock; lease per job (SPEC-13b [П-5]).
- **Risk:** SPEC-13b overview/spend tests expecting `no-provider` must be updated in the same item (to confirm `server/test/**/ops-spend*`, `ops-overview*`).

### W38 — Reminder and monitoring integration tests
- **Serves:** AC-45, AC-46.
- **Do:** `server/test/integration/mail-plan.int.test.ts` through the existing `ops-tick` door with a substitute `now`: 30.12 09:00 Kyiv → one `page` `mail/plan-free`; second tick → none; `T2F_MAIL_PLAN=pro` → none; 29.12 → none. Extend `server/test/integration/ops-overview.int.test.ts` (or `ops-spend.int.test.ts`) so the `mail` row shows today's counter after one sent mail.
- **Files:** `server/test/integration/mail-plan.int.test.ts`, `server/test/integration/ops-overview.int.test.ts`.
- **Done means:** both green.
- **Verify:** one int file each.
- **Rules that apply:** —
- **Risk:** low.

### P13 — Subject data and guest cleanup (Lane A, opus — personal data deletion)

### W40 — `auth` subject-data handler
- **Serves:** AC-49, AC-50, EC-10.
- **Do:** `server/src/auth/subjectData.ts` `SubjectDataHandler {capability:'auth', export, erase, anonymise}`: export = email (not for anonymous placeholders), Google name, `user_accounts` provider ids only (no token columns), sessions (`created_at`, `expires_at`, `device_id`), distinct device ids; erase = `internalAdapter.deleteUser(id)` + delete `auth_verifications` with identifier `sign-in-otp-<email>` + `session` event `reason:'erased'` (branch S1) + invalidate; anonymise = erase (no partial anonymisation of auth data). `server/src/registries/subjectData.ts` rows `auth` (handler) and `auth-codes` (`declarative`, `retention '10 min'`), sorted.
- **Files:** `server/src/auth/subjectData.ts`, `server/src/registries/subjectData.ts`, `server/src/container.ts`.
- **Done means:** W42 green.
- **Verify:** server files on the three files.
- **Rules that apply:** FR-PLAT-13 interface (`platform/subjectData.ts`); never export tokens.
- **Risk:** the registry row needs the handler built from deps → follow how `runSubjectData` receives rows (to confirm whether rows are static or built in `container.ts`).

### W41 — Guest cleanup job
- **Serves:** AC-5.
- **Do:** `server/src/domain/auth/guestPrune.ts` `isStale(lastActiveAt, now)` (30 days); `server/src/ops/guestPrune.ts` job `auth-guest-prune` (hourly, lease `'ops-auth'`): anonymous users whose latest session `updated_at` (or user `created_at` without sessions) is older than 30 days → `runSubjectData('export', id, rows)`; if every handler except `auth` returns empty → `internalAdapter.deleteUser`; batch ≤500 per run. Add to `OPS_JOBS` and `OpsLeaseName`.
- **Files:** `server/src/domain/auth/guestPrune.ts`, `server/src/ops/{guestPrune,runner,ports}.ts`.
- **Done means:** W42 green.
- **Verify:** server files on the four files.
- **Rules that apply:** wall clock; deletion only through the internal adapter (one transaction).
- **Risk:** deleting a guest someone is using right now — 30 days of no session activity makes that impossible by definition.

### W42 — Subject-data and cleanup tests
- **Serves:** AC-5, AC-49, AC-50.
- **Do:** `server/test/integration/auth-subject-data.int.test.ts` (account by code + Google → export fields exactly, no `accessToken`/`idToken`/`refreshToken`; erase → no rows in the four tables, a second tab subscriber gets `session` `erased`); `server/test/integration/auth-guest-prune.int.test.ts` (substitute `now` +30 d through `ops-tick`: guest without data removed with sessions; guest with a row of a test subject-data handler kept); unit `server/test/unit/subject-data-registry.test.ts` (rows `auth`, `auth-codes` present, sorted).
- **Files:** the three test files.
- **Done means:** all green.
- **Verify:** one int file each; server files on the unit test.
- **Rules that apply:** —
- **Risk:** low.

### P14 — Client `auth` http adapter and behaviour suite (Lane B, sonnet)

### W43 — `lib/api/http/auth.ts`
- **Serves:** AC-54, AC-31 (adapter side).
- **Do:** `createHttpAuth({fetch, transport})` implementing `AuthService` (`lib/api/contracts/auth.ts`) by the recipe `frontend-seam.md` §6.0 (like `lib/api/http/site.ts`): `session()` → `GET /api/auth/get-session` parsed with `sessionSchema`, the held `CodeInfo` merged into `Session.code`; `requestCode(email,intent)` → `POST …/send-verification-otp {email, type:'sign-in'}` → `CodeInfo` (kept client-side); `verifyCode` → `POST …/sign-in/email-otp {email, otp}` → `SignInOutcome`, then `session()` and, if the subject changed, `transport.renewToken()`; `google({returnPath})` → `{kind:'redirect', url}`; `signOut` → `POST …/sign-out` then `renewToken()`; `subscribe` over `user:#<id>` `session` events → refetch; `devCode`/`devReset` absent. Errors pass through as `ApiError` (same reasons as sim, `authCodeError`). NOT added to `HTTP_DOMAINS` / `httpFactories`.
- **Files:** `lib/api/http/auth.ts`.
- **Done means:** W44 green.
- **Verify:** web files on `lib/api/http/auth.ts`.
- **Rules that apply:** frontend-ui-architecture (shared adapter radius), security (no token storage, cookies only), contract-conformance §1.
- **Risk:** low.

### W44 — `auth` suite on sim and http
- **Serves:** AC-54, AC-31 (node-level).
- **Do:** move the rows of `tests/unit/api/auth-sim.test.ts:25-94` (code: new/existing; errors wrong-code / too-many-attempts / expired; limits wait / unavailable; Google sign-in and cancel) into `tests/contract/auth.suite.ts` `describeDomain(name, makeService, ctx)` where `ctx` supplies `lastCode(email)`, `expireCode(email)`, `googleUser(user)` and `completeGoogle(url)`; sim ctx uses `devCode`/sim helpers in `tests/unit/api/auth-contract.test.ts`; http ctx in `tests/contract/auth.http.test.ts` uses the doors and `fakeOidc`-style form POST (copy of the logic — `server/test/support` is not importable from web; keep it local to the file). Sim-only rows (pass on device, hooks, peek) stay in `auth-sim.test.ts`. The http file also asserts AC-31 at node level: after `verifyCode`, a spy transport's `renewToken` was called once.
- **Files:** `tests/contract/auth.suite.ts`, `tests/contract/auth.http.test.ts`, `tests/unit/api/auth-contract.test.ts`, `tests/unit/api/auth-sim.test.ts`.
- **Done means:** `npx vitest run tests/unit/api --maxWorkers=2` green; auth http suite → `auth` row green on sim and http.
- **Verify:** web files on the four files; auth http suite.
- **Rules that apply:** contract-conformance §2 (one suite, two adapters).
- **Risk:** `contract-run.mjs` maps `auth-contract` and `auth-sim` to one domain (`:24-27`) — both must pass.

### P15 — Realtime token renewal (Lane B, opus — realtime tokens)

### W45a — Transport method `renewToken()`
- **Serves:** AC-31.
- **Do:** `lib/api/http/realtime/transport.ts`: additive method `renewToken()` that drops the cached connection token, fetches `GET /api/realtime/token` and, if the subject in it differs (or the connection is anonymous), reconnects with the new token (`setToken` + reconnect), re-subscribing current channels; idempotent while a renewal is running. `tests/unit/api/realtime-transport.test.ts` rows: anonymous connection → `renewToken()` → one token request, reconnect with token; renewal during renewal → one request; token never logged.
- **Files:** `lib/api/http/realtime/transport.ts`, `lib/api/http/realtime/types.ts` (if the interface lives there), `tests/unit/api/realtime-transport.test.ts`.
- **Done means:** the unit file green; existing transport rows unchanged.
- **Verify:** web files on the three files.
- **Rules that apply:** security → token stays inside the client (`transport.ts:5`); SPEC-06 backoff rules untouched.
- **Risk:** reconnect storms → reuse `reconnectDelay` bounds.

### P16 — Cross-cutting checks: logs, load, network guard (Lane A, sonnet)

### W39 — Logs without emails/codes, performance, fakes-only network
- **Serves:** AC-48, AC-55, NFR-1, NFR-2, NFR-6.
- **Do:** `server/test/integration/auth-logs.int.test.ts`: full run (request code, wrong code, sign-in, failover via fake SMTP, both providers down, Google with unverified email) with a capturing logger + `process.stdout.write` spy + reading `alarms`, `log-alarms`, `audit` rows written during the test → search the unique address, its local part and every issued code → 0 hits. `server/test/integration/mail-load.int.test.ts`: 200 code requests over 10 s (distinct addresses, ipDay spread through the test edge header) → p95 of request→Mailpit receipt ≤5 s (NFR-1). `server/test/integration/auth-perf.int.test.ts`: 500 `get-session` with a session → p95 ≤50 ms (NFR-2) using `test/integration/measure.ts`. `server/test/support/noMailNetwork.ts` in `server/vitest.integration.config.ts` `setupFiles` (pattern `noTelegramNetwork.ts`): any `net.connect`/`tls.connect` to ports 25/465/587/2465/2587 on a non-loopback host, or `fetch` to `accounts.google.com`/`oauth2.googleapis.com`/`*.resend.com`/`*.cloudflare.net` throws (AC-55, NFR-6).
- **Files:** `server/test/integration/{auth-logs,mail-load,auth-perf}.int.test.ts`, `server/test/support/noMailNetwork.ts`, `server/vitest.integration.config.ts`.
- **Done means:** the three files green with the guard active.
- **Verify:** one int file each.
- **Rules that apply:** NFR-6.
- **Risk:** NFR-1/NFR-2 timing on a loaded Windows machine → run when no other heavy process runs; numbers go into the report.

### P17 — Docs patch (Lane B, sonnet)

### W45 — Docs patch for documents outside the repo
- **Serves:** AC-58, AC-59 (owner task recorded).
- **Do:** side notes `C:/Users/ADMIN/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/side-session-notes/local_359ad0f2-bcef-4e10-835b-0930d88a93eb/spec-10/docs-patch.md` (Ukrainian): `docs/backend/secrets.md` section for the W8 variables (names, class, who fills); `docs/backend/alarms.md` rows `mail/*` and `auth/link-retry`; `docs/services/mail.md` (transports, fallback, counters, owner tasks: DNS SPF/DKIM/DMARC for Resend and `cf-bounce.mail.time2fest.com`, keys into `SMTP_PASSWORD` / `SMTP_FALLBACK_PASSWORD`, first live mail to Gmail/Outlook with «Show original» PASS (AC-59), capture real Resend SMTP refusal texts (EC-11), Pro by 30.12); `docs/services/google.md` (variables, redirect URI `https://time2fest.com/api/auth/callback/google`, production client = SPEC-22b); `docs/backend/frontend-seam.md` §3.6 / §3.11 rows (7 routes, `session` event, reasons); night-peak estimate of code mails (FR-MAIL-06, [Q5]) with the formula and assumptions; `docs/knowledge/gotchas.md` entries found during the wave (Better Auth #11533, #12947, chaos lock).
- **Files:** the side-notes file (outside the repo), (`docs/knowledge/gotchas.md` in repo, if entries exist).
- **Done means:** the orchestrator compares the patch with `registries/ops.ts`, `registries/env.ts` and the route rows (manual).
- **Verify:** manual (orchestrator).
- **Rules that apply:** skill `docs-sync` (Ukrainian).
- **Risk:** low.

(Item ids W45a and W45 are distinct; W32 is unused.)

## Execution

Single conductor; each dispatch is `sdd-engineering:implementer` with this plan's path, the phase id and `model` from the table; ~80 tool calls; out of budget → `PARTIAL` with the tree green after the last finished item. The conductor commits after each phase. Two lanes have disjoint files; Lane A phases are strictly sequential.

| Lane / phase | Executor | Model | Work items | Files (disjoint across a parallel pair) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — deps, fakes, spike | implementer | **opus** — spike on sign-in/OAuth/session hooks decides later branches; `package.json`, compose, workflow security-routed | W1–W5 | `server/package.json`, `pnpm-lock.yaml`, `docker-compose.yml`, `server/scripts/stack.mjs`, `.github/workflows/verify.yml`, `fakes/smtp/{server.mjs,README.md}`, `fakes/oidc/README.md`, `server/test/unit/fake-smtp.test.ts`, `server/test/support/fakeOidc.ts`, `server/test/integration/auth-spike.int.test.ts` | — | — | runs `pnpm install` alone; stack up |
| P2 — contracts (Lane B) | implementer | sonnet | W6, W7 | `packages/contracts/src/{auth,auth.schemas,schemas,index}.ts`, `packages/contracts/test/auth.test.ts`, `scripts/contract-surface.baseline.json` | P1 | P3 | unit only |
| P3 — env + refusal (Lane A) | implementer | **opus** — `platform/env.ts` test-class refusal and secret masking (security-routed) | W8, W9 | `server/src/registries/env.ts`, `server/src/platform/env.ts`, `server/.env.example`, `infra/ops/node/server.env.example`, `server/scripts/db.mjs`, `server/test/unit/auth-env.test.ts`, (`infra/ops/test/env-example.test.mjs`) | P1 | P2 | unit only |
| P4 — options, migration, schema check | implementer | sonnet | W10–W12 | `server/src/auth/{options,cli.config}.ts`, `server/src/collections/authLinkRetries.ts`, `server/src/registries/collections.ts`, `server/src/migrations/**`, `server/src/payload-types.ts`, `server/src/cli/authSchemaCheck.ts`, `server/scripts/verify-schema.mjs`, `server/test/integration/auth-schema.int.test.ts` | P2, P3 | — | generator runs alone; migcheck DB |
| P5 — mount, sessions, cookies | implementer | **opus** — sign-in surface, cookies, IP header handling, origin | W13–W16 | `server/src/domain/auth/{email,returnPath,sessionExpiry}.ts`, `server/src/platform/device.ts`, `server/src/endpoints/{types,pipeline,auth,deps}.ts`, `server/src/auth/{instance,forward}.ts`, `server/src/registries/routes.ts`, `server/src/container.ts`, `server/test/unit/auth-domain.test.ts`, `server/test/integration/auth-session.int.test.ts` | P4 | P6 | shared lock; server build HEAVY once |
| P6 — mail domain (Lane B) | implementer | sonnet | W17, W18 | `server/src/mail/ports.ts`, `server/src/domain/mail/{classify,breaker,ceiling,day}.ts`, `server/src/mail/templates/signInCode.ts`, `server/test/unit/{mail-domain,mail-template}.test.ts` | P1 | P5 | unit only |
| P7 — mail transport + failover | implementer | **opus** — no-lost-code failover, provider secrets, alarm semantics | W19–W21 | `server/src/adapters/smtpMail.ts`, `server/src/mail/service.ts`, `server/src/registries/ops.ts`, `server/src/endpoints/deps.ts`, `server/src/container.ts`, `server/test/unit/smtp-mail.test.ts`, `server/test/support/{mailpit,mailChaos}.ts`, `server/test/integration/mail-failover.int.test.ts` | P5, P6 | — | shared lock; chaos Redis lock |
| P8 — test doors | implementer | **opus** — test doors (security-routed) | W26, W27 | `server/src/test-doors/{auth,registry}.ts`, `server/test/support/testEmail.ts`, `server/test/unit/test-email.test.ts`, `server/test/integration/auth-doors.int.test.ts` | P7 | — | shared lock |
| P9 — code engine + limits | implementer | **opus** — sign-in code flow, enumeration safety, limits | W22–W25 | `server/src/platform/{fingerprint,edge,rateLimit}.ts`, `server/src/registries/rateLimits.ts`, `server/src/auth/{codeLimits,codeFlow,instance,forward}.ts`, `server/test/unit/auth-limits.test.ts`, `server/test/integration/auth-code.int.test.ts` | P8 | — | shared lock |
| P10 — subject, guest, events, merge | implementer | **opus** — guest merge, sessions, realtime invalidation | W28–W31 | `server/src/adapters/sessionSubjects.ts`, `server/src/endpoints/types.ts`, `server/src/registries/{middleware,authLinks,ops}.ts`, `server/src/container.ts`, `server/src/auth/{events,merge,instance}.ts`, `server/test/integration/{auth-guest,auth-events,auth-merge}.int.test.ts`, `server/test/e2e/auth-device.e2e.ts` | P9 | — | shared lock; e2e needs `serve` |
| P11 — Google | implementer | **opus** — OAuth, linking rules, open-redirect guard | W33–W35 | `server/src/auth/{google,instance,forward}.ts`, `server/test/integration/auth-google.int.test.ts`, `server/test/e2e/auth-google.e2e.ts` | P10 | — | shared lock; e2e needs `serve` + `oidc` |
| P12 — mail ops rows + reminder | implementer | sonnet | W36–W38 | `server/src/domain/mail/planReminder.ts`, `server/src/ops/{mailPlan,runner,ports,spend}.ts`, `server/src/domain/ops/spend.ts`, `server/src/registries/spend.ts`, `server/src/mail/service.ts`, `server/test/unit/mail-plan.test.ts`, `server/test/integration/{mail-plan,ops-overview}.int.test.ts` | P11 | P14 | shared lock |
| P14 — client adapter + suite (Lane B) | implementer | sonnet | W43, W44 | `lib/api/http/auth.ts`, `tests/contract/{auth.suite,auth.http.test}.ts`, `tests/unit/api/{auth-contract,auth-sim}.test.ts` | P11 | P12 | http suite needs `serve` (run after P12's int files finish — one heavy at a time) |
| P13 — subject data + guest cleanup | implementer | **opus** — personal-data export/erase and automatic deletion | W40–W42 | `server/src/auth/subjectData.ts`, `server/src/registries/subjectData.ts`, `server/src/container.ts`, `server/src/domain/auth/guestPrune.ts`, `server/src/ops/{guestPrune,runner,ports}.ts`, `server/test/integration/{auth-subject-data,auth-guest-prune}.int.test.ts`, `server/test/unit/subject-data-registry.test.ts` | P12 | P15 | shared lock |
| P15 — realtime renewal (Lane B) | implementer | **opus** — realtime connection tokens (client) | W45a | `lib/api/http/realtime/{transport,types}.ts`, `tests/unit/api/realtime-transport.test.ts` | P14 | P13 | unit only |
| P16 — logs, load, network guard | implementer | sonnet | W39 | `server/test/integration/{auth-logs,mail-load,auth-perf}.int.test.ts`, `server/test/support/noMailNetwork.ts`, `server/vitest.integration.config.ts` | P13, P15 | — | shared lock; timing runs with no other heavy process |
| P17 — docs patch (Lane B) | implementer | sonnet | W45 | side-notes `spec-10/docs-patch.md`, (`docs/knowledge/gotchas.md`) | P16 | — | text only |
| L — integration pass | conductor | — | — | none | P17 + rebase on master | — | full `verify.yml`-equivalent run once; then `security-reviewer`, architecture review |

Order: P1 → (P2 ∥ P3) → P4 → (P5 ∥ P6) → P7 → P8 → P9 → P10 → P11 → (P12 ∥ P14) → (P13 ∥ P15) → P16 → P17 → L. Files touched by several Lane-A phases (`container.ts`: P5, P7, P10, P13; `auth/instance.ts`: P5, P9, P10, P11; `auth/forward.ts`: P5, P9, P11; `endpoints/types.ts`: P5, P10; `endpoints/deps.ts`: P5, P7; `registries/ops.ts`: P7, P10; `ops/runner.ts` and `ops/ports.ts`: P12, P13; `mail/service.ts`: P7, P12) are sequential by construction; no file appears in both members of a parallel pair. 17 phases: 10 opus (P1, P3, P5, P7, P8, P9, P10, P11, P13, P15), 7 sonnet.

## Verification plan
| Command | Directory | Passing means |
|---|---|---|
| server files (per item) | `server/` | tsc, eslint, related unit tests green |
| contracts files + `node ../../scripts/contract-surface.mjs --check` | `packages/contracts/` | schemas compile, tests green, surface additive |
| web files (per item) | repo root | tsc, eslint, related unit tests green |
| one int file (per listed file) | `server/` | the file green under the shared lock |
| one e2e file (`auth-device`, `auth-google`) | `server/` | green with `--workers=2` |
| auth http suite (`node scripts/contract-run.mjs`) | repo root | `auth` row green on sim and http |
| migcheck + `node scripts/verify-schema.mjs` | `server/` | up/down/up clean; schema check incl. Better Auth green |
| server build (once, P5) | `server/` | `next build` succeeds |
| stack health (`node scripts/stack.mjs up`) | `server/` | oidc, mailpit-chaos, fake-smtp healthy |
| Full `verify` (config `full` per package = the `verify.yml` steps) | per config | once, in L only — not in any phase |

## Assumptions
- Variable names `T2F_AUTH_SECRET`, `T2F_GOOGLE_CLIENT_ID`, `T2F_GOOGLE_CLIENT_SECRET`, `T2F_GOOGLE_DISCOVERY_URL`, `SMTP_USER`, `SMTP_FALLBACK_HOST/PORT/USER/PASSWORD`, `T2F_MAIL_FROM` are planner choices (the spec names only `SMTP_*`, `SMTP_FALLBACK_*`, `T2F_MAIL_PLAN`, the ceilings and `T2F_SEASON_END`); `secrets.md` gets them via W45.
- Table names `users`, `user_sessions`, `user_accounts`, `auth_verifications` follow research notes BA §2; the retry queue is a Payload collection so its DDL is Payload-generated.
- The code mail is sent synchronously inside the request (not via an outbox) because AC-40 requires an `unavailable` answer when both providers fail; the reply time is identical for new and existing emails, so enumeration stays closed.
- Limits commit after the mail outcome ([П-8]) with an atomic 30 s gap; FastStore gets no new operation.
- `Ctx.device` is resolved in the pipeline rather than in a middleware so that `finalize` can set the cookie on every non-public response, including failures.
- `isNew` in `SignInOutcome` comes from a per-request flag set by `databaseHooks.user.create.after`.
- Guest creation is exposed both as the allowed path `sign-in/anonymous` (AC-34) and server-side for `subject: 'required'` rows; both share the `auth-guest-create` limit.

## Open questions
(none — spec OQ-3 is answered by the spike W5 S1 with both branches planned in W29/W40; a negative S2 is a stop-and-report, not an open question)

## Research used
- `…/side-session-notes/…/spec-10/research-code.md` — repo facts (dispatcher, registries, ports, doors, env, alarms, subject data).
- `…/spec-10/research-better-auth.md` — Better Auth 1.7.28 behaviour, linking, emailOTP, cookies, genericOAuth, #11533, #12947, spike list.
- `…/spec-10/research-mail.md` — Resend SMTP, Nodemailer 10.6.1 options and errors, Cloudflare Email Service SMTP, Mailpit chaos API.
- Planner reads: `server/scripts/lib/worktree.mjs:61-89` (slot), `server/src/endpoints/pipeline.ts:154-170, 242-281` (origin, exact-match dispatch), `server/src/registries/middleware.ts:20-60, 108-116`, `server/src/registries/env.ts:150-170`, `server/src/ports.ts` (`FastStore`), `.github/workflows/verify.yml:28-133`, `docker-compose.yml`, `tests/contract/site.http.test.ts`, `scripts/contract-run.mjs:1-60`, `lib/api/http/domains.ts`.

## Rollback / blast radius
- Revert the branch: the migration adds only new tables (`users`, `user_sessions`, `user_accounts`, `auth_verifications`, `auth_link_retries`); `down` drops them; SPEC-13a rollback swaps the image and never runs `down` — the old image ignores the tables.
- Production behaviour change limited to `/api/auth/*`, the `t2f_device` cookie on non-public responses, the subject resolver (was always `null`) and the mail monitoring row; the site's `auth` adapter stays `sim`, so no visitor sees sign-in until SPEC-11.
- Shared local resources: two new compose services and one port each; chaos is confined to `mailpit-chaos` under a lock.
