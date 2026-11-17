# Implementation plan: Cloudflare edge (SPEC-05)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-05-cloudflare-edge.md` (Status: approved; checker 2026-11-17: 0 markers, 0 violations). AC-1 … AC-51, NFR-1 … NFR-5. Open questions 1–3 of the spec are non-blocking (SPEC-13a, pre-launch wave, SPEC-22a).
This plan implements those requirements; it does not define or change them.
**Execution mode** — multi-agent with **one lane of sequential phases** P1 … P9: one `sdd-engineering:implementer` dispatch per phase, never two at once. Phase L is run by the wave lead (main session), not by an implementer. Chosen by the owner and passed in the orchestrator's brief on 2026-11-17 (16 GB machine; another wave runs heavy work in parallel).
**Out of scope** — the spec's Non-goals (`:24-32`): FR-EDGE-02/05/06/12 (snapshot cache, purge, red button, `HIT` on snapshots — SPEC-08); admin, `/cms-api/*`, Access (SPEC-04); Centrifugo host (SPEC-06); the real server, rehearsal deploy, secret rotation (SPEC-13a); the PayPro webhook handler (SPEC-17); the real session cookie (SPEC-10); the pre-launch build mode, SEO files, `public/_headers` noindex, any deploy to `time2fest.com`; deploys of `rehearsal`/`prelaunch`/`production`; Workers VPC, Authenticated Origin Pulls, R2, Bot Fight Mode path rules; FR-ID-17. No Payload collection, global or migration. Architecture and security review are performed by separate agents.

