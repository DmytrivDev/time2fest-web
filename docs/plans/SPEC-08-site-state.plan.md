# Implementation plan: Site state, edge cache, red button — `site` snapshot, toggle-with-reason, products port, Worker cache with source order and R2, red button, catalog rebuild with freeze window, event-moment patches in open tabs (SPEC-08)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-08-site-state.md` (Status: approved; checker: 0 markers, 0 violations; Open questions 1–4 non-blocking, `:800-807`). AC-1 … AC-72 (`:217-504`), NFR-1 … NFR-5 (`:533-549`), contracts `:605-650`, owner decisions В1–В6 (`:20-48`), session decisions С1–С14 (`:54-109`).
This plan implements those requirements; it does not define or change them.
**Execution mode** — ACCELERATED: one conductor session with a small context, a fresh `sdd-engineering:implementer` per phase (dispatched with this plan's path and the phase id), **at most two lanes at once** — chosen by the orchestrator for the owner (brief of 2026-11-20). Lanes: **S** (`packages/contracts`, `server/**`, `server/.env.example`) and **C** (client side: first `workers/edge/**`, then the site root `lib/**`, `components/**`, `tests/**`, `.github/workflows/deploy.yml`, `infra/ops/test/workflow.test.mjs`). Phase **L** is run by the wave lead (main session); phase **RH** only after the owner's «так» (spec08-q3, В5) and is **not a merge condition**.
**Out of scope** — the spec's Non-goals (`:161-179`): `import products`, any PayPro call or key, the real products adapter (SPEC-17); consumer refusals `chat-closed`, product-off, `tier-off` and the visible toggle states (SPEC-15/17/18); chain polling and the chains public-address row (SPEC-12); what `hidden` does on air pages (SPEC-12); hit ratio ≥99 % and multi-region spike 2 (SPEC-23); production keys, `T2F_REBUILD_PRODUCTION=1`, production realtime flag (SPEC-22); any Cloudflare zone change (cache rules, `cf.cacheTtl`, `[cache]`, DNS, bucket domain); the banner on layouts without `OfflineNotice` (Open question 1). Architecture and security review are separate agents (`security-reviewer` mandatory: public cacheable route, red button input, purge/dispatch tokens, test doors).

Repository root for every path = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-08-site-state` (branch `spec-08-site-state`, base `9d18cf7`).
- **Do not commit, never push** (the conductor commits after each phase). **Never stage `tsconfig.json`** (root or server). `server/src/payload-types.ts` already shows as modified (LF rewrite, gotcha `docs/knowledge/gotchas.md:10`) — regenerate it only in W6.
- **Never touch another session's files:** `lib/prelaunch/**`, `content/prelaunch/**`, `workers/prelaunch/**`, `scripts/prelaunch/**`.
- Never read: `research_data/**`, `docs/archive/**`, `Old Project/**`, `reference-boards/**`, `graphify-out/graph.json`, `out*/`, `.next*/`, `node_modules` (except `.d.ts`/`package.json` lookups), `pnpm-lock.yaml`, `.env*` contents (`server/.env.example` holds names only and may be read), `dashboard/secrets/**`.
- **No PayPro anywhere:** no call, no URL, no env var, no key (В1). **No Cloudflare zone change**, no `wrangler deploy`, no real purge or dispatch call outside RH. New env vars only as names: `T2F_CF_PURGE_TOKEN`, `T2F_CF_ZONE_ID`, `T2F_SITE_URL`, `T2F_GITHUB_DISPATCH_TOKEN`, `T2F_REBUILD_PRODUCTION` — the exact set of spec `:645-650`, all optional in every class.
- Machine: 16 GB. Vitest always `--maxWorkers=2`; Playwright `--workers=2`. Local stack **slot 16**: server `http://127.0.0.1:4160`, integration web `4161`; DB `t2f_spec_08_site_state` (created and seeded) and `t2f_spec_08_site_state_test`. Port 3000 may be taken by a foreign process — no test binds it; fakes listen on port 0.
- **Each phase runs only its targeted checks** (config `files` command of the package + the named test files). No phase runs a `full` verify; L runs it once.
- **No new dependency in this wave** (wrangler 4.149.0 with `createTestHarness`, `@cloudflare/workers-types`, `centrifuge`, `zod`, `react-dom` are already installed; root `package.json:69,101`). `pnpm install` is never run.
- Paths marked **(to confirm)** were not opened by the planner; the implementer checks them with Grep before editing and keeps the plan's intent.

## Conductor decisions (2026-11-20)

- **[А-1]** Rebuild launch uses `workflow_dispatch` of `deploy.yml` (fine-grained token "Actions: write" — same as the owner's board task), not `repository_dispatch` ("Contents: write"). Resolves follow-up 3; AC-67 reads «workflow accepts the catalog-changed launch».
- **[А-2]** Purge after commit = one `purge_cache` request with `{"tags":["t2f-site-state"]}`; the edge stores `Cache-Tag: t2f-site-state` (W28). Resolves follow-up 2 in code; RH still measures it. AC-33 «one request» holds; the address becomes the tag.
- **[А-3]** Follow-ups 1, 4, 5, 6 accepted as the plan describes (snapshot in `data`; `R2_PREFIX`; `GET /cms-api/site/view` owner-only; prelaunch build serves the build snapshot with no network and **no visible change** — the prelaunch site must not change look).

## Requirements traceability

"int" = server integration file under the shared lock; "Mf" = edge test (Node handler test with injected cache/bucket/clock, plus the workerd harness file); "L" = wave-lead pass; "RH" = rehearsal step after the owner's «так».

| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | zod schemas `SiteState`/`SiteEvent`, optional `outage`, additive only | `:217` | W1, W4 | W1 Done; W4 (surface check) |
| AC-2 | `site` contract suite same on sim and http | `:229` | W35 | W35 Done (sim); L (http run) |
| AC-3 | `GET /api/site/state` 200, `Cache-Control: public, max-age=10`, no `Set-Cookie` with session cookie | `:232` | W17, W21 | W21 Done (int) |
| AC-4 | version +≥1 in the change's transaction; concurrent changes distinct | `:240` | W8, W9, W10, W16 | W16 Done (int) |
| AC-5 | publish `site:state` snapshot ≤1 s after commit | `:243` | W12, W16 | W16 Done (int) |
| AC-6 | rollback → no publish, no purge, no R2 | `:246` | W12, W16 | W16 Done (int) |
| AC-7 | publish `unavailable`/`rejected` → change kept, one `site/publish-failed` | `:249` | W12, W16 | W16 Done (int) |
| AC-8 | `eventPatches[id]` = saved patch | `:252` | W7, W12, W21 | W21 Done (int) |
| AC-9 | `catalogVersion` = `catalogVersionOf(meta)` after change | `:255` | W10, W12, W21 | W21 Done (int) |
| AC-10 | switches change only via toggle-with-reason (REST write refused) | `:260` | W5, W18, W21 | W21 Done (int) |
| AC-11 | reason empty or >200 → `invalid` | `:263` | W7, W11 | W11 Done |
| AC-12 | one journal row (actor, before/after, reason, mode), one-step revert | `:266` | W9, W21 | W21 Done (int) |
| AC-13 | `auto` never lifts a manual payments pause (table) | `:274` | W7, W11 | W11 Done |
| AC-14 | `auto` for any key but `payments` → `forbidden` | `:285` | W7, W11 | W11 Done |
| AC-15 | one `isEnabled`, same table on server and site | `:288` | W2, W11, W35 | W2, W11, W35 Done |
| AC-16 | non-owner → `forbidden` | `:297` | W18, W21 | W21 Done (int) |
| AC-17 | admin slice: 9 switches, pause mode, reason, product choice ×4, empty-port text | `:300` | W22, W24 | W24 Done |
| AC-18 | `products` only from the port; default empty in every class | `:311` | W8, W20, W21 | W21 Done (int) |
| AC-19 | product choice → its price, `priceVersion` +1 | `:314` | W7, W9, W21 | W21 Done (int) |
| AC-20 | unknown / other-key product → `invalid` | `:317` | W7, W21 | W11, W21 Done |
| AC-21 | no route/action/door creates a product or sets an amount | `:320` | W5, W18, W19, W21 | W21 Done (int) |
| AC-22 | no PayPro call, no PayPro env var | `:323` | W15 | W15 Done |
| AC-23 | one public-address list for server rows and Worker | `:328` | W3, W17, W30 | W21 (server half), W30 (edge half) Done |
| AC-24 | foreign query params dropped from cache key and origin request | `:331` | W28, W30 | W30 Done (Mf) |
| AC-25 | copy ≤10 s served without origin | `:334` | W28, W30, W32 | W30, W32 Done (Mf) |
| AC-26 | >10 s → serve and refresh in background once | `:337` | W28, W30 | W30 Done (Mf) |
| AC-27 | origin failure → stale copy ≤30 s past freshness | `:340` | W28, W30 | W30 Done (Mf) |
| AC-28 | no stale copy → R2 copy, `x-t2f-source: r2` | `:347` | W28, W30, W32 | W30, W32 Done (Mf) |
| AC-29 | nothing → existing `503 unavailable` | `:350` | W28, W30 | W30 Done (Mf) |
| AC-30 | no `Set-Cookie` from any source | `:353` | W28, W30, W32 | W30, W32 Done (Mf) |
| AC-31 | non-public paths never cached | `:356` | W28, W30 | W30 Done (Mf) |
| AC-32 | no `[cache]` in any wrangler env | `:359` | W31 | W31 Done |
| AC-33 | purge request ≤2 s after commit when token set | `:364` | W13, W16 | W16 Done (int) |
| AC-34 | no token → skip + `site/purge-skipped`; boot never fails | `:367` | W13, W15, W16 | W15, W16 Done |
| AC-35 | purge retries 30 s, 120 s; `site/purge-failed` (`log`) | `:370` | W13, W16 | W16 Done (int) |
| AC-36 | R2 copy = published; retries 30/120/300 s; `site/r2-copy-failed` (`page`) | `:373` | W14, W16 | W16 Done (int) |
| AC-37 | 50 changes, 20 readers: never older than the event | `:376` | W12, W16 | W16 Done (int) |
| AC-38 | red-button object wins over origin and cache | `:381` | W29, W30, W32 | W30, W32 Done (Mf) |
| AC-39 | add/remove takes effect ≤15 s | `:384` | W29, W30 | W30 Done (Mf) |
| AC-40 | R2 read error → normal order + `site/red-button-read-failed` | `:387` | W29, W30 | W30 Done (Mf) |
| AC-41 | invalid / no `outage` → ignored + `site/red-button-invalid` | `:390` | W1, W29, W30 | W30 Done (Mf) |
| AC-42 | command writes `site/prepared/technical.json` passing AC-41 | `:393` | W23, W24 | W24 Done |
| AC-43 | ≤10-step Cloudflare dashboard instruction | `:396` | W46 | L (docs patch, manual read) |
| AC-44 | server down + warm cache + red button → banner ≤60 s in all tabs, player stays | `:403` | W29, W36, W45 | L (e2e) |
| AC-45 | http adapter reads route, accepts valid `snapshot`, ignores `clock`/unknown/invalid | `:408` | W33, W35 | W35 Done |
| AC-46 | older version dropped; events during load applied after it | `:411` | W3, W33, W35 | W35 Done |
| AC-47 | `outage` snapshot (and the first without it) applied regardless of version | `:414` | W3, W35 | W1/W3 tests, W35 Done |
| AC-48 | not `connected` / no transport → poll every 15 s ±1 | `:417` | W33, W35 | W35 Done |
| AC-49 | poll ≤30 s in any realtime state | `:420` | W33, W35 | W35 Done |
| AC-50 | `onResync` → immediate re-read | `:423` | W33, W35 | W35 Done |
| AC-51 | read fails → keep last, else build snapshot (sim values) | `:426` | W33, W35 | W35 Done |
| AC-52 | toggle visible in open tab: p95 ≤3 s (realtime), ≤30 s without | `:429` | W33, W45 | L (int e2e) |
| AC-53 | moment −20 min → countdown changes ≤30 s without reload | `:435` | W41, W42, W43, W45 | L (e2e) |
| AC-54 | patched moment used for air transition and stamp | `:438` | W41, W42, W43, W44 | W44 Done |
| AC-55 | prices from `site.products`, build values for missing keys | `:441` | W37, W38, W39 | W37 Done; L (fidelity) |
| AC-56 | `outage` → `states.backendDown` in `OfflineNotice`, content and players kept; offline wins | `:444` | W36, W45 | W36 Done; L (e2e) |
| AC-57 | snapshot without `outage` removes the banner | `:447` | W36 | W36 Done |
| AC-58 | transport only with `NEXT_PUBLIC_REALTIME_URL`; prelaunch has no `centrifuge` | `:450` | W33 | L (`check-bundle` runs) |
| AC-59 | reconnect pause uniform in [1500, min(45000, 1500·2ⁿ)] | `:453` | W34, W35 | W35 Done |
| AC-60 | handshake/token 4xx → 30–60 s | `:456` | W34, W35 | W35 Done |
| AC-61 | rebuild 150 s after the last `catalog.changed` | `:461` | W25, W26, W27 | W27 Done (int) |
| AC-62 | freeze window → deferred + `site/rebuild-frozen`, checked at launch | `:464` | W25, W27 | W27 Done |
| AC-63 | deferred → exactly one launch ≤60 s after 01.01 14:00 UTC | `:467` | W25, W26, W27 | W27 Done (int) |
| AC-64 | production only with `T2F_REBUILD_PRODUCTION` on, else `site/rebuild-disabled` | `:470` | W15, W26, W27 | W27 Done |
| AC-65 | no GitHub token → no launch + `site/rebuild-not-configured`; boot never fails | `:473` | W15, W26, W27 | W27 Done (int) |
| AC-66 | launch error → retry 60 s, 300 s; `site/rebuild-failed` (`page`) | `:476` | W26, W27 | W27 Done (int) |
| AC-67 | deploy workflow accepts the catalog-changed launch (`workflow_dispatch`, [А-1]), rehearsal + master only | `:479` | W40 | W40 Done |
| AC-68 | test-class doors: switch, products fake, choose product, red button in test R2 | `:484` | W19, W21 | W21 Done; L (doors-404 e2e) |
| AC-69 | rehearsal: red button with warm cache, server stopped → banner ≤60 s, streams play | `:494` | W47 | RH (manual) |
| AC-70 | rehearsal: tunnel down 10 min → 200 on every 15 s poll | `:497` | W47 | RH (manual) |
| AC-71 | rehearsal: catalog change → new version at edge ≤15 min | `:500` | W47 | RH (manual) |
| AC-72 | rehearsal: 20 toggles p95 ≤3 s; new visitor ≤2 s after commit with purge token | `:503` | W47 | RH (manual) |
| NFR-1 | snapshot ≤32 KB with 300 patches + 4 products | `:533` | W1 | W1 Done |
| NFR-2 | `x-t2f-source`, `x-t2f-site-version` on every public response | `:536` | W28, W30 | W30 Done (Mf) |
| NFR-3 | no visible change but the banner: boards ≤0.1 % | `:542` | W37, W38, W39, W41, W43, W46 | L (`layout-fidelity`) |
| NFR-4 | ≤1 red-button R2 read per isolate per 10 s | `:545` | W29, W30 | W30 Done (Mf) |
| NFR-5 | no new UI strings; `messages/*.json` unchanged | `:548` | W36 | W36 Done |

## Spec follow-ups

For `spec-creator` and the owner; the plan implements the spec as written and records how it reads these points.
1. **Snapshot event shape vs. the C3 envelope.** C2 / AC-5 / `:625` say `{type:'snapshot', id:'site:<version>', state}`, but every publication passes `RealtimeEnvelopeSchema` (`packages/contracts/src/realtime.schemas.ts:10-17`, `.strict()`: `type`, `id`, `version?`, `data?`), so a top-level `state` is refused as `validation` (`server/src/realtime/publisher.ts:69`). The plan publishes `{type:'snapshot', id:'site:<version>', version, data: state}`; the site adapter turns it into the domain `SiteEvent` `{type:'snapshot', state}` (`packages/contracts/src/site.ts:53`). The spec should say `data`.
2. **Purge by URL and Cache API entries (С8).** Cloudflare's "How the cache works" (2026-10-29) names only Purge Everything and Cache-Tag purge as global for entries stored with `cache.put`; purge-by-URL is not listed (not denied either). AC-33 is built as written (one request with the exact address). The edge additionally stores entries with `Cache-Tag: t2f-site-state` (no behaviour change) so a later wave can switch to tag purge. Whether the "new visitor ≤2 s" half of AC-72 holds is settled only by RH; without effective purge the bound is the 10 s freshness.
3. **GitHub token permission (В4 б).** GitHub's fine-grained-token permission table requires **"Contents: write"** for `POST /repos/{owner}/{repo}/dispatches`, not "Actions: write" as `:38` says. The code is unaffected; the owner should create the RH token with "Contents: write" (only on `time2fest-web`).
4. **R2 keys and the environment prefix.** The server writes R2 objects under the environment prefix `T2F_R2_PREFIX` (`server/src/registries/env.ts:109`; catalog copy `<prefix>catalog/latest.json`, `server/src/catalog/copy.ts:3`). The plan keeps that: `<prefix>site/latest.json`, `<prefix>site/prepared/technical.json`, `<prefix>site/red-button.json`; the Worker gets the same prefix as var `R2_PREFIX`. The AC-43 instruction names the full key.
5. **Read side of the admin slice.** The contracts list only the two writes (`:628-636`). AC-17 needs the current values, the pause mode and the product list: the plan adds `GET /cms-api/site/view` (owner only, every class). Additive.
6. **"moment" in the catalog.** Catalog events carry `midnightMs` (`lib/data/build.ts:52-63`); a patch `moment` replaces that event's `midnightMs` in the patched view (W41). Zone midnights are untouched.
7. **Prelaunch build is `API_MODE=http`** (`scripts/prelaunch/build.mjs:63-73`). Without care the `site` http adapter would poll a 404 on the prelaunch domain every 15 s. The plan answers the build snapshot without any network when `NEXT_PUBLIC_PRELAUNCH=1` (W33); visible prelaunch output is unchanged.

## Affected surface

Routing = `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1. Abbreviations: **onion** = `engineering-paved-path:onion-architecture`, **sec** = `engineering-paved-path:security`, **cc** = `contract-conformance`, **ms** = `migration-safety`, **sf** = `seed-and-fixtures`, **next** = `engineering-paved-path:next-best-practices`, **react** = `engineering-paved-path:react-best-practices`, **rtl** = `engineering-paved-path:react-testing-library`, **fui** = `engineering-paved-path:frontend-ui-architecture`.

| File | New/Mod | Package | Home (ring / radius) | Skills | Constraint to respect |
|---|---|---|---|---|---|
| `packages/contracts/src/site.ts` | Mod | contracts | wire types | onion, cc | additive only (FR-MIG-07): `outage?: 'technical'`, constants; zod-free (`index.ts:1-7`) |
| `packages/contracts/src/site.schemas.ts`, `schemas.ts` | New/Mod | contracts | wire schemas | onion, cc | zod only via `schemas.ts`; all objects `.strict()` |
| `packages/contracts/src/siteGuard.ts` | New | contracts | wire guard | onion, cc | **zod-free, import-free**: used by the site bundle and the Worker (the site bundle has no zod: only `lib/time/serverTimeMachine.ts` imports it, test build) |
| `packages/contracts/src/siteRules.ts`, `publicRoutes.ts`, `index.ts` | New/Mod | contracts | pure rules / data | onion, cc | `publicRoutes.ts` has no imports (the Worker imports it by relative path) |
| `packages/contracts/test/{site,isEnabled}.test.ts`, `isEnabled.table.ts` | New | contracts | tests | gap | table exported for server and web tests |
| `scripts/contract-surface.baseline.json` | Mod | web | generated | gap | additive diff only |
| `server/src/globals/siteState.ts`, `server/src/registries/globals.ts` | New/Mod | server | ring 4 (Payload) | ms | API `update` never (AC-10); read owner only; thin — rules in `domain/site` (routing note "Payload is a thin layer") |
| `server/src/migrations/<ts>_site_state.{ts,json}`, `index.ts`, `server/src/payload-types.ts` | New/Mod | server | generated | ms, gap | `pnpm migrate:create` + `fix-migration-down.mjs`; additive |
| `server/src/domain/site/{switches,products,snapshot,rebuild}.ts` | New | server | ring 1 | onion | pure; time is a parameter; no `Date.now()` (`server/eslint.config.mjs:20-34`) |
| `server/src/site/{ports,service,snapshot,fanout,rebuild}.ts` | New | server | ring 2/3 | onion | ports as parameters, no container access; journal in the same `tx` (`server/src/audit/ports.ts:1-8`) |
| `server/src/adapters/{payloadSiteState,products,cfPurge,githubDispatch}.ts` | New | server | ring 4 | onion | Payload rows/`fetch` never leave adapters; tokens never logged |
| `server/src/adapters/s3.ts`, `server/src/catalog/ports.ts` | Mod | server | ring 4 / 2 | onion, sec | `ObjectStore.delete?` added (door only); `put` unchanged |
| `server/src/corrections/service.ts`, `server/src/catalog/service.ts` (+ `collections/catalog/hooks.ts`, `catalog/import.ts` to confirm) | Mod | server | ring 3 | onion | only add `siteVersion.bump(tx)` beside the existing `publish(tx, …)` (`corrections/service.ts:225`, `catalog/service.ts:43`) |
| `server/src/registries/{routes,rateLimits,subscribers,revertHandlers,env,adminSlots}.ts` | Mod | server | root | onion, sec | one sorted row each (`assertRegistry`) |
| `server/src/endpoints/{siteState,types,deps}.ts` | New/Mod | server | ring 4 | onion, sec, cc | `public: true` (`types.ts:156-157`); `Deps` gains an optional `site` field only |
| `server/src/admin/cmsEndpoints.ts` | Mod | server | ring 4 | onion, sec | owner check as existing rows; ApiResult refusals `invalid`/`forbidden` |
| `server/src/admin/{SiteStateSlice,SiteStateView}.tsx`, `server/src/admin/messages.ts` | New/Mod | server | admin UI | gap (`server/src/admin/**/*.tsx`, propose react) | reason rendered as text (React escaping) |
| `server/src/test-doors/{site,registry}.ts` | New/Mod | server | ring 4 | sec | dynamic import only (`container.ts` door path); `T2F_ENV=test` + `T2F_TEST_DOORS=1` |
| `server/src/container.ts` | Mod | server | root | onion, sec | additive deps; rebuild ticker started only in `startProcessBackground` |
| `server/src/cli/sitePrepared.ts`, `server/package.json` (script `site:prepared`) | New/Mod | server | ring 4 | sec | no secrets in output |
| `server/.env.example` | Mod | server | config | sec | names only |
| `server/test/unit/*`, `server/test/integration/*`, `server/test/e2e/doors-404.e2e.ts` | New/Mod | server | tests | gap | `// check-secrets: allow test fake` on literal tokens |
| `workers/edge/src/{publicCache,redButton,handler,env,index}.ts` | New/Mod | edge | edge | sec | `caches` only in `publicCache.ts`; no `cf:` cache options; fail-closed origin unchanged (`handler.ts:28-34`) |
| `workers/edge/wrangler.json` | Mod | edge | config | sec | `r2_buckets` + `R2_PREFIX` per env; **never** a `cache` key; no route/domain change |
| `workers/edge/test/{public-cache,site-cache.worker,handler,config}.test.ts`, `test/support/tempConfig.ts` | New/Mod | edge | tests | sec (workers/**) | harness cannot fake time — freshness only in the Node file |
| `lib/api/http/{site,domains,index}.ts`, `lib/api/domains.ts` | New/Mod | web | adapter | fui, sec, cc | recipe `frontend-seam.md` §6.0; never imports `lib/api/sim/**` |
| `lib/api/site/buildSnapshot.ts`, `lib/api/sim/site.ts` | New/Mod | web | lib | gap | build snapshot shared by sim and http (sim is stripped in production, `simEntry.disabled.ts`) |
| `lib/api/http/realtime/{backoff,transport}.ts` | New/Mod | web | adapter | fui, sec | dynamic `import('centrifuge')` stays (`transport.ts:143`) |
| `lib/api/hooks/site.ts` | Mod | web | hook | fui, react | no new strings |
| `components/shell/Offline.tsx` | Mod | web | shared shell | fui, react | reuse `states.backendDown`; no layout change |
| `lib/offers/prices.ts` | New | web | lib | gap | build values = `PASS_PRICE` (`lib/offers/format.ts:5`), `TOAST_TIERS` (`lib/toast/tiers.ts:7`) |
| pass/toast price consumers (W38, W39 lists) | Mod | web | components | fui, react | only the displayed amount changes source |
| `lib/data/patched.ts`, `lib/engine/{currentAirEvent,mainCelebration,stamp}.ts`, `lib/events/engineScheduler.ts`, `lib/api/hooks/live.ts`, `lib/live/{homeData,countryData}.ts`, `lib/player/BroadcastController.tsx` | New/Mod | web | lib | gap (`lib/**` .ts unrouted), react for `.tsx`, fui for hooks | identity: no patch → the same `getData()` object (keeps every `useMemo(…, [])` stable) |
| moment components (W43 list) | Mod | web | components | fui, react | read the patched view, nothing else changes |
| `tests/unit/**`, `tests/contract/site.*`, `tests/e2e/site-state/*` | New/Mod | web | tests | rtl for `tests/unit/**`, gap otherwise | — |
| `.github/workflows/deploy.yml`, `infra/ops/test/workflow.test.mjs` | Mod | web, ops | CI | sec | actions pinned by SHA; secrets only under `env:` (existing test) |

**Coverage gaps:** `packages/contracts/test/**`, `lib/data/**`, `lib/engine/**`, `lib/events/**`, `lib/live/**`, `lib/offers/**`, `lib/api/site/**` (unrouted `.ts`; apply fui radius rules by analogy), `server/src/admin/**/*.tsx` (propose `react-best-practices`), `server/test/**`, `tests/e2e/**`, migrations and `payload-types.ts` (generated), `scripts/contract-surface.baseline.json`, all `*.md` and the AC-43 docs patch.

## Contract changes

- **Shared contracts / schemas:** yes, additive. `SiteState.outage?: 'technical'`; constants `SITE_CHANNEL_CLASS = 'site:state'`, `siteEventId(v) = 'site:'+v`, `SITE_R2_KEYS = {latest:'site/latest.json', prepared:'site/prepared/technical.json', redButton:'site/red-button.json'}`, header names `x-t2f-source` / `x-t2f-site-version`; `SiteStateSchema`, `SiteSnapshotEnvelopeSchema` (`{type:'snapshot', id, version, data}`), `SiteSwitchBodySchema` (`{key, value, reason 1..200, room?, tier?}`), `SiteProductBodySchema` (`{key, productId, reason}`), `SiteDoorBodySchema` (discriminated `switch|products|select|redButton|reset`); zod-free `parseSiteState`; `isEnabled`; `applySiteEvent` gains the outage rule (AC-47); `PUBLIC_ROUTES`. One copy only (`packages/contracts`); `lib/api/contracts/site.ts` re-exports.
- **Migration:** yes → global `site-state`: `version` int (default 1), `at` date, `switches` json, `paymentsPause` select `manual|auto` nullable, `productSelections` json (`{[key]: {productId, price:{amount,currency}, priceVersion}}`), `rebuildDueAt` date nullable, `rebuildDeferred` checkbox, `lastFannedOut` int (default 0). Generated by `cd server && pnpm migrate:create site_state`, then `node scripts/fix-migration-down.mjs src/migrations/<file>.ts` (scripts `server/package.json:21-22`). Additive (CREATE only). **Numbering:** master's newest is `20261119_212709_moderation` (`git ls-tree master server/src/migrations`); the generated file sorts after it; L re-checks after the conductor's rebase and regenerates if master gained a migration.
- **Seed / fixture data:** no new seed rows — the global's field defaults are the snapshot (all switches on, no pause, no selections, version 1), equal to what sim shows apart from `products` (sim lists build prices, http `[]`, and the site falls back to the same build prices, AC-55). The door `reset` restores the global's defaults and empties the products fake (W19).
- **Build-only failures:** yes, three. (1) `centrifuge` reaching a bundle without `NEXT_PUBLIC_REALTIME_URL` (verify build, prelaunch) — guarded by a literal `process.env.NEXT_PUBLIC_REALTIME_URL` check around the dynamic import (W33); caught by `node scripts/check-bundle.mjs out-verify` (web `full`) and the prelaunch check in L. (2) zod pulled into the site bundle by a `@time2fest/contracts/schemas` import from `lib/**` — banned in W33 (use `siteGuard.ts`); visible only in the build size, L compares. (3) The Worker importing `packages/contracts/src/{publicRoutes,siteGuard}.ts` by relative path — `tsc` passes but `wrangler` bundling could differ; caught by the workerd harness file (W32) which bundles the real entry.
- **Wire contract:** yes → new public route `GET /api/site/state`; owner routes `POST /cms-api/site/switch`, `POST /cms-api/site/product`, `GET /cms-api/site/view` (follow-up 5); `snapshot` envelope on `site:state` (follow-up 1; the `clock` event of SPEC-07 is unchanged); edge headers `x-t2f-source`, `x-t2f-site-version`; R2 objects; `workflow_dispatch` of `deploy.yml` with inputs `{env, reason:'catalog-changed', catalogVersion}` ([А-1]); door `POST /api/_test/site`. cc check: `site` suite on sim (CI `pnpm contracts:run --sim-only`) and http (L, `tests/contract/site.http.test.ts`), `node scripts/contract-surface.mjs --check`; §3.11 row in the docs patch.
- **Layout fidelity:** yes — `site` switches from sim to http in the integration build and `components/**` change (prices source, `OfflineNotice`, moment readers). `layout-fidelity` in L on the pass, toasts and live-air boards (NFR-3), http build, empty products port; expected 0 diff (no patch, no outage). Plus one capture of the outage banner state is evidence, not a fidelity board.
- **Payload migration:** yes (see Migration) → `migration-safety` in W6 (checks 1–6) and numbering again in L.
- **Seed and fixtures:** no (see Seed / fixture data).
- **Test doors:** yes → `POST /api/_test/site` in `server/src/test-doors/site.ts`, registered only through the door registry (dynamic import); `doors-gating.test.ts` and `doors-404.e2e.ts` gain one row; L runs the production-class `doors-404` e2e.
- **Agent write surface:** no — no role, key or agent path; writes are owner-only. `security-reviewer` runs anyway.

## Work items

Conventions for every item:
- **Verify (server)** = `cd server && npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`.
- **Verify (contracts / edge / ops / web)** = the config `files` command of that package in its `dir` (`.claude/sdd-engineering.json`).
- **One integration file** = `cd server && node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>` (stack up per skill `local-stack`, slot 16, DBs `t2f_spec_08_site_state[_test]` migrated). Never `pnpm` after `--` on Windows.
- Every literal token in a test: `// check-secrets: allow test fake`. Logs never contain a token, a reason text longer than 200 chars, or an R2 body.
- Log/alarm codes exactly as the spec: `site/publish-failed`, `site/purge-skipped`, `site/purge-failed`, `site/r2-copy-failed`, `site/red-button-read-failed`, `site/red-button-invalid`, `site/rebuild-frozen`, `site/rebuild-disabled`, `site/rebuild-not-configured`, `site/rebuild-failed`.

### W1 — `SiteState` wire schema, guard, size (S·P1)
- **Serves:** AC-1, AC-41 (guard used by the edge), NFR-1.
- **Do:** `site.ts`: add `outage?: 'technical'` and the constants of Contract changes. `site.schemas.ts`: `SiteStateSchema` (strict; 9 switch keys; `products[]` with `key` enum, `price {amount int ≥0, currency 'USD'}`, `priceVersion int ≥1`; `eventPatches` record of strict `{moment?, isMainCelebration?, restrained?:{note?}, hidden?}`; `outage` optional literal), the envelope and body schemas; re-export from `schemas.ts`. `siteGuard.ts`: `parseSiteState(x: unknown): SiteState | null` with the same rules, no imports. Tests: sim snapshot (`lib/api/sim/site.ts:10-35` values) and the same with `outage` parse; 12 malformed cases are refused by both schema and guard identically; a sample with 300 patches + 4 products serialises to ≤32 768 bytes.
- **Files:** `packages/contracts/src/{site,site.schemas,schemas,siteGuard}.ts`, `packages/contracts/test/site.test.ts`.
- **Done means:** contracts `files` green; the test proves schema/guard agreement on every case and the NFR-1 bound.
- **Verify:** contracts `files` on those files.
- **Rules that apply:** cc → additive, one copy; onion → no runtime import in `index.ts`.
- **Risk:** low.

### W2 — `isEnabled` and the shared table (S·P1)
- **Serves:** AC-15.
- **Do:** `siteRules.ts`: `isEnabled(switches, target)` with `target` = `{kind:'product', key:'pass'|'passGift'}` | `{kind:'tier', tier:'2'|'5'|'10'}` | `{kind:'room', room}` | `{kind:'switch', key:'chat'|'viewersMap'|'passOffer'}`; rules exactly `:289-293`. `test/isEnabled.table.ts` exports the full combination table (every boolean of the involved switches); `test/isEnabled.test.ts` runs it. Export from `index.ts`.
- **Files:** `packages/contracts/src/{siteRules,index}.ts`, `packages/contracts/test/{isEnabled.table,isEnabled.test}.ts`.
- **Done means:** contracts `files` green; table covers 2^n rows for each target kind.
- **Verify:** contracts `files`.
- **Rules that apply:** onion → pure function.
- **Risk:** low.

### W3 — Outage rule in `applySiteEvent`; public-address list (S·P1)
- **Serves:** AC-46, AC-47 (rule), AC-23 (list).
- **Do:** `applySiteEvent`: newer version wins (unchanged) **and** an event whose state has `outage`, or the first without `outage` after a current state with it, is applied regardless of version (AC-47). `publicRoutes.ts`: `PUBLIC_ROUTES = [{ key: 'site-state', path: '/api/site/state', allowedParams: [], freshMs: 10_000, staleMs: 30_000, r2Copy: 'site/latest.json', redButton: 'site/red-button.json' }]` (no imports). Tests in `site.test.ts`: version 1 outage after 50 applied; next 51 without outage applied; older normal snapshot dropped.
- **Files:** `packages/contracts/src/{site,publicRoutes,index}.ts`, `packages/contracts/test/site.test.ts`.
- **Done means:** contracts `files` green with those cases.
- **Verify:** contracts `files`.
- **Rules that apply:** cc → `applySiteEvent` is shared by sim and http adapters (one rule).
- **Risk:** existing `tests/unit/api/site-hooks.test.tsx` / `site-sim.test.ts` must stay green — run them: `npx vitest run tests/unit/api/site-hooks.test.tsx tests/unit/api/site-sim.test.ts --maxWorkers=2`.

### W4 — Contract-surface baseline (S·P1)
- **Serves:** AC-1 ("additive only" check).
- **Do:** `node scripts/contract-surface.mjs --update` (flag as in SPEC-09 W13; `--help` to confirm); review that only additions appear.
- **Files:** `scripts/contract-surface.baseline.json`.
- **Done means:** `node scripts/contract-surface.mjs --check` exits 0; baseline diff has only `+` lines.
- **Verify:** that command.
- **Rules that apply:** cc → non-breaking.
- **Risk:** low.

### W5 — Global `site-state` (S·P2)
- **Serves:** AC-10, AC-21 (no writable price/switch through the API); storage for AC-4, AC-12, AC-19, AC-61 … AC-63.
- **Do:** `globals/siteState.ts` (slug `site-state`, label `Стан сайту`, fields of Contract changes, `access: { read: ownerOnly, update: never, readVersions: ownerOnly }`, every field `admin.readOnly`, `admin.hidden` — the slice is the UI). One sorted line in `registries/globals.ts`. Mirror `globals/moderationSettings.ts` for the access shape.
- **Files:** `server/src/globals/siteState.ts`, `server/src/registries/globals.ts`.
- **Done means:** server `tsc` exit 0.
- **Verify:** server `files` on both files.
- **Rules that apply:** ms; routing note "Payload is a thin layer".
- **Risk:** low.

### W6 — Generated migration and migration safety (S·P2)
- **Serves:** persistence of W5 (AC-4, AC-10); ms gate.
- **Do:** `cd server && pnpm migrate:create site_state`; `node scripts/fix-migration-down.mjs src/migrations/<file>.ts`; `pnpm generate:types`; `pnpm migrate`. Then: grep `up` for `DROP|TRUNCATE|DELETE FROM|ALTER COLUMN .* TYPE|SET NOT NULL` (none); `down` non-empty; `node scripts/db.mjs migcheck up` → `pnpm migrate` → `pnpm migrate:down` → `pnpm migrate` → `node scripts/db.mjs migcheck drop`; `node scripts/verify-schema.mjs`. Extend `server/test/integration/payload-schema.int.test.ts` with the global's table.
- **Files:** `server/src/migrations/<ts>_site_state.{ts,json}`, `server/src/migrations/index.ts`, `server/src/payload-types.ts`, `server/test/integration/payload-schema.int.test.ts`.
- **Done means:** all commands exit 0; second `generate:types` gives no diff; the int file green; one report line per ms check; file name sorts after `20261119_212709_moderation`.
- **Verify:** those commands + the int file.
- **Rules that apply:** ms 1–6 (generated, never hand-written; additive; up/down/up).
- **Risk:** number clash at merge → L regenerates.

### W7 — Site domain: switch rules, product choice, snapshot assembly (S·P3)
- **Serves:** AC-8, AC-11, AC-13, AC-14, AC-19, AC-20 (pure parts), AC-42 (pure part).
- **Do:** `domain/site/switches.ts`: `checkToggle(current, pause, req)` → `ok | {refuse:'invalid'|'forbidden'}`: reason trimmed length 1..200 (`invalid`); unknown key / missing `room` for `chatRooms` / missing `tier` for `toastTiers` → `invalid`; `auto` on any key but `payments` → `forbidden`; `auto` enabling `payments` while pause is `manual` → `forbidden`; `auto` pausing while a manual pause holds keeps `manual` (table `:277-283`). `applyToggle` returns the new switches + pause. `domain/site/products.ts`: `chooseProduct(list, key, productId, selections)` → new selection with `priceVersion = prev + 1` or `invalid` (`unknown-product`, other key). `domain/site/snapshot.ts`: `buildSnapshot({row, patches, catalogMeta})` → `SiteState` (`products` from selections only; `eventPatches` from the corrections' effective patches via `toSitePatch`, `server/src/corrections/service.ts:13-30`; `catalogVersion = catalogVersionOf(meta)`); `technicalOf(state)` = state + `outage:'technical'`.
- **Files:** `server/src/domain/site/{switches,products,snapshot}.ts`.
- **Done means:** server `tsc`/lint green; no clock read in these files (`grep -n "Date.now\|new Date()"` empty).
- **Verify:** server `files`.
- **Rules that apply:** onion → ring 1, pure; С4, С6.
- **Risk:** medium — the pause table is easy to get subtly wrong; W11 pins it.

### W8 — Site ports and adapters (S·P3)
- **Serves:** AC-4 (version in tx), AC-18 (empty port default).
- **Do:** `site/ports.ts`: `SiteStore { read(tx?): Promise<SiteRow>; write(tx, patch): Promise<SiteRow> /* bumps version +1 in the same statement */; bumpVersion(tx): Promise<number> }`, `ProductCatalog { list(): Promise<readonly CatalogProduct[]> }` (`{id, key, price}`), `SnapshotSink` (publish/purge/copy used by W12). `adapters/payloadSiteState.ts`: atomic `UPDATE … SET version = version + 1, at = now RETURNING` inside the caller's transaction (drizzle + `req.transactionID` pattern of `server/src/adapters/pgScheduler.ts:79-114`), so concurrent writers serialize on the row and get distinct increasing values. `adapters/products.ts`: `emptyProducts` (`list → []`) and `createFakeProducts()` (settable list; used only by doors in `test`).
- **Files:** `server/src/site/ports.ts`, `server/src/adapters/{payloadSiteState,products}.ts`.
- **Done means:** server `tsc` green; no PayPro identifier anywhere (`grep -rni paypro server/src/site server/src/adapters/products.ts` empty).
- **Verify:** server `files`.
- **Rules that apply:** onion → ports justified by process boundary (DB) and a second implementation (fake); Payload rows stay in the adapter.
- **Risk:** the global row must exist before the first `UPDATE` — create on first read (`INSERT … ON CONFLICT DO NOTHING`) or rely on Payload's global row (to confirm).

### W9 — Toggle-with-reason and product choice service (S·P3)
- **Serves:** AC-4, AC-12, AC-19; enables AC-10, AC-16.
- **Do:** `site/service.ts`: `toggle(tx, actor, req, mode)` and `chooseProduct(tx, actor, req)`: run the W7 rule, write through `SiteStore.write` (version +1), append **one** journal row (`action: 'site.switch'` / `'site.product'`, `before`/`after` = `{key, value|selection, pause}`, plus `reason` and `mode` inside `after` — `JournalEntry` has no reason field, DR-11), publish internal event `site.changed` `{version}` in the same `tx`. Revert handler row `site.switch` / `site.product` in `registries/revertHandlers.ts`: restores `before` through the same service path (mode `manual`, reason `revert <journal id>`), giving a new version.
- **Files:** `server/src/site/service.ts`, `server/src/registries/revertHandlers.ts`.
- **Done means:** server `tsc` green; W21 proves one row + revert.
- **Verify:** server `files`.
- **Rules that apply:** onion → service gets ports as parameters; audit journal in the same tx (`server/src/audit/ports.ts:4-7`).
- **Risk:** medium.

### W10 — Version bump on corrections and catalog changes (S·P3)
- **Serves:** AC-4 (four kinds of change), AC-8, AC-9.
- **Do:** wherever `event-patch.changed` and `catalog.changed` are published inside a transaction (`server/src/corrections/service.ts:225`; `server/src/catalog/service.ts:43` and its callers `collections/catalog/hooks.ts:47`, `catalog/import.ts:8` — to confirm the single publish point), also call `siteVersion.bump(tx)`. Add the `bumpVersion` port to `CorrectionDeps` and the catalog deps (optional field; absent → no bump, so existing unit tests keep compiling).
- **Files:** `server/src/corrections/service.ts`, `server/src/catalog/service.ts` (+ the one caller that owns the tx, to confirm).
- **Done means:** server `tsc` green; existing corrections/catalog unit tests green (`npx vitest related` on the touched files).
- **Verify:** server `files`.
- **Rules that apply:** onion; "catalog itself is never written by corrections" (`corrections/service.ts:11`) stays true.
- **Risk:** medium — the catalog `afterChange` hook runs per record; bump once per transaction (idempotent within one tx via `SET version = version + 1 WHERE … ` once per `catalog.changed` publish, which is already once per tx).

### W11 — Site domain unit tests (S·P3)
- **Serves:** AC-11, AC-13, AC-14, AC-15 (server import), AC-20.
- **Do:** `server/test/unit/site-domain.test.ts`: reasons 0/200/201 chars; the five-row pause table; each of the 8 other keys with `auto` → `forbidden`; unknown product, other-key product. `server/test/unit/site-isenabled.test.ts` imports `../../../packages/contracts/test/isEnabled.table` and asserts `isEnabled` from `@time2fest/contracts` (AC-15 server half).
- **Files:** `server/test/unit/{site-domain,site-isenabled}.test.ts`.
- **Done means:** both files green.
- **Verify:** server `files` on them.
- **Rules that apply:** onion → domain tested without DB.
- **Risk:** low.

### W12 — Snapshot reader and after-commit fan-out: publish (S·P4)
- **Serves:** AC-5, AC-6, AC-7, AC-8, AC-9, AC-37.
- **Do:** `site/snapshot.ts`: `readSnapshot(deps)` = W7 `buildSnapshot` over `SiteStore.read`, corrections' effective patches, catalog meta. `site/fanout.ts`: subscriber rows (one per topic `site.changed`, `catalog.changed`, `event-patch.changed`; keys sorted in `registries/subscribers.ts`) that, after commit, read the snapshot and — only when `state.version > lastFannedOut` (claimed by conditional `UPDATE … SET lastFannedOut = v WHERE lastFannedOut < v RETURNING`, so one instance and one event per version) — publish `{type:'snapshot', id: siteEventId(v), version: v, data: state}` on class `site:state` (`registries/channels.ts:19`). `unavailable`/`validation` → exactly one `warn` `site/publish-failed` `{version}`; the change stays. Then purge (W13) and R2 copy (W14), detached. Nothing runs for a rolled-back tx because internal events exist only after commit (`events/ports.ts:4-6`).
- **Files:** `server/src/site/{snapshot,fanout}.ts`, `server/src/registries/subscribers.ts`.
- **Done means:** server `tsc` green; W16 proves AC-5/6/7/37.
- **Verify:** server `files`.
- **Rules that apply:** onion; sec → envelope validated by the publisher (`realtime/publisher.ts:69-71`).
- **Risk:** AC-5's 1 s depends on the delivery loop's wake (`EventSource.watch`); measure in W16 and report p95.

### W13 — Purge by Cache-Tag (S·P4, [А-2])
- **Serves:** AC-33, AC-34, AC-35.
- **Do:** `adapters/cfPurge.ts`: `POST https://api.cloudflare.com/client/v4/zones/{T2F_CF_ZONE_ID}/purge_cache`, `Authorization: Bearer <T2F_CF_PURGE_TOKEN>`, body `{"tags":["t2f-site-state"]}` (**tag purge**, conductor decision [А-2]: Cloudflare documents Cache-Tag purge as global for `cache.put` entries, URL purge is not; tag purge is available on all plans; `T2F_SITE_URL` stays only for logs); success = 2xx and `success:true`. Base URL injectable (tests use a fake on port 0). In `fanout.ts`: no token / zone / site URL → one `info` `site/purge-skipped` per change; otherwise attempts at 0, 30 s, 120 s (scheduler injectable like `catalog/copy.ts:19`); third failure → `alarm.raise({level:'log', code:'site/purge-failed'})`.
- **Files:** `server/src/adapters/cfPurge.ts`, `server/src/site/fanout.ts`.
- **Done means:** server `tsc` green; token never in a log line (`grep` in W16 output).
- **Verify:** server `files`.
- **Rules that apply:** sec → secret only from env, never logged; onion → adapter behind the `SnapshotSink` port.
- **Risk:** see Spec follow-up 2.

