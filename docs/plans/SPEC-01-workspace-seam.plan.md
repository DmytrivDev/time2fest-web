# Implementation plan: Workspace and seam vocabulary (SPEC-01)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-01-workspace-seam.md` (Status: approved, 0 `[NEEDS CLARIFICATION]` markers). AC-1 … AC-46, NFR-1 … NFR-5.
This plan implements those requirements; it does not define or change them.
**Execution mode** — single-agent, sequential phases P1 … P5 (one `sdd-engineering:implementer` dispatch per phase, all Sonnet). Recommended by the planner and given in the orchestrator's brief (2026-11-16); the orchestrator confirms it with the owner before `run-plan-auto`.
**Out of scope** — everything in the spec's `Non-goals` (spec lines 22-33): any `server/` code, moving the other contracts into the package, any visible site change, reading `site` from components, `held` moderation, `refunded` as a final state, rendering of new system messages, the behavioural items of §8.3, pinning pnpm (`packageManager`), a Vercel trial build by push, e2e in CI, the default for reminder emails. Zod wire schemas (the target of skill `contract-conformance` §1) are not introduced: the spec's `site` contract is **proposed** and the package ships plain TS (DR-17). Architecture and security review are performed by separate agents.

Repository root for every path below = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-01-workspace-seam` (branch `spec-01-workspace-seam`). It has **no `node_modules`** yet: P1 installs them. Never create junctions or symlinks to the main checkout's `node_modules`. **Do not commit.** Never push.

## Requirements traceability
| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | workspace = exactly `time2fest-web`, `@time2fest/contracts`, `@time2fest/rules` | `SPEC-01:50` | W1 | W1, W11 |
| AC-2 | `rules` has `time/`, `text/`, no runtime exports, own typecheck passes | `SPEC-01:53` | W1 | W1, W11 |
| AC-3 | frozen install + `build:demo` green with pnpm 9, 10, 12; `out-demo/index.html` each | `SPEC-01:56` | W1, W12 | W12 |
| AC-4 | `vercel.json` byte-identical to `master` | `SPEC-01:59` | (no item touches it) | W11 |
| AC-5 | package exports `ApiErrorCode`, `ApiError`, `ApiResult`, `Unsubscribe`, `ok`, `fail` identical to `lib/api/result.ts:8-48`, plus `site` | `SPEC-01:64` | W2, W3 | W2, W3 |
| AC-6 | every `@/lib/api/result` / `@/lib/api/contracts/*` import keeps working; no file outside the wave list | `SPEC-01:67` | W2, W4 | W2, W11 |
| AC-7 | `SiteState` exact fields, no `announcements` / `minBuild` | `SPEC-01:72` | W3 | W3 |
| AC-8 | `applySiteEvent` older/equal version → same reference | `SPEC-01:75` | W3 | W3 |
| AC-9 | `applySiteEvent` newer version or no state → received snapshot | `SPEC-01:78` | W3 | W3 |
| AC-10 | sim `state()` defaults (switches on, prices, `catalogVersion`) | `SPEC-01:81` | W4 | W4 |
| AC-11 | `peek()` = last delivered or `undefined` | `SPEC-01:84` | W4 | W4 |
| AC-12 | hook applies snapshots received during load via `applySiteEvent` | `SPEC-01:87` | W4 | W4 |
| AC-13 | `getService('site')` in sim, wrapped by `withFaults` | `SPEC-01:90` | W4 | W4 |
| AC-14 | `MIGRATED_DOMAINS`, `missingDomains('http')` unchanged | `SPEC-01:93` | W4 | W4 |
| AC-15 | no import of the `site` hook/service from `components/`, `app/`, `stores/` | `SPEC-01:96` | W4 | W11 |
| AC-16 | chat `chat-closed` send reason, `translate-limit` translate reason | `SPEC-01:101` | W5 | W7 |
| AC-17 | checkout `start` reason literal union (7 members) | `SPEC-01:104` | W5 | W7 |
| AC-18 | checkout `cancel` reason `already-paid` | `SPEC-01:107` | W5 | W7 |
| AC-19 | passport `claim` reasons `claim-closed`, `unknown-event` | `SPEC-01:110` | W5 | W7 |
| AC-20 | toasts `check` reason `moderation` | `SPEC-01:113` | W5 | W7 |
| AC-21 | profile `linkGoogle` reason `google-taken` | `SPEC-01:116` | W5 | W7 |
| AC-22 | rating `vote` reason `not-rated` | `SPEC-01:119` | W5 | W7 |
| AC-23 | `SystemPayload` + `announcement`, `time-pending` | `SPEC-01:124` | W6 | W7 |
| AC-24 | optional `priceVersion` (request), `price` + `priceVersion` (`Order`) | `SPEC-01:127` | W5 | W7 |
| AC-25 | `refunded` in `OrderStatus`; `isFinalOrder(refunded) === false`, others unchanged | `SPEC-01:130` | W5 | W7 |
| AC-26 | optional `Session` field: which celebration the pass is for | `SPEC-01:133` | W5 | W7 |
| AC-27 | optional `ProfileSettings` boolean for reminder emails; sim does not return it | `SPEC-01:136` | W5 | W7 |
| AC-28 | `applyStreamEvent` returns the same map for `hide` | `SPEC-01:139` | W6 | W7 |
| AC-29 | optional `version` on every `StreamEvent` member and `StreamChain`; optional `override` on `StreamSource` | `SPEC-01:142` | W6 | W7 |
| AC-30 | sim adapters emit none of the new reasons/kinds/statuses/fields | `SPEC-01:145` | W5, W6 (by not touching `lib/api/sim/**` except `site`) | W7, W11 |
| AC-31 | `components/`, `app/`, `styles/`, `messages/`, `lib/engine/` unchanged; `stores/` type-only | `SPEC-01:150` | (no item touches them) | W11 |
| AC-32 | e2e passes, `tests/e2e/` unchanged | `SPEC-01:153` | — | W13 |
| AC-33 | sim board capture: 0 boards above 0.1 % | `SPEC-01:156` | — | W14 |
| AC-34 | workflow on every push: frozen install + `full` of web, contracts, rules; ubuntu-latest, Node 22 | `SPEC-01:161` | W10 | W10 (static), orchestrator after merge |
| AC-35 | `concurrency` per branch, `cancel-in-progress: true` | `SPEC-01:164` | W10 | W10 |
| AC-36 | failed install or verify → failed job (no `continue-on-error`) | `SPEC-01:167` | W10 | W10 |
| AC-37 | no Playwright / Storybook / e2e in workflow | `SPEC-01:170` | W10 | W10 |
| AC-38 | additive check: removal / optional→required → non-zero, names each | `SPEC-01:175` | W8 | W8 |
| AC-39 | purely additive change → exit 0 | `SPEC-01:178` | W8 | W8 |
| AC-40 | unrecorded additive change → fail + print refresh command | `SPEC-01:181` | W8 | W8 |
| AC-41 | breaking passes only after baseline regenerated with explicit flag that records it | `SPEC-01:184` | W8 | W8 |
| AC-42 | additive check in `full` of `web` and `contracts` | `SPEC-01:187` | W9 | W9 |
| AC-43 | real `contracts` `files` / `full` commands, exit 0 | `SPEC-01:192` | W9 | W9, W11 |
| AC-44 | `rules` entry, typecheck, exit 0 | `SPEC-01:195` | W9 | W9, W11 |
| AC-45 | `server` entry equal to `master` | `SPEC-01:198` | W9 | W9 |
| AC-46 | §3.11 docs patch in the wave report; no file outside `web/` edited | `SPEC-01:201` | W15 | W15 (orchestrator review) |
| NFR-1 | web `dependencies` gain only workspace packages | `SPEC-01:224` | W1 | W11 |
| NFR-2 | `http` build has no `site` sim code | `SPEC-01:227` | W4 | W13 (`prod` project) |
| NFR-3 | packages import nothing from the web app | `SPEC-01:230` | W1, W2, W3 | W11 |
| NFR-4 | workflow `contents: read`, no `secrets.` | `SPEC-01:233` | W10 | W10 |
| NFR-5 | package test commands with ≤2 workers | `SPEC-01:236` | W1, W9 | W9 |

## Spec follow-ups
Addressed to `spec-creator` and the owner; none blocks the plan, which implements the spec as written.
1. **AC-10 cites `catalog.version()` (`lib/api/contracts/catalog.ts:16`), but no `CatalogService` implementation exists** (`catalog` is absent from `simFactories`, `lib/api/sim/index.ts:20-30`; only the interface exists). The plan computes the value with the rule documented on that very line (`meta.generatedAt` + `tzdbVersion`, `catalog.ts:15`, fields at `lib/data/types.ts:413`) in one exported pure function, so a future `catalog` adapter reuses it. A later revision could name that function instead of `catalog.version()`.
2. **AC-17 wording groups `pass-owned` with `payments-off (unavailable)`**, while the existing contract documents `pass-owned` as `conflict` (`lib/api/contracts/checkout.ts:73`). The plan keeps `conflict` for `pass-owned` (existing behaviour, not changed by this wave).
3. **AC-38 lists four breaking kinds but says nothing about a changed property type** (e.g. `string` → `number`). Skill `contract-conformance` §4 counts a type change as breaking. The plan treats any non-additive change (type text changed and not a pure literal-union widening) as breaking too. This is stricter than AC-38 and does not conflict with AC-39 (a type change is not purely additive).
4. **AC-32 says "the e2e suite"; `playwright.config.ts:4-33` starts both web servers (dev `:3000` and production build `:3100`) for any project selection.** The plan runs the full suite once (all four projects). The `prod` project also covers NFR-2.
5. **Skill `layout-fidelity` §3-4 relies on `BT/compare-live.mjs` and test doors marked "(S01)", but SPEC-01's goals do not include them** (they belong to the server waves). For the sim-only AC-33 the plan uses tools that already exist: `BT/snapshot.mjs` with `--shots`/`--project` in a temp dir, plus `scripts/baseline-shots.mjs diff`. The orchestrator should re-label the "(S01)" items in `layout-fidelity` to the wave that really builds them.

## Affected surface
Routing table: `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1. Paths relative to the worktree root.

| File | New/Mod | Package | Home (ring / radius) | Skills that will govern it | Constraint to respect |
|---|---|---|---|---|---|
| `pnpm-workspace.yaml` | Mod | web | workspace root | — (coverage gap) | keep `allowBuilds` lines 1-9 byte-identical; add `packages:` (EC-3: pnpm 9 rejects a workspace file without it) |
| `pnpm-lock.yaml` | Mod (generated) | web | — | — (coverage gap, never hand-edited) | `lockfileVersion: '9.0'` must not change (`research-vercel.md:3`); only new `importers` entries may appear |
| `package.json` | Mod | web | root | `engineering-paved-path:security` | NFR-1: only `"@time2fest/contracts": "workspace:*"` added to `dependencies` (`package.json:29-37`); no other edit |
| `tsconfig.json` | Mod | web | root | — (coverage gap) | add only `"packages/*/node_modules"`, `"packages/*/dist"` to `exclude` (`tsconfig.json:41-46`); do **not** copy the main checkout's uncommitted `.next-e2e`/`.next-wp` include globs |
| `next.config.ts` | Mod | web | root | `engineering-paved-path:next-best-practices` | add `transpilePackages: ['@time2fest/contracts']` only; do not touch the `http` alias block (`next.config.ts:33-42`), which is the NFR-2 guard |
| `packages/contracts/package.json` | New | contracts | package root | `contract-conformance`, `engineering-paved-path:security` | exports TS source (`./src/index.ts`), no build step (DR-17); devDeps pinned to the root versions `typescript 5.9.3`, `vitest 5.0.3` (`package.json:68,70`) |
| `packages/contracts/tsconfig.json` | New | contracts | package root | `contract-conformance` | standalone (no `extends ../../…`, no `paths` `@/*`): NFR-3 grep must stay empty |
| `packages/contracts/vitest.config.ts` | New | contracts | package root | `contract-conformance` | `environment: 'node'`, `include: ['test/**/*.test.ts']` |
| `packages/contracts/src/index.ts` | New | contracts | ring 2 (ports: shared contract) | `engineering-paved-path:onion-architecture`, `contract-conformance` | narrow barrel of `result` + `site` only |
| `packages/contracts/src/result.ts` | New | contracts | ring 1/2 (error taxonomy) | `engineering-paved-path:onion-architecture`, `contract-conformance` | content of `lib/api/result.ts:7-48` moved verbatim (members, comments, semantics) |
| `packages/contracts/src/site.ts` | New | contracts | ring 2 (types) + ring 1 (`applySiteEvent`, pure) | `engineering-paved-path:onion-architecture`, `contract-conformance` | onion ban 4: no import from the web app; shape exactly per `SPEC-01:249-271` |
| `packages/contracts/test/result.test.ts` | New | contracts | test | `contract-conformance` | — |
| `packages/contracts/test/site.test.ts` | New | contracts | test | `contract-conformance` | negative type cases via `// @ts-expect-error`, enforced by the package `tsc` |
| `packages/rules/package.json` | New | rules | package root | `engineering-paved-path:security` | exports `./time`, `./text`; devDep `typescript 5.9.3` only |
| `packages/rules/tsconfig.json` | New | rules | package root | — (coverage gap) | standalone, same compiler options as contracts |
| `packages/rules/src/time/index.ts`, `packages/rules/src/text/index.ts` | New | rules | ring 1 (empty) | — (coverage gap: no routing row for `packages/rules/**`) | AC-2: `export {};` plus a doc comment, nothing else |
| `lib/api/result.ts` | Mod | web | seam | — (coverage gap: no row matches `lib/api/*.ts`) | becomes a re-export; keep the header comment; `export type` for types (isolatedModules, `tsconfig.json:18`) |
| `lib/api/contracts/site.ts` | New | web | seam contract | `contract-conformance` | re-export from `@time2fest/contracts` only |
| `lib/api/sim/site.ts` | New | web | sim adapter | — (coverage gap: no row for `lib/api/sim/**`) | sim adapters are imported only by `lib/api/sim/index.ts` (`eslint.config.mjs:20-31`) |
| `lib/api/sim/index.ts` | Mod | web | sim registry | — (coverage gap) | one line, the same shape as `lib/api/sim/index.ts:21-29` |
| `lib/api/services.ts` | Mod | web | registry | — (coverage gap) | add `site: SiteService` to `Services` (`services.ts:24-35`); `MIGRATED_DOMAINS` (`services.ts:41`) unchanged (AC-14) |
| `lib/api/hooks/site.ts` | New | web | data hook (`lib/api/hooks`) | `engineering-paved-path:frontend-ui-architecture`, `engineering-paved-path:react-best-practices` | follow the `createResource` pattern of `lib/api/hooks/rating.ts:39-51`; **do not modify `lib/api/resource.ts`**, which drops events before the first load (`resource.ts:11,107`) |
| `tests/unit/api/site-sim.test.ts` | New | web | test | `engineering-paved-path:react-testing-library` | — |
| `tests/unit/api/site-hooks.test.tsx` | New | web | test | `engineering-paved-path:react-testing-library` | inject a fake service through `setServicesForTest` (`services.ts:65`); no timers or sleeps |
| `lib/api/contracts/chat.ts`, `checkout.ts`, `passport.ts`, `toasts.ts`, `profile.ts`, `rating.ts`, `auth.ts`, `live.ts` | Mod | web | seam contracts | `contract-conformance` | additions only; existing members and comments unchanged (FR-MIG-07) |
| `lib/data/types.ts` | Mod | web | shared data types | — (coverage gap) | only the three additions of AC-23/AC-29 (lines 184-195, 91-114, 122-129) |
| `tests/unit/api/seam-vocabulary.test.ts` | New | web | test | `engineering-paved-path:react-testing-library` | type assertions are enforced by `npx tsc --noEmit -p .`, not by vitest |
| `scripts/contract-surface.mjs` | New | web | build tooling | — (coverage gap) | uses only `typescript` (existing devDep) and `node:*`; determines root from its own location, not `cwd` |
| `scripts/contract-surface.baseline.json` | New (generated by the tool) | web | — | — (coverage gap, generated) | never hand-edited |
| `tests/unit/contract-surface.test.ts` | New | web | test | `engineering-paved-path:react-testing-library` | `// @vitest-environment node`; fixtures in a `fs.mkdtempSync` temp dir, removed in `afterAll` |
| `.claude/sdd-engineering.json` | Mod | web | pipeline config | — (coverage gap) | `server` entry (lines 17-22) byte-identical (AC-45) |
| `.github/workflows/verify.yml` | New | web | CI | `engineering-paved-path:security` | `permissions: contents: read`; no `secrets.`; `persist-credentials: false` |