Repository root for every path below = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-05-cloudflare-edge` (branch `spec-05-cloudflare-edge`, base `eb2fece`). `node_modules` is installed. Slot 10: server port **4100**, web 4101, Redis DB 10 (`server/scripts/lib/worktree.mjs:86-88`). **Do not commit, never push** (the wave lead commits). **No implementer writes outside this worktree.** Never read `.env*` contents, `pnpm-lock.yaml`, `out*`, `.next*`, `node_modules` sources beyond `.d.ts` lookups.

**Shared with SPEC-04 (merges after us):** `server/src/registries/*.ts`, `packages/contracts/src/index.ts`, `server/src/payload.config.ts`, `.github/workflows/verify.yml`, `.claude/sdd-engineering.json`, root `package.json`, `tsconfig.json`, `eslint.config.mjs`. In these files add lines only — one entry per line, sorted where the file is sorted, no reformatting, no reordering. This wave does not touch `packages/contracts/**` or `payload.config.ts`.

## Requirements traceability
| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | wrangler config: assets, `run_worker_first` `/api`+`/api/*`, `force-trailing-slash`, no workers.dev/preview, 4 envs | `docs/specs/SPEC-05-cloudflare-edge.md:51` | W2 | W2 |
| AC-2 | non-`/api` paths from static, never origin; live with server stopped | `:54` | W4, W6, W26 | W6; live W29 |
| AC-3 | `/api` exact or WebSocket upgrade → single 404 `private, no-store` | `:57` | W4, W6 | W5, W6 |
| AC-4 | `functions/` gone; root tsc/eslint/vitest do not check `workers/**`, `infra/**` | `:60` | W1, W7 | W7, W28 |
| AC-5 | proxy passes method, path, query, headers, body stream; only `x-t2f-*` changed | `:65` | W4 | W5, W6 |
| AC-6 | origin status, headers, each `Set-Cookie`, body unchanged (incl. JSON 5xx) | `:68` | W4 | W6 |
| AC-7 | no Cache API, no `cf` cache options, no added/changed `Cache-Control`/`Set-Cookie` | `:71` | W4 | W5, W6 |
| AC-8 | strip inbound `x-t2f-*`, set secret + `<ip>;<country>` | `:74` | W4 | W5, W6 |
| AC-9 | throw / 502-504 / 520-530 non-JSON → JSON 503 `unavailable`, `Retry-After: 5` | `:77` | W4 | W6; live W29 |
| AC-10 | rehearsal/prelaunch/production answer GET `/api/time` at the edge | `:82` | W4, W7 | W6, W7 |
| AC-11 | `test` proxies `/api/time` | `:85` | W4 | W6 |
| AC-12 | prelaunch: other `/api/*` → single 404; no origin var | `:90` | W2, W4 | W2, W6 |
| AC-13 | deploy command per env, prelaunch own assets dir, `build:prelaunch` slot in README | `:93` | W8, W9 | W8, W9 |
| AC-14 | `T2F_EDGE_SECRET` in env registry (secret, ≥32, required rehearsal/production) + `.env.example` | `:98` | W10 | W14 |
| AC-15 | rehearsal/production: no valid `x-t2f-edge` → single 404 before route lookup | `:101` | W11, W12 | W18 |
| AC-16 | `test` with secret set → same check | `:104` | W12 | W18 |
| AC-17 | `test` without secret → no check, no trusted address; SPEC-02 suites green | `:107` | W12 | W18, W28 |
| AC-18 | constant-time secret comparison | `:110` | W11 | W14 |
| AC-19 | secret, header values, raw IP, salt never in logs/responses/DB/store | `:113` | W10, W11 | W14, W19 |
| AC-20 | address/country only from `x-t2f-client`; 5 other headers ignored | `:118` | W11, W12 | W18 |
| AC-21 | country missing/`XX`/`T1`/not ISO-2 → `unknown` | `:121` | W11 | W14 |
| AC-22 | check inactive / no header / bad IP → shared "no address" bucket | `:124` | W11 | W14 |
| AC-23 | request context exposes country + fingerprint, no raw address | `:127` | W12 | W14 |
| AC-24 | HMAC-SHA-256 with day salt, IPv6 /64; SPEC-02 AC-51 test rewritten | `:132` | W11, W13 | W14 |
| AC-25 | salt create-if-absent, 32 bytes, TTL ≤ 24 h | `:135` | W11 | W18 |
| AC-26 | new salt after UTC midnight | `:138` | W11 | W14 |
| AC-27 | store down → in-process day salt | `:141` | W11 | W14 |
| AC-28 | rate-limit middleware uses the fingerprint as `ipDay` | `:144` | W13 | W18 |
| AC-29 | `ipDay` row with `windowMs` > 86 400 000 stops startup | `:147` | W13 | W14 |
| AC-30 | fingerprint used only as limit key | `:150` | W11, W13 | W19 |
| AC-31 | declarative subject-data row + "daily IP fingerprint" row | `:153` | W17 | W17 |
| AC-32 | non-public route and own responses carry `no-store` (`private, no-store` default) | `:158` | W15 | W18 |
| AC-33 | public route: `Set-Cookie` stripped + warning; 0 public rows | `:161` | W15 | W18 |
| AC-34 | echo door contract (test + doors) | `:164` | W16 | W16 |
| AC-35 | echo door sets `t2f_edge_probe` cookie with exact attributes | `:167` | W16 | W16 |
| AC-36 | echo door outside test/doors → single 404 | `:170` | W16 | W16, W28 |
| AC-37 | infra desired state elements for `test` | `:175` | W21 | W21 |
| AC-38 | `plan` = GET only | `:178` | W22 | W22 |
| AC-39 | second `apply` → no mutation, «без змін» | `:181` | W24 | W24; live W29 |
| AC-40 | guard: main domains, zone settings, deletes → exit ≠ 0, 0 mutations | `:184` | W23 | W23 |
| AC-41 | `cloudflare` lock serialises applies | `:187` | W24 | W24 |
| AC-42 | no token/secret in output; tunnel token only via gitignored file | `:190` | W22, W24, W25 | W22, W24 |
| AC-43 | journal line after an apply with changes | `:193` | W24 | W24 |
| AC-44 | stop at first refusal, name permission, list applied | `:196` | W22, W24 | W24 |
| AC-45 | `edge` and `infra` verify entries mirrored in CI | `:201` | W3, W20 | W20 |
| AC-46 | live: probe cookie set and returned through the edge | `:206` | W16, W26 | W29 |
| AC-47 | live: country reaches origin | `:209` | W12, W26 | W29 |
| AC-48 | live: no `CF-Cache-Status: HIT` on `/api/*` | `:212` | W4, W26 | W29 |
| AC-49 | live: tunnel host blocked; origin port loopback only | `:215` | W21, W26 | W29 |
| AC-50 | live: forged `x-t2f-*`/XFF do not reach origin | `:218` | W4, W12, W26 | W29 |
| AC-51 | live: under-attack on test host, exempt POST passes byte-identical | `:221` | W21, W24, W26 | W29 |
| NFR-1 | ≤ 2 ms CPU p95 (manual, dashboard) | `:248` | W26 | W29 |
| NFR-2 | bundle ≤ 64 KiB, no runtime deps | `:251` | W8 | W8 |
| NFR-3 | no secret values in repo; `check-secrets` green; no secret `vars` | `:254` | W2, W9, W22 | W2, W28 |
| NFR-4 | body streamed, not read (1 MiB) | `:257` | W4 | W6 |
| NFR-5 | edge check + fingerprint ≤ 1 ms p95 | `:260` | W11 | W14 |

**If `CLOUDFLARE_API_TOKEN_INFRA` never arrives:** the deploy token (Workers edit, 403 on DNS and rulesets, `research-cloudflare` §9) can still deploy the Worker, so AC-2 (live, server stopped) and AC-9 (live, tunnel absent) can be verified. These stay **`not verified (blocked: token)`**: AC-39 (live part), AC-46, AC-47, AC-48, AC-49, AC-50, AC-51, NFR-1. Their unit and integration parts are still verified.

## Spec follow-ups
Addressed to `spec-creator` and the owner. The plan implements the spec as written. Where items collide with existing code, the plan takes the reading that satisfies all of them and says so here.

1. **Echo door vs SPEC-02 door rules.** `10-origin` refuses every test door whose `Host` is not loopback, and every mutating door call that is not `application/json` (`server/src/endpoints/pipeline.ts:124-139`). Through the tunnel the `Host` is `o-test.time2fest.com`, and AC-51 posts `application/x-www-form-urlencoded`. The plan adds one door flag, `edgeProbe`, set only on the echo door. For that door, an edge-verified request satisfies the `Host` rule and any content type is accepted. All other doors keep both rules (W16).
2. **AC-15 and Next's implicit methods.** The catch-all exports only GET/POST/PUT/PATCH/DELETE (`server/src/app/api/[[...path]]/route.ts:14-18`). Next answers HEAD and OPTIONS itself, so those never reach the edge check. The plan exports `HEAD` and `OPTIONS` to the same handler (W12). Both then get the single 404, as EC-6 states. `HEAD /api/time` changes from Next's implicit 200 to 404.
3. **Time contract "sim" column.** The sim side of the time suite was the Pages Function (`tests/unit/api/time-contract.test.ts:1-4`). AC-4 forbids the root from checking `workers/**`, so the suite now runs on the edge handler inside the edge package (W7). `pnpm contracts:run` then shows `time | no suite | …` in the sim column. A follow-up can teach `scripts/contract-run.mjs` to read the edge result.
4. **AC-41 "lock `cloudflare` of `server/scripts/lock.mjs`".** That CLI has no lock names (one `integration.*` set, `server/scripts/lib/lock.mjs:17-19`). The plan reuses the library's `acquire()` on a `cloudflare/` subfolder of the same lock dir, which gives a separate exclusive lock by the same mechanism (W24).
5. **AC-34 "no `x-t2f-*` values in the response"** vs the echo contract, which lists `x-t2f-probe-signature` among echoed headers (`:294`, needed by AC-51). Read as: `x-t2f-edge` and `x-t2f-client` are never echoed.
6. **AC-37 Bot Fight Mode check** reads `GET /zones/{z}/bot_management`. Its permission is not in `research-cloudflare` §9, so the infra token needs it too. A refusal is reported by AC-44's path.
7. **Spec line citations** carry doubled line numbers from the research notes. Actual lines: `server/src/registries/middleware.ts:34-38` (spec `:145-149`), root `tsconfig.json:41-49` (spec `:135-143`). The substance is unchanged.
8. **AC-17 "SPEC-02 suites pass unchanged"** cannot hold literally, because AC-24 rewrites `server/test/unit/mechanisms.test.ts:31-65` and AC-31 changes `runSubjectData`'s result (`server/test/integration/subject-data.int.test.ts:24-37` gains `declarative`). The test-door e2e list `server/test/e2e/doors-404.e2e.ts:11-20,43` gains the two echo rows. No other SPEC-02 test changes.

## Affected surface
Routing per `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1.

| File | New/Mod | Package | Home (ring / radius) | Skills that will govern it | Constraint to respect |
|---|---|---|---|---|---|
| `pnpm-workspace.yaml` | Mod | web | workspace | unrouted | add `- 'workers/*'` after `- 'server'` (`pnpm-workspace.yaml:4`) |
| `pnpm-lock.yaml` | Mod (generated) | — | — | unrouted | only the importer entry `workers/edge: {}` |
| `package.json` (root) | Mod | web | — | security | one contiguous block of new `scripts` (W9); no dependency change — `wrangler` 4.149.0 and `@cloudflare/workers-types` stay root devDependencies (`package.json:46,79`) |
| `tsconfig.json` (root) | Mod | web | — | unrouted | add `"workers"`, `"infra"` to `exclude` (`tsconfig.json:41-49`) |
| `eslint.config.mjs` | Mod | web | — | unrouted | add `'workers/**', 'infra/**'` to the global `ignores` (`eslint.config.mjs:99`) |
| `.claude/sdd-engineering.json` | Mod | — | — | unrouted | append `edge` (W3) and `infra` (W20) verify objects |
| `.github/workflows/verify.yml` | Mod | — | — | security | steps `edge full`, `infra full` = config `full` strings verbatim (`verify.yml:1-2`) |
| `functions/api/time.ts` | Delete | web | — | security | AC-4 |
| `tests/unit/functions-time.test.ts`, `tests/unit/api/time-contract.test.ts` | Delete | web | — | unrouted | their assertions move to W7 |
| `workers/edge/package.json` | New | edge | — | security | `@time2fest/edge`, private, `type: module`, **no `dependencies`/`devDependencies`** (tools from root `node_modules` by path) |
| `workers/edge/{tsconfig.json,tsconfig.test.json,vitest.config.ts,.gitignore}` | New | edge | — | security (`workers/**`) | `tsconfig.json`: `lib ES2022`, `types: ["@cloudflare/workers-types"]`, include `src`. `tsconfig.test.json`: `types: ["node"]`, `allowJs`+`checkJs`, include `src`, `test`, `scripts`, `vitest*.ts`, `live`. `.gitignore`: `.wrangler/`, `dist/` |
| `workers/edge/wrangler.json` | New | edge | — | security | plain JSON (tests `JSON.parse` it); `vars` hold no secret (NFR-3) |
| `workers/edge/src/{index,handler,proxy,responses,env}.ts` | New | edge | Worker | security | Fetch-API types only (compiles under workers-types and node types); no Cache API, no `cf` fetch options (AC-7); body never read (NFR-4) |
| `workers/edge/test/{config,handler,worker,time-contract,dry-run,deploy}.test.ts`, `workers/edge/test/support/{originStub,tempConfig}.ts`, `workers/edge/test/fixtures/site/**` | New | edge | — | security (`workers/**`) | node env; harness = wrangler `createTestHarness` (`node_modules/wrangler/wrangler-dist/cli.d.ts:801-1113`) |
| `workers/edge/scripts/deploy.mjs` | New | edge | — | security | `// @ts-check`; Node built-ins; secrets via env/stdin only |
| `workers/edge/live/edge.live.test.ts`, `workers/edge/vitest.live.config.ts` | New | edge | — | security | skipped without `T2F_LIVE_SITE` |
| `workers/edge/README.md` | New | edge | — | unrouted | deploy, `build:prelaunch` slot, live runbook |
| `server/src/registries/env.ts` | Mod | server | ring 4 registry | onion | new block `edge` placed **before** `platform` (blocks sorted by key, `env.ts:2,31`) |
| `server/.env.example` | Mod | server | — | security (`**/.env*`) | add `T2F_EDGE_SECRET=` (no value) |
| `server/src/platform/edge.ts` | New | server | ring 3 | onion | edge gate + `ClientContext`; imports `ports.ts`, `node:crypto`, `node:net` only |
| `server/src/platform/fingerprint.ts` | New | server | ring 3 (HMAC + IPv6 /64 are pure; day salt over `FastStore`) | onion | no adapter import (onion ban 2); no module-level mutable state |
| `server/src/endpoints/pipeline.ts` | Mod | server | ring 4 driving adapter | onion, security, contract-conformance | gate before route lookup (`pipeline.ts:207-210`); response finalisation (AC-32/33); export `readBodyBytes` |
| `server/src/endpoints/types.ts` | Mod | server | ring 4 | onion, security, contract-conformance | `Ctx.client`; `RouteRow.public?`, `RouteRow.edgeProbe?`; `DispatcherInput.edge?` |
| `server/src/container.ts` | Mod | server | composition root | onion, security | builds the gate in `buildDispatcher` (`container.ts:137-140`) |
| `server/src/app/api/[[...path]]/route.ts` | Mod | server | Next route | next-best-practices | add `export const HEAD = handle; export const OPTIONS = handle;` only |
| `server/src/platform/rateLimit.ts` | Mod | server | ring 3 | onion | `LimitTarget.ipDay`; remove the stub `ipDayKey` (`rateLimit.ts:37-43`) |
| `server/src/registries/middleware.ts` | Mod | server | ring 4 registry | onion | `30-rate-limit` passes `ipDay` (`middleware.ts:34-38`); window check in `rateLimitMiddleware` |
| `server/src/platform/subjectData.ts` | Mod | server | ring 3 | onion | declarative row type; runner skips and names it |
| `server/src/registries/subjectData.ts` | Mod | server | ring 4 registry | onion | one row `ip-day-fingerprint` |
| `server/src/test-doors/edgeEcho.ts` | New | server | test door | onion, security | loaded only through the dynamic door import (`container.ts:138`) |
| `server/src/test-doors/{registry,index}.ts` | Mod | server | test door | onion, security | two sorted rows; `edgeProbe` passed to the route row |
| `server/test/unit/{edge,edge-static}.test.ts`, `server/test/unit/mechanisms.test.ts` | New / Mod | server | — | unrouted (`server/test/**`) | `mechanisms.test.ts:31-65` rewritten, not deleted |
| `server/test/integration/{edge,edge-echo}.int.test.ts`, `subject-data.int.test.ts` | New / Mod | server | — | unrouted | in-process dispatcher, `helpers.ts` |
| `server/test/e2e/doors-404.e2e.ts` | Mod | server | — | unrouted | +2 rows, count 10, optional `x-t2f-edge` |
| `infra/cloudflare/cf.mjs`, `infra/cloudflare/lib/{config,desired,api,current,diff,redact,guard,apply,tokenFile}.mjs` | New | infra | script | **unrouted** | `// @ts-check`, Node ESM, global `fetch`, zero dependencies |
| `infra/cloudflare/{tsconfig.json,vitest.config.mjs,.gitignore,README.md}` | New | infra | — | unrouted | `.gitignore`: `.local/` |
| `infra/cloudflare/test/*.test.mjs`, `infra/cloudflare/test/support/fakeApi.mjs` | New | infra | — | unrouted | fake Cloudflare API: in-process fetch + loopback HTTP server |
| `infra/cloudflare/cloudflared/compose.yml` | New | infra | — | security (`**/docker-compose*.yml` analogue; treat as such) | token only from `../.local/tunnel-<env>.env` |

**Coverage gaps:** `infra/**` (no routing row; judged by AC-37…AC-44 and the security review); `workers/edge/README.md`, `infra/cloudflare/README.md`, `docs/plans/*.md`; `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `eslint.config.mjs`, `.claude/sdd-engineering.json`; `server/test/**`; `infra/cloudflare/cloudflared/compose.yml` (named `compose.yml`, so `**/docker-compose*.yml` does not match — the security rules apply anyway).

## Contract changes
- **Shared contracts / schemas:** no change to `packages/contracts`. The two spec contracts "trusted edge headers" and "edge origin failure" are internal edge→origin conventions. They reuse `ApiError` code `unavailable` and `not_found` (`packages/contracts/src/result.ts:4-31`), so no new code or reason is added.
- **Migration:** no.
- **Seed / fixture data:** no.
- **Build-only failures:** yes.
  - (1) Without the `workers`/`infra` excludes, `next build`'s typecheck of the root tsconfig would fail on Workers types while edge tests stay green. W1 adds the excludes and web `full` (W28) catches a miss.
  - (2) A Worker that typechecks but does not bundle is caught only by `wrangler deploy --dry-run`, so W8 runs it for all four envs.
- **Wire contract:** yes — narrow and non-breaking.
  - (a) A new test-only route `GET|POST /api/_test/edge-echo` exists only in class `test` with doors on.
  - (b) Dispatcher-made responses go from `cache-control: no-store` to `private, no-store`. The value still contains `no-store`, and `/api/time` keeps `no-store, max-age=0` (`server/src/endpoints/time.ts:8`).
  - (c) `HEAD`/`OPTIONS` on `/api/*` now get the single 404 (Spec follow-up 2).
  - (d) Edge-made 404/503 bodies use existing codes.
  - `/api/time` body and headers are unchanged, and no `ApiError` code or reason is added.
  - Check: the time suite `tests/contract/time.suite.ts` runs on the edge handler (W7) and on http (`pnpm contracts:run` in W28). The docs patch adds a §3.11 row for the echo door and a note on HEAD/OPTIONS (W30).
- **Layout fidelity:** no. Nothing under `web/` that renders changes.
  - `functions/api/time.ts` is not served by the demo: Vercel builds the static `out-demo` (`vercel.json:5-6`), and the client already falls back to device time when `/api/time` fails (`lib/time/TimeSource.ts`).
  - `public/**` is untouched, and `_headers` stays a Non-goal.
- **Payload migration:** no. No collection, global or field changes, and the salt lives in Redis.
- **Test doors:** yes. The echo door is a door row and is loaded only through `shouldLoadDoors` (`server/src/container.ts:34-36,138`).
  - W16 adds both rows to `server/test/e2e/doors-404.e2e.ts`, and W28 runs it against a production-class server.
  - Because AC-15 refuses everything without the secret, the e2e sends `x-t2f-edge: $T2F_E2E_EDGE_SECRET` when set. That way the door gating itself is what gets compared, not only the edge gate.
- **Agent write surface:** no.
- **Seed and fixtures:** no.

## Work items

### W1 — Workspace member `workers/edge` and root exclusions (P1)
- **Serves:** AC-4, AC-45; enables all edge items.
- **Do:**
  - Create `workers/edge/package.json`: name `@time2fest/edge`, `private`, `type: module`, `engines.node >=22.12`, no dependency keys. Scripts are added in W9.
  - Add `- 'workers/*'` to `pnpm-workspace.yaml`. Run `pnpm install --prefer-offline` from the root.
  - `git diff -- pnpm-lock.yaml` must show only the `workers/edge` importer. If anything else changes, revert it and return BLOCKED.
  - Create `tsconfig.json`, `tsconfig.test.json`, `vitest.config.ts` and `.gitignore` as in Affected surface.
  - `vitest.config.ts`: `environment: 'node'`, `include: ['test/**/*.test.ts']`, `testTimeout: 60_000`, `hookTimeout: 60_000`.
  - Tools always run from the root by path: `node ../../node_modules/typescript/bin/tsc`, `node ../../node_modules/vitest/vitest.mjs` and `node ../../node_modules/wrangler/bin/wrangler.js`. This is the `packages/rules` pattern (`.claude/sdd-engineering.json` `rules.files`).
  - Root: `tsconfig.json` exclude gains `"workers"`, `"infra"`, and the `eslint.config.mjs:99` ignores gain `'workers/**', 'infra/**'`.
- **Files:** `workers/edge/{package.json,tsconfig.json,tsconfig.test.json,vitest.config.ts,.gitignore}`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `eslint.config.mjs`.
- **Done means:**
  - `node_modules/@time2fest/edge` resolves to `workers/edge`.
  - The lockfile diff is the importer only.
  - Root `npx tsc --noEmit -p .` and `npx eslint --no-warn-ignored eslint.config.mjs` exit 0.
- **Verify:** web `files` on `tsconfig.json eslint.config.mjs`.
- **Rules that apply:** security → A03 (no new package; `wrangler`/`workers-types` reused at their pinned versions).
- **Risk:** lockfile churn. Keep it to the importer.

