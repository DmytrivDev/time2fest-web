# Implementation plan: Time rules module (SPEC-03)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-03-time-rules.md` (Status: approved; checker: 0 markers, 0 violations). AC-1 … AC-38, NFR-1 … NFR-3. Open questions 1–3 of the spec are non-blocking (owner decision / answered below / docs-sync).
This plan implements those requirements; it does not define or change them.
**Execution mode** — single-agent, sequential phases P1 … P5 (one `sdd-engineering:implementer` dispatch per phase) plus P6, which is run by the orchestrator under the heavy-run lock. Given as decided in the orchestrator's brief (2026-11-17): single lane, wave size S.
**Out of scope** — the spec's Non-goals (lines 22-32): time source (`lib/time/TimeSource.ts`, `TimeProvider.tsx`, `params.ts`, `timeMachine.ts`, `computeJumps` in `lib/time/jumps.ts`), anything in `server/`, text rules (`metPhrase`, `ukOrdinal`), fixing the "zone passed +15 min" divergence (Open question 1, owner answer Q2 = A — behaviour preserved), UI-only timings (−60 s, −12 s, stamp hint 60 s, TV countdown 5 min, a11y milestones, rotation, "typing"), the offer *decision* (`offerEligibility` stays in web; only its time bounds move), rating rows and the `weighted` formula, the §2.3 table update in `docs/site/00-overview.md` (docs-sync after merge), delivery of moment corrections (FR-CAT-12), any dependency version change (SPEC-02 upgrades Next in parallel). Architecture and security review are performed by separate agents.

