/**
 * SPEC-14 W23 — every downtime sign of [А5] through HTTP, the presence doors and the test clock (in-process dispatcher,
 * this slot's Postgres and Redis; the catalog is stubbed so the windows are known). Each case ticks the sampler with
 * `presence-tick` every 5 s of server time across the read span of its own window (a different hour per case, so
 * cases never share samples) and reads the record with `presence-health`:
 * AC-16 — fast store down during the window → `fast-store-unavailable`; a simulated restart (new run id) →
 *   `fast-store-restart`; no ticks for 15 s in the window → `sample-gap`; injected beat errors 2 % → `beat-errors`;
 *   a manual record → `manual`; each case records `downtime` with exactly that sign. Errors 0.5 % → `healthy`.
 * AC-17 — 40 subjects beat before the window, 15 inside it → `beat-rate-drop`.
 * AC-21 — one edge report overlapping two windows → both `downtime/edge-region`, the record `recordedBy: system`.
 * The real Redis stop/start is the exclusive restart test's job (P16).
 */
import { randomBytes, randomInt } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { finaliseDueAt, samplesSpanOf, SAMPLE_INTERVAL_MS } from '../../src/domain/presence/healthSigns';
import { windowOf } from '../../src/domain/presence/window';
import { presenceOf } from '../../src/endpoints/deps';
import { presenceFaults } from '../../src/presence/faults';
import { buildAuthHarness, CookieJar, freshIp, writeProbe, type AuthHarness } from '../support/authClient';
import { ownRedis } from './helpers';

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14s-${run}`;
const started = new Date();
const HOUR = 3_600_000;
const SEC = 1_000;
/** A random whole hour in 2051–2060: no other run's samples share these instants. */
const B = Date.parse('2051-01-01T00:00:00Z') + randomInt(0, 80_000) * HOUR;

const CASES = {
  unavailable: B,
  restart: B + HOUR,
  gap: B + 2 * HOUR,
  errors: B + 3 * HOUR,
  healthy: B + 4 * HOUR,
  rateDrop: B + 5 * HOUR,
  edgeA: B + 6 * HOUR,
  edgeB: B + 6 * HOUR + 30 * SEC,
  manual: B + 7 * HOUR,
} as const;
type CaseKey = keyof typeof CASES;
const ev = (k: CaseKey) => `s-${k}-${run}`;

const keys = Object.keys(CASES) as CaseKey[];
const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2050-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: keys.map((k) => ({ zoneId: `z-${k}`, midnightUtc: new Date(CASES[k]).toISOString() })),
  countries: [],
  cities: [],
  events: keys.map((k) => ({ eventId: ev(k), countryIso: 'AA', zoneId: `z-${k}`, slot: 'midnight' })),
  traditions: [],
};
const live = keys.map((k) => ({ eventId: ev(k), zoneId: `z-${k}`, moment: CASES[k], nonMidnight: false, hidden: false }));

type Json = { ok: boolean; value?: Record<string, unknown>; error?: { code: string } };
interface HealthView {
  records: { momentMs: number; state: string; signs: string[]; recordedBy: string }[];
  downtimes: { kind: string; recordedBy: string }[];
}

let h: AuthHarness;
let pool: pg.Pool;

async function door(path: string, body: unknown): Promise<Json> {
  const res = await h.call(`/api/_test/presence/${path}`, { body });
  const json = (await res.json()) as Json;
  expect(res.status, `${path} ${JSON.stringify(json)}`).toBe(200);
  return json;
}
async function setClock(at: number): Promise<void> {
  expect((await h.call('/api/_test/clock', { body: { at, frozen: true } })).status).toBe(200);
}
const health = async (k: CaseKey) => (await door('health', { eventId: ev(k) })).value as unknown as HealthView;

/**
 * One `presence-tick` every 5 s of server time from the read span start of `first` to the first tick at or after the
 * finalisation of `last`;
 * `before(at)` runs at each instant before its tick, `skip(at)` leaves that tick out.
 */
async function tickThrough(first: number, last: number, opts: { before?: (at: number) => Promise<void>; skip?: (at: number) => boolean } = {}): Promise<void> {
  const from = samplesSpanOf(first).from;
  const due = finaliseDueAt(last);
  for (let at = from; at - SAMPLE_INTERVAL_MS < due; at += SAMPLE_INTERVAL_MS) {
    await setClock(at);
    await opts.before?.(at);
    if (opts.skip?.(at)) continue;
    const t = (await door('tick', {})).value as { sample: { ok: boolean } };
    expect(t.sample.ok).toBe(true);
  }
}

interface Guest {
  jar: CookieJar;
  ip: string;
}
async function guests(n: number): Promise<Guest[]> {
  const out: Guest[] = [];
  for (let i = 0; i < n; i += 1) {
    const g = { jar: new CookieJar(), ip: freshIp() };
    expect((await writeProbe(h, g)).status).toBe(200);
    out.push(g);
  }
  return out;
}
/** `perGuest` beats from each guest (≤ 12 a minute per subject); answers the statuses. */
async function beats(gs: readonly Guest[], k: CaseKey, perGuest: number): Promise<number[]> {
  const statuses: number[] = [];
  for (const g of gs) {
    for (let i = 0; i < perGuest; i += 1) statuses.push((await h.call('/api/presence', { body: { eventIds: [ev(k)], source: 'tv' }, jar: g.jar, ip: g.ip })).status);
  }
  return statuses;
}

/** The tick instants of a window: the first one at or after its start, and the next. */
function windowTicks(m: number): { first: number; second: number } {
  const from = samplesSpanOf(m).from;
  const w = windowOf(m);
  const first = from + Math.ceil((w.from - from) / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
  return { first, second: first + SAMPLE_INTERVAL_MS };
}

async function expectOnly(k: CaseKey, signs: string[]): Promise<HealthView> {
  const v = await health(k);
  expect(v.records).toHaveLength(1);
  expect(v.records[0]).toMatchObject({ momentMs: CASES[k], state: signs.length > 0 ? 'downtime' : 'healthy', signs, recordedBy: 'system' });
  return v;
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => live } };
  });
  presenceFaults.reset();
  presenceOf(h.deps).clear();
  presenceOf(h.deps).intake.take();
}, 60_000);

afterAll(async () => {
  presenceFaults.reset();
  if (h) await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  for (const t of ['presence_window_health', 'presence_downtimes', 'presence_event_moments', 'presence_proofs']) await pool.query(`DELETE FROM ${t} WHERE season = $1`, [SEASON]);
  await pool.query('DELETE FROM presence_samples WHERE at >= $1 AND at <= $2', [String(B - HOUR), String(B + 9 * HOUR)]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  for (const p of ['pr:mk:', 'pr:pre:', 'pr:in:', 'pr:cnt:pre:', 'pr:cnt:in:']) await redis.deleteByPrefix(`${p}${SEASON}:`);
  await redis.close();
});

describe('downtime signs (AC-16, AC-17, AC-21)', () => {
  it('fast store down at a sample in the window → fast-store-unavailable', async () => {
    const t = windowTicks(CASES.unavailable);
    await tickThrough(CASES.unavailable, CASES.unavailable, {
      async before(at) {
        if (at === t.first) await door('fault', { fastStore: 'down' });
        if (at === t.second) await door('fault', { fastStore: 'up' });
      },
    });
    await expectOnly('unavailable', ['fast-store-unavailable']);
  }, 120_000);

  it('a fast-store restart (new run id) in the counting span → fast-store-restart', async () => {
    const m = CASES.restart;
    await tickThrough(m, m, {
      async before(at) {
        if (at === samplesSpanOf(m).from + 120 * SEC) await door('fault', { fastStore: 'restart' });
      },
    });
    await expectOnly('restart', ['fast-store-restart']);
  }, 120_000);

  it('no ticks for 15 s inside the window → sample-gap', async () => {
    const t = windowTicks(CASES.gap);
    let skipped = 0;
    await tickThrough(CASES.gap, CASES.gap, {
      skip(at) {
        const out = at > t.first && skipped < 3;
        if (out) skipped += 1;
        return out;
      },
    });
    expect(skipped).toBe(3);
    await expectOnly('gap', ['sample-gap']);
  }, 120_000);

  it('injected beat errors 2 % in the window → beat-errors', async () => {
    const t = windowTicks(CASES.errors);
    const gs = await guests(5);
    let statuses: number[] = [];
    await tickThrough(CASES.errors, CASES.errors, {
      async before(at) {
        if (at === t.first) {
          await door('fault', { beatErrorRate: 0.02 });
          statuses = await beats(gs, 'errors', 10);
          await door('fault', { beatErrorRate: 0 });
        }
      },
    });
    expect(statuses).toHaveLength(50);
    expect(statuses.filter((s) => s === 200)).toHaveLength(49);
    await expectOnly('errors', ['beat-errors']);
  }, 120_000);

  it('injected beat errors 0.5 % → healthy', async () => {
    const t = windowTicks(CASES.healthy);
    const gs = await guests(20);
    let statuses: number[] = [];
    await tickThrough(CASES.healthy, CASES.healthy, {
      async before(at) {
        if (at === t.first) {
          await door('fault', { beatErrorRate: 0.005 });
          statuses = await beats(gs, 'healthy', 10);
          await door('fault', { beatErrorRate: 0 });
        }
      },
    });
    expect(statuses).toHaveLength(200);
    expect(statuses.filter((s) => s !== 200)).toHaveLength(1);
    await expectOnly('healthy', []);
  }, 180_000);

  it('40 subjects before the window, 15 inside it → beat-rate-drop (AC-17)', async () => {
    const m = CASES.rateDrop;
    const t = windowTicks(m);
    const gs = await guests(40);
    await tickThrough(m, m, {
      async before(at) {
        if (at === m - 180 * SEC) expect(await beats(gs, 'rateDrop', 1)).toEqual(Array(40).fill(200));
        if (at === t.first) expect(await beats(gs.slice(0, 15), 'rateDrop', 1)).toEqual(Array(15).fill(200));
      },
    });
    await expectOnly('rateDrop', ['beat-rate-drop']);
  }, 180_000);

  it('one edge report overlapping two windows → both downtime/edge-region, recordedBy system (AC-21)', async () => {
    await setClock(samplesSpanOf(CASES.edgeA).from - SEC);
    const rep = (await door('downtime', { kind: 'edge-region', region: 'eu-central', from: CASES.edgeA, to: CASES.edgeA + 5 * SEC })).value as {
      downtime: { recordedBy: string };
    };
    expect(rep.downtime.recordedBy).toBe('system');
    await tickThrough(CASES.edgeA, CASES.edgeB);
    for (const k of ['edgeA', 'edgeB'] as const) {
      const v = await expectOnly(k, ['edge-region']);
      expect(v.downtimes).toEqual([expect.objectContaining({ kind: 'edge-region', recordedBy: 'system' })]);
    }
  }, 120_000);

  it('a manual record of the event → manual', async () => {
    await setClock(samplesSpanOf(CASES.manual).from - SEC);
    const rec = (await door('downtime', { kind: 'manual', eventId: ev('manual'), reason: 'owner saw the stream drop' })).value as { downtime: { recordedBy: string } };
    expect(rec.downtime.recordedBy).toBe('owner');
    await tickThrough(CASES.manual, CASES.manual);
    await expectOnly('manual', ['manual']);
  }, 120_000);
});
