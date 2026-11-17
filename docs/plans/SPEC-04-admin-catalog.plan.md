# Implementation plan: Admin and moments catalog (SPEC-04)

**Route** — A (spec-driven).
**Requirements source** — `docs/specs/SPEC-04-admin-catalog.md` (Status: draft; 0 `[NEEDS CLARIFICATION]` markers). AC-1 … AC-88, NFR-1 … NFR-10. The spec is `draft` only because the owner's answers Q1–Q7 are pending. The orchestrator's brief (2026-11-17) says to plan from the working answers in the table «Припущення до відповіді власника» (spec:14-26) as if the spec were approved. Every item those answers decide is a small, isolated work item marked **`owner-dependent: Qn`**. A different answer changes that item only.
This plan implements those requirements; it does not define or change them.
**Execution mode** — phased single pipeline, at most 2 lanes at once, each lane with its own files. The orchestrator settled this mode in its brief (2026-11-17). There is one `sdd-engineering:implementer` dispatch per phase or lane, with this plan's path and the phase or lane id. The model for each dispatch comes from the `Model` column of `## Execution`. Each dispatch is meant to finish in 60–80 tool calls.
**Out of scope** — everything in the spec's `Non-goals` (spec:46-59). In particular:
- the content slots, content agent and SVG cleaning (SPEC-21a/b);
- site rebuilds and freezing, the `site` snapshot, `eventPatches` delivery and the red button (SPEC-08);
- recomputing moments and the scheduler (SPEC-07);
- Telegram alarms and the full alarms screen (SPEC-13b);
- chat and payment reactions to unattended mode;
- anything in real Cloudflare;
- origin closure (SPEC-05);
- deleting catalog records;
- third-party audit plugins;
- the 3-year journal purge (SPEC-20);
- any change to `data/*.json`, components, styles, tokens or site texts;
- full non-midnight events.

Architecture and security review are performed by separate agents. The `security-reviewer` is mandatory here: this wave changes the agent write surface, Access and keys (NFR-9).

**Repository root** for every path below is the worktree `D:/Work/Pets/Time2Fest/web/.claude/worktrees/spec-04-admin-catalog` (branch `spec-04-admin-catalog`). Its worktree slug is `spec_04_admin_catalog`, so its databases are `t2f_spec_04_admin_catalog` and `t2f_spec_04_admin_catalog_test`. The slot and ports are printed by `pnpm db:create`; never hard-code them.

**Do not commit, and never push.** The sub-session commits after the run (`run-plan-auto` §3); the one exception is the WIP commit of Gate R before P11. Machine: 16 GB. Run Vitest with `--maxWorkers=2`, Playwright with `--workers=2`, and server integration tests serially.

**Pipelining with SPEC-05** (Cloudflare edge Worker, a parallel wave in another worktree that merges first):
- **Never create or edit** `workers/**`, `wrangler.toml`, `functions/**` or `D:/Work/Pets/Time2Fest/docs/backend/cloudflare-notes.md`.
- **Shared files are append-only, one line per change.** These are:
  - the collection list in `server/src/payload.config.ts`;
  - every `server/src/registries/*.ts` (one sorted line per domain);
  - `server/src/migrations/**`;
  - `docker-compose.yml`;
  - `package.json` and `server/package.json`;
  - `pnpm-lock.yaml`;
  - `server/src/registries/env.ts`;
  - `.gitignore`;
  - `packages/contracts/src/{index,schemas}.ts`;
  - `server/src/test-doors/registry.ts`.

  Do not reformat or re-sort them beyond inserting your own line.
- **New dependencies only in P1.**
- **Payload migrations:** during development use throwaway, stacked `spec04_wip_pN` migrations (see `## Schema during development`). The single real migration is generated **once**, in P11, after Gate R has rebased onto `master` with SPEC-05 merged.

**Never read:** `research_data/**`, `docs/archive/**`, `Old Project/**`, `**/reference-boards/**`, `board-tools/shots/**` (except the `*.fid.png` files the compare step flags), `graphify-out/graph.json`, `out*/`, `.next*/`, `node_modules`, `pnpm-lock.yaml`. **Never write** `data/**` or anything under `D:/Work/Pets/Time2Fest/docs/**` (root docs changes go into `## Docs patch`). The one exception is the transient `BT/reports/_fid-*.json` that `snapshot.mjs` always writes; W54 deletes it in the same step (Assumptions).

## Requirements traceability
`spec:N` = line in `docs/specs/SPEC-04-admin-catalog.md`. `Qn` = owner-dependent item.

| Req | Requirement (short) | Source | Work items | Checked by |
|---|---|---|---|---|
| AC-1 | No valid `Cf-Access-Jwt-Assertion` on a non-`/api/*` path → 403, empty body, Payload not reached, even with a cookie or API key | spec:81 | W9, W14, W15 | W14 `Done means` |
| AC-2 | Bad signature, unknown `kid`, non-RS256, foreign `iss`/`aud`, past `exp` → 403 | spec:84 | W12 | W12 |
| AC-3 | Person JWT passes only with an owner email from config (main + 1 reserve) (Q2) | spec:87 | W13 | W13 |
| AC-4 | Service-token JWT only to `/cms-api/*` and only with an allowed `common_name` | spec:90 | W12, W14 | W14 |
| AC-5 | A Payload operation without the Access identity set by the gate is refused | spec:93 | W10, W15 | W15 |
| AC-6 | Wrong `Host` on `/admin/*`, `/cms-api/*` → 404 identical to an unknown path | spec:96 | W9, W14 | W14 |
| AC-7 | rehearsal/production with missing or test Access settings → refuse to start, naming the variable | spec:99 | W11 | W11 |
| AC-8 | `POST /api/_test/access-token` signs person/service JWTs in the test class only | spec:102 | W12 | W12, W53 (404 in production) |
| AC-9 | Unknown `kid`, ≥30 s since the last JWKS fetch → refetch and accept the new key | spec:105 | W12 | W12 |
| AC-10 | JWKS unreachable + unknown `kid` → 403 + log alarm `access-jwks-unreachable` | spec:108 | W12 | W12 |
| AC-11 | Admin request to the origin bypassing the edge → refused | spec:111 | W51 | W51 (after SPEC-05) |
| AC-12 | Payload session 24 h (Q1) | spec:114 | W16 | W16 |
| AC-13 | No first-register screen; first owner only by a command that refuses when an owner exists | spec:117 | W17 | W17 |
| AC-14 | Exactly three roles; no second `owner` | spec:122 | W18 | W18 |
| AC-15 | The key value is shown once; never in reads, journal or logs | spec:125 | W19 | W19 |
| AC-16 | A revoked key is refused on the very next request | spec:128 | W19 | W19 |
| AC-17 | Agent-role record cannot sign in by password | spec:131 | W18 | W18 |
| AC-18 | Agents: read catalog only; any other write or read of journal/keys refused | spec:134 | W18, W25 | W18, W25 matrix |
| AC-19 | `agentPublish` off → the agent's publish saved as `proposal` from the next request | spec:137 | W20 | W20 |
| AC-20 | Every write → exactly one journal row in the same transaction; failed journal → data rolled back | spec:142 | W22, W28, W31, W35, W45, W24, W19 | W22 + per-domain tests |
| AC-21 | Journal rows cannot be changed or deleted by any role | spec:145 | W22 | W22 |
| AC-22 | One-step revert; revert row links the original; the revert can be reverted | spec:148 | W23 | W23 |
| AC-23 | Current ≠ "after" → `changed-since`, nothing changed | spec:151 | W23 | W23 |
| AC-24 | No revert handler → no button, API `not-revertible` | spec:154 | W23, W47 | W23, W53 (e2e) |
| AC-25 | Revert by a non-owner → refused | spec:157 | W23 | W23 |
| AC-26 | First screen: slots in registry order, last 20 journal rows with revert, unattended slice | spec:162 | W46, W47 | W53 (e2e) |
| AC-27 | A failing slice → the others render, an error in its place | spec:165 | W46 | W53 (e2e) |
| AC-28 | Test slice registered only in the test class | spec:168 | W46 | W46 |
| AC-29 | A slice action goes through the owner interface, is journaled and revertible | spec:171 | W46 | W46 |
| AC-30 | Native Payload admin in `uk`, with Ukrainian labels | spec:174 | W46 | W53 (e2e) |
| AC-31 | Sleep window = one-off Kyiv interval stored as UTC; end ≤ start or overlap refused (Q5) | spec:179 | W41, W42 | W42 |
| AC-32 | Inside a window with no manual override → on, ≤30 s lag | spec:182 | W41, W45 | W41, W45 |
| AC-33 | Manual toggle holds until the next window boundary (Q5) | spec:185 | W42, W45 | W42 |
| AC-34 | `page` alarm unacknowledged 15 min → on, actor system, cause `alarm` | spec:188 | W43, W45 | W43 |
| AC-35 | Alarm-caused mode ends only when all `page` alarms are acknowledged or on a manual off (Q4) | spec:191 | W44, W45 | W44 |
| AC-36 | Exactly one "Unattended mode" event + journal row per transition | spec:194 | W45 | W45 |
| AC-37 | `page` alarm stored (source, code, time, `acknowledgedAt` empty), never throws | spec:197 | W24 | W24 |
| AC-38 | "Acknowledge" sets `acknowledgedAt` + journal row | spec:200 | W24, W49 | W24, W53 (e2e) |
| AC-39 | `POST /api/_test/alarm` in the test class only | spec:203 | W24 | W24, W53 |
| AC-40 | Event delivered to every subscriber in every instance ≤2 s after commit | spec:208 | W21 | W21 (single), W53 (two instances, exclusive) |
| AC-41 | Rolled-back transaction → no event | spec:211 | W21 | W21 |
| AC-42 | Increasing versions + state-read port with the same version | spec:214 | W21, W35 | W35 |
| AC-43 | Content fields in `uk`/`en`/`es`/`fr`, `uk` required | spec:219 | W25 | W25 |
| AC-44 | Country gender `m`/`f`/`n`/`pl`/empty | spec:222 | W25 | W25 |
| AC-45 | Zone midnight not writable by any role; only the import writes it | spec:225 | W25, W49 | W25, W53 (e2e) |
| AC-46 | `iso`/`slug` immutable after create | spec:228 | W25 | W25 |
| AC-47 | No deletion of season/zone/event/country/city/tradition (Q7) | spec:231 | W26, W49 | W26, W53 (e2e) |
| AC-48 | Event slot kind; non-midnight requires `startsAt` | spec:234 | W25 | W25 |
| AC-49 | Integrity violations refused with the rule name | spec:237 | W27 | W27 |
| AC-50 | Generator writes zone midnights + tzdb version from the pinned tzdb | spec:242 | W7 | W7 |
| AC-51 | Dated tzdb discrepancy report, exit 0/1, changes nothing | spec:245 | W8 | W8 |
| AC-52 | Two reports per season + a tzdb-announcements note | spec:248 | W8, W56 | manual (December; W56 docs patch) |
| AC-53 | Correction confirmation "was → will be" (+ local time); saved only after confirm | spec:253 | W35, W48 | W53 (e2e) |
| AC-54 | Correction saved/reverted → journal + "Correction changed" event per changed event | spec:256 | W35, W38 | W35, W38 |
| AC-55 | >60 min from base → `correction-out-of-range` (Q3) | spec:259 | W36 | W36 |
| AC-56 | New main unmarks the old main of the pair in the same correction (Q6) | spec:262 | W37 | W37 |
| AC-57 | Hiding the main with another visible event and no new main → `main-required` (Q6) | spec:265 | W37 | W37 |
| AC-58 | Pair with no other visible event: hide main after a warning (Q6) | spec:268 | W37, W48 | W37, W53 (e2e) |
| AC-59 | `restrained` needs a `uk` note ≤200 chars; stored as plain text | spec:271 | W35 | W35 |
| AC-60 | Corrections accepted the same way during 31.12 08:00 – 01.01 14:00 UTC | spec:274 | W35 | W35 |
| AC-61 | Stale correction version → `changed-since` | spec:277 | W35 | W35 |
| AC-62 | Corrections separate from the base; port in `SiteEventPatch` form with a version | spec:280 | W35 | W35 |
| AC-63 | `GET /api/catalog` 200 `ApiResult{version,schedule,countries}` passes the shared schema | spec:285 | W29, W30 | W30, W40 |
| AC-64 | After an import on an empty DB, the site-built `Catalog` deep-equals the one from `data/` | spec:288 | W31, W40 | W40 |
| AC-65 | Integrity broken in the DB → `unavailable`/`catalog-invalid` | spec:291 | W30 | W30 |
| AC-66 | Non-midnight events not in `events`; read port gives them with `startsAt` | spec:294 | W30 | W30 |
| AC-67 | Any catalog change → `generatedAt` = server time, new version, "Catalog changed" event; no-op import → none | spec:297 | W28, W31 | W28, W31 |
| AC-68 | `build:int` takes the catalog from the server; non-`ok` → exit ≠0 naming the server address; no fallback | spec:300 | W39 | W39, W53 |
| AC-69 | Demo build from `data/` unchanged; `data/*.json` unchanged | spec:303 | W39 | W55 |
| AC-70 | `http` mode: domain `catalog` migrated, `version()` = server version | spec:306 | W39 | W39 |
| AC-71 | Boards of all pages from the http build ≤0.1 %; 0.1–0.5 % explained, no layout shift | spec:309 | W54 | W54 |
| AC-72 | Version change → R2 `latest` + `<version>` objects ≤60 s, body = `GET /api/catalog` | spec:314 | W34 | W34 |
| AC-73 | R2 failure → ≥3 retries in 5 min, change kept, then `page` alarm | spec:317 | W34 | W53 (exclusive) |
| AC-74 | `pnpm stack` starts the R2 emulator with a per-worktree bucket/prefix | spec:320 | W2, W3, W34 | W34 |
| AC-75 | Dry run: four-group report, nothing written | spec:325 | W31 | W31 |
| AC-76 | Two applies → same state, second report 0/0 | spec:328 | W31 | W31 |
| AC-77 | Admin-edited record skipped and reported | spec:331 | W31 | W31 |
| AC-78 | Apply journals a summary + one row per added/changed record | spec:334 | W31 | W31 |
| AC-79 | `import catalog` runs in every class, independent of doors | spec:337 | W31 | W31 |
| AC-80 | Unknown import domain → exit ≠0 listing known domains | spec:340 | W31 | W31 |
| AC-81 | Source fails schema → exit ≠0 with file and field path, nothing written | spec:343 | W31 | W31 |
| AC-82 | `export catalog` writes `data/`-format files, byte-equal after a clean import, without corrections or non-midnight events | spec:346 | W33 | W33 |
| AC-83 | No `--write` or dirty targets → no write, list or reason printed | spec:349 | W33 | W33 |
| AC-84 | `http-seeds` maps every manifest seed name; unknown → exit ≠0 | spec:354 | W5 | W5 |
| AC-85 | `compare-live` writes `<id>.fid.png` + JSON with % and class | spec:357 | W4 | W4 |
| AC-86 | Masks from the repo overlay painted in both images; manifests read-only | spec:360 | W4 | W4 |
| AC-87 | Playwright http config shoots the integration build, ≤2 workers | spec:363 | W6 | W6, W53 |
| AC-88 | Stack seed / reset door fill the catalog = import on an empty DB | spec:368 | W32 | W32 |
| NFR-1 | Gate adds ≤20 ms p95 (warm JWKS) | spec:405 | W14 | W53 |
| NFR-2 | `GET /api/catalog` ≤1 s p95, body ≤2 MB | spec:408 | W30 | W53 |
| NFR-3 | >30 `GET /api/catalog` per minute per client → `rate_limited` + `retryAfterMs` | spec:411 | W30 | W30 |
| NFR-4 | Apply ≤120 s, dry run ≤60 s | spec:414 | W31 | W53 |
| NFR-5 | No agent keys, Access JWTs, R2 keys or `PAYLOAD_SECRET` in logs, journal, output, responses | spec:417 | W12, W19, W22, W34 | W53 (aggregate grep) + security review |
| NFR-6 | Journal kept ≥3 years; no deletion in this wave | spec:420 | W22 | W22 (static) |
| NFR-7 | R2 emulator memory ≤256 MB | spec:423 | W2 | W53 |
| NFR-8 | Gate denial → one log line with reason code, no JWT/email, ≤1/s per reason | spec:426 | W14 | W14 |
| NFR-9 | `security-reviewer` without open HIGH | spec:429 | all; W55 | `run-plan-auto` review step |
| NFR-10 | First admin screen ≤3 s p95 locally | spec:432 | W46 | W53 |