Repository root for every path below = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-03-time-rules` (branch `spec-03-time-rules`, base `3f2389f`). `node_modules` is installed. **Do not commit, never push** (the orchestrator commits). Never touch `server/**`, `tsconfig.json` (it has an unrelated local modification — never stage it), `lib/time/**`.

**Behaviour reference** — "as on master" always means commit `3f2389f` (`git show 3f2389f:<path>`); `master` itself may move while this wave runs.

## Requirements traceability
| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | `@time2fest/rules/time` exports every listed rule/constant | `docs/specs/SPEC-03-time-rules.md:49` | W2–W10, W12 | W10, W17 `Done means` |
| AC-2 | eslint error on `Date.now` / `performance.now` / `new Date()` in `packages/rules/src/**` | `:52` | W16 | W16 |
| AC-3 | eslint error on app imports from `packages/rules/src/**` | `:55` | W16 | W16 |
| AC-4 | old rule paths → `no-restricted-imports`; old modules deleted | `:58` | W12, W13, W16 | W13, W16 |
| AC-5 | duplicate check (moment ± rule constant / same-valued own constant) fails `eslint .` | `:61` | W16 | W16 |
| AC-6 | the 13 copies replaced by package calls | `:64` | W14 | W14, W17 |
| AC-7 | three divergent rules under own names, outputs unchanged | `:67` | W9, W15 | W9, W15 |
| AC-8 | `workspace:*` + `transpilePackages`, lockfile link only | `:70` | W1 | W1, W18 |
| AC-9 | package test suite via root vitest, in `verify` and CI | `:73` | W1 | W1, W18 |
| AC-10 | moved rules identical for Δ = 0; existing tests pass with import-only diff; §2.3 table at ±1 ms | `:78` | W4–W7, W13 | W7, W13 |
| AC-11 | celebration bounds inclusive | `:81` | W3 | W3 |
| AC-12 | toast season before/during/after | `:84` | W3 | W3 |
| AC-13 | event status bounds | `:87` | W4 | W7 |
| AC-14 | moment timeline points | `:90` | W4 | W7 |
| AC-15 | air slot current rule | `:93` | W5 | W7 |
| AC-16 | zone `past` at m + 15 min | `:96` | W5 | W7 |
| AC-17 | `pinnedUntil` rule | `:99` | W6 | W7 |
| AC-18 | rating open at m + 15 s − Δ | `:102` | W7 | W7, W10 |
| AC-19 | rating closed at last + 12 h + Δ | `:105` | W7 | W7, W10 |
| AC-20 | Δ shifts only the listed bounds, in the person's favour | `:108` | W3, W7, W8 | W10 |
| AC-21 | default Δ = 0; server default 1500 | `:111` | W2 | W2, W10 |
| AC-22 | `RangeError` on invalid Δ / I | `:114` | W2 | W2, W10 |
| AC-23 | client surface presence rule | `:119` | W8, W13 | W13 (existing `presence.test.ts`) |
| AC-24 | pulse presence window [m − 2I − Δ; m + 15 s + Δ] | `:122` | W8 | W8 |
| AC-25 | client `openedAt`/`at` never widen the window | `:125` | W8 | W8 |
| AC-26 | `grantedAt = m + 15 s` | `:128` | W8, W11 | W8 |
| AC-27 | four FR-STAMP-03 cases | `:133` | W10 | W10 |
| AC-28 | Kiribati / Chatham | `:136` | W10 | W10 |
| AC-29 | Nepal / India | `:139` | W10 | W10 |
| AC-30 | UTC+1 zone at 2026-12-31T23:00Z | `:142` | W10 | W10 |
| AC-31 | empty zone list = master values, no throw | `:145` | W3, W6, W7, W10 | W10 |
| AC-32 | Δ = 1500 examples on open/close | `:148` | W10 | W10 |
| AC-33 | site never calls the pulse rule | `:153` | W17 | W17 |
| AC-34 | full vitest of web and rules green | `:156` | W18 | W18 |
| AC-35 | e2e us1-air, us8-time-machine, us3-room, us6-offers × phone/desktop | `:159` | W19 | W19 |
| AC-36 | boards unchanged (layout-fidelity on `sim`) | `:162` | W20 | W20 |
| AC-37 | web `full` verify incl. `next build` | `:165` | W18 | W18 |
| AC-38 | no file changed outside the card's list; nothing in `server/` | `:168` | all; see Spec follow-up 1 | W17 |
| NFR-1 | zero runtime deps, compiles with ES2022 lib, no DOM | `:189` | W1, W2 | W2 |
| NFR-2 | no module-level mutable state | `:192` | W10, W16 | W10, W16 |
| NFR-3 | CI `verify` < 20 min | `:195` | W21 | W21 |

## Spec follow-ups
Addressed to `spec-creator` and the owner. The plan implements the spec as written; where the spec's own items conflict, the plan takes the only reading that satisfies all of them and says so here.

1. **AC-38 file list vs AC-4 / A2.** AC-4 and A2 delete the old modules without re-exports, so every consumer's import line must change: ~45 files outside the AC-38 list (`components/map/**`, `components/live/Caption.tsx`, `lib/api/sim/passport.ts`, `lib/presence/surfaces.ts`, `lib/demo/seed.ts`, `lib/player/BroadcastController.tsx`, `stories/player/PlayerBlock.stories.tsx`, `stories/tv/TvScreen.stories.tsx`, …). The plan changes **only import lines** in those files, and W17 checks that mechanically. Proposed AC-38 rewording: "… plus import-line-only changes in consumers of the moved modules".
2. **AC-1 "`pinnedUntil`".** The web function `pinnedUntil(t: {tier, createdAt}, midnights)` mixes a product rule (only $5/$10 tiers pin, `lib/toast/tiers.ts:23`) with the time rule. The package exports the time rule as **`pinnedUntilAt(createdAt, midnights)`** (AC-17). `lib/toast/feed.ts` keeps `pinnedUntil` as a one-line tier gate over it, so `tests/unit/toast/feed.test.ts` changes only its import lines (AC-10).
3. **AC-10 / Q5 "move existing tests".** Only `tests/unit/engine/celebration.test.ts` and `tests/unit/engine/newYear.test.ts` are self-contained. The others import web fixtures (`tests/unit/fixtures/data`, `getData`, `stores/guest`, `lib/api/sim/*`), and the package must not import the app (AC-3). Those tests stay in `tests/unit/**`, change only their import lines, and run against the package through the root vitest. The new package suite covers the same boundaries without fixtures (W7, W10).
4. **AC-5 scope.** The duplicate check is applied to app code (`app/`, `components/`, `lib/`, `stores/`, `stories/`, `hooks/`, `functions/`) but not to `tests/**`. Tests build boundary instants such as `kyiv.midnightMs + RATING_OPEN_AFTER - 1` by design (`tests/unit/api/rating-sim.test.ts:20`).
5. **AC-20 "stamp acceptance bound".** Read as `stampAcceptUntil(m, Δ) = m + 15 s + Δ`: the latest server receipt time at which presence for the event still counts. This is the upper edge of the AC-24 window, and the window uses it.
6. **Open question 2 answered.** `functions/api/time.ts` only returns `now` (`tests/unit/functions-time.test.ts:5-15`). It repeats no rule, so AC-6 does not change.
7. **Knowledge file.** `docs/knowledge/gotchas.md` (config `knowledgeFiles`) does not exist in this tree. There are no project gotchas to apply.

## Affected surface
Consumer lists come from `grep` of import sites and `graphify affected` (isCelebrating, zoneState, eventStatus, midnightOf, currentSlotIndex, presenceOf, presentEvents, captionPhase, momentTimeline, arrivedYear, toastSeason, canSayToast, pinnedUntil, ratingCloseAt), run 2026-11-17 in this worktree.

### New: package `rules` (`packages/rules/**` — unrouted, see Coverage gaps)
| File | New/Mod | Content | Constraint to respect |
|---|---|---|---|
| `packages/rules/package.json` | Mod (only if needed) | no change expected; `exports["./time"]` already points to `./src/time/index.ts` | security → no new dependency (NFR-1, AC-8) |
| `packages/rules/tsconfig.json` | Mod | `include: ["src", "test", "vitest.config.ts"]` (mirror `packages/contracts/tsconfig.json`) | keep `lib: ["ES2022"]`, `types: []` (NFR-1) |
| `packages/rules/vitest.config.ts` | New | `environment: 'node'`, `include: ['test/**/*.test.ts']`, `resolve.alias['@time2fest/rules/time'] = src/time/index.ts` | imports `vitest/config` resolved from root `node_modules` |
| `packages/rules/src/time/types.ts` | New | `Ms`, `MidnightLike {midnightMs}`, `ZonesLike {zones: readonly MidnightLike[]}`, `EventLike {id; midnightUtc; midnightMs?}`, `EventStatus`, `ZoneState`, `PresenceSource`, `ToastSeason`, `Pulse` | structural types only (A3); identical unions to `lib/data/types.ts:61,226` |
| `packages/rules/src/time/constants.ts` | New | all durations from `lib/engine/config.ts:9-32` except `NEXT_EVENT_JUMP`, `TYPING_QUIET`; `CELEBRATION_LEAD/TAIL` (`lib/engine/celebration.ts:4,10`); `RATING_OPEN_AFTER`, `RATING_CLOSE_AFTER` (`lib/rating/rating.ts:21,27`); `SCHEDULE_CLOSE_MS` (`components/live/CalendarButton.tsx:15`); `CATCH_UP_MAX_AGE_MS` (`lib/stamp/stampCelebration.ts:28`); `SERVER_CLOCK_TOLERANCE_MS = 1500` | same names and values as master (tests stay import-only) |
| `packages/rules/src/time/tolerance.ts` | New | `assertTolerance(delta)`, `assertPulseInterval(i)` → `RangeError` | AC-22 |
| `packages/rules/src/time/celebration.ts` | New | `isCelebrating`, `toastsOpenAt`, `canSayToast(now, data, delta = 0)`, `toastSeason` | bodies as `lib/engine/celebration.ts:16-24`, `lib/toast/season.ts:14-31` |
| `packages/rules/src/time/year.ts` | New | `arrivedYear` | `new Date(arg)` with an argument stays legal (AC-2 bans the no-arg form only) |
| `packages/rules/src/time/event.ts` | New | `midnightOf`, `eventStatus`, `toRuntime` (generic `<E extends MidnightLike>`), `handoverMoment(m)` | `lib/engine/eventStatus.ts:5-19` |
| `packages/rules/src/time/caption.ts` | New | `captionPhase` + all its exported types | verbatim from `lib/engine/captionPhase.ts` |
| `packages/rules/src/time/moment.ts` | New | `momentTimeline`, `momentState`, `momentStage` + types | verbatim from `lib/engine/momentTimeline.ts` |
| `packages/rules/src/time/slot.ts` | New | `currentSlotIndex`, `zoneState`, `isZonePast(now, m)` | `lib/engine/currentAirEvent.ts:55-58`, `lib/engine/zoneState.ts:15-23` |
| `packages/rules/src/time/pins.ts` | New | `nextMidnightAfter`, `prevMidnightAtOrBefore`, `pinnedUntilAt` | `lib/toast/feed.ts:46-73` minus the tier gate |
| `packages/rules/src/time/bounds.ts` | New | `ratingCloseAt({zones})`, `isRatingOpenFor(now, m, delta = 0)`, `isRatingClosed(now, data, delta = 0)`, `offerEarliestAt(m)`, `isTooCloseToNextForOffer(now, nextM)`, `isScheduleClosed(now, m)`, `isStampTooOldToCelebrate(now, grantedAt)` | `ratingCloseAt` keeps `Math.max(...[])` behaviour for empty zones (AC-31) |
| `packages/rules/src/time/presence.ts` | New | `PresenceSurface`, `presenceOf`, `presenceMoment`, `presentEvents`, `stampGrantedAt(m)`, `stampAcceptUntil(m, delta = 0)`, `isPresentByPulses(...)` | client rule verbatim from `lib/engine/presence.ts:16-69`; the `buildStamp` part goes to web (W11) |
| `packages/rules/src/time/divergent.ts` | New | `zonePassedHandover`, `defaultCountryZone`, `isInReminderWindow` | each doc comment cites spec Open question 1 |
| `packages/rules/src/time/index.ts` | Mod | the package's public surface: named re-exports of the files above (`export type` for types, `isolatedModules`) | the only barrel; it is the package `exports` entry |
| `packages/rules/test/*.test.ts` | New / moved | `foundation`, `celebration-season`, `rules-table`, `presence-pulses`, `divergent`, `boundaries.shared`, `exports`; moved `celebration.test.ts`, `newYear.test.ts` | no imports outside `packages/rules` |
| `packages/rules/eslint/no-time-rule-copy.mjs` + `.d.mts` | New | local ESLint plugin for AC-5 | not in `tsconfig` `include`; `.d.mts` types its exports for the lint test |

