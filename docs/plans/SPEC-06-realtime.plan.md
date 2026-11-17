# Implementation plan: Realtime — Centrifugo transport (SPEC-06)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-06-realtime.md` (Status: approved; checker 2026-11-18: 6 specs, 0 markers, 0 violations). AC-1 … AC-67, NFR-1 … NFR-7. The spec's Open questions 1–6 are non-blocking (`:632-641`); Open question 5 is settled by research (see Research used).
This plan implements those requirements; it does not define or change them.
**Execution mode** — multi-phase, sequential, with at most two lanes (S = server, W = web) whose file sets are disjoint. One `sdd-engineering:implementer` dispatch per phase. A W phase may run beside an S phase only when the machine has a free heavy slot (≤2 heavy agents machine-wide, `sdd-routing.md` §7; SPEC-13a runs in another worktree). Otherwise phases run in the listed order. Phase L is run by the wave lead (main session). Chosen by the owner and passed in the orchestrator's brief on 2026-11-18 (16 GB machine).
**Out of scope** — everything in the spec's Non-goals (`:33-41`):
- any domain (chat, stamps, live, notifications, orders, site state); no adapter switches to `http`; no board changes;
- FR-RT-07 and FR-RT-08;
- any change in the real Cloudflare account or on the remote node (`rt.*`, tunnel, `security_level`, closing the origin); `infra/cloudflare/**` and `workers/**` are untouched;
- Centrifugo PRO, subscription tokens, the `channels` claim, presence, `join_leave`, delta;
- per-subject connection limits and `connection_rate_limit` (П-RT);
- a server-sent `snapshot`;
- the real session and sign-in (SPEC-10).

No Payload collection, global or migration. Architecture and security review are performed by separate agents (`security-reviewer` is mandatory for this wave, `sdd-routing.md` §4).

