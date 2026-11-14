---
name: local-stack
description: Brings up the Time2Fest local backend stack in Docker (Postgres, Payload server, Centrifugo, Mailpit, S3/R2 emulator), creates this worktree's own databases, migrates, seeds and smoke-tests it, and serves the http integration build. Written as the contract SPEC-01 must fulfil; until then commands are TODO. Use before integration tests, contract http suites, layout-fidelity runs, or when the owner asks to start the backend locally.
argument-hint: "up | seed | smoke | down | status [--slot k]"
---

# local-stack — one command to a working local backend

Owner decision 2026-11-14: everything works locally first (Docker); the server comes later. Lesson from Genfasad: several worktrees hammering one Postgres made tests flaky — every worktree gets its own databases and integration tests run serially.

**Status: TODO-until-created.** Nothing below exists yet. SPEC-01 must create it with exactly these behaviours (names may change; then update this skill and `docs/backend/README.md` in the same commit).

## 1. What SPEC-01 must deliver
| Piece | Contract |
|---|---|
| `docker-compose.yml` (repo root `web/`, compose project `t2f`) | Services: `postgres` (one container, host port **5433** — a native PostgreSQL 17 is installed on this machine and may hold 5432), `centrifugo` (v6, admin off, API key from env), `mailpit` (SMTP 1025, UI/API 8025), `minio` or another S3 emulator for R2 (9000). Payload runs **outside** compose in dev (`pnpm --dir server dev`) so each worktree runs its own on its slot port. Memory limits per service (Postgres ≤1 GB, others ≤256 MB). |
| `.env.example` for `server/` | Every variable named, no values that work in production. Real values only in the main checkout's `server/.env.local` (gitignored). |
| `pnpm stack:up` / `stack:down` | `docker compose up -d --wait`; down never removes volumes (`-v` is forbidden in scripts). |
| `pnpm db:create -- --slot k` | Creates `t2f_<branch-slug>` and `t2f_<branch-slug>_test` if missing; prints the `DATABASE_URI`. Never drops anything. |
| `pnpm --dir server migrate` / `migrate:status` | Payload migrations on this worktree's database. |
| `pnpm --dir server seed` | Idempotent seed from `web/data` (skill `seed-and-fixtures`). |
| `pnpm stack:smoke` | Checks, each with a one-line result: `GET /api/time`; `GET /api/site/state`; `GET /api/realtime/token` for a guest; email OTP send → code read from Mailpit API → sign-in → `get-session`; test doors answer only with the test flag. Exit ≠ 0 on any failure. |
| Integration web build | `npx cross-env NEXT_PUBLIC_ENV=test NEXT_PUBLIC_API_MODE=http NEXT_DIST_DIR=out-int next build`, served on the slot's web port with `/api/*` proxied to the slot's server (same origin, like the Cloudflare Worker). |
| Test doors | Registered only with the test flag (`T2F_TEST_DOORS=1` and non-production env); the production build does not contain them; a prod-config test asserts 404. |
| Ports by slot k (0 = main checkout, 1..3 = worktrees) | server `4000+10k`, web integration `4001+10k`; Postgres/Centrifugo/Mailpit/S3 shared, isolated by database name / channel namespace `t2f<k>` / mailbox tag. |

## 2. Procedure (after SPEC-01)
1. Docker Desktop running (`docker info` succeeds), else stop and tell the orchestrator.
2. `pnpm stack:up` → `pnpm db:create -- --slot k` → `pnpm --dir server migrate` → `pnpm --dir server seed` → `pnpm --dir server dev -p <4000+10k>` (background) → `pnpm stack:smoke`.
3. Report: `Stack ready: slot k, ports …, DB t2f_<slug>, seed N records, smoke 5/5` — or the exact failing step and its last 20 lines.

## 3. Rules
- Never drop volumes, databases of other worktrees or the main checkout's database; never run `docker system prune`.
- Integration tests: `--maxWorkers=1` / serial; vitest unit tests `--maxWorkers=2`; Playwright `--workers=2`.
- Stop your own `server dev` process when the phase ends (RAM). Leave shared containers running for other worktrees.
- Production server `178.20.157.85` is never used for local work; read-only there unless the owner says otherwise.