### Web (root package)
| File | New/Mod | Package | Home | Skills that will govern it | Constraint to respect |
|---|---|---|---|---|---|
| `package.json` | Mod | web | — | security | add only `"@time2fest/rules": "workspace:*"` to `dependencies`, next to `@time2fest/contracts` (`package.json:37`); no version change |
| `pnpm-lock.yaml` | Mod (generated) | web | — | unrouted | only the importer link entry `'@time2fest/rules': specifier workspace:*, version link:packages/rules` |
| `next.config.ts` | Mod | web | — | next-best-practices | `transpilePackages: ['@time2fest/contracts', '@time2fest/rules']` (`next.config.ts:21`); nothing else |
| `.claude/sdd-engineering.json` | Mod | — | — | unrouted | `rules.files` / `rules.full` (W1) |
| `.github/workflows/verify.yml` | Mod | — | — | security | step `rules full` equals config `rules.full` (`verify.yml:1-2` comment requires lock-step) |
| `eslint.config.mjs` | Mod | web | — | unrouted | flat config: a later block with the same rule **replaces** earlier options for overlapping files, so the components/app block (`eslint.config.mjs:19-89`) must carry seam patterns + old-rule paths together (W16) |
| `lib/engine/config.ts` | Mod | web | lib | unrouted | keeps only `NEXT_EVENT_JUMP` (used by `lib/time/jumps.ts:6`, not to be touched) and `TYPING_QUIET` (used by `lib/engine/offerEligibility.ts:2`) |
| `lib/engine/{celebration,eventStatus,zoneState,newYear,presence,momentTimeline,captionPhase}.ts`, `lib/toast/season.ts` | Delete | web | — | — | no re-export stubs (A2) |
| `lib/engine/stamp.ts` | New | web | lib | unrouted | `buildStamp`, `StampContext` from `lib/engine/presence.ts:71-88`, `grantedAt: stampGrantedAt(midnightOf(e))` |
| `lib/engine/currentAirEvent.ts` | Mod | web | lib | unrouted | stays in web (stream choice, `AirState` used by `lib/time/jumps.ts:7`); imports `currentSlotIndex`, `toRuntime`, `handoverMoment` from the package; `currentSlotIndex` export removed |
| `lib/engine/offerEligibility.ts` | Mod | web | lib | unrouted | lines 59, 64 → `offerEarliestAt`, `isTooCloseToNextForOffer` |
| `lib/rating/rating.ts` | Mod | web | lib | unrouted | drops `RATING_*` and `ratingCloseAt`; line 110 → `!isRatingOpenFor(now, e.midnightMs)`; line 119 → `isRatingClosed(now, data)` |
| `lib/toast/feed.ts` | Mod | web | lib | unrouted | drops `nextMidnightAfter`, `prevMidnightAtOrBefore`, `CELEBRATION_TAIL` import; `pinnedUntil = tierPins(t.tier) ? pinnedUntilAt(t.createdAt, m) : null` |
| `lib/stamp/stampCelebration.ts` | Mod | web | lib | unrouted | drops `CATCH_UP_MAX_AGE_MS` (line 28); line 81 → `isStampTooOldToCelebrate` |
| AC-6 sites: `components/countries/CountryList.tsx:100,155`, `components/map/CountryPanel.tsx:108,333`, `components/map/ZonePanel.tsx:214`, `components/map/parts/MapTooltip.tsx:27`, `components/country/CountryLive.tsx:102`, `components/rating/RatingPage.tsx:69`, `components/live/CalendarButton.tsx:15,29`, `components/live/EventCard.tsx:23,173` | Mod | web | as is | frontend-ui-architecture, react-best-practices | one expression per site → package call; no JSX change |
| AC-6 sites (`.ts`): `components/country/useCountryPlayer.ts:222`, `lib/schedule/schedulePath.ts:55`, `lib/room/windowEnd.ts:27`, `lib/api/sim/rating.ts:47`, `lib/chat-sim/simulator.ts:95` | Mod | web | as is | unrouted | same |
| AC-7 sites: `components/room/hooks/useRoomLiveStreams.ts:31`, `lib/events/engineScheduler.ts:108`, `lib/live/countryData.ts:54`, `lib/api/sim/NotificationsGenerator.tsx:84` | Mod | web | as is | react-best-practices (`.tsx`) | output unchanged; guard `now > 0 && zones.length > 1` stays in `countryData.ts:53` |
| Import-only consumers (W12; Spec follow-up 1): `components/account/PassPlaque.tsx`, `components/chat/parts/AuthorPanel.tsx`, `components/country/countryHelpers.ts`, `components/dev/TimeMachinePanel.tsx` (only if it imports a moved name), `components/live/{ActionRow,Caption}.tsx`, `components/map/{MapSide,ZoneListView,ZoneMap}.tsx`, `components/map/parts/{MapLegend,ZoneGroup,ZoneMapCardSlot,ZoneMapOverlay,ZoneMapSvg,ZoneMapTipView}.tsx`, `components/map/zoneMapGeometry.ts`, `components/passport/PassportPage.tsx`, `components/player/{CountdownScene,PlayerBlock}.tsx`, `components/schedule/SchedulePage.tsx`, `components/shell/ShellHeader.tsx`, `components/support/SupportPage.tsx`, `components/toast/{ToastWindow,useToastSeason}.tsx`, `components/tv/{TvScene,TvSidebar}.tsx`, `lib/api/hooks/passport.ts`, `lib/api/sim/passport.ts`, `lib/demo/seed.ts`, `lib/presence/surfaces.ts`, `lib/live/{eventCards,homeData}.ts`, `lib/offers/context.ts`, `lib/player/BroadcastController.tsx`, `lib/toast/worldToasts.ts`, `stories/player/PlayerBlock.stories.tsx`, `stories/tv/TvScreen.stories.tsx` | Mod | web | — | frontend-ui-architecture, react-best-practices (`.tsx`, `lib/api/hooks/**`) | **import lines only** |
| Tests, import-only: `tests/unit/engine/{captionPhase,currentAirEvent,momentTimeline,presence,status}.test.ts`, `tests/unit/toast/{season,feed}.test.ts`, `tests/unit/rating/rating.test.ts`, `tests/unit/api/{rating-sim.test.ts,rating-hooks.test.tsx}`, `tests/unit/live/{caption-veil,main-celebration-ui}.test.tsx`, `tests/unit/stamp/{header-celebration.test.tsx,celebration.test.ts}`, `tests/unit/room/windowEnd.test.ts`, `tests/unit/us6/flow.test.tsx` | Mod | web | — | react-testing-library (`.test.tsx`) | import lines only (AC-10) |
| `tests/unit/engine/{celebration,newYear}.test.ts` → `packages/rules/test/` | Move (`git mv`) | rules | — | unrouted | import line only |
| `tests/unit/lint/time-rules-lint.test.ts` | New | web | — | unrouted | `// @vitest-environment node`; ESLint Node API `lintText` (W16) |

Not changed although they are related (spec Non-goals, brief): `lib/time/jumps.ts` keeps `NEXT_EVENT_JUMP` from `@/lib/engine/config` and `type AirState` from `@/lib/engine/currentAirEvent`, both still valid. `tests/unit/time/jumps.test.ts` is unchanged. `functions/**` and `server/**` are not changed.

**Coverage gaps:** `packages/rules/**` (no routing row; `docs/backend/sdd-routing.md` §1 routes only `packages/contracts/src/**`). It is judged by NFR-1/2 and the AC-2/3 lint. Also unrouted: `lib/engine/**`, `lib/{rating,toast,stamp,schedule,room,live,events,chat-sim,presence,demo,offers,player}/**`, `lib/api/sim/**` (`.ts`), `components/**/*.ts`, `eslint.config.mjs`, `.claude/sdd-engineering.json`, `pnpm-lock.yaml`, `docs/plans/*.md`.