Repository root for every path below = the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-06-realtime` (branch `spec-06-realtime`, base `33535e1`). `node_modules` is installed.
- **Slot 12** (`server/scripts/lib/worktree.mjs:66-88`): server port **4120**, web 4121, fakes 4122–4125, Redis DB 12.
- **Slug** `spec_06_realtime`, Centrifugo channel prefix `spec_06_realtime_`.
- **Do not commit, never push** (the wave lead commits). **No implementer writes outside this worktree.**
- Never read `.env*` contents, `pnpm-lock.yaml`, `out*`, `.next*`, or `node_modules` sources beyond `.d.ts` lookups. One exception: W37 reads the built `node_modules/centrifuge/dist/*.js` only to grep the signature string.

**Shared with SPEC-13a (runs in parallel; merge order decided by the orchestrator):**
- `server/src/registries/*.ts`, `server/src/platform/env*.ts`, `server/src/instrumentation.ts`;
- `docker-compose.yml`, `.github/workflows/verify.yml`, root and `server/package.json`, `pnpm-lock.yaml`;
- `packages/contracts/src/{index,schemas}.ts`, `.claude/sdd-engineering.json`.

**Rule for every item that touches one of these files:** add lines only. One entry per line, at its sorted position where the file is sorted. No reformatting, no reordering, no removing.

The exceptions are only those NFR-4 allows (`:330`), plus two single-line edits named in their items:
- inside the `centrifugo` service block of `docker-compose.yml`, edits are free, and the `CENTRIFUGO_HTTP_API_INSECURE` line is removed;
- the one-line `routeRegistry` array in W18;
- the `verify[web].full` string in W38.

`server/src/platform/env.ts` is **not** edited in this wave.

## Requirements traceability

Spec lines: AC block `:70-293`, NFR block `:321-340`. "int" = integration test. "excl" = exclusive-lock test. "L" = wave-lead phase.

| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | Registry holds exactly the C8 classes + `rttest` (test only) | `:70` | W4, W5 | W5 Done |
| AC-2 | Generated config for 3 classes + failing sync check | `:73` | W8, W9, W14 | W9, W14 Done |
| AC-3 | No client publish / history / presence permissions | `:76` | W7, W9 | W9 Done |
| AC-4 | No `rttest` outside `test` | `:79` | W7, W9 | W9 Done |
| AC-5 | `client.ping_interval` 25 s | `:82` | W7, W9 | W9 Done |
| AC-6 | `allowed_origins` per class | `:85` | W7, W9 | W9 Done |
| AC-7 | Anonymous connect without token; empty-`sub` tokens refused; anon subscribe only on public classes | `:88` | W7, W9 | W9 Done |
| AC-8 | Personal history ≤600 s, meta TTL ≤3 600 s | `:91` | W7, W9 | W9 Done |
| AC-9 | Centrifugo on stack Redis, own DB | `:94` | W12, W13, W27 | W27 Done (int) |
| AC-10 | Prefix after the namespace colon; empty in rehearsal/production | `:99` | W4, W5 | W5 Done |
| AC-11 | Bad `T2F_CENTRIFUGO_PREFIX` refuses start | `:102` | W6 | W6 Done |
| AC-12 | 200 with HS256 JWT, claims `sub`/`iat`/`exp` only | `:107` | W16, W17, W18, W22 | W19 (unit), W22 (int) Done |
| AC-13 | 200 `{token:null,expiresAt:null}` | `:110` | W18, W22 | W22 Done |
| AC-14 | `exp − iat` uniform in [2 700; 4 500] | `:113` | W16, W19 | W19 Done |
| AC-15 | `private, no-store`, no CORS headers | `:116` | W18, W22 | W22 Done |
| AC-16 | >30 / 60 s per daily IP fingerprint → 429 | `:119` | W18, W22 | W22 Done |
| AC-17 | Token and both keys never logged | `:122` | W18, W23, W24, W25, W27 | W27 Done (int) |
| AC-18 | Invalid subject id → 500 `unknown` | `:125` | W16, W19 | W19 Done |
| AC-19 | `test` without secret → 503 `realtime-not-configured` | `:128` | W18, W19, W22 | W22 Done |
| AC-20 | rehearsal/production refuse start without vars / with short keys | `:131` | W6 | W6 Done |
| AC-21 | Client `publish` → 103, nothing delivered | `:136` | W7, W28 | W28 Done |
| AC-22 | Anonymous → personal channel → 103 | `:139` | W28 | W28 Done |
| AC-23 | `sub` A → B's channel → 103 (also with prefix) | `:142` | W28 | W28 Done |
| AC-24 | Own personal channels: subscribed + delivered | `:145` | W28 | W28 Done |
| AC-25 | Anonymous → public classes: subscribed + delivered | `:148` | W28 | W28 Done |
| AC-26 | Unknown namespace → 102 | `:151` | W28 | W28 Done |
| AC-27 | Foreign `Origin` refused | `:154` | W28 | W28 Done |
| AC-28 | Foreign-key / expired token refused | `:157` | W28 | W28 Done |
| AC-29 | API without / with wrong key → 401; no INSECURE in compose | `:160` | W12, W14, W28 | W14 (static), W28 (int) Done |
| AC-30 | Unbatched class: subscriber receives exactly the envelope | `:165` | W24, W27 | W27 Done |
| AC-31 | Unknown class / bad envelope / >65 536 B → `validation`, 0 API calls | `:168` | W2, W24, W27 | W27 Done (unit) |
| AC-32 | Centrifugo down / 5xx → `unavailable` ≤2 s, no throw, warn | `:171` | W23, W24, W27 | W27 Done |
| AC-33 | Same `id` twice within 60 s → delivered once | `:174` | W24, W27 | W27 Done |
| AC-34 | Contracts: C3 envelope, C3 batch, C1 response schemas | `:177` | W2 | W2 Done |
| AC-35 | `invalidateSubject` → 3014 within 2 s, only S | `:180` | W25, W27 | W27 Done |
| AC-36 | Centrifugo down during invalidate → `unavailable` ≤2 s + warn | `:183` | W25, W27 | W27 Done |
| AC-37 | Batches: first event waits ≤300 ms, gaps ≥250 ms | `:188` | W30, W31 | W31 Done (int) |
| AC-38 | Order kept across batch boundaries | `:191` | W30, W31 | W31 Done (int) |
| AC-39 | >200 events or >64 KiB → split in the same flush, order kept | `:194` | W29, W31 | W31 Done (unit) |
| AC-40 | Failed batch dropped + warn, next batch on schedule | `:197` | W30, W31 | W31 Done (int + unit) |
| AC-41 | Network drop within history → all missed events, `recovered`, no `resync` | `:202` | W33, W39 | W39 Done |
| AC-42 | Recovery fails → exactly one `onResync`, no partial history | `:205` | W33, W39, W40, W46 | W39 (a), W46 (b, excl) |
| AC-43 | Centrifugo container restart → all events or one `onResync` | `:208` | W40, W46 | W46 (excl) |
| AC-44 | One Centrifugo subscription per channel; removed on last unsubscribe | `:213` | W33, W35 | W35 Done |
| AC-45 | Lazy `import('centrifuge')` and socket only on first `subscribe` | `:216` | W33, W35 | W35 Done |
| AC-46 | Batch unpacked, one `onEvent` per envelope, in order | `:219` | W2, W33, W35 | W35 Done |
| AC-47 | Connection state + state listeners | `:222` | W33, W35 | W35 Done |
| AC-48 | `token:null` → anonymous connect | `:225` | W33, W35, W39 | W35 (unit), W39 (int) Done |
| AC-49 | Refresh returns `null` after a subject → anon reconnect ≤5 s, public kept, `onForbidden` for personal | `:228` | W33, W39 | W39 Done |
| AC-50 | Token error / 5xx / 429 → retry after 5–10 s, state `connecting` | `:231` | W33, W35 | W35 Done |
| AC-51 | 103 → one `onForbidden`, no retry | `:234` | W33, W35 | W35 Done |
| AC-52 | No realtime URL → stays `disconnected`, no network | `:237` | W33, W34, W35 | W35 Done |
| AC-53 | Reconnect delay 0.5–20 s | `:240` | W33, W35 | W35 Done |
| AC-54 | Drop stale `version`; drop seen `id` within the last 1 000 | `:243` | W32, W35 | W35 Done (contract suite) |
| AC-55 | `HTTP_DOMAINS` stays `['catalog']` | `:248` | W36 | W36 Done |
| AC-56 | No `centrifuge` code in page build | `:251` | W37, W38, W45 | W45 Done |
| AC-57 | Door returns token and sets the current test subject | `:256` | W20, W22 | W22 Done |
| AC-58 | `POST /api/_test/reset` forgets the subject | `:259` | W20, W22 | W22 Done |
| AC-59 | Door 404 outside test + doors | `:262` | W20, W21, W22 | W21 (unit), W22 (int) Done |
| AC-60 | Stack generates shared gitignored secrets once, reuses them | `:267` | W10, W11, W14, W22 | W14 (unit) + W22 (AC-12 int: the `.env.local` secret is accepted by Centrifugo) |
| AC-61 | CI runs the realtime suite against env-only Centrifugo | `:270` | W13, W47 | W47 (manual: CI log) |
| AC-62 | Suite skips with a message naming Centrifugo when unreachable | `:273` | W22 | W22 Done |
| AC-63 | k6 scripts via `grafana/k6`, parameterised, two scenarios | `:278` | W41, W42, W43 | W43 Done |
| AC-64 | Reconnect-storm scenario and its report | `:281` | W41, W43 | W43 Done |
| AC-65 | k6 answers pings; JSON protocol v6 frames | `:284` | W41, W43 | W43 Done |
| AC-66 | Idle >5 min through `rt.*` tunnel | `:289` | — | **Not in this wave.** Owner of the check: П-RT after SPEC-13a (`:290`) |
| AC-67 | Direct origin access refused | `:292` | — | **Not in this wave.** Owner of the check: SPEC-13a (`:293`) |
| NFR-1 | 2 000 k6 connections, 10 min, p95 ≤1 s, memory caps | `:321` | W43, W46 | W46 (manual, exclusive lock, after the orchestrator's "yes") |
| NFR-2 | Lazy chunk ≤30 KB gzip | `:324` | — | **Not in this wave** (deferred by the spec, `:325`). Owner: the first wave that switches a domain onto the transport. AC-56 stands in here. |
| NFR-3 | `check-secrets` and `check-research-data` green; test keys marked | `:327` | every test item, W45 | W45 Done |
| NFR-4 | Line-level changes to env registry, compose, verify.yml | `:330` | W6, W12, W13 | W47 Done |
| NFR-5 | One warn line per refusal; no body, token or key | `:333` | W24, W25, W27, W30, W31 | W27, W31 Done |
| NFR-6 | Image `centrifugo/centrifugo:v6.10.3`; `centrifuge` exact 5.8.x | `:336` | W1, W36 | W36 Done |
| NFR-7 | 30 000 via Cloudflare, p95 ≤1 s | `:339` | — | **Not in this wave.** Owner: П-RT (29–30.11), finally SPEC-23 (`:340`) |

Map of the spec's "Done when" table (`:619-630`) to work items:
- "client publish refused" → W28;
- "personal channel only for its subject" → W28, W27, W39;
- "anonymous only on public channels" → W9, W22, W28;
- "after a drop: history, else snapshot" → W39, W46;
- "batches 250–500 ms" → W31;
- "token expiry spread" → W19;
- "smoke test 1–2 k" → W46;
- "k6 scripts" → W43.

## Spec follow-ups

These are addressed to `spec-creator`, the wave lead and the owner. The plan implements the spec as written.

1. **`live:streams` and `live:viewers` share namespace `live`, but C8 gives them different history** (10 / 300 s and 1 / 120 s, `:427-428`). Centrifugo history options are per namespace (research Q2: `namespace.go:82-180`), not per channel.
   - The registry keeps the C8 values per row (AC-1).
   - The generated namespace `live` takes the larger size and the larger TTL of its rows: 10 / 300 s.
   - SPEC-12 should either move `live:viewers` to its own namespace or accept 10 / 300 s.
   - The same merge applies to `toasts` and `rating` in `channel.without_namespace`. There the values are equal (`:438`).
2. **Open question 5 is answered.** `client.allowed_origins` uses glob matching, so `http://127.0.0.1:*` matches `http://127.0.0.1:4121`. A request without an `Origin` header is accepted. A rejected origin gets 403. Open question 5 can be closed. The `test` class uses `["http://127.0.0.1:*", "http://localhost:*"]`.
3. **AC-62 Verify says "locally the suite runs in `test:stack`" (`:274`).** This plan runs the realtime suite in `test:int` instead, under the shared lock, both locally and in CI.
   - Reason: the suite needs only Postgres, Redis and Centrifugo, with an in-process dispatcher (`server/test/integration/helpers.ts:18-23`).
   - It does not need a running `pnpm stack` server.
   - The spec leaves the choice to the plan (D14, `:529`).
4. **AC-60 says "a file that Centrifugo … reads" (`:267`).** Here Centrifugo does not read the file itself. The stack script reads the shared file and passes the values to `docker compose up` through `${…}` interpolation.
   - Reason: the local and CI configuration is env-only.
   - A bind-mounted file would differ in absolute path per worktree. Compose would then recreate the shared container on every worktree's `stack:up`.
5. **The seam's channel list lacks `site:state`.** `frontend-seam.md:106` lists the channels without it, while C8 has it. This is fixed in the docs patch (W48), not in the spec.

## Affected surface

Skills come from the routing table `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1. Abbreviations:
- **onion** = `engineering-paved-path:onion-architecture`
- **sec** = `engineering-paved-path:security`
- **cc** = `contract-conformance`
- **fua** = `engineering-paved-path:frontend-ui-architecture`

| File | New/Mod | Package | Home (ring / radius) | Skills | Constraint to respect |
|---|---|---|---|---|---|
| `package.json` | Mod | web | — | sec | Exact pin `"centrifuge": "5.8.0"` in `dependencies`; one added line |
| `server/package.json` | Mod | server | — | sec | `centrifuge` 5.8.0 in `devDependencies` (P1); script lines `realtime:config` (P3) and `k6` (P13), added lines only |
| `pnpm-lock.yaml` | Mod | — | generated | — (gap) | Only `pnpm install` in P1 writes it |
| `packages/contracts/src/realtime.ts` | New | contracts | ring 2 (wire types) | onion, cc | Types only, zod-free (it is re-exported from `index.ts`, which the site bundle imports; `schemas.ts:1`) |
| `packages/contracts/src/realtime.schemas.ts` | New | contracts | ring 2 | onion, cc | Zod schemas `satisfies z.ZodType<…>` of the `realtime.ts` types (pattern `catalog.ts` + `catalog.schemas.ts`) |
| `packages/contracts/src/schemas.ts` | Mod | contracts | ring 2 | onion, cc | One added line `export * from './realtime.schemas';` after `:64` |
| `packages/contracts/src/index.ts` | Mod | contracts | ring 2 | onion, cc | One added line `export * from './realtime';` |
| `packages/contracts/test/realtime.test.ts` | New | contracts | test | cc | — |
| `scripts/contract-surface.baseline.json` | Mod | web | generated | — (gap) | Only `node scripts/contract-surface.mjs --update` (additive, no `--breaking`) |
| `server/src/domain/realtime/channels.ts` | New | server | ring 1 | onion | Pure; no clock, no random, no I/O |
| `server/src/domain/realtime/config.ts` | New | server | ring 1 | onion | Pure parser of a raw env object; names only, never values (`platform/env.ts:1-5` pattern) |
| `server/src/domain/realtime/centrifugoConfig.ts` | New | server | ring 1 | onion | Pure generator; deterministic key order |
| `server/src/domain/realtime/token.ts` | New | server | ring 1 | onion | Times from parameters (clock value, random value), never `Date.now()` (`server/eslint.config.mjs:20-35`) |
| `server/src/domain/realtime/batch.ts` | New | server | ring 1 | onion | Pure split |
| `server/src/registries/channels.ts` | New | server | composition root | onion | Sorted rows, `assertRegistry` (`architecture.md` "new domain = a row in each registry") |
| `server/src/registries/env.ts` | Mod | server | composition root | onion | Append block `realtime` after `platform` (blocks are sorted by key, `:48-105`). The existing `T2F_CENTRIFUGO_URL`/`_PREFIX` lines (`:97-98`) stay untouched |
| `server/src/registries/routes.ts` | Mod | server | composition root | onion | One-line array edit, sorted by key |
| `server/src/registries/rateLimits.ts` | Mod | server | composition root | onion | One added row, sorted |
| `server/src/instrumentation.ts` | Mod | server | composition root | onion | Added lines after the access check (`:184-190` pattern) |
| `server/src/platform/env.check.ts` | Mod | server | ring 4 (CLI) | onion | Added lines after the access check |
| `server/src/realtime/ports.ts` | New | server | ring 2 | onion, sec, cc | Ports: `SubjectResolver`, `TokenSigner`, `RandomSource`, `CentrifugoApi`, `Scheduler`, `ChannelPublisher`, `SubjectInvalidator`. No vendor types |
| `server/src/realtime/token.ts` | New | server | ring 3 | onion, sec, cc | Use case over ports; fail closed |
| `server/src/realtime/publisher.ts` | New | server | ring 3 | onion, sec, cc | Never throws into domain code; one warn line per refusal |
| `server/src/realtime/batcher.ts` | New | server | ring 3 | onion, sec, cc | Per-channel serial flush; `Scheduler` and `Clock` injected |
| `server/src/realtime/invalidate.ts` | New | server | ring 3 | onion, sec, cc | — |
| `server/src/adapters/centrifugoApi.ts` | New | server | ring 4 | onion (+ sec — see Coverage gaps) | `fetch` with a 2 s `AbortSignal.timeout`; `X-API-Key`; never logs key or body |
| `server/src/adapters/centrifugoToken.ts` | New | server | ring 4 | onion (+ sec — gap) | `jose` 5.10.0 (`server/package.json`), `alg: 'HS256'` explicit |
| `server/src/adapters/noSessionSubjects.ts` | New | server | ring 4 | onion | Always `null` until SPEC-10 (C5, `:410`) |
| `server/src/endpoints/realtimeToken.ts` | New | server | ring 4 | onion, sec, cc | Not `public` (`types.ts:107`); `rateLimit: 'realtime-token'` |
| `server/src/endpoints/types.ts` | Mod | server | ring 4 | onion, sec, cc | Added optional `Deps` fields, like `catalogStore?` (`:62-73`) |
| `server/src/endpoints/deps.ts` | Mod | server | ring 4 | onion, sec, cc | Added getters, `built()` pattern (`:139-155`) |
| `server/src/container.ts` | Mod | server | composition root | onion, sec | Wiring only; the test resolver is reached only through the doors' dynamic `import()` (`:283`) |
| `server/src/test-doors/realtimeToken.ts` | New | server | ring 4 | onion, sec | Loaded only through `test-doors/index.ts` |
| `server/src/test-doors/registry.ts` | Mod | server | ring 4 | onion, sec | Row added at its sorted position; one added line in `resetDoor` |
| `server/src/test-doors/index.ts` | Mod | server | ring 4 | onion, sec | — |
| `server/src/cli/realtimeConfig.ts` | New | server | ring 4 (CLI) | onion, sec | Writes only `server/realtime/*.json` |
| `server/realtime/centrifugo.{test,rehearsal,production}.json` | New | server | generated | — (gap) | Written only by `pnpm --dir server realtime:config --write`. No secrets, no engine address |
| `server/scripts/lib/realtimeSecrets.mjs` | New | server | script | sec | Never prints values; file mode 0600 |
| `server/scripts/stack.mjs` | Mod | server | script | sec | Added lines in `up`/`down`/`smoke` |
| `server/scripts/db.mjs` | Mod | server | script | sec | Added lines in the `env` writer (`:66-91`) |
| `server/scripts/k6.mjs` | New | server | script | sec | Docker only; no host-network assumptions |
| `server/load/realtime/**` (k6 JS) | New | server | load scripts | — (gap) | Runs inside `grafana/k6:2.4.0` |
| `server/.env.example` | Mod | server | — | sec | Two added lines (names only) |
| `docker-compose.yml` | Mod | web | — | sec | NFR-4: edits only inside the `centrifugo` block (`:44-63`) |
| `.github/workflows/verify.yml` | Mod | web | — | sec | NFR-4: added lines only |
| `.claude/sdd-engineering.json` | Mod | — | config | — (gap) | One string edit in `verify[web].full` (W38) |
| `lib/api/http/realtime/types.ts` | New | web | `lib/api/http` layer | fua, sec, cc | C7 types; `import type` from `@time2fest/contracts` only |
| `lib/api/http/realtime/dedupe.ts` | New | web | `lib/api/http` | fua, sec, cc | Pure |
| `lib/api/http/realtime/transport.ts` | New | web | `lib/api/http` | fua, sec, cc | Relative imports only (no `@/`); typechecks under `server/tsconfig.json` too (W39 imports it); no `window`/DOM-only types |
| `lib/api/http/realtime/index.ts` | New | web | `lib/api/http` | fua, sec, cc | Narrow barrel (fua §2); reads `process.env.NEXT_PUBLIC_REALTIME_URL` |
| `tests/unit/api/realtime-transport.test.ts` | New | web | test | — (gap) | — |
| `tests/unit/api/realtime-contract.test.ts` | New | web | test | cc | — |
| `tests/unit/api/realtime-boundary.test.ts` | New | web | test | — (gap) | — |
| `scripts/check-bundle.mjs` | New | web | script | — (gap) | Read-only scan |
| `tests/unit/lint/check-bundle.test.ts` | New | web | test | — (gap) | — |
| `server/test/unit/realtime-*.test.ts`, `server/test/unit/k6-runner.test.ts` | New | server | test | — (gap) | `// check-secrets: allow test fake` on every literal key |
| `server/test/unit/{platform,edge,env-access-catalog,doors-gating}.test.ts` | Mod | server | test | — (gap) | Fixture lines added only |
| `server/test/e2e/doors-404.e2e.ts` | Mod | server | test | — (gap) | One row added to the door list (`:14-18`) |
| `server/test/integration/realtime-*.int.test.ts`, `realtime-support.ts`, `realtime-proxy.ts` | New | server | test | — (gap) | Serial; skip guard (AC-62) |
| `server/test/exclusive/realtime-recovery.exclusive.test.ts` | New | server | test | — (gap) | Exclusive lock only |
| `docs/specs/README.md` | Mod | — | docs | — (gap) | Row 13 status |

**Coverage gaps:**
- **Unrouted by the table** (`sdd-routing.md:21`): `server/test/**`, tests under `tests/unit/**/*.test.ts` other than `*-contract.test.ts`, `server/load/**`, `server/realtime/*.json`, `scripts/check-bundle.mjs`, `scripts/contract-surface.baseline.json`, `.claude/sdd-engineering.json`, `pnpm-lock.yaml`, `docs/**`.
- **Two security-sensitive adapters are unrouted by sec:** `server/src/adapters/centrifugoApi.ts` and `server/src/adapters/centrifugoToken.ts`. The sec row lists adapters by name (`sdd-routing.md:13`: `{accessJwt,testSigner,identityMarker,s3}`).
  - This plan assigns `engineering-paved-path:security` to both.
  - The orchestrator should add them to the sec row (the same step SPEC-04 took for `accessJwt`).

## Contract changes

- **Shared contracts / schemas:** yes. New `packages/contracts/src/realtime.ts` (types) and `realtime.schemas.ts` (zod):
  - C1 token value and response;
  - C2 door body;
  - C3 envelope and batch;
  - reason `realtime-not-configured`.

  Both are exported additively (index + schemas). The server validates with these schemas (publisher, door body). `web` uses the types only (`import type`), so the site bundle stays zod-free. The contract-surface baseline is updated additively (W3). No change to `lib/api/contracts/**`.
- **Migration:** no. The spec adds no collection, global or field. The registry is code. Nothing under `server/src/{collections,globals,migrations}/**` is touched.
- **Seed / fixture data:** no.
  - No collection and no `web/data` source change.
  - The test subject is process state of the door (C2), not seed.
  - `rttest:*` exists only in the generated `test` config.
- **Build-only failures:** yes, two of them.
  1. `centrifuge` must not enter any page bundle while no adapter imports the transport (AC-56).
     - Typecheck and unit tests cannot see a static import that slipped in.
     - Caught by `node scripts/check-bundle.mjs out-verify` after `npx cross-env NEXT_DIST_DIR=out-verify next build` in `.`. Wired into `verify[web].full` and as a CI step (W38). Run in W45.
  2. `server/src/realtime/**` and `adapters/centrifugo*.ts` are pulled into the server `next build` through `container.ts`.
     - Caught by the wave lead's `pnpm --dir server build` in W45. A `node:` import in a file the edge runtime reads would fail only there. `instrumentation.ts` already guards on `NEXT_RUNTIME === 'nodejs'` (`:178`).
- **Wire contract:** yes.
  - New route `GET /api/realtime/token` (C1; the seam row `frontend-seam.md:241` exists as proposed).
  - New door `POST /api/_test/realtime-token` (C2).
  - Channel registry C8 (class names = seam §2.6 plus `site:state`; prefix only in `test`).
  - Event envelope and batch C3.
  - Error reason `realtime-not-configured`.

  All additive (cc §4: a new route or channel is non-breaking).
  - **cc check:** there is no domain service, so there is no sim ↔ http behaviour suite to run. The transport's own contract suite is `tests/unit/api/realtime-contract.test.ts` (AC-54, AC-46), run in `npx vitest run tests/unit/api --maxWorkers=2`.
  - `pnpm contracts:run --sim-only` must stay green (catalog unchanged).
  - The §3.11 row update and the §2.6 channel list go into the docs patch (W48).
- **Layout fidelity:** no. Justification:
  - (a) `HTTP_DOMAINS` stays `['catalog']`, proven by W36 (AC-55).
  - (b) No file under `app/**`, `components/**`, `lib/api/hooks/**`, `stores/**`, `messages/**` or `next.config.ts` changes. The only `web` source added is `lib/api/http/realtime/**`, and no adapter or page imports it.
  - (c) W45 proves from the build output that `centrifuge` is in no page file (AC-56).
  - If (c) fails, the answer flips to yes and the wave stops before the merge.
- **Payload migration:** no (see Migration).
- **Test doors:** yes. New door `POST /api/_test/realtime-token`; `POST /api/_test/reset` extended to forget the test subject.
  - Registered only through `doorRoutes` (dynamic `import()` behind `shouldLoadDoors`, `container.ts:64-67,283`).
  - Unit gating: `server/test/unit/doors-gating.test.ts` (W21).
  - Production-build 404 list: `server/test/e2e/doors-404.e2e.ts` (W21; run by the wave lead in W45).
  - Integration 404 in a non-test class (W22, AC-59).
- **Agent write surface:** no. No role, Access service key or agent endpoint changes. The Centrifugo API key is a server-to-Centrifugo secret, not an agent credential. `security-reviewer` still runs, per `sdd-routing.md` §4.
- **Seed and fixtures:** no (see above).

## Work items

Conventions for every item:
- **Verify (server)** = `cd server && npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}`.
- **Verify (web)** = the web `files` command in `.`.
- **Verify (contracts)** = the contracts `files` command in `packages/contracts`.
- **One integration file**: `cd server && node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>`. Note that `pnpm test:int -- <name>` does **not** filter.
- Integration items need Docker Postgres, Redis and Centrifugo up with this worktree's DBs created; the gate W44 prepares this.
- Every literal key, secret or password in a test carries `// check-secrets: allow test fake` on its line (NFR-3).
- A skipped realtime suite is reported as **not run**, never as passed.

### W1 — Add `centrifuge` 5.8.0 to web and to server dev (P1)
- **Serves:** NFR-6; enables AC-41 … AC-54 (web transport) and the Node clients of the integration tests (AC-12, AC-21 … AC-43).
- **Do:**
  - root `package.json` `dependencies`: `"centrifuge": "5.8.0"`;
  - `server/package.json` `devDependencies`: `"centrifuge": "5.8.0"`;
  - run `pnpm install` once (the only lockfile write of the wave).
  - No other dependency. The server needs none: `jose` 5.10.0 signs HS256, Node 22 `fetch`/`WebSocket` are global, `ioredis` exists.
- **Files:** `package.json`, `server/package.json`, `pnpm-lock.yaml`.
- **Done means:** `pnpm install --frozen-lockfile` exits 0. Both manifests carry exactly `5.8.0` (no caret). `node -e "import('centrifuge').then(m=>console.log(typeof m.Centrifuge))"` prints `function` in `.` and in `server`.
- **Verify:** the commands in Done means.
- **Rules that apply:** sec → A03 (pin exact versions of security-relevant packages).
- **Risk:** lockfile conflict with SPEC-13a. The wave lead resolves it by re-running `pnpm install` at merge, never by hand.

### W2 — Realtime wire types and schemas (P1)
- **Serves:** AC-34; enables AC-31, AC-46, AC-54, AC-12, AC-13, AC-19, AC-57.
- **Do:**
  - `realtime.ts`: types `RealtimeEnvelope` `{type: string; id: string; version?: number; data?: unknown}`, `RealtimeBatch` `{type:'batch'; id: string; events: RealtimeEnvelope[]}`, `RealtimeTokenValue` `{token: string|null; expiresAt: string|null}`, `RealtimeSubjectKind = 'guest'|'account'`, `REALTIME_REASONS = ['realtime-not-configured'] as const`, `REALTIME_MAX_PUBLICATION_BYTES = 65_536`, `REALTIME_MAX_BATCH_EVENTS = 200`.
  - `realtime.schemas.ts`:
    - `RealtimeEnvelopeSchema`: `type` min 1, `id` 1–64, `version` int ≥0 optional, `data` unknown optional, strict;
    - `RealtimeBatchSchema`: literal `batch`, events 1–200;
    - `RealtimeTokenValueSchema`: both null together or both strings (ISO), via refine;
    - `RealtimeTokenResponseSchema = apiResultSchema(RealtimeTokenValueSchema)`;
    - `TestRealtimeTokenBodySchema` (C2): `{subject:{kind, id: /^[A-Za-z0-9_-]{1,64}$/}, ttlSeconds?: int 1–4500}`, strict.

    Each with `satisfies z.ZodType<…>`.
  - Add one export line in `schemas.ts` and one in `index.ts`.
- **Files:** `packages/contracts/src/{realtime.ts,realtime.schemas.ts,schemas.ts,index.ts}`, `packages/contracts/test/realtime.test.ts`.
- **Done means:** the test passes and shows:
  - C1 and C3 examples from the spec (`:386`, `:398-399`) parse;
  - an envelope without `id`, `version: -1`, a batch without `events` and a batch of 201 events are rejected;
  - `{token:'x', expiresAt:null}` is rejected;
  - `index.ts` exports nothing from `zod` (assert: `realtime.ts` has no `zod` import).
- **Verify (contracts)** on the five files.
- **Rules that apply:** cc §1 (one schema, used by both sides); onion ring 2 (types speak the conversation, no vendor types).
- **Risk:** low.

### W3 — Contract-surface baseline (P1)
- **Serves:** enables AC-34 (keeps the additive-surface guard green).
- **Do:** run `node scripts/contract-surface.mjs --update` (additive mode, no `--breaking`) after W2.
- **Files:** `scripts/contract-surface.baseline.json`.
- **Done means:** `node scripts/contract-surface.mjs --check` exits 0. The baseline diff only adds entries.
- **Verify:** that command in `.`.
- **Rules that apply:** cc §4 (additive only).
- **Risk:** a non-additive diff means W2 changed an existing export. Stop and report.

### W4 — Channel model and name builder (P2)
- **Serves:** AC-10, AC-18 (id rule); enables AC-1, AC-23.
- **Do:** In `server/src/domain/realtime/channels.ts` (ring 1), define:
  - `ChannelClassRow`: `key` (`'site:state'`, `'chat:country'`, `'user'`, `'rttest'`…), `namespace: string | null`, `shape: 'fixed' | 'keyed' | 'personal'`, `visibility: 'public' | 'personal'`, `history: {size, ttlSeconds}`, `batched: boolean`, `testOnly?: true`.
  - `channelName(row, key | undefined, prefix)` per AC-10:
    - `site:state` → `site:<p>state`;
    - `chat:country` + `UA` → `chat:<p>country.UA`;
    - `notif` + `42` → `notif:<p>user#42`;
    - `user` + `42` → `user:<p>#42`;
    - `toasts` → `<p>toasts`;
    - `rttest` + `batch` → `rttest:<p>batch`.
  - `SUBJECT_ID = /^[A-Za-z0-9_-]{1,64}$/`, `CHANNEL_PREFIX = /^[a-z0-9_]{1,40}_$/`.
  - Key validation: ISO `^[A-Z]{2}$`, `rttest` name `^[a-z0-9_]{1,40}$`, subject id = `SUBJECT_ID`. A bad key returns `undefined`, not a throw.
- **Files:** `server/src/domain/realtime/channels.ts`.
- **Done means:** covered by W5's test (names for every class with prefix `abc_` and with `''`).
- **Verify (server)** with W5's files.
- **Rules that apply:** onion §1 (pure rule → ring 1, test without Docker).
- **Risk:** a prefix placed before the namespace breaks namespaces (DR-2). The test pins it.

### W5 — Channel registry (P2)
- **Serves:** AC-1, AC-10.
- **Do:**
  - In `server/src/registries/channels.ts`, put the 11 C8 rows sorted by key, with values exactly as C8 (`:426-436`). `assertRegistry('channels', …)`.
  - `channelClassesFor(cls)` drops `testOnly` rows outside `test`.
  - `REALTIME_SITE_ORIGINS`: `rehearsal: 'https://rehearsal.time2fest.com'`, `production: 'https://time2fest.com'` (cite `workers/edge/wrangler.json:37,63`).
  - Test `server/test/unit/realtime-registry.test.ts`:
    - lists the rows against a literal C8 table (AC-1);
    - checks `rttest` exists only for `test`;
    - checks every name of AC-10 for prefix `abc_` and `''`;
    - checks that a key with `:`, `#`, `,` is refused.
- **Files:** `server/src/registries/channels.ts`, `server/test/unit/realtime-registry.test.ts`.
- **Done means:** the test passes and covers all 11 rows. The expected AC-10 names `chat:abc_world`, `user:abc_#42`, `notif:abc_user#42`, `abc_toasts` appear verbatim.
- **Verify (server)** on W4 + W5 files.
- **Rules that apply:** onion §4 (registries are the composition root); `architecture.md` "new domain = a row in each registry, sorted".
- **Risk:** low.

### W6 — Realtime env: secrets block and config parser (P2)
- **Serves:** AC-11, AC-20; NFR-4 (env registry part).
- **Do:**
  1. **`server/src/registries/env.ts`:** append a new block `{ key: 'realtime', vars: [T2F_CENTRIFUGO_API_KEY, T2F_CENTRIFUGO_TOKEN_SECRET] }` after the `platform` block. Each var: `z.string().min(32).optional()`, `secret: true`, `requiredIn: REQ`. Added lines only. The existing `:97-98` lines stay as they are.
  2. **`server/src/domain/realtime/config.ts`:** `parseRealtimeConfig(raw, cls)` returns `{ok:true, config:{url?, apiKey?, tokenSecret?, prefix}}` or `{ok:false, failing: string[]}`, by these rules:
     - `T2F_CENTRIFUGO_PREFIX` non-empty and not matching `CHANNEL_PREFIX` → failing (any class);
     - outside `test`, `prefix` resolves to `''`;
     - in `rehearsal` and `production`, `T2F_CENTRIFUGO_URL` missing → failing;
     - the secrets' length rule stays in the registry.

     This is the `parseAccessConfig` precedent (`instrumentation.ts:184-190`): a class-dependent rule outside the shared `platform` block, so NFR-4 holds.
  3. **Callers:** call it in `server/src/instrumentation.ts` (exit 1 with `env: invalid <names>`) and in `server/src/platform/env.check.ts`, as added lines after the access check.
  4. **Tests:** `server/test/unit/realtime-env.test.ts`:
     - AC-11: `a:b_`, `a#b_`, `ABC_` fail naming `T2F_CENTRIFUGO_PREFIX`; `abc_` passes;
     - AC-20: rehearsal/production without each var, and with a 31-char key, fail naming exactly that variable;
     - both secrets are `secret: true`;
     - `test` without them passes.
  5. **Existing tests:** run `npx vitest run test/unit/platform.test.ts test/unit/edge.test.ts test/unit/env-access-catalog.test.ts` first. Where a rehearsal/production fixture now fails on the two new required vars, add the two vars to that fixture (one added line each, value marked `// check-secrets: allow test fake`). Do not change any expected failing list otherwise.
- **Files:** `server/src/registries/env.ts`, `server/src/domain/realtime/config.ts`, `server/src/instrumentation.ts`, `server/src/platform/env.check.ts`, `server/test/unit/realtime-env.test.ts`, `server/test/unit/{platform,edge,env-access-catalog}.test.ts` (fixtures only, if red).
- **Done means:**
  - the new test passes;
  - the three existing files pass;
  - `git diff -U0 server/src/registries/env.ts` shows only `+` lines;
  - `node -e` is not needed: `pnpm --dir server env:check` with `T2F_CENTRIFUGO_PREFIX=ABC_` in the shell env prints `env: invalid T2F_CENTRIFUGO_PREFIX` and exits 1.
- **Verify (server)** on the listed files.
- **Rules that apply:**
  - sec A04 (secrets ≥256 bit);
  - sec A09 (names, never values);
  - onion ring 1 for the parser (`platform/env.ts:1-5`: pure, never reads `process.env`).
- **Risk:** existing fixture tests. Only added fixture lines are allowed.

### W7 — Centrifugo config generator (P3)
- **Serves:** AC-3 … AC-8, AC-21 (static half); enables AC-2, AC-9.
- **Do:** In `server/src/domain/realtime/centrifugoConfig.ts`, write a pure `centrifugoConfig(rows, cls, origins)` returning a plain object in Centrifugo v6 JSON keys (research Q2):
  - **Client:** `client.ping_interval: "25s"`; `client.allow_anonymous_connect_without_token: true`; `client.disallow_anonymous_connection_tokens: true`; `client.allowed_origins`:
    - `test` → `["http://127.0.0.1:*", "http://localhost:*"]`;
    - rehearsal/production → `[REALTIME_SITE_ORIGINS[cls]]`.
  - **`health.enabled: true`.**
  - **Namespaces:** one per distinct `namespace` of `channelClassesFor(cls)`, sorted by name. Rows without a namespace go to `channel.without_namespace`. Within one namespace the history is the max size and max TTL of its rows (Spec follow-up 1).
  - **Public:** `allow_subscribe_for_anonymous: true`, `allow_subscribe_for_client: true`.
  - **Personal:** `allow_user_limited_channels: true`, `history_meta_ttl: "3600s"`, no anonymous subscribe. Whether `allow_subscribe_for_client` is also needed for `#` channels is settled empirically by W28 (AC-24 must pass, AC-22/23 must refuse). Record the result in a comment.
  - **History everywhere:** `history_size`, `history_ttl: "<n>s"`, `force_recovery: true`.
  - **Never emitted:** `allow_publish_for_*`, `allow_history_for_*`, `allow_presence_for_*`, any secret, any engine address.
  - **`centrifugoEnv(config)`:** the env rendering: `CENTRIFUGO_` + upper-cased key, dots → `_`; arrays of strings space-separated; `CENTRIFUGO_CHANNEL_NAMESPACES` as one JSON string; `channel.without_namespace.*` as `CENTRIFUGO_CHANNEL_WITHOUT_NAMESPACE_*`. Deterministic order.
- **Files:** `server/src/domain/realtime/centrifugoConfig.ts`.
- **Done means:** covered by W9.
- **Verify (server)** with W9's files.
- **Rules that apply:** onion §1; sec A01 (deny by default: personal channels only through `#`), A02 (explicit origin allowlist).
- **Risk:** a wrong v6 key name is silently ignored by Centrifugo. W28 is the real proof, so W7's keys must be exactly those in research Q2.

### W8 — `realtime:config` CLI and generated files (P3)
- **Serves:** AC-2.
- **Do:**
  - `server/src/cli/realtimeConfig.ts` (run with `tsx`), with modes:
    - `--write` writes `server/realtime/centrifugo.{test,rehearsal,production}.json` (2-space JSON, stable key order, trailing `\n`);
    - `--check` regenerates in memory and exits 1 naming the file and the first differing JSON path when a stored file differs, 0 otherwise;
    - `--print-env test` prints `centrifugoEnv` of `test`;
    - `--dir <path>` overrides the folder (for tests).
  - Add one script line to `server/package.json`: `"realtime:config": "tsx src/cli/realtimeConfig.ts"`.
  - Run `--write` once.
- **Files:** `server/src/cli/realtimeConfig.ts`, `server/realtime/centrifugo.{test,rehearsal,production}.json`, `server/package.json`.
- **Done means:** `pnpm --dir server realtime:config --check` exits 0 on the clean tree.
- **Verify (server)** on the CLI file, plus the command above.
- **Rules that apply:** sec (CLI writes only inside `server/realtime/`).
- **Risk:** low.

### W9 — Config tests (P3)
- **Serves:** AC-2 … AC-8.
- **Do:** Write `server/test/unit/realtime-config.test.ts`. It parses the three generated files and checks:
  - AC-3: no forbidden permission key anywhere (recursive key scan);
  - AC-4: no `rttest` namespace in rehearsal/production;
  - AC-5: `client.ping_interval === "25s"` in all three;
  - AC-6: `allowed_origins` exact per class;
  - AC-7: the two anonymous flags; `allow_subscribe_for_anonymous` only in public namespaces and `without_namespace`;
  - AC-8: personal `history_ttl` ≤600 s, `history_meta_ttl` ≤3 600 s;
  - AC-2: the CLI `--check` on a temp copy (`os.tmpdir()`) is 0, then 1 after changing one field of the copy.
- **Files:** `server/test/unit/realtime-config.test.ts`.
- **Done means:** the test passes with one `it` per AC-2 … AC-8, each naming its AC.
- **Verify (server)** on W7–W9 files.
- **Rules that apply:** —.
- **Risk:** low.

### W10 — Shared realtime secrets file (P4)
- **Serves:** AC-60.
- **Do:** In `server/scripts/lib/realtimeSecrets.mjs`, write `realtimeSecretsFile(cwd, env)`:
  - the path is `path.join(path.dirname(resolveLockDir(cwd, env)), 'realtime', 'centrifugo.env')`, i.e. `<main checkout>/.claude/sdd/realtime/centrifugo.env`, shared by all worktrees and gitignored by `.claude/sdd/` (`.gitignore:22`);
  - the lock-dir resolution is `server/scripts/lib/lock.mjs:43-51`.

  Then `ensureRealtimeSecrets(file)`:
  - creates the folder and file (mode 0o600) with `T2F_CENTRIFUGO_TOKEN_SECRET` and `T2F_CENTRIFUGO_API_KEY`, each `crypto.randomBytes(32).toString('hex')` (64 chars), different from each other, when absent;
  - otherwise returns the existing values;
  - never prints them.
- **Files:** `server/scripts/lib/realtimeSecrets.mjs`.
- **Done means:** covered by W14.
- **Verify (server)** with W14's files.
- **Rules that apply:** sec A04 (CSPRNG, ≥256 bit), A09 (never logged).
- **Risk:** low.

### W11 — Stack and env wiring (P4)
- **Serves:** AC-60, AC-9; enables AC-12, AC-19 (env present locally).
- **Do:**
  - **`server/scripts/stack.mjs`:**
    - `up()` and `down()` call `ensureRealtimeSecrets` and pass both values in the `env` of the `docker compose` child (`{...process.env, T2F_CENTRIFUGO_TOKEN_SECRET, T2F_CENTRIFUGO_API_KEY}`);
    - `smoke()` gains one check `centrifugo api key`: `POST http://127.0.0.1:8000/api/info` with `X-API-Key` → 200.
  - **`server/scripts/db.mjs` `env`:** add lines `T2F_CENTRIFUGO_URL=http://127.0.0.1:8000`, `T2F_CENTRIFUGO_TOKEN_SECRET=…`, `T2F_CENTRIFUGO_API_KEY=…`. The values come from `process.env` when set (CI), else from `ensureRealtimeSecrets`.
  - **`server/.env.example`:** two added name-only lines.
- **Files:** `server/scripts/stack.mjs`, `server/scripts/db.mjs`, `server/.env.example`.
- **Done means:**
  - `node server/scripts/db.mjs env` run twice leaves the same three values in `server/.env.local`;
  - the implementer checks this by comparing hashes (`node -e` printing a sha256 of the lines, never the values).
- **Verify (server)** on the three files.
- **Rules that apply:** sec (`.env.local` stays gitignored, `.gitignore:4`).
- **Risk:** the stack-script edits must stay additive (shared with SPEC-13a only through `stack.mjs` if it touches it; added lines only).

### W12 — Compose: env-only Centrifugo on Redis (P4)
- **Serves:** AC-9, AC-29 (no INSECURE), NFR-4 (compose part); enables AC-21 … AC-43 locally.
- **Do:** Inside the `centrifugo` block only (`docker-compose.yml:44-63`):
  - remove `CENTRIFUGO_HTTP_API_INSECURE: 'true'`;
  - add `depends_on: { redis: { condition: service_healthy } }`;
  - add the `test` env lines printed by `pnpm --dir server realtime:config --print-env test`, each value single-quoted;
  - add `CENTRIFUGO_ENGINE_TYPE: 'redis'`;
  - add `CENTRIFUGO_ENGINE_REDIS_ADDRESS: 'redis://redis:6379/63'`. DB 63 is never a worktree slot: `T2F_SLOT` ≤47, `registries/env.ts:88`.
  - add `CENTRIFUGO_ENGINE_REDIS_PREFIX: 't2f_centrifugo'` (pub/sub is shared across DBs, research Q2);
  - add `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY: '${T2F_CENTRIFUGO_TOKEN_SECRET:-}'` and `CENTRIFUGO_HTTP_API_KEY: '${T2F_CENTRIFUGO_API_KEY:-}'`. These are `:-` defaults, so `stop`/`start` from other tools still parse; an empty key gives 401 for everything (research Q4).
  - Keep `CENTRIFUGO_ADMIN_ENABLED`, `CENTRIFUGO_HEALTH_ENABLED`, image tag, ports, limits.
- **Files:** `docker-compose.yml`.
- **Done means:**
  - `git diff -U0 docker-compose.yml` touches only lines 44–63 plus added lines inside that block;
  - `docker compose -p t2f -f docker-compose.yml config --quiet` exits 0.
- **Verify:** that command in `.`; the env-sync part by W14.
- **Rules that apply:** sec A02 (no insecure API), A04.
- **Risk:** applying it recreates the shared `centrifugo` container. That is the gate W44, run by the wave lead, not the implementer. **Implementers do not run `pnpm stack:up` in P4.**

### W13 — CI: Centrifugo service (P4)
- **Serves:** AC-61, AC-9 (CI), NFR-4 (workflow part).
- **Do:** Make these additions in `.github/workflows/verify.yml`, added lines only:
  1. **Service `centrifugo`:** image `centrifugo/centrifugo:v6.10.3` (default CMD starts the server, research Q3); `ports: ['8000:8000']`; `options: --health-cmd "wget -qO- http://127.0.0.1:8000/health" --health-interval 5s --health-retries 20`; `env:` with the same generated test env lines as W12, plus:
     - `CENTRIFUGO_ENGINE_TYPE: redis`;
     - `CENTRIFUGO_ENGINE_REDIS_ADDRESS: redis://redis:6379/15` (CI Redis has 16 DBs, slot 0 is used, `verify.yml:116`);
     - `CENTRIFUGO_ENGINE_REDIS_PREFIX: t2f_centrifugo`;
     - `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY: ci-hmac-${{ github.run_id }}-${{ github.run_attempt }}-0123456789abcdef`;
     - `CENTRIFUGO_HTTP_API_KEY: ci-api-${{ github.run_id }}-${{ github.run_attempt }}-0123456789abcdef`.

     These are per-run throwaway values with no literal secret (`check-secrets` honours allow-markers only under test paths, `scripts/check-secrets.mjs:16,62`).
  2. **Server integration step:** add `env:` with `T2F_CENTRIFUGO_URL: http://127.0.0.1:8000` and the two keys under their `T2F_` names, same expressions.
  3. **New step before "server integration":** `curl -sf http://127.0.0.1:8000/health || (docker restart ${{ job.services.centrifugo.id }} && sleep 5 && curl -sf http://127.0.0.1:8000/health)`. This covers a Centrifugo that started before Redis (not established, research).
- **Files:** `.github/workflows/verify.yml`.
- **Done means:**
  - `git diff -U0 .github/workflows/verify.yml` shows only `+` lines;
  - the YAML parses: `node -e` with `yaml` is not available, so instead W14's sync test reads the service block;
  - W14 passes.
- **Verify:** W14.
- **Rules that apply:** sec (workflow secrets: none committed).
- **Risk:** CI is observable only on push. AC-61 is checked by the wave lead (W47).

### W14 — Env-sync check and stack tests (P4)
- **Serves:** AC-2 (compose/CI part), AC-29 (static), AC-60.
- **Do:**
  - **Extend `--check` in `server/src/cli/realtimeConfig.ts`:** extract the `centrifugo` env entries of `docker-compose.yml` and of the `centrifugo` service in `verify.yml` (line-based: `KEY: value` lines inside that block). Compare every generated `centrifugoEnv(test)` entry with them, ignoring the secret and engine-address keys. Exit 1 naming the file and the key on a mismatch.
  - **Test `server/test/unit/realtime-stack.test.ts`:**
    - AC-60: `ensureRealtimeSecrets` on a temp file twice gives identical values ≥32 chars and two different keys; `git check-ignore -q <main checkout>/.claude/sdd/realtime/centrifugo.env` exits 0;
    - AC-29 static: `docker-compose.yml` has no `CENTRIFUGO_HTTP_API_INSECURE`;
    - AC-2: `--check` is 0 on the tree and 1 on a temp copy of the compose file with one value changed.
- **Files:** `server/src/cli/realtimeConfig.ts`, `server/test/unit/realtime-stack.test.ts`.
- **Done means:** the test passes and `pnpm --dir server realtime:config --check` exits 0.
- **Verify (server)** on W10–W14 server files.
- **Rules that apply:** —.
- **Risk:** `git check-ignore` needs git. The test skips with a message if `git` is absent.

### W15 — Realtime ports (P5)
- **Serves:** enables AC-12 … AC-19, AC-30 … AC-40, AC-57.
- **Do:** In `server/src/realtime/ports.ts` (ring 2), define:
  - `RealtimeSubject {kind: 'guest'|'account'; id: string}`;
  - `SubjectResolver { resolve(req: Request): Promise<RealtimeSubject | null> }` (two implementations: production null, test door);
  - `TokenSigner { sign(claims: {sub; iat; exp}): Promise<string> }` (test substitution for AC-14);
  - `RandomSource = () => number` in [0, 1) (seeded in tests);
  - `CentrifugoApi { publish({channel, data, idempotencyKey}): Promise<PublishOutcome>; disconnectUser(user, code, reason): Promise<'ok' | 'unavailable'> }` (process boundary);
  - `Scheduler { setTimeout(fn, ms): unknown; clearTimeout(h): void }`;
  - `ChannelPublisher` (C4: `publish(classKey, key, envelope) → 'ok'{offset?, epoch?} | 'queued' | 'validation' | 'unavailable'`);
  - `SubjectInvalidator` (C6).

  No `jose`, `fetch` or `centrifuge` types.
- **Files:** `server/src/realtime/ports.ts`.
- **Done means:** the file compiles and imports nothing outside `@time2fest/contracts` and `../ports`.
- **Verify (server)** with W19.
- **Rules that apply:** onion §2 (each port justified by a process boundary, two implementations or test substitution), ban 2.
- **Risk:** low.

### W16 — Token times and the issue use case (P5)
- **Serves:** AC-12, AC-14, AC-18.
- **Do:**
  - **`server/src/domain/realtime/token.ts` (ring 1):**
    - `tokenTimes(nowMs, rand, ttlSeconds?)` → `iat = floor(nowMs/1000)`, `exp = iat + (ttlSeconds ?? 2700 + floor(rand * 1801))`;
    - `expiresAtIso(exp)`.
  - **`server/src/realtime/token.ts` (ring 3):** `issueRealtimeToken({resolver, signer, clock, random}, req)`:
    - resolver `null` → `{token:null, expiresAt:null}`;
    - id not matching `SUBJECT_ID` → failure `unknown`, no token, no signing call;
    - else sign `{sub: id, iat, exp}` only.
- **Files:** `server/src/domain/realtime/token.ts`, `server/src/realtime/token.ts`.
- **Done means:** covered by W19.
- **Verify (server)** with W19.
- **Rules that apply:** sec A07/A04 (claims minimal, `exp` always set), A10 (fail closed).
- **Risk:** low.

### W17 — Signer and production subject adapters (P5)
- **Serves:** AC-12; C5 production adapter.
- **Do:**
  - `server/src/adapters/centrifugoToken.ts`: `createHs256Signer(secret)` uses `jose` `SignJWT` with `setProtectedHeader({alg:'HS256', typ:'JWT'})` and exactly the three claims.
  - `server/src/adapters/noSessionSubjects.ts`: `noSessionSubjects: SubjectResolver` always resolves `null`.
- **Files:** those two.
- **Done means:** W19 verifies a signed token with `jose.jwtVerify` (HS256 only) and the claim set equals `['exp','iat','sub']`.
- **Verify (server)** with W19.
- **Rules that apply:** sec A04 (explicit algorithm; never `none`).
- **Risk:** low.

### W18 — Route, registries, `Deps`, wiring (P5)
- **Serves:** AC-12, AC-13, AC-15, AC-16, AC-17, AC-19.
- **Do:**
  - **`server/src/endpoints/realtimeToken.ts`:** `realtimeTokenRoute` with key `realtime-token`, `GET /api/realtime/token`, `rateLimit: 'realtime-token'`, not `public`, no `needs`. The handler:
    - when `realtimeOf(deps)` has no signer (no `T2F_CENTRIFUGO_TOKEN_SECRET`; only possible in `test` after W6) → `failure('unavailable', {reason:'realtime-not-configured'})`;
    - otherwise `issueRealtimeToken`;
    - it never logs the token.
  - **`server/src/registries/routes.ts`:** the array becomes `[catalogRoute, realtimeTokenRoute, timeRoute]` (sorted by key; the single-line edit allowed above) plus its import line.
  - **`server/src/registries/rateLimits.ts`:** row `{ key: 'realtime-token', limit: 30, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' }` after `catalog-read`.
  - **`server/src/endpoints/types.ts`:** optional `Deps` fields `subjects?: SubjectResolver; realtime?: RealtimePorts`, where `RealtimePorts = { signer?: TokenSigner; random: RandomSource; prefix: string; publisher?: ChannelPublisher; invalidator?: SubjectInvalidator }`. Publisher and invalidator are filled in P7.
  - **`server/src/endpoints/deps.ts`:** getters `subjectsOf`, `realtimeOf`.
  - **`server/src/container.ts`, `createDeps`:**
    - `parseRealtimeConfig(raw, cls)`; failure → throw `env: invalid <names>` like `:128`;
    - `deps.subjects = overrides.subjects ?? noSessionSubjects`;
    - `deps.realtime = overrides.realtime ?? { signer: secret ? createHs256Signer(secret) : undefined, random: () => crypto.randomInt(0, 2**32) / 2**32, prefix }`.
- **Files:** `server/src/endpoints/{realtimeToken,types,deps}.ts`, `server/src/registries/{routes,rateLimits}.ts`, `server/src/container.ts`.
- **Done means:**
  - W19 passes;
  - `git diff -U0` of `rateLimits.ts` shows only `+` lines;
  - `routes.ts` differs by the import line and the one array line.
- **Verify (server)** on the listed files + W19.
- **Rules that apply:**
  - onion ban 1 (route reaches ports through `ctx.deps` only), §4 (wiring only in the root);
  - sec A02 (no CORS: the pipeline adds none, `pipeline.ts:31-36`), A06 (rate limit);
  - cc (C1 shape from the shared schema).
- **Risk:** `Deps` is shared by every route. Optional fields keep existing tests compiling.

### W19 — Token unit tests (P5)
- **Serves:** AC-12 (claims), AC-14, AC-18, AC-19 (unit).
- **Do:** Write `server/test/unit/realtime-token.test.ts`:
  - **AC-14:**
    - 1 000 tokens over 60 s of a controlled clock (step 60 ms), with a **seeded PRNG** (e.g. mulberry32 with a fixed seed) as `RandomSource`, so the bucket assertion cannot flake;
    - every `exp − iat` in [2 700; 4 500];
    - no 60-s `exp` bucket holds >50 tokens.
  - **AC-18:** a stub resolver returning `a#b`, `a,b` and a 65-char id → `unknown`, signer called 0 times.
  - **AC-12:** with the real HS256 signer the claims are exactly `sub`, `iat`, `exp`.
  - **AC-19:** the route handler with a `Deps` lacking a signer → 503 body `{ok:false, error:{code:'unavailable', reason:'realtime-not-configured'}}`.
- **Files:** `server/test/unit/realtime-token.test.ts`.
- **Done means:** the file passes with one `it` per AC.
- **Verify (server)** on W15–W19 files.
- **Rules that apply:** —.
- **Risk:** low.

### W20 — Test door and test subject resolver (P6)
- **Serves:** AC-57, AC-58, AC-59.
- **Do:**
  - **`server/src/test-doors/realtimeToken.ts`:**
    - a process-wide `testSubjects` holder: `set`, `clear`, and `resolver: SubjectResolver` returning the current subject;
    - `realtimeTokenDoor: DoorRow` with key `realtime-token`, `POST /api/_test/realtime-token`, `body: TestRealtimeTokenBodySchema`;
    - handler: no signer → `unavailable`/`realtime-not-configured`; else sign with the same `realtimeOf(deps).signer`, `tokenTimes(now, random, ttlSeconds)`; `testSubjects.set(subject)`; return `{token, expiresAt}`.
  - **`server/src/test-doors/registry.ts`:** the row at its sorted position (between `paypro-webhook` and `reset`), and in `resetDoor`'s handler one added line `testSubjects.clear()`.
  - **`server/src/test-doors/index.ts`:** export `doorSubjects = testSubjects.resolver`.
  - **`server/src/container.ts` `buildDispatcher`:** when `shouldLoadDoors`, take `doorSubjects` from the same dynamic import and set `deps.subjects` to it before building the dispatcher (composition root; no static import of `test-doors/**` anywhere).
- **Files:** `server/src/test-doors/{realtimeToken,registry,index}.ts`, `server/src/container.ts`.
- **Done means:**
  - W21 and W22 pass;
  - `grep -rn "test-doors/realtimeToken" server/src` matches only `test-doors/registry.ts` and `test-doors/index.ts`.
- **Verify (server)** on the listed files.
- **Rules that apply:** sec A01 (doors only in `test` + `T2F_TEST_DOORS=1`), `architecture.md` "Дверцята"; onion §4.
- **Risk:** EC-16. The holder is one per process, so parallel tests must use the token from the door response. State this in the door's header comment.

### W21 — Door gating lists (P6)
- **Serves:** AC-59.
- **Do:**
  - Add `/api/_test/realtime-token` to the production-404 assertions of `server/test/unit/doors-gating.test.ts` (added lines).
  - Add `['POST', '/api/_test/realtime-token']` to the list in `server/test/e2e/doors-404.e2e.ts` (`:14-18`, added line).
- **Files:** those two.
- **Done means:** `doors-gating.test.ts` passes. The e2e file is run by the wave lead in W45.
- **Verify (server)** on the unit file.
- **Rules that apply:** contractCheck "Test doors".
- **Risk:** low.

### W22 — Realtime test support and token integration suite (P6)
- **Serves:** AC-12, AC-13, AC-15, AC-16, AC-19, AC-57, AC-58, AC-59, AC-60 (evidence), AC-62.
- **Do:**
  1. **`server/test/integration/realtime-support.ts`:**
     - `centrifugoProbe(url, apiKey, prefix)` → `{ready: true}` or `{ready: false, message}`. It publishes into `rttest:<prefix>probe` through `POST /api/publish` with the key, with a 2 s timeout. `ready` only when Centrifugo answers 200 without `error`, which proves the key and the `test` namespaces.
     - `describeRealtime(name, fn)` = `describe.skipIf(!ready)`. When skipping it logs once: `[realtime] Centrifugo with the test configuration is unreachable at <url>: <message> — suite skipped`.
     - A Node `Centrifuge` client factory (global `WebSocket`, no `Origin`), a raw API helper and `name(classKey, key)` via the registry and `T2F_CENTRIFUGO_PREFIX`.
  2. **`server/test/integration/realtime-token.int.test.ts`:**
     - AC-13: no door subject → `{token:null, expiresAt:null}`.
     - AC-57: door `{subject:{kind:'guest', id:'g1'}}` then `GET` → `sub === 'g1'`.
     - AC-12: that token connects to Centrifugo (state `connected`); this also proves AC-60, because the secret in `.env.local` equals Centrifugo's.
     - AC-58: `POST /api/_test/reset` then `GET` → `token:null`.
     - AC-15: `GET` with `Origin: https://evil.example` → `cache-control: private, no-store` and no `access-control-*` header.
     - AC-16: 31 requests in one minute from one client → the 31st is 429 `rate_limited` with `retryAfterMs > 0`. Follow the fingerprint setup of `edge.int.test.ts`.
     - AC-19: deps without `T2F_CENTRIFUGO_TOKEN_SECRET` → 503 `realtime-not-configured`.
     - AC-59: deps with `T2F_ENV: 'production'` (pattern `doors.int.test.ts:25`) → the door path answers the unknown-path 404 body.
     - AC-62: `centrifugoProbe('http://127.0.0.1:1', …)` returns `ready:false` with a message containing `Centrifugo`.
- **Files:** `server/test/integration/realtime-support.ts`, `server/test/integration/realtime-token.int.test.ts`.
- **Done means:**
  - the single-file command passes with the stack up and every `it` executed (0 skipped);
  - the same file with `T2F_CENTRIFUGO_URL=http://127.0.0.1:1` in the shell env reports the Centrifugo-dependent `it`s as skipped, prints the `[realtime] … Centrifugo …` line and exits 0.
- **Verify:** both runs, under the shared lock.
- **Rules that apply:** `local-stack` §3 (shared lock, serial).
- **Risk:** the boot of Payload in `beforeAll` (60 s hook timeout, `vitest.integration.config.ts`). Re-run the single file once on a timeout.

### W23 — Centrifugo HTTP API adapter (P7)
- **Serves:** AC-32, AC-36, AC-17; enables AC-30, AC-33, AC-35.
- **Do:** Write `server/src/adapters/centrifugoApi.ts` → `createCentrifugoApi({url, apiKey, log})`:
  - `POST <url>/api/publish` with body `{channel, data, idempotency_key}`;
  - `POST <url>/api/disconnect` with body `{user, disconnect:{code, reason}}`;
  - header `X-API-Key`, `AbortSignal.timeout(2000)`.

  Outcome mapping (research Q4):
  - 200 with `result` → `ok` (`offset`, `epoch`);
  - 200 with `error` → `rejected` (code);
  - 401 → `unavailable` (misconfigured key);
  - 5xx, timeout or network error → `unavailable`.

  It never throws and never puts the key, URL credentials or body in a log line.
- **Files:** `server/src/adapters/centrifugoApi.ts`.
- **Done means:** covered by W27.
- **Verify (server)** with W27.
- **Rules that apply:** sec A09/A10; onion ring 4 (the only file that knows the Centrifugo HTTP API).
- **Risk:** low.

### W24 — Publish port, unbatched path (P7)
- **Serves:** AC-30, AC-31, AC-33, NFR-5.
- **Do:** In `server/src/realtime/publisher.ts`, `createChannelPublisher({api, rows, prefix, log})`. Its `publish(classKey, key, envelope)`:
  - unknown class (not in `channelClassesFor(cls)`), bad key, or envelope failing `RealtimeEnvelopeSchema` → `validation`;
  - `Buffer.byteLength(JSON.stringify(envelope))` >65 536 → `validation`;
  - no API call on any of these.

  Otherwise it calls `api.publish({channel: channelName(...), data: envelope, idempotencyKey: envelope.id})` and maps:
  - `ok` → `ok` with offset/epoch;
  - `unavailable` or `rejected` → `unavailable`.

  **NFR-5 warn line on every refusal and failure:** exactly one `log.warn({event:'realtime_publish', class, events: 1, result})`, with no envelope, token or key.

  In P7, rows with `batched: true` take the same immediate path. W30 switches them.
- **Files:** `server/src/realtime/publisher.ts`.
- **Done means:** covered by W27.
- **Verify (server)** with W27.
- **Rules that apply:** onion ban 2 (imports ports and ring 1 only); cc (C3 schema from contracts).
- **Risk:** low.

### W25 — `invalidateSubject` (P7)
- **Serves:** AC-35, AC-36, NFR-5.
- **Do:** In `server/src/realtime/invalidate.ts`, `createSubjectInvalidator({api, log})`. `invalidate(subjectId)` calls `api.disconnectUser(id, 3014, 'state invalidated')`. On `unavailable` it writes one `log.warn({event:'realtime_invalidate', subject: id, result:'unavailable'})`.
- **Files:** `server/src/realtime/invalidate.ts`.
- **Done means:** covered by W27.
- **Verify (server)** with W27.
- **Rules that apply:** sec A09.
- **Risk:** low.

### W26 — Wire publisher and invalidator (P7)
- **Serves:** enables AC-30 … AC-36 for domain waves.
- **Do:** In `container.ts`, when `T2F_CENTRIFUGO_URL` and `T2F_CENTRIFUGO_API_KEY` are set, build the API, publisher and invalidator into `deps.realtime`. Add `publisherOf(deps)` and `invalidatorOf(deps)` to `deps.ts`. Without the URL they are absent and the getters throw `deps: realtime publisher missing`.
- **Files:** `server/src/container.ts`, `server/src/endpoints/deps.ts`.
- **Done means:** W27 obtains both through the getters from `testDeps()`.
- **Verify (server)** with W27.
- **Rules that apply:** onion §4.
- **Risk:** low.

### W27 — Publisher tests (P7)
- **Serves:** AC-9, AC-17, AC-30 … AC-33, AC-35, AC-36, NFR-5.
- **Do:**
  - **Unit `server/test/unit/realtime-publisher.test.ts`:**
    - AC-31: a stub API records 0 calls for an unknown class, an envelope without `id`, and a 65 537-byte envelope;
    - NFR-5: captured warn lines for `unavailable` publish and invalidate contain `class`/`subject`, `events`, `result`, and no `data`, token or key substring.
  - **Integration `server/test/integration/realtime-publish.int.test.ts`** (under `describeRealtime`):
    - AC-30: an anonymous subscriber on `site:state` receives the published envelope ≤1 s later, deep-equal;
    - AC-33: the same `id` twice → one publication within 2 s;
    - AC-32: API at `http://127.0.0.1:<closed fake port 4125>` → `unavailable` in ≤2 s, no throw, warn line;
    - AC-35: two connections with door tokens for `S` and one for `T`; `invalidate('S')` → both S clients get disconnect code 3014 within 2 s, T stays connected;
    - AC-36: closed port → `unavailable` ≤2 s + warn with the id;
    - AC-17: a capturing logger over token issue, publish and invalidate has no line containing the token, `T2F_CENTRIFUGO_TOKEN_SECRET` or `T2F_CENTRIFUGO_API_KEY` values;
    - AC-9: after publishing into `site:state`, `ioredis` on `redis://127.0.0.1:6380/<db>` finds keys with prefix `t2f_centrifugo` in the Centrifugo DB and none in the slot DB (12). `<db>` = `process.env.T2F_TEST_CENTRIFUGO_REDIS_DB ?? 63`, and CI sets `15` in the step env (one added line in W13's step env; the implementer adds it in this item).
- **Files:** `server/test/unit/realtime-publisher.test.ts`, `server/test/integration/realtime-publish.int.test.ts`, `.github/workflows/verify.yml` (one added env line).
- **Done means:** the unit file passes; the integration file passes with 0 skipped.
- **Verify (server)** + single-file integration run.
- **Rules that apply:** —.
- **Risk:** low.

### W28 — Permissions integration suite (P8)
- **Serves:** AC-21 … AC-29 (int); settles W7's personal-namespace flag.
- **Do:** Write `server/test/integration/realtime-permissions.int.test.ts` (under `describeRealtime`, door tokens for `sub` A and B):
  - **AC-21:** for every class of the `test` registry, a client `publish` → error 103, and a second subscriber receives nothing in 2 s.
  - **AC-22:** anonymous → `notif:<p>user#A`, `orders:<p>user#A`, `user:<p>#A` → 103.
  - **AC-23:** `sub` A → the three channels of B → 103.
  - **AC-24:** A → own three channels subscribed; a server publish through the port arrives.
  - **AC-25:** anonymous → each public class (incl. `<p>toasts`, `<p>rating`, `chat:<p>country.UA`) subscribed and delivered.
  - **AC-26:** `admin:x`, `rttest2:x` → 102.
  - **AC-27:** a raw `node:http` upgrade request to `/connection/websocket` with `Origin: https://evil.example` → status 403 (research Q1).
  - **AC-28:** a token signed with another 64-char key, and a door token with `ttlSeconds: 1` used after 2 s → connect refused.
  - **AC-29:** `POST /api/publish` without a key and with a wrong key → 401, and a subscriber gets nothing.

  If AC-24 fails because personal namespaces lack `allow_subscribe_for_client`, the implementer adds it in W7, regenerates (W8), re-runs `--print-env` and updates W12/W13 lines, and records which way it went. That is an allowed cross-phase fix inside the same wave; report it.
- **Files:** `server/test/integration/realtime-permissions.int.test.ts` (and, only if needed, the W7/W8/W12/W13 files).
- **Done means:** the file passes with 0 skipped. If generated files changed, `realtime:config --check` is still 0.
- **Verify:** single-file integration run + server `files` on any touched src.
- **Rules that apply:** sec A01.
- **Risk:** a change to the shared container config needs W44 again (wave lead).

### W29 — Batch split rule (P9)
- **Serves:** AC-39.
- **Do:** In `server/src/domain/realtime/batch.ts`, write `splitBatch(events, makeId, maxEvents = 200, maxBytes = 65_536)` → an ordered list of `RealtimeBatch`. Each batch has ≤200 events and serialised ≤65 536 bytes. Order is kept. A single event over the byte limit never reaches here (AC-31 refuses it at enqueue).
- **Files:** `server/src/domain/realtime/batch.ts`.
- **Done means:** covered by W31.
- **Verify (server)** with W31.
- **Rules that apply:** onion §1.
- **Risk:** low.

### W30 — Batcher and the publisher switch (P9)
- **Serves:** AC-37, AC-38, AC-40, NFR-5.
- **Do:**
  - **`server/src/realtime/batcher.ts`:** per channel, the first event of an empty queue schedules a flush at +300 ms through `Scheduler`. Flushes of one channel run strictly one after another (a promise chain), so order holds across batch boundaries.
  - **The spacing rule:** with the queue empty at the first event, a flush at `first + 300 ms` is ≥250 ms after the previous flush, which satisfies both bounds of AC-37. The implementer keeps an assertion that the next flush time is ≥ previous + 250 ms.
  - **A flush:** `splitBatch`, then `api.publish` per batch with `idempotencyKey = batch.id`. A failed batch is dropped with one `log.warn({event:'realtime_publish', class, events: n, result})` and the schedule continues.
  - **`publisher.ts`:** `batched` rows validate (AC-31 rules per event), enqueue and return `queued`.
- **Files:** `server/src/realtime/batcher.ts`, `server/src/realtime/publisher.ts`, `server/src/container.ts` (pass `Scheduler` = global timers).
- **Done means:** covered by W31.
- **Verify (server)** with W31.
- **Rules that apply:** onion ban 2, §2 (`Scheduler` port for deterministic tests).
- **Risk:** the timers must be `unref`'d so they never keep a CLI process alive.

### W31 — Batching tests (P9)
- **Serves:** AC-37 … AC-40, NFR-5.
- **Do:**
  - **Unit `server/test/unit/realtime-batch.test.ts`** (fake scheduler and clock):
    - AC-39: 450 events in one window → 3 publications in order, each ≤65 536 bytes;
    - AC-40 unit: the first publish `unavailable` → warn with `class`, `events`, `result`, then the next window publishes;
    - flush timing: first event + 300 ms; gaps ≥250 ms.
  - **Integration `server/test/integration/realtime-batch.int.test.ts`:**
    - AC-37: `rttest:batch`, 20 events/s for 60 s. Publisher-side intervals (wrap the API to record times) are all in [250; 500] ms. Subscriber p95 inter-batch interval is in [250; 500] ms. `it` timeout 120 s.
    - AC-38: 1 000 events with an increasing counter → subscriber order equal after unpacking.
    - AC-40: a local fake HTTP API (`node:http` on fake port 4124) answers 503 to the first publish and proxies the rest to Centrifugo → the first batch is lost, the next is delivered, warn line present.
- **Files:** `server/test/unit/realtime-batch.test.ts`, `server/test/integration/realtime-batch.int.test.ts`.
- **Done means:** the unit file passes; the integration file passes with 0 skipped.
- **Verify (server)** + single-file integration run.
- **Rules that apply:** —.
- **Risk:** timing on a loaded machine. The bounds are the spec's. On a red run, re-run once and report both timings.

### W32 — Transport types and dedupe rule (P10)
- **Serves:** AC-54; enables AC-44 … AC-53.
- **Do:**
  - **`lib/api/http/realtime/types.ts`:**
    - `RealtimeListener {onEvent(e: RealtimeEnvelope); onResync?(); onForbidden?()}`;
    - `ConnectionState = 'connecting'|'connected'|'disconnected'`;
    - `RealtimeTransport {subscribe(channel, listener): Unsubscribe; state(): ConnectionState; onStateChange(fn): Unsubscribe}` (C7, `Unsubscribe` from `@time2fest/contracts`).
  - **`lib/api/http/realtime/dedupe.ts` (pure):** `createChannelFilter()` with `accept(envelope) → boolean`:
    - with `version`: accept only when greater than the last accepted version of the channel;
    - without `version`: refuse when `id` is among the last 1 000 accepted ids (FIFO window).
- **Files:** `lib/api/http/realtime/{types,dedupe}.ts`.
- **Done means:** covered by W35.
- **Verify (web)** with W35.
- **Rules that apply:** fua §4 (pure helpers, `import type`), §5.1.
- **Risk:** low.

### W33 — Transport core (P10)
- **Serves:** AC-41 … AC-53 (behaviour), AC-46.
- **Do:** In `lib/api/http/realtime/transport.ts`, write `createRealtimeTransport({url, tokenUrl, fetch, loadCentrifuge = () => import('centrifuge'), random, timers})`:
  - **AC-52:** with no `url` → state stays `disconnected`, no import and no fetch.
  - **AC-45:** on the first `subscribe`, the lazy import and the token fetch run, then the client is created with `minReconnectDelay: 500`, `maxReconnectDelay: 20000` (AC-53).
  - **Token handling:**
    - `getToken` returns `''` for `token:null` (AC-48, research Q5);
    - on a network error, 5xx or 429 it waits a random 5–10 s and retries, state `connecting` (AC-50);
    - it never throws `UnauthorizedError`.
  - **AC-44:** one Centrifugo subscription per channel, with a listener count; the last unsubscribe removes the subscription and, when none is left, disconnects (state `disconnected`).
  - **Publications:**
    - a batch (`type:'batch'`) is unpacked in order (AC-46);
    - each envelope passes the channel filter (AC-54) before `onEvent`.
  - **Recovery:**
    - on `subscribed` with `wasRecovering && !recovered`, call `onResync` once per listener and drop nothing else (AC-42);
    - recovered publications arrive as ordinary publications (AC-41).
  - **AC-51:** a subscription error code 103 → `onForbidden` once and the subscription is not retried (removed from the client).
  - **AC-49:** a refresh that returns `null` after a subject reconnects anonymously (Centrifugo 3014 → reconnect → `getToken` gives `''`). Public subscriptions resume; personal ones get 103 → `onForbidden`.
  - **AC-47:** state listeners fire on every change of the state diagram (`:373-382`).
- **Files:** `lib/api/http/realtime/transport.ts`.
- **Done means:** covered by W35 and W39.
- **Verify (web)** with W35.
- **Rules that apply:** fua §5 (the effectful adapter lives in the `lib/api/http` layer, not in components); sec (token kept in memory only, never in storage or logs); cc (C3/C7 semantics).
- **Risk:** this file is also typechecked by `server` (W39 imports it). Relative imports and `@time2fest/contracts` only; no DOM-only globals.

### W34 — Transport entry (P10)
- **Serves:** AC-52; enables later domain adapters.
- **Do:** In `lib/api/http/realtime/index.ts` (narrow barrel with a one-line purpose comment), export the types, `createRealtimeTransport` and `getRealtimeTransport()`. The latter is a lazy singleton with `url = process.env.NEXT_PUBLIC_REALTIME_URL` (inlined by Next at build; unset in every current build) and `tokenUrl = '/api/realtime/token'`. **No file outside `lib/api/http/realtime/` imports it in this wave.**
- **Files:** `lib/api/http/realtime/index.ts`.
- **Done means:** `grep -rn "http/realtime" app components lib --include=*.ts --include=*.tsx` matches only files inside `lib/api/http/realtime/`.
- **Verify (web)** with W35.
- **Rules that apply:** fua §2 (one narrow barrel).
- **Risk:** low.

### W35 — Transport unit and contract tests (P10)
- **Serves:** AC-44 … AC-48, AC-50 … AC-54.
- **Do:**
  - **`tests/unit/api/realtime-transport.test.ts`** (a fake `Centrifuge` class injected through `loadCentrifuge`, fake timers, fake `fetch`, seeded random):
    - AC-44: 3 subscribes → 1; 3 unsubscribes → 0;
    - AC-45: no import and 0 connections before the first `subscribe`;
    - AC-46: a batch of 3 → 3 `onEvent` in order;
    - AC-47: each transition of the diagram;
    - AC-48: an empty token passed;
    - AC-50: 503 then 200, pause within [5 000; 10 000] ms;
    - AC-51: one `onForbidden`, 0 retries;
    - AC-52: no `url` → `disconnected`, fetch 0 calls;
    - AC-53: the options object contains 500 / 20 000.
  - **`tests/unit/api/realtime-contract.test.ts`:**
    - AC-54: `v3, v2, v4` → `v3, v4`; a repeated `id` → dropped; the 1 001st-oldest `id` → accepted again;
    - AC-46 with a real `RealtimeBatch` shape.
- **Files:** those two tests.
- **Done means:** both pass under the web `files` command.
- **Verify (web)** on W32–W35 files.
- **Rules that apply:** cc §2 (contract suite file naming `*-contract.test.ts`).
- **Risk:** low.

### W36 — Wave-boundary static test (P11)
- **Serves:** AC-55, NFR-6.
- **Do:** Write `tests/unit/api/realtime-boundary.test.ts`:
  - AC-55: imports `HTTP_DOMAINS` and expects `['catalog']`; asserts no file in `lib/api/http/*.ts` (top level) imports `./realtime`;
  - NFR-6: reads `docker-compose.yml` and expects the line `image: centrifugo/centrifugo:v6.10.3`; reads `package.json` and expects `dependencies.centrifuge` to match `^5\.8\.\d+$` (exact, no range).
- **Files:** `tests/unit/api/realtime-boundary.test.ts`.
- **Done means:** the test passes.
- **Verify (web)** on that file.
- **Rules that apply:** —.
- **Risk:** low.

### W37 — Bundle scan script (P11)
- **Serves:** AC-56.
- **Do:**
  - **`scripts/check-bundle.mjs <dir>`:** scans `<dir>/**/*.js` for the centrifuge-js signature strings. These are `WebSocket constructor not found, make sure it is available globally or passed as a dependency in Centrifuge options` and `token expired but no getToken function set in the configuration` (research Q5; present verbatim in the minified dist).
    - Exit 0 with `check-bundle: clean (<n> files)`.
    - Exit 1 listing each matching file.
    - Exit 2 when `<dir>` is missing.
  - **`tests/unit/lint/check-bundle.test.ts`:**
    - a temp dir with a clean file → 0;
    - a temp file containing one signature → 1;
    - a missing dir → 2;
    - self-test: at least one signature occurs in `node_modules/centrifuge/dist/centrifuge.js` (read with `fs`, grep only). This proves the signature is real for the installed version.
- **Files:** `scripts/check-bundle.mjs`, `tests/unit/lint/check-bundle.test.ts`.
- **Done means:** the test passes.
- **Verify (web)** on both files.
- **Rules that apply:** —.
- **Risk:** low.

### W38 — Wire the bundle scan into the full checks (P11)
- **Serves:** AC-56.
- **Do:**
  - **`.claude/sdd-engineering.json`:** append ` && node scripts/check-bundle.mjs out-verify` to the end of `verify[web].full` (the single string edit allowed above).
  - **`.github/workflows/verify.yml`:** add a new step `bundle check` right after `web full`, with `run: node scripts/check-bundle.mjs out-verify` (added lines only). The file header (`:98-99`) asks to keep it mirrored with the config.
- **Files:** `.claude/sdd-engineering.json`, `.github/workflows/verify.yml`.
- **Done means:**
  - `node -e "JSON.parse(require('fs').readFileSync('.claude/sdd-engineering.json','utf8'))"` exits 0;
  - `git diff -U0 .github/workflows/verify.yml` shows only `+` lines.
- **Verify:** those commands.
- **Rules that apply:** sec (workflow).
- **Risk:** P11 must run after P4 and P7 (both edit `verify.yml`).

### W39 — Transport integration against real Centrifugo (P12)
- **Serves:** AC-41, AC-42 (a), AC-48 (int), AC-49.
- **Do:**
  - **`server/test/integration/realtime-proxy.ts`:** a `node:net` TCP proxy on fake port 4123 to `127.0.0.1:8000`, with `drop()` (destroy all sockets) and `pause(ms)` (refuse new connections).
  - **`server/test/integration/realtime-transport.int.test.ts`** (under `describeRealtime`). It imports `createRealtimeTransport` from `../../../lib/api/http/realtime/transport` and passes `loadCentrifuge: () => import('centrifuge')`, `fetch` bound to the in-process dispatcher, and `url` = the proxy address.
    - **AC-48:** anonymous connect, `site:state` subscribed.
    - **AC-41:** drop + pause 3 s, publish 5 events through the port → after reconnect 5 events in order, `onResync` not called.
    - **AC-42 (a):** publish `history_size + 1` (= 11) events during the pause → exactly one `onResync`, none of the missed events delivered.
    - **AC-49:** door subject `g1`, subscriptions `site:state` and `user:<p>#g1`; `POST /api/_test/reset`, then `invalidateSubject('g1')` → within 5 s the state returns to `connected`, the public subscription still receives a publish, the personal listener got `onForbidden`.
