/**
 * SPEC-07 evidence suite B (W40) against the real Postgres and the seeded catalog: schedulers built
 * like the process one (same lease and run stores, same moment source narrowed to India's zone, same
 * shared clock) with probe rows of each late rule, on private lease rows. The doors set the night.
 * - AC-33, AC-34: downtime (paused scheduler, clock jump) of 4 and 6 min over midnight → `always`
 *   runs, `within` 5 min runs at 4 and is skipped (journal + log line) at 6.
 * - AC-35: downtime to +16 min → the `until handover` action is skipped.
 * - AC-36, AC-37: a +30 min jump applies the late rules in server time; a −10 min jump back in the
 *   same run epoch repeats nothing.
 * - AC-39: the run recorder delayed 3 s → exactly one `page` scheduler/lag row.
 * - AC-40: an action failing twice → the third attempt (≥ 1 s apart, same id) succeeds; the other
 *   action of the moment ran on time.
 * - AC-42: two lease clients in one process → at most one acting at each of 30 samples over 60 s.
 * - AC-45, AC-48: the holder paused → the other takes over (journal + log line with both holders and
 *   the new epoch); resumed, the old holder runs nothing.
 * - NFR-7: no secret value in any captured log line.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeasonMoment } from '@time2fest/rules/time';
import { SKIP_ACTION, TAKEOVER_ACTION } from '../../src/adapters/pgScheduler';
import { momentActionsFor } from '../../src/registries/moments';
import { ALL_MOMENT_KINDS, RUN_RECORDER } from '../../src/scheduler/recorder';
import { printMeasure } from './measure';
import {
  bootHarness,
  captureLog,
  MIN,
  privateLeaseName,
  probeRow,
  SEC,
  secretValues,
  sleep,
  testScheduler,
  until,
  zoneSource,
  type Harness,
  type LogLine,
  type ProbeCall,
  type TestScheduler,
} from './scheduler-support';

/** India: two events, midnight 18:30 UTC. */
const ZONE = 'utc+0530';
const WITHIN = 5 * MIN;