## Contract changes
- **Shared contracts / schemas:** no wire change. There is one new public TS surface, `@time2fest/rules/time`, marked proposed in the spec (`:207`). `packages/contracts` is not touched.
- **Migration:** no.
- **Seed / fixture data:** no. `lib/demo/seed.ts` changes its import line only.
- **Build-only failures:** yes, low risk. The package is TS source that enters client bundles, and without `transpilePackages` `next build` fails while `tsc` and vitest stay green. W1 adds it, and W18 (`next build` in web `full`) catches it. The package imports no Node or DOM modules (NFR-1).
- **Wire contract:** no. No service method, route, channel, ApiError or wire schema changes.
- **Layout fidelity:** yes. Files under `web/` that render change (import rewiring and AC-6/AC-7 expressions in components). Run `layout-fidelity` on the `sim` build for the boards of home (air, caption), country, countries/map, room, TV, rating, support (toasts), schedule and passport (W20, orchestrator-run). Domain e2e runs with `--workers=2` (W19).
- **Payload migration:** no.
- **Test doors:** no.
- **Agent write surface:** no.
- **Seed and fixtures:** no.

## Work items

### W1 — Wire the package into the workspace, verify and CI (P1)
- **Serves:** AC-8, AC-9; enables every later item.
- **Do:**
  - Add `"@time2fest/rules": "workspace:*"` to the root `dependencies`, then run `pnpm install --prefer-offline` from the root. Check `git diff 3f2389f -- pnpm-lock.yaml`: only the `.` importer gains the `@time2fest/rules` link entry. If anything else changes, revert it and stop with BLOCKED.
  - Add `'@time2fest/rules'` to `transpilePackages`.
  - Create `packages/rules/vitest.config.ts` (see Affected surface) and extend the tsconfig `include`.
  - Set config `rules` to `files`: `npx tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs related --run --maxWorkers=2 --passWithNoTests {files}` and `full`: `npx tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2`. These use the root vitest binary. Plain `npx vitest` inside `packages/rules` would not find it, because that package has no `vitest`.
  - Copy `full` verbatim into the `rules full` step of `verify.yml`.
  - Lockfile note for rebase: on conflict take master's `pnpm-lock.yaml`, re-run `pnpm install`, and commit the regenerated file (SPEC-02 changes Next versions in parallel).
