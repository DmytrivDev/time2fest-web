/**
 * The run recorder (SPEC-07 W29; AC-27, AC-29, AC-32, AC-64, AC-65, AC-73), ring 3: the one C5 row
 * of this wave. It exists in the classes `test` and `rehearsal` only (D12) — the proof of a ×60 night.
 *
 * For every group of every one of the 11 moment kinds (`late: 'always'`), `run`:
 * 1. writes one `run-records` row per consequence id (C4), idempotent: a retry with the same id
 *    leaves the first row as it was;
 * 2. in `test` only, publishes `{ type: 'run-record', id: consequenceId }` to `rttest:scheduler`
 *    (a publisher result `validation`/`unavailable` throws → the scheduler retries, AC-40); a process
 *    without a configured publisher records only;
 * 3. in `test` only, throws if a one-shot fault was armed by the test door (AC-29: the "crash"
 *    after publishing and before the scheduler writes `done`; the retry reuses the same id).
 *
 * Server time comes only from the group (`at`, `now`); the injected real clock gives the real start
 * instant that the deviation measurement needs (AC-32). The fault flag lives on `globalThis`, so the
 * door module (loaded through the dynamic import) and this module share it in one process.
 */
import type { SeasonMomentKind } from '@time2fest/rules/time';
import type { Clock } from '../ports';
import type { ChannelPublisher } from '../realtime/ports';
import type { MomentActionGroup, MomentActionRow } from './ports';

export const RUN_RECORDER = 'run-recorder';
/** The `rttest` channel key the recorder publishes to in `test` (`rttest:scheduler`). */
export const RUN_RECORD_CHANNEL = 'scheduler';
export const RUN_RECORD_EVENT = 'run-record';

/** Every kind of C1: the recorder records every moment of the night. */
export const ALL_MOMENT_KINDS: readonly SeasonMomentKind[] = [
  'celebration-start',
  'poll-start',
  'poll-end',
  'event-reminder',
  'pin-end',
  'zone-midnight',
  'event-moment',
  'event-stamp',
  'event-handover',
  'celebration-end',
  'rating-close',
];

/** One row of `run-records`: one consequence (group) of one run epoch. */
export interface RunRecord {
  consequenceId: string;
  /** The group's moment keys, C1 order. */
  keys: string[];
  action: string;
  runEpoch: number;
  /** Server instant of the group (planned). */
  plannedAt: number;
  /** REAL ms (wall clock) the recorder ran at. */
  startedAt: number;
  /** Server instant the run started (`group.now`); `at − plannedAt` is the server lateness. */
  at: number;
}

/** Port of the record table (adapter `adapters/payloadRunRecords.ts`). */
export interface RunRecordStore {
  /** Inserts the row unless its `consequenceId` exists; `true` when this call inserted it. */
  record(row: RunRecord): Promise<boolean>;
  /** The rows of one run epoch, by `startedAt`, then insertion order. */
  list(runEpoch: number): Promise<RunRecord[]>;
}

export interface RunRecorderDeps {
  records: RunRecordStore;
  /** The realtime publisher, when the process has one configured (test publishing only). */
  publisher?: ChannelPublisher;
  real: Clock;
}

// ---- one-shot fault (test door `POST /api/_test/scheduler/fault`) -----------------------------

const FAULT_KEY = Symbol.for('t2f.test.schedulerFault');

interface ArmedFault {
  /** The action it applies to; absent = the next action of any key. */
  action?: string;
}

function faultSlot(): { armed?: ArmedFault } {
  const g = globalThis as unknown as Record<symbol, { armed?: ArmedFault } | undefined>;
  return (g[FAULT_KEY] ??= {});
}

/** Arms the one-shot fault. Called only by the test door (class `test`). */
export function armRunFault(action?: string): void {
  faultSlot().armed = action === undefined ? {} : { action };
}

/** Disarms it (the `reset` door). */
export function clearRunFault(): void {
  delete faultSlot().armed;
}

/** Whether a fault is armed (tests and the door answer). */
export function runFaultArmed(): boolean {
  return faultSlot().armed !== undefined;
}

/** Takes the fault if it is armed for `action`: it fires once. */
function takeRunFault(action: string): boolean {
  const slot = faultSlot();
  const armed = slot.armed;
  if (!armed || (armed.action !== undefined && armed.action !== action)) return false;
  delete slot.armed;
  return true;
}

/** The error of the simulated crash; its `code` lands in the scheduler's retry log. */
export class InjectedRunFault extends Error {
  readonly code = 'injected_fault';
  constructor() {
    super('scheduler: injected fault after publish');
    this.name = 'InjectedRunFault';
  }
}

// ---- the row ----------------------------------------------------------------------------------

/**
 * The recorder row. `resolve` gives its dependencies on first use (the registry binds them to the
 * process deps lazily, so building the registry needs no database).
 */
export function createRunRecorder(resolve: () => Promise<RunRecorderDeps>): MomentActionRow {
  return {
    key: RUN_RECORDER,
    capability: 'SPEC-07',
    kinds: ALL_MOMENT_KINDS,
    late: 'always',
    classes: ['test', 'rehearsal'],
    async run(group: MomentActionGroup, ctx) {
      const deps = await resolve();
      const inserted = await deps.records.record({
        consequenceId: group.consequenceId,
        keys: group.moments.map((m) => m.key),
        action: group.action,
        runEpoch: group.runEpoch,
        plannedAt: group.at,
        startedAt: deps.real.now(),
        at: group.now,
      });
      if (ctx.cls !== 'test') return;
      if (deps.publisher) {
        const result = await deps.publisher.publish('rttest', RUN_RECORD_CHANNEL, { type: RUN_RECORD_EVENT, id: group.consequenceId });
        if (result.status === 'validation' || result.status === 'unavailable') {
          throw Object.assign(new Error('scheduler: run record not published'), { code: `publish_${result.status}` });
        }
      }
      if (takeRunFault(group.action)) {
        ctx.log.warn({ msg: 'scheduler-injected-fault', action: group.action, consequenceId: group.consequenceId, inserted });
        throw new InjectedRunFault();
      }
    },
  };
}
