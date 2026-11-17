# Implementation plan: Server, rehearsal environment, deploy, rollback (SPEC-13a)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-13a-server-deploy.md` (Status: approved; checker 2026-11-17: 5 specs, 0 markers, 0 violations). AC-1 … AC-57, NFR-1 … NFR-5. Open questions 1–7 of the spec are non-blocking: each has an assumption and a fallback (`:547-560`).
This plan implements those requirements; it does not define or change them.
**Execution mode** — single-agent, **sequential phases** P1 … P13: one `sdd-engineering:implementer` dispatch per phase, never two at once. Phases L1 and L2 are run by the wave lead (main session), not by an implementer. The **Stage 2 runbook** (end of this file) is executed by the wave session when the owner provides the node; it is not an implementer phase. Mode chosen by the owner and passed in the orchestrator's brief on 2026-11-17 (16 GB machine; one implementer at a time).
**Out of scope** — the spec's Non-goals (`:46-59`): backups and restore, Telegram alarms, monitoring, cost counters, a continuous external probe (SPEC-13b); the production node, production secrets, deploys to `time2fest.com`/`www`/`admin`, moving the main domain, `import catalog` into production, a GitHub environment with owner approval (SPEC-22b); Centrifugo on the realtime node, 30k connections, `ulimit`, several `cloudflared` replicas, final night sizes, DigitalOcean tier upgrades (П-RT, SPEC-23); two server instances and the scheduler lease, node time sync, rehearsal clock control (SPEC-07); Centrifugo in the node Compose project (SPEC-06); privacy policy text (SPEC-17); a Hetzner adapter; an image registry, a managed database, SSH through the tunnel, zero-downtime resize; the live GitHub Actions run; an automatic migration-compatibility checker. No Payload collection, global or migration. Architecture review and security review (mandatory for this wave) are performed by separate agents.

Repository root for every path below = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-13a-server-deploy` (branch `spec-13a-server-deploy`). Slot **26**: server port **4260**, web 4261, database `t2f_spec_13a_server_deploy` (+ `_test`), Redis DB 26. **Do not commit, never push** — the wave lead commits after every phase (P12 builds the image from `HEAD` with `git archive`, so every earlier phase must be committed before P12 starts). **No implementer writes outside this worktree.** Never read `.env*` contents (except `*.example`), `pnpm-lock.yaml`, `out*`, `.next*`, `node_modules` beyond `.d.ts` / `--help` lookups, `infra/*/.local/**`.

**Precondition (P1, first step): rebase on `master` with SPEC-04 merged.** Every file reference below that SPEC-04 changes is quoted from the SPEC-04 worktree (`D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-04-admin-catalog`, head `c4b03d8`). After the rebase the implementer confirms with `git log --oneline -3 master` that the SPEC-04 merge is present and that `server/src/registries/env.ts` has the `access` and `catalog` blocks (`T2F_R2_BUCKET` at `:70`, `T2F_REDIS_PREFIX` at `:96`). If SPEC-04 is not on `master` yet → return BLOCKED.

**Shared files (changed line-wise, no reformatting, no reordering).** One entry per line, sorted where the file is sorted:
- `server/src/registries/env.ts`
- `server/src/registries/routes.ts`
- `server/src/platform/env.ts`
- `server/src/platform/edge.ts`
- `server/src/container.ts`
- `server/.env.example`
- `.github/workflows/verify.yml`
- `.claude/sdd-engineering.json`
- root `package.json` (scripts only)
- `infra/cloudflare/{cf.mjs, lib/config.mjs, lib/desired.mjs, lib/guard.mjs}`
- `workers/edge/scripts/deploy.mjs`
- `.claude/skills/migration-safety/SKILL.md`

`server/scripts/stack.mjs` is **not** touched (the image has its own start script, W8). **No new dependency** anywhere, so `pnpm-lock.yaml` does not change. `infra/ops` is not a workspace member (like `infra/cloudflare`) and reaches `typescript`/`vitest` through the root `node_modules`.

## Requirements traceability

Stage column: S1 = local, S1b = Cloudflare only (phase L2), S2 = real node (Stage 2 runbook). A requirement with several stages is verified on each; S2 items stay `not verified: no server` until the runbook runs, and Stage 1 merges without them.

| Req | Requirement (short) | Source | Work items | Stage | Checked by |
|---|---|---|---|---|---|
| AC-1 | image tagged with the full 40-hex SHA; runs without `.git`; health `commit` = SHA | `SPEC-13a:82` | W8, W9, W18, W32 | S1 | W32 (no `.git` in container; health commit) |
| AC-2 | non-test classes listen on `T2F_HOST`/`T2F_SERVER_PORT`; test stays loopback; bad `T2F_HOST` → exit ≠0 naming it | `:85` | W4, W5, W8 | S1 | W5, W8 unit; W32 (`rehearsal` on `0.0.0.0` reachable in network) |
| AC-3 | node project: postgres, redis, server, cloudflared; no published port; third-party images by digest | `:88` | W10, W32 | S1 | W10 unit; W32 `docker compose port` empty |
| AC-4 | server port reachable only inside the internal network shared with cloudflared | `:91` | W10, W32 | S1 | W32 |
| AC-5 | `GET /api/health` 200 `{"ok":true,"commit":…}`, `private, no-store`; no edge header → single 404 | `:94` | W7, W32 | S1 | W7 integration; W32 on the node |
| AC-6 | DB or Redis not answering in 2 s → 503 `{"ok":false}` exactly | `:97` | W7, W32 | S1 | W7 integration; W32 (`redis` stopped) |
| AC-7 | node services restart after reboot without a human | `:100` | W10, R4 | S1, S2 | W10 unit (`unless-stopped`); R4 reboot ≤3 min |
| AC-8 | bootstrap: `deploy` user with owner key, no root/password SSH, firewall TCP 22 only, Docker; rerun changes nothing | `:103` | W24, R1 | S1, S2 | W24 unit; R1 e2e |
| AC-9 | deploy step order build → deliver → migrate → swap → health → Worker, each step journalled | `:108` | W18, W20, W32, R3 | S1, S2 | W20 unit; W32 journal order + new SHA; R3 e2e |
| AC-10 | bad `--env`/`--commit`/target → exit 2 before any action, nothing in a shell line | `:111` | W13, W14 | S1 | W13 unit (fake executor not called) |
| AC-11 | dirty tree → refusal before build | `:114` | W15, W20 | S1 | W15/W20 unit |
| AC-12 | failed migration → old container kept, no Worker, exit ≠0 naming «міграції» | `:117` | W20, W33 | S1 | W20 unit; W33 integration |
| AC-13 | no health 200 in 60 s → previous image back, no Worker, exit ≠0 | `:120` | W18, W20, W33 | S1 | W20 unit; W33 (≤90 s, 0 wrangler calls) |
| AC-14 | Worker failure after swap → new server kept, journal `worker-failed`, exit ≠0 naming «Worker» | `:123` | W19, W20 | S1 | W20 unit |
| AC-15 | journal fields `at … failedStep`, never a secret value | `:126` | W16, W20, W21, W32 | S1 | W16 unit; W32 (all fields, sentinel absent) |
| AC-16 | keep the 3 last server images, never current/previous | `:129` | W18, W32 | S1 | W18 unit; W32 (5 deploys → 3 SHAs) |
| AC-17 | concurrent deploy/rollback of the same env → second refused naming the lock | `:132` | W16, W32 | S1 | W16 unit; W32 (two parallel commands) |
| AC-18 | < 5 GB free → refusal before delivery | `:135` | W18, W20 | S1 | W18 unit (4.9 GB → 0 deliveries) |
| AC-19 | deploy/rollback never run migration `down` | `:138` | W20, W21 | S1 | W20/W21 unit (recorded commands) |
| AC-20 | deploy never writes Worker secrets | `:141` | W19, W20 | S1 | W20 unit (no `secret put`) |
| AC-21 | prelaunch/production or a main host need `--confirm <env>` AND `--allow-main-domain`, else exit 2; prelaunch = Worker only | `:144` | W13, W20, W30 | S1 | W13 unit (ops); W30 unit (edge `deploy.mjs`); W20 (prelaunch Worker only) |
| AC-22 | target `178.20.157.85` → exit 2 whatever the flags | `:147` | W13 | S1 | W13 unit |
| AC-23 | production 31.12 08:00 – 01.01 14:00 UTC without `--emergency` → exit 2 | `:150` | W13 | S1 | W13 unit (fake clock) |
| AC-24 | rollback: Worker to `workerVersionBefore` of the last ok record, then server to `imageBefore`/`--to`, journalled | `:155` | W21, W33, W37, R5 | S1, S1b, S2 | W21 unit; W33 integration; L2 (Worker real); R5 e2e |
| AC-25 | rollback runs no migration and does not change the node env file | `:158` | W21, W33 | S1 | W33 (migrations table and env-file checksum equal) |
| AC-26 | no ok record or its image missing → refusal, no changes | `:161` | W21 | S1 | W21 unit (0 wrangler, 0 Docker) |
| AC-27 | target record generation < current edge-secret generation → refusal with explanation | `:164` | W21 | S1 | W21 unit |
| AC-28 | infra env `rehearsal`: tunnel `t2f-rehearsal`, `o-rehearsal` (`^/api/` only), `admin-rehearsal` (all paths), CNAMEs; test + rehearsal together; reapply «без змін» | `:169` | W28, W37 | S1, S1b | W28 unit; L2 apply/plan |
| AC-29 | `o-rehearsal` in the existing block rule, `admin-rehearsal` not; no new custom rule | `:172` | W28, W37 | S1, S1b | W28 unit; L2 (`o-rehearsal…/api/time` → 403) |
| AC-30 | `--with-access` creates/updates the Access app for `admin-rehearsal`, emails only from a local env var | `:175` | W29 | S1 | W29 unit (live after OQ-2 → R2) |
| AC-31 | rehearsal Worker deploy builds `test`+`http` into `out-edge-rehearsal`, served on `rehearsal.time2fest.com` | `:178` | W2, W19, W37 | S1b | L2 (`/` 200 html, `*.workers.dev` 404) |
| AC-32 | `rehearsal…/api/time` answered by the Worker (SPEC-05 AC-10) | `:181` | W37 | S1b | L2 |
| AC-33 | move-domain re-binds the name to a second Worker by deploying it, back the same way, gap journalled | `:184` | W31, W37 | S1b | L2 |
| AC-34 | explicit detach only of a binding its journal created; never main hosts | `:187` | W31 | S1 | W31 unit |
| AC-35 | `T2F_EDGE_SECRET_PREVIOUS` set → either value accepted, constant time | `:192` | W6 | S1 | W6 integration (both 200, third → single 404) |
| AC-36 | `PREVIOUS` < 32 chars or equal to the secret → refuse to start naming it | `:195` | W4, W5 | S1 | W5 unit |
| AC-37 | rotation order (1)…(4), generation incremented | `:198` | W23, W33, R6 | S1, S2 | W23 unit (order); W33 (no 404 for the client); R6 e2e |
| AC-38 | rehearsal secrets generated (≥32 bytes), stored only in `.local` 0600, node env file 0600, Worker secrets; via stdin only | `:201` | W22, W37 | S1, S1b | W22 unit; L2 (`wrangler secret list`) |
| AC-39 | denylist `time2fest-prod`, `o.time2fest.com`, `t2f_production`, `t2f:production:`; `T2F_R2_BUCKET`, `T2F_REDIS_PREFIX` isolated | `:204` | W4, W5 | S1 | W5 unit |
| AC-40 | node env example lists every var required in rehearsal/production, empty | `:207` | W11 | S1 | W11 unit |
| AC-41 | docs patch with the `secrets.md` text (7 points) | `:210` | W35 | S1 | L1 manual check + secret-pattern grep |
| AC-42 | deploy workflow: `workflow_dispatch` only, `env` choice `rehearsal`, no `pull_request_target`, SHA-pinned actions, secrets by name, `pnpm deploy:env` | `:223` | W12 | S1 | W12 unit |
| AC-43 | one `ops` row in the verify config and the same steps in `verify.yml`; other rows untouched | `:226` | W1 | S1 | W1 unit + L1 `git diff` |
| AC-44 | `migration-safety` rule: new migration compatible with the previous image; rollback runs no `down` | `:229` | W3 | S1 | W3 grep |
| AC-45 | provider access only through the adapter interface; fake and DO pass one contract suite; DO names only in its adapter | `:234` | W25, W26 | S1 | W25/W26 unit + grep |
| AC-46 | capacity prints the plan by default; changes only with `--confirm <env>` | `:237` | W27 | S1 | W27 unit |
| AC-47 | resource without both tags → refusal, 0 deletes | `:240` | W27 | S1 | W27 unit |
| AC-48 | main node resize CPU/RAM only, size from the allowed list | `:243` | W26, W27, R7 | S1, S2 | W27 unit; R7 (OQ-4) |
| AC-49 | realtime node created with tags + bootstrap, removed by delete (never power-off); realtime profile only `cloudflared` | `:246` | W10, W27, R7 | S1, S2 | W10/W27 unit; R7 (OQ-4) |
| AC-50 | never a second server instance; realtime profile has no `server` | `:249` | W10, W27 | S1 | W10/W27 unit |
| AC-51 | off-season: main → off-season size, realtime deleted; `status` shows drift | `:252` | W27, R7 | S1, S2 | W27 unit; R7 |
| AC-52 | provider error / 429 → stop, print done steps; rerun resumes | `:255` | W27 | S1 | W27 unit |
| AC-53 | probe every second through the edge, downtime in seconds journalled | `:258` | W17, W20, W21, W27, W31, R3–R7 | S1, S2 | W17 unit (200,503,503,200 → 2 s); R-steps numbers |
| AC-54 | from a node container without edge header → single 404 | `:263` | W8, R4 | S2 | R4 |
| AC-55 | `o-rehearsal` bypassing the Worker → 403; only TCP 22 open on the node | `:266` | W28, R4 | S2 | R4 |
| AC-56 | admin without Access → login/403, `o-rehearsal` with admin Host → 403, node IP → no connection | `:269` | W28, W29, R4 | S2 | R4 (after OQ-2) |
| AC-57 | `master` on the node: `/` 200, `/api/health` 200 with that SHA | `:272` | R3 | S2 | R3 (after OQ-3) |
| NFR-1 | rollback ≤5 min to previous SHA and recorded Worker version, worst of 3 | `:300` | W21, W37, R5 | S1b, S2 | L2 (Worker part timed); R5 |
| NFR-2 | deploy/rollback `/api/*` downtime ≤60 s by the AC-53 probe | `:303` | W17, R3, R5 | S2 | R3, R5 |
| NFR-3 | capacity journals resize downtime and realtime create/delete times | `:306` | W27, R7 | S2 | R7 (OQ-4), else «not verified live» |
| NFR-4 | no secret value in stdout, stderr, journals, server log, CI artifacts | `:309` | W14, W20, W21, W22, W23 | S1 | sentinel tests in W14, W20, W21, W22, W23 |
| NFR-5 | capacity prints price/hour of every created or enlarged resource before `--confirm` | `:312` | W25, W27 | S1 | W27 unit |

**If the owner never provides the node (OQ-1/OQ-3):** S2 rows stay `not verified: no server` — AC-7 (live part), AC-8 (e2e), AC-9 (e2e), AC-24 (S2), AC-37 (S2), AC-48/49/51 (manual), AC-53 (numbers), AC-54 … AC-57, NFR-1 (S2 part), NFR-2, NFR-3. Every unit/integration/S1b part is still verified and Stage 1 is mergeable.

## Spec follow-ups

Addressed to `spec-creator` and the owner. The plan implements the spec as written.
1. **Rollback after a `worker-failed` deploy (AC-24).** "The last successful record" skips the `worker-failed` one, so the Worker goes back one version further than the one it is on. This is implemented literally. Suggest naming this case in the spec.
2. **Lock and disk check before the build (AC-9 diagram vs AC-17/AC-18).** The diagram places «замок і перевірка диска» after delivery. AC-18 requires "before delivery" and AC-17 requires "changing nothing", so both checks run before the build. The six AC-9 steps keep their order.
3. **AC-27 refuses the whole rollback**, not just the Worker half (exit 2, no change). Rolling only the server back would leave a Worker/server pair that was never deployed together.
4. **`edge:secret --generate` also pushes the owner-filled node env files to the node** (R2 keys, Access values, tunnel token). No other command in the spec's table writes them, and AC-25 forbids rollback from touching them. Suggest naming this in the command table.
5. **`/api/health` through the Worker is public** on `rehearsal.time2fest.com` and discloses the commit SHA (AC-57 needs it). That is fine for rehearsal. SPEC-22b should decide this for production.
6. **AC-39 matches the denylist by substring** (SPEC-02 AC-20 semantics, `env.ts:120-123`). `o.time2fest.com` also matches any `*o.time2fest.com` host (for example `demo.time2fest.com`) and refuses to start. This fails closed; no rehearsal value is affected.

## Affected surface

| File | New/Mod | Package | Home (ring / radius) | Skills that will govern it | Constraint to respect |
|---|---|---|---|---|---|
| `server/src/registries/env.ts` | Mod | server | ring 4 registry | onion; security (via `platform/env.ts` schema) | SPEC-04 shape `:48-105`; blocks sorted by `key`, add lines only (`:52-62` access, `:69-73` catalog, `:79` edge, `:86-102` platform) |
| `server/src/platform/env.ts` | Mod | server | ring 1 (pure) | onion; security | never reads `process.env` (`:2-4`); messages name variables only (`:4`); `PRODUCTION_DENYLIST` `:40`; cross-variable rule pattern = `PAYPRO_MODE` `:127-129` |
| `server/src/platform/edge.ts` | Mod | server | ring 3/4 platform | onion; security | HMAC + `timingSafeEqual` (`:73-82`); refusal is `null` (`:7`); nothing logs (`:10`) |
| `server/src/container.ts` | Mod | server | composition root | onion; security | `edgeGateOf` `:301-309`; hidden-port pattern `CATALOG_STORE_KEY` + `catalogStoreOf` (`:52`, `:168-173`) |
| `server/src/health/ports.ts` | New | server | ring 2 port | onion | technology-neutral; one method |
| `server/src/adapters/readiness.ts` | New | server | ring 4 adapter | onion | lazy Payload accessor (`container.ts:100-117`); Redis via `FastStore` (`ports.ts:29-40`) |
| `server/src/endpoints/health.ts` | New | server | ring 4 driving adapter | onion; security; contract-conformance | raw `Response` like `endpoints/time.ts:13-31`; reaches the port via dynamic `import('../container')` like `endpoints/catalog.ts:15` |
| `server/src/registries/routes.ts` | Mod | server | ring 4 registry | onion | sorted unique rows (`:9`, `assertRegistry`) |
| `server/.env.example` | Mod | server | config | security (`**/.env*`) | names only (`:1`) |
| `server/scripts/lib/listen.mjs` | New | server | script lib | security (`server/scripts/**`) | pure; no `process.env` read |
| `server/scripts/image-start.mjs` | New | server | script | security | no git, no pnpm, `shell:false`, forwards SIGTERM; prints names only |
| `server/scripts/health-probe.mjs` | New | server | script | security | secret only from its own env, never in argv/output |
| `server/Dockerfile`, `server/Dockerfile.dockerignore` | New | server | build | security (unrouted file; rules applied anyway) | base image by digest; non-root user; no secret in any layer; `.git` excluded |
| `server/test/unit/env-13a.test.ts`, `edge-rotation.test.ts`, `listen.test.ts` | New | server | tests | — | `rawEnv` helper pattern `server/test/unit/platform.test.ts:21-23`; `// check-secrets: allow` on fake secrets (`scripts/check-secrets.mjs:16-20`) |
| `server/test/integration/health.int.test.ts`, `edge-rotation.int.test.ts` | New | server | tests | — | `testDeps(overrides, env)` from `server/test/integration/helpers.ts:18` |
| `infra/ops/**` (`ops.mjs`, `lib/**`, `node/**`, `edge-twin/**`, `test/**`, `README.md`, configs) | New | ops | ops tooling | security (`infra/**`) | mirror `infra/cloudflare`: `// @ts-check` `.mjs`, JSDoc, `main(argv, deps)` exported for tests (`cf.mjs:53-66`), zero deps, `shell:false` |
| `infra/cloudflare/lib/config.mjs` | Mod | infra | config | security | `ENVS` `:29-38`; `SECRET_ENV_NAMES` `:58` |
| `infra/cloudflare/lib/desired.mjs` | Mod | infra | desired state | security | ingress ends `http_status:404` (`:40`); block rule over tunnel hosts (`:65-71`); every expression names hosts (`:11`) |
| `infra/cloudflare/lib/access.mjs` | New | infra | Access app | security | GET/POST/PUT only under `--with-access`; emails from env, never printed |
| `infra/cloudflare/lib/guard.mjs` | Mod | infra | guard | security | `KINDS` `:11`, deny by default (`:3`) |
| `infra/cloudflare/cf.mjs` | Mod | infra | CLI | security | arg parser `:23-51`; `desiredState([args.env])` `:107` → all envs |
| `infra/cloudflare/test/{desired,access}.test.mjs` | Mod/New | infra | tests | — | existing tests build `desiredState(['test'])` (`desired.test.mjs:6`) |
| `workers/edge/scripts/deploy.mjs`, `workers/edge/test/deploy.test.ts` | Mod | edge | script / test | security (`workers/**`) | `--confirm` check `:68-71`, exit 2 |
| `.github/workflows/deploy.yml` | New | ops | CI | security (`.github/workflows/**`) | no `pull_request_target`, inputs never interpolated into `run:`, actions by SHA |
| `.github/workflows/verify.yml` | Mod | ops | CI | security | header comment `:1-2`; step order `:52-57` |
| `.claude/sdd-engineering.json` | Mod | — | config | unrouted | add one one-line object; no other line changes |
| `package.json` (root) | Mod | web | scripts | security (`**/package.json`) | scripts only `:9-41`; no dependency change |
| `.claude/skills/migration-safety/SKILL.md` | Mod | — | skill text | unrouted | one new numbered check line |

**Coverage gaps:** `infra/ops/**` and `infra/cloudflare/**` are routed only to `security` (no architecture skill; `sdd-routing.md:13`). The same holds for `workers/edge/scripts/deploy.mjs`. `server/Dockerfile*`, `infra/ops/node/compose*.yml` and `*.env.example` under `infra/ops/node/` are not matched by `**/docker-compose*.yml` or `**/.env*`, so they are judged by the security review and W10/W11 tests. Also unrouted: `.claude/sdd-engineering.json`, `.claude/skills/migration-safety/SKILL.md`, `infra/ops/README.md`, `docs/plans/*.md`, and the docs patch outside the repo. `server/test/**` is unrouted (`sdd-routing.md:21`).

## Contract changes
- **Shared contracts / schemas:** no. `packages/contracts/**` and `lib/api/contracts/**` are untouched.
- **Migration:** **no — confirmed.** No collection, global or field changes. `migration-safety` gains only a rule line (W3). `verify-schema` still runs in `server full`. On a fresh worktree DB run `pnpm --dir server migrate` before `node scripts/verify-schema.mjs`.
- **Seed / fixture data:** no.
- **Build-only failures:** **yes**, two of them.
  - (a) The server image runs `next build` of Next 16 + Payload 3.91 inside Docker. Typecheck and unit tests cannot catch a CSS/importMap/server-client failure there (`docs/plans/SPEC-02-server-skeleton.plan.md:195`). W9 builds the image under the exclusive lock.
  - (b) After SPEC-04, a `test`+`http` site build fetches the catalog from `T2F_CATALOG_URL` or `127.0.0.1:<slot port>` and fails closed (`lib/data/catalogSource.mjs:20-28`, `next.config.ts` `configWithServerCatalog`). `build:edge:rehearsal` therefore needs `T2F_CATALOG_URL`. In S1b this is the slot-26 dev server (`http://127.0.0.1:4260`); in S2 it is `https://rehearsal.time2fest.com`. L2 runs it.
- **Wire contract:** yes, operationally — new route `GET /api/health`. It is deliberately **not** in the web contracts or `packages/contracts` (spec `:372`: "У контракти web не входить"). It is an edge→server operational probe, the site never calls it, and its body is fixed by AC-5/AC-6, so no shared schema or sim adapter exists to keep in step. The check that still runs is `node scripts/contract-surface.mjs --check` (inside `web full`, L1). It proves the web contract surface is unchanged. `pnpm contracts:run --sim-only` stays green. The `frontend-seam.md` §3.11 row goes into the docs patch (W35).
- **Layout fidelity:** no. The site does not render differently. `build:edge:rehearsal` only adds a build script with the same flags as `build:edge:test` and a new dist dir. Skill skipped (`sdd-routing.md:62`).
- **Payload migration:** no (see above).
- **Test doors:** no. `/api/health` is a production route, not a door. No `/api/_test/*` path is added, so `doors-404` is unchanged.
- **Agent write surface:** no. `security-reviewer` is mandatory anyway by the wave rule (`sdd-routing.md:60`).
- **Seed and fixtures:** no.

## Work items

Verification commands used below:
- **ops.files** = `cd infra/ops && node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs related --run --maxWorkers=2 --passWithNoTests <files> > ../../.claude/sdd/logs/13a-<W>.log 2>&1; tail -40 ../../.claude/sdd/logs/13a-<W>.log`. Run `mkdir -p .claude/sdd/logs` once; `.claude/sdd/` is gitignored. The same file-and-tail pattern applies to every command below.
- **server.files** = the config `server.files` command in `server/` on the touched files.
- **server.int `<file>`** = `cd server && node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>`. `pnpm test:int -- <name>` does **not** filter (`docs/backend/README.md:105`). Prerequisite (wave lead, once before P2): `pnpm stack:up`, `pnpm db:create`, `pnpm --dir server migrate`.
- **infra.files** / **edge.files** = config entries.
- **HEAVY:** `node server/scripts/lock.mjs --mode exclusive -- <cmd>` from the repo root. Never two heavy runs at once.

### W1 — Rebase, `infra/ops` scaffold, `ops` verify row and CI step (P1)
- **Serves:** AC-43; enables every `ops` item.
- **Do:**
  - Precondition: `git rebase master` (SPEC-04 merged; see header). Stop as BLOCKED on conflict.
  - `infra/ops/tsconfig.json` and `vitest.config.mjs`: copies of `infra/cloudflare/{tsconfig.json,vitest.config.mjs}`. `vitest.config.mjs` gets `exclude: ['test/node/**']`.
  - `infra/ops/vitest.node.config.mjs`: `include: ['test/node/**/*.int.test.mjs']`, `fileParallelism: false`, `testTimeout: 900_000`, `hookTimeout: 900_000`.
  - `infra/ops/.gitignore`: `.local/`.
  - `infra/ops/ops.mjs`: CLI entry `node infra/ops/ops.mjs <deploy|rollback|bootstrap|edge-secret|move-domain|capacity> …`. It exports `main(argv, deps)` returning the exit code, with the same tail as `cf.mjs:155-159`. Every subcommand prints `not implemented` and returns 1 until its phase wires it. An unknown subcommand → 2.
  - `.claude/sdd-engineering.json`: insert **one line** before the `infra` object: `{ "package": "ops", "dir": "infra/ops", "files": "node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs related --run --maxWorkers=2 --passWithNoTests {files}", "full": "node ../../node_modules/typescript/bin/tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2" },`. It ends with a comma, so no existing line changes.
  - `.github/workflows/verify.yml`: new step `ops full` (`working-directory: infra/ops`, `run:` = the `full` string verbatim) after `infra full`. Add a second header comment line naming `ops full`; do not edit line 1.
  - `infra/ops/test/ci.test.mjs`:
    - parse the JSON and assert one `ops` row with these strings;
    - text-scan `verify.yml` for a step named `ops full` whose `working-directory` is `infra/ops` and whose `run:` equals `full`;
    - assert every other package's row still exists (`web`, `contracts`, `rules`, `server`, `edge`, `infra`).