### W2 — `wrangler.json` for four environments + config test (P1)
- **Serves:** AC-1, AC-12 (config part), NFR-3 (no secret `vars`).
- **Do:**
  - Top level:
    - `name: "t2f-edge"`, `main: "src/index.ts"`, `compatibility_date: "2026-10-01"` (≤ the bundled workerd `1.20261006.1`), `workers_dev: false`, `preview_urls: false`.
    - `assets`: `{ binding: "ASSETS", html_handling: "force-trailing-slash", not_found_handling: "none", run_worker_first: ["/api", "/api/*"] }`.
  - Each env under `env.<name>` repeats `workers_dev`, `preview_urls`, `assets` (with its `directory`), `routes` and `vars`, because vars are not inherited (`research-cloudflare` §1):

    | env | `assets.directory` | `routes` (custom domain) | `vars` |
    |---|---|---|---|
    | `test` | `../../out-edge-test` | `test.time2fest.com` | `EDGE_ENV=test`, `ORIGIN_URL=https://o-test.time2fest.com` |
    | `rehearsal` | `../../out-edge-rehearsal` | `rehearsal.time2fest.com` | `EDGE_ENV=rehearsal`, `ORIGIN_URL=https://o-rehearsal.time2fest.com` |
    | `prelaunch` | `../../out-prelaunch` | `time2fest.com` | `EDGE_ENV=prelaunch` (no `ORIGIN_URL`) |
    | `production` | `../../out` | `time2fest.com` | `EDGE_ENV=production`, `ORIGIN_URL=https://o.time2fest.com` |
  - Secret `T2F_EDGE_SECRET` is never in the file.
  - Add `test/fixtures/site/index.html` and `test/fixtures/site/country/ua/index.html` (one line of HTML each).
  - Test `test/config.test.ts`:
    - for each of the 4 envs: `directory` set, `run_worker_first` deep-equals `["/api","/api/*"]`, `html_handling` = `force-trailing-slash`, `workers_dev === false`, `preview_urls === false`;
    - `prelaunch` has no `ORIGIN_URL`; `prelaunch.assets.directory` differs from every other env's;
    - no `vars` key matches `/secret|token|key|password/i`.
- **Files:** `workers/edge/wrangler.json`, `workers/edge/test/config.test.ts`, `workers/edge/test/fixtures/site/**`.
- **Done means:** edge `full` (W3) exits 0 with `config.test.ts` passing.
- **Verify:** edge `files` on `wrangler.json test/config.test.ts`.
- **Rules that apply:** security → A02 (no `workers.dev` bypass of zone rules, EC-15); secrets only via `wrangler secret`.
- **Risk:** the `run_worker_first` array form must be accepted by wrangler 4.149.0. W8's dry-run proves it.

### W3 — `edge` verify entry and CI step (P1)
- **Serves:** AC-45 (edge half).
- **Do:**
  - Append to `.claude/sdd-engineering.json` `verify`: `{ "package": "edge", "dir": "workers/edge", "files": "node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json && node ../../node_modules/vitest/vitest.mjs related --run --maxWorkers=2 --passWithNoTests {files}", "full": "node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.test.json && node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2" }`.
  - Add step `edge full` (`working-directory: workers/edge`, `run:` = the `full` string verbatim) after `rules full` in `verify.yml`. Extend the header comment's list with `edge full`.
- **Files:** `.claude/sdd-engineering.json`, `.github/workflows/verify.yml`.
- **Done means:** the `run:` string equals the config `full` string byte for byte, checked with `node -e` reading both files.
- **Verify:** edge `full`.
- **Rules that apply:** security → CI least privilege (`permissions: contents: read` unchanged).
- **Risk:** low.

### W4 — The edge Worker (P2)
- **Serves:** AC-2, AC-3, AC-5 … AC-12, AC-48, AC-50 (edge side), NFR-4.
- **Do:**
  - `src/env.ts`: `interface EdgeEnv { EDGE_ENV: 'test'|'rehearsal'|'prelaunch'|'production'; ORIGIN_URL?: string; T2F_EDGE_SECRET?: string; ASSETS: { fetch(req: Request): Promise<Response> } }`.
  - `src/index.ts`: `export default { fetch: (req, env) => handle(req, env, { fetch, now: Date.now, cf: (req as { cf?: { country?: string } }).cf }) }`. This is the only file that touches `request.cf`.
  - `src/responses.ts`:
    - `notFound()`: 404, body exactly `{"ok":false,"error":{"code":"not_found"}}`, `content-type: application/json; charset=utf-8`, `cache-control: private, no-store`.
    - `unavailable()`: 503, body `{"ok":false,"error":{"code":"unavailable","retryAfterMs":5000}}`, same two headers, `retry-after: 5`.
    - `timeNow(now)`: the three headers of `functions/api/time.ts:5-9`, body `{"now":<Math.trunc(now)>}`.
  - `src/handler.ts` routes in this order:
    1. Path neither `/api` nor `/api/…` → `env.ASSETS.fetch(req)`. An asset miss still reaches the Worker, and ASSETS answers 404.
    2. Path exactly `/api`, or the `upgrade` header equals `websocket` (case-insensitive) → `notFound()`.
    3. `EDGE_ENV !== 'test'` and `GET` and path exactly `/api/time` → `timeNow(now())`.
    4. No `ORIGIN_URL` (prelaunch) → `notFound()`.
    5. `ORIGIN_URL` set but no `T2F_EDGE_SECRET` → `unavailable()`. Fail closed, never send unauthenticated.
    6. Otherwise `proxy()`.
  - `src/proxy.ts`:
    - target = `ORIGIN_URL` origin + `url.pathname` + `url.search`.
    - Headers: copy the inbound headers, delete `host`, `x-t2f-edge`, `x-t2f-client`. Set `x-t2f-edge: <secret>` and `x-t2f-client: <cf-connecting-ip ?? ''>;<cf?.country ?? ''>`.
    - `fetch(target, { method, headers, body: GET/HEAD ? null : req.body, redirect: 'manual', duplex: 'half' })`. Cast the init where workers-types lacks `duplex`. Do not read, clone or buffer the body.
    - On throw → `unavailable()`.
    - On status ∈ {502, 503, 504} ∪ [520, 530] with a `content-type` that does not start with `application/json` → cancel the origin body, then `unavailable()`.
    - Otherwise return the origin `Response` object as is. No new headers, no `caches`, no `cf` options.
- **Files:** `workers/edge/src/{env,index,handler,proxy,responses}.ts`.
- **Done means:** both edge tsconfigs typecheck; W5 and W6 are green.
- **Verify:** edge `files` on the five files.
- **Rules that apply:**
  - security → A10 fail-closed (missing secret → 503, never an unauthenticated forward);
  - security → A09 (never `console.log` a header value or the secret);
  - security → A01 (static and admin paths never proxied, D1).
- **Risk:** high. This is the trust boundary of every later wave. Watch for a header leak, a buffered body, or a Cloudflare HTML page leaking through.

### W5 — Node-level handler tests (P2)
- **Serves:** AC-3, AC-5, AC-7, AC-8 (exact values).
- **Do:** `test/handler.test.ts` calls `handle()` directly, with a recording fake `fetch`, a fake `ASSETS`, `now = () => 1_767_225_600_000` and `cf = { country: 'UA' }`. Cases:
  - client sends `x-t2f-client: 203.0.113.9;US`, `x-t2f-edge: forged`, `CF-Connecting-IP: 198.51.100.7` → the fake sees exactly `x-t2f-edge` = env secret and `x-t2f-client` = `198.51.100.7;UA`;
  - no `cf` → `198.51.100.7;`;
  - `Cookie`, `Content-Type`, `X-Probe` and the query string arrive unchanged;
  - the init's `body` is the same stream object as `req.body`, so it is never read (NFR-4 review evidence);
  - `/api` and an `Upgrade: websocket` request → the `notFound()` bytes, fake calls 0;
  - static scan: no file in `src/**/*.ts` contains `caches`, `cacheTtl`, `cacheEverything`, `cacheKey`, `cacheTtlByStatus` or `cf:` (AC-7);
  - `ORIGIN_URL` without secret → 503, fake calls 0.
- **Files:** `workers/edge/test/handler.test.ts`.
- **Done means:** the file passes with one `it` per bullet.
- **Verify:** edge `files` on `test/handler.test.ts src/handler.ts src/proxy.ts`.
- **Rules that apply:** —
- **Risk:** low.

### W6 — workerd integration tests via wrangler's test harness (P2)
- **Serves:** AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, NFR-4.
- **Do:**
  - `test/support/tempConfig.ts` writes a copy of `wrangler.json` to `os.tmpdir()/t2f-edge-<pid>/wrangler.json` with:
    - `main` made absolute;
    - every env's `assets.directory` = absolute `test/fixtures/site`;
    - `vars.ORIGIN_URL` replaced by a given URL where the env has one.
  - The harness is `createTestHarness({ workers: [{ configPath: <tmp>, env, secrets: { T2F_EDGE_SECRET: <test value> } }] })` (`cli.d.ts:1050-1113`). Tests dispatch with `harness.fetch(url, { cf: { country: 'UA' }, … })` (`DispatchFetch`, miniflare `index.d.ts:426`). Mark the test secret line `// check-secrets: allow test value`.
  - `test/support/originStub.ts` runs `node:http` on `127.0.0.1:0` and records method, path+query, headers and the SHA-256 of the body. Scripted paths:
    - `/api/stub/cookies` → 200, two `Set-Cookie`, `X-Custom`, JSON body;
    - `/api/stub/json503` → 503 `application/json`;
    - `/api/stub/html530` → 530 `text/html`;
    - `/api/stub/html502` → 502 `text/html`;
    - `/api/stub/drop` → `socket.destroy()`;
    - anything else → 200 echo.
  - `test/worker.test.ts` cases:
    - AC-2 (`test`): `/`, `/country/ua/` → 200; `/admin/`, `/cms-api/x` → 404; stub calls 0.
    - AC-3: `/api` → 404 with the exact single-404 body and `cache-control: private, no-store`. If the harness cannot dispatch an `Upgrade: websocket` request, the WebSocket case stays only in W5 — record which.
    - AC-5: GET, HEAD, OPTIONS, PUT, DELETE, POST JSON and POST `application/x-www-form-urlencoded` → the stub sees the same method, path, query, `cookie`, `content-type`, `x-probe` and body SHA-256.
    - AC-6/AC-7: `/api/stub/cookies` → client `getSetCookie()` has both lines, `x-custom` is equal, and the body bytes are equal. No `cache-control` is added when the stub sends none. `/api/stub/json503` → 503 passed byte for byte.
    - AC-8: forged inbound `x-t2f-*` never reaches the stub. The stub's `x-t2f-edge` equals the test secret and its `x-t2f-client` ends with `;UA`. The exact IP is asserted in W5, because miniflare may rewrite `CF-Connecting-IP`.
    - AC-9: html530, html502, drop → the exact `unavailable()` body, `retry-after: 5`, `cache-control: private, no-store`.
    - AC-10 (`rehearsal`, `ORIGIN_URL` → a closed loopback port): GET `/api/time` → 200, `|now − Date.now()| ≤ 1000`, the three headers, stub calls 0.
    - AC-11 (`test`): `/api/time` body equals the stub body.
    - AC-12 (`prelaunch`): `/api/x` and POST `/api/time` → single 404; stub calls 0.
    - NFR-4: a 1 MiB POST arrives with the same SHA-256.
  - Close the harness and the stub in `afterAll`.
- **Files:** `workers/edge/test/worker.test.ts`, `workers/edge/test/support/{tempConfig,originStub}.ts`.
- **Done means:** edge `full` is green on Windows.
- **Verify:** edge `files` on the three files.
- **Rules that apply:** —
- **Risk:** workerd on Windows, and harness behaviour with `run_worker_first` patterns (spike 7: `/api` vs `/api/*`). If the harness cannot start, stop at BLOCKED with the error. Do **not** fall back to Node-only tests for these ACs: the spec requires `workerd`.

