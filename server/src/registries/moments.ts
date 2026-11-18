/**
 * Moment-action registry (AC-62; SPEC-07 C5, AC-73): what the server does at season moments.
 * One row per action, sorted by `key`. A feature adds exactly ONE row:
 *
 *   { key: 'zone-greeting', capability: 'SPEC-15', kinds: ['zone-midnight'],
 *     late: { within: 300_000 }, run: async (group, ctx) => { … publish with group.consequenceId … } },
 *
 * The scheduler groups moments of one instant per action (one call per group), applies the late
 * rule and records exactly-once per (runEpoch, action, momentKey). `run` must be idempotent by
 * `group.consequenceId` and read time only from `group.now`. Empty until the run recorder (SPEC-07
 * W29); subscribers of other waves add their own rows.
 */
import { appliesIn, assertActionRules } from '../domain/scheduler/plan';
import type { EnvClass } from '../platform/env';
import { assertRegistry } from '../platform/registry';
import type { MomentActionRow } from '../scheduler/ports';

export type { MomentActionRow };

export const momentsRegistry: readonly MomentActionRow[] = [];

assertRegistry('moments', momentsRegistry, (r) => r.key);
assertActionRules(momentsRegistry);

/** The rows that exist in class `cls` (rows without `classes` exist everywhere). */
export function momentActionsFor(cls: EnvClass): readonly MomentActionRow[] {
  return momentsRegistry.filter((r) => appliesIn(r, cls));
}