### W14 — R2 copy `site/latest.json` (S·P4)
- **Serves:** AC-36; feeds AC-28.
- **Do:** reuse `ObjectStore` (`catalog/ports.ts:48-51`) and `catalogCopyDepsOf` objects/prefix; key `<prefix>site/latest.json`, body = the published state JSON, `application/json`. Schedule `[0, 30_000, 120_000, 300_000]` (same as `catalog/copy.ts:19`); each retry re-reads the snapshot and writes only if its version ≥ the one being copied; after the 4th failure `alarm.raise({level:'page', code:'site/r2-copy-failed'})`. No bucket configured (`catalogCopy()` → `undefined`) → skip with one `info` line.
- **Files:** `server/src/site/fanout.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server `files`.
- **Rules that apply:** onion.
- **Risk:** low.

### W15 — Env vars (names only) and the no-PayPro check (S·P4)
- **Serves:** AC-22, AC-34, AC-64, AC-65 (boot without vars).
- **Do:** new block `site` in `registries/env.ts`: `T2F_CF_PURGE_TOKEN` (secret, optional), `T2F_CF_ZONE_ID` (optional, `/^[0-9a-f]{32}$/`), `T2F_SITE_URL` (optional `z.url()`), `T2F_GITHUB_DISPATCH_TOKEN` (secret, optional), `T2F_REBUILD_PRODUCTION` (`'0'|'1'`, default `'0'`); no `requiredIn`. Names in `server/.env.example`. `server/test/unit/site-env.test.ts`: env parses in `test` and `rehearsal` without any of them; the registry's names diffed against `git show 9d18cf7:server/src/registries/env.ts` gain exactly these five and no name matching `/PAYPRO/`. If `infra/ops/test/env-example.test.mjs` pins the example's names, update it in this item (to confirm).
- **Files:** `server/src/registries/env.ts`, `server/.env.example`, `server/test/unit/site-env.test.ts` (+ `infra/ops/test/env-example.test.mjs` if needed).
- **Done means:** server `files` green; ops `files` green if touched.
- **Verify:** server `files`; ops `files`.
- **Rules that apply:** sec → secrets flagged `secret: true`, never logged.
- **Risk:** low.

### W16 — Fan-out integration tests (S·P4)
- **Serves:** AC-4, AC-5, AC-6, AC-7, AC-33, AC-34, AC-35, AC-36, AC-37.
- **Do:** `server/test/integration/site-fanout.int.test.ts`: per change kind (toggle, product via fake, correction save, catalog import) version grows; two concurrent toggles → two distinct increasing versions; Centrifugo subscriber (existing realtime test helpers, `rttest`-style token door) receives the snapshot ≤1 s after the response (report p95 over 20); forced rollback (throw after write inside the tx) → 0 publish, 0 purge requests, 0 R2 writes; Centrifugo API URL pointed at a closed port → change kept, `GET` (direct handler or loopback) returns the new version, exactly one `site/publish-failed`; fake purge server: one request with the exact URL, after commit; no token → `site/purge-skipped`; always-failing purge with an injected schedule → 3 attempts, 1 alarm; local R2 stub (the one the catalog-copy int test uses — to confirm) holds `site/latest.json` equal to the event; failing stub → 4 attempts, 1 `page` alarm. `site-concurrency.int.test.ts`: 50 sequential changes with 20 parallel readers; no read after an event's arrival returns a lower version.
- **Files:** `server/test/integration/{site-fanout,site-concurrency}.int.test.ts`.
- **Done means:** both int files green, 0 skipped.
- **Verify:** one integration file at a time.
- **Rules that apply:** — 
- **Risk:** timing flakes — use injected schedules, never real 30 s waits.

### W17 — Public route `GET /api/site/state` (S·P5)
- **Serves:** AC-3, AC-23 (server half).
- **Do:** `endpoints/siteState.ts`: row `{key:'site-state', method:'GET', path:'/api/site/state', public: true, needs:['db'], rateLimit:'site-read'}`; handler returns `Response` with JSON `SiteState` (no `ApiResult` wrapper — the contract body is the bare snapshot, `:608`), `Cache-Control: public, max-age=10`, `Content-Type: application/json`. Query params ignored. Row in `registries/routes.ts` (sorted), `site-read` in `registries/rateLimits.ts` (memory policy, generous — at least 600/min per client so the AC-37 readers pass; to confirm policy shape). `Deps.site?` in `types.ts` + getter `siteOf` in `deps.ts`. `server/test/unit/public-routes.test.ts`: the set of `routeRegistry` rows with `public: true` equals `PUBLIC_ROUTES` paths (fails both ways).
- **Files:** `server/src/endpoints/{siteState,types,deps}.ts`, `server/src/registries/{routes,rateLimits}.ts`, `server/test/unit/public-routes.test.ts`.
- **Done means:** server `files` green incl. the new unit test.
- **Verify:** server `files`.
- **Rules that apply:** sec → public response carries no subject data; `Set-Cookie` dropped by the pipeline (`pipeline.ts:98-102`); cc.
- **Risk:** low.

### W18 — Owner endpoints: switch, product, view (S·P5)
- **Serves:** AC-10, AC-16, AC-21; read side for AC-17 (follow-up 5).
- **Do:** in `admin/cmsEndpoints.ts`: `POST /cms-api/site/switch` (body `SiteSwitchBodySchema`; mode always `manual`), `POST /cms-api/site/product` (`SiteProductBodySchema`), `GET /cms-api/site/view` (`{state, paymentsPause, products: CatalogProduct[], selections}`). Owner check exactly like existing rows; refusals `{ok:false, error:{code:'validation'|'forbidden', reason?}}` with the existing status mapping (`invalid` → 400 `validation`, `unknown-product` reason; `forbidden` → 403). Every write runs inside one Payload transaction and calls W9. No endpoint, field or door accepts an amount.
- **Files:** `server/src/admin/cmsEndpoints.ts`.
- **Done means:** server `tsc` green; W21 proves the refusals.
- **Verify:** server `files`.
- **Rules that apply:** sec → owner only, JSON content type, same-origin as existing cms rows; untrusted reason ≤200.
- **Risk:** medium.

### W19 — Test door `POST /api/_test/site` (S·P5)
- **Serves:** AC-68; feeds AC-44, AC-52, AC-53 e2e.
- **Do:** `test-doors/site.ts` with `SiteDoorBodySchema`: `switch {key, value, mode, room?, tier?, reason?}` (through W9, actor `system:test-door`), `products {list}` (sets the fake), `select {key, productId}`, `redButton {action:'put'|'delete'}` (writes/deletes `<prefix>site/red-button.json` = `technicalOf(current)` in the test bucket through `ObjectStore`; add optional `delete(key)` to `ObjectStore` and `adapters/s3.ts`), `reset` (global defaults, empty fake). Row in `test-doors/registry.ts`; `server/test/unit/doors-gating.test.ts` and `server/test/e2e/doors-404.e2e.ts` gain the path.
- **Files:** `server/src/test-doors/{site,registry}.ts`, `server/src/catalog/ports.ts`, `server/src/adapters/s3.ts`, `server/test/unit/doors-gating.test.ts`, `server/test/e2e/doors-404.e2e.ts`.
- **Done means:** server `files` green; gating unit test lists the new path.
- **Verify:** server `files`.
- **Rules that apply:** sec → door only via dynamic import, only `T2F_ENV=test` + `T2F_TEST_DOORS=1`; never sets a price amount (the fake list is test data only, AC-21 concerns real routes).
- **Risk:** low.

### W20 — Composition root wiring (S·P5)
- **Serves:** AC-18 (empty port in every class), enables AC-3 … AC-37.
- **Do:** `container.ts`: build `deps.site = { store, products, fanout deps (publisher, purge adapter or `undefined`, objects via `catalogCopy`), service }`; `products` = `emptyProducts` in every class; in `test` the doors swap in `createFakeProducts()` (held on `deps.site`), so a server of class `test` without a door call still answers `products: []`. Pass `bumpVersion` into corrections and catalog deps (W10).
- **Files:** `server/src/container.ts`.
- **Done means:** server `tsc` green; server boots (`npx vitest related` on container tests).
- **Verify:** server `files`.
- **Rules that apply:** onion → one composition root, services get ports.
- **Risk:** medium (container is shared; additive only).

### W21 — Route, admin and door integration tests (S·P5)
- **Serves:** AC-3, AC-8, AC-9, AC-10, AC-12, AC-16, AC-18, AC-19, AC-20, AC-21, AC-68, AC-23 (server half run).
- **Do:** `site-route.int.test.ts`: request with a session cookie → body passes `SiteStateSchema`, `Cache-Control` exactly `public, max-age=10`, no `Set-Cookie`; correction −20 min + `restrained` note → same values in `eventPatches`; `import catalog` with changed data → `catalogVersion` changes and equals `catalogVersionOf(meta)`; class `test` without fake and the rehearsal config → `products: []`. `site-admin.int.test.ts`: Payload REST/admin update of the global → refused, state unchanged; owner toggle → one journal row with actor, before/after, reason, mode; revert → previous value, new version; `content-agent`, `stream-agent`, anonymous → `forbidden`; fake with two `pass` products: choose the second → its price, `priceVersion` +1; unknown id and other-key id → `invalid`, snapshot unchanged; route table and cms endpoints contain no price write; `price` write through Payload API → refused. Extend `doors.int.test.ts` (to confirm name) with the site door actions.
- **Files:** `server/test/integration/{site-route,site-admin}.int.test.ts`, `server/test/integration/doors.int.test.ts`.
- **Done means:** all three int files green, 0 skipped.
- **Verify:** one integration file at a time.
- **Rules that apply:** sec.
- **Risk:** low.

### W22 — Admin slice «Стан сайту» (S·P6)
- **Serves:** AC-17.
- **Do:** `admin/SiteStateSlice.tsx` (client; polls `GET /cms-api/site/view` via `admin/api.ts`) and `admin/SiteStateView.tsx` (pure props → markup: 9 switches with values incl. rooms and tiers, `payments` pause mode, reason field, one product select per key `pass`, `toast:2`, `toast:5`, `toast:10`; empty port → exactly «Товарів ще немає — ціни з’являться після підключення PayPro (SPEC-17)»). Strings in `admin/messages.ts`. Row in `registries/adminSlots.ts` (next free order).
- **Files:** `server/src/admin/{SiteStateSlice,SiteStateView,messages}.tsx|ts`, `server/src/registries/adminSlots.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server `files`.
- **Rules that apply:** react (proposed row) → view is pure; reason shown as text.
- **Risk:** low.