**Coverage gaps:** `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.json`, `packages/rules/tsconfig.json`, `packages/rules/src/**`, `lib/api/result.ts`, `lib/api/services.ts`, `lib/api/sim/index.ts`, `lib/api/sim/site.ts`, `lib/data/types.ts`, `scripts/contract-surface.mjs`, `scripts/contract-surface.baseline.json`, `.claude/sdd-engineering.json`, this plan (`docs/**`). Recommend to the orchestrator: add routing rows for `packages/rules/src/**/*.ts` (onion ring 1), `lib/api/*.ts`, `lib/api/sim/**` (frontend-ui-architecture) and `scripts/**/*.mjs`.

**Knowledge files:** config `knowledgeFiles` = `docs/knowledge/gotchas.md`. That file does not exist in this worktree (checked). There is no `CLAUDE.md` in `web/`. The root `D:/Work/Pets/Time2Fest/CLAUDE.md` traps that apply: Windows `\r\n` in generated files; bash heredocs with Ukrainian apostrophes break, so write such text with the Write tool.

## Contract changes
- **Shared contracts / schemas:** yes.
  - (1) The error model moves from `lib/api/result.ts` to `packages/contracts/src/result.ts`. `lib/api/result.ts` re-exports it, so every importer is untouched (W2).
  - (2) New `site` contract in `packages/contracts/src/site.ts`, re-exported by `lib/api/contracts/site.ts` (W3, W4).
  - (3) Additive vocabulary in 8 `lib/api/contracts/*.ts` files and `lib/data/types.ts` (W5, W6).
  - Lock-step pairs:
    - the package `index.ts` ↔ `lib/api/result.ts` ↔ `lib/api/contracts/site.ts` re-exports;
    - the `full` command strings in `.claude/sdd-engineering.json` ↔ the run steps in `.github/workflows/verify.yml`, which must be identical (W9, W10);
    - the contract surface ↔ `scripts/contract-surface.baseline.json`. The baseline is generated last, in W8, after all contract edits.
  - No test enforces equality of copies other than the new additive check.
