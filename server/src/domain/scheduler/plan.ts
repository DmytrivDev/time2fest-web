/**
 * The scheduler's plan (SPEC-07 AC-24, AC-26, AC-30, AC-36 … AC-38, NFR-6), ring 1: pure, no I/O,
 * no clock read — server time and the settled pairs are parameters.
 *
 * - Moments come from `seasonMoments` (C1) in its fixed order; this module never re-sorts them.
 * - A group is one (action, instant): every moment of the action's kinds at that instant, in C1
 *   order. The action is called once per group (AC-30).
 * - Groups follow the C1 order of their first moment; groups sharing a first moment follow the
 *   order of the action rows.
 * - A pair (action, moment key) settled in the current run epoch never becomes due again — not
 *   after a backward jump, not after a patch moved the moment (AC-26, AC-37). A new run epoch
 *   starts with an empty settled set.
 */
import type { SeasonMoment, SeasonMomentKind } from '@time2fest/rules/time';
import { pairKey } from './consequence';
import { lateVerdict, untilBoundary, type LateRule, type LateVerdict } from './late';

export type { LateRule };

/** The part of a moment-action row (C5) the plan needs. */
export interface ActionRule {
  /** Action key: kebab-case, unique; the first part of every consequence id. */
  readonly key: string;
  readonly kinds: readonly SeasonMomentKind[];
  readonly late: LateRule;
  /** Classes the row exists in; absent = every class. */
  readonly classes?: readonly string[];
}

export interface PlanGroup {
  readonly action: string;
  readonly at: number;
  /** C1 order. */
  readonly moments: readonly SeasonMoment[];
}

export interface SchedulePlan {
  /** Sorted by `at`, then C1 order of the first moment, then action row order. */
  readonly groups: readonly PlanGroup[];
  readonly rules: ReadonlyMap<string, ActionRule>;
  readonly byKey: ReadonlyMap<string, SeasonMoment>;
  readonly byKind: ReadonlyMap<SeasonMomentKind, readonly SeasonMoment[]>;
}

/** A group with only its not-yet-settled moments. */
export type DueGroup = PlanGroup;

export interface DueOptions {
  /** AC-38: frozen virtual time runs nothing. */
  readonly frozen?: boolean;
  /** Groups before this server instant are not due (for example the start of a fresh run epoch). */
  readonly since?: number;
}

const ACTION_KEY = /^[a-z][a-z0-9-]*$/;

/** True when the row exists in `cls`. */
export function appliesIn(rule: Pick<ActionRule, 'classes'>, cls: string): boolean {
  return rule.classes === undefined || rule.classes.includes(cls);
}

/** Static check of the action rows: kebab-case keys, at least one distinct kind, a sane late rule. */
export function assertActionRules(rules: readonly ActionRule[]): void {
  for (const r of rules) {
    if (!ACTION_KEY.test(r.key)) throw new Error(`moment action ${r.key}: key must be kebab-case`);
    if (r.kinds.length === 0) throw new Error(`moment action ${r.key}: no moment kinds`);
    if (new Set(r.kinds).size !== r.kinds.length) throw new Error(`moment action ${r.key}: duplicate kinds`);
    if (r.classes !== undefined && r.classes.length === 0) throw new Error(`moment action ${r.key}: empty classes`);
    const late = r.late;
    if (late !== 'always' && 'within' in late && !(Number.isFinite(late.within) && late.within > 0)) {
      throw new Error(`moment action ${r.key}: within must be a positive number of ms`);
    }
  }
}

/**
 * The plan for `moments` (C1 order) and the action rows of class `cls`. One pass: O(moments ×
 * matching rows). Re-run it whenever the moment list changes (patch, catalog change).
 */