- **Files:** `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `packages/rules/{tsconfig.json,vitest.config.ts}`, `.claude/sdd-engineering.json`, `.github/workflows/verify.yml`.
- **Done means:** `node_modules/@time2fest/rules` resolves to `packages/rules`. `git diff 3f2389f -- package.json pnpm-lock.yaml packages/rules/package.json` shows only the link entries. The `rules full` text in `verify.yml` equals the config string.
- **Verify:** web `files` on `next.config.ts`; rules `full` (passes once W2 adds its first test, which is in the same phase).
- **Rules that apply:** security → A03 supply chain (no new package, no version change); next-best-practices → bundling (workspace TS source needs `transpilePackages`).
- **Risk:** lockfile churn. Keep it to the link only.

### W2 — Package foundation: types, constants, Δ validation (P1)
- **Serves:** AC-1, AC-21, AC-22, NFR-1.
- **Do:**
  - Create `types.ts`, `constants.ts` and `tolerance.ts` as described in Affected surface.
  - `assertTolerance(d)` throws `RangeError` unless `Number.isFinite(d) && d >= 0`. `assertPulseInterval(i)` throws unless `Number.isFinite(i) && i > 0`.
  - Every function that takes Δ defaults it to `0` and calls `assertTolerance` first.
  - `index.ts` re-exports the new files.
  - Test `packages/rules/test/foundation.test.ts`: each constant value against master, `SERVER_CLOCK_TOLERANCE_MS === 1500`, and the four `RangeError` inputs of AC-22 (Δ = −1, NaN; I = 0, Infinity).
- **Files:** `packages/rules/src/time/{types,constants,tolerance,index}.ts`, `packages/rules/test/foundation.test.ts`.
- **Done means:** the rules `full` command is green with ≥ 1 test file. `packages/rules/package.json` has no `dependencies` key.
- **Verify:** rules `files` on the four files.
- **Rules that apply:** frontend-ui-architecture §4 → `as const`/plain constants, no `enum`; `import type` for types.
- **Risk:** low.

### W3 — Celebration, toast season, arrived year (P1)
- **Serves:** AC-11, AC-12, AC-20 (toast-payment end), AC-31 (celebration/season part), AC-1.
- **Do:**
  - Port `isCelebrating`, `toastsOpenAt`, `toastSeason` and `arrivedYear` with the same bodies, taking structural `ZonesLike`.
  - `canSayToast(now, data, delta = 0)` = `isCelebrating`, with the end bound `last + CELEBRATION_TAIL + delta`. The start bound is not shifted.
  - Tests in `packages/rules/test/celebration-season.test.ts`: the AC-11 four points, the AC-12 three phases, and the empty zone list (`isCelebrating` false, `toastsOpenAt` null, `toastSeason` `'before'`, as on master).
- **Files:** `packages/rules/src/time/{celebration,year,index}.ts`, `packages/rules/test/celebration-season.test.ts`.
- **Done means:** the tests named above are green. `canSayToast(t, d)` equals `isCelebrating(t, d)` for Δ = 0 at every AC-11 point.
- **Verify:** rules `files`.
- **Rules that apply:** NFR-2 (no module-level `let`).
- **Risk:** low.

### W4 — Event status, handover, caption phases, moment timeline (P2)
- **Serves:** AC-13, AC-14, AC-10, AC-1.
- **Do:**
  - Port `midnightOf`, `eventStatus`, `toRuntime` and `handoverMoment(m) = m + HANDOVER_AFTER` into `event.ts`. `toRuntime<E extends MidnightLike>(now, e): E & { status: EventStatus; t: number }` has the same body as master.
  - Copy `captionPhase.ts` and `momentTimeline.ts` verbatim into `caption.ts` and `moment.ts`. Swap only their imports to the package-local modules and `EventLike`.
- **Files:** `packages/rules/src/time/{event,caption,moment,index}.ts`.
- **Done means:** `npx tsc --noEmit -p packages/rules` passes. `diff` of each copied function body against `git show 3f2389f:lib/engine/<file>` shows only import and type-alias lines.
- **Verify:** rules `files`.
- **Rules that apply:** frontend-ui-architecture §5 → pure rules as plain functions; no React.
- **Risk:** low. `EventRuntime` compatibility is checked in W12 by root `tsc`.

### W5 — Air slot and zone state (P2)
- **Serves:** AC-15, AC-16, AC-1.
- **Do:** Port `currentSlotIndex` and `zoneState` verbatim into `slot.ts`. Add `isZonePast(now, m) = now >= m + HANDOVER_AFTER`. `zoneState` uses `isZonePast` for its `past` branch.
- **Files:** `packages/rules/src/time/{slot,index}.ts`.
- **Done means:** `tsc` for rules passes. W7 holds the tests.
- **Verify:** rules `files`.
- **Rules that apply:** NFR-2.
- **Risk:** low.

### W6 — Next/previous midnight and pin end (P2)
- **Serves:** AC-17, AC-31 (pin part), AC-1.
- **Do:** Port `nextMidnightAfter` and `prevMidnightAtOrBefore` verbatim. Add `pinnedUntilAt(createdAt, midnights)`, which is the body of `lib/toast/feed.ts:65-73` without the `tierPins` line (Spec follow-up 2).
- **Files:** `packages/rules/src/time/{pins,index}.ts`.
- **Done means:** `tsc` for rules passes. W7 holds the tests.
- **Verify:** rules `files`.
- **Rules that apply:** —
- **Risk:** low.

### W7 — Rating, offer, schedule and catch-up bounds plus the §2.3 table test (P2)
- **Serves:** AC-18, AC-19, AC-10 (table), AC-13–AC-17, AC-31 (rating part), AC-1.
- **Do:**
  - `bounds.ts` (signatures in Affected surface):
    - `isRatingOpenFor = now >= m + RATING_OPEN_AFTER - delta`
    - `isRatingClosed = now >= ratingCloseAt(data) + delta`
    - `offerEarliestAt = m + OFFER_MIN_AFTER`
    - `isTooCloseToNextForOffer = nextM - now < OFFER_MIN_BEFORE_NEXT`
    - `isScheduleClosed = m - now < SCHEDULE_CLOSE_MS`
    - `isStampTooOldToCelebrate = now - grantedAt > CATCH_UP_MAX_AGE_MS`
  - Test `packages/rules/test/rules-table.test.ts` with m = 2027-01-01T00:00:00Z:
    - every bound of AC-13 … AC-19 at bound − 1 ms, bound and bound + 1 ms;
    - the AC-14 timeline values;
    - AC-15: second-to-last slot at m + 15 min is not current, last slot at m + 2 h is current, at + 1 ms there is no slot;
    - AC-17: EC-1/EC-2 cases;
    - `ratingCloseAt({zones: []})` equals `-Infinity` and `isRatingClosed` is `true`, both as on master.
- **Files:** `packages/rules/src/time/{bounds,index}.ts`, `packages/rules/test/rules-table.test.ts`.
- **Done means:** rules `full` is green, and the table test has ≥ 1 assertion per bound of AC-13 … AC-19.
- **Verify:** rules `files`.
- **Rules that apply:** NFR-2.
- **Risk:** low.

### W8 — Presence: client surface rule, stamp moment, server pulse window (P3)
- **Serves:** AC-23, AC-24, AC-25, AC-26, AC-20 (stamp/pulse part), AC-1.
- **Do:**
  - Copy `presenceOf`, `presenceMoment`, `presentEvents` and `PresenceSurface` verbatim from `lib/engine/presence.ts:16-69`.
  - Add `stampGrantedAt(m) = m + STAMP_DELAY` and `stampAcceptUntil(m, delta = 0) = m + STAMP_DELAY + delta`.
  - Add `isPresentByPulses({ moment, pulses, intervalMs, delta = 0 })`, where `pulses: readonly { receivedAt: Ms; openedAt?: Ms; at?: Ms }[]`:
    - validate Δ and I first (AC-22);
    - return `true` iff some `receivedAt` lies in `[moment − 2·I − Δ, stampAcceptUntil(moment, Δ)]`, inclusive;
    - never read `openedAt` or `at` (AC-25). The doc comment states that they are untrusted hints.
  - Test `packages/rules/test/presence-pulses.test.ts`:
    - the AC-24 four edge points (I = 20 s, Δ = 1500: m − 41.5 s yes, m − 41.501 s no, m + 16.5 s yes, m + 16.501 s no);
    - AC-25: received at m + 30 s with `openedAt` m − 10 min and `at` m → not counted;
    - AC-26: `grantedAt` for presence at m + 14 s equals m + 15 s.
- **Files:** `packages/rules/src/time/{presence,index}.ts`, `packages/rules/test/presence-pulses.test.ts`.
- **Done means:** those tests are green. `grep -n "openedAt\|\.at\b" packages/rules/src/time/presence.ts` matches only the client-rule lines and the `Pulse` type, never inside `isPresentByPulses`.
- **Verify:** rules `files`.
- **Rules that apply:** spec Untrusted inputs: client fields never widen the window.
- **Risk:** medium. A wrong edge (open vs closed) is a stamp-granting bug in SPEC-07, so it is pinned by the ±1 µs-level points above.

### W9 — Divergent rules under their own names (P3)
- **Serves:** AC-7.
- **Do:** `divergent.ts`:
  - `zonePassedHandover(now, m) = now >= m + HANDOVER_AFTER`. It applies to every zone including the last; it is separate from `isZonePast` so the owner's Open question 1 can change room/scheduler alone.
  - `defaultCountryZone(now, zones)` = `zones.find(z => z.midnightMs + RECORDING_AFTER > now) ?? zones.at(-1)`, generic `<Z extends MidnightLike>`.
  - `isInReminderWindow(now, m) = now >= m - HOWTO_BEFORE && now < m + HOWTO_BEFORE`.
  - Test `packages/rules/test/divergent.test.ts`: for each rule, −1 ms / 0 / +1 ms at its bound against hard-coded expected values derived from the master expressions (`useRoomLiveStreams.ts:31`, `engineScheduler.ts:108`, `countryData.ts:54`, `NotificationsGenerator.tsx:84`). The last zone at m + 16 min counts as passed.
- **Files:** `packages/rules/src/time/{divergent,index}.ts`, `packages/rules/test/divergent.test.ts`.
- **Done means:** the divergent tests are green, and the last-zone case reports `zonePassedHandover === true` while `currentSlotIndex` still returns the last slot.
- **Verify:** rules `files`.
- **Rules that apply:** —
- **Risk:** low.

### W10 — Shared boundary suite and export list (P3)
- **Serves:** AC-27–AC-32, AC-20, AC-21, AC-22, AC-31, NFR-2, AC-1.
- **Do:**
  - `packages/rules/test/boundaries.shared.test.ts` imports only from `@time2fest/rules/time` (the server will run it unchanged). It holds:
    - the four named FR-STAMP-03 tests (AC-27);
    - Kiribati/Chatham at exactly 2026-12-31T10:15:00Z ± 1 ms (AC-28);
    - Nepal/India at 2026-12-31T18:30:00Z ± 1 ms (AC-29);
    - UTC+1 at 2026-12-31T23:00:00Z: `live`, `arrivedYear` 2027, not `past` (AC-30);
    - empty zones: celebration, season, `pinnedUntilAt`, rating close equal the master values and do not throw (AC-31);
    - the six Δ = 1500 points of AC-32;
    - AC-20: each shiftable bound moves by exactly 1500 ms in the person's favour, and `eventStatus`/`momentTimeline`/`currentSlotIndex`/`zoneState` results are identical for any Δ (they take none);
    - AC-21: calls without Δ equal calls with Δ = 0;
    - NFR-2: every exported function called twice with equal args gives equal results.
  - `packages/rules/test/exports.test.ts` imports every name listed in AC-1 from `@time2fest/rules/time` and asserts each is defined.
- **Files:** `packages/rules/test/{boundaries.shared,exports}.test.ts`.
- **Done means:** rules `full` is green. The two files import nothing but `vitest` and `@time2fest/rules/time`.
- **Verify:** rules `full`.
- **Rules that apply:** —
- **Risk:** low.

### W11 — `buildStamp` gets a web home (P4)
- **Serves:** enables AC-4 (deleting `lib/engine/presence.ts`); AC-26 (stamp uses `stampGrantedAt`).
- **Do:** Create `lib/engine/stamp.ts` with `StampContext` and `buildStamp` from `lib/engine/presence.ts:71-88`, with `grantedAt: stampGrantedAt(midnightOf(ctx.event))` (both from the package).
- **Files:** `lib/engine/stamp.ts`.
- **Done means:** root `tsc` passes, and `buildStamp` output for a fixture event equals master (covered by `tests/unit/engine/presence.test.ts` after W13).
- **Verify:** web `files` on `lib/engine/stamp.ts`.
- **Rules that apply:** frontend-ui-architecture §4 → module named after the concept (no `utils`).
- **Risk:** low.

### W12 — Switch every import to the package and trim the mixed modules (P4)
- **Serves:** AC-4, AC-1 (no declarations outside the package), AC-10.
- **Do:**
  1. Pure path swaps, where every imported name exists in the package under the same name. In all `*.ts`/`*.tsx` under `app components lib stores stories tests` (not `lib/time/**`), rewrite `'@/lib/engine/(celebration|eventStatus|zoneState|newYear|momentTimeline|captionPhase)'` and `'@/lib/toast/season'` to `'@time2fest/rules/time'`. Use a scripted `sed -i -E`, then `git diff --stat`.
  2. Mixed modules, edited by hand:
     - `@/lib/engine/config`: moved names → package; `NEXT_EVENT_JUMP`/`TYPING_QUIET` stay.
     - `@/lib/engine/presence`: `buildStamp`/`StampContext` → `@/lib/engine/stamp`, the rest → package.
     - `@/lib/rating/rating`: `RATING_*`, `ratingCloseAt` → package.
     - `@/lib/toast/feed`: `nextMidnightAfter` → package.
     - `@/lib/engine/currentAirEvent`: `currentSlotIndex` → package.
     - `@/lib/stamp/stampCelebration`: `CATCH_UP_MAX_AGE_MS` → package.
  3. Trim the source modules:
     - `config.ts` keeps 2 constants;
     - `rating.ts`, `feed.ts`, `currentAirEvent.ts` import from the package and stop declaring moved names; `feed.ts` `pinnedUntil` becomes the tier gate over `pinnedUntilAt`;
     - `currentAirEvent.ts:113` → `handoverMoment(slot.midnightMs)`;
     - `rating.ts:74-76` deleted, and `rating.ts:110,118-119` use the package;
     - `stampCelebration.ts:28` deleted, line 81 uses `isStampTooOldToCelebrate`.
  4. Merge two `@time2fest/rules/time` imports in one file into one statement.
- **Files:** the "Import-only consumers" and "Tests, import-only" rows, plus `lib/engine/{config,currentAirEvent}.ts`, `lib/rating/rating.ts`, `lib/toast/feed.ts`, `lib/stamp/stampCelebration.ts`, and the AC-6 component files' import lines.
- **Done means:**
  - `grep -rnE "@/lib/engine/(celebration|eventStatus|zoneState|newYear|presence|momentTimeline|captionPhase)|@/lib/toast/season" app components lib stores stories tests` is empty.
  - Root `tsc` passes.
  - The `git diff` of every consumer file contains only `import` lines (and their multi-line continuation lines).
- **Verify:** web `files` on every touched file. Pass the list via `git diff --name-only`, minus deleted files, and run vitest related in chunks of ~20 files if the command line gets long.
- **Rules that apply:** frontend-ui-architecture §4 → `import type` for type-only imports; no new wide barrels.
- **Risk:** medium (many files). It is mechanical, and root `tsc` catches every miss.

### W13 — Delete moved modules, move the self-contained tests (P4)
- **Serves:** AC-4, AC-10, AC-23.
- **Do:**
  - `git rm` `lib/engine/{celebration,eventStatus,zoneState,newYear,presence,momentTimeline,captionPhase}.ts` and `lib/toast/season.ts`.
  - `git mv tests/unit/engine/celebration.test.ts packages/rules/test/celebration.test.ts` and the same for `newYear.test.ts`. Change only their import line to `@time2fest/rules/time`.
- **Files:** the deleted modules, the two moved tests.
- **Done means:**
  - `Glob` for each deleted path is empty.
  - `git diff -M 3f2389f --stat` shows both tests as renames.
  - Root vitest related on the import-only tests (`tests/unit/engine/*`, `tests/unit/toast/{season,feed}.test.ts`, `tests/unit/rating/rating.test.ts`, `tests/unit/api/rating-*.test.*`, `tests/unit/stamp/*`, `tests/unit/room/windowEnd.test.ts`, `tests/unit/time/jumps.test.ts`) is green.
  - Rules `full` is green.
- **Verify:** web `files` on the touched tests; rules `full`.
- **Rules that apply:** react-testing-library → tests unchanged except imports.
- **Risk:** low.

### W14 — Replace the 13 copies (P5)
- **Serves:** AC-6.
- **Do:** One expression per site:
  - `CountryList.tsx:100,155`, `CountryPanel.tsx:108,333`, `ZonePanel.tsx:214`, `MapTooltip.tsx:27`, `schedulePath.ts:55` → `isZonePast(now, zone.midnightMs)` (or `midnightMs`).
  - `windowEnd.ts:27` → `handoverMoment(midnightOf(event))`; `useCountryPlayer.ts:222` → `handoverMoment(mainEvent.midnightMs)`.
  - `CountryLive.tsx:102` → `now >= stampGrantedAt(mainEvent.midnightMs)`.
  - `sim/rating.ts:47`, `RatingPage.tsx:69` → `isRatingOpenFor(now|minute, e.midnightMs)`.
  - `simulator.ts:95` → `stampGrantedAt(slot.midnightMs)`.
  - `CalendarButton.tsx:15,29` and `EventCard.tsx:23,173` → delete the local `SCHEDULE_CLOSE_MS` and call `isScheduleClosed(now, midnightMs)`.
  - `offerEligibility.ts:59,64` → `offerEarliestAt(midnightOf(last))`, `isTooCloseToNextForOffer(now, midnightOf(next))`.
  - Remove the imports that are now unused.
- **Files:** the AC-6 rows of Affected surface plus `lib/engine/offerEligibility.ts`.
- **Done means:**
  - `grep -rnE "midnightMs \+ (HANDOVER_AFTER|STAMP_DELAY|RATING_OPEN_AFTER)|\+ 15_000|SCHEDULE_CLOSE_MS = |CATCH_UP_MAX_AGE_MS = " app components lib` is empty.
  - The touched tests (`tests/unit/live/*`, `tests/unit/countries/*`, `tests/unit/schedule/*`, `tests/unit/room/windowEnd.test.ts`, `tests/unit/api/rating-*`, `tests/unit/engine/offerEligibility.test.ts`) pass unchanged.
- **Verify:** web `files` on the touched files.
- **Rules that apply:** react-best-practices → derive during render, no new state or effects; frontend-ui-architecture §5 → rule in a plain function, component only calls it.
- **Risk:** low. Each replacement is algebraically identical.

### W15 — Route the divergent sites through their named rules (P5)
- **Serves:** AC-7.
- **Do:**
  - `useRoomLiveStreams.ts:31` → `data.zones.find((z) => !zonePassedHandover(now, z.midnightMs))`.
  - `engineScheduler.ts:108` → `if (zonePassedHandover(now, slot.midnightMs)) continue;`.
  - `countryData.ts:54` → `defaultCountryZone(now, zones)?.id ?? null` inside the existing guard.
  - `NotificationsGenerator.tsx:84` → `isInReminderWindow(now, e.midnightMs)`.
- **Files:** those four files.
- **Done means:** the expressions are replaced, and the existing tests `tests/unit/events/scheduler.test.ts`, `tests/unit/room/*`, `tests/unit/live/*` and `tests/unit/notifications/*` pass unchanged.
- **Verify:** web `files`.
- **Rules that apply:** react-best-practices (`.tsx`).
- **Risk:** low.

### W16 — Lint: package purity, old paths, duplicate check (P5)
- **Serves:** AC-2, AC-3, AC-4, AC-5, NFR-2.
- **Do:** In `eslint.config.mjs`:
  - (a) Hoist the existing seam `patterns` array and the `no-restricted-syntax` selectors into named constants (behaviour unchanged).
  - (b) Define `oldRulePaths`:
    - path patterns for every deleted module: `@/lib/engine/<m>`, `**/lib/engine/<m>`, and the relative `./<m>` inside `lib/engine`; `@/lib/toast/season`, `**/lib/toast/season`;
    - `importNames` entries for the moved names on still-existing modules: `@/lib/engine/config` (moved constants), `@/lib/rating/rating` (`RATING_OPEN_AFTER`, `RATING_CLOSE_AFTER`, `ratingCloseAt`), `@/lib/toast/feed` (`nextMidnightAfter`, `prevMidnightAtOrBefore`), `@/lib/engine/currentAirEvent` (`currentSlotIndex`), `@/lib/stamp/stampCelebration` (`CATCH_UP_MAX_AGE_MS`), `@/lib/engine/presence`.
    - message: "Правила часу — лише @time2fest/rules/time (SPEC-03)."
  - (c) A block for `**/*.{ts,tsx,mjs}` with `ignores: ['packages/rules/**', 'components/**', 'app/**']` and `no-restricted-imports: oldRulePaths`.
  - (d) The existing components/app block gets `patterns: [...seamPatterns, ...oldRulePaths.patterns]` and `paths: oldRulePaths.paths`. This is needed because in flat config the later block's options replace the earlier ones for overlapping files.
  - (e) A block for `packages/rules/src/**/*.ts`:
    - `no-restricted-imports` patterns `@/*`, `../../../*`, `../../../**`, `next`, `next/*`, `react`, `react/*`;
    - `no-restricted-syntax`: `CallExpression[callee.object.name='Date'][callee.property.name='now']`, `CallExpression[callee.object.name='performance'][callee.property.name='now']`, `NewExpression[callee.name='Date'][arguments.length=0]`, `Program > VariableDeclaration[kind='let']` (NFR-2).
  - (f) The local plugin `packages/rules/eslint/no-time-rule-copy.mjs`, rule `t2f-time/no-rule-copy`. It applies to `**/*.{ts,tsx}` with `ignores: ['packages/rules/**', 'tests/**']` (Spec follow-up 4). It reports:
    - **(i)** a `+`/`-` BinaryExpression where one operand is a *moment expression* (identifier or member property named `midnightMs`, `midnight`, `m` or `t0`, or a call to `midnightOf`) and the other operand either has a name in `RULE_CONSTANT_NAMES` (every exported constant of `constants.ts` except `SERVER_CLOCK_TOLERANCE_MS`) or statically evaluates to a value in `BOUNDARY_VALUES` (the set of those constants' values). Static evaluation covers numeric literals with separators, unary minus, `*` of literals, and same-module `const` identifiers with such initialisers.
    - **(ii)** a relational comparison (`<`, `<=`, `>`, `>=`) between a moment-involving `+`/`-` expression and an operand that satisfies the same name/value test (catches `midnightMs - now < SCHEDULE_CLOSE_MS` with a local constant).
    - The module also exports `RULE_CONSTANT_NAMES` and `BOUNDARY_VALUES`. `.d.mts` declares them.
  - Test `tests/unit/lint/time-rules-lint.test.ts` (`// @vitest-environment node`, timeout 60 s) uses `new ESLint({ cwd: root })` and `lintText(code, { filePath })` to assert:
    - AC-2: `packages/rules/src/time/__sample__.ts` with the three calls → 3 errors; `new Date(0)` → 0.
    - AC-3: `import { x } from '@/lib/data/types'` there → 1 error.
    - AC-4: `components/__s__.tsx` importing `@/lib/toast/season` → `no-restricted-imports`, and the existing seam patterns still fire in the same file (regression for the merge in d).
    - AC-5: `components/__dup__.tsx` with `zone.midnightMs + HANDOVER_AFTER` → error; `now >= m + 15_000` → error; `const C = 2 * 60_000; midnightMs - now < C` → error.
    - Valid: `HANDOVER_AFTER - sinceMidnight` (pattern of `components/tv/TvSidebar.tsx:246`), `air.nextEvent.midnightMs + NEXT_EVENT_JUMP` (`lib/time/jumps.ts:36`), `z.midnightMs + (j + 1) * 60_000` (`lib/toast/worldToasts.ts:59`) → 0 errors.
    - Lock-step: `RULE_CONSTANT_NAMES` equals the package's exported constant names, and `BOUNDARY_VALUES` equals their values.
