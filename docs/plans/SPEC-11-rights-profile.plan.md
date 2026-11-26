# Implementation plan: Rights and profile — pass on account and device (attach exactly once, valid to the end of its holiday), the device × session table, bans and the temporary daily-fingerprint block, guest → account merge, nick, flag, settings, «My schedule», email change, Google link/unlink, subject-data handlers (SPEC-11)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-11-rights-profile.md` (Status: approved; 0 `[NEEDS CLARIFICATION]` markers). AC-1 … AC-64 (`:85-291`), edge cases EC-1 … EC-13 (`:295-307`), NFR-1 … NFR-7 (`:311-330`), owner decisions В1–В8 (`:15-22`), defaults [Q1]–[Q5] (`:26-30`), session decisions [А1]–[А13] (`:36-48`), proposed contract (`:363`). Open questions (`:476-480`) block nothing: 1–2 are owner/visual-package items; 3 ("a next-holiday pass enables pass features at once") is settled by FR-ID-15 as written and proved in W11/W14 (AC-14).
This plan implements those requirements; it does not define or change them.
**Execution mode** — recommended (to be confirmed by the orchestrator for the owner): **single conductor, sequential phases, two lanes with disjoint files** — Lane A = server (one implementer at a time), Lane B = contracts, shared rules, web client. Optional parallel pairs: P2∥P3, P5∥P13, P10∥P12 (see `Execution`). Reason: `server/src/container.ts`, `server/src/auth/{instance,merge,forward}.ts`, `server/src/registries/{routes,middleware}.ts` are touched by several Lane-A phases, so Lane A serializes; the machine allows ≤2 heavy processes (`docs/backend/sdd-routing.md` §7).
**Out of scope** — the spec's Non-goals (`:58-65`): payment, webhooks, refunds, issuing the pass for the $10 toast (SPEC-17/18 — only the `grantPass`/`revokePass` interface here); `profile.exportData` / `profile.deleteAccount` on the client and code re-confirmation (SPEC-20; their suite rows are skipped «до SPEC-20»); ban checks in chat send, toasts, `chat.authorPath` (SPEC-14/15/16/17 through this wave's interfaces); the `chat` domain stays `sim`; reminder mails and schedule notifications (SPEC-19); drawing the new visible states and re-shooting boards (В7); zone/region pages (SPEC-24); the moderators' ban workflow (SPEC-15/16). (The retry job for `auth_link_retries` IS in scope — W29b, conductor decision 2.) Architecture review and `security-reviewer` are separate agents (`security-reviewer` mandatory: sessions, merge, OAuth link, bans, personal data, test doors).