### W7 — Remove the Pages Function; time contract on the edge (P3)
- **Serves:** AC-4, AC-10 (contract parity).
- **Do:**
  - Delete `functions/api/time.ts` (and the empty `functions/`), `tests/unit/functions-time.test.ts` and `tests/unit/api/time-contract.test.ts`.
  - Remove the now-dead `"functions"` entry from the root `tsconfig.json` exclude **only if** nothing else matches it. Otherwise leave it, to keep the diff minimal — record which.
  - Add `workers/edge/test/time-contract.test.ts`:

    ```ts
    import { describeDomain } from '../../../tests/contract/time.suite';
    ```

    It runs `describeDomain('time (edge)', …)` with `handle(new Request('https://t.test/api/time'), { EDGE_ENV: 'prelaunch', ASSETS }, { fetch: neverCalled, now: Date.now })`.
- **Files:** `functions/api/time.ts` (delete), `tests/unit/functions-time.test.ts` (delete), `tests/unit/api/time-contract.test.ts` (delete), `workers/edge/test/time-contract.test.ts`, maybe `tsconfig.json`.
- **Done means:**
  - `Glob functions/**` is empty;
  - `grep -rn "functions/api" --include=*.ts . ':!docs'` finds only the comments at `server/src/endpoints/time.ts:3` and `server/test/integration/time.int.test.ts:8`;
  - edge `files` is green on the new test;
  - root `npx vitest run tests/unit/api --maxWorkers=2` is green.
- **Verify:** edge `files` on `test/time-contract.test.ts`; web `files` on `tsconfig.json`.
- **Rules that apply:** contract-conformance §2 (one suite, now run against edge and http).
- **Risk:** low.

### W8 — Dry-run bundle per environment + README slot (P3)
- **Serves:** AC-13 (dry-run part, `build:prelaunch` slot), NFR-2.
- **Do:**
  - `test/dry-run.test.ts`: for each of the 4 envs, build the temp config (W6 helper) and run `node <root>/node_modules/wrangler/bin/wrangler.js deploy --dry-run --config <tmp> --env <env> --outdir <tmp>/<env>` via `execFileSync` (no shell). Assert exit 0, and that the bundled `.js` in `outdir` is ≤ 65 536 bytes.
  - Assert `workers/edge/package.json` has no `dependencies` key.
  - `workers/edge/README.md` covers:
    - the 4 envs and which are deployed in this wave (only `test`);
    - the deploy commands of W9;
    - secret handling;
    - a **"Reserved: `build:prelaunch`"** section. That root script will build the pre-launch static site into `out-prelaunch` and belongs to the pre-launch wave. It is not implemented here (D11).
- **Files:** `workers/edge/test/dry-run.test.ts`, `workers/edge/README.md`.
- **Done means:** all 4 dry-runs pass, the bundle is ≤ 64 KiB, and the README names `build:prelaunch`.
- **Verify:** edge `files` on `test/dry-run.test.ts`.
- **Rules that apply:** security → A03 (no runtime dependency).
- **Risk:** dry-run may need network for nothing else. If it asks for auth, set `CLOUDFLARE_ACCOUNT_ID=0` in the child env only, and report it.