- **Migration:** no — no database in this wave.
- **Seed / fixture data:** no — the sim `site` defaults are constants of the adapter (AC-10), not seed data.
- **Build-only failures:** yes.
  - (a) `next build` must resolve the TS-source workspace package. That is the job of `transpilePackages` (`research-vercel.md:7`). Caught by the `web` `full` (`npx cross-env NEXT_DIST_DIR=out-verify next build`, `.claude/sdd-engineering.json:9`) and by `pnpm build:demo` (W12).
  - (b) Vercel's pnpm 9/10 versus a lockfile written by local pnpm 12.4.2. Caught only by W12 (three frozen installs).
  - (c) The `http` build must not include the `site` sim. Guarded by `lib/api/simEntry.ts` aliasing (`next.config.ts:33-42`), proven by the `prod` e2e project (W13).
- **Wire contract (config `contractChecks`):** yes. Contracts change (new domain `site`, new reasons, kinds, fields, statuses). Skill `contract-conformance` applies:
  - **sim only this wave.** There is no `http` adapter and no server, so no http suite.
  - The sim side is pinned by `tests/unit/api/site-sim.test.ts` and `site-hooks.test.tsx`; the existing `tests/unit/api/*-sim.test.ts` must pass unchanged.
  - All changes are additive per §4 of the skill, except `OrderStatus` gaining `refunded`. That widens an enum consumed by the client, which is why AC-25 keeps it non-final. Report it as such.
  - The `frontend-seam.md` §3.11 row goes in the report's docs patch (W15).
- **Layout fidelity:** yes, in the sense that `web/` changes, though nothing that renders changes (AC-31). Skill `layout-fidelity`, sim only: the step 5 e2e (W13) plus the AC-33 capture (W14).
- **Payload migration:** no — no collections.
- **Test doors:** no — no server.
- **Agent write surface:** no — no role, key or endpoint.
- **Seed and fixtures:** no — no collection or `web/data` source changes.

## Work items

Common verify commands (from `.claude/sdd-engineering.json`, run in the directory given):
- **web targeted** (dir `.`): `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`
- **contracts targeted** (dir `packages/contracts`), until W9 writes it into the config: `npx tsc --noEmit -p . && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`
- **rules targeted** (dir `packages/rules`): `npx tsc --noEmit -p .`

Test output always goes to a file in the session scratchpad, and only `tail -40` of it is read (`sdd-routing.md` §5). Example: `npx vitest … > "$SCRATCH/w4.txt" 2>&1; echo exit=$?; tail -40 "$SCRATCH/w4.txt"`.

### W1 — Create the pnpm workspace, the two packages and install
- **Serves:** AC-1, AC-2, NFR-1, NFR-3, NFR-5; enables AC-3, AC-5 (package must exist and resolve).
- **Do:**
  1. Record `pnpm --version` (expected `12.4.2`) and `node --version` for the report.
  2. `pnpm-workspace.yaml`: prepend
     ```yaml
     packages:
       - '.'
       - 'packages/*'
     ```
     Keep the `allowBuilds` block unchanged.
  3. `packages/contracts/package.json`:
     - name `@time2fest/contracts`, version `0.0.0`, `private: true`, `type: module`;
     - `exports: { ".": "./src/index.ts" }`;
     - scripts `typecheck: "tsc --noEmit -p ."`, `test: "vitest run --maxWorkers=2"`;
     - devDependencies `typescript: "5.9.3"`, `vitest: "5.0.3"`.
  4. `packages/contracts/tsconfig.json`:
     - `target ES2022`, `lib ["ES2022"]`, `module esnext`, `moduleResolution bundler`, `strict`, `noUncheckedIndexedAccess`, `isolatedModules`, `noEmit`, `skipLibCheck`, `types: []`;
     - `include ["src", "test", "vitest.config.ts"]`.
  5. `packages/contracts/vitest.config.ts`: `defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } })`.
  6. `packages/contracts/src/index.ts`: a one-line doc comment and `export {};`. W2 and W3 fill it.
  7. `packages/rules/package.json`:
     - name `@time2fest/rules`, private, `type: module`;
     - exports `"./time": "./src/time/index.ts"`, `"./text": "./src/text/index.ts"`;
     - script `typecheck`; devDependency `typescript: "5.9.3"`.
  8. `packages/rules/tsconfig.json`: the same options as contracts, `include ["src"]`.
  9. `packages/rules/src/time/index.ts`, `packages/rules/src/text/index.ts`: one doc comment ("pure time/text rules shared by web and server — filled by later waves") and `export {};`.
  10. Root `package.json`: add `"@time2fest/contracts": "workspace:*"` to `dependencies`. Add nothing else. `rules` gets no consumer yet.
  11. `tsconfig.json`: append `"packages/*/node_modules"` and `"packages/*/dist"` to `exclude`.
  12. `next.config.ts`: add `transpilePackages: ['@time2fest/contracts'],` inside `nextConfig`, with a one-line comment (workspace package ships TS source).
  13. Run `pnpm install` (local 12.4.2, **not** frozen, to add the importers) in the worktree root. Then check the lockfile:
      - `git diff --stat pnpm-lock.yaml`;
      - `grep -n "lockfileVersion" pnpm-lock.yaml` still shows `'9.0'`;
      - the diff only adds `importers` for `packages/contracts` and `packages/rules` and the `link:` dependency of `.`.
      - **If `lockfileVersion` changed or unrelated packages were re-resolved, STOP and report BLOCKED.** Do not try other pnpm flags.
