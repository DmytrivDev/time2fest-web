---
name: docs-sync
description: Keeps Time2Fest documentation in step with decisions and code. Use after an owner decision or answer, after a wave step (spec, plan, run, merge), when a contract, route, channel or visible screen changes, or when asked to update docs. Knows the Time2Fest docs map (decision.md, conception.md, process.md, backlog.md, docs/site, docs/backend, PRD) and who may write what. Writes Ukrainian.
---

# docs-sync — Time2Fest documentation

Root docs live in `D:/Work/Pets/Time2Fest/docs/` and are **not in git**. Code and wave specs/plans live in the `web` repo. Write **Ukrainian**; never put keys, emails of real people or data from `research_data/` into docs.

## 1. Who writes what
- **Wave sub-session (worktree):** never edits anything under `D:/Work/Pets/Time2Fest/` outside its own checkout (root `docs/**`, `CLAUDE.md`, `.specify/**`). Parallel worktrees would overwrite each other with no merge. Instead it puts a **docs patch** into its final report: per file, the exact text and where it goes. Inside its checkout it edits its spec, plan, `web/README.md`, `server/README.md`, `docs/knowledge/gotchas.md` (only via `sdd-engineering:engineering-insights`).
- **Orchestrator (main session):** applies docs patches at merge time, and alone edits `web/docs/specs/README.md` (index), `docs/backend/roadmap.md`, `docs/process.md`, `docs/decision.md`, `CLAUDE.md`, `docs/handoff.md`.

## 2. What happened → what to update

| What happened | Update |
|---|---|
| Owner decision or answer | New entry at the **top** of `docs/decision.md`: date, decision, reason, status. Never rewrite old entries; a changed decision is a new entry that names the old one |
| What we build changed | `docs/conception.md` (and the PRD `docs/bmad/planning-artifacts/prds/prd-Time2Fest-2026-10-20/prd.md` only if the owner says the requirement itself changed) |
| Wave merged / strategic step done | One line at the **bottom** of `docs/process.md`: date — what, commits |
| Idea or task for later | Checkbox in `docs/backlog.md` |
| Method, route, channel, event, `ApiError` code or reason changed | `docs/backend/frontend-seam.md` §3.x of the domain **and** the §3.11 row; the comment in `web/lib/api/contracts/<domain>.ts` |
| Fast path, admin switch, snapshot, cache, emergency path changed | `docs/backend/content-freshness.md` §5 |
| Something visible on the site changed (new state, skeleton, text) | `docs/site/<page>.md` (and `00-overview.md` if the rule is general) **and re-capture that page's boards** with `board-tools/` (README there; `00-overview.md` §8.4), then rebuild the canvas. In the backend phase a visible change needs the owner's OK first (constitution, layout-fidelity) |
| Wave spec status / wave state | `web/docs/specs/README.md` index; `docs/backend/roadmap.md` — orchestrator only |
| Backend code structure (routes, collections, jobs, env vars, ports) | `docs/backend/code-map.md` (one paragraph per package), not `CLAUDE.md` |
| Non-obvious lesson | Offer `sdd-engineering:engineering-insights` → `web/docs/knowledge/gotchas.md` |
| New document | Line in `docs/README.md`; key document — also the table in `CLAUDE.md` |
| Umbrella backend spec / wave map changed | Root `specs/002-…/` (Spec Kit) and `docs/backend/roadmap.md`; it is done live with the owner |
| Test doors, fixtures, ports, compose services changed | `docs/backend/README.md` (commands) and skill `local-stack` |

## 3. Checks before you finish
- [ ] Every decision has a `decision.md` entry; nothing contradicts a newer entry.
- [ ] Contract changes are in `frontend-seam.md` §3.11.
- [ ] Visible changes: page file updated, boards re-captured or listed as "не знято" with the reason.
- [ ] `process.md` has a line for a finished step.
- [ ] No secrets, no personal data.
- [ ] In doubt about doc ↔ code → run skill `drift-check` (orchestrator, once per wave).

Tell the owner briefly which documents changed.