### W23 — Command `site:prepared` (S·P6)
- **Serves:** AC-42.
- **Do:** `cli/sitePrepared.ts`: reads the current snapshot, writes `technicalOf(state)` to stdout and, when a bucket is configured, to `<prefix>site/prepared/technical.json`. Script `"site:prepared": "tsx src/cli/sitePrepared.ts"` in `server/package.json` (pattern of `clock`, `:31`).
- **Files:** `server/src/cli/sitePrepared.ts`, `server/package.json`.
- **Done means:** server `tsc` green.
- **Verify:** server `files`.
- **Rules that apply:** sec → no env values printed.
- **Risk:** low.

### W24 — Slice and command tests (S·P6)
- **Serves:** AC-17, AC-42.
- **Do:** `server/test/unit/site-slice.test.ts`: `renderToStaticMarkup(createElement(SiteStateView, props))` with an empty port (exact text) and with the fake (4 selects with options); 9 switch rows and the pause mode present. `server/test/unit/site-prepared.test.ts`: the command's pure part output passes `parseSiteState` and has `outage: 'technical'`.
- **Files:** `server/test/unit/{site-slice,site-prepared}.test.ts`.
- **Done means:** both green.
- **Verify:** server `files` on them.
- **Rules that apply:** —
- **Risk:** `react-dom/server` availability in the server package (Payload depends on it; to confirm).

