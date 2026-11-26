/**
 * SPEC-07 W32 (AC-73, AC-74): the moment-action registry has the run recorder in `test` and
 * `rehearsal` only (and, since SPEC-14 W19, the presence window finalisation in every class); the subscriber registry recomputes the moments on both topics. The recorder row
 * over fakes: idempotent by consequence id, publishes only in `test`, and the one-shot fault fires
 * after publishing (AC-29).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { CATALOG_CHANGED_TOPIC } from '../../src/catalog/service';
import { EVENT_PATCH_CHANGED_TOPIC } from '../../src/corrections/service';
import { PRESENCE_FINALISE } from '../../src/presence/health';
import { momentActionsFor, momentsRegistry } from '../../src/registries/moments';
import { subscriberRegistry } from '../../src/registries/subscribers';
import type { ChannelPublisher, PublishResult } from '../../src/realtime/ports';
import type { ActionContext, MomentActionGroup } from '../../src/scheduler/ports';
import {
  ALL_MOMENT_KINDS,
  armRunFault,
  clearRunFault,
  createRunRecorder,
  InjectedRunFault,
  RUN_RECORDER,
  runFaultArmed,
  type RunRecord,
  type RunRecordStore,
} from '../../src/scheduler/recorder';

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const AT = Date.parse('2026-12-31T23:00:00Z');

function memoryRecords(): RunRecordStore & { rows: RunRecord[] } {
  const rows: RunRecord[] = [];
  return {
    rows,
    async record(row) {
      if (rows.some((r) => r.consequenceId === row.consequenceId)) return false;
      rows.push(row);
      return true;
    },
    async list(runEpoch) {
      return rows.filter((r) => r.runEpoch === runEpoch);
    },
  };
}

function spyPublisher(result: PublishResult = { status: 'queued' }) {
  const calls: unknown[][] = [];
  const publisher: ChannelPublisher = {
    async publish(...args) {
      calls.push(args);
      return result;
    },
  };
  return { publisher, calls };
}

function group(over: Partial<MomentActionGroup> = {}): MomentActionGroup {
  return {
    action: RUN_RECORDER,
    at: AT,
    moments: [
      { key: 'zone-midnight:Europe/Paris', kind: 'zone-midnight', at: AT, rank: 2, order: 0 },
      { key: 'zone-midnight:Europe/Berlin', kind: 'zone-midnight', at: AT, rank: 2, order: 0 },
    ],
    consequenceId: 'run-recorder:7:0123456789abcdef',
    now: AT + 1_500,
    lateMs: 1_500,
    runEpoch: 7,
    ...over,
  };
}

const ctxOf = (cls: ActionContext['cls']): ActionContext => ({ cls, log: silent });

describe('moment-action registry (AC-73)', () => {
  it('has the run recorder in test and rehearsal only, the presence finalisation everywhere', () => {
    expect(momentsRegistry.map((r) => r.key)).toEqual([PRESENCE_FINALISE, RUN_RECORDER]);
    expect(momentActionsFor('production').map((r) => r.key)).toEqual([PRESENCE_FINALISE]);
    expect(momentActionsFor('test').map((r) => r.key)).toEqual([PRESENCE_FINALISE, RUN_RECORDER]);
    expect(momentActionsFor('rehearsal').map((r) => r.key)).toEqual([PRESENCE_FINALISE, RUN_RECORDER]);
  });

  it('the presence finalisation takes event-stamp, late "always" (SPEC-14 W19)', () => {
    const row = momentsRegistry.find((r) => r.key === PRESENCE_FINALISE);
    expect(row).toMatchObject({ capability: 'SPEC-14', kinds: ['event-stamp'], late: 'always' });
  });

  it('the recorder takes every one of the 11 kinds, late "always"', () => {
    const row = momentsRegistry.find((r) => r.key === RUN_RECORDER);
    expect(row?.late).toBe('always');
    expect(row?.capability).toBe('SPEC-07');
    expect(new Set(row?.kinds)).toEqual(new Set(ALL_MOMENT_KINDS));
    expect(ALL_MOMENT_KINDS).toHaveLength(11);
  });
});

describe('subscriber registry (AC-74)', () => {
  it('recomputes the moments on catalog.changed and event-patch.changed', () => {
    const rows = subscriberRegistry.filter((s) => s.key.startsWith('scheduler-recompute'));
    expect(rows.map((r) => r.topic).sort()).toEqual([CATALOG_CHANGED_TOPIC, EVENT_PATCH_CHANGED_TOPIC].sort());
  });
});

describe('run recorder row', () => {
  afterEach(() => clearRunFault());

  it('test: one row per consequence id (server instants from the group, real start injected), published to rttest each run', async () => {
    const records = memoryRecords();
    const { publisher, calls } = spyPublisher();
    const row = createRunRecorder(async () => ({ records, publisher, real: { now: () => 42 } }));
    await row.run(group(), ctxOf('test'));
    await row.run(group(), ctxOf('test'));
    expect(records.rows).toEqual([
      {
        consequenceId: 'run-recorder:7:0123456789abcdef',
        keys: ['zone-midnight:Europe/Paris', 'zone-midnight:Europe/Berlin'],
        action: RUN_RECORDER,
        runEpoch: 7,
        plannedAt: AT,
        startedAt: 42,
        at: AT + 1_500,
      },
    ]);
    const envelope = { type: 'run-record', id: 'run-recorder:7:0123456789abcdef' };
    expect(calls).toEqual([
      ['rttest', 'scheduler', envelope],
      ['rttest', 'scheduler', envelope],
    ]);
  });

  it('rehearsal: records, never publishes, never takes the fault', async () => {
    const records = memoryRecords();
    const { publisher, calls } = spyPublisher();
    const row = createRunRecorder(async () => ({ records, publisher, real: { now: () => 1 } }));
    armRunFault();
    await expect(row.run(group(), ctxOf('rehearsal'))).resolves.toBeUndefined();
    expect(records.rows).toHaveLength(1);
    expect(calls).toEqual([]);
    expect(runFaultArmed()).toBe(true);
  });

  it('test without a configured publisher records only', async () => {
    const records = memoryRecords();
    const row = createRunRecorder(async () => ({ records, real: { now: () => 1 } }));
    await row.run(group(), ctxOf('test'));
    expect(records.rows).toHaveLength(1);
  });

  it.each(['unavailable', 'validation'] as const)('a publisher result %s throws (AC-40 retry), the row stays single', async (status) => {
    const records = memoryRecords();
    const { publisher } = spyPublisher({ status });
    const row = createRunRecorder(async () => ({ records, publisher, real: { now: () => 1 } }));
    await expect(row.run(group(), ctxOf('test'))).rejects.toMatchObject({ code: `publish_${status}` });
    await expect(row.run(group(), ctxOf('test'))).rejects.toThrow();
    expect(records.rows).toHaveLength(1);
  });

  it('AC-29: an armed fault fires once, after publishing; the retry with the same id publishes again and adds no row', async () => {
    const records = memoryRecords();
    const { publisher, calls } = spyPublisher();
    const row = createRunRecorder(async () => ({ records, publisher, real: { now: () => 1 } }));
    armRunFault('another-action');
    await row.run(group(), ctxOf('test'));
    expect(runFaultArmed()).toBe(true);
    clearRunFault();

    armRunFault(RUN_RECORDER);
    const id = 'run-recorder:7:fedcba9876543210';
    await expect(row.run(group({ consequenceId: id }), ctxOf('test'))).rejects.toBeInstanceOf(InjectedRunFault);
    expect(runFaultArmed()).toBe(false);
    await row.run(group({ consequenceId: id }), ctxOf('test'));
    expect(records.rows.filter((r) => r.consequenceId === id)).toHaveLength(1);
    expect(calls.filter((c) => (c[2] as { id: string }).id === id)).toHaveLength(2);
  });
});
