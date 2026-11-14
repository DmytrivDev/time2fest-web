---
name: drift-check
description: Deep comparison of Time2Fest documentation, code and UI (doc ↔ web ↔ server ↔ seam routes table). Use once per wave by the orchestrator after merge, before a demo, or when the owner asks /drift-check. Finds and reports mismatches with file:line on both sides; fixes nothing. Run it as a Sonnet subagent to save tokens.
argument-hint: "[base: commit, tag or master~N; default — merge-base of the wave branch, else HEAD~10]"
---

# drift-check — docs ↔ code ↔ UI

You only find and show mismatches. What is true is decided by the owner (product) or the orchestrator (technical).

## 1. Scope
1. Base: the argument, else `git merge-base HEAD master` of the wave, else `HEAD~10`. Say what you compare against.
2. Changed files in `web`: `git diff --name-only <base>...HEAD` + `git status --porcelain`.
3. Group them:
   - **web code** — `app/**`, `components/**`, `lib/**`, `stores/**`;
   - **seam** — `lib/api/contracts/**`, `lib/api/http/**`, `lib/api/sim/**`, `packages/contracts/**`;
   - **server** — `server/**`, `workers/**`, `functions/**`;
   - **UI texts** — `messages/uk.json`;
   - **docs** — root `D:/Work/Pets/Time2Fest/docs/site/**`, `docs/backend/**`, top entries of `docs/decision.md` (grep by date), `web/docs/specs/**`.

## 2. Claims to check (cite file:line)
- `docs/backend/frontend-seam.md` §3.11 — every route and channel ↔ a server handler (grep the route path in `server/src/endpoints/**`, Payload `endpoints:` arrays, Better Auth mount) **and** an `http` adapter method; extra server routes that §3.11 does not list.
- `ApiError` codes and reasons in `lib/api/contracts/<domain>.ts` comments ↔ codes the server returns ↔ codes the UI handles.
- `content-freshness.md` §5.1 (`site` domain, `live` events `hide`/`version`) ↔ code.
- `docs/site/<page>.md` "Код" sections — paths exist; "Відомі межі" items still true.
- `docs/backend/README.md` and skill `local-stack` commands ↔ `package.json` scripts and compose file.
- Wave spec ACs marked implemented ↔ plan-verifier verdict in the run ledger.
- Constitution rules: nothing rendered over the YouTube player; test doors registered only under the test flag (grep the door routes and their guard); prices not hard-coded in texts that the admin can switch; no `research_data` path in code, seeds or tests.
- `CLAUDE.md` commands and paths still exist.

## 3. Verdicts
- ✅ matches (count only, if many);
- ❌ mismatch — code/UI does something else; say what;
- ⚠️ promised but not built, or built but not documented;
- ❔ could not check — say why.
Use Grep, Read ranges, `graphify explain`; never guess.

## 4. Report (Ukrainian, in the chat)
```markdown
## Drift-check: <base>..HEAD, <date>
Обсяг: N файлів коду, M текстів, K документів.
| # | Статус | Твердження (документ:рядок) | Код / UI (файл:рядок) | Деталі |
**Підсумок:** ✅a · ❌b · ⚠️c · ❔d
**Пропозиції:** що виправити в коді, що в документах (рішення — за власником чи оркестратором).
```
Order: ❌, then ⚠️, then ❔.

## 5. After
Fix nothing yourself. Doc fixes go through `docs-sync`, code fixes as a normal task or wave. The orchestrator adds one line to `docs/process.md` only if the drift check closed a wave.

## Why there is no Stop hook here
Genfasad's `docs-drift-gate.mjs` reads `git status` of the project root. In Time2Fest the docs live outside git (root is not a repo), so the hook would see web code changes without ever seeing the doc changes and would block after almost every coding turn — noise, extra turns, extra tokens. The same check is done once per wave by this skill and by the docs patch in every sub-session report.