### W25 — Rebuild domain: debounce and freeze window (S·P7)
- **Serves:** AC-61, AC-62, AC-63 (pure parts).
- **Do:** `domain/site/rebuild.ts`: `REBUILD_DEBOUNCE_MS = 150_000`; `inFreeze(ms)` = 31.12 08:00:00 UTC ≤ t < 01.01 14:00:00 UTC (year of `t`, both sides of New Year); `freezeEnd(ms)`; `decide(nowMs, pending)` → `launch | wait | frozen`, evaluated **at launch time**.
- **Files:** `server/src/domain/site/rebuild.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server `files`.
- **Rules that apply:** onion → pure.
- **Risk:** low.

### W26 — Rebuild service, GitHub dispatch adapter, subscriber (S·P7)
- **Serves:** AC-61, AC-63, AC-64, AC-65, AC-66.
- **Do:** `adapters/githubDispatch.ts`: `POST https://api.github.com/repos/DmytrivDev/time2fest-web/actions/workflows/deploy.yml/dispatches` (**`workflow_dispatch`**, conductor decision [А-1]: needs only "Actions: write", matching the owner's token task), `Authorization: Bearer <T2F_GITHUB_DISPATCH_TOKEN>`, `Accept: application/vnd.github+json`, body `{ref:'master', inputs:{env:'rehearsal', reason:'catalog-changed', catalogVersion:'<v>'}}`; success = 204; base URL injectable. `site/rebuild.ts`: subscriber of `catalog.changed` sets `rebuildDueAt = committedAt + 150 s` (persisted in the global, so a later change pushes it and a restart keeps it); a ticker every 15 s on the clock port (virtual time in `test`) claims a due launch with a conditional `UPDATE … WHERE rebuildDueAt = $due RETURNING` (exactly once across instances); at launch: in freeze → `rebuildDeferred = true`, `rebuildDueAt = freezeEnd`, one `site/rebuild-frozen`; class `production` and `T2F_REBUILD_PRODUCTION !== '1'` → `site/rebuild-disabled`; no token → `site/rebuild-not-configured`; failure → retries at 60 s and 300 s, third failure → `page` alarm `site/rebuild-failed`. Ticker started only in `startProcessBackground` (`container.ts`); subscriber row in `registries/subscribers.ts`.
- **Files:** `server/src/adapters/githubDispatch.ts`, `server/src/site/rebuild.ts`, `server/src/registries/subscribers.ts`, `server/src/container.ts`.
- **Done means:** server `tsc` green.
- **Verify:** server `files`.
- **Rules that apply:** sec → token from env only; onion.
- **Risk:** medium — virtual time and the ticker; W27 pins it.

