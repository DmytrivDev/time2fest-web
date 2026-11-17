# Implementation plan: Server skeleton (SPEC-02)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-02-server-skeleton.md` (Status: approved, 0 `[NEEDS CLARIFICATION]` markers). AC-1 … AC-72, NFR-1 … NFR-8.
This plan implements those requirements; it does not define or change them.
**Execution mode** — multi-phase, sequential, with one 2-lane phase (P2: L2a ∥ L2b, disjoint files). The orchestrator settled this mode in its brief (2026-11-16). There is one `sdd-engineering:implementer` dispatch per phase or lane, with the plan path and the phase or lane id. The model for each dispatch comes from the `Model` column of `## Execution`.
**Out of scope** — everything in the spec's `Non-goals` (spec lines 23-33):
- domain logic and domain collections;
- the AI, YouTube and PayPro fakes, and minio;
- the fields, access and sign-in of `admins`, and the rehearsal clock admin;
- Better Auth and the `auth` schema;
- client/server clock reconciliation (FR-CLK-15). `lib/time/**`, `packages/rules/**`, `lib/engine/**`, `lib/toast/season.ts` and `lib/rating/**` are not touched;
- the moment scheduler, beyond an empty registry;
- Centrifugo channels and publishing, beyond the prefix;
- the real IP fingerprint;
- Telegram alarms;
- `board-tools/http-seeds.mjs`, `compare-live.mjs` and the root Playwright `http` config (SPEC-04);
- e2e, time-machine scenarios and board comparison in CI;
- Node or Payload above 3.91.0;
- pushing or running CI on GitHub.

Architecture and security review are performed by separate agents.

Repository root for every path below = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-02-server-skeleton` (branch `spec-02-server-skeleton`, slot 4 by AC-7, slug `spec_02_server_skeleton`). **Do not commit. Never push.** Never create junctions or symlinks to another checkout's `node_modules`. Machine: 16 GB, Node v22.12.0, pnpm 12.4.2. Vitest `--maxWorkers=2`, server integration `--maxWorkers=1` (serial), Playwright `--workers=2`.

**Concurrent wave SPEC-03 owns these files — never edit them:** `packages/rules/**`, `lib/engine/**`, `lib/toast/season.ts`, `lib/rating/**`, `lib/time/**`. Site components, styles, `messages/`, tokens are not edited either.

## Requirements traceability
| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | `pnpm stack` starts 4 services, waits healthy, creates DBs, migrates, seeds, serves on slot port | spec:49 | W4, W12, W18, W20 | W24 + W29 `Done means` |
| AC-2 | AC-1 + smoke with outbound network off | spec:52 | W20 | W29 (manual, heavy) |
| AC-3 | `stack:down`/`stack:up` keep volumes and rows | spec:55 | W4, W20 | W24 exclusive test, run in W29 |
| AC-4 | `fakes/{ai,youtube,paypro}/` with one placeholder each, no fake service in compose | spec:58 | W4 | W4, W28 |
| AC-5 | Docker unreachable → non-zero exit naming Docker before any DB step | spec:61 | W20 | W24 |
| AC-6 | Slot port busy (server or static server) → non-zero exit naming the port | spec:64 | W20, W21 | W24 |
| AC-7 | Slot function 0 / 2·NN / 2·NN+1 | spec:69 | W6 | W6 |
| AC-8 | Ports `4000+10·slot+offset`, all distinct, max 4475 | spec:72 | W6 | W6 |
| AC-9 | Unmatched branch without `T2F_SLOT` → refuse naming branch and `T2F_SLOT` | spec:75 | W6 | W6 |
| AC-10 | Isolation values from slug; slug `[a-z0-9_]`, ≤40 | spec:78 | W6 | W6 |
| AC-11 | Redis has 64 databases | spec:81 | W4 | W24 |
| AC-12 | Two worktrees in parallel do not see each other's rows, keys, mails | spec:84 | W6, W12, W16, W24 | W29 (heavy, two worktrees) |
| AC-13 | Ordinary run takes shared lock, waits on exclusive holder | spec:89 | W7 | W7 |
| AC-14 | Exclusive waits for all holders | spec:92 | W7 | W7 |
| AC-15 | Wait > 30 min → exit naming holder, mode, start time | spec:95 | W7 | W7 |
| AC-16 | Lease > 60 min → takeover + journal `takeover` line | spec:98 | W7 | W7 |
| AC-17 | Lock dir = main checkout `.claude/sdd/locks/` via `git rev-parse --git-common-dir`, `T2F_LOCK_DIR` override, journal | spec:101 | W7 | W7 |
| AC-18 | `T2F_ENV` class, unknown → `production` | spec:106 | W8 | W8 |
| AC-19 | Env schema failure → exit non-zero before listening, names without values | spec:109 | W8, W11, W20 | W8, W20 |
| AC-20 | test/rehearsal with denylisted resource or PayPro not sandbox → refuse | spec:112 | W8 | W8 |
| AC-21 | rehearsal = production for doors, real time for clock | spec:115 | W15 | W15 |
| AC-22 | Rejections use the `ApiResult` failure body | spec:120 | W10, W13 | W13 |
| AC-23 | Code → HTTP status map | spec:123 | W13 | W13 |
| AC-24 | Schema failure → `validation`/`invalid-input`, handler not run | spec:126 | W10, W13 | W13 |
| AC-25 | Reasons `invalid-input`, `in-progress`, `lock-required` added additively | spec:129 | W10 | W10 |
| AC-26 | Unexpected throw → `unknown`, no stack, logged | spec:132 | W13 | W13 |
| AC-27 | No interface text; `message` = field path or log id | spec:135 | W13 | W13 |
| AC-28 | Mutating request with absent/foreign `Origin` → `forbidden` unless the route has the exemption flag | spec:138 | W13 | W13 |
| AC-29 | Doors module imported only for `T2F_ENV=test` + `T2F_TEST_DOORS=1` | spec:143 | W15 | W15 |
| AC-30 | Production: `/api/_test/*` 404 identical to unknown path | spec:146 | W13, W15, W27 | W29 (e2e, heavy) |
| AC-31 | Headers/params/cookies never enable doors | spec:149 | W15, W27 | W15 + W29 |
| AC-32 | Four stub doors → 501 `unavailable` | spec:152 | W15 | W15 |
| AC-33 | Dependency-breaking door without exclusive lock → 403 `lock-required` | spec:155 | W15 | W15 |
| AC-34 | Time only through `server/src/clock` (lint rule) | spec:160 | W2, W9 | W9 |
| AC-35 | Clock `at` set → `at` then advance | spec:163 | W9, W15 | W15 |
| AC-36 | Speed `s` advances `s` ms per ms | spec:166 | W9, W15 | W15 |
| AC-37 | Frozen clock returns the same instant | spec:169 | W9, W15 | W15 |
| AC-38 | Bad speed/at → 400 `invalid-input`, state kept | spec:172 | W10, W15 | W15 |
| AC-39 | Reset or restart → real time, speed 1, not frozen | spec:175 | W9, W15, W18 | W15 + W29 (restart) |
| AC-40 | `GET /api/time` bare `{now}` + three headers, no envelope | spec:178 | W14 | W14 |
| AC-41 | Production clock real, no setter | spec:181 | W9 | W9 |
| AC-42 | Integration build with server clock frozen at X → site time within 2 000 ms | spec:184 | W21, W27 | W29 (e2e, heavy) |
| AC-43 | Static server serves `out-int` on web port, proxies `/api/*`, node built-ins only | spec:187 | W21 | W24 |
| AC-44 | `/api/*` dev rewrite only for test + http under `next dev` | spec:190 | W22 | W22 |
| AC-45 | Seed reads only allowed sources; no `research_data` reference | spec:195 | W18, W25 | W18, W25 |
| AC-46 | Seed twice → same counts | spec:198 | W18 | W18 |
| AC-47 | Reset empties own rows and prefixed keys, resets clock, seeds; others untouched | spec:201 | W18 | W18 |
| AC-48 | Rate-limit row requires limit, window, key kinds, Redis-down policy | spec:206 | W16 | W16 |
| AC-49 | Over limit → `rate_limited` with `retryAfterMs > 0` | spec:209 | W16 | W16 |
| AC-50 | Redis down → per-row policy | spec:212 | W16 | W29 (exclusive, heavy) |
| AC-51 | `ipDay` from a stub that reads no address header | spec:215 | W16 | W16 |
| AC-52 | Same `clientId`+subject+method → stored result, handler once | spec:220 | W17 | W17 |
| AC-53 | Different subject or method → new request | spec:223 | W17 | W17 |
| AC-54 | Concurrent duplicate → `conflict`/`in-progress` | spec:226 | W17 | W17 |
| AC-55 | Retention class required; `chat` TTL ≥ 86 400 s; `order` in Postgres | spec:229 | W11, W17 | W17 |
| AC-56 | Alarm `page`/`log` writes one line, never throws | spec:234 | W8 | W8 |
| AC-57 | Subject-data registry: all results or the names of the failed capabilities | spec:237 | W19 | W19 |
| AC-58 | One auth collection `admins`, no `users` table | spec:242 | W11, W12 | W12 |
| AC-59 | Schema only via Payload migrations, push off, only `public` | spec:245 | W11, W12 | W12 |
| AC-60 | GraphQL, playground, `/api/<collection>` → 404; REST under a non-public prefix | spec:248 | W11, W13 | W13 + W24 |
| AC-61 | Test class listens on loopback only | spec:251 | W20 | W24 |
| AC-62 | One sorted, duplicate-free registry per shared thing, statically checked | spec:256 | W8, W11, W13, W15, W16, W18, W19 | W8 + W19 |
| AC-63 | Working `server` `files`/`full` + "Test doors" check naming `T2F_ENV=test`, `T2F_TEST_DOORS=1` | spec:259 | W5 | W28 |
| AC-64 | Contract runner: all domains on sim, http only for served ones, others `no server` | spec:262 | W23 | W23 + W28 |
| AC-65 | CI workflow: server unit, server integration (PG+Redis services), sim contract suites, secret check, research_data check | spec:265 | W25 | W28 (local run of the same steps) |
| AC-66 | Five skills describe this stand, no "SPEC-01 creates" | spec:268 | W26 | W26 |
| AC-67 | No site file changes outside the allowed list | spec:273 | W3, W22, W20 | W28 |
| AC-68 | Site typecheck/lint/unit exclude `server/`; `server` is a workspace project | spec:276 | W1, W3 | W28 |
| AC-69 | Sim only in the demo build; `vercel.json` unchanged; `build:demo` passes; bundle guard green | spec:279 | W22 | W28 |
| AC-70 | Docs patch for the root in the report, root not edited | spec:282 | W30 | W30 |
| AC-71 | Server down → static server 502 empty body | spec:287 | W21 | W24 |
| AC-72 | Postgres down → `unavailable`; `/api/time` still 200 | spec:290 | W13 | W29 (exclusive, heavy) |
| NFR-1 | Memory caps 1 GB PG, 256 MB others | spec:324 | W4 | W4 |
| NFR-2 | Only the listed new deps, exact pins, justified | spec:327 | W1 | W1 + `## Dependency justification` |
| NFR-3 | Secrets only in env | spec:330 | W2, W8, W25 | W25 |
| NFR-4 | Logger and alarm mask secret values | spec:333 | W8 | W8 |
| NFR-5 | ≤2 workers; integration exactly 1 | spec:336 | W2, W5 | W28 |
| NFR-6 | `pnpm stack` to listening ≤120 s (images pulled) | spec:339 | W20 | W29 (measured) |
| NFR-7 | Cookies `SameSite=Lax` + `HttpOnly` | spec:342 | W11 | W24 |
| NFR-8 | `/api/time` p95 ≤50 ms over 1 000 sequential local requests | spec:345 | W14 | W24 |

All 72 ACs and 8 NFRs are mapped. No AC is unmapped.

## Spec follow-ups
Addressed to `spec-creator` and the owner. The plan implements the spec as written; each item says how.

1. **AC-42 observation point.** In the test build the site's time source is the `TimeMachine`, not `TimeSource` (`lib/time/params.ts:171-190`). So "the site's time source" can never report the server clock in `NEXT_PUBLIC_ENV=test`, and changing that would mean editing `lib/time/**`, which is a Non-goal owned by SPEC-03/SPEC-07. The site's own server-time path in that build is the `<head>` prefetch of `/api/time`: `app/layout.tsx:30` and `lib/time/timePrefetch.ts:15`, exposed as `window.__t2fTimePrefetch`. In the test build that prefetch is never consumed, because `TimeSource` is not created. W27 reads `await window.__t2fTimePrefetch.promise` and checks that `now` is within 2 000 ms of X. A later spec (SPEC-07) should reword AC-42 once the client follows the server clock.
2. **AC-66 wording.** The stale text in the five skills reads "SPEC-01 must create", "TODO until SPEC-01", "after S01" and so on, not the literal "SPEC-01 creates". W26 removes every SPEC-01-as-server-owner phrase. Its check greps for `SPEC-01` and `S01` in those five files, with an allowlist of zero lines.
3. **AC-64 "domains served by the server"** is not defined. The plan defines it as "a domain that has `tests/contract/<domain>.http.test.ts`". In this wave that is only `time`.
4. **AC-19 "before listening".** Next binds its port before `instrumentation.register()` runs. The plan therefore validates the environment in a preflight process before it spawns `next` (W20). It also validates in `instrumentation.ts` as a second guard (W11).
5. **Open question 2 of the spec** (the orchestrator confirms AC-23 status map, AC-32 501 body, AC-33 `lock-required`). The plan implements them as written. A changed decision would be a new spec.
6. **`.graphifyignore`** is not tracked: it is listed in `.git/info/exclude:9` of the main checkout, so no commit can carry it. AC-67 lists it as an allowed change. The wave therefore leaves it untouched, and the orchestrator applies the line in the main checkout (see `## Docs patch`).

## Affected surface
The current routing table (`D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1) routes onion only for `server/src/{domain,chat,jobs}/**`. Server files outside those folders are listed with **onion-architecture (proposed row, see Docs patch)** and counted as coverage gaps until the orchestrator extends the row.

| File | New/Mod | Package | Home (ring) | Skills that will govern it | Constraint to respect |
|---|---|---|---|---|---|
| `pnpm-workspace.yaml` | Mod | web | workspace | — (unrouted) | Add `- 'server'` only; keep `allowBuilds` entries, add one only if install reports an ignored build script (`pnpm-workspace.yaml:4-12`) |
| `pnpm-lock.yaml` | Mod | web | generated | — (unrouted) | `lockfileVersion: '9.0'` unchanged; only additions for `server` and the contracts `zod` |
| `package.json` (root) | Mod | web | scripts | `engineering-paved-path:security` (`**/package.json`) | Scripts only; `dependencies` and `devDependencies` byte-identical (AC-67) |
| `tsconfig.json` (root) | Mod | web | config | — | Exactly one added line `"server"` in `exclude` (`tsconfig.json:42-49`). Never stage the main checkout's local edit (EC-19) |
| `eslint.config.mjs` (root) | Mod | web | config | — | Add `'server/**'` to the `ignores` array (`eslint.config.mjs:9`), nothing else |
| `next.config.ts` (root) | Mod | web | config | `engineering-paved-path:next-best-practices` | `rewrites` key only when `TEST_BUILD && API_MODE === 'http' && NODE_ENV !== 'production'` (`next.config.ts:12-17`); export config otherwise identical |
| `docker-compose.yml` | New | server | infra | `engineering-paved-path:security` (`**/docker-compose*.yml`) | Ports bound to `127.0.0.1`; memory caps (NFR-1); no `fake*` service; no secret values |
| `fakes/{ai,youtube,paypro}/.gitkeep` | New | server | placeholder | — | Exactly three files (AC-4) |
| `.claude/sdd-engineering.json` | Mod | — | pipeline config | — (unrouted) | Replace the two `server` TODO commands (`:23-28`) and the "Test doors" `check` (`:50-53`); keep everything else |
| `.github/workflows/verify.yml` | Mod | — | CI | `engineering-paved-path:security` (`.github/workflows/**`) | `permissions: contents: read` kept; service containers; mirrors config `full` |
| `.claude/skills/{local-stack,seed-and-fixtures,migration-safety,layout-fidelity,contract-conformance}/SKILL.md` | Mod | — | skills | — (`**/*.md` unrouted) | Facts from this plan only (AC-66) |
| `packages/contracts/package.json` | Mod | contracts | package | `engineering-paved-path:security`, `contract-conformance` | Add `zod` (exact) and the export `"./schemas"` |
| `packages/contracts/src/result.ts` | Mod | contracts | ring 1 (wire vocabulary) | `onion-architecture`, `contract-conformance` | Additive only (`result.ts:1-44`); existing exports unchanged |
| `packages/contracts/src/schemas.ts` | New | contracts | ring 1 | `onion-architecture`, `contract-conformance` | zod only; not re-exported from `index.ts`, so the site bundle stays zod-free |
| `packages/contracts/test/{platform-reasons,schemas}.test.ts` | New | contracts | test | `contract-conformance` | node env (`packages/contracts/vitest.config.ts`) |
| `scripts/contract-surface.baseline.json` | Mod | web | generated | — | Only via `node scripts/contract-surface.mjs --update` (no `--breaking`) |
| `scripts/contract-run.mjs` | New | web | tooling | — (gap) | Node built-ins only; per-domain table |
| `scripts/check-secrets.mjs`, `scripts/check-research-data.mjs` | New | web | tooling | `engineering-paved-path:security` → Secret Detection | Read-only scans; exit 1 on a hit |
| `tests/contract/time.suite.ts`, `tests/contract/time.http.test.ts`, `tests/contract/vitest.http.config.ts` | New | web | test | `contract-conformance` | Suite shape `describeDomain(makeService, ctx)` (skill §2); http run serial |
| `tests/unit/api/time-contract.test.ts` | New | web | test | `contract-conformance` | sim run against `functions/api/time.ts:2-10` |
| `tests/unit/next-config.test.ts` | New | web | test | — (gap) | `// @vitest-environment node` |
| `server/package.json` | New | server | package | `engineering-paved-path:security` | Exact versions; `payload`/`@payloadcms/*` = `3.91.0` |
| `server/tsconfig.json`, `server/vitest.config.ts`, `server/vitest.integration.config.ts`, `server/vitest.stack.config.ts`, `server/eslint.config.mjs`, `server/next.config.mjs`, `server/playwright.config.ts` | New | server | config | `next-best-practices` (`server/next.config.*`) | Worker caps (NFR-5); Date ban (AC-34) |
| `server/.env.example` | New | server | config | `engineering-paved-path:security` (`**/.env*`) | Names only, no values (NFR-3) |
| `server/scripts/lib/worktree.mjs` | New | server | tooling | — (gap) | Node built-ins only (it is imported by `serve-int.mjs`, AC-43) |
| `server/scripts/lib/lock.mjs`, `server/scripts/lock.mjs` | New | server | tooling | — (gap) | Node built-ins only; atomic `mkdir` mutex |
| `server/scripts/db.mjs` | New | server | tooling | — (gap) | Creates only `t2f_<slug>`, `t2f_<slug>_test`, `t2f_<slug>_migcheck`; drops only `_migcheck` |
| `server/scripts/stack.mjs`, `server/scripts/serve-int.mjs`, `server/scripts/verify-schema.mjs` | New | server | tooling | — (gap) | `serve-int.mjs`: `node:*` only |
| `server/src/ports.ts` | New | server | ring 2 | `onion-architecture` (proposed) | Technology-neutral interfaces only |
| `server/src/platform/{registry,env,logger}.ts` | New | server | ring 1 (`registry`, `env` parse) / ring 4 (`logger` writes stdout) | `onion-architecture` (proposed), `security` → A09 | No import of `ioredis`, `pg`, `payload`, `next` in `platform/**` except `logger.ts` (node `process.stdout` only) |
| `server/src/platform/{rateLimit,idempotency,subjectData}.ts` | New | server | ring 3 | `onion-architecture` (proposed) | Depend on `ports.ts` only (ban 2) |
| `server/src/clock/index.ts` | New | server | ring 4 adapter of time, with a pure core | `onion-architecture` (proposed) | The only file allowed `Date.now()`/`new Date()` (AC-34) |
| `server/src/registries/{env,collections,routes,middleware,rateLimits,moments,subjectData}.ts` | New | server | composition (ring 4 wiring) | `onion-architecture` (proposed) | Sorted, unique rows (AC-62) |
| `server/src/adapters/{redis,payload}.ts` | New | server | ring 4 | `onion-architecture` (proposed), `security` | Implement `ports.ts`; map connection errors to `DependencyUnavailable` |
| `server/src/container.ts` | New | server | composition root | `onion-architecture` (proposed) → §4 | Lazy singletons on `globalThis`; Payload only when a route needs `db` |
| `server/src/endpoints/{pipeline,types,time}.ts` | New | server | ring 4 (driving adapter) | `security`, `contract-conformance` | Routes delegate; no SQL in routes (ban 1) |
| `server/src/app/api/[[...path]]/route.ts` | New | server | ring 4 | `next-best-practices` (`server/src/app/**`) | Single catch-all so the clock singleton lives in one module graph |
| `server/src/test-doors/{index,registry}.ts` | New | server | ring 4 | `security` | Loaded by dynamic `import()` only under `T2F_ENV=test` and `T2F_TEST_DOORS=1` |
| `server/src/seed/{index,registry,cli}.ts` | New | server | ring 3 / CLI | `seed-and-fixtures` | Allowed sources only (AC-45); idempotent |
| `server/src/payload.config.ts` | New | server | Payload config | `migration-safety` | `push: false`, `graphQL.disable`, `routes.api: '/cms-api'`, `admin.user: 'admins'` |
| `server/src/collections/{admins,idempotencyRecords}.ts` | New | server | Payload | `migration-safety` | Thin; access `() => false` on idempotency |
| `server/src/migrations/*` | New (generated) | server | generated | `migration-safety` | Only `pnpm --dir server migrate:create initial` |
| `server/src/payload-types.ts` | New (generated) | server | generated | — (unrouted, generated) | Only `pnpm --dir server generate:types` |
| `server/src/app/(payload)/{layout.tsx,custom.css,admin/importMap.js,admin/[[...segments]]/page.tsx,admin/[[...segments]]/not-found.tsx,cms-api/[...slug]/route.ts}` | New | server | Payload app | `next-best-practices` | Blank template v3.91.0 shape (see W11) |
| `server/src/instrumentation.ts` | New | server | boot guard | `next-best-practices` | Exits non-zero on env failure |
| `server/test/**` | New | server | tests | — (gap: no row matches `server/test/**`) | Unit `--maxWorkers=2`, integration and stack `--maxWorkers=1` |

