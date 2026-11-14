---
name: graphify-rules
description: When and how agents use the Graphify code map in Time2Fest instead of reading whole files — graphify affected before changing shared code, explain for an unfamiliar module, path between two symbols, update after a wave; separate graph for server/. Use before editing shared web code (lib/api, resource.ts, hooks, lib/engine), when exploring unfamiliar code, and after merging a wave.
---

# graphify-rules

CLI `graphify` (`C:\Users\ADMIN\.local\bin\graphify.exe`; in Git Bash `export PATH="$PATH:/c/Users/ADMIN/.local/bin"`). Commands run **from the repo root** (`web/` or the worktree root). Answers are short; they replace reading files, not Grep.

| When | Command |
|---|---|
| Before changing a shared symbol (`lib/api/*`, `resource.ts`, hooks, `lib/engine/*`, a contract type) | `graphify affected "<symbol>" --depth 2` → list the dependants in the plan item or report |
| Need to understand an unfamiliar module or function | `graphify explain "<symbol>"` (not reading the file whole) |
| How two things are connected | `graphify path "<A>" "<B>"` |
| Words, strings, texts | Grep — `graphify query` is noisy |
| After a wave is merged into master (orchestrator) | `graphify update .` (~30 s, no model) |

- Exit 3 = ambiguous name (candidates listed — pick one), 4 = no node.
- **Worktrees:** `graphify-out/` is not in git, so a fresh worktree has no graph. Use the main checkout's graph read-only: `--graph D:/Work/Pets/Time2Fest/web/graphify-out/graph.json` (it may lag the branch — confirm with Grep), or run `graphify update .` once in the worktree if the wave changed shared code. Never commit `graphify-out/`.
- **Server graph (once `server/` exists):** add `server/` and `packages/` to `web/.graphifyignore`, build a separate graph `cd server; graphify update .` (writes `server/graphify-out/`, add it to `.git/info/exclude`). Cross-side questions: `graphify merge-graphs graphify-out/graph.json server/graphify-out/graph.json --out <tmp>/merged.json`, then `--graph <tmp>/merged.json`.
- Never read `graphify-out/graph.json` or `graph.html` with Read. Never add `research_data/` or `docs/` to a graph; no LLM labelling (`label`, `cluster-only` with naming) without the owner.