### W27 — Rebuild tests (S·P7)
- **Serves:** AC-61 … AC-66.
- **Do:** `server/test/unit/site-rebuild.test.ts`: boundaries 31.12 07:59:59 / 08:00:00 / 01.01 13:59:59 / 14:00:00 UTC; decision at launch not at change; production with and without the flag. `server/test/integration/site-rebuild.int.test.ts` (test clock door of SPEC-07 + fake dispatch on port 0): 10 changes in 2 min → 1 launch 150 s after the last; 3 changes in the window → 1 launch at 14:00:xx (≤60 s); no token → `site/rebuild-not-configured`, server boots; failing fake → 3 attempts, 1 alarm.
- **Files:** `server/test/unit/site-rebuild.test.ts`, `server/test/integration/site-rebuild.int.test.ts`.
- **Done means:** both green, 0 skipped.
- **Verify:** server `files`; the int file under the shared lock.
- **Rules that apply:** —
- **Risk:** virtual-time speed in tests — set it through the clock door.

### W28 — Edge public cache and source order (C·E8)
- **Serves:** AC-24 … AC-31, NFR-2 (AC-38 order slot).
- **Do:** `publicCache.ts` (the **only** file naming `caches`): `defaultCache()` returns `caches.default`; `servePublic(req, route, env, deps)` implements the flowchart `:589-603`: strip the query (key and origin request use `origin + path` only); red button (W29) first; cache `match` → if age ≤ `freshMs` (age from stored header `x-t2f-cached-at`, compared with `deps.now()`) serve `cache`; if older, serve it and refresh in background once per isolate (`deps.waitUntil`); miss → origin via existing `proxy()`; origin failure = network error / 500–504 / 520–530 / non-JSON / `parseSiteState` null → stale copy while age ≤ `freshMs + staleMs` → R2 `<R2_PREFIX>site/latest.json` (guard-checked) → `unavailable()`. A good origin answer is stored with `Cache-Control: public, s-maxage=40`, `x-t2f-cached-at`, `Cache-Tag: t2f-site-state`, **without** `Set-Cookie`. Every response: `Set-Cookie` removed, `x-t2f-source` (`red-button|origin|cache|r2`), `x-t2f-site-version`. Non-public paths never reach this module. `handler.ts`: after step 4 (no origin → 404 unchanged), a path in `PUBLIC_ROUTES` (imported from `../../../packages/contracts/src/publicRoutes`) and `GET` → `servePublic`; a missing secret makes the origin "failed" for this path only (red button / cache / R2 still answer). `env.ts`: `SITE_BUCKET?: {get(key): Promise<{text(): Promise<string>} | null>}`, `R2_PREFIX?: string`; `EdgeDeps` gains `cache?`, `waitUntil?`.
- **Files:** `workers/edge/src/{publicCache,handler,env}.ts`.
- **Done means:** edge `files` green (both tsconfigs).
- **Verify:** edge `files`.
- **Rules that apply:** sec → fail-closed origin forward unchanged; no `cf:` cache option; `docs/backend/cloudflare-notes.md` (read the section on proxying first).
- **Risk:** high — the cache key must ignore query and cookies; covered by W30.

### W29 — Red button at the edge (C·E8)
- **Serves:** AC-38, AC-39, AC-40, AC-41, NFR-4.
- **Do:** `redButton.ts`: `redButtonState(env, deps)` reads `<R2_PREFIX>site/red-button.json` at most once per 10 s per isolate (module memo keyed by `deps.now()`; the memo stores "absent" too); read throws → `console.warn(JSON.stringify({event:'site/red-button-read-failed'}))` and "absent"; body not JSON / guard fails / no `outage:'technical'` → `site/red-button-invalid` and "absent". Present → the object body is served with `x-t2f-source: red-button`, `Cache-Control: public, max-age=10`. No bucket binding → always absent (prelaunch/production without binding).
- **Files:** `workers/edge/src/redButton.ts`, `workers/edge/src/publicCache.ts`.
- **Done means:** edge `files` green.
- **Verify:** edge `files`.
- **Rules that apply:** sec → untrusted file validated (spec Untrusted inputs `:680`).
- **Risk:** low.

