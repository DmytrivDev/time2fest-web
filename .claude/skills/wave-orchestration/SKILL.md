---
name: wave-orchestration
description: How the Time2Fest orchestrator runs backend waves — dependency graph of wave specs, one sub-session per spec in its own git worktree with its own database, owner answers only the first-pass questions, merge order and conditions, conflict avoidance (shared enumerations pipelined, migrations by the second to merge), stuck sub-sessions, RAM caps, worktree cleanup, and the sub-session brief template. Use in the orchestrator session (launched in web/ on master) when starting, watching or merging wave specs.
---

# wave-orchestration — umbrella spec → waves → merged master

Sources: the umbrella spec (Spec Kit, root `D:/Work/Pets/Time2Fest/specs/002-…/`) and the wave map `D:/Work/Pets/Time2Fest/docs/backend/roadmap.md` (orchestrator-owned: specs, `depends on`, shared enumerations each spec touches, state). Procedure overview for people: `docs/backend/README.md`.

## 1. Orchestrator role
- Session launched in `D:\Work\Pets\Time2Fest\web` on `master`, Opus. It does not write feature code, specs or plans; it reads reports, `git log`, `git diff --stat`, ledgers.
- A spec whose dependencies are merged is started without asking: `start_session` with a worktree, branch `spec-NN-<slug>`, fresh context, the brief from §6.
- **Limits:** ≤3 sub-sessions alive; ≤2 in a heavy phase (run-plan-auto, e2e, board capture, builds) on the whole machine — the third waits after its plan. One board-capture run at a time.

## 2. Owner touchpoints (decision.md 2026-11-14)
1. **First pass of every wave spec**: the sub-session returns spec-creator's questions with recommended defaults; the orchestrator relays them to the owner in one numbered message (several specs → one message, grouped), passes the answers back. Then everything runs autonomously to a merged result.
2. **Stops** (ask the owner, otherwise never): a choice contradicts `docs/` or the constitution, or has no recommended option; a new business rule (money, sign-in, privacy, YouTube policy); missing access or account (PayPro, Google OAuth, SMTP, Cloudflare, server); a `layout`-class fidelity difference or any visible change; a security HIGH that one fix round did not close; second failed attempt (verify, merge, escalated Opus phase); a usage/context limit that `hand_off_to_session` cannot get around; plugin version changed mid-wave.
3. Accepted explained fidelity differences and every autonomous decision `[А]` are listed for the owner in the merge summary.

## 3. Avoid the 149-conflict rebase (Genfasad lesson)
- **Pipeline, not parallel**, for specs touching the same shared enumerations: `ApiError` codes/reasons, `SystemPayload` kinds, channel names, the Payload `users` collection, `packages/contracts/src/index.ts`, `payload.config.ts` collection list, the migrations folder. The second spec may write its spec and plan in parallel; its `run-plan-auto` starts only after the first is merged and it has rebased. Say so in its brief.
- **One domain = its own files** (`packages/contracts/src/<domain>.ts`, `server/src/collections/<domain>/`, `server/src/endpoints/<domain>/`, `lib/api/http/<domain>.ts`). Registration lists (barrels, collection arrays, route indexes) are one entry per line, sorted — SPEC-01 creates them with slots so later waves only append a line.
- **Migrations** are generated only by the spec that merges second, after rebase (`migration-safety`).
- **Lockfile:** new dependencies only in a wave's first phase; on conflict take master's `pnpm-lock.yaml` and rerun `pnpm install`, never hand-merge.
- **Rebase early:** the sub-session rebases on `master` after the spec, after the plan, before `run-plan-auto` and before its final report.
- **Indexes and root docs** only by the orchestrator (`docs-sync` §1); no formatting sweeps or renames of shared files inside a wave.
- Merge one branch at a time, smallest first.

## 4. Per-worktree resources (16 GB, one Postgres)
- Database `t2f_<slug>` and test database `t2f_<slug>_test` in the shared local Postgres container; created by `local-stack` for the worktree; integration tests serial.
- Port slot: the orchestrator assigns slot k = 1..3 in the brief: server `4000+10k`, web integration build `4001+10k`, Centrifugo shares the stack (namespaces per slot). Exact scheme: `local-stack` (S01).
- Secrets: `.env.local` lives only in the main checkout; the brief gives the absolute path to read, worktrees never copy it into git.