- **Files:** `eslint.config.mjs`, `packages/rules/eslint/no-time-rule-copy.{mjs,d.mts}`, `tests/unit/lint/time-rules-lint.test.ts`.
- **Done means:** the lint test is green, and `npx eslint .` reports 0 errors without any new `eslint-disable` comment. If a non-goal UI timing trips the rule, the rule is narrowed and a valid case is added to the test; it is not disabled at the site.
- **Verify:** web `files` on the four files, then `npx eslint .` once (it is part of the web `full` checks and is cheap enough to run here).
- **Rules that apply:** security → `.github/workflows` unaffected; config only.
- **Risk:** medium. A flat-config override can silently drop the seam rules, which is why the regression assertion in d) exists.

### W17 — Static scope checks (P5)
- **Serves:** AC-33, AC-38, AC-6, AC-1, AC-8.
- **Do:** Run and report the output of these read-only checks:
  1. `grep -rn "isPresentByPulses" app components lib` → empty (AC-33).
  2. `git diff 3f2389f --name-only -- server` → empty.
  3. `git diff 3f2389f --name-only`: every path is in the AC-38 list, in the AC-6/AC-7 site list, or in the import-only lists of Affected surface.
  4. For the import-only files: `git diff 3f2389f -U0 -- <files> | grep -E '^[-+]' | grep -vE '^(\+\+\+|---|[-+]\s*(import |\}|[A-Za-z_, ]+,?$|type ))'` → empty (manually check any multi-line import residue).
  5. AC-1 check: `grep -rnE "(export )?(const|function) (<every AC-1 name>)\b" app components lib stores` → only `lib/toast/feed.ts` `pinnedUntil` (Spec follow-up 2).
  6. `git diff 3f2389f -- package.json pnpm-lock.yaml packages/rules/package.json` → link entries only.
