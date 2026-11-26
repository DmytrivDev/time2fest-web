/**
 * Moment-action registry (AC-62; SPEC-07 C5, AC-73): what the server does at season moments.
 * One row per action, sorted by `key`. A feature adds exactly ONE row:
 *
 *   { key: 'zone-greeting', capability: 'SPEC-15', kinds: ['zone-midnight'],
 *     late: { within: 300_000 }, run: async (group, ctx) => { … publish with group.consequenceId … } },
 *
 * The scheduler groups moments of one instant per action (one call per group), applies the late
 * rule and records exactly-once per (runEpoch, action, momentKey). `run` must be idempotent by
 * `group.consequenceId` and read time only from `group.now`. Rows: the presence window finalisation (SPEC-14
 * [П-5], every class) and the run recorder (SPEC-07 W29, AC-73: `test` and `rehearsal` only).
 */
import { processDeps } from '../adapters/processDeps';
import { createPayloadRunRecordStore } from '../adapters/payloadRunRecords';
import { realClock } from '../clock';
import { appliesIn, assertActionRules } from '../domain/scheduler/plan';
import { presenceOf } from '../endpoints/deps';
import { createPresenceFinaliseRow } from '../presence/health';
import type { EnvClass } from '../platform/env';
import { assertRegistry } from '../platform/registry';
import type { MomentActionRow } from '../scheduler/ports';
import { createRunRecorder, type RunRecorderDeps } from '../scheduler/recorder';

export type { MomentActionRow };

let recorderDeps: Promise<RunRecorderDeps> | undefined;

/** The recorder's dependencies over the process deps, resolved once on its first run. */
function processRecorderDeps(): Promise<RunRecorderDeps> {
  recorderDeps ??= (async () => {
    const deps = await processDeps();
    // Like `registries/imports.ts`: the container is loaded lazily (it imports this registry).
    const { payloadOf } = await import('../container');
    const publisher = deps.realtime?.publisher;
    return { records: createPayloadRunRecordStore(payloadOf(deps)), real: realClock, ...(publisher ? { publisher } : {}) };
  })();
  recorderDeps.catch(() => {
    recorderDeps = undefined;
  });
  return recorderDeps;
}

export const momentsRegistry: readonly MomentActionRow[] = [
  createPresenceFinaliseRow(async () => presenceOf(await processDeps()).finaliser),
  createRunRecorder(processRecorderDeps),
];

assertRegistry('moments', momentsRegistry, (r) => r.key);
assertActionRules(momentsRegistry);

/** The rows that exist in class `cls` (rows without `classes` exist everywhere). */
export function momentActionsFor(cls: EnvClass): readonly MomentActionRow[] {
  return momentsRegistry.filter((r) => appliesIn(r, cls));
}