### W9 — Deploy script and package scripts (P3)
- **Serves:** AC-13, NFR-3.
- **Do:**
  - `workers/edge/scripts/deploy.mjs --env <test|rehearsal|prelaunch|production> [--secrets-file <path>] [--confirm <env>]`:
    1. If `--secrets-file` is given, call `process.loadEnvFile(path)`. The path is never printed.
    2. Unknown env → exit 1.
    3. Env ≠ `test` without `--confirm <same env>` → exit 2: `not deployed in this wave`.
    4. Require `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, and for envs with `ORIGIN_URL` also `T2F_EDGE_SECRET` with ≥ 32 characters. A missing value is reported by **name only**.
    5. Require the env's assets directory to exist and be non-empty.
    6. Run `wrangler deploy --env <env>`.
    7. For proxy envs, run `wrangler secret put T2F_EDGE_SECRET --env <env>` with the value written to the child's **stdin**, never argv. Use `spawn(process.execPath, [wranglerJs, …], { shell: false, env: process.env })`, so the token travels only in the env.
    8. Print only wrangler's output, plus `deployed <env>`.
  - Edge `package.json` scripts: `deploy:test`, `deploy:rehearsal`, `deploy:prelaunch`, `deploy:production` → `node scripts/deploy.mjs --env <env>`. Args after `--` pass through.
  - Root `package.json`, one contiguous block after `contracts:run`:
    - `"build:edge:test": "cross-env NEXT_PUBLIC_ENV=test NEXT_PUBLIC_API_MODE=http NEXT_DIST_DIR=out-edge-test next build"`;
    - `"edge:deploy:test": "pnpm --dir workers/edge deploy:test"`;
    - `"edge:tunnel:up": "docker compose -p t2f-edge -f infra/cloudflare/cloudflared/compose.yml up -d"`;
    - `"edge:tunnel:down": "docker compose -p t2f-edge -f infra/cloudflare/cloudflared/compose.yml down"`;
    - `"infra:cf": "node infra/cloudflare/cf.mjs"`.
  - The infra and tunnel targets are created in P7/P8. Defining the scripts now keeps the shared file to one hunk.
  - `test/deploy.test.ts` injects `spawn`. Checks: refusal without `--confirm`; missing var names in output and no values; the secret goes to stdin and appears in no argv; `prelaunch` skips `secret put`.
- **Files:** `workers/edge/scripts/deploy.mjs`, `workers/edge/package.json`, `workers/edge/test/deploy.test.ts`, `package.json`.
- **Done means:** `deploy.test.ts` passes, and `node -e` confirms the 5 root scripts and 4 edge scripts exist.
- **Verify:** edge `files` on `scripts/deploy.mjs test/deploy.test.ts`.
- **Rules that apply:**
  - security → secrets never in argv or logs (A09);
  - security → `execFile`/`spawn` without a shell (A05).
- **Risk:** `wrangler secret put` on a Worker that does not exist prompts interactively, so deploy runs first. Between the two steps the Worker answers 503, because of W4's fail-closed branch.

### W10 — `T2F_EDGE_SECRET` in the env registry (P4)
- **Serves:** AC-14, AC-19 (log masking).
- **Do:**
  - New block `{ key: 'edge', vars: [{ name: 'T2F_EDGE_SECRET', schema: z.string().min(32).optional(), secret: true, requiredIn: ['rehearsal', 'production'] }] }`, placed before `platform`.
  - `secret: true` feeds the logger mask (`server/src/platform/logger.ts:28-34`, `env.ts` `secrets`).
  - Add `T2F_EDGE_SECRET=` to `server/.env.example`.
- **Files:** `server/src/registries/env.ts`, `server/.env.example`.
- **Done means:**
  - `loadEnv({T2F_ENV:'rehearsal', …valid others…})` without the var → `{ ok:false, failing }` contains `T2F_EDGE_SECRET`, and the printed failure has no value;
  - a 31-character value fails;
  - class `test` without it is ok.
  - Tested in W14.
- **Verify:** server `files` on the two files.
- **Rules that apply:** security → A04 (≥ 32 chars); onion → registry is ring 4.
- **Risk:** low. Production-class local runs now need the var (W28).

### W11 — Edge gate, trusted client and daily fingerprint (P4)
- **Serves:** AC-15 (comparison), AC-18 … AC-22, AC-24 … AC-27, AC-30, NFR-5.
- **Do:**
  - **`server/src/platform/fingerprint.ts`:**
    - `networkOf(ip)`: IPv4 as is; IPv4-mapped IPv6 → the IPv4; IPv6 → the first 4 hextets of the expanded form → `xxxx:xxxx:xxxx:xxxx::/64`.
    - `fingerprintOf(network, salt)` = hex HMAC-SHA-256.
    - `daySalts({ fast, clock, random = randomBytes })` returns `{ saltFor(): Promise<string> }`:
      - day = `new Date(clock.now()).toISOString().slice(0,10)`;
      - a per-instance cache `{ day, salt }` is reused while `day` is unchanged (NFR-5);
      - otherwise `get('edge:salt:<day>')`, and if absent `setIfAbsent(key, base64(random(32)), ttl)`, then `get` again;
      - `ttl` = ms until the next UTC midnight, clamped to [1, 86 400 000];
      - on `DependencyUnavailable`, use the instance's memory salt for that day (random, created once per day, never written anywhere) and do not cache it as the Redis salt, so the next request retries Redis;
      - a day change drops both.
  - **`server/src/platform/edge.ts`:**
    - `ClientContext = { country: string; edgeVerified: boolean; addressPresent: boolean; ipDay(): Promise<string> }`. There is **no address field** (AC-23).
    - `createEdgeGate({ envClass, secret, salts })` returns `{ active: boolean; admit(req: Request): ClientContext | null }`:
      - `active` = class `rehearsal`/`production`, or class `test` with a secret;
      - inactive → always returns `noAddress(false)`;
      - active → compare `x-t2f-edge` (absent = `''`) with `timingSafeEqual(hmac(k, received), hmac(k, secret))`, where `k` = random 32 bytes per gate. This is constant-time whatever the length or prefix of the input (AC-18);
      - mismatch → `null`;
      - match → parse `x-t2f-client`: exactly one `;`, ip part with `net.isIP() ∈ {4,6}`, country part `/^[A-Z]{2}$/` and not `XX`/`T1`, else `'unknown'`;
      - `ipDay()` → `fp:<fingerprintOf(networkOf(ip), await salts.saltFor())>`, or the no-address bucket `noaddr:<day>` (AC-22) when the IP is invalid or absent;
      - the raw IP lives only in the closure.
    - No other header (`X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`, `Forwarded`) is read anywhere (AC-20).
    - Nothing here logs.
- **Files:** `server/src/platform/{edge,fingerprint}.ts`.
- **Done means:** W14's cases for AC-18, 21, 22, 24, 26, 27 and NFR-5 pass.
- **Verify:** server `files` on the two files.
- **Rules that apply:**
  - onion → ring 3 over the `FastStore` port, no adapter import (ban 2), state per instance not per module;
  - security → A04 constant-time compare, A09 no secrets or IP in logs, A10 fail closed (refusal = `null`).
- **Risk:** high. A wrong comparison opens the origin; a wrong salt flow merges or splits limit buckets.

### W12 — Dispatcher wiring: gate before route lookup, `ctx.client`, HEAD/OPTIONS (P4)
- **Serves:** AC-15, AC-16, AC-17, AC-20, AC-23, AC-47 (origin side), AC-50 (origin side).
- **Do:**
  - `types.ts`:
    - `Ctx.client: ClientContext` (import type from `platform/edge`);
    - `RouteRow.public?: true` (docs: "cacheable; `Set-Cookie` stripped", used in W15);
    - `RouteRow.edgeProbe?: true` (set only by door rows, used in W16);
    - `DispatcherInput.edge?` = the gate type.
  - `pipeline.ts`:
    - default gate = inactive (existing tests that build `createDispatcher` without `edge` keep working, AC-17);
    - in `dispatch`, **first line** after `new URL`: `const client = edge.admit(req); if (client === null) return notFoundResponse();`. This runs before the METHODS check and the table lookup (`pipeline.ts:209-210`);
    - put `client` on `ctx`.
  - `container.ts` `buildDispatcher` passes `createEdgeGate({ envClass: deps.env.class, secret: deps.env.vars.T2F_EDGE_SECRET, salts: daySalts({ fast: deps.redis, clock: deps.clock }) })`.
  - `route.ts`: `export const HEAD = handle; export const OPTIONS = handle;` (Spec follow-up 2).
- **Files:** `server/src/endpoints/{types,pipeline}.ts`, `server/src/container.ts`, `server/src/app/api/[[...path]]/route.ts`.
- **Done means:**
  - server `tsc` is green;
  - the existing integration suites `pnpm --dir server test:int -- pipeline rate-limit doors time` pass unchanged (AC-17);
  - `grep -rn "x-forwarded-for\|x-real-ip\|cf-connecting-ip\|true-client-ip\|'forwarded'" server/src` → no reads.
- **Verify:** server `files` on the four files.
- **Rules that apply:**
  - onion → container is the only place that knows the gate and the store;
  - next-best-practices → route handlers export named methods; no other `app/api/**` file (`route.ts:1-3`).
- **Risk:** high. Ordering is the whole point of AC-15.

### W13 — `ipDay` from the fingerprint; window check (P4)
- **Serves:** AC-24 (SPEC-02 test rewrite), AC-28, AC-29, AC-30.
- **Do:**
  - `rateLimit.ts`: delete `ipDayKey` (`:37-43`). `LimitTarget` = `{ subject?; device?; ipDay? }`, and `limitKeys` uses `target.ipDay` (the `clock` field goes).
  - `middleware.ts`:
    - `run` passes `ipDay: row.keys.includes('ipDay') ? await ctx.client.ipDay() : undefined`, so the salt is read only when a row needs it;
    - in `rateLimitMiddleware(rows)` before building `byKey`: any row with `keys` including `ipDay` and `windowMs > 86_400_000` → `throw new Error('rate-limits: <key> ipDay window exceeds 24 h')`. The registry module calls it at import, so server start fails (AC-29).
  - Rewrite `server/test/unit/mechanisms.test.ts:31-65` as "AC-24/SPEC-02 AC-51":
    - a dispatcher with an **active** gate (class `test`, secret) and memory stores;
    - two requests with the same `x-t2f-client: 198.51.100.7;UA`, the valid secret and different `X-Forwarded-For`/`X-Real-IP` → the second is 429;
    - the store key matches `/^rl:r:ipDay:fp:[0-9a-f]{64}$/` and contains no part of the IP.
- **Files:** `server/src/platform/rateLimit.ts`, `server/src/registries/middleware.ts`, `server/test/unit/mechanisms.test.ts`.
- **Done means:** `mechanisms.test.ts` is green, and `grep -rn "ipDayKey\|ipday:stub" server` → none.
- **Verify:** server `files` on the three files.
- **Rules that apply:** onion → `rateLimit.ts` stays ring 3 over ports.
- **Risk:** medium.

### W14 — Server unit tests for the edge mechanisms (P4)
- **Serves:** AC-14, AC-18, AC-19, AC-21 … AC-24, AC-26, AC-27, AC-29, NFR-5.
- **Do:** `server/test/unit/edge.test.ts`, one `it` per bullet:
  - AC-14: rehearsal without the var fails by name; 31 chars fail.
  - AC-18: a wrong value of another length, of the same length and with a shared prefix → each refused (`null`).
  - AC-19: build deps with a capture logger and the secret. Run a success, a refusal and a route handler that throws. The joined log text contains none of: the secret, the `x-t2f-client` value, the raw IP, the salt (read via the fake store).
  - AC-21: table — `''`, `XX`, `T1`, `ua`, `U1`, `UAX` → `unknown`; `UA` → `UA`.
  - AC-22: `1.2.3`, `abc`, `''`, no header, inactive gate → `ipDay()` = the no-address bucket.
  - AC-23: `expectTypeOf<ClientContext>()` has no key matching `/ip|addr/i` besides `addressPresent` and `ipDay`.
  - AC-24: same IP same day → equal; `2001:db8:1:2::a` vs `2001:db8:1:2:ffff::1` → equal; `2001:db8:1:3::a` → different; the fingerprint contains no IP substring.
  - AC-26: test clock `2026-12-31T23:59:59.999Z` vs `2027-01-01T00:00:00.000Z` → different fingerprints.
  - AC-27: a store whose every method rejects with `DependencyUnavailable` → the fingerprint is computed and equal across 3 calls the same day.
  - AC-29: `rateLimitMiddleware([{ key:'x', limit:1, windowMs: 86_400_001, keys:['ipDay'], onStoreDown:'memory' }])` throws.
  - NFR-5: 1 000 requests through `createDispatcher` with an active gate, a memory store and a trivial route. The p95 of the per-request time minus the p95 with an inactive gate is ≤ 1 ms. Use `performance.now()`, after 50 warm-up requests.
- **Files:** `server/test/unit/edge.test.ts`.
- **Done means:** the file is green under `npx vitest run test/unit/edge.test.ts --maxWorkers=2`.
- **Verify:** server `files` on the test.
- **Rules that apply:** —
- **Risk:** the NFR-5 timing on a loaded machine. Retry the measurement once; never loosen the bound.

### W15 — Cache-Control and public-route cookies in the dispatcher (P5)
- **Serves:** AC-32, AC-33.
- **Do:**
  - `JSON_HEADERS['cache-control']` = `private, no-store` (`pipeline.ts:28-31`).
  - Add `finalize(res, route)`, applied to every route outcome after `toResponse`:
    - **non-public:**
      - no `cache-control` → set `private, no-store`;
      - `cache-control` without the token `no-store` → replace it with `private, no-store`;
      - a value containing `no-store` stays (keeps `/api/time`'s `no-store, max-age=0`).
    - **public:** keep `cache-control`. If `set-cookie` is present, drop all `set-cookie` and `log.warn({ event: 'public-set-cookie', route: route.key })`.
  - Rebuild the `Response` (`new Response(res.body, { status, statusText, headers })`), because a handler's `Response` may have immutable headers.
- **Files:** `server/src/endpoints/pipeline.ts`.
- **Done means:** W18's AC-32/33 cases pass; `pnpm --dir server test:int -- time pipeline` is green.
- **Verify:** server `files` on `src/endpoints/pipeline.ts`.
- **Rules that apply:** security → personal responses never cacheable (`research-cloudflare` §5 danger).
- **Risk:** medium. Every response passes through it.

### W16 — Echo door and its origin-rule exemption (P5)
- **Serves:** AC-34, AC-35, AC-36, AC-46 (origin side).
- **Do:**
  - `DoorRow.edgeProbe?: true`. `doorRoutes` copies it to the route row (`test-doors/index.ts:23-35`).
  - `10-origin`, for `route.testDoor && route.edgeProbe`:
    - the loopback-`Host` rule is satisfied by `isLoopbackHost(...) || ctx.client.edgeVerified`;
    - the JSON-only rule is skipped;
    - a present `Origin` must still be allowed;
    - all other doors are unchanged.
  - `server/src/test-doors/edgeEcho.ts` exports rows `edge-echo-get` (GET) and `edge-echo-post` (POST) at `/api/_test/edge-echo`, `edgeProbe: true`, no `body` schema. The handler:
    - reads the raw bytes with `readBodyBytes(req, DEFAULT_MAX_BODY_BYTES)`, exported from `pipeline.ts`; `readBody` now calls it. Over the cap → `failure('validation', { reason: 'invalid-input' })`;
    - returns a raw `Response` 200 with JSON `{ ok: true, value: { method, path, query (without '?'), bodyBytes, bodySha256 (hex), headers, edgeVerified, client: { country, addressPresent }, probeCookie } }`;
    - `headers` holds only those of `content-type`, `content-length`, `user-agent`, `cookie`, `x-t2f-probe-signature` that are present. `x-t2f-edge` and `x-t2f-client` are never included (Spec follow-up 5);
    - `probeCookie` = the value of `t2f_edge_probe` from `Cookie`, else `null`;
    - when absent, it adds `set-cookie: t2f_edge_probe=<randomBytes(16) hex>; Path=/; Secure; HttpOnly; SameSite=Lax`.
  - Registry: insert both rows after `clock-set`, in key order (`registry.ts:95-120`).
  - `server/test/e2e/doors-404.e2e.ts`:
    - add `['GET','/api/_test/edge-echo']` and `['POST','/api/_test/edge-echo']`;
    - the length check becomes 10;
    - when `T2F_E2E_EDGE_SECRET` is set, `probe()` adds `x-t2f-edge` to every request.
  - `server/test/integration/edge-echo.int.test.ts`:
    - AC-34 fields, the SHA-256 of a form body and the header allow-list; the response text contains no IP, no `fp:`, no secret, no `x-t2f-client` value;
    - AC-35 exact `Set-Cookie`, and `probeCookie` echoed on a second call with the cookie;
    - the edge-verified non-loopback `Host` `o-test.time2fest.com` is accepted for the echo door and refused (`forbidden`) for `/api/_test/clock`;
    - AC-36: class `rehearsal` with the valid secret, and class `test` without doors → both methods answer exactly like `/api/nope` (status, body, header names).
- **Files:** `server/src/test-doors/{edgeEcho,registry,index}.ts`, `server/src/endpoints/{pipeline,types}.ts`, `server/test/e2e/doors-404.e2e.ts`, `server/test/integration/edge-echo.int.test.ts`.
- **Done means:** `pnpm --dir server test:int -- edge-echo doors` is green; server `tsc` and eslint are green.
- **Verify:** server `files` on the source files.
- **Rules that apply:**
  - security → least privilege for the exemption (one door, only with edge verification), no sensitive data in responses;
  - onion → the door stays in the dynamically imported module.
- **Risk:** high. A too-wide exemption would expose reset/clock doors through the tunnel.

### W17 — Declarative subject-data row (P6)
- **Serves:** AC-31.
- **Do:**
  - `platform/subjectData.ts`: add `SubjectDataDeclaration = { capability: string; declarative: true; retention: string; description: string }` and `SubjectDataRow = SubjectDataHandler | SubjectDataDeclaration`.
  - `runSubjectData(op, id, rows)` runs the handlers only. Its results become `{ ok: true; results; declarative: string[] }` | `{ ok: false; failed: string[]; declarative: string[] }`.
  - Registry row (sorted): `{ capability: 'ip-day-fingerprint', declarative: true, retention: '<= 24 h', description: 'Daily IP fingerprint: rate-limit key only, no handler' }`.
  - Update `subject-data.int.test.ts:24-37` with `declarative`. Add a unit case in `edge.test.ts`: a declarative row plus a handler → no throw, `declarative: ['ip-day-fingerprint']`.
- **Files:** `server/src/platform/subjectData.ts`, `server/src/registries/subjectData.ts`, `server/test/integration/subject-data.int.test.ts`, `server/test/unit/edge.test.ts`.
- **Done means:** `pnpm --dir server test:int -- subject-data` and the unit case are green.
- **Verify:** server `files` on the four files.
- **Rules that apply:** onion → ring 3 runner stays free of registry imports.
- **Risk:** low.

### W18 — Server integration suite for the edge (P6)
- **Serves:** AC-15, AC-16, AC-17, AC-20, AC-25, AC-28, AC-32, AC-33.
- **Do:** `server/test/integration/edge.int.test.ts` (helpers `BASE`, `testDeps`, `ownRedis`; secret = a 40-char test value marked `// check-secrets: allow test value`), one `it` per bullet:
  - **AC-15:** `createDeps` with class `rehearsal` (all its required vars) and the dispatcher via `buildDispatcher`, plus a spy route. GET `/api/time` and GET `/api/nope`, without the secret and with a wrong one → identical status, body and header pairs; the spy handler is never called.
  - **AC-16:** the same in class `test` with the secret.
  - **AC-17:** class `test` without the secret → `/api/time` 200; `ctx.client` = `{ edgeVerified: false, addressPresent: false, country: 'unknown' }`.
  - **AC-20:** with the valid secret and a fixed `x-t2f-client`, vary each of `X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`, `True-Client-IP`, `Forwarded` → a probe route returning `{ country, ipDay: await ctx.client.ipDay() }` returns the same value.
  - **AC-25:** two dispatchers on the same real Redis → the same `ipDay` for one IP. `PTTL` of `edge:salt:<day>`, read with a raw `ioredis` client on the prefixed key, is > 0 and ≤ 86 400 000.
  - **AC-28:** row `ipDay` limit 2, three requests with the same `x-t2f-client` and different XFF → the third is 429 `rate_limited`; three different client IPs → none refused.
  - **AC-32:** routes with no header, `max-age=60`, and `no-store, max-age=0` → `private, no-store`, `private, no-store`, unchanged. A 404, a 429, a 500 (throwing handler) and a 503 (Redis-down fail-closed row) → all contain `no-store`.
  - **AC-33:** a test `public: true` route setting a cookie → no `set-cookie`, and one warn line `{event:'public-set-cookie', route}`; `routeRegistry.filter(r => r.public).length === 0`.
  - `afterAll` deletes `edge:salt:*` and `rl:it-*` keys of the slot.
- **Files:** `server/test/integration/edge.int.test.ts`.
- **Done means:** `pnpm --dir server test:int -- edge` is green.
- **Verify:** server `files` on the test (tsc/eslint), then the `test:int` command above.
- **Rules that apply:** —
- **Risk:** Redis key prefix handling. Use `T2F_REDIS_PREFIX` exactly as `adapters/redis.ts:32-41`.

### W19 — Static privacy checks (P6)
- **Serves:** AC-19 (storage part), AC-30.
- **Do:** `server/test/unit/edge-static.test.ts`, reading the sources with `fs`:
  - AC-19: no file under `server/src/collections/**` declares a field named `/ip|address|salt|fingerprint/i`;
  - AC-30: the only call sites of `fingerprintOf(` / `daySalts(` / `.ipDay(` in `server/src/**` are `platform/edge.ts`, `platform/fingerprint.ts`, `container.ts`, `registries/middleware.ts` and `test-doors/edgeEcho.ts`, and `edgeEcho.ts` does not call `ipDay`.
- **Files:** `server/test/unit/edge-static.test.ts`.
- **Done means:** green.
- **Verify:** server `files` on the test.
- **Rules that apply:** —
- **Risk:** low.

### W20 — Infra package scaffold + `infra` verify and CI (P7)
- **Serves:** AC-45 (infra half).
- **Do:**
  - `infra/cloudflare/tsconfig.json`: `allowJs`, `checkJs`, `noEmit`, `strict`, `target ES2022`, `module/moduleResolution NodeNext`, `types: ["node"]`, `skipLibCheck`, include `**/*.mjs`.
  - `vitest.config.mjs`: node env, `include: ['test/**/*.test.mjs']`, `testTimeout: 30_000`.
  - `.gitignore`: `.local/`.
  - Config entry `{ "package": "infra", "dir": "infra/cloudflare", "files": "node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs related --run --maxWorkers=2 --passWithNoTests {files}", "full": "node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2" }`.
  - CI step `infra full` after `edge full`, `run:` verbatim; extend the header comment.
- **Files:** `infra/cloudflare/{tsconfig.json,vitest.config.mjs,.gitignore}`, `.claude/sdd-engineering.json`, `.github/workflows/verify.yml`.
- **Done means:** both CI `run:` strings equal their config `full` strings (`node -e` check), and `infra full` is green at the end of P7.
- **Verify:** infra `full`.
- **Rules that apply:** security → CI.
- **Risk:** low.

### W21 — Desired state for `test` (P7)
- **Serves:** AC-37, AC-49 (rule), AC-51 (toggle definition).
- **Do:**
  - `lib/config.mjs`:
    - `MAIN_HOSTS = ['time2fest.com', 'www.time2fest.com', 'admin.time2fest.com']`;
    - `EXEMPT_PATHS = [{ path: '/api/webhooks/paypro', envs: 'all' }, { path: '/api/_test/edge-echo', envs: ['test'] }]` — the one registry;
    - `ENVS.test = { siteHost: 'test.time2fest.com', tunnelHost: 'o-test.time2fest.com', tunnelName: 't2f-test', originService: 'http://host.docker.internal:4100', underAttack: false }`. The port comes from slot 10 and the value is commented as such. Only `test` is defined in this wave.
  - `lib/desired.mjs` `desiredState(envNames, { underAttack })` builds:
    - `tunnels[]`: name, ingress `[{ hostname: tunnelHost, service: originService }, { service: 'http_status:404' }]`;
    - `dns[]`: proxied CNAME `tunnelHost` → `<tunnelId>.cfargotunnel.com`, resolved at diff time;
    - **`http_request_firewall_custom`** (whole phase, rules identified by `ref`):
      1. `t2f-skip-exempt` — `(http.host in {<site hosts>} and http.request.uri.path in {<exempt paths>})`, action `skip`, `action_parameters: { ruleset: 'current', phases: ['http_ratelimit','http_request_firewall_managed'], products: ['securityLevel','bic','uaBlock','zoneLockdown','hot'] }`;
      2. `t2f-block-tunnel-hosts` — `(http.host in {<tunnel hosts>})`, action `block`.
    - **`http_config_settings`:**
      1. `t2f-under-attack-test` — `(http.host eq "test.time2fest.com")`, `set_config { security_level: 'under_attack' }`, `enabled: underAttack`;
      2. `t2f-exempt-config` — the same expression as the skip rule, `set_config { security_level: 'essentially_off', bic: false }`. It comes last, so it wins over rule 1.
    - `zone: { pseudo_ipv4: 'off', bot_fight_mode: false }` — checked, never written without the zone flag.
  - Every rule expression names its hosts: the guard treats a hostless expression as zone-wide.
  - `test/desired.test.mjs`: each AC-37 element is present for `test`; the ingress ends with `http_status:404`; the block rule names `o-test.time2fest.com`; the exempt path list equals `EXEMPT_PATHS` for `test`; under-attack is disabled by default; no expression names a `MAIN_HOSTS` entry.
- **Files:** `infra/cloudflare/lib/{config,desired}.mjs`, `infra/cloudflare/test/desired.test.mjs`.
- **Done means:** the test is green.
- **Verify:** infra `files` on the three files.
- **Rules that apply:** — (unrouted; Free budget in Risks: custom rules 2/5, config rules 2/10).
- **Risk:** medium. The rule syntax is verified only live (W29). If Cloudflare rejects a field, the apply stops by AC-44.

### W22 — API client, current-state reader, diff, `plan`, redaction (P7)
- **Serves:** AC-38, AC-42 (output), AC-44 (missing token).
- **Do:**
  - `cf.mjs [plan|apply] --env test [--secrets-file <path>] [--under-attack on|off] [--allow-main-domain] [--allow-zone-settings] [--allow-delete]`. `apply` is wired in P8; in P7 it exits 1 with `not implemented`.
    - `--secrets-file` → `process.loadEnvFile`.
    - Missing `CLOUDFLARE_API_TOKEN_INFRA`, `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_ZONE_ID` → exit 1, naming the missing vars and the token's permissions (list below), before any request.
    - `main(argv, { env, fetch, out, now })` is exported for tests.
  - `lib/api.mjs`:
    - base `https://api.cloudflare.com/client/v4`. `CLOUDFLARE_API_BASE` is honoured only if it is `http://127.0.0.1:<port>` or `http://localhost:<port>` (tests), else exit 1;
    - `Authorization: Bearer` from env;
    - each call carries a `category` (`tunnel`, `dns`, `waf`, `config-rules`, `zone-settings`, `bot-management`) used by AC-44;
    - a non-2xx response → an `ApiRefusal { status, category, method, path }`. The response body is never printed.
  - `lib/current.mjs` (GETs only):
    - `cfd_tunnel?name=&is_deleted=false`;
    - `cfd_tunnel/{id}/configurations`;
    - `dns_records?name=`;
    - `rulesets/phases/{phase}/entrypoint` (404 → empty list);
    - `settings/pseudo_ipv4`;
    - `bot_management`.
  - `lib/diff.mjs`: `diff(desired, current)` → ordered changes `{ kind, op: 'create'|'update'|'delete', target, hosts: string[], summary }`. `hosts` holds every hostname in DNS names, ingress and rule expressions (regex for quoted `*.time2fest.com` / `time2fest.com`), or `['*zone*']` for a hostless rule or a zone setting. Rules are compared by `ref` on `description`, `expression`, `action`, `action_parameters` and `enabled`. A current rule without a desired `ref` → `delete`.
  - Output prints one line per change, or «без змін» when there are none.
  - `lib/redact.mjs` masks the values of `CLOUDFLARE_API_TOKEN_INFRA`, `CLOUDFLARE_API_TOKEN`, `T2F_EDGE_SECRET` and any tunnel token seen, in every output line.
  - `test/support/fakeApi.mjs`: an in-memory Cloudflare with `fetch(url, init)`, a request log (method, path), seeding, scripted refusals (status per category), and `listen()` → a loopback HTTP server over the same state for multi-process tests.
  - `test/plan.test.mjs`:
    - against an empty fake → the change list is non-empty and the log has GET only (AC-38);
    - with env values `tok-…`, a fake tunnel token and a fake edge secret present → `out` contains none of them (AC-42);
    - no token → exit 1 naming the var, 0 requests (AC-44 first half).
  - **Permissions** for the README and error text:
    - Account · Cloudflare Tunnel · Edit;
    - Zone · DNS · Edit;
    - Zone · Zone WAF · Edit;
    - Zone · Config Rules · Edit;
    - Zone · Zone Settings · Read (Edit only with `--allow-zone-settings`);
    - Zone · Bot Management · Read.