- **Files:** `server/test/integration/realtime-proxy.ts`, `server/test/integration/realtime-transport.int.test.ts`.
- **Done means:** the file passes with 0 skipped; `server` typecheck stays green with the cross-package import.
- **Verify:** single-file integration run + server `files` on both files.
- **Rules that apply:** `local-stack` §3.
- **Risk:** reconnect timing. The reconnect delay is random 0.5–20 s, so the test passes `minReconnectDelay`/`maxReconnectDelay` overrides through the factory only if W33 exposes them for tests. Otherwise allow 25 s timeouts (state in the report).

### W40 — Exclusive recovery tests (P12; run by the wave lead)
- **Serves:** AC-42 (b), AC-43.
- **Do:** Write `server/test/exclusive/realtime-recovery.exclusive.test.ts`, modelled on `deps-down.exclusive.test.ts:20-40` (compose helper, health wait). The compose child gets the two secrets via `ensureRealtimeSecrets`.
  - **AC-42 (b):** during a proxy pause, `FLUSHDB` on the Centrifugo Redis DB → after reconnect, one `onResync`, none of the missed events.
  - **AC-43:** `docker compose restart centrifugo` during a subscription with events before and after → all events from known offsets or exactly one `onResync`, never a silent gap (assert on the counter sequence).

  **The implementer writes it and runs only `npx tsc --noEmit -p .`. It is never executed under the shared lock.**