Repository root for every path = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-11` (branch `spec-11-rights-profile`, base `master` `d68a216a` + spec commit `6bd566e8`).

- **Port slot: 22** — derived, do NOT set `T2F_SLOT` (`server/scripts/lib/worktree.mjs:66-77`: `spec-NN-*` → `2·NN`; ports `4000 + 10·22` → server 4220, web 4221, `:86-87`); databases `t2f_spec_11_rights_profile` / `…_test`, Redis DB 22. Shared compose services (Postgres 5433, Redis 6380, Mailpit 1025/8025, `oidc` 8091) are reused; this wave adds none.
- **Do not commit, never push** (the conductor commits after each phase). Never stage `tsconfig.json`. `server/src/payload-types.ts` and `server/src/migrations/**` are touched only in P4.
- **Never read** (`sdd-routing.md` §6): `research_data/**`, `docs/archive/**`, `Old Project/**`, `**/reference-boards/**`, `graphify-out/graph.json`, `out*/`, `.next*/`, `node_modules` (except `.d.ts`/`dist` lookups in `better-auth`), `pnpm-lock.yaml`, `.env*` other than `*.env.example`, `dashboard/secrets/**`, `docs/decision.md` whole.
- **No live mail, no live Google** (В8, NFR-6): only Mailpit and the fake OIDC `http://127.0.0.1:8091/google`; the existing `server/test/support/noMailNetwork.ts` guard stays in `setupFiles`.
- **Dependencies change only in P1** (Better Auth 1.7.27 → 1.7.28; nothing else is added — no new library in this wave). `pnpm install` runs only in P1.
- Machine: Vitest `--maxWorkers=2`; integration files serially under the shared lock; one heavy process at a time besides one implementer (server `serve` for http suites, migcheck).
- Paths marked **(to confirm)** were not opened by the planner; the implementer checks them with Grep / `graphify explain` before editing and keeps the plan's intent.
- Phase ids P1 … P15; work items W1 … W46 (+ W29b). Every phase brief: plan header, own `Execution` row, own items, the `Affected surface` rows of its files, the ACs its items cite (`sdd-routing.md` §5).

### Command shorthands used in `Verify` lines
- **server files** = config `server` → `files` (in `server/`): `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`.
- **contracts files** = config `contracts` → `files` (in `packages/contracts/`) plus `node ../../scripts/contract-surface.mjs --check`.
- **rules files** = config `rules` → `files` (in `packages/rules/`).
- **web files** = config `web` → `files` (repo root).
- **one int file** = in `server/`: `node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts --maxWorkers=1 test/integration/<file>` (stack up per skill `local-stack`, slot 22, DB migrated and seeded; never `pnpm` after `--` on Windows).
- **migcheck** = in `server/`: `node scripts/db.mjs migcheck up` → `pnpm migrate` → `pnpm migrate:down` → `pnpm migrate` → `node scripts/db.mjs migcheck drop`; then `node scripts/verify-schema.mjs`.
- **contract run** = repo root, worktree server served (`node server/scripts/stack.mjs serve`, slot 22): `node scripts/contract-run.mjs` (sim + http per domain; `auth` and `profile` rows must be green on both columns). Without the server: `node scripts/contract-run.mjs --sim-only`.

## Planner decisions

- **[П-1] Storage: raw SQL tables, not Payload collections.** New tables `passes`, `bans`, `profiles` and a unique index `user_accounts_provider_account_uq` live next to the Better Auth tables (precedent: SPEC-10 [П-4], `server/src/migrations/20261125_001708_spec10_auth.ts`) and are reached through Better Auth's own `pg.Pool` (precedent `server/src/auth/merge.ts:49-52`, `server/src/test-doors/auth.ts:85-90`). Reasons: (1) the invariants the spec puts on the database need a **partial** unique index (`passes (attached_user_id, season) WHERE attached_user_id IS NOT NULL AND revoked_at IS NULL AND erased_at IS NULL` — NFR-3, AC-10) and a unique **normalized nick key** (AC-29/AC-30), which Payload fields cannot declare; (2) subject ids are uuid text with no FK/cascade to `users` ([А7], AC-50/AC-53: a retry must work after the guest is gone); (3) pass and ban records are personal data and must not get a Payload REST/admin surface (the owner's ban slice reads them through owner-only `/cms-api/bans/*` endpoints, W38); (4) attach, merge and the sign-in finish step run on Better Auth's pool, the same connection pool as `users`. **One migration** `<ts>_spec11_rights` in P4 holds all DDL (no later phase changes the schema). It is created with `pnpm --dir server migrate:create spec11_rights` (blank: no collection changed — Payload asks to confirm a blank migration; pass its non-interactive accept flag, to confirm with `npx payload migrate:create --help`), then `node scripts/fix-migration-down.mjs <file>` (skill `migration-safety` check 1), then the DDL is written into `up`/`down` as `db.execute(sql.raw(...))` (pattern of the SPEC-10 migration). `migration-safety` check 1 is reported as "hand-written DDL, named in W8" — the same reviewed deviation SPEC-10 used for generator SQL.
- **[П-2] Module layout (onion).** Pure rules in `server/src/domain/rights/**` (no I/O, injected `now`); application services and their ports in `server/src/rights/**` (`ports.ts`, `passes.ts`, `bans.ts`, `banMarks.ts`, `profiles.ts`, `schedule.ts`, `emailChange.ts`, `links.ts`, `subjectData.ts`, `events.ts`); one adapter `server/src/auth/pool.ts` exposes the Better Auth pool as the `RightsDb` port (`query`, `tx(fn)` with `BEGIN/COMMIT/ROLLBACK` on one client) — Better Auth stays imported only under `server/src/auth/**`. Routes: `server/src/endpoints/me.ts` (profile + schedule), `server/src/endpoints/meAccount.ts` (email + Google), `server/src/endpoints/chatNick.ts`. Getters `rightsOf(deps)` in `server/src/endpoints/deps.ts` (pattern `moderationOf`, research-code §7) — services built lazily from `deps` (no new `Deps` field unless a test must inject; then `Deps.rights?`).
- **[П-3] Pass attach is one conditional UPDATE guarded by the partial unique index** (research-better-auth §2): `UPDATE passes SET attached_user_id=$acc, attached_at=$now WHERE id=$pass AND attached_user_id IS NULL AND revoked_at IS NULL AND erased_at IS NULL RETURNING id`. 1 row → attached; 0 rows → re-read (own → idempotent ok, other → not ours); SQLSTATE `23505` on `passes_one_active_per_account` → "account already has a pass" → the pass stays on the device. Path (a) (this device) runs before path (b) (the account's verified email = `payment_email`, earliest unattached first — EC-3); at most one pass is attached per sign-in (AC-7). Each path is its own short transaction; no advisory lock is needed (the index is the invariant for every write path, NFR-3).
- **[П-4] Where the sign-in finish step runs** ([А4], DR-3). Guest sign-in: Better Auth's `onLinkAccount` → `linkGuest` (SPEC-10) runs the `authLinks` rows **`bans`, `passes`, `profile`** (sorted by key); the `passes` row is the attach step (a)+(b) for the guest's device. Sign-in without a guest (after sign-out, `onLinkAccount` does not fire): the forwarder `server/src/auth/forward.ts`, after a successful `/sign-in/email-otp` or `/callback/google` response that set an account session, calls the same `attachOnSignIn({account, device, email})` unless `linkGuest` already ran in this request's auth scope (a flag in the scope, `server/src/auth/scope.ts`). A failure in the no-guest path writes an `auth_link_retries` row (handler `passes`, `from_subject = device:<id>`) and raises `log` `auth/link-retry` — identical to SPEC-10. Email change never triggers it (EC-4).
- **[П-5] Guest removal** ([А2], AC-49/AC-50). `anonymous({ disableDeleteAnonymousUser: true })` (research-better-auth §1). At the end of `linkGuest`: always `internalAdapter.deleteUserSessions(guestId)` (fires the existing `signed-out` event); then delete the guest (`internalAdapter.deleteUser`, transactional on 1.7.28) only when **this** call claimed and completed every handler (a skipped claim = another request owns the work → no delete), no `auth_link_retries` row has `from_subject = guestId`, and no active unattached pass is bound to the guest's device. Otherwise the guest stays for `auth-guest-prune`, whose keep rule becomes: open retry row, or active unattached pass on the guest's device, or data of any capability other than `auth`, `profile`, `bans` (W29). After a guest is pruned, its `profile` and `bans` rows are erased (nick released — AC-31). After every merge: `invalidateSubject` for guest and account (AC-53) and a `profile` event to the account.
- **[П-6] Pass holiday** ([А5]): pure `passSeason(issuedAtMs, {currentKey, currentEndMs})` → `currentKey` when `issuedAt < currentEnd`, else the next key (`2026-27` → `2027-28`); `seasonEndMs(key)` = `T2F_SEASON_END` for the current key, +1 calendar year per later key. `currentKey` = catalog season key (`CatalogStore.read().season.key`), `currentEndMs` = `AuthWiring.seasonEnd` (`server/src/auth/instance.ts:99-111`). "Now" for passes, bans and the schedule = the server's season clock `deps.clock` (moved by the `clock-set` door), never the client. A pass is active from issue to its season end (open question 3 → FR-ID-15).
- **[П-7] Pass view = pure FR-ID-14 function** `passView({accountPass, devicePass, signedIn})` → `{hasPass, passOn, passSince, passNight, devicePass}` in `server/src/domain/rights/passView.ts`; `toSession` (`server/src/auth/response.ts:110-124`) replaces `neutral` with it. One SQL read per `get-session` (account's active pass + the device's active unattached pass, both by index) — NFR-1.
- **[П-8] Bans and the daily-fingerprint block** ([А6], [Q3], NFR-5, NFR-7). Table `bans(kind account|guest|device, subject_id, source_ban_id → bans ON DELETE SET NULL, created_at, created_by, reason_code)`, unique `(kind, subject_id)`, no IP column (AC-26). Account ban → derived device bans for every `user_sessions.device_id` of the account and, through `databaseHooks.session.create.after` (`instance.ts`), for every later session's device (AC-20). Redis only (FastStore, TTL to the next 00:00 UTC of the fingerprint clock): `ban:fp:<subject>` = the subject's current `ipDay` (written by a middleware `27-ban-mark` on each request of a subject — `setIfAbsent`, cheap), `ban:ipday:<fp>` = ban instant (written at ban time from `ban:fp:<subject>` and, while the subject is banned, by `27-ban-mark` for each new fingerprint it uses — AC-23), `ban:guestfp:<guestId>` = creation fingerprint (written in `startGuestSession`). `isBlocked(subject, {device})`: DB bans (account/guest of the subject, device of `ctx.device`) first; then, for a guest only, `ban:ipday:<guestfp>` with ban instant ≤ guest `created_at` → `kind:'ip-day'`, `until` = next 00:00 UTC (AC-24/AC-25). Redis error → DB result only + `log` alarm `bans/fast-store-down` (ops row, W18) (NFR-7). Fingerprint TTLs use the same clock as `platform/fingerprint.ts` `daySalts` (to confirm which clock it takes) so the test clock moves both.
- **[П-9] Profile record** ([А7]): `profiles(subject_id text pk, nick text, nick_key text, flag_code text, settings jsonb, schedule text[], updated_at)`; `nick_key` = `nick.trim().toLocaleLowerCase('und')` computed in the domain (`server/src/domain/rights/nick.ts`), unique partial index `WHERE nick_key IS NOT NULL` → `23505` maps to `validation/taken` (AC-29/AC-30, race closed by the index). Schedule writes run in one transaction with `SELECT … FOR UPDATE` on the profile row (AC-40: a parallel `toggle` cannot make a fifth country). `pendingEmail` and `googleLinked` are read from `auth_verifications` / `user_accounts` at `GET` time, not stored.
- **[П-10] Schedule rule extraction** ([А8], AC-37): `packages/rules/src/schedule/countryZone.ts` holds the Dataset-free rule over `ScheduleCatalog { events: readonly {eventId, zoneId, countryIso}[]; zoneCountryIsos(zoneId): readonly string[] }`; `lib/schedule/countryZone.ts` keeps its exported names and delegates (adapter from `Dataset`); the server builds the catalog view from `CatalogStore` (events by `zoneId`+`countryIso`, zone countries from cities — the same definition as `lib/schedule/countryZone.ts:24-27`). One case table `packages/rules/test/schedule.table.ts` is run by the rules unit test and by a web unit test through the web wrapper; the server unit test runs it through the server wrapper.
- **[П-11] Email change is our own flow** ([А11]): identifier `t2f-change-email-<userId>` in `auth_verifications` via `internalAdapter.createVerificationValue`, value `<newEmail>:<sha256(code)>:<attemptsLeft>:<sentAt>`; limits = the SPEC-10 code limits keyed by the new address (`server/src/auth/codeLimits.ts`: 30 s gap → `rate_limited/wait`, 5/10 min, 10/day → `too-many`); mail through `MailService` with a new template `changeEmailCode`; verify = `consumeVerificationValue` + compare + `internalAdapter.updateUser(uid, {email, emailVerified:true})`, `23505` on `users.email` → `conflict/taken`; then delete `sign-in-otp-<oldEmail>`, publish a `profile` event (the profile re-reads `pendingEmail`) and a `session` event so other tabs re-read the new email (the client `auth` adapter re-reads on any `session` event, `lib/api/http/auth.ts` `subscribe`). The `session` event carries the dedicated reason `email-changed` (conductor decision 2026-11-26 on Spec follow-up 4; added to the contracts in W3).
- **[П-12] Google link/unlink** ([А12]): link = our route `POST /api/me/google {returnPath}` → `auth.api.linkSocial({headers, body:{provider:'google', callbackURL, errorCallbackURL, disableRedirect:true}})` → `{kind:'redirect', url}`; the existing `/api/auth/callback/google` row completes it; `server/src/auth/google.ts` sets `accountLinking.allowDifferentEmails: true` ([Q1]) and maps link errors (`account_already_linked_to_different_user`, and `unable_to_link_account` when a re-read shows the Google `sub` owned by another user — AC-47) to `returnPath?error=google-taken`. Unlink = our route with `internalAdapter.findAccounts` + `deleteAccount`; pure `signInMethods({isAnonymous, emailVerified, providers})`; refuse `conflict/last-method` only when Google is the sole method (research-better-auth §4: BA's `/unlink-account` is not forwarded).
- **[П-13] Events** ([А10]): `SESSION_EVENT_REASONS` += `pass-granted`, `pass-attached`, `pass-revoked`; new event `{type:'profile', id, data:{}}` on `user:#<id>` via the same publisher (`server/src/auth/events.ts` pattern; failures logged, never thrown). Pass events go to the holder: the account, or every subject with a session on the pass's device (`user_sessions.device_id`), and — for AC-12 — to the subjects of the device the pass left.
- **[П-14] Client bundle stays zod-free.** `packages/contracts/src/schemas.ts:1` forbids zod in the site bundle, but `lib/api/http/auth.ts:14` imports `sessionSchema` etc. from `@time2fest/contracts/schemas`; harmless while `auth` is not in `HTTP_DOMAINS`, a bundle regression once it is. P2 adds zod-free guards `packages/contracts/src/authGuard.ts` and `profileGuard.ts` (pattern `siteGuard.ts`, with a test proving they agree with the zod schemas) and P13 switches both http adapters to them before wiring `HTTP_DOMAINS`.
- **[П-15] Test doors and fixtures.** The seed registry is bound to Payload collections (`server/src/seed/registry.ts`), so the rights fixtures are named door presets: `POST /api/_test/rights/fixture {name}` with `pass-account`, `pass-device`, `pass-attached`, `ban-account`, `ban-guest`, `ban-device`, `ban-ip-day`, `merge-pair`; plus parametric doors `rights/pass-grant`, `rights/pass-revoke`, `rights/ban`, `rights/profile-seed`, `rights/link-fault` (next `authLinks` row of a key throws once). `reset` empties `passes`, `bans`, `profiles` (`clearRightsTables` next to `clearAuthTables`, `server/src/test-doors/registry.ts:98`); Redis keys go with the prefix wipe.

## Spec follow-ups
**Conductor decisions 2026-11-26 (binding for this plan):** (1) narrowing accepted — a guest whose only non-auth data is profile/nick/bans is prunable after 30 days, nick released (W29); (2) a retry job `auth-link-retry` is added to P9 (W29b) — success deletes the row (= closed), give up after 24 attempts with the existing `auth/link-retry` alarm; pass-attach failures are never lost; (3) door presets accepted; (4) dedicated `session` reason `email-changed` (W3, W31); (5) `grantPass` with `{device, paymentEmail}` → `pass-owned` when the device already has an active unattached pass for that holiday OR `passOwnedByEmail(paymentEmail)` (W13); (6) the admin slice both bans (account/guest/device by id) and unbans, owner-only, journaled (W37, W38); (7) node-level contract suites accepted. The items below are kept as the original findings.

1. **AC-31 vs SPEC-10 guest prune.** SPEC-10's prune keeps a guest when any capability other than `auth` holds data (`server/src/domain/auth/guestPrune.ts` `holdsOtherData`), so a guest with a nick would never be pruned and AC-31's "nick freed on guest prune" could not happen. The plan narrows the keep rule (П-5, W29) to retry rows, an unattached device pass, and capabilities other than `auth`/`profile`/`bans`. spec-creator may want to state this in the spec.
2. **AC-50 "повтор закрито".** There is no retry worker and no "closed" state on `auth_link_retries`; the plan treats "closed" as "row deleted" (test deletes it). Without a worker, a guest with an open retry is kept indefinitely — worth a backlog line.
3. **AC-62 "сид-фікстури"** are door presets, not seed-registry rows ([П-15]) — the seed registry only writes Payload collections.
4. **AC-44 "опублікувати `session`"** after an email change has no matching reason in [А10] (`signed-in|signed-out|erased|pass-*`). The plan publishes `session` with `signed-in` and a `profile` event ([П-11]); spec-creator should name the reason (e.g. `email-changed`) — adding one later is additive.
5. **AC-16 `pass-owned` for a device holder.** "власнику з активним пасом" is clear for `{account}`; for `{device, paymentEmail}` the plan refuses when the device already has an active unattached pass for that holiday, and leaves the email-level check to the caller via `passOwnedByEmail` (SPEC-17 checkout). If the spec means "refuse when the payment email already owns a pass", it should say so.
6. **US-3 "власник баню"** — AC-22 covers only unban in the admin slice; ban creation is the `ban()` interface (SPEC-15/16) and a test door. The slice gets list + unban only.
7. **AC-2/AC-60 e2e** run as node-level contract suites (`contract-run`), not browser e2e — same as SPEC-10 follow-up 1; the `layout-fidelity` board check for the switched domains is the conductor's step in L.

## Requirements traceability
| Req | Requirement (cited) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | `get-session` pass fields computed only by the server | spec:85 | W3, W11, W12 | W14 `rights-pass.int` |
| AC-2 | 8 FR-ID-14 rows on sim and http | spec:88 | W42 | W42/W44 contract run |
| AC-3 | guest-paid pass recorded on device, `passOn:'device'` | spec:91 | W11, W12 | W14 |
| AC-4 | device pass serves any session of the device without own pass | spec:94 | W11, W12 | W14, W42 (row 7) |
| AC-5 | path (a) attach on sign-in, row 4 | spec:97 | W13, W26, W27 | W28 `rights-signin.int` |
| AC-6 | path (b) by verified email on any device | spec:100 | W13, W27 | W28 |
| AC-7 | both possible → only the device pass | spec:103 | W13 | W28 |
| AC-8 | account with own pass → no attach, row 5 | spec:106 | W13 | W28 |
| AC-9 | sign-out after attach → device `hasPass:false`, row 6 | spec:109 | W12 | W28, W42 |
| AC-10 | concurrent attaches → exactly one; no 2 active passes | spec:112 | W8, W13 | W14 `rights-pass-race.int` |
| AC-11 | `passOwnedByEmail` three cases | spec:115 | W13 | W14 |
| AC-12 | attach by email elsewhere → `session` to device A ≤3 s | spec:118 | W13, W27 | W28 |
| AC-13 | before/during holiday → current `passNight` | spec:123 | W11 | W11 unit, W14 |
| AC-14 | after holiday end → next holiday | spec:126 | W11 | W11 unit, W14 |
| AC-15 | clock past end → `hasPass:false` | spec:129 | W11, W12 | W14 |
| AC-16 | `grantPass` idempotent by `grantRef`; `pass-owned` | spec:132 | W13 | W14 |
| AC-17 | grant/attach/revoke events ≤3 s | spec:135 | W4, W13 | W14 |
| AC-18 | `isBlocked` result shape | spec:140 | W15, W16 | W15 unit, W18 `rights-bans.int` |
| AC-19 | guest ban carried to the account on sign-in | spec:143 | W26 | W28 `rights-merge.int` |
| AC-20 | account ban spreads to current and later devices | spec:146 | W16, W17 | W18 |
| AC-21 | ban has no term | spec:149 | W15, W16 | W18 |
| AC-22 | owner unbans (and bans, decision 6) in admin slice, audited; non-owner 403 | spec:152 | W37, W38 | W38 `rights-bans-admin.int` |
| AC-23 | ban marks the subject's daily fingerprint(s) | spec:155 | W17 | W18 |
| AC-24 | ip-day blocks only guests created after the mark | spec:158 | W15, W17 | W18 |
| AC-25 | block ends when the fingerprint changes (00:00 UTC) | spec:161 | W17 | W18 |
| AC-26 | no IP/fingerprint in DB with ban/profile/pass | spec:164 | W8, W17 | W18 |
| AC-27 | nick verdict first; `block` → rule reason | spec:169 | W19, W20 | W22 `rights-profile.int` |
| AC-28 | `review` → `forbidden` | spec:172 | W20 | W22 |
| AC-29 | case/space-insensitive uniqueness → `taken` | spec:175 | W8, W19, W20 | W22 |
| AC-30 | concurrent same nick → one `taken` | spec:178 | W8, W20 | W22 |
| AC-31 | guest prune / account erase frees the nick | spec:181 | W29, W36 | W29 `auth-guest-prune.int`, W36 |
| AC-32 | nick text never logged | spec:184 | W20 | W22 |
| AC-33 | flag: catalog ISO or special codes | spec:187 | W19, W20 | W22 |
| AC-34 | `detectedFlag` from edge country; body ignored | spec:190 | W20 | W22 |
| AC-35 | `profile` event ≤3 s after any profile change | spec:193 | W4, W20, W24 | W22, W25 |
| AC-36 | settings keys, `reminderEmails` default true, unknown → `invalid-input` | spec:196 | W3, W19, W20 | W22 |
| AC-37 | one pure schedule rule for site and server | spec:201 | W6, W7, W23 | W6/W7/W23 unit (one table) |
| AC-38 | add → all events of that country in the zone | spec:204 | W23, W24 | W25 `rights-schedule.int` |
| AC-39 | full zone → `conflict/schedule-full` (toggle, PUT) | spec:207 | W23, W24 | W25 |
| AC-40 | replace atomic, keeps position; no 5 under race | spec:210 | W24 | W25 |
| AC-41 | no pass → `forbidden`; device pass → ok | spec:213 | W24 | W25 |
| AC-42 | unknown/hidden event id → `invalid-input` | spec:216 | W23, W24 | W25 |
| AC-43 | email change request: code, `pendingEmail`, refusals, limits | spec:221 | W30, W31 | W33 `rights-email.int` |
| AC-44 | verify: email changed, pass stays, `session` (`email-changed`); race → `taken` | spec:224 | W3, W31 | W33 |
| AC-45 | cancel → `pendingEmail:null`, old code `expired` | spec:227 | W31 | W33 |
| AC-46 | link Google incl. other email; other owner → `google-taken` | spec:230 | W32 | W33 `rights-google.int` |
| AC-47 | concurrent link of one Google id → one row | spec:233 | W8, W32 | W33 |
| AC-48 | unlink; sole method → `last-method` | spec:236 | W30, W32 | W33 |
| AC-49 | revoke guest sessions; delete only when all conditions hold | spec:241 | W26 | W28 |
| AC-50 | prune keeps guest with retry or device pass | spec:244 | W29, W29b | W29, W29b `auth-link-retry.int` |
| AC-51 | profile merge: account field wins; guest nick freed | spec:247 | W26 | W28 |
| AC-52 | schedule merge: account first, then guest countries | spec:250 | W23, W26 | W28 |
| AC-53 | second merge call changes nothing; invalidate both | spec:253 | W26 | W28 |
| AC-54 | export of `profile`, `passes`, `bans` | spec:258 | W36 | W36 `rights-subject-data.int` |
| AC-55 | erase account: profile gone, nick free; passes stripped | spec:261 | W36 | W36 |
| AC-56 | all rows run even when one fails | spec:264 | W36 | W36 |
| AC-57 | erase keeps derived device bans | spec:267 | W36 | W36 |
| AC-58 | `/api/me/*` + nick-check for own subject only, limits, `unauthorized` | spec:272 | W20, W21, W24, W31, W32 | W22, W33 |
| AC-59 | contracts additive; site wires fields only | spec:275 | W3, W4, W5, W40 | W3/W4 unit, `contract-surface --check` |
| AC-60 | `HTTP_DOMAINS` += auth, profile; suites green, SPEC-20 rows skipped | spec:278 | W39, W41, W43, W44 | W44 contract run |
| AC-61 | sim has the server's refusals | spec:281 | W40 | W43 profile suite on sim |
| AC-62 | doors + fixture presets; 404 outside test; reset clears | spec:284 | W34 | W35 `rights-doors.int` |
| AC-63 | Better Auth 1.7.28; `auth-*` green | spec:287 | W1, W2 | W2 |
| AC-64 | docs patch for root docs | spec:290 | W46 | manual (orchestrator) |
| EC-1 | cookie lost → path (b) remains | spec:295 | W13 | W28 (AC-6 case) |
| EC-2 | copied device cookie — accepted risk | spec:296 | — (non-goal) | — |
| EC-3 | two unattached passes same email → earliest attaches | spec:297 | W13 | W14 race file |
| EC-4 | email changed to a payment email → attach only at next sign-in | spec:298 | W31 | W33 |
| EC-5 | nick changed in another tab → `profile` | spec:299 | W20 | W22 |
| EC-6 | verdict providers down → fallback filter | spec:300 | W20 | W22 (moderation door `fallback`) |
| EC-7 | merge during an open replace → AC-52 rule + `profile` | spec:301 | W26 | W28 |
| EC-8 | ban while typing → SPEC-15 | spec:302 | — (non-goal) | — |
| EC-9 | erase with unattached pass → pass stays on payment email | spec:303 | W36 | W36 |
| EC-10 | shared NAT: old guests/accounts write, new guests blocked | spec:304 | W17 | W18 |
| EC-11 | ban at 23:59 UTC lasts a minute by ip-day | spec:305 | W17 | W18 |
| EC-12 | expired pass + next purchase → two records, next active | spec:306 | W11, W13 | W14 |
| EC-13 | SPEC-24 region = new city event, same country | spec:307 | W6 | W6 unit |
| NFR-1 | `get-session` with pass fields ≤50 ms p95 | spec:311 | W12 | W14 (extends `auth-perf.int`) |
| NFR-2 | `profile`/`session` event p95 ≤3 s | spec:314 | W4, W20 | W22 (20 changes) |
| NFR-3 | DB holds "one active pass per account per holiday" | spec:317 | W8 | W10 `rights-schema.int` |
| NFR-4 | bodies ≤4 KB → 413; schedule ≤512 ids | spec:320 | W3, W21, W24 | W22, W25 |
| NFR-5 | fingerprint keys only in Redis, TTL ≤ to 00:00 UTC | spec:323 | W17 | W18 |
| NFR-6 | no live mail/Google in tests | spec:326 | W33 | W33 (guard + fake OIDC log) |
| NFR-7 | Redis down → DB bans only, `bans/fast-store-down` | spec:329 | W16, W18 | W18 |

## Affected surface
| File | New/Mod | Package | Home (ring / radius) | Skills that will govern it | Constraint to respect |
|---|---|---|---|---|---|
| `server/package.json`, `pnpm-lock.yaml` | Mod | server | manifest | security (`**/package.json`); lockfile unrouted | exact pin `better-auth` `1.7.28` (now `1.7.27`, `server/package.json:50`); nothing else |
| `server/test/integration/auth-spike.int.test.ts` | Mod | server | test | gap | header outcome table updated for 1.7.28; assertions follow observed behaviour |
| `packages/contracts/src/{auth,auth.schemas,profile,profile.schemas,authGuard,profileGuard,schemas,index}.ts`, `packages/contracts/test/{auth,profile,guards}.test.ts` | Mod/New | contracts | contracts | onion, contract-conformance | additive only (contract-conformance §4); zod only in `*.schemas.ts` (`schemas.ts:1`); guards import-free (pattern `siteGuard.ts:1-15`) |
| `scripts/contract-surface.baseline.json` | Mod | web | script data | contract-conformance | additions only |
| `lib/api/contracts/{profile,auth}.ts`, `tests/unit/api/seam-vocabulary.test.ts` | Mod | web | client contract | contract-conformance | additive reason unions only (В7: no new visible state) |
| `packages/rules/src/schedule/{countryZone,index}.ts`, `packages/rules/package.json`, `packages/rules/test/{schedule.table,schedule}.test.ts` | New/Mod | rules | shared pure rules | gap for `packages/rules/**` (no routing row) — onion by analogy | pure, no data import; export path `./schedule` next to `./time`, `./text` |
| `lib/schedule/countryZone.ts`, `tests/unit/schedule/country-zone-rule.test.ts` | Mod/New | web | lib helper | gap (`lib/schedule/**` unrouted) | exported names and behaviour unchanged (`lib/schedule/countryZone.ts:13-70`) |
| `server/src/migrations/{<ts>_spec11_rights.ts,.json,index.ts}`, `server/src/payload-types.ts` | New/Mod | server | migrations | migration-safety | one migration [П-1]; `fix-migration-down.mjs`; up/down/up on migcheck; no destructive op on existing tables |
| `server/src/auth/pool.ts` | New | server | adapter | onion, security (`server/src/auth/**`) | the only place reading BA's pool for rights; replaces copies in `test-doors/auth.ts:85-90` |
| `server/src/domain/rights/{passSeason,passView,blocked,nick,flags,settings,schedule,signInMethods}.ts` | New | server | domain (pure) | onion | no I/O, injected `now`; flags list = [Q5] codes + catalog ISO |
| `server/src/rights/{ports,passes,bans,banMarks,profiles,schedule,emailChange,links,subjectData,events}.ts` | New | server | application + ports | onion | ports injected; SQL via `RightsDb`; never logs nick, email, code, fingerprint (AC-32, SPEC-10 AC-48) |
| `server/src/auth/{options,instance,merge,forward,response,events,google,link,scope}.ts` | Mod/New | server | adapter (BA glue) | onion, security | BA only here; `linkGuest` never throws (`merge.ts:95-117`); `stripTokens` stays |
| `server/src/adapters/sessionSubjects.ts` | Mod | server | driven adapter | onion | `startGuestSession` writes `ban:guestfp` (no address) |
| `server/src/endpoints/{me,meAccount,chatNick,types,deps}.ts` | New/Mod | server | driving adapter | onion, security, contract-conformance | strict zod bodies from contracts; `maxBodyBytes: 4096`; subject only from session |
| `server/src/registries/{routes,middleware,rateLimits,authLinks,subjectData,ops,adminSlots}.ts` | Mod | server | registries | onion | sorted + `assertRegistry`; every `raise` code has an ops row (gotchas.md:24) |
| `server/src/domain/auth/guestPrune.ts`, `server/src/ops/guestPrune.ts`, `server/src/auth/subjectData.ts` | Mod | server | domain / ops / adapter | onion | prune keep rule [П-5]; deletion via internal adapter inside `runInAuthScope` (gotchas.md:37) |
| `server/src/mail/templates/changeEmailCode.ts` | New | server | mail template | onion | pattern `signInCode.ts`; no links |
| `server/src/admin/{BansSlice,BansView}.tsx`, `server/src/admin/bansEndpoints.ts`, `server/src/admin/cmsEndpoints.ts` | New/Mod | server | Payload admin glue | gap for `server/src/admin/**/*.tsx` (sdd-routing §1 note); security not routed — owner-only checks per `cmsHttp.ts` | pattern `StreamsSlice`/`StreamsView`/`streamsEndpoints.ts`; audit via `resolveActor` (`admin/opsEndpoints.ts:18`) |
| `server/src/test-doors/{rights,registry,auth}.ts` | New/Mod | server | test doors | security (`server/src/test-doors/**`) | registered only with `T2F_ENV=test` + `T2F_TEST_DOORS=1`; header row count updated |
| `lib/api/http/{auth,profile,index,domains}.ts` | Mod/New | web | client adapters | frontend-ui-architecture, security, contract-conformance | recipe `frontend-seam.md` §6.0; zod-free [П-14]; `factories` typed by `HTTP_DOMAINS` (`index.ts:12`) |
| `lib/api/sim/profile.ts` | Mod | web | sim adapter | gap (`lib/api/sim/**` unrouted) — contract-conformance by suite | refusals equal to the server (AC-61) |
| `tests/contract/{auth.suite,auth.http.test,profile.suite,profile.http.test}.ts`, `tests/unit/api/{auth-contract,profile-contract}.test.ts` | Mod/New | web | tests | contract-conformance | one suite, two adapters; SPEC-20 rows `it.skip` with reason «до SPEC-20» |
| `server/test/unit/*.test.ts`, `server/test/integration/rights-*.int.test.ts`, `auth-merge.int.test.ts`, `auth-guest-prune.int.test.ts`, `auth-perf.int.test.ts` | New/Mod | server | tests | gap (`server/test/**`) | serial integration; unique test emails (`test/support/testEmail.ts`) |
| `docs/knowledge/gotchas.md`; side notes `…/spec-11/docs-patch.md` | Mod/New | docs | docs | gap (`**/*.md`) | Ukrainian; root docs changed only by the orchestrator |

**Coverage gaps:** `packages/rules/**`, `lib/schedule/**`, `lib/api/sim/**`, `server/test/**`, `server/src/admin/**/*.tsx`, `pnpm-lock.yaml`, `server/src/payload-types.ts`, `docs/**` — named, not governed by a routed skill.

## Contract changes
- **Shared contracts / schemas:** yes → `packages/contracts/src/auth.ts` (`SESSION_EVENT_REASONS` += `pass-granted`, `pass-attached`, `pass-revoked`, `email-changed`); `auth.schemas.ts` (`sessionEventSchema` enum follows); new `profile.ts` (`PROFILE_REASONS = ['google-taken','last-method','same-email','schedule-full','taken'] as const`, `PROFILE_SETTINGS_KEYS`, `SPECIAL_FLAG_CODES` [Q5], `ProfileEvent`), new `profile.schemas.ts` (`profileSettingsSchema` strict, `profileSchema` mirroring `lib/api/contracts/profile.ts:23-35`, `profilePatchBody {nick?≤64 chars, flagCode?, detectedFlag? (accepted, ignored), settings?: partial}`, `scheduleBody {eventIds ≤512}`, `scheduleToggleBody {eventId}`, `scheduleReplaceBody {outIso, eventId}`, `emailChangeBody {email ≤254}`, `emailVerifyBody {code /^\d{6}$/}`, `googleLinkBody {returnPath ≤512}`, `nickCheckBody {nick}`, `profileEventSchema`, door bodies), zod-free `authGuard.ts`/`profileGuard.ts`; exports through `schemas.ts`/`index.ts`. Client `lib/api/contracts/profile.ts` gains `ScheduleReason`, `UnlinkGoogleReason = 'last-method'`, `ChangeEmailReason` unions (additive); `Session` already has `passNight?` (`lib/api/contracts/auth.ts:55`). Order: P2 lands before any server or web phase imports it. Baseline gains entries only.
- **Migration:** yes → one migration `<ts>_spec11_rights` [П-1]: tables `passes`, `bans`, `profiles`; partial unique `passes_one_active_per_account`; partial indexes `passes_device_unattached`, `passes_email_unattached`; unique `passes_grant_ref_uq`; unique `profiles_nick_key_uq`; unique `bans_kind_subject_uq`; unique `user_accounts_provider_account_uq` on the existing Better Auth table (expand-only, compatible with the previous image — migration-safety check 9). Commands: `pnpm --dir server migrate:create spec11_rights` (`server/package.json`), `node scripts/fix-migration-down.mjs <file>`, migcheck.
- **Seed / fixture data:** yes → fixture presets as test doors [П-15] (`pass-account`, `pass-device`, `pass-attached`, `ban-*`, `merge-pair`); values equal the sim seeds used by the suites (pass email/since from `stores/auth.ts` demo values — to confirm). No production seed.
- **Build-only failures:** yes → (1) wiring `auth`/`profile` into `HTTP_DOMAINS` pulls the adapters into the integration build: zod must not enter the site bundle [П-14] — caught by `next build` + `scripts/check-bundle.mjs` in L; (2) `next.config.ts` reads `HTTP_DOMAINS` (research-code §3) — same build in L; (3) `server/src/admin/*.tsx` and `rights/**` enter the server Next build — server build once in P12 (`node scripts/lock.mjs --mode exclusive -- npx next build` in `server/`, stop `serve` first).
- **Wire contract:** yes → new routes (AC-58), event `profile`, new `session` reasons, reasons of AC-59. Check: skill contract-conformance — `auth` and `profile` suites on sim and http (W42–W44); the docs patch carries `frontend-seam.md` §3.6/§3.7/§3.11 rows (W46).
- **Layout fidelity:** yes → `auth` and `profile` switch to `http`; skill `layout-fidelity` on the boards of pages reading `useSession`/`useProfile` hooks (cabinet, pass, schedule, header) — conductor in L, with `--workers=2`.
- **Payload migration:** yes → skill `migration-safety`, all 9 checks in W9 (check 1 reported as the named DDL deviation).
- **Test doors:** yes → W34; the existing production-build test that walks the door registry proves 404 outside `test` (to confirm its file in `server/test/`).
- **Agent write surface:** no → no agent role or key changes.
- **Seed and fixtures:** yes → see above; skill `seed-and-fixtures` (fixtures equal sim values; no `research_data`).

## Work items

### P1 — Better Auth 1.7.28 (Lane A, opus)

### W1 — Re-pin Better Auth
- **Serves:** AC-63; enables AC-49 (transactional `deleteUser`), AC-43 (concurrent OTP fix).
- **Do:** `server/package.json` `"better-auth": "1.7.28"`; `pnpm install` once from the repo root. Replace every `npx auth@1.7.27` mention in code comments/scripts if any (grep). No other dependency changes in the wave.
- **Files:** `server/package.json`, `pnpm-lock.yaml`.
- **Done means:** `pnpm --dir server ls better-auth` prints exactly `1.7.28`; `node scripts/verify-schema.mjs` (in `server/`) green (BA expects no new column).
- **Verify:** server files on `package.json`; `node scripts/verify-schema.mjs`.
- **Rules that apply:** security → exact pin.
- **Risk:** lockfile churn — lockfile changes only in this phase.

### W2 — Re-run the spike and the auth suites on 1.7.28
- **Serves:** AC-63.
- **Do:** run `auth-spike.int.test.ts`, then `auth-session`, `auth-code`, `auth-guest`, `auth-events`, `auth-merge`, `auth-google`, `auth-guest-prune`, `auth-subject-data`, `auth-doors`, `auth-schema` int files one by one. Where the spike's observed behaviour changed (expected: `deleteUser` one transaction, `delete.before` veto keeps sessions/accounts and throws `FAILED_TO_DELETE_USER`; session `delete.after` count after a transactional delete), update the assertion and add rows **S9** (`deleteUser` atomic + veto) and **S10** (`disableDeleteAnonymousUser: true` leaves the guest's session row; `onLinkAccount` still fires on `/sign-in/email-otp` and `/callback/google`) to the header table. Do not change product code here.
- **Files:** `server/test/integration/auth-spike.int.test.ts`.
- **Done means:** all eleven int files green on 1.7.28; header lists S1…S10 with observed outcome; if S1 (session delete events) changed, the report says which SPEC-10 code depends on it.
- **Verify:** one int file per listed file.
- **Rules that apply:** NFR-6 guard active.
- **Risk:** if S10 shows `onLinkAccount` no longer fires with deletion disabled → STOP and report (blocks [П-4]/[П-5]).

### P2 — Contracts and client vocabulary (Lane B, sonnet)

### W3 — Wire types, schemas, reasons
- **Serves:** AC-59, AC-36, AC-1, NFR-4.
- **Do:** as `Contract changes` → shared contracts. `profileSettingsSchema`: `hour12` bool, `homeCountry` `/^[A-Z]{2}$/`|null, `homeZoneId` string ≤32|null, `showPassport`, `showPath`, `passportHints`, `quietDefault`, `reminderEmails` bools; strict. `profilePatchBody.settings` = the same strict object `.partial()`. `sessionEventSchema` reason enum = new `SESSION_EVENT_REASONS` (incl. `email-changed`). Door bodies: `rightsPassGrantDoor {holder: {account} | {device, paymentEmail}, source, grantRef, issuedAt?}`, `rightsPassRevokeDoor {grantRef}`, `rightsBanDoor {kind:'account'|'guest'|'device'|'ip-day', subject}`, `rightsProfileSeedDoor {subject, nick?, flagCode?, schedule?, settings?}`, `rightsFixtureDoor {name}`, `rightsLinkFaultDoor {handler}`.
- **Files:** `packages/contracts/src/{auth,auth.schemas,profile,profile.schemas,schemas,index}.ts`, `packages/contracts/test/{auth,profile}.test.ts`, `scripts/contract-surface.baseline.json`.
- **Done means:** `contract-surface --check` green with only additions; tests pin `PROFILE_REASONS`, the new session reasons, and reject extra keys, 513 ids, 6-letter flag, `code` `12345a`, 4.1 KB nick.
- **Verify:** contracts files on the listed files.
- **Rules that apply:** contract-conformance §1, §4.
- **Risk:** low.

### W4 — Client contract unions
- **Serves:** AC-59, AC-17, AC-35 (client side of events).
- **Do:** `lib/api/contracts/profile.ts`: `ScheduleReason = 'schedule-full'`, `ChangeEmailReason = 'email'|'same-email'|'taken'`, `UnlinkGoogleReason = 'last-method'`; comment on `subscribe` names event `profile`. `lib/api/contracts/auth.ts`: comment lists the new `session` reasons (type unchanged — the client re-reads on any). `tests/unit/api/seam-vocabulary.test.ts`: rows for the new reasons.
- **Files:** `lib/api/contracts/profile.ts`, `lib/api/contracts/auth.ts`, `tests/unit/api/seam-vocabulary.test.ts`.
- **Done means:** web files green; no component file changed (В7).
- **Verify:** web files on the three files.
- **Rules that apply:** contract-conformance §4 (additive).
- **Risk:** low.

### W5 — Zod-free guards
- **Serves:** AC-59, AC-60 (enables the domain switch without zod in the bundle) [П-14].
- **Do:** `packages/contracts/src/authGuard.ts` (`parseSession`, `parseCodeInfo`, `parseSignInOutcome`, `parseGoogleRedirect`, `isSessionEvent`) and `profileGuard.ts` (`parseProfile`, `parseScheduleIds`, `isProfileEvent`) — import-free, structural return types, same rules as the zod schemas; export from `index.ts`. `packages/contracts/test/guards.test.ts`: a table of valid/invalid samples gives the same verdict through guard and schema.
- **Files:** `packages/contracts/src/{authGuard,profileGuard,index}.ts`, `packages/contracts/test/guards.test.ts`.
- **Done means:** guards test green; `contract-surface --check` green.
- **Verify:** contracts files.
- **Rules that apply:** pattern `siteGuard.ts:1-15`.
- **Risk:** low.

### P3 — Shared schedule rule (Lane B, sonnet)

### W6 — Pure rule in `packages/rules`
- **Serves:** AC-37, EC-13.
- **Do:** `packages/rules/src/schedule/countryZone.ts` [П-10]: `ZONE_SLOT_LIMIT`, `countryZoneEvents(eventId, cat)`, `zoneSlotCount(zoneId, cat)`, `scheduledCountries(schedule, zoneId, cat)`, `scheduleToggleResult`, `toggleCountryZone`, `replaceCountryZone`, plus `mergeSchedules(accountIds, guestIds, cat)` (account events first, then guest countries per zone while slots remain — AC-52) and `validateScheduleIds(ids, cat)` (unknown/hidden → false). `index.ts` re-exports; `package.json` export `"./schedule"`. `packages/rules/test/schedule.table.ts` (cases incl. "two city events of one country in a zone count once", region-as-city, zone with 2 countries → 2 slots, full zone, replace keeps index, merge 3+2 → 4 with 3 from account); `schedule.test.ts` runs it.
- **Files:** `packages/rules/src/schedule/{countryZone,index}.ts`, `packages/rules/package.json`, `packages/rules/test/{schedule.table,schedule.test}.ts`.
- **Done means:** rules test green.
- **Verify:** rules files.
- **Rules that apply:** pure, no `lib/data` import.
- **Risk:** low.

### W7 — Site wrapper delegates
- **Serves:** AC-37.
- **Do:** `lib/schedule/countryZone.ts` keeps its exported signatures (`data: Dataset = getData()` defaults) and builds a `ScheduleCatalog` from `Dataset` (events → `{eventId:id, zoneId, countryIso}`, zone countries from `cities`), calling the rules. `tests/unit/schedule/country-zone-rule.test.ts` runs `schedule.table.ts` through the wrapper with a tiny Dataset.
- **Files:** `lib/schedule/countryZone.ts`, `tests/unit/schedule/country-zone-rule.test.ts`.
- **Done means:** new test and existing schedule tests (`npx vitest related lib/schedule/countryZone.ts`) green.
- **Verify:** web files on both files.
- **Rules that apply:** behaviour unchanged for the site.
- **Risk:** memoize the catalog per Dataset (WeakMap) to keep render cost.

### P4 — Tables and the migration (Lane A, sonnet)

### W8 — DDL
- **Serves:** NFR-3, AC-10, AC-26, AC-29, AC-30, AC-47; enables P5–P12.
- **Do:** the migration of [П-1]. `passes(id uuid pk default gen_random_uuid(), season text not null check (season ~ '^\d{4}-\d{2}$'), source text not null check (source in ('purchase','gift','admin')), grant_ref text not null, payment_email text, device_id text, attached_user_id uuid, issued_at timestamptz not null, attached_at timestamptz, revoked_at timestamptz, erased_at timestamptz)` + `passes_grant_ref_uq` unique(grant_ref) + `passes_one_active_per_account` unique(attached_user_id, season) where attached_user_id is not null and revoked_at is null and erased_at is null + `passes_device_unattached` (device_id) where attached_user_id is null and revoked_at is null and erased_at is null + `passes_email_unattached` (payment_email, issued_at) same predicate + index (attached_user_id). `bans(id uuid pk, kind text check in ('account','guest','device'), subject_id text not null, source_ban_id uuid references bans(id) on delete set null, created_at timestamptz not null, created_by text not null, reason_code text check (length ≤64))` + `bans_kind_subject_uq` + index (source_ban_id). `profiles(subject_id text pk, nick text, nick_key text, flag_code text, settings jsonb not null default '{}', schedule text[] not null default '{}', updated_at timestamptz not null)` + `profiles_nick_key_uq` unique(nick_key) where nick_key is not null. `CREATE UNIQUE INDEX user_accounts_provider_account_uq ON user_accounts (provider_id, account_id)`. `down`: drop the index and the three tables (`IF EXISTS`). No IP/fingerprint column anywhere.
- **Files:** `server/src/migrations/<ts>_spec11_rights.ts`, `.json`, `server/src/migrations/index.ts`, `server/src/payload-types.ts` (regenerated, expected no diff).
- **Done means:** migcheck up/down/up green; `verify-schema.mjs` green.
- **Verify:** migcheck.
- **Rules that apply:** migration-safety checks 1–9 (one line each; check 2: no destructive op on existing tables; check 9: expand-only).
- **Risk:** `gen_random_uuid()` needs PG ≥13 (compose Postgres version — to confirm) — else generate ids in the app.

### W9 — Pool port
- **Serves:** enables P5–P12 ([П-2]).
- **Do:** `server/src/auth/pool.ts` `authPool(deps): Promise<pg.Pool>` (moved from `test-doors/auth.ts:85-90`, which now imports it) and `rightsDbOf(deps): RightsDb` (`query(text, values)`, `tx(fn)` acquiring one client, `BEGIN`…`COMMIT`/`ROLLBACK`, releasing in `finally`). `server/src/rights/ports.ts`: `RightsDb`, `PassStore`, `BanStore`, `ProfileStore` interfaces (filled in later phases).
- **Files:** `server/src/auth/pool.ts`, `server/src/rights/ports.ts`, `server/src/test-doors/auth.ts`.
- **Done means:** server files green; `auth-doors.int.test.ts` still green.
- **Verify:** server files; one int file `auth-doors.int.test.ts`.
- **Rules that apply:** onion → adapter ring; security → no pool leaks (release in `finally`).
- **Risk:** low.

### W10 — Schema invariants test
- **Serves:** NFR-3, AC-26, AC-47 (DB side).
- **Do:** `server/test/integration/rights-schema.int.test.ts`: direct insert of a second active pass for the same account/season → `23505`; a revoked one + a new one → ok; two profiles with nick keys `ліра` → `23505`; duplicate `(provider_id, account_id)` in `user_accounts` → `23505`; `information_schema.columns` of `passes`, `bans`, `profiles` has no column matching `/ip|fingerprint|fp/`.
- **Files:** `server/test/integration/rights-schema.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file.
- **Rules that apply:** —
- **Risk:** low.

### P5 — Passes (Lane A, opus — attach atomicity and race tests, risk Р6)

### W11 — Pure pass rules
- **Serves:** AC-13, AC-14, AC-15, AC-1, EC-12; FR-ID-14.
- **Do:** `server/src/domain/rights/passSeason.ts` [П-6] (`passSeason`, `seasonEndMs`, `nextSeasonKey`, `isActive(pass, now, ctx)`); `passView.ts` [П-7] mapping the 8 FR-ID-14 rows. `server/test/unit/rights-pass-domain.test.ts`: before/during/after end, +1 s after end inactive, next-season pass active immediately (OQ-3), key `2026-27` → `2027-28`, all 8 table rows.
- **Files:** `server/src/domain/rights/{passSeason,passView}.ts`, `server/test/unit/rights-pass-domain.test.ts`.
- **Done means:** unit green.
- **Verify:** server files.
- **Rules that apply:** onion domain purity.
- **Risk:** low.

### W12 — Session carries pass fields
- **Serves:** AC-1, AC-3, AC-4, AC-9, AC-15, NFR-1.
- **Do:** `server/src/rights/passes.ts` `view({accountId|null, device, now})` — one query (account's active pass ∪ device's active unattached pass); `server/src/auth/response.ts` `toSession` gets the pass view (signature gains `rights` access; callers in `forward.ts` pass it) and drops `neutral` pass fields (`code` stays `null`); `passNight` emitted when `hasPass`. Client-sent fields never read.
- **Files:** `server/src/rights/passes.ts`, `server/src/auth/response.ts`, `server/src/auth/forward.ts`.
- **Done means:** W14 green; response parses with `sessionSchema`.
- **Verify:** server files on the three files.
- **Rules that apply:** security → `stripTokens` untouched.
- **Risk:** `get-session` latency — one indexed query.

### W13 — Grant, revoke, attach, `passOwnedByEmail`, events
- **Serves:** AC-3, AC-5…AC-8 (store side), AC-10, AC-11, AC-12, AC-16, AC-17, EC-1, EC-3, EC-12.
- **Do:** in `server/src/rights/passes.ts`: `grantPass({holder, source, grantRef})` (`INSERT … ON CONFLICT (grant_ref) DO NOTHING RETURNING`, re-read on conflict → same pass; account holder with an active pass for the season → `conflict/pass-owned`; device holder → `pass-owned` when the device already has an active unattached pass for the season OR `passOwnedByEmail(paymentEmail)` is true (conductor decision 5); season by [П-6]); `revokePass(grantRef)` (sets `revoked_at`); `attachOnSignIn({account, device, email})` [П-3] path (a) then (b), returns `{attached: passId|null, from: 'device'|'email'|null, previousDevice?}`; `passOwnedByEmail(email)` (account with that verified email holds an active pass ∪ active unattached pass with that `payment_email`); `hasPass(subject, device)`. `server/src/rights/events.ts` `publishPassEvent(deps, holder, reason)` → `session` with `pass-granted|pass-attached|pass-revoked` to the account or every subject with a session on the device (`user_sessions.device_id`), and for path (b) also to the subjects of `previousDevice` (AC-12). `server/src/auth/events.ts` accepts the new reasons (type only). Expose through `rightsOf(deps).passes` in `server/src/endpoints/deps.ts`.
- **Files:** `server/src/rights/{passes,events}.ts`, `server/src/auth/events.ts`, `server/src/endpoints/deps.ts`.
- **Done means:** W14 green.
- **Verify:** server files.
- **Rules that apply:** onion → service takes `RightsDb`, publisher, clock; never logs emails.
- **Risk:** Р6 — closed by the index; tests below prove it.

### W14 — Pass and race integration tests
- **Serves:** AC-1, AC-3, AC-4, AC-10, AC-11, AC-13…AC-17, EC-3, EC-12, NFR-1.
- **Do:** `server/test/integration/rights-pass.int.test.ts` (harness `buildAuthHarness` pattern from `auth-subject-data.int.test.ts`): grant to device → guest `get-session` row 2; device pass + account with own pass signing out → row 7 (direct session setup, no sign-in flow yet); clock door before/during/after `T2F_SEASON_END` → `passNight` `2026-27`/`2027-28`, +1 s → `hasPass:false`; double `grantRef` → one row; `pass-owned`; `passOwnedByEmail` three cases; a second tab (Centrifugo subscriber, pattern `auth-events.int.test.ts`) receives `pass-granted`, `pass-attached`, `pass-revoked` ≤3 s. `server/test/integration/rights-pass-race.int.test.ts` (deterministic, no sleeps): **SQL level** — two `pg.Client`s on the test DB plus a watcher; A `BEGIN; UPDATE … pass P → account U` (uncommitted); B issues the same/other UPDATE as an un-awaited promise; the watcher polls `SELECT 1 FROM pg_stat_activity WHERE pid = <B pid> AND wait_event_type = 'Lock'` until true (barrier); `COMMIT` A → same pass: B gets 0 rows; different pass, same account: B rejects `23505` and its pass stays unattached; repeat with `ROLLBACK` A → B succeeds. **App level** — two `attachOnSignIn` for the same device through a latch injected into `RightsDb.tx` (both reach the latch before either commits, then release) → exactly one attached pass, one active pass on the account; device pass + email pass for one account concurrently → one attached (EC-3: the earliest by `issued_at` when path (b) wins). `server/test/integration/auth-perf.int.test.ts`: add a case — 500 `get-session` with a device pass, p95 ≤50 ms (NFR-1).
- **Files:** `server/test/integration/{rights-pass,rights-pass-race,auth-perf}.int.test.ts`.
- **Done means:** the three files green; the race file runs 20 iterations without a flake.
- **Verify:** one int file each.
- **Rules that apply:** —
- **Risk:** the app-level latch must wrap the transaction client, not the pool — otherwise the barrier is not reached.

### P6 — Bans and the daily-fingerprint block (Lane A, opus — bans, fingerprint block, `isBlocked`)

### W15 — Pure blocked decision
- **Serves:** AC-18, AC-21, AC-24.
- **Do:** `server/src/domain/rights/blocked.ts` `blockedVerdict({subjectKind, subjectBan, deviceBan, ipDayMarkAtMs|null, guestCreatedAtMs, nextUtcMidnightMs})` → `{blocked:false} | {blocked:true, kind, until}`; order account/guest → device → ip-day (guests only, mark ≤ created); `until: null` except ip-day. Unit `server/test/unit/rights-blocked.test.ts` (every kind, old guest, account on a marked fingerprint, +400 days).
- **Files:** `server/src/domain/rights/blocked.ts`, `server/test/unit/rights-blocked.test.ts`.
- **Done means:** unit green.
- **Verify:** server files.
- **Rules that apply:** domain purity.
- **Risk:** low.

### W16 — Ban store and `isBlocked`
- **Serves:** AC-18, AC-20, AC-21, AC-22 (store side), NFR-7.
- **Do:** `server/src/rights/bans.ts`: `ban({kind, subject, by, reasonCode})` (account → also derived device bans for every `user_sessions.device_id` of the account, one tx), `unban(banId)` (deletes the ban and its derived rows), `list()`, `isBlocked(subject, {device, subjectKind})` (DB + marks via W17; Redis failure → DB only + `alarm.raise({level:'log', source:'bans', code:'bans/fast-store-down'})`), `onAccountSession(accountId, deviceId)` (adds a derived device ban when the account is banned). `server/src/auth/instance.ts` `session.create.after` calls `onAccountSession` for non-anonymous users (inside the hook deps; never throws). `server/src/registries/ops.ts` row `bans/fast-store-down` (level `log`). `rightsOf(deps).bans` getter. `isBlocked` is the interface for SPEC-15/16/17 — exported from `server/src/rights/bans.ts`.
- **Files:** `server/src/rights/bans.ts`, `server/src/auth/instance.ts`, `server/src/registries/ops.ts`, `server/src/endpoints/deps.ts`.
- **Done means:** W18 green; `test/unit/ops-registry-scan.test.ts` green.
- **Verify:** server files.
- **Rules that apply:** security → no IP in DB; gotchas.md:24 (ops row with the raise).
- **Risk:** hook failure must not break sign-in (wrap, log).

### W17 — Fingerprint marks
- **Serves:** AC-23, AC-24, AC-25, AC-26, NFR-5, EC-10, EC-11.
- **Do:** `server/src/rights/banMarks.ts` over `FastStore`: `rememberSubjectFp(subject, fp, now)` (`setIfAbsent ban:fp:<subject>` TTL to next 00:00 UTC), `markFp(fp, bannedAt)` (`ban:ipday:<fp>`), `rememberGuestFp(guestId, fp)`, `ipDayMarkFor(guestId)`; middleware `27-ban-mark` in `server/src/registries/middleware.ts` (after `25-subject`): when `ctx.subject` is set → `rememberSubjectFp`; if the subject is banned (cached per request via `isBlocked` DB part) → `markFp(await ctx.client.ipDay())`. `ban()` marks the subject's remembered fingerprint at once. `server/src/adapters/sessionSubjects.ts` `startGuestSession` → `rememberGuestFp`. TTL ≤ seconds to next 00:00 UTC of the fingerprint clock [П-8].
- **Files:** `server/src/rights/banMarks.ts`, `server/src/registries/middleware.ts`, `server/src/adapters/sessionSubjects.ts`.
- **Done means:** W18 green.
- **Verify:** server files.
- **Rules that apply:** `ipDay` windows ≤24 h (`registries/middleware.ts:20-24`); keys hold fingerprints only, never addresses.
- **Risk:** an extra Redis write per subject request — `setIfAbsent`, one round trip; measured by `auth-perf` (W14) staying green.

### W18 — Bans integration tests
- **Serves:** AC-18, AC-20, AC-21, AC-23…AC-26, NFR-5, NFR-7, EC-10, EC-11.
- **Do:** `server/test/integration/rights-bans.int.test.ts`: ban account → `kind:'account'`, `until:null`; sign-out → new guest on the same device `kind:'device'`; clock +400 d → still banned; subject request with edge header `x-t2f-client` A, ban, new device with A → new guest `ip-day`, an account from A → not blocked, a guest created before the ban → not blocked; clock past 00:00 UTC → new guest not blocked; 23:59:00 ban → blocked until 00:00 only; TTL of `ban:*` keys ≤ seconds to 00:00 UTC; no `ban:`-like value in `bans`/`profiles`/`passes` rows; Redis stopped (chaos: a `FastStore` stub that throws, injected via `testDeps`) → account ban still `blocked`, `ip-day` not, alarm row `bans/fast-store-down`.
- **Files:** `server/test/integration/rights-bans.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file.
- **Rules that apply:** a fresh `x-t2f-client` per caller with the edge secret set (gotchas.md:35).
- **Risk:** low.

### P7 — Profile, nick, flag, settings (Lane A, sonnet)

### W19 — Pure profile rules
- **Serves:** AC-29, AC-33, AC-36.
- **Do:** `server/src/domain/rights/nick.ts` (`nickKey`), `flags.ts` (`isAllowedFlag(code, catalogIsos)` = catalog ISO alpha-2 ∪ `SPECIAL_FLAG_CODES`), `settings.ts` (`applySettingsPatch(current, patch, {countryIsos, zoneIds})` → value or `invalid-input`; defaults incl. `reminderEmails: true` [Q2], values from `stores/account.ts:35-44`). Unit `server/test/unit/rights-profile-domain.test.ts`.
- **Files:** `server/src/domain/rights/{nick,flags,settings}.ts`, `server/test/unit/rights-profile-domain.test.ts`.
- **Done means:** unit green.
- **Verify:** server files.
- **Rules that apply:** domain purity.
- **Risk:** low.

### W20 — Profile service, events, routes
- **Serves:** AC-27, AC-28, AC-29, AC-30, AC-32, AC-33, AC-34, AC-35, AC-36, AC-58, EC-5, EC-6, NFR-2.
- **Do:** `server/src/rights/profiles.ts`: `get(subject, ctx)` (row or defaults; `detectedFlag` = `ctx.client.country` unless `unknown` → `null`; `googleLinked`, `pendingEmail` read from `user_accounts`/`auth_verifications`), `patch(subject, patch)` — nick: `moderationOf(deps).verdict.verdict({kind:'nick', text})` first (`block` → `validation` + rule reason; `review` → `validation/forbidden`), then upsert with `nick_key`; `23505` → `validation/taken`; flag/settings via W19; publishes `profile` (`server/src/rights/events.ts` `publishProfileEvent`) and never logs nick text; `checkNick(subject, nick)` (verdict + uniqueness, excluding the subject's own key). `server/src/endpoints/me.ts` rows `me-profile-get` `GET /api/me/profile` (no guest creation without a session: defaults), `me-profile-patch` `PATCH /api/me/profile` (`subject:'required'`, body `profilePatchBody`, `maxBodyBytes: 4096`, `rateLimit: 'me-profile'`); `server/src/endpoints/chatNick.ts` row `chat-nick-check` `POST /api/chat/nick-check` (`subject:'required'`, `rateLimit: 'chat-nick-check'`). `server/src/endpoints/types.ts` `Ctx.subjectKind?: 'guest'|'account'` set by `25-subject` (`server/src/registries/middleware.ts`) from `sessionSubjectOf` (the kind it already computes). `server/src/registries/routes.ts` rows (sorted).
- **Files:** `server/src/rights/{profiles,events}.ts`, `server/src/endpoints/{me,chatNick,types}.ts`, `server/src/registries/{routes,middleware}.ts`.
- **Done means:** W22 green.
- **Verify:** server files.
- **Rules that apply:** security → subject only from session; strict body rejects an injected id (`invalid-input`); contract-conformance → shared schemas.
- **Risk:** `PATCH` with only `detectedFlag` must be a no-op success.

### W21 — Rate-limit rows
- **Serves:** AC-58, [А13].
- **Do:** `server/src/registries/rateLimits.ts`: `me-profile` (30 / 60 000 ms, keys `['subject']`, `onStoreDown: 'memory'`), `me-schedule` (same), `chat-nick-check` (same); sorted.
- **Files:** `server/src/registries/rateLimits.ts`.
- **Done means:** registry unit tests green; 31st `PATCH` in a minute → `rate_limited` in W22.
- **Verify:** server files.
- **Rules that apply:** registry sorted + `assertRegistry`.
- **Risk:** low.

### W22 — Profile integration tests
- **Serves:** AC-27…AC-30, AC-32…AC-36, AC-58 (profile part), NFR-2, NFR-4, EC-5, EC-6.
- **Do:** `server/test/integration/rights-profile.int.test.ts`: four rule reasons (`a`, 21 chars, link, `admin`); moderation door `review` → `forbidden`, not saved; `Ліра` taken → `ліра ` → `taken`, own nick again ok; two parallel `PATCH` same free nick → one ok, one `taken`; capturing logger + stdout spy → no nick text after the refusals; flags `UA`, `pride` ok, `XX`, `<b>` → `invalid-input`; edge header country `PL` → `detectedFlag:'PL'`, body `detectedFlag:'US'` ignored; full settings round-trip, `reminderEmails` default `true`, unknown key and foreign zone → `invalid-input`; second-tab subscriber gets `profile` ≤3 s; 20 settings changes → p95 ≤3 s (NFR-2); 4.1 KB body → 413; body with `subject` key → `invalid-input`; 31st `PATCH`/min → `rate_limited`; moderation fallback (providers off) still yields rule reasons (EC-6).
- **Files:** `server/test/integration/rights-profile.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file.
- **Rules that apply:** —
- **Risk:** low.

### P8 — Schedule on the server (Lane A, sonnet)

### W23 — Server wrapper over the shared rule
- **Serves:** AC-37, AC-38, AC-39, AC-42, AC-52 (rule).
- **Do:** `server/src/domain/rights/schedule.ts`: `scheduleCatalogFrom(stored: StoredCatalog)` (events not hidden; zone countries from cities) memoized per catalog `generatedAt`; re-exports the rule calls. Unit `server/test/unit/rights-schedule-rule.test.ts` runs `packages/rules/test/schedule.table.ts` through it.
- **Files:** `server/src/domain/rights/schedule.ts`, `server/test/unit/rights-schedule-rule.test.ts`.
- **Done means:** unit green with the shared table.
- **Verify:** server files.
- **Rules that apply:** one rule, two wrappers (AC-37).
- **Risk:** hidden events: an id of a hidden event is unknown (AC-42).

### W24 — Schedule service and routes
- **Serves:** AC-38…AC-42, AC-35, AC-58, NFR-4.
- **Do:** `server/src/rights/schedule.ts`: `set(subject, ids)`, `toggle(subject, eventId)`, `replace(subject, outIso, eventId)` — each: `hasPass(subject, device)` else `forbidden`; validate ids (`invalid-input`); one tx with `SELECT … FOR UPDATE` on the profile row (insert default row first if absent); `full` → `conflict/schedule-full` without change; publish `profile`. `server/src/endpoints/me.ts` rows `me-schedule-put` `PUT /api/me/schedule`, `me-schedule-toggle`, `me-schedule-replace` (`subject:'required'`, `rateLimit:'me-schedule'`, `maxBodyBytes: 4096`); `server/src/registries/routes.ts`.
- **Files:** `server/src/rights/schedule.ts`, `server/src/endpoints/me.ts`, `server/src/registries/routes.ts`.
- **Done means:** W25 green.
- **Verify:** server files.
- **Rules that apply:** security, contract-conformance.
- **Risk:** `PUT` with >4 countries in a zone → `schedule-full` (AC-39 "через PUT").

### W25 — Schedule integration tests
- **Serves:** AC-35, AC-38…AC-42, NFR-4.
- **Do:** `server/test/integration/rights-schedule.int.test.ts` (catalog seeded; pick a zone with ≥5 countries from the seeded catalog at runtime): toggle → all events of the country in the zone; fifth country via toggle and via PUT → `schedule-full`, unchanged; replace → 4 countries, position kept; replace ∥ toggle (`Promise.all`) → never 5; guest without pass → `forbidden`, with a device pass (door/fixture from W13 store call) → ok; unknown id → `invalid-input`; 513 ids → `invalid-input`; `profile` event received.
- **Files:** `server/test/integration/rights-schedule.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file.
- **Rules that apply:** —
- **Risk:** low.

### P9 — Sign-in finish step, merge handlers, guest removal (Lane A, opus — sign-in finish, merge, deletion conditions)

### W26 — Merge handlers and guest removal
- **Serves:** AC-19, AC-49, AC-51, AC-52, AC-53, EC-7; FR-ID-12.
- **Do:** `server/src/rights/links.ts` rows: `bans` (guest ban → account ban `created_by:'merge'`; idempotent by the unique key), `passes` (`attachOnSignIn({account:to, device: guest device, email: account verified email})`, publishes `pass-attached`), `profile` (fields where the account's value is unset take the guest's; the guest's nick moves only when the account has none, else the guest's `nick_key` is cleared; schedule = `mergeSchedules`; guest row then removed; publishes `profile` to the account). `server/src/registries/authLinks.ts` registers them (sorted). `server/src/auth/options.ts` `anonymous({ …, disableDeleteAnonymousUser: true })`. `server/src/auth/merge.ts` `linkGuest` [П-5]: track whether this call claimed and finished every handler; afterwards always `internalAdapter.deleteUserSessions(guest)`; delete the guest only when the conditions hold (query `auth_link_retries` by `from_subject`, `passes` by device); `invalidateSubject` for both ids; mark the auth scope `linked=true`. A test-only fault hook (`Deps.authLinks` override, already supported) is used by tests.
- **Files:** `server/src/rights/links.ts`, `server/src/registries/authLinks.ts`, `server/src/auth/{options,merge,scope}.ts`.
- **Done means:** W28 green; `auth-merge.int.test.ts` updated expectation (guest kept when a handler throws or a device pass stays; gone otherwise) green.
- **Verify:** server files; one int file `auth-merge.int.test.ts`.
- **Rules that apply:** `linkGuest` never throws (`merge.ts:95-117`); every BA call inside the auth scope (gotchas.md:37).
- **Risk:** deleting a guest while another tab's request still merges — prevented by "only the claimant of all handlers deletes".

### W27 — Finish step for sign-ins without a guest
- **Serves:** AC-5, AC-6, AC-7, AC-8, AC-12, EC-1; [А4], DR-3.
- **Do:** `server/src/auth/forward.ts`: after a successful `/sign-in/email-otp` or `/callback/google` response that created an account session and when the scope has no `linked` flag → `attachOnSignIn({account, device: ctx.device, email})`; failure → `auth_link_retries` row (`handler 'passes'`, `from_subject 'device:<id>'`) + `log` `auth/link-retry` (reuse `recordRetry` from `merge.ts`, exported). The response is returned unchanged; `get-session` afterwards shows the attach.
- **Files:** `server/src/auth/{forward,merge}.ts`.
- **Done means:** W28 green.
- **Verify:** server files.
- **Rules that apply:** security → sign-in never fails because of the attach.
- **Risk:** the Google callback is a redirect response — detect the new session by the `Set-Cookie` of the session token, as the anonymous plugin does.

### W28 — Sign-in and merge integration tests
- **Serves:** AC-5…AC-9, AC-12, AC-19, AC-49, AC-51…AC-53, EC-1, EC-7; FR-ID-14 rows 4–8 at server level.
- **Do:** `server/test/integration/rights-signin.int.test.ts` (helpers `test/support/authClient.ts`: `CookieJar`, `signIn`, `sessionOf`, `waitFor`, `testEmail`): row 4 (account without pass signs in on a device with a pass → `account`, pass row has account id); path (b) on device B → pass attached, device A session row 8 + `session` event to A ≤3 s; both paths → device pass attached, email pass untouched; row 5; row 6 after sign-out; sign-in after sign-out (no guest) still attaches (DR-3); cookie lost → path (b) (EC-1). `server/test/integration/rights-merge.int.test.ts`: guest ban → account banned after sign-in; profile merge both nick cases (guest nick freed / moved); 3 account + 2 guest countries → 4 with 3 of the account; handler `profile` throws (via `Deps.authLinks` wrapper) → guest kept + retry row + alarm; device pass left (account has own pass) → guest kept; second `linkGuest` for the pair → no change; invalidation spy sees both ids; merge during an open replace (EC-7) → AC-52 result + `profile` event.
- **Files:** `server/test/integration/{rights-signin,rights-merge,auth-merge}.int.test.ts`.
- **Done means:** the three files green.
- **Verify:** one int file each.
- **Rules that apply:** —
- **Risk:** Google path of row 4 needs the fake OIDC — reuse `fakeOidc.ts`.

### W29 — Guest prune keep rule
- **Serves:** AC-31 (guest side), AC-50 (conductor decision 1).
- **Do:** `server/src/domain/auth/guestPrune.ts` `holdsOtherData(results, except)` → `except` becomes a list (`['auth','profile','bans']`); `server/src/ops/guestPrune.ts` `GuestPruneJobDeps.held(id): Promise<boolean>` (open `auth_link_retries` with `from_subject = id`, or active unattached pass on the guest's `users.device_id`) checked before deletion; after `deleteIfStale` succeeds → `afterGuestRemoved(id)` erases the guest's `profile` and `bans` rows (nick released). Wiring of the two new deps where the job is built (`server/src/auth/subjectData.ts` `createAuthGuestStore` or the container — to confirm). `server/test/integration/auth-guest-prune.int.test.ts`: guest with a nick, +31 d → removed, nick free; guest with an open retry → kept; delete the retry row → removed next run; guest whose device has an unattached pass → kept until the pass is attached or its season ends.
- **Files:** `server/src/domain/auth/guestPrune.ts`, `server/src/ops/guestPrune.ts`, `server/src/auth/subjectData.ts`, `server/test/integration/auth-guest-prune.int.test.ts`.
- **Done means:** the int file green; `server/test/unit/*guest*` (if any) green.
- **Verify:** server files; one int file.
- **Rules that apply:** deletion via internal adapter inside `runInAuthScope`.
- **Risk:** existing SPEC-10 case "guest with a test handler's data kept" must stay green (its capability is not in the list).

### W29b — Link retry job `auth-link-retry` (conductor decision 2)
- **Serves:** AC-50, AC-49, AC-5…AC-8 (no lost attach); [А4].
- **Do:** pure `server/src/domain/auth/linkRetry.ts` (`LINK_RETRY_MAX_ATTEMPTS = 24`, `nextRetryAt(attempts, now)` = now + 1 h, `isDue(row, now)`); `server/src/ops/linkRetry.ts` job `auth-link-retry` (hourly, lease `ops-auth-link` with the same TTL pattern as `ops/guestPrune.ts`, wall clock, batch ≤100, rows `next_at ≤ now AND attempts < 24` with `FOR UPDATE SKIP LOCKED`, pattern `payloadOps.ts:163`): resolve the handler by `handler` key from `authLinkRegistry` (or `Deps.authLinks`); `from_subject = 'device:<id>'` → `attachOnSignIn({account: user_id, device, email})`; otherwise `handler.link({fromSubject, toSubject: user_id, deps})`, all inside `runInAuthScope`. Success → delete the row (= closed), then re-check the guest-removal conditions of [П-5] for `from_subject` (same function as `linkGuest`, extracted to `server/src/auth/merge.ts` `maybeRemoveGuest`) and publish the handler's event. Failure → `attempts+1`, `next_at`, `last_error_code`; reaching 24 → row kept as dead (not retried, still holds the guest) and `alarm.raise({level:'log', source:'auth', code:'auth/link-retry', details:{handler, gaveUp:true}})` (existing ops row). Add to `OPS_JOBS` (`server/src/ops/runner.ts`) and the lease name union (`server/src/ops/ports.ts`). `server/test/integration/auth-link-retry.int.test.ts`: a `passes` failure in the no-guest path → retry row → job run (clock +1 h via `ops-tick`) → pass attached, row gone; a guest kept by a failed `profile` handler → job succeeds → guest removed; a handler that always throws → after 24 runs no more attempts, one give-up alarm.
- **Files:** `server/src/domain/auth/linkRetry.ts`, `server/src/ops/{linkRetry,runner,ports}.ts`, `server/src/auth/merge.ts`, `server/test/integration/auth-link-retry.int.test.ts`.
- **Done means:** the int file green; `test/unit/ops-registry-scan.test.ts` green.
- **Verify:** server files; one int file.
- **Rules that apply:** handlers idempotent (`registries/authLinks.ts:5`); every BA call inside `runInAuthScope` (gotchas.md:37); one runner per lease.
- **Risk:** double run of one row by two instances — `SKIP LOCKED` + lease.

### P10 — Email change and Google (Lane A, opus — Better Auth link/unlink, email change)

### W30 — Pure method and email rules
- **Serves:** AC-43, AC-48.
- **Do:** `server/src/domain/rights/signInMethods.ts` `signInMethods({isAnonymous, emailVerified, providerIds})`, `canUnlink(methods, 'google')`; email change value codec (`encode/decode` of `<email>:<hash>:<attempts>:<sentAt>`) in the same module or `emailChange` domain file. Unit `server/test/unit/rights-account-domain.test.ts`.
- **Files:** `server/src/domain/rights/signInMethods.ts`, `server/test/unit/rights-account-domain.test.ts`.
- **Done means:** unit green.
- **Verify:** server files.
- **Rules that apply:** domain purity.
- **Risk:** low.

### W31 — Email change flow
- **Serves:** AC-43, AC-44, AC-45, AC-58, EC-4.
- **Do:** `server/src/rights/emailChange.ts` [П-11]: `request(account, email)` (normalize with `domain/auth/email.ts`; same → `validation/same-email`; bad → `validation/email`; taken → `conflict/taken`; limits via `auth/codeLimits.ts` keyed by the new address; store hashed code; send `changeEmailCode` through the mail service; `unavailable` handling as SPEC-10 [П-8]); `verify(account, code)` (`wrong-code` with `attemptsLeft`, `expired`, `too-many-attempts`; update email `23505` → `taken`; delete `sign-in-otp-<old>`; publish `session` with reason `email-changed` + `profile`; no attach — EC-4); `cancel(account)`. `server/src/mail/templates/changeEmailCode.ts` (Ukrainian text+HTML, no links). `server/src/endpoints/meAccount.ts` rows `me-email-request` `POST /api/me/email`, `me-email-verify` `POST /api/me/email/verify`, `me-email-cancel` `DELETE /api/me/email` (guest → `unauthorized`); `server/src/registries/routes.ts`.
- **Files:** `server/src/rights/emailChange.ts`, `server/src/mail/templates/changeEmailCode.ts`, `server/src/endpoints/meAccount.ts`, `server/src/registries/routes.ts`.
- **Done means:** W33 green.
- **Verify:** server files.
- **Rules that apply:** security → codes hashed, email never logged (SPEC-10 AC-48); mail only to Mailpit in tests.
- **Risk:** the 1.7.28 OTP concurrency fix does not cover our identifier — `consumeVerificationValue` is the atomic step (research-better-auth "Not established" 2: cross-process atomicity unread — the race test in W33 covers it at our level).

### W32 — Google link and unlink
- **Serves:** AC-46, AC-47, AC-48, AC-58; [Q1].
- **Do:** `server/src/auth/link.ts` `startGoogleLink(deps, headers, returnPath)` (`auth.api.linkSocial` with `disableRedirect:true`, `callbackURL`/`errorCallbackURL` from `safeReturnPath`) and `unlinkGoogle(deps, accountId)` (`findAccounts` + `deleteAccount`, refusal `conflict/last-method` by W30). `server/src/auth/google.ts`: `accountLinking.allowDifferentEmails: true`; callback error mapping for link: `account_already_linked_to_different_user` → `error=google-taken`; `unable_to_link_account` → re-read `user_accounts` by `(provider_id, account_id)`: other owner → `google-taken`, else `failed`. Rows `me-google-link` `POST /api/me/google`, `me-google-unlink` `DELETE /api/me/google` in `server/src/endpoints/meAccount.ts` (guest → `unauthorized`); publish `profile` after unlink and after a successful link callback.
- **Files:** `server/src/auth/{link,google}.ts`, `server/src/endpoints/meAccount.ts`.
- **Done means:** W33 green; SPEC-10 `auth-google.int.test.ts` still green.
- **Verify:** server files; one int file `auth-google.int.test.ts`.
- **Rules that apply:** security → open-redirect guard (`safeReturnPath`), no token in any response.
- **Risk:** `allowDifferentEmails: true` must not enable sign-in auto-link by a different email — the W33 test proves sign-in by an unlinked Google with another email creates no link to an existing account.

### W33 — Email and Google integration tests
- **Serves:** AC-43…AC-48, AC-58, EC-4, NFR-6.
- **Do:** `server/test/integration/rights-email.int.test.ts`: request → Mailpit has the code, `pendingEmail` set; same / taken / malformed refusals; second request <30 s → `rate_limited/wait`; verify → email changed, verified, account pass still on it, `session` event received; race: verify while another account signs up with that address → `taken`; wrong → `wrong-code`, expired (expire via a door or direct row update) → `expired`; cancel → old code `expired`; guest → `unauthorized`; changing to a payment email of an unattached pass does not attach (EC-4). `server/test/integration/rights-google.int.test.ts` (fake OIDC): link with a different Google email → `googleLinked:true`; Google of another account → `error=google-taken`; two parallel links of one `sub` by two accounts → one `user_accounts` row, the other `google-taken`; code + Google → unlink ok; Google-only without verified email → `last-method`; the fake OIDC request log shows only `127.0.0.1:8091` (NFR-6).
- **Files:** `server/test/integration/{rights-email,rights-google}.int.test.ts`.
- **Done means:** both green with `noMailNetwork` active.
- **Verify:** one int file each.
- **Rules that apply:** unique recipients (`testEmail.ts`).
- **Risk:** parallel-link test needs two independent OAuth states — run both authorize flows to the callback, then fire the callbacks with `Promise.all`.

### P11 — Test doors and fixture presets (Lane A, opus — test doors)

### W34 — Rights doors
- **Serves:** AC-62; enables W42–W44.
- **Do:** `server/src/test-doors/rights.ts` rows [П-15] (`rights-fixture`, `rights-pass-grant`, `rights-pass-revoke`, `rights-ban`, `rights-profile-seed`, `rights-link-fault`), strict bodies from W3, sorted into `server/src/test-doors/registry.ts` (header count updated); `reset` calls `clearRightsTables` (`DELETE FROM passes; DELETE FROM bans; DELETE FROM profiles;`) from `server/src/test-doors/auth.ts`. `rights-pass-grant {holder:{device:'current'}}` binds to the caller's device cookie (`ctx.device`) so the http suite can grant to its own jar; `rights-ban {kind:'ip-day'}` marks the caller's current fingerprint. Fixture values = sim seeds (skill `seed-and-fixtures` §2).
- **Files:** `server/src/test-doors/{rights,registry,auth}.ts`.
- **Done means:** W35 green.
- **Verify:** server files.
- **Rules that apply:** security → doors only in `test` with `T2F_TEST_DOORS=1` (dynamic import, `container.ts`); no production import path.
- **Risk:** low.

### W35 — Doors test
- **Serves:** AC-62.
- **Do:** `server/test/integration/rights-doors.int.test.ts`: each door works in `test`; each fixture name yields the state it names (`get-session`/`isBlocked`); `reset` empties the three tables; with `T2F_TEST_DOORS` unset each path → 404 identical to an unknown path.
- **Files:** `server/test/integration/rights-doors.int.test.ts`.
- **Done means:** green.
- **Verify:** one int file.
- **Rules that apply:** contractCheck «Test doors».
- **Risk:** low.

### P12 — Subject data rows and the owner's ban slice (Lane A, sonnet)

### W36 — Subject-data handlers
- **Serves:** AC-54, AC-55, AC-56, AC-57, AC-31 (account side), EC-9.
- **Do:** `server/src/rights/subjectData.ts` three `SubjectDataHandler`s reading deps through `requireSubjectDataDeps()` (pattern `server/src/auth/subjectData.ts`): `profile` (export nick, flag, settings, schedule, pending email change `{email, sentAt}`; erase = delete row (nick freed) + delete `t2f-change-email-<id>`; anonymise = erase), `passes` (export `{season, source, issuedAt, place:'account'|'device'}` of passes attached to the subject or unattached on its devices — no email of others, no device ids; erase for an account = attached passes get `attached_user_id NULL, payment_email NULL, device_id NULL, erased_at now`; unattached passes untouched — FR-PRIV-05), `bans` (export `{kind, since}` of bans on the subject and its devices; erase = delete the subject's own ban, keep derived device bans [Q4]). `server/src/registries/subjectData.ts` rows sorted (`auth`, `auth-codes`, `bans`, `ip-day-fingerprint`, `passes`, `profile`). `server/test/integration/rights-subject-data.int.test.ts`: export fields exactly, no fingerprint; erase → profile gone, nick free, unattached device pass still active; erased account with a ban → new guest on its device still blocked; extra failing row → others ran, `ok:false` naming it.
- **Files:** `server/src/rights/subjectData.ts`, `server/src/registries/subjectData.ts`, `server/test/integration/rights-subject-data.int.test.ts`.
- **Done means:** int file green; `server/test/unit/subject-data-registry.test.ts` updated rows green.
- **Verify:** server files; one int file.
- **Rules that apply:** FR-PLAT-13 interface (`platform/subjectData.ts`).
- **Risk:** low.

### W37 — Owner endpoints `/cms-api/bans/*`
- **Serves:** AC-22.
- **Do:** `server/src/admin/bansEndpoints.ts` (pattern `streamsEndpoints.ts`, helpers `cmsHttp.ts`: owner role, JSON, ≤1 KB, strict zod): `GET /bans` (list: kind, subject id, created, source, derived count — no fingerprints), `POST /bans/ban {kind:'account'|'guest'|'device', subjectId}` → `rights.bans.ban({…, by:'owner'})` (unknown account/guest id → `not_found`) and `POST /bans/unban {banId}` → `rights.bans.unban`, each with an audit row via `resolveActor` (`server/src/audit/journal`) (conductor decision 6); registered in `server/src/admin/cmsEndpoints.ts` (every class).
- **Files:** `server/src/admin/{bansEndpoints,cmsEndpoints}.ts`.
- **Done means:** W38 green.
- **Verify:** server files.
- **Rules that apply:** access gate + `payloadGuard` second check (research-code §11); audit in its own tx.
- **Risk:** low.

### W38 — Ban slice and its test
- **Serves:** AC-22.
- **Do:** `server/src/admin/BansSlice.tsx` (server component, `processDeps()`), `BansView.tsx` (client list + «Зняти бан» button calling `/cms-api/bans/unban` + a small form «Забанити» (kind select, id field) calling `/cms-api/bans/ban`), row `35-bans` in `server/src/registries/adminSlots.ts`. `server/test/integration/rights-bans-admin.int.test.ts`: owner ban by id → `isBlocked` true + audit row; owner unban → `isBlocked` false for the ban and its derived device bans, audit row present; `content-agent` identity → 403. Server build once (HEAVY, see Contract changes).
- **Files:** `server/src/admin/{BansSlice,BansView}.tsx`, `server/src/registries/adminSlots.ts`, `server/test/integration/rights-bans-admin.int.test.ts`.
- **Done means:** int file green; server `next build` succeeds.
- **Verify:** server files; one int file; server build.
- **Rules that apply:** react-best-practices proposed for `server/src/admin/**/*.tsx` (routing gap).
- **Risk:** low.

### P13 — Web adapters and sim (Lane B, sonnet)

### W39 — `lib/api/http/profile.ts` and zod-free `auth`
- **Serves:** AC-60, AC-59.
- **Do:** `createHttpProfile({fetch, transport})` implementing `ProfileService` (`lib/api/contracts/profile.ts:44-82`) by the recipe `frontend-seam.md` §6.0 (like `lib/api/http/auth.ts`): `get`, `update`, `setSchedule`, `toggleSchedule`, `replaceSchedule`, `changeEmail`, `confirmEmailChange`, `cancelEmailChange`, `linkGoogle` (`POST /api/me/google {returnPath: current path}` → `location.assign(url)` — returns the redirect outcome as the contract expects, to confirm the contract's return), `unlinkGoogle`, `subscribe` (`profile` events on `user:#<subject>` → re-read), `exportData`/`deleteAccount` → `fail('unavailable')` (SPEC-20). Responses parsed with `profileGuard` (W5). `lib/api/http/auth.ts`: replace the `@time2fest/contracts/schemas` import with `authGuard` parsers (behaviour unchanged).
- **Files:** `lib/api/http/profile.ts`, `lib/api/http/auth.ts`.
- **Done means:** web files green; `grep -n "contracts/schemas" lib/api/http/*.ts` → nothing.
- **Verify:** web files on both files.
- **Rules that apply:** frontend-ui-architecture (shared adapter), security (cookies only, no token storage), contract-conformance §1.
- **Risk:** low.