**Coverage gaps:**
- These server folders are outside the current onion row (proposed row in the Docs patch): `server/scripts/**`, `server/src/{ports.ts,platform,clock,registries,adapters,container.ts}`.
- `server/test/**`, `tests/unit/next-config.test.ts`, `scripts/contract-run.mjs`.
- Always unrouted: `**/*.md`, `pnpm-lock.yaml`, `scripts/contract-surface.baseline.json`, `.claude/sdd-engineering.json`, `server/src/payload-types.ts`, `server/src/migrations/*`, `server/src/app/(payload)/admin/importMap.js`.

## Contract changes
- **Shared contracts / schemas:** yes. These are additive, in `packages/contracts`:
  - the type `PlatformReason = 'invalid-input' | 'in-progress' | 'lock-required'` and `PLATFORM_REASONS` in `src/result.ts`;
  - the new `src/schemas.ts` (zod), exported as `@time2fest/contracts/schemas`.

  There are no duplicated copies; `lib/api/result.ts` re-exports the package. `node scripts/contract-surface.mjs --update` then `--check` (W10).
- **Migration:** yes. It is the first migration, `initial`, and creates:
  - the `admins` auth collection (email and password from `auth: true`);
  - `idempotency_records`;
  - Payload internals (`payload_migrations`, `payload_preferences`, `payload_locked_documents` and their rels).

  It is generated by `pnpm --dir server migrate:create initial` (`payload migrate:create`, research: `packages/payload/src/bin/migrate.ts:72`, needs no live DB). It is never hand-written. Push is off (`postgresAdapter({ push: false })`), and only schema `public` is used. The skill is `migration-safety`, checks 1-7, in W12.
- **Seed / fixture data:** yes (mechanism only). The seed registry is empty in production code. Tests register a test row to prove idempotency (AC-46) and reset (AC-47). `POST /api/_test/fixtures` applies a named seed row. Sources are restricted to the AC-45 list, and nothing is read from `research_data`. The skill is `seed-and-fixtures` §1, §3 and §4.
- **Build-only failures:** yes. There are three:
  1. `server/next.config.mjs` plus Payload's `withPayload` and the `(payload)` app only fail in `next build` (CSS import, server/client boundary, `importMap`). W27 runs `pnpm --dir server build` before the production e2e.
  2. The root `next.config.ts` change can break the site export while `tsc` stays green. W28 runs `web` `full` (includes `next build`) and `pnpm build:demo`.
  3. `packages/contracts/src/schemas.ts` must not enter the site bundle. Only tests import `@time2fest/contracts/schemas`, and W28 greps `out-verify/_next/static` for `ZodError`, which must find nothing.
- **Wire contract:** yes.
  - Server routes: `GET /api/time` (existing edge contract, now also on the server), `GET|POST /api/_test/clock`, `POST /api/_test/{reset,fixtures,last-code,paypro-webhook,video-status,moderation}`.
  - Three new reasons.
  - The `ApiResult` failure body with the AC-23 status map.

  `contract-conformance`:
  - the `time` suite runs on sim (`functions/api/time.ts`) and on http (the server) through `pnpm contracts:run` (W23);
  - the `frontend-seam.md` §3.11 rows are in the Docs patch.
- **Layout fidelity:** no board capture. This wave switches no domain to `http` and changes no rendering file. The only site changes are the `tsconfig`/ESLint exclusions (no output effect) and a `rewrites` key that exists only under `next dev` with test + http. Unchanged boards (FR-MIG-02) are proven cheaply in W28:
  - (a) the AC-44 unit test shows the export config is unchanged for every production phase;
  - (b) `pnpm build:demo` passes;
  - (c) the existing time-machine and production e2e run against the test and production builds: `tests/e2e/us8-time-machine.spec.ts` on `phone` and `desktop`, and `tests/e2e/us8-production.prod.spec.ts` on `prod`, with `--workers=2`;
  - (d) `git diff master --name-only` shows no file under `app/`, `components/`, `styles/`, `messages/`, `lib/`, `stores/` or `public/`.
- **Payload migration:** yes, see Migration above (`migration-safety`, W12).
- **Test doors:** yes. Doors are registered only when `T2F_ENV=test` and `T2F_TEST_DOORS=1`, through a dynamic `import()` (W15). The production build test (W27, run in W29) proves that every `/api/_test/*` path returns a 404 identical to an unknown path, including with `X-T2F-Test-Doors: 1`, `?doors=1` and the cookie `t2f_env=test`. The contract check text in `.claude/sdd-engineering.json` is updated to `T2F_ENV=test` (W5).
- **Agent write surface:** no. No role, API key or agent write endpoint is added.
- **Seed and fixtures:** yes, see Seed above.

## Dependency justification
Constitution IX (`D:/Work/Pets/Time2Fest/.specify/memory/constitution.md:129`) and spec A-2 (`D:/Work/Pets/Time2Fest/specs/002-backend/spec.md:1144`) require a justification for every new dependency or service. All versions are pinned **exactly**, with no `^`.

| Dependency / service | Where | Version rule | Why (one line) | Alternative considered |
|---|---|---|---|---|
| `payload`, `@payloadcms/next`, `@payloadcms/ui`, `@payloadcms/db-postgres` | `server` | `3.91.0` exactly | Constitution IX names Payload 3 + Postgres as the server. 3.91.0 is the newest release that runs on Node 22.12.0 (3.92+ needs ^22.23.4, spec:32). Peers accept `next >=16.3.3 <17` and `react ^19.2.1` (research, `@payloadcms/ui@3.91.0` package.json) | — (decided) |
| `graphql` | `server` | exact version pnpm resolves for `^16.8.1` | A hard peer of `payload`/`@payloadcms/next`, even though GraphQL is disabled (research §2) | none: the peer is mandatory |
| `next` 16.4.1, `react`/`react-dom` 19.3.0 | `server` | same as the site (`package.json:30-35`) | Payload's admin and route handlers run in Next. The same versions mean no new resolution | — |
| `zod` | `packages/contracts` (+ `server`, same version) | `pnpm add --save-exact zod@4` (reuse the exact 4.x already in the lockfile if Payload brings one) | NFR-2 allows one runtime validation library. AC-24 and contract-conformance §1 need one schema that is both the TS type and the boundary check | hand-written validators: two sources of truth, no `z.infer` |
| `ioredis` | `server` | `--save-exact ioredis@5` | Redis client. Has per-connection `db` (Redis DB = slot, AC-10), `enableOfflineQueue:false` and `maxRetriesPerRequest:0` for fail-fast (AC-50), `SCAN MATCH` for prefix reset (AC-47) | `redis` (node-redis): equally fine, but offline-queue control is less direct |
| `pg`, `@types/pg` | `server` | `pg` = the exact version `@payloadcms/db-postgres@3.91.0` resolves (one copy in the lockfile); `@types/pg` exact latest 8.x | `CREATE DATABASE` for worktree DBs (AC-1), table counts and unique-insert for the `order` idempotency class (AC-55), connection-error mapping (AC-72) | importing Payload's transitive `pg`: a phantom dependency under pnpm |
| `tsx` | `server` (dev) | the exact version `payload@3.91.0` depends on (research: 4.23.15 — confirm in the lockfile) | Runs the TS env preflight (AC-19) and the seed CLI. Already in the lockfile, so no new package | `node --experimental-strip-types` (requires `.ts` import specifiers in code Next also bundles) |
| Dev tooling: `typescript` 5.9.3, `vitest` 5.0.3, `@types/node` 22.19.0, `@types/react` / `@types/react-dom` 19.3.0, `eslint` 9.39.5, `@eslint/js` 9.39.5, `typescript-eslint` 8.72.0, `globals` 17.13.0, `cross-env` 10.1.0, `@playwright/test` 1.64.0 | `server` (dev) | root versions (`package.json:39-79`) | No new resolution | — |
| **Redis** service (`redis:7.4-alpine`, exact patch tag pinned) | compose | — | A-2 (accepted 2026-11-16, `spec.md:36,1144`): rate limits, pulses and the `chat` idempotency class need a fast store with TTL. Postgres would put hot-path counter writes on the database that must stay healthy on the night | Postgres-only (UNLOGGED tables, advisory locks): rejected in A-2 |
| **Postgres** (`postgres:17-alpine`, exact patch tag), **Centrifugo** (`centrifugo/centrifugo:v6`, exact tag), **Mailpit** (`axllent/mailpit`, exact tag) | compose | — | Postgres and Centrifugo are named by constitution IX. Mailpit is a local-only SMTP sink (`local-stack` skill), so no mail ever leaves the machine | — |

No other runtime dependency is allowed. There is no `sharp`, no `@payloadcms/richtext-lexical` and no `sass`: the Payload template's `custom.scss` becomes `custom.css`.

## Work items

Commands in **Verify** lines:
- **server targeted** = in `server/`: `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`. This is the config `files` entry after W5.
- **server integration** = in `server/`: `pnpm test:int -- <file>`.
- **contracts targeted** = the config entry for `packages/contracts`.
- **web targeted** = the config entry for `.`.

### W1 — Workspace project `server` and every new dependency (P1)
- **Serves:** NFR-2, AC-68; enables every other item (lockfile rule: new deps only in this phase).
- **Do:**
  1. Record `node --version` (expect v22.12.0) and `pnpm --version` (expect 12.4.2) for the report.
  2. `pnpm-workspace.yaml`: add `  - 'server'` under `packages`.
  3. Create `server/package.json`:
     - name `@time2fest/server`, `private: true`, `type: module`, `engines.node: ">=22.12"`;
     - dependencies: `@time2fest/contracts: workspace:*`, `payload`, `@payloadcms/next`, `@payloadcms/ui`, `@payloadcms/db-postgres` (all `3.91.0`), `next: 16.4.1`, `react: 19.3.0`, `react-dom: 19.3.0`, `graphql`, `zod`, `ioredis`, `pg`;
     - devDependencies as in `## Dependency justification`.
     - Scripts (final names; later items fill the files they call):
       ```json
       "typecheck": "tsc --noEmit -p .",
       "lint": "eslint .",
       "test": "vitest run --maxWorkers=2",
       "test:int": "node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts --maxWorkers=1",
       "test:int:exclusive": "cross-env T2F_EXCLUSIVE=1 node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.integration.config.ts --maxWorkers=1",
       "test:stack": "node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.stack.config.ts --maxWorkers=1",
       "test:e2e": "playwright test --workers=2",
       "payload": "payload",
       "migrate": "payload migrate",
       "migrate:status": "payload migrate:status",
       "migrate:down": "payload migrate:down",
       "migrate:create": "payload migrate:create",
       "generate:types": "payload generate:types",
       "generate:importmap": "payload generate:importmap",
       "schema:check": "node scripts/verify-schema.mjs",
       "seed": "tsx src/seed/cli.ts",
       "env:check": "tsx src/platform/env.check.ts",
       "serve": "node scripts/stack.mjs serve",
       "build": "next build",
       "start": "node scripts/stack.mjs start"
       ```
  4. `packages/contracts/package.json`:
     - add `"dependencies": { "zod": "<exact>" }`;
     - add the export `"./schemas": "./src/schemas.ts"` next to `"."`.
  5. Install in two steps, so the pins come from the lockfile and are not guessed:
     - (a) `pnpm install` with Payload, `graphql` and `tsx` written as `3.91.0` / `^16.8.1` / `*` temporarily;
     - (b) read the resolved `graphql`, `pg` (under `@payloadcms/db-postgres`) and `tsx` (under `payload`) versions from `pnpm-lock.yaml`. Write them exactly into `server/package.json`, and add `zod`, `ioredis` and `@types/pg` with `pnpm --dir <pkg> add --save-exact`. Run `pnpm install` once more.
  6. If install prints "Ignored build scripts", add each package to `allowBuilds`:
     - `true` only if the server needs it at runtime (none is expected);
     - otherwise `false`;
     - record why.
  7. Lockfile check:
     - `grep -n "lockfileVersion" pnpm-lock.yaml` is still `'9.0'`;
     - `git diff --stat pnpm-lock.yaml` adds the `server` importer and the contracts `zod` only;
     - **if `lockfileVersion` changed or the site's packages were re-resolved, STOP and report BLOCKED.**
  8. Peer check: `pnpm --dir server ls next react payload --depth 0` shows one `next@16.4.1` and one `react@19.3.0` shared with the site. Install prints no unmet-peer warning for `next`/`react` from `@payloadcms/*`. If it does, STOP.
