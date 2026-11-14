---
name: run-plan-auto
description: Autonomous /sdd-engineering:run-plan for Time2Fest backend waves (the plugin skill is user-only). Use in a wave sub-session once the wave spec is approved and its plan exists in docs/plans/. Adds the pinned-plugin check, per-phase models with Sonnet-to-Opus escalation, context budget, RAM caps and the Time2Fest gates (contract-conformance, migration-safety, layout-fidelity, security-reviewer).
argument-hint: "docs/plans/<slug>.plan.md [notes…]"
---

# run-plan-auto — autonomous run-plan for Time2Fest

The plugin skill `sdd-engineering:run-plan` has `disable-model-invocation: true`. This wrapper reads it and executes it as your own instructions. Consent to run = the wave spec is `approved` (owner answered the first-pass questions; decision.md 2026-11-14). Routing, models and limits: `D:/Work/Pets/Time2Fest/docs/backend/sdd-routing.md`.

Arguments: `$ARGUMENTS`

## 1. Preconditions — stop with a report if any fails
1. The first argument is an existing `docs/plans/*.plan.md` (relative to the repo root of this checkout).
2. The spec named in its `Requirements source` has `Status: approved` in the spec file itself.
3. `git branch --show-current` is not `master`. `git rev-parse --show-toplevel` is `D:/Work/Pets/Time2Fest/web` or a worktree under `web/.claude/worktrees/`.
4. The plan's `Execution` table has a `Model` column. Missing → treat every phase as `sonnet` except phases whose items touch `server/src/{auth,payments,realtime,test-doors,agent-api}/**` or `workers/**` → `opus`; note it in the ledger.

## 2. Locate the pinned plugin
1. Read `.claude/sdd-pin.json` → `version`, `gitCommitSha`.
2. Read `~/.claude/plugins/installed_plugins.json`, key `sdd-engineering@devdigest-marketplace`. Prefer the entry whose `projectPath` is `D:\Work\Pets\Time2Fest\web` (case-insensitive), else any entry with the pinned `version`.
3. The entry's `version` must equal the pin and its `gitCommitSha` must start with the pinned sha. Mismatch → **STOP**: "plugin changed during the wave (installed X, pinned Y)". The orchestrator decides: re-pin between waves, or reinstall the pinned version.
4. File missing or format changed → fall back to `~/.claude/plugins/cache/devdigest-marketplace/sdd-engineering/<pinned version>/`.
5. That directory is the **plugin root**. Read `<root>/skills/run-plan/SKILL.md` in full; missing → STOP.

## 3. Execute it, with these overrides
Substitute `$ARGUMENTS` = this skill's arguments, `${CLAUDE_PLUGIN_ROOT}` = plugin root. The line "Runs only when the user invokes /sdd-engineering:run-plan" counts as satisfied.

**Autonomy.** Where run-plan says "ask the user" decide yourself: CRITICAL/WARNING → fix, SUGGESTION → skip (listed), disputed → take the side with evidence and record it. Ask (AskUserQuestion) only on the stop list of the `wave-orchestration` skill.

**Models.** Every `sdd-engineering:implementer` call passes `model` = the phase's `Model` (`sonnet` | `opus`). `plan-verifier` and `architecture-reviewer` → `model: "sonnet"`. `security-reviewer` and `fidelity-triager` → their own frontmatter (no override).

**Escalation Sonnet → Opus (per phase or fix batch).** An *attempt* is one implementer dispatch. A `PARTIAL` that completed ≥1 item is progress, not a failed attempt. Escalate to `model: "opus"` when any holds:
1. after the Sonnet phase report **and** one Sonnet fix-mode round, the phase's targeted `verify.files` is still red;
2. Sonnet returns `BLOCKED` that is not structural, or `PARTIAL` with zero items done;
3. the same item comes back `PARTIAL` twice in a row;
4. plan-verifier marks the same item `not verified` in two rounds;
5. a review finding fixed by Sonnet is reported `still open` or reopens;
6. a Sonnet implementer hangs twice (see "Stuck agents").
On escalation: re-dispatch the remaining items (or the open findings, fix mode) on Opus with a 5-line note of what failed (failure lines only, no logs). Ledger line: `ESCALATED <phase> sonnet→opus: <rule n>`. The rest of that phase stays on Opus; the next phase returns to its planned model. Opus gets one attempt + one fix round; still red → STOP (stop list: second failure).

**Stuck agents.** No report from a dispatched agent after 45 min of wall time → TaskStop it, record `HUNG`, re-dispatch the same work once with the same notes. Second hang → escalation rule 6 (Sonnet) or STOP (Opus).

**Checks inside phases.** Implementers run only the targeted `verify.files` of their package and the tests of the files they changed — never `full`. `full` runs once, in the integration pass. A plan item "full verify" in the last phase is closed by that pass.

**Parallelism (16 GB RAM).** At most **2** implementers at once (lanes), and only if no other worktree is running heavy work (ask the orchestrator in the report if unsure). Vitest `--maxWorkers=2`, Playwright `--workers=2`. Integration tests of the server run serially against this worktree's own database (`local-stack`).

**Context budget — paste verbatim into the notes of every implementer brief:**
> Context budget:
> - From the plan read only the header, your `Execution` row, your items and the `Affected surface` rows of your files: `grep -n`, then Read with offset/limit. From the spec read only the ACs your items cite (`grep -n "AC-NN"`).
> - Search code precisely (Grep, `graphify explain/affected` per skill graphify-rules) and read ranges of ≤150 lines. Read a whole file only if it is under 200 lines or you rewrite it. Never re-read a file you just wrote.
> - Trim command output (`| tail -40`); look only at failing tests.
> - Never read: reference-boards/**, board-tools/shots/** (except named *.diff.png), docs/archive/**, research_data/**, Old Project/**, graphify-out/graph.json, out*/, .next*/.
> - After ~120 tool calls with work left: bring the current item to a green targeted check and return `Status: PARTIAL` listing the remaining items.

**Time2Fest gates — run after integrate, before verify #1, only when the plan's `Contract changes` says yes:**
- `Wire contract: yes` → skill `contract-conformance` (sim and http suites of the touched domains). Red → implementer fix mode.
- `Payload migration: yes` → skill `migration-safety`. Red → fix mode; destructive change without a plan item → STOP.
- `Layout fidelity: yes` → skill `layout-fidelity` (after the screens/adapters phase). Defects → fix mode with the rule "fix data or adapter, never layout components".
- `Seed and fixtures: yes` → skill `seed-and-fixtures` checks.

**Review.** Round 1 in one message: `architecture-review:architecture-reviewer` (scope: change; pass `D:/Work/Pets/Time2Fest/docs/backend/architecture.md` if it exists) **and** `security-reviewer` — for every wave spec, not only security-routed files. Architecture: max **2** rounds. Security: one round + one fix round for HIGH and MEDIUM; LOW → listed.

**Commits.** run-plan never commits. After its report the sub-session commits into its own branch (message in Ukrainian, attribution trailer from the session).

## 4. Report additions
Besides run-plan's report: phase → model used → escalations; agent hangs; gate tables (contract, migration, fidelity summary with the list of accepted differences for the owner); the "docs patch" for `docs-sync` (text the orchestrator applies to root docs).