### W30 — Edge Node tests with injected cache, bucket and time (C·E8)
- **Serves:** AC-23 (edge half), AC-24 … AC-31, AC-38 … AC-41, NFR-2, NFR-4.
- **Do:** `workers/edge/test/public-cache.test.ts` with an in-memory `cache` (match/put honouring the stored headers), an in-memory bucket (counting `get`, optionally throwing), a counting fake origin and `now` advanced by hand: 20 random params → origin sees 1 request without query; 100 requests within 10 s → 1 origin call; at 11 s stale answer then the next has the new version (1 background call); origin 530: copy at 39 s of age, next source at 41 s; empty cache + 530 + R2 copy → body, `x-t2f-source: r2`; nothing → 503 `UNAVAILABLE_BODY`; origin `Set-Cookie` absent in first and cached answers; a private path twice → 2 origin calls, `private, no-store` kept; red button present over a warm cache; add/remove visible by 10 s; bucket throws → origin answer; broken JSON and no-`outage` → normal answer; 1 000 requests in 10 s → ≤1 bucket read; every source sets both headers. Edge half of AC-23: test that `PUBLIC_ROUTES` drives the branch (a path not in the list is proxied untouched). `handler.test.ts:166-174`: narrow the ban to "`caches` appears only in `publicCache.ts`; `cacheTtl|cacheEverything|cacheKey|cacheTtlByStatus|\bcf:` nowhere".
- **Files:** `workers/edge/test/{public-cache,handler}.test.ts`.
- **Done means:** edge `files` green on both files; every case above asserted.
- **Verify:** edge `files`.
- **Rules that apply:** sec.
- **Risk:** low.

### W31 — Worker entry, bindings and config test (C·E9)
- **Serves:** AC-32; wiring of AC-24 … AC-41.
- **Do:** `index.ts`: `fetch(req, env, ctx)` passes `cache: defaultCache()`, `waitUntil: (p) => ctx.waitUntil(p)`. `wrangler.json`: in `test` and `rehearsal` env blocks add `r2_buckets: [{binding:'SITE_BUCKET', bucket_name:<the env's bucket>}]` and `vars.R2_PREFIX` = that env's server `T2F_R2_PREFIX` (names from `infra/cloudflare/**` or `docs/services/` — to confirm; if a name cannot be established, leave that env without the binding and record it for L). `production`: same only if its bucket name is established; `prelaunch`: no binding. No `cache` key anywhere. `test/support/tempConfig.ts`: copy `r2_buckets` per env (not inherited). `config.test.ts`: no env and no top level has a `cache` key (AC-32); every env with `SITE_BUCKET` has `R2_PREFIX`.
- **Files:** `workers/edge/src/index.ts`, `workers/edge/wrangler.json`, `workers/edge/test/support/tempConfig.ts`, `workers/edge/test/config.test.ts`.
- **Done means:** edge `files` green; `workers/edge/test/deploy.test.ts` still green (it reads `wrangler.json`).
- **Verify:** edge `files` on the touched tests + `deploy.test.ts`.
- **Rules that apply:** sec → no route/custom-domain change; bindings are not zone changes.
- **Risk:** a wrong bucket name only breaks a future deploy (none in this wave).

### W32 — Workerd harness test (C·E9)
- **Serves:** AC-25, AC-28, AC-30, AC-38 (real runtime evidence).
- **Do:** `workers/edge/test/site-cache.worker.test.ts` using `createTestHarness` (pattern `worker.test.ts:21-40`) and the origin stub: two requests → one origin call (`caches.default` hit); origin returning `Set-Cookie` → none in the response, and a second request still reaches the cache from the stored copy; origin stopped + `(await h.getWorker().getEnv()).SITE_BUCKET.put('<prefix>site/latest.json', json)` → `x-t2f-source: r2`; `put` of the red-button object → `x-t2f-source: red-button` (after ≤10 s memo — use a fresh harness or wait out the memo by design of the test order). No freshness timing here (harness cannot fake time).
- **Files:** `workers/edge/test/site-cache.worker.test.ts`.
- **Done means:** the file green.
- **Verify:** edge `files` on it.
- **Rules that apply:** sec.
- **Risk:** harness start time (~seconds); keep one harness per describe.

### W33 — `site` http adapter, build snapshot, domain lists (C·W10)
- **Serves:** AC-45, AC-46, AC-48, AC-49, AC-50, AC-51, AC-58; enables AC-52.
- **Do:** move the sim defaults to `lib/api/site/buildSnapshot.ts` (`buildSnapshot()`; sim imports it — `lib/api/sim/site.ts`). `lib/api/http/site.ts`: `state()` = `fetch('/api/site/state')` → `parseSiteState` → `ok` or `unavailable`/`network`; `subscribe(cb)`: (a) only when `process.env.NEXT_PUBLIC_REALTIME_URL` is a non-empty literal at build time, dynamic `import('./realtime')` → `getRealtimeTransport().subscribe('site:state', {onEvent, onResync})`; `onEvent` accepts only `type === 'snapshot'` with `parseSiteState(data)` and emits `{type:'snapshot', state}`; `clock`, unknown and invalid are ignored; `onResync` → immediate `state()` → emit; (b) a poll timer: every 15 s while the transport is absent or `state() !== 'connected'` (`onStateChange`), else every 30 s; each poll emits on success, keeps the last on failure. `peek()` = last applied or `undefined`. `NEXT_PUBLIC_PRELAUNCH === '1'` → returns `buildSnapshot()` without any network or timer (follow-up 7). `lib/api/hooks/site.ts`: when `load` fails and nothing was applied, serve `buildSnapshot()` (AC-51); reduce stays `applySiteEvent` (W3). `HTTP_DOMAINS` gains `'site'`, `http/index.ts` the factory, `lib/api/domains.ts` `MIGRATED_DOMAINS` gains `'site'`. No `@time2fest/contracts/schemas` import anywhere under `lib/**`.
- **Files:** `lib/api/site/buildSnapshot.ts`, `lib/api/sim/site.ts`, `lib/api/http/{site,domains,index}.ts`, `lib/api/domains.ts`, `lib/api/hooks/site.ts`.
- **Done means:** web `files` green; `grep -rn "contracts/schemas" lib` empty.
- **Verify:** web `files`.
- **Rules that apply:** fui → adapter in `lib/api/http`; cc → sim and http same contract; sec → untrusted events validated.
- **Risk:** high — the literal env gate decides whether `centrifuge` enters the verify/prelaunch bundles; L proves it with `check-bundle`.

### W34 — Reconnect pauses (C·W10)
- **Serves:** AC-59, AC-60.
- **Do:** `lib/api/http/realtime/backoff.ts`: `reconnectDelay(n, random) = 1500 + random() * (min(45000, 1500·2ⁿ) − 1500)`; `refusalDelay(random) = 30000 + random() * 30000`. `transport.ts`: replace centrifuge's own reconnect (`MIN/MAX_RECONNECT_DELAY_MS`, `:12-13`, `:258-262`) with own scheduling — on a non-final `disconnected`, stop centrifuge's retry and call `connect()` after `reconnectDelay(attempt)`; reset `attempt` on `connected` (if centrifuge-js exposes no hook to disable its own backoff, set its min/max to the computed delay per attempt — the implementer reads the installed `centrifuge` `.d.ts` and picks one; the observable delay must equal the formula). Token request answered 4xx (and a handshake refusal) → next attempt after `refusalDelay`; 5xx/network keep the current 5–10 s (`:15-16`). Random source and timers injectable.
- **Files:** `lib/api/http/realtime/{backoff,transport}.ts`.
- **Done means:** web `files` green; existing `tests/unit/**/realtime*` tests green.
- **Verify:** web `files` on the touched files + existing transport tests.
- **Rules that apply:** sec → fewer reconnect storms (П-RT рек. 5).
- **Risk:** high — centrifuge internals; keep the change behind the two pure functions.

### W35 — Site client tests and the contract suite (C·W10)
- **Serves:** AC-2 (suite), AC-15 (web half), AC-45 … AC-51, AC-59, AC-60.
- **Do:** `tests/unit/api/site-http.test.ts` (fake fetch, fake transport, fake timers): `snapshot`/`clock`/unknown/broken events; event during load applied after an older snapshot; transport `disconnected` and absent → 15 s ±1; `connected` without events → request by 30 s; `onResync` → immediate request; failure with and without a previous snapshot; prelaunch flag → no fetch. `tests/unit/api/realtime-backoff.test.ts`: random 0 and 1 for n = 0 … 6; refusal 30/60 s with injected clock. `tests/contract/site.suite.ts` (`describeDomain` like `tests/contract/catalog.suite.ts`), `tests/unit/api/site-contract.test.ts` (sim), `tests/contract/site.http.test.ts` (resets via `/api/_test/reset`, uses `/api/_test/site`). `tests/unit/api/site-isenabled.test.ts` imports `packages/contracts/test/isEnabled.table.ts`. Update `site-hooks.test.tsx` / `site-sim.test.ts` only if the moved defaults require it.
- **Files:** `tests/unit/api/{site-http,realtime-backoff,site-contract,site-isenabled}.test.ts`, `tests/contract/{site.suite,site.http.test}.ts`, `tests/unit/api/{site-hooks.test.tsx,site-sim.test.ts}`.
- **Done means:** web `files` green on the unit files; `pnpm contracts:run --sim-only` lists `site` green.
- **Verify:** web `files`; `pnpm contracts:run --sim-only`.
- **Rules that apply:** rtl; cc → one suite for both adapters.
- **Risk:** low.

### W36 — Outage banner in `OfflineNotice` (C·W11)
- **Serves:** AC-56, AC-57, NFR-5; part of AC-44.
- **Do:** `components/shell/Offline.tsx`: `OfflineNotice` also reads `useSiteState()`; shown when offline (text `t('offline')`, priority) or when online and `state?.outage === 'technical'` (text `t('backendDown')`); markup and position unchanged; the rest of the page is untouched. `tests/unit/shell/offline-outage.test.tsx`: outage → banner with the `states.backendDown` text and the sibling content still rendered; next snapshot without outage → no banner; offline + outage → offline text; `git diff --exit-code 9d18cf7 -- messages/` in the Done check.
- **Files:** `components/shell/Offline.tsx`, `tests/unit/shell/offline-outage.test.tsx`.
- **Done means:** web `files` green; `git diff --exit-code 9d18cf7 -- messages/` exits 0.
- **Verify:** web `files`.
- **Rules that apply:** fui, react → no new component, no new string; `app/(live)/layout.tsx:54` unchanged.
- **Risk:** low.

### W37 — Prices from the snapshot (C·W11)
- **Serves:** AC-55.
- **Do:** `lib/offers/prices.ts`: `sitePrices(state)` → `{pass: number, tiers: {2,5,10}: number}` in dollars from `products` (`amount / 100`), each missing key → build value (`PASS_PRICE`, the tier value). `useSitePrices()` in `lib/api/hooks/site.ts`. `tests/unit/offers/prices.test.ts`: `products: []` → 5 / 2 / 5 / 10; a product with 700 cents for `pass` → 7.
- **Files:** `lib/offers/prices.ts`, `lib/api/hooks/site.ts`, `tests/unit/offers/prices.test.ts`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** fui → pure function in `lib`, hook in `lib/api/hooks`.
- **Risk:** low.

### W38 — Pass price consumers (C·W11)
- **Serves:** AC-55, NFR-3.
- **Do:** replace the displayed `PASS_PRICE` with `useSitePrices().pass` in: `components/auth/AuthParts.tsx` (`:515,561,565,600`), `components/chat/parts/ChatSettings.tsx:127`, `components/chat/parts/TranslateGate.tsx:90`, `components/countries/CountryList.tsx:68`, `components/live/NowNext.tsx:244`, `components/live/ScheduleLockedBar.tsx:33`, `components/pass/PassBuy.tsx:58` (module const → inside component), `components/pass/PassInfo.tsx:53`, `components/pass/PassOffer.tsx:73`, `components/pass/PassPageParts.tsx:106`, `components/pass/PassPerks.tsx:295`, `components/passport/PathLock.tsx:29`, `components/schedule/ScheduleGate.tsx:82`, `components/schedule/SchedulePage.tsx:306`. If a file is a server component (no `'use client'`), keep it server-side by passing the value from its client parent or leave the constant and record why (to confirm per file). Existing unit tests of these components stay green.
- **Files:** the 14 components above.
- **Done means:** web `files` green on them; `grep -rn "PASS_PRICE" components` lists only files recorded as exceptions.
- **Verify:** web `files`.
- **Rules that apply:** react → hooks only in client components; fui.
- **Risk:** medium — 14 files; visible output must stay identical (L fidelity).