- **Files:** `server/test/exclusive/realtime-recovery.exclusive.test.ts`.
- **Done means:** the file typechecks; execution happens in W46.
- **Verify (server)** `files` on it (vitest `related` will not run it: the unit config excludes `test/exclusive`).
- **Rules that apply:** `local-stack` §3 (exclusive only after the orchestrator's go).
- **Risk:** it breaks a shared dependency for every worktree. W46 only.

### W41 — k6 scripts (P13)
- **Serves:** AC-63, AC-64, AC-65.
- **Do:** Write the scripts under `server/load/realtime/`. This is the path П-RT and SPEC-23 reuse.
  - **`lib/centrifugo.js`:**
    - `k6/websockets` client speaking the Centrifugo v6 JSON protocol: `{"id":1,"connect":{"token"?, "name":"k6"}}`, then `subscribe` frames;
    - answers each server `{}` ping with `{}` (research Q6);
    - optional `Origin` header from env;
    - counters for failed checks, reconnect success, recovered subscriptions, `token_requests` and delivery latency (from `data.t`).
  - **Scenarios:**
    - `steady.js` — steady connections with subscriptions;
    - `publish.js` — the subscribers plus one publisher VU calling `POST /api/publish` with `X-API-Key` at a configured rate, measuring delivery latency;
    - `storm.js` — all sockets closed in a window `STORM_AT`…`STORM_WINDOW`, reconnect, report the success share, the recovered share and `token_requests`.
  - **Every parameter comes from env:** `WS_URL`, `API_URL`, `VUS`, `RAMP`, `DURATION`, `TOKEN_SOURCE` (`anon` | `door:<share 0–1>`), `TOKENS_FILE`, `CHANNELS` (comma list, already prefixed), `PUBLISH_RATE`, `ORIGIN`.
- **Files:** `server/load/realtime/{lib/centrifugo.js,steady.js,publish.js,storm.js}`.
- **Done means:** covered by W43.
- **Verify:** W43.
- **Rules that apply:** —.
- **Risk:** k6 2.x API drift. Pin the image `grafana/k6:2.4.0`.

### W42 — k6 runner (P13)
- **Serves:** AC-63.
- **Do:**
  - **`server/scripts/k6.mjs --scenario steady|publish|storm --vus N --ramp 30s --duration 90s --token anon|door:0.1 --channels site:state,rttest:batch [--rate 1000/min] [--origin …]`:**
    - resolves the worktree prefix and prefixes the channel names (via the AC-10 rule mirrored in JS; covered by its unit test against W5's names);
    - for `door:` it pre-fetches the share of tokens from `http://127.0.0.1:<server port>/api/_test/realtime-token` on the host. The door answers only loopback `Host`, so the container cannot call it. Tokens go to a temp file mounted read-only.
    - It writes `API_KEY` to a temp `--env-file` (deleted afterwards; never on the command line).
    - It runs `docker run --rm --network t2f_default -v <load dir>:/scripts:ro -v <tmp>:/data:ro --env-file <tmp env> grafana/k6:2.4.0 run /scripts/<scenario>.js`, with `WS_URL=ws://centrifugo:8000/connection/websocket` and `API_URL=http://centrifugo:8000` (compose network, so no host-loopback question).
    - It prints the k6 summary.
  - **`server/package.json`:** one script line `"k6": "node scripts/k6.mjs"`.
  - **Unit `server/test/unit/k6-runner.test.ts`:** argument parsing and the `docker` argv built (no Docker call); the key never appears in argv; prefixed channels.
- **Files:** `server/scripts/k6.mjs`, `server/package.json`, `server/test/unit/k6-runner.test.ts`.
- **Done means:** the unit test passes.
- **Verify (server)** on the runner + test.
- **Rules that apply:** sec (secrets via env-file, not argv; `execFile` without shell).
- **Risk:** low.

### W43 — k6 proof runs and the NFR-1 command (P13)
- **Serves:** AC-63, AC-64, AC-65; prepares NFR-1.
- **Do:** Run each of these under the shared lock, with the stack up and the server serving on 4120 (`pnpm --dir server serve` in the background; stop it afterwards, `local-stack` §5):
  - (a) `node server/scripts/lock.mjs --mode shared -- pnpm --dir server k6 --scenario steady --vus 50 --ramp 10s --duration 60s --token door:0.1 --channels site:state,rttest:batch` → 0 failed checks (AC-63);
  - (b) `--scenario publish --vus 50 --duration 60s --rate 600/min` → 0 failed checks, latency reported (AC-63);
  - (c) `--scenario storm --vus 50 --token anon` → reconnect success 100%, `token_requests` 0 (AC-64);
  - (d) `--scenario steady --vus 50 --duration 90s` → no disconnect code 3012 ("no pong") (AC-65).

  Never more than 100 connections here. Then write `server/load/realtime/README.md`:
  - parameters, examples;
  - the **NFR-1 command for the wave lead**: `node server/scripts/lock.mjs --mode exclusive -- pnpm --dir server k6 --scenario publish --vus 2000 --ramp 2m --duration 10m --token door:0.1 --channels site:state,rttest:batch --rate 1000/min`, and alongside it `docker stats --no-stream t2f-centrifugo-1 t2f-redis-1` every 60 s;
  - the П-RT note (30 000 via Cloudflare: `WS_URL` of `rt.*` after SPEC-13a).
- **Files:** `server/load/realtime/README.md`.
- **Done means:** the four summaries are pasted into the phase report with the numbers above. The README contains the exact NFR-1 command.
- **Verify:** the four runs.
- **Rules that apply:** `local-stack` §3 and §5.
- **Risk:** if `k6/websockets` sends an `Origin` by default (not established), the test-class glob still matches loopback origins only. Pass `--origin http://127.0.0.1:4121` if refused.

### W44 — Gate: apply the new stack configuration (wave lead, after P4)
- **Serves:** enables every integration item (AC-9, AC-12 … AC-43).
- **Do:**
  1. Confirm with `docker ps` that no other worktree's realtime run is in progress. SPEC-13a's suites do not use Centrifugo; only `stack:smoke` checks its health.
  2. Run `pnpm stack:up`; this recreates the shared `centrifugo` container with the env-only `test` config on Redis DB 63.
  3. Run `pnpm db:create`; this rewrites `server/.env.local` with the three `T2F_CENTRIFUGO_*` lines.
  4. Run `pnpm stack:smoke` (7/7 with the new key check).
- **Files:** none in git.
- **Done means:** smoke 7/7; the W22 probe returns `ready: true`.
- **Verify:** smoke output.
- **Rules that apply:** `local-stack` §5 (never `down -v`).
- **Risk:** a worktree on a branch without this change that runs `pnpm stack:up` recreates Centrifugo with the old insecure in-memory config. The realtime suites then **skip**. The wave lead re-runs W44 and treats skipped as not run.

### W45 — Integration pass (wave lead)
- **Serves:** AC-56, NFR-3, and the full check of all ACs.
- **Do:** Run, one heavy run at a time:
  - web `full` (now ending with `node scripts/check-bundle.mjs out-verify`, AC-56: `check-bundle: clean`);
  - contracts `full`;
  - server `full` (`pnpm test:int` includes every realtime file, 0 realtime skips);
  - `pnpm --dir server build`;
  - `pnpm --dir server realtime:config --check`;
  - `node scripts/check-secrets.mjs` after `git add -A`;
  - `node scripts/check-research-data.mjs`;
  - `pnpm install --frozen-lockfile`;
  - `pnpm contracts:run --sim-only`;
  - `pnpm --dir server test:e2e -- doors-404` against a production-class server (as in SPEC-05).
- **Files:** none.
- **Done means:** every command exits 0; `check-bundle` prints `clean`; there are 0 skipped realtime tests in the `test:int` output.
- **Verify:** the Verification plan.
- **Rules that apply:** `sdd-format` §6.
- **Risk:** Next "upgrade nudge" on `next build` (`architecture.md:47`): use `CI=1 __NEXT_AGENT_UPGRADE=security`.

### W46 — Exclusive runs and the 2 000-connection smoke (wave lead, after the orchestrator's explicit "yes")
- **Serves:** AC-42 (b), AC-43, NFR-1.
- **Do:**
  1. `cd server && npx cross-env T2F_EXCLUSIVE=1 node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.integration.config.ts test/exclusive/realtime-recovery.exclusive.test.ts`.
  2. With the server serving on 4120, the NFR-1 command from the README.
  3. Put the k6 summary and the `docker stats` lines into the wave report.
- **Files:** none.
- **Done means:**
  - W40 passes;
  - NFR-1: 0 unexpected disconnects, p95 delivery ≤1 s, Centrifugo ≤256 MB, Redis ≤256 MB.
- **Verify:** as above.
- **Rules that apply:** spec D17 (`:532`), `local-stack` §3.
- **Risk:** RAM. Run nothing else heavy on the machine during it.

### W47 — NFR-4 diff review and CI evidence (wave lead)
- **Serves:** NFR-4, AC-61.
- **Do:**
  - `git diff -U0 33535e1 -- server/src/registries/env.ts docker-compose.yml .github/workflows/verify.yml`. Every `-` line is either `CENTRIFUGO_HTTP_API_INSECURE` or inside the `centrifugo` block of compose; everything else is `+`.
  - After the push, read the `verify.yml` run log. The realtime integration files ran and passed (not skipped) in `server integration`.
- **Files:** none.
- **Done means:** both statements hold, quoted in the wave report.
- **Verify:** as above.
- **Rules that apply:** —.
- **Risk:** none.

### W48 — Docs patch, specs index, knowledge (wave lead)
- **Serves:** enables the hand-over to SPEC-07/08/10/12/15 and П-RT (spec "Передачі", `:440-448`).
- **Do:**
  - Write the docs patch in Ukrainian into the shared notes (outside the repo): `…/side-session-notes/<session>/spec-06/docs-patch.md`. It covers:
    - `frontend-seam.md` §3.11 row `:241` (implemented; C1 shape) and §2.6 channel list `:106` (add `site:state`; prefix only in `test`);
    - `docs/backend/README.md` and `readiness.md` (realtime done; Open questions 1–4, 6 status);
    - `local-stack` SKILL notes (env-only Centrifugo on Redis DB 63; secrets file `.claude/sdd/realtime/centrifugo.env`; `pnpm --dir server realtime:config`, `pnpm --dir server k6`; the recreate hazard of W44);
    - the routing-row follow-up (sec for `adapters/centrifugo*.ts`);
    - Spec follow-ups 1 and 2 for SPEC-12 and the spec's Open question 5;
    - `docs/services/` is not touched (nothing in Cloudflare).
  - In the repo, update the `docs/specs/README.md` row 13 status from `draft` to `approved`. It becomes `implemented` only after `plan-verifier` reports every in-wave AC verified and the owner confirms.
  - **Knowledge:** `docs/knowledge/gotchas.md` (config `knowledgeFiles`) does not exist in this worktree. The proposed entries go into the docs patch for the main session to record with `sdd-engineering:engineering-insights`: the Centrifugo namespace history merge, the compose recreate hazard, and the fact that Node's WebSocket sends no `Origin`.
- **Files:** `docs/specs/README.md`.
- **Done means:**
  - the patch file exists outside the repo with those sections;
  - the README row reads `approved`.
- **Verify:** read-back.
- **Rules that apply:** `docs-sync` skill (Ukrainian; who writes what).
- **Risk:** none.

## Execution

Sequential phases in one worktree. Each implementer phase is a fresh `sdd-engineering:implementer` dispatch with this plan's path and the phase id. It touches only its phase's files, ends with a green targeted check, and is independently committable by the wave lead.

**Lanes:** S (server, P2–P9, P12, P13) and W (web, P10, P11). P10 may run beside one S phase among P2–P9, and only when no other heavy agent runs on the machine (SPEC-13a counts, `sdd-routing.md` §7). Otherwise run P10 after P9.

**Budget:** ~60–80 tool calls per phase. If a phase runs out, it returns PARTIAL with the tree green after the last finished item, and a second dispatch of the same phase continues.

**Integration items need gate W44.** Integration files run serially under the shared lock, one file at a time.

| Lane / phase | Executor | Model | Work items | Files (disjoint) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — deps, wire contracts | implementer | sonnet | W1, W2, W3 | `package.json`, `server/package.json`, `pnpm-lock.yaml`, `packages/contracts/src/{realtime,realtime.schemas,schemas,index}.ts`, `packages/contracts/test/realtime.test.ts`, `scripts/contract-surface.baseline.json` | — | — | `pnpm install` runs alone (only generator) |
| P2 — channel model, registry, env | implementer | **opus** — channel-name isolation and fail-closed env rules for secrets are the trust boundary of every later phase | W4, W5, W6 | `server/src/domain/realtime/{channels,config}.ts`, `server/src/registries/{channels,env}.ts`, `server/src/instrumentation.ts`, `server/src/platform/env.check.ts`, `server/test/unit/{realtime-registry,realtime-env}.test.ts`, fixture lines in `server/test/unit/{platform,edge,env-access-catalog}.test.ts` | P1 | P10 (conditional) | this worktree |
| P3 — Centrifugo config generation | implementer | **opus** — permissions of every channel class live in this generator; a wrong v6 key is silently ignored | W7, W8, W9 | `server/src/domain/realtime/centrifugoConfig.ts`, `server/src/cli/realtimeConfig.ts`, `server/realtime/centrifugo.{test,rehearsal,production}.json`, `server/package.json`, `server/test/unit/realtime-config.test.ts` | P2 | P10 (conditional) | `--write` touches only `server/realtime/` |
| P4 — secrets, stack, compose, CI | implementer | sonnet | W10–W14 | `server/scripts/lib/realtimeSecrets.mjs`, `server/scripts/{stack,db}.mjs`, `server/.env.example`, `docker-compose.yml`, `.github/workflows/verify.yml`, `server/src/cli/realtimeConfig.ts`, `server/test/unit/realtime-stack.test.ts` | P3 | P10 (conditional) | no `stack:up` (that is W44) |
| L-gate — apply stack config | wave lead | — | W44 | — | P4 | — | shared container recreated once |
| P5 — token endpoint | implementer | **opus** — token issuing: claims, expiry spread, fail-closed 503, rate limit | W15–W19 | `server/src/realtime/{ports,token}.ts`, `server/src/domain/realtime/token.ts`, `server/src/adapters/{centrifugoToken,noSessionSubjects}.ts`, `server/src/endpoints/{realtimeToken,types,deps}.ts`, `server/src/registries/{routes,rateLimits}.ts`, `server/src/container.ts`, `server/test/unit/realtime-token.test.ts` | P4, W44 | P10 (conditional) | this worktree |
| P6 — test door, subject resolver | implementer | **opus** — the test subject resolver must stay unreachable outside the doors' dynamic import | W20, W21, W22 | `server/src/test-doors/{realtimeToken,registry,index}.ts`, `server/src/container.ts`, `server/test/unit/doors-gating.test.ts`, `server/test/e2e/doors-404.e2e.ts`, `server/test/integration/{realtime-support,realtime-token.int.test}.ts` | P5 | P10 (conditional) | `test:int` shared lock, single file |
| P7 — publish port, invalidate | implementer | **opus** — publisher port: never throws into domain code, 2 s bound, no secret in logs | W23–W27 | `server/src/adapters/centrifugoApi.ts`, `server/src/realtime/{publisher,invalidate}.ts`, `server/src/container.ts`, `server/src/endpoints/deps.ts`, `server/test/unit/realtime-publisher.test.ts`, `server/test/integration/realtime-publish.int.test.ts`, `.github/workflows/verify.yml` (1 line) | P6 | P10 (conditional) | shared lock |
| P8 — permissions suite | implementer | sonnet | W28 | `server/test/integration/realtime-permissions.int.test.ts` (+ W7/W8/W12/W13 files only if AC-24 forces the flag) | P7 | P10 (conditional) | shared lock; a config change needs W44 again |
| P9 — batching | implementer | **opus** — publisher batching: ordering across flushes, spacing bounds, drop-and-continue | W29, W30, W31 | `server/src/domain/realtime/batch.ts`, `server/src/realtime/{batcher,publisher}.ts`, `server/src/container.ts`, `server/test/unit/realtime-batch.test.ts`, `server/test/integration/realtime-batch.int.test.ts` | P8 | P10 (conditional) | shared lock; the AC-37 test runs 60 s |
| P10 — client transport core | implementer | **opus** — client transport core: lazy load, listener counting, recovery/resync and refusal semantics | W32–W35 | `lib/api/http/realtime/{types,dedupe,transport,index}.ts`, `tests/unit/api/{realtime-transport,realtime-contract}.test.ts` | P1 | one of P2–P9 (conditional) | web files only |
| P11 — wave boundaries, bundle scan | implementer | sonnet | W36, W37, W38 | `tests/unit/api/realtime-boundary.test.ts`, `scripts/check-bundle.mjs`, `tests/unit/lint/check-bundle.test.ts`, `.claude/sdd-engineering.json`, `.github/workflows/verify.yml` | P10, P7 | — | no `next build` (W45 does it) |
| P12 — transport integration, exclusive file | implementer | **opus** — network fault injection and recovery semantics across server and client; flaky-timing risk | W39, W40 | `server/test/integration/{realtime-proxy,realtime-transport.int.test}.ts`, `server/test/exclusive/realtime-recovery.exclusive.test.ts` | P9, P10 | — | shared lock; the exclusive file is **not run** |
| P13 — k6 | implementer | sonnet | W41, W42, W43 | `server/load/realtime/**`, `server/scripts/k6.mjs`, `server/package.json`, `server/test/unit/k6-runner.test.ts` | P6 | — | k6 ≤100 connections, shared lock; own server process stopped afterwards |
| L — integration, exclusive, NFR-1, docs | wave lead | — | W45, W46, W47, W48 | `docs/specs/README.md`; patch outside the repo | P11, P12, P13 | — | W46 only after the orchestrator's "yes", exclusive lock |

Two lanes never touch the same file. P10 (web) shares nothing with P2–P9. P11 waits for P7 because both edit `verify.yml`.

Escalation from Sonnet to Opus follows `run-plan-auto` §3. P5 is the widest phase (13 files). If its budget runs out, return PARTIAL after W18 with the tree green, and dispatch W19 again.

## Verification plan

| Command | Directory | Passing means |
|---|---|---|
| contracts `files` | `packages/contracts` | exit 0 (P1) |
| `node scripts/contract-surface.mjs --check` | `.` | exit 0 (P1, W45) |
| server `files` (config) | `server` | exit 0 (every server phase) |
| `pnpm realtime:config --check` | `server` | exit 0 (P3, P4, P8, W45) |
| `docker compose -p t2f -f docker-compose.yml config --quiet` | `.` | exit 0 (P4) |
| `node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<realtime file>` | `server` | exit 0, 0 skipped (P6–P9, P12) |
| the same for `realtime-token.int.test.ts` with `T2F_CENTRIFUGO_URL=http://127.0.0.1:1` | `server` | exit 0, Centrifugo-dependent tests skipped, message names Centrifugo (AC-62) |
| `node server/scripts/lock.mjs --mode shared -- pnpm --dir server k6 …` (four runs of W43) | `.` | as W43 |
| web `files` (config) | `.` | exit 0 (P10, P11) |
| `pnpm stack:smoke` | `.` | 7/7 (W44) |
| web, contracts, rules, server `full` (config; web now ends with `check-bundle`) | their dirs | exit 0 — wave lead (W45) |
| `node scripts/check-secrets.mjs` after `git add -A` | `.` | `check-secrets: clean` (NFR-3) |
| `node scripts/check-research-data.mjs` | `.` | exit 0 (NFR-3) |
| `pnpm install --frozen-lockfile` | `.` | exit 0 |
| `pnpm contracts:run --sim-only` | `.` | exit 0 |
| `pnpm --dir server build` | `.` | exit 0 |
| `pnpm --dir server test:e2e -- doors-404` (production-class server) | `.` | the new door row is 404, identical to an unknown path |
| exclusive file of W46, NFR-1 command | `server`, `.` | as W46 — wave lead, after the go |
| `git diff -U0 33535e1 -- …` (W47) | `.` | NFR-4 holds |

## Assumptions

Technical judgement calls only.
- **Local and CI Centrifugo are configured by env only.** The JSON files are the generated source of truth, and the sync check binds compose and CI env to them (W14). Reason: worktrees would otherwise recreate the shared container through different bind-mount paths.
- **Centrifugo's Redis is DB 63 locally and DB 15 in CI**, with prefix `t2f_centrifugo`. DB 63 is above the slot range 0–47 (`registries/env.ts:88`); CI Redis has 16 DBs.
- **Shared secrets file:** `<main checkout>/.claude/sdd/realtime/centrifugo.env`, resolved like the lock dir. CI uses per-run values built from `github.run_id`.
- **AC-11 and the class-dependent half of AC-20 live in a pure `parseRealtimeConfig`**, called at boot like `parseAccessConfig`. This keeps `registries/env.ts` additive (NFR-4). The two secrets carry `requiredIn` + `min(32)` + `secret: true` in a new `realtime` block.
- **Key validation:** an ISO country key is `^[A-Z]{2}$`; an `rttest` name is `^[a-z0-9_]{1,40}$`.
- **Namespace history merge:** max size and max TTL (Spec follow-up 1).
- **Batch envelope `id`** is a random id per batch (`crypto.randomUUID()` through the composition root), used as the Centrifugo `idempotency_key`. The Centrifugo idempotency window is 5 min per channel (research Q4), which covers AC-33's 60 s.
- **NFR-1's publisher is k6** publishing straight to the Centrifugo API on the compose network. The connection load, not the server batcher, is what NFR-1 measures; the batcher is proven by AC-37/38.
- **k6 runs on the compose network `t2f_default`.** Door tokens are pre-fetched on the host, because doors answer loopback `Host` only.
- **Centrifugo's "unexpected" 401** (wrong key) maps to `unavailable` in the publish port, with a warn.
- **AC-14's distribution test uses a seeded PRNG.** With real randomness a >5% bucket appears in roughly 1 run in 20, which would make the test flaky.

## Open questions

None.

## Research used

- **Spec provenance (`:467-468`):** research-centrifugo and research-code of 2026-11-17. Not re-read: no file of it exists in the repository or in the shared notes.
- **One planner researcher** (`research-tools:researcher`, Opus, 2026-11-18) against Centrifugo v6.10.3 source, centrifuge-js 5.8.0 source, actions/runner and k6 docs:
  - `allowed_origins` uses gobwas glob, so `http://127.0.0.1:*` matches; no `Origin` is accepted; a refused origin gets 403 (`internal/origin/origin.go:15-45`; centrifuge `internal/websocket/server.go:214-220`). Node 22 sends no `Origin` (undici).
  - Env naming `CENTRIFUGO_<KEY with . → _>`. `CENTRIFUGO_CHANNEL_NAMESPACES` takes a JSON array (`types.go:778-808`); env overrides the file; lists are space-separated. `history_meta_ttl` exists per namespace and globally. `engine.redis.address` takes `redis://host:6379/N`.
  - The image runs with `CMD ["centrifugo"]`; GitHub service containers share a network with label aliases.
  - Server API: errors come back as HTTP 200 with an `error` body; a missing or wrong key gives 401; `idempotency_key` window 5 min; disconnect body `{user, disconnect:{code, reason}}`; 3014 is a reconnecting code in centrifuge-js.
  - centrifuge-js: uses global `WebSocket`; `getToken` returning `''` means anonymous; `subscribed` has `wasRecovering`/`recovered`; dist ≈23.1 KB gzip; signature strings as in W37.
  - k6: `grafana/k6:2.4.0`, module `k6/websockets`, headers as the 3rd constructor argument; ping `{}` → pong `{}`.
- **Not established by research** (handled in the plan):
  - whether k6 sends an `Origin` by default → W43 risk;
  - Windows host-loopback reachability from containers → avoided by the compose network;
  - `wget` in the Centrifugo image → CI health-check plus restart step (W13);
  - Centrifugo start-up before Redis → `depends_on` locally, restart step in CI.

## Rollback / blast radius

- **Code:** revert the branch. Every server change is additive except the one-line `routeRegistry` edit and the `centrifugo` compose block. No database migration, no seed change, no change in Cloudflare or on any server.
- **Shared local state:**
  - the Centrifugo container is recreated (W44);
  - Redis DB 63 holds Centrifugo history;
  - the secrets file lives in the main checkout's `.claude/sdd/realtime/`.

  To roll back, run `pnpm stack:up` from a checkout without this change. That recreates the old container. DB 63 can be left (TTL ≤10 min of history; `history_meta_ttl` ≤1 h for personal namespaces).
- **Other worktrees:** while branches differ, whichever worktree runs `stack:up` last decides the Centrifugo config. Realtime suites then skip by design (AC-62). The wave lead repeats W44 before any realtime run.
- **Site:** none. No page imports the transport (AC-55/56), and `HTTP_DOMAINS` is unchanged.
