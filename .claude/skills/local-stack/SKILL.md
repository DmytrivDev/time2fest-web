---
name: local-stack
description: Brings up the Time2Fest local backend stack in Docker (Postgres, Payload server, Centrifugo, Redis, Mailpit), creates this worktree's own databases, migrates, seeds and smoke-tests it, and serves the http integration build. Use before integration tests, contract http suites, layout-fidelity runs, or when the owner asks to start the backend locally.
argument-hint: "up | seed | smoke | down | status [--slot k]"
---

# local-stack — one command to a working local backend

Owner decision 2026-11-14: everything works locally first (Docker); the server comes later. Lesson from Genfasad: several worktrees hammering one Postgres made tests flaky — every worktree gets its own databases and integration tests run serially.

**Status: built by SPEC-02.** Commands below exist and were proven on this machine. Real-state notes: Next is 16.4.5 (site and server); Payload REST lives at `/cms-api` (the site API stays at `/api`); `pnpm stack` reaches "listening" in about 73 s on a cold start; compose sets `CENTRIFUGO_HEALTH_ENABLED`.

## 1. Commands (run from `web/` of the worktree)
| Command | What it does |
|---|---|
| `pnpm stack` | `up` + `db:create` + migrate + seed + `serve` (dev server on the slot port); prints `[stack] listening on ...` |
| `pnpm stack:up` / `stack:down` | `docker compose -p t2f up -d --wait postgres redis centrifugo mailpit` / `stop`. Never `down -v`, never removes volumes |
| `pnpm stack:smoke` | One-line result per check; exit != 0 on any failure |
| `pnpm db:create` | Creates `t2f_<slug>` and `t2f_<slug>_test` if missing and writes `server/.env.local`; never drops anything |
| `pnpm build:int` / `pnpm serve:int` | Integration web build (`NEXT_PUBLIC_ENV=test NEXT_PUBLIC_API_MODE=http NEXT_DIST_DIR=out-int`) and its static server on the slot web port, `/api/*` proxied to the slot server |
| `pnpm --dir server migrate` / `seed` / `serve` | Payload migrations; idempotent seed; `next dev` on the slot port |
| `pnpm --dir server start:prod` | `next build` + `next start` on the slot port (production build; needed for the NFR-8 latency test) |
| `pnpm --dir server test:int` | Integration tests, serial, **shared** lock. `pnpm test:int -- <name>` does **not** filter; to run one file: `cd server && node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>` |
| `pnpm --dir server test:stack` | Stack tests against a running `pnpm stack` (shared lock). `T2F_SERVER_MODE=start` also enables the production-only NFR-8 case |
| `pnpm --dir server test:int:exclusive` | Exclusive tests (`server/test/exclusive/**`), **exclusive** lock; heavy, orchestrator only |

## 2. Slots, ports, isolation
- Slot rule (AC-7): slot 0 = main checkout; a worktree gets the lowest free slot from `git worktree list`.
- Ports `4000+10*slot+offset` (AC-8): offset 0 server, 1 web (integration build), 2-5 fakes (AI, YouTube, PayPro, spare).
- Isolation per worktree: databases `t2f_<slug>` and `t2f_<slug>_test`; Redis DB = slot with key prefix `t2f:<slug>:` (shared Redis on host port **6380**, 64 DBs); Centrifugo channel prefix `<slug>_`; mail addresses `name+<slug>@example.com` (one Mailpit).
- Env: `T2F_ENV` (class: `test` | `production` ...) decides what may run; `T2F_TEST_DOORS=1` registers the `/api/_test/*` doors, only when `T2F_ENV` is not production. The test-door rows are `sameOriginExempt` (mutating calls skip the same-origin check).

## 3. Integration lock
Machine-wide, shared/exclusive with leases: shared holders run in parallel (`test:int`, `test:stack`), an exclusive holder runs alone. Files live in `.claude/sdd/locks/` of the **main checkout**; override with `T2F_LOCK_DIR`. Wait up to 30 min, lease 60 min; a stale holder is taken over and journaled. Tool: `node server/scripts/lock.mjs --mode shared|exclusive -- <command>`.

## 4. Procedure
1. Docker Desktop running (`docker info` succeeds), else stop and tell the orchestrator.
2. `pnpm stack` (background; wait for `listening`) then `pnpm stack:smoke`.
3. Report: `Stack ready: slot k, ports ..., DB t2f_<slug>, seed N records, smoke n/n` or the exact failing step and its last 20 lines.

## 5. Rules
- Compose service `r2` (`adobe/s3mock:5.2.3`, `127.0.0.1:9090`, bucket `t2f-catalog`, key prefix per worktree = the slug; ≈165–200 MiB idle of its 256 MiB cap) emulates Cloudflare R2 for the catalog copy; `pnpm stack:smoke` is 6/6 with it. `pnpm stack:up` starts it with the others.
- Timings on this machine: `POST /api/_test/reset` reseeds the catalog in ≈15 s, the catalog seed ≈6 s, `pnpm --dir server import catalog --apply` ≈25 s. Other commands: `pnpm --dir server import <domain> [--apply]`, `pnpm --dir server export catalog --from … [--write]`, `pnpm --dir server owner:create --email …`.
- The integration build (`pnpm build:int`) is MIXED: http for domains that have an adapter (now `catalog`), sim for the rest (test builds only); it prints `[api] integration build: http = …; sim = …`. It fetches `GET /api/catalog` at config time and fails closed (server down → exit 1 naming the URL). The client time machine (`window.__t2f.timeMachine`, `?t=`) works in it; syncing it with the server test clock is SPEC-07.
- e2e: Playwright path filters match the worktree path (`admin-catalog` also matches `spec-04-admin-catalog`; use `admin-catalog.e2e`). `access.e2e` and `origin-bypass.e2e` need `T2F_E2E_SERVER=http://127.0.0.1:<port>` (test doors answer only on loopback); admin UI specs need `T2F_E2E_SERVER=http://admin.localhost:<port>`. Admin writes need `Origin` = the admin origin and `content-type: application/json` (CSRF rule). Under load an integration file can hit the 10 s `beforeAll` boot timeout: re-run that single file.
- Never drop volumes, databases of other worktrees or the main checkout's database; never run `docker system prune`.
- Integration tests: serial (`--maxWorkers=1`); vitest unit tests `--maxWorkers=2`; Playwright `--workers=2`.
- Stop your own server process when the phase ends (RAM). Leave shared containers running for other worktrees.
- Production server `178.20.157.85` is never used for local work; read-only there unless the owner says otherwise.