### W40 — Sim refusals
- **Serves:** AC-61, AC-59.
- **Do:** `lib/api/sim/profile.ts`: `update` validates nick with `validateNick` (+ CHAT_SCRIPT authors as taken, same as `lib/api/sim/chat.ts:152-155`), flag allow-list, settings keys; schedule actions refuse `forbidden` when the sim session has no pass (`stores/auth` `passPlace` null) and return `conflict/schedule-full` when `scheduleToggleResult` is `full`; email change refusals `same-email`/`taken` as the server.
- **Files:** `lib/api/sim/profile.ts`.
- **Done means:** existing UI unit tests (`npx vitest related lib/api/sim/profile.ts`) green.
- **Verify:** web files.
- **Rules that apply:** contract-conformance §2 (sim = server behaviour).
- **Risk:** a UI path that toggles the schedule without a pass now sees `forbidden` — check `profile-hooks.test.tsx` and the schedule components' tests; the UI already gates by pass (to confirm), else record in the report.

### W41 — Switch the domains
- **Serves:** AC-60.
- **Do:** `lib/api/http/domains.ts` `HTTP_DOMAINS = ['auth','catalog','live','profile','site']` (keep existing order style); `lib/api/http/index.ts` factories `auth: () => createHttpAuth({ transport: () => import('./realtime').then(m => m.getRealtimeTransport()) })` and `profile` likewise (literal-guarded dynamic import, pattern `site.ts:47-50`).
- **Files:** `lib/api/http/{domains,index}.ts`.
- **Done means:** web files green; `tests/unit/api/integration-build.test.tsx` green.
- **Verify:** web files.
- **Rules that apply:** `factories` typed by `HTTP_DOMAINS` (`index.ts:12`).
- **Risk:** build-only — covered in L (`next build` + `check-bundle.mjs`).

