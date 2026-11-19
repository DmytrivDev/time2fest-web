/**
 * SPEC-07 evidence suite A (W39) against the real Postgres, the seeded catalog and THE process
 * scheduler (`deps.scheduler`, the run recorder in its registry), driven through the test doors:
 * - AC-27, AC-30, AC-31, AC-32, AC-73: one ×600 night run across three slices — from the default
 *   start to Chatham midnight + 16 min (Kiribati handover = Chatham midnight, EC-1), Nepal − 20 min
 *   to India + 16 min (Nepal handover = India midnight, EC-2), UTC+1 ± 16/20 min (44 countries,
 *   EC-3) — with forward jumps between them. The concatenated record keys must equal the C1 list
 *   (once each, in order, groups as enumerated). Deviation of the real start of every action from its
 *   real due instant is printed as `T2F_MEASURE moment-deviation-ms` and held to p99 ≤ 1 000 ms.
 * - AC-25, AC-26 (EC-4): an event correction −20 min saved through `saveCorrection` reaches the
 *   scheduler through `event-patch.changed` within 2 s (`T2F_MEASURE scheduler-recompute-ms`); saved
 *   before, 1 min before and after the old moment, every pair of the event is recorded exactly once.
 * - AC-29: the fault door → the recorder publishes, "crashes" before `done`, the retry publishes the
 *   same consequence id again: two publications on `rttest`, the web client transport delivers once.
 * Needs the real lease free: a dev server of this worktree holding it makes `beforeAll` time out.
 */
import type { RealtimeBatch, RealtimeEnvelope } from '@time2fest/contracts';
import { createLocalReq } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SeasonMoment } from '@time2fest/rules/time';
import { createRealtimeTransport, type RealtimeFetch } from '../../../lib/api/http/realtime/transport';
import { saveCorrection } from '../../src/corrections/service';
import { publisherOf } from '../../src/endpoints/deps';
import { RUN_RECORDER, runFaultArmed } from '../../src/scheduler/recorder';
import type { SchedulerHandle } from '../../src/scheduler/service';
import { note, printMeasure } from './measure';
import { centrifugeClient, connectAndWait, describeRealtime, name, websocketUrl } from './realtime-support';
import { BASE, bootHarness, checkRun, MIN, SEC, sleep, until, type Harness } from './scheduler-support';

const KIRIBATI = 'utc+1400';
const CHATHAM = 'utc+1345';
const NEPAL = 'utc+0545';
const INDIA = 'utc+0530';
const CET = 'utc+0100';
/** The single event of this zone is the one the corrections move. */
const PATCH_ZONE = 'utc+1030';
const SPEED = 600;

