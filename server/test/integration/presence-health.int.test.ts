/**
 * SPEC-14 W20 — the intake health log in process (THE process deps of the test class, this slot's Postgres and Redis,
 * the shared test clock; the catalog is stubbed so the windows are known):
 * AC-14 — 6 sampler calls over 30 s of server time → 6 rows with node id, Redis reachability, run id and uptime, the
 *   beats since the previous sample, and no subject column;
 * AC-15 — a scheduler night-run: the window record is written ≤ 30 s after window end + 10 s; a scheduler started
 *   after the window (a server that was down) writes it ≤ 30 s after boot; a second run leaves one record;
 * AC-22 — a database-write fault: `presence/finalise-failed` alarms for the sample and the finalisation, and no record
 *   (never `healthy` on incomplete data); without the fault and with steady samples the window is `healthy`;
 * AC-20, AC-64 — a downtime alarms `presence/downtime` (`page`) and publishes `presence.downtime-recorded` exactly once
 *   per record (the edge report, then the window record; the sweep adds none).
 */
import { randomBytes, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { finaliseDueAt, samplesSpanOf, SAMPLE_INTERVAL_MS } from '../../src/domain/presence/healthSigns';
import { presenceOf } from '../../src/endpoints/deps';
import { presenceFaults } from '../../src/presence/faults';
import { createPresenceFinaliseRow, PRESENCE_FINALISE } from '../../src/presence/health';
import { PRESENCE_DOWNTIME_TOPIC } from '../../src/presence/downtime';
import type { AlarmInput } from '../../src/ports';
import type { MomentSource } from '../../src/scheduler/ports';
import { bootHarness, MIN, privateLeaseName, SEC, testScheduler, until, type Harness, type TestScheduler } from './scheduler-support';

const run = randomBytes(3).toString('hex');
const SEASON = `t14h-${run}`;
/** A random whole hour in 2031–2040: no other run's samples share these instants. */
const B = Date.parse('2031-01-01T00:00:00Z') + randomInt(0, 80_000) * 3_600_000;
const M1 = B; // scheduler night-run (live)
const M2 = B - 3_600_000; // scheduler started after the window (boot)
const M3 = B + 3_600_000; // samples, write fault, healthy
const M4 = B + 2 * 3_600_000; // edge report → downtime alarm and event
const E1 = `h1-${run}`;
const E2 = `h2-${run}`;
const E3 = `h3-${run}`;
const E4 = `h4-${run}`;
const EVENTS = [
  { eventId: E1, zoneId: 'z1', momentMs: M1 },
  { eventId: E2, zoneId: 'z2', momentMs: M2 },
  { eventId: E3, zoneId: 'z3', momentMs: M3 },
  { eventId: E4, zoneId: 'z4', momentMs: M4 },
];

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2030-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: EVENTS.map((e) => ({ zoneId: e.zoneId, midnightUtc: new Date(e.momentMs).toISOString() })),
  countries: [],
  cities: [],
  events: EVENTS.map((e) => ({ eventId: e.eventId, countryIso: 'AA', zoneId: e.zoneId, slot: 'midnight' })),
  traditions: [],
};
const live = EVENTS.map((e) => ({ eventId: e.eventId, zoneId: e.zoneId, moment: e.momentMs, nonMidnight: false, hidden: false }));

/** The scheduler's moments of one event only. */
const sourceOf = (eventId: string): MomentSource => ({
  async load() {
    const e = EVENTS.find((x) => x.eventId === eventId)!;
    return { seasonId: SEASON, zones: [{ zoneId: e.zoneId, midnightMs: e.momentMs }], events: [{ eventId, zoneId: e.zoneId, countryIso: 'AA', momentMs: e.momentMs, sortIndex: 0 }] };
  },
});

interface HealthRow {
  event_id: string;
  moment_ms: string;
  state: string;
  signs: string[];
  recorded_by: string;
  recorded_at: string;
}

let h: Harness;
const alarms: AlarmInput[] = [];
const schedulers: TestScheduler[] = [];

const presence = () => presenceOf(h.deps);
const records = async (eventId: string) =>
  (
    await h.pool.query<HealthRow>(
      'SELECT event_id, moment_ms, state, signs, recorded_by, recorded_at FROM presence_window_health WHERE season = $1 AND event_id = $2',
      [SEASON, eventId],
    )
  ).rows;
const downtimeEvents = async () =>
  (
    await h.pool.query<{ payload: { kind: string; eventIds: string[]; signs: string[] } }>(
      `SELECT payload FROM internal_events WHERE topic = $1 AND payload->>'season' = $2 ORDER BY id`,
      [PRESENCE_DOWNTIME_TOPIC, SEASON],
    )
  ).rows.map((r) => r.payload);