### W39 — Toast price consumers (C·W12)
- **Serves:** AC-55, NFR-3.
- **Do:** displayed tier prices from `useSitePrices().tiers` in `components/toast/ToastTiers.tsx` (`:24,36,94`), `ToastCompose.tsx`, `ToastGift.tsx`, `ToastPayment.tsx` (`formatUsd` callers). Tier identities (`TOAST_TIERS`, `DEFAULT_TIER`, `isToastTier`, `stores/toast.ts`) do **not** change — only the shown amount.
- **Files:** `components/toast/{ToastTiers,ToastCompose,ToastGift,ToastPayment}.tsx`.
- **Done means:** web `files` green; `tests/unit/toast/**` green unchanged.
- **Verify:** web `files`; `npx vitest run tests/unit/toast --maxWorkers=2`.
- **Rules that apply:** react, fui.
- **Risk:** low.

### W40 — Deploy workflow accepts the catalog-changed `workflow_dispatch` (C·W12)
- **Serves:** AC-67.
- **Do ([А-1]):** `.github/workflows/deploy.yml`: `workflow_dispatch` gains optional string inputs `reason` and `catalogVersion` (echoed in the run name / log only); no `repository_dispatch`; job stays `if: github.ref == 'refs/heads/master'`, `environment: rehearsal`. `infra/ops/test/workflow.test.mjs`: the only trigger is `workflow_dispatch`; inputs `env` (still `[rehearsal]`), `reason`, `catalogVersion`; the branch guard and environment unchanged.
- **Files:** `.github/workflows/deploy.yml`, `infra/ops/test/workflow.test.mjs`.
- **Done means:** ops `files` green on `test/workflow.test.mjs`.
- **Verify:** ops `files`.
- **Rules that apply:** sec → pinned actions, secrets only under `env:` (existing tests).
- **Risk:** low.

### W41 — Patched dataset view (C·W13)
- **Serves:** AC-53, AC-54 (core).
- **Do:** `lib/data/patched.ts`: `withEventPatches(data, patches)` → if no patch has `moment`, return `data` itself; else a new `Dataset` whose patched events carry `midnightMs = moment` (and `midnightUtc` ISO), with `eventsBySlot` rebuilt by the same rule as `lib/data/build.ts:74-81`; memoised on `(data, patches)` identity. `usePatchedData()` in `lib/api/hooks/site.ts` = `withEventPatches(getData(), useSiteState().state?.eventPatches)`; a non-hook `patchedData()` for engine code that reads `siteState.peek()` (W42). `tests/unit/data/patched.test.ts`: no moment patch → same reference; −20 min patch → event and slot moved.
- **Files:** `lib/data/patched.ts`, `lib/api/hooks/site.ts`, `tests/unit/data/patched.test.ts`.
- **Done means:** web `files` green.
- **Verify:** web `files`.
- **Rules that apply:** fui; react → stable identity.
- **Risk:** high — any new object identity without a patch would re-run `useMemo(…, [])` consumers; the reference check pins it.

### W42 — Engine readers of the moment (C·W13)
- **Serves:** AC-53, AC-54 (air transition, stamp, scheduler).
- **Do:** make these read the patched view instead of `getData()`: `lib/engine/currentAirEvent.ts` (`airSlots` `:39-45`, `currentAirEvent` `:85-102`), `lib/engine/mainCelebration.ts` (`:35-37,55-73`), `lib/engine/stamp.ts` (`:9-18`), `lib/events/engineScheduler.ts` (`:107,150`), `lib/api/hooks/live.ts` (`withChains`, `:55-67`, applies patches too), `lib/live/{homeData,countryData}.ts`, `lib/player/BroadcastController.tsx:224`. Where a function already takes a `Dataset` parameter, change the caller; where it calls `getData()` itself, call `patchedData()`.
- **Files:** the 8 files above.
- **Done means:** web `files` green; existing `tests/unit/engine/**`, `tests/unit/events/**`, `tests/unit/live/**` green unchanged (no patch = same data).
- **Verify:** web `files`; `npx vitest run tests/unit/engine tests/unit/events tests/unit/live --maxWorkers=2`.
- **Rules that apply:** react for `.tsx`; fui.
- **Risk:** high — `engineScheduler` timing; no behaviour change without patches.

### W43 — Components reading the moment (C·W14)
- **Serves:** AC-53, AC-54 (display), NFR-3.
- **Do:** use `usePatchedData()` (or the dataset from `useLiveData`) instead of `getData()` for event moments in: `components/player/CountdownScene.tsx:179-182`, `components/player/PlayerBlock.tsx:183,270-355`, `components/home/HomeLive.tsx:79-155`, `components/country/CountryLive.tsx:101`, `components/country/useCountryPlayer.ts:217-221`, `components/shell/useStampCelebration.ts:73`, `components/stamp/StampBlock.tsx:77,214`, `components/live/EventCard.tsx:172,261`. **Not converted** (catalog labels, map, schedule and lists show catalog time; out of AC-53/54 scope): `components/map/**`, `components/countries/**`, `components/schedule/**`, `components/passport/**`, `lib/passport/**`, `lib/prefest/**`, `lib/rating/**`, `lib/toast/**`, `lib/tv/**`, `components/dev/**`.
- **Files:** the 8 components above.
- **Done means:** web `files` green; their existing unit tests green unchanged.
- **Verify:** web `files`.
- **Rules that apply:** react, fui.
- **Risk:** medium.

### W44 — Patched-moment unit test (C·W14)
- **Serves:** AC-54.
- **Do:** `tests/unit/engine/patched-moment.test.ts`: with a −20 min moment patch on one event, `currentAirEvent`/handover and `buildStamp` grant time return the new moment; without a patch the outputs equal the unpatched ones.
- **Files:** `tests/unit/engine/patched-moment.test.ts`.
- **Done means:** green.
- **Verify:** web `files`.
- **Rules that apply:** —
- **Risk:** low.

### W45 — E2E specs for L (C·W14)
- **Serves:** AC-44, AC-52, AC-53, AC-56 (e2e half).
- **Do:** `tests/e2e/site-state/`: `toggle-latency.spec.ts` (20 toggles through `/api/_test/site`, measures time to the new `version` in an open tab via a test hook on `peek()`; prints `T2F_MEASURE {"metric":"site-toggle-ms",…}`; a variant with Centrifugo stopped asserts ≤30 s); `moment-patch.spec.ts` (test clock + correction −20 min → countdown text changes ≤30 s without reload); `red-button.spec.ts` + helper `edgeHarness.ts` (starts the edge Worker with `createTestHarness`, ASSETS = the integration build dir, `ORIGIN_URL` = local server; warms the cache with ≥20 requests, stops the server, puts the red-button object via `getEnv().SITE_BUCKET`, two tabs (desktop, phone) show the `states.backendDown` banner ≤60 s and the player element stays). Registered in `playwright.http.config.ts` as a serial project (to confirm config shape); `--workers=2`.
- **Files:** `tests/e2e/site-state/{toggle-latency.spec,moment-patch.spec,red-button.spec,edgeHarness}.ts`, `playwright.http.config.ts`.
- **Done means:** `npx tsc --noEmit -p .` green; specs listed by `npx playwright test --list -c playwright.http.config.ts`. They run in L.
- **Verify:** web `files` (typecheck + lint).
- **Rules that apply:** —
- **Risk:** medium — the harness with a static ASSETS dir; if it cannot serve the integration build, the red-button spec reads `/api/site/state` through the harness and the page through the web server with a proxy rule (decide in L, record).

### W46 — Integration pass (L, wave lead)
- **Serves:** AC-2 (http), AC-43, AC-44, AC-52, AC-53, AC-56, AC-58, AC-68 (production 404), NFR-3; closes every AC; **full verify**.
- **Do:** after the conductor's rebase, in order: (1) `migration-safety` summary, numbering vs master (regenerate per W6 if needed); (2) contract-conformance: `pnpm contracts:run --sim-only`, `node scripts/contract-surface.mjs --check`, `tests/contract/site.http.test.ts` against slot 16, table in the report; (3) `node scripts/check-secrets.mjs` after `git add -N` of new files; (4) **one** full verify: contracts, server, edge, ops, web `full` from the config (web `full` = `next build` to `out-verify` + `check-bundle` without `--allow-realtime` → AC-58 half 1); (5) AC-58 half 2: `pnpm build:prelaunch:domain` (writes `out-prelaunch` only) then `node scripts/check-bundle.mjs out-prelaunch` without the flag, and the integration build with `NEXT_PUBLIC_REALTIME_URL` of the local Centrifugo then `check-bundle --allow-realtime`; (6) `pnpm --dir server test:e2e -- doors-404`; (7) e2e W45 with `--workers=2` against slot 16 (server 4160, web 4161) — AC-44, AC-52 (p95 ≤3 s; ≤30 s without realtime), AC-53; (8) `layout-fidelity` on the pass, toasts and live-air boards on the http build with the empty port (NFR-3, ≤0.1 %); (9) docs patch outside the repo (AC-43 instruction ≤10 steps with the full prefixed keys, §3.11 row, env names, follow-ups 1–7) via `docs-sync`.
- **Files:** none in the tree (docs patch outside the repo; spec status by the orchestrator).
- **Done means:** every command green; reports: ms lines, cc table, measurements (AC-5 p95, AC-52 p95), fidelity percentages, bundle-check outputs.
- **Verify:** the Verification plan rows marked L.
- **Rules that apply:** ms, cc, layout-fidelity, seed-and-fixtures (n/a — confirm no seed diff).
- **Risk:** `pnpm build:prelaunch:domain` must not deploy (it only builds; deploy is a separate script — never run it).