- **Files:** `infra/ops/{tsconfig.json,vitest.config.mjs,vitest.node.config.mjs,.gitignore,ops.mjs}`, `infra/ops/test/ci.test.mjs`, `.claude/sdd-engineering.json`, `.github/workflows/verify.yml`.
- **Done means:** `ops full` is green. `git diff master -- .claude/sdd-engineering.json` shows exactly one added line and no removed line.
- **Verify:** ops `full` (`cd infra/ops && <full>`).
- **Rules that apply:** security → CI: no new secrets, `permissions: contents: read` unchanged.
- **Risk:** low.

### W2 — Root scripts (P1)
- **Serves:** AC-9, AC-24, AC-31 (command entry points); enables AC-8, AC-33, AC-37, AC-38, AC-46.
- **Do:** add to root `package.json` `scripts`, after `infra:cf`, one per line:
  - `"deploy:env": "node infra/ops/ops.mjs deploy"`
  - `"rollback:env": "node infra/ops/ops.mjs rollback"`
  - `"node:bootstrap": "node infra/ops/ops.mjs bootstrap"`
  - `"edge:secret": "node infra/ops/ops.mjs edge-secret"`
  - `"edge:move-domain": "node infra/ops/ops.mjs move-domain"`
  - `"capacity": "node infra/ops/ops.mjs capacity"`
  - after `build:edge:test`: `"build:edge:rehearsal": "cross-env NEXT_PUBLIC_ENV=test NEXT_PUBLIC_API_MODE=http NEXT_DIST_DIR=out-edge-rehearsal next build"`
  - `out-*` is already ignored (`.gitignore`).
- **Files:** `package.json`.
- **Done means:** `node -e` prints all seven scripts from `package.json`, and `pnpm deploy:env -- --env rehearsal` prints `not implemented` and exits 1.
- **Verify:** `node -e "const s=require('./package.json').scripts;for(const k of ['deploy:env','rollback:env','node:bootstrap','edge:secret','edge:move-domain','capacity','build:edge:rehearsal'])if(!s[k])process.exit(1)"`.
- **Rules that apply:** security → `package.json` (no dependency change).
- **Risk:** low.

### W3 — `migration-safety` rule (P1)
- **Serves:** AC-44.
- **Do:** append check `9. **Compatible with the previous image:** the new migration works with the code of the previous server image (expand → contract across two deploys); the SPEC-13a rollback (\`pnpm rollback:env\`) never runs \`down\` — it only swaps the image back.` after check 8.
- **Files:** `.claude/skills/migration-safety/SKILL.md`.
- **Done means:** `grep -n "Compatible with the previous image" .claude/skills/migration-safety/SKILL.md` → 1 line, and that line contains `never runs`.
- **Verify:** that grep.
- **Rules that apply:** —
- **Risk:** low.

### W4 — Env registry: `T2F_HOST`, `T2F_COMMIT`, `T2F_EDGE_SECRET_PREVIOUS`, isolation flags (P2)
- **Serves:** AC-2 (schema), AC-36, AC-39; enables AC-1 (`commit`).
- **Do** (lines only, in the SPEC-04 file):
  - `edge` block, after `T2F_EDGE_SECRET`: `{ name: 'T2F_EDGE_SECRET_PREVIOUS', schema: z.string().min(32).optional(), secret: true },`.
  - `platform` block, after `T2F_SERVER_PORT`:
    - `{ name: 'T2F_HOST', schema: z.union([z.ipv4(), z.string().regex(/^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/i)]).optional() },`
    - `{ name: 'T2F_COMMIT', schema: z.string().regex(/^[0-9a-f]{40}$/).optional() },`
  - Add `isolated: true` to the existing `T2F_R2_BUCKET` (`:70`) and `T2F_REDIS_PREFIX` (`:96`) objects — the only modified lines.
  - `server/.env.example`: add `T2F_EDGE_SECRET_PREVIOUS=`, `T2F_HOST=`, `T2F_COMMIT=` lines (names only).
- **Files:** `server/src/registries/env.ts`, `server/.env.example`.
- **Done means:** `server.files` is green on both files.
- **Verify:** server.files.
- **Rules that apply:**
  - security → A04: `secret: true` on the previous secret, so `createLogger` masks it (`container.ts:128`);
  - onion → the registry is ring 4 and adds no logic.
- **Risk:** low. `T2F_HOST` stays optional; compose sets it (W10).