### P14 — Behaviour suites (Lane B, sonnet)

### W42 — `auth` suite: FR-ID-14 rows
- **Serves:** AC-2, AC-4, AC-9.
- **Do:** `tests/contract/auth.suite.ts` ctx gains `grantDevicePass(svc, email)`, `grantAccountPass(email)`, `signInAs(svc, email)` helpers; 8 rows of FR-ID-14 (`specs/002-backend/spec.md:643-656`) as one `describe('FR-ID-14')`, row 8 using two services with separate device jars. Sim ctx in `tests/unit/api/auth-contract.test.ts` (sim store helpers), http ctx in `tests/contract/auth.http.test.ts` (doors `rights-pass-grant` with `device:'current'`, `auth-last-code`).
- **Files:** `tests/contract/auth.suite.ts`, `tests/contract/auth.http.test.ts`, `tests/unit/api/auth-contract.test.ts`.
- **Done means:** sim column green (`--sim-only`); http column green in W44.
- **Verify:** web files on the three files.
- **Rules that apply:** contract-conformance §2.
- **Risk:** sim's attach rule must match row 4/5/8 — if a sim row differs from the server, the server is the reference and W40's file gets the fix (report it).

### W43 — `profile` suite
- **Serves:** AC-60, AC-61.
- **Do:** new `tests/contract/profile.suite.ts` `describeDomain(name, makeService, ctx)`: defaults; nick ok / `short` / `taken` (ctx `takeNick`) / `forbidden`; flag ok / `invalid-input`; settings round-trip; schedule `forbidden` without pass (ctx `givePass`), toggle adds the country group, fifth country `schedule-full` (ctx `fullZone()` returns 5 event ids of distinct countries in one zone), replace; email change request / wrong code / cancel (ctx `lastCode`); `linkGoogle` returns a redirect; `unlinkGoogle` on a code-only account → `last-method`; `exportData` and `deleteAccount` rows `it.skip('… — до SPEC-20')`. `tests/unit/api/profile-contract.test.ts` (sim), `tests/contract/profile.http.test.ts` (doors, own cookie jar as in `auth.http.test.ts`).
- **Files:** `tests/contract/profile.suite.ts`, `tests/contract/profile.http.test.ts`, `tests/unit/api/profile-contract.test.ts`.
- **Done means:** `node scripts/contract-run.mjs --sim-only` → `profile` sim green.
- **Verify:** web files on the three files.
- **Rules that apply:** contract-conformance §2; skip reason text contains «до SPEC-20».
- **Risk:** `contract-run.mjs` discovers domains by file names (`tests/unit/api/<d>-(sim|contract)`, research-code §3) — names chosen accordingly.

