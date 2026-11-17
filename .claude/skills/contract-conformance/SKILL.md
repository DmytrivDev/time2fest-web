---
name: contract-conformance
description: Keeps the wire contract identical on both sides — shared zod schemas in packages/contracts, service interfaces in web/lib/api/contracts, server routes and Centrifugo channels — and proves http behaves like sim with one behaviour suite per domain run against both adapters. Use when a plan answers yes to "Wire contract", when web/lib/api/contracts, lib/api/http, packages/contracts or server routes change, and to decide whether a change is breaking.
argument-hint: "<domain…> | --all"
---

# contract-conformance — sim ↔ http ↔ server say the same thing

The main threat to "the site looks exactly like the boards" is not CSS but a different data shape or a different refusal code. This check is deterministic and runs before any board capture.

**Status: built by SPEC-02** (first domain: `time`). `packages/contracts` (`@time2fest/contracts`) holds the shared schemas; the suites live under `tests/contract/`.

## 1. Three layers, one source
- **Wire schemas** — `packages/contracts/src/schemas.ts` (import `@time2fest/contracts/schemas`): zod schemas for every HTTP request/response body and every Centrifugo event; DTO types are `z.infer<>` of them. Both `web` (`lib/api/http/<domain>.ts`) and `server` import them; the server validates input with the same schema; OpenAPI generation is not built yet.
- **Service interfaces** — `web/lib/api/contracts/<domain>.ts` stay plain TS interfaces (methods return `Promise<ApiResult<T>>`, `subscribe` returns an unsubscribe). Their DTO types are re-exported from the wire schemas, not redefined.
- **Routes and channels** — the single list is `docs/backend/frontend-seam.md` §3.11 (+ `content-freshness.md` §5.1 for `site` and `live` events). Every row has a server handler and an adapter method; nothing exists on one side only.

## 2. One behaviour suite per domain
- `tests/contract/<domain>.suite.ts` exports `describeDomain(makeService, ctx)`: given a service factory and a context (clock, fixtures, user), it asserts behaviour — results, `ApiError.code`/`reason`, event order, idempotency.
- Run (a) on **sim** as a unit test (`tests/unit/api/<domain>-contract.test.ts`, vitest, no network) — it pins what the boards show; (b) on **http** as an integration test against the local server of this worktree (`tests/contract/<domain>.http.test.ts`, serial, `--maxWorkers=1`, config `tests/contract/vitest.http.config.ts`), with fixtures and clock from the test doors.
- Existing `tests/unit/api/*-sim.test.ts` are the starting material; move assertions into the suite, keep sim-only internals in the sim test.

## 3. Completeness check (script not built yet: `pnpm contracts:check`; `node scripts/contract-surface.mjs --check` guards the exported surface; text descriptors are compared in canonical form: union members and object keys are order-insensitive, tuples and parameters are ordered)
- every §3.11 route/channel → handler in `server/` and method in `lib/api/http/`;
- every `ApiError` code/reason in a contract comment → produced by the server and handled by the UI;
- every schema used by a handler is the shared one (no local copy).
Output: table `method | route/channel | schema | sim suite | http suite → pass/fail`.

## 4. What counts as breaking
Breaking (needs a plan item, both sides in one commit, and a `frontend-seam.md` §3.11 update): removing or renaming a field, route, channel, event or error code; making an optional field required; changing a field's type, unit (ms vs s, cents vs dollars) or meaning; changing an enum's members; changing idempotency or ordering guarantees; changing an error from `{ok:false}` to a thrown exception or back.
Non-breaking: adding an optional field the client ignores; adding a new route or channel; adding an error reason the UI already maps to a generic message (state it in the report).
The production site is a static export: an already-open tab keeps the old client (decision 2026-11-14, 6.2 — no forced reload). So the server must accept the previous client version for one season: breaking changes after the first public deploy need a versioned route or a tolerant reader.

## 5. Run
```bash
npx vitest run tests/unit/api --maxWorkers=2     # sim suites
pnpm contracts:run                               # sim + http suites per domain (needs the server up)
pnpm contracts:run --sim-only                    # sim only (CI)
```
Red -> `sdd-engineering:implementer` fix mode with the failing rows. Report the table in the run report.