export function buildPlan(moments: readonly SeasonMoment[], rules: readonly ActionRule[], cls: string): SchedulePlan {
  const active = rules.filter((r) => appliesIn(r, cls));
  const byKindRules = new Map<SeasonMomentKind, ActionRule[]>();
  for (const r of active) {
    for (const kind of r.kinds) {
      const list = byKindRules.get(kind);
      if (list) list.push(r);
      else byKindRules.set(kind, [r]);
    }
  }

  const groups: { action: string; at: number; moments: SeasonMoment[] }[] = [];
  const open = new Map<string, { action: string; at: number; moments: SeasonMoment[] }>();
  const byKey = new Map<string, SeasonMoment>();
  const byKind = new Map<SeasonMomentKind, SeasonMoment[]>();
  let openAt: number | undefined;

  for (const moment of moments) {
    byKey.set(moment.key, moment);
    const ofKind = byKind.get(moment.kind);
    if (ofKind) ofKind.push(moment);
    else byKind.set(moment.kind, [moment]);

    // C1 keeps equal instants together, so the open groups of the previous instant are closed.
    if (moment.at !== openAt) {
      open.clear();
      openAt = moment.at;
    }
    for (const r of byKindRules.get(moment.kind) ?? []) {
      let group = open.get(r.key);
      if (!group) {
        group = { action: r.key, at: moment.at, moments: [] };
        open.set(r.key, group);
        groups.push(group);
      }
      group.moments.push(moment);
    }
  }

  return { groups, rules: new Map(active.map((r) => [r.key, r])), byKey, byKind };
}

function unsettled(group: PlanGroup, settled: ReadonlySet<string>): readonly SeasonMoment[] {
  if (settled.size === 0) return group.moments;
  return group.moments.filter((moment) => !settled.has(pairKey(group.action, moment.key)));
}

/**
 * Groups due at `serverNow` (at ≤ now), in plan order, each with only its moments whose pair is
 * not in `settled` (done, skipped or failed in this run epoch); fully settled groups are omitted.
 * A forward jump simply makes more groups due at once; the late rules then decide (AC-36).
 */
export function dueGroups(plan: SchedulePlan, serverNow: number, settled: ReadonlySet<string>, options: DueOptions = {}): DueGroup[] {
  if (options.frozen) return [];
  const out: DueGroup[] = [];
  for (const group of plan.groups) {
    if (group.at > serverNow) break;
    if (options.since !== undefined && group.at < options.since) continue;
    const moments = unsettled(group, settled);
    if (moments.length > 0) out.push(moments === group.moments ? group : { ...group, moments });
  }
  return out;
}

/** Instant of the first group after `serverNow` that still has an unsettled pair, or null. */
export function nextDueAt(plan: SchedulePlan, serverNow: number, settled: ReadonlySet<string>): number | null {
  for (const group of plan.groups) {
    if (group.at <= serverNow) continue;
    if (unsettled(group, settled).length > 0) return group.at;
  }
  return null;
}

/**
 * Real milliseconds to sleep before the next look: at most `maxMs`, sooner when the next due
 * instant is closer (server distance ÷ speed). Frozen or nothing ahead → `maxMs`.
 */
export function wakeDelayMs(nextAt: number | null, serverNow: number, speed: number, maxMs: number): number {
  if (nextAt === null || !(speed > 0)) return maxMs;
  return Math.max(0, Math.min(maxMs, Math.ceil((nextAt - serverNow) / speed)));
}

export interface LateSplit {
  /** Moments to run now, C1 order. */
  readonly run: readonly SeasonMoment[];
  /** Moments skipped by the late rule, with the verdict to journal. */
  readonly skip: readonly { readonly moment: SeasonMoment; readonly verdict: Extract<LateVerdict, { run: false }> }[];
  /** Lateness of the group in server time. */
  readonly lateMs: number;
}

/** Applies the action's late rule to every moment of a due group (AC-33 … AC-35). */
export function splitLate(plan: SchedulePlan, group: DueGroup, serverNow: number): LateSplit {
  const rule = plan.rules.get(group.action);
  if (!rule) throw new Error(`scheduler: action ${group.action} is not in the plan`);
  const late = rule.late;
  const run: SeasonMoment[] = [];
  const skip: { moment: SeasonMoment; verdict: Extract<LateVerdict, { run: false }> }[] = [];
  let lateMs = 0;
  for (const moment of group.moments) {
    const untilAt = late !== 'always' && 'until' in late ? untilBoundary(late.until, moment.key, plan.byKey, plan.byKind) : undefined;
    const verdict = lateVerdict(late, moment.at, serverNow, untilAt);
    lateMs = verdict.lateMs;
    if (verdict.run) run.push(moment);
    else skip.push({ moment, verdict });
  }
  return { run, skip, lateMs };
}