- **Files:** `infra/cloudflare/cf.mjs`, `infra/cloudflare/lib/{api,current,diff,redact}.mjs`, `infra/cloudflare/test/plan.test.mjs`, `infra/cloudflare/test/support/fakeApi.mjs`, `infra/cloudflare/README.md`.
- **Done means:** infra `full` is green.
- **Verify:** infra `files` on the touched files.
- **Rules that apply:** security → A09 (no token in output), base-URL allow-list (no token sent to an arbitrary host).
- **Risk:** medium.

### W23 — Guard (P8)
- **Serves:** AC-40.
- **Do:** `lib/guard.mjs` `guard(changes, flags)` → `{ ok, refused: [{ change, reason, flag }] }`:
  - `hosts ∩ MAIN_HOSTS ≠ ∅` → needs `--allow-main-domain`;
  - `'*zone*' ∈ hosts` or `kind === 'zone-setting'` → needs `--allow-zone-settings`;
  - `op === 'delete'` → needs `--allow-delete`.

  `apply` runs the guard on the full change list **before** taking the lock's first mutation. Any refusal → print each refused change with its flag, exit 2, and make 0 mutating requests. `plan` prints the same verdicts but exits 0.

  `test/guard.test.mjs` covers the five cases, each without its flag → exit 2 and 0 non-GET requests in the fake log, and each with its flag → allowed:
  1. a desired change naming `time2fest.com`;
  2. one naming `www.time2fest.com`;
  3. one naming `admin.time2fest.com`;
  4. a zone setting (`pseudo_ipv4` drift);
  5. a fake current custom-phase rule without a desired `ref` (a delete).
- **Files:** `infra/cloudflare/lib/guard.mjs`, `infra/cloudflare/test/guard.test.mjs`.
- **Done means:** green.
- **Verify:** infra `files`.
- **Rules that apply:** security → deny by default; guarded changes need an explicit flag.
- **Risk:** high. This is what protects the main domain.

### W24 — Apply: order, lock, idempotence, failure stop, journal line, tunnel token file (P8)
- **Serves:** AC-39, AC-41, AC-42, AC-43, AC-44, AC-51 (toggle).
- **Do:** `lib/apply.mjs`. On `apply`:
  1. Acquire `acquire({ dir: path.join(lockDir(cwd, env), 'cloudflare'), owner: '<slug>:<pid>', mode: 'exclusive' })` from `server/scripts/lib/lock.mjs:59,184` (slug via `resolveWorktree`).
  2. **Then** read the current state, diff and guard. Reading under the lock makes a second concurrent apply see the first one's result.
  3. Execute the changes in order:
     1. tunnel `POST cfd_tunnel {name, config_src:'cloudflare'}`;
     2. `PUT …/configurations {config:{ingress}}`;
     3. DNS `POST`/`PATCH`;
     4. for each phase, `PUT rulesets/phases/{phase}/entrypoint {rules}` with the full desired list;
     5. zone settings only when flagged.
  4. Stop at the first `ApiRefusal`: print `refused <status> on <category> <method> <path>; needs permission: <permission>`, then `applied before the refusal:` with the list. Exit 3 (AC-44).
  5. Afterwards, if no `infra/cloudflare/.local/tunnel-<env>.env` exists, `GET cfd_tunnel/{id}/token` and write `TUNNEL_TOKEN=<token>\n` there with mode `0o600` (`lib/tokenFile.mjs`). The token is never printed (AC-42).
  6. Release the lock in `finally`.
  7. With changes, print `- <YYYY-MM-DD from now()> — infra/cloudflare apply (<env>): <summaries joined by '; '>` (AC-43). With none, print «без змін» and make 0 mutations (AC-39).

  `--under-attack on|off` overrides `ENVS.<env>.underAttack` for that run only (AC-51 live toggle).

  Tests:
  - `test/apply.test.mjs`:
    - apply on an empty fake → changes applied, journal line regex `^- \d{4}-\d{2}-\d{2} — infra\/cloudflare apply \(test\): .+$`, token file written under a temp `cwd`, `out` without the token;
    - a second apply → «без змін», 0 non-GET;
    - a 403 scripted on `waf` → exit 3, names "Zone WAF · Edit", and lists the tunnel/DNS changes already applied;
    - `--under-attack on` then a default `plan` → a single diff on `t2f-under-attack-test.enabled`.
  - `test/lock.test.mjs`: the fake on `listen()`, `T2F_LOCK_DIR` = a temp dir, two `child_process.spawn(process.execPath, ['cf.mjs','apply','--env','test'])` started together with `CLOUDFLARE_API_BASE` = the fake URL. The fake delays every mutation by 300 ms. Assert that the total mutation count equals the count of a single apply, and that exactly one output contains «без змін». Also add `git check-ignore infra/cloudflare/.local/tunnel-test.env` → exit 0 (AC-42).
