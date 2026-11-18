# Implementation plan: Clock server — one time engine, exactly-once moment scheduler with a lease, virtual time (SPEC-07)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-07-clock-server.md` (Status: approved; 0 markers; Open questions 1–7 non-blocking, `:748-758`). AC-1 … AC-78 (`:105-380`), NFR-1 … NFR-8 (`:417-444`), contracts C1 … C10 (`:505-548`).
This plan implements those requirements; it does not define or change them.
**Execution mode** — multi-phase, at most **two lanes at once** (16 GB machine, `sdd-routing.md` §7). Lanes: **S** (server), **R** (rules, one phase), **E** (edge), **W** (web `lib/time`, e2e), **O** (`infra/ops`). File sets are disjoint between lanes. One `sdd-engineering:implementer` dispatch per phase, with this plan's path and the phase id. Phases **L** and **RH** are run by the wave lead (main session). Recommended by the planner on 2026-11-18 per the orchestrator brief (mode delegated to the planner).
**Out of scope** — the spec's Non-goals (`:60-71`): moment subscribers of other waves (only the registry, the run recorder and the recompute subscriber are built), stream statuses, delivery of patches to tabs, Telegram, load p99, a second production instance, node resize on any default path, arbitrary client speed on rehearsal, decisions about `hidden` events, any production/prelaunch site behaviour change, moving `lib/events/engineScheduler.ts`, the unattended ticker. Phase 0 (Centrifugo on the rehearsal node, secrets generator, `rt-rehearsal`, `NEXT_PUBLIC_REALTIME_URL`) is **already done** (`b783d2b`, `e2bdf20`) and is not re-planned. Architecture and security review are separate agents (`security-reviewer` mandatory).