- **Files:** `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `server/package.json`, `packages/contracts/package.json`.
- **Done means:**
  - `pnpm -r ls --depth -1` lists `time2fest-web`, `@time2fest/contracts`, `@time2fest/rules`, `@time2fest/server`;
  - `grep -E '"(payload|@payloadcms/[a-z-]+)": "' server/package.json` shows `3.91.0` on every line;
  - no `^` or `~` in `server/package.json` versions;
  - `git diff master -- package.json` is empty at the end of P1.
- **Verify:** `pnpm -r ls --depth -1`; contracts targeted with `{files}` = `package.json` (typecheck only).
- **Rules that apply:** `engineering-paved-path:security` → A03 (exact pins, lockfile committed, no typosquats; the package names above are the only ones).
- **Risk:** pnpm may hoist differently on Windows. The worktree is nested in `D:/Work/Pets/Time2Fest/web`, so Node can silently resolve from the parent `web/node_modules`. Do not "fix" a missing module by relying on that; CI on a clean clone (W25/W28) is the check.

### W2 — Server toolchain: tsconfig, ESLint (Date ban), vitest configs, env example (P1)
- **Serves:** AC-34 (lint rule), NFR-5, NFR-3; enables all server items.
- **Do:**
  - `server/tsconfig.json`:
    - `target ES2022`, `lib ["dom","dom.iterable","esnext"]`, `module esnext`, `moduleResolution bundler`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `noEmit`, `skipLibCheck`, `jsx preserve`, `allowJs`, `checkJs`, `resolveJsonModule`, `plugins [{name:"next"}]`, `paths {"@payload-config": ["./src/payload.config.ts"]}`;
    - `include ["next-env.d.ts","src/**/*","test/**/*","scripts/**/*.mjs","*.config.ts","*.config.mjs",".next/types/**/*.ts"]`, `exclude ["node_modules",".next","graphify-out"]`.
    - Next may rewrite this file on its first run. Accept only its additions.
  - `server/eslint.config.mjs`: `typescript-eslint` recommended plus:
    - (a) for `src/**/*.ts` except `src/clock/**`, `no-restricted-syntax` errors on `CallExpression[callee.object.name='Date'][callee.property.name='now']` and `NewExpression[callee.name='Date'][arguments.length=0]`, message "time only through server/src/clock (AC-34)";
    - (b) for `src/platform/**` and `src/ports.ts`, `no-restricted-imports` of `ioredis`, `pg`, `payload`, `@payloadcms/*`, `next`, `next/*`, `**/adapters/*`, `**/endpoints/*`, `**/container` (onion ban 2);
    - ignores `.next/**`, `src/migrations/**`, `src/payload-types.ts`, `src/app/(payload)/admin/importMap.js`.
  - `server/vitest.config.ts`: `environment: 'node'`, `include: ['test/unit/**/*.test.ts']`, `alias {'@payload-config': './src/payload.config.ts'}`.
  - `server/vitest.integration.config.ts`:
    - `include` = `T2F_EXCLUSIVE ? ['test/exclusive/**/*.test.ts'] : ['test/integration/**/*.int.test.ts']`;
    - `fileParallelism: false`, `maxWorkers: 1`, `globalSetup: './test/integration/global-setup.ts'`, `testTimeout: 30000`, same alias.
  - `server/vitest.stack.config.ts`: `include ['test/stack/**/*.stack.test.ts']`, `fileParallelism:false`, no globalSetup.
  - `server/.env.example`: one line per variable of the platform env block (W8 list), **names with empty values** and a comment that `pnpm db:create` writes `server/.env.local` (gitignored by `.gitignore:4`).
  - `server/src/ports.ts`: placeholder `export {};` with a one-line doc comment (W8 fills it).
- **Files:** `server/tsconfig.json`, `server/eslint.config.mjs`, `server/vitest.config.ts`, `server/vitest.integration.config.ts`, `server/vitest.stack.config.ts`, `server/.env.example`, `server/src/ports.ts`.
- **Done means:**
  - in `server/`, `npx tsc --noEmit -p .` and `npx eslint .` exit 0;
  - a scratch file `src/x.ts` containing `Date.now()` makes eslint fail with the AC-34 message (delete it after);
  - `grep -E '=[^[:space:]]' server/.env.example` is empty.
- **Verify:** server targeted with `{files}` = `src/ports.ts`.
- **Rules that apply:**
  - `engineering-paved-path:security` → Secret Detection (`.env.example` names only);
  - `engineering-paved-path:onion-architecture` → §6 enforcement (encode ban 2 as a lint rule).
- **Risk:** low.

### W3 — Site exclusions for `server/` (P1)
- **Serves:** AC-67, AC-68.
- **Do:**
  - `tsconfig.json`: append `"server"` to `exclude`. That is the only line, which keeps the main checkout's uncommitted `include` edit out (EC-19).
  - `eslint.config.mjs`: add `'server/**'` to the first `ignores` array.
  - The site `vitest.config.ts` already includes only `tests/unit/**` (`vitest.config.ts:10`), so there is no change.
- **Files:** `tsconfig.json`, `eslint.config.mjs`.
- **Done means:**
  - `git diff master -- tsconfig.json` shows exactly one added line, `"server"`, plus a trailing-comma change on the previous line;
  - `npx tsc --noEmit -p .` and `npx eslint eslint.config.mjs` exit 0 at the root.
- **Verify:** web targeted with `{files}` = `eslint.config.mjs`.
- **Rules that apply:** none beyond the constraint column.
- **Risk:** low.

### W4 — Docker compose stack and fake placeholders (P1)
- **Serves:** AC-4, AC-11, NFR-1; enables AC-1, AC-3.
- **Do:** `docker-compose.yml` at the root, `name: t2f`. Four services, each with an exact image tag (pull once, then pin the exact patch tag; never `latest`), a `healthcheck`, `restart: unless-stopped`, and `mem_limit` plus `deploy.resources.limits.memory`.

  | Service | Image | Port | Config | Healthcheck | Volume | Memory |
  |---|---|---|---|---|---|---|
  | `postgres` | `postgres:17.x-alpine` | `127.0.0.1:5433:5432` | `POSTGRES_USER: t2f`, `POSTGRES_HOST_AUTH_METHOD: trust` | `pg_isready -U t2f` | `t2f_pgdata` | `1g` |
  | `redis` | `redis:7.4.x-alpine` | `127.0.0.1:6380:6379` | `command: ["redis-server","--databases","64","--save","","--appendonly","no"]` | `redis-cli ping` | none | `256m` |
  | `centrifugo` | `centrifugo/centrifugo:v6.x.y` | `127.0.0.1:8000:8000` | `command: centrifugo`; env `CENTRIFUGO_HTTP_API_INSECURE: "true"`, `CENTRIFUGO_ADMIN_ENABLED: "false"` | `wget -qO- http://127.0.0.1:8000/health` | none | `256m` |
  | `mailpit` | `axllent/mailpit:v1.x.y` | `127.0.0.1:1025:1025`, `127.0.0.1:8025:8025` | — | the image's own, or `wget -qO- http://127.0.0.1:8025/livez` | none | `256m` |

  Notes on the table:
  - Postgres uses `trust` auth because the port is loopback-only and no password may be committed (NFR-3).
  - Centrifugo is not used in this wave (publishing is SPEC-06). If v6 refuses to start without a client key, add `CENTRIFUGO_CLIENT_INSECURE: "true"` and note it.

  Fake placeholders: `fakes/ai/.gitkeep`, `fakes/youtube/.gitkeep`, `fakes/paypro/.gitkeep` (empty).
- **Files:** `docker-compose.yml`, `fakes/ai/.gitkeep`, `fakes/youtube/.gitkeep`, `fakes/paypro/.gitkeep`.
- **Done means:**
  - `docker compose -p t2f config` exits 0;
  - `grep -n "fake" docker-compose.yml` is empty;
  - `grep -nE "mem_limit|memory:" docker-compose.yml` shows `1g` once and `256m` three times;
  - `git ls-files --others --exclude-standard fakes/` lists exactly three files;
  - `docker compose -p t2f up -d --wait postgres redis` succeeds, and `docker exec t2f-redis-1 redis-cli CONFIG GET databases` → `64`.
- **Verify:** the commands in Done means (Docker Desktop must be running; this is the only Docker step in P1).
- **Rules that apply:** `engineering-paved-path:security` → A02 (no service exposed beyond loopback; admin UIs off).
- **Risk:** the local PostgreSQL 17 on 5432 does not conflict (5433). Centrifugo v6 env names: if the container is unhealthy, read its log and fix the env key names.

### W5 — Real `server` verify commands and the "Test doors" check (P1)
- **Serves:** AC-63, NFR-5.
- **Do:** in `.claude/sdd-engineering.json`:
  - `server.files` = `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`;
  - `server.full` = `npx tsc --noEmit -p . && npx eslint . && npx vitest run --maxWorkers=2 && pnpm test:int && node scripts/verify-schema.mjs`. `test:int` is the serial integration suite on `t2f_<slug>_test` under the shared lock; `verify-schema.mjs` is the migrate-status and types check from W12;
  - the "Test doors" `check` = `door is registered only when T2F_ENV=test and T2F_TEST_DOORS=1 (dynamic import in server/src/test-doors); production build test proves every /api/_test/* path returns 404 identical to an unknown path`.

  Keep the `contracts` entries as they are: their `full` already meets AC-63.
- **Files:** `.claude/sdd-engineering.json`.
- **Done means:**
  - `node -e "JSON.parse(require('fs').readFileSync('.claude/sdd-engineering.json','utf8'))"` exits 0;
  - `grep -c "TODO-until-created" .claude/sdd-engineering.json` → `0`;
  - `grep -c "NODE_ENV=test" .claude/sdd-engineering.json` → `0`;
  - every vitest command in the file has `--maxWorkers=2`, and `test:int` (W1) has `--maxWorkers=1`.
- **Verify:** the greps above.
- **Rules that apply:** `sdd-format` §1 (verify entry shape).
- **Risk:** low. `server.full` needs Postgres and Redis up. The Verification plan says so.

### W6 — Slot, ports and isolation functions (P2 · L2a)
- **Serves:** AC-7, AC-8, AC-9, AC-10; enables AC-12.
- **Do:** create `server/scripts/lib/worktree.mjs`: `// @ts-check`, JSDoc types, Node built-ins only (`node:child_process`, `node:path`, `node:fs`).
  - `gitInfo(cwd)` → `{ branch, isMainCheckout, commonDir, toplevel }`. It uses `git rev-parse --abbrev-ref HEAD`, `--git-dir` and `--git-common-dir`. The main checkout is the case where the absolute `--git-dir` equals the absolute `--git-common-dir`.
  - `slotFor({ branch, isMainCheckout, envSlot })`:
    - `envSlot`, if set, must be an integer 0–47, or throw; when valid it wins;
    - the main checkout → 0;
    - `/^spec-(\d{2})([ab])?-/` with NN 01–23 → `2·NN`, or `2·NN+1` for `b`;
    - otherwise throw `Error` with the text `branch "<branch>" matches no spec-NN[a|b]-* pattern; set T2F_SLOT=<0-47>`.
  - `portsFor(slot)` → `{ server: 4000+10·slot, web: +1, fakes: [+2,+3,+4,+5] }`.
  - `slugFor({ branch, isMainCheckout })`: the main checkout → `main`; otherwise lowercase, replace `/[^a-z0-9]+/g` with `_`, trim `_`, cut to 40.
  - `isolationFor({ slug, slot })` → `{ database: 't2f_'+slug, testDatabase: 't2f_'+slug+'_test', redisDb: slot, redisPrefix: 't2f:'+slug+':', channelPrefix: slug+'_', mailAddress: (name) => name+'+'+slug+'@example.com' }`.
  - `resolveWorktree(cwd, env)` combines all of the above. It is the single entry used by the scripts.

  Test `server/test/unit/worktree.test.ts`:
  - the AC-7 table: `master`/main → 0, `spec-02-x` → 4, `spec-13a-x` → 26, `spec-13b-x` → 27, `spec-23-x` → 46;
  - AC-8: 48 × 6 ports all distinct, max 4475;
  - AC-9: `feature-x` without `T2F_SLOT` throws a message containing both `feature-x` and `T2F_SLOT`; with `T2F_SLOT=5` → 5;
  - AC-10: for `spec-02-server-skeleton` the six values equal `t2f_spec_02_server_skeleton`, `…_test`, `4`, `t2f:spec_02_server_skeleton:`, `spec_02_server_skeleton_`, and an address whose local part contains the slug;
  - a 70-character branch gives a slug `^[a-z0-9_]{1,40}$`.
- **Files:** `server/scripts/lib/worktree.mjs`, `server/test/unit/worktree.test.ts`.
- **Done means:** the test file passes, with every case above as its own `it`.
- **Verify:** server targeted with `{files}` = `scripts/lib/worktree.mjs test/unit/worktree.test.ts`.
- **Rules that apply:** `engineering-paved-path:security` → A05 (branch name is trusted only after normalisation; `execFileSync('git', [...])`, never a shell string).
- **Risk:** low.

### W7 — Machine integration lock (P2 · L2a)
- **Serves:** AC-13, AC-14, AC-15, AC-16, AC-17.
- **Do:**
  - `server/scripts/lib/lock.mjs`, Node built-ins only:
    - `lockDir(cwd, env)`:
      - `env.T2F_LOCK_DIR` if set (absolute);
      - else `path.resolve(path.dirname(path.resolve(cwd, git rev-parse --git-common-dir)), '.claude/sdd/locks')`;
      - creates the folder recursively.
    - Files in it:
      - `integration.json` = `{ holders: [{ owner, mode: 'shared'|'exclusive', pid, startedAt, leaseAt }] }`;
      - the mutex `integration.mutex/`, taken with an atomic `fs.mkdirSync`; on `EEXIST` retry every 100 ms; a mutex older than 30 s is removed;
      - the journal `integration.journal`, one line per event: `ISO\towner\tmode\tevent`, with `event` ∈ `take|release|takeover|timeout`.
    - `acquire({ dir, owner, mode, timeoutMs = env.T2F_LOCK_TIMEOUT_MS ?? 30·60_000, staleMs = env.T2F_LOCK_STALE_MS ?? 60·60_000, now = Date.now, sleep })`:
      - poll every 500 ms under the mutex;
      - drop holders whose `leaseAt` is older than `staleMs`, journalling `takeover` with the stale owner's name;
      - `shared` may take while no `exclusive` holder exists; `exclusive` may take while there are no holders;
      - on timeout, journal `timeout` and throw with the text `integration lock: waited <min> min; held by <owner> (<mode>) since <startedAt>`;
      - return `{ release, renew }`.
    - `readHolders(dir)` is for the server (W15).
    - Lease renewal runs every 60 s while held.
  - `server/scripts/lock.mjs` is the CLI:
    - `--mode shared|exclusive -- <cmd...>`;
    - the owner is the worktree slug from `resolveWorktree` plus `:` and the pid;
    - it spawns `<cmd>` with `shell: false` (`npx` resolved through `process.platform === 'win32' ? 'npx.cmd'`), renews the lease, releases it on child exit and on `SIGINT`/`SIGTERM`, and exits with the child's code;
    - it exports `T2F_LOCK_DIR` and `T2F_LOCK_MODE` to the child.
  - Test `server/test/unit/lock.test.ts`, using a temp dir via `T2F_LOCK_DIR` and an injected clock:
    - AC-13: a shared request waits while an exclusive holder exists and is granted after release;
    - AC-14: an exclusive request waits for a shared holder;
    - AC-15: `timeoutMs = 300` → the error names owner, mode and start;
    - AC-16: a holder with `leaseAt` 61 min old is taken over, and the journal has `takeover` with the old owner;
    - AC-17: from this worktree, the default dir equals `<main checkout>/.claude/sdd/locks`; with `T2F_LOCK_DIR` it equals that folder; `git check-ignore -q <dir>/integration.json` exits 0; the journal has one line per take, release and takeover.
- **Files:** `server/scripts/lib/lock.mjs`, `server/scripts/lock.mjs`, `server/test/unit/lock.test.ts`.
- **Done means:** the test file passes, with one `it` per AC above.
- **Verify:** server targeted with `{files}` = `scripts/lib/lock.mjs scripts/lock.mjs test/unit/lock.test.ts`.
- **Rules that apply:** `engineering-paved-path:security` → A10 (fail closed: an unreadable `integration.json` means wait and retry, never "no holders"); `execFile`-style spawn, no shell.
- **Risk:** Windows: a `mkdir` mutex left by a killed process is handled by the 30 s rule. Do **not** use the name `heavy.lock`; the orchestrator's heavy lock is unrelated.