### W5 — Denylist and the previous-secret rule (P2)
- **Serves:** AC-36, AC-39, AC-2 (invalid `T2F_HOST` refused by name).
- **Do:**
  - `PRODUCTION_DENYLIST = ['time2fest-prod', 'o.time2fest.com', 't2f_production', 't2f:production:']`, one per line. Update the comment: filled by SPEC-13a, production node names fixed by convention (OQ-6).
  - In `loadEnv`, after the `PAYPRO_MODE` rule (`:127-129`): when `env.T2F_EDGE_SECRET_PREVIOUS !== undefined` and it equals `env.T2F_EDGE_SECRET`, push `T2F_EDGE_SECRET_PREVIOUS` once.
  - `server/test/unit/env-13a.test.ts`:
    - class `rehearsal` with each denylisted id in its variable → `failing` names it:
      - `T2F_R2_BUCKET=time2fest-prod`;
      - `T2F_CENTRIFUGO_URL=https://o.time2fest.com` (an isolated URL variable);
      - `DATABASE_URI=…/t2f_production`;
      - `T2F_REDIS_PREFIX=t2f:production:`;
    - the rehearsal values `time2fest-rehearsal`, `https://o-rehearsal.time2fest.com`, `…/t2f_rehearsal`, `t2f:rehearsal:` → `ok`;
    - `T2F_EDGE_SECRET_PREVIOUS` with 31 chars, and equal to the secret → `failing` contains it and no value appears in the result;
    - `T2F_HOST='bad host;'` → `failing` = `['T2F_HOST']`; `T2F_HOST=0.0.0.0` → ok.
  - Build rehearsal envs like `platform.test.ts:21-23` (all REQ vars present). Mark fake secret strings with `// check-secrets: allow fake`.
- **Files:** `server/src/platform/env.ts`, `server/test/unit/env-13a.test.ts`.
- **Done means:** the new test is green. `server.files` passes on `platform/env.ts`, including the existing `platform.test.ts` and `env-access-catalog.test.ts`.
- **Verify:** server.files on both files.
- **Rules that apply:**
  - onion ring 1 → no `process.env`;
  - security → A10 fail closed, A09 names only.
- **Risk:** medium. The substring match may refuse an unforeseen value (Spec follow-up 6). Existing tests that use the default denylist in class `rehearsal` must stay green.

### W6 — Edge gate accepts the current and the previous secret (P2)
- **Serves:** AC-35.
- **Do:**
  - `EdgeGateDeps` gains `previousSecret: string | undefined`.
  - `createEdgeGate` computes `expectedPrev = mac(previousSecret)` when present. `admit` computes **both** comparisons unconditionally — `const a = timingSafeEqual(received, expected); const b = expectedPrev ? timingSafeEqual(received, expectedPrev) : false;` — and refuses when `!(a || b)`. No early return between them.
  - Header doc `:1-10` gains one line on rotation.
  - `container.ts` `edgeGateOf` passes `previousSecret` from `deps.env.vars.T2F_EDGE_SECRET_PREVIOUS` with the same `typeof` guard.
  - Tests:
    - `server/test/unit/edge-rotation.test.ts`: both values admitted, a third → `null`, previous unset → only current;
    - `server/test/integration/edge-rotation.int.test.ts`: `buildDispatcher(testDeps({}, { T2F_EDGE_SECRET: A, T2F_EDGE_SECRET_PREVIOUS: B }))`. `GET /api/time` with A → 200, with B → 200, with C → the single 404, byte-equal to an unknown path. After W7, also `/api/health`; P3 extends the file.
- **Files:** `server/src/platform/edge.ts`, `server/src/container.ts`, `server/test/unit/edge-rotation.test.ts`, `server/test/integration/edge-rotation.int.test.ts`.
- **Done means:** both tests are green, and `server/test/unit/edge.test.ts` (SPEC-05) is unchanged and green.
- **Verify:** server.files on the 4 files; server.int `edge-rotation.int.test.ts`.
- **Rules that apply:**
  - security → A04/A07: constant-time compare, fail closed, the secret is never logged or returned;
  - onion → the gate stays in platform; only the composition root reads env.
- **Risk:** medium. This is the trust boundary of every `/api/*` request.

### W7 — `GET /api/health` (P3)
- **Serves:** AC-5, AC-6.
- **Do:**
  - `server/src/health/ports.ts`: `export interface ReadinessProbe { check(timeoutMs: number): Promise<boolean> }` — true when DB **and** Redis answered within `timeoutMs`.
  - `server/src/adapters/readiness.ts`: `createReadinessProbe({ payload, fast })`.
    - DB: through the lazy Payload accessor, run `select 1` on its pool (`payload.db.pool.query('select 1')`). Use the same unsafe-cast pattern as `guardPool` (`container.ts:93-99`).
    - Redis: `fast.get('health:probe')`.
    - Both run in parallel, raced against one `setTimeout(timeoutMs)`. Any throw or timeout → false. Never rethrow and never log error text.
  - `container.ts`:
    - `const READINESS_KEY = Symbol.for('t2f.readiness')`, defined in `createDeps` like `CATALOG_STORE_KEY` (`:156`);
    - `export function readinessOf(deps)`, a copy of the `catalogStoreOf` shape (`:168-173`).
  - `server/src/endpoints/health.ts`: `healthRoute` `{ key: 'health', method: 'GET', path: '/api/health' }`. The handler:
    - loads `readinessOf` by dynamic import (as `catalog.ts:15`);
    - ok → `200 {"ok":true,"commit":<T2F_COMMIT ?? '0'.repeat(40)>}`;
    - else → `503 {"ok":false}`;
    - headers `Cache-Control: private, no-store` and JSON content type;
    - no `needs`, no `rateLimit`, no envelope.
  - `registries/routes.ts`: `[catalogRoute, healthRoute, timeRoute]`, sorted.
  - `server/test/integration/health.int.test.ts`:
    - `testDeps` with `T2F_COMMIT=<40 hex>` → 200, the exact body, the header;
    - `REDIS_URL` pointing at a closed loopback port → 503 with body exactly `{"ok":false}` within ≤ 3 s;
    - class `test` with `T2F_EDGE_SECRET` set and no header → the single 404.
  - Extend `edge-rotation.int.test.ts` with `/api/health` for both secrets.
- **Files:** `server/src/health/ports.ts`, `server/src/adapters/readiness.ts`, `server/src/endpoints/health.ts`, `server/src/registries/routes.ts`, `server/src/container.ts`, `server/test/integration/health.int.test.ts`, `server/test/integration/edge-rotation.int.test.ts`.
- **Done means:** both integration files are green and `server.files` is green.
- **Verify:** server.files; server.int `health.int.test.ts`; server.int `edge-rotation.int.test.ts`.
- **Rules that apply:**
  - onion → the route reaches a ring-2 port through the root (ban 1: no `pg`/Payload import in the route); the adapter is ring 4; the port is justified because it crosses process boundaries and a test substitutes it;
  - security → A10: no host names or error text in the body; A09: no error text logged;
  - contract-conformance → operational route, outside web contracts (see Contract changes).
- **Risk:** medium.
  - The first call after boot initialises Payload lazily and may exceed 2 s → 503. The deploy health wait polls for 60 s, so a slow first answer is tolerated.
  - The 2-second cap is a timer, not the injected `Clock` (I/O timeout, not business time).

### W8 — Listen address, image start, health probe (P3)
- **Serves:** AC-1 (start without git; `commit`), AC-2; enables AC-4, AC-13, AC-54.
- **Do:**
  - `server/scripts/lib/listen.mjs`: `listenAddress(env)`.
    - Class `test` (exact `T2F_ENV==='test'`) → `{ host: '127.0.0.1', port: Number(T2F_SERVER_PORT) }`.
    - Otherwise both `T2F_HOST` (validated by the W4 regex) and `T2F_SERVER_PORT` (1–65535) are required. A failure → `{ failing: [names] }`.
  - `server/scripts/image-start.mjs`: the container `CMD`. It:
    - reads `process.env` and calls `listenAddress`;
    - on failure prints `env: invalid <names>` and exits 1;
    - in a non-test class requires `T2F_COMMIT` (40 hex), else exits 1 naming it;
    - spawns `process.execPath node_modules/next/dist/bin/next start -p <port> -H <host>` with `shell:false`, `cwd` = `server/`;
    - forwards SIGINT/SIGTERM and exits with the child's code;
    - never calls `resolveWorktree`, git or pnpm. Env validation itself is done by `instrumentation.ts` on boot, which exits 1 naming variables.
  - `server/scripts/health-probe.mjs`: `node scripts/health-probe.mjs [--url <u>] [--secret current|none|wrong] [--raw]`.
    - Default URL `http://127.0.0.1:${T2F_SERVER_PORT}/api/health`; default `--secret current` takes `T2F_EDGE_SECRET` **from its own environment**. `wrong` = 32 random bytes.
    - It prints `<status> <commit|->`, or with `--raw` status + sorted headers + body.
    - Exit 0 only on 200.
    - The URL must be `http://` to a single-label host or loopback; otherwise exit 2.
  - `server/test/unit/listen.test.ts`:
    - test class → loopback whatever `T2F_HOST` says;
    - rehearsal `0.0.0.0:3000` → ok;
    - missing or bad `T2F_HOST` → failing `T2F_HOST`;
    - no `.git` lookup: grep `image-start.mjs` for `worktree|git|pnpm` → none.
- **Files:** `server/scripts/lib/listen.mjs`, `server/scripts/image-start.mjs`, `server/scripts/health-probe.mjs`, `server/test/unit/listen.test.ts`.
- **Done means:** the unit test is green, and tsc (server tsconfig includes `scripts/**/*.mjs` if it already does — otherwise JSDoc only) is clean.
- **Verify:** server.files on the 4 files.
- **Rules that apply:**
  - security → A05 command injection: `shell:false`, fixed argv;
  - A09: the probe never prints the secret.
- **Risk:** low.

### W9 — Server image (P3)
- **Serves:** AC-1.
- **Do:**
  - `server/Dockerfile`, multi-stage.
    - Base `node:22-bookworm-slim@sha256:<digest>`. Resolve the digest with `docker buildx imagetools inspect node:22-bookworm-slim` and comment the tag next to it.
    - `ARG T2F_COMMIT` (required; build fails on a non-40-hex value via a `RUN` test).
    - `npm install -g pnpm@12.4.2` (as `verify.yml:44`).
    - Copy the workspace manifests (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, every workspace `package.json`), then `pnpm install --frozen-lockfile --filter @time2fest/server...`, then copy `server/` and `packages/contracts/`.
    - `pnpm --dir server build`. If `next build` needs env, set **build-stage-only** placeholders in that one `RUN`: class `test`, loopback `DATABASE_URI` with DB `t2f_build`, `REDIS_URL`, `T2F_REDIS_PREFIX=t2f:build:`, a fixed 32-char non-secret `PAYLOAD_SECRET` marked `build-only placeholder`. Never `ENV` them in the runtime stage.
    - Runtime stage keeps `node_modules` **with devDependencies** (`tsx` and the Payload CLI run `pnpm migrate` in the one-shot container; Assumption A1).
    - `ENV NODE_ENV=production T2F_COMMIT=$T2F_COMMIT`; `LABEL org.opencontainers.image.revision=$T2F_COMMIT`; `USER node`; `WORKDIR /app/server`; `CMD ["node","scripts/image-start.mjs"]`; no `EXPOSE`.
  - `server/Dockerfile.dockerignore`: `**/.git`, `.git`, `**/node_modules`, `**/.next*`, `out*`, `**/.local`, `**/.env*` (except `*.example`), `.claude`, `docs`, `research_data`, `graphify-out`, `tests`, `**/test-results`.
- **Files:** `server/Dockerfile`, `server/Dockerfile.dockerignore`.
- **Done means:** the HEAVY directory-context build succeeds. Then `docker run --rm --entrypoint sh t2f-server:p3check -c 'test ! -e /app/.git && test ! -e /app/server/.git && echo no-git'` prints `no-git`, and `docker image inspect` shows the label. After that, `docker image rm t2f-server:p3check`.
- **Verify:** HEAVY `docker build -f server/Dockerfile --build-arg T2F_COMMIT=0123456789abcdef0123456789abcdef01234567 -t t2f-server:p3check .` (log to file, tail), then the `docker run` check above.
- **Rules that apply:**
  - security → A02/A03: base image by digest, non-root, no secret in any layer or `ARG`, minimal context.
- **Risk:** high (build-only failures; see Contract changes (a)). The first build is slow. If `next build` fails only inside Docker, compare with a local `pnpm --dir server build` under the same lock before changing anything.

### W10 — Node Compose project and realtime profile (P4)
- **Serves:** AC-3, AC-4 (static), AC-7 (unit), AC-49 (profile), AC-50 (profile).
- **Do:**
  - `infra/ops/node/compose.yml` (no top-level `name`; the project comes from `-p`):
    - `postgres` (`postgres:17.12-alpine@sha256:<digest>`; `env_file: postgres.env`; volume `pgdata`; healthcheck `pg_isready`; `mem_limit 1g`);
    - `redis` (`redis:7.4.12-alpine@sha256:<digest>`; healthcheck `redis-cli ping`; `mem_limit 256m`);
    - `server`:
      - `image: t2f-server:${T2F_SERVER_SHA:?set by ops}`;
      - `env_file: server.env`;
      - `environment` fixes `T2F_ENV: ${T2F_ENV:?}`, `T2F_HOST: 0.0.0.0`, `T2F_SERVER_PORT: "3000"` (compose `environment` wins over `env_file`);
      - `mem_limit 1536m`;
      - networks `backend` + `egress`;
    - `cloudflared` (`cloudflare/cloudflared@sha256:<digest>`, `command: tunnel --no-autoupdate run`, `env_file: cloudflared.env`, networks `backend` + `egress`, `mem_limit 128m`).
    - Every service has `restart: unless-stopped` and **no `ports`**.
    - Networks: `backend: { internal: true }` and `egress: {}`. `postgres` and `redis` are on `backend` only.
  - `infra/ops/node/compose.realtime.yml`: only `cloudflared` (same digest, `restart: unless-stopped`, no ports).
  - Resolve digests with `docker buildx imagetools inspect <tag>` (index digest) and put the tag in a comment.
  - `infra/ops/test/compose.test.mjs` (text parse, no YAML library):
    - no `ports:` key anywhere;
    - each `image:` other than `t2f-server:` contains `@sha256:` + 64 hex;
    - each service has `restart: unless-stopped`;
    - the service set equals `{postgres, redis, server, cloudflared}`;
    - `server` is not on any network that has no `internal: true`, except `egress`;
    - `postgres`/`redis` only on `backend`;
    - the realtime file has exactly one service, `cloudflared`, and no `server`.
- **Files:** `infra/ops/node/compose.yml`, `infra/ops/node/compose.realtime.yml`, `infra/ops/test/compose.test.mjs`.
- **Done means:** the test is green, and `docker compose -f infra/ops/node/compose.yml config -q` with dummy `T2F_SERVER_SHA`/`T2F_ENV` env and empty env files in a temp dir exits 0.
- **Verify:** ops.files on the test; that `docker compose config` call.
- **Rules that apply:** security → A02 (no published port; internal network); A03 (digest pins).
- **Risk:** low.

### W11 — Node env examples (P4)
- **Serves:** AC-40.
- **Do:**
  - `infra/ops/node/server.env.example`: every registry variable whose `requiredIn` contains `rehearsal` or `production` (post-SPEC-04: `T2F_ACCESS_AUD`, `T2F_ACCESS_JWKS_URL`, `T2F_ACCESS_TEAM_DOMAIN`, `T2F_ADMIN_HOST`, `T2F_OWNER_EMAILS`, `T2F_R2_*` ×5, `T2F_EDGE_SECRET`, `T2F_ALLOWED_ORIGINS`) plus the always-required `DATABASE_URI`, `REDIS_URL`, `PAYLOAD_SECRET`, plus `T2F_REDIS_PREFIX` and `T2F_EDGE_SECRET_PREVIOUS`. Each line `NAME=` with an empty value and a comment header «names only; values in `.local`/node».
  - `postgres.env.example`: `POSTGRES_USER=`, `POSTGRES_DB=`, `POSTGRES_PASSWORD=`.
  - `cloudflared.env.example`: `TUNNEL_TOKEN=`.
  - None of the examples contains `T2F_ENV`, `T2F_HOST`, `T2F_SERVER_PORT` or `T2F_COMMIT`: compose and the image set them, and an empty line would override the image `ENV`.
  - `infra/ops/test/env-example.test.mjs`:
    - load the registry by dynamic `import(pathToFileURL('../../server/src/registries/env.ts'))` (vitest transforms TS; tsc sees `any`);
    - collect names with `requiredIn` ∩ {rehearsal, production} plus vars with no `.optional()` (`DATABASE_URI`, `REDIS_URL`, `PAYLOAD_SECRET`; detect with `schema.safeParse(undefined).success === false`);
    - fail on each name missing from the example, and on any line with a non-empty value;
    - fail if one of the four compose-owned names is present.
