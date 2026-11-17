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
- No S3/R2 emulator in compose: the R2 emulator belongs to the first wave that writes to R2.
- Never drop volumes, databases of other worktrees or the main checkout's database; never run `docker system prune`.
- Integration tests: serial (`--maxWorkers=1`); vitest unit tests `--maxWorkers=2`; Playwright `--workers=2`.
- Stop your own server process when the phase ends (RAM). Leave shared containers running for other worktrees.
- Production server `178.20.157.85` is never used for local work; read-only there unless the owner says otherwise.