**Wave card «Готово, коли» → the item that produces its evidence** (from the spec's Traceability `From` column):

| Card bullet | AC | Evidence from |
|---|---|---|
| відмова навіть з паролем Payload | AC-1, AC-12 | W14 (cookie without JWT → 403), W15 |
| тестовий підписувач лише в тестовому класі | AC-7 | W11 |
| тестовий підписувач підтвердження Access | AC-8 | W12 |
| прямий запит повз край → відмова (Д8) | AC-11 | W51 (post-rebase) |
| ролі owner/content-agent/stream-agent | AC-14 | W18 |
| ключі агентів з миттєвим відкликанням | AC-16 | W19 |
| кожна дія — у журналі | AC-20 | W22 (+ per-domain journal assertions) |
| відкат одним кроком | AC-22 | W23 |
| тестовий зріз підключається до каркаса | AC-28, AC-29 | W46 |
| режим без нагляду за розкладом (тестовий годинник) | AC-32 | W41, W45 |
| за непідтвердженою тривогою | AC-34 | W43 |
| дверцята режиму без нагляду через тестовий годинник | AC-39 | W24 |
| скрипт генерує північ поясів з tzdb | AC-50 | W7 |
| звіт розбіжностей | AC-51 | W8 |
| поправка зберігається з підтвердженням | AC-53 | W48 (UI) + W53 (e2e run) |
| публікує внутрішню подію «Поправку події змінено» | AC-54 | W35, W38 |
| сайт збирається з GET /api/catalog | AC-68 | W39 + W53 step 4 |
| зібраний Catalog глибоко дорівнює нинішньому | AC-64 | W40 |
| демо із замороженого web/data (Д4) | AC-69 | W55 (`build:demo`, `git diff --stat master -- data/`) |
| перемикання catalog | AC-70 | W39 |
| дошки всіх сторінок — без різниці | AC-71 | W54 |
| копія каталогу в R2 | AC-72 | W34 |
| локально — емуляція | AC-74 | W2, W34 |
| сухий прогін нічого не пише (К6) | AC-75 | W31 |
| import catalog двічі → однаковий стан | AC-76 | W31 |
| не перетирає правки адмінки | AC-77 | W31 |
| пише кожен запуск у журнал | AC-78 | W31 |
| не дверцята; працює в усіх класах | AC-79 | W31 |
| реєстр імпорту з рядком на домен | AC-80 | W31 |
| export catalog оновлює демо (Д4) | AC-82 | W33 |
| http-seeds.mjs / compare-live.mjs / маски / конфіг Playwright для http | AC-84 … AC-87 | W5, W4, W4, W6 |
| сид каталогу з web/data | AC-88 | W32 |

## Spec follow-ups
Addressed to `spec-creator` and the owner. The plan implements the spec as written; each item says how.

1. **AC-64 vs AC-67: `generatedAt` on import.**
   - AC-67 says every catalog change except a no-op import sets `generatedAt` to server time.
   - AC-64 needs the version after an import on an empty DB to equal the version of `data/`, which is `generatedAt + tzdb`.
   - The plan therefore has `import` write the season meta (`generatedAt`, `tzdbVersion`) **from the source file**. A no-op import writes nothing. Every non-import write (admin, `/cms-api`, slice action, revert) sets `generatedAt` to server time.
   - Consequence: an import that changes rows while `data/schedule.json` keeps the same `generatedAt` keeps the version. This cannot happen with the generator, which stamps `generatedAt` on every run (`scripts/build_schedule.py:201`).
2. **AC-70 and the production build.**
   - `resolveApiMode` makes every non-test build `http` (`next.config.ts:61-65`), including the `web` `verify.full` build into `out-verify`. If that build had to fetch from a server, every verify would need the stack.
   - The plan therefore fails closed (AC-68) for the **integration build** (`NEXT_PUBLIC_ENV=test` + `http`): `build:int`, `out-fid`, and any other test+http build.
   - A production `http` build reads the server catalog only when `T2F_CATALOG_URL` is set; otherwise it reads `data/` and prints `catalog: data/ (T2F_CATALOG_URL not set)`.
   - SPEC-08/SPEC-13a should make the production build fail closed once a production server exists.
3. **OQ-5 is settled by reading the tool.** `snapshot.mjs` already accepts `--shots` (`BT/snapshot.mjs:25`; the header comment does not list it). `batch-01 … batch-08` hold 533 states (49/121/105/56/77/80/33/12), which is about 965 boards across their breakpoints (layout-fidelity skill). AC-71 asks for "all manifests", so W54 captures all of them, one batch at a time.
4. **`snapshot.mjs` always writes `BT/reports/<batch>.json`** into the root docs tree (`snapshot.mjs:26,641`). The layout-fidelity procedure names the subset manifest `_fid-…` and deletes the report right after (skill §4 step 4). The plan follows that. It is the only write under `D:/Work/Pets/Time2Fest/docs/**`, and it is transient.
5. **AC-19 test collection.** The plan keeps the `agent-test-posts` collection registered in every class, with access granted only in the test class. Registering it only in `test` would make the generated migration depend on the class it was generated in. Production gets an empty, inaccessible table.
6. **AC-52** is satisfied in December (first week and before 30.12), after this wave. The wave delivers the report tool and one dated baseline report (W8), and the docs-patch line for `docs/backlog.md` (W56). The two seasonal reports are an operational step for the orchestrator.
7. **AC-11** depends on SPEC-05. W51 runs only after Gate R. If SPEC-05 has not merged when the run reaches P11, the report marks AC-11 «не виконано, чекає SPEC-05» as the spec allows (spec:112), and P11 still consolidates the migration on the current `master`. In that case the second rebase regenerates it (migration-safety check 5).

## Affected surface
Routing: `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md` §1. The shorthands below are:
- **onion** = `engineering-paved-path:onion-architecture` (`server/src/**/*.ts`, `packages/contracts/src/**/*.ts`; excludes `server/src/{app,collections,migrations}/**`, `payload-types.ts`, tests);
- **security** = `engineering-paved-path:security`;
- **cc** = `contract-conformance`;
- **ms** = `migration-safety`;
- **next** = `engineering-paved-path:next-best-practices`;
- **seed** = `seed-and-fixtures`;
- **react** = `engineering-paved-path:react-best-practices` (excludes `server/**`, so it does not apply to server `.tsx`).

Ring placement follows `D:/Work/Pets/Time2Fest/docs/backend/architecture.md:5-10`:
- **ring 1** — pure functions in `server/src/domain/**`;
- **ring 2** — per-domain `ports.ts`;
- **ring 3** — services over ports;
- **ring 4** — adapters, endpoints, collections, globals, the proxy, CLIs and admin components;
- **composition** — `container.ts` and `registries/**`.

| File | New/Mod | Package | Home (ring) | Skills that will govern it | Constraint to respect |
|---|---|---|---|---|---|
| `server/package.json` | Mod | server | deps / scripts | security | P1 only for deps; exact versions; scripts `import`, `export`, `owner:create` appended |
| `package.json` (root) | Mod | web | devDeps / scripts | security | P1 only: `pngjs` exact; no script reorder |
| `docker-compose.yml` | Mod | server | infra | security | New service `r2` appended; loopback port; `mem_limit: 256m` (NFR-7); no secret |
| `server/scripts/stack.mjs` | Mod | server | tooling | security | Append `r2` to the `up` list (`stack.mjs:55`) and one S3 probe to `smoke` |
| `server/scripts/db.mjs` | Mod | server | tooling | security | Append env lines in `writeEnv` (`db.mjs:63-79`); never print values |
| `server/src/registries/env.ts` | Mod | server | composition | onion | New blocks `access`, `catalog`, sorted before `platform` (`env.ts:31`) |
| `server/src/domain/access/{config,classify}.ts` | New | server | ring 1 | onion | Pure; no `process.env` read (pass env in) |
| `server/src/domain/access/ownerEmails.ts` | New | server | ring 1 | onion | **owner-dependent: Q2**; one function |
| `server/src/access/ports.ts` | New | server | ring 2 | onion | `AccessVerifier`, `IdentityMarker`, `DenyLog` |
| `server/src/access/gate.ts` | New | server | ring 3 | onion, security | Decision only; no Next or jose import |
| `server/src/access/payloadGuard.ts` | New | server | ring 4 (Payload glue) | onion, security | Adds the second check to every collection/global; thin |
| `server/src/adapters/{accessJwt,identityMarker}.ts` | New | server | ring 4 | onion, security | jose only here; HMAC marker with a per-process key |
| `server/src/adapters/testSigner.ts` | New | server | ring 4 (test-only) | onion, security | Imported only through the dynamic doors import (`container.ts:138`) and the test-class verifier branch |
| `server/src/proxy.ts` | New | server | ring 4 (driving) | next, security | Next 16 Proxy (Node runtime); strips inbound identity headers |
| `server/src/payload.config.ts` | Mod | server | Payload config | ms | One-line edits only: `collections: …map(harden)`, `globals:` line, `i18n:` line |
| `server/src/instrumentation.ts` | Mod | server | boot guard | next | Append Access-config check (AC-7) and `startBackground(deps)` (events listener, unattended ticker) |
| `server/src/platform/env.check.ts` | Mod | server | boot guard | onion | Append the Access-config check (AC-7) |
| `server/src/collections/admins.ts` | Mod | server | Payload | ms, security | role field, `useAPIKey`, `tokenExpiration` (Q1), hooks |
| `server/src/collections/{agentTestPosts,auditLog,internalEvents,alarms}.ts` | New | server | Payload | ms | Thin; access via `domain/access/roles.ts` |
| `server/src/collections/catalog/{seasons,zones,countries,cities,events,traditions,fields}.ts` | New | server | Payload | ms | Thin; text natural-key FKs; group fields `{uk,en,es,fr}` |
| `server/src/collections/{eventPatches,unattendedWindows}.ts` | New | server | Payload | ms | Thin |
| `server/src/globals/{adminSettings,unattendedState}.ts` | New | server | Payload | ms | Thin |
| `server/src/registries/{collections,globals}.ts` | Mod / New | server | composition | onion | One sorted line per collection; `globals.ts` new |
| `server/src/domain/access/roles.ts` | New | server | ring 1 | onion, security | Role → operation policy table (AC-14, AC-18) |
| `server/src/access/keys.ts` | New | server | ring 3 | onion, security | Issue/revoke; value returned once |
| `server/src/cli/createOwner.ts` | New | server | ring 4 (CLI) | security | Refuses when an owner exists (AC-13) |
| `server/src/events/{ports,bus}.ts`, `server/src/adapters/pgEvents.ts`, `server/src/registries/subscribers.ts` | New | server | 2 / 3 / 4 / composition | onion | Outbox in the same transaction; LISTEN/NOTIFY + poll |
| `server/src/audit/{ports,journal,revert,hooks}.ts`, `server/src/domain/audit/revert.ts`, `server/src/registries/revertHandlers.ts` | New | server | 2 / 3 / 1 / composition | onion, security | Journal in the caller's transaction; no delete code |
| `server/src/alarms/{ports,service}.ts`, `server/src/adapters/payloadAlarms.ts` | New | server | 2 / 3 / 4 | onion | Store failure never throws (AC-37) |
| `server/src/platform/logger.ts` | Mod | server | ring 4 | onion | `createAlarm(logger, store?)` additive param only (`logger.ts:67`) |
| `server/src/container.ts` | Mod | server | composition | onion, security | New ports in `Deps`; raw Payload stays private |
| `server/src/endpoints/types.ts` | Mod | server | ring 4 | cc | `Deps` gains the new ports (additive fields) |
| `server/src/domain/catalog/{integrity,assemble,fromData,importPlan,toData,version}.ts` | New | server | ring 1 | onion | Pure; shared by import, seed, export, endpoint |
| `server/src/catalog/{ports,service,import,export,copy}.ts` | New | server | 2 / 3 | onion | No Payload import |
| `server/src/adapters/{payloadCatalog,s3}.ts` | New | server | ring 4 | onion, security | `@aws-sdk/client-s3` only in `s3.ts` |
| `server/src/endpoints/catalog.ts` | New | server | ring 4 | cc, security | Uses `CatalogResponseSchema`; rate-limit row |
| `server/src/registries/{routes,rateLimits,imports}.ts` | Mod / Mod / New | server | composition | onion | One line each |
| `server/src/cli/{import,export}.ts` | New | server | ring 4 (CLI) | security | Exit codes per AC-80/81/83; no secret output |
| `server/src/seed/registry.ts` | Mod | server | ring 3 | seed | Six `catalog-N-*` rows appended |
| `server/src/adapters/payload.ts` | Mod | server | ring 4 | onion | Seed store passes `context: { t2fActor: 'system:seed' }` (additive) |
| `server/src/domain/corrections/{rules,range,mainCelebration}.ts` | New | server | ring 1 | onion | `range.ts` = **Q3**, `mainCelebration.ts` = **Q6** |
| `server/src/corrections/{ports,service}.ts`, `server/src/adapters/payloadCorrections.ts` | New | server | 2 / 3 / 4 | onion | One transaction: patch + journal + outbox |
| `server/src/domain/unattended/{windows,kyiv,override,alarmTrigger,alarmExit,machine}.ts` | New | server | ring 1 | onion | `kyiv.ts`/`override.ts` = **Q5**, `alarmExit.ts` = **Q4** |
| `server/src/unattended/{ports,service,ticker}.ts`, `server/src/adapters/payloadUnattended.ts` | New | server | 2 / 3 / 4 | onion | Compare-and-set transition under a row lock |
| `server/src/admin/**/*.tsx`, `server/src/registries/adminSlots.ts` | New | server | ring 4 (Payload admin UI) / composition | next (client/server boundary only) | **Coverage gap** for `.tsx` (react row excludes `server/**`) |
| `server/src/app/(payload)/admin/importMap.js` | Mod (generated) | server | generated | — | Only `pnpm --dir server generate:importmap` |
| `server/src/test-doors/registry.ts` | Mod | server | ring 4 | security | Rows `access-token`, `admin-test-slice`, `alarm` appended (sorted) |
| `server/src/migrations/*` | New (generated) | server | generated | ms | `spec04_wip_pN` throwaway; one `admin_catalog` in P11 |
| `server/src/payload-types.ts` | Mod (generated) | server | generated | — | Only `generate:types` |
| `server/test/{unit,integration,e2e,exclusive}/**` | New | server | tests | — (unrouted) | Integration serial; e2e `--workers=2` |
| `packages/contracts/src/{catalog,catalog.schemas}.ts` | New | contracts | ring 1 (wire) | onion, cc | Additive; zod only in `catalog.schemas.ts` |
| `packages/contracts/src/{index,schemas}.ts` | Mod | contracts | ring 1 | cc | One `export *` line each |
| `packages/contracts/test/catalog.test.ts`, `scripts/contract-surface.baseline.json` | New / Mod | contracts / web | test / generated | cc | Baseline only via `contract-surface.mjs --update` |
| `lib/api/http/catalog.ts`, `lib/api/sim/catalog.ts` | New | web | `lib/api` adapter | frontend-ui-architecture, security, cc | Sync service over `getData()` |
| `lib/api/http/index.ts`, `lib/api/sim/index.ts`, `lib/api/services.ts` | Mod | web | seam | frontend-ui-architecture, cc | One entry each; `'catalog'` appended to `MIGRATED_DOMAINS` (`services.ts:43`) |
| `lib/data/catalogSource.mjs`, `next.config.ts` | New / Mod | web | build config | next | Fetch only for test+http (fail closed) or `T2F_CATALOG_URL` |
| `.gitignore` | Mod | web | config | — | One line `.t2f-catalog/` |
| `tests/contract/{catalog.suite.ts,catalog.http.test.ts}`, `tests/unit/api/catalog-contract.test.ts`, `tests/unit/api/catalog-source.test.ts` | New | web | tests | cc | http suite serial |
| `scripts/boards/{compare-live,http-seeds}.mjs`, `scripts/boards/lib/{png,manifests}.mjs`, `scripts/boards/masks.json` | New | web | tooling | — (**coverage gap**) | Manifests read-only (AC-86) |
| `playwright.http.config.ts` | New | web | test config | — (gap) | `workers: 2` |
| `tests/unit/boards/*.test.ts` | New | web | tests | react-testing-library (`tests/unit/**`, no-op for non-React) | `// @vitest-environment node` |
| `scripts/build_schedule.py` | Mod | web | generator | — (gap) | Add `--out <dir>` only; default output unchanged |
| `scripts/tzdb_report.py`, `scripts/tests/test_tzdb_{generator,report}.py`, `scripts/tests/fixtures/tzdb/*.json`, `docs/tzdb-reports/<date>.md` | New | web | tooling / tests / report | — (gap) | Never writes `data/` |
| `.claude/skills/{local-stack,layout-fidelity,seed-and-fixtures}/SKILL.md` | Mod | — | skills | — (`*.md` unrouted) | Facts from this wave only (W56) |

**Coverage gaps:**
- `server/src/admin/**/*.tsx`: no row applies, because the react row excludes `server/**` and the onion row is `*.ts`. W46 applies the `next` client/server boundary rules by hand.
- `scripts/boards/**`, `playwright.http.config.ts`, `scripts/*.py`, `scripts/tests/**`, `server/test/**`.
- Always unrouted: `**/*.md`, `docs/tzdb-reports/**`, `pnpm-lock.yaml`, `server/src/payload-types.ts`, `server/src/migrations/*`, `importMap.js`, `scripts/contract-surface.baseline.json`.

## Contract changes
- **Shared contracts / schemas:** yes, additive only, in `packages/contracts`:
  - `src/catalog.ts` adds `CATALOG_REASONS = ['catalog-invalid']` and the type `CatalogPayload = { version; schedule; countries }`. It is typed against plain interfaces, not the web `Dataset`.
  - `src/catalog.schemas.ts` adds the zod `CatalogResponseSchema`, and the internal event payload schemas `EventPatchChangedSchema`, `CatalogChangedSchema` and `UnattendedChangedSchema` (spec:526-533).
  - `index.ts` and `schemas.ts` each gain one `export *` line.
  - There are no duplicated copies.
  - Run `node scripts/contract-surface.mjs --update`, then `--check` (W29).
- **Migration:** yes. It adds:
  - `admins` columns: role, API key fields;
  - the new collections `agent-test-posts`, `audit-log`, `internal-events`, `alarms`, `seasons`, `zones`, `countries`, `cities`, `events`, `traditions`, `event-patches` and `unattended-windows`;
  - the globals `admin-settings` and `unattended-state`.

  It is generated once in P11 by `pnpm --dir server migrate:create admin_catalog`, after Gate R. It is never hand-written. Before that, the throwaway `spec04_wip_pN` migrations are used (see the next section). Skill `migration-safety`, checks 1–8.
- **Seed / fixture data:** yes.
  - Six seed rows (`catalog-1-seasons` … `catalog-6-traditions`) read `data/schedule.json` and `data/countries.json` through the same pure mapper as the import (AC-88).
  - There are no new board fixtures: the catalog state of every board comes from the seed, and the remaining manifest seeds are client-side `localStorage` in this wave (W5).
  - Nothing is read from `research_data` or `data/streams.candidates.json`.
- **Build-only failures:** yes.
  1. `server/src/proxy.ts`, the Payload admin components (`server/src/admin/**`, `'use client'` boundaries) and `importMap.js` can fail only in `next build` of the server. W53 runs `pnpm --dir server start:prod`, which builds first.
  2. The `next.config.ts` catalog-source change can break the static export while `tsc` stays green. W55 runs `web` `full` (production `http` without `T2F_CATALOG_URL`, so `data/`), `pnpm build:demo` and `pnpm build:int` (W53).
  3. `@time2fest/contracts/schemas` must stay out of the site bundle. W55 greps `out-verify/_next/static` for `ZodError`.
- **Wire contract:** yes. The changes are:
  - the new route `GET /api/catalog`, with the reason `catalog-invalid` and the `rate_limited` row;
  - the new test doors `POST /api/_test/access-token`, `POST /api/_test/alarm` and `POST /api/_test/admin-test-slice`;
  - the internal event payloads, which are server-internal but have shared schemas.

  `contract-conformance` runs the `catalog` suite on sim (`data/`) and on http (the server) through `pnpm contracts:run` (W40, W52). The `frontend-seam.md` §3.1/§3.11 rows are in the Docs patch.
- **Layout fidelity:** yes. The `catalog` domain switches to `http` in the integration build. W54 runs `layout-fidelity` on all manifests from the http build, with `fidelity-triager`, one capture run at a time. The domain e2e also runs with `playwright.http.config.ts` (W53).
- **Payload migration:** yes, see Migration (`migration-safety`, W50).
- **Test doors:** yes. `access-token`, `alarm` and `admin-test-slice` are rows of `server/src/test-doors/registry.ts`, loaded only through `shouldLoadDoors` (`container.ts:34-36`, dynamic import `:138`). W53 re-runs `server/test/e2e/doors-404.e2e.ts`, extended with the three paths, against `T2F_ENV=production` and expects 404 identical to an unknown path. The test signer's key material exists only behind the same gate.
- **Agent write surface:** yes. The roles `content-agent`/`stream-agent`, API keys, `agentPublish` and the `/cms-api` agent path change. `security-reviewer` is mandatory. The audit log (AC-20) and one-step revert (AC-22) are covered by W22/W23.
- **Seed and fixtures:** yes, see Seed above. Skill `seed-and-fixtures` §1 and §4 run in W52.

## Schema during development
Payload migrations are generated once, in P11, by the spec that merges second (wave-orchestration §3; migration-safety check 5). Until then every phase that changes collections or globals (P3, P4, P5, P8, P9) uses a **throwaway stacked migration**. Nothing here touches another worktree's database.

1. Run this, from the worktree root, after the phase's collection edits:
   ```
   pnpm --dir server migrate:create spec04_wip_p<N>
   ```
   Payload diffs against the latest `.json` snapshot, so each WIP contains only that phase's delta. Never hand-edit it.
2. `pnpm --dir server migrate` migrates the worktree's main DB `t2f_spec_04_admin_catalog`. The `_test` DB is migrated automatically by `server/test/integration/global-setup.ts:27-29` on every integration run.
3. `pnpm --dir server generate:types && pnpm --dir server generate:importmap`, then `cd server && node scripts/verify-schema.mjs`.
   - **Trap:** on a fresh DB, `migrate` must run **before** `verify-schema`, or (a) reports pending migrations.
4. Dev schema push (`push: true`) is rejected. `payload migrate` asks an interactive question after a dev push, and `payload.config.ts:25` keeps `push: false`.
5. WIP files are never merged. P11 (W50) rolls them back on both own DBs, deletes them, and generates the one real migration. At the end of the run, `ls server/src/migrations | grep spec04_wip` must be empty.

## Dependency justification
Constitution IX and spec A-2 require a justification for every new dependency. Every version is exact (`.npmrc: save-exact=true`). All of them are added in P1 only.

| Dependency / service | Where | Version | Why | Alternative considered |
|---|---|---|---|---|
| `jose` | `server` | **5.10.0** — already in the tree as a dependency of `payload@3.91.0` (`node_modules/.pnpm/payload@3.91.0…/node_modules/jose`), so there is no new resolution | `jwtVerify` (RS256, `iss`, `aud`, `exp`); `createRemoteJWKSet` (`cooldownDuration` 30 s for AC-9, `cacheMaxAge` 10 min, `timeoutDuration` 5 s); `createLocalJWKSet`; `SignJWT`, `generateKeyPair`, `exportJWK` for the test signer. All exist in 5.10.0 (researcher, jose `src/jwks/remote.ts` @v5.10.0) | jose 6.2.17 (latest, 2026-11-09): a second copy in the lockfile. Upgrading later is small: the 6.0 breaks are the dropped Node ≤18, the removed `agent` option, and `CryptoKey` returned from `generateKeyPair` |
| `@aws-sdk/client-s3` | `server` | exact version at install, 3.x (3.1170.0 on 2026-11-17) | Writes the R2 copy (`PutObject`) and its tests (`GetObject`, `ListObjectsV2`). Cloudflare's R2 Node example uses it (`region: 'auto'`, R2 endpoint). Use `forcePathStyle: true` locally and `requestChecksumCalculation: 'WHEN_REQUIRED'` | `aws4fetch` 1.0.20: last release 2024-08-28, unmaintained; needs hand-written XML parsing for List |
| `@payloadcms/translations` | `server` | `3.91.0` | `import { uk } from '@payloadcms/translations/languages/uk'` for `i18n.supportedLanguages` (AC-30). It is already a transitive dependency of `payload`; it is made direct to avoid a phantom dependency under pnpm | none |
| `pngjs` | root `devDependencies` | **7.0.0** — already in the tree via `mapshaper` | PNG decode/encode for `compare-live` and its synthetic tests (AC-85, AC-86). The diff loop is hand-written: any channel > `tol` | Chromium canvas (as in `BT/diff.mjs`): too heavy for unit tests; `pixelmatch`: a new package with a different metric |
| **R2 emulator** `adobe/s3mock:5.2.3` | compose service `r2` | pinned tag (P1 records its digest) | S3-compatible, Apache-2.0, published 2026-09-19. Initial bucket by env `COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS=t2f-catalog`; path-style; README recommends `--memory=256m` for CI. Worktree isolation is a **key prefix** `<slug>/` in the one bucket (AC-74 allows a prefix) | MinIO: repo archived 2026-04-25, image pulls unreliable. LocalStack: needs an auth token since 2026-03. **Fallback** (W2 rule): `versity/versitygw:v1.11.0` (Go, posix backend), if s3mock exceeds 230 MiB idle or is OOM-killed under 256 MiB |

There is no other runtime dependency. Specifically there is no `@payloadcms/richtext-lexical`, no Payload localization tables (the content languages are group fields), and no `pixelmatch`.

## Work items

Commands in **Verify** lines:
- **server targeted** = in `server/`: `npx tsc --noEmit -p . && npx eslint --no-warn-ignored {files} && npx vitest related --run --maxWorkers=2 --passWithNoTests {files}` (config `files`).
- **server int `<file>`** = in `server/`: `node scripts/lock.mjs --mode shared -- npx vitest run -c vitest.integration.config.ts test/integration/<file>`.
  - **Trap:** `pnpm test:int -- <name>` does **not** filter (local-stack §1).
  - It needs `docker compose -p t2f up -d --wait postgres redis r2`, or `pnpm stack:up`.
- **web targeted** = the config `files` entry at `.`.
- **contracts targeted** = the config `files` entry at `packages/contracts`.
- **py `<pattern>`** = at `.`: `python -X utf8 -m unittest discover -s scripts/tests -p "<pattern>"`.

---

### P1 — dependencies, R2 emulator, env plumbing

### W1 — Every new dependency and the new server scripts (P1)
- **Serves:** enables AC-1…AC-10 (jose), AC-30 (translations), AC-72…AC-74 (S3 client), AC-85/86 (pngjs), AC-13/AC-75…AC-83 (scripts). This is the lockfile rule: new dependencies only in this phase.
- **Do:**
  - In `server/`, run `pnpm add --save-exact jose@5.10.0 @payloadcms/translations@3.91.0 @aws-sdk/client-s3`. At the root, run `pnpm add -D -w --save-exact pngjs@7.0.0`.
  - Append these scripts to `server/package.json`, after `env:check`:
    - `"import": "tsx src/cli/import.ts"`;
    - `"export": "tsx src/cli/export.ts"`;
    - `"owner:create": "tsx src/cli/createOwner.ts"`.

    The CLI files arrive in W17/W31/W33. Until then the scripts point at missing files, and that is expected.
- **Files:** `server/package.json`, `package.json`, `pnpm-lock.yaml`.
- **Done means:**
  - `node -e "require.resolve('jose',{paths:['server']})"` resolves 5.10.0;
  - there is no `^` or `~` in either `package.json`;
  - `pnpm install --frozen-lockfile` exits 0;
  - `git diff --stat master -- pnpm-lock.yaml` shows additions only for these four packages and their closure.
- **Verify:** `pnpm install --frozen-lockfile`; server targeted on `package.json` (tsc only).
- **Rules that apply:** `engineering-paved-path:security` → A06 (exact pins, no unused dependency); wave-orchestration §3 (lockfile).
- **Risk:** `@aws-sdk/client-s3` brings ~100 `@smithy/*` packages. It goes into `server` only, never the site.

### W2 — R2 emulator service in the stack (P1)
- **Serves:** AC-74, NFR-7; enables AC-72, AC-73.
- **Do:**
  - Append the service `r2` to `docker-compose.yml`:
    - `image: adobe/s3mock:5.2.3`, `restart: unless-stopped`;
    - `ports: ['127.0.0.1:9090:9090']`;
    - `environment: { COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS: t2f-catalog, JAVA_TOOL_OPTIONS: '-XX:MaxRAMPercentage=60 -Xss512k' }`;
    - `mem_limit: 256m` plus `deploy.resources.limits.memory: 256m` (same shape as `docker-compose.yml:38-42`).

    There is no in-image healthcheck, because whether the image has `curl`/`wget` is not established. `stack.mjs` probes from the host instead.
  - In `server/scripts/stack.mjs`, append `'r2'` to the `up` service list (`:55`). Append one smoke check: `GET http://127.0.0.1:9090/favicon.ico` → 200 within 30 s ("r2").
  - **Fallback rule.** After `pnpm stack:up`, run `docker stats --no-stream t2f-r2-1`. Switch to `versity/versitygw:v1.11.0` if memory exceeds 230 MiB, if the container is OOM-killed (`docker inspect … .State.OOMKilled`), or if the probe fails twice:
    - backend `posix /data`;
    - `ROOT_ACCESS_KEY`/`ROOT_SECRET_KEY` = the local dummy pair;
    - the bucket is a directory created by `command`;
    - port 7070 mapped to 9090.

    Record the switch in the phase report.
- **Files:** `docker-compose.yml`, `server/scripts/stack.mjs`.
- **Done means:**
  - `pnpm stack:up` leaves 5 services running;
  - `pnpm stack:smoke` prints `smoke 6/6`;
  - `docker inspect -f '{{.HostConfig.Memory}}' t2f-r2-1` = `268435456`;
  - idle memory from `docker stats --no-stream` is < 256 MiB (the value goes in the report).
- **Verify:** the commands above (stack only, no server build).
- **Rules that apply:** local-stack §5 (never `down -v`, never prune; the rule "No S3/R2 emulator in compose" ends with this wave, W56); security → A05 (loopback only, no committed secret).
- **Risk:** the JVM may not start under 256 MiB, in which case use the fallback. Other worktrees share the `t2f` project: `up` adds a service but does not recreate the others.

### W3 — Env blocks `access` and `catalog`, and worktree `.env.local` lines (P1)
- **Serves:** AC-74 (per-worktree prefix); enables AC-3, AC-4, AC-6, AC-7, AC-72.
- **Do:**
  - In `server/src/registries/env.ts`, add two blocks before `platform`, keeping the sort.

    `access` (each `requiredIn: ['rehearsal','production']`, except `T2F_ACCESS_SERVICE_CNS`, which is optional):
    - `T2F_ADMIN_HOST`: host[:port];
    - `T2F_ACCESS_TEAM_DOMAIN`: `https://…`;
    - `T2F_ACCESS_AUD`: non-empty;
    - `T2F_ACCESS_JWKS_URL`: a URL, or the literal `test-signer:`;
    - `T2F_OWNER_EMAILS`: comma list;
    - `T2F_ACCESS_SERVICE_CNS`: comma list.

    `catalog`:
    - `T2F_R2_ENDPOINT` (url, `isolated`);
    - `T2F_R2_BUCKET`;
    - `T2F_R2_PREFIX` (`^[a-z0-9_]+/$`);
    - `T2F_R2_ACCESS_KEY_ID` and `T2F_R2_SECRET_ACCESS_KEY` (both `secret: true`);
    - `T2F_CATALOG_RATE_PER_MIN` (default `30`).

    The R2 vars are `requiredIn: ['rehearsal','production']`.
  - In `server/scripts/db.mjs` `writeEnv`, append these lines (test values, not secrets):
    - `T2F_ADMIN_HOST=admin.localhost:<server port>`;
    - `T2F_ACCESS_TEAM_DOMAIN=https://t2f-test.invalid`;
    - `T2F_ACCESS_AUD=t2f-test-aud`;
    - `T2F_ACCESS_JWKS_URL=test-signer:`;
    - `T2F_OWNER_EMAILS=owner+<slug>@example.com,owner2+<slug>@example.com`;
    - `T2F_ACCESS_SERVICE_CNS=test-agent.access`;
    - `T2F_R2_ENDPOINT=http://127.0.0.1:9090`;
    - `T2F_R2_BUCKET=t2f-catalog`;
    - `T2F_R2_PREFIX=<slug>/`;
    - `T2F_R2_ACCESS_KEY_ID=t2f-local`;
    - `T2F_R2_SECRET_ACCESS_KEY=t2f-local-secret-0000`.

    Then re-run `pnpm db:create`. It keeps `PAYLOAD_SECRET` (`db.mjs:56-61`).
- **Files:** `server/src/registries/env.ts`, `server/scripts/db.mjs`, `server/test/unit/env-access-catalog.test.ts`.
- **Done means:**
  - the unit test shows `loadEnv` passes for the test-class `.env.local` values;
  - it fails naming `T2F_ACCESS_AUD` when that variable is absent in `production`;
  - `T2F_R2_SECRET_ACCESS_KEY` is in `secrets` (masked);
  - `pnpm --dir server env:check` exits 0.
- **Verify:** server targeted on the three files.
- **Rules that apply:** onion (registry sorted, `assertRegistry`); security → A02/A09 (secret flags so the logger masks them, `logger.ts:28`).
- **Risk:** low.

---

### LB1 — board tools (lane B, parallel with P2; web files only)

### W4 — `compare-live`, PNG diff library and mask overlay (LB1)
- **Serves:** AC-85, AC-86.
- **Do:**
  - `scripts/boards/lib/png.mjs`:
    - `diffPngs(refBuf, newBuf, { tol, masks })` → `{ pct, diffPng }`;
    - a pixel differs when any RGBA channel differs by more than `tol`;
    - images of different size are compared over the union, and the extra area counts as different;
    - masks are rectangles `[x, y, w, h]` painted opaque black in **both** images before comparing;
    - the diff PNG is the new image dimmed, with differing pixels red.
  - `scripts/boards/compare-live.mjs` takes `--ref <dir> --new <dir> --ids a,b|@file --tol 24 --out <dir> [--masks scripts/boards/masks.json]`. For each id it:
    - reads `<ref>/<id>.live.png` and `<new>/<id>.live.png`;
    - writes `<out>/<id>.fid.png`;
    - adds `{ id, pct, class }` to `<out>/compare-live.json`, where `class` is `pass` (≤0.1), `triage` (0.1–0.5) or `defect` (>0.5);
    - exits 1 if any id is a `defect` or is missing.
  - `scripts/boards/masks.json` is `{ "$comment": "…", "masks": { "<id glob>": [[x,y,w,h], …] } }`. It starts empty.
  - `scripts/boards/lib/manifests.mjs` is a read-only loader: `fs.readFileSync` only. Its manifest root is `BT/manifests`, or `T2F_BT_DIR`.
  - Tests in `tests/unit/boards/compare-live.test.ts` (node env) build synthetic 100×100 pairs with 5, 30 and 80 differing pixels (0.05 %, 0.3 %, 0.8 %). They expect three classes and three `.fid.png` files in a temp dir. A mask over the 30-pixel area gives `pass`.
  - `tests/unit/boards/readonly.test.ts` asserts that no `scripts/boards/**` source contains `writeFile`, `appendFile`, `rm`, `rename` or `copyFile` with a path built from the manifest root. It does this with a regex over the source text plus an allowlist of the `--out` writes.
- **Files:** `scripts/boards/lib/png.mjs`, `scripts/boards/lib/manifests.mjs`, `scripts/boards/compare-live.mjs`, `scripts/boards/masks.json`, `tests/unit/boards/compare-live.test.ts`, `tests/unit/boards/readonly.test.ts`.
- **Done means:** both tests pass, and `node scripts/boards/compare-live.mjs --help` exits 0.
- **Verify:** web targeted on the six files.
- **Rules that apply:** layout-fidelity §1: never raise `--tol` or the thresholds; dynamic regions get masks.
- **Risk:** low.

### W5 — `http-seeds` (LB1)
- **Serves:** AC-84.
- **Do:**
  - `scripts/boards/http-seeds.mjs` takes `--manifest <path>|--all --server http://127.0.0.1:<port> [--dry]`.
  - It collects every **named** seed (string) used by the manifests' `defaults.seed` and `states[].seed`, including names inside arrays. Inline object seeds are client-side `localStorage` (applied by `snapshot.mjs:562-563`) and are listed as `client-only`.
  - It maps each name through `SEED_MAP`, which holds `fresh`, `guest`, `user`, `pass`, `nick` and `authOther`. Each one maps to a list of door calls. In this wave every list is `[{ door: 'reset' }]`, because the server state they need is the catalog only: users, passes and stamps are still `sim` and not served by this wave's server.
  - Unknown name → exit 1 printing `unknown seed: <names>`.
  - Without `--dry` it calls `POST <server>/api/_test/reset` once per run.
  - Test `tests/unit/boards/http-seeds.test.ts`:
    - every seed name in `BT/manifests/*.json` has an entry (read-only, via `lib/manifests.mjs`);
    - a fixture manifest with `"seed": "nope"` gives exit 1 and prints `nope`.
- **Files:** `scripts/boards/http-seeds.mjs`, `tests/unit/boards/http-seeds.test.ts`.
- **Done means:** the test passes, and `node scripts/boards/http-seeds.mjs --all --dry` lists the 6 names and exits 0.
- **Verify:** web targeted.
- **Rules that apply:** seed-and-fixtures §2 (names = manifest seeds; values from sim, not retyped).
- **Risk:** later waves extend `SEED_MAP`. Each extension must keep the "all names mapped" test green.

### W6 — Playwright config for `http` (LB1)
- **Serves:** AC-87.
- **Do:**
  - Add `playwright.http.config.ts` at the root:
    - `testDir: './tests/e2e'`, `workers: 2`, `fullyParallel: true`;
    - projects `phone`/`desktop`, same viewports as `playwright.config.ts:8-11`;
    - `baseURL: http://127.0.0.1:${T2F_WEB_PORT}`, read from `server/.env.local` (parsed like `global-setup.ts:8-16`), or `T2F_E2E_BASE`;
    - **no** `webServer`: the integration build and the server are started by `pnpm build:int`/`pnpm serve:int`/`pnpm stack` (W53);
    - `testIgnore: /.*\.prod\.spec\.ts/`.
  - Add `tests/unit/boards/http-config.test.ts`, which imports the config and asserts `workers <= 2` and no `webServer`.
- **Files:** `playwright.http.config.ts`, `tests/unit/boards/http-config.test.ts`.
- **Done means:** the test passes. One real run through it happens in W53, step 5.
- **Verify:** web targeted.
- **Rules that apply:** sdd-routing §7 (Playwright `--workers=2`).
- **Risk:** low.

### LB2 — tzdb tools (lane B, parallel with P3; web files only)

### W7 — Generator check on the pinned tzdb (LB2)
- **Serves:** AC-50.
- **Do:**
  - Add `--out <dir>` to `scripts/build_schedule.py`. The default output stays the current `data/` path (`:27`, `:228`), and nothing else changes.
  - Add `scripts/tests/test_tzdb_generator.py` (unittest). It runs the generator with `--out <tempdir>` and asserts:
    - the output has 38 zones;
    - every `midnightUtc` and `offsetMinutes`, and `tzdbVersion` (`2026f`), equal those in `data/schedule.json`;
    - the zone moments are not read from any input (the seed files hold no `midnightUtc`: grep).

    It fails, and does not skip, when `tzdata.IANA_VERSION != '2026f'`.
- **Files:** `scripts/build_schedule.py`, `scripts/tests/test_tzdb_generator.py`.
- **Done means:**
  - `py "test_tzdb_generator.py"` passes;
  - `git diff --stat master -- data/` is empty after the run.
- **Verify:** py `test_tzdb_generator.py`.
- **Rules that apply:** constitution II (time from tzdb only).
- **Risk:** low. The test needs `tzdata==2026.6` (`scripts/requirements.txt`).

### W8 — tzdb discrepancy report (LB2)
- **Serves:** AC-51, AC-52 (tool and first baseline report).
- **Do:**
  - Add `scripts/tzdb_report.py`, run as `python -X utf8 scripts/tzdb_report.py --source data|<url of GET /api/catalog> [--out docs/tzdb-reports]`. It:
    - computes each zone's offset and midnight with the **installed** `tzdata`, reusing the generator's functions by import;
    - compares them with the source's `zones`;
    - writes `docs/tzdb-reports/<YYYY-MM-DD>-<tzdb>.md`, a table of the zones that differ, or "no differences";
    - exits 0 with no differences and 1 with differences;
    - never writes the source.
  - Add `scripts/tests/test_tzdb_report.py`, with fixture `scripts/tests/fixtures/tzdb/shifted.json` (one zone's offset +30 min). The fixture gives exit 1 and one row; the unchanged `data/` gives exit 0 and an empty table. Both runs write to a tempdir.
  - Commit-ready baseline: run it once with `--source data`, writing `docs/tzdb-reports/2026-11-17-2026f.md`.
- **Files:** `scripts/tzdb_report.py`, `scripts/tests/test_tzdb_report.py`, `scripts/tests/fixtures/tzdb/shifted.json`, `docs/tzdb-reports/2026-11-17-2026f.md`.
- **Done means:**
  - `py "test_tzdb_report.py"` passes;
  - the baseline report exists and says "no differences";
  - the `data/` diff is empty.
- **Verify:** py `test_tzdb_*.py`.
- **Rules that apply:** spec Untrusted inputs: tzdb differences are reported, never applied.
- **Risk:** low. The report against `GET /api/catalog` is exercised in W53 step 4.

---

### P2 — Access gate (spikes first)

### W9 — Spike OQ-2: Payload admin client on `admin.localhost` (P2, first item)
- **Serves:** enables AC-1, AC-6, AC-12 (resolves OQ-2).
- **Do:**
  - Use `pnpm stack` (server on the slot port), then run Playwright via `pnpm --dir server test:e2e` with a throwaway spec `server/test/e2e/spike-admin-host.e2e.ts`. It opens `http://admin.localhost:<port>/admin` (Chromium resolves `*.localhost` to loopback) and records every request URL the admin client makes during login and the dashboard.
  - **Question:** are the fetches relative (same host) or absolute to `serverURL`/`localhost`?
  - **If relative:** leave `serverURL` unset locally. The gate needs no CORS.
  - **Fallback, written in advance (absolute):**
    - set `serverURL: 'http://' + T2F_ADMIN_HOST` (test) or `https://` (rehearsal/production) in `payload.config.ts`, as one line;
    - Payload then adds it to `csrf` (research-access-payload §8);
    - the gate keeps checking the Access JWT on that host only.
  - Record the result in `## Deviations` of the phase report. Delete the spike spec at the end of the phase.
- **Files:** `server/test/e2e/spike-admin-host.e2e.ts` (temporary), possibly one line in `server/src/payload.config.ts`.
- **Done means:** the report states "relative" or "absolute" with 3 sample URLs, and which branch W14 uses.
- **Verify:** the spike run itself. **Trap:** warm `/admin` once with `curl` before Playwright, because a cold `next dev` gives false failures.
- **Rules that apply:** next (proxy runs before routes).
- **Risk:** the Payload admin may need cookies on `admin.localhost`. They are host-only by default, which is fine.

### W10 — Spike OQ-3: does Payload `access.admin` / `beforeOperation` see request headers? (P2)
- **Serves:** enables AC-5 (resolves OQ-3).
- **Do:**
  - Write a throwaway integration test `server/test/integration/spike-guard.int.test.ts`. It registers, through `createDeps` + `payloadOf`, a temporary collection config with `access.admin`, `access.read` and `hooks.beforeOperation` that record `req.headers.get('x-t2f-probe')`. It then calls the REST handler `REST_GET(config)` from `@payloadcms/next/routes` directly with a `Request` that carries the header.
  - **Answer:** which of `access.admin`, `access.read`, `beforeOperation` and `admins.hooks.beforeLogin` see the headers.
  - **Decision for W15:**
    - **if `beforeOperation` sees headers:** the second check is a `beforeOperation` hook (+ `beforeLogin`) on every collection, plus `access.admin` on `admins`;
    - **fallback:** if no Payload hook sees headers, the second check moves into `server/src/app/(payload)/cms-api/[...slug]/route.ts` and the `(payload)` layout's `serverFunction`, which wrap `REST_*`/`handleServerFunctions` and verify the marker before delegating. This is a wrapper only; the Payload template behaviour is unchanged.
  - Delete the spike test at the end of the phase.
- **Files:** `server/test/integration/spike-guard.int.test.ts` (temporary).
- **Done means:** the report names the chosen location of the second check with evidence (the recorded header values).
- **Verify:** server int `spike-guard.int.test.ts`.
- **Rules that apply:** architecture.md "Payload": hooks thin.
- **Risk:** low.

### W11 — Access configuration and the boot refusal (P2)
- **Serves:** AC-7.
- **Do:**
  - Add `server/src/domain/access/config.ts`, a pure `parseAccessConfig(env, cls)` that returns `{ ok: true, config } | { ok: false, failing: string[] }`. In `rehearsal`/`production` it refuses when any of these holds:
    - a required var is missing;
    - `T2F_ACCESS_JWKS_URL` is `test-signer:`, not `https:`, or its host does not end with `.cloudflareaccess.com`;
    - `T2F_ACCESS_TEAM_DOMAIN` host ends with `.invalid`;
    - `T2F_ACCESS_JWKS_URL` does not start with `T2F_ACCESS_TEAM_DOMAIN + '/cdn-cgi/access/certs'`.

    In `test` it allows `test-signer:` and `http://127.0.0.1:*`.
  - Call it in `server/src/instrumentation.ts` (exit 1 with `env: invalid <names>`) and in `server/src/platform/env.check.ts`. Each call is appended after the existing check.
  - The container builds `AccessConfig` once.
- **Files:** `server/src/domain/access/config.ts`, `server/src/instrumentation.ts`, `server/src/platform/env.check.ts`, `server/test/unit/access-config.test.ts`, `server/test/integration/access-boot.int.test.ts`.
- **Done means:**
  - the unit test covers the matrix (missing `aud`, test JWKS in production, test issuer in rehearsal → named);
  - the integration test spawns `npx tsx src/platform/env.check.ts` with `T2F_ENV=production T2F_ACCESS_JWKS_URL=test-signer: …` and gets exit ≠0 with `T2F_ACCESS_JWKS_URL` in stderr;
  - without `T2F_ACCESS_AUD` the same happens, naming it.
- **Verify:** server targeted; server int `access-boot.int.test.ts`.
- **Rules that apply:** security → A05 (fail closed); onion (ring 1 pure).
- **Risk:** low.

### W12 — JWT verifier, JWKS refresh, test signer and its door (P2)
- **Serves:** AC-2, AC-8, AC-9, AC-10; part of AC-4 (claims), NFR-5 (JWT never logged).
- **Do:**
  - `server/src/access/ports.ts` defines:
    - `AccessVerifier.verify(token)` → `{ ok: true, claims: { sub, email?, common_name?, iss, aud, exp } } | { ok: false, reason: 'missing'|'invalid'|'jwks-unreachable' }`;
    - `IdentityMarker`;
    - `DenyLog`.
  - `server/src/adapters/accessJwt.ts`:
    - uses `jwtVerify(token, jwks, { algorithms: ['RS256'], issuer: teamDomain, audience: aud })`;
    - `jwks` = `createRemoteJWKSet(new URL(url), { cooldownDuration: 30_000, cacheMaxAge: 600_000, timeoutDuration: 5_000 })`, or the test signer's `createLocalJWKSet` when `test-signer:`;
    - `nbf` is not required;
    - a JWKS fetch error (`JWKSTimeout` or a network error) on an unknown `kid` → `jwks-unreachable` and `alarm.raise({ level: 'log', source: 'access', code: 'access-jwks-unreachable' })`;
    - no error message containing the token is ever logged.
  - `server/src/adapters/testSigner.ts` (test class only):
    - one process-wide RS256 key set on `globalThis[Symbol.for('t2f.testSigner')]`;
    - `sign({ kind, email?, commonName?, aud?, iss?, expiresInSec?, kid? })`;
    - a person token gets `sub` = random and `email`; a service token gets `sub: ''` and `common_name`;
    - `addKey()` rotates in a new `kid`, for tests.
  - The door row `access-token` in `server/src/test-doors/registry.ts`: `POST /api/_test/access-token`, body schema in the door file (spec:538 shape) → `{ token }`. The signer is loaded only from the doors module.
  - Integration test `server/test/integration/access-jwt.int.test.ts`:
    - (AC-2) six tokens, each with one violation (bad signature, unknown `kid`, HS256, foreign `iss`, foreign `aud`, past `exp`) → `invalid`;
    - (AC-9) a local JWKS HTTP server on an ephemeral loopback port with key A. Add key B; a token signed with B is accepted on the first call after ≥30 s. Use `vi.useFakeTimers` only for the test's own waits; jose's cooldown uses real time, so the test waits 30.5 s (`testTimeout` 45 s);
    - (AC-10) stop the JWKS server; a new-`kid` token → `jwks-unreachable` and one alarm line;
    - (AC-8) the door returns a token that passes the verifier.
- **Files:** `server/src/access/ports.ts`, `server/src/adapters/accessJwt.ts`, `server/src/adapters/testSigner.ts`, `server/src/test-doors/registry.ts`, `server/test/integration/access-jwt.int.test.ts`.
- **Done means:**
  - the integration test passes;
  - `grep -rn "eyJ" server/src` is empty;
  - `grep -n "testSigner" server/src` hits only `test-doors/**` and the `test-signer:` branch of `container.ts`, which uses a dynamic `import()`.
- **Verify:** server targeted; server int `access-jwt.int.test.ts`.
- **Rules that apply:** security → A07 (verify `alg`, `iss`, `aud`, `exp`), A09 (no token in logs); architecture.md "Дверцята" (test class only).
- **Risk:** the JWKS test's 30 s wait. Keep it in one test case.

### W13 — Owner email list (P2) — **owner-dependent: Q2**
- **Serves:** AC-3.
- **Do:**
  - Add `server/src/domain/access/ownerEmails.ts`:
    - `parseOwnerEmails(raw)` returns a list of 1–2 lower-cased emails, else fails naming `T2F_OWNER_EMAILS`;
    - `isOwnerEmail(list, email)` uses a case-insensitive exact match.

    **Q2 decides** the count (main + 1 reserve). A different answer changes only `MAX_OWNER_EMAILS` and this file.
  - Add a unit test, and an integration case in `access-gate.int.test.ts` (W14): a foreign email → 403; the main and the reserve email → pass.
- **Files:** `server/src/domain/access/ownerEmails.ts`, `server/test/unit/owner-emails.test.ts`.
- **Done means:** the unit test passes (3 emails → fails; mixed case → match).
- **Verify:** server targeted.
- **Rules that apply:** onion ring 1.
- **Risk:** low.

### W14 — The gate: Next proxy, host rule, service path rule, deny log (P2)
- **Serves:** AC-1, AC-4, AC-6, NFR-8, NFR-1 (budget); evidence for the card bullet "відмова навіть з паролем Payload".
- **Do:**
  - Add `server/src/domain/access/classify.ts` (ring 1):
    - `classify(claims, config)` returns `person-owner | person-foreign | service-allowed | service-foreign`;
    - `decide({ path, host, adminHost, verified })` returns `pass | deny403 | notFound404`, with these rules:
      - `/api/*` → `pass`, untouched;
      - `/admin*` or `/cms-api*` with `host ≠ adminHost` → `notFound404`;
      - any other non-`/api` path without a valid JWT → `deny403`;
      - a service token on a path that is not `/cms-api/*` → `deny403`.
  - Add `server/src/access/gate.ts` (ring 3), which composes the verifier, `classify` and `decide`. On a pass it returns the identity to mark.
  - `DenyLog` adapter: a single `log.warn({ event: 'access-deny', reason })`, throttled to ≤1 line per second per reason. It has no token and no email.
  - `server/src/adapters/identityMarker.ts`: an HMAC-SHA256 over `kind|subject|exp`, using a 32-byte key generated per process on `globalThis`. `sign(identity)` → header value; `verify(value)` → identity | null.
  - `server/src/proxy.ts` (Next 16 `proxy`, default Node runtime, `export const config = { matcher: ['/((?!api/).*)'] }`). It:
    - deletes inbound `x-t2f-access-identity`;
    - runs the gate;
    - on `deny403` returns `new Response(null, { status: 403 })`;
    - on `notFound404` returns `NextResponse.rewrite(new URL('/__t2f-not-found', req.url))`, so Next's own 404 is byte-identical to an unknown path;
    - on `pass` returns `NextResponse.next({ request: { headers } })` with the signed marker.
  - Use the W9 branch for `serverURL`.
  - Integration test `server/test/integration/access-gate.int.test.ts` calls the exported `proxy(req)` directly:
    - no JWT, but a valid Payload cookie, on `/admin` and `/cms-api/admins/me` → 403 with empty body;
    - with a JWT → `next`;
    - an agent API-key header without a JWT → 403;
    - (AC-4) a service JWT on `/admin` → 403; a foreign `common_name` on `/cms-api` → 403; an allowed one → `next`;
    - (AC-6) `Host: time2fest.com` on `/admin` and `/cms-api/admins` → a rewrite to the not-found path;
    - (NFR-8) 50 denials in 5 s with one reason → ≤5 lines, and the token and email are absent from them.

    An e2e assertion that "404 is identical to an unknown path" (body + headers) is in `server/test/e2e/access.e2e.ts`, run in W53.
  - (NFR-1) Add a case that calls `proxy` 200× with a warm JWKS and computes p95 of its own duration. It prints the value and asserts ≤20 ms.
- **Files:** `server/src/domain/access/classify.ts`, `server/src/access/gate.ts`, `server/src/adapters/identityMarker.ts`, `server/src/proxy.ts`, `server/test/integration/access-gate.int.test.ts`, `server/test/e2e/access.e2e.ts`.
- **Done means:**
  - the integration test passes;
  - `grep -n "Cf-Access-Jwt-Assertion\|cf-access-jwt-assertion" server/src/proxy.ts` hits (the header, not the cookie);
  - `grep -rn "CF_Authorization" server/src` is empty.
- **Verify:** server targeted; server int `access-gate.int.test.ts`.
- **Rules that apply:** next → Proxy (Node runtime, do not rely on the proxy alone, hence W15); security → A01 (deny by default), A07; research-access-payload §1, §7.
- **Risk:** the matcher must not skip `/_next/*` assets of the admin, because they must also be gated. Admin static assets with no JWT → 403 is acceptable behind Access.

---

### P3 — second Payload check, roles and keys

### W15 — Second check inside Payload (P3)
- **Serves:** AC-5; second half of AC-1.
- **Do:**
  - Add `server/src/access/payloadGuard.ts` with `harden(row)`. Using the W10 outcome, it adds:
    - `hooks.beforeOperation` (or the route wrapper, if W10 took the fallback), which throws `Forbidden` unless `identityMarker.verify(req.headers.get('x-t2f-access-identity'))` is non-null **or** `req.context.t2fTrusted` is set by a server-side caller (local API in CLI, seed, services);
    - `access.admin` on `admins`, which requires the marker;
    - `hooks.beforeLogin` on `admins`, which requires the marker.

    Server-side local-API callers pass `context: { t2fTrusted: true, t2fActor }` and `overrideAccess` only where a service writes.
  - Change `server/src/payload.config.ts` (one line): `collections: collectionRegistry.map((r) => harden(r))`. Add the `globals:` line the same way, over the new `server/src/registries/globals.ts` (initially `[]`).
  - Integration test `server/test/integration/access-payload.int.test.ts` calls `REST_GET(config)` for `/cms-api/admins/me` directly, bypassing the proxy, with a valid login cookie and no marker → refused. With a valid marker → 200. Login without the marker → refused.
- **Files:** `server/src/access/payloadGuard.ts`, `server/src/payload.config.ts`, `server/src/registries/globals.ts`, `server/test/integration/access-payload.int.test.ts` (+ the 2 route-wrapper files if the W10 fallback applies).
- **Done means:** the test passes, and `grep -n "harden" server/src/payload.config.ts` has one hit.
- **Verify:** server targeted; server int `access-payload.int.test.ts`.
- **Rules that apply:** security → A01 (defence in depth); ms (the config change has no schema effect).
- **Risk:** the seed, CLI and services must pass `t2fTrusted`, or they are locked out. W17/W31/W32 tests catch this.

### W16 — Payload session 24 h (P3) — **owner-dependent: Q1**
- **Serves:** AC-12.
- **Do:** in `server/src/collections/admins.ts`, set `auth.tokenExpiration: 86_400` (Q1). The cookie lifetime follows `tokenExpiration` in Payload. If a different Q1 answer removes the Payload password, this item becomes `auth.disableLocalStrategy` plus an Access-identity strategy, and changes only here.
- **Files:** `server/src/collections/admins.ts`, `server/test/integration/session.int.test.ts`.
- **Done means:**
  - after login through `REST_POST` (`/cms-api/admins/login`, with the marker), the JWT has `exp − iat` = 86 400 ± 60;
  - the `Set-Cookie` `Expires`/`Max-Age` is 24 h ± 1 min.
- **Verify:** server int `session.int.test.ts`.
- **Rules that apply:** ms (no schema change).
- **Risk:** low.

### W17 — No first-register screen; `owner:create` command (P3)
- **Serves:** AC-13.
- **Do:**
  - The proxy rule refuses `/admin/create-first-user` and `/cms-api/admins/first-register` with 404 (through `decide`), in every class.
  - An `admins` `beforeChange` hook refuses `operation === 'create'` without `req.user?.role === 'owner'` and without `context.t2fTrusted`.
  - `server/src/cli/createOwner.ts`, run as `pnpm --dir server owner:create --email <e>`:
    - it reads the password from stdin (no echo, never printed);
    - it refuses with exit 2 when any `owner` exists;
    - it requires the email to be in `T2F_OWNER_EMAILS`;
    - it journals with actor `system:owner-create` once W22 lands. Until then a TODO-free no-op port is wired by the container.
- **Files:** `server/src/cli/createOwner.ts`, `server/src/domain/access/classify.ts` (path rule), `server/src/collections/admins.ts`, `server/test/integration/first-user.int.test.ts`.
- **Done means:**
  - on an empty `admins`, `GET /admin/create-first-user` through the proxy → 404;
  - REST first-register → refused;
  - the command creates the owner (exit 0), and a second run gives exit ≠0.
- **Verify:** server int `first-user.int.test.ts`.
- **Rules that apply:** security → A07, A04.
- **Risk:** low.

### W18 — Roles, agent password refusal, role policy (P3)
- **Serves:** AC-14, AC-17, AC-18 (policy base).
- **Do:**
  - Add the `admins` field `role`: select `owner | content-agent | stream-agent`, required, `defaultValue: 'owner'`. The default only matters for a pre-existing row (Assumptions). AC-14 blocks a second owner.
  - `beforeChange`: refuse a create or update that results in a second `owner`, or that changes any record **to** `owner`, from any actor except `owner:create`.
  - `beforeLogin`: refuse when `user.role !== 'owner'` (AC-17).
  - Add `server/src/domain/access/roles.ts`: a pure policy table `can(role, collectionGroup, op)`, where `collectionGroup ∈ catalog | corrections | audit | keys | unattended | alarms | test`. Agents may only `read` `catalog`.
  - Add `server/src/access/policies.ts`, a helper returning Payload `access` functions from the table, for use by every collection in this wave.
  - Payload has no "role enum" outside the select, so a role name outside it is refused by validation.
- **Files:** `server/src/collections/admins.ts`, `server/src/domain/access/roles.ts`, `server/src/access/policies.ts`, `server/test/unit/roles.test.ts`, `server/test/integration/roles.int.test.ts`.
- **Done means:**
  - the unit test covers the policy table;
  - the integration test:
    - owner → set another record to `owner` → refused;
    - agent → create `owner` → refused;
    - role `admin` → validation refused;
    - `content-agent` login by password → refused;
    - the agent matrix on `admins`/`audit-log`/`agent-test-posts` → refused (the catalog part of the matrix is in W25).
- **Verify:** server targeted; server int `roles.int.test.ts`.
- **Rules that apply:** security → A01 (least privilege); onion (policy is ring 1).
- **Risk:** low.

### W19 — Agent API keys: issue once, revoke instantly (P3)
- **Serves:** AC-15, AC-16, NFR-5 (keys).
- **Do:**
  - On `admins`, set `auth.useAPIKey: true`, with field-level `access.read: () => false` on `apiKey`/`enableAPIKey` for every role. The API-key strategy looks up by `apiKeyIndex` internally and does not need read access (research-access-payload §14).
  - Add `server/src/access/keys.ts` (ring 3) and a Payload custom endpoint on `admins`:
    - `POST /cms-api/admins/:id/issue-key` (owner only, agent records only) generates 32 random bytes as base64url, sets `enableAPIKey: true` and `apiKey`, journals `key.issue` **without** the value, and returns `{ key }` once;
    - `POST /cms-api/admins/:id/revoke-key` sets `enableAPIKey: false` and `apiKey: null` and journals `key.revoke`.
  - Agents send `Authorization: admins API-Key <key>` plus the service-token JWT header.
  - Integration test `server/test/integration/keys.int.test.ts`:
    - issue → reads by the owner and by the agent do not contain the value;
    - a request with the key (and a service JWT through the proxy) → 200;
    - revoke → the next request is refused;
    - the captured logger lines and journal rows do not contain the value. The journal assertion is enabled after W22; until then it checks the logger only, and W22 extends it.
- **Files:** `server/src/collections/admins.ts`, `server/src/access/keys.ts`, `server/test/integration/keys.int.test.ts`.
- **Done means:** the test passes, and a search for the key string in captured output → 0 hits.
- **Verify:** server int `keys.int.test.ts`.
- **Rules that apply:** security → A02 (secret shown once), A09; research §14 (changing `PAYLOAD_SECRET` voids keys → Docs patch for SPEC-13a).
- **Risk:** Payload may echo `apiKey` in the update response. `afterRead` removal plus field access covers both.

### W20 — `agentPublish` switch and the test collection (P3)
- **Serves:** AC-19.
- **Do:**
  - Add the global `server/src/globals/adminSettings.ts` (`admin-settings`) with `agentPublish: checkbox`, default `true`. Owner only; agents may not read it.
  - Add the collection `server/src/collections/agentTestPosts.ts` (`agent-test-posts`, `admin.hidden: true`):
    - fields `title` and `status` (`draft | published | proposal`);
    - access: create/update for agents **only in the test class** (`envClass === 'test'`), else `() => false`;
    - a `beforeChange` hook: if the actor is an agent and `status === 'published'` and `agentPublish` is false (read fresh per request, no cache), it sets `status = 'proposal'`.
  - Add one row in `registries/collections.ts` and one in `registries/globals.ts`.
  - Throwaway migration `spec04_wip_p3` (see `## Schema during development`).
- **Files:** `server/src/globals/adminSettings.ts`, `server/src/collections/agentTestPosts.ts`, `server/src/registries/collections.ts`, `server/src/registries/globals.ts`, `server/src/migrations/*spec04_wip_p3*` (gen.), `server/src/payload-types.ts` (gen.), `server/test/integration/agent-publish.int.test.ts`.
- **Done means:**
  - with the switch on, the agent's publish → `published`;
  - after turning it off between two requests, the second → `proposal`;
  - `node scripts/verify-schema.mjs` exits 0 after `pnpm --dir server migrate`.
- **Verify:** server targeted; server int `agent-publish.int.test.ts`; `verify-schema`.
- **Rules that apply:** ms (WIP only; check 1 at P11); security → A01.
- **Risk:** low.

---

### P4 — internal events, journal, revert, alarms

### W21 — Internal events: outbox, delivery to every instance, subscriber registry (P4)
- **Serves:** AC-40, AC-41, AC-42 (mechanism).
- **Do:**
  - Add the collection `internal-events` (hidden, access `() => false`): `topic` (text, index), `version` (number), `payload` (json), `committedAt` (date).
  - Add `server/src/events/ports.ts`:
    - `EventPublisher.publish(tx, topic, payload)`, which writes inside the caller's transaction;
    - `EventSubscriber`, a row of `registries/subscribers.ts`: `{ key, topic, handle(event) }`, sorted.
  - Add `server/src/adapters/pgEvents.ts`:
    - `publish` runs, on the **transaction's connection**, `SELECT pg_advisory_xact_lock(<topic hash>)`, then inserts the outbox row (the `id` bigserial is the global version, and the per-topic `version` = max + 1 under the lock), then `SELECT pg_notify('t2f_<slug>_events', id)`;
    - Postgres delivers `NOTIFY` only on commit and drops it on rollback, which gives AC-41;
    - a listener: one dedicated `pg.Client` per process `LISTEN`s on the channel, and a 500 ms poll of `id > lastSeen` covers lost notifications;
    - each new row is dispatched to the matching subscriber rows, in order, at most once per process (`lastSeen` in memory, starting at the max id at boot).
  - `startBackground(deps)` is called from `instrumentation.ts` (nodejs runtime, not under `next build`) and from integration helpers.
  - Add a test subscriber row, present only in the `test` class, that records events in memory (`globalThis`).
- **Files:** `server/src/collections/internalEvents.ts`, `server/src/events/ports.ts`, `server/src/events/bus.ts`, `server/src/adapters/pgEvents.ts`, `server/src/registries/subscribers.ts`, `server/src/registries/collections.ts`, `server/src/instrumentation.ts`, `server/src/container.ts`, `server/test/integration/events.int.test.ts`.
- **Done means:**
  - publish inside a committed transaction → the test subscriber receives the event ≤2 s later, with an increasing `version`;
  - a transaction that throws after `publish` → no event within 3 s (AC-41);
  - three publishes before a subscriber starts → reading the state port gives the last version (completed per topic in W35).

  The two-instance proof (AC-40) is `server/test/exclusive/events-two-instances.exclusive.test.ts`. It starts two `next start`/`serve` processes on two ports against the same `_test` DB, and runs in W53 under the exclusive lock.
- **Verify:** server targeted; server int `events.int.test.ts`.
- **Rules that apply:** onion (ports in ring 2; `pg` only in the adapter); architecture.md "Пул Postgres" (the listener client has an `error` handler and reconnects).
- **Risk:** running SQL on Payload's transaction connection (`req.transactionID` → `payload.db.sessions[id]`) is an internal API. **Fallback:** the outbox insert goes through Payload `create` with `req` (same transaction), and `NOTIFY` is dropped. The poll alone still meets 2 s, and the advisory lock is then taken through `payload.db.drizzle.execute` within the session.

### W22 — Audit journal in the same transaction (P4)
- **Serves:** AC-20, AC-21, NFR-6, NFR-5 (journal side).
- **Do:**
  - Add the collection `audit-log`:
    - fields: `actor { kind: owner|agent|system, id, label }`, `action`, `target { collection, id }`, `at` (from `deps.clock`), `before` (json), `after` (json), `revertOf` (text, nullable), `revertible` (checkbox, computed at write);
    - access: `read` owner only; `create`/`update`/`delete` → `() => false` for every role (writes only through the journal port with `overrideAccess` and `req`).
  - Add `server/src/audit/ports.ts` (`Journal.append(tx, entry)`), `server/src/audit/journal.ts` (actor resolution from `req.user`, the API-key user, or `context.t2fActor`) and `server/src/audit/hooks.ts`:
    - an `afterChange`/`afterDelete` hook factory that appends one row with `before = previousDoc`, `after = doc`, on the same `req`, so the same transaction;
    - a hook error rethrows, so Payload rolls the whole transaction back.
  - `CollectionRow` in `registries/collections.ts` gains the optional `audited?: true` (additive), and `harden` attaches the hooks to audited rows.
  - Mark `admins` and `agent-test-posts` audited.
  - Wire `createOwner` and `keys` to the journal.
  - Static NFR-6 check: `grep -rnE "audit-log.*delete|deleteMany|delete\(\{ *collection: 'audit-log'" server/src` is empty.
- **Files:** `server/src/collections/auditLog.ts`, `server/src/audit/ports.ts`, `server/src/audit/journal.ts`, `server/src/audit/hooks.ts`, `server/src/registries/collections.ts`, `server/src/access/payloadGuard.ts`, `server/test/integration/journal.int.test.ts`.
- **Done means:**
  - one write to `agent-test-posts` → exactly one journal row with every field filled;
  - a simulated journal failure (test-only port override that throws) → the data row is absent;
  - the owner updating or deleting a journal row via REST → refused;
  - key issue/revoke rows exist and have no value (extends W19's test).
- **Verify:** server targeted; server int `journal.int.test.ts` and `keys.int.test.ts`.
- **Rules that apply:** security → A08/A09 (tamper-proof audit); onion.
- **Risk:** Payload `afterChange` runs inside the operation's transaction only when `req` is passed through. Every service must pass `req` (stated in the port's doc comment).

### W23 — Revert engine (P4)
- **Serves:** AC-22, AC-23, AC-24, AC-25.
- **Do:**
  - Add `server/src/domain/audit/revert.ts` (ring 1): `canRevert(entry, currentValue)` → `ok | 'changed-since'`, using a deep compare of the fields present in `after`.
  - Add `server/src/registries/revertHandlers.ts`: rows `{ key: <action kind>, revert(tx, entry) }`, sorted. The generic `collection.update` handler restores `before` through Payload `update` with `req`, so a new journal row is written by the hook. It is marked `revertOf: <id>` through `context.t2fRevertOf`.
  - Add `server/src/audit/revert.ts` (ring 3):
    - owner only (else `forbidden`);
    - no handler → `not-revertible`;
    - a check failure → `changed-since`;
    - else the handler runs in one transaction.
  - Add the Payload endpoint `POST /cms-api/audit-log/:id/revert` on `audit-log`, returning `ApiResult`.
  - `revertible` on new rows is `revertHandlers.has(action)`.
- **Files:** `server/src/domain/audit/revert.ts`, `server/src/audit/revert.ts`, `server/src/registries/revertHandlers.ts`, `server/src/collections/auditLog.ts`, `server/test/unit/revert.test.ts`, `server/test/integration/revert.int.test.ts`.
- **Done means:**
  - change → revert → value = before; revert of the revert → value = after; three linked rows;
  - change A, change B, revert A → `changed-since` and the value stays B;
  - a test kind without a handler → `not-revertible`, `revertible: false`;
  - an agent key → `forbidden`.
- **Verify:** server targeted; server int `revert.int.test.ts`.
- **Rules that apply:** onion (rule in ring 1); security → A01.
- **Risk:** low.

### W24 — Alarm store, acknowledge, alarm door (P4)
- **Serves:** AC-37, AC-38 (server), AC-39.
- **Do:**
  - Add the collection `alarms`: `source`, `code`, `level` (`page`), `raisedAt`, `acknowledgedAt` (nullable). Owner read; writes through the service only.
  - Add `server/src/alarms/ports.ts` (`AlarmStore.save`, `listOpenPage`, `acknowledge`), `server/src/adapters/payloadAlarms.ts` and `server/src/alarms/service.ts` (`acknowledge(id, actor)`, which sets `acknowledgedAt = clock.now()` and journals in one transaction).
  - Change `createAlarm(logger, store?)` in `server/src/platform/logger.ts` additively. For `level === 'page'` it calls `store.save(...)` fire-and-forget, inside `try` with a `.catch` that logs a `log`-level line. It never throws, preserving AC-56 of SPEC-02 (`ports.ts:23`).
  - Container wiring.
  - The door row `alarm` (`POST /api/_test/alarm`, `{ source, code }` → `{ id }`) raises through the port.
  - The Payload endpoint `POST /cms-api/alarms/:id/acknowledge` (owner).
- **Files:** `server/src/collections/alarms.ts`, `server/src/alarms/ports.ts`, `server/src/alarms/service.ts`, `server/src/adapters/payloadAlarms.ts`, `server/src/platform/logger.ts`, `server/src/container.ts`, `server/src/test-doors/registry.ts`, `server/test/integration/alarms.int.test.ts`; throwaway migration `spec04_wip_p4` (covers W21–W24).
- **Done means:**
  - `raise(page)` → one row and one log line;
  - a store override that throws → `raise` returns normally;
  - the door creates a row;
  - acknowledge → `acknowledgedAt` set and one journal row;
  - `verify-schema` exits 0.
- **Verify:** server targeted; server int `alarms.int.test.ts`; `verify-schema`.
- **Rules that apply:** SPEC-02 AC-56 (alarm never throws); architecture.md "Дверцята".
- **Risk:** low.

---

### P5 — catalog collections

### W25 — Catalog collections (P5)
- **Serves:** AC-43, AC-44, AC-45, AC-46, AC-48, AC-18 (catalog part of the matrix); enables AC-63…AC-88.
- **Do:**
  - Add `server/src/collections/catalog/fields.ts`:
    - `localized(name, { maxLength? })` returns a `group` with `uk` (required), `en`, `es`, `fr` (optional), all plain text (AC-43);
    - `naturalKey(name)` returns text, unique, indexed;
    - `importedHash` returns text, hidden.
  - Add six collections, all with labels in Ukrainian, `access` from `policies.ts` (owner rw; agents read), and `audited: true`:
    - `seasons` (`seasons`): `key`, `generatedAt`, `tzdbVersion`;
    - `zones` (`zones`): `zoneId`, `order`, `offsetMinutes`, `midnightUtc` (**`access.update: () => false`**, plus `admin.readOnly`; written only by the import with `context.t2fImport`), `representativeCityId`;
    - `countries` (`countries`): `iso` and `slug` (immutable: a `beforeChange` hook refuses a change on update, AC-46), `name` localized, `gender` select `m|f|n|pl` + empty (AC-44), `flagCode`, `zoneIds` (json array), `illustrationId`, `howToText` localized, `gallery` (json), `popularity`, `sortIndex`;
    - `cities` (`cities`): `cityId`, `countryIso`, `zoneId`, `name` localized, `landmark` localized (optional), `celebrationType`, `mapPoint {x,y}`, `isCountryMain`, `sortIndex`;
    - `events` (`events`): `eventId`, `cityId`, `zoneId`, `countryIso`, `midnightUtc`, `isMainCelebration`, `type`, `popularity`, `restrainedNote` localized (optional), `slot` select `midnight|fireworks-20|dawn|jan-1`, default `midnight`, and `startsAt` (required by `validate` when `slot ≠ midnight`, AC-48), `sortIndex`;
    - `traditions` (`traditions`): `traditionId`, `countryIso`, `title` localized, `text` localized, `iconId`, `sortIndex`.
  - The field set must round-trip every key of `data/schedule.json`/`countries.json`, including `$schema`, `version` and key order through the mapper in W30/W33. The implementer lists the JSON keys with `node -e` and asserts coverage in a unit test.
  - Add six rows to `registries/collections.ts` (one line each), `resettable: true`.
  - Throwaway migration `spec04_wip_p5` (covers W25–W28).
- **Files:** `server/src/collections/catalog/{fields,seasons,zones,countries,cities,events,traditions}.ts`, `server/src/registries/collections.ts`, `server/test/unit/catalog-model.test.ts`, `server/test/integration/catalog-access.int.test.ts`.
- **Done means:**
  - unit (model): four languages per localized field; `uk`-only passes; without `uk` → refused; five gender values pass, `x` → refused; the `startsAt` rule holds;
  - integration:
    - the owner changing `zones.midnightUtc` → refused and the value unchanged;
    - changing `countries.slug` → refused;
    - `dawn` without `startsAt` → refused, and with it → saved;
    - the agent matrix (create/update/delete on the 6 collections) → refused, while the agent's read → 200;
  - the key-coverage test passes.
- **Verify:** server targeted; server int `catalog-access.int.test.ts`.
- **Rules that apply:** ms; architecture.md "Payload" (thin; rules in `domain/`); security → A03 (plain text only, no rich text).
- **Risk:** files are large, but the logic is in W27.

### W26 — No deletion of catalog records (P5) — **owner-dependent: Q7**
- **Serves:** AC-47.
- **Do:** in the six catalog collections, set `access.delete: () => false` for every role. In `fields.ts`, add `admin: { disableBulkEdit? }` and hide the delete control by giving no delete permission; Payload hides "Delete" when `access.delete` is false. A different Q7 answer changes only this line set and its test.
- **Files:** `server/src/collections/catalog/fields.ts` (shared `noDelete` constant), `server/test/integration/catalog-nodelete.int.test.ts`.
- **Done means:** an owner delete through REST on each of the 6 kinds → refused, and the row is still there. The e2e "no Delete action" runs in W53.
- **Verify:** server int `catalog-nodelete.int.test.ts`.
- **Rules that apply:** spec "Передача" (deletion is soft only, because Payload deletes versions with the document).
- **Risk:** low.

### W27 — Catalog integrity rules (P5)
- **Serves:** AC-49; enables AC-65.
- **Do:**
  - Add `server/src/domain/catalog/integrity.ts` (ring 1): `checkCatalog(snapshot)` returns violations `{ rule, ids }`. The rules are:
    - `event-zone-missing`, `event-city-missing`, `event-country-missing`;
    - `city-zone-mismatch` (city zone ≠ event zone);
    - `pair-main-count` (in each country×zone pair, not exactly one main **visible** event, unless every event of the pair is hidden; this wave reads `hidden` from corrections when present, else none).
  - Add `server/src/catalog/service.ts` `assertIntegrityAfter(tx, change)`, called from a `beforeChange` hook on events/cities/zones/countries. It builds the snapshot over the pending change and throws `ValidationError` with `rule` in the message.
- **Files:** `server/src/domain/catalog/integrity.ts`, `server/src/catalog/ports.ts`, `server/src/catalog/service.ts`, `server/src/collections/catalog/{events,cities}.ts` (hook line), `server/test/unit/catalog-integrity.test.ts`, `server/test/integration/catalog-integrity.int.test.ts`.
- **Done means:**
  - unit: the full `data/` snapshot → no violations, and each rule triggered once;
  - integration: one refused save per rule, with the rule name in the error.
- **Verify:** server targeted; server int `catalog-integrity.int.test.ts`.
- **Rules that apply:** architecture.md "Payload" (rule in `domain/`).
- **Risk:** cost of a full-snapshot check per save (298 events). It is acceptable: one query per collection and an in-memory check.

### W28 — Catalog version bump and the "Catalog changed" event (P5)
- **Serves:** AC-67, AC-20 (catalog writes journaled).
- **Do:**
  - Add `server/src/domain/catalog/version.ts`: `catalogVersionOf` is re-used from `@time2fest/contracts` (`site.ts:70-73`).
  - An `afterChange` hook on the 5 non-season catalog collections, unless `context.t2fImport`:
    - updates `seasons.generatedAt = iso(clock.now())` in the same `req`;
    - publishes the `catalog.changed` event `{ version, at }` (payload per `CatalogChangedSchema`) through `EventPublisher` in the same transaction.
  - The import sets it from the source (W31).
- **Files:** `server/src/catalog/service.ts`, `server/src/collections/catalog/{zones,countries,cities,events,traditions}.ts` (hook line), `server/test/integration/catalog-version.int.test.ts`.
- **Done means:**
  - renaming a city → a new `generatedAt`, one `catalog.changed` event with the new version, and one journal row.

  The no-op import case is asserted in W31.
- **Verify:** server int `catalog-version.int.test.ts`; `verify-schema` after `spec04_wip_p5`.
- **Rules that apply:** spec follow-up 1.
- **Risk:** a hook loop (the season update re-triggers hooks). Seasons have no bump hook, and the bump passes `context.t2fInternal`.

---

### P6 — catalog wire, read port, import

### W29 — Contracts: catalog reason, payload type, wire schemas (P6)
- **Serves:** AC-63 (shared schema), AC-65 (reason), AC-54/AC-36/AC-67 (event payload schemas).
- **Do:**
  - Add `packages/contracts/src/catalog.ts`: `CATALOG_REASONS = ['catalog-invalid'] as const`, `CatalogReason`, and the `CatalogPayload` interface.
  - Add `packages/contracts/src/catalog.schemas.ts` with zod:
    - `CatalogResponseSchema = apiResultSchema(z.object({ version: z.string(), schedule: ScheduleFileSchema, countries: CountriesFileSchema }))`. The schemas are built from `data/schedule.schema.json`'s structure (strict on known keys, `$schema` optional);
    - `EventPatchChangedSchema`, `CatalogChangedSchema`, `UnattendedChangedSchema` per spec:526-533.
  - Append `export * from './catalog';` to `index.ts` and `export * from './catalog.schemas';` to `schemas.ts`.
  - Add `packages/contracts/test/catalog.test.ts`: `data/schedule.json` + `countries.json` wrapped in the result pass; a missing `zoneId` fails with a path.
  - Run `node scripts/contract-surface.mjs --update` then `--check`.
- **Files:** `packages/contracts/src/catalog.ts`, `packages/contracts/src/catalog.schemas.ts`, `packages/contracts/src/index.ts`, `packages/contracts/src/schemas.ts`, `packages/contracts/test/catalog.test.ts`, `scripts/contract-surface.baseline.json`.
- **Done means:** the contracts targeted check is green, and `contract-surface --check` exits 0.
- **Verify:** contracts targeted.
- **Rules that apply:** cc §1 (one source), §4 (additive = non-breaking).
- **Risk:** `index.ts` must not pull zod into the site, because `catalog.ts` is types only. W55 greps the bundle for `ZodError`.

### W30 — `GET /api/catalog`, read ports, rate limit (P6)
- **Serves:** AC-63, AC-65, AC-66, NFR-2, NFR-3.
- **Do:**
  - Add `server/src/domain/catalog/assemble.ts` (ring 1): rows → `{ schedule, countries }` in exactly the `data/` shape and key order:
    - zones by `order` → countries → cities by `sortIndex` → events of slot `midnight` only (AC-66);
    - `restrained` omitted when empty;
    - the language fields in the `data/` form (`{ uk }` where `data/` has `{ uk }`, a string where it has a string; spec:523).
  - Add `server/src/adapters/payloadCatalog.ts`: one `find` per collection with `pagination: false`, `depth: 0`.
  - `server/src/catalog/service.ts`:
    - `readCatalog()` → `{ version, schedule, countries }`, or `unavailable/catalog-invalid` when `checkCatalog` fails (AC-65);
    - the ports `nonMidnightEvents()` (with `startsAt`, AC-66) and `zoneMoments()`.
  - Add `server/src/endpoints/catalog.ts`: `GET /api/catalog`, `needs: ['db']`, `rateLimit: 'catalog-read'`, and the response validated by `CatalogResponseSchema` in tests only.
  - Add one row to `registries/routes.ts`, and one row `catalog-read` (30/min per device key, `memory`/`redis` policy as SPEC-02 rows) to `registries/rateLimits.ts`.
- **Files:** `server/src/domain/catalog/assemble.ts`, `server/src/adapters/payloadCatalog.ts`, `server/src/catalog/service.ts`, `server/src/endpoints/catalog.ts`, `server/src/registries/routes.ts`, `server/src/registries/rateLimits.ts`, `server/test/integration/catalog-read.int.test.ts`.
- **Done means** (on the `_test` DB, after `import catalog --apply` from W31; this test runs after W31 within the phase):
  - the body passes `CatalogResponseSchema` and `schedule` passes `data/schedule.schema.json` (ajv is not available, so the zod mirror is used);
  - a fixture inserting an event with a missing zone through `overrideAccess` + `context.t2fInternal` (bypassing hooks) → `unavailable`/`catalog-invalid`;
  - a `fireworks-20` event is not in `events` and is returned by the port with `startsAt`;
  - 20 requests → p95 printed ≤1 000 ms and body ≤2 MB;
  - the 31st request in a minute → `rate_limited` with `retryAfterMs`.
- **Verify:** server targeted; server int `catalog-read.int.test.ts`.
- **Rules that apply:** cc; security → A04 (rate limit on a public route); architecture.md "Помилки".
- **Risk:** key order and the language-field form. The byte-equal export test (W33) is the strict guard.

### W31 — `import catalog`: plan, apply, journal, registry, CLI (P6)
- **Serves:** AC-64 (server side), AC-67 (no-op import), AC-75, AC-76, AC-77, AC-78, AC-79, AC-80, AC-81, NFR-4.
- **Do:**
  - Add `server/src/domain/catalog/fromData.ts` (ring 1): data files → rows per collection, with `importedHash` = a sha256 of the canonical row JSON.
  - Add `server/src/domain/catalog/importPlan.ts` (ring 1): `(sourceRows, dbRows)` → groups:
    - `add`;
    - `change`;
    - `same`;
    - `skipped-admin-edited`: the DB row's current hash ≠ its stored `importedHash`.
  - Add `server/src/catalog/import.ts` (ring 3):
    - validate the source with `CatalogResponseSchema` parts before anything else, and exit with the file and zod path (AC-81);
    - the dry run prints the 4 groups with ids;
    - `--apply` runs in one transaction: upsert add/change with `context: { t2fImport: true, t2fTrusted: true, t2fActor: 'system:import' }`, write the season meta from the source, journal one summary row plus one row per added/changed record, and publish `catalog.changed` only if anything changed.
  - Add `server/src/registries/imports.ts`: rows `{ key: 'catalog', run }`, sorted. SPEC-08/12/21 append theirs.
  - Add `server/src/cli/import.ts`: `pnpm --dir server import <domain> [--apply] [--source-dir <dir>]`. Default source dir is `../data`. An unknown domain → exit 2 listing `catalog`. It runs in any class and does not load the doors (AC-79).
- **Files:** `server/src/domain/catalog/fromData.ts`, `server/src/domain/catalog/importPlan.ts`, `server/src/catalog/import.ts`, `server/src/registries/imports.ts`, `server/src/cli/import.ts`, `server/test/unit/import-plan.test.ts`, `server/test/integration/catalog-import.int.test.ts`.
- **Done means:**
  - unit: `import nope` → exit ≠0 with `catalog` in the output; the plan groups are correct;
  - integration, on the `_test` DB, after the reset door:
    - (AC-75) row counts of the DB, the journal and the R2 prefix before and after a dry run are equal, and the report has 4 groups;
    - (AC-76) two applies → table snapshots equal, and the second report shows 0 added / 0 changed;
    - (AC-77) apply, rename a city through REST (owner marker), apply → the name is kept and the city is in `skipped-admin-edited`;
    - (AC-78) changing two records in a temp copy of `data/` → 1 summary + 2 rows;
    - (AC-81) a temp `schedule.json` with an empty `zoneId` → exit ≠0, the file and path printed, and the DB unchanged;
    - (AC-79) the CLI with `T2F_ENV=rehearsal`, no `T2F_TEST_DOORS`, and test Access/R2 env values dry-runs with exit 0. It uses the local `_test` DB, and the denylist is empty (`env.ts` `PRODUCTION_DENYLIST`);
    - (AC-67) a no-op re-import → same version, no event;
    - (NFR-4) apply and dry-run durations printed, ≤120 s / ≤60 s.
- **Verify:** server targeted; server int `catalog-import.int.test.ts`.
- **Rules that apply:** seed-and-fixtures §1 (sources from `data/` only; idempotent); security → A08 (validate before write).
- **Risk:** one 1 900-row transaction. Use batched `create`s with the same `req`; if NFR-4 is at risk, the importer may use `payload.db` bulk inserts inside the adapter.

---

### P7 — seed, export, R2 copy

### W32 — Seed rows for the catalog (P7)
- **Serves:** AC-88.
- **Do:**
  - Append six rows to `server/src/seed/registry.ts`: `catalog-1-seasons`, `catalog-2-zones`, `catalog-3-countries`, `catalog-4-cities`, `catalog-5-events`, `catalog-6-traditions`. Their sources are `data/schedule.json` or `data/countries.json`, and their `rows()` come from `fromData.ts`, the same mapper as the import, natural keys per collection. The sorted keys give the dependency order.
  - In `server/src/adapters/payload.ts`, the seed store passes `context: { t2fTrusted: true, t2fImport: true, t2fActor: 'system:seed' }` (additive).
- **Files:** `server/src/seed/registry.ts`, `server/src/adapters/payload.ts`, `server/test/integration/catalog-seed.int.test.ts`.
- **Done means:**
  - after the reset door → the snapshot of the 6 tables equals the snapshot after `import catalog --apply` on an emptied DB, compared on business fields plus `importedHash`;
  - `pnpm --dir server seed` twice → the same counts;
  - `grep -rn "research_data\|streams.candidates" server/src/seed` is empty.
- **Verify:** server int `catalog-seed.int.test.ts`.
- **Rules that apply:** seed-and-fixtures §1, §4.
- **Risk:** `seed-reset.int.test.ts` (SPEC-02) counts rows. Update its expectations only if it asserts an empty registry; do not weaken it.

### W33 — `export catalog` (P7)
- **Serves:** AC-82, AC-83.
- **Do:**
  - Add `server/src/domain/catalog/toData.ts` (ring 1): `{ schedule, countries }` → file text. It produces `JSON.stringify(obj, null, 2) + '\n'` with the `data/` key order. It matches Python's `json.dumps(ensure_ascii=False, indent=2)`, number format included: a unit test runs the existing `data/` files through `assemble ∘ fromData ∘ toData` and compares the bytes. The line ending follows the target file's existing EOL.
  - Add `server/src/catalog/export.ts` and `server/src/cli/export.ts`: `pnpm --dir server export catalog --from <base url | db> [--out <dir>] [--write]`. It:
    - excludes corrections (the base only) and non-midnight events;
    - without `--write`, prints the changed files and writes nothing;
    - with `--write`, refuses with exit 3 when `git status --porcelain -- <targets>` is non-empty.
  - **Tests never write `data/`:** they use `--out <tmpdir>`.
- **Files:** `server/src/domain/catalog/toData.ts`, `server/src/catalog/export.ts`, `server/src/cli/export.ts`, `server/test/unit/catalog-roundtrip.test.ts`, `server/test/integration/catalog-export.int.test.ts`.
- **Done means:**
  - unit: a byte-equal round trip of both files;
  - integration:
    - import, then export to a tmp dir → `Buffer.equals` with `data/*` for both;
    - after a correction (W35 not yet present, so a direct `event-patches` insert is skipped until P8 and the case is completed in W38) and a `dawn` event → the files are the same;
    - without `--write` → no file changed and the list printed;
    - `--write` over a tmp git repo with a modified target → exit ≠0 with the reason;
  - `git diff --stat master -- data/` is empty.
- **Verify:** server targeted; server int `catalog-export.int.test.ts`.
- **Rules that apply:** spec AC-69 (`data/` frozen in this wave).
- **Risk:** float formatting (Python `repr` vs JS), for example `mapPoint`. If they differ, a custom number serializer must reproduce Python's; the round-trip test proves it.

### W34 — R2 copy of the catalog (P7)
- **Serves:** AC-72, AC-73, AC-74, NFR-5 (R2 keys).
- **Do:**
  - Add `server/src/catalog/ports.ts` `ObjectStore.put(key, body, contentType)`, and `server/src/adapters/s3.ts` (`S3Client({ endpoint, region: 'auto', forcePathStyle: <endpoint is loopback>, credentials, requestChecksumCalculation: 'WHEN_REQUIRED' })`).
  - Add `server/src/catalog/copy.ts`: the subscriber row `catalog-r2-copy` on `catalog.changed`. On an event it:
    - reads `readCatalog()`;
    - puts `<prefix>catalog/latest.json` and `<prefix>catalog/<version>.json`;
    - retries at 0 s, 30 s, 120 s, 300 s (≥3 retries within 5 min), with the delays from `deps.clock`-based timers injectable for tests;
    - after the last failure raises `alarm({ level: 'page', source: 'catalog', code: 'catalog-r2-copy-failed' })`.

    The catalog change is already committed, because the subscriber runs after commit.
  - Add one row to `registries/subscribers.ts`.
  - The test listing uses `ListObjectsV2` with the worktree prefix.
- **Files:** `server/src/catalog/ports.ts`, `server/src/adapters/s3.ts`, `server/src/catalog/copy.ts`, `server/src/registries/subscribers.ts`, `server/src/container.ts`, `server/test/integration/catalog-r2.int.test.ts`, `server/test/exclusive/r2-down.exclusive.test.ts`.
- **Done means:**
  - with the emulator up, a city rename → both objects present ≤60 s, and the body deep-equals `GET /api/catalog`;
  - (AC-74) a second prefix written by the test is not listed under this worktree's prefix, and this worktree's objects are not under the other prefix. Two real worktrees are not needed: the prefix comes from the slug (W3);
  - captured logs contain no `T2F_R2_SECRET_ACCESS_KEY` value.

  The exclusive test (run in W53) stops `t2f-r2-1` and expects: the change committed, ≥3 attempts, and a `page` alarm row, using injected short delays. It restarts the container at the end.
- **Verify:** server targeted; server int `catalog-r2.int.test.ts`.
- **Rules that apply:** security → A02 (keys from env only, masked); local-stack §5 (restart only your own stopped service, inside the exclusive lock).
- **Risk:** S3 checksum headers on s3mock. If `WHEN_REQUIRED` still fails, set `responseChecksumValidation: 'WHEN_REQUIRED'` too.

---

### P8 — event corrections

### W35 — Corrections core: store, versions, plain-text note, transaction with journal and events (P8)
- **Serves:** AC-42 (state port), AC-53 (server half), AC-54, AC-59, AC-60, AC-61, AC-62, AC-20.
- **Do:**
  - Add the collection `event-patches`:
    - `eventId` (unique);
    - `moment` (ms, nullable), `isMainCelebration` (nullable), `restrainedNote` (text ≤200, nullable), `restrained` (checkbox), `hidden` (checkbox);
    - `version` (number);
    - access: owner only through the service; direct REST create/update → `() => false`, so the slice uses the endpoint.
  - Add `server/src/domain/corrections/rules.ts` (ring 1):
    - `validatePatch(base, current, input)` → `ok | reason`;
    - `restrained` without a `uk` note or a note >200 → `validation`/`invalid-input`;
    - a stale `expectedVersion` → `changed-since`;
    - the note is stored verbatim as text, and rendering escapes it.

    There is **no** time-window rule (AC-60).
  - Add `server/src/corrections/service.ts` `saveCorrection({ eventIds, changes, expectedVersions }, actor)`. In one transaction it:
    - validates through `rules` + `range` (W36) + `mainCelebration` (W37);
    - upserts the patches with `version + 1`;
    - writes one journal row (action `correction.save`, before/after for every touched event);
    - publishes one `event-patch.changed` per changed event, all with the same new `corrections` topic version (AC-56 needs a shared version).
  - Ports: `currentPatches()` → `{ version, patches: Record<eventId, SiteEventPatch> }` (AC-62, form `site.ts:34-40`, `restrained: { note }`); `momentsWithPatches()`.
  - Add the Payload endpoints `POST /cms-api/event-patches/preview` (returns "was → will be", the event zone's local time, and a `warnings` array) and `POST /cms-api/event-patches/save`.
  - Throwaway migration `spec04_wip_p8`.
- **Files:** `server/src/collections/eventPatches.ts`, `server/src/domain/corrections/rules.ts`, `server/src/corrections/ports.ts`, `server/src/corrections/service.ts`, `server/src/adapters/payloadCorrections.ts`, `server/src/registries/collections.ts`, `server/test/unit/corrections-rules.test.ts`, `server/test/integration/corrections.int.test.ts`.
- **Done means:**
  - save → one journal row and one event;
  - two clients read version 1, the first saves, the second with version 1 → `changed-since`;
  - test clock at 31.12 23:40 UTC → saved and published;
  - a note without `uk` → refused, 201 chars → refused, `<b>x</b>` stored and returned unchanged;
  - after a correction, `GET /api/catalog` body and version are unchanged, and the port returns `{ moment, isMainCelebration, restrained, hidden }`;
  - three corrections before the subscriber starts → the port returns the third version and all three values (AC-42).
- **Verify:** server targeted; server int `corrections.int.test.ts`; `verify-schema`.
- **Rules that apply:** onion (rules ring 1); security → A03 (plain text), A04.
- **Risk:** the version semantics are documented in the port comment: a per-event `version` for AC-61, and a topic version for events and ports.

### W36 — Correction range ±60 min (P8) — **owner-dependent: Q3**
- **Serves:** AC-55.
- **Do:** add `server/src/domain/corrections/range.ts`: `MAX_SHIFT_MS = 60 * 60_000` and `checkRange(baseMoment, newMoment)` → `ok | 'correction-out-of-range'` (inclusive at 60 min). A different Q3 answer changes the constant or the rule here only.
- **Files:** `server/src/domain/corrections/range.ts`, `server/test/unit/corrections-range.test.ts`, case in `corrections.int.test.ts`.
- **Done means:** +60 and −60 min → saved; +61 min → `correction-out-of-range`.
- **Verify:** server targeted; server int `corrections.int.test.ts`.
- **Rules that apply:** onion ring 1.
- **Risk:** low.

### W37 — Main celebration and hiding (P8) — **owner-dependent: Q6**
- **Serves:** AC-56, AC-57, AC-58 (server: the warning flag).
- **Do:** add `server/src/domain/corrections/mainCelebration.ts`: `applyMainRules(pairEvents, change)` → `{ changes, warnings } | 'main-required'`.
  - Marking a new main unsets the previous main of the same country×zone pair, inside the same correction.
  - Hiding the main while another visible event exists and no new main is chosen → `main-required`.
  - When no other visible event exists → allowed, with the warning `pair-without-main`, which preview shows and save requires `confirmWarnings: true` for.

  A different Q6 answer changes this file only.
- **Files:** `server/src/domain/corrections/mainCelebration.ts`, `server/test/unit/corrections-main.test.ts`, cases in `corrections.int.test.ts`.
- **Done means:**
  - a pair with two events, marking the second → the first is not main, one journal row, two events with one version;
  - hide main without a choice → `main-required`; with a new main → saved;
  - a single-event pair → preview has the warning, and save with confirm → hidden.
- **Verify:** server targeted; server int `corrections.int.test.ts`.
- **Rules that apply:** onion ring 1.
- **Risk:** `data/` has no pair with two events (296/296 single, research-code §2). The test inserts a second event through the importer with a temp source.

### W38 — Correction revert handler and export with corrections (P8)
- **Serves:** AC-54 (revert event), AC-22 (for corrections), AC-82 (with a correction).
- **Do:**
  - Add the revert handler row `correction.save` in `registries/revertHandlers.ts`. It restores the `before` patches through `saveCorrection` with actor `owner` and `revertOf`, which emits events with the restored values.
  - Complete the W33 export case: after a correction and a `dawn` event, the exported files are byte-equal to `data/`.
- **Files:** `server/src/registries/revertHandlers.ts`, `server/src/corrections/service.ts`, `server/test/integration/corrections.int.test.ts`, `server/test/integration/catalog-export.int.test.ts`.
- **Done means:**
  - revert of a correction → one more event with the restored values, and the journal has the linked row;
  - the export case is green.
- **Verify:** server int `corrections.int.test.ts`, `catalog-export.int.test.ts`.
- **Rules that apply:** as W23.
- **Risk:** low.

---

### LC — site catalog over http (lane C, parallel with P8; web files only)

### W39 — Build-time catalog source and the `catalog` adapters (LC)
- **Serves:** AC-68, AC-69, AC-70.
- **Do:**
  - Add `lib/data/catalogSource.mjs` (Node, built-ins only): `resolveCatalogSource({ testBuild, apiMode, env })` → `'data' | { url }`:
    - test + http → `{ url: env.T2F_CATALOG_URL ?? 'http://127.0.0.1:' + <T2F_SERVER_PORT from env or server/.env.local> }`;
    - production + http with `T2F_CATALOG_URL` → `{ url }`;
    - else `'data'` (spec follow-up 2).

    `fetchCatalogTo(dir, url)` GETs `<url>/api/catalog`, requires `ok: true`, writes `<dir>/schedule.json` and `<dir>/countries.json`, and throws `catalog: <url>/api/catalog → <status|code>` on any failure, with no fallback.
  - In `next.config.ts`, export an async config that, when the source is a URL, awaits `fetchCatalogTo('.t2f-catalog/<distDir>', url)`. It then adds `turbopack.resolveAlias` entries `'@/data/schedule.json'` and `'@/data/countries.json'` → the fetched files, appended inside the existing `http` branch (`next.config.ts:87-96`). It also sets `env.NEXT_PUBLIC_CATALOG_VERSION` from the response. On failure it `process.exit(1)` after printing the message.
  - Add `lib/api/http/catalog.ts` and `lib/api/sim/catalog.ts`: `{ catalog: () => omit(getData(), 'chainsByEventId'), version: () => catalogVersionOf(getData().meta) }`. In http, `version()` must equal the response `version`; a unit test asserts it against `NEXT_PUBLIC_CATALOG_VERSION` when it is set.
  - Register `catalog` in `httpFactories` (`lib/api/http/index.ts:24`) and in `simFactories` (`lib/api/sim/index.ts:21`), and append `'catalog'` to `MIGRATED_DOMAINS` (`services.ts:43`).
  - Append `.t2f-catalog/` to `.gitignore`.
  - Add `tests/unit/api/catalog-source.test.ts`:
    - the matrix of `resolveCatalogSource`;
    - `fetchCatalogTo` against a local `http.createServer`: `ok` → files written; 503 or connection refused → throws with the URL.
- **Files:** `lib/data/catalogSource.mjs`, `next.config.ts`, `lib/api/http/catalog.ts`, `lib/api/sim/catalog.ts`, `lib/api/http/index.ts`, `lib/api/sim/index.ts`, `lib/api/services.ts`, `.gitignore`, `tests/unit/api/catalog-source.test.ts`.
- **Done means:**
  - web targeted is green;
  - `tests/unit/api/mode.test.tsx` and the `missingDomains` expectations are still green (update only the migrated-domain list in the test if it enumerates domains);
  - `git diff --stat master -- data/` is empty.

  The real `build:int` runs (server down → exit ≠0 naming the URL; server up with a renamed city → the name in `out-int` HTML) are W53 step 4.
- **Verify:** web targeted on the nine files.
- **Rules that apply:** next → config (async config allowed); frontend-ui-architecture (adapters in `lib/api/{http,sim}`); frontend-seam §2.3 (one switch).
- **Risk:** `turbopack.resolveAlias` with a JSON specifier. **Fallback:** `load.ts` stays unchanged, and the build step writes into an alias module `lib/data/catalog.int.json`. The fallback is gitignored and selected only through the alias, so `lib/data/load.ts` is never edited.

### W40 — Catalog contract suite on sim and http, and AC-64 deep equality (LC)
- **Serves:** AC-63 (client side), AC-64.
- **Do:**
  - Add `tests/contract/catalog.suite.ts`: `describeDomain(makeService, ctx)`. It asserts:
    - `version()` = `catalogVersionOf(meta)`;
    - counts are 38/246/298/298;
    - every `ReadonlyMap` has the same entries as an expected `Catalog` built by `buildDataset(data/schedule.json, data/countries.json, streams)` minus `chainsByEventId`, compared with a recursive deep equality that walks Map entries.
  - Add `tests/unit/api/catalog-contract.test.ts` (sim: `getData()`) and `tests/contract/catalog.http.test.ts`. The http variant:
    - calls the reset door (the catalog is seeded = import on an empty DB, by W32/AC-88);
    - fetches `GET /api/catalog` from the worktree server;
    - validates it with `CatalogResponseSchema`;
    - builds `buildDataset(body.schedule, body.countries, streams)` and runs the suite.

    `scripts/contract-run.mjs` picks up the domain from the file names (`contract-run.mjs:23-33`).
- **Files:** `tests/contract/catalog.suite.ts`, `tests/contract/catalog.http.test.ts`, `tests/unit/api/catalog-contract.test.ts`.
- **Done means:**
  - the sim run is green under web targeted;
  - `pnpm contracts:run` with the stack up → `catalog` green on both sides (run in W52).
- **Verify:** web targeted; http run in W52.
- **Rules that apply:** cc §2.
- **Risk:** low.

---

### P9 — unattended mode

### W41 — Sleep windows store and schedule evaluation (P9)
- **Serves:** AC-31 (storage, overlap), AC-32.
- **Do:**
  - Add the collection `unattended-windows`: `startsAt`, `endsAt` (UTC), and an optional `label`; owner only.
  - Add the global `unattended-state`: `on`, `cause` (`schedule|manual|alarm|null`), `manualUntil` (UTC, nullable), `version`, `changedAt`.
  - Add `server/src/domain/unattended/windows.ts`: `validateWindow(new, existing)` → `ok | 'end-not-after-start' | 'overlaps'`; `activeWindow(windows, now)`; `nextBoundary(windows, now)`.
  - Add `server/src/domain/unattended/machine.ts` (ring 1): `desiredState({ windows, manual, openPageAlarms, now, current })` → `{ on, cause }`.
  - Throwaway migration `spec04_wip_p9` at the end of the phase.
- **Files:** `server/src/collections/unattendedWindows.ts`, `server/src/globals/unattendedState.ts`, `server/src/registries/{collections,globals}.ts`, `server/src/domain/unattended/{windows,machine}.ts`, `server/test/unit/unattended-machine.test.ts`.
- **Done means:**
  - unit: a boundary −1 s → off; a boundary +0 → on; the window end → off;
  - overlap and end ≤ start → refused.
- **Verify:** server targeted.
- **Rules that apply:** onion ring 1; constitution II (UTC instants).
- **Risk:** low.

### W42 — Kyiv-time input and manual override (P9) — **owner-dependent: Q5**
- **Serves:** AC-31, AC-33.
- **Do:**
  - Add `server/src/domain/unattended/kyiv.ts`: `kyivLocalToUtc('YYYY-MM-DDTHH:mm')`, implemented with `Intl.DateTimeFormat` offset probing for `Europe/Kyiv`. It must handle 31.12 → 01.01 and DST edges.
  - Add `server/src/domain/unattended/override.ts`: the manual toggle holds until `nextBoundary(windows, now)`, and `null` boundary → indefinitely.
  - The windows collection's `beforeValidate` converts the Kyiv input fields into UTC. A different Q5 answer (recurring schedule, or manual "until I switch back") changes these two files only.
- **Files:** `server/src/domain/unattended/kyiv.ts`, `server/src/domain/unattended/override.ts`, `server/src/collections/unattendedWindows.ts`, `server/test/unit/unattended-kyiv.test.ts`, `server/test/integration/unattended.int.test.ts`.
- **Done means:**
  - unit: `2026-12-31T23:00` Kyiv → `2026-12-31T21:00Z`; `2027-01-01T01:00` → `2026-12-31T23:00Z`;
  - integration (test clock door): a manual off inside a window holds until its end; a manual on outside holds until the next start;
  - end ≤ start and overlap → refused through REST.
- **Verify:** server targeted; server int `unattended.int.test.ts`.
- **Rules that apply:** onion ring 1.
- **Risk:** `Intl` tz data comes from Node's ICU, not tzdb `2026f`. Kyiv has no pending change, so this is acceptable (Assumptions).

### W43 — Auto-on after an unacknowledged `page` alarm (P9)
- **Serves:** AC-34.
- **Do:** add `server/src/domain/unattended/alarmTrigger.ts`: `alarmDue(openPageAlarms, now)` → true when any alarm has `raisedAt + 15 min ≤ now` and `acknowledgedAt` is empty. `machine` uses it with the cause `alarm` and actor `system:unattended`.
- **Files:** `server/src/domain/unattended/alarmTrigger.ts`, `server/test/unit/unattended-alarm.test.ts`, case in `unattended.int.test.ts`.
- **Done means:**
  - alarm at T (door): T+14:59 → off; T+15:00 (+≤30 s tick) → on;
  - the journal row has actor kind `system`.
- **Verify:** server int `unattended.int.test.ts`.
- **Rules that apply:** onion.
- **Risk:** low.

### W44 — Exit rule of alarm-caused mode (P9) — **owner-dependent: Q4**
- **Serves:** AC-35.
- **Do:** add `server/src/domain/unattended/alarmExit.ts`: while `cause === 'alarm'`, `off` only when no open `page` alarm remains or on a manual off. There is no timeout. A different Q4 answer (for example a quiet period) changes this file only.
- **Files:** `server/src/domain/unattended/alarmExit.ts`, `server/test/unit/unattended-exit.test.ts`, case in `unattended.int.test.ts`.
- **Done means:**
  - +2 h of test clock with no new alarm → still on;
  - acknowledging the last alarm → off ≤30 s;
  - separately, a manual off → off.
- **Verify:** server int `unattended.int.test.ts`.
- **Rules that apply:** onion.
- **Risk:** low.

### W45 — Transitions exactly once: service, ticker, event, journal (P9)
- **Serves:** AC-32 (≤30 s lag), AC-33/34/35 (applied), AC-36, AC-20.
- **Do:**
  - Add `server/src/unattended/service.ts`:
    - `evaluate(now)` in one transaction locks the `unattended-state` row (`SELECT … FOR UPDATE` through the adapter), computes `desiredState`, and **only if it differs** writes the state (`version + 1`), one journal row and one `unattended.changed` event `{ on, cause, at, version }`;
    - `setManual(on, actor)`.
  - Add `server/src/unattended/ticker.ts`: every 10 s per process, started from `startBackground`. Two instances are safe because of the row lock and compare-and-set.
  - Add the revert handler row `unattended.set-manual`.
  - Add the Payload endpoint `POST /cms-api/unattended/manual` (owner).
- **Files:** `server/src/unattended/ports.ts`, `server/src/unattended/service.ts`, `server/src/unattended/ticker.ts`, `server/src/adapters/payloadUnattended.ts`, `server/src/registries/revertHandlers.ts`, `server/src/container.ts`, `server/test/integration/unattended.int.test.ts`; throwaway migration `spec04_wip_p9`.
- **Done means:**
  - the test subscriber gets exactly one event per transition across the AC-32…35 scenarios, with schema-valid payloads (`UnattendedChangedSchema`), and one journal row each;
  - calling `evaluate` twice at the same instant → no second event;
  - `verify-schema` exits 0.
- **Verify:** server targeted; server int `unattended.int.test.ts`; `verify-schema`.
- **Rules that apply:** onion; security → A04 (race-free transitions).
- **Risk:** the ticker must not run during `next build` or the CLIs. `startBackground` runs only from `instrumentation.register` under `NEXT_RUNTIME === 'nodejs'` and not when `NEXT_PHASE === 'phase-production-build'`.

---

### P10 — admin first screen (Payload admin UI)

### W46 — First-screen shell: slot registry, error isolation, test slice, Ukrainian admin (P10)
- **Serves:** AC-26 (shell), AC-27, AC-28, AC-29, AC-30, NFR-10 (measured in W53).
- **Do:**
  - Add `server/src/registries/adminSlots.ts`: rows `{ key, order, label, component: '<import path>#Export', testOnly? }`, sorted by `order`. The rows are `10-corrections`, `20-unattended` and `90-test` (with `testOnly: true`; filtered out unless `envClass === 'test'`, AC-28).
  - Add `server/src/admin/Dashboard.tsx`, a server component used as `admin.components.views.dashboard`. It renders each slot inside `server/src/admin/SliceBoundary.tsx`, a client error boundary that shows `Зріз «<label>» не відмалювався` in place of a slice. It also renders the journal panel (W47).
  - Add `server/src/admin/TestSlice.tsx` (client):
    - shows a counter;
    - its action calls `POST /cms-api/agent-test-posts` through the owner interface (journaled and revertible through the W23 generic handler);
    - it throws when the door flag `admin-test-slice` `{ fail: true }` is set. The door row is added to `test-doors/registry.ts` and sets a `globalThis` flag that the slice's data endpoint reads.
  - In `payload.config.ts`, add one line `i18n: { supportedLanguages: { uk }, fallbackLanguage: 'uk' }` and one line `admin.components.views.dashboard`. Ukrainian `labels`/`admin.description` go on every collection and global of this wave.
  - Run `pnpm --dir server generate:importmap`.
  - Integration `server/test/integration/admin-slots.int.test.ts`:
    - under `T2F_ENV=production` config, `visibleSlots(env)` has no `90-test`;
    - the test slice action → one journal row, and its revert succeeds.

    Write the e2e `server/test/e2e/admin-shell.e2e.ts` (run in W53):
    - with a test JWT via `extraHTTPHeaders` and a login, the three slices and 20 journal rows are visible;
    - with the fail flag, the other two slices and the journal are visible and an error text sits in place of the test slice;
    - the `html[lang]`/Payload language is `uk`;
    - the collection labels are Ukrainian;
    - NFR-10: 10 loads, p95 ≤3 000 ms printed.
- **Files:** `server/src/registries/adminSlots.ts`, `server/src/admin/{Dashboard,SliceBoundary,TestSlice}.tsx`, `server/src/payload.config.ts`, `server/src/test-doors/registry.ts`, `server/src/app/(payload)/admin/importMap.js` (gen.), `server/test/integration/admin-slots.int.test.ts`, `server/test/e2e/admin-shell.e2e.ts`.
- **Done means:**
  - the integration test passes;
  - `verify-schema` (importMap current) exits 0;
  - `npx tsc --noEmit -p .` in `server/` is green.
- **Verify:** server targeted; server int `admin-slots.int.test.ts`.
- **Rules that apply:** next → server/client boundary (`'use client'` only on the boundary and the interactive slices); spec Goals (native Payload UI, no site tokens).
- **Risk:** the Payload 3.91 dashboard override API name (`admin.components.views.dashboard.Component`). Check it in `node_modules/payload/dist/config/types.d.ts` before writing it.

### W47 — Journal panel with revert (P10)
- **Serves:** AC-24 (no button), AC-26 (last 20 rows).
- **Do:** add `server/src/admin/JournalPanel.tsx`:
  - a server component that lists the last 20 `audit-log` rows (owner);
  - a client `RevertButton` shown only when `revertible`, which calls `POST /cms-api/audit-log/:id/revert` and shows `changed-since`/`not-revertible` reasons in Ukrainian.
- **Files:** `server/src/admin/JournalPanel.tsx`, `server/src/admin/RevertButton.tsx`, e2e case in `server/test/e2e/admin-shell.e2e.ts`.
- **Done means:**
  - tsc is green;
  - the e2e case (run in W53): a row of a kind with no handler has no button; a revertible row has one.
- **Verify:** server targeted.
- **Rules that apply:** next boundary.
- **Risk:** low.

### W48 — Corrections slice with confirmation (P10)
- **Serves:** AC-53, AC-58 (UI warning).
- **Do:** add `server/src/admin/CorrectionsSlice.tsx` (client). It:
  - picks an event and edits moment, main, restrained+note and hidden;
  - on "Зберегти" calls preview and opens a confirm dialog showing "було → стане" per field, the event zone's local time for a moment change, and the `pair-without-main` warning when present;
  - on "Скасувати" changes nothing;
  - on "Підтвердити" calls save with `expectedVersion`.
- **Files:** `server/src/admin/CorrectionsSlice.tsx`, `server/test/e2e/admin-corrections.e2e.ts`.
- **Done means:** tsc is green. The e2e (run in W53) checks:
  - a moment change opens the dialog with both values and the local time;
  - cancel → unchanged;
  - confirm → saved;
  - a single-event pair → warning shown, then hidden after confirm.
- **Verify:** server targeted.
- **Rules that apply:** next boundary; security → A03 (the note is rendered as text, no `dangerouslySetInnerHTML`).
- **Risk:** low.

### W49 — Unattended slice with acknowledge; catalog admin read-only and no-delete checks (P10)
- **Serves:** AC-38 (UI), AC-45 (e2e), AC-47 (e2e).
- **Do:**
  - Add `server/src/admin/UnattendedSlice.tsx`: current state and cause, the windows list and add form (Kyiv time), a manual on/off control, and the open `page` alarms with "Підтвердити".
  - Add the e2e `server/test/e2e/admin-catalog.e2e.ts`:
    - the zone edit form shows `midnightUtc` read-only;
    - the six catalog collections show no "Видалити" action;
    - the acknowledge button sets `acknowledgedAt` (shown).
- **Files:** `server/src/admin/UnattendedSlice.tsx`, `server/test/e2e/admin-catalog.e2e.ts`, `server/src/app/(payload)/admin/importMap.js` (gen.).
- **Done means:** tsc is green and `verify-schema` exits 0. The e2e runs in W53.
- **Verify:** server targeted; `verify-schema`.
- **Rules that apply:** next boundary.
- **Risk:** low.

---

### Gate R — rebase on `master` with SPEC-05 (sub-session, before P11)
Not an implementer item. The run-plan session stops after P10 and the integration of lanes, and reports "ready for Gate R". Then:
1. The orchestrator confirms that SPEC-05 is merged, or decides to proceed without it (spec follow-up 7).
2. The sub-session makes a WIP commit, then runs `git rebase master`.
   - Lockfile conflict → take master's `pnpm-lock.yaml` and run `pnpm install` (wave-orchestration §3).
   - Single-line shared files → keep both lines, sorted.
   - `server/src/migrations/**` → keep master's files; the `spec04_wip_*` files stay until W50.
3. Run `pnpm install --frozen-lockfile`.
4. Resume `run-plan-auto` at P11.

### P11 — the one migration, and the edge-bypass proof

### W50 — Consolidate the WIP migrations into one generated migration (P11)
- **Serves:** every schema AC (AC-12…AC-49, AC-53…AC-62, AC-31…AC-39 storage); the `Payload migration` contract check.
- **Do:**
  1. On both own DBs, roll back the WIPs. Repeat
     ```
     pnpm --dir server migrate:down
     ```
     for main, and
     ```
     npx cross-env DATABASE_URI=postgres://t2f@127.0.0.1:5433/t2f_spec_04_admin_catalog_test pnpm --dir server migrate:down
     ```
     for `_test`, until this query returns no row on each:
     ```
     SELECT name FROM payload_migrations WHERE name LIKE '%spec04_wip%'
     ```
     Run the query with `node -e` + `pg`. If a `down` fails, run `pnpm --dir server migrate:reset` **on these two DBs only**, followed by `pnpm stack` to re-seed. Never touch another DB.
  2. Delete `server/src/migrations/*spec04_wip*.{ts,json}`.
  3. Generate `pnpm --dir server migrate:create admin_catalog`. It diffs against the latest snapshot on `master` (`20261116_221920_initial.json`, or SPEC-05's if it added one). Never hand-edit it.
  4. Run `pnpm --dir server migrate`, then `generate:types`, then `generate:importmap`, then `cd server && node scripts/verify-schema.mjs`.
  5. Run `migration-safety` checks 1–8:
     - check 2: grep for destructive SQL. Only `CREATE`/`ALTER TABLE admins ADD COLUMN` is expected in `up`, and the `role` column `NOT NULL DEFAULT 'owner'` is a new column, not `SET NOT NULL` on an existing one;
     - check 4: `node scripts/db.mjs migcheck up` → `migrate` → `migrate:down` → `migrate` → `migcheck drop`;
     - check 7: `pnpm --dir server seed` twice;
     - check 8: no big-table index in this wave.
  6. Run the full server integration suite once: `pnpm --dir server test:int` (shared lock).
- **Files:** `server/src/migrations/<ts>_admin_catalog.{ts,json}` (gen.), `server/src/migrations/index.ts` (gen.), `server/src/payload-types.ts` (gen.), `server/src/app/(payload)/admin/importMap.js` (gen.); deleted WIP files.
- **Done means:**
  - `ls server/src/migrations | grep spec04_wip` is empty;
  - exactly one new migration exists after master's;
  - `verify-schema` exits 0;
  - the migcheck up/down/up exits 0;
  - the seed is idempotent;
  - `pnpm --dir server test:int` exits 0.
- **Verify:** as listed.
- **Rules that apply:** `migration-safety` (all checks); wave-orchestration §3 (the second to merge regenerates).
- **Risk:** a rolled-back WIP leaves orphan enum types if a `down` is incomplete. `migrate:reset` on own DBs is the fallback.

### W51 — AC-11: an admin request bypassing the edge is refused (P11, post-rebase)
- **Serves:** AC-11.
- **Do:**
  - Read `D:/Work/Pets/Time2Fest/docs/backend/cloudflare-notes.md` (from SPEC-05) for:
    - (a) the origin channel (tunnel or Authenticated Origin Pulls);
    - (b) whether `Cf-Access-Jwt-Assertion` reaches the origin;
    - (c) whether the admin host passes through the Worker.
  - Write `server/test/e2e/origin-bypass.e2e.ts`. A direct request to the server's own origin port with `Host: <admin host>` must be refused in every case, sending no `Cf-Access-Jwt-Assertion`, a forged unsigned one, or one signed by an unknown key: 403 from the gate (W14). If the notes describe an origin-side mechanism that is testable locally (for example an AOP client certificate check in the server, or a shared-secret header from the Worker), add the case "valid Access JWT but no edge credential" → refused.
  - **If the notes say the header does not reach the origin** through the chosen channel: STOP and report to the orchestrator, because the gate's premise (OQ-1) is broken.
  - **If the file does not exist** (SPEC-05 not merged): report AC-11 «не виконано, чекає SPEC-05».
- **Files:** `server/test/e2e/origin-bypass.e2e.ts`.
- **Done means:** the e2e passes in W53 step 6, or the report carries the exact "waiting" or "stop" status with the reason.
- **Verify:** run in W53.
- **Rules that apply:** security → A01/A05; spec OQ-1, SPEC-13a hand-off (repeat on the real server).
- **Risk:** depends on SPEC-05's choice.

---

### P12 — gates, heavy proofs, fidelity, full verification

### W52 — Gate runs: contract-conformance, migration-safety recap, seed-and-fixtures (P12)
- **Serves:** AC-63, AC-64 (http run), AC-88 (seed check); the contract checks Wire contract, Payload migration, Seed and fixtures.
- **Do:**
  - Run `pnpm stack` in the background and wait for `listening`. Then run `pnpm stack:smoke` (6/6), and:
    - `pnpm contracts:run` → `time` and `catalog` green on sim and http;
    - the `migration-safety` report table from W50 (no re-run unless the code changed since);
    - `seed-and-fixtures` §4: `pnpm --dir server seed` twice gives the same counts, and `grep -ri research_data server tests scripts/boards` gives nothing.
- **Files:** none.
- **Done means:** each gate's table is in the report and green.
- **Verify:** as listed.
- **Rules that apply:** `run-plan-auto` §3 gates.
- **Risk:** low.

### W53 — Heavy proofs (P12; the orchestrator runs them one at a time under the machine heavy lock)
- **Serves:** AC-8/AC-39 (production 404), AC-11, AC-24, AC-26, AC-27, AC-30, AC-38, AC-40, AC-45, AC-47, AC-53, AC-58, AC-68, AC-73, AC-87, NFR-1, NFR-2, NFR-4, NFR-5, NFR-7, NFR-10.
- **Do (each result goes in the report):**
  1. **Exclusive suite:** `pnpm --dir server test:int:exclusive`, covering `events-two-instances` (AC-40) and `r2-down` (AC-73). It takes the exclusive lock.
  2. **Server production build + admin e2e:**
     - `pnpm --dir server start:prod`. The test class comes from `.env.local`, and `next build` catches the build-only failures of proxy and admin.
     - **Warm** `/admin` with a `curl` that carries a door token first.
     - Then `T2F_E2E_BASE=http://admin.localhost:<port> pnpm --dir server test:e2e -- admin access`, covering `admin-shell`, `admin-corrections`, `admin-catalog` and `access`.
     - Record the NFR-10 p95, and the NFR-1 p95 from `access-gate.int.test.ts`.
  3. **Production doors:**
     - `T2F_ENV=production` with the Access/R2 production-shaped dummy values (https `*.cloudflareaccess.com` URL; JWKS never fetched, because no request carries a token);
     - `pnpm --dir server start`;
     - `server/test/e2e/doors-404.e2e.ts`, extended with `access-token`, `alarm` and `admin-test-slice`, must give 404 identical to an unknown path.
  4. **Integration build from the server:**
     - with the server **stopped**, `pnpm build:int` must exit ≠0 with `http://127.0.0.1:<port>/api/catalog` in the output (AC-68);
     - then restart the stack, rename one city through REST as the owner, and run `pnpm build:int`. The new name must appear in `out-int/country/<slug>/index.html` (`grep`);
     - revert the rename through the journal, re-run `pnpm build:int`, and keep `out-int` for step 5 and W54;
     - also run `python -X utf8 scripts/tzdb_report.py --source http://127.0.0.1:<port>/api/catalog --out <tmp>` → exit 0.
  5. **http Playwright (AC-87):** `pnpm serve:int` (background), then `npx playwright test -c playwright.http.config.ts tests/e2e/<one catalog-heavy spec, e.g. the country page spec> --workers=2` → green.
  6. **AC-11:** `server/test/e2e/origin-bypass.e2e.ts` (W51) against the step-2 server.
  7. **NFR-2/NFR-4/NFR-5/NFR-7:**
     - read the printed p95, size and durations from the W30/W31 test output;
     - `docker stats --no-stream t2f-r2-1` < 256 MiB;
     - redirect the stack's server stdout from steps 1–6 to a temp file and grep it for the test agent key, a door JWT (`eyJ`), `t2f-local-secret` and `PAYLOAD_SECRET`'s value → 0 hits.
  8. Stop every process this phase started; leave the shared containers up.
- **Files:** none (`doors-404.e2e.ts` was extended in W24/W46 as the doors were added).
- **Done means:** every step's stated result is in the report. A step that could not run is reported "not run" with the reason, never "passed".
- **Verify:** as listed.
- **Rules that apply:** local-stack §3–§5; sdd-routing §7 (≤2 heavy processes; one capture run at a time); trap: e2e on a cold dev server gives false failures, so warm first.
- **Risk:** RAM. Steps 2 and 5 together hold two Next processes and Chromium. Run them sequentially.

### W54 — Layout fidelity on all pages from the http build (P12; orchestrator, one capture run at a time)
- **Serves:** AC-71; the Layout fidelity contract check.
- **Do:**
  - Follow `layout-fidelity` §4 with this wave's tools:
    1. stack up and seeded (reset door), `out-int` from W53 step 4 served by `pnpm serve:int` on the slot web port;
    2. `node scripts/boards/http-seeds.mjs --all --server http://127.0.0.1:<server port>`;
    3. for each `batch-01 … batch-08`, **one at a time**:
       ```
       node <BT>/snapshot.mjs --manifest <tmp>/_fid-spec04-<batch>.json --base http://127.0.0.1:<web port> --web <worktree root> --shots <tmp>/shots --project <tmp>/project
       ```
       where the subset manifest is a copy of the batch named `_fid-…`. Then delete `<BT>/reports/_fid-spec04-<batch>.json` immediately (spec follow-up 4);
    4. `node scripts/boards/compare-live.mjs --ref <BT>/shots --new <tmp>/shots --ids @<tmp>/ids.txt --tol 24 --out <tmp>/fid`.
  - 0.1–0.5 % → dispatch `fidelity-triager` with the ids, percentages and three image paths each.
  - Known baselines that are **not** defects:
    - `02-scene-celebrate*` differs by confetti noise without any code change (pre-existing). The triager classes it `dynamic`, so add a rectangle mask to `scripts/boards/masks.json` and record it;
    - `05-stamp.p390` at 0.125 % is the baseline.
  - >0.5 % or a `layout` class → fix data, adapter or mask, **never layout**. Implementer fix mode on W39/W40/W30/W33.
- **Files:** `scripts/boards/masks.json` (only if the triager classifies a region `dynamic`).
- **Done means:**
  - the layout-fidelity §7 report table covers all 8 batches;
  - no unexplained defect;
  - `ls <BT>/reports | grep _fid-spec04` is empty;
  - nothing new under `<BT>/shots`.
- **Verify:** as listed.
- **Rules that apply:** `layout-fidelity` §1 (never), §6 (thresholds); sdd-routing §7.
- **Risk:** duration (~965 boards). It can be split across sessions by batch, and the report is cumulative.

### W55 — Full verification of every touched package (P12; integration pass)
- **Serves:** AC-69, NFR-9 (closes the run), NFR-6 (static), and the build-only checks.
- **Do (each command once, `| tail -40`):**
  1. `server` `full`, in `server/`, with the stack's Postgres, Redis and r2 up.
  2. `contracts` `full`; `rules` `full`.
  3. `web` `full`. Then `grep -rl "ZodError" out-verify/_next/static` must be empty.
  4. `pnpm build:demo`. Then `git diff --stat master -- data/` must be empty (AC-69), and `git diff master -- vercel.json` empty.
  5. `python -X utf8 -m unittest discover -s scripts/tests -p "test_tzdb*.py"`.
  6. `git diff master --name-only -- components app styles messages public stores lib/time lib/engine` must be empty, apart from `lib/api/**`, `lib/data/catalogSource.mjs` and `next.config.ts` as planned.
  7. `grep -rnE "\^|~" server/package.json packages/contracts/package.json` must give no version hits.
  8. NFR-6 static grep (W22).
- **Files:** none.
- **Done means:** every command exits 0 or gives the stated output. Failures are fixed in the owning item and re-run once.
- **Verify:** as listed.
- **Rules that apply:** `sdd-format` §6 (full once per package).
- **Risk:** `web` `full` runs `next build` into `out-verify`. Run it alone, because it is heavy.

### W56 — Skill texts and the Docs patch (P12)
- **Serves:** AC-52 (backlog line via the patch), AC-74 (local-stack rule change); the docs hand-off.
- **Do:**
  - Edit repo skills (facts from this wave only):
    - `local-stack` §5: remove "No S3/R2 emulator in compose" and describe the `r2` service (`adobe/s3mock:5.2.3` or the fallback actually used, port 9090, bucket `t2f-catalog`, prefix `<slug>/`);
    - `layout-fidelity`: point `BT/http-seeds.mjs`/`BT/compare-live.mjs` to `scripts/boards/…`; `playwright.http.config.ts` exists; `snapshot.mjs` supports `--shots`; masks live in `scripts/boards/masks.json` (rectangles), not in the manifests;
    - `seed-and-fixtures`: the catalog seed rows; `http-seeds` is in `scripts/boards/`.
  - Copy `## Docs patch` into the wave report, with any names changed during the run.
- **Files:** `.claude/skills/{local-stack,layout-fidelity,seed-and-fixtures}/SKILL.md`.
- **Done means:**
  - the three skills no longer say `BT/http-seeds.mjs` or "No S3/R2 emulator";
  - the report contains the patch;
  - `find D:/Work/Pets/Time2Fest/docs/backend -newer docs/specs/SPEC-04-admin-catalog.md` lists nothing from this wave.
- **Verify:** greps above.
- **Rules that apply:** `docs-sync` (the orchestrator writes root docs in Ukrainian).
- **Risk:** low.

## Execution
Each phase or lane is one `sdd-engineering:implementer` dispatch with this plan's path and the phase or lane id. Phases run in order. Lanes LB1, LB2 and LC run in parallel with the named phase. Their files are disjoint from the server files, and they run no generator that touches the other side. At most 2 implementers run at once. Docker Desktop must be running from P1 on. Integration runs use the single-file lock command (local-stack §1).

| Lane / phase | Executor | Model | Work items | Files (disjoint) | Depends on | Parallel with | Isolation |
|---|---|---|---|---|---|---|---|
| P1 — deps, R2 emulator, env | implementer | sonnet | W1, W2, W3 | `server/package.json`, `package.json`, `pnpm-lock.yaml`, `docker-compose.yml`, `server/scripts/{stack,db}.mjs`, `server/src/registries/env.ts`, `server/test/unit/env-access-catalog.test.ts` (8) | — | — | alone; `pnpm install` is the only generator; the **only** phase adding deps |
| LB1 — board tools | implementer | sonnet | W4, W5, W6 | `scripts/boards/**` (5), `playwright.http.config.ts`, `tests/unit/boards/*.test.ts` (4) (10) | P1 (pngjs) | P2 | web files only; no server, no generator |
| P2 — Access gate | implementer | **opus** — JWT verification and JWKS rotation, the deny-by-default gate in front of Payload, the test signer gated to the test class, and two spikes whose fallback changes where the guard lives | W9, W10, W11, W12, W13, W14 | `server/src/{proxy.ts,instrumentation.ts}`, `server/src/domain/access/{config,ownerEmails,classify}.ts`, `server/src/access/{ports,gate}.ts`, `server/src/adapters/{accessJwt,testSigner,identityMarker}.ts`, `server/src/platform/env.check.ts`, `server/src/test-doors/registry.ts`, tests (≈7 incl. 2 temporary spikes) (≈21) | P1 | LB1 | server; spikes start `pnpm stack` and stop it |
| LB2 — tzdb tools | implementer | sonnet | W7, W8 | `scripts/build_schedule.py`, `scripts/tzdb_report.py`, `scripts/tests/{test_tzdb_generator,test_tzdb_report}.py`, `scripts/tests/fixtures/tzdb/shifted.json`, `docs/tzdb-reports/2026-11-17-2026f.md` (6) | P1 | P3 | web files; never writes `data/` |
| P3 — second check, roles, keys | implementer | **opus** — the second Payload check (defence in depth), roles and the single-owner invariant, API keys shown once and revoked instantly, agent access rules | W15, W16, W17, W18, W19, W20 | `server/src/access/{payloadGuard,keys,policies}.ts`, `server/src/domain/access/roles.ts`, `server/src/collections/{admins,agentTestPosts}.ts`, `server/src/globals/adminSettings.ts`, `server/src/registries/{collections,globals}.ts`, `server/src/payload.config.ts`, `server/src/cli/createOwner.ts`, migrations WIP p3 (gen.), `payload-types.ts` (gen.), tests (7) (≈20) | P2 | LB2 | server; Payload generators run here |
| P4 — events, journal, revert, alarms | implementer | **opus** — the transactional outbox with cross-instance delivery, the journal in the same transaction, the revert engine with `changed-since`, and the alarm store that must never throw | W21, W22, W23, W24 | `server/src/events/**`, `server/src/audit/**`, `server/src/alarms/**`, `server/src/domain/audit/revert.ts`, `server/src/adapters/{pgEvents,payloadAlarms}.ts`, `server/src/collections/{internalEvents,auditLog,alarms}.ts`, `server/src/registries/{subscribers,revertHandlers,collections}.ts`, `server/src/{container,instrumentation}.ts`, `server/src/platform/logger.ts`, `server/src/access/payloadGuard.ts`, `server/src/test-doors/registry.ts`, WIP p4 (gen.), tests (6) (≈28) | P3 | — | server; Payload generators |
| P5 — catalog collections | implementer | sonnet | W25, W26, W27, W28 | `server/src/collections/catalog/**` (7), `server/src/domain/catalog/{integrity,version}.ts`, `server/src/catalog/{ports,service}.ts`, `server/src/registries/collections.ts`, WIP p5 (gen.), tests (6) (≈19) | P4 | — | server; Payload generators |
| P6 — catalog wire, read, import | implementer | sonnet | W29, W30, W31 | `packages/contracts/src/{catalog,catalog.schemas,index,schemas}.ts`, `packages/contracts/test/catalog.test.ts`, `scripts/contract-surface.baseline.json`, `server/src/domain/catalog/{assemble,fromData,importPlan}.ts`, `server/src/adapters/payloadCatalog.ts`, `server/src/catalog/{service,import}.ts`, `server/src/endpoints/catalog.ts`, `server/src/registries/{routes,rateLimits,imports}.ts`, `server/src/cli/import.ts`, tests (3) (≈21) | P5 | — | server + contracts; `contract-surface --update` writes only the baseline |
| P7 — seed, export, R2 copy | implementer | sonnet | W32, W33, W34 | `server/src/seed/registry.ts`, `server/src/adapters/{payload,s3}.ts`, `server/src/domain/catalog/toData.ts`, `server/src/catalog/{export,copy,ports}.ts`, `server/src/cli/export.ts`, `server/src/registries/subscribers.ts`, `server/src/container.ts`, tests (6) (≈16) | P6 | — | server; does **not** run the exclusive test |
| P8 — corrections | implementer | **opus** — concurrent edits (`changed-since`), one transaction across patch, journal and events with a shared version, the main-celebration invariants on the festival night | W35, W36, W37, W38 | `server/src/collections/eventPatches.ts`, `server/src/domain/corrections/**` (3), `server/src/corrections/{ports,service}.ts`, `server/src/adapters/payloadCorrections.ts`, `server/src/registries/{collections,revertHandlers}.ts`, WIP p8 (gen.), tests (5) (≈16) | P7 | LC | server; Payload generators |
| LC — site catalog over http | implementer | sonnet | W39, W40 | `lib/data/catalogSource.mjs`, `next.config.ts`, `lib/api/{http,sim}/{catalog,index}.ts`, `lib/api/services.ts`, `.gitignore`, `tests/unit/api/{catalog-source,catalog-contract}.test.ts`, `tests/contract/catalog.{suite,http.test}.ts` (12) | P6 (route + schemas) | P8 | web files only; no `next build` (W53 runs it) |
| P9 — unattended mode | implementer | **opus** — the unattended-mode rule: schedule, manual override, alarm trigger and exit, and exactly-once transitions across instances | W41, W42, W43, W44, W45 | `server/src/collections/unattendedWindows.ts`, `server/src/globals/unattendedState.ts`, `server/src/domain/unattended/**` (6), `server/src/unattended/**` (3), `server/src/adapters/payloadUnattended.ts`, `server/src/registries/{collections,globals,revertHandlers}.ts`, `server/src/container.ts`, WIP p9 (gen.), tests (5) (≈22) | P8, LC | — | server; Payload generators |
| P10 — admin first screen | implementer | sonnet | W46, W47, W48, W49 | `server/src/admin/**` (8), `server/src/registries/adminSlots.ts`, `server/src/payload.config.ts`, `server/src/test-doors/registry.ts`, `importMap.js` (gen.), `server/test/integration/admin-slots.int.test.ts`, `server/test/e2e/admin-{shell,corrections,catalog}.e2e.ts` (≈16) | P9 | — | server; `generate:importmap` |
| Gate R | sub-session | — | — | WIP commit + rebase | P10 | — | the only commit inside the run |
| P11 — migration + AC-11 | implementer | **opus** — rolling back the stacked WIPs on own DBs without touching others, regenerating after rebase, and the edge-bypass judgement against SPEC-05's notes (may need a STOP) | W50, W51 | `server/src/migrations/*` (gen.), `payload-types.ts`, `importMap.js` (gen.), `server/test/e2e/origin-bypass.e2e.ts` (≈6) | Gate R | — | alone; `migrate:down`/`migrate:create` on own DBs only |
| P12 — gates, heavy, fidelity, full | implementer (W52, W55, W56) + **orchestrator** under the heavy lock (W53, W54) | sonnet | W52, W53, W54, W55, W56 | `.claude/skills/{local-stack,layout-fidelity,seed-and-fixtures}/SKILL.md`, `scripts/boards/masks.json` (only if triaged `dynamic`) (4) | P11 | — | W53/W54 heavy: one at a time; one board capture at a time |

**Why P2, P3, P4, P5, P6 and P9 exceed ~12 files:** each is one concern whose ports, adapter, collection and test are written together, and about a third of the files are tests or generated. Splitting them would add hand-off reads that cost more than they save. The item count stays ≤6 per phase.

**Escalation:** sonnet phases follow `run-plan-auto` §3. P5 and P6 escalate to opus on a second red targeted verify. LC escalates if the `resolveAlias` fallback is needed and still fails.

## Verification plan
| Command | Directory | Passing means |
|---|---|---|
| server `full`: `npx tsc --noEmit -p . && npx eslint . && npx vitest run --maxWorkers=2 && pnpm test:int && node scripts/verify-schema.mjs` (stack up incl. `r2`) | `server` | exit 0 |
| contracts `full` | `packages/contracts` | exit 0 |
| rules `full` | `packages/rules` | exit 0 (untouched; proves no fallout) |
| web `full` (incl. `contract-surface --check` and `next build` → `out-verify`) | `.` | exit 0; `grep -rl ZodError out-verify/_next/static` empty |
| `pnpm build:demo` | `.` | exit 0; `git diff --stat master -- data/` empty |
| `python -X utf8 -m unittest discover -s scripts/tests -p "test_tzdb*.py"` | `.` | exit 0 |
| `pnpm contracts:run` (stack up) | `.` | `time`, `catalog` green on sim and http |
| `pnpm --dir server test:int:exclusive` | `.` | exit 0 (heavy; exclusive lock) |
| `pnpm --dir server start:prod` + `pnpm --dir server test:e2e -- admin access origin-bypass` | `.` | exit 0 (heavy; warm first) |
| `T2F_ENV=production pnpm --dir server start` + `test:e2e -- doors-404` | `.` | all `/api/_test/*` incl. new doors → 404 = unknown path |
| `pnpm build:int` (server down, then up) | `.` | down: exit ≠0 naming the URL; up: renamed city in `out-int` HTML |
| `npx playwright test -c playwright.http.config.ts <spec> --workers=2` | `.` | exit 0 |
| `layout-fidelity` (`snapshot.mjs` per batch + `scripts/boards/compare-live.mjs`) | `.` | no unexplained defect; report table |
| `migration-safety` checks 1–8 (W50) | `server` | each line green |
| static greps in W12, W14, W22, W32, W55, W56 | `.` | as stated |

## Docs patch (root, for orchestrator)
The orchestrator applies these in Ukrainian through `docs-sync`. The wave does not edit them.

1. **`docs/backend/architecture.md`:**
   - Rings: ring 1 gains `domain/{access,audit,catalog,corrections,unattended}/**`. Ring 2 gains the per-domain `ports.ts` (`access`, `events`, `audit`, `alarms`, `catalog`, `corrections`, `unattended`). Ring 3 gains `access/{gate,keys}.ts`, `events/bus.ts`, `audit/{journal,revert}.ts`, `alarms/service.ts`, `catalog/{service,import,export,copy}.ts`, `corrections/service.ts` and `unattended/{service,ticker}.ts`. Ring 4 gains `proxy.ts`, `access/payloadGuard.ts`, `adapters/{accessJwt,testSigner,identityMarker,pgEvents,payloadAlarms,payloadCatalog,payloadCorrections,payloadUnattended,s3}.ts`, `cli/**`, `admin/**` (Payload admin UI) and `globals/**`.
   - "Новий домен" row list gains `globals`, `subscribers`, `revertHandlers`, `imports` and `adminSlots`.
   - New rules:
     - "Admin = Access gate (`proxy.ts`) + a second check in Payload (`harden`). Local-API callers pass `context.t2fTrusted`";
     - "Every write goes into `audit-log` in the same transaction; `audit-log` is never deleted";
     - "An internal event = an outbox row in the transaction + NOTIFY/poll; state is the truth, the event is a hint".
2. **`docs/backend/sdd-routing.md` §1:**
   - security: add `server/src/proxy.ts`, `server/src/adapters/{accessJwt,testSigner,identityMarker,s3}.ts`, `server/src/cli/**`, `scripts/boards/**` (they read the root);
   - ms: `server/src/globals/**` (already there);
   - add an unrouted note for `server/src/admin/**/*.tsx` (the react row excludes `server/**`; suggest a row `server/src/admin/**/*.tsx` → `react-best-practices`), and for `scripts/*.py`, `scripts/tests/**`, `playwright.http.config.ts`.
3. **`docs/backend/README.md` §6 and §9:**
   - §6 Commands: add `pnpm --dir server import <domain> [--apply]`, `pnpm --dir server export catalog --from … [--write]`, `pnpm --dir server owner:create --email …`, `node scripts/boards/{http-seeds,compare-live}.mjs`, `npx playwright test -c playwright.http.config.ts`, `python -X utf8 scripts/tzdb_report.py --source data|<url>`.
   - §9: remove `http-seeds.mjs`, `compare-live.mjs`, the Playwright http config, masks and the R2 emulator from "what does not exist yet". They now exist; the tools live in `web/scripts/boards/`, not in `board-tools/`.
4. **`docs/backend/frontend-seam.md`:**
   - §3.1 "Майбутнє джерело" → "now: `GET /api/catalog` in the integration build (fails closed); production build — `T2F_CATALOG_URL` (until SPEC-08/13a)";
   - §3.11 rows: `catalog` `GET /api/catalog` (served by `server/`, reason `catalog-invalid`, `rate_limited` 30/min); test doors adds `access-token`, `alarm`, `admin-test-slice`.
5. **`docs/backend/secrets.md`** (SPEC-13a hand-off): changing `PAYLOAD_SECRET` voids every agent API key, so issue the keys again (EC-8, OQ-7). Add new variable names: the `T2F_ACCESS_*`, `T2F_OWNER_EMAILS` and `T2F_R2_*` names.
6. **`docs/backlog.md`:** subscribe to tzdb announcements (tz-announce) before the festival; run `scripts/tzdb_report.py` in the first week of December and before 30.12, saving into `web/docs/tzdb-reports/` (AC-52).
7. **`docs/backend/README.md` §1 or `local-stack` mention:** the `r2` compose service and the per-worktree prefix.

## Assumptions
Technical judgement calls only:
- **Gate location:** Next 16 `proxy.ts` plus a second check through `harden()` on every collection (research-access-payload §6–§7). The exact hook (`beforeOperation` or the route wrapper) is decided by W10, with the fallback written down.
- **Identity hand-off from proxy to Payload:** an HMAC-signed request header with a per-process key. Inbound copies are stripped, so a direct route call without the proxy has no valid marker (AC-5).
- **Not-found parity (AC-6)** comes from a proxy rewrite to a non-existent path, so Next renders its own 404 for both cases.
- **Content languages are group fields `{uk,en,es,fr}`**, not Payload localization. This keeps the `data/` shape, one table per collection, and byte-equal export.
- **Catalog foreign keys are text natural keys** (`zoneId`, `countryIso`, `cityId`), not Payload relationship fields. Import, seed and export upsert by natural key; integrity is checked by `domain/catalog/integrity.ts`.
- **"Changed in admin since import"** = the current row hash ≠ `importedHash`.
- **The admin `role` column gets `defaultValue: 'owner'`.** This makes the migration safe for an existing row, which can only be the owner; AC-14's hook prevents a second owner.
- **The internal-events version** is the outbox `id`, plus a per-topic counter under `pg_advisory_xact_lock`, so ids commit in order.
- **The R2 copy key layout** is `<prefix>catalog/latest.json` and `<prefix>catalog/<version>.json`. The prefix is the worktree slug; production uses an empty prefix in its own bucket (SPEC-13a).
- **Kyiv conversion uses Node ICU** (`Intl`). Kyiv's rules are stable, and the tzdb-pinned generator stays the only source of zone midnights.
- **`jose` 5.10.0** (the version Payload already resolves), not 6.x. A later upgrade is listed in Research.
- **Board masks are rectangles** in `scripts/boards/masks.json`. `compare-live` sees only PNGs; selector masks would need the live DOM.
- **The transient `BT/reports/_fid-*.json`** written by `snapshot.mjs` is deleted in the same step. It is the only touch of the root docs tree.

## Open questions
None. OQ-1 is handled by W51's STOP/wait rule, OQ-2/OQ-3 by the W9/W10 spikes with fallbacks, OQ-4 by the `owner-dependent` items, OQ-5 by reading the tool (spec follow-up 3), and OQ-6/OQ-7 belong to SPEC-13a (Docs patch 5).

## Research used
- `C:/Users/ADMIN/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/side-session-notes/local_359ad0f2-bcef-4e10-835b-0930d88a93eb/spec-04/research-code.md`: catalog shape, sizes, SPEC-02 registries, seed, doors, env, services and board tooling.
- `…/spec-04/research-access-payload.md`: Access JWT validation, JWKS rotation and jose caching, person vs service claims, Payload strategy order (a custom strategy cannot veto a password session, so the gate goes in front), Next 16 proxy, cookie/csrf behaviour, API keys (DB lookup per request, so revocation is immediate; `PAYLOAD_SECRET` change voids keys), versions deleted with the document.
- One planner researcher (`research-tools:researcher`, Sonnet, web, 2026-11-17):
  - **(a) Emulator:**
    - MinIO's repo was archived 2026-04-25 and the image is unreliable;
    - LocalStack has needed an auth token since 2026-03;
    - `adobe/s3mock:5.2.3`, pushed 2026-09-19: env initial buckets, path-style, 256m suggested for CI;
    - SeaweedFS `weed mini` 4.54 (2026-11-16): multi-service in one process, so RAM is doubtful;
    - `versity/versitygw` v1.11.0 (2026-11-06).
  - **(b) Client:** `@aws-sdk/client-s3` 3.1170.0 is the Cloudflare R2 Node example (`region: 'auto'`); `aws4fetch` 1.0.20 is from 2024-08-28.
  - **(c) jose:** the latest is 6.2.17 (2026-11-09). At tag v5.10.0, `timeoutDuration` 5 s, `cooldownDuration` 30 s, `cacheMaxAge` 10 min and `createLocalJWKSet` all exist. The 6.0 breaks do not affect `jwtVerify`, `SignJWT` or `createRemoteJWKSet` signatures.
  - **Not established:**
    - the idle RAM of each emulator: W2 measures it and has the fallback rule;
    - whether the images ship `curl`/`wget`: a host-side probe is used instead;
    - R2's behaviour with flexible checksums: `WHEN_REQUIRED` is set, and W34 tests it against the emulator; real R2 is SPEC-13a;
    - the jose per-advisory affected versions: the newest advisory (2024-03) concerns JWE, which is not used.
- Spot-checked by the planner in this worktree:
  - `server/{package.json,next.config.mjs,vitest.integration.config.ts,playwright.config.ts}`;
  - `server/src/{payload.config.ts,ports.ts,container.ts,instrumentation.ts}`;
  - `server/src/registries/{collections,routes,moments,env}.ts`;
  - `server/src/endpoints/types.ts`, `server/src/test-doors/{index,registry}.ts`, `server/src/seed/{registry,index,cli}.ts`, `server/src/clock/index.ts`, `server/src/platform/{env.ts:1-60,env.check.ts,logger.ts:60-77}`;
  - `server/scripts/{db,verify-schema}.mjs`, `server/test/integration/{global-setup,helpers}.ts`, `docker-compose.yml`;
  - `lib/api/{contracts/catalog.ts,services.ts:1-80,http/index.ts}`, `lib/data/{load.ts,types.ts:330-433}`, `next.config.ts`, `package.json` scripts, `vercel.json`, `.npmrc`, `.gitignore`;
  - `packages/contracts/{package.json,src/index.ts,src/result.ts,src/site.ts:25-73,src/schemas.ts}`, `playwright.config.ts`, `scripts/build_schedule.py` (grep), `scripts/tests/test_no_key_leak.py:1-20`;
  - `BT/snapshot.mjs:1-100` (`--shots` at `:25`, reports at `:26`), `BT/diff.mjs:1-30`, and the manifest counts.
- The knowledge file `docs/knowledge/gotchas.md` does not exist yet. `cloudflare-notes.md` does not exist yet (SPEC-05 not merged).

## Rollback / blast radius
- **Rollback:**
  - discard the worktree changes;
  - roll back the WIP or final migration on **own DBs only** (`migrate:down`, or `migrate:reset` on `t2f_spec_04_admin_catalog{,_test}`);
  - remove the `r2` service from compose with `docker compose -p t2f rm -sf r2`; never `down -v`;
  - `pnpm install`.
- **Blast radius if merged:**
  - **Site:** the catalog is unchanged for the demo and the production build. Only the integration build reads the server, and AC-69 is proven in W55.
  - **Shared stack:** a new `r2` container (256 MiB) in the `t2f` project, so other worktrees see one more service in `stack:up`.
  - **Server:** the admin is now behind the gate in **every** class. A misconfigured Access env in rehearsal or production refuses to start (AC-7), which is intended.
  - **Lockfile:** `@aws-sdk/client-s3` closure (server only), plus `jose`, `@payloadcms/translations` and `pngjs`, which are already in the tree.
  - **Other waves:** SPEC-07/08/12/13b/21 get the subscriber, revert, import and slot registries and the ports. Nothing they own is edited.
- No production resource is touched, and nothing changes in real Cloudflare.