describe('scheduler evidence A: exactly once, order, groups, recompute, crash', { timeout: 180_000 }, () => {
  let h: Harness;
  let scheduler: SchedulerHandle;
  let base: SeasonMoment[] = [];

  const at = (key: string, list: readonly SeasonMoment[] = base): number => {
    const m = list.find((x) => x.key === key);
    if (!m) throw new Error(`no moment ${key}`);
    return m.at;
  };
  const eventOf = (zoneId: string) => {
    const m = base.find((x) => x.kind === 'event-moment' && x.zoneId === zoneId);
    if (!m?.eventId) throw new Error(`no event in ${zoneId}`);
    return m.eventId;
  };

  /**
   * Waits (clock still running: a frozen clock runs nothing, AC-38) until the recorder has every
   * moment up to `stopAt`, then freezes the night; returns the records planned up to `stopAt`.
   */
  async function settle(epoch: number, stopAt: number, expected: () => Promise<readonly SeasonMoment[]>) {
    const want = (await expected()).filter((m) => m.at <= stopAt);
    const keys = new Set(want.map((m) => m.key));
    await until(
      async () => {
        const have = new Set((await h.records(epoch)).flatMap((r) => r.keys));
        return [...keys].every((k) => have.has(k));
      },
      60_000,
      'every due moment recorded',
    );
    await h.clock({ frozen: true });
    // A pass that was running when the clock froze has finished.
    await sleep(500);
    return { records: (await h.records(epoch)).filter((r) => r.plannedAt <= stopAt), want, stopAt };
  }

  beforeAll(async () => {
    h = await bootHarness({ bus: true });
    if (!h.deps.scheduler) throw new Error('no scheduler in deps');
    scheduler = h.deps.scheduler;
    base = await h.moments();
    expect(base[0]?.kind).toBe('celebration-start');
    scheduler.start();
    await until(() => scheduler.status().lease.acting, 15_000, 'lease acquired (a dev server of this worktree holds it?)');
  }, 120_000);

  afterAll(async () => {
    await h?.payload.delete({ collection: 'event-patches', where: { eventId: { equals: eventOf(PATCH_ZONE) } }, overrideAccess: true, context: { t2fTrusted: true } });
    await scheduler?.stop();
    await h?.close();
  }, 120_000);

  it('AC-27, AC-30, AC-31, AC-32: ×600 over three slices — every pair once, C1 order, one call per instant', async () => {
    const t0 = performance.now();
    const slices = [
      { from: undefined, to: at(`zone-midnight:${CHATHAM}`) + 16 * MIN },
      { from: at(`zone-midnight:${NEPAL}`) - 20 * MIN, to: at(`zone-midnight:${INDIA}`) + 16 * MIN },
      { from: at(`zone-midnight:${CET}`) - 20 * MIN, to: at(`zone-midnight:${CET}`) + 16 * MIN },
    ];
    const epoch = await h.nightRun({ speed: SPEED });
    /** Real-time windows: server [from, to] ran continuously from the anchor (real, server). */
    const windows: { from: number; to: number; real: number; server: number }[] = [];
    for (const [i, slice] of slices.entries()) {
      if (i > 0 && slice.from !== undefined) await h.clock({ at: slice.from });
      const a = h.anchor();
      expect(a.speed).toBe(SPEED);
      windows.push({ from: a.server, to: slice.to, real: a.real, server: a.server });
      await until(() => h.now() >= slice.to, 60_000, `clock past slice ${i}`);
    }
    const { records, want, stopAt } = await settle(epoch, slices.at(-1)?.to ?? 0, () => h.moments());
    expect(want[0]?.kind).toBe('celebration-start');

    const check = checkRun(records, want);
    note(`[scheduler-a] ×${SPEED}:${records.length} records, ${check.pairs} pairs up to ${new Date(stopAt).toISOString()} in ${Math.round(performance.now() - t0)} ms`);
    expect(check.duplicates).toEqual([]);
    expect(check.missed).toEqual([]);
    expect(check.unexpected).toEqual([]);
    expect(check.orderViolations).toBe(0);
    expect(check.groupMismatches).toEqual([]);
    expect(records.flatMap((r) => r.keys)).toEqual(want.map((m) => m.key));
    expect(new Set(records.map((r) => r.consequenceId)).size).toBe(records.length);

    // EC-1, EC-2: the earlier zone's handover precedes the later zone's midnight inside ONE call.
    const recordAt = (t: number) => {
      const list = records.filter((r) => r.plannedAt === t);
      expect(list).toHaveLength(1);
      return list[0]?.keys ?? [];
    };
    for (const [earlier, later] of [
      [KIRIBATI, CHATHAM],
      [NEPAL, INDIA],
    ] as const) {
      const keys = recordAt(at(`zone-midnight:${later}`));
      const handover = `event-handover:${eventOf(earlier)}`;
      expect(keys).toContain(handover);
      expect(keys.indexOf(handover)).toBeLessThan(keys.indexOf(`zone-midnight:${later}`));
    }
    // EC-3 / AC-30: UTC+1 midnight is one call carrying the event moments of every country there.
    const cetKeys = recordAt(at(`zone-midnight:${CET}`));
    const cetEvents = base.filter((m) => m.kind === 'event-moment' && m.zoneId === CET);
    expect(cetEvents.length).toBeGreaterThan(10);
    expect(cetKeys.filter((k) => k.startsWith('event-moment:'))).toHaveLength(cetEvents.length);
    expect(new Set(cetEvents.map((m) => m.countryIso)).size).toBeGreaterThan(10);

    // AC-32 ("without load"): real start of the action − real due instant, for moments reached by
    // running time — not those a jump passed over, nor those that fell due while the scheduler was
    // still running that jump's backlog (the jumped-over groups), in real ms.
    const deviations: number[] = [];
    let backlogged = 0;
    for (const r of records) {
      const w = windows.find((x) => r.plannedAt >= x.from && r.plannedAt <= x.to);
      if (!w) continue;
      const due = w.real + (r.plannedAt - w.server) / SPEED;
      const backlogEnd = Math.max(-Infinity, ...records.filter((x) => x.plannedAt < w.from).map((x) => x.startedAt));
      if (due < backlogEnd) {
        backlogged += 1;
        continue;
      }
      deviations.push(r.startedAt - due);
    }
    note(`[scheduler-a] deviation: ${deviations.length} moments measured, ${backlogged} queued behind a jump backlog excluded`);
    // One record per instant: ~20 instants are reached by running time in the three slices.
    expect(deviations.length).toBeGreaterThanOrEqual(10);
    const s = printMeasure('moment-deviation-ms', deviations);
    expect(Math.min(...deviations)).toBeGreaterThanOrEqual(-5);
    expect(s.p99).toBeLessThanOrEqual(1_000);
  });

  // ---- corrections (AC-25, AC-26) ---------------------------------------------------------------

  const patchEvent = () => eventOf(PATCH_ZONE);
  async function dropPatch(): Promise<void> {
    await h.payload.delete({ collection: 'event-patches', where: { eventId: { equals: patchEvent() } }, overrideAccess: true, context: { t2fTrusted: true } });
  }
  async function patch(moment: number): Promise<void> {
    await dropPatch();
    const id = patchEvent();
    if (!h.deps.corrections) throw new Error('no corrections in deps');
    const saved = await saveCorrection(
      h.deps.corrections,
      await createLocalReq({ context: { t2fTrusted: true } }, h.payload),
      { changes: { [id]: { moment } }, expectedVersions: { [id]: 0 }, confirmWarnings: true },
      { kind: 'system', id: 'scheduler-a', label: 'scheduler-a' },
    );
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
  }
  const eventKeys = () => ['event-reminder', 'event-moment', 'event-stamp', 'event-handover'].map((k) => `${k}:${patchEvent()}`);
  /** Planned instants of the event's four keys in the records (one entry per recorded occurrence). */
  const eventRuns = (records: readonly { keys: readonly string[]; plannedAt: number }[]) =>
    Object.fromEntries(eventKeys().map((k) => [k.split(':')[0] as string, records.filter((r) => r.keys.includes(k)).map((r) => r.plannedAt)]));

  /** Runs on at ×600 until the old handover + 1 min, freezes, and returns the settled records. */
  async function finishWindow(epoch: number, m: number) {
    await h.clock({ speed: SPEED, frozen: false });
    await until(() => h.now() >= m + 16 * MIN, 30_000, 'clock past the old handover');
    const settled = await settle(epoch, m + 16 * MIN, () => h.moments());
    const check = checkRun(settled.records, settled.want);
    expect(check.duplicates).toEqual([]);
    expect(check.missed).toEqual([]);
    expect(check.unexpected).toEqual([]);
    return settled;
  }

  it('AC-25, AC-26: a −20 min correction before the moment → new list within 2 s; the event runs once, at its new instants', async () => {
    await dropPatch();
    const m = at(`event-moment:${patchEvent()}`);
    const moved = m - 20 * MIN;
    const epoch = await h.nightRun({ speed: 1, from: m - 40 * MIN });
    // The moments before `from` run at once (late, `always`); then hold the clock.
    const earlier = base.filter((x) => x.at <= m - 40 * MIN).map((x) => x.key);
    await until(
      async () => {
        const have = new Set((await h.records(epoch)).flatMap((r) => r.keys));
        return earlier.every((k) => have.has(k));
      },
      30_000,
      'earlier moments recorded',
    );
    await h.clock({ frozen: true });
    const before = scheduler.status().next;
    expect(before?.at).toBeGreaterThan(moved - 15 * MIN);

    const t0 = performance.now();
    await patch(moved);
    const next = await until(
      () => {
        const n = scheduler.status().next;
        return n && n.at === moved - 15 * MIN && n.keys.includes(`event-reminder:${patchEvent()}`) ? n : undefined;
      },
      5_000,
      'the scheduler works with the corrected list',
    );
    const recomputeMs = performance.now() - t0;
    printMeasure('scheduler-recompute-ms', [recomputeMs]);
    expect(next.at).toBe(moved - 15 * MIN);
    expect(recomputeMs).toBeLessThanOrEqual(2_000);

    const { records } = await finishWindow(epoch, m);
    expect(eventRuns(records)).toEqual({
      'event-reminder': [moved - 15 * MIN],
      'event-moment': [moved],
      'event-stamp': [moved + 15 * SEC],
      'event-handover': [moved + 15 * MIN],
    });
  });

  it('AC-26, EC-4: the same correction 1 min before the old moment → the done reminder is not repeated, the rest runs once at once', async () => {
    await dropPatch();
    const m = at(`event-moment:${patchEvent()}`);
    const moved = m - 20 * MIN;
    const epoch = await h.nightRun({ speed: 1, from: m - MIN });
    await until(async () => (await h.records(epoch)).some((r) => r.keys.includes(`event-reminder:${patchEvent()}`)), 30_000, 'old reminder recorded');
    await patch(moved);
    const { records } = await finishWindow(epoch, m);
    expect(eventRuns(records)).toEqual({
      'event-reminder': [m - 15 * MIN],
      'event-moment': [moved],
      'event-stamp': [moved + 15 * SEC],
      'event-handover': [moved + 15 * MIN],
    });
  });

  it('AC-26, EC-4: the same correction after the old moment → moment and stamp are not repeated, only the handover runs at its new instant', async () => {
    await dropPatch();
    const m = at(`event-moment:${patchEvent()}`);
    const moved = m - 20 * MIN;
    const epoch = await h.nightRun({ speed: 1, from: m + MIN });
    await until(async () => (await h.records(epoch)).some((r) => r.keys.includes(`event-stamp:${patchEvent()}`)), 30_000, 'old stamp recorded');
    await patch(moved);
    const { records } = await finishWindow(epoch, m);
    expect(eventRuns(records)).toEqual({
      'event-reminder': [m - 15 * MIN],
      'event-moment': [m],
      'event-stamp': [m + 15 * SEC],
      'event-handover': [moved + 15 * MIN],
    });
    await dropPatch();
  });

  // ---- crash between publish and done (AC-29) ---------------------------------------------------

  describeRealtime('AC-29 on rttest', () => {
    it('fault after publish → two publications with one consequence id; the web client transport delivers it once', async () => {
      const channel = name('rttest', 'scheduler');
      const tokenFetch: RealtimeFetch = (input) => h.dispatch(new Request(new URL(input, BASE)));
      const transport = createRealtimeTransport({ url: websocketUrl(), tokenUrl: '/api/realtime/token', fetch: tokenFetch, loadCentrifuge: () => import('centrifuge') });
      const delivered: RealtimeEnvelope[] = [];
      const stop = transport.subscribe(channel, { onEvent: (e) => delivered.push(e) });
      const raw = centrifugeClient(null);
      const published: string[] = [];
      try {
        expect(await connectAndWait(raw)).toBe('connected');
        const sub = raw.newSubscription(channel);
        sub.on('publication', (ctx) => {
          // `rttest` is a batched class: one publication = one batch of envelopes.
          const data = ctx.data as RealtimeBatch | RealtimeEnvelope;
          if (data.type === 'batch') for (const e of (data as RealtimeBatch).events) published.push(e.id);
          else published.push(data.id);
        });
        const subscribed = new Promise<void>((r) => sub.once('subscribed', () => r()));
        sub.subscribe();
        await subscribed;
        // Both listeners are live once a probe reaches them.
        const probe: RealtimeEnvelope = { type: 'probe', id: `probe-${Date.now()}`, data: {} };
        await until(async () => {
          await publisherOf(h.deps).publish('rttest', 'scheduler', probe);
          await sleep(300);
          return delivered.some((e) => e.id === probe.id) && published.includes(probe.id);
        }, 15_000, 'transport and raw client subscribed');

        await h.door('/api/_test/scheduler/fault', { after: 'publish', action: RUN_RECORDER });
        expect(runFaultArmed()).toBe(true);
        const start = at(base[0]?.key ?? '');
        const epoch = await h.nightRun({ speed: 60, from: start - 2 * SEC });
        const key = base[0]?.key ?? '';
        const row = await until(
          async () => (await h.runRows(epoch, RUN_RECORDER)).find((r) => r.moment_key === key && r.status === 'done'),
          15_000,
          'faulted run settled done',
        );
        await h.clock({ frozen: true });
        expect(runFaultArmed()).toBe(false);
        const id = row.consequence_id ?? '';
        expect(id.startsWith(`${RUN_RECORDER}:${epoch}:`)).toBe(true);
        await sleep(2_000);
        const records = (await h.records(epoch)).filter((r) => r.keys.includes(key));
        expect(records.map((r) => r.consequenceId)).toEqual([id]);
        expect(published.filter((x) => x === id)).toHaveLength(2);
        expect(delivered.filter((e) => e.id === id)).toHaveLength(1);
      } finally {
        stop();
        raw.disconnect();
      }
    });
  });
});