### W8 — Registry check, environment classes and schema, logger with masking, alarm (P2 · L2a)
- **Serves:** AC-18, AC-19 (validation function), AC-20, AC-56, AC-62 (check), NFR-3, NFR-4.
- **Do:**
  - `server/src/ports.ts` (ring 2):
    - `Logger { info(o), warn(o), error(o) }`;
    - `Alarm { raise(a: { level: 'page'|'log'; source: string; code: string; details?: Record<string, unknown> }): void }`;
    - `FastStore` (`incrWindow(key, windowMs) → { count, ttlMs }`, `setIfAbsent(key, value, ttlMs) → boolean`, `get`, `set(key, value, ttlMs)`, `deleteByPrefix(prefix) → number`);
    - `IdempotencyStore` (`begin(key) → 'started' | { status: 'running' } | { status: 'done', result }`, `finish(key, result)`, `abort(key)`);
    - `LockState { holdsExclusive(owner: string): boolean }`;
    - `Clock { now(): number }`;
    - the error class `DependencyUnavailable` (core taxonomy, plain `Error` subclass).
  - `server/src/platform/registry.ts` (ring 1): `assertRegistry<T>(name, rows, keyOf)` throws `registry <name>: row <key> out of order | duplicate`.
  - `server/src/platform/env.ts` (ring 1, pure; takes the raw env object):
    - `envClass(raw)`: `'test'|'rehearsal'|'production'`, an exact match only; anything else → `production`.
    - `EnvVar` row type `{ name, schema: ZodType, secret?: true, isolated?: true }`.
    - `loadEnv(raw, blocks = envRegistry, denylist = PRODUCTION_DENYLIST)` → `{ ok: true, env, secrets: string[] }` | `{ ok: false, failing: string[] }`. Messages contain names only, never values.
    - Isolation guard for `test`/`rehearsal`:
      - every `isolated` var whose value contains any denylist id fails with its name;
      - `PAYPRO_MODE` must equal `sandbox`.
    - `PRODUCTION_DENYLIST: readonly string[] = []` with a comment pointing to spec Open question 1 (SPEC-13a fills it).
  - `server/src/registries/env.ts`: the block registry `[{ key: 'platform', vars: [...] }]`, sorted by key. Platform vars:

    | Var | Type | Flags |
    |---|---|---|
    | `T2F_ENV` | free string, classified by `envClass` | |
    | `T2F_TEST_DOORS` | `'1'` or absent | |
    | `T2F_SLOT` | int 0–47 | |
    | `T2F_SLUG` | `^[a-z0-9_]{1,40}$` | |
    | `T2F_SERVER_PORT` | int | |
    | `T2F_WEB_PORT` | int | |
    | `T2F_LOCK_DIR` | string | |
    | `T2F_ALLOWED_ORIGINS` | comma list of origins, required in `production` | |
    | `DATABASE_URI` | URL | secret, isolated |
    | `REDIS_URL` | URL | secret, isolated |
    | `T2F_REDIS_PREFIX` | string | |
    | `T2F_CENTRIFUGO_URL` | URL, optional | isolated |
    | `T2F_CENTRIFUGO_PREFIX` | string | |
    | `SMTP_HOST`, `SMTP_PORT` | | isolated |
    | `PAYLOAD_SECRET` | ≥32 chars | secret |
    | `PAYPRO_MODE` | `sandbox|live`, default `sandbox` | isolated |

    R2 and AI vars are added by their owner waves as new rows.
  - `server/src/platform/env.check.ts`: a CLI (run by `pnpm env:check` via `tsx`). It loads `.env.local` with Node's `process.loadEnvFile` when present, calls `loadEnv(process.env)`, and on failure prints `env: invalid <NAME>[, <NAME>]` and exits 1.
  - `server/src/platform/logger.ts` (ring 4, stdout only):
    - `createLogger(secrets: string[])` writes one JSON line per call (`{ t, level, ...fields }`; `t` comes from an injected `Clock`);
    - before writing it replaces every occurrence of every secret value (length ≥ 4) in every string field with `***`;
    - `createAlarm(logger)` implements `Alarm`: one line `{ level: 'alarm', alarm: level, source, code, ... }`, everything wrapped in `try { … } catch { /* never throw */ }`.
  - Test `server/test/unit/platform.test.ts`:
    - AC-18: `''`, `prod`, `Test` and absent → `production`;
    - AC-19: a bad `PAYLOAD_SECRET` → `failing` contains `PAYLOAD_SECRET`, and the serialized result does not contain the value;
    - AC-20: class `test` with `DATABASE_URI` containing an injected denylist id → refused, naming `DATABASE_URI`; `PAYPRO_MODE=live` in `rehearsal` → refused, naming `PAYPRO_MODE`;
    - AC-56: `page` and `log` each produce one line; a throwing stdout writer does not throw;
    - NFR-4: a log and an alarm containing the secret value print `***`;
    - AC-62: `assertRegistry` fails on a swapped and on a duplicated synthetic list, and passes on `envRegistry`.
- **Files:** `server/src/ports.ts`, `server/src/platform/registry.ts`, `server/src/platform/env.ts`, `server/src/platform/env.check.ts`, `server/src/registries/env.ts`, `server/src/platform/logger.ts`, `server/test/unit/platform.test.ts`.
- **Done means:** the test file passes, with one `it` per bullet above; the W2 lint rule (b) passes on `src/platform/**`.
- **Verify:** server targeted with the seven files.
- **Rules that apply:**
  - `engineering-paved-path:security` → A09 (redact secrets), A10 (an unknown class falls to the strictest, `production`);
  - `engineering-paved-path:onion-architecture` → §1 (env parsing is ring 1: a pure function of its input), §2 (ports only for process boundaries: store, lock, clock, log).
- **Risk:** the masking must also apply to `Error.message` fields passed to the logger. Test that too.

### W9 — Server clock (P2 · L2a)
- **Serves:** AC-34, AC-41; core of AC-35, AC-36, AC-37, AC-39.
- **Do:** `server/src/clock/index.ts`:
  - pure `virtualNow(state, realNow)`, with `state = { anchorVirtual, anchorReal, speed, frozen }`. When `frozen`, it returns `anchorVirtual`. Otherwise it returns `anchorVirtual + (realNow − anchorReal)·speed`, rounded to an integer.
  - Real time is `Date.now()`. This is the only allowed call in `server/src/**` (AC-34).
  - `realClock: Clock` returns `Date.now()`.
  - The test clock is a process singleton stored on `globalThis[Symbol.for('t2f.clock')]`. `createTestClock()` returns `TestClock extends Clock` with:
    - `set({ at?, speed?, frozen? })`. Re-anchor at the current virtual instant before applying, so the time does not jump;
    - `state()` → `{ now, speed, frozen }`;
    - `reset()`, back to real time, speed 1, not frozen.
  - `clockFor(cls: EnvClass): Clock` returns `realClock` for `production` and `rehearsal` (AC-21, AC-41), and the singleton's `Clock` view for `test`. `TestClock` is exported **only** through `createTestClock`, and only `test-doors` imports it.

  Test `server/test/unit/clock.test.ts`:
  - `virtualNow` for speed 60 over 1 000 ms → +60 000; frozen → constant;
  - `set({ at })` → `now()` ≈ at;
  - `reset()` → real;
  - `clockFor('production')` has no `set`: `// @ts-expect-error` on `.set` compiles and `'set' in clock === false` (AC-41).
- **Files:** `server/src/clock/index.ts`, `server/test/unit/clock.test.ts`.
- **Done means:** the test passes; `npx eslint src` shows no Date-ban error, and `grep -rnE "Date\.now\(\)|new Date\(\)" server/src --include=*.ts` lists only `server/src/clock/index.ts`.
- **Verify:** server targeted with the two files.
- **Rules that apply:** `engineering-paved-path:onion-architecture` → §1 (pure math is ring 1; reading the wall clock is the adapter).
- **Risk:** low.

### W10 — Platform reasons and zod wire schemas in the contracts package (P2 · L2b)
- **Serves:** AC-25; schemas used by AC-22, AC-24, AC-38, AC-40.
- **Do:**
  - `packages/contracts/src/result.ts`: append
    ```ts
    /** Platform reasons (SPEC-02), valid with any code: schema failure, duplicate in flight, door needs the exclusive lock. */
    export const PLATFORM_REASONS = ['invalid-input', 'in-progress', 'lock-required'] as const;
    export type PlatformReason = (typeof PLATFORM_REASONS)[number];
    ```
  - `packages/contracts/src/schemas.ts`:
    - `ApiErrorCodeSchema = z.enum([...9 codes in the order of result.ts:4-21])` with `satisfies z.ZodType<ApiErrorCode>`;
    - `ApiErrorSchema = z.object({ code, reason: z.string().optional(), retryAfterMs: z.number().int().positive().optional(), attemptsLeft: z.number().int().nonnegative().optional(), message: z.string().optional() }).strict()`;
    - `apiResultSchema(value)` (union of `{ok:true,value}` and `{ok:false,error}`), and `ApiFailureSchema`;
    - `TimeResponseSchema = z.object({ now: z.number().int().nonnegative() }).strict()`;
    - `TestClockSetSchema = z.object({ at: z.number().int().nonnegative().optional(), speed: z.number().int().min(0).max(600).optional(), frozen: z.boolean().optional() }).strict()`;
    - `TestClockStateSchema = z.object({ now, speed, frozen }).strict()`;
    - `TestFixturesBodySchema = z.object({ name: z.string().min(1).max(64) }).strict()`;
    - DTO types via `z.infer`.
    - Do **not** export it from `index.ts`.
  - Tests:
    - `packages/contracts/test/platform-reasons.test.ts`: the three reasons are exported and `fail('validation', { reason: 'invalid-input' })` type-checks;
    - `packages/contracts/test/schemas.test.ts`:
      - every `fail(...)` code passes `ApiFailureSchema`;
      - `{now: 1.5}`, `{now: -1}` and extra keys are rejected;
      - for `TestClockSetSchema`, the values `601`, `-1`, `1.5` and `at: -5` are rejected, and `{ at: 0, speed: 600, frozen: true }` is accepted.
  - Then run `node scripts/contract-surface.mjs --update` (no `--breaking`) at the root and commit the baseline change with the item.
- **Files:** `packages/contracts/src/result.ts`, `packages/contracts/src/schemas.ts`, `packages/contracts/test/platform-reasons.test.ts`, `packages/contracts/test/schemas.test.ts`, `scripts/contract-surface.baseline.json`.
- **Done means:**
  - contracts `full` (`npx tsc --noEmit -p . && npx vitest run --maxWorkers=2 && node ../../scripts/contract-surface.mjs --check`) exits 0;
  - `git diff master -- scripts/contract-surface.baseline.json` only adds entries;
  - `grep -n "schemas" packages/contracts/src/index.ts` is empty.
- **Verify:** contracts targeted with the four package files; root `node scripts/contract-surface.mjs --check`.
- **Rules that apply:**
  - `contract-conformance` §4 (adding a reason is non-breaking; adding a route is non-breaking) and §1 (DTO = `z.infer`);
  - `engineering-paved-path:onion-architecture` → ring 1 may import `zod`.
- **Risk:** the `--update` refusal path. If the script calls any change breaking, STOP; do not use `--breaking`.