### W44 — Both columns green
- **Serves:** AC-2, AC-60, AC-61.
- **Do:** serve the worktree server (slot 22), run the contract run; fix only test wiring in W42/W43 files; a behavioural mismatch goes back to the owning phase's file (report).
- **Files:** (none new).
- **Done means:** `auth` and `profile` rows green on sim and http; skipped rows only the two «до SPEC-20».
- **Verify:** contract run.
- **Rules that apply:** one heavy process (serve) at a time.
- **Risk:** low.

### P15 — Docs (Lane B, sonnet)

### W45 — Gotchas
- **Serves:** AC-64 (repo part).
- **Do:** `docs/knowledge/gotchas.md` new section «Права й профіль (SPEC-11, <date>)» (Ukrainian), only facts met in this wave, e.g.: `disableDeleteAnonymousUser` leaves the guest's session row; partial unique index as the pass invariant and the `23505` outcome; `pg_stat_activity` barrier for race tests; zod must not reach the site bundle through http adapters; `allowDifferentEmails` scope; Better Auth `/unlink-account` blocks code+Google users; fingerprint TTL clock.
- **Files:** `docs/knowledge/gotchas.md`.
- **Done means:** entries present, each one line of fact + remedy.
- **Verify:** manual (conductor).
- **Rules that apply:** skill `docs-sync` (Ukrainian).
- **Risk:** low.