- **Files:** `infra/cloudflare/lib/{apply,tokenFile}.mjs`, `infra/cloudflare/cf.mjs`, `infra/cloudflare/test/{apply,lock}.test.mjs`.
- **Done means:** infra `full` is green.
- **Verify:** infra `files`.
- **Rules that apply:** security → A10 (stop on the first failure), A09 (no token output), secrets on disk only in a gitignored 0600 file.
- **Risk:** high. Partial applies; the lock across processes on Windows.

### W25 — `cloudflared` runner (P8)
- **Serves:** AC-42 (token path), enables AC-46 … AC-51.
- **Do:**
  - `infra/cloudflare/cloudflared/compose.yml`: service `cloudflared`, `image: ${CLOUDFLARED_IMAGE:?set CLOUDFLARED_IMAGE to a pinned cloudflare/cloudflared tag}`, `command: tunnel --no-autoupdate run`, `env_file: ../.local/tunnel-${T2F_EDGE_ENV:-test}.env`, `extra_hosts: ["host.docker.internal:host-gateway"]`, `restart: "no"`. No port is published.
  - README section: start and stop with `pnpm edge:tunnel:up`/`down`; the image tag is pinned by the wave lead and recorded in `docs/services/cloudflare.md`; the token file is gitignored and never printed.
- **Files:** `infra/cloudflare/cloudflared/compose.yml`, `infra/cloudflare/README.md`.
- **Done means:**
  - `docker compose -f infra/cloudflare/cloudflared/compose.yml config --quiet` exits non-zero without `CLOUDFLARED_IMAGE` and 0 with it, given a dummy env file in a temp copy. If Docker is not running, report it as **not run**;
  - `git check-ignore infra/cloudflare/.local/x.env` → 0.
- **Verify:** infra `files` (no code change); the commands above.
- **Rules that apply:** security → no secrets in compose; no published port.
- **Risk:** the Docker Desktop route from `host.docker.internal` to a 127.0.0.1-bound server (`server/scripts/stack.mjs:112`). This is checked live in W29.

### W26 — Live e2e suite (P9)
- **Serves:** AC-2, AC-9, AC-46 … AC-51, NFR-1 (all live parts).
- **Do:** `workers/edge/vitest.live.config.ts` (node env, `include: ['live/**/*.live.test.ts']`, `testTimeout: 60_000`, `maxWorkers: 1`) and `workers/edge/live/edge.live.test.ts`.
  - Env: `T2F_LIVE_SITE` (e.g. `https://test.time2fest.com`), `T2F_LIVE_TUNNEL_HOST`, `T2F_LIVE_MODE` ∈ `normal|server-down|tunnel-down|under-attack`, `T2F_LIVE_COUNTRY_PATH` (default: a `/country/<slug>/` present in `out-edge-test`).
  - Whole file: `describe.skipIf(!process.env.T2F_LIVE_SITE)`. Each block runs only in its mode.
  - **normal:**
    - AC-46: GET echo → `Set-Cookie` matches `^t2f_edge_probe=[0-9a-f]{32}; Path=/; Secure; HttpOnly; SameSite=Lax$`, with no `Domain`. A second GET with that cookie → `probeCookie` equals it.
    - AC-47: `loc` from `${site}/cdn-cgi/trace` equals `client.country`; `addressPresent === true`.
    - AC-48: 20 × echo and 20 × `/api/time` → no `cf-cache-status: HIT`.
    - AC-49: `${tunnel}/api/time`, `/api/webhooks/paypro` (POST) and `/connection/websocket` → 403.
    - AC-50: send `x-t2f-client: 203.0.113.9;US`, a random `x-t2f-edge` and `X-Forwarded-For: 203.0.113.9` → `edgeVerified === true`, and `country` equals the trace `loc`.
    - NFR-1 warm-up: 200 echo GETs, asserting only that each is 200.
  - **server-down** — AC-2: `/` and the country path → 200.
  - **tunnel-down** — AC-9: `/api/time` and echo → 503, body equal to the edge `unavailable()` JSON, `retry-after: 5`.
  - **under-attack** — AC-51:
    - POST `application/x-www-form-urlencoded` body `a=1&b=%C3%A9` with `x-t2f-probe-signature` = HMAC-SHA-256 hex of the raw bytes (a random per-run key) → 200, `bodySha256` equals the client hash, and the echoed signature is identical;
    - GET `/` → status ≠ 200.
  - Script `live` in the edge `package.json`: `node ../../node_modules/vitest/vitest.mjs run -c vitest.live.config.ts`.
- **Files:** `workers/edge/vitest.live.config.ts`, `workers/edge/live/edge.live.test.ts`, `workers/edge/package.json`, `workers/edge/tsconfig.test.json` (include `live`).
- **Done means:** without `T2F_LIVE_SITE`, `pnpm --dir workers/edge live` exits 0 with every test skipped, and the edge `full` is unaffected.
- **Verify:** edge `files` on the two new files.
- **Rules that apply:** —
- **Risk:** low.

### W27 — Live runbook (P9)
- **Serves:** enables W29 (all live ACs).
- **Do:** `workers/edge/README.md` § "Live verification on test.time2fest.com" — the exact command sequence of W29. No real path or value; placeholders `<secrets-file>` and `<tag>`.
- **Files:** `workers/edge/README.md`.
- **Done means:** every command in W29 appears in the README verbatim.
- **Verify:** n/a (docs).
- **Rules that apply:** —
- **Risk:** low.

### W28 — Integration pass (L, wave lead)
- **Serves:** AC-4, AC-17, AC-36, NFR-3; final evidence for every unit/integration AC.
- **Do:**
  1. Run `full` for `web`, `contracts`, `rules`, `server`, `edge` and `infra`. `server` needs `docker compose -p t2f up -d --wait postgres redis` plus `node scripts/db.mjs create && node scripts/db.mjs env && pnpm migrate` once.
  2. `pnpm contracts:run` with the worktree server up (time row: http pass; sim "no suite", see Spec follow-up 3).
  3. `pnpm install --frozen-lockfile` in a throwaway clean checkout.
  4. `git add -A` (no commit yet), then `node scripts/check-secrets.mjs`. It scans the index only (`scripts/check-secrets.mjs:39`).
  5. Start the server in class `production` with `T2F_EDGE_SECRET` and `T2F_ALLOWED_ORIGINS` set, then `T2F_E2E_SERVER=<url> T2F_E2E_EDGE_SECRET=<same> pnpm --dir server test:e2e -- doors-404`.
- **Done means:** all exit 0, apart from known pre-existing reds that also fail on `master` (name them).