- **Files:** `infra/ops/node/{server,postgres,cloudflared}.env.example`, `infra/ops/test/env-example.test.mjs`.
- **Done means:** the test is green. Adding a required variable to the registry in a scratch copy would turn it red (shown by an assertion on a synthetic block in the same test).
- **Verify:** ops.files on the test.
- **Rules that apply:** security → names only, no values (check-secrets would flag values).
- **Risk:** low.

### W12 — Deploy workflow (P4)
- **Serves:** AC-42.
- **Do:** `.github/workflows/deploy.yml`:
  - `name: deploy`;
  - `on: workflow_dispatch: inputs: env: { type: choice, options: [rehearsal], required: true }`;
  - `permissions: contents: read`;
  - `concurrency: { group: deploy-${{ inputs.env }}, cancel-in-progress: false }`;
  - one job, `ubuntu-latest`, `timeout-minutes: 45`. Steps:
    - `actions/checkout@<40-hex SHA> # vX.Y.Z` with `persist-credentials: false` and `fetch-depth: 0`;
    - `actions/setup-node@<SHA> # vX.Y.Z` (node 22). Resolve the SHAs with `git ls-remote --tags https://github.com/actions/checkout` / `…/setup-node` for the same majors as `verify.yml` (v6, v7);
    - `npm install -g pnpm@12.4.2`, `pnpm install --frozen-lockfile`;
    - SSH material from secrets written with `umask 077` into `$RUNNER_TEMP`: `T2F_REHEARSAL_SSH_KEY` → key file, `T2F_REHEARSAL_KNOWN_HOSTS` → known_hosts;
    - deploy step with `env:` `T2F_DEPLOY_ENV: ${{ inputs.env }}`, `T2F_REHEARSAL_HOST: ${{ secrets.T2F_REHEARSAL_HOST }}`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `T2F_SSH_KEY_FILE`, `T2F_KNOWN_HOSTS_FILE`, `T2F_CATALOG_URL: https://rehearsal.time2fest.com`, and `run: pnpm deploy:env -- --env "$T2F_DEPLOY_ENV" --target "$T2F_REHEARSAL_HOST"`.
  - No `${{ }}` inside any `run:`.
  - `infra/ops/test/workflow.test.mjs` (text):
    - the only trigger is `workflow_dispatch`, with no `pull_request_target`, `push` or `schedule`;
    - the `env` input is `type: choice` and the options list is exactly `[rehearsal]`;
    - every `uses:` matches `@[0-9a-f]{40}`;
    - every `${{ secrets.X }}` sits under an `env:` key;
    - no `run:` line contains `${{`;
    - a `run:` contains `pnpm deploy:env`.
- **Files:** `.github/workflows/deploy.yml`, `infra/ops/test/workflow.test.mjs`.
- **Done means:** the test is green.
- **Verify:** ops.files on the test.
- **Rules that apply:** security → CI: script-injection pattern (inputs via `env:`), least `permissions`, pinned actions, secrets by name.
- **Risk:** low. The live run is out of the wave.

### W13 — Arguments, config and guards (P5)
- **Serves:** AC-10, AC-21 (ops), AC-22, AC-23.
- **Do:**
  - `infra/ops/lib/config.mjs`:
    - `ENVS`:
      - `rehearsal`: `siteHost: 'rehearsal.time2fest.com'`, `workerEnv: 'rehearsal'`, `serverSteps: true`, `nodeDir: '/srv/t2f/rehearsal'`, `project: 't2f-rehearsal'`, `localProject: 't2f-node-rehearsal'`, `distDir: 'out-edge-rehearsal'`, `buildEnv: { NEXT_PUBLIC_ENV: 'test', NEXT_PUBLIC_API_MODE: 'http' }`;
      - `prelaunch`: `workerEnv: 'prelaunch'`, `serverSteps: false`, `mainDomain: true`;
      - `production`: `serverSteps: true`, `mainDomain: true`, `freeze: true`, `nodeDir: '/srv/t2f/production'`.
    - `MAIN_HOSTS` (same list as `infra/cloudflare/lib/config.mjs:5`); `FORBIDDEN_TARGETS = ['178.20.157.85']`; `SECRET_ENV_NAMES`.
  - `lib/args.mjs` `parseArgs(sub, argv)` validates before anything runs:
    - `--env` must be in `ENVS` (the allowed set depends on the subcommand);
    - `--commit` must match `^[0-9a-f]{7,40}$`; existence is checked by `git.mjs` (W15);
    - `--target` is `local`, IPv4 (`net.isIPv4`) or an RFC-1123 host name ≤253 chars;
    - `--to` must match `^[0-9a-f]{40}$`;
    - `--confirm` must be in `ENVS`; `--size` must match `^[a-z0-9-]{1,40}$`;
    - unknown flags and duplicates are refused.
    - Any failure → `{ code: 2, message }` naming the flag, never echoing the value back if it contains control characters.
  - `lib/guard.mjs` `guardRun({ sub, env, target, flags, now })`, exit 2 on:
    - `FORBIDDEN_TARGETS` whatever the flags (AC-22);
    - `ENVS[env].mainDomain` or `target ∈ MAIN_HOSTS` without **both** `--confirm <env>` and `--allow-main-domain` (AC-21);
    - `ENVS[env].freeze` and `now` in `[Dec 31 08:00:00Z, Jan 1 14:00:00Z)` of the matching year without `--emergency` (AC-23; deploy and rollback only).
  - Tests:
    - `test/args.test.mjs`: each of `;`, `$(id)`, a space, a backtick, a newline and an unknown env → 2, and the injected fake executor recorded 0 calls (wire through `main(argv, { exec })`);
    - `test/guard.test.mjs`:
      - prelaunch/production/`time2fest.com`/`www`/`admin` with no flag, with only one flag → 2, and 0 SSH/wrangler calls;
      - `178.20.157.85` with both flags → 2;
      - clock `…-12-31T08:00:00Z`, `…-01-01T13:59:59Z` → 2; `14:00:00Z` → allowed; `--emergency` → allowed.
- **Files:** `infra/ops/lib/{config,args,guard}.mjs`, `infra/ops/test/{args,guard}.test.mjs`, `infra/ops/ops.mjs`.
- **Done means:** both tests are green.
- **Verify:** ops.files on the 6 files.
- **Rules that apply:** security → A05 (allow-list validation before use), A01 (deny by default).
- **Risk:** medium.

### W14 — Command runner, transports, quoting, redaction (P5)
- **Serves:** AC-10 (nothing in a shell line), NFR-4; enables every remote step.
- **Do:** `infra/ops/lib/exec.mjs`.
  - `run(file, args, { input?: string|Readable, stdout?: Writable, timeoutMs?, env? })` → `{ code, stdout, stderr }`. It always spawns with `shell:false`. `.cmd` shims are never spawned: Node tools run as `process.execPath <js>` (wrangler `node_modules/wrangler/bin/wrangler.js`, next `node_modules/next/dist/bin/next`), as `workers/edge/scripts/deploy.mjs:31` does.
  - `localTransport()` and `sshTransport({ host, user, keyFile?, knownHostsFile, accept?: 'strict'|'new' })`. Both expose `exec(argv: string[], opts)`.
    - The SSH transport builds `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes|accept-new -o UserKnownHostsFile=<file> -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4 [-i <key>] <user>@<host> -- <remote>`.
    - `<remote>` = `argv.map(shq).join(' ')`, where `shq` single-quotes every element (`'` → `'\''`).
    - Every argv element must also pass a per-call allow-list (env names, 40-hex SHAs, fixed paths from config). An element with a newline or NUL → throw before spawning.
  - `lib/redact.mjs`: `createRedactor(values)`. It masks every registered value (≥ 8 chars) and its base64url/hex forms in every line written to stdout, stderr or a journal. Every output path of ops goes through `out()`/`err()` created by `main`, as in `cf.mjs:67-71`.
  - `test/support/fakeExec.mjs`: records `{ transport, argv, inputLength }` (never the input bytes) and returns scripted results by matcher.
  - `test/exec.test.mjs`:
    - `shq` round-trips `a'b`, `$(x)`, spaces;
    - an element with `\n` throws and spawns nothing;
    - a sentinel secret in child stdout/stderr is masked in `out`;
    - the local transport runs `node -e` and returns its code.
- **Files:** `infra/ops/lib/{exec,redact}.mjs`, `infra/ops/test/exec.test.mjs`, `infra/ops/test/support/fakeExec.mjs`.
- **Done means:** the test is green.
- **Verify:** ops.files on the 4 files.
- **Rules that apply:** security → A05 command injection (`execFile` semantics, quoting), A09 (redaction), host-key pinning.
- **Risk:** medium. Windows: `ssh.exe`, `docker.exe` and `git.exe` must be on `PATH`. Paths with backslashes are only ever local argv, never remote. Read child output with `/\r?\n/`.

### W15 — Git: clean tree, commit, archive (P6)
- **Serves:** AC-11, AC-10 (`--commit` must be a commit), AC-1 (build from the commit).
- **Do:** `infra/ops/lib/git.mjs`:
  - `assertClean()` runs `git status --porcelain=v1 -z`; any entry → `{ code: 2, message: 'робоче дерево має незакомічені зміни' }`;
  - `resolveCommit(sha?)` runs `git rev-parse --verify <sha|HEAD>^{commit}`; not a commit → 2; returns the 40-hex SHA;
  - `archive(sha)` returns the stdout stream of `git archive --format=tar <sha>`.
  - `test/git.test.mjs` uses fake exec: a modified file → refusal and 0 build calls; an unknown SHA → 2.
- **Files:** `infra/ops/lib/git.mjs`, `infra/ops/test/git.test.mjs`.
- **Done means:** the test is green.
- **Verify:** ops.files.
- **Rules that apply:** security → argv only.
- **Risk:** low.

### W16 — Deploy journal and node lock (P6)
- **Serves:** AC-15, AC-17; enables AC-24, AC-26, AC-27.
- **Do:**
  - `infra/ops/lib/journal.mjs`: JSON Lines at `<nodeDir>/journal.jsonl`. On a remote node, append through the transport with argv `['sh','-c','cat >> "$1"','_',<path>]` and the line on stdin; locally with `fs.appendFileSync`. Records:
    - `{ kind:'step', at, env, commit, step, status, ms }`;
    - `{ kind:'deploy'|'rollback', at, env, commit, imageBefore, imageAfter, workerVersionBefore, workerVersionAfter, edgeSecretGeneration, result: 'ok'|'failed'|'worker-failed'|'rolled-back', failedStep, downtimeSeconds? }`;
    - `{ kind:'edge-secret', at, env, generation }`.
  - Readers:
    - `lastOk(records, env)`;
    - `currentGeneration(records, env)` = max `generation`, default 1;
    - `deployedShas(records, env)` (most recent first).
  - Every record passes the redactor before writing. A record carrying a value from `SECRET_ENV_NAMES` → throw (defence in depth).
  - `lib/lock.mjs` `acquireNodeLock(transport, env)` → `{ release }` or `{ code: 2, message: 'замок deploy-<env> зайнятий' }`. It refuses immediately and never waits.
    - Remote: a holder child `ssh … flock -n -E 75 <nodeDir>/deploy.lock sh -c 'echo locked; exec cat'`. The lock is held while the child's stdin stays open. Exit 75 → busy. The lock is released by closing stdin, and automatically when the connection drops (EC-2).
    - Local: `fs.mkdirSync(<stateDir>/deploy.lock)` (atomic) plus `owner.json` `{ pid, at }`. A holder whose pid is dead (`process.kill(pid, 0)` throws) is taken over. Released in `finally` and on SIGINT/SIGTERM.
  - Tests:
    - `test/journal.test.mjs`: each AC-15 field is present; a sentinel secret in a record never reaches the written line; generation and `lastOk` logic;
    - `test/lock.test.mjs`: two `acquireNodeLock` calls on the local state dir → the second gets code 2 naming `deploy-rehearsal`; a dead-pid takeover; the remote holder argv equals the fixed form.
- **Files:** `infra/ops/lib/{journal,lock}.mjs`, `infra/ops/test/{journal,lock}.test.mjs`.
- **Done means:** both tests are green.
- **Verify:** ops.files on the 4 files.
- **Rules that apply:** security → A09 (no secret in the journal), fail closed on the lock.
- **Risk:** medium.

### W17 — Downtime probe (P6)
- **Serves:** AC-53; enables NFR-2, NFR-3.
- **Do:** `infra/ops/lib/probe.mjs` `startProbe({ url | check, clock, every: 1000, fetch })` → `{ stop(): { downtimeSeconds, samples } }`.
  - Every second it does one GET with a 2-second timeout. Success = HTTP 200.
  - Downtime = the sum over failure runs of `(first success after the run) − (last success before it)` in whole seconds, rounded up. A run still open at `stop()` counts up to `stop`.
  - URL form `https://<siteHost>/api/health`. The `check` form is used for the local target (W18 exec probe).
  - `test/probe.test.mjs`: fake clock and answers 200, 503, 503, 200 at 1-second ticks → 2 s; all 200 → 0.
- **Files:** `infra/ops/lib/probe.mjs`, `infra/ops/test/probe.test.mjs`.
- **Done means:** the test is green.
- **Verify:** ops.files.
- **Rules that apply:** —
- **Risk:** low.

### W18 — Image and node operations (P7)
- **Serves:** AC-1, AC-16, AC-18; enables AC-9, AC-12, AC-13, AC-24.
- **Do:** two modules.
  - `infra/ops/lib/image.mjs`:
    - `buildImage(sha)`: skipped when `docker image inspect t2f-server:<sha>` succeeds. Otherwise it pipes `git archive <sha>` into `docker build -f server/Dockerfile --build-arg T2F_COMMIT=<sha> -t t2f-server:<sha> -` (tar context on stdin). The fallback, if BuildKit rejects `-f` with a stdin context: extract into an `os.tmpdir()` folder with `tar -xf -` and build that folder.
    - `deliver(transport, sha)`: skipped when the node already has the tag. Otherwise `docker save t2f-server:<sha>` → `zlib.createGzip()` → `transport.exec(['docker','load'], { input })`. `docker load` reads gzip. The same code path serves the local target.
    - `retain(transport, keepShas)`: lists `docker image ls t2f-server --format {{.Tag}}` and removes every tag not in `keepShas`. `keepShas` = current ∪ previous ∪ the 3 most recent `deployedShas`.
  - `infra/ops/lib/node.mjs`:
    - `freeBytes(transport)`: remote `df -Pk /var/lib/docker`; local `docker run --rm --entrypoint df <pinned postgres image> -Pk /` (Docker Desktop VM disk). Free < 5 × 1024³ → `{ code: 2 }` before delivery.
    - `uploadCompose(transport, nodeDir)`: `compose.yml` from the commit's tree via `git show <sha>:infra/ops/node/compose.yml`, written with `sh -c 'cat > "$1.tmp" && mv "$1.tmp" "$1"'`. Local: copy.
    - `compose(transport, project, nodeDir, args)`: `docker compose -p <project> -f <nodeDir>/compose.yml --env-file <nodeDir>/current.env <args>`. `current.env` holds only `T2F_ENV=` and `T2F_SERVER_SHA=`. It is written by `setCurrent(sha)` after a successful swap and is never the node env file.
    - `migrate(sha)`: `compose run --rm --no-deps -e T2F_SERVER_SHA … server pnpm migrate`. Postgres is brought up first with `compose up -d --wait postgres redis`.
    - `swap(sha)`: `compose up -d --no-deps --force-recreate server`, with `T2F_SERVER_SHA` passed via a temp `--env-file` for the call.
    - `waitHealthy(sha, 60_000)`: polls `compose exec -T server node scripts/health-probe.mjs` every second until it prints `200 <sha>`.
    - Cloudflared is started (`up -d cloudflared`) only when `cloudflared.env` has a non-empty `TUNNEL_TOKEN`. Locally, read the file without printing; remotely, `grep -q '^TUNNEL_TOKEN=.' <file>`.
  - Tests:
    - `test/image.test.mjs`: a fake disk report of 4.9 GB → refusal and 0 `docker load`; retention with 5 SHAs keeps 3 + current + previous;
    - `test/node.test.mjs`: the exact argv of each compose call; no argv contains `down`.