- **Files:** none.
- **Done means:** checks 1–6 return as stated.
- **Verify:** n/a (the checks are the evidence).
- **Rules that apply:** —
- **Risk:** low.

### W18 — Full verify (P6, orchestrator-run)
- **Serves:** AC-34, AC-37, AC-9, AC-8.
- **Do:**
  - Run `full` for `web` (`.`), `contracts` (`packages/contracts`) and `rules` (`packages/rules`) from `.claude/sdd-engineering.json`. Confirm the rules output shows its test-file count > 0.
  - In a clean checkout of the branch (or after `rm -rf node_modules` in a throwaway worktree), run `pnpm install --frozen-lockfile`.
  - **Known pre-existing red:** the home JS budget check (420 KB) also fails on `master` and is not a regression. Report it as known. Any other red is a failure.
- **Done means:** all three `full` commands exit 0 apart from the known budget item, and the frozen install succeeds.

### W19 — Domain e2e (P6, orchestrator-run)
- **Serves:** AC-35.
- **Do:** `npx playwright test tests/e2e/us1-air.spec.ts tests/e2e/us8-time-machine.spec.ts tests/e2e/us3-room.spec.ts tests/e2e/us6-offers.spec.ts --project=phone --project=desktop --workers=2`
- **Done means:** 4 specs × 2 projects are green.

### W20 — Layout fidelity (P6, orchestrator-run)
- **Serves:** AC-36.
- **Do:** Skill `layout-fidelity` on the `sim` build for the boards of home, country, countries/map, room, TV, rating, support, schedule and passport (manifests under config `designs`).
- **Done means:** every board diff is ≤ 0.1 %; boards between 0.1 % and 0.5 % carry a `fidelity-triager` class other than `layout`; no board is above 0.5 %.