### W11 — Payload config, collections, admin app, boot guard (P3)
- **Serves:** AC-58, AC-59, AC-60 (REST prefix, GraphQL off), NFR-7, AC-19 (second guard); enables AC-55 (`order` store).
- **Do:**
  - `server/src/payload.config.ts`, with `buildConfig`:
    - `secret: env.PAYLOAD_SECRET`;
    - `admin: { user: 'admins' }`;
    - `routes: { api: '/cms-api', admin: '/admin' }`;
    - `graphQL: { disable: true }`;
    - `collections: collectionRegistry.map((r) => r.collection)`;
    - `db: postgresAdapter({ pool: { connectionString: env.DATABASE_URI }, push: false, migrationDir: path.resolve(dirname, 'migrations') })`;
    - `typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') }`.

    The env comes from `loadEnv(process.env)`; on failure it throws an `Error` that lists names only.
  - `server/src/collections/admins.ts`: `slug: 'admins'`, `auth: { cookies: { sameSite: 'Lax', secure: <class === 'production'> } }`, `fields: []`, so only the auth email and password exist (HttpOnly is Payload's default: `packages/payload/src/auth/cookies.ts:152,179`, research §4).
  - `server/src/collections/idempotencyRecords.ts`:
    - `slug: 'idempotency-records'`, `admin.hidden: true`;
    - access `read/create/update/delete: () => false` (local API with `overrideAccess` only);
    - fields `key` (text, required, unique, index), `status` (select `running|done`, required), `result` (json).
  - `server/src/registries/collections.ts`: rows `{ key, collection, resettable }`, sorted by key: `admins` (resettable `false`), `idempotency-records` (`true`). Run `assertRegistry` at module load.
  - `server/next.config.mjs`:
    - `withPayload({ reactStrictMode: true, devIndicators: false, turbopack: { root: path.resolve(dirname, '..') }, outputFileTracingRoot: path.resolve(dirname, '..'), webpack: (c) => { c.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] }; return c; } }, { devBundleServerPackages: false })`.
    - Use the blank template v3.91.0 shape (research §6).
  - Payload app files (blank template v3.91.0, research §6):
    - `src/app/(payload)/layout.tsx`: `RootLayout` + a `'use server'` `serverFunction` → `handleServerFunctions({ ...args, config, importMap })`; imports `@payloadcms/next/css`, `./admin/importMap.js`, `./custom.css`;
    - `src/app/(payload)/custom.css`: empty, with one comment line;
    - `src/app/(payload)/admin/[[...segments]]/page.tsx`: `RootPage` + `generatePageMetadata`;
    - `src/app/(payload)/admin/[[...segments]]/not-found.tsx`: `NotFoundPage` + `generatePageMetadata`;
    - `src/app/(payload)/admin/importMap.js`: from `pnpm --dir server generate:importmap`;
    - `src/app/(payload)/cms-api/[...slug]/route.ts`: `import config from '@payload-config'; import '@payloadcms/next/css'; import { REST_DELETE, REST_GET, REST_OPTIONS, REST_PATCH, REST_POST, REST_PUT } from '@payloadcms/next/routes';` and export `GET/POST/DELETE/PATCH/PUT/OPTIONS = REST_X(config)`.
    - **No** `graphql` or `graphql-playground` route files.
  - `server/src/instrumentation.ts`: `export async function register() { if (process.env.NEXT_RUNTIME === 'nodejs') { const r = loadEnv(process.env); if (!r.ok) { console.error('env: invalid ' + r.failing.join(', ')); process.exit(1); } } }`.
- **Files:** `server/src/payload.config.ts`, `server/src/collections/admins.ts`, `server/src/collections/idempotencyRecords.ts`, `server/src/registries/collections.ts`, `server/next.config.mjs`, `server/src/app/(payload)/layout.tsx`, `server/src/app/(payload)/custom.css`, `server/src/app/(payload)/admin/[[...segments]]/page.tsx`, `server/src/app/(payload)/admin/[[...segments]]/not-found.tsx`, `server/src/app/(payload)/admin/importMap.js`, `server/src/app/(payload)/cms-api/[...slug]/route.ts`, `server/src/instrumentation.ts`.
- **Done means:**
  - `npx tsc --noEmit -p .` in `server/` exits 0;
  - `grep -rn "graphql" server/src/app` is empty;
  - `grep -n "push: false" server/src/payload.config.ts` has one hit;
  - `grep -n "schemaName" server/src/payload.config.ts` is empty.
- **Verify:** server targeted with the non-generated files.
- **Rules that apply:**
  - `migration-safety` (collections change → the migration in W12);
  - `engineering-paved-path:next-best-practices` → route handlers, `'use server'` only inside the layout's server function;
  - `engineering-paved-path:security` → A01 (deny by default: the idempotency collection has no access);
  - Payload layering (Docs patch): collections are thin, with no rules in hooks.
- **Risk:** Next 16.4.1 with Payload 3.91.0 is peer-valid but untested upstream (the template pins 16.3.3, research §1). If `next build` fails inside `@payloadcms/*`, report BLOCKED with the log. Do not downgrade `next`.

### W12 — Worktree DB tool, first migration, generated types, schema check, integration setup (P3)
- **Serves:** AC-58, AC-59, AC-63 (`verify-schema`); enables AC-1 and every integration item.
- **Do:**
  - `server/scripts/db.mjs` (imports `pg` and `./lib/worktree.mjs`):
    - `create`: connect to `postgres://t2f@127.0.0.1:5433/postgres` and `CREATE DATABASE` `t2f_<slug>` and `t2f_<slug>_test` if missing. The identifier is checked by `/^t2f_[a-z0-9_]{1,46}$/` before it is interpolated. Never drop anything.
    - `env`: write `server/.env.local` with every platform var for this worktree:
      - `T2F_ENV=test`, `T2F_TEST_DOORS=1`;
      - slot, slug and ports;
      - `DATABASE_URI=postgres://t2f@127.0.0.1:5433/t2f_<slug>`, `REDIS_URL=redis://127.0.0.1:6380/<slot>`;
      - the prefixes and `SMTP_HOST=127.0.0.1`, `SMTP_PORT=1025`;
      - `T2F_LOCK_DIR` (from `lockDir`);
      - `T2F_ALLOWED_ORIGINS=http://127.0.0.1:<web>,http://localhost:<web>,http://localhost:3000`;
      - `PAYLOAD_SECRET`: keep the existing value, else `crypto.randomBytes(32).toString('hex')`.
    - `migcheck <up|drop>`: create or drop **only** `t2f_<slug>_migcheck`.
    - It prints names, never the secret.
  - Run `node scripts/db.mjs create && node scripts/db.mjs env`, then generate the migration with `pnpm --dir server migrate:create initial`. Never hand-edit it. Then `pnpm --dir server migrate`, `pnpm --dir server generate:types` and `pnpm --dir server generate:importmap`.
  - `server/scripts/verify-schema.mjs`:
    - (a) pending migrations: compare the names exported by `src/migrations/index.ts` with `SELECT name FROM payload_migrations` on `DATABASE_URI`. It exits 1 listing the missing ones, because `payload migrate:status` always exits 0 (research §5, `bin/index.ts:78`);
    - (b) types: run `payload generate:types` and then `git diff --exit-code -- src/payload-types.ts`;
    - (c) the same for `src/app/(payload)/admin/importMap.js`.
  - `server/test/integration/global-setup.ts`:
    - load `.env.local`;
    - override `DATABASE_URI` to `t2f_<slug>_test`, set `T2F_ENV=test`;
    - run `payload migrate` on it (a child process with that env);
    - expose the env to the tests.
  - `server/test/integration/payload-schema.int.test.ts`:
    - AC-58: on `_test`, the tables `admins` and `idempotency_records` exist and `users` does not (`information_schema.tables`);
    - AC-59: on `_migcheck` (created and dropped by the test), `migrate` → `migrate:down` → `migrate` all exit 0, and `SELECT 1 FROM information_schema.schemata WHERE schema_name='auth'` returns no row.
- **Files:** `server/scripts/db.mjs`, `server/scripts/verify-schema.mjs`, `server/src/migrations/<timestamp>_initial.ts` (generated), `server/src/migrations/index.ts` (generated), `server/src/payload-types.ts` (generated), `server/test/integration/global-setup.ts`, `server/test/integration/payload-schema.int.test.ts`.
- **Done means:**
  - `pnpm --dir server test:int -- payload-schema` passes;
  - `node scripts/verify-schema.mjs` exits 0;
  - the migration's `up` and `down` are both non-empty;
  - `grep -nE "DROP TABLE|TRUNCATE|DELETE FROM" server/src/migrations/*_initial.ts` hits only inside `down`;
  - `git status --porcelain server/.env.local` is empty (ignored).
- **Verify:** server integration `payload-schema`; `node scripts/verify-schema.mjs`.
- **Rules that apply:** `migration-safety` checks 1 (generated), 2 (no destructive op in `up`), 3 (down works), 4 (up/down/up on `_migcheck`, drop only it), 6 (types regenerated); `engineering-paved-path:security` → A05 (identifier allowlist before SQL interpolation).
- **Risk:** the Payload CLI may resolve `migrationDir` against cwd (research: not established). Always run it from `server/`.

### W13 — HTTP pipeline: error model, validation, same-origin, route and middleware registries, 404 surface (P4)
- **Serves:** AC-22, AC-23, AC-24, AC-26, AC-27, AC-28, AC-60 (`/api/*` 404s), AC-72 (mapping), AC-62 (rows).
- **Do:**
  - `server/src/endpoints/types.ts`:
    - `RouteRow = { key: string; method; path: string; body?: ZodType; query?: ZodType; needs?: ('db'|'redis')[]; sameOriginExempt?: true; rateLimit?: string; idempotency?: string; handler(ctx) → Promise<Response | { ok: true; value } | ApiFailure> }`;
    - `Middleware = { key: string; run(ctx, next) }`;
    - `Ctx = { req, url, env, clock, deps, log, subject?: string }`.
  - `server/src/endpoints/pipeline.ts`, `createDispatcher({ routes, middleware, env, deps })` → `(req: Request) => Promise<Response>`:
    1. Match `method + path` exactly. No match → `404 { ok:false, error:{ code:'not_found' } }`, with `content-type: application/json; charset=utf-8` and `cache-control: no-store` and no other header. This one response is also used for doors in non-test classes (AC-30).
    2. Middleware in registry order: `10-origin`, then `20-validate`, then `30-rate-limit` and `40-idempotency` (W16/W17 fill those two). Then the handler.
    3. `10-origin` (mutating methods only): `Origin` absent or not in `env.T2F_ALLOWED_ORIGINS` → `forbidden`, unless the row has `sameOriginExempt`. There is no reason field.
    4. `20-validate`: parse the JSON body (a malformed body counts as a failure) and the query with the row schemas. Failure → `validation` with reason `invalid-input`, and `message` = the first issue path joined by `.`. The handler is not run.
    5. The status map lives in `errors` inside `pipeline.ts`: `validation 400, unauthorized 401, forbidden 403, not_found 404, conflict 409, rate_limited 429, unavailable 503, unknown 500, network 503`. `network` is never produced by the server and maps to 503 for completeness.
    6. Catch: `DependencyUnavailable`, or a pg/ioredis connection error (`ECONNREFUSED`, `ETIMEDOUT`, pg SQLSTATE class `08`, `57P01`), → `unavailable`. Any other throw → log `{ level:'error', logId, err }` (masked) and respond `unknown` with `message: logId` (`/^log_[a-z0-9]{10}$/`). There is no stack and no exception text.
    7. A failure body keeps only `code`, `reason`, `retryAfterMs`, `attemptsLeft` and `message`. Before it is sent, `message` must match `^[A-Za-z0-9_.\[\]]+$` or the log-id pattern; otherwise it is dropped.
  - `server/src/registries/routes.ts`: sorted rows; this wave has only `time` (W14). `server/src/registries/middleware.ts`: sorted rows `10-origin`, `20-validate`, `30-rate-limit`, `40-idempotency` (the last two are pass-through until P5).
  - `server/src/container.ts` (composition root): `getDeps()` with lazy singletons on `globalThis`:
    - `env`, `clock` (`clockFor(class)`), `logger`, `alarm`;
    - `payload` (`getPayload({ config })`, only on first use by a `needs:['db']` route);
    - `redis` (W16) and `lockState` (W15, built on `readHolders`).
  - `server/src/app/api/[[...path]]/route.ts`:
    - `export const dynamic = 'force-dynamic'; export const runtime = 'nodejs';`;
    - `GET/POST/PUT/PATCH/DELETE = (req) => dispatcher(req)`, where `dispatcher` is built once per process from `getDeps()`, `routeRegistry` and, in the test class with the flag, the door routes (W15).
  - `server/test/integration/pipeline.int.test.ts` calls `createDispatcher` in process with **test-local** sample routes (no production surface):
    - AC-22/27: every refusal passes `ApiFailureSchema` and only allowed keys are present;
    - AC-23: one sample route per code → the mapped status;
    - AC-24: a bad body → 400 `invalid-input`, and the handler spy is not called;
    - AC-26: a throwing handler → 500 `unknown`, the body does not contain the error text, and the captured log has the `logId`;
    - AC-28: a foreign or absent `Origin` on POST → 403 and the handler is not called; the exempt row → called;
    - AC-60: `/api/graphql`, `/api/graphql-playground` and `/api/admins` → 404 not_found, built from the real registries;
    - AC-72 mapping: a `needs:['db']` sample route whose dependency throws `ECONNREFUSED` → 503 `unavailable` while `/api/time` → 200.
- **Files:** `server/src/endpoints/types.ts`, `server/src/endpoints/pipeline.ts`, `server/src/registries/routes.ts`, `server/src/registries/middleware.ts`, `server/src/container.ts`, `server/src/app/api/[[...path]]/route.ts`, `server/test/integration/pipeline.int.test.ts`.
- **Done means:** `pnpm --dir server test:int -- pipeline` passes, with one `it` per bullet.
- **Verify:** server targeted with the source files; server integration `pipeline`.
- **Rules that apply:**
  - `engineering-paved-path:security` → A01 (deny by default: unknown → 404), A02 (no stack traces), A10 (fail closed on origin), A09 (log 5xx with id, masked);
  - `contract-conformance` §4 (the error-model shape);
  - `engineering-paved-path:onion-architecture` → ban 1 (routes never import `pg`/Payload directly; they get `deps`), §4 (inject ports, not the container, into platform services).
- **Risk:** Next route bundles duplicate module state per route. The single catch-all keeps the clock, the doors and the dispatcher in one graph. Do not add other `app/api/**` route files.

### W14 — `GET /api/time` on the server (P4)
- **Serves:** AC-40, NFR-8 (implementation); the observation point of AC-35 … AC-39.
- **Do:** `server/src/endpoints/time.ts`. It is a route row `{ key: 'time', method: 'GET', path: '/api/time' }` whose handler returns a raw `Response`. The body is `JSON.stringify({ now: Math.max(0, Math.round(ctx.clock.now())) })` with exactly the headers of `functions/api/time.ts:4-8`: `Cache-Control: no-store, max-age=0`, `Content-Type: application/json; charset=utf-8`, `X-Robots-Tag: noindex`. There is no envelope, and it does not touch `db` or `redis`. Register it in `registries/routes.ts`.

  `server/test/integration/time.int.test.ts`: the body has exactly the key `now`, an integer ≥ 0; the three headers are byte-equal; the response passes `TimeResponseSchema`.
- **Files:** `server/src/endpoints/time.ts`, `server/src/registries/routes.ts` (shared with W13, same phase), `server/test/integration/time.int.test.ts`.
- **Done means:** `pnpm --dir server test:int -- time` passes.
- **Verify:** server integration `time`.
- **Rules that apply:** `contract-conformance` (same shape on both sides: `functions/api/time.ts`); `engineering-paved-path:security` → no data beyond `now`.
- **Risk:** low.

### W15 — Test doors: gating, registry, clock door, stubs, `lock-required` (P4)
- **Serves:** AC-21, AC-29, AC-31 (in-process), AC-32, AC-33, AC-35, AC-36, AC-37, AC-38, AC-39 (reset part), AC-62 (rows).
- **Do:**
  - `server/src/test-doors/registry.ts`: door rows `{ key, method, path, body?, dependencyBreaking?: true, handler }`, sorted by key.
    - `clock-get`: `GET /api/_test/clock` → `{ok:true,value: state()}`.
    - `clock-set`: `POST /api/_test/clock`, body `TestClockSetSchema`, → `set` then `state()`. On validation failure the state is untouched, because the pipeline validates before the handler runs.
    - `last-code`, `moderation`, `paypro-webhook`, `video-status`: stubs → `new Response(JSON.stringify({ ok:false, error:{ code:'unavailable' } }), { status: 501, headers: json })`.
    - `reset` and `fixtures` rows are added in W18.
  - `server/src/test-doors/index.ts`: `doorRoutes(deps)` turns the door rows into `RouteRow`s.
    - It imports `createTestClock`. This is the only importer.
    - For rows with `dependencyBreaking`, the handler first checks `deps.lockState.holdsExclusive(env.T2F_SLUG)`. If that is false → `forbidden` with reason `lock-required`, and nothing changes.
  - Gating in `app/api/[[...path]]/route.ts` (W13 file, same phase):
    ```ts
    const doors = env.class === 'test' && process.env.T2F_TEST_DOORS === '1'
      ? (await import('../../../test-doors/index')).doorRoutes(deps) : [];
    ```
    No request field is ever read for this decision. Put the decision in an exported `shouldLoadDoors(env)` inside `container.ts`, so it can be tested.
  - `server/test/unit/doors-gating.test.ts`:
    - AC-29: `vi.mock` the doors module with a factory that counts its evaluation. Build the dispatcher factory for `rehearsal`+flag, `production`+flag and `test` without the flag → count 0; `test`+flag → 1.
    - AC-31 in process: `production` dispatcher, `/api/_test/clock` with `X-T2F-Test-Doors: 1`, `?doors=1` and `Cookie: t2f_env=test` → the same status, body and header set as `/api/nope`.
  - `server/test/integration/doors.int.test.ts` (dispatcher with doors, class `test`):
    - AC-35: `at = 2026-12-31T23:59:00Z`, speed 1 → `/api/time` within ±500 ms;
    - AC-36: speed 60, a real wait of 1 000 ms → +60 000 ±1 000;
    - AC-37: frozen, three reads 500 ms apart are equal;
    - AC-38: `601`, `-1`, `1.5` and `at:-5` → 400 `invalid-input`, and `GET /api/_test/clock` is unchanged;
    - AC-32: the four stubs → 501 with the exact body;
    - AC-33: a test-local door row with `dependencyBreaking` → 403 `lock-required` without the lock. With an exclusive holder written for this slug in a temp `T2F_LOCK_DIR` → executed;
    - AC-21: a `rehearsal` dispatcher with `T2F_TEST_DOORS=1` → `/api/_test/clock` 404, and `/api/time` within ±2 000 ms of `Date.now()`;
    - AC-39 (reset half): after `clock.reset()` → real time ±2 000 ms. The restart half is in W29.
- **Files:** `server/src/test-doors/registry.ts`, `server/src/test-doors/index.ts`, `server/src/app/api/[[...path]]/route.ts` (W13 file), `server/src/container.ts` (W13 file), `server/test/unit/doors-gating.test.ts`, `server/test/integration/doors.int.test.ts`.
- **Done means:**
  - both test files pass, with one `it` per AC bullet;
  - `grep -rn "test-doors" server/src --include=*.ts | grep -v "^server/src/test-doors/"` shows only the dynamic `import(` line in `route.ts`, or the `shouldLoadDoors` site.
- **Verify:** server targeted for the source files and the unit test; server integration `doors`.
- **Rules that apply:**
  - `engineering-paved-path:security` → A01 (doors are absent, not "forbidden", outside the test class), A10 (fail closed: an unreadable lock state means `lock-required`);
  - the "Test doors" contract check (W5 text);
  - constitution XIII (doors only in `test`).
- **Risk:** Turbopack may still bundle the dynamic import into the production build. That is acceptable: the module is never **evaluated** outside the test class, and the production e2e (W27) proves 404. Do not add a second gate based on a request header.

### W16 — Rate limits (P5)
- **Serves:** AC-48, AC-49, AC-50 (implementation and exclusive test), AC-51, AC-62 (rows), AC-11 support.
- **Do:**
  - `server/src/adapters/redis.ts`: `createRedisStore(env)`, an ioredis client.
    - Options: `db = slot` (from the `REDIS_URL` path), `keyPrefix` = `T2F_REDIS_PREFIX`, `enableOfflineQueue: false`, `maxRetriesPerRequest: 0`, `connectTimeout: 500`, `lazyConnect: true`.
    - It implements `FastStore`:
      - `incrWindow` = `MULTI INCR + PEXPIRE NX + PTTL`;
      - `setIfAbsent` = `SET NX PX`;
      - `deleteByPrefix` = `SCAN MATCH <prefix>*` + `UNLINK` in batches of 500.
    - Connection errors → `DependencyUnavailable`.
    - `createMemoryStore(clock)` is the in-process `FastStore` used by the `memory` policy.
  - `server/src/platform/rateLimit.ts` (ring 3):
    - `RateLimitRow = { key: string; limit: number; windowMs: number; keys: readonly ('subject'|'device'|'ipDay')[]; onStoreDown: 'fail-closed' | 'memory' }`. Every field is required, and there is no default (AC-48).
    - `checkLimit(row, ctx, stores)` → `ok` or `{ code:'rate_limited', retryAfterMs: max(1, ttlMs) }`. If the store throws `DependencyUnavailable`: `fail-closed` → `{ code:'unavailable' }`; `memory` → the same check on the memory store.
    - `ipDayKey(clock)` = `ipday:stub:` + the UTC date from the clock. It reads no request header (AC-51, a SPEC-05 stub).
  - `server/src/registries/rateLimits.ts`: an empty sorted array of `RateLimitRow` (domain waves add rows).
  - Fill the `30-rate-limit` middleware: a route with `rateLimit: '<row key>'` is checked. An unknown key is a startup error.
  - Tests:
    - `server/test/unit/mechanisms.test.ts`:
      - AC-48: `// @ts-expect-error` on a row without `onStoreDown`;
      - AC-51: `ipDayKey` is the same with forged `X-Forwarded-For` / `X-Real-IP`;
      - AC-62: `rateLimits`, `moments` and `subjectData` pass `assertRegistry`.
    - `server/test/integration/rate-limit.int.test.ts` (real Redis): a test row with limit N=3 → the 4th request is 429 with `retryAfterMs > 0`.
    - `server/test/exclusive/deps-down.exclusive.test.ts`. It runs only under `test:int:exclusive` and stops and starts shared containers with `docker compose -p t2f stop|start <svc>`:
      - AC-50: Redis stopped → the `fail-closed` row → 503 `unavailable`; the `memory` row is still enforced (4th → 429);
      - AC-72: Postgres stopped → a `needs:['db']` sample route → 503 `unavailable`, `/api/time` → 200;
      - AC-3 is added in W24.
- **Files:** `server/src/adapters/redis.ts`, `server/src/platform/rateLimit.ts`, `server/src/registries/rateLimits.ts`, `server/src/registries/middleware.ts` (P4 file), `server/test/unit/mechanisms.test.ts`, `server/test/integration/rate-limit.int.test.ts`, `server/test/exclusive/deps-down.exclusive.test.ts`.
- **Done means:**
  - `pnpm --dir server test` and `pnpm --dir server test:int -- rate-limit` pass;
  - the exclusive file exists and is excluded from `test:int` (its name does not match `*.int.test.ts`). It is **run** in W29, not here.
- **Verify:** server targeted; server integration `rate-limit`.
- **Rules that apply:** `engineering-paved-path:security` → A06 (rate limiting, fail-closed by declaration), A10; `engineering-paved-path:onion-architecture` → ban 2 (`rateLimit.ts` takes `FastStore`, never `ioredis`).
- **Risk:** with `keyPrefix`, `SCAN` must use the full prefix. Test `deleteByPrefix` explicitly in W18.

### W17 — Idempotency by `clientId` (P5)
- **Serves:** AC-52, AC-53, AC-54, AC-55.
- **Do:**
  - `server/src/platform/idempotency.ts` (ring 3):
    - `IdempotencyRow = { method: string; retention: 'chat' | 'order' }`, with `retention` required.
    - `idemKey(subject, method, clientId)` = `idem:<method>:<subject>:<clientId>`.
    - `runOnce(row, key, run, stores)`:
      - `begin` → `started`: run, then `finish(result)`; on a throw, `abort` and rethrow;
      - `running` → `{ code:'conflict', reason:'in-progress' }`;
      - `done` → the stored result.
    - `chat` uses the Redis store: `SET NX PX 86_400_000` for `running`, then `SET` the result with the same TTL. `order` uses the Payload store.
  - `server/src/adapters/payload.ts`: `createPayloadIdempotencyStore(getPayload)`:
    - `begin` = `payload.create({ collection:'idempotency-records', data:{ key, status:'running' }, overrideAccess:true })`; a unique violation → read the row;
    - `finish` = update to `done` + `result`;
    - `abort` = delete;
    - pg connection errors → `DependencyUnavailable`.
  - Fill the `40-idempotency` middleware. A route with `idempotency: '<method>'` reads `clientId` from the validated body (required string ≤ 64) and the subject from `ctx.subject`. In this wave the subject comes from test-local routes only; real subjects arrive with SPEC-10.
  - `server/test/integration/idempotency.int.test.ts` (test-local routes and rows):
    - AC-52: a repeat → the same body, counter = 1;
    - AC-53: another subject and another method → both executed;
    - AC-54: two concurrent requests (`Promise.all`, the handler awaits a latch) → one result and one 409 `in-progress`;
    - AC-55: the `chat` key TTL (`PTTL` through a raw ioredis client with the prefix) ≥ 86 400 000 ms; the `order` row is still read back after the Redis client is closed and recreated (proves the Postgres store).

    Add the type test "row without `retention` fails" to `mechanisms.test.ts` (W16 file, same phase).
- **Files:** `server/src/platform/idempotency.ts`, `server/src/adapters/payload.ts`, `server/src/registries/middleware.ts` (P5 shared), `server/test/integration/idempotency.int.test.ts`, `server/test/unit/mechanisms.test.ts` (shared).
- **Done means:** `pnpm --dir server test:int -- idempotency` passes, with one `it` per AC; the mechanisms unit test passes.
- **Verify:** server targeted; server integration `idempotency`.
- **Rules that apply:** `engineering-paved-path:onion-architecture` → ban 3 (Payload rows never leave `adapters/payload.ts`; it returns `{status, result}`); `engineering-paved-path:security` → A08 (the stored result is returned only for the same subject; the key contains the subject).
- **Risk:** a crashed handler leaves `running` rows for the `order` class. Mitigation: `abort` on throw. The process-crash case is a known limit; record it in the report for SPEC-17.

### W18 — Seed, reset and fixtures doors, moments registry (P5)
- **Serves:** AC-45 (registry part), AC-46, AC-47, AC-39 (reset), AC-62 (rows); enables AC-1.
- **Do:**
  - `server/src/seed/registry.ts`:
    - `SeedRow = { key; collection: string; naturalKey: string; source: AllowedSource | 'fixture'; fixture?: true; rows(): Promise<object[]> }`;
    - `ALLOWED_SOURCES` = the AC-45 list (`data/*.json` except `data/streams.candidates.json`, `scripts/seed/*.seed.json`, `lib/demo/seed.ts`);
    - an empty sorted `seedRegistry`.
  - `server/src/seed/index.ts`:
    - `runSeed(payload, rows = seedRegistry)`: an upsert by `naturalKey` (find, then update or create, `overrideAccess`). It returns counts per collection. It validates every `source` against `ALLOWED_SOURCES` before reading.
    - `resetWorktree(deps)`:
      - (1) delete all rows of every `resettable` collection in `collectionRegistry` (own `DATABASE_URI` only);
      - (2) `redis.deleteByPrefix('')` (the prefix is applied by the client, so only `t2f:<slug>:` keys);
      - (3) `testClock.reset()`;
      - (4) `runSeed`.
  - `server/src/seed/cli.ts`: `pnpm --dir server seed` → `getPayload` + `runSeed`, prints counts.
  - `server/src/registries/moments.ts`: an empty sorted array, with a type and a doc comment (SPEC-07 fills it).
  - Doors (`server/src/test-doors/registry.ts`, P4 file):
    - `reset`: `POST /api/_test/reset` → `resetWorktree` → `{ok:true,value:{}}`;
    - `fixtures`: `POST /api/_test/fixtures`, `TestFixturesBodySchema` → a `seedRegistry` row with `fixture: true` and that key → applied, 200; an unknown name → 404 `not_found`.
  - `server/test/integration/seed-reset.int.test.ts` (injected test row into `idempotency-records`, which is resettable):
    - AC-46: seed twice → equal counts;
    - AC-47:
      - write own-prefix keys, plus a foreign-prefix key in Redis DB 63 (slots use 0–47, so 63 never belongs to a worktree);
      - call `POST /api/_test/reset` through the dispatcher;
      - own keys are gone, the DB 63 key is still there, rows equal the after-seed state, the clock is real;
    - fixtures: a known name → 200, unknown → 404, `{}` → 400;
    - AC-45 (registry part): a row with `source: 'research_data/x.json'` is rejected by `runSeed` before any read.
- **Files:** `server/src/seed/registry.ts`, `server/src/seed/index.ts`, `server/src/seed/cli.ts`, `server/src/registries/moments.ts`, `server/src/test-doors/registry.ts` (P4 file), `server/test/integration/seed-reset.int.test.ts`.
- **Done means:** `pnpm --dir server test:int -- seed-reset` passes; `pnpm --dir server seed` exits 0 twice and prints the same counts.
- **Verify:** server targeted; server integration `seed-reset`.
- **Rules that apply:** `seed-and-fixtures` §1 (idempotent upsert by natural key; never `streams.candidates.json`), §2 (fixtures only through the door, test class), §3 (no `research_data`); `engineering-paved-path:security` → A01 (reset touches only this worktree's DB and prefix).
- **Risk:** `deleteByPrefix('')` with ioredis `keyPrefix`. `SCAN` does **not** apply `keyPrefix`, so pass the full prefix explicitly. The DB 63 assertion catches a mistake.

### W19 — Subject-data registry (P5)
- **Serves:** AC-57, AC-62 (rows).
- **Do:**
  - `server/src/platform/subjectData.ts` (ring 3): `SubjectDataHandler = { capability: string; export(id); erase(id); anonymise(id) }`. `runSubjectData(op, subjectId, handlers = subjectDataRegistry)` calls every handler with `Promise.allSettled` and returns `{ ok:true, results: Record<capability, unknown> }` or `{ ok:false, failed: string[] }`.
  - `server/src/registries/subjectData.ts`: an empty sorted array.
  - `server/test/integration/subject-data.int.test.ts`:
    - two test handlers, one rejects → `{ ok:false, failed:['<its name>'] }`;
    - none → `{ ok:true, results:{} }`.

    It needs no infrastructure; it sits in the integration folder to match the spec's level.
- **Files:** `server/src/platform/subjectData.ts`, `server/src/registries/subjectData.ts`, `server/test/integration/subject-data.int.test.ts`.
- **Done means:** the test passes; `mechanisms.test.ts` (W16) includes `subjectDataRegistry` in its `assertRegistry` loop.
- **Verify:** server targeted; server integration `subject-data`.
- **Rules that apply:** `engineering-paved-path:onion-architecture` → ring 3 with no adapter import.
- **Risk:** low.

### W20 — Stack scripts and root commands (P6)
- **Serves:** AC-1, AC-2 (implementation), AC-3, AC-5, AC-6 (server port), AC-19 (preflight), AC-61, NFR-6 (implementation).
- **Do:** `server/scripts/stack.mjs <cmd>` (imports `./lib/worktree.mjs`, `./db.mjs` helpers, `node:*`). It prints one line per step, `[stack] <step> ok (<ms> ms)`.
  - `up`:
    - `docker info --format "{{.ServerVersion}}"` (10 s timeout). On failure → `Docker is not reachable (start Docker Desktop): <first stderr line>`, exit 2, **before** any DB step (AC-5);
    - then `docker compose -p t2f -f <root>/docker-compose.yml up -d --wait postgres redis centrifugo mailpit`.
  - `down`: `docker compose -p t2f stop` (never `down -v`, never `rm`) (AC-3).
  - `db-create`: `db.mjs create` + `env`.
  - `serve`:
    - (1) probe the slot server port with `net.createServer().listen(port, host)`. `EADDRINUSE` → `port <n> is in use`, exit 3 (AC-6);
    - (2) preflight `pnpm env:check` → exit 1 on failure, **before** `next` starts (AC-19);
    - (3) host: `127.0.0.1` when the class is `test` (AC-61); `T2F_HOST` is accepted only for other classes;
    - (4) spawn `next dev -p <port> -H <host>` in `server/` with `.env.local` loaded, in the foreground, forwarding signals.
  - `start`: the same as `serve` but `next start` (used by the production e2e with `T2F_ENV=production`).
  - `smoke`: `GET http://127.0.0.1:<server>/api/time` → 200 + `TimeResponseSchema` shape (hand-checked: one integer key `now`); Redis `PING` (a raw `node:net` RESP command); Postgres `SELECT 1` (pg); Mailpit `GET :8025/api/v1/info`; Centrifugo `GET :8000/health`. It prints `smoke 5/5` or the failing ones, and exits 1 on any failure.
  - `all` (= `pnpm stack`): `up` → `db-create` → `pnpm --dir server migrate` → `pnpm --dir server seed` → `serve`. It prints the elapsed ms from start to "listening" (NFR-6).

  Root `package.json` scripts (scripts only):
  ```json
  "stack": "node server/scripts/stack.mjs all",
  "stack:up": "node server/scripts/stack.mjs up",
  "stack:down": "node server/scripts/stack.mjs down",
  "stack:smoke": "node server/scripts/stack.mjs smoke",
  "db:create": "node server/scripts/stack.mjs db-create",
  "build:int": "cross-env NEXT_PUBLIC_ENV=test NEXT_PUBLIC_API_MODE=http NEXT_DIST_DIR=out-int next build",
  "serve:int": "node server/scripts/serve-int.mjs",
  "contracts:run": "node scripts/contract-run.mjs"
  ```
- **Files:** `server/scripts/stack.mjs`, `package.json`.
- **Done means:**
  - `git diff master -- package.json` touches only `scripts`;
  - `pnpm stack` in this worktree prints `listening` on 4040, and `pnpm stack:smoke` prints `smoke 5/5`. Stop the server afterwards.
- **Verify:** `node --check server/scripts/stack.mjs`; the Done means run (Docker up).
- **Rules that apply:** `engineering-paved-path:security` → A02 (loopback in test), A10 (preflight fail closed); spawn without a shell.
- **Risk:** on Windows, `next` must be resolved as `node_modules/.bin/next.cmd` or through `process.execPath` + `next/dist/bin/next`. Prefer the latter.

### W21 — Integration static server with `/api` proxy (P6)
- **Serves:** AC-43, AC-71, AC-6 (static server port); enables AC-42.
- **Do:** `server/scripts/serve-int.mjs` imports only `node:http`, `node:fs`, `node:path`, `node:net`, `node:url` and `./lib/worktree.mjs`, which is itself `node:*`-only.
  - It serves `<root>/out-int` on `127.0.0.1:<web port>`.
  - Static: `trailingSlash` export layout (`/x/` → `x/index.html`); unknown → `404.html` with status 404; correct `Content-Type` for html, js, css, json, svg, png, webp, woff2, ico, txt.
  - `/api/*` → `http.request` to `127.0.0.1:<server port>`, the same method, path, headers and body piped.
  - Upstream error or timeout (10 s) → `502` with an empty body (AC-71).
  - Busy port → `port <n> is in use`, exit 3 (AC-6).
- **Files:** `server/scripts/serve-int.mjs`.
- **Done means:** `node --check` passes; `grep -nE "^import .* from '(?!node:|\./lib/worktree\.mjs)" server/scripts/serve-int.mjs` is empty, and the same for `lib/worktree.mjs` with `node:` only.
- **Verify:** `node --check server/scripts/serve-int.mjs`; behaviour in W24.
- **Rules that apply:** `engineering-paved-path:security` → path traversal (`path.resolve` must stay under `out-int`, else 404).
- **Risk:** low.

### W22 — Site dev rewrite for test + http (P6)
- **Serves:** AC-44; part of AC-67 and AC-69.
- **Do:**
  - In `next.config.ts`, after `API_MODE`:
    ```ts
    // SPEC-02 (AC-44): only `next dev` of the test build in http mode proxies /api/* to this worktree's server.
    // A static export ignores rewrites (output: 'export'); the integration build uses server/scripts/serve-int.mjs.
    const DEV_API_PROXY = TEST_BUILD && API_MODE === 'http' && process.env.NODE_ENV !== 'production';
    ```
    and inside `nextConfig`: `...(DEV_API_PROXY ? { rewrites: async () => [{ source: '/api/:path*', destination: \`http://127.0.0.1:${process.env.T2F_SERVER_PORT ?? '4000'}/api/:path*\` }] } : {}),`.
  - `tests/unit/next-config.test.ts` (`// @vitest-environment node`). For each of the four combinations (`NEXT_PUBLIC_ENV` test or unset × `NEXT_PUBLIC_API_MODE` sim or http, with `NODE_ENV=development`):
    - `vi.resetModules()`, then `vi.stubEnv` the three variables, then `await import('../../next.config')`;
    - assert `typeof cfg.rewrites === 'function'` only for test + http.

    Also, for `NODE_ENV=production` with test + http, `rewrites` is undefined. For production with no flags, the key set equals the expected list (`transpilePackages, output, trailingSlash, images, devIndicators, env, turbopack` and the next-intl additions). Compute that list once from the default build in the test, not from memory.
- **Files:** `next.config.ts`, `tests/unit/next-config.test.ts`.
- **Done means:** `npx vitest run tests/unit/next-config.test.ts --maxWorkers=2` passes; `git diff master -- next.config.ts` adds lines only.
- **Verify:** web targeted with `{files}` = `next.config.ts tests/unit/next-config.test.ts`.
- **Rules that apply:** `engineering-paved-path:next-best-practices` → self-hosting/rewrites (rewrites do not apply to `output: 'export'`, EC-13).
- **Risk:** Next may warn that "rewrites will not automatically work with output: export" during `next dev` of that one combination. A warning is acceptable; an error is not. Check it once with `pnpm dev:test` + `NEXT_PUBLIC_API_MODE=http` in W29.

### W23 — `time` contract suite on sim and http, and the contract runner (P6)
- **Serves:** AC-64; the Wire contract gate.
- **Do:**
  - `tests/contract/time.suite.ts`: `describeDomain(name, makeFetch: () => Promise<Response>)`. It asserts:
    - status 200;
    - `TimeResponseSchema` passes;
    - `Object.keys(body)` equals `['now']`;
    - the three headers are byte-equal (AC-40 list);
    - `now` is within ±5 000 ms of `Date.now()`, because the http run first calls `POST /api/_test/reset`.
  - `tests/unit/api/time-contract.test.ts`: `describeDomain('time (sim)', () => onRequestGet())`, importing `@/functions/api/time`.
  - `tests/contract/time.http.test.ts`: `describeDomain('time (http)', () => fetch(\`${process.env.T2F_SERVER_URL}/api/time\`))`, with `beforeAll` POSTing `/api/_test/reset` with an allowed `Origin`.
  - `tests/contract/vitest.http.config.ts`: node env, `include ['tests/contract/**/*.http.test.ts']`, `maxWorkers: 1`, `fileParallelism: false`.
  - `scripts/contract-run.mjs [--sim-only]`:
    - Domains = the union of the names from `tests/unit/api/<d>-{sim,contract}.test.*` and `tests/contract/<d>.http.test.ts`.
    - Sim = `npx vitest run tests/unit/api --maxWorkers=2 --reporter=json --outputFile=<tmp>`, mapped per domain.
    - Http = for domains with an http suite, `npx vitest run -c tests/contract/vitest.http.config.ts <file>`. `T2F_SERVER_URL` defaults to `http://127.0.0.1:<server port>` from `resolveWorktree`; the runner imports `server/scripts/lib/worktree.mjs`.
    - Other domains → `skipped (no server)`.
    - With `--sim-only` every http column is `skipped (sim-only)`.
    - Prints `domain | sim | http` and exits 1 if any non-skipped cell failed.
- **Files:** `tests/contract/time.suite.ts`, `tests/contract/time.http.test.ts`, `tests/contract/vitest.http.config.ts`, `tests/unit/api/time-contract.test.ts`, `scripts/contract-run.mjs`.
- **Done means:**
  - `npx vitest run tests/unit/api/time-contract.test.ts --maxWorkers=2` passes;
  - with the stack serving (W20), `pnpm contracts:run` prints every domain green on sim, `time` green on http, and every other domain `skipped (no server)`;
  - `pnpm contracts:run --sim-only` exits 0 without a server.
- **Verify:** web targeted with `{files}` = the four `tests/**` files; `pnpm contracts:run --sim-only`.
- **Rules that apply:** `contract-conformance` §2 (one suite per domain, two runs, http serial), §5 (runner output table).
- **Risk:** low.

### W24 — Stack-level tests (P6)
- **Serves:** AC-1, AC-5, AC-6, AC-11, AC-12 (single-worktree half), AC-43, AC-60 (`/cms-api`), AC-61, AC-71, NFR-7, NFR-8, AC-3 (exclusive file).
- **Do:**
  - `server/test/stack/stack.stack.test.ts` requires the stack served by `pnpm stack` in another terminal. It reads ports from `resolveWorktree` and `.env.local`.
    - AC-1: `/api/time` → 200, and `verify-schema` (a) reports no pending migration.
    - AC-5: `node scripts/stack.mjs up` with `DOCKER_HOST=tcp://127.0.0.1:1` (+ `DOCKER_CONTEXT=default`) → exit ≠ 0, stdout or stderr contains `Docker`, and no `[stack] db-create` line.
    - AC-6: occupy the server port and then the web port (with a probe on a spare slot via `T2F_SLOT=47`), run `serve` / `serve-int` → exit ≠ 0 and the port number in the output.
    - AC-11: ioredis `CONFIG GET databases` → `64`.
    - AC-43: start `serve-int` (`T2F_SLOT` of this worktree, `out-int` built by `pnpm build:int` beforehand; the test skips with a clear message if `out-int` is missing). `GET /` → `index.html` content; `GET /api/time` → the server body.
    - AC-71: `serve-int` with the server port pointed at a dead port (`T2F_SLOT=47`) → `/api/time` 502 with an empty body.
    - AC-60: `GET /cms-api/admins` → not 404 (Payload REST answers, 401/403/200).
    - AC-61: connect to every non-internal IPv4 of `os.networkInterfaces()` on the server port → `ECONNREFUSED`/timeout. Skip if the machine has none.
    - NFR-7: create an admin via `payload.create` on the worktree DB (random email `t+<slug>@example.com`), `POST /cms-api/admins/login` → `Set-Cookie` contains `HttpOnly` and `SameSite=Lax`, then delete the admin.
    - NFR-8: 1 000 sequential `fetch` → p95 ≤ 50 ms.
  - `server/test/stack/isolation.stack.test.ts` (AC-12, one worktree's half):
    - write rows tagged with the slug into `idempotency_records` of `t2f_<slug>_test`, keys under the prefix, and one mail to `mailAddress('iso')` via a raw SMTP dialogue on `node:net` to 1025;
    - then assert: every row's key contains the own slug; `SCAN` of the own Redis DB returns only own-prefix keys; the Mailpit search `to:<slug>` returns only messages whose recipients contain the own slug;
    - clean up its own data only.
  - `server/test/exclusive/stack-restart.exclusive.test.ts` (AC-3): insert a row, `stack.mjs down`, `stack.mjs up`, and the row is still there.
- **Files:** `server/test/stack/stack.stack.test.ts`, `server/test/stack/isolation.stack.test.ts`, `server/test/exclusive/stack-restart.exclusive.test.ts`.
- **Done means:** with `pnpm stack` running, `pnpm --dir server test:stack` passes (every case above as its own `it`). The exclusive file is run in W29.
- **Verify:** `pnpm --dir server test:stack`.
- **Rules that apply:** `engineering-paved-path:security` → test data uses `example.com`, no real addresses; `seed-and-fixtures` §3.
- **Risk:** the stack must be running, so this phase starts `pnpm stack` in the background and stops it at the end (`local-stack` §3: stop your own server).

### W25 — CI workflow, secret check, `research_data` check (P7)
- **Serves:** AC-65, AC-45 (static path check), NFR-3.
- **Do:**
  - `scripts/check-secrets.mjs`:
    - `git ls-files -z` (tracked + staged), excluding `pnpm-lock.yaml`, `*.png|jpg|webp|woff2`, `data/**`, `docs/**`;
    - it scans for the Secret Detection patterns of `engineering-paved-path:security` (AWS, Google `AIza…`, generic `(secret|key|token|password)\s*[:=]\s*['"][^'"]{8,}`, private key header, GitHub, npm, Slack tokens) plus `postgres(ql)?://[^:@\s]+:[^@\s]+@`;
    - it also fails if any tracked file matches `(^|/)\.env(\..*)?$` other than `.env.example`;
    - it prints `file:line pattern` (never the match) and exits 1 on a hit. Keep a small, explicit allowlist array (`file:line` + reason) for known test fakes such as `scripts/tests/test_no_key_leak.py:18`.
  - `scripts/check-research-data.mjs`: `git grep -n "research_data" -- server packages tests scripts/seed` → any hit exits 1 and prints `file:line`.
  - `.github/workflows/verify.yml`:
    - Keep the existing steps. Add the env `T2F_LOCK_DIR: ${{ runner.temp }}/t2f-locks` at job level and raise `timeout-minutes` to 30.
    - Services (GitHub cannot pass `--databases`, so CI uses slot 0 → Redis DB 0 of 16, which is enough):
      ```yaml
      postgres: { image: <same tag as compose>, env: { POSTGRES_USER: t2f, POSTGRES_HOST_AUTH_METHOD: trust }, ports: ['5433:5432'], options: --health-cmd "pg_isready -U t2f" --health-interval 5s --health-retries 20 }
      redis: { image: <same tag as compose>, ports: ['6380:6379'], options: --health-cmd "redis-cli ping" --health-interval 5s --health-retries 20 }
      ```
    - Steps after `rules full`:
      - `secret check`: `node scripts/check-secrets.mjs`;
      - `research_data path check`: `node scripts/check-research-data.mjs`;
      - `contract suites (sim)`: `pnpm contracts:run --sim-only`;
      - `server unit`: in `server`, `npx tsc --noEmit -p . && npx eslint . && npx vitest run --maxWorkers=2`;
      - `server integration`: in `server`, `node scripts/db.mjs create && node scripts/db.mjs env && pnpm migrate && pnpm test:int && node scripts/verify-schema.mjs`.
    - Update the header comment: "`web full`, `contracts full`, `rules full`, and the server steps (= `server.full` split in two) mirror `.claude/sdd-engineering.json`. Change them together."
- **Files:** `scripts/check-secrets.mjs`, `scripts/check-research-data.mjs`, `.github/workflows/verify.yml`.
- **Done means:**
  - both scripts exit 0 on the tree;
  - each exits 1 on a scratch file containing `AIza` + 35 chars / `research_data/` (create it, run, delete);
  - `grep -cE "name: (server unit|server integration|contract suites \(sim\)|secret check|research_data path check)" .github/workflows/verify.yml` → `5`;
  - `permissions: contents: read` is unchanged.
- **Verify:** the scripts; `node -e` YAML sanity via `npx --yes yaml@2 valid .github/workflows/verify.yml`, or skip with "not run" if unavailable. The local run of every step is in W28.
- **Rules that apply:** `engineering-paved-path:security` → Secret Detection table, A03 (actions pinned to major tags as the existing file does).
- **Risk:** false positives in existing files. Allowlist only with `file:line` and a reason; never weaken a pattern.

### W26 — Fix the five stand skills (P7)
- **Serves:** AC-66.
- **Do:** rewrite the stale parts with the facts of this plan.
  - `local-stack/SKILL.md`:
    - status "built by SPEC-02";
    - the commands `pnpm stack`, `stack:up`, `stack:down`, `stack:smoke`, `db:create`, `build:int`, `serve:int`, `pnpm --dir server {migrate,seed,serve,test:int,test:stack,test:int:exclusive}`;
    - slot rule (AC-7) and ports `4000+10·slot+offset` (0 server, 1 web, 2–5 fakes);
    - isolation (`t2f_<slug>`, `_test`, Redis DB = slot with prefix `t2f:<slug>:`, Redis host port 6380 with 64 DBs, channel prefix `<slug>_`, mail `name+<slug>@example.com`);
    - the integration lock (shared/exclusive, `.claude/sdd/locks/`, `T2F_LOCK_DIR`, 30 min / 60 min);
    - no minio (R2 emulator belongs to the first wave that writes R2);
    - `T2F_ENV`/`T2F_TEST_DOORS`.
  - `seed-and-fixtures`: status line, real paths `server/src/seed/{registry,index,cli}.ts`, doors `reset` and `fixtures`.
  - `migration-safety`: `pnpm --dir server migrate:create <name>`, `migrate`, `migrate:down`, `generate:types`, `node scripts/verify-schema.mjs`, `node scripts/db.mjs migcheck up|drop`.
  - `layout-fidelity`: door names are final; `/api/_test/last-code` is a 501 stub until SPEC-10; `playwright.http.config.ts` is still SPEC-04.
  - `contract-conformance`: `packages/contracts/src/schemas.ts` (`@time2fest/contracts/schemas`), `tests/contract/<d>.suite.ts`, `pnpm contracts:run [--sim-only]`, http config `tests/contract/vitest.http.config.ts`.

  Keep each file's frontmatter `name`; update `description` only where it says "SPEC-01" or "TODO".
- **Files:** `.claude/skills/{local-stack,seed-and-fixtures,migration-safety,layout-fidelity,contract-conformance}/SKILL.md`.
- **Done means:**
  - `grep -nE "SPEC-01|S01|TODO-until-created|minio" .claude/skills/{local-stack,seed-and-fixtures,migration-safety,layout-fidelity,contract-conformance}/SKILL.md` is empty, except lines that name SPEC-01 as the owner of `packages/contracts` (allowed, listed in the report);
  - `grep -n "4000+10" .claude/skills/local-stack/SKILL.md` matches the AC-8 formula.
- **Verify:** the greps.
- **Rules that apply:** AC-66 only; `docs-sync` style (English in skills, as now).
- **Risk:** low.

### W27 — e2e: integration-build time (AC-42) and production 404 (AC-30, AC-31) (P7)
- **Serves:** AC-42, AC-30, AC-31.
- **Do:**
  - `server/playwright.config.ts`: `testDir: 'test/e2e'`, `workers: 2`, one project `chromium` with no `webServer`. The orchestrator starts the servers in W29. `baseURL` comes from `T2F_E2E_BASE`.
  - `server/test/e2e/time-int.e2e.ts` (AC-42):
    - `request.post(\`${server}/api/_test/clock\`, { data: { at: X, frozen: true }, headers: { Origin: web } })`, with `X = Date.parse('2026-12-31T23:59:00Z')`;
    - `page.goto(web + '/')`;
    - `const r = await page.evaluate(() => (window as any).__t2fTimePrefetch?.promise)`;
    - expect `Math.abs(r.now - X) <= 2000`;
    - then reset.
  - `server/test/e2e/doors-404.e2e.ts` (AC-30/31), against the server started with `T2F_ENV=production`:
    - for every door path of the registry (a static list in the test, equal to `test-doors/registry.ts` paths — assert the count is 8) and `/api/nope`, with the same method;
    - status, body and header names (excluding `date`) are equal;
    - repeated with `X-T2F-Test-Doors: 1`, `?doors=1` and the cookie `t2f_env=test`.
- **Files:** `server/playwright.config.ts`, `server/test/e2e/time-int.e2e.ts`, `server/test/e2e/doors-404.e2e.ts`.
- **Done means:** `npx tsc --noEmit -p .` in `server/` includes and passes these files. They are run in W29.
- **Verify:** server targeted with the three files (typecheck + lint; vitest finds no tests there).
- **Rules that apply:** `engineering-paved-path:security` → A01 (indistinguishable 404); the "Test doors" contract check.
- **Risk:** low.

### W28 — Full verification and static checks (P7, no file changes)
- **Serves:** AC-63, AC-65 (local run), AC-67, AC-68, AC-69, NFR-1, NFR-2, NFR-5; the Layout fidelity proof.
- **Do (each command once, output `| tail -40`):**
  1. `server` `full` from the config, in `server/`, with the stack's Postgres and Redis up.
  2. `contracts` `full` in `packages/contracts`; `rules` `full`.
  3. `web` `full` at the root (includes `next build` into `out-verify`); then `grep -rl "ZodError" out-verify/_next/static` must be empty.
  4. `pnpm build:demo`; `git diff master -- vercel.json` must be empty (AC-69).
  5. The http bundle guard and the unchanged-site proof, with ports 3000/3100 free (`--workers=2`):
     - `npx playwright test tests/e2e/us8-production.prod.spec.ts --project=prod`;
     - `npx playwright test tests/e2e/us8-time-machine.spec.ts --project=phone --project=desktop`.
  6. AC-65 local CI:
     - `node scripts/check-secrets.mjs`;
     - `node scripts/check-research-data.mjs`;
     - `pnpm contracts:run --sim-only`;
     - the two server steps exactly as in the workflow (with `T2F_LOCK_DIR` set to a temp dir).
  7. AC-67:
     - `git diff master --name-only | grep -vE '^(server/|fakes/|docs/|\.claude/|tests/|packages/contracts/|scripts/(contract-run|check-secrets|check-research-data)\.mjs$|scripts/contract-surface\.baseline\.json$|\.github/workflows/verify\.yml$|docker-compose\.yml$)'` ⊆ {`tsconfig.json`, `eslint.config.mjs`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `next.config.ts`};
     - `git diff master -- tsconfig.json` = one line;
     - `git diff master --name-only -- lib/time packages/rules lib/engine lib/toast/season.ts lib/rating` is empty.
  8. AC-68: `pnpm -r ls --depth -1` lists `@time2fest/server`.
  9. NFR-2: no `^`/`~` in `server/package.json` or `packages/contracts/package.json`; all of `payload`/`@payloadcms/*` are `3.91.0`.
  10. NFR-5: `grep -rnE "vitest (run|related)" .claude/sdd-engineering.json server/package.json .github/workflows/verify.yml` → each with `--maxWorkers=2`, or `=1` for `test:int`/`test:stack`/http.
- **Files:** none.
- **Done means:** every command above exits 0 or gives the stated output; failures are fixed in the owning item and re-run once.
- **Verify:** as listed.
- **Rules that apply:** `sdd-format` §6 (full once per package).
- **Risk:** step 5 builds the site (`pnpm build`) on 3100. Run it alone (the orchestrator's heavy lock).

### W29 — Heavy integration proofs (P7, no file changes; orchestrator runs them under the machine heavy lock)
- **Serves:** AC-2, AC-3, AC-12, AC-30, AC-31, AC-39 (restart), AC-42, AC-50, AC-72, NFR-6, AC-44 (one dev check).
- **Do (one at a time, each result in the report):**
  1. **NFR-6 + AC-1:** images already pulled, `pnpm stack:down` then a timed `pnpm stack` → the printed ms to "listening" is ≤ 120 000. Then `pnpm stack:smoke` → `5/5`.
  2. **AC-39 restart:** set the clock frozen at X through the door, stop and start `pnpm --dir server serve`, then `/api/time` ≈ `Date.now()` ±2 000.
  3. **AC-2 offline:** after step 1, the owner or orchestrator disables the network adapter (or Wi-Fi), then runs `pnpm stack:down && pnpm stack` and `pnpm stack:smoke` → `5/5`. Paste the output and re-enable the network. This is manual: a test cannot cut the host's network.
  4. **Exclusive suite (AC-3, AC-50, AC-72):** `pnpm --dir server test:int:exclusive`. It takes the exclusive lock, so it waits for other worktrees' shared runs, and it stops and starts shared containers.
  5. **AC-12 two worktrees:**
     - `git worktree add ../spec-02b-isoprobe -b spec-02b-isoprobe spec-02-server-skeleton` (slot 5); `pnpm install --frozen-lockfile` and `pnpm db:create` there;
     - run `pnpm --dir server test:int` **and** `pnpm --dir server test:stack -- isolation` (with `pnpm stack` up in each) in both worktrees at the same time;
     - both green, and each worktree's own isolation assertions hold;
     - then remove the probe worktree, its branch, and **only** its DBs `t2f_spec_02b_isoprobe{,_test}` (`DROP DATABASE` by exact name).
  6. **AC-42:**
     - `pnpm build:int`;
     - `pnpm stack` (server on 4040) and `pnpm serve:int` (web on 4041);
     - `T2F_E2E_BASE=http://127.0.0.1:4041 T2F_SERVER_URL=http://127.0.0.1:4040 pnpm --dir server test:e2e -- time-int`.
  7. **AC-30/31 production:**
     - `pnpm --dir server build`, then `T2F_ENV=production T2F_ALLOWED_ORIGINS=https://time2fest.com pnpm --dir server start` on the slot port (loopback, own DB);
     - `T2F_E2E_BASE=http://127.0.0.1:4040 pnpm --dir server test:e2e -- doors-404`;
     - stop the server.
  8. **AC-44 dev check:** `npx cross-env NEXT_PUBLIC_ENV=test NEXT_PUBLIC_API_MODE=http T2F_SERVER_PORT=4040 next dev -p 3040` with the server up → `curl -s localhost:3040/api/time` returns the server's `{now}`. Record any warning, then stop.
  9. Stop every process this phase started. Leave the shared containers running.
- **Files:** none in this worktree. The probe worktree is temporary and removed.
- **Done means:** each step's stated result is in the report. A step that could not run is reported "not run" with the reason, never "passed".
- **Verify:** as listed.
- **Rules that apply:** `local-stack` §3 (never drop volumes or other worktrees' DBs; never `docker system prune`); `sdd-routing.md` §7 (≤2 heavy processes).
- **Risk:** step 5 needs a second `node_modules` (disk, RAM). Run it alone and clean up immediately.

### W30 — Docs patch in the wave report (P7, no file changes)
- **Serves:** AC-70.
- **Do:** copy `## Docs patch (root, for orchestrator)` of this plan into the wave report. Update it with any name changed during the run (`## Deviations`). Do **not** edit any file under `D:/Work/Pets/Time2Fest/docs/`.
- **Files:** none.
- **Done means:**
  - the report contains the patch section;
  - `git -C D:/Work/Pets/Time2Fest/web status --porcelain` shows nothing new from this wave (the root `D:/Work/Pets/Time2Fest` is not a git repo, so the check is that no file under `D:/Work/Pets/Time2Fest/docs/backend/` has a modification time after the wave start: `find D:/Work/Pets/Time2Fest/docs/backend -newer docs/specs/SPEC-02-server-skeleton.md` is empty).
- **Verify:** the `find`.
- **Rules that apply:** `docs-sync` (the orchestrator writes root docs, in Ukrainian).
- **Risk:** low.

## Execution
Each phase or lane is one `sdd-engineering:implementer` dispatch with this plan's path and the phase or lane id. Phases run in order. Only P2 has two lanes, L2a and L2b, which may run in parallel because their file sets are disjoint and neither runs a generator that touches the other's files.

The `server` targeted verify is real from P1 (W5). Docker Desktop must be running from P3 on (Postgres and Redis via `docker compose -p t2f up -d --wait postgres redis`). Integration runs go through `pnpm test:int`, which takes the shared lock.

| Lane / phase | Executor | Model | Work items | Files (disjoint) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — install and toolchain | `sdd-engineering:implementer` | sonnet | W1, W2, W3, W4, W5 | `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `server/package.json`, `packages/contracts/package.json`, `server/{tsconfig.json,eslint.config.mjs,vitest.config.ts,vitest.integration.config.ts,vitest.stack.config.ts,.env.example}`, `server/src/ports.ts`, `tsconfig.json`, `eslint.config.mjs`, `docker-compose.yml`, `fakes/{ai,youtube,paypro}/.gitkeep`, `.claude/sdd-engineering.json` (19, all config) | — | — | this worktree alone; `pnpm install` is the only generator and the **only** phase that adds dependencies |
| P2 · L2a — worktree, lock, env, logger, clock | `sdd-engineering:implementer` | **opus** — cross-process lock with leases and takeover (silent races) and the env isolation guard that stops a test env writing to production resources | W6, W7, W8, W9 | `server/scripts/lib/{worktree,lock}.mjs`, `server/scripts/lock.mjs`, `server/src/ports.ts`, `server/src/platform/{registry,env,env.check,logger}.ts`, `server/src/registries/env.ts`, `server/src/clock/index.ts`, `server/test/unit/{worktree,lock,platform,clock}.test.ts` (14) | P1 | L2b | this worktree; no generator |
| P2 · L2b — contracts vocabulary and schemas | `sdd-engineering:implementer` | sonnet | W10 | `packages/contracts/src/{result,schemas}.ts`, `packages/contracts/test/{platform-reasons,schemas}.test.ts`, `scripts/contract-surface.baseline.json` (5) | P1 | L2a | this worktree; `contract-surface.mjs --update` writes only the baseline |
| P3 — Payload and schema | `sdd-engineering:implementer` | sonnet | W11, W12 | `server/next.config.mjs`, `server/src/payload.config.ts`, `server/src/collections/{admins,idempotencyRecords}.ts`, `server/src/registries/collections.ts`, `server/src/instrumentation.ts`, `server/src/app/(payload)/**` (6), `server/scripts/{db,verify-schema}.mjs`, `server/src/migrations/*` (gen.), `server/src/payload-types.ts` (gen.), `server/test/integration/{global-setup.ts,payload-schema.int.test.ts}` (20 incl. 4 generated and 6 template files) | P2 (both lanes: `loadEnv`, `assertRegistry`, schemas) | — | this worktree alone: the Payload generators (`migrate:create`, `generate:types`, `generate:importmap`) run here |
| P4 — HTTP pipeline, `/api/time`, test doors | `sdd-engineering:implementer` | **opus** — test doors (`sdd-routing.md` §2), fail-closed same-origin, production 404 parity, error-model leakage | W13, W14, W15 | `server/src/endpoints/{types,pipeline,time}.ts`, `server/src/registries/{routes,middleware}.ts`, `server/src/container.ts`, `server/src/app/api/[[...path]]/route.ts`, `server/src/test-doors/{index,registry}.ts`, `server/test/unit/doors-gating.test.ts`, `server/test/integration/{pipeline,time,doors}.int.test.ts` (13) | P3 | — | this worktree |
| P5 — rate limits, idempotency, seed/reset, subject data | `sdd-engineering:implementer` | **opus** — concurrent idempotency (`in-progress`), per-row Redis-down policies, reset that must stay inside one worktree's DB and prefix | W16, W17, W18, W19 | `server/src/adapters/{redis,payload}.ts`, `server/src/platform/{rateLimit,idempotency,subjectData}.ts`, `server/src/registries/{rateLimits,moments,subjectData,middleware}.ts`, `server/src/seed/{registry,index,cli}.ts`, `server/src/test-doors/registry.ts`, `server/test/unit/mechanisms.test.ts`, `server/test/integration/{rate-limit,idempotency,seed-reset,subject-data}.int.test.ts`, `server/test/exclusive/deps-down.exclusive.test.ts` (21) | P4 | — | this worktree; does **not** run the exclusive file |
| P6 — stack, integration build, contract runner | `sdd-engineering:implementer` | sonnet | W20, W21, W22, W23, W24 | `server/scripts/{stack,serve-int}.mjs`, `package.json`, `next.config.ts`, `tests/unit/next-config.test.ts`, `tests/contract/{time.suite.ts,time.http.test.ts,vitest.http.config.ts}`, `tests/unit/api/time-contract.test.ts`, `scripts/contract-run.mjs`, `server/test/stack/{stack,isolation}.stack.test.ts`, `server/test/exclusive/stack-restart.exclusive.test.ts` (14) | P5 | — | this worktree; starts `pnpm stack` in the background for W23/W24 and stops it at the end; one `pnpm build:int` |
| P7 — CI, skills, e2e, full proof, heavy proofs, docs patch | `sdd-engineering:implementer` (W25–W28, W30) + **orchestrator** under the machine heavy lock (W29) | sonnet | W25, W26, W27, W28, W29, W30 | `scripts/{check-secrets,check-research-data}.mjs`, `.github/workflows/verify.yml`, `.claude/skills/{local-stack,seed-and-fixtures,migration-safety,layout-fidelity,contract-conformance}/SKILL.md`, `server/playwright.config.ts`, `server/test/e2e/{time-int,doors-404}.e2e.ts` (11) | P6 | — | W28 step 5 and all of W29 are **heavy**: one at a time, under the orchestrator's machine heavy lock (`.claude/sdd/heavy.lock`, unrelated to the integration lock). W29 step 5 uses a temporary second worktree and removes it |

Seven phases (eight dispatches with the P2 lanes).

**Why P1, P3, P5 and P7 exceed ~12 files:**
- P1 is 19 one-screen config files with no logic.
- P3 has 6 Payload template files and 4 generated files.
- P5 shares the registries with its four mechanisms, which are one coherent concern.
- P7 is mostly Markdown.

Splitting them would push the plan to 9–10 phases, past the target of 7.

**Escalation:** sonnet phases follow `run-plan-auto` §3. P3 escalates to Opus if Next/Payload fails to build twice.

## Verification plan
| Command | Directory | Passing means |
|---|---|---|
| `npx tsc --noEmit -p . && npx eslint . && npx vitest run --maxWorkers=2 && pnpm test:int && node scripts/verify-schema.mjs` (server `full`, W5) — needs `docker compose -p t2f up -d --wait postgres redis` | `server` | exit 0 |
| `npx tsc --noEmit -p . && npx vitest run --maxWorkers=2 && node ../../scripts/contract-surface.mjs --check` (contracts `full`) | `packages/contracts` | exit 0 |
| `npx tsc --noEmit -p .` (rules `full`) | `packages/rules` | exit 0 |
| web `full` from the config (includes `contract-surface --check` and `next build` to `out-verify`) | `.` | exit 0; `grep -rl ZodError out-verify/_next/static` empty |
| `pnpm build:demo` | `.` | exit 0; `git diff master -- vercel.json` empty |
| `npx playwright test tests/e2e/us8-production.prod.spec.ts --project=prod --workers=2`; `npx playwright test tests/e2e/us8-time-machine.spec.ts --project=phone --project=desktop --workers=2` | `.` | exit 0 (heavy, alone) |
| `pnpm contracts:run --sim-only`; `pnpm contracts:run` (stack up) | `.` | sim all green; http: `time` green, others `skipped (no server)` |
| `node scripts/check-secrets.mjs && node scripts/check-research-data.mjs` | `.` | exit 0 |
| `pnpm stack` then `pnpm stack:smoke` | `.` | listening ≤120 s; `smoke 5/5` |
| `pnpm --dir server test:stack` | `.` | exit 0 (stack up) |
| `pnpm --dir server test:int:exclusive` | `.` | exit 0 (heavy; exclusive lock) |
| `pnpm --dir server test:e2e -- time-int` / `-- doors-404` with the W29 setup | `.` | exit 0 (heavy) |
| static greps of W25, W26 and W28 steps 7–10 | `.` | as stated in the items |

## Docs patch (root, for orchestrator)
The orchestrator applies these to the Time2Fest root (Ukrainian text, `docs-sync`). The wave does not edit them (AC-70).

1. **`D:/Work/Pets/Time2Fest/docs/backend/architecture.md`** (new). Content:
   - **Server rings in `server/src/`:**
     - ring 1 (pure, no I/O, tested without Docker): `platform/registry.ts`, the parsing in `platform/env.ts`, the `virtualNow` math in `clock/`, and future `domain/**` rules;
     - ring 2: `ports.ts` (`Clock`, `Logger`, `Alarm`, `FastStore`, `IdempotencyStore`, `LockState`);
     - ring 3 (use cases over ports): `platform/{rateLimit,idempotency,subjectData}.ts`, `seed/index.ts`;
     - ring 4: `adapters/{redis,payload}.ts`, `endpoints/**` (driving), `test-doors/**`, `app/**`, `collections/**`, `clock/index.ts` (wall clock);
     - composition root: `container.ts` and `registries/**`.
   - **Payload layering:**
     - collections, hooks, access and endpoints are thin;
     - any rule checkable without a database lives in `server/src/domain/**` as a pure function and is called from a hook or an endpoint;
     - a hook never calls another domain's collection directly; it goes through that domain's ring-3 service;
     - Payload rows never leave `adapters/` (DTOs only);
     - Payload REST lives under `/cms-api` (not proxied by the Worker), GraphQL is disabled, and public routes exist only in `registries/routes.ts`.
   - **Adding a domain = one row per registry:** `collections`, `routes`, `middleware` (rare), `test-doors/registry`, `seed/registry`, `rateLimits`, `moments`, `subjectData`, `env` blocks. Each list is sorted by key, with duplicates rejected by `assertRegistry`.
   - **Time:** only through `server/src/clock`. ESLint bans `Date.now()`/`new Date()` elsewhere.
   - **Errors:** `ApiResult` failure bodies with the status map, reasons from `@time2fest/contracts`, no text.
2. **`docs/backend/README.md` §6 Commands** — replace the "Local stand" row ("commands will appear in SPEC-02") with:
   - `pnpm stack` (everything, server in the foreground);
   - `pnpm stack:up` / `stack:down` / `stack:smoke`, `pnpm db:create`;
   - `pnpm --dir server {migrate,seed,serve,test,test:int,test:stack,test:int:exclusive,test:e2e}`;
   - `pnpm build:int` + `pnpm serve:int`, `pnpm contracts:run [--sim-only]`;
   - server check (target / full) = the config `server` entries.
   Add a row: "Integration lock: `node server/scripts/lock.mjs --mode shared|exclusive -- <cmd>`, folder `.claude/sdd/locks/` of the main checkout".
3. **`docs/backend/README.md` §9** — remove from "what does not exist yet": `server/`, `docker-compose.yml`, seed and fixtures mechanism, test doors, `verify` for `server`, tsconfig/eslint exclusions. What remains missing: `http-seeds.mjs`, `compare-live.mjs`, the `http` Playwright config, masks (SPEC-04); the fakes (SPEC-09/12/17); minio (first R2 wave). Add: "`web/.graphifyignore` — add `server/` and `packages/` (untracked file of the main checkout)".
4. **`docs/backend/sdd-routing.md` §1** — the `server/src` layout differs from the proposal. Change these rows:
   - onion: `server/src/**/*.ts` with excludes `server/src/app/**`, `server/src/collections/**`, `server/src/migrations/**`, `server/src/payload-types.ts`, `**/*.test.ts` (replacing `server/src/{domain,chat,jobs}/**`);
   - security: add `server/src/endpoints/**` (already present), `server/src/container.ts`, `server/src/platform/env.ts`, `server/scripts/**`;
   - seed-and-fixtures: `server/src/seed/**` (already present); fixtures live as `fixture: true` rows of `server/src/seed/registry.ts` (no `server/src/test-doors/fixtures/**` folder);
   - contract-conformance: add `tests/unit/api/*-contract.test.ts` and `scripts/contract-run.mjs`;
   - add an unrouted note: `server/test/**` (no testing-library row applies).
5. **`docs/backend/frontend-seam.md` §3.11** — rows:
   - `GET /api/time` now also served by `server/` (bare `{now}`, AC-40);
   - the test doors under `/api/_test/` (test class only);
   - the vocabulary rows for the reasons `invalid-input`, `in-progress`, `lock-required` (`@time2fest/contracts`, `PLATFORM_REASONS`).
6. **Main checkout, local only:** append `server/` and `packages/` to `web/.graphifyignore`. The file is untracked (`.git/info/exclude:9`). Then `cd server; graphify update .` per `graphify-rules`.
7. **`docs/backlog.md`** — `order`-class idempotency rows left in `running` by a process crash need a sweep (SPEC-17).

## Assumptions
Technical judgement calls only:
- **Server layout** is `server/src/{ports.ts,platform,clock,registries,adapters,container.ts,endpoints,test-doors,seed,collections,app,migrations}`, rather than the routing proposal's `domain/` (no domain rules exist yet). The routing patch is in Docs patch item 4.
- **One catch-all route** `server/src/app/api/[[...path]]/route.ts` serves every `/api/*`, including `/api/time` and the doors. The alternatives were Payload root endpoints or one Next route per path; the catch-all keeps the clock singleton and the door gate in one module graph. Payload root endpoints would also sit under the REST prefix (research §3).
- **Payload REST prefix is `/cms-api`.** It is not proxied by the Worker, which handles only `/api/*`, so it counts as non-public. A Next app folder starting with `_` would be private and unroutable, so `_payload` is not an option.
- **Worktree tooling is plain `.mjs`** with `// @ts-check`, Node built-ins only (plus `pg` in `db.mjs`, `stack.mjs`). This lets `serve-int.mjs` satisfy AC-43, and the lock and slot logic run before any install-dependent code. TS CLIs (`env.check.ts`, `seed/cli.ts`) run through `tsx`, which `payload` already depends on.
- **Postgres `trust` auth on loopback 5433** and an insecure Centrifugo API on loopback. Local only, so no credential is committed (NFR-3).
- **Redis host port 6380** (mirrors 5433) and `--save ""`. AC-3 concerns Postgres rows, which live in the `t2f_pgdata` volume.
- **Sample routes for AC-22 … AC-28, AC-49, AC-52 … AC-54 and AC-72 are test-local.** They are passed to `createDispatcher` in the tests, never registered, so no production surface exists for them.
- **`/api/*` 404 body** is `{ ok:false, error:{ code:'not_found' } }`. It is the same for unknown paths and for doors outside the test class (AC-30).
- **CI uses slot 0** (the main checkout of a clean clone) and Redis DB 0 of the service container's default 16. `--databases 64` cannot be passed to a GitHub service container, and AC-11 is proven locally (W24).
- **Lock fairness is not added** (no writer preference). AC-13 and AC-14 define only holder-based waiting, and AC-15's 30-minute limit bounds starvation.
- **The `order` idempotency store is a Payload collection `idempotency-records`.** AC-59 allows schema changes only through Payload migrations, so the first migration includes it alongside `admins`.

## Open questions
None.

## Research used
- `C:/Users/ADMIN/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/side-session-notes/local_359ad0f2-bcef-4e10-835b-0930d88a93eb/spec-02/research-code.md` (skills vs card, time seam, contracts, CI, exclusions).
- `…/spec-02/research-payload-auth.md` (Payload minimal set, migrations, push, `public` schema, root endpoints).
- One planner researcher (`research-tools:researcher`, Sonnet, 2026-11-16) on `payload@3.91.0` sources:
  - peers: `next >=16.3.3 <17`, `react ^19.2.1`, `graphql ^16.8.1`, engines `>=20.18.1`;
  - `graphQL.disable` and the GraphQL routes as plain files;
  - `routes.api` decides the REST file location;
  - auth cookies are HttpOnly by default, `auth.cookies.sameSite`;
  - `migrate:status` always exits 0;
  - `migrate:create` needs no DB;
  - the CLI loads TS via the bundled `tsx`;
  - the blank-template file list;
  - an `admins` auth collection suppresses `users` (`sanitize.ts:72-90`).

  **Not established:** the GraphQL handler behaviour when disabled (irrelevant: no route files); the default `migrationDir` (set explicitly); whether `migrate:create` resolves paths from cwd (always run from `server/`); runtime compatibility of Next 16.4.1 / React 19.3.0 with 3.91.0 (W11 risk, BLOCKED rule).
- Spot-checked by the planner in this worktree:
  - `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `eslint.config.mjs`, `playwright.config.ts`, `.gitignore`, `.github/workflows/verify.yml`, `.claude/sdd-engineering.json`;
  - `packages/contracts/{package.json,tsconfig.json,src/index.ts,src/result.ts}`, `functions/api/time.ts`, `tests/unit/functions-time.test.ts`, `scripts/contract-surface.mjs:1-90`;
  - `lib/api/{mode.ts,services.ts:20-50}`, `lib/time/{testApi.ts,params.ts:86-200,timePrefetch.ts:1-30,TimeSource.ts:60-110}`, `app/layout.tsx:20-40`;
  - the five skills' stale lines;
  - the main checkout's uncommitted `tsconfig.json`/`eslint.config.mjs` diff and `.git/info/exclude`.
- Knowledge file `docs/knowledge/gotchas.md` (config `knowledgeFiles`) does not exist yet. There is no project `CLAUDE.md` in `web/`.

## Rollback / blast radius
- Nothing is committed by the run. Rollback means:
  - discard the worktree changes (`git restore` the modified files, `git clean -fd server fakes tests/contract`);
  - `pnpm install` to restore `node_modules`;
  - drop **only** `t2f_spec_02_server_skeleton`, `…_test` and `…_migcheck`;
  - leave the shared containers and volumes alone.
- Blast radius if merged:
  - **Site build and demo:** `next.config.ts` adds a key only in dev test + http; the exclusions do not change output. Proven by W28 steps 3–5. Vercel keeps the previous deploy on failure.
  - **Lockfile:** additions for `server` and `zod`. A wrong resolution would break `pnpm install --frozen-lockfile` on Vercel; W28 step 4 (`build:demo`) and the CI install catch it.
  - **Other worktrees on the machine:** shared containers (`t2f` project), the integration lock folder, Redis DBs by slot. The exclusive suite and the AC-12 probe stop containers or create a second worktree, and run only under the heavy lock.
  - **CI:** the workflow grows by 5 steps and 2 service containers. Nothing is pushed in this wave.
- No production resource is touched. `PRODUCTION_DENYLIST` is empty until SPEC-13a.