- **Files:** `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `tsconfig.json`, `next.config.ts`, `packages/contracts/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`, `packages/rules/{package.json,tsconfig.json,src/time/index.ts,src/text/index.ts}`.
- **Done means:**
  - `pnpm -r ls --depth -1` lists exactly `time2fest-web`, `@time2fest/contracts`, `@time2fest/rules`;
  - `npx tsc --noEmit -p .` exits 0 in `packages/rules`;
  - `grep -rn "export" packages/rules/src` shows only `export {};` lines;
  - `git diff master -- package.json` shows exactly one added line in `dependencies` and nothing else;
  - `lockfileVersion: '9.0'` is unchanged.
- **Verify:**
  - rules targeted in `packages/rules`;
  - web targeted with `{files}` = `next.config.ts` (runs root `tsc` + eslint);
  - `pnpm -r ls --depth -1`.
- **Rules that apply:**
  - `engineering-paved-path:security` → A03 supply chain: exact pinned versions, lockfile committed, no new third-party package (the devDeps resolve to the versions already in the lockfile);
  - `engineering-paved-path:next-best-practices` → Bundling: transpile workspace TS packages;
  - `engineering-paved-path:onion-architecture` → ban 4: no package imports the hosting app.
- **Risk:**
  - pnpm 12 may rewrite unrelated lockfile sections (mitigated by the STOP rule).
  - The worktree is nested inside `D:/Work/Pets/Time2Fest/web`, so Node resolution can silently fall back to the parent `web/node_modules` if a package lacks a dependency. CI on a clean clone (W10) is the definitive check. Do not "fix" a missing-dependency error by relying on it.

### W2 — Move the error model into `@time2fest/contracts`, re-export from `lib/api/result.ts`
- **Serves:** AC-5 (error model part), AC-6.
- **Do:**
  - Create `packages/contracts/src/result.ts` with the exact declarations of `lib/api/result.ts:7-48`: `ApiErrorCode` with its 9 members and doc comments, `ApiError`, `ApiResult`, `ok`, `fail` and `Unsubscribe`, including their comments.
  - `packages/contracts/src/index.ts`: `export * from './result';`.
  - Rewrite `lib/api/result.ts`: keep its header comment (lines 1-5) plus one sentence saying the source now lives in `@time2fest/contracts`, then
    ```ts
    export type { ApiErrorCode, ApiError, ApiResult, Unsubscribe } from '@time2fest/contracts';
    export { ok, fail } from '@time2fest/contracts';
    ```
  - Create `packages/contracts/test/result.test.ts`:
    - `ok(1)` deep-equals `{ ok: true, value: 1 }`;
    - `fail('conflict', { reason: 'x' })` deep-equals `{ ok: false, error: { code: 'conflict', reason: 'x' } }`;
    - `fail('network')` equals `{ ok: false, error: { code: 'network' } }`;
    - an exhaustive `const codes: Record<ApiErrorCode, true> = { network: true, unavailable: true, unauthorized: true, forbidden: true, not_found: true, conflict: true, rate_limited: true, validation: true, unknown: true }` with `expect(Object.keys(codes)).toHaveLength(9)`. A missing or extra member fails the package `tsc`.
- **Files:** `packages/contracts/src/result.ts`, `packages/contracts/src/index.ts`, `packages/contracts/test/result.test.ts`, `lib/api/result.ts`.
- **Done means:**
  - contracts targeted is green on the three package files;
  - root `npx tsc --noEmit -p .` exits 0 with no importer of `@/lib/api/result` edited (`git diff master --name-only` shows no file outside this plan's Affected surface);
  - `npx vitest run tests/unit/api --maxWorkers=2` is green.
- **Verify:**
  - contracts targeted (`{files}` = `src/result.ts src/index.ts test/result.test.ts`);
  - web targeted (`{files}` = `lib/api/result.ts`);
  - plus `npx vitest run tests/unit/api --maxWorkers=2`.
- **Rules that apply:**
  - `engineering-paved-path:onion-architecture` → §1: the error taxonomy is core and shared by both hosts;
  - `contract-conformance` → §1: one source, re-exported, not redefined;
  - `engineering-paved-path:frontend-ui-architecture` → §4: `import type` / `export type` for types.
- **Risk:** low. A missing `export type` breaks `isolatedModules`, and `tsc` catches it.

### W3 — `site` contract and `applySiteEvent` in the package
- **Serves:** AC-5 (`site` part), AC-7, AC-8, AC-9, NFR-3.
- **Do:** `packages/contracts/src/site.ts`, following the proposed contract at `SPEC-01:249-271`.
  - **Types:**
    - `Money = { amount: number; currency: 'USD' }` (amount in minor units);
    - `ProductKey = 'pass' | 'toast:2' | 'toast:5' | 'toast:10'`;
    - `SiteProduct { key: ProductKey; price: Money; priceVersion: number }`;
    - `SiteSwitches { chat; toasts; pass; passGift; payments; viewersMap; passOffer: boolean; chatRooms: Readonly<Record<string, boolean>> (absent key = room open); toastTiers: { '2': boolean; '5': boolean; '10': boolean } }`;
    - `SiteEventPatch { moment?: number /* ms */; isMainCelebration?: boolean; restrained?: { note?: string }; hidden?: boolean }`;
    - `SiteState { version: number; at: string /* ISO */; switches: SiteSwitches; products: readonly SiteProduct[]; catalogVersion: string; eventPatches: Readonly<Record<string, SiteEventPatch>> }`;
    - `SiteEvent = { type: 'snapshot'; state: SiteState }`;
    - `SiteService { state(): Promise<ApiResult<SiteState>>; subscribe(onEvent: (event: SiteEvent) => void): Unsubscribe; peek(): SiteState | undefined }`, with method doc comments naming `GET /api/site/state` and channel `site:state` (proposed).
  - **Pure rule:** `applySiteEvent(current: SiteState | undefined, event: SiteEvent): SiteState`:
    - `!current` or `event.state.version > current.version` → `event.state`;
    - otherwise → `current` (the same reference).
  - Imports only `./result`. `index.ts` adds `export * from './site';`.
  - `packages/contracts/test/site.test.ts`:
    - a full `SiteState` literal compiles;
    - two `// @ts-expect-error` literals, one with `announcements: []` and one with `minBuild: 1`;
    - `applySiteEvent` cases: older returns the same reference (`toBe`), equal returns the same reference, newer returns the received object, `undefined` current returns the received object.
- **Files:** `packages/contracts/src/site.ts`, `packages/contracts/src/index.ts`, `packages/contracts/test/site.test.ts`.
- **Done means:**
  - contracts targeted is green;
  - the package `tsc` fails if either `@ts-expect-error` line stops erroring;
  - `grep -rnE "from '@/|\.\./\.\./" packages --include=*.ts --include=*.json` (excluding `node_modules`) is empty.
- **Verify:** contracts targeted (`{files}` = `src/site.ts src/index.ts test/site.test.ts`), plus the NFR-3 grep above.
- **Rules that apply:**
  - `engineering-paved-path:onion-architecture` → §1: `applySiteEvent` is a pure ring-1 rule, testable without I/O;
  - §2: `SiteService` is a port (crosses the process boundary, has sim and future http implementations);
  - `contract-conformance` → §4: shape is additive-friendly (event union can gain deltas later).
- **Risk:** low.

### W4 — Wire the `site` domain into the web seam (contract re-export, sim adapter, registry, hook)
- **Serves:** AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, NFR-2 (by construction).
- **Do:**
  - **`lib/api/contracts/site.ts`:** a header comment plus re-exports from `@time2fest/contracts`:
    - types `SiteState`, `SiteSwitches`, `SiteProduct`, `ProductKey`, `Money`, `SiteEventPatch`, `SiteEvent`, `SiteService`;
    - value `applySiteEvent`.
  - **`lib/api/sim/site.ts`:**
    - Export a pure `catalogVersionOf(meta: { generatedAt: string; tzdbVersion: string }): string`, returning `` `${meta.generatedAt}+${meta.tzdbVersion}` ``, following the rule documented at `lib/api/contracts/catalog.ts:15`. (Spec follow-up 1.)
    - Export `createSimSite(): SiteService`, holding module-scope `last: SiteState | undefined` and a listener set.
    - `state()` builds the defaults:
      - `version: 1`, `at: new Date(0).toISOString()`;
      - every switch `true`, `chatRooms: {}`, `toastTiers` all `true`;
      - products `pass` 500, `toast:2` 200, `toast:5` 500, `toast:10` 1000, currency `USD`, all `priceVersion: 1`;
      - `eventPatches: {}`;
      - `catalogVersion: catalogVersionOf(getData().meta)`.
    - `state()` stores the defaults in `last` and returns `ok(...)`.
    - `subscribe(cb)` adds a listener that sets `last = applySiteEvent(last, e)` before calling `cb`, and returns the remover. The sim never emits.
    - `peek()` returns `last`.
    - Export `resetSimSiteForTest()` that clears `last`.
  - **`lib/api/sim/index.ts`:** add `site: () => withFaults('site', createSimSite()),`.
  - **`lib/api/services.ts`:** import `type { SiteService } from './contracts/site'` and add `site: SiteService;` to `Services`. Do **not** touch `MIGRATED_DOMAINS` or `missingDomains`.
  - **`lib/api/hooks/site.ts`** (`'use client'`):
    - `export const siteState = createResource<SiteState, SiteEvent>(() => { const svc = getService('site'); let seen: SiteState | undefined; return { load, subscribe, reduce, peek }; })`, where:
      - `subscribe: (cb) => svc.subscribe((e) => { seen = applySiteEvent(seen, e); cb(e); })` buffers what arrives before the first data, because `resource.ts:107` drops those events;
      - `load: async () => { const r = await svc.state(); return r.ok && seen ? ok(applySiteEvent(r.value, { type: 'snapshot', state: seen })) : r; }`;
      - `reduce: applySiteEvent`;
      - `peek: () => svc.peek()`.
    - `export function useSiteState(): { status: ResourceStatus; state: SiteState | undefined }`, returning `useResource(siteState)` mapped.
    - No consumers.
  - **`tests/unit/api/site-sim.test.ts`:**
    - AC-10: `state()` deep-equals the defaults, and `catalogVersion === catalogVersionOf(getData().meta)`;
    - AC-11: `peek()` is `undefined` before, and after `state()` it is the same value;
    - AC-13 and AC-14:
      - `getService('site')` resolves in sim;
      - `simFaults.failNext('site', 'state', 'network')` makes the next `state()` return `{ ok: false, error: { code: 'network' } }`;
      - `MIGRATED_DOMAINS` does not include `'site'`;
      - reset with `resetSimFaultsForTest`.
  - **`tests/unit/api/site-hooks.test.tsx`** (AC-12): inject a fake `SiteService` with `setServicesForTest`. Its `state()` returns a promise resolved manually, and its `subscribe` keeps the callback. Mount `useSiteState` with `renderHook`.
    - Case 1: emit a v5 snapshot during load, then resolve `state()` with v3. The hook exposes v5.
    - Case 2: emit v2 during load, then resolve with v3. The hook exposes v3.
    - Restore the services after each case.
- **Files:** `lib/api/contracts/site.ts`, `lib/api/sim/site.ts`, `lib/api/sim/index.ts`, `lib/api/services.ts`, `lib/api/hooks/site.ts`, `tests/unit/api/site-sim.test.ts`, `tests/unit/api/site-hooks.test.tsx`.
- **Done means:**
  - web targeted is green for these 7 files;
  - `tests/unit/api/mode.test.tsx` passes with no change (`git diff master -- tests/unit/api/mode.test.tsx` is empty);
  - `grep -rnE "hooks/site|getService\('site'\)" components app stores` is empty.
- **Verify:**
  - web targeted (`{files}` = the 7 files);
  - plus `npx vitest run tests/unit/api --maxWorkers=2 > "$SCRATCH/w4-api.txt" 2>&1; tail -40 "$SCRATCH/w4-api.txt"`.