Repository root for every path = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-07-clock-server` (branch `spec-07-clock-server`, base `0d7b4e3`).
- **Do not commit, never push** (the wave lead commits after each phase).
- Never read: `research_data/**`, `docs/archive/**`, `Old Project/**`, `reference-boards/**`, `graphify-out/graph.json`, `out*/`, `.next*/`, `node_modules` (except `.d.ts` lookups), `pnpm-lock.yaml`, `.env*` contents.
- **Another agent may still be editing `infra/ops/**` and `infra/cloudflare/**`** (phase 0 follow-ups). Lane O starts only after the wave lead confirms `git status --short infra/` is clean and `git log --oneline -3` shows no new phase-0 commit in flight. `infra/cloudflare/**` is not touched by this plan at all.
- Paths marked **(to confirm)** were not opened by the planner; the implementer checks them with Grep before editing and keeps the plan's intent.

## Requirements traceability

"int" = integration test (shared lock); "excl" = exclusive lock; "L" = wave-lead phase; "RH" = rehearsal evidence.

| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | Every scheduler/lease/slice/rule decision reads time only via the clock port; virtual in test/rehearsal when active | `:105` | W13, W27 | W15 Done |
| AC-2 | No good `/api/time` sample → `device-fallback`, one warn | `:108` | W46 | W46 Done |
| AC-3 | After a good sample, failures keep `server` state, back-off 5/10/20/60 s | `:111` | W46 | W46 Done |
| AC-4 | Device clock ±1 h → countdown within 1 s | `:114` | W51 | W51 Done (e2e), W58 |
| AC-5 | Edge `/api/time` ≤100 ms off UTC in 19/20 from two networks | `:117` | W60 | RH (manual) |
| AC-6 | `ops` installs chrony (`time.cloudflare.com`), disables timesyncd | `:122` | W53 | W53 Done |
| AC-7 | Not synced or \|offset\| >100 ms → non-zero exit | `:125` | W53, W60 | W53 Done; RH |
| AC-8 | Edge adds `x-t2f-edge-now` on forward | `:128` | W16 | W18 Done |
| AC-9 | Client `x-t2f-edge-now` replaced | `:131` | W16 | W18 Done |
| AC-10 | Header without valid edge secret ignored | `:134` | W20 | W21 Done (int) |
| AC-11 | Divergence = min per 60 s window, shown in slice | `:137` | W19, W20, W36 | W21 Done |
| AC-12 | >250 ms in 3 windows → `page` clock/edge-divergence | `:140` | W19, W20 | W21 Done (int) |
| AC-13 | 100–250 ms → `log` clock/edge-divergence-warn | `:143` | W19 | W21 Done |
| AC-14 | Empty window → unknown, no alarm; real time only | `:146` | W19, W20 | W21 Done |
| AC-15 | Rehearsal edge forwards `GET /api/time`, same 3 headers | `:151` | W17 | W18 Done |
| AC-16 | Origin silent 1 000 ms / non-2xx / bad body → edge time | `:154` | W17 | W18 Done |
| AC-17 | Production/prelaunch: edge clock only, no origin call | `:157` | W17 | W18 Done |
| AC-18 | Server stopped → countdown, slot switch, stamp continue (edge in production mode) | `:160` | W52 | W52 Done, W58 |
| AC-19 | Pure enumerator of all season moments (11 kinds), sorted | `:165` | W4 | W6 Done |
| AC-20 | Tie order handover/pin-end → zone-midnight → event-stamp by sortIndex → rest | `:168` | W4 | W6 Done |
| AC-21 | Keys without time; ±20 min patch keeps keys | `:171` | W4 | W6 Done |
| AC-22 | Poll window = midnight ±1 h, named constant | `:174` | W5 | W6 Done |
| AC-23 | `t2f-time/no-rule-copy` on `server/**` | `:177` | W7 | W7 Done |
| AC-24 | Event moments from patched moment; zone moments from tzdb midnight | `:180` | W22, W26 | W24 Done |
| AC-25 | `event-patch.changed`/`catalog.changed` → new list ≤2 s | `:185` | W28 | W39 Done (int) |
| AC-26 | Done pairs not repeated after patch; rest at new moment | `:188` | W22, W25 | W39 Done (int) |
| AC-27 | Each (moment, action) of a run epoch exactly once | `:193` | W25, W27, W29 | W39 (int ×600), W58 (×60), RH |
| AC-28 | Deterministic consequence id (action, sorted keys, epoch) | `:196` | W22 | W24 Done |
| AC-29 | Crash after publish → same id, client receives once | `:199` | W25, W27, W30 | W39 Done (int) |
| AC-30 | Same time + same action → one call with the group | `:202` | W22, W27 | W39 Done (int) |
| AC-31 | Speed >1 → AC-20 order, no gaps | `:205` | W27 | W39 Done, W58, RH |
| AC-32 | Start ≤1 000 ms real after due (p99), speed 1–600 | `:208` | W27, W29 | W39 measurement, W58, RH |
| AC-33 | Missed `always` actions run whatever the lateness | `:213` | W22, W27 | W40 Done (int) |
| AC-34 | `within` late >5 min → skip + journal | `:216` | W22, W27 | W40 Done (int) |
| AC-35 | `until` boundary passed → skip + journal | `:219` | W22, W27 | W40 Done (int) |
| AC-36 | Forward jump → AC-33…35 in server time | `:222` | W27 | W40 Done (int) |
| AC-37 | Backward jump same epoch → no repeats | `:225` | W25, W27 | W40 Done (int) |
| AC-38 | Frozen → no runs, no lag alarms | `:228` | W22, W27 | W24 Done |
| AC-39 | Due >2 s real and not started → `page` scheduler/lag | `:231` | W22, W27 | W40 Done (int) |
| AC-40 | Failure/unavailable → retry ≤1/s while the late rule allows, then "not done" | `:234` | W27 | W40 Done (int) |
| AC-41 | Non-holder raises no scheduler alarms | `:237` | W27 | W41 (excl) via W58 |
| AC-42 | ≤1 holder; ~6 s term, ~2 s renew, DB clock | `:242` | W25, W27 | W40 Done (int) |
| AC-43 | Non-holder runs no action | `:245` | W27 | W41 (excl) via W58 |
| AC-44 | Holder stopped → takeover ≤10 s, missed processed | `:248` | W25, W27 | W41 (excl) via W58; RH optional |
| AC-45 | Stale lease epoch refused before publish | `:251` | W25, W30 | W40 Done (int) |
| AC-46 | Cannot renew → stop before term by monotonic clock | `:254` | W22, W27 | W24 Done |
| AC-47 | Lease term in real time only | `:257` | W22 | W24 Done |
| AC-48 | Takeover journalled (prev, new, epoch, time) | `:260` | W27 | W40 Done (int) |
| AC-49 | Virtual change visible in every process ≤1 s, ≤50 ms apart | `:265` | W12, W13 | W15 Done (int) |
| AC-50 | Virtual state survives restart/deploy | `:268` | W12 | W15 Done (int); RH |
| AC-51 | Rehearsal admin: set (speed 1), real, restart-night, journalled | `:271` | W33, W34 | W37 Done (int) |
| AC-52 | Production: no control, C9 → 404 like unknown | `:274` | W34 | W37 Done, W57 |
| AC-53 | Non-owner/no Access → refused, no change | `:277` | W34 | W37 Done (int) |
| AC-54 | `ops clock` status/set/real/restart-night/speed, journal actor `ops` | `:280` | W35, W54 | W54 Done; RH |
| AC-55 | `ops clock` production → non-zero before connecting | `:283` | W54 | W54 Done |
| AC-56 | Rehearsal change → `clock` event in `site:state`, id `clock:<epoch>:<seq>` | `:286` | W33 | W37 Done (int) |
| AC-57 | Rehearsal build resyncs `TimeSource` on `clock` ≤5 s | `:289` | W47 | W47 Done; RH |
| AC-58 | Non-test builds: no time machine, no `/api/_test/*` | `:292` | W44, W48 | W48 Done, W57 |
| AC-59 | Integration build: start from `GET /api/_test/clock` (RTT/2) | `:297` | W43, W44 | W51 Done (e2e) |
| AC-60 | `?t=`, `?speed=`, panel, `__t2f` → `POST /api/_test/clock` | `:300` | W43, W45 | W51 Done (e2e) |
| AC-61 | Outside change followed ≤2 s (polling) | `:303` | W43 | W51 Done (e2e) |
| AC-62 | Invalid `?t=`/`?speed=` → warn, no POST | `:306` | W44 | W46 Done |
| AC-63 | `sim` builds keep the local machine | `:309` | W44 | W46 Done; W57 sim e2e |
| AC-64 | Panel jump to −5 s → `zone-midnight` recorded ≤2 s after | `:312` | W29, W51 | W51 Done (e2e) |
| AC-65 | Rehearsal ×60 via `ops clock`, one record per pair, AC-20 order | `:317` | W29, W35, W54 | RH (manual) |
| AC-66 | Full night at speed 1 on rehearsal | `:320` | W33 (mechanism) | SPEC-23 (manual, out of this wave's evidence) |
| AC-67 | Doors C7 only in test + `T2F_TEST_DOORS=1`; else 404 | `:325` | W30, W31 | W32 Done, W57 |
| AC-68 | Door list test counts 18 | `:328` | W31 | W32 Done |
| AC-69 | Strict door schemas | `:331` | W2, W30 | W32 Done |
| AC-70 | `scheduler-drill`: memory check, 2nd server profile, stop holder, measure, clean up, no resize | `:336` | W56 | W56 Done; RH optional |
| AC-71 | Not enough memory → refuse before any container | `:346` | W56 | W56 Done |
| AC-72 | Production or resize without explicit flag → refuse | `:349` | W56 | W56 Done |
| AC-73 | Moment registry: exactly the run recorder (test, rehearsal) | `:354` | W23, W29 | W32 Done, W39 |
| AC-74 | Event subscriber "recompute moments" on both topics | `:357` | W28 | W32 Done |
| AC-75 | Slice shows phase, slots, next 10, health, divergence, clock | `:362` | W36, W38 | W37 Done (int) |
| AC-76 | Slice refreshes ≥ every 5 s | `:373` | W38 | W51 (e2e), W58 measurement |
| AC-77 | Slice only for `owner` | `:376` | W34 | W37 Done (int) |
| AC-78 | One failing block shows error, others refresh | `:379` | W36, W38 | W37 Done (int) |
| NFR-1 | No new mandatory env var | `:417` | all | W57 (`env-example.test.mjs`, `ci.test.mjs`) |
| NFR-2 | Additive generated migration, previous image compatible | `:420` | W8, W9 | W10, W57 (migration-safety) |
| NFR-3 | Production/prelaunch bundles unchanged; transport only in rehearsal build | `:423` | W44, W47, W48 | W57 (`check-bundle`) |
| NFR-4 | Clock-changing e2e in a separate serial project | `:426` | W50 | W57 (two green runs) |
| NFR-5 | Measurements in the report | `:429` | W39, W41, W42, W58, W60 | L + RH |
| NFR-6 | 5 000 moments recomputed ≤200 ms | `:437` | W22 | W24 Done |
| NFR-7 | Journal of clock changes, takeovers, skips; no secrets | `:440` | W27, W33 | W40, W37 Done |
| NFR-8 | No action before the list is loaded; no tab events with an empty list | `:443` | W27 | W24 Done |

## Spec follow-ups

For `spec-creator` and the owner; the plan implements the spec as written and records how it reads these points.
1. **AC-58 vs. the real rehearsal build (Open question 6).** The rehearsal site build is `NEXT_PUBLIC_ENV=test` + `http` (`infra/ops/lib/config.mjs:37`, `package.json:37`) because the non-migrated domains still need `sim` (`lib/api/domains.ts:23-28`). Making it a production build would break the rehearsal site. The plan adds a build constant `NEXT_PUBLIC_SITE_CLASS=rehearsal` (`lib/env.ts`) that removes the time machine, the `window.__t2f` API and every `/api/_test/*` call from that build and enables the `clock` listener; `sim` domains stay. AC-58's checkable content holds for rehearsal, production and prelaunch outputs. The spec should say "rehearsal build = integration build without the time machine".
2. **Read side of the slice.** C9 lists only `POST /cms-api/clock`. AC-75/76 need a read the slice can poll, and AC-52 needs production to keep a read-only slice while `POST /cms-api/clock` is 404. The plan adds `GET /cms-api/festival-state` (owner only, every class). Additive.
3. **×60 full night length.** From `celebration-start` to `rating-close` the season spans ≈40 h virtual → ≈40 min real at ×60. The CI integration suite runs ×600 over a 2 h slice; the full ×60 night is a wave-lead script (W42/W58) and the rehearsal run (RH).
4. **AC-66** cannot be evidenced in this wave (SPEC-23 general rehearsal); the mechanism ships here.

## Affected surface

Routing = `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1. Abbreviations: **onion** = `engineering-paved-path:onion-architecture`, **sec** = `engineering-paved-path:security`, **cc** = `contract-conformance`, **ms** = `migration-safety`, **next** = `engineering-paved-path:next-best-practices`, **react** = `engineering-paved-path:react-best-practices`, **rtl** = `engineering-paved-path:react-testing-library`, **fui** = `engineering-paved-path:frontend-ui-architecture`.

| File | New/Mod | Package | Home (ring / radius) | Skills | Constraint to respect |
|---|---|---|---|---|---|
| `server/package.json` | Mod | server | manifest | sec | add `"@time2fest/rules": "workspace:*"` only (deps at `:37-53`); exact versions |
| `pnpm-lock.yaml` | Mod | — | generated | gap | written only by `pnpm install` in W1 |
| `server/Dockerfile` | Mod | server | image | sec (`**/docker*`? no — gap, reviewed under sec by brief) | `COPY packages/rules/ packages/rules/` next to `:27`; without it `next build` in the image fails (only `package.json` is copied, `:23`) |
| `packages/contracts/src/clock.ts`, `clock.schemas.ts`, `index.ts`, `schemas.ts` | New/Mod | contracts | wire | onion, cc | types zod-free in `index.ts` (`:1-5`); zod only via `schemas.ts` (`:1`) |
| `scripts/contract-surface.baseline.json` | Mod | web | generated | gap | additive |
| `packages/rules/src/time/season.ts`, `constants.ts`, `index.ts` | New/Mod | rules | pure rules | gap (rules unrouted) | no `Date.now`, only `const` module state (`eslint.config.mjs:131-151`) |
| `packages/rules/test/season.test.ts` | New | rules | test | gap | — |
| `server/eslint.config.mjs` | Mod | server | lint | gap | import the rule from `packages/rules/eslint/no-time-rule-copy.mjs`; tests excluded as in root (`eslint.config.mjs:154-159`) |
| `server/src/collections/schedulerLeases.ts`, `schedulerRuns.ts`, `runRecords.ts` | New | server | ring 4 (Payload) | ms | API access `never`; not resettable except `runRecords` (test) |
| `server/src/globals/clockState.ts` | New | server | ring 4 | ms | read/update via API `never`; only the adapter writes |
| `server/src/registries/{collections,globals}.ts` | Mod | server | root | onion, ms | one sorted line each |
| `server/src/migrations/<ts>_clock_server.{ts,json}`, `index.ts` | New/Mod | server | generated | ms | `pnpm migrate:create` + `node scripts/fix-migration-down.mjs`; additive only |
| `server/src/payload-types.ts` | Mod | server | generated | gap | regenerated |
| `server/src/domain/timekeeping/{virtual,divergence}.ts` | New | server | ring 1 | onion | pure; time as parameter |
| `server/src/timekeeping/{ports,shared,control,divergence}.ts` | New | server | ring 2/3 | onion | no `Date.now()` (`server/eslint.config.mjs:20-34`); real time comes from injected `realClock` |
| `server/src/clock/index.ts` | Mod | server | ring 4 (only wall-clock reader) | onion | keep `virtualNow`, `realClock`; add `monotonicClock`; `clockFor` gains the shared view |
| `server/src/adapters/{payloadClockState,pgScheduler,payloadMoments}.ts` | New | server | ring 4 | onion | Payload rows never leave adapters (`architecture.md:17`) |
| `server/src/domain/scheduler/{plan,consequence,late,lease}.ts` | New | server | ring 1 | onion | pure; NFR-6 |
| `server/src/scheduler/{ports,service,recompute,recorder,festival}.ts` | New | server | ring 2/3 | onion | services get ports as parameters, no container access |
| `server/src/registries/moments.ts` | Mod | server | root | onion | C5 row type; one row (recorder), `classes: ['test','rehearsal']` |
| `server/src/registries/subscribers.ts` | Mod | server | root | onion | add `scheduler-recompute` and `clock-refresh` rows, sorted |
| `server/src/registries/middleware.ts` | Mod | server | root | onion, sec | one new sorted row for edge-time samples |
| `server/src/container.ts` | Mod | server | root | onion, sec | additive: deps fields + `startProcessBackground` starts scheduler and clock refresher |
| `server/src/endpoints/types.ts` | Mod | server | ring 4 | onion, cc | optional `Deps` fields only |
| `server/src/test-doors/{scheduler,registry,index}.ts` | New/Mod | server | ring 4 | sec | doors only via dynamic import (`container.ts:324`); `dependencyBreaking` not needed |
| `server/src/admin/cmsEndpoints.ts` | New | server | ring 4 | onion (excluded? `admin/**` .ts routed by onion) , sec | owner check like `globals/unattendedState.ts:21-40`; C9 only when class `rehearsal` |
| `server/src/payload.config.ts` | Mod | server | config | ms | add `endpoints: cmsEndpointsFor(class)` (to confirm how the config reads the class) |
| `server/src/admin/{FestivalSlice,FestivalStateView}.tsx` | New | server | admin UI | gap (`server/src/admin/**/*.tsx`, propose react) | client part polls via `admin/api.ts` |
| `server/src/registries/adminSlots.ts` | Mod | server | root | onion | row `05-festival`, order 5 |
| `server/src/cli/clock.ts`, `server/package.json` script `clock` | New/Mod | server | ring 4 | sec | refuses unless class `rehearsal` (or `test` for tests) |
| `server/test/unit/*.test.ts` (new: `timekeeping`, `divergence`, `scheduler-plan`, `scheduler-lease`, `doors-scheduler`, `moments-registry`, `cms-endpoints`), `doors-gating.test.ts` | New/Mod | server | tests | gap | `// check-secrets: allow test fake` on literal keys |
| `server/test/integration/{clock-shared,divergence,scheduler-a,scheduler-b,clock-control}.int.test.ts`, `scheduler-support.ts`, `measure.ts` | New | server | tests | gap | serial, shared lock |
| `server/test/exclusive/scheduler-two-instances.exclusive.test.ts`, `support/scheduler-instance.ts` | New | server | tests | gap | exclusive lock only |
| `server/scripts/night-run.mjs` | New | server | script | sec | prints `T2F_MEASURE` lines |
| `server/test/e2e/doors-404.e2e.ts` | Mod | server | tests | gap | 14 → 18 rows |
| `workers/edge/src/{proxy,handler,responses}.ts` | Mod | edge | edge | sec | proxy contract `proxy.ts:1-2` unchanged otherwise |
| `workers/edge/test/{handler,worker}.test.ts` (to confirm which holds proxy tests) | Mod | edge | tests | — | — |
| `lib/env.ts` | Mod | web | lib | gap | constants inlined at build |
| `lib/time/{serverTimeMachine,rehearsalClock,params,TimeSource,testApi}.ts`, `TimeProvider.tsx` | New/Mod | web | lib | gap for `.ts` (lib/time unrouted), react for `.tsx` | `IS_TEST_BUILD` branches must stay dead-code in production |
| `components/dev/TimeMachineMount.tsx` | Mod | web | dev component | fui, react | mount only when the machine exists |
| `scripts/check-bundle.mjs`, `tests/unit/lint/check-bundle.test.ts` | Mod | web | script | sec | new signatures; same exit codes |
| `tests/unit/time/{serverTimeMachine,rehearsalClock,timeSource,params}.test.ts` | New/Mod | web | tests | rtl (no — `.ts`), gap | — |
| `playwright.http.config.ts`, `tests/e2e/server-clock/*.spec.ts`, `tests/e2e/edge-offline/*.spec.ts` | Mod/New | web | e2e | gap | `--workers=2`, clock project serial |
| `package.json` (scripts `build:edge:rehearsal`, `build:int` unchanged) | Mod | web | manifest | sec | add `NEXT_PUBLIC_SITE_CLASS=rehearsal` to `build:edge:rehearsal` only |
| `infra/ops/lib/{bootstrap,args,config}.mjs`, `infra/ops/ops.mjs`, `infra/ops/lib/clock.mjs`, `infra/ops/lib/drill.mjs`, `infra/ops/node/compose.drill.yml` | New/Mod | ops | infra | sec | `production` refused before connecting; one SSH connection per step (gotcha `ufw limit`) |
| `infra/ops/test/{bootstrap,clock,drill,args,worker}.test.mjs` | New/Mod | ops | tests | — | temp `localDir`/paths (gotcha `cf.mjs`) |

**Coverage gaps:** `packages/rules/**` and `lib/time/*.ts` (no routing row; apply onion-like purity rules of SPEC-03 and fui by analogy), `server/src/admin/**/*.tsx` (propose `react-best-practices`), `server/Dockerfile`, `server/test/**`, `tests/e2e/**`, `playwright.http.config.ts`, migrations and `payload-types.ts` (generated), `scripts/contract-surface.baseline.json`, all `*.md`.

## Contract changes

- **Shared contracts / schemas:** yes, additive only (C3, C7, C9, slice view). New `packages/contracts/src/clock.ts` (types: `ClockEvent` `{type:'clock', id, data:{virtual, speed}}`, `NightRunValue`, `NightRunRecord`, `LeaseDoorValue`, `ClockControlValue`, `FestivalStateView`, header name `EDGE_NOW_HEADER = 'x-t2f-edge-now'`) re-exported from `index.ts`; `clock.schemas.ts` (strict zod: `NightRunBodySchema` speed int 1..600 default 60, from/to int ≥0; `LeaseDoorBodySchema`; `FaultDoorBodySchema` `{after:'publish', action?: string ≤64}`; `ClockControlBodySchema` discriminated union `set|real|restart-night`; `ClockEventSchema`; `FestivalStateViewSchema`) re-exported from `schemas.ts`. Server validates with them; web uses types only. `TestClockSetSchema`/`TestClockStateSchema` unchanged.
- **Migration:** yes → collections `scheduler-leases` (name unique, holder, epoch int, expiresAt, renewedAt), `scheduler-runs` (runEpoch, action, momentKey; unique (runEpoch, action, momentKey); status started|done|skipped|failed; consequenceId; leaseEpoch; plannedAt; startedAt; finishedAt; reason), `run-records` (consequenceId unique, keys json, action, runEpoch, plannedAt, startedAt (real ms), at (server ms)), global `clock-state` (virtual bool, anchorVirtual, anchorReal, speed, frozen, runEpoch, seq). Generated by `cd server && pnpm migrate:create clock_server` then `node scripts/fix-migration-down.mjs <file>` (scripts `server/package.json:18-21`). Additive only; the previous image ignores the new tables (deploy never runs `down`).
- **Seed / fixture data:** no seed change (no collection that the site reads; the lease row is created on first acquire by `INSERT … ON CONFLICT DO NOTHING`, the clock-state global defaults to "real"). The test door `reset` additionally empties `run-records` and `scheduler-runs` and resets the shared clock (W14, W30). Fixtures: none — scheduler tests use the seeded catalog.
- **Build-only failures:** yes, three.
  1. Server image: `packages/rules` source is not copied (`server/Dockerfile:23,27`) → image `next build` fails once the server imports `@time2fest/rules`. Fixed in W1; caught by the wave lead's image build in L (`git archive HEAD | docker build -f server/Dockerfile --build-arg T2F_COMMIT=<sha> -`), also by the RH deploy.
  2. Production site bundle: the time machine, `window.__t2f`, `/api/_test/*` strings or `centrifuge` slipping into `out-verify` → caught by `node scripts/check-bundle.mjs out-verify` (extended in W48) after `npx cross-env NEXT_DIST_DIR=out-verify next build`.
  3. Server `next build`: new `node:` imports reached from files the edge runtime reads; `pnpm --dir server build` in L.
- **Wire contract:** yes, additive — `clock` event on `site:state` (C3), four doors (C7), header `x-t2f-edge-now` (C8), `POST /cms-api/clock` (C9, rehearsal only), `GET /cms-api/festival-state` (slice read, follow-up 2), moments list C1 (rules export), `/api/time` unchanged (C2). cc check: `pnpm contracts:run --sim-only` stays green; `tests/contract/time.http.test.ts` re-run in L against the stack (C2 body unchanged); §3.11 row and `architecture.md` rings in the docs patch (W59).
- **Payload migration:** yes (see Migration) → skill `migration-safety` in L: generated, up/down/up on a copy of the seeded DB, types regenerated, no number clash with master.
- **Seed and fixtures:** no (see above).
- **Test doors:** yes — four new doors in `server/src/test-doors/scheduler.ts`, registered only through `doorRegistry` (dynamic import, `container.ts:324`); 14 → 18 in `doors-gating.test.ts` and `doors-404.e2e.ts`; production-class e2e run in L.
- **Agent write surface:** no — no role, service key or agent path; C9 is owner-only through Access. `security-reviewer` runs anyway.
- **Layout fidelity:** yes, small smoke. No reference board changes. `lib/time/params.ts` (time source of the integration build) changes, so the integration build's time path is different. Run `layout-fidelity` on **3 boards** chosen by the wave lead from the board-tools manifests: one home pre-midnight countdown, one live air at midnight, one post-midnight stamp state (the skill's selection for `lib/time` consumers). Board capture must run **one page at a time** (the time machine now moves the server clock). Production/prelaunch: no fidelity run (NFR-3; bundle check proves no change).

## Work items

Conventions for every item:
- **Verify (server)** = `cd server && npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`.
- **Verify (rules / contracts / edge / ops / web)** = the config `files` command of that package in its `dir` (`.claude/sdd-engineering.json`).
- **One integration file** = `cd server && node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>`. The stack must be up (`pnpm stack:up`, worktree DBs created and migrated: `node scripts/db.mjs create && pnpm migrate` in `server`).
- **Exclusive** = `cd server && node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.integration.config.ts test/exclusive/<file>` — never `pnpm` after `--` on Windows.
- Every literal secret in a test: `// check-secrets: allow test fake`. Byte comparisons of files normalise `\r\n` → `\n`.
- **Measurement lines** (NFR-5): one stdout line `T2F_MEASURE {"metric":"<name>",…}` printed by `server/test/integration/measure.ts` (`printMeasure(metric, values)` → `{n,p50,p99,max}` in ms). Metrics: `moment-deviation-ms`, `lease-takeover-ms`, `admin-refresh-ms`, `node-clock-offset-ms`, `edge-time-offset-ms`.

### W1 — Server depends on `@time2fest/rules`; image copies it (P1)
- **Serves:** enables AC-19…AC-24, AC-27 (server reads moments from rules).
- **Do:** `server/package.json` dependencies: `"@time2fest/rules": "workspace:*"` (sorted after contracts). Run `pnpm install` once (only lockfile write of the wave). `server/Dockerfile`: `COPY --chown=node:node packages/rules/ packages/rules/` right after the contracts source copy (`:27`). If `server/next.config.mjs` needs `transpilePackages` for TS sources of workspace packages, check how `@time2fest/contracts` is resolved today and mirror it (to confirm).
- **Files:** `server/package.json`, `pnpm-lock.yaml`, `server/Dockerfile`.
- **Done means:** `pnpm install --frozen-lockfile` exits 0; `cd server && node -e "import('@time2fest/rules/time').then(m=>console.log(typeof m.momentTimeline))"` via `npx tsx -e` prints `function`; `grep -n "packages/rules/ packages/rules/" server/Dockerfile` finds one line; `infra/ops/test/image.test.mjs` still green (to confirm it asserts Dockerfile lines).
- **Verify:** commands above + ops `files` on `test/image.test.mjs`.
- **Rules that apply:** sec → pinned workspace dependency, no new external package.
- **Risk:** lockfile conflict at merge — re-run `pnpm install`, never hand-edit.

### W2 — Clock wire types and strict schemas (P1)
- **Serves:** AC-56 (C3), AC-67, AC-69 (C7), AC-51…AC-53 (C9), AC-75 (view), AC-8 (C8 name).
- **Do:** as listed in Contract changes. Speed int 0..600 for C10/`set`; door `night-run` speed 1..600; all objects `.strict()`; negative times rejected. Unit tests in `packages/contracts/test/clock.test.ts`: unknown field, speed 601, speed 0 in night-run, negative `from` all fail; valid bodies parse.
- **Files:** `packages/contracts/src/{clock,clock.schemas,index,schemas}.ts`, `packages/contracts/test/clock.test.ts`.
- **Done means:** contracts `files` green; the new test proves each rejection named above.
- **Verify:** contracts `files`.
- **Rules that apply:** cc → additive only, wire schema in `packages/contracts`; onion → no runtime import in `index.ts`.
- **Risk:** low.

### W3 — Contract-surface baseline (P1)
- **Serves:** enables the cc gate for W2.
- **Do:** `node scripts/contract-surface.mjs --write` (to confirm flag name with `--help`), review that only additions appear.
- **Files:** `scripts/contract-surface.baseline.json`.
- **Done means:** `node scripts/contract-surface.mjs --check` exits 0; `git diff` of the baseline has only `+` lines.
- **Verify:** that command.
- **Rules that apply:** cc → non-breaking.
- **Risk:** low.

### W4 — Season moments enumerator C1 (P2)
- **Serves:** AC-19, AC-20, AC-21, AC-24 (rules half).
- **Do:** `packages/rules/src/time/season.ts`: `seasonMoments(input)` where input = `{ seasonId, zones: {zoneId, midnightMs}[], events: {eventId, zoneId, countryIso, momentMs, sortIndex, hidden?}[] }` → `SeasonMoment[]` (`key`, `kind`, `at`, `rank`, `order`, `zoneId?`, `eventId?`, `countryIso?`, `hidden?`). Kinds and times from existing constants only: `celebration-start` = first midnight − `CELEBRATION_LEAD`; per zone `poll-start`/`poll-end` (W5), `zone-midnight`, `pin-end` (= zone midnight, per spec C5 "pin-end by tzdb"); per event `event-reminder` (= moment − `HOWTO_BEFORE`), `event-moment`, `event-stamp` (+`STAMP_DELAY`), `event-handover` (`handoverMoment`); `celebration-end` (last midnight + `CELEBRATION_TAIL`); `rating-close` (`ratingCloseAt`). Key = `<kind>:<zoneId|eventId|seasonId>`. Sort by `at`, then rank (1 handover & pin-end, 2 zone-midnight, 3 event-stamp by `order`, 4 rest), then key. Export from `time/index.ts`. No clock read.
- **Files:** `packages/rules/src/time/season.ts`, `packages/rules/src/time/index.ts`.
- **Done means:** W6 tests green; `grep -n "Date.now\|new Date()" packages/rules/src/time/season.ts` empty; rules lint clean.
- **Verify:** rules `files`.
- **Rules that apply:** SPEC-03 purity (`eslint.config.mjs:131-151`); reuse constants, no copied numbers (`t2f-time/no-rule-copy`).
- **Risk:** the exact instants of `event-reminder` and `pin-end` are plan interpretations of C1 kind names; recorded in Assumptions.

### W5 — Poll window constant and functions (P2)
- **Serves:** AC-22.
- **Do:** `constants.ts`: `POLL_WINDOW_BEFORE = 60 * MIN`, `POLL_WINDOW_AFTER = 60 * MIN`; `season.ts`: `pollWindow(midnightMs) → {from, to}` used by the enumerator.
- **Files:** `packages/rules/src/time/{constants,season}.ts`.
- **Done means:** `poll-start`/`poll-end` of three zones equal midnight ∓ 3 600 000 in W6.
- **Verify:** rules `files`.
- **Rules that apply:** as W4.
- **Risk:** low.

### W6 — Enumerator tests (P2)
- **Serves:** AC-19…AC-22.
- **Do:** `packages/rules/test/season.test.ts`: small catalog full expected list; Kiribati handover 10:15 UTC = Chatham midnight → `event-handover` before `zone-midnight`; Nepal handover 18:30 UTC = India midnight; UTC+1 zone with 3 countries → stamps by `sortIndex`; same event ±20 min patch → identical key set; empty input → `[]`; 5 000-moment synthetic input enumerates in <200 ms (also a rules-side guard for NFR-6). Update `exports.test.ts` if it pins the export list.
- **Files:** `packages/rules/test/season.test.ts`, `packages/rules/test/exports.test.ts`.
- **Done means:** rules `full` green.
- **Verify:** rules `full`.
- **Rules that apply:** tests may build boundary instants (root lint ignores tests).
- **Risk:** low.

### W7 — `t2f-time/no-rule-copy` for `server/**` (P2)
- **Serves:** AC-23.
- **Do:** in `server/eslint.config.mjs` add a block `files: ['src/**/*.ts'], ignores: ['src/migrations/**']`, plugin `t2f-time` from `../packages/rules/eslint/no-time-rule-copy.mjs` (check its export shape in the root config's import, `eslint.config.mjs` top), rule `'t2f-time/no-rule-copy': 'error'`. Add `server/test/unit/lint-rule-copy.test.ts` that runs ESLint's `Linter`/`ESLint` API on an in-memory snippet `const x = midnightMs + 15 * 60_000;` with `filePath: 'src/example.ts'` and expects one error from that rule.
- **Files:** `server/eslint.config.mjs`, `server/test/unit/lint-rule-copy.test.ts`.
- **Done means:** the test passes; `cd server && npx eslint .` exits 0 on the current tree (fix any existing hit by importing the rule constant, never by disabling).
- **Verify:** server `files` + `npx eslint .`.
- **Rules that apply:** onion → no rule copies in server.
- **Risk:** existing server code may copy a boundary (e.g. unattended windows) — fix inside this item; if more than 3 files, report PARTIAL.

### W8 — Collections and global for lease, runs, records, clock state (P3)
- **Serves:** NFR-2; enables AC-42…AC-50, AC-27, AC-73.
- **Do:** the four definitions listed in Contract changes, API access `never` for create/update/delete (read: owner only for `run-records`, others `never`), `admin.hidden: true`. Unique indexes via Payload `index`/`unique` (compound unique for `scheduler-runs` through `indexes` — to confirm Payload 3.91 syntax). Register one sorted line in `registries/collections.ts` (`resettable: true` only for `run-records` and `scheduler-runs`) and `registries/globals.ts`.
- **Files:** `server/src/collections/{schedulerLeases,schedulerRuns,runRecords}.ts`, `server/src/globals/clockState.ts`, `server/src/registries/{collections,globals}.ts`.
- **Done means:** server `files` green; `assertRegistry` passes.
- **Verify:** server `files`.
- **Rules that apply:** ms → collections thin; architecture.md → Payload rows stay in adapters.
- **Risk:** `resettable` on `scheduler-runs` must not erase a live run in non-test classes — reset exists only in `test`.

### W9 — Generated migration (P3)
- **Serves:** NFR-2.
- **Do:** `cd server && pnpm migrate:create clock_server`, then `node scripts/fix-migration-down.mjs src/migrations/<file>.ts`; check `up` is CREATE-only; regenerate `payload-types.ts` (`pnpm generate:types` — to confirm script name); `pnpm migrate` on the worktree DB.
- **Files:** `server/src/migrations/<ts>_clock_server.{ts,json}`, `server/src/migrations/index.ts`, `server/src/payload-types.ts`.
- **Done means:** migration `up` contains no `DROP`/`ALTER … DROP`/`RENAME`; `pnpm migrate` exits 0; `node scripts/verify-schema.mjs` exits 0; `server/test/unit/migration-down.test.ts` green.
- **Verify:** those commands + server `files` on the migration.
- **Rules that apply:** ms → generated, never hand-written; `down` works.
- **Risk:** number clash with another wave merged first → the second to merge regenerates (wave-orchestration).

### W10 — Schema check (P3)
- **Serves:** NFR-2.
- **Do:** extend `server/test/integration/payload-schema.int.test.ts` (to confirm what it asserts) with the four new tables and the unique indexes.
- **Files:** `server/test/integration/payload-schema.int.test.ts`.
- **Done means:** that integration file green.
- **Verify:** one integration file.
- **Rules that apply:** ms.
- **Risk:** low.

### W11 — Virtual-time domain (P4)
- **Serves:** AC-49, AC-50, AC-51, AC-54, AC-56 (rules of change).
- **Do:** `server/src/domain/timekeeping/virtual.ts`: state `{virtual, anchorVirtual, anchorReal, speed, frozen, runEpoch, seq}`; pure transitions `setMoment(state, at, realNow)` (speed 1, virtual), `backToReal(state, realNow)`, `restartNight(state, realNow)` (runEpoch+1), `setSpeed(state, speed, realNow)` (re-anchor at current virtual instant), `testSet(state, change, realNow)` (door semantics of `clock/index.ts:59-72`); each increments `seq`. `now(state, realNow)` reuses `virtualNow` (move it here and re-export from `clock/index.ts`). `clockEventId(state) = 'clock:' + runEpoch + ':' + seq`.
- **Files:** `server/src/domain/timekeeping/virtual.ts`, `server/src/clock/index.ts` (re-export only in this item).
- **Done means:** unit tests in W15 for every transition; re-anchoring never jumps (`now` before == after at change instant).
- **Verify:** server `files`.
- **Rules that apply:** onion ring 1 — no I/O, no clock read.
- **Risk:** low.

### W12 — Clock-state port and Payload adapter (P4)
- **Serves:** AC-49, AC-50, NFR-7.
- **Do:** `server/src/timekeeping/ports.ts`: `ClockStateStore { load(): Promise<State>; change(actor, fn: (s)=>State): Promise<State> }` (one transaction: read with lock, write global, journal row via the existing journal, outbox `clock.changed` with `{seq, runEpoch}`), `MonotonicClock { now(): number }`. `server/src/adapters/payloadClockState.ts` implements it (pattern: `adapters/payloadUnattended.ts`). Journal row: actor, before, after, runEpoch — no secrets.
- **Files:** `server/src/timekeeping/ports.ts`, `server/src/adapters/payloadClockState.ts`.
- **Done means:** W15 integration: a change writes one global row, one `audit-log` row, one `clock.changed` outbox row in one transaction (rollback on journal failure leaves the global unchanged).
- **Verify:** server `files` + one integration file (W15).
- **Rules that apply:** architecture.md → journal in the same transaction; event = outbox row.
- **Risk:** global write lock — use the adapter's transaction pattern from `payloadUnattended.ts`.

### W13 — Shared clock view; `clockFor` per class; container (P4)
- **Serves:** AC-1, AC-49.
- **Do:** `server/src/timekeeping/shared.ts`: `createSharedClock({store, real, log})` → `Clock & { refresh(): Promise<void>; state(): State; apply(state) }` — cache in memory, `now()` = real when not virtual, else `virtualNow`; refresh on boot, on `clock.changed` (subscriber W28 row `clock-refresh`), and every 5 s (unref timer) as fallback. `clock/index.ts`: `monotonicClock` (`performance.now`), `clockFor(cls, shared?)` → production `realClock`; test/rehearsal → the shared view. `container.ts`: build the store and shared clock in `createDeps` (`overrides.clock` still wins), expose `deps.sharedClock` (new optional field in `endpoints/types.ts`); `startProcessBackground` calls `refresh()` before anything else.
- **Files:** `server/src/timekeeping/shared.ts`, `server/src/clock/index.ts`, `server/src/container.ts`, `server/src/endpoints/types.ts`, `server/src/registries/subscribers.ts` (row `clock-refresh`, topic `clock.changed`).
- **Done means:** unit: production deps' clock is `realClock`; rehearsal/test deps' clock follows a stubbed store change after `refresh()`; integration W15 AC-49.
- **Verify:** server `files`.
- **Rules that apply:** onion → container is the only wiring point; AC-34 of SPEC-02 → only `clock/` reads wall time.
- **Risk:** processes that never start background (CLI, tests) must call `refresh()` explicitly — documented in the module header.

### W14 — Test doors and reset through the shared store (P4)
- **Serves:** AC-49, AC-59…AC-61 (server side), AC-64.
- **Do:** `createTestClock` becomes a facade over the shared clock + store: `set(change)` → `store.change('test-door', s => testSet(s, change, real))` then `apply`; `reset()` → back to real (async). `DoorTools.clock` type updated; `clock-get`/`clock-set` doors `await`; `seed/index.ts` `clock.reset()` awaits (to confirm the call site `:60-72`). Keep `GET /api/_test/clock` value shape `TestClockState`.
- **Files:** `server/src/clock/index.ts`, `server/src/test-doors/{registry,index}.ts`, `server/src/seed/index.ts`.
- **Done means:** `server/test/integration/doors.int.test.ts` green unchanged in intent (adapt `afterEach` to await `reset()`); door state persists across two `buildDispatcher` calls.
- **Verify:** server `files` + one integration file `doors.int.test.ts`.
- **Rules that apply:** sec → `createTestClock` still imported only by `test-doors` (and tests).
- **Risk:** every integration file that calls `createTestClock().reset()` synchronously needs `await` — grep `createTestClock` in `server/test/**` and fix all in this item.

### W15 — Virtual-time tests (P4)
- **Serves:** AC-1, AC-49, AC-50, NFR-7 (clock part).
- **Do:** `server/test/unit/timekeeping.test.ts` (W11 transitions, clockFor per class); `server/test/integration/clock-shared.int.test.ts`: two deps sets (two `createDeps` + two buses in one process, or one child via `tsx` like `exclusive/support/events-instance.ts`) — `POST /api/_test/clock` on A, both `GET` within 1 s, |A−B| ≤50 ms; new `createDeps` after a change (restart) keeps anchor, speed, epoch; journal row per change has no `T2F_EDGE_SECRET` value.
- **Files:** `server/test/unit/timekeeping.test.ts`, `server/test/integration/clock-shared.int.test.ts`.
- **Done means:** both green.
- **Verify:** server `files` + one integration file.
- **Rules that apply:** —
- **Risk:** timing flake — assert with polling up to 1 s, not a fixed sleep.

### W16 — Edge `x-t2f-edge-now` (P5)
- **Serves:** AC-8, AC-9.
- **Do:** `proxy.ts`: `headers.delete('x-t2f-edge-now')` with the other client headers, then `headers.set('x-t2f-edge-now', String(Math.trunc(deps.now())))` immediately before `deps.fetch`; `proxy` deps gain `now`.
- **Files:** `workers/edge/src/proxy.ts`, `workers/edge/src/handler.ts`.
- **Done means:** W18 tests.
- **Verify:** edge `files`.
- **Rules that apply:** sec → client-controlled headers are always stripped.
- **Risk:** low.

### W17 — Rehearsal `/api/time` via origin with fallback (P5)
- **Serves:** AC-15, AC-16, AC-17.
- **Do:** `handler.ts` step 3: `production`/`prelaunch` → `timeNow(deps.now())` as today; `rehearsal` → `proxy` of `GET /api/time` with `AbortSignal.timeout(1000)` (or a race with a 1 000 ms timer); accept only 2xx with JSON body `{now}` where `now` is an integer ≥0, and answer `timeNow(body.now)` (same three headers); anything else → `timeNow(deps.now())`. `test` unchanged (forward). If `ORIGIN_URL` or the secret is missing in rehearsal → edge time.
- **Files:** `workers/edge/src/handler.ts`, `workers/edge/src/responses.ts` (helper only if needed).
- **Done means:** W18 tests.
- **Verify:** edge `files`.
- **Rules that apply:** sec → origin body validated before use; fail to edge time, never to an error.
- **Risk:** `AbortSignal.timeout` availability in workerd/Node tests — fall back to a manual timer.

### W18 — Edge tests (P5)
- **Serves:** AC-8, AC-9, AC-15, AC-16, AC-17.
- **Do:** in the handler/proxy test file (to confirm: `workers/edge/test/handler.test.ts`): header present and integer; client value replaced; rehearsal forward returns origin `now` with the three headers; three failure cases (1 100 ms delay with fake timers, 500, `{now:-1}`/`{now:1.5}`) → edge `now`; production/prelaunch: fetch stub called 0 times. `time-contract.test.ts` still green.
- **Files:** `workers/edge/test/handler.test.ts` (and `worker.test.ts` if proxy tests live there).
- **Done means:** edge `full` green.
- **Verify:** edge `full`.
- **Rules that apply:** —
- **Risk:** low.

### W19 — Divergence domain (P6)
- **Serves:** AC-11, AC-12, AC-13, AC-14.
- **Do:** `server/src/domain/timekeeping/divergence.ts`: `windowOf(realMs)` (60 s), `addSample(acc, arrivalReal, edgeNow)` keeps min of `arrival − edgeNow`; `closeWindow(acc, streak)` → `{value | 'unknown', level: 'ok'|'warn'|'page', streak}`: |v|>250 → streak+1, page when streak reaches 3 (once per streak); 100<|v|≤250 → warn; empty → unknown, streak unchanged-reset to 0 (to state in tests).
- **Files:** `server/src/domain/timekeeping/divergence.ts`.
- **Done means:** W21 unit cases.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 1.
- **Risk:** low.

### W20 — Divergence sampler as middleware row (P6)
- **Serves:** AC-10, AC-11, AC-12, AC-13, AC-14.
- **Do:** `server/src/timekeeping/divergence.ts`: `createDivergenceMeter({real: realClock, alarm, log})` with `sample(edgeNow)`, `current()`; window closing on a 5 s unref timer by **real** time. Middleware row (sorted key, e.g. `05-edge-time`) in `registries/middleware.ts`: when `ctx.client.edgeVerified` and header `x-t2f-edge-now` parses as a safe integer, `meter.sample(value)`; otherwise ignore. Alarms: `page` `clock`/`edge-divergence`, `log` `clock`/`edge-divergence-warn`, details `{ms, windows}` only. Meter on `deps` (optional field), built in `container.ts`.
- **Files:** `server/src/timekeeping/divergence.ts`, `server/src/registries/middleware.ts`, `server/src/container.ts`, `server/src/endpoints/types.ts`.
- **Done means:** W21.
- **Verify:** server `files`.
- **Rules that apply:** sec → header trusted only with a verified edge secret; onion → middleware row in the registry.
- **Risk:** middleware runs only for matched routes — acceptable (every proxied path is a route or a 404 without a sample).

### W21 — Divergence tests (P6)
- **Serves:** AC-10…AC-14.
- **Do:** unit `server/test/unit/divergence.test.ts` (min with simulated latency, warn level via stub `Alarm`, unknown window, active virtual time does not change the value); integration `server/test/integration/divergence.int.test.ts`: rehearsal-class deps with an edge secret (pattern `doors.int.test.ts:20-34`): header without secret → no sample; with secret and +300 ms skew over 3 windows (inject the meter's real clock/timer, not the test clock) → exactly one `alarms` row `clock/edge-divergence`.
- **Files:** `server/test/unit/divergence.test.ts`, `server/test/integration/divergence.int.test.ts`.
- **Done means:** both green.
- **Verify:** server `files` + one integration file.
- **Rules that apply:** —
- **Risk:** AC-12's spec hint says "test clock drives windows" but AC-14 demands real time; the meter takes an injectable real clock — the test injects a fake one (Assumption).

### W22 — Scheduler domain (P7)
- **Serves:** AC-24, AC-26, AC-28, AC-30, AC-33…AC-35, AC-38, AC-39, AC-46, AC-47, NFR-6.
- **Do:** `server/src/domain/scheduler/plan.ts`: `buildPlan(moments C1, rows C5, cls)` → per (action, at) groups of keys (AC-30), ordered by C1 order; `dueGroups(plan, serverNow, doneSet)` excluding done (moment, action) pairs (AC-26, AC-37); `consequence.ts`: `consequenceId(actionKey, runEpoch, sortedKeys)` = `<action>:<epoch>:<sha256(keys.join('\n')) hex 16>` (C4); `late.ts`: `lateVerdict(rule, at, serverNow, momentsByKind)` → `run | skip` (`always`; `within` >300 000 → skip; `until` kind instant passed → skip); `lagMs(at, serverNow, speed)` real-ms lag, no lag when speed 0; `lease.ts`: `mayAct({grantedAtMono, termMs, nowMono})` real-time only (AC-46, AC-47).
- **Files:** `server/src/domain/scheduler/{plan,consequence,late,lease}.ts`.
- **Done means:** W24.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 1 (`node:crypto` hash allowed).
- **Risk:** low.

### W23 — Scheduler ports and C5 row type (P7)
- **Serves:** AC-73 (registry shape); enables AC-27…AC-48.
- **Do:** `server/src/scheduler/ports.ts`: `LeaseStore { acquireOrRenew(holderId): Promise<{held, epoch, expiresInMs, previousHolder?}>; release? }`, `RunStore { claim(leaseEpoch, holder, runEpoch, action, keys, consequenceId, plannedAt): Promise<'claimed'|'stale'|'done'>; finish(…status, reason) ; donePairs(runEpoch); missed24h() }`, `MomentSource { load(): Promise<SeasonMoment[]> }`, `ActionContext`. `registries/moments.ts`: replace `MomentRow` with `MomentActionRow` (C5: `key, capability, kinds, late, classes?, run(group, ctx)`) and `momentActionsFor(cls)`; rows empty in this item (recorder row added in W29). Check that nothing else imports `MomentRow`/`momentsRegistry` (`graphify affected "momentsRegistry"`).
- **Files:** `server/src/scheduler/ports.ts`, `server/src/registries/moments.ts`.
- **Done means:** server `files` green.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 2, technology-neutral.
- **Risk:** low.

### W24 — Scheduler unit tests (P7)
- **Serves:** AC-24, AC-28, AC-38, AC-46, AC-47, NFR-6, NFR-8 (domain half).
- **Do:** `server/test/unit/scheduler-plan.test.ts` (same ids twice, different epoch → different id; patch +20 min moves only that event's moments; UTC+1 group one call; frozen → no due, no lag; 5 000 moments recomputed <200 ms measured with `performance.now()`), `server/test/unit/scheduler-lease.test.ts` (term by monotonic time; speed 600 and +1 h jump don't change it; failing store → no action after term).
- **Files:** the two test files.
- **Done means:** both green.
- **Verify:** server `files`.
- **Rules that apply:** —
- **Risk:** perf test on a slow machine — threshold 200 ms as the spec says, run once warm.

### W25 — Postgres lease and run store adapter (P8)
- **Serves:** AC-26, AC-27, AC-29, AC-37, AC-42, AC-44, AC-45.
- **Do:** `server/src/adapters/pgScheduler.ts` with raw SQL over Payload's pool (pattern: `adapters/pgEvents.ts`). Lease: `INSERT … ON CONFLICT DO NOTHING` the `scheduler` row; `UPDATE … SET holder=$1, epoch = CASE WHEN holder=$1 THEN epoch ELSE epoch+1 END, expires_at = now() + interval '6 seconds', renewed_at = now() WHERE name='scheduler' AND (holder=$1 OR expires_at < now()) RETURNING epoch, …` (DB clock). Claim, one transaction: `SELECT 1 … WHERE holder=$h AND epoch=$e AND expires_at > now() FOR SHARE` → none = `stale`; then insert/update the `scheduler-runs` rows of every pair to `started` (not overwriting `done`). Finish: same epoch check, set `done|skipped|failed`. Table/column names from the generated migration (W9).
- **Files:** `server/src/adapters/pgScheduler.ts`.
- **Done means:** W40 lease tests.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 4; architecture.md → pool errors become `unavailable` (`guardPool`).
- **Risk:** Payload's table names differ from slugs — read them from the migration.

### W26 — Moment source adapter (P8)
- **Serves:** AC-24, AC-25.
- **Do:** `server/src/adapters/payloadMoments.ts`: `catalogStore.read()` (zones `midnightUtc`, events `sortIndex`, season key) + `momentsWithPatches(createPayloadCorrectionReader(...))` (`corrections/service.ts:275-286`) → `seasonMoments` input; `order` = event `sortIndex`; only `midnight` slot events produce event moments (to confirm against `assemble.ts:4`).
- **Files:** `server/src/adapters/payloadMoments.ts`.
- **Done means:** W39 reads the seeded catalog and produces a non-empty list with the expected first moment `celebration-start`.
- **Verify:** server `files`.
- **Rules that apply:** onion → rules called from the adapter's caller? No: the adapter returns input rows; `scheduler/service.ts` calls `seasonMoments` (keep rules out of adapters).
- **Risk:** low.

### W27 — Scheduler service loop (P8)
- **Serves:** AC-1, AC-27, AC-29…AC-48 (behaviour), NFR-7, NFR-8.
- **Do:** `server/src/scheduler/service.ts`: `startScheduler({clock, mono, lease, runs, source, rows, alarm, log, publisher?, holderId, cls, runEpochOf})`. Loop: renew lease every 2 s (real); while held and the term (mono) not expired: if the moment list is not loaded → nothing (NFR-8); compute due groups by server time; for each in C1 order: late verdict → skip with journal (log line `scheduler-skip` key/action/lateness) and `skipped` row; else `claim` → `stale` aborts; run `row.run(group, ctx)` (ctx: `now`, `consequenceId`, `late`); success → `finish done`; error/`unavailable`/`rejected` → retry ≥1 s apart while the late rule allows, then `failed` + journal (AC-40). Lag alarm only for the holder (AC-39, AC-41) and not when frozen. Timer: next wake = min(250 ms, (nextAt − now)/speed) real, unref. Takeover journal line: previous holder, new holder, epoch, time (AC-48). `pause()/resume()` hooks for the door. `runEpochOf`: production = season key; test/rehearsal = clock-state `runEpoch`.
- **Files:** `server/src/scheduler/service.ts`.
- **Done means:** W39/W40 green.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 3 (ports only); sec → no secret in logs.
- **Risk:** the hardest item; if the budget runs out, return PARTIAL after the claim/finish path with tests of W24 still green.

### W28 — Wiring and recompute subscriber (P8)
- **Serves:** AC-25, AC-74, NFR-8.
- **Do:** `server/src/scheduler/recompute.ts`: subscriber `scheduler-recompute` on `event-patch.changed` and `catalog.changed` (two rows, or one with `topic: '*'` filtered — two rows keep `topic` exact) marking the list dirty and reloading within ≤2 s. `container.ts`: `startProcessBackground` starts the scheduler after the bus (holderId = `<hostname>:<pid>:<random>`); expose `deps.scheduler` (status for the slice). `registries/subscribers.ts`: rows sorted.
- **Files:** `server/src/scheduler/recompute.ts`, `server/src/container.ts`, `server/src/registries/subscribers.ts`, `server/src/endpoints/types.ts`.
- **Done means:** unit: `subscriberRegistry` contains `scheduler-recompute` for both topics (in W32's `moments-registry.test.ts`).
- **Verify:** server `files`.
- **Rules that apply:** onion → container only.
- **Risk:** CLI processes (`cli/*`) must not start the scheduler — only `instrumentation.ts` path does.

### W29 — Run recorder action (P9)
- **Serves:** AC-27, AC-32, AC-64, AC-65, AC-73.
- **Do:** `server/src/scheduler/recorder.ts`: C5 row `run-recorder` for all 11 kinds, `late: 'always'`, `classes: ['test','rehearsal']`; `run` upserts a `run-records` row by `consequenceId` (idempotent) with keys, action, runEpoch, plannedAt (server ms), startedAt (real ms), deviation real ms; in `test` publishes `{type:'run-record', id: consequenceId}` to `rttest` through `publisherOf(deps)` (unavailable → error → AC-40 retry). Add the row to `registries/moments.ts`. Fault hook: if a one-shot fault is armed (W30), throw after publishing and before returning.
- **Files:** `server/src/scheduler/recorder.ts`, `server/src/registries/moments.ts`.
- **Done means:** W32 registry test; W39 records.
- **Verify:** server `files`.
- **Rules that apply:** C5 contract (idempotent by `consequenceId`, reads only `ctx.now`).
- **Risk:** low.

### W30 — Scheduler doors (P9)
- **Serves:** AC-29, AC-45, AC-67, AC-69.
- **Do:** `server/src/test-doors/scheduler.ts`: `POST /api/_test/scheduler/night-run` (body W2; sets shared clock to `from` (default `celebration-start − 60 000`), speed, new run epoch; returns `{epoch}`), `GET /api/_test/scheduler/night-run` (records of the current epoch, sorted by startedAt), `POST /api/_test/scheduler/lease` (`pause`/`resume` → `{holder, epoch}`), `POST /api/_test/scheduler/fault` (arms the one-shot fault). Register four rows in `test-doors/registry.ts` (sorted). `reset` door also empties runs/records (they are resettable) and resumes a paused scheduler.
- **Files:** `server/src/test-doors/{scheduler,registry}.ts`.
- **Done means:** W32.
- **Verify:** server `files`.
- **Rules that apply:** sec → doors only via dynamic import; strict body schemas; loopback-only pipeline (`pipeline.ts:151-161`).
- **Risk:** the door reaches the scheduler through `deps.scheduler` — never via a static import from production code into `test-doors`.

### W31 — Door lists 14 → 18 (P9)
- **Serves:** AC-67, AC-68.
- **Do:** `server/test/unit/doors-gating.test.ts` count/list; `server/test/e2e/doors-404.e2e.ts` add the 4 method+path pairs and `toHaveLength(18)`.
- **Files:** those two files.
- **Done means:** unit green; e2e file compiles (`npx tsc --noEmit -p .` in `server`); run in L.
- **Verify:** server `files`.
- **Rules that apply:** Test doors gate.
- **Risk:** low.

### W32 — Registry and door unit tests (P9)
- **Serves:** AC-68, AC-69, AC-73, AC-74.
- **Do:** `server/test/unit/moments-registry.test.ts` (`momentActionsFor('production')` empty, test/rehearsal = `['run-recorder']`; subscriber rows include `scheduler-recompute` on both topics), `server/test/unit/doors-scheduler.test.ts` (unknown field, speed 601, negative `from` → `validation`, state unchanged).
- **Files:** the two test files.
- **Done means:** both green.
- **Verify:** server `files`.
- **Rules that apply:** —
- **Risk:** low.

### W33 — Clock control service and `clock` event (P10)
- **Serves:** AC-51, AC-54, AC-56, NFR-7.
- **Do:** `server/src/timekeeping/control.ts`: `controlClock(deps, actor: 'owner:<id>'|'ops', action)` for `set`, `real`, `restart-night`, `speed` (speed only for `ops`); allowed only in class `rehearsal` (and `test` for tests); uses `ClockStateStore.change`, then publishes C3 to `site:state` with id `clockEventId` via `publisherOf(deps)` (failure → log, state stays changed).
- **Files:** `server/src/timekeeping/control.ts`.
- **Done means:** W37.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 3.
- **Risk:** low.

### W34 — Payload endpoints `festival-state` and `clock` (P10)
- **Serves:** AC-51, AC-52, AC-53, AC-75, AC-77.
- **Do:** `server/src/admin/cmsEndpoints.ts`: `cmsEndpointsFor(cls)` → `GET /festival-state` (owner only, view of W36) and, only when `cls === 'rehearsal'`, `POST /clock` (owner only, JSON content type, body ≤1 KB, `ClockControlBodySchema`; refusal `forbidden` without change; `validation`). Owner check and actor as in `globals/unattendedState.ts:21-55` (`roleOf`, `resolveActor`). `payload.config.ts`: `endpoints: cmsEndpointsFor(<class>)` (to confirm how the config gets the class — `loadEnv` or `process.env.T2F_ENV`).
- **Files:** `server/src/admin/cmsEndpoints.ts`, `server/src/payload.config.ts`.
- **Done means:** W37.
- **Verify:** server `files`.
- **Rules that apply:** sec → Access gate + owner role + CSRF rules of `proxy.ts`; ms → config change without schema change.
- **Risk:** Payload root `endpoints` behaviour under `/cms-api` — if root endpoints are not served there, attach both to the `clock-state` global and record the path change as a Spec follow-up (stop and report, do not silently rename).

### W35 — Server CLI `clock` (P10)
- **Serves:** AC-54, AC-65 (server side).
- **Do:** `server/src/cli/clock.ts` (pattern `cli/import.ts`): `status | set --at <ISO> | real | restart-night | speed <0..600> | records [--epoch N]`; builds deps, `refresh()`, calls `controlClock(…'ops'…)`; prints one JSON line; refuses (exit 2) unless `T2F_ENV` is `rehearsal` or `test`. `server/package.json` script `"clock": "tsx src/cli/clock.ts"` (mirror the `import` script).
- **Files:** `server/src/cli/clock.ts`, `server/package.json`.
- **Done means:** unit in W37 file: production env → exit 2 before any DB call.
- **Verify:** server `files`.
- **Rules that apply:** sec → no HTTP entry; output has no secrets.
- **Risk:** low.

### W36 — Festival state view service (P10)
- **Serves:** AC-11 (shown), AC-75, AC-78.
- **Do:** `server/src/scheduler/festival.ts`: `festivalState(deps)` → blocks `phase` (rules `isCelebrating`/`toastSeason`), `slots` (`currentSlotIndex`), `next` (10 moments), `health` (holder, epoch, renew age, lag, missed 24 h), `divergence`, `clock` (virtual, speed, epoch); each block computed in its own try/catch → `{ok:false}` for that block only.
- **Files:** `server/src/scheduler/festival.ts`.
- **Done means:** W37.
- **Verify:** server `files`.
- **Rules that apply:** onion ring 3; time only from `deps.clock`.
- **Risk:** low.

### W37 — Control, slice and CLI tests (P10)
- **Serves:** AC-51…AC-53, AC-56, AC-75, AC-77, AC-78, NFR-7.
- **Do:** `server/test/unit/cms-endpoints.test.ts` (production list has no `POST /clock`; CLI refuses production); `server/test/integration/clock-control.int.test.ts`: rehearsal-class deps — three actions change state, one journal row each with actor; centrifuge-js client on `site:state` (helpers `realtime-support.ts`) receives one `clock` event with id `clock:<epoch>:<seq>`; non-owner → `forbidden`, state unchanged; festival view at 23:50 Paris (test clock) has expected phase/slots/next; a failing lease store stub → `health` block error, others ok.
- **Files:** the two test files.
- **Done means:** both green (realtime part reported **not run** if Centrifugo is down, never passed).
- **Verify:** server `files` + one integration file.
- **Rules that apply:** —
- **Risk:** the Payload endpoint handler test needs a Payload request — call the endpoint's handler with a minimal `PayloadRequest` like existing global endpoint tests (to confirm which test covers `unattendedState` manual endpoint).

### W38 — Admin slice UI (P11)
- **Serves:** AC-75, AC-76, AC-78.
- **Do:** `server/src/admin/FestivalSlice.tsx` (server component returning the client view), `server/src/admin/FestivalStateView.tsx` (`'use client'`, polls `callApi('GET','/festival-state')` every 3 s, renders six blocks with per-block error text, `data-testid` per block and `data-updated-at` for the e2e measurement; in rehearsal shows three buttons calling `POST /clock`), registry row `{ key: '05-festival', order: 5, label: 'Стан свята', … }` in `adminSlots.ts`. Ukrainian labels.
- **Files:** `server/src/admin/{FestivalSlice,FestivalStateView}.tsx`, `server/src/registries/adminSlots.ts`.
- **Done means:** server `files` green; `admin-slots.int.test.ts` updated if it pins the slot list (to confirm) and green.
- **Verify:** server `files` + that integration file.
- **Rules that apply:** react (proposed row) → effect cleanup of the interval; no Payload import in the client part.
- **Risk:** low.

### W39 — Scheduler integration suite A (P12)
- **Serves:** AC-25, AC-26, AC-27, AC-29, AC-30, AC-31, AC-32, AC-73.
- **Do:** `server/test/integration/scheduler-support.ts` (start deps + bus + scheduler in-process, door helpers), `measure.ts` (W conventions), `scheduler-a.int.test.ts`: ×600 over a 2 h slice around the first midnights (Kiribati/Chatham) and Nepal/India window — one record per pair, order = enumerator order; UTC+1 group = one record with several keys; patch −20 min (save via `corrections/service.ts` `saveCorrection`) → new list ≤2 s, then before/after-old-moment variants → one record per pair; fault door → two publications with one id on `rttest`, centrifuge-js client receives once; prints `T2F_MEASURE moment-deviation-ms`.
- **Files:** `server/test/integration/{scheduler-support,measure,scheduler-a.int.test}.ts`.
- **Done means:** file green, 0 skipped (realtime part: not run if Centrifugo down); measurement line printed.
- **Verify:** one integration file.
- **Rules that apply:** —
- **Risk:** flaky timing — assertions on counts/order, deviations only measured (not asserted beyond 1 000 ms p99).

### W40 — Scheduler integration suite B (P12)
- **Serves:** AC-33…AC-37, AC-39, AC-40, AC-42, AC-45, AC-48, NFR-7.
- **Do:** `scheduler-b.int.test.ts`: pause 5 min across midnight (lease door pause + clock jump) → all `always` done; 4 vs 6 min `within` → run vs skip + log; `until` +16 min skip; +30 min jump; −10 min back → no new records; recorder stub delayed 3 s → one `scheduler/lag` alarm row; failing twice → third succeeds, other actions on time; two lease clients in one process → only one held at each of 30 samples over 60 s; pause/resume → old process makes no claim (stale); takeover log line fields; no secret values in captured logs.
- **Files:** `server/test/integration/scheduler-b.int.test.ts`.
- **Done means:** green.
- **Verify:** one integration file.
- **Rules that apply:** —
- **Risk:** 60 s lease sampling makes the file ~2 min; keep under the vitest timeout (set per test).

### W41 — Exclusive two-instance file (P12; run in L)
- **Serves:** AC-41, AC-43, AC-44, NFR-5.
- **Do:** `server/test/exclusive/support/scheduler-instance.ts` (child process like `events-instance.ts`, prints `READY`, `HOLDER <bool>`), `scheduler-two-instances.exclusive.test.ts`: two instances, ×60 window → all records from the holder; recorder delay 3 s → exactly one lag alarm; kill the holder at a midnight → the other holds ≤10 s, missed processed; `T2F_MEASURE lease-takeover-ms`.
- **Files:** the two files.
- **Done means:** `npx tsc --noEmit -p .` in `server` green; **not run** by the implementer.
- **Verify:** server `files` (typecheck/lint only).
- **Rules that apply:** exclusive lock only.
- **Risk:** child process uses `tsx` from `server/node_modules`.

### W42 — Night-run script ×60 (P12)
- **Serves:** AC-27, AC-31, AC-32, NFR-5.
- **Do:** `server/scripts/night-run.mjs`: against a running worktree server (`--server http://127.0.0.1:<port>`): `POST night-run {speed}`, polls until `rating-close` recorded (or `--to`), fetches records, compares with the expected order from the enumerator (via `GET` keys sorted by plannedAt and rank check), checks one record per pair, prints `T2F_MEASURE moment-deviation-ms` and `NIGHT_RUN ok|fail <reason>`. `--rehearsal-records <json file>` mode analyses records printed by `pnpm run clock records` (RH).
- **Files:** `server/scripts/night-run.mjs`.
- **Done means:** `node server/scripts/night-run.mjs --help` exits 0; a ×600 dry run against the stack finishes `NIGHT_RUN ok` (run by the implementer once, shared lock).
- **Verify:** that run.
- **Rules that apply:** sec → no secrets printed.
- **Risk:** low.

### W43 — Server-backed time machine (P13)
- **Serves:** AC-59, AC-60, AC-61.
- **Do:** `lib/time/serverTimeMachine.ts`: same public surface as `TimeMachine` (`now/get/set/advance/subscribe/speed/status 'machine'/ready`), anchored on the door state: init `GET /api/_test/clock` with RTT/2 correction; `set/advance` → `POST /api/_test/clock` then re-anchor from the response; poll `GET` every 1 500 ms and re-anchor (emit only on change >250 ms or speed change); errors keep the current anchor and retry.
- **Files:** `lib/time/serverTimeMachine.ts`.
- **Done means:** W46 unit tests.
- **Verify:** web `files`.
- **Rules that apply:** fui by analogy (lib module, no React).
- **Risk:** two tabs (EC-23) — last write wins, both follow the poll.

### W44 — Time source selection per build (P13)
- **Serves:** AC-58, AC-59, AC-62, AC-63, NFR-3.
- **Do:** `lib/env.ts`: `IS_REHEARSAL_BUILD = process.env.NEXT_PUBLIC_SITE_CLASS === 'rehearsal'`, `HAS_TIME_MACHINE = IS_TEST_BUILD && !IS_REHEARSAL_BUILD`, `SERVER_TIME_MACHINE = HAS_TIME_MACHINE && process.env.NEXT_PUBLIC_API_MODE === 'http'` (direct `process.env` reads so they inline). `next.config.ts` passes `NEXT_PUBLIC_SITE_CLASS` through `env` like `NEXT_PUBLIC_ENV` (`:52`) (to confirm). `params.ts` `createAppTimeSource`: rehearsal → `TimeSource`; integration → `resolveMachineStart` warnings (AC-62: invalid params → warn, no POST); with a valid `t`/`speed` → `ServerTimeMachine` + one POST; without `t` → state from the door (AC-59), no sessionStorage; `sim` → unchanged path (AC-63). `components/dev/TimeMachineMount.tsx`: mount only when `HAS_TIME_MACHINE`.
- **Files:** `lib/env.ts`, `next.config.ts`, `lib/time/params.ts`, `components/dev/TimeMachineMount.tsx`.
- **Done means:** W46; production build contains none of the time machine strings (W48).
- **Verify:** web `files`.
- **Rules that apply:** next → build-time env inlining; fui → dev component stays in `components/dev`.
- **Risk:** `TimeMachinePanel` typed on `TimeMachine` — make `ServerTimeMachine` satisfy a shared interface (`MachineLike` in `types.ts`).

### W45 — Test API and provider over the machine interface (P13)
- **Serves:** AC-60.
- **Do:** `lib/time/testApi.ts`, `TimeProvider.tsx`, `types.ts`: accept `MachineLike`; `installTestApi` only when `HAS_TIME_MACHINE`.
- **Files:** `lib/time/{testApi,types}.ts`, `lib/time/TimeProvider.tsx`.
- **Done means:** `tests/unit/time/provider.test.tsx` and `timeMachine.test.ts` green.
- **Verify:** web `files`.
- **Rules that apply:** react → no behaviour change in `sim`.
- **Risk:** low.

### W46 — Time unit tests (P13)
- **Serves:** AC-2, AC-3, AC-62, AC-63 (and W43/W44 behaviour).
- **Do:** `tests/unit/time/timeSource.test.ts` — keep/extend: always-failing fetch → `device-fallback` + exactly one warn; after a good sample, failures keep state and `now()`, back-off 5/10/20/60 s (fake timers). `tests/unit/time/serverTimeMachine.test.ts`: init from GET with RTT/2, set → POST + anchor from response, outside change followed ≤2 s, failure keeps anchor. `tests/unit/time/params.test.ts`: invalid `t`/`speed` → `[time-machine]` warn and no fetch; sim path unchanged.
- **Files:** the three test files.
- **Done means:** web `files` green on them.
- **Verify:** web `files`.
- **Rules that apply:** —
- **Risk:** low.

### W47 — Rehearsal `clock` listener and `TimeSource.resync` (P14)
- **Serves:** AC-57, NFR-3.
- **Do:** `TimeSource.ts`: public `resync()` (one sampling round now). `lib/time/rehearsalClock.ts`: when `IS_REHEARSAL_BUILD`, `import('@/lib/api/http/realtime')` lazily, subscribe `site:state`, on envelope `type === 'clock'` call `resync()` (debounced 500 ms); unsubscribe on stop. Hooked from `createAppTimeSource().activate()` behind `IS_REHEARSAL_BUILD` only. Test `tests/unit/time/rehearsalClock.test.ts` with a fake transport: `clock` → resync within 5 s; other types ignored.
- **Files:** `lib/time/{TimeSource,rehearsalClock,params}.ts`, `tests/unit/time/rehearsalClock.test.ts`.
- **Done means:** test green; `tests/unit/api/realtime-boundary.test.ts` still green.
- **Verify:** web `files`.
- **Rules that apply:** fui → transport stays in `lib/api/http/realtime`; NFR-3 → dynamic import behind a build constant.
- **Risk:** low.

### W48 — Bundle scan for non-test builds (P14)
- **Serves:** AC-58, NFR-3.
- **Do:** `scripts/check-bundle.mjs`: add signatures `/api/_test/` and the time-machine storage key `t2f:session:timeMachine` (and keep centrifuge ones). Extend `tests/unit/lint/check-bundle.test.ts` with fixtures for each signature (CRLF-independent).
- **Files:** `scripts/check-bundle.mjs`, `tests/unit/lint/check-bundle.test.ts`.
- **Done means:** test green; in L, `out-verify` (production) and a rehearsal build scanned **without** the centrifuge signatures (flag `--allow-realtime`) are clean.
- **Verify:** web `files`.
- **Rules that apply:** sec → same exit codes 0/1/2.
- **Risk:** the production build must not contain `/api/_test/` anywhere (including the time-machine panel) — any hit means a constant is not inlined.

### W49 — Rehearsal build script (P14)
- **Serves:** AC-57, AC-58.
- **Do:** `package.json` `build:edge:rehearsal`: add `NEXT_PUBLIC_SITE_CLASS=rehearsal`. (The matching `infra/ops/lib/config.mjs:37` line is W55.)
- **Files:** `package.json`.
- **Done means:** `grep -n "build:edge:rehearsal" package.json` shows the variable.
- **Verify:** web `files` (no source files) — tsc only.
- **Rules that apply:** sec.
- **Risk:** low.

### W50 — Serial server-clock project (P15)
- **Serves:** NFR-4.
- **Do:** `playwright.http.config.ts`: projects `server-clock` (desktop viewport) matching `tests/e2e/server-clock/**` and the existing time-machine specs (`global-states`, `us1-air`, `us16-notifications`, `us17-pass`, `us3-room`, `us7-tv`, `us8-time-machine`, `us9-auth`), `fullyParallel: false`; other projects `testIgnore` them. Document the two invocations: `npx playwright test -c playwright.http.config.ts --project=server-clock --workers=1` and `--project=phone --project=desktop --workers=2`.
- **Files:** `playwright.http.config.ts`.
- **Done means:** `npx playwright test -c playwright.http.config.ts --list` shows every clock spec only under `server-clock`.
- **Verify:** that command.
- **Rules that apply:** —
- **Risk:** the 8 existing specs now drive the server clock; any spec that relied on sessionStorage start needs `?t=` (fix in W51).

### W51 — Integration-build e2e (P15)
- **Serves:** AC-4, AC-59, AC-60, AC-61, AC-64, AC-76.
- **Do:** `tests/e2e/server-clock/clock-sync.spec.ts`: server clock 23:59:00 Paris → page countdown ~60 s; each of `?t=`, `?speed=`, panel, `__t2f.timeMachine.set/advance` → door state equal within 1 s; door POST from the test → page follows ≤2 s; panel jump to −5 s before a zone midnight → recorder record ≤2 s after midnight (door GET). `device-skew.spec.ts`: `page.clock` shifted ±1 h → countdown differs ≤1 s from unshifted. `admin-refresh.spec.ts` (server e2e base, owner via access-token door): change the test clock → slice block updates ≤5 s; prints `T2F_MEASURE admin-refresh-ms`.
- **Files:** `tests/e2e/server-clock/{clock-sync,device-skew,admin-refresh}.spec.ts`.
- **Done means:** run in L twice green with the two invocations.
- **Verify:** typecheck in web `files`; full run in L.
- **Rules that apply:** —
- **Risk:** admin e2e needs Access test signer — reuse `server/test/e2e/admin-support.ts` patterns.

### W52 — Edge-offline e2e (P15)
- **Serves:** AC-18.
- **Do:** `tests/e2e/edge-offline/server-stopped.spec.ts` + README note: run against `wrangler dev` of the edge in `production` mode serving the integration build's static output with `ORIGIN_URL` pointing to a stopped port; page time machine near a midnight (sim build machine path); asserts countdown ticks, air slot switches at handover, stamp shows. Command recorded in the Verification plan.
- **Files:** `tests/e2e/edge-offline/server-stopped.spec.ts`.
- **Done means:** run in L green.
- **Verify:** typecheck; run in L.
- **Rules that apply:** —
- **Risk:** the production-mode edge serves `/api/time` itself — the page in a `sim`-machine build uses its own machine; use the `out-edge-test`-like static build with `NEXT_PUBLIC_ENV=test` and `sim` time machine (to confirm the exact build recipe in `workers/edge/README.md`).

### W53 — Chrony on node preparation (P16)
- **Serves:** AC-6, AC-7.
- **Do:** `bootstrap.mjs`: new root step `time-sync` after `swap`: check `chronyc -n tracking` synced and `systemctl is-active systemd-timesyncd` inactive; apply: install `chrony`, write `/etc/chrony/sources.d/t2f.sources` with `server time.cloudflare.com iburst nts` (to confirm NTS support in Ubuntu's chrony; else plain), disable `systemd-timesyncd`, restart chrony, `chronyc makestep`. Post-check: parse `chronyc tracking` "System time" and "Leap status : Normal"; |offset| >100 ms or not normal → exit non-zero with the message. One SSH connection per step.
- **Files:** `infra/ops/lib/bootstrap.mjs`, `infra/ops/test/bootstrap.test.mjs`.
- **Done means:** tests with a fake executor show install/disable steps; synced 12 ms → ok; 150 ms → non-zero; "Not synchronised" → non-zero.
- **Verify:** ops `files`.
- **Rules that apply:** sec; gotcha `ufw limit`.
- **Risk:** low.

### W54 — `ops clock` (P16)
- **Serves:** AC-54, AC-55, AC-65.
- **Do:** `args.mjs` spec `clock: { envs: ['rehearsal'], positional: ['status','set','real','restart-night','speed','records'], values: {'--at': V.iso?, '--speed': …}, required: ['--env'] }` (production refused by `envs` before any connection); `infra/ops/lib/clock.mjs`: one SSH call `docker compose … exec -T server pnpm run clock <args>` (argv checked by `assertAllowed`), print the JSON line; journal via `lib/journal.mjs`. `ops.mjs`: add to `SUBCOMMANDS` and `RUNNERS`.
- **Files:** `infra/ops/lib/{args,clock}.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/clock.test.mjs`.
- **Done means:** fake target receives the exact argv for each action; `--env production` → code 2, transport never called.
- **Verify:** ops `files`.
- **Rules that apply:** sec → no new HTTP entry; argv allow-list.
- **Risk:** low.

### W55 — Rehearsal build env in ops (P16)
- **Serves:** AC-57, AC-58.
- **Do:** `infra/ops/lib/config.mjs:37` add `NEXT_PUBLIC_SITE_CLASS: 'rehearsal'`; update `infra/ops/test/worker.test.mjs:119-134` expectations.
- **Files:** `infra/ops/lib/config.mjs`, `infra/ops/test/worker.test.mjs`.
- **Done means:** ops `full` green.
- **Verify:** ops `full`.
- **Rules that apply:** sec.
- **Risk:** phase-0 agent edits — start only after the gate in the header.

### W56 — `scheduler-drill` (P17)
- **Serves:** AC-70, AC-71, AC-72.
- **Do:** `infra/ops/node/compose.drill.yml`: service `server-drill` (same image variable as `server`, `mem_limit` 640m, profile `scheduler-drill`, no ports, same networks/env files). `infra/ops/lib/drill.mjs`: refuse production and any `--resize` without `--confirm-resize` (exit 2, no SSH); read `MemAvailable` from `/proc/meminfo` over SSH; need = drill limit + 128 MB margin → refuse with "short by N MB"; upload the drill compose; `up -d server-drill`; wait until both healthy; find the holder (`pnpm run clock status` lease field); `docker stop` the holder; poll the other's status every 500 ms until it holds → `T2F_MEASURE lease-takeover-ms`; `docker start` the stopped one; `rm -sf server-drill`; never touch node size. `args.mjs` spec `scheduler-drill`.
- **Files:** `infra/ops/node/compose.drill.yml`, `infra/ops/lib/{drill,args}.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/drill.test.mjs`, `infra/ops/test/compose.test.mjs` (drill file parsed).
- **Done means:** fake target: low memory → refusal before any compose call with the shortfall; production / resize without flag → code 2, transport untouched; happy path order of calls as listed; ops `full` green; `env-example.test.mjs` green (no new env var).
- **Verify:** ops `full`.
- **Rules that apply:** sec; gotcha DigitalOcean resize (never on the default path).
- **Risk:** the holder detection depends on the CLI `status` output (W35) — contract: `{"lease":{"holder":"<id>","epoch":N}}`.

### W57 — Integration pass (L, wave lead)
- **Serves:** every AC/NFR (gate), NFR-1…NFR-4.
- **Do:** `pnpm install --frozen-lockfile`; all `full` commands of the config for web, contracts, rules, server (incl. `pnpm test:int`, `verify-schema`), edge, ops, infra; `node scripts/check-secrets.mjs` (after `git add -N` of new files), `node scripts/check-research-data.mjs`; `pnpm contracts:run --sim-only`; `pnpm --dir server build`; image build from `git archive`; `pnpm --dir server test:e2e -- doors-404` against a production-class server (18 rows) plus `POST /cms-api/clock` = unknown `/cms-api/__nope` answer; rehearsal build `npx cross-env NEXT_PUBLIC_ENV=test NEXT_PUBLIC_API_MODE=http NEXT_PUBLIC_SITE_CLASS=rehearsal NEXT_DIST_DIR=out-rh next build` + `node scripts/check-bundle.mjs out-rh --allow-realtime`; skills `migration-safety`, `contract-conformance`, `layout-fidelity` (3-board smoke, one capture at a time); http e2e two invocations (W50) twice; sim e2e `us8-time-machine` unchanged; `.github/workflows/verify.yml` — no new service needed (Postgres, Redis, Centrifugo exist); if any new test needs one, add it there.
- **Files:** none (fixes go back to the owning phase in fix mode).
- **Done means:** every command exit 0 and every gate green; `infra/ops/test/env-example.test.mjs` and `ci.test.mjs` green.
- **Verify:** as listed.
- **Risk:** RAM — never run the http e2e and a `next build` at the same time.

### W58 — Local evidence runs (L, wave lead)
- **Serves:** AC-4, AC-18, AC-27, AC-29, AC-31, AC-32, AC-41, AC-43, AC-44, AC-76, AC-25, NFR-5.
- **Do (in this order):**
  1. ×60 full night: `node server/scripts/lock.mjs --mode shared -- node server/scripts/night-run.mjs --server http://127.0.0.1:<port> --speed 60` (~40 min) → `NIGHT_RUN ok`, every moment once, FR-CLK-16 order checked for Kiribati/Chatham, Nepal/India, UTC+1; keep the `T2F_MEASURE moment-deviation-ms` line.
  2. Exclusive: `cd server && node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.integration.config.ts test/exclusive/scheduler-two-instances.exclusive.test.ts` → takeover ≤10 s, `T2F_MEASURE lease-takeover-ms`; then `pnpm stack:smoke` (all green).
  3. Crash between publish and done: `scheduler-a` fault test output (same id, one delivery).
  4. Admin refresh: `admin-refresh.spec.ts` → `T2F_MEASURE admin-refresh-ms` (≤5 000).
  5. Device skew: `device-skew.spec.ts` green.
  6. Server stopped: `edge-offline` e2e green.
  7. Catalog patch recompute: `scheduler-a` patch test green.
- **Files:** none.
- **Done means:** all seven pass; measurement lines collected verbatim into the wave report.
- **Risk:** the ×60 run holds the shared lock ~40 min; schedule when no other worktree needs it.

### W59 — Docs patch, specs index, knowledge (L, wave lead)
- **Serves:** wave closure.
- **Do:** docs patch (Ukrainian) outside the repo per `docs-sync`: `frontend-seam.md` §3.11 rows (clock event, doors, `festival-state`, `clock`), `architecture.md` new rings (`domain/{timekeeping,scheduler}` ring 1, `timekeeping/ports.ts`, `scheduler/ports.ts` ring 2, `timekeeping/*`, `scheduler/*` ring 3, new adapters ring 4), `sdd-routing.md` (rows for `server/src/admin/**/*.tsx`, `lib/time/**`, `packages/rules/**`), `docs/specs/README.md` index status after verifier.
- **Files:** `docs/specs/README.md`; patch outside the repo.
- **Done means:** patch handed to the orchestrator.

### W60 — Rehearsal evidence (RH, manual / orchestrator, after L)
- **Serves:** AC-5, AC-7, AC-27, AC-31, AC-32, AC-44 (optional), AC-50, AC-54, AC-57, AC-65, AC-70 (optional), NFR-5.
- **Do (exact commands, from the worktree, owner consent rules of `docs/services/README.md` apply):**
  1. Deploy the branch commit: `node infra/ops/ops.mjs deploy --env rehearsal --commit <sha40>` → health ok, migration applied.
  2. Chrony: `node infra/ops/ops.mjs bootstrap --host <rehearsal host>` (re-run is idempotent) → output shows `time-sync` ok and offset; `T2F_MEASURE node-clock-offset-ms` from `chronyc tracking`.
  3. Clock state survives deploy (AC-50): `node infra/ops/ops.mjs clock status --env rehearsal` before and after a redeploy — same epoch/anchor.
  4. ×60 server-side: `node infra/ops/ops.mjs clock restart-night --env rehearsal`, `… clock set --at <celebration-start − 1 min ISO> --env rehearsal`, `… clock speed 60 --env rehearsal`; wait ~40 min; `… clock records --env rehearsal > %SCRATCH%/rh-records.json`; `node server/scripts/night-run.mjs --rehearsal-records <file>` → `NIGHT_RUN ok` + `T2F_MEASURE moment-deviation-ms`; then `… clock real --env rehearsal`.
  5. Client resync (AC-57): open `https://rehearsal.time2fest.com`, `… clock set --at <ISO> --env rehearsal` (speed 1) → the tab shows the new countdown within 5 s.
  6. Edge drift (AC-5): 20 samples of `GET https://rehearsal.time2fest.com/api/time` from the operator machine (NTP-synced, offset by RTT/2) and 20 from a GitHub Actions runner (workflow_dispatch one-off script, or `gh workflow run` of a probe job if present — otherwise record as not run) → `T2F_MEASURE edge-time-offset-ms`, 19/20 ≤100 ms each. Note: at rehearsal the edge forwards to the origin; set `clock real` first.
  7. Optional drill (only if `MemAvailable` allows; resize only after the owner's "yes", spec07-q2): `node infra/ops/ops.mjs scheduler-drill --env rehearsal` → `T2F_MEASURE lease-takeover-ms`.
- **Files:** none.
- **Done means:** a measurement table in the wave report; any step not run is reported as **not run** with the reason.

## Execution

Sequential phases; at most two run at the same time and only from different lanes. Each dispatch: `sdd-engineering:implementer`, this plan's path, the phase id; ~80 tool calls; out of budget → `PARTIAL` with the tree green after the last finished item. Escalation Sonnet → Opus by `run-plan-auto` §3.

| Lane / phase | Executor | Model | Work items | Files (disjoint) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| S·P1 — deps, contracts | implementer | sonnet | W1, W2, W3 | `server/package.json`, `pnpm-lock.yaml`, `server/Dockerfile`, `packages/contracts/{src/clock,src/clock.schemas,src/index,src/schemas,test/clock.test}.ts`, `scripts/contract-surface.baseline.json` | — | — | `pnpm install` alone |
| R·P2 — season moments, lint | implementer | sonnet | W4–W7 | `packages/rules/src/time/{season,constants,index}.ts`, `packages/rules/test/{season,exports}.test.ts`, `server/eslint.config.mjs`, `server/test/unit/lint-rule-copy.test.ts` | P1 | E·P5 | — |
| S·P3 — schema, migration | implementer | sonnet | W8, W9, W10 | `server/src/collections/{schedulerLeases,schedulerRuns,runRecords}.ts`, `server/src/globals/clockState.ts`, `server/src/registries/{collections,globals}.ts`, `server/src/migrations/**`, `server/src/payload-types.ts`, `server/test/integration/payload-schema.int.test.ts` | P2 | E·P5, W·P13 | migration generator runs alone |
| S·P4 — shared virtual time | implementer | **opus** — cross-process virtual-time state, outbox refresh and the door facade; every later phase reads time through it | W11–W15 | `server/src/domain/timekeeping/virtual.ts`, `server/src/timekeeping/{ports,shared}.ts`, `server/src/adapters/payloadClockState.ts`, `server/src/clock/index.ts`, `server/src/container.ts`, `server/src/endpoints/types.ts`, `server/src/registries/subscribers.ts`, `server/src/test-doors/{registry,index}.ts`, `server/src/seed/index.ts`, `server/test/unit/timekeeping.test.ts`, `server/test/integration/{clock-shared,doors}.int.test.ts` (+ `await reset()` call sites in `server/test/**`) | P3 | W·P13 | shared lock |
| E·P5 — edge header and time proxy | implementer | **opus** — trust boundary of `x-t2f-edge-now` and fail-safe origin time on the edge | W16, W17, W18 | `workers/edge/src/{proxy,handler,responses}.ts`, `workers/edge/test/{handler,worker}.test.ts` | P1 | R·P2 or S·P3 | edge only |
| S·P6 — divergence | implementer | sonnet | W19, W20, W21 | `server/src/domain/timekeeping/divergence.ts`, `server/src/timekeeping/divergence.ts`, `server/src/registries/middleware.ts`, `server/src/container.ts`, `server/src/endpoints/types.ts`, `server/test/unit/divergence.test.ts`, `server/test/integration/divergence.int.test.ts` | P4, P5 | W·P13/P14 | shared lock |
| S·P7 — scheduler domain | implementer | **opus** — grouping, consequence ids and late rules decide exactly-once | W22, W23, W24 | `server/src/domain/scheduler/{plan,consequence,late,lease}.ts`, `server/src/scheduler/ports.ts`, `server/src/registries/moments.ts`, `server/test/unit/scheduler-{plan,lease}.test.ts` | P6 | W·P14 | — |
| S·P8 — lease, loop, wiring | implementer | **opus** — Postgres lease with fencing epoch, claim/done transactions, the scheduler loop | W25–W28 | `server/src/adapters/{pgScheduler,payloadMoments}.ts`, `server/src/scheduler/{service,recompute}.ts`, `server/src/container.ts`, `server/src/registries/subscribers.ts`, `server/src/endpoints/types.ts` | P7 | W·P15 | — |
| S·P9 — recorder, doors | implementer | **opus** — test doors (pause, fault) must stay unreachable outside the dynamic import | W29–W32 | `server/src/scheduler/recorder.ts`, `server/src/registries/moments.ts`, `server/src/test-doors/{scheduler,registry}.ts`, `server/test/unit/{doors-gating,moments-registry,doors-scheduler}.test.ts`, `server/test/e2e/doors-404.e2e.ts` | P8 | W·P15 | — |
| S·P10 — control, endpoints, CLI | implementer | **opus** — new privileged owner entry (C9) and class gating; publishes the `clock` event | W33–W37 | `server/src/timekeeping/control.ts`, `server/src/admin/cmsEndpoints.ts`, `server/src/payload.config.ts`, `server/src/cli/clock.ts`, `server/package.json`, `server/src/scheduler/festival.ts`, `server/test/unit/cms-endpoints.test.ts`, `server/test/integration/clock-control.int.test.ts` | P9 | O·P16 | shared lock; `server/package.json` script line only |
| S·P11 — admin slice UI | implementer | sonnet | W38 | `server/src/admin/{FestivalSlice,FestivalStateView}.tsx`, `server/src/registries/adminSlots.ts`, `server/test/integration/admin-slots.int.test.ts` | P10 | O·P16/P17 | — |
| S·P12 — scheduler evidence suites | implementer | **opus** — timing-sensitive exactly-once, crash and lease proofs; flake risk | W39–W42 | `server/test/integration/{scheduler-support,measure,scheduler-a.int.test,scheduler-b.int.test}.ts`, `server/test/exclusive/{scheduler-two-instances.exclusive.test.ts,support/scheduler-instance.ts}`, `server/scripts/night-run.mjs` | P11 | O·P17 | shared lock; exclusive file **not run** |
| W·P13 — integration-build time machine | implementer | **opus** — virtual-time shared state on the client: anchoring, RTT/2, polling, build-constant dead-code | W43–W46 | `lib/time/{serverTimeMachine,params,testApi,types}.ts`, `lib/time/TimeProvider.tsx`, `lib/env.ts`, `next.config.ts`, `components/dev/TimeMachineMount.tsx`, `tests/unit/time/{timeSource,serverTimeMachine,params}.test.ts` | P1 | S·P3/P4/P6 | web only |
| W·P14 — rehearsal listener, bundle scan | implementer | sonnet | W47, W48, W49 | `lib/time/{TimeSource,rehearsalClock}.ts`, `lib/time/params.ts` (one hook line), `tests/unit/time/rehearsalClock.test.ts`, `scripts/check-bundle.mjs`, `tests/unit/lint/check-bundle.test.ts`, `package.json` | W·P13 | S·P6/P7 | no `next build` (L does it) |
| W·P15 — e2e | implementer | sonnet | W50, W51, W52 | `playwright.http.config.ts`, `tests/e2e/server-clock/*.spec.ts`, `tests/e2e/edge-offline/server-stopped.spec.ts` | W·P14, S·P9 (doors), S·P11 for admin spec | S·P8/P9 | specs written, full runs in L |
| O·P16 — chrony, ops clock, build env | implementer | sonnet | W53, W54, W55 | `infra/ops/lib/{bootstrap,args,clock,config}.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/{bootstrap,clock,worker}.test.mjs` | S·P10 (CLI contract), phase-0 gate (header) | S·P10/P11 | ops only |
| O·P17 — scheduler drill | implementer | **opus** — ops drill stops containers on a live node; refusal paths must fire before any change | W56 | `infra/ops/node/compose.drill.yml`, `infra/ops/lib/{drill,args}.mjs`, `infra/ops/ops.mjs`, `infra/ops/test/{drill,compose}.test.mjs` | O·P16 | S·P11/P12 | ops only |
| L — integration, evidence, docs | wave lead | — | W57, W58, W59 | `docs/specs/README.md`; patch outside the repo | all phases | — | W58 step 2 exclusive lock |
| RH — rehearsal evidence | wave lead / orchestrator (manual) | — | W60 | none | L, owner rules for the rehearsal node | — | rehearsal node only |

`container.ts`, `endpoints/types.ts`, `registries/subscribers.ts`, `registries/moments.ts` are touched by several **S** phases — always sequentially in one lane. `server/package.json` is touched by P1 and P10 (sequential). `lib/time/params.ts` by P13 and P14 (sequential, same lane). `infra/ops/lib/args.mjs` and `ops.mjs` by P16 and P17 (sequential). No file appears in two lanes.

## Verification plan

| Command | Directory | Passing means |
|---|---|---|
| contracts `files` / `full` | `packages/contracts` | exit 0 (P1, L) |
| `node scripts/contract-surface.mjs --check` | `.` | exit 0 (P1, L) |
| rules `files` / `full` | `packages/rules` | exit 0 (P2, L) |
| server `files` (config) | `server` | exit 0 (every S phase) |
| `pnpm migrate:create clock_server`; `node scripts/fix-migration-down.mjs <file>`; `pnpm migrate`; `node scripts/verify-schema.mjs` | `server` | exit 0 (P3) |
| one integration file (`node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>`) | `server` | exit 0, 0 skipped (P3, P4, P6, P10–P12) |
| edge `files` / `full` | `workers/edge` | exit 0 (P5, L) |
| web `files` | `.` | exit 0 (P13–P15) |
| `npx playwright test -c playwright.http.config.ts --list` | `.` | clock specs only in `server-clock` (P15) |
| ops `files` / `full` | `infra/ops` | exit 0 (P16, P17, L) |
| web, contracts, rules, server, edge, ops, infra `full` (config) | their dirs | exit 0 (L) |
| `node scripts/check-secrets.mjs` (after `git add -N`), `node scripts/check-research-data.mjs` | `.` | clean (L) |
| `pnpm contracts:run --sim-only` | `.` | exit 0 (L) |
| `pnpm --dir server build`; `git archive HEAD \| docker build -f server/Dockerfile --build-arg T2F_COMMIT=<sha> -` | `.` | exit 0 (L) |
| `npx cross-env NEXT_DIST_DIR=out-verify next build && node scripts/check-bundle.mjs out-verify` | `.` | clean (L, part of web `full`) |
| rehearsal build `out-rh` + `node scripts/check-bundle.mjs out-rh --allow-realtime` | `.` | clean (L) |
| `pnpm --dir server test:e2e -- doors-404` (production-class server) | `.` | 18 rows 404 like unknown (L) |
| `npx playwright test -c playwright.http.config.ts --project=server-clock --workers=1`, then `--project=phone --project=desktop --workers=2`, twice | `.` | green twice (L, NFR-4) |
| `npx playwright test tests/e2e/us8-time-machine.spec.ts` (sim config) | `.` | green unchanged (L, AC-63) |
| `node server/scripts/lock.mjs --mode shared -- node server/scripts/night-run.mjs --server http://127.0.0.1:<port> --speed 60` | `.` | `NIGHT_RUN ok` + measure line (L) |
| `node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.integration.config.ts test/exclusive/scheduler-two-instances.exclusive.test.ts`, then `pnpm stack:smoke` | `server`, `.` | green, takeover ≤10 s, smoke all green (L) |
| skills `migration-safety`, `contract-conformance`, `layout-fidelity` (3 boards) | — | green (L) |
| W60 commands | `.` | measurement table (RH) |

## Assumptions

Technical judgement calls only.
- **Rehearsal site build** keeps `NEXT_PUBLIC_ENV=test` + `http` and adds `NEXT_PUBLIC_SITE_CLASS=rehearsal` (Spec follow-up 1, spec Open question 6). Simulated toasts/presence that already ship in that build are pre-existing and untouched.
- **C1 instants** not spelled out in the spec: `event-reminder` = moment − `HOWTO_BEFORE` (15 min); `pin-end` = zone midnight by tzdb (spec C5/Передачі); `event-moment` = patched moment; `rating-close` = `ratingCloseAt`; `celebration-end` = last midnight + `CELEBRATION_TAIL`. Keys `<kind>:<id>`.
- **Lease** row per name `scheduler`, created on first acquire; term 6 s, renew 2 s, both by `now()` of Postgres; local stop by `performance.now()` 6 s after the last successful renew minus 500 ms margin.
- **Exactly-once bookkeeping** per (runEpoch, action, momentKey) row; the consequence digest covers the not-yet-done keys of a group, so a retry after a crash reproduces the same id.
- **Production run epoch** = the season key (one per season, C4).
- **Clock refresh** across processes: outbox topic `clock.changed` + 5 s fallback re-read; AC-49's 1 s bound relies on NOTIFY wake-ups, with the 500 ms poll as backup.
- **Divergence windows** run on an injectable real clock; tests inject a fake one (AC-12 vs AC-14 wording).
- **Slice read path** `GET /cms-api/festival-state` (Spec follow-up 2); slice polls every 3 s.
- **×60 full night** is a wave-lead script; CI covers ×600 on 2 h slices (Spec follow-up 3).
- **No new env var** (NFR-1): every timing is a code constant.

## Open questions

None.

## Research used

- No planner researcher dispatched (brief: stack described in earlier plans and the spec; spec research of 2026-11-18 cited at spec `:583-584`).
- Code read directly by the planner: `server/src/{clock/index.ts,ports.ts,container.ts,events/{bus,ports}.ts,registries/{moments,subscribers,adminSlots,globals}.ts,test-doors/{registry,index}.ts,platform/edge.ts,endpoints/pipeline.ts:220-282,corrections/service.ts:200-287,proxy.ts}`, `server/{Dockerfile,package.json,eslint.config.mjs,playwright.config.ts}`, `packages/rules/src/time/{index,moment,constants,types,celebration,pins,event,slot}.ts`, `packages/contracts/src/{index,schemas,realtime}.ts`, `lib/time/{params,timeMachine,types}.ts`, `lib/env.ts`, `lib/api/domains.ts`, `lib/api/http/realtime/{index,types}.ts`, `workers/edge/src/*`, `infra/ops/lib/{config,args,bootstrap,node}.mjs` (parts), `.github/workflows/verify.yml` (outline), `playwright.http.config.ts`, `scripts/check-bundle.mjs`, `server/test/integration/doors.int.test.ts`, `server/test/e2e/doors-404.e2e.ts`.
- **Not established** (marked "to confirm" in items): Payload 3.91 root `endpoints` under `/cms-api` (W34 fallback stated), compound unique index syntax (W8), `payload.config.ts` access to the env class (W34), types-generation script name (W9), which edge test file holds proxy tests (W18), `image.test.mjs` Dockerfile assertions (W1), NTS support in Ubuntu's chrony package (W53), recipe of the production-mode edge e2e build (W52), whether Playwright 1.64 supports per-project `workers` (W50 uses two invocations either way).

## Rollback / blast radius

- **Code:** revert the branch. Schema change is additive; the previous server image runs on the new schema (new tables unused). `down` exists but deploy never runs it.
- **Behaviour switches at runtime:** production keeps `realClock`; the scheduler in production has no action rows (recorder is test/rehearsal only), so it only holds the lease and computes moments. Rehearsal gets virtual time controls.
- **Site:** production/prelaunch bundles proven unchanged by `check-bundle`; the integration build's time machine now drives the server test clock (affects only test builds and e2e).
- **Rehearsal node:** chrony replaces timesyncd (reversible by `apt-get remove chrony && systemctl enable --now systemd-timesyncd`); drill leaves no container behind (`rm -sf server-drill`); no resize on any default path.
- **Shared local state:** worktree DBs get four tables; the ×60 run holds the shared lock ~40 min.