### W21 — CI duration (P6, orchestrator-run after push)
- **Serves:** NFR-3.
- **Done means:** the `verify` job run on the wave branch finishes in < 20 min.

## Execution
Single-agent: each phase is a fresh `sdd-engineering:implementer` dispatch with this plan's path and the phase id. Phases run strictly in order, nothing in parallel (`sdd-routing.md` §7). Every phase leaves the tree green: root `tsc`, eslint on touched files, vitest related, and rules `full` from P1 on. P1–P3 are additive: old modules stay and nothing imports the package yet. P4 switches the imports, and P5 removes the copies and turns on the lint.

| Lane / phase | Executor | Model | Work items | Files (disjoint) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — wiring + foundation + celebration | `sdd-engineering:implementer` | sonnet | W1, W2, W3 | `package.json`, `pnpm-lock.yaml`, `next.config.ts`, `.claude/sdd-engineering.json`, `.github/workflows/verify.yml`, `packages/rules/{tsconfig.json,vitest.config.ts}`, `packages/rules/src/time/{types,constants,tolerance,celebration,year,index}.ts`, `packages/rules/test/{foundation,celebration-season}.test.ts` | — | — | this worktree; `pnpm install` is the only generator, run alone |
| P2 — event, slot, pins, bounds | `sdd-engineering:implementer` | sonnet | W4, W5, W6, W7 | `packages/rules/src/time/{event,caption,moment,slot,pins,bounds,index}.ts`, `packages/rules/test/rules-table.test.ts` | P1 | — | this worktree |
| P3 — presence, pulses, divergent rules, shared suite | `sdd-engineering:implementer` | **opus** — new FR-STAMP-03 pulse window and Δ directions; a wrong closed/open edge grants or denies stamps in SPEC-07 | W8, W9, W10 | `packages/rules/src/time/{presence,divergent,index}.ts`, `packages/rules/test/{presence-pulses,divergent,boundaries.shared,exports}.test.ts` | P2 | — | this worktree |
| P4 — rewire and delete | `sdd-engineering:implementer` | sonnet | W11, W12, W13 | `lib/engine/stamp.ts`, `lib/engine/{config,currentAirEvent}.ts`, `lib/rating/rating.ts`, `lib/toast/feed.ts`, `lib/stamp/stampCelebration.ts`, import-only consumers and tests (Affected surface), deleted modules, the two moved tests | P3 | — | this worktree; the scripted `sed` touches only the listed import strings |
| P5 — copies, divergent sites, lint, scope checks | `sdd-engineering:implementer` | **opus** — the ESLint duplicate-check rule and the flat-config merge are judgement work, where a mistake silently drops the existing seam lint | W14, W15, W16, W17 | AC-6/AC-7 sites, `lib/engine/offerEligibility.ts`, `eslint.config.mjs`, `packages/rules/eslint/*`, `tests/unit/lint/time-rules-lint.test.ts` | P4 | — | this worktree |
| P6 — proof | orchestrator (main session, heavy-run lock) | — | W18, W19, W20, W21 | none (build output, shots) | P5 | — | one heavy run at a time; `next build` writes `out-verify` (no clash with a dev server) |

P4 touches ~60 files, which exceeds the ~12-file guideline. Each edit there is an import line, and most are one scripted `sed`, so splitting the phase would only add a dispatch. Escalation from Sonnet to Opus follows `run-plan-auto` §3.

## Verification plan
| Command | Directory | Passing means |
|---|---|---|
| web `files`: `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}` | `.` | targeted per item, exit 0 |
| rules `files` (after W1): `npx tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs related --run --maxWorkers=2 --passWithNoTests {files}` | `packages/rules` | exit 0 |
| rules `full` (after W1): `npx tsc --noEmit -p . && node ../../node_modules/vitest/vitest.mjs run --maxWorkers=2` | `packages/rules` | exit 0, test files > 0 |
| `npx eslint .` | `.` | 0 errors (W16) |
| web `full` (config) | `.` | exit 0 apart from the known home JS budget (420 KB) red that also fails on master — orchestrator-run |
| contracts `full` (config) | `packages/contracts` | exit 0 — orchestrator-run |
| `pnpm install --frozen-lockfile` | clean checkout | exit 0 — orchestrator-run |
| `npx playwright test tests/e2e/us1-air.spec.ts tests/e2e/us8-time-machine.spec.ts tests/e2e/us3-room.spec.ts tests/e2e/us6-offers.spec.ts --project=phone --project=desktop --workers=2` | `.` | 8 green — orchestrator-run |
| skill `layout-fidelity` (sim build) | `.` | thresholds of W20 — orchestrator-run |

## Assumptions
Technical judgement calls only.
- `lib/engine/currentAirEvent.ts` stays in web. Stream-source choice (`pickSlotEvent`, `sourceStatus`) is not a time rule, and its `AirState` type is used by `lib/time/jumps.ts:7`, which must not change. Only `currentSlotIndex` and the handover moment move.
- `lib/engine/config.ts` stays with `NEXT_EVENT_JUMP` (time machine, Non-goal) and `TYPING_QUIET` (offer UI decision, Non-goal). It is not a "moved module". Its moved names are banned through `importNames`.
- Package names equal the master names wherever the function's signature is unchanged (tests stay import-only). New names are `isZonePast`, `handoverMoment`, `pinnedUntilAt`, `isRatingOpenFor`, `isRatingClosed`, `offerEarliestAt`, `isTooCloseToNextForOffer`, `isScheduleClosed`, `isStampTooOldToCelebrate`, `stampGrantedAt`, `stampAcceptUntil`, `isPresentByPulses`, `zonePassedHandover`, `defaultCountryZone`, `isInReminderWindow`, `SERVER_CLOCK_TOLERANCE_MS`. The spec leaves new names to the plan (`:207`).
- `ratingCloseAt` keeps its name and accepts `{ zones }`, so callers passing `Dataset` compile unchanged.
- Package tests resolve `@time2fest/rules/time` by a vitest alias, so the shared suite's import line is identical in web, package and (later) server.
- The rules package runs the root vitest binary by path (`../../node_modules/vitest/vitest.mjs`). `npx vitest` inside a package without its own `vitest` would not find the root binary.
- The duplicate-check ESLint plugin lives in `packages/rules/eslint/` rather than the root `eslint/` folder, which is outside the AC-38 list.

## Open questions
None.

## Research used
No researcher dispatched: the stack is already described by `docs/plans/SPEC-01-workspace-seam.plan.md`, and no external library behaviour is assumed beyond ESLint flat-config override semantics and `no-restricted-imports` `importNames`, both of which are pinned by the W16 test. In-repo evidence came from `grep` of import sites and `graphify affected` (14 symbols, 2026-11-17, this worktree).

## Rollback / blast radius
- Blast radius: every page that reads time rules (home, country, countries/map, room, TV, rating, support, schedule, passport, chat). Each item is behaviour-preserving, and the risk is a typo in a replaced expression. The table tests, the existing unit suites, e2e and layout-fidelity cover it.
- Rollback: the wave is a single branch. Drop the branch, or revert its merge commit. No data, migration or server state is involved.
- Merge with SPEC-02 (parallel): shared files are `package.json`, `pnpm-lock.yaml`, `eslint.config.mjs`, `.github/workflows/verify.yml`, `.claude/sdd-engineering.json` and `next.config.ts`. On conflict, take master's lockfile, re-run `pnpm install` and commit the result. Re-apply the one-line `dependencies` and `transpilePackages` additions and the rules verify step by hand.
