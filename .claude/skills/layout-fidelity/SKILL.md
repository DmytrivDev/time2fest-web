---
name: layout-fidelity
description: Proves the site looks exactly like the reference boards after a backend wave — capture the affected boards from the http integration build (server test doors set the state) and pixel-compare them with the reference live shots; thresholds, triage by fidelity-triager, rule "fix data or adapter, never layout". Use when a wave switches a domain from sim to http or changes anything under web/ that renders, and before merging such a wave.
argument-hint: "<domain…> [--pages 02,04] [--only <slug substring>]"
---

# layout-fidelity — exact match with the existing layout

Owner rule (decision.md 2026-11-14): every component comes from the existing layout, so the difference must be minimal. Differences above the threshold that are **explained** are accepted by the orchestrator and listed for the owner. Reference = the live shots the boards were captured from: `BT/shots/<id>.live.png`, where `BT = D:/Work/Pets/Time2Fest/docs/bmad/planning-artifacts/ux-designs/ux-Time2Fest-2026-10-21/board-tools` (965 boards, 16 pages, manifests in `BT/manifests/`).

**Status: built by SPEC-02 and SPEC-04.** The test-door names are final (section 3). `/api/_test/last-code` is a 501 stub until SPEC-10. The board tools live in the repo, `scripts/boards/` (not in `BT/`): `http-seeds.mjs`, `compare-live.mjs`, `snapshot.mjs` (supports `--shots`) and `masks.json`; `playwright.http.config.ts` exists. The integration build is MIXED (http for `catalog`, sim for the rest), so only catalog-backed boards differ from a pure sim build.

## 1. Never
- Never fix a mismatch by changing layout: `components/**`, `*.module.css`, Tailwind classes, tokens, `messages/uk.json`, breakpoints. Fix the **fixture, seed, adapter mapping, server data or a mask**. If only a layout change would fix it → STOP: that is a site change that needs the owner, a `docs/site/<page>.md` update and a re-capture.
- Never write into `BT/shots/`, `BT/../reference-boards/project/` or a real batch report. Never raise `--tol` or the thresholds to make a run pass; dynamic regions get a mask in the manifest instead.
- Never read `reference-boards/**` HTML or whole shot folders; only the PNGs of flagged ids.

## 2. Which boards
1. Domain → hooks: `web/lib/api/hooks/<domain>.ts`. Consumers: `cd web; graphify affected "<hook name>" --depth 2` (e.g. `useStamps`, `usePresence`), cross-check with `docs/backend/frontend-seam.md` §2.10.
2. Components → pages: `docs/site/00-overview.md` §8.1 (code map) and §8.4 (page numbers). Starting hint: live → 02, 03, 04, 05, 11; chat → 14 (+02, 05); toasts → 09, 02; checkout → 12, 15, 09; auth → 13, 01, 10; profile → 10, 06, 14; passport → 07, 01, 02, 04, 05; rating → 08, 04, 11; notifications → 10, 01; site/catalog → all (sample: one state per page × 4 bps).
3. Pages → states: in `BT/manifests/batch-*.json` pick entries with `"page"` in that list **and** whose `seed`, `t2f`, `url` (`simFail`, `simDelay`) or `steps` touch the domain. Write the chosen ids into the report. Typical size: 50–300 boards per domain.

## 3. What the server provides (test environment only)
- Test doors, registered only when the test flag is on and absent from the production build (names are final, SPEC-02): `POST /api/_test/fixtures` (users, sessions, pass, stamps, orders, chat rooms, rating votes, notifications, site switches), `POST /api/_test/clock` (server time aligned with the time machine `?t=…&speed=0`; constitution II — one time source), `POST /api/_test/reset`.
- Sign-in codes: the last OTP from Mailpit (`GET http://localhost:8025/api/v1/messages`) or `GET /api/_test/last-code?email=` (501 stub until SPEC-10) — replaces `window.__t2f.lastCode()`.
- Seed translator `node scripts/boards/http-seeds.mjs`: manifest seed names (`guest`, `user`, `pass`, `authOther`, `nick`…) → fixture calls with the same values sim shows (skill `seed-and-fixtures`).
- `node scripts/boards/compare-live.mjs`: live-vs-live pixel compare (`--ref BT/shots --new <dir> --ids … --tol 24`), masks are rectangles in `scripts/boards/masks.json` (not in the manifests; painted out in both images), writes `<id>.fid.png` and a JSON report to the chosen dir.
- `playwright.http.config.ts` (repo root): runs the domain e2e against the integration build: `npx playwright test -c playwright.http.config.ts <spec> --workers=2`.

## 4. Capture and compare
1. Stack up and seeded (skill `local-stack`), this worktree's database.
2. Integration build of **this checkout**: `npx cross-env NEXT_PUBLIC_ENV=test NEXT_PUBLIC_API_MODE=http NEXT_DIST_DIR=out-fid next build`, serve `out-fid` on this worktree's web port, `/api/*` proxied to this worktree's server.
3. Manifest subset: write `<tmp>/_fid-<wave>-<batch>.json` (ids from step 2; the leading `_` keeps the report out of `build-canvas.mjs`).
4. `node scripts/boards/snapshot.mjs --manifest <tmp>/_fid-….json --base http://localhost:<web port> --web <this checkout> --shots <tmp>/shots --project <tmp>/project` — always both `--shots` and `--project` in a temp dir. The script still writes `BT/reports/_fid-….json`: delete it after the run.
5. `node scripts/boards/compare-live.mjs --ref BT/shots --new <tmp>/shots --ids <ids> --out <tmp>/fid`.
6. One capture run at a time on the machine (Chromium + Next + Docker on 16 GB).

## 5. Always
- Domain e2e (`tests/e2e/us*.spec.ts` of the touched pages) on the test build: `npx playwright test <files> --project=phone --project=desktop --workers=2`; also with the http config (`-c playwright.http.config.ts`).
- Contract suites: skill `contract-conformance`.

## 6. Thresholds and who decides
| Diff of a board | Verdict |
|---|---|
| ≤ 0.1 % | pass |
| 0.1–0.5 % | `fidelity-triager` (Sonnet) reads `<id>.fid.png` + both shots and classifies |
| > 0.5 %, or any "layout shift" | defect: fix in this wave (data/adapter/fixture/mask) |

Triage classes: `data` (fixture ≠ sim value) → fix fixture; `time` (clock, relative time) → fix clock/fixture; `dynamic` (viewers counter, animation frame) → add a rectangle to `scripts/boards/masks.json` (a repo file); `render` (font antialiasing, ≤1 px subpixel) → accept; `layout` (element moved, size changed, missing/extra element) → defect, never accepted by the orchestrator — owner decides; `state` (a loading/skeleton state that only http shows) → owner decides, design package.
Explained differences above 0.1 % that are not `layout` → the orchestrator accepts them and lists them for the owner (id, %, class, one-line reason).

## 7. Report
```markdown
## Layout fidelity — <wave/spec>, <domains>, <date>
Boards: N (pages …) · pass a · triaged b (accepted c) · defects d · not run e (why)
| id | % | class | verdict | note |
**For the owner (accepted explained differences):** …
**e2e:** <files>: pass/fail · **contract suites:** pass/fail
```
