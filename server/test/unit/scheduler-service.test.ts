/**
 * The scheduler loop over in-memory ports (SPEC-07 W27): NFR-8, AC-27, AC-38, AC-40, AC-45, AC-46.
 * Fake timers drive both loops; the monotonic clock is the faked `Date.now()`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmInput } from '../../src/ports';
import { pairKey } from '../../src/domain/scheduler/consequence';
import type { ClaimInput, FinishInput, LeaseGrant, MomentActionGroup, MomentActionRow, SeasonInput } from '../../src/scheduler/ports';
import { createScheduler, type ClockView } from '../../src/scheduler/service';

const silent = { info: () => {}, warn: () => {}, error: () => {} };
const MIDNIGHT = Date.parse('2026-12-31T23:00:00Z');
const SEASON: SeasonInput = { seasonId: '2026-27', zones: [{ zoneId: 'Z1', midnightMs: MIDNIGHT }], events: [] };
const KEY = 'zone-midnight:Z1';

function harness(opts: { rowRun?: (g: MomentActionGroup) => Promise<void>; within?: number; season?: SeasonInput | null } = {}) {
  const clock: ClockView = { now: MIDNIGHT - 10_000, speed: 1, frozen: false };
  const lease = { epoch: 1, failing: false };
  const rows = new Map<string, { status: string; consequenceId?: string }>();
  const calls: MomentActionGroup[] = [];
  const alarms: AlarmInput[] = [];
  const claims: ClaimInput[] = [];
  const finishes: FinishInput[] = [];
  let staleClaims = false;
  const claim = async (c: ClaimInput) => {
    claims.push(c);
    if (staleClaims || c.leaseEpoch !== lease.epoch) return 'stale' as const;
    let open = 0;
    for (const k of c.keys) {
      const cur = rows.get(pairKey(c.action, k));
      if (cur && cur.status !== 'started') continue;
      rows.set(pairKey(c.action, k), { status: 'started', consequenceId: c.consequenceId });
      open += 1;
    }
    return open > 0 ? ('claimed' as const) : ('done' as const);
  };
  const finish = async (f: FinishInput) => {
    finishes.push(f);
    if (f.leaseEpoch !== lease.epoch) return 'stale' as const;
    for (const k of f.keys) {
      const cur = rows.get(pairKey(f.action, k));
      if (!cur || cur.status === 'started') rows.set(pairKey(f.action, k), { status: f.status, ...(f.consequenceId ? { consequenceId: f.consequenceId } : {}) });
    }
    return 'finished' as const;
  };
  const row: MomentActionRow = {
    key: 'rec',
    capability: 'test',
    kinds: ['zone-midnight'],
    late: { within: opts.within ?? 300_000 },
    run: async (g) => {
      calls.push(g);
      await opts.rowRun?.(g);
    },
  };
  const scheduler = createScheduler({
    view: () => ({ ...clock }),
    mono: () => Date.now(),
    lease: {
      acquireOrRenew: async (): Promise<LeaseGrant> => {
        if (lease.failing) throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' });
        return { held: true, epoch: lease.epoch, expiresInMs: 6_000 };
      },
    },
    runs: {
      claim,
      finish,
      // One batch = one fence: the store answers `stale` for all of it, before writing anything.
      claimGroups: async (cs) => {
        const out: ('claimed' | 'done')[] = [];
        for (const c of cs) {
          const r = await claim(c);
          if (r === 'stale') return 'stale';
          out.push(r);
        }
        return out;
      },
      finishGroups: async (fs) => {
        if (fs.some((f) => f.leaseEpoch !== lease.epoch)) return 'stale';
        for (const f of fs) await finish(f);
        return 'finished';
      },
      ledger: async () => ({
        settled: new Set([...rows].filter(([, r]) => r.status !== 'started').map(([k]) => k)),
        started: new Map([...rows].filter(([, r]) => r.status === 'started').map(([k, r]) => [k, r.consequenceId ?? ''])),
      }),
      missed24h: async () => ({ skipped: 0, failed: 0 }),
    },
    source: {
      load: async () => {
        if (opts.season === null) throw Object.assign(new Error('no catalog'), { code: 'ECONNREFUSED' });
        return opts.season ?? SEASON;
      },
    },
    rows: [row],
    alarm: { raise: (a) => void alarms.push(a) },
    log: silent,
    holderId: 'host:1:aa',
    cls: 'test',
    runEpochOf: () => 7,
  });
  return { clock, lease, rows, calls, alarms, claims, finishes, scheduler, setStale: (v: boolean) => (staleClaims = v) };
}

describe('scheduler service loop', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('runs a due group exactly once, with the C4 id, and never again in the same run epoch (AC-27)', async () => {
    const h = harness();
    h.scheduler.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(h.calls).toHaveLength(0);
    h.clock.now = MIDNIGHT + 100;
    await vi.advanceTimersByTimeAsync(1_000);
    h.clock.now = MIDNIGHT + 5_000;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]?.moments.map((m) => m.key)).toEqual([KEY]);
    expect(h.calls[0]?.consequenceId).toMatch(/^rec:7:[0-9a-f]{16}$/);
    expect(h.rows.get(pairKey('rec', KEY))?.status).toBe('done');
    const s = h.scheduler.status();
    expect(s.lease).toMatchObject({ held: true, acting: true, epoch: 1 });
    expect(s.last).toMatchObject({ action: 'rec', status: 'done', keys: [KEY] });
    expect(s.counters.done).toBe(1);
    await h.scheduler.stop();
  });

  it('runs nothing before the moment list is loaded (NFR-8)', async () => {
    const h = harness({ season: null });
    h.clock.now = MIDNIGHT + 1_000;
    h.scheduler.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.calls).toHaveLength(0);
    expect(h.claims).toHaveLength(0);
    expect(h.scheduler.status().loaded).toBe(false);
    await h.scheduler.stop();
  });

  it('frozen: no call and no lag alarm for 10 s real (AC-38)', async () => {
    const h = harness();
    h.clock.now = MIDNIGHT + 60_000;
    h.clock.frozen = true;
    h.clock.speed = 0;
    h.scheduler.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.calls).toHaveLength(0);
    expect(h.alarms).toHaveLength(0);
    await h.scheduler.stop();
  });

  it('store unreachable: stops acting when the monotonic term runs out, one page alarm (AC-46)', async () => {
    const h = harness();
    h.scheduler.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(h.scheduler.status().lease.acting).toBe(true);
    h.lease.failing = true;
    await vi.advanceTimersByTimeAsync(6_000);
    expect(h.scheduler.status().lease.acting).toBe(false);
    h.clock.now = MIDNIGHT + 1_000;
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.calls).toHaveLength(0);
    expect(h.alarms.filter((a) => a.level === 'page' && a.code === 'lease_unreachable')).toHaveLength(1);
    await h.scheduler.stop();
  });

  it('a stale claim never runs the action (AC-45)', async () => {
    const h = harness();
    h.setStale(true);
    h.clock.now = MIDNIGHT + 1_000;
    h.scheduler.start();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.claims.length).toBeGreaterThan(0);
    expect(h.calls).toHaveLength(0);
    expect(h.scheduler.status().counters.stale).toBeGreaterThan(0);
    await h.scheduler.stop();
  });

  it('retries a failing action ≥1 s apart, then succeeds with the same consequence id (AC-40)', async () => {
    let fails = 2;
    const h = harness({
      rowRun: async () => {
        if (fails-- > 0) throw Object.assign(new Error('publish'), { code: 'unavailable' });
      },
    });
    h.clock.now = MIDNIGHT + 1_000;
    h.scheduler.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.calls).toHaveLength(3);
    const at = h.calls.map((c) => c.consequenceId);
    expect(new Set(at).size).toBe(1);
    expect(h.rows.get(pairKey('rec', KEY))?.status).toBe('done');
    await h.scheduler.stop();
  });

  it('settles as failed once the late rule no longer allows a retry (AC-40)', async () => {
    const h = harness({
      within: 2_000,
      rowRun: async () => {
        throw Object.assign(new Error('publish'), { code: 'rejected' });
      },
    });
    h.clock.now = MIDNIGHT + 500;
    h.scheduler.start();
    await vi.advanceTimersByTimeAsync(1_500);
    h.clock.now = MIDNIGHT + 3_000;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(h.rows.get(pairKey('rec', KEY))?.status).toBe('failed');
    expect(h.finishes.at(-1)).toMatchObject({ status: 'failed', reason: 'rejected' });
    await h.scheduler.stop();
  });

  it('AC-32: at x600 a group that comes due during a look runs at once, not after a tick', async () => {
    const SECOND = MIDNIGHT + 15_000; // 25 ms real at x600
    const h = harness({
      season: { seasonId: '2026-27', zones: [{ zoneId: 'Z1', midnightMs: MIDNIGHT }, { zoneId: 'Z2', midnightMs: SECOND }], events: [] },
      rowRun: async (g) => {
        // The first look costs 50 ms real = 30 s of server time: the second group is due when it ends.
        if (g.at === MIDNIGHT) h.clock.now = SECOND + 15_000;
      },
    });
    h.clock.speed = 600;
    h.clock.now = MIDNIGHT + 600;
    h.scheduler.start();
    const t0 = Date.now();
    await vi.advanceTimersByTimeAsync(20);
    expect(h.calls.map((c) => c.at)).toEqual([MIDNIGHT, SECOND]);
    expect(Date.now() - t0).toBeLessThan(250);
    expect(h.claims.map((c) => c.plannedAt)).toEqual([MIDNIGHT, SECOND]);
    expect(h.rows.get(pairKey('rec', 'zone-midnight:Z2'))?.status).toBe('done');
    await h.scheduler.stop();
  });
});