### W46 — Docs patch for root docs
- **Serves:** AC-64.
- **Do:** write `C:/Users/ADMIN/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/side-session-notes/local_359ad0f2-bcef-4e10-835b-0930d88a93eb/spec-11/docs-patch.md` (Ukrainian): `docs/backend/frontend-seam.md` §3.6/§3.7 (routes AC-58, reasons, `profile` event, `session` reasons; replace the stale «пас на пошті оплати» text by FR-ID-09 two paths), §3.11 rows, §6.1 (domains `auth`, `profile` on http), §8 (pass holiday `passNight`); `docs/site/account.md`, `pass.md`, `schedule.md` sections «Код» and «Відомі межі»; `docs/backend/alarms.md` rows `bans/fast-store-down` and the `auth/link-retry` handler names; `docs/backend/code-map.md` (`server/src/rights/**`, `domain/rights/**`, `packages/rules/src/schedule`); `alarms.md`: `auth/link-retry` give-up detail and the `auth-link-retry` job; Spec follow-ups 1–6 for the orchestrator.
- **Files:** the side-notes file (outside the repo).
- **Done means:** the orchestrator compares the patch with the route rows, ops rows and `HTTP_DOMAINS` (manual).
- **Verify:** manual (orchestrator).
- **Rules that apply:** root docs are changed only by the orchestrator.
- **Risk:** low.