/** One sample every 5 s across the read span of `moment`. */
async function steadySamples(moment: number): Promise<void> {
  const span = samplesSpanOf(moment);
  for (let at = span.from; at <= span.to; at += SAMPLE_INTERVAL_MS) expect((await presence().sampler.sampleOnce(at)).ok).toBe(true);
}

function start(eventId: string): TestScheduler {
  const row = createPresenceFinaliseRow(async () => presence().finaliser);
  const s = testScheduler(h.deps, { rows: [row], leaseName: privateLeaseName('t14h'), source: sourceOf(eventId) });
  schedulers.push(s);
  s.handle.start();
  return s;
}

beforeAll(async () => {
  h = await bootHarness();
  h.deps.catalogStore = { read: async () => stored };
  h.deps.live = { ...h.deps.live!, events: { events: async () => live } };
  const raise = h.deps.alarm.raise.bind(h.deps.alarm);
  h.deps.alarm = {
    raise(a) {
      alarms.push(a);
      raise(a);
    },
  };
  presence().clear();
  presence().intake.take();
}, 120_000);

afterAll(async () => {
  for (const s of schedulers) await s.handle.stop().catch(() => undefined);
  presenceFaults.reset();
  if (h) {
    const node = presence().nodeId;
    await h.pool.query('DELETE FROM presence_samples WHERE node_id = $1 AND at >= $2 AND at <= $3', [node, String(M2 - 10 * MIN), String(M4 + 10 * MIN)]);
    for (const t of ['presence_window_health', 'presence_downtimes', 'presence_event_moments']) await h.pool.query(`DELETE FROM ${t} WHERE season = $1`, [SEASON]);
    await h.pool.query(`DELETE FROM internal_events WHERE topic = $1 AND payload->>'season' = $2`, [PRESENCE_DOWNTIME_TOPIC, SEASON]);
    await h.close();
  }
}, 120_000);

describe('sampler (AC-14)', () => {
  it('6 calls over 30 s of server time → 6 rows with the listed fields and no subject column', async () => {
    const p = presence();
    p.intake.accepted(3);
    p.intake.failed(1);
    // Well before the read span of M3's window, so these beats never reach its record.
    const ats = Array.from({ length: 6 }, (_, i) => M3 - 9 * MIN + i * 5 * SEC);
    for (const at of ats) expect(await p.sampler.sampleOnce(at)).toMatchObject({ ok: true, fastReachable: true });
    const { rows } = await h.pool.query<{ node_id: string; at: string; fast_reachable: boolean; fast_run_id: string | null; fast_uptime_s: string | null; accepted: number; failed: number }>(
      'SELECT node_id, at, fast_reachable, fast_run_id, fast_uptime_s, accepted, failed FROM presence_samples WHERE node_id = $1 AND at >= $2 AND at <= $3 ORDER BY at',
      [p.nodeId, String(ats[0]), String(ats[5])],
    );
    expect(rows.map((r) => Number(r.at))).toEqual(ats);
    for (const r of rows) {
      expect(r.fast_reachable).toBe(true);
      expect(typeof r.fast_run_id).toBe('string');
      expect(r.fast_run_id!.length).toBeGreaterThan(0);
      expect(Number(r.fast_uptime_s)).toBeGreaterThanOrEqual(0);
    }
    expect(rows.map((r) => [r.accepted, r.failed])).toEqual([[3, 1], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]]);
    const cols = await h.pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'presence_samples'");
    expect(cols.rows.map((c) => c.column_name).filter((c) => /subject|user|ip/i.test(c))).toEqual([]);
  });
});