describe('scheduler evidence B: late rules, lag, retries, lease', { timeout: 120_000 }, () => {
  let h: Harness;
  let moments: SeasonMoment[] = [];
  let M = 0;
  const lines: LogLine[] = [];
  const running: TestScheduler[] = [];

  const keysOf = (kind: string) => moments.filter((m) => m.kind === kind && m.zoneId === ZONE).map((m) => m.key);
  const ofEpoch = (calls: readonly ProbeCall[], action: string, epoch: number) => calls.filter((c) => c.action === action && c.runEpoch === epoch);
  const calledKeys = (calls: readonly ProbeCall[], action: string, epoch: number) => ofEpoch(calls, action, epoch).flatMap((c) => c.keys);

  function start(rows: Parameters<typeof testScheduler>[1]['rows'], leaseName = privateLeaseName('b'), holderId?: string): TestScheduler {
    const s = testScheduler(h.deps, { rows, leaseName, source: zoneSource(h.deps, ZONE), log: captureLog(lines).log, ...(holderId ? { holderId } : {}) });
    running.push(s);
    s.handle.start();
    return s;
  }
  async function stop(s: TestScheduler): Promise<void> {
    await s.handle.stop();
    const i = running.indexOf(s);
    if (i >= 0) running.splice(i, 1);
  }
  const acting = (s: TestScheduler) => until(() => s.handle.status().lease.acting, 15_000, `${s.holderId} acting`);
  const journal = async (action: string, ref: string) =>
    (
      await h.payload.find({
        collection: 'audit-log',
        where: { and: [{ action: { equals: action } }, { 'target.ref': { equals: ref } }] },
        overrideAccess: true,
        depth: 0,
        sort: 'id',
      })
    ).docs as unknown as { before: Record<string, unknown> | null; after: Record<string, unknown>; createdAt?: string }[];

  beforeAll(async () => {
    h = await bootHarness();
    moments = await h.moments();
    M = moments.find((m) => m.key === `zone-midnight:${ZONE}`)?.at ?? NaN;
    expect(Number.isFinite(M)).toBe(true);
    expect(keysOf('event-moment').length).toBeGreaterThanOrEqual(1);
  }, 120_000);

  afterAll(async () => {
    for (const s of [...running]) await s.handle.stop();
    await h?.close();
  }, 120_000);

  // ---- late rules (AC-33 … AC-37) -----------------------------------------------------------------

  describe('late rules', () => {
    const calls: ProbeCall[] = [];
    let s: TestScheduler;

    beforeAll(async () => {
      s = start([
        probeRow('probe-always', ALL_MOMENT_KINDS, 'always', calls),
        probeRow('probe-within', ['zone-midnight'], { within: WITHIN }, calls),
        probeRow('probe-until', ['event-moment'], { until: 'event-handover' }, calls),
      ]);
      await acting(s);
    });
    afterAll(async () => {
      await stop(s);
    });

    /** New run epoch 10 s before midnight; waits until the earlier moments (late, `always`) ran. */
    async function beforeMidnight(): Promise<number> {
      const epoch = await h.nightRun({ speed: 1, from: M - 10 * SEC });
      await until(() => keysOf('event-reminder').every((k) => calledKeys(calls, 'probe-always', epoch).includes(k)), 15_000, 'reminders ran');
      return epoch;
    }
    /** Downtime: the scheduler stops acting before midnight, the clock moves to `M + by`, it resumes. */
    async function downtime(by: number): Promise<number> {
      const epoch = await beforeMidnight();
      s.handle.pause();
      expect(ofEpoch(calls, 'probe-always', epoch).filter((c) => c.at >= M)).toEqual([]);
      await h.clock({ at: M + by });
      s.handle.resume();
      return epoch;
    }
    const settledRow = (epoch: number, action: string, key: string) =>
      until(async () => (await h.runRows(epoch, action)).find((r) => r.moment_key === key && r.status !== 'started'), 15_000, `${action} ${key} settled`);

    it('AC-33, AC-34: downtime 4 min over midnight → `always` and `within 5 min` both run, once', async () => {
      const epoch = await downtime(4 * MIN);
      await settledRow(epoch, 'probe-within', `zone-midnight:${ZONE}`);
      await until(() => keysOf('event-stamp').every((k) => calledKeys(calls, 'probe-always', epoch).includes(k)), 15_000, 'stamps ran');
      const within = ofEpoch(calls, 'probe-within', epoch);
      expect(within).toHaveLength(1);
      expect(within[0]?.keys).toEqual([`zone-midnight:${ZONE}`]);
      expect(within[0]?.lateMs).toBeGreaterThanOrEqual(4 * MIN);
      expect(within[0]?.lateMs).toBeLessThan(WITHIN);
      for (const k of [...keysOf('pin-end'), ...keysOf('zone-midnight'), ...keysOf('event-moment'), ...keysOf('event-stamp')]) {
        expect(calledKeys(calls, 'probe-always', epoch).filter((x) => x === k)).toHaveLength(1);
      }
    });

    it('AC-33, AC-34, NFR-7: downtime 6 min → `always` runs, `within 5 min` is skipped with a journal row and a log line', async () => {
      const from = lines.length;
      const epoch = await downtime(6 * MIN);
      const row = await settledRow(epoch, 'probe-within', `zone-midnight:${ZONE}`);
      expect(row).toMatchObject({ status: 'skipped', reason: 'within-exceeded' });
      await until(() => keysOf('event-stamp').every((k) => calledKeys(calls, 'probe-always', epoch).includes(k)), 15_000, 'stamps ran');
      expect(ofEpoch(calls, 'probe-within', epoch)).toEqual([]);
      expect(calledKeys(calls, 'probe-always', epoch)).toEqual(expect.arrayContaining([`zone-midnight:${ZONE}`, ...keysOf('event-moment')]));
      const skip = lines.slice(from).find((l) => l.fields.msg === 'scheduler-skip' && l.fields.action === 'probe-within');
      expect(skip?.fields).toMatchObject({ keys: [`zone-midnight:${ZONE}`], reason: 'within-exceeded' });
      expect(Number(skip?.fields.lateMs)).toBeGreaterThan(6 * MIN - SEC);
      const rows = await journal(SKIP_ACTION, `${epoch}:probe-within`);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.after).toMatchObject({ keys: [`zone-midnight:${ZONE}`], reason: 'within-exceeded' });
    });

    it('AC-35: downtime to +16 min → the `until handover` action is skipped; `always` ran the handover', async () => {
      const epoch = await downtime(16 * MIN);
      for (const k of keysOf('event-moment')) expect(await settledRow(epoch, 'probe-until', k)).toMatchObject({ status: 'skipped', reason: 'until-passed' });
      await until(() => keysOf('event-handover').every((k) => calledKeys(calls, 'probe-always', epoch).includes(k)), 15_000, 'handovers ran');
      expect(ofEpoch(calls, 'probe-until', epoch)).toEqual([]);
    });

    it('AC-36: a +30 min jump over midnight while running → lateness in server time: `always` runs, `within` and `until` skip', async () => {
      const epoch = await beforeMidnight();
      const t0 = performance.now();
      await h.clock({ at: M + 30 * MIN });
      expect(await settledRow(epoch, 'probe-within', `zone-midnight:${ZONE}`)).toMatchObject({ status: 'skipped', reason: 'within-exceeded' });
      for (const k of keysOf('event-moment')) expect(await settledRow(epoch, 'probe-until', k)).toMatchObject({ status: 'skipped', reason: 'until-passed' });
      await until(() => keysOf('event-handover').every((k) => calledKeys(calls, 'probe-always', epoch).includes(k)), 15_000, 'handovers ran');
      // Far less than 5 min of real time passed: the skips come from server time.
      expect(performance.now() - t0).toBeLessThan(WITHIN);
      expect(ofEpoch(calls, 'probe-within', epoch)).toEqual([]);
      expect(ofEpoch(calls, 'probe-until', epoch)).toEqual([]);
    });

    it('AC-37: a −10 min jump back after midnight in the same run epoch → no pair runs again', async () => {
      const epoch = await h.nightRun({ speed: 600, from: M - MIN });
      await until(() => h.now() >= M + 5 * MIN && keysOf('event-stamp').every((k) => calledKeys(calls, 'probe-always', epoch).includes(k)), 15_000, 'past midnight');
      const ranBefore = ofEpoch(calls, 'probe-always', epoch).length;
      expect(ofEpoch(calls, 'probe-within', epoch)).toHaveLength(1);
      const back = h.now() - 10 * MIN;
      expect(back).toBeLessThan(M);
      await h.clock({ at: back });
      // Crosses midnight again, then up to past the handover (+15 min), which runs for the first time.
      await until(() => h.now() >= M + 16 * MIN, 15_000, 'clock past the handover');
      await until(() => keysOf('event-handover').every((k) => calledKeys(calls, 'probe-always', epoch).includes(k)), 15_000, 'handovers ran');
      await h.clock({ frozen: true });
      await sleep(300);
      const pairs = ofEpoch(calls, 'probe-always', epoch)
        .concat(ofEpoch(calls, 'probe-within', epoch), ofEpoch(calls, 'probe-until', epoch))
        .flatMap((c) => c.keys.map((k) => `${c.action}|${k}`));
      expect(pairs.length).toBe(new Set(pairs).size);
      // Only the handover group (+15 min) and later were new after the jump back.
      const fresh = ofEpoch(calls, 'probe-always', epoch).slice(ranBefore);
      expect(fresh.length).toBeGreaterThan(0);
      expect(fresh.every((c) => c.at > M + 5 * MIN)).toBe(true);
      expect(ofEpoch(calls, 'probe-within', epoch)).toHaveLength(1);
    });
  });

  // ---- lag (AC-39) ------------------------------------------------------------------------------

  it('AC-39: the run recorder delayed 3 s at midnight → exactly one `page` scheduler/lag row', async () => {
    const recorder = momentActionsFor('test').find((r) => r.key === RUN_RECORDER);
    if (!recorder) throw new Error('no run recorder in the test class');
    let delayed = false;
    const slow = {
      ...recorder,
      async run(...args: Parameters<typeof recorder.run>) {
        if (!delayed && args[0].at === M) {
          delayed = true;
          await sleep(3_000);
        }
        return recorder.run(...args);
      },
    };
    const from = lines.length;
    const store = h.deps.alarmStore;
    if (!store) throw new Error('no alarm store in deps');
    // `raisedAt` is SERVER time (virtual here): new rows are told apart by id, not by time.
    const known = new Set((await store.listOpenPage()).map((a) => a.id));
    const s = start([slow]);
    try {
      await acting(s);
      // ×60: the stamps (+15 s) fall due 0.25 s real after midnight, behind the 3 s call.
      const epoch = await h.nightRun({ speed: 60, from: M - 2 * SEC });
      await until(
        async () => {
          const have = new Set((await h.records(epoch)).flatMap((r) => r.keys));
          return keysOf('event-stamp').every((k) => have.has(k));
        },
        15_000,
        'stamps recorded',
      );
      await sleep(1_000);
      await h.clock({ frozen: true });
      expect(s.handle.status().counters.lagAlarms).toBe(1);
      const lag = lines.slice(from).filter((l) => l.fields.msg === 'scheduler-lag');
      expect(lag).toHaveLength(1);
      expect(Number(lag[0]?.fields.lagMs)).toBeGreaterThan(2_000);
      const rows = (await store.listOpenPage()).filter((a) => !known.has(a.id) && a.source === 'scheduler' && a.code === 'lag');
      expect(rows).toHaveLength(1);
    } finally {
      await stop(s);
    }
  });

  // ---- retries (AC-40) --------------------------------------------------------------------------

  it('AC-40: an action failing twice → retried ≥ 1 s apart with the same id, third attempt done; the other action ran on time', async () => {
    const calls: ProbeCall[] = [];
    const s = start([
      probeRow('probe-flaky', ['zone-midnight'], { within: WITHIN }, calls, async (call) => {
        if (call.attempt <= 2) throw Object.assign(new Error('flaky'), { code: 'publish_unavailable' });
      }),
      probeRow('probe-other', ['zone-midnight'], 'always', calls),
    ]);
    try {
      await acting(s);
      const epoch = await h.nightRun({ speed: 1, from: M - 3 * SEC });
      const row = await until(
        async () => (await h.runRows(epoch, 'probe-flaky')).find((r) => r.status === 'done'),
        20_000,
        'flaky action done',
      );
      const flaky = ofEpoch(calls, 'probe-flaky', epoch);
      expect(flaky.map((c) => c.attempt)).toEqual([1, 2, 3]);
      expect(new Set(flaky.map((c) => c.consequenceId)).size).toBe(1);
      expect(row.consequence_id).toBe(flaky[0]?.consequenceId);
      for (let i = 1; i < flaky.length; i += 1) expect((flaky[i]?.realAt ?? 0) - (flaky[i - 1]?.realAt ?? 0)).toBeGreaterThanOrEqual(990);
      const other = ofEpoch(calls, 'probe-other', epoch);
      expect(other).toHaveLength(1);
      expect(other[0]?.lateMs).toBeLessThan(1_000);
      expect(other[0]?.realAt).toBeLessThan(flaky[1]?.realAt ?? 0);
      await h.clock({ frozen: true });
    } finally {
      await stop(s);
    }
  });

  // ---- lease (AC-42, AC-45, AC-48) --------------------------------------------------------------

  it('AC-42: two lease clients in one process → at most one acting at each of 30 samples over 60 s', { timeout: 90_000 }, async () => {
    const lease = privateLeaseName('b-two');
    const a = start([], lease);
    const b = start([], lease);
    try {
      await until(() => a.handle.status().lease.acting || b.handle.status().lease.acting, 15_000, 'one holder');
      const samples: number[] = [];
      for (let i = 0; i < 30; i += 1) {
        await sleep(2_000);
        samples.push([a, b].filter((s) => s.handle.status().lease.acting).length);
        const { rows } = await h.pool.query<{ holder: string; live: boolean }>(
          'SELECT "holder", "expires_at" > now() AS "live" FROM "scheduler_leases" WHERE "name" = $1',
          [lease],
        );
        const actingIds = [a, b].filter((s) => s.handle.status().lease.acting).map((s) => s.holderId);
        if (actingIds.length === 1 && rows[0]?.live) expect(rows[0].holder).toBe(actingIds[0]);
      }
      expect(Math.max(...samples)).toBeLessThanOrEqual(1);
      expect(samples.filter((n) => n === 1).length).toBeGreaterThanOrEqual(29);
    } finally {
      await stop(a);
      await stop(b);
    }
  });

  it('AC-45, AC-48, EC-8: the holder paused → the other takes over (journal, log line); resumed, the old one runs nothing', async () => {
    const lease = privateLeaseName('b-fence');
    const xCalls: ProbeCall[] = [];
    const yCalls: ProbeCall[] = [];
    const from = lines.length;
    const x = start([probeRow('probe-always', ALL_MOMENT_KINDS, 'always', xCalls)], lease, `b-x:${process.pid}`);
    try {
      await acting(x);
      const oldEpoch = x.handle.status().lease.epoch ?? 0;
      const y = start([probeRow('probe-always', ALL_MOMENT_KINDS, 'always', yCalls)], lease, `b-y:${process.pid}`);
      await sleep(1_000);
      expect(y.handle.status().lease.acting).toBe(false);

      const t0 = performance.now();
      x.handle.pause();
      await until(() => y.handle.status().lease.acting, 12_000, 'takeover');
      const takeoverMs = performance.now() - t0;
      printMeasure('lease-takeover-pause-ms', [takeoverMs]);
      expect(takeoverMs).toBeLessThanOrEqual(10_000);

      x.handle.resume();
      const epoch = await h.nightRun({ speed: 60, from: M - 3 * SEC });
      await until(() => keysOf('event-stamp').every((k) => calledKeys(yCalls, 'probe-always', epoch).includes(k)), 15_000, 'the new holder ran midnight');
      await sleep(2_000);
      await h.clock({ frozen: true });
      expect(ofEpoch(xCalls, 'probe-always', epoch)).toEqual([]);
      expect(x.handle.status().lease.acting).toBe(false);
      const pairs = calledKeys(yCalls, 'probe-always', epoch);
      expect(pairs.length).toBe(new Set(pairs).size);

      const takeover = lines.slice(from).find((l) => l.fields.msg === 'scheduler-takeover' && l.fields.holder === y.holderId);
      expect(takeover?.fields).toMatchObject({ holder: y.holderId, previousHolder: x.holderId, epoch: oldEpoch + 1 });
      const rows = await journal(TAKEOVER_ACTION, lease);
      expect(rows.at(-1)).toMatchObject({ before: { holder: x.holderId, epoch: oldEpoch }, after: { holder: y.holderId, epoch: oldEpoch + 1 } });
      expect(rows.at(-1)?.createdAt).toBeTruthy();
      await stop(y);
    } finally {
      await stop(x);
    }
  });

  it('NFR-7: no captured scheduler log line carries a secret value', () => {
    const secrets = secretValues();
    expect(secrets.length).toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(10);
    const text = JSON.stringify(lines);
    for (const v of secrets) expect(text.includes(v)).toBe(false);
  });
});