- **Files:** `infra/ops/lib/{image,node}.mjs`, `infra/ops/test/{image,node}.test.mjs`.
- **Done means:** both tests are green.
- **Verify:** ops.files on the 4 files.
- **Rules that apply:** security → A05 (argv only, remote paths from config), A02 (no `down -v`, never touch volumes).
- **Risk:** medium. Windows stream piping (`git archive` → `docker build -`) must use binary streams. Never `docker compose down` (`stack.mjs:4` rule).

### W19 — Worker operations (P7)
- **Serves:** AC-14, AC-20, AC-24 (Worker half), AC-31 (build step).
- **Do:** `infra/ops/lib/worker.mjs`. It runs `process.execPath <wrangler.js> <args> --env <workerEnv>` with `cwd` = `workers/edge` and `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` from the environment or `--secrets-file` (Assumption A6).
  - `currentVersion()`: `deployments status --json` → `versions[0].version_id`. A missing Worker → `null`.
  - `deploy()`: `deploy` → `currentVersion()`.
  - `rollback(versionId)`: `rollback <id> -m "t2f rollback" -y`.
  - `putSecret(name, value)`: `secret put <name>` with the value on stdin. Used **only** by `secrets.mjs` (W22/W23); `deploy.mjs` never imports it. A static test asserts this.
  - `buildSite(env)`: `process.execPath node_modules/next/dist/bin/next build` with `NEXT_PUBLIC_ENV=test`, `NEXT_PUBLIC_API_MODE=http`, `NEXT_DIST_DIR=out-edge-rehearsal`, `T2F_CATALOG_URL` (default `https://<siteHost>`). A test asserts these equal the `build:edge:rehearsal` script flags.
  - Prelaunch: no build. Refused when `out-prelaunch` is missing or empty.
  - `test/worker.test.mjs`: the argv of each call; `deployments status` JSON parsing (fixture); the value is passed only on stdin.
- **Files:** `infra/ops/lib/worker.mjs`, `infra/ops/test/worker.test.mjs`, `infra/ops/test/fixtures/deployments-status.json`.
- **Done means:** the test is green.
- **Verify:** ops.files on the 3 files.
- **Rules that apply:** security → secrets only on stdin (`cloudflare-notes.md` §11 row 8).
- **Risk:** medium.
  - wrangler 4.149.0 flags are confirmed from local `--help`: `rollback [version-id] -m -y`, `deployments status --json`.
  - In a non-TTY run, wrangler sets `override_existing_origin = true` for custom domains (`node_modules/wrangler/wrangler-dist/cli.js:164214-164217`). This is why AC-21's double flag guards prelaunch/production.

### W20 — Deploy orchestration (P7)
- **Serves:** AC-9, AC-11, AC-12, AC-13, AC-14, AC-18, AC-19, AC-20, AC-21 (prelaunch path), NFR-4.
- **Do:** `infra/ops/lib/deploy.mjs` `runDeploy(ctx)`, wired into `ops.mjs deploy`. Order:
  1. args (W13) → guard (W13) → `assertClean` + `resolveCommit` (W15) → transport (`local` → `localTransport` + state dir `infra/ops/.local/node-local-<env>/`; host → `sshTransport` as `deploy@<host>`, known_hosts from `T2F_KNOWN_HOSTS_FILE` or `infra/ops/.local/known_hosts`) → `acquireNodeLock` → `freeBytes` ≥ 5 GB;
  2. journalled steps, in this order: `build` → `deliver` → `migrate` → `swap` → `health` → `worker` (`buildSite` + `deploy`, or `deploy` only for prelaunch). Prelaunch runs only the `worker` step (`serverSteps: false`);
  3. on success: `setCurrent`, a `deploy` record (`result: ok`, `imageBefore` = the previous `current.env` SHA, versions before/after, `edgeSecretGeneration` from the journal), then `retain`;
  4. failure paths:
     - migrate fails → no swap, no Worker, record `failed` / `failedStep: 'migrate'`, message names «міграції», exit 1;
     - health timeout → `swap(previous)` and wait for its health, no Worker, record `failed`/`health`, exit 1;
     - Worker fails → keep the new server, `setCurrent(new)`, record `worker-failed`/`worker`, message names «Worker», exit 1;
  5. `--probe` starts W17 around steps `swap … worker`. URL form for hosts; the exec `check` form for `local`. `downtimeSeconds` goes into the record;
  6. release the lock in `finally`. Exit codes: 0 ok, 2 refusal before any change, 1 step failure.
  - Dependencies are injectable through `main(argv, deps)`: `exec`, `transport`, `worker`, `clock`, `out`.
  - `test/deploy.test.mjs` (all fakes):
    - the journal step order;
    - migrate failure → 0 swaps, 0 wrangler, code 1, `failedStep: 'migrate'`;
    - health timeout (fake clock) → swap back to the previous SHA, 0 wrangler;
    - wrangler failure → `worker-failed`, no swap back;
    - no recorded argv contains `migrate:down` or the token `down`;
    - no `secret put` in any run;
    - prelaunch with both flags → only `worker` (0 docker/ssh);
    - sentinel secrets in env and fake child output appear in no `out`/`err`/journal line (NFR-4).
- **Files:** `infra/ops/lib/deploy.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/deploy.test.mjs`.
- **Done means:** the test is green and ops `full` is green.
- **Verify:** ops.files on the 3 files; then ops `full`.
- **Rules that apply:** security → A10 (fail closed, release the lock), A09 (redaction).
- **Risk:** high. This is the orchestration that P12 proves on Docker.

### W21 — Rollback (P7)
- **Serves:** AC-24, AC-25, AC-26, AC-27, AC-19, NFR-4; enables NFR-1.
- **Do:** `infra/ops/lib/rollback.mjs` `runRollback(ctx)`, wired into `ops.mjs rollback`.
  1. args/guard → lock → read the journal.
  2. `rec = lastOk`. Refuse with exit 2 and no change when:
     - `rec` is missing, or `rec.workerVersionBefore` / the server target (`--to` or `rec.imageBefore`) is null;
     - the image `t2f-server:<target>` is absent on the node (AC-26);
     - `rec.edgeSecretGeneration < currentGeneration` → message «секрет краю замінено після цього розгортання; відкат Worker’а заборонено» (AC-27; Spec follow-up 3).
  3. Steps: `worker-rollback` (`worker.rollback(rec.workerVersionBefore)`) → `swap(target)` → `health` → `setCurrent(target)` → a `rollback` record (`result: rolled-back`, or `failed` with `failedStep`, EC-8).
     - No `migrate`, no write to `server.env`/`postgres.env`/`cloudflared.env` (AC-25).
     - The Worker step and the whole command are timed; seconds go into the record (NFR-1).
  4. `--probe` as in deploy.
  - `test/rollback.test.mjs`:
    - an empty journal → 0 wrangler and 0 docker calls, exit 2;
    - a missing image → the same;
    - generation 1 vs current 2 → refusal text contains `секрет краю`;
    - a normal run → `rollback <workerVersionBefore>` first, then a swap to `imageBefore`;
    - `--to` overrides the image;
    - no recorded argv has `migrate`; no env-file write;
    - sentinel check.
- **Files:** `infra/ops/lib/rollback.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/rollback.test.mjs`.
- **Done means:** the test is green and ops `full` is green.
- **Verify:** ops.files; ops `full`.
- **Rules that apply:** security → A10.
- **Risk:** medium.

### W22 — Generate rehearsal secrets and push node env files (P8)
- **Serves:** AC-38, NFR-4; enables S2 R2 (Spec follow-up 4).
- **Do:** `infra/ops/lib/secrets.mjs` `generate({ env, target? })`, wired to `ops.mjs edge-secret --env rehearsal --generate [--target <host|local>] [--secrets-file <f>]`. Only `rehearsal` is accepted, else 2.
  - Local files live in `infra/ops/.local/<env>/{server.env,postgres.env,cloudflared.env}`.
    - They are created from the W11 examples when missing, then written with `fs.writeFileSync(…, { mode: 0o600 })` + `fs.chmodSync(0o600)`.
    - On Windows, assert instead that `git check-ignore -q <path>` succeeds, and refuse otherwise.
  - Fill only **empty** values. Each one is `randomBytes(32).toString('base64url')` (43 chars):
    - `PAYLOAD_SECRET`, `T2F_EDGE_SECRET`, `POSTGRES_PASSWORD`;
    - derived `DATABASE_URI`, built with `new URL('postgres://postgres:5432/t2f_rehearsal')` and then `username`/`password` setters. Never a string literal of the form `postgres://u:p@` — that is a `check-secrets` pattern (`scripts/check-secrets.mjs:36`);
    - `REDIS_URL=redis://redis:6379/0`, `T2F_REDIS_PREFIX=t2f:rehearsal:`, `POSTGRES_USER=t2f`, `POSTGRES_DB=t2f_rehearsal`;
    - `TUNNEL_TOKEN` copied from `infra/cloudflare/.local/tunnel-rehearsal.env` when present.
  - Existing values are never regenerated (a Postgres password change after the DB was initialised would lock the server out).
  - When a target is given: push all three files through the transport — remote argv `['sh','-c','umask 077 && cat > "$1.tmp" && mv "$1.tmp" "$1"','_',<path>]` with the file on stdin; local target = copy into the state dir with mode 0600.
  - When the Worker secret is new: `worker.putSecret('T2F_EDGE_SECRET', value)` via stdin.
  - Output: names and «згенеровано / вже було / надіслано», never a value.
  - `test/secrets.test.mjs` (fake exec and fake worker; temp `.local`):
    - sentinel-free check: no generated value appears in any recorded argv, `out`, `err` or journal;
    - each value is ≥ 43 chars and differs from the others;
    - a second run generates nothing;
    - the mode is `0o600` on POSIX, or the `check-ignore` assertion on Windows;
    - `env` ≠ rehearsal → 2.
- **Files:** `infra/ops/lib/secrets.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/secrets.test.mjs`.
- **Done means:** the test is green.
- **Verify:** ops.files on the 3 files.
- **Rules that apply:** security → A04 (CSPRNG ≥ 32 bytes), A09/NFR-4 (stdin only), file permissions.
- **Risk:** medium.

### W23 — Edge-secret rotation (P8)
- **Serves:** AC-37, NFR-4.
- **Do:** `rotate({ env, target })` → `ops.mjs edge-secret --env rehearsal --rotate --target <host|local> [--probe]`, under the node lock (W16). Steps, each journalled:
  1. new = 32 random bytes. Server env file: `T2F_EDGE_SECRET_PREVIOUS=<old>`, `T2F_EDGE_SECRET=<new>`. Push, then `compose up -d --no-deps --force-recreate server`, then `waitHealthy`.
  2. `worker.putSecret('T2F_EDGE_SECRET', new)`.
  3. Check through the edge: host target → `GET https://<siteHost>/api/health` → 200; local target → the exec probe with the current secret → 200. A failure stops here (PREVIOUS stays, so both values keep working), exit 1.
  4. Remove `T2F_EDGE_SECRET_PREVIOUS`, push, recreate, `waitHealthy`.
  5. Append `{ kind: 'edge-secret', generation: current + 1 }` and update `.local/<env>/server.env`.
  - `test/rotate.test.mjs`:
    - the step order (1)…(4) exactly;
    - the generation increments;
    - a failure at (3) leaves PREVIOUS in the pushed file and does not run (4);
    - neither secret appears outside stdin.
- **Files:** `infra/ops/lib/secrets.mjs`, `infra/ops/test/rotate.test.mjs`.
- **Done means:** the test is green.
- **Verify:** ops.files.
- **Rules that apply:** security → A04, fail closed.
- **Risk:** medium.