describe('finalisation (AC-15)', () => {
  it('a night-run: one record ≤ 30 s after the window end + 10 s, written by system', async () => {
    const due = finaliseDueAt(M1);
    await h.nightRun({ speed: 4, from: M1 + 5 * SEC });
    start(E1);
    // W4: the moments row leaves a not-yet-due window to the 5 s process ticker (the primary finaliser). Stand-in for
    // that ticker, scoped to E1 so the other cases' windows stay untouched: finalise E1 at server time every second.
    const timer = setInterval(() => void presence().finaliser.finaliseEvents([E1], h.now()).catch(() => undefined), SEC);
    const ticker = { stop: async () => clearInterval(timer) };
    let rec: HealthRow | undefined;
    try {
      [rec] = await until(async () => {
        const r = await records(E1);
        return r.length > 0 ? r : undefined;
      }, 90_000, 'E1 window record');
    } finally {
      await ticker.stop();
    }
    expect(rec).toMatchObject({ event_id: E1, moment_ms: String(M1), recorded_by: 'system' });
    expect(Number(rec!.recorded_at)).toBeGreaterThanOrEqual(due);
    expect(Number(rec!.recorded_at) - due).toBeLessThanOrEqual(30 * SEC);
    // The ticker only started at m + 5 s: the window start has no samples → never `healthy`.
    expect(rec).toMatchObject({ state: 'downtime' });
    expect(rec!.signs).toContain('sample-gap');
    await h.clock({ frozen: true });
    for (const s of schedulers.splice(0)) await s.handle.stop();
  }, 150_000);

  it('a server started after the window writes the record ≤ 30 s after boot; a second run leaves one record', async () => {
    await h.nightRun({ speed: 1, from: M2 + 5 * MIN });
    const boot = h.now();
    start(E2);
    const [rec] = await until(async () => {
      const r = await records(E2);
      return r.length > 0 ? r : undefined;
    }, 60_000, 'E2 window record');
    expect(Number(rec!.recorded_at) - boot).toBeLessThanOrEqual(30 * SEC);
    await h.clock({ frozen: true });
    for (const s of schedulers.splice(0)) await s.handle.stop();

    const row = createPresenceFinaliseRow(async () => presence().finaliser);
    const now = h.now();
    const group = {
      action: PRESENCE_FINALISE,
      at: M2 + 15 * SEC,
      moments: [{ key: `event-stamp:${E2}`, kind: 'event-stamp' as const, at: M2 + 15 * SEC, rank: 3 as const, order: 0, eventId: E2 }],
      consequenceId: `${PRESENCE_FINALISE}:0:again`,
      now,
      lateMs: now - M2,
      runEpoch: 0,
    };
    await row.run(group, { cls: 'test', log: { info: () => {}, warn: () => {}, error: () => {} } });
    await presence().finaliser.finaliseDue(now);
    expect(await records(E2)).toHaveLength(1);
  }, 120_000);
});

describe('failed writes (AC-22) and a healthy window', () => {
  it('a database-write fault → finalise-failed for the sample and the window, and no record', async () => {
    alarms.length = 0;
    presenceFaults.apply({ dbWrite: 'down' });
    try {
      expect((await presence().sampler.sampleOnce(M3 + 5 * SEC)).ok).toBe(false);
      const report = await presence().finaliser.finaliseEvents([E3], finaliseDueAt(M3) + SEC);
      expect(report).toMatchObject({ written: 0, failed: 1 });
    } finally {
      presenceFaults.reset();
    }
    const failed = alarms.filter((a) => a.code === 'presence/finalise-failed');
    expect(failed.map((a) => (a.details as { stage: string }).stage).sort()).toEqual(['finalise', 'sample']);
    expect(failed.every((a) => a.level === 'log' && a.source === 'presence')).toBe(true);
    expect(await records(E3)).toEqual([]);
  });

  it('steady samples, counters and no faults → `healthy`', async () => {
    await steadySamples(M3);
    const report = await presence().finaliser.finaliseEvents([E3], finaliseDueAt(M3) + SEC);
    expect(report).toMatchObject({ written: 1, failed: 0 });
    expect(await records(E3)).toEqual([expect.objectContaining({ state: 'healthy', signs: [], recorded_by: 'system' })]);
  });
});

describe('downtime alarm and event (AC-20, AC-64)', () => {
  it('an edge report and the downtime window each alarm `page` and publish one internal event', async () => {
    alarms.length = 0;
    const before = (await downtimeEvents()).filter((e) => e.eventIds.includes(E4));
    expect(before).toEqual([]);
    await steadySamples(M4);
    const now = finaliseDueAt(M4) + SEC;
    const added = await presence().downtimes.reportEdgeFailure({ region: 'eu-west', from: M4 - SEC, to: M4 + SEC }, now);
    expect(added).toMatchObject({ ok: true, row: { kind: 'edge-region', recorded_by: 'system', region: 'eu-west' } });
    expect(await presence().finaliser.finaliseEvents([E4], now)).toMatchObject({ written: 1 });
    expect(await records(E4)).toEqual([expect.objectContaining({ state: 'downtime', signs: ['edge-region'] })]);
    // The sweep of the next tick finds nothing left to alarm.
    await presence().finaliser.finaliseDue(now + 5 * SEC);

    const events = (await downtimeEvents()).filter((e) => e.eventIds.includes(E4));
    expect(events.map((e) => e.kind).sort()).toEqual(['edge-region', 'window']);
    const pages = alarms.filter((a) => a.code === 'presence/downtime');
    expect(pages.filter((a) => (a.details as { event: string }).event === E4)).toHaveLength(2);
    expect(pages.every((a) => a.level === 'page' && a.source === 'presence')).toBe(true);
  });
});