## Execution

Single conductor; each dispatch is `sdd-engineering:implementer` with this plan's path, the phase id and `model` from the table; ~80 tool calls; out of budget → `PARTIAL` with the tree green after the last finished item. The conductor commits after each phase. Every phase ends with its targeted checks only (tsc/eslint/related vitest of touched packages, the int files it names); the full `verify` runs once in L.

| Lane / phase | Executor | Model | Work items | Files (disjoint across a parallel pair) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — Better Auth 1.7.28 | implementer | **opus** — re-baselines the library behaviour (spike S1/S9/S10) that the merge and deletion design rests on | W1, W2 | `server/package.json`, `pnpm-lock.yaml`, `server/test/integration/auth-spike.int.test.ts` | — | — | runs `pnpm install` alone; stack up |
| P2 — contracts, vocab, guards (Lane B) | implementer | sonnet | W3–W5 | `packages/contracts/src/{auth,auth.schemas,profile,profile.schemas,authGuard,profileGuard,schemas,index}.ts`, `packages/contracts/test/{auth,profile,guards}.test.ts`, `scripts/contract-surface.baseline.json`, `lib/api/contracts/{profile,auth}.ts`, `tests/unit/api/seam-vocabulary.test.ts` | P1 | P3 | unit only |
| P3 — shared schedule rule (Lane B) | implementer | sonnet | W6, W7 | `packages/rules/src/schedule/**`, `packages/rules/package.json`, `packages/rules/test/schedule.{table,test}.ts`, `lib/schedule/countryZone.ts`, `tests/unit/schedule/country-zone-rule.test.ts` | P1 | P2 | unit only |
| P4 — tables + migration | implementer | sonnet | W8–W10 | `server/src/migrations/**`, `server/src/payload-types.ts`, `server/src/auth/pool.ts`, `server/src/rights/ports.ts`, `server/src/test-doors/auth.ts`, `server/test/integration/rights-schema.int.test.ts` | P2, P3 | — | generator alone; migcheck DB |
| P5 — passes | implementer | **opus** — pass records, atomic attach and deterministic race tests (risk Р6) | W11–W14 | `server/src/domain/rights/{passSeason,passView}.ts`, `server/src/rights/{passes,events}.ts`, `server/src/auth/{response,forward,events}.ts`, `server/src/endpoints/deps.ts`, `server/test/unit/rights-pass-domain.test.ts`, `server/test/integration/{rights-pass,rights-pass-race,auth-perf}.int.test.ts` | P4 | P13 | shared lock |
| P13 — web adapters + sim (Lane B) | implementer | sonnet | W39–W41 | `lib/api/http/{profile,auth,domains,index}.ts`, `lib/api/sim/profile.ts` | P2, P3 | P5 | unit only |
| P6 — bans + fingerprint block | implementer | **opus** — bans, IP-fingerprint block, `isBlocked`, sign-in session hook | W15–W18 | `server/src/domain/rights/blocked.ts`, `server/src/rights/{bans,banMarks}.ts`, `server/src/auth/instance.ts`, `server/src/registries/{ops,middleware}.ts`, `server/src/adapters/sessionSubjects.ts`, `server/src/endpoints/deps.ts`, `server/test/unit/rights-blocked.test.ts`, `server/test/integration/rights-bans.int.test.ts` | P5 | — | shared lock |
| P7 — profile, nick, settings | implementer | sonnet | W19–W22 | `server/src/domain/rights/{nick,flags,settings}.ts`, `server/src/rights/{profiles,events}.ts`, `server/src/endpoints/{me,chatNick,types}.ts`, `server/src/registries/{routes,middleware,rateLimits}.ts`, `server/test/unit/rights-profile-domain.test.ts`, `server/test/integration/rights-profile.int.test.ts` | P6 | — | shared lock |
| P8 — schedule (server) | implementer | sonnet | W23–W25 | `server/src/domain/rights/schedule.ts`, `server/src/rights/schedule.ts`, `server/src/endpoints/me.ts`, `server/src/registries/routes.ts`, `server/test/unit/rights-schedule-rule.test.ts`, `server/test/integration/rights-schedule.int.test.ts` | P7 | — | shared lock |
| P9 — sign-in finish, merge, guest removal, retry job | implementer | **opus** — sign-in finish step, `authLinks` merge handlers, guest deletion conditions, retry job | W26–W29, W29b | `server/src/rights/links.ts`, `server/src/registries/authLinks.ts`, `server/src/auth/{options,merge,scope,forward,subjectData}.ts`, `server/src/domain/auth/{guestPrune,linkRetry}.ts`, `server/src/ops/{guestPrune,linkRetry,runner,ports}.ts`, `server/test/integration/{rights-signin,rights-merge,auth-merge,auth-guest-prune,auth-link-retry}.int.test.ts` | P8 | — | shared lock |
| P10 — email change + Google | implementer | **opus** — Better Auth link/unlink, own email-change code flow | W30–W33 | `server/src/domain/rights/signInMethods.ts`, `server/src/rights/emailChange.ts`, `server/src/mail/templates/changeEmailCode.ts`, `server/src/auth/{link,google}.ts`, `server/src/endpoints/meAccount.ts`, `server/src/registries/routes.ts`, `server/test/unit/rights-account-domain.test.ts`, `server/test/integration/{rights-email,rights-google}.int.test.ts` | P9 | P12 | shared lock |
| P12 — subject data + ban slice | implementer | sonnet | W36–W38 | `server/src/rights/subjectData.ts`, `server/src/registries/{subjectData,adminSlots}.ts`, `server/src/admin/{bansEndpoints,cmsEndpoints}.ts`, `server/src/admin/{BansSlice,BansView}.tsx`, `server/test/integration/{rights-subject-data,rights-bans-admin}.int.test.ts`, `server/test/unit/subject-data-registry.test.ts` | P9 | P10 | shared lock; server build HEAVY once (W38) — run after P10's int files, never with another heavy process |
| P11 — test doors | implementer | **opus** — test doors (security-routed) | W34, W35 | `server/src/test-doors/{rights,registry,auth}.ts`, `server/test/integration/rights-doors.int.test.ts` | P10, P12 | — | shared lock |
| P14 — behaviour suites (Lane B) | implementer | sonnet | W42–W44 | `tests/contract/{auth.suite,auth.http.test,profile.suite,profile.http.test}.ts`, `tests/unit/api/{auth-contract,profile-contract}.test.ts` | P11, P13 | — | http column needs `serve` (HEAVY) |
| P15 — docs (Lane B) | implementer | sonnet | W45, W46 | `docs/knowledge/gotchas.md`, side-notes `spec-11/docs-patch.md` | P14 | — | text only |
| L — integration pass | conductor | — | — | none | P15 + rebase on master | — | full `verify.yml`-equivalent once; migration-safety check 5 after rebase; `layout-fidelity` for `auth`/`profile` pages; then `security-reviewer`, architecture review |