## 5. Merge
**Conditions** (from the sub-session report, verified by the orchestrator on the branch): spec `approved` with ≥2 researchers used; plan-verifier — every item and AC verified; architecture-reviewer — no CRITICAL open; security-reviewer — no HIGH/MEDIUM open; contract suites green; migration-safety green; layout-fidelity — no unexplained defect; docs patch present.
**Then:** `git merge --no-ff spec-NN-<slug>` into `master` → `verify.full` of every touched package on master → apply the docs patch (`docs-sync`), index row, `roadmap.md` state, one line in `docs/process.md` → `graphify update .` → at the end of a wave `drift-check` (Sonnet subagent). **No push** unless the owner asks. Failing conditions → back to the sub-session via SendMessage; second failure → stop.

**Cleanup after merge:** `git worktree remove .claude/worktrees/<name>`, `git branch -d spec-NN-<slug>`, drop the worktree's own databases (`t2f_<slug>`, `t2f_<slug>_test` — only these, only after merge), `git worktree prune`. Keep ≤4 worktrees on disk.

**Stuck sub-session:** no news for 30 min → `git -C <worktree> log -3`, read `<worktree>/.claude/sdd/runs/*.md` tail, then SendMessage "continue from the ledger, step <n>". `list_events` sometimes lacks the report text → collect from the branch (commits, ledger, spec). Limits → pause: the sub-session stops background agents, makes a WIP commit, writes `docs/plans/<slug>.resume.md` (done phases, current phase state, next action, `[А]` decisions); resume in the same worktree with "read the resume file and continue".

## 6. Sub-session brief (complete — it cannot see this conversation)
- **Role:** "You run SPEC-NN <name> (wave N of `docs/backend/roadmap.md`) in a worktree. Report to the orchestrator in Ukrainian. Ask the owner nothing; questions go to the orchestrator; stops — wave-orchestration §2."
- **Read:** CLAUDE.md (auto), `D:/Work/Pets/Time2Fest/docs/backend/README.md`, `sdd-routing.md`, the wave's section of the umbrella spec, `frontend-seam.md` §3.x of your domains + §3.11, `content-freshness.md` §5 if relevant, the constitution. Nothing from sdd-routing §6 "never".
- **Cycle, commit after each stage:**
  1. `sdd-engineering:spec-creator` (Opus) with ≥2 `research-tools:researcher` in parallel (Sonnet for code/docs facts — also hand-offs "до SPEC-NN" and open OQs in neighbouring specs; Opus + web for PayPro, Better Auth, Centrifugo, Cloudflare). Pass 1 → send the questions with defaults to the orchestrator and **wait**. Pass 2 → `docs/specs/SPEC-NN-<slug>.md`, Ukrainian body per sdd-routing §3. Set `Status: approved` after the owner's answers are encoded and no marker remains.
  2. `sdd-engineering:implementation-planner` (Opus): English plan `docs/plans/SPEC-NN-<slug>.plan.md`, phases ≤5–6 items or ~12 files, `Model` column, ≤2 lanes with disjoint files; execution mode — recommended.
  3. Skill `run-plan-auto docs/plans/SPEC-NN-<slug>.plan.md` (if pipelined: wait for the orchestrator's go after rebase).
  4. Commit the result; rebase on master; final report.
- **Rules:** commits only in your branch (Ukrainian messages, attribution trailer); no push, no merge; no code outside your spec; your DB `t2f_<slug>`, port slot k; Docker Desktop must be running; never read or copy `research_data/`; secrets only from the main checkout's `.env.local`, never printed.
- **Report:** branch, commits, commands run and results, verdict tables (plan-verifier, architecture, security, contract, migration, fidelity), models used and escalations, `[А]` decisions, researcher questions, the docs patch, what stays open.
- **Background:** 2–3 sentences on the wave and its neighbours.