- **Rules that apply:**
  - `engineering-paved-path:frontend-ui-architecture` → §5: server data goes through the data hooks in `lib/api/hooks`; no wide barrel;
  - `engineering-paved-path:react-best-practices` → Hooks: no `useEffect` (the resource uses `useSyncExternalStore`), and subscriptions are cleaned up by `resource.ts`;
  - `engineering-paved-path:react-testing-library` → Hook testing: `renderHook`, no fixed delays, mock at the service boundary only;
  - `contract-conformance` → §2: the sim test pins what the boards will show.
- **Risk:**
  - `faults.ts:45` SYNC regex: `state` is async and therefore wrapped (intended); `peek` and `subscribe` are not.
  - Adding `site` to `Services` widens `ServiceName`, but `MIGRATED_DOMAINS` is an explicit list, so the `ApiGuard` banner (`lib/api/ApiGuard.tsx:14`) is unaffected (EC-8).

### W5 — Seam vocabulary in the domain contracts (reasons, fields, `refunded`)
- **Serves:** AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-24, AC-25, AC-26, AC-27, AC-30.
- **Do:** additions only. Each new union is `export type`, and each member carries a one-line doc comment with its `ApiErrorCode` and the `spec.md` line the spec cites.
  - `chat.ts`:
    - append `| 'chat-closed'` to `ChatSendReason` (line 15), doc: `unavailable`;
    - add `export type ChatTranslateReason = 'translate-limit'` (`rate_limited`) next to it.
  - `checkout.ts`:
    - `export type CheckoutStartReason = 'pass-owned' | 'payments-off' | 'banned' | 'price-changed' | 'toasts-closed' | 'tier-off' | 'countries'`, with codes `pass-owned` `conflict` (existing doc line 73, Spec follow-up 2), `payments-off` `unavailable`, `banned` `forbidden`, `price-changed` / `toasts-closed` / `tier-off` `conflict`, `countries` `validation`; `price-changed` doc: "client re-reads `site`" (DR-13);
    - `export type CheckoutCancelReason = 'already-paid'` (`conflict`);
    - `CheckoutStartRequest.priceVersion?: number`;
    - `Order.price?: Money` (import `type { Money } from '@time2fest/contracts'`) and `Order.priceVersion?: number`;
    - append `| 'refunded'` to `OrderStatus`, with a doc saying it is not final and its display belongs to the payments wave;
    - **`isFinalOrder` body unchanged**, which already yields `false` for `refunded`.
  - `passport.ts`: `export type PassportClaimReason = 'claim-closed' | 'unknown-event'` (`conflict`, `not_found`).
  - `toasts.ts`: `export type ToastCheckReason = 'moderation'` (`validation`); the doc says the filter reasons stay `ToastIssue.kind`.
  - `profile.ts`:
    - `export type LinkGoogleReason = 'google-taken'` (`conflict`);
    - `ProfileSettings.reminderEmails?: boolean`, doc FR-PROF-11; the default is decided by the profile wave (OQ-3).
  - `rating.ts`: `export type RatingVoteReason = 'no-stamp' | 'closed' | 'not-open' | 'not-rated'`. The first three are the reasons already documented at `rating.ts:29`; `not-rated` is `forbidden`.
  - `auth.ts`: `Session.passNight?: NightId` (import `type { NightId } from '@/lib/data/types'`), doc FR-ID-15: the celebration the pass is for.
  - Do **not** touch any file under `lib/api/sim/**`.
- **Files:** `lib/api/contracts/{chat,checkout,passport,toasts,profile,rating,auth}.ts`.
- **Done means:**
  - web targeted is green on the 7 files;
  - `git diff master -- lib/api/contracts` contains only `+` lines plus the changed lines that append a union member (`ChatSendReason`, `OrderStatus`);
  - `git diff master --name-only -- lib/api/sim` is empty.
- **Verify:** web targeted (`{files}` = the 7 files).
- **Rules that apply:** `contract-conformance` → §4 non-breaking: new optional fields and reasons; the `refunded` member is reported as an enum widening that the client keeps non-final.
- **Risk:** an exhaustive `switch` or `Record` over a widened union would fail `tsc`. Research found none (`research-code.md:3-5`), and `tsc` is the check.

### W6 — Stream and system-message vocabulary (`lib/data/types.ts`, `live.ts`)
- **Serves:** AC-23, AC-28, AC-29, AC-30.
- **Do:**
  - `lib/data/types.ts`:
    - append to `SystemPayload` (lines 184-195) `| { kind: 'announcement'; text: string }` and `| { kind: 'time-pending'; eventId: string }`, each with a doc line (FR-CHAT-26; rendering belongs to the chat wave);
    - `StreamSource` (line 91) gains `override?: boolean`;
    - `StreamChain` (line 122) gains `version?: number`.
  - `lib/api/contracts/live.ts`:
    - add `version?: number` to both existing `StreamEvent` members;
    - add a member `| { type: 'hide'; eventId: string; sourceId: string; version?: number }` with a doc comment ("hide is ignored by this client — behaviour belongs to the live wave");
    - in `applyStreamEvent`, add the first statement `if (event.type === 'hide') return chains;` and extend its doc comment by one sentence.
- **Files:** `lib/data/types.ts`, `lib/api/contracts/live.ts`.
- **Done means:**
  - web targeted is green;
  - `tests/unit/api/live-sim.test.ts` and `live-hooks.test.tsx` pass unchanged;
  - `git diff master -- lib/data/types.ts` contains only added lines.
- **Verify:** web targeted (`{files}` = `lib/data/types.ts lib/api/contracts/live.ts`).
- **Rules that apply:** `contract-conformance` → §4: optional fields and a new event the client ignores are non-breaking.
- **Risk:** `lib/data/types.ts` is imported widely, but this change only adds lines; `tsc` covers it.

### W7 — Vocabulary tests
- **Serves:** checks AC-16 … AC-30.
- **Do:** create `tests/unit/api/seam-vocabulary.test.ts`.
  - **Type-level assignments, enforced by root `tsc`:**
    - each new literal assigned to its exported union (`const a: ChatSendReason = 'chat-closed'`, `ChatTranslateReason = 'translate-limit'`, every one of the 7 `CheckoutStartReason` members, `CheckoutCancelReason`, both `PassportClaimReason`, `ToastCheckReason`, `LinkGoogleReason`, `RatingVoteReason = 'not-rated'`);
    - both new `SystemPayload` objects, plus an array literal of the six existing kinds that still compiles;
    - `CheckoutStartRequest` and `Order` objects with and without the new fields;
    - `Session` with and without `passNight`;
    - `ProfileSettings` with and without `reminderEmails`;
    - a `StreamChain` with `version` and a `StreamSource` with `override`.
  - **Runtime:**
    - `isFinalOrder` for all seven statuses: `paid`, `declined`, `cancelled`, `expired` → `true`; `open`, `pending`, `refunded` → `false`;
    - `applyStreamEvent(chains, { type: 'hide', eventId, sourceId })` returns the same map (`toBe`), using a chain built as in `tests/unit/api/live-sim.test.ts:39-62`;
    - AC-27: the sim profile's settings object has no `reminderEmails` key (call the sim profile through `getService('profile')` the way `tests/unit/api/profile-hooks.test.tsx` obtains it).
- **Files:** `tests/unit/api/seam-vocabulary.test.ts`.
- **Done means:**
  - web targeted is green;
  - the AC-30 grep returns the same lines on the branch as on `master` (expected: none):
    ```
    git grep -nE "'(chat-closed|translate-limit|price-changed|toasts-closed|tier-off|already-paid|claim-closed|unknown-event|google-taken|not-rated|announcement|time-pending|refunded)'|priceVersion|reminderEmails|passNight|override\b|type: 'hide'" -- lib/api/sim ':!lib/api/sim/site.ts'
    ```
    Run it on the work tree and compare with the same pattern via `git grep … master -- lib/api/sim`.
- **Verify:** web targeted (`{files}` = `tests/unit/api/seam-vocabulary.test.ts`).
- **Rules that apply:** `engineering-paved-path:react-testing-library` → use few, meaningful tests; static analysis carries the type checks.
- **Risk:** low.