Order: P1 → (P2 ∥ P3) → P4 → (P5 ∥ P13) → P6 → P7 → P8 → P9 → (P10 ∥ P12) → P11 → P14 → P15 → L. Files touched by several Lane-A phases (`server/src/endpoints/deps.ts`: P5, P6; `server/src/rights/events.ts`: P5, P7; `server/src/registries/middleware.ts`: P6, P7; `server/src/registries/routes.ts`: P7, P8, P10; `server/src/endpoints/me.ts`: P7, P8; `server/src/auth/forward.ts`: P5, P9; `server/src/test-doors/auth.ts`: P4, P11) are sequential by construction; no file appears in both members of a parallel pair (P2/P3, P5/P13, P10/P12 checked). 15 phases: 6 opus (P1, P5, P6, P9, P10, P11), 9 sonnet. At most two implementers run at once; int files serialize on the shared lock.

## Verification plan
| Command | Directory | Passing means |
|---|---|---|
| server files (per item) | `server/` | tsc, eslint, related unit tests green |
| contracts files + `node ../../scripts/contract-surface.mjs --check` | `packages/contracts/` | compiles, tests green, surface additive |
| rules files | `packages/rules/` | compiles, schedule table green |
| web files (per item) | repo root | tsc, eslint, related unit tests green |
| one int file (per listed file) | `server/` | green under the shared lock |
| migcheck + `node scripts/verify-schema.mjs` | `server/` | up/down/up clean; schema check green |
| server build (once, W38) | `server/` | `next build` succeeds |
| contract run (`node scripts/contract-run.mjs`, server served) | repo root | `auth`, `profile` green on sim and http; only «до SPEC-20» skips |
| Full `verify` (config `full` per package = `verify.yml` steps) | per config | once, in L only — not in any phase |

## Assumptions
- Raw SQL tables instead of Payload collections [П-1]; ids `uuid` via `gen_random_uuid()`.
- Rights services use Better Auth's pool (max 5) — the same pool that holds `users`; `get-session` adds one indexed query.
- Pass/ban/schedule time uses `deps.clock` (season clock, test-movable); fingerprint TTLs use the fingerprint clock [П-8].
- Rate-limit rows `me-profile`, `me-schedule`, `chat-nick-check` use `onStoreDown: 'memory'` (profile writes are not a security boundary; the email change uses the SPEC-10 fail-closed code rows).
- Fixture presets are doors, not seed rows [П-15].
- `homeZoneId` max length 32 and nick body max 64 chars (rules then cut to 20) are planner limits under NFR-4's 4 KB.
- `Ctx.subjectKind` is added (rather than re-querying `users.is_anonymous`) because the subject resolver already knows the kind (research-code §4).

## Open questions
(none — spec gaps are listed under Spec follow-ups and are planned as written; the only stop-and-report is W2's S10 outcome)

## Research used
- `…/side-session-notes/…/spec-11/research-code.md` — repo facts with file:line (contracts, sim, suites, merge, prune, subject data, routes, errors, verdict, fingerprint, catalog, migrations, doors, admin).
- `…/spec-11/research-better-auth.md` — `onLinkAccount` order and failure, `disableDeleteAnonymousUser`, race design and deterministic tests, own email change, link/unlink, 1.7.28 fixes.
- Planner reads: `server/src/auth/merge.ts:1-117`, `server/src/auth/response.ts:95-124`, `server/src/registries/{authLinks,subjectData}.ts`, `server/src/ops/guestPrune.ts`, `server/src/domain/auth/guestPrune.ts`, `server/src/test-doors/{registry.ts:80-110,auth.ts:85-100}`, `lib/api/http/{domains,index,auth}.ts`, `lib/schedule/countryZone.ts:1-70`, `packages/contracts/src/{auth,index,schemas,siteGuard}.ts`, `packages/rules/package.json`, `scripts/check-bundle.mjs:1-30`, `server/scripts/lib/worktree.mjs:66-87`, `docs/knowledge/gotchas.md`, `specs/002-backend/spec.md:636-660`, `docs/plans/SPEC-10-auth-mail.plan.md`.

## Rollback / blast radius
- Revert the branch: the migration only adds three tables and one unique index on `user_accounts`; `down` drops them; SPEC-13a rollback swaps the image and never runs `down` — the old image ignores the tables and the index (a duplicate Google row it might try to insert would now fail with a unique violation, which is the intended invariant).
- Behaviour changes in production: `get-session` returns real pass fields; guests are no longer deleted by Better Auth on sign-in (removed by our step or by prune); the site's `auth` and `profile` domains switch to `http` (visible to visitors — `layout-fidelity` in L); new `/api/me/*`, `/api/chat/nick-check`, `/cms-api/bans/*` routes; one Redis write per subject request (`27-ban-mark`).
- Shared local resources: none added; the race test uses two extra connections to the worktree test DB only.