### W24 — Node bootstrap (P8)
- **Serves:** AC-8; enables AC-49.
- **Do:** `infra/ops/lib/bootstrap.mjs` → `ops.mjs bootstrap --host <ipv4|name> [--env rehearsal]`. The host is validated by W13, and the forbidden target → 2.
  - The first contact uses `sshTransport` as `root` with `accept: 'new'` into `infra/ops/.local/known_hosts`, and prints the host key fingerprint (`ssh-keygen -lf`) for the owner to compare with the provider console.
  - Steps, each with a read-only «already done» check first (printed `без змін` when every check passes):
    1. user `deploy` (`id -u deploy` / `useradd -m -s /bin/bash deploy`; `install -d -m 700 -o deploy ~deploy/.ssh`; root's `authorized_keys` copied with mode 600);
    2. Docker from the Ubuntu archive (`docker --version` / `apt-get update && apt-get install -y docker.io docker-compose-v2`), `usermod -aG docker deploy`;
    3. `/srv/t2f/<env>`, owned by deploy, mode 700;
    4. firewall: `ufw default deny incoming`, `ufw default allow outgoing`, `ufw allow 22/tcp`, `ufw --force enable` (check: `ufw status verbose`);
    5. **verify that `ssh deploy@host true` works** with the same key — stop with exit 1 if not (lockout guard);
    6. sshd drop-in `/etc/ssh/sshd_config.d/00-t2f.conf`: `PermitRootLogin no`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, then `sshd -t && systemctl reload ssh`. This is the last step.
  - Rerun: root login refused → connect as `deploy`, check that `docker info` and `/srv/t2f/<env>` work, report `без змін` (root-only checks are reported as «перевірено при першому запуску; повторна перевірка — порт-скан R4»).
  - Remote commands are fixed strings in `bootstrap.mjs`. No user value enters them except the validated env name.
  - `test/bootstrap.test.mjs` (fake transport):
    - the step list and order;
    - step 6 never runs before the step-5 check passes;
    - with all checks already passing → 0 mutating commands and output `без змін`;
    - root refused on rerun → the deploy-user path.
- **Files:** `infra/ops/lib/bootstrap.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/bootstrap.test.mjs`.
- **Done means:** the test is green.
- **Verify:** ops.files on the 3 files.
- **Rules that apply:** security → A02 (no root/password SSH, default-deny firewall), host-key TOFU recorded, no `curl | sh`.
- **Risk:** medium. A lockout is possible on a real node if step order is wrong; the S2 runbook keeps the provider console open (R1).

### W25 — Provider interface, fake adapter, contract suite (P9)
- **Serves:** AC-45, NFR-5 (prices), AC-52 (scripted errors).
- **Do:**
  - `infra/ops/lib/capacity/provider.mjs`: JSDoc typedefs only.
    - `Provider { listNodes(tags: string[]): Promise<Node[]>; sizes(): Promise<Size[]>; createNode(spec): Promise<Node>; resizeNode(id, size): Promise<void>; deleteNode(id): Promise<void>; waitNode(id, state): Promise<Node> }`.
    - `Node { id, name, size, status: 'active'|'off'|'new', tags, publicIp }`.
    - `Size { slug, vcpus, memoryMb, diskGb, priceHourly }`.
    - The `ProviderError { status, retryAfterSec?, step }` class.
  - `lib/capacity/fake.mjs`: in-memory provider with tags, a size table with hourly prices from `research-providers.md:8-13`, scripted failures (`failOnCall(n, 429)`), and a call log. `resizeNode` records `{ size, disk: false }`.
  - `test/capacity/provider.contract.mjs`: `describeProvider(name, makeProvider)`:
    - list by tags returns only fully-tagged nodes;
    - create → appears active;
    - resize → size changed, disk unchanged;
    - delete → gone;
    - a scripted 429 → `ProviderError` with `status 429`;
    - sizes carry `priceHourly > 0`.
  - `test/capacity/fake.test.mjs` runs the suite on the fake.
- **Files:** `infra/ops/lib/capacity/{provider,fake}.mjs`, `infra/ops/test/capacity/{provider.contract.mjs,fake.test.mjs}`.
- **Done means:** the fake passes the suite.
- **Verify:** ops.files on the 4 files.
- **Rules that apply:** onion §2 (applied by analogy, unrouted) → a port with two implementations and test substitution.
- **Risk:** low.

### W26 — DigitalOcean adapter and recorded responses (P9)
- **Serves:** AC-45, AC-48 (CPU/RAM only).
- **Do:** `infra/ops/lib/capacity/digitalocean/adapter.mjs` + `config.mjs`.
  - Base `https://api.digitalocean.com`. `Authorization: Bearer $DIGITALOCEAN_TOKEN`. `DO_API_BASE` is honoured only for `http://127.0.0.1:<port>` (tests), as `infra/cloudflare/lib/api.mjs` does.
  - `listNodes`: `GET /v2/droplets?tag_name=t2f-managed&per_page=200`, following `links.pages.next`. One tag per call (filter the rest client-side).
  - `sizes`: `GET /v2/sizes?per_page=200` → `price_hourly`.
  - `createNode`: `POST /v2/droplets` `{ name, region, size, image: 'ubuntu-24-04-x64', ssh_keys: [<fingerprint from T2F_DO_SSH_KEY>], tags, ipv6: false, monitoring: false }` → 202. Then poll `GET /v2/droplets/{id}` until `status: active`.
  - `resizeNode`:
    - `POST /v2/droplets/{id}/actions` `{ type: 'shutdown' }`, poll, with a fallback to `{ type: 'power_off' }` after 60 s;
    - `{ type: 'resize', size, disk: false }` → 201, poll `GET /v2/droplets/{id}/actions/{action_id}` until `completed`/`errored`;
    - `{ type: 'power_on' }`, poll.
    - Power actions exist **only inside resize** (AC-49 forbids `power_off` for realtime removal).
  - `deleteNode`: `DELETE /v2/droplets/{id}` → 204.
  - A non-2xx response → `ProviderError { status, retryAfterSec from ratelimit-reset }`. The body `message` is never printed together with request data.
  - `config.mjs`: `ENV_SIZES` (sizes are provider-specific, so they live here):
    - `rehearsal: { region: 'fra1', main: { offSeason: 's-2vcpu-4gb', allowed: ['s-2vcpu-4gb', 's-4vcpu-8gb'] }, realtime: { size: 's-2vcpu-4gb' } }`;
    - `production: { region: 'fra1', main: { offSeason: 's-2vcpu-4gb', allowed: ['s-2vcpu-4gb', 's-4vcpu-8gb', 's-8vcpu-16gb'] }, realtime: { size: 'c-4' } }` — commented «SPEC-23 sets final night sizes».
    - The token scopes (for README and docs patch): `droplet:read/create/update/delete`, `actions:read`, `sizes:read`, `regions:read`, `tag:read`, `tag:create`, `ssh_key:read`, `image:read`, `vpc:read`.
  - `test/capacity/digitalocean.test.mjs` runs the W25 suite against a loopback HTTP server that replays `test/fixtures/do/*.json`. The fixtures are hand-written from the official OpenAPI (researcher 2026-11-17): list, sizes, create 202, action 201/completed, delete 204, 429 `{ id: 'too_many_requests' }` with `ratelimit-reset`.
  - Grep test: `droplet|digitalocean` (case-insensitive) occurs in no file under `infra/ops/lib` or `infra/ops/ops.mjs` outside `lib/capacity/digitalocean/`.
- **Files:** `infra/ops/lib/capacity/digitalocean/{adapter,config}.mjs`, `infra/ops/test/capacity/digitalocean.test.mjs`, `infra/ops/test/fixtures/do/*.json`.
- **Done means:** the suite and the grep test are green.
- **Verify:** ops.files on the touched files.
- **Rules that apply:**
  - security → token only from env, base-URL allow-list, the token never printed.
- **Risk:** medium. The fixtures are not real recordings (no token); the live shape is confirmed only in R7 (OQ-4).

### W27 — Capacity command (P9)
- **Serves:** AC-46, AC-47, AC-48, AC-49, AC-50, AC-51, AC-52, NFR-3, NFR-5.
- **Do:** `infra/ops/lib/capacity/capacity.mjs` → `ops.mjs capacity --env <rehearsal|production> <plan|night|back|off-season|realtime-create|realtime-delete|status> [--size <s>] [--confirm <env>] [--probe]`. The provider is chosen by `T2F_PROVIDER` (default `digitalocean`); tests inject `fake`.
  - Desired state per subcommand, computed from **observed** state, so a rerun skips steps already done (AC-52):
    - `night --size S` → main size S (S must be in `allowed`, else 2);
    - `back` → main `offSeason`;
    - `off-season` → main `offSeason` + no realtime node;
    - `realtime-create` → realtime node present;
    - `realtime-delete` → absent;
    - `plan` → inventory (nodes, sizes, `priceHourly`, allowed sizes);
    - `status` → drift against the off-season state, printed line by line, or «розбіжностей немає».
  - Nodes are selected only by tags `t2f-managed` + `t2f-env-<env>`, with role tags `t2f-role-main`/`t2f-role-realtime`. Any step on a node missing either required tag → refusal naming the node, 0 mutating calls (AC-47).
  - Steps and prices: every step that creates or enlarges a resource prints `$<priceHourly>/год` before execution (NFR-5).
    - Without `--confirm <env>` → print the plan and exit 0, with 0 mutating calls (AC-46).
    - With `--confirm`, execute in order. A `ProviderError` → stop, print `виконано: …` and the failed step, exit 1.
  - Main node: only `resizeNode` (vertical; AC-48, AC-50). There is no step that starts a server anywhere (AC-50).
  - Realtime: `createNode` with tags and role, then `bootstrap` (W24) against its public IP, then `compose.realtime.yml` uploaded to `/srv/t2f/<env>-realtime/` (not started: the realtime tunnel token belongs to П-RT). Removal is `deleteNode` only (AC-49).
  - Timing: resize downtime by `--probe` (W17), and create/delete durations in seconds. Both go to `infra/ops/.local/<env>/capacity.jsonl` and to stdout (NFR-3).
  - `test/capacity/capacity.test.mjs` (fake):
    - no `--confirm` → 0 mutating calls and a plan with a price per paid step;
    - an untagged node → refusal with its name, 0 deletes;
    - a size outside `allowed` → 2;
    - resize requests have `disk:false`;
    - `realtime-create`/`delete` → `create` + `delete`, `power_off` never called for realtime;
    - no plan contains a step that starts `server`;
    - a 429 on call 2 → stop, then the rerun executes only from step 2;
    - the fake with an enlarged main + realtime → `off-season` plan «зменшити, видалити», and after execution `status` → no drift.
- **Files:** `infra/ops/lib/capacity/capacity.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/capacity/capacity.test.mjs`.
- **Done means:** the test is green and ops `full` is green.
- **Verify:** ops.files; ops `full`.
- **Rules that apply:** security → A01 (act only on tagged resources), a confirm gate before cost.
- **Risk:** medium.

### W28 — `infra/cloudflare`: rehearsal env, admin host, all envs together (P10)
- **Serves:** AC-28, AC-29; enables AC-55, AC-56.
- **Do:**
  - `lib/config.mjs`:
    - add `ENVS.rehearsal = { siteHost: 'rehearsal.time2fest.com', tunnelHost: 'o-rehearsal.time2fest.com', tunnelName: 't2f-rehearsal', originService: 'http://server:3000', adminHost: 'admin-rehearsal.time2fest.com', underAttack: false }`, with the comment «origin = the `server` service in the node Compose network»;
    - widen the JSDoc type with `adminHost?: string`;
    - add `T2F_OWNER_EMAILS` to `SECRET_ENV_NAMES`.
  - `lib/desired.mjs`:
    - ingress per env = `[{hostname: tunnelHost, path: TUNNEL_PATH, service}, ...(adminHost ? [{hostname: adminHost, service}] : []), {service: 'http_status:404'}]`;
    - `dns` adds a proxied CNAME for `adminHost` to the same tunnel;
    - the block rule set stays `tunnelHosts` only (admin host excluded). Rule count is unchanged.
  - `cf.mjs`: the desired state is always `desiredState(Object.keys(ENVS), { underAttack: { [args.env]: args.underAttack } })`, so a whole-phase `PUT` keeps both envs. `--env` keeps selecting the tunnel-token file and the under-attack target.
  - `desiredState` accepts either a boolean (old callers in tests) or a per-env map.
  - `test/desired.test.mjs` adds:
    - with `['test','rehearsal']`: the rehearsal ingress has both host entries and ends with `http_status:404`;
    - the block-rule expression contains `o-rehearsal.time2fest.com` and not `admin-rehearsal…`;
    - the custom-rule count is 2 and the config-rule count is 3;
    - the test-env objects are byte-equal to `desiredState(['test'])`'s;
    - `cf.mjs plan --env test` builds both envs (fake API log shows rehearsal objects).
- **Files:** `infra/cloudflare/lib/{config,desired}.mjs`, `infra/cloudflare/cf.mjs`, `infra/cloudflare/test/desired.test.mjs`.
- **Done means:** infra `full` is green: the existing apply/guard/lock/plan tests plus the new cases.
- **Verify:** infra.files on the 4 files; infra `full`.
- **Rules that apply:** security → A01 (admin host open only behind Access + server JWT check `server/src/proxy.ts:1-8`), Free budget (custom rules 2/5 unchanged).
- **Risk:** medium. After this change, `apply --env test` also creates the rehearsal tunnel and DNS. This is intended (AC-28); L2 shows it in `plan` before `apply`.

### W29 — Access application flag (P10)
- **Serves:** AC-30; enables AC-56.
- **Do:** `infra/cloudflare/lib/access.mjs`.
  - `desiredAccess(env, emails)` → `{ name: 't2f-admin-<env>', domain: adminHost, type: 'self_hosted', session_duration: '24h', policies: [{ name: 't2f-owner-<env>', decision: 'allow', include: emails.map(email => ({ email: { email } })) }] }`.
  - Read: `GET /accounts/{a}/access/apps`, matched by `domain`. Changes `{ kind: 'access-app', op: 'create'|'update', hosts: [adminHost] }`. Apply: `POST` or `PUT /accounts/{a}/access/apps/{id}`. The `aud` from the response is printed (not a secret) for `T2F_ACCESS_AUD`.
  - `cf.mjs`: `--with-access` flag. Only with it are Access changes computed, and `T2F_OWNER_EMAILS` must be set in env (from `--secrets-file`, never git), else exit 1 naming it. Emails are printed only as a count.
  - `lib/guard.mjs`: add `'access-app'` to `KINDS` (one token on `:11`).
  - `test/access.test.mjs`:
    - without the flag → no access change in the plan and no `/access/` request in the fake log;
    - with the flag → the emails in the POST body equal the env value;
    - `git grep` of `infra/cloudflare` for the test email → only the test file;
    - the redactor masks the email list in output;
    - a host in `MAIN_HOSTS` → guard refusal.
- **Files:** `infra/cloudflare/lib/{access,guard}.mjs`, `infra/cloudflare/cf.mjs`, `infra/cloudflare/test/access.test.mjs`, `infra/cloudflare/test/support/fakeApi.mjs` (Access routes), `infra/cloudflare/README.md` (token permission «Access: Apps and Policies Edit»).
- **Done means:** infra `full` is green.
- **Verify:** infra.files; infra `full`.
- **Rules that apply:** security → A01, PII (emails) never in git or output.
- **Risk:** medium. The Access app body shape is checked only by the fake. The live call waits for OQ-2 (R2), and a field rejection stops `apply` by the existing API-refusal path.

### W30 — Edge deploy script: main-domain double flag (P10)
- **Serves:** AC-21 (edge part).
- **Do:** in `workers/edge/scripts/deploy.mjs`, after the `--confirm` check (`:68-71`), add: for `prelaunch` and `production` (their routes claim `time2fest.com`), `--allow-main-domain` must also be present, else write `needs --confirm <env> and --allow-main-domain` and return 2.
  - `workers/edge/test/deploy.test.ts`: prelaunch/production with neither flag, with only `--confirm`, with only `--allow-main-domain` → 2 and 0 spawns; with both → spawns `deploy`.
- **Files:** `workers/edge/scripts/deploy.mjs`, `workers/edge/test/deploy.test.ts`.
- **Done means:** the edge test is green.
- **Verify:** edge.files on the 2 files.
- **Rules that apply:** security → A01 deny by default.
- **Risk:** low.

### W31 — Domain move between Workers (P11)
- **Serves:** AC-33, AC-34, AC-53 (move gap).
- **Do:**
  - `infra/ops/edge-twin/worker.mjs`: `fetch()` → `new Response('t2f-edge-rehearsal-alt', { headers: { 'x-t2f-twin': '1', 'cache-control': 'no-store' } })`.
  - `infra/ops/lib/moveDomain.mjs` → `ops.mjs move-domain --name <host> --to <worker> [--confirm <env>] [--allow-main-domain] [--secrets-file <f>]`.
    - Allowed workers: `t2f-edge-rehearsal` (wrangler env `rehearsal`, config `workers/edge/wrangler.json`), `t2f-edge-rehearsal-alt` (twin; a generated wrangler config in `os.tmpdir()` with `name`, `main` = the absolute twin path, `compatibility_date` from `wrangler.json`, `workers_dev:false`, `preview_urls:false`, `routes: [{ pattern: <name>, custom_domain: true }]`), `t2f-edge-prelaunch`, `t2f-edge-production`. The last two need the W13 double flag.
    - Allowed names: `rehearsal.time2fest.com`, plus `MAIN_HOSTS` under the double flag.
    - The move is **a non-TTY `wrangler deploy` of the target Worker with that custom domain**; wrangler sets `override_existing_origin` (W19 Risk).
    - A probe (W17 URL form on `https://<name>/`, success = 200 from either Worker) runs from 5 s before to 30 s after the deploy and records the gap and which Worker answered (`x-t2f-twin` present or not).
    - Journal `infra/ops/.local/<env>/edge.jsonl` gets `{ kind: 'move-domain', at, name, from, to, gapSeconds, createdBinding: <domain id or null> }`.
  - `detach(name)`: the AC-34 fallback, used only when wrangler fails with a custom-domain conflict. It looks up the binding via `GET /accounts/{a}/workers/domains?hostname=<name>`. It deletes it (`DELETE /accounts/{a}/workers/domains/{id}`) **only** when `edge.jsonl` has a `createdBinding` with that id **and** `name` is not in `MAIN_HOSTS` (refused even with a record and with both flags). Otherwise exit 2.
  - `test/moveDomain.test.mjs`:
    - the generated twin config;
    - the argv of the twin deploy and of the return deploy;
    - the gap in the journal from a fake probe;
    - detach without a record → 2 and 0 DELETE;
    - `time2fest.com` with a record → 2;
    - `--to` unknown → 2.
- **Files:** `infra/ops/edge-twin/worker.mjs`, `infra/ops/lib/moveDomain.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/moveDomain.test.mjs`.
- **Done means:** the test is green and ops `full` is green.
- **Verify:** ops.files; ops `full`.
- **Rules that apply:** security → A01 (main domain never detached), token only from env.
- **Risk:** medium. The live behaviour is proven only in L2.

### W32 — Local-node integration suite, part 1 (P12)
- **Serves:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-9, AC-15, AC-16, AC-17 (integration evidence).
- **Do:** `infra/ops/test/node/deploy.int.test.mjs`. It calls `main(argv, deps)` in-process with the **real** local transport and Docker, and a **fake** `worker` (records calls, returns version ids `v1, v2 …`).
  - Compose project `t2f-node-rehearsal` (never `t2f`, no host ports); state dir in `os.tmpdir()`.
  - Env files are generated by `edge-secret --generate --target local` with the fake worker. Then placeholder Access/R2 values are written into the temp `server.env`: `T2F_ACCESS_TEAM_DOMAIN=https://t2f-local.cloudflareaccess.com`, JWKS URL under it, `T2F_ACCESS_AUD=local`, `T2F_ADMIN_HOST=admin-rehearsal.time2fest.com`, `T2F_OWNER_EMAILS=owner@example.com`, `T2F_R2_*` syntactic placeholders. None of them is contacted at boot.
  - The base image is built once from `HEAD` (`git rev-parse HEAD`). Derived images are built with a 2-line Dockerfile in a temp dir (`FROM t2f-server:<base>` + `ENV T2F_COMMIT=<synthetic sha>`) and tagged with synthetic 40-hex SHAs. No commits are created.
  - Cases:
    1. deploy base → journal steps in AC-9 order; the probe container on `t2f-node-rehearsal_backend` (`docker run --rm --network … --env-file <server.env> t2f-server:<sha> node scripts/health-probe.mjs --url http://server:3000/api/health`) → `200 <sha>`; with `--secret none` → status, headers and body equal to an unknown path (single 404); `docker compose exec server sh -c 'test ! -e /app/.git'` → 0 (AC-1, AC-2, AC-4, AC-5);
    2. `docker compose -p t2f-node-rehearsal port <svc> <port>` is empty for every service; a host connection to `127.0.0.1:3000` is refused (AC-3, AC-4);
    3. `docker compose stop redis` → the probe prints `503`, and `--raw` shows the body exactly `{"ok":false}`; then `start redis` (AC-6);
    4. five deploys of derived SHAs → `docker image ls t2f-server` holds exactly the last 3 plus nothing else outside current/previous (AC-16);
    5. two concurrent `main(['deploy',…])` → exactly one runs steps, the other returns 2 naming `deploy-rehearsal` (AC-17);
    6. every deploy record has all AC-15 fields, and the sentinel `PAYLOAD_SECRET` value (read from the temp file) does not appear in the journal (AC-15, NFR-4).
  - `afterAll`: `docker compose -p t2f-node-rehearsal stop` and `rm -f`, plus removal of the synthetic image tags. Volumes are removed **only** for this project (`docker volume rm t2f-node-rehearsal_pgdata`). Never `-p t2f`.
- **Files:** `infra/ops/test/node/deploy.int.test.mjs`, `infra/ops/test/node/support.mjs`.
- **Done means:** the file is green under the exclusive lock.
- **Verify:** HEAVY `node server/scripts/lock.mjs --mode exclusive -- node node_modules/vitest/vitest.mjs run -c infra/ops/vitest.node.config.mjs infra/ops/test/node/deploy.int.test.mjs`.
- **Rules that apply:** security → test env values are placeholders marked `// check-secrets: allow`.
- **Risk:** high.
  - First real Docker Desktop run of P7/P8 code; failures are orchestration bugs (fix in `lib/`, not in the test).
  - ≈4 GB RAM for the image build.

### W33 — Local-node integration suite, part 2 (P12)
- **Serves:** AC-12, AC-13, AC-24, AC-25, AC-37 (integration evidence).
- **Do:** `infra/ops/test/node/failure.int.test.mjs`, same harness.
  1. A derived image whose migrate fails: its `server/src/migrations/index.ts` is replaced by a module exporting one migration whose `up` throws. Deploy → exit 1, `failedStep: 'migrate'`, the probe still shows the previous SHA, 0 fake-worker calls (AC-12).
  2. A derived image with `ENV T2F_HOST="bad host"` → exit 1 within ≤ 90 s, health shows the previous SHA, 0 worker calls (AC-13).
  3. Deploy A, deploy B, then rollback:
     - the fake worker got `rollback v<A's after>` first;
     - health shows A;
     - `select count(*) from payload_migrations` (via `docker compose exec postgres psql`) and the sha256 of the node `server.env` are equal before and after (AC-24, AC-25).
  4. Rotation `edge-secret --rotate --target local` while a loop sends the old secret until the fake `putSecret` is called and the new one after → no 404 in any answer (503 or a refused connection during recreate is allowed); the generation in the journal = 2 (AC-37).
- **Files:** `infra/ops/test/node/failure.int.test.mjs`.
- **Done means:** the file is green under the exclusive lock.
- **Verify:** HEAVY, as W32 with this file.
- **Rules that apply:** —
- **Risk:** high (as W32).

### W34 — `infra/ops/README.md` (P13)
- **Serves:** AC-41 (in-repo half: names only), US-1/US-2 operability.
- **Do:** commands and flags (spec table `:380-387` plus `--secrets-file`, `--target local`), exit codes (0/1/2), node layout `/srv/t2f/<env>/…`, the local-node rules (project `t2f-node-<env>`, the exclusive lock, never `-p t2f`), the journal format, the DO token scopes (W26), the Cloudflare tokens, the rule «agents never see production values», and the order of S2 steps (pointer to this plan's runbook). Names only, no values.
- **Files:** `infra/ops/README.md`.
- **Done means:** `node scripts/check-secrets.mjs` (after `git add -N infra/ops/README.md`) → clean.
- **Verify:** that command.
- **Rules that apply:** security → names only.
- **Risk:** low.

### W35 — Docs patch (P13; outside the repo)
- **Serves:** AC-41; the contract-check docs row; spec Goal «порядок робочих секретів».
- **Do:** write `C:/Users/ADMIN/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/side-session-notes/local_359ad0f2-bcef-4e10-835b-0930d88a93eb/spec-13a/docs-patch.md` in Ukrainian with sections:
  1. the **full text of `docs/backend/secrets.md`**:
     - variables by class (names only) from the registry and W11;
     - who generates each and where it lives (node file 0600, Worker secrets, GitHub Actions secrets);
     - the owner's order for entering production secrets;
     - the edge-secret rotation order (AC-37 steps);
     - the note «зміна `PAYLOAD_SECRET` анулює ключі агентів» (SPEC-04 OQ-7);
     - the permissions of `DIGITALOCEAN_TOKEN` (W26 scopes), the R2 keys (bucket-scoped read/write) and the GitHub deploy key/secrets (W12 names);
     - the rule «агенти не бачать робочих значень»;
  2. the `frontend-seam.md` §3.11 row for `GET /api/health` (edge → server, operational, not in web contracts, 200/503/404);
  3. additions to `docs/backend/README.md` §6 (the new `pnpm` commands, the HEAVY/lock rule for deploy and the local-node suite);
  4. additions to `cloudflare-notes.md` (§2: a non-TTY wrangler moves a Custom Domain, `cli.js:164214`; §10: `deployments status --json`, `rollback <id> -m -y`; L2 results go here later);
  5. `docs/services/server.md`/`cloudflare.md` state lines (rehearsal tunnel, Worker, twin, Access pending OQ-2).
  - Placeholders `<L2: …>` / `<S2: …>` for numbers filled later by the wave lead.
- **Files:** that one file (outside the repo).
- **Done means:** the file exists with the 7 `secrets.md` points (each as its own heading or bullet), and a grep for the `scripts/check-secrets.mjs` patterns over it is empty.
- **Verify:** `node -e` grep of the file with the patterns of `scripts/check-secrets.mjs:27-36` → no hit.
- **Rules that apply:** security → Secret Detection.
- **Risk:** low.

### W36 — Integration pass (L1, wave lead)
- **Serves:** AC-43 (diff check), AC-41 (manual review), every S1 AC (final evidence).
- **Do:**
  1. `full` for `ops`, `server`, `infra`, `edge` (configs). `server full` needs `pnpm stack:up` + `pnpm db:create` + `pnpm --dir server migrate` first (fresh DB: migrate **before** `verify-schema`). Run `web full` once under the exclusive lock: it contains `next build` and `contract-surface --check`.
  2. HEAVY: both local-node files (W32, W33) once more on the final `HEAD`.
  3. `git diff master -- .claude/sdd-engineering.json` → exactly one added line (AC-43).
  4. `git add -A`, then `node scripts/check-secrets.mjs` → clean.
  5. `pnpm contracts:run --sim-only` → green.
  6. Check the docs patch against the 7 AC-41 points.
  7. Run `security-reviewer` (mandatory) and `architecture-reviewer` on the server files.
  8. At the end of the wave, add candidate gotchas to `docs/knowledge/gotchas.md` via `engineering-insights`:
     - a non-TTY wrangler overrides Custom Domains;
     - a `test`+`http` build needs `T2F_CATALOG_URL` after SPEC-04;
     - `postgres://u:p@` literals trip `check-secrets`;
     - compose `environment` beats `env_file`, and an empty env-file line overrides an image `ENV`;
     - the cloudflared image has no shell, so probe from a container on the same network.
- **Done means:** all exit 0 apart from pre-existing reds that also fail on `master` (name them), and the review findings HIGH/MEDIUM are fixed or accepted by the owner.

### W37 — Live Cloudflare, stage S1b (L2, wave lead)
- **Serves:** AC-24 (S1b), AC-28, AC-29, AC-31, AC-32, AC-33, AC-38 (S1b), NFR-1 (Worker part).
- **Do:** credentials only through a secrets file outside the repo, passed by path: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN_INFRA`. Heavy steps run under the exclusive lock.
  1. `pnpm infra:cf plan --env rehearsal --secrets-file <f>` → review that only rehearsal objects are created and test objects are unchanged. Then `apply --env rehearsal`, `apply` again → «без змін», and `plan --env test` → «без змін» (AC-28).
     - `curl -s -o /dev/null -w "%{http_code}" https://o-rehearsal.time2fest.com/api/time` → 403 (AC-29).
     - Journal line into the docs patch.
  2. `pnpm edge:secret -- --env rehearsal --generate --secrets-file <f>` (no target) → `.local/rehearsal/*.env` created. Then `node node_modules/wrangler/bin/wrangler.js secret list --env rehearsal` (cwd `workers/edge`) lists `T2F_EDGE_SECRET` (AC-38).
  3. Slot-26 dev server up and seeded (`pnpm stack`). Then `T2F_CATALOG_URL=http://127.0.0.1:4260 pnpm build:edge:rehearsal`, then `pnpm --dir workers/edge deploy:rehearsal -- --confirm rehearsal --secrets-file <f>` (with the `.local` secrets file for `T2F_EDGE_SECRET`). Check:
     - `/` → 200 `text/html`;
     - `https://t2f-edge-rehearsal.<account>.workers.dev/` → 404 (AC-31);
     - `/api/time` → 200, `now` within ±1 000 ms, the SPEC-05 AC-10 headers (AC-32).
  4. Worker rollback through the real command (local node + real Worker):
     - `T2F_CATALOG_URL=http://127.0.0.1:4260 pnpm deploy:env -- --env rehearsal --target local --secrets-file <f>` twice (same commit; image and delivery are skipped the second time; Worker versions differ);
     - then `pnpm rollback:env -- --env rehearsal --target local --secrets-file <f>`;
     - `wrangler deployments status --env rehearsal --json` shows the recorded `workerVersionBefore`. Record the Worker-step seconds (NFR-1 S1b, AC-24 S1b).
  5. `pnpm edge:move-domain -- --name rehearsal.time2fest.com --to t2f-edge-rehearsal-alt --secrets-file <f>` → the body is `t2f-edge-rehearsal-alt`. Then `--to t2f-edge-rehearsal` → the site is back. Copy both gaps from `.local/rehearsal/edge.jsonl` into the docs patch (AC-33). The twin stays (OQ-5).
  6. Stop the local node project (`docker compose -p t2f-node-rehearsal stop`).
- **Done means:** each listed AC has recorded evidence, or a named blocker (token permission, Cloudflare refusal).
- **Stop rule:** if step 5 leaves `rehearsal.time2fest.com` unbound or bound to the twin and the return fails twice, stop and report. Detach (AC-34) only through the command, never by hand.

## Execution
One lane, strictly sequential phases: one implementer at a time (`sdd-routing.md` §7). Each implementer phase is a fresh `sdd-engineering:implementer` dispatch with this plan's path and the phase id, and it touches only its phase's files. Every phase ends with a green targeted check for its package. The wave lead commits after each phase. Before P2, the wave lead brings up `pnpm stack:up`, runs `pnpm db:create` and runs `pnpm --dir server migrate` for slot 26.

| Lane / phase | Executor | Model | Work items | Files (disjoint) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — rebase, ops scaffold, config, CI, scripts, rule | implementer | sonnet | W1, W2, W3 | `infra/ops/{tsconfig.json,vitest.config.mjs,vitest.node.config.mjs,.gitignore,ops.mjs}`, `infra/ops/test/ci.test.mjs`, `.claude/sdd-engineering.json`, `.github/workflows/verify.yml`, `package.json`, `.claude/skills/migration-safety/SKILL.md` | SPEC-04 on master | — | this worktree; rebase first; no install |
| P2 — env, denylist, two-value edge gate | implementer | **opus** — trust boundary of every `/api/*` request (constant-time two-value compare) and the isolation guard that keeps rehearsal off production resources | W4, W5, W6 | `server/src/registries/env.ts`, `server/.env.example`, `server/src/platform/{env,edge}.ts`, `server/src/container.ts`, `server/test/unit/{env-13a,edge-rotation}.test.ts`, `server/test/integration/edge-rotation.int.test.ts` | P1 | — | this worktree; `test:int` file under the shared lock |
| P3 — health, image start, Dockerfile | implementer | **opus** — Payload/Next image build with unknown build-time env, start without git, health semantics (2 s, no leak) | W7, W8, W9 | `server/src/health/ports.ts`, `server/src/adapters/readiness.ts`, `server/src/endpoints/health.ts`, `server/src/registries/routes.ts`, `server/src/container.ts`, `server/scripts/{lib/listen.mjs,image-start.mjs,health-probe.mjs}`, `server/Dockerfile`, `server/Dockerfile.dockerignore`, `server/test/unit/listen.test.ts`, `server/test/integration/{health,edge-rotation}.int.test.ts` | P2 | — | image build HEAVY under the exclusive lock |
| P4 — node compose, env examples, deploy workflow | implementer | sonnet | W10, W11, W12 | `infra/ops/node/**`, `.github/workflows/deploy.yml`, `infra/ops/test/{compose,env-example,workflow}.test.mjs` | P3 | — | `docker compose config` only (no `up`) |
| P5 — args, guards, runner, transports | implementer | **opus** — injection-proof SSH command building and the main-domain/freeze guards | W13, W14 | `infra/ops/lib/{config,args,guard,exec,redact}.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/{args,guard,exec}.test.mjs`, `infra/ops/test/support/fakeExec.mjs` | P4 | — | no network |
| P6 — git, journal, lock, probe | implementer | **opus** — cross-process lock that releases on a dropped SSH session; journal never holding a secret | W15, W16, W17 | `infra/ops/lib/{git,journal,lock,probe}.mjs`, `infra/ops/test/{git,journal,lock,probe}.test.mjs` | P5 | — | lock dirs in temp |
| P7 — deploy and rollback orchestration | implementer | **opus** — step order with auto-revert, Worker/server split states, journal and lock lifetimes | W18, W19, W20, W21 | `infra/ops/lib/{image,node,worker,deploy,rollback}.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/{image,node,worker,deploy,rollback}.test.mjs`, `infra/ops/test/fixtures/deployments-status.json` | P6 | — | fakes only |
| P8 — secrets, rotation, bootstrap | implementer | **opus** — edge-secret rotation without 404s, secrets only via stdin, SSH lockout ordering | W22, W23, W24 | `infra/ops/lib/{secrets,bootstrap}.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/{secrets,rotate,bootstrap}.test.mjs` | P7 | — | fakes only; `.local` in temp |
| P9 — capacity | implementer | **opus** — tag guard before paid/destructive calls, resumable plan, provider-neutral adapter | W25, W26, W27 | `infra/ops/lib/capacity/**`, `infra/ops/ops.mjs`, `infra/ops/test/capacity/**`, `infra/ops/test/fixtures/do/**` | P8 | — | loopback HTTP only |
| P10 — Cloudflare rehearsal, Access, edge guard | implementer | **opus** — whole-phase `PUT` across envs, admin host exposure, Access app flag, main-domain guards | W28, W29, W30 | `infra/cloudflare/{cf.mjs,README.md}`, `infra/cloudflare/lib/{config,desired,access,guard}.mjs`, `infra/cloudflare/test/{desired,access}.test.mjs`, `infra/cloudflare/test/support/fakeApi.mjs`, `workers/edge/scripts/deploy.mjs`, `workers/edge/test/deploy.test.ts` | P9 | — | fake API only |
| P11 — domain move | implementer | sonnet | W31 | `infra/ops/edge-twin/worker.mjs`, `infra/ops/lib/moveDomain.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/moveDomain.test.mjs` | P10 | — | fakes only |
| P12 — local-node integration suite | implementer | **opus** — first real Docker run of P7/P8 code; red means an orchestration bug to fix in `lib/`, on Windows + Docker Desktop | W32, W33 | `infra/ops/test/node/**` (+ fixes in `infra/ops/lib/**` limited to failing behaviour) | P11, all phases committed | — | HEAVY, exclusive lock; project `t2f-node-rehearsal`; never `-p t2f` |
| P13 — README and docs patch | implementer | sonnet | W34, W35 | `infra/ops/README.md`, `spec-13a/docs-patch.md` (side notes) | P12 | — | — |
| L1 — integration pass | wave lead | — | W36 | build outputs, reviews | P13 | — | heavy runs one at a time |
| L2 — live Cloudflare S1b | wave lead | — | W37 | `infra/cloudflare/.local/**`, `infra/ops/.local/**` (gitignored), docs patch | L1 | — | credentials only via `--secrets-file` |
| Stage 2 runbook | wave session | — | R0 … R8 | node, docs patch | owner provides node (OQ-1, OQ-3) | — | see below |

Escalation Sonnet → Opus follows `run-plan-auto` §3. P3 and P7 are the largest phases. If the budget runs out (~80 calls), return PARTIAL with the tree green after the current item: after W8 in P3, after W19 in P7. Continue in a second dispatch of the same phase.

## Verification plan
| Command | Directory | Passing means |
|---|---|---|
| ops `files` / `full` (added in W1) | `infra/ops` | exit 0 |
| server `files` (config) | `server` | exit 0 |
| `node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>` (`edge-rotation`, `health`) | `server` | exit 0; Postgres + Redis up, DB migrated |
| HEAVY `docker build -f server/Dockerfile --build-arg T2F_COMMIT=<hex> -t t2f-server:p3check .` + no-`.git` check | `.` | exit 0, prints `no-git` |
| `docker compose -f infra/ops/node/compose.yml config -q` (dummy env) | `.` | exit 0 |
| HEAVY `node server/scripts/lock.mjs --mode exclusive -- node node_modules/vitest/vitest.mjs run -c infra/ops/vitest.node.config.mjs <file>` | `.` | W32, W33 green |
| infra `files` / `full` (config) | `infra/cloudflare` | exit 0 |
| edge `files` (config) | `workers/edge` | exit 0 |
| web `full` (config) — under the exclusive lock | `.` | exit 0 — wave lead |
| `server full`, `ops full`, `infra full`, `edge full` (config) | their dirs | exit 0 — wave lead |
| `git diff master -- .claude/sdd-engineering.json` | `.` | one added line |
| `node scripts/check-secrets.mjs` after `git add -A` | `.` | clean — wave lead |
| `pnpm contracts:run --sim-only` | `.` | green — wave lead |
| `pnpm infra:cf plan\|apply --env rehearsal --secrets-file <f>`; `pnpm edge:secret`, `deploy:env`, `rollback:env`, `edge:move-domain` as in W37 | `.` | as W37 — wave lead, live |

## Assumptions
Technical judgement calls only.
- **A1 — Image keeps devDependencies.** Whether `payload migrate` runs without `tsx` and devDependencies is not established (spec OQ-7, `research-code.md:54`). The image keeps them, and migrations run as `pnpm migrate` in a one-shot container. The cost is a larger image delivered in full each time (accepted price C10/A19).
- **A2 — Build context from `git archive <sha>`.** The image content is exactly the commit: no `.git`, no untracked files. The local tag is reused when it already exists, and delivery is skipped when the node has the tag.
- **A3 — `current.env` is separate from the node env file.** It holds only `T2F_ENV` and `T2F_SERVER_SHA` for Compose interpolation. Deploy and rollback rewrite it; they never touch `server.env`/`postgres.env`/`cloudflared.env` (AC-25).
- **A4 — Compose owns `T2F_ENV`, `T2F_HOST=0.0.0.0` and `T2F_SERVER_PORT=3000`; the image owns `T2F_COMMIT`.** The env examples therefore omit them (W11). Without `T2F_COMMIT` (dev/test runs only), health reports 40 zeros. `image-start.mjs` refuses a non-test start without it.
- **A5 — Health from inside.** The deploy health wait runs `health-probe.mjs` inside the server container, so the edge secret never crosses a process argv. AC-4/AC-54 «from the cloudflared container» are checked from a container on the network shared with cloudflared: the cloudflared image is distroless with no shell or HTTP client.
- **A6 — `--secrets-file <path>`** on every ops command, with the same semantics as `cf.mjs:86-95` and `deploy.mjs:62`. Credentials come from env or that file and are never printed.
- **A7 — Exit codes.** 0 = ok; 2 = refusal before any change (arguments, guards, dirty tree, busy lock, disk < 5 GB, no rollback target, edge-secret generation); 1 = a named step failed.
- **A8 — The local target runs the real Worker step** when no fake is injected. That is how S1b (W37 step 4) exercises Worker rollback without a node. Integration tests inject a fake worker in-process.
- **A9 — Locks.** Remote: `flock` held by a live SSH session, released automatically when the connection drops (EC-2). Local: an atomic `mkdir` with dead-pid takeover. `server/scripts/lib/lock.mjs` is not reused for this, because it waits and leases (`lock.mjs:184-243`) while AC-17 needs an immediate refusal.
- **A10 — Bootstrap uses Ubuntu's `docker.io` + `docker-compose-v2` packages**, not `get.docker.com`, and ufw for the node firewall. A DigitalOcean Cloud Firewall is not created by this wave (defence in depth the owner may add; ufw satisfies AC-8).
- **A11 — Provider sizes live in the DigitalOcean adapter's config.** The neutral layer knows only roles (main, realtime) and the `allowed`/`offSeason` keys. Production sizes are a placeholder for SPEC-23.
- **A12 — Role tags** `t2f-role-main`/`t2f-role-realtime` are added next to the two required tags, to tell the main node from the realtime node. The owner adds all three to the manually created node (R0).
- **A13 — Realtime node.** It is created, bootstrapped and given `compose.realtime.yml`, but not started (its tunnel token belongs to П-RT).
- **A14 — `infra/cloudflare` desired state always spans all envs.** A whole-phase `PUT` (`cloudflare-notes.md:99`) would otherwise delete the other env's rules. `--env` selects only the token file and the under-attack target.
- **A15 — DigitalOcean API facts** come from the official OpenAPI spec (researcher, 2026-11-17). A resize through the API powers the Droplet down automatically; the adapter still issues `shutdown` first for a clean stop. `disk:false` reversibility is an inference, confirmed live in R7 only.
- **A16 — Downtime rounding.** Whole seconds, rounded up, with the probe failing on any non-200 or a 2-second timeout.

## Open questions
None. Spec OQ-1 … OQ-6 gate only S2 steps (runbook R0); OQ-7 is resolved by A1 (migrate), the S2 timing (Actions duration, out of wave) and AC-27 (wrangler secrets).

## Research used
- Read in full: the spec; `spec-13a/research-code.md`; `spec-13a/research-providers.md`; `docs/backend/sdd-routing.md` §1, §2, §5–§7; `cloudflare-notes.md` §2, §3, §9–§11; `.claude/sdd-engineering.json`; the SPEC-05 plan pattern (header, W20–W22, Execution).
- Verified in the SPEC-04 worktree (post-merge shape):
  - `server/src/registries/env.ts:31-105`;
  - `server/src/platform/env.ts:35-140`;
  - `server/src/platform/edge.ts:42-100`;
  - `server/src/container.ts:46-58,93-173,294-315`;
  - `server/src/endpoints/{catalog,time,types}.ts`;
  - `server/src/ports.ts`;
  - `server/src/proxy.ts`;
  - `server/src/domain/access/config.ts:35-114`;
  - `server/src/instrumentation.ts`;
  - `server/src/platform/env.check.ts`;
  - `server/scripts/stack.mjs`;
  - `server/package.json`;
  - `next.config.ts` diff;
  - `lib/data/catalogSource.mjs:20-63`;
  - the `git diff --stat master...HEAD`, which shows no change to `verify.yml`, `.claude/sdd-engineering.json`, `infra/**` or `workers/edge/**`.
- Verified in this worktree:
  - `infra/cloudflare/{cf.mjs,lib/config.mjs,lib/desired.mjs,lib/guard.mjs}`;
  - apply/tokenFile references;
  - `infra/cloudflare/cloudflared/compose.yml`;
  - `workers/edge/{scripts/deploy.mjs,package.json,wrangler.json}`;
  - `.github/workflows/verify.yml`;
  - root `package.json`, `pnpm-workspace.yaml`;
  - `scripts/check-secrets.mjs:16-46`;
  - `server/scripts/lib/lock.mjs`;
  - `server/test/integration/helpers.ts:18`;
  - `.claude/skills/migration-safety/SKILL.md`.
- wrangler 4.149.0 (main checkout `node_modules`):
  - `rollback --help`, `deployments status --help` (`--json`), `deploy --help`;
  - Custom Domain override in non-TTY mode, `wrangler-dist/cli.js:164192-164257`.
- One researcher (Sonnet, external) for the DigitalOcean API v2: list/create/delete/actions/sizes/errors/rate limits/scopes/tags, from `github.com/digitalocean/openapi` and `docs.digitalocean.com`, retrieved 2026-11-17. Not established (handled by A15/R7):
  - the error on resizing an active Droplet;
  - `disk:false` reversibility;
  - `Retry-After` on 429;
  - the live presence of the `ubuntu-24-04-x64` slug.

## Rollback / blast radius
- **Blast radius:**
  - every `/api/*` request on the server (two-value edge gate);
  - server boot (denylist, previous-secret rule, `T2F_HOST`);
  - a new public route `/api/health`;
  - Cloudflare `rehearsal` resources (tunnel, two CNAMEs, the block-rule expression) plus Worker `t2f-edge-rehearsal` and twin `t2f-edge-rehearsal-alt`;
  - the `test` env objects are unchanged in content.
  - The production server `178.20.157.85` and the main domain are unreachable by construction (AC-21, AC-22).
- **Code rollback:** revert the merge. There is no migration, and nothing persistent except gitignored `.local` folders and local Docker images and projects (`docker compose -p t2f-node-rehearsal …`).
- **Cloudflare rollback:**
  - `wrangler rollback` for `t2f-edge-rehearsal`;
  - delete the twin (after the owner's yes, OQ-5);
  - `pnpm infra:cf apply --env test --allow-delete` with `rehearsal` removed from `ENVS`.
- **Merge:** rebased on master after SPEC-04 (P1). The shared files differ by added lines; on conflict keep both sides. No lockfile change.

## Risks
- **Payload/Next image build (W9)** is the largest unknown: build-time env, importMap, memory. Mitigation: build under the exclusive lock, compare with a local `pnpm --dir server build`, placeholders only in the build stage.
- **Image size and delivery time** over the owner's uplink (full image every deploy, A1). Delivery happens before the swap, so it does not count as downtime (NFR-2). CI deploys avoid the uplink.
- **Docker Desktop vs Linux (EC-18).** Disk checks, `flock`, ufw and SSH are proven only in S2. The local target exercises compose, images, migrations, the swap and health.
- **Non-TTY wrangler steals Custom Domains.** `deploy:env --env prelaunch|production` or `move-domain` to a main host would silently move `time2fest.com`. The AC-21 double flag in ops (W13) and edge (W30) is the only guard. The security review must check that no code path deploys those envs without it.
- **SSH lockout (W24).** Mitigation: the step-5 check before the sshd drop-in; the owner keeps the provider console open in R1.
- **Free-plan rule counts.** Custom rules stay 2/5 and config rules become 3/10 (one under-attack rule for rehearsal).
- **Heavy runs on 16 GB.** P3, P12, L1 and L2 each contain a ≈4 GB build. Never run two at once; vitest `--maxWorkers=2`.

## Stage 2 runbook (wave session, when the owner provides the node)
Not implementer phases. Every command runs from the worktree root with credentials only via `--secrets-file` and the SSH key in the agent. Commands that build images or the site run under `node server/scripts/lock.mjs --mode exclusive -- …`. Record every number in `infra/ops/.local/rehearsal/*.jsonl` / the node journal and copy it into the docs patch (`<S2: …>` placeholders).

- **R0 — Preconditions (owner).**
  - OQ-1: a DigitalOcean Droplet `s-2vcpu-4gb`, FRA1, Ubuntu 24.04, with the owner's SSH key and tags `t2f-managed`, `t2f-env-rehearsal`, `t2f-role-main`.
  - OQ-3: R2 keys for `time2fest-rehearsal` written by the owner into `infra/ops/.local/rehearsal/server.env`, together with the Access values once OQ-2 is answered.
  - OQ-4: yes to the < $1 capacity run, and a `DIGITALOCEAN_TOKEN` with the W26 scopes.
  - Without OQ-1 + OQ-3, every S2 row is reported `not verified: no server`.
- **R1 — Bootstrap (AC-8).** With the provider console open:
  - `pnpm node:bootstrap -- --host <ip> --env rehearsal`; compare the printed host-key fingerprint with the console.
  - Check: `ssh root@<ip> true` → `Permission denied`; `ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password deploy@<ip>` → refused; `ssh deploy@<ip> docker info` → ok.
  - A second run prints `без змін`.
- **R2 — Secrets, tunnel and Access.**
  - `pnpm infra:cf apply --env rehearsal --secrets-file <f>` (tunnel token file).
  - After OQ-2 yes: `--with-access` with `T2F_OWNER_EMAILS` in the secrets file. Copy the printed `aud` into `T2F_ACCESS_AUD`.
  - `pnpm edge:secret -- --env rehearsal --generate --target <ip> --secrets-file <f>`.
- **R3 — First deploy from `master` (AC-9 e2e, AC-57, NFR-2, AC-53).**
  - `T2F_CATALOG_URL=https://rehearsal.time2fest.com pnpm deploy:env -- --env rehearsal --target <ip> --probe --secrets-file <f>`. On the very first deploy the catalog URL answers 503 until the server is healthy; the Worker step runs after health, so this succeeds.
  - Check: `curl https://rehearsal.time2fest.com/` → 200, and `/api/health` → 200 with `git rev-parse master`. Record the probe downtime.
- **R4 — Live repeats.**
  - AC-54: `ssh deploy@<ip> docker run --rm --network t2f-rehearsal_backend --env-file /srv/t2f/rehearsal/server.env t2f-server:<sha> node scripts/health-probe.mjs --url http://server:3000/api/health --secret none --raw`, again with `--secret wrong`, and once more for `/api/nope` → identical status, headers and body.
  - AC-55:
    - `curl` `https://o-rehearsal.time2fest.com/api/time`, `-X POST …/api/webhooks/paypro` and `…/connection/websocket` → 403 each, and `docker compose logs server` contains none of them;
    - from another machine, `nmap -Pn -p- <ip>` → only `22/tcp` open.
  - AC-56 (after OQ-2):
    - `https://admin-rehearsal.time2fest.com/admin` without a session → the Access login or 403, with no server log line;
    - `curl -H 'Host: admin-rehearsal.time2fest.com' https://o-rehearsal.time2fest.com/admin` → 403;
    - `curl --connect-timeout 5 http://<ip>/` and `https://<ip>/` → no connection;
    - the owner logs in to the rehearsal admin through Access (≈ 2 min).
  - AC-32 is still 200.
  - AC-7: the owner power-cycles the Droplet from the console; `https://rehearsal.time2fest.com/api/health` → 200 within ≤ 3 min.
- **R5 — Rollback ×3 with timing (AC-24 S2, NFR-1, NFR-2).**
  - Deploy commit A, deploy commit B (two commits on `master` or a rehearsal branch merged to `master`), then `pnpm rollback:env -- --env rehearsal --target <ip> --probe --secrets-file <f>`. Health shows A and the Worker is on the recorded version.
  - Repeat the deploy-B/rollback pair twice more. Worst of three ≤ 5 min (NFR-1), and each probe downtime ≤ 60 s (NFR-2).
- **R6 — Live rotation (AC-37 S2).**
  - Start a separate probe loop (`--probe`) through `rehearsal.time2fest.com`, then run `pnpm edge:secret -- --env rehearsal --rotate --target <ip> --probe --secrets-file <f>`.
  - No 404 in the probe samples; the journal generation is +1.
  - Then confirm `pnpm rollback:env` is refused by AC-27 (expected, exit 2) until a new deploy.
- **R7 — Capacity (only after OQ-4 yes; AC-48, AC-49, AC-51, NFR-3).**
  - `pnpm capacity -- --env rehearsal plan`, then `night --size s-4vcpu-8gb` (dry), then the same `--confirm rehearsal --probe`, then `back --confirm rehearsal --probe`.
  - `realtime-create --confirm rehearsal`, then `realtime-delete --confirm rehearsal`, then `off-season --confirm rehearsal`, then `status` → «розбіжностей немає».
  - Record resize downtimes and create/delete seconds.
  - Without OQ-4: AC-48/49/51 live and NFR-3 are reported «не перевірено наживо, лише фейк».
- **R8 — Close.**
  - Fill the `<S2: …>` placeholders in the docs patch.
  - Append service journal lines (`docs/services/server.md`, `cloudflare.md`, `digitalocean` if created) the same day.
  - Add gotchas found live through `engineering-insights`.
  - Report each S2 row of the traceability table as verified, with its evidence line.