### W47 — Rehearsal run (RH — only after the owner's «так», spec08-q3 answered «а»; not a merge condition)
- **Serves:** AC-69, AC-70, AC-71, AC-72.
- **Do:** with the two narrow keys (В4; GitHub token "Actions: write", [А-1]) set on rehearsal only: warm the cache (≥20 requests), stop the server, put the red button per the AC-43 instruction, measure desktop + phone banner ≤60 s with streams playing (screenshots); stop the tunnel 10 min, poll every 15 s, log `x-t2f-source` (all 200); change one country in the catalog, measure new version at the edge ≤15 min; 20 toggles: tab p95 ≤3 s and a new visitor ≤2 s after commit with the purge token (settles follow-up 2). No production domain, no paid nodes, no zone change.
- **Files:** none (report in the wave's report).
- **Done means:** the four measurements with evidence in the report, or `not run — owner has not said «так»`.
- **Verify:** manual.
- **Rules that apply:** `docs/services/` — every external action logged the same day.
- **Risk:** purge-by-URL may not drop Cache API entries (follow-up 2).

## Execution

Two lanes at most at the same time. Each dispatch: `sdd-engineering:implementer`, this plan's path, the phase id; ~80 tool calls; out of budget → `PARTIAL` with the tree green after the last finished item. Escalation Sonnet → Opus by `run-plan-auto` §3. A fresh implementer reads: the plan header, its Execution row, its items, the Affected-surface rows of its files, and the ACs its items cite.

| Lane / phase | Executor | Model | Work items | Files (disjoint) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| S·P1 — contracts | implementer | sonnet | W1–W4 | `packages/contracts/src/{site,site.schemas,schemas,siteGuard,siteRules,publicRoutes,index}.ts`, `packages/contracts/test/{site.test,isEnabled.table,isEnabled.test}.ts`, `scripts/contract-surface.baseline.json` | — | — | unit only |
| S·P2 — global + migration | implementer | sonnet | W5, W6 | `server/src/globals/siteState.ts`, `server/src/registries/globals.ts`, `server/src/migrations/**`, `server/src/payload-types.ts`, `server/test/integration/payload-schema.int.test.ts` | S·P1 | C·E8 | migration generator and migcheck alone (no other DB phase) |
| S·P3 — snapshot core | implementer | **opus** — version bump inside foreign transactions (corrections, catalog), pause table, journal + revert in one tx | W7–W11 | `server/src/domain/site/{switches,products,snapshot}.ts`, `server/src/site/{ports,service}.ts`, `server/src/adapters/{payloadSiteState,products}.ts`, `server/src/registries/revertHandlers.ts`, `server/src/corrections/service.ts`, `server/src/catalog/service.ts` (+ caller), `server/test/unit/{site-domain,site-isenabled}.test.ts` | S·P2 | C·E9 | unit only |
| S·P4 — fan-out after commit | implementer | **opus** — publish/purge/R2 only after commit, exactly-once per version across instances, retry/alarm schedules | W12–W16 | `server/src/site/{snapshot,fanout}.ts`, `server/src/adapters/cfPurge.ts`, `server/src/registries/{subscribers,env}.ts`, `server/.env.example`, `server/test/unit/site-env.test.ts`, `server/test/integration/{site-fanout,site-concurrency}.int.test.ts` (+ `infra/ops/test/env-example.test.mjs` if needed) | S·P3 | C·W10 | shared lock, int files one at a time |
| S·P5 — route, cms, door, wiring | implementer | **opus** — public cacheable route, owner writes, a test door, container | W17–W21 | `server/src/endpoints/{siteState,types,deps}.ts`, `server/src/registries/{routes,rateLimits}.ts`, `server/src/admin/cmsEndpoints.ts`, `server/src/test-doors/{site,registry}.ts`, `server/src/catalog/ports.ts`, `server/src/adapters/s3.ts`, `server/src/container.ts`, `server/test/unit/{public-routes,doors-gating}.test.ts`, `server/test/e2e/doors-404.e2e.ts`, `server/test/integration/{site-route,site-admin,doors}.int.test.ts` | S·P4 | C·W11 | shared lock |
| S·P6 — admin slice, command | implementer | sonnet | W22–W24 | `server/src/admin/{SiteStateSlice,SiteStateView}.tsx`, `server/src/admin/messages.ts`, `server/src/registries/adminSlots.ts`, `server/src/cli/sitePrepared.ts`, `server/package.json`, `server/test/unit/{site-slice,site-prepared}.test.ts` | S·P5 | C·W12 | unit only |
| S·P7 — rebuild | implementer | **opus** — debounce + freeze window on virtual time, exactly-once launch across instances, retries | W25–W27 | `server/src/domain/site/rebuild.ts`, `server/src/adapters/githubDispatch.ts`, `server/src/site/rebuild.ts`, `server/src/registries/subscribers.ts`, `server/src/container.ts`, `server/test/unit/site-rebuild.test.ts`, `server/test/integration/site-rebuild.int.test.ts` | S·P6 | C·W13 | shared lock |
| C·E8 — edge cache + red button | implementer | **opus** — Worker cache source order, stale/fresh windows, red-button precedence (`workers/**`) | W28–W30 | `workers/edge/src/{publicCache,redButton,handler,env}.ts`, `workers/edge/test/{public-cache,handler}.test.ts` | S·P1 | S·P2 | unit only |
| C·E9 — Worker entry, bindings, harness | implementer | **opus** — `workers/**` bindings and real-runtime cache/R2 evidence | W31, W32 | `workers/edge/src/index.ts`, `workers/edge/wrangler.json`, `workers/edge/test/{support/tempConfig,config.test,site-cache.worker.test}.ts` | C·E8 | S·P3 | harness on loopback ports |
| C·W10 — site adapter, reconnect | implementer | **opus** — realtime client reconnect and the bundle gate | W33–W35 | `lib/api/site/buildSnapshot.ts`, `lib/api/sim/site.ts`, `lib/api/http/{site,domains,index}.ts`, `lib/api/http/realtime/{backoff,transport}.ts`, `lib/api/domains.ts`, `lib/api/hooks/site.ts`, `tests/unit/api/{site-http,realtime-backoff,site-contract,site-isenabled}.test.ts`, `tests/unit/api/{site-hooks.test.tsx,site-sim.test.ts}`, `tests/contract/{site.suite,site.http.test}.ts` | S·P1 | S·P4 | no `next build` |
| C·W11 — banner, prices, pass consumers | implementer | sonnet | W36–W38 | `components/shell/Offline.tsx`, `tests/unit/shell/offline-outage.test.tsx`, `lib/offers/prices.ts`, `lib/api/hooks/site.ts`, `tests/unit/offers/prices.test.ts`, the 14 W38 components | C·W10 | S·P5 | no `next build` |
| C·W12 — toast prices, deploy workflow | implementer | sonnet | W39, W40 | `components/toast/{ToastTiers,ToastCompose,ToastGift,ToastPayment}.tsx`, `.github/workflows/deploy.yml`, `infra/ops/test/workflow.test.mjs` | C·W11 | S·P6 | — |
| C·W13 — patched dataset, engine | implementer | **opus** — data identity and engine timing (`engineScheduler`, air handover, stamp) | W41, W42 | `lib/data/patched.ts`, `lib/api/hooks/site.ts`, `tests/unit/data/patched.test.ts`, `lib/engine/{currentAirEvent,mainCelebration,stamp}.ts`, `lib/events/engineScheduler.ts`, `lib/api/hooks/live.ts`, `lib/live/{homeData,countryData}.ts`, `lib/player/BroadcastController.tsx` | C·W12 | S·P7 | — |
| C·W14 — moment components, e2e specs | implementer | sonnet | W43–W45 | the 8 W43 components, `tests/unit/engine/patched-moment.test.ts`, `tests/e2e/site-state/*`, `playwright.http.config.ts` | C·W13, S·P5 (doors) | — | e2e only listed, run in L |
| L — integration pass (full verify) | wave lead | — | W46 | none (docs patch outside the repo) | all phases + conductor's rebase | — | one heavy process at a time |
| RH — rehearsal | wave lead | — | W47 | none | L merged; **owner's «так»** | — | not a merge condition |

Order: S·P1 → (S·P2 ∥ C·E8) → (S·P3 ∥ C·E9) → (S·P4 ∥ C·W10) → (S·P5 ∥ C·W11) → (S·P6 ∥ C·W12) → (S·P7 ∥ C·W13) → C·W14 → L → (RH after «так»). Lane S never touches `workers/**`, `lib/**`, `components/**`, `tests/**`; lane C never touches `server/**` or `packages/contracts/src/**` (it imports them read-only). `lib/api/hooks/site.ts` is touched by C·W10, C·W11 and C·W13 — all in lane C, sequential. `server/src/registries/subscribers.ts` and `container.ts` are touched by S·P4/S·P5/S·P7 — lane S, sequential.

## Verification plan

| Command | Directory | Passing means |
|---|---|---|
| contracts `files` (config) | `packages/contracts` | exit 0 (S·P1) |
| `node scripts/contract-surface.mjs --check` (after `--update` in W4) | `.` | exit 0 (S·P1, L) |
| server `files` (config) | `server` | exit 0 (S·P2 … S·P7) |
| `node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>` | `server` | exit 0, 0 skipped (S·P2, P4, P5, P7) |
| `pnpm migrate:create site_state`; `node scripts/fix-migration-down.mjs <file>`; `pnpm generate:types`; `pnpm migrate`; `node scripts/db.mjs migcheck up` → `pnpm migrate` / `migrate:down` / `migrate` → `node scripts/db.mjs migcheck drop`; `node scripts/verify-schema.mjs` | `server` | exit 0 (S·P2) |
| edge `files` (config) | `workers/edge` | exit 0 (C·E8, C·E9) |
| web `files` (config) | `.` | exit 0 (C·W10 … C·W14) |
| ops `files` (config) | `infra/ops` | exit 0 (S·P4 if touched, C·W12) |
| `npx vitest run tests/unit/toast tests/unit/engine tests/unit/events tests/unit/live --maxWorkers=2` | `.` | green, unchanged (C·W12, C·W13) |
| `pnpm contracts:run --sim-only` | `.` | `site` row green (C·W10, L) |
| contracts, server, edge, ops, web `full` (config) — **once** | their dirs | exit 0 (L, W46 — closes "full verify") |
| `node scripts/check-secrets.mjs` (after `git add -N`), `node scripts/check-research-data.mjs` | `.` | clean (L, part of web `full`) |
| `pnpm build:prelaunch:domain` → `node scripts/check-bundle.mjs out-prelaunch`; integration build with `NEXT_PUBLIC_REALTIME_URL` → `node scripts/check-bundle.mjs <dir> --allow-realtime` | `.` | exit 0 both (L, AC-58) |
| `npx vitest run -c tests/contract/vitest.http.config.ts tests/contract/site.http.test.ts` (`T2F_SERVER_URL=http://127.0.0.1:4160`) | `.` | green (L, AC-2) |
| `pnpm --dir server test:e2e -- doors-404` | `.` | site door 404 like unknown in production class (L, AC-68) |
| `npx playwright test tests/e2e/site-state -c playwright.http.config.ts --workers=2` | `.` | AC-44 ≤60 s, AC-52 p95 ≤3 s / ≤30 s, AC-53 ≤30 s (L) |
| skills `migration-safety`, `contract-conformance`, `layout-fidelity` | — | green (S·P2 / L) |

## Assumptions

- **A1** The site version is one counter on the `site-state` global, bumped by an atomic `UPDATE … RETURNING` in the caller's transaction; corrections and catalog changes bump it beside their existing `publish(tx, …)`. Row lock = distinct increasing versions for concurrent writers (AC-4).
- **A2** Fan-out reads the whole snapshot after commit and is deduplicated by `lastFannedOut` with a conditional update, so several internal events of one transaction or several instances give one publication per version.
- **A3** Wire envelope `{type:'snapshot', id, version, data}` (follow-up 1); the domain `SiteEvent` stays `{type, state}`.
- **A4** Product selections store the chosen product's price and `priceVersion` at selection time; the snapshot never reads the port for prices (it reads it only to validate a choice and for the slice).
- **A5** Edge freshness is computed from a stored `x-t2f-cached-at` header and `deps.now()`, not from Cache API expiry (workerd cannot fake time); stored entries live `s-maxage=40` (= 10 + 30).
- **A6** The public-address list and the snapshot guard live in `packages/contracts/src` as import-free files the Worker imports by relative path; if `wrangler` bundling refuses the path, fallback = an edge copy pinned by a test against the contracts file (the `EDGE_NOW_HEADER` pattern, `workers/edge/src/proxy.ts:9-10`).
- **A7** Rebuild state is persisted on the `site-state` global (`rebuildDueAt`, `rebuildDeferred`), so the freeze-deferred launch survives a restart; the ticker runs every 15 s on the clock port.
- **A8** The GitHub repository `DmytrivDev/time2fest-web` is a constant in the adapter (no new env var; the spec's list is closed).
- **A9** The site never ships zod: the client validates with the zod-free guard, proven equal to the schema in W1.
- **A10** AC-54's conversion list is W42 + W43; catalog labels, map, schedule, passport, prefest, rating, toast greeting and TV keep the catalog time.

## Open questions

None.

## Research used

- Two planner researchers (2026-11-20). (1) Edge/external (Opus): wrangler 4.149.0 `createTestHarness` supports `caches.default` and local `r2_buckets` (`node_modules/wrangler/wrangler-dist/cli.js:375644, 183414-183420`), Node-side R2 via `h.getWorker().getEnv()`; cache expiry uses the real clock (`miniflare …/cache.worker.js:625`); `Set-Cookie` responses are never stored; `@cloudflare/workers-types` already typed in `workers/edge/tsconfig.json`; purge API `POST /zones/{id}/purge_cache {files}` and the Cache-API caveat (developers.cloudflare.com/workers/reference/how-the-cache-works, 2026-10-29); `repository_dispatch` 204, "Contents: write", default branch only (docs.github.com). Not established: whether purge-by-URL removes `cache.put` entries (→ follow-up 2, RH); whether `cache.put` throws or resolves on a 413 (tests assert a miss).
- (2) Web codebase (Sonnet): moment readers (`midnightMs`, no single chokepoint), price consumers, `OfflineNotice` only in `app/(live)/layout.tsx:54`, transport backoff (`transport.ts:12-16,143,258-262`), `check-bundle` flags and callers, contract-suite template, `resource.ts` has `refresh()` but no timer, build scripts.
- Code read by the planner: the spec; `packages/contracts/src/{site,index,realtime,realtime.schemas}.ts`; `lib/api/{contracts/site,sim/site,hooks/site,http/catalog,http/domains,http/index,http/realtime/index,http/realtime/types,domains}.ts`; `server/src/registries/{routes,channels,subscribers,env}.ts`; `server/src/endpoints/{types,catalog}.ts`, `pipeline.ts:30-104`; `server/src/realtime/{ports,publisher}.ts`; `server/src/audit/{ports,journal}.ts`; `server/src/events/ports.ts`; `server/src/catalog/copy.ts:1-30`, `ports.ts:48-51`; `server/src/corrections/service.ts:1-30`; `server/src/collections/eventPatches.ts`; `workers/edge/src/*`, `wrangler.json`, `vitest.config.ts`, tsconfigs, `test/handler.test.ts:150-185`, `test/worker.test.ts:1-40`, `test/support/tempConfig.ts`; `.github/workflows/deploy.yml`; `infra/ops/test/workflow.test.mjs:1-40`; `docs/knowledge/gotchas.md`; plans SPEC-07, SPEC-09 (format).

## Rollback / blast radius

- Contracts: additive types/schemas; `applySiteEvent` gains the outage rule (only affects states carrying `outage`, none before this wave).
- Server: one global (additive migration; the previous image ignores it), one public route, three owner routes, one door, one admin slice, fan-out and rebuild subscribers. Without the new env vars nothing leaves the process except Centrifugo publishes (already configured) and the R2 copy (existing bucket config). Reverting the S commits restores SPEC-07/09 behaviour; corrections/catalog only lose the version bump.
- Edge: only `/api/site/state` takes the new branch; every other path is proxied exactly as before (W30 asserts). No zone change; bindings matter only at the next deploy.
- Site: `site` domain moves to http in http builds; with no patch, no outage and an empty port the output is identical (L fidelity). The realtime client changes only its reconnect pauses. Prelaunch output unchanged (follow-up 7; bundle check in L).
- No PayPro call, no real purge or dispatch outside RH.