### W8 — Additive-only contract check (tool, tests, baseline)
- **Serves:** AC-38, AC-39, AC-40, AC-41; enables AC-42.
- **Do:** create `scripts/contract-surface.mjs`. It is ESM, uses `typescript` (root devDep) and `node:fs` / `node:path` / `node:url`, and runs on Node 22.
  - **CLI:**
    - `--check` (default), `--update`, `--update --breaking`;
    - `--root <dir>` (default: the parent of the script's own directory, so it works from `packages/contracts` too);
    - `--baseline <file>` (default `<root>/scripts/contract-surface.baseline.json`).
    - Exit codes: `0` ok, `1` violation or mismatch, `2` usage or IO error.
  - **Covered surfaces** (relative to root), per AC-38:
    - every `*.ts` under `packages/contracts/src/`;
    - every `*.ts` in `lib/api/contracts/`;
    - every declaration of `lib/data/types.ts` reachable (transitively) from those exports.
    - Build a `ts.createProgram` over the covered files with `{ strict: true, skipLibCheck: true, noEmit: true, types: [], moduleResolution: Bundler, module: ESNext, target: ES2022, baseUrl: root, paths: { '@/*': ['./*'], '@time2fest/contracts': ['./packages/contracts/src/index.ts'] } }`.
  - **Descriptor per exported declaration**, keyed `<file>#<Name>`:
    - interface or object type → `props: { name: { optional, type: <descriptor> } }`;
    - union of literals → `union: [sorted literal texts]`;
    - union with object members discriminated by a literal `type` or `kind` property → `variants: { <discriminant>: <object descriptor> }`;
    - reference to a covered or reachable named declaration → `ref: <key>`;
    - function → `fn: <signature text>`;
    - anything else → `text: checker.typeToString(...)`.
    - Inline nested object and union types are described recursively. Output is sorted for stable diffs.
  - **Classification** of current versus baseline:
    - **Breaking:** a declaration, property, union member or variant was removed; `optional: true` became `false`; or any other changed `text` / `fn` / `ref` (Spec follow-up 3).
    - **Additive:** a new declaration, property, union member or variant.
    - **Equal.**
  - **Output:**
    - `--check` with any breaking change → exit 1, with one line per change naming `file#Decl[.prop|member]` and the kind (AC-38).
    - `--check` with only additive changes → exit 1, printing `Contract surface grew but the baseline is not refreshed. Run: node scripts/contract-surface.mjs --update` (AC-40).
    - `--check` with nothing changed → exit 0.
    - `--update` with additive changes only → write the baseline, exit 0 (AC-39 then holds on the next `--check`).
    - `--update` with any breaking change → exit 1 and tell the user to re-run with `--update --breaking`.
    - `--update --breaking` → write the baseline and append to its `breaking` array `{ recordedAt: <ISO>, changes: [<the lines above>] }`, exit 0 (AC-41).
  - **Baseline file:** `{ "version": 1, "surfaces": {…}, "breaking": [] }`, written with `\n` line endings.
  - **Tests:** create `tests/unit/contract-surface.test.ts` (`// @vitest-environment node`). Each case builds a minimal fixture tree in `fs.mkdtempSync(os.tmpdir())`, containing `packages/contracts/src/index.ts`, `lib/api/contracts/x.ts` and `lib/data/types.ts`. It runs `spawnSync(process.execPath, [script, '--root', dir, '--baseline', file, …])` and asserts exit codes and stdout:
    1. a removed field, a removed union member, and `?` removed → each exits non-zero and its name appears (AC-38);
    2. a new optional field plus a new reason with `--update`, then `--check` → exits 0 (AC-39);
    3. the same addition without `--update` → `--check` fails and stdout contains `--update` (AC-40);
    4. a breaking fixture: `--update` alone fails; `--update --breaking` succeeds, then `--check` exits 0 and the baseline JSON `breaking[0].changes` names the declaration (AC-41).
  - **Generate the real baseline last:** `node scripts/contract-surface.mjs --update`, then `node scripts/contract-surface.mjs --check` exits 0.
- **Files:** `scripts/contract-surface.mjs`, `scripts/contract-surface.baseline.json`, `tests/unit/contract-surface.test.ts`.
- **Done means:**
  - the 4 test cases pass;
  - `node scripts/contract-surface.mjs --check` exits 0 from the root;
  - `cd packages/contracts && node ../../scripts/contract-surface.mjs --check` exits 0;
  - the baseline contains keys for `packages/contracts/src/site.ts#SiteState` and `lib/data/types.ts#SystemPayload`, and none for `lib/data/types.ts#GuestState` unless it is reachable.
- **Verify:** web targeted (`{files}` = `scripts/contract-surface.mjs tests/unit/contract-surface.test.ts`).
- **Rules that apply:**
  - `contract-conformance` → §4: the definition of breaking;
  - `engineering-paved-path:security` → A05: spawn with an argument array, never `shell: true`.
- **Risk:**
  - Program creation over the real contracts pulls their transitive imports (`lib/chat/message`, `lib/toast/*`), which is slower but correct.
  - If the descriptor for a covered type is unstable between runs (ordering), `--check` flaps. Mitigate by sorting every collection.

### W9 — Real `verify` commands for `contracts` and `rules`; additive check in `web` full
- **Serves:** AC-42, AC-43, AC-44, AC-45, NFR-5.
- **Do:** edit `.claude/sdd-engineering.json`.
  - **`web.full`:** insert `node scripts/contract-surface.mjs --check && ` right after `npx tsc --noEmit -p . && `. Leave `web.files` unchanged.
  - **Replace the `contracts` entry:**
    - `dir` `packages/contracts`;
    - `files`: `npx tsc --noEmit -p . && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`;
    - `full`: `npx tsc --noEmit -p . && npx vitest run --maxWorkers=2 && node ../../scripts/contract-surface.mjs --check`.
  - **Add a `rules` entry after `contracts`:** `dir` `packages/rules`, `files` `npx tsc --noEmit -p .`, `full` `npx tsc --noEmit -p .`.
  - **`server` entry:** byte-identical.
  - Keep 2-space JSON formatting.
- **Files:** `.claude/sdd-engineering.json`.
- **Done means:**
  - in `packages/contracts`, both new commands exit 0 (`files` with `{files}` = `src/site.ts`);
  - in `packages/rules`, both exit 0;
  - `git diff master -- .claude/sdd-engineering.json` shows no change inside the `server` object;
  - both `full` strings contain `contract-surface.mjs --check`;
  - every vitest command contains `--maxWorkers=2`.
- **Verify:** run the four commands above, output to a file, `tail -40`.
- **Rules that apply:** `sdd-format` §1: the verify entry shape.
- **Risk:** low.

### W10 — GitHub Actions workflow
- **Serves:** AC-34, AC-35, AC-36, AC-37, NFR-4.
- **Do:** create `.github/workflows/verify.yml`:
  - `name: verify`;
  - `on: push` (no branch filter);
  - `permissions: { contents: read }`;
  - `concurrency: { group: verify-${{ github.ref }}, cancel-in-progress: true }`;
  - a single job `verify` on `runs-on: ubuntu-latest` with these steps:
    1. `actions/checkout@v6` with `persist-credentials: false`;
    2. `actions/setup-node@v7` with `node-version: 22`. Action majors are taken from `research-vercel.md:9`. If either major does not exist when the implementer checks `gh api repos/actions/checkout/releases/latest --jq .tag_name` (and the same for `setup-node`), use the latest existing major and say so in the report.
    3. `npm install -g pnpm@12.4.2` (the local version recorded in W1). This deliberately avoids `pnpm/action-setup`: no `packageManager` field (Non-goal), and pnpm ≥11 support in that action is not established (`research-vercel.md:9`).
    4. `pnpm install --frozen-lockfile`;
    5. `web full`: the exact `full` string of the `web` entry;
    6. `contracts full`: `working-directory: packages/contracts`, exact string;
    7. `rules full`: `working-directory: packages/rules`, exact string.
  - No `continue-on-error`, no cache step, no `secrets.`.
  - A header comment says the commands mirror `.claude/sdd-engineering.json` and must change with it.
- **Files:** `.github/workflows/verify.yml`.
- **Done means:**
  - `grep -nE "playwright|test:e2e|storybook" .github/workflows/verify.yml` is empty;
  - `grep -n "secrets\." …` is empty;
  - `grep -n "continue-on-error" …` is empty;
  - the file contains `contents: read`, `cancel-in-progress: true` and `on: push`;
  - the three run strings equal the three `full` strings in `.claude/sdd-engineering.json` (compare with `node -e` reading both).
  - AC-34 … AC-36 runtime behaviour is checked by the orchestrator on the first push after merge (manual per spec).
- **Verify:** the greps above. There is no YAML linter in the project, so a syntax check is `node -e "…"` only if a YAML parser is already present in `node_modules` (`yaml` is a transitive dependency of several tools; check with `node -p "require.resolve('yaml')"`). If none is present, report the syntax check as `not run`.
- **Rules that apply:** `engineering-paved-path:security` → A01/A02: least-privilege token (`contents: read`, `persist-credentials: false`); A03: pinned tool versions; secrets: none referenced.
- **Risk:** `next build` in CI runs in `http` mode (`next.config.ts:12-17`), the same as the local `web` full, so it should not regress. The token sync is skipped in CI (EC-11, `scripts/sync_tokens.mjs:16-19`).

### W11 — Full verification and static checks (no file changes)
- **Serves:** checks AC-1, AC-2, AC-4, AC-6, AC-15, AC-30, AC-31, AC-43, AC-44, NFR-1, NFR-3; it is the single `full` run per package after the last edit (`sdd-format` §6).
- **Do:**
  - Run the three `full` commands from `.claude/sdd-engineering.json`: `web` in `.`, `contracts` in `packages/contracts`, `rules` in `packages/rules`. Each writes its output to a scratch file; read `tail -40`.
  - Then run the static checks:
    - `pnpm -r ls --depth -1` (AC-1);
    - `git diff master -- vercel.json` is empty (AC-4);
    - `git status --porcelain` and `git diff master --name-only`: every path must be in this plan's Affected surface, or be `docs/plans/SPEC-01-workspace-seam.plan.md` or `docs/specs/**` (AC-6). Untracked files appear in `git status`, so list them too.
    - `git diff master --name-only -- components app styles messages lib/engine` is empty, and `git diff master -- stores` is empty (AC-31);
    - the AC-15 grep from W4 and the AC-30 grep from W7;
    - `git diff master -- package.json` touches `dependencies` by one `workspace:*` line only (NFR-1);
    - the NFR-3 grep from W3.
- **Files:** none.
- **Done means:**
  - all three `full` commands exit 0;
  - every static check above holds.
  - A build-script side effect on tracked files (e.g. `public/yt/**` from `sync_yt_loader`) is listed and restored with `git restore <path>` only if it is generated output not in the wave list.
- **Verify:** as in **Do**.
- **Rules that apply:** `sdd-format` §6: `full` once after the last edit.
- **Risk:** `next build` in `web` full is the heaviest step (~16 GB machine). Run nothing else in parallel.

### W12 — AC-3 local Vercel proof with pnpm 9, 10 and 12 (no file changes)
- **Serves:** AC-3 (and EC-1, EC-2, EC-3).
- **Do:** *(orchestrator amendment)* NOT in the worktree (it sits inside `web/`, so Node would fall back to the parent `web/node_modules` and hide a missing dependency). Requires P1–P4 committed on the branch. Make a clean clone OUTSIDE `web/`: `git clone -q --branch spec-01-workspace-seam "<worktree path>" "$SCRATCH/vercel-proof"` and run everything below from `$SCRATCH/vercel-proof`; delete that folder at the end. Three runs in this order: pnpm 9, pnpm 10, then local 12. Before each run, remove `node_modules`, `packages/contracts/node_modules`, `packages/rules/node_modules`, `out-demo` and `.next-demo` with `rm -rf` (inside the clone only).
  - Run 1:
    ```
    npx --yes pnpm@9 --version
    npx --yes pnpm@9 install --frozen-lockfile > "$SCRATCH/ac3-p9-install.txt" 2>&1; echo exit=$?
    npx --yes pnpm@9 build:demo > "$SCRATCH/ac3-p9-build.txt" 2>&1; echo exit=$?
    test -f out-demo/index.html && echo OK
    git status --porcelain pnpm-lock.yaml
    ```
    The last command must print nothing: `--frozen-lockfile` never rewrites the lockfile.
  - Run 2: the same with `pnpm@10`.
  - Run 3: the same with plain `pnpm` (12.4.2).
  - Report each version string, both exit codes, the presence of `out-demo/index.html`, and the `tail -40` of any non-zero run.
  - **If pnpm 9 or 10 rejects the lockfile, STOP and report BLOCKED with the error.** Do not change `vercel.json` (AC-4), do not add `packageManager` (Non-goal), and do not regenerate the lockfile with another pnpm version; the orchestrator takes it to the owner.
- **Files:** none (generated folders only).
- **Done means:** for each of the three versions, `install --frozen-lockfile` and `build:demo` exit 0, `out-demo/index.html` exists, and `pnpm-lock.yaml` is unmodified.
- **Verify:** as in **Do**.
- **Rules that apply:** `engineering-paved-path:security` → A03: install only from the frozen lockfile.
- **Risk:**
  - `npx pnpm@9` / `@10` downloads pnpm from npm (network required).
  - pnpm 10 skips unlisted build scripts (EC-2). The build must still pass, as it does on Vercel today.
  - Running in a clone outside `web/` removes the nested-worktree fallback for this proof; CI remains the definitive check.

### W13 — e2e suite unchanged (AC-32) and `http` bundle guard (NFR-2) (no file changes)
- **Serves:** AC-32, NFR-2.
- **Do:**
  1. **Preflight.** `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/` and the same for `:3100` must fail to connect. `playwright.config.ts:24,31` has `reuseExistingServer: true`, so a server from the main checkout or another worktree would be silently tested instead of this code. If either port answers, STOP and report BLOCKED. Do not kill other sessions' servers.
  2. **Run the full suite once.** All projects, because the config starts both web servers for any project selection (`playwright.config.ts:20-33`); the `prod` project runs the bundle guard `tests/e2e/us8-production.prod.spec.ts` with `tests/e2e/helpers/bundle.ts`.
     ```
     npx playwright test --workers=2 > "$SCRATCH/e2e.txt" 2>&1; echo exit=$?; tail -40 "$SCRATCH/e2e.txt"
     ```
  3. On a red test, re-run only that file with `--project=<its project> --workers=1` to read the real failure (`sdd-format` §6). Report it; do not edit `tests/e2e/**`.
  4. `git diff master -- tests/e2e` must be empty.
  5. Restore build side effects on tracked files as in W11.
- **Files:** none.
- **Done means:** Playwright exits 0, and `git diff master -- tests/e2e` is empty.
- **Verify:** as in **Do**.
- **Rules that apply:** skill `layout-fidelity` §5 (e2e with `--workers=2`); `sdd-routing.md` §7: at most 2 heavy processes, so nothing else runs in parallel.
- **Risk:** long run, and the `prod` web server runs `pnpm build` (writes `out/`). Flaky timing tests have existed (commit `142d58b`). A flaky failure is re-run once by file; report both results.

### W14 — Reference-board check of the sim build (AC-33), one capture run (no file changes in `web/`)
- **Serves:** AC-33.
- **Do:**
  - Paths: `BT = D:/Work/Pets/Time2Fest/docs/bmad/planning-artifacts/ux-designs/ux-Time2Fest-2026-10-21/board-tools`; `TMP` = a new folder in the session scratchpad.
  1. **Board sample** (skill `layout-fidelity` §2, "site/catalog → all: one state per page × 4 bps"). Write `TMP/_fid-spec01.json` with a short node script in the scratchpad. It reads `BT/manifests/batch-*.json` and takes, for each page `01` … `16`, the first entry that has no `steps` and no `simFail` / `simDelay` in `url`, keeping that entry's `bps`. Keep the manifest wrapper shape of the source batch (whatever keys `snapshot.mjs` expects alongside the entries) so `_common.json` defaults still apply. Expect about 16 entries and at most 64 boards. List the ids in the report.
  2. **Server.** Start a sim test dev server from this worktree on a free port with its own build folder, in the background:
     ```
     NEXT_DIST_DIR=.next-fid npx cross-env NEXT_PUBLIC_ENV=test next dev -p 3041
     ```
     Wait for `http://localhost:3041/` to answer 200. Do not run it at the same time as W13.
  3. **Capture once:**
     ```
     node "$BT/snapshot.mjs" --manifest "$TMP/_fid-spec01.json" --base http://localhost:3041 --web <worktree root> --shots "$TMP/shots" --project "$TMP/project" > "$TMP/snap.txt" 2>&1; tail -40 "$TMP/snap.txt"
     ```
     Then delete `BT/reports/_fid-spec01.json` (the script writes it; skill `layout-fidelity` §4.4).
     Never write into `BT/shots/` or `BT/../reference-boards/`.
  4. **Compare with the reference live shots.** Copy `BT/shots/<id>.live.png` for exactly the captured ids into `TMP/ref/`, and `TMP/shots/<id>.live.png` into `TMP/new/`. Then run `node scripts/baseline-shots.mjs diff "$TMP/ref" "$TMP/new"` (existing tool, `scripts/baseline-shots.mjs:9,105-157`). It writes `TMP/new/diff.json`.
  5. **Triage.**
     - Boards ≤ 0.1 % pass.
     - Boards between 0.1 % and 0.5 % go to `fidelity-triager` (Sonnet) with the ids, percentages and three image paths. The orchestrator dispatches it if the implementer cannot.
     - Anything above 0.5 % is reported as a defect with its id.
     - **Never change layout, tolerance or thresholds** (`layout-fidelity` §1).
  6. Stop the dev server, delete `.next-fid`.
- **Cost:** one dev-server compile (~1-2 min) plus about 64 boards at ~5-10 s each, about 10-15 min. One Chromium. Run only once (brief).
- **Files:** none in `web/` (scratch only). The transient `BT/reports/_fid-spec01.json` is deleted.
- **Done means:**
  - the report holds the `layout-fidelity` §7 table;
  - 0 boards above 0.1 % (AC-33), or every board above 0.1 % is listed with its triage class for the orchestrator.
  - A board that differs because the reference predates `master` (not because of this wave) is shown by class, not hidden.
- **Verify:** as in **Do**.
- **Rules that apply:** skill `layout-fidelity` §1 (never fix by layout, never raise thresholds), §4.6 (one capture at a time), §6 (thresholds), §7 (report); `sdd-routing.md` §6: read only the PNGs of flagged ids.
- **Risk:**
  - `snapshot.mjs`'s manifest wrapper shape is not verified by this plan; adapt the subset file to whatever shape the batch files use.
  - If the run fails for tooling reasons, report AC-33 as `not run` with the error, never as passed.

### W15 — Docs patch for `frontend-seam.md` §3.11 in the wave report (no file changes)
- **Serves:** AC-46.
- **Do:**
  - Read `D:/Work/Pets/Time2Fest/docs/backend/frontend-seam.md` lines 215-255 only (heading-targeted read, `sdd-routing.md` §6).
  - In the phase report, write a unified-diff-style patch, in Ukrainian per `sdd-routing.md` §3, that:
    - adds the `site` row: `GET /api/site/state`, Centrifugo `site:state`, marked proposed;
    - adds the eight routes listed at `frontend-seam.md:242-249` to the §3.11 table (each row: domain, HTTP, Centrifugo).
  - **Edit no file outside `web/`**, and do not edit `frontend-seam.md`; the orchestrator applies the patch from the main session.
- **Files:** none.
- **Done means:**
  - the report contains the patch with 9 added rows;
  - `git -C D:/Work/Pets/Time2Fest status` is not applicable (the root is not git), so instead the implementer states that it wrote no file outside the worktree. Its tool log shows no Write/Edit outside the worktree except scratch files.
- **Verify:** orchestrator review (manual per spec).
- **Rules that apply:** `contract-conformance` §1 (routes list is §3.11); skill `docs-sync` is the orchestrator's, not the implementer's.
- **Risk:** low.

## Execution
Single-agent: each phase is a fresh `sdd-engineering:implementer` dispatch with this plan's path and the phase id. Phases run strictly in order; nothing in parallel (16 GB machine, `sdd-routing.md` §7).

| Lane / phase | Executor | Model | Work items | Files (disjoint) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — workspace + error model | `sdd-engineering:implementer` | sonnet | W1, W2 | `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package.json`, `tsconfig.json`, `next.config.ts`, `packages/contracts/{package.json,tsconfig.json,vitest.config.ts,src/index.ts,src/result.ts,test/result.test.ts}`, `packages/rules/**`, `lib/api/result.ts` | — | — | this worktree; `pnpm install` is the only generator; no other process may run |
| P2 — `site` domain | `sdd-engineering:implementer` | sonnet | W3, W4 | `packages/contracts/src/{site.ts,index.ts}`, `packages/contracts/test/site.test.ts`, `lib/api/contracts/site.ts`, `lib/api/sim/{site.ts,index.ts}`, `lib/api/services.ts`, `lib/api/hooks/site.ts`, `tests/unit/api/site-{sim,hooks}.test.*` | P1 | — | this worktree |
| P3 — seam vocabulary | `sdd-engineering:implementer` | sonnet | W5, W6, W7 | `lib/api/contracts/{chat,checkout,passport,toasts,profile,rating,auth,live}.ts`, `lib/data/types.ts`, `tests/unit/api/seam-vocabulary.test.ts` | P2 (`Money` import from the package) | — | this worktree |
| P4 — additive check, config, CI | `sdd-engineering:implementer` | sonnet | W8, W9, W10 | `scripts/contract-surface.mjs`, `scripts/contract-surface.baseline.json`, `tests/unit/contract-surface.test.ts`, `.claude/sdd-engineering.json`, `.github/workflows/verify.yml` | P3 (baseline captures the final surface) | — | this worktree |
| P5 — proof | `sdd-engineering:implementer` | sonnet | W11, W12, W13, W14, W15 | none (generated folders, scratch) | P4 | — | this worktree; W12 deletes and reinstalls `node_modules`; W13 and W14 each run alone (ports 3000/3100, then 3041) |

All phases are Sonnet: every item is mechanical. The one judgement-heavy item, W8 (surface descriptors), has a fully specified algorithm and black-box tests. Escalation to Opus follows `run-plan-auto` §3 if W8 fails its tests twice.

## Verification plan
| Command | Directory | Passing means |
|---|---|---|
| `npx tsc --noEmit -p . && node scripts/contract-surface.mjs --check && npx eslint . && npx vitest run --maxWorkers=2 && node scripts/sync_tokens.mjs --check && npx cross-env NEXT_DIST_DIR=out-verify next build` (web `full` after W9) | `.` | exit 0 |
| `npx tsc --noEmit -p . && npx vitest run --maxWorkers=2 && node ../../scripts/contract-surface.mjs --check` (contracts `full`) | `packages/contracts` | exit 0 |
| `npx tsc --noEmit -p .` (rules `full`) | `packages/rules` | exit 0 |
| `pnpm -r ls --depth -1` | `.` | exactly the three projects |
| `npx --yes pnpm@9 install --frozen-lockfile && npx --yes pnpm@9 build:demo`; same with `pnpm@10`; same with local `pnpm` | `.` (clean `node_modules` before each) | 6 × exit 0, `out-demo/index.html` after each, `pnpm-lock.yaml` unmodified |
| `npx playwright test --workers=2` | `.` (ports 3000/3100 free beforehand) | exit 0; `git diff master -- tests/e2e` empty |
| `node $BT/snapshot.mjs --manifest $TMP/_fid-spec01.json --base http://localhost:3041 --web . --shots $TMP/shots --project $TMP/project` then `node scripts/baseline-shots.mjs diff $TMP/ref $TMP/new` | `.` | 0 boards > 0.1 % (or each listed with triage class) |
| static greps of W11 (vercel.json, file list, AC-31 folders, AC-15, AC-30, NFR-1, NFR-3) and W10 (AC-37, NFR-4) | `.` | each as stated in the item |

## Assumptions
Technical judgement calls only:
- **Error model placement.** The package exports TS source with no build step (DR-17), and `transpilePackages` is added as a safeguard for Turbopack and the Storybook webpack build (`research-vercel.md:7`).
- **Root `tsc` also typechecks `packages/**`** through `include: ["**/*.ts"]` (`tsconfig.json:34`). That is a stricter, harmless double check, so packages are not excluded.
- **Packages declare `typescript` / `vitest` as their own devDependencies** at the root versions, so `npx` finds local bins inside each package and does not download them.
- **`applySiteEvent` takes the channel event** (`{ type: 'snapshot', state }`) rather than a bare snapshot, so the channel can later gain delta events without a signature change (DR-20). AC-8 and AC-9 are expressed on `event.state.version`.
- **Buffering for AC-12 lives in the `site` hook's resource source** (`lib/api/hooks/site.ts`), not in the shared `lib/api/resource.ts`, so no other domain's behaviour changes.
- **`catalogVersion` in sim** = `` `${meta.generatedAt}+${meta.tzdbVersion}` `` per `catalog.ts:15` (Spec follow-up 1). The sim `at` is `new Date(0).toISOString()` and `version` is `1`, constants that make tests deterministic and are not visible anywhere.
- **Session field name `passNight?: NightId`** (`lib/data/types.ts:247`). Reminder flag name `reminderEmails?: boolean`. Money type `{ amount; currency: 'USD' }` is shared by `site` products and `Order.price`.
- **`RatingVoteReason` includes the three reasons already documented** at `rating.ts:29`, plus `not-rated`, and `CheckoutStartReason` keeps `pass-owned` as `conflict`.
- **The additive check is a Node script at `scripts/contract-surface.mjs`** with its baseline at `scripts/contract-surface.baseline.json`. Neither lives under `packages/`, so the NFR-3 grep for `../../` in `packages/**` stays empty. Its tests drive the CLI as a black box, so no type declarations for the `.mjs` are needed.
- **The CI installs pnpm with `npm install -g pnpm@12.4.2`** rather than `pnpm/action-setup` (no `packageManager` field; that action's pnpm ≥11 support is not established).
- **AC-33 uses `scripts/baseline-shots.mjs diff`** for live-versus-live comparison, because `BT/compare-live.mjs` does not exist (Spec follow-up 5).

## Open questions
None.

## Research used
- `C:/Users/ADMIN/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/side-session-notes/local_359ad0f2-bcef-4e10-835b-0930d88a93eb/spec-01/research-code.md` (codebase facts: reason locations, `SystemPayload`, registry, no snapshot tool, workspace effects).
- `…/spec-01/research-vercel.md` (pnpm versions on Vercel, `allowBuilds`, `transpilePackages`, GitHub Actions versions, local proof recipe).
- No planner researchers were dispatched (brief: facts already established).
- Spot-checked by the planner in this worktree:
  - `lib/api/result.ts`, `services.ts`, `sim/index.ts`, `sim/faults.ts`, `resource.ts`;
  - `contracts/{checkout,live,rating,catalog}.ts`;
  - `lib/data/types.ts:170-215, 413`;
  - `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.mjs`;
  - `tests/unit/api/mode.test.tsx`, `tests/e2e/helpers/bundle.ts`, `scripts/baseline-shots.mjs`, `scripts/sync_tokens.mjs`;
  - `BT/snapshot.mjs` options, `BT/README.md:1-60`;
  - local `pnpm --version` = 12.4.2.

## Rollback / blast radius
- Nothing is committed by the run. Rollback = discard the worktree changes (`git restore` / `git clean` on the files of the Affected surface) and `rm -rf node_modules packages`.
- Blast radius if merged:
  - **Vercel demo:** install or build of the demo. Proven by W12; Vercel keeps the previous deploy on failure.
  - **Every importer of `@/lib/api/result`:** covered by root `tsc` and the full unit suite.
  - **Widened unions:** `OrderStatus`, `ChatSendReason`, `SystemPayload`, `StreamEvent`, covered by `tsc`, the unit suite and e2e.
  - **CI:** a new workflow on every push. Private-repo minutes are OQ-2.
- No runtime behaviour of the site changes (AC-31, AC-32, AC-33).