### W29 — Live verification on test.time2fest.com (L, wave lead)
- **Serves:** AC-2, AC-9, AC-39, AC-46 … AC-51, NFR-1 (live).
- **Do:** credentials come from a secrets file outside the repo, whose path is given only on the command line. It holds `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN_INFRA` and `T2F_EDGE_SECRET` (≥ 32 random chars).
  1. `pnpm infra:cf plan --env test --secrets-file <f>`, then `apply`, then `apply` again → «без змін» (AC-39). Paste the journal line into `docs/services/cloudflare.md`.
  2. `pnpm build:edge:test`, then `pnpm edge:deploy:test -- --secrets-file <f>`.
  3. Start the worktree stack with `T2F_EDGE_SECRET` in the server env (class `test`, `T2F_TEST_DOORS=1`). Run `CLOUDFLARED_IMAGE=cloudflare/cloudflared:<tag> pnpm edge:tunnel:up`.
  4. `T2F_LIVE_SITE=https://test.time2fest.com T2F_LIVE_TUNNEL_HOST=https://o-test.time2fest.com T2F_LIVE_MODE=normal pnpm --dir workers/edge live`. Then grep the server log for the 3 tunnel-host probes of AC-49 (expect none).
  5. Stop the server → `T2F_LIVE_MODE=server-down`. Restart it, stop the tunnel → `tunnel-down`. Restart the tunnel.
  6. `pnpm infra:cf apply --env test --under-attack on --secrets-file <f>` → `T2F_LIVE_MODE=under-attack`. Then `apply` without the flag, then `plan` → no differences (AC-51).
  7. AC-49 port: from another device on the LAN (or this machine's LAN IP), `Test-NetConnection <lan-ip> -Port 4100` → refused.
  8. NFR-1: read the Worker CPU p95 in the dashboard after the 200-request warm-up and record it.
  9. `pnpm edge:tunnel:down`. Remove `T2F_EDGE_SECRET` from the server env.
- **Done means:** each listed AC is verified with recorded evidence, or marked `not verified (blocked: token)` per the traceability note.
- **Risks to watch:** spike 1. If the Worker's same-zone fetch is blocked by `t2f-block-tunnel-hosts`, **stop**: decision D1 must be revisited with the owner, not patched in the rule.

### W30 — Docs patch (L, wave lead; outside the repo except where noted)
- **Serves:** spec Goals (`:22`), D14.
- **Do:** implementers write nothing here. The wave lead writes:
  - `D:/Work/Pets/Time2Fest/docs/backend/cloudflare-notes.md` — research facts plus the live spike results;
  - `docs/services/cloudflare.md` — journal lines (apply output, deploy, tunnel image tag, token permissions);
  - `spec-05/docs-patch.md` (side-session notes) for `frontend-seam.md` §3.11 — the echo door row, HEAD/OPTIONS → 404, the edge 503 `unavailable`;
  - `docs/backend/README.md` §1 — the `workers/` and `infra/` paths;
  - `docs/backend/sdd-routing.md` — rows `workers/edge/**` (security; contract-conformance for `src/**`) and `infra/**` (security), removal of `functions/**`, and a note on `contract-run` (Spec follow-up 3);
  - candidate gotchas for `docs/knowledge/gotchas.md` via `engineering-insights` (Next implicit HEAD/OPTIONS bypass the dispatcher; `check-secrets` scans the index only; vars are not inherited by wrangler envs).
- **Done means:** the files exist and are linked from `docs/services/cloudflare.md`.

## Execution
One lane, phases strictly sequential: one implementer at a time (`sdd-routing.md` §7). Each implementer phase is a fresh `sdd-engineering:implementer` dispatch with this plan's path and the phase id, and touches only its phase's files. Every phase ends with a green targeted `verify.files` for its package. Server phases P4–P6 also run their named `pnpm --dir server test:int -- <name>` (shared lock). Docker Postgres and Redis must be up, with this worktree's DBs created and migrated: the wave lead prepares this once before P4.

| Lane / phase | Executor | Model | Work items | Files (disjoint) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — edge scaffold, config, CI | implementer | sonnet | W1, W2, W3 | `workers/edge/{package.json,tsconfig*.json,vitest.config.ts,.gitignore,wrangler.json}`, `workers/edge/test/{config.test.ts,fixtures/**}`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `eslint.config.mjs`, `.claude/sdd-engineering.json`, `.github/workflows/verify.yml` | — | — | this worktree; `pnpm install` is the only generator, run alone |
| P2 — Worker proxy | implementer | **opus** — trust boundary: header strip/set, streamed body, error mapping without leaking Cloudflare pages; workerd harness on Windows | W4, W5, W6 | `workers/edge/src/**`, `workers/edge/test/{handler,worker}.test.ts`, `workers/edge/test/support/**` | P1 | — | this worktree |
| P3 — Pages Function removal, dry-run, deploy | implementer | sonnet | W7, W8, W9 | `functions/**` (del), `tests/unit/functions-time.test.ts` (del), `tests/unit/api/time-contract.test.ts` (del), `workers/edge/test/{time-contract,dry-run,deploy}.test.ts`, `workers/edge/{README.md,package.json,scripts/deploy.mjs}`, `package.json`, maybe `tsconfig.json` | P2 | — | this worktree; dry-run writes only to `os.tmpdir()` |
| P4 — origin check, trusted client, fingerprint | implementer | **opus** — security-critical: constant-time compare before route lookup, salt lifecycle, no raw IP in context | W10, W11, W12, W13, W14 | `server/src/registries/{env,middleware}.ts`, `server/.env.example`, `server/src/platform/{edge,fingerprint,rateLimit}.ts`, `server/src/endpoints/{pipeline,types}.ts`, `server/src/container.ts`, `server/src/app/api/[[...path]]/route.ts`, `server/test/unit/{mechanisms,edge}.test.ts` | P3 | — | this worktree; `test:int` under the shared lock |
| P5 — cache policy, echo door | implementer | **opus** — test-door exemption and the cookie/cache policy decide what the tunnel exposes | W15, W16 | `server/src/endpoints/{pipeline,types}.ts`, `server/src/test-doors/{edgeEcho,registry,index}.ts`, `server/test/e2e/doors-404.e2e.ts`, `server/test/integration/edge-echo.int.test.ts` | P4 | — | this worktree |
| P6 — subject data, integration suite, static checks | implementer | sonnet | W17, W18, W19 | `server/src/platform/subjectData.ts`, `server/src/registries/subjectData.ts`, `server/test/integration/{subject-data,edge}.int.test.ts`, `server/test/unit/{edge,edge-static}.test.ts` | P5 | — | this worktree |
| P7 — infra desired state and plan | implementer | sonnet | W20, W21, W22 | `infra/cloudflare/{tsconfig.json,vitest.config.mjs,.gitignore,README.md,cf.mjs}`, `infra/cloudflare/lib/{config,desired,api,current,diff,redact}.mjs`, `infra/cloudflare/test/{desired,plan}.test.mjs`, `infra/cloudflare/test/support/fakeApi.mjs`, `.claude/sdd-engineering.json`, `.github/workflows/verify.yml` | P6 | — | this worktree; no network (fake API only) |
| P8 — infra guard, apply, lock, runner | implementer | **opus** — guard logic that protects the main domain, partial-apply stop, cross-process lock | W23, W24, W25 | `infra/cloudflare/lib/{guard,apply,tokenFile}.mjs`, `infra/cloudflare/cf.mjs`, `infra/cloudflare/test/{guard,apply,lock}.test.mjs`, `infra/cloudflare/cloudflared/compose.yml`, `infra/cloudflare/README.md` | P7 | — | this worktree; lock dir = temp in tests |
| P9 — live suite and runbook | implementer | sonnet | W26, W27 | `workers/edge/{vitest.live.config.ts,live/**,package.json,tsconfig.test.json,README.md}` | P8 | — | this worktree |
| L — integration pass, live verification, docs | wave lead (main session) | — | W28, W29, W30 | build outputs, `infra/cloudflare/.local/**` (gitignored), docs outside the repo | P9 | — | heavy runs one at a time; credentials only via `--secrets-file` |

Escalation from Sonnet to Opus follows `run-plan-auto` §3. P4 is the largest phase (12 files). If its budget runs out, return PARTIAL after W12 with the tree green, and continue W13–W14 in a second P4 dispatch.

## Verification plan
| Command | Directory | Passing means |
|---|---|---|
| web `files` (config) | `.` | exit 0 (P1, P3) |
| edge `files` / `full` (added in W3) | `workers/edge` | exit 0 |
| server `files` (config) | `server` | exit 0 |
| `pnpm test:int -- <name>` (`edge`, `edge-echo`, `subject-data`, `pipeline`, `rate-limit`, `doors`, `time`) | `server` | exit 0 (Postgres + Redis up) |
| infra `files` / `full` (added in W20) | `infra/cloudflare` | exit 0 |
| web, contracts, rules, server `full` (config) | their dirs | exit 0 — wave lead |
| `pnpm contracts:run` | `.` | time http pass — wave lead |
| `pnpm install --frozen-lockfile` | clean checkout | exit 0 — wave lead |
| `node scripts/check-secrets.mjs` after `git add -A` | `.` | `check-secrets: clean` — wave lead |
| `pnpm --dir server test:e2e -- doors-404` (production-class server, `T2F_E2E_SERVER`, `T2F_E2E_EDGE_SECRET`) | `.` | 10 rows × 4 variants green — wave lead |
| `pnpm --dir workers/edge live` (modes of W29) | `.` | green per mode — wave lead, live |
| `pnpm infra:cf plan|apply --env test --secrets-file <f>` | `.` | as W29 — wave lead, live |

## Assumptions
Technical judgement calls only.
- **Tooling.** `wrangler` and `@cloudflare/workers-types` stay root devDependencies at their pinned versions. The edge package reaches every tool by path, so no dependency or version changes and the lockfile gains one importer. Worker tests use wrangler 4.149.0's own `createTestHarness`, found in its `cli.d.ts:801-1113`, rather than `@cloudflare/vitest-pool-workers` or a direct `miniflare` dependency. That is the lightest option that still runs `workerd`.
- **Plain-JSON config.** `wrangler.json` (not `.jsonc`) lets tests `JSON.parse` it without a JSONC parser.
- **Edge tests run against a temp config copy.** It has absolute `main` and fixture assets, so dry-run and harness tests need no site build and touch no repo folder.
- **The Worker deletes the inbound `Host`.** Fetch derives it from `ORIGIN_URL`, and the origin sees the tunnel host. This is the only header beyond the two `x-t2f-*` that changes, and it is inherent to the target.
- **Missing edge secret fails closed.** A Worker with `ORIGIN_URL` but no `T2F_EDGE_SECRET` answers 503 `unavailable` instead of forwarding.
- **Fingerprint details.** IPv4-mapped IPv6 is treated as IPv4. The no-address bucket key is `noaddr:<UTC day>`. Fingerprint values carry the prefix `fp:`. The Redis salt key is `edge:salt:<UTC day>`, with TTL until the next UTC midnight (≤ 24 h).
- **Edge gate placement.** The gate is a `DispatcherInput` field built by the composition root, not a middleware row, because middleware runs only after a route matches (`pipeline.ts:209-216`).
- **Environment registry.** `T2F_EDGE_SECRET` goes in a new env block `edge`, which keeps SPEC-04's likely `platform` edits conflict-free.
- **Deploy guard.** The deploy script refuses non-`test` envs without `--confirm <env>`. Production and prelaunch share the apex custom domain, and only `test` is deployed in this wave.
- **Rule and env shapes.**
  - `prelaunch`/`production` share the apex route, `rehearsal` uses `rehearsal.time2fest.com`, and the origin hosts are `o-<env>.time2fest.com`, with `o.time2fest.com` for production. SPEC-13a may rename the non-test ones.
  - The infra Free budget combines envs into one block rule and one skip rule per phase, by host and path sets.
- **Tunnel origin.** The `test` tunnel's origin service is `http://host.docker.internal:4100`, the slot-10 server. The value is fixed in git, and a later wave changes the line deliberately.
- **`serve-int.mjs` is unchanged.** No AC needs edge headers locally. Without `T2F_EDGE_SECRET` the class-`test` server runs with the check off (AC-17), so the local stack and every existing test stay green.
- **Infra CLI exit codes.** 0 = ok / no changes, 1 = usage or missing variable, 2 = guard refusal, 3 = API refusal.

## Open questions
None.

## Research used
- No researcher was dispatched (brief: research done). Read in full:
  - `spec-05/research-code.md`;
  - `spec-05/research-cloudflare.md`.
- Verified in code (2026-11-17, this worktree), with actual line numbers:
  - `server/src/endpoints/pipeline.ts`, `types.ts`;
  - `server/src/platform/{rateLimit,subjectData,env}.ts`;
  - `server/src/registries/{middleware,env,subjectData,rateLimits}.ts`;
  - `server/src/container.ts`, `server/src/test-doors/{index,registry}.ts`;
  - `server/src/adapters/redis.ts:32-78`, `server/src/ports.ts`;
  - `server/scripts/lock.mjs`, `lib/lock.mjs:43-70,184-239`, `lib/worktree.mjs:86-88`, `stack.mjs:112`;
  - `scripts/check-secrets.mjs`, `scripts/contract-run.mjs`, `.github/workflows/verify.yml`;
  - root `tsconfig.json`, `eslint.config.mjs:99`, `package.json`, `pnpm-workspace.yaml`, `vercel.json`;
  - `tests/contract/time.suite.ts`, the two time tests, `server/test/e2e/doors-404.e2e.ts`, `server/test/integration/{helpers,rate-limit.int,subject-data.int}.test.ts`.
- Pinned tooling checked in `node_modules`:
  - wrangler 4.149.0 (`createTestHarness`, `WorkerInput.vars/secrets`, `DispatchFetch` with `cf`);
  - workerd 1.20261006.1 with the Windows binary present;
  - miniflare 5.20261006.1-alpha (transitive only).
- Spike items deferred to W29: 1 (same-zone fetch vs WAF), 3 (headers at origin), 5 (webhook path under attack), 6 (body bytes), 7 (`/api` pattern; covered locally by W6), 8 (`CF-Cache-Status`), 10 (tunnel down status), 11 (ruleset PUT creating the entrypoint).

## Rollback / blast radius
- **Blast radius:**
  - every `/api/*` request on the server: the gate, `Cache-Control` finalisation, HEAD/OPTIONS;
  - rate-limit keys;
  - the subject-data runner's result shape;
  - the time contract test location;
  - Cloudflare `test` resources only.
- **Not covered by the edge secret:** `/admin` and `/cms-api/*` on the origin, which bypass the dispatcher (`research-code` §Request pipeline). They are protected only by the tunnel-host WAF block until SPEC-04.
- **Code rollback:** drop the branch or revert the merge. Nothing is stored except Redis salt keys, which expire in ≤ 24 h. There is no migration.
- **Cloudflare rollback:**
  - `wrangler rollback` or delete Worker `t2f-edge-test`;
  - `pnpm infra:cf apply --env test --allow-delete` against a desired state without `test`, which deletes the tunnel, DNS and rules;
  - delete `infra/cloudflare/.local/`.
- **Merge with SPEC-04:**
  - shared files differ only by added lines; on conflict keep both sides' lines;
  - lockfile: take master's, re-run `pnpm install`, keep the `workers/edge` importer;
  - `verify.yml`/config: re-append the `edge` and `infra` objects and steps verbatim.

## Risks
- **Worker tests on Windows (workerd).** The harness starts a local `workerd` per file, which is RAM-heavy on a 16 GB machine shared with another wave. Run with `--maxWorkers=2`. If the harness fails to start on Windows, P2 returns BLOCKED; CI on Linux is the fallback evidence, decided by the wave lead.
- **`wrangler` 4.149.0 API.** `createTestHarness` is new and may change its shape. `run_worker_first` array support and `/api` exact matching are proven by W6/W8 locally and by W29 live.
- **Same-zone fetch vs WAF block rule (spike 1).** If the Worker is blocked too, stop (W29). There is no in-rule secret, because that would put the secret in git.
- **Free-plan rule counts.**

  | Phase | Limit | Used after this wave | Left for others |
  |---|---|---|---|
  | Custom rules | 5 | 2 (`t2f-skip-exempt`, `t2f-block-tunnel-hosts`), shared by all envs through host sets | 3 for SPEC-04/08/22a |
  | Config rules | 10 | 2 | 8 |
  | Rate-limit | 1 | 0 | 1 |
  | Cache rules | 10 | 0 | SPEC-08 |

  Adding an env changes expressions, not counts.
- **Docker → host loopback.** `cloudflared` in Docker Desktop must reach the 127.0.0.1-bound server through `host.docker.internal`. If it cannot, run the native `cloudflared` with the same token file, and record the deviation.
- **SPEC-04 merge overlap.** Its admin tunnel and Access rows go into `infra/cloudflare/` and may need custom rules from the budget above. `registries/env.ts`, `middleware.ts` and `subjectData.ts` are edited by both waves.
- **Exposure during the live session.** The laptop server with doors on is reachable through the tunnel. Only the echo door accepts a non-loopback `Host`, and only with the edge secret. W29 step 9 shuts it down.
