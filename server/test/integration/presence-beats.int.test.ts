/**
 * SPEC-14 W16 — the presence beat through the real pipeline (in-process dispatcher, this slot's Postgres and Redis, the
 * test clock; the catalog and the patched moments are stubbed so the windows are known):
 * strict body (AC-1), `nextBeatMs` schedule (AC-2), exactly one proof before `ok` (AC-3), none outside the window and a
 * pre-window counter instead (AC-4), `openedAt` never widens the window (AC-11), the 13th beat a minute → 429 (AC-5),
 * Redis down → proof straight in Postgres, `ok`, `presence/fast-store-down` at most once a minute (AC-6), Redis down +
 * DB fault → `unavailable` 5000 and a failed beat (AC-7), invalid events skipped (AC-8), the highest source wins
 * (AC-9), 1 KiB body limit (NFR-4), no subject / IP in the logs (NFR-5), `private, no-store` (NFR-7), every `pr:*`
 * key with a TTL ≤ 48 h (AC-56).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RedisStore } from '../../src/adapters/redis';
import type { StoredCatalog } from '../../src/catalog/ports';
import { windowOf } from '../../src/domain/presence/window';
import { presenceOf } from '../../src/endpoints/deps';
import { presenceFaults } from '../../src/presence/faults';
import { DependencyUnavailable, type AlarmInput } from '../../src/ports';
import { buildAuthHarness, CookieJar, freshIp, writeProbe, type AuthHarness } from '../support/authClient';
import { ownRedis } from './helpers';

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14-${run}`;
const started = new Date();
const M = Date.parse('2026-12-31T22:00:00Z');
const M2 = M + 3_600_000;
const E1 = `e1-${run}`; // midnight, zone A
const E2 = `e2-${run}`; // non-midnight slot
const E3 = `e3-${run}`; // hidden by a correction
const E4 = `e4-${run}`; // midnight, zone B (an hour later)
const W = windowOf(M);
const TTL_48H = 172_800_000;

/** The harness store: the real Redis; `down` fails every `pr:*` call; every `pr:*` TTL is recorded. */
const fast = { down: false, ttls: [] as { key: string; ttlMs: number }[] };
const pr = (k: string) => k.startsWith('pr:');
function guard(k: string): void {
  if (fast.down && pr(k)) throw new DependencyUnavailable('redis');
}
const store: RedisStore = {
  close: async () => {},
  deleteByPrefix: (p) => redis.deleteByPrefix(p),
  decrIfPresent: (k) => (guard(k), redis.decrIfPresent(k)),
  async incrWindow(k, w) {
    guard(k);
    if (pr(k)) fast.ttls.push({ key: k, ttlMs: w });
    return redis.incrWindow(k, w);
  },
  async setIfAbsent(k, v, ttl) {
    guard(k);
    if (pr(k)) fast.ttls.push({ key: k, ttlMs: ttl });
    return redis.setIfAbsent(k, v, ttl);
  },
  async set(k, v, ttl) {
    guard(k);
    if (pr(k)) fast.ttls.push({ key: k, ttlMs: ttl });
    return redis.set(k, v, ttl);
  },
  async get(k) {
    guard(k);
    return redis.get(k);
  },
  async del(k) {
    guard(k);
    return redis.del(k);
  },
};

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2026-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: [
    { zoneId: 'za', midnightUtc: new Date(M).toISOString() },
    { zoneId: 'zb', midnightUtc: new Date(M2).toISOString() },
  ],
  countries: [],
  cities: [],
  events: [
    { eventId: E1, countryIso: 'AA', zoneId: 'za', slot: 'midnight' },
    { eventId: E2, countryIso: 'AA', zoneId: 'za', slot: 'concert' },
    { eventId: E3, countryIso: 'BB', zoneId: 'za', slot: 'midnight' },
    { eventId: E4, countryIso: 'CC', zoneId: 'zb' },
  ],
  traditions: [],
};
const live = [
  { eventId: E1, zoneId: 'za', moment: M, nonMidnight: false, hidden: false },
  { eventId: E2, zoneId: 'za', moment: M, nonMidnight: true, hidden: false },
  { eventId: E3, zoneId: 'za', moment: M, nonMidnight: false, hidden: true },
  { eventId: E4, zoneId: 'zb', moment: M2, nonMidnight: false, hidden: false },
];

const logs: string[] = [];
const alarms: AlarmInput[] = [];
let pool: pg.Pool;
let h: AuthHarness;
const ips: string[] = [];

const setClock = async (at: number) => {
  const res = await h.call('/api/_test/clock', { body: { at, frozen: true } });
  expect(res.status).toBe(200);
};

interface Guest {
  jar: CookieJar;
  ip: string;
  subject: string;
}
async function guest(): Promise<Guest> {
  const jar = new CookieJar();
  const ip = freshIp();
  ips.push(ip);
  const res = await writeProbe(h, { jar, ip });
  expect(res.status).toBe(200);
  return { jar, ip, subject: ((await res.json()) as { value: { subject: string } }).value.subject };
}

const beat = (g: Guest, body: unknown) => h.call('/api/presence', { body, jar: g.jar, ip: g.ip });
const value = async (res: Response) => ((await res.json()) as { value: { nextBeatMs: number | null } }).value;
const proofs = async (subject: string) =>
  (
    await pool.query<{ event_id: string; moment_ms: string; first_received_at: string; source: string }>(
      'SELECT event_id, moment_ms, first_received_at, source FROM presence_proofs WHERE subject_id = $1 ORDER BY event_id',
      [subject],
    )
  ).rows;
const fastAlarms = () => alarms.filter((a) => a.code === 'presence/fast-store-down');

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(store, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => live } };
    const capture = (fields: Record<string, unknown>) => void logs.push(JSON.stringify(fields));
    deps.log = { info: capture, warn: capture, error: capture };
    const raise = deps.alarm.raise.bind(deps.alarm);
    deps.alarm = {
      raise(a) {
        alarms.push(a);
        raise(a);
      },
    };
  });
  await setClock(M);
}, 60_000);

afterAll(async () => {
  fast.down = false;
  presenceFaults.reset();
  await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  await pool.query('DELETE FROM presence_proofs WHERE season = $1', [SEASON]);
  await pool.query('DELETE FROM presence_event_moments WHERE season = $1', [SEASON]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  for (const p of ['pr:mk:', 'pr:pre:', 'pr:in:', 'pr:cnt:pre:', 'pr:cnt:in:', 'pr:ev:', 'pr:eva:']) await redis.deleteByPrefix(`${p}${SEASON}:`);
  await redis.close();
});

describe('body and headers (AC-1, NFR-4, NFR-7)', () => {
  it('rejects any extra field, too many events, an unknown source; a body over 1 KiB is refused unread', async () => {
    const g = await guest();
    for (const body of [
      { eventIds: [E1], source: 'tv', playerState: 'playing' },
      { eventIds: Array.from({ length: 9 }, (_, i) => `x${i}`), source: 'tv' },
      { eventIds: [], source: 'tv' },
      { eventIds: [E1], source: 'radio' },
    ]) {
      const res = await beat(g, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('validation');
    }
    const big = await beat(g, { eventIds: [E1], source: 'tv', openedAt: M, pad: 'a'.repeat(1_100) });
    expect(big.status).toBe(400);
    const err = ((await big.json()) as { error: { code: string; reason?: string; message?: string } }).error;
    expect(err).toMatchObject({ code: 'validation' });
    // Refused by the size cap before parsing: no field path (the strict schema would name `pad`).
    expect(err.message).toBeUndefined();
    expect(await proofs(g.subject)).toEqual([]);
  });

  it('answers with Cache-Control: private, no-store', async () => {
    const res = await beat(await guest(), { eventIds: [E1], source: 'tv' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('proof (AC-3, AC-4, AC-9, AC-11)', () => {
  it('a beat in the window → exactly one proof with the first receipt time; repeats add none', async () => {
    await setClock(M);
    const g = await guest();
    expect(await value(await beat(g, { eventIds: [E1], source: 'tv' }))).toEqual({ nextBeatMs: 20_000 });
    expect(await proofs(g.subject)).toEqual([{ event_id: E1, moment_ms: String(M), first_received_at: String(M), source: 'tv' }]);
    await setClock(M + 5_000);
    expect((await beat(g, { eventIds: [E1], source: 'tv' })).status).toBe(200);
    expect(await proofs(g.subject)).toEqual([{ event_id: E1, moment_ms: String(M), first_received_at: String(M), source: 'tv' }]);
  });

  it('the highest-priority source wins and is never lowered (country > room > air > tv)', async () => {
    await setClock(M);
    const g = await guest();
    for (const [source, expected] of [
      ['tv', 'tv'],
      ['room', 'room'],
      ['air', 'room'],
      ['country', 'country'],
      ['tv', 'country'],
    ] as const) {
      expect((await beat(g, { eventIds: [E1], source })).status).toBe(200);
      expect((await proofs(g.subject))[0]?.source, source).toBe(expected);
    }
    expect(await proofs(g.subject)).toHaveLength(1);
  });

  it('outside the window: no proof, only the pre-window counter; openedAt inside the window changes nothing', async () => {
    await setClock(M - 300_000);
    const g = await guest();
    const res = await beat(g, { eventIds: [E1], source: 'country', openedAt: M - 30_000 });
    expect(await value(res)).toEqual({ nextBeatMs: 60_000 });
    expect(await proofs(g.subject)).toEqual([]);
    expect(await redis.get(`pr:pre:${SEASON}:${E1}:${M}:${g.subject}`)).toBe('1');
    expect(Number(await redis.get(`pr:cnt:pre:${SEASON}:${E1}:${M}`))).toBeGreaterThanOrEqual(1);

    await setClock(W.until + 1);
    expect(await value(await beat(g, { eventIds: [E1], source: 'country', openedAt: M }))).toEqual({ nextBeatMs: null });
    expect(await proofs(g.subject)).toEqual([]);
  });

  it('the window bounds come from the rule: its first and last instants count', async () => {
    for (const at of [W.from, W.until]) {
      await setClock(at);
      const g = await guest();
      expect((await beat(g, { eventIds: [E1], source: 'tv' })).status).toBe(200);
      expect(await proofs(g.subject), String(at - M)).toHaveLength(1);
    }
    await setClock(W.from - 1);
    const g = await guest();
    expect((await beat(g, { eventIds: [E1], source: 'tv' })).status).toBe(200);
    expect(await proofs(g.subject)).toEqual([]);
  });
});

describe('schedule and event validity (AC-2, AC-8)', () => {
  it('nextBeatMs follows [А2] relative to the nearest moment', async () => {
    const g = await guest();
    for (const [at, expected] of [
      [M - 3_600_000, 900_000],
      [M - 1_200_000, 900_000],
      [M - 600_000, 300_000],
      [M - 300_000, 60_000],
      [M - 120_001, 60_000],
      [M - 120_000, 20_000],
      [W.until, 20_000],
    ] as const) {
      await setClock(at);
      expect(await value(await beat(g, { eventIds: [E1], source: 'tv' })), String(at - M)).toEqual({ nextBeatMs: expected });
    }
  });

  it('non-midnight, hidden and unknown events are skipped: no proof, nextBeatMs from the rest only', async () => {
    await setClock(M);
    const g = await guest();
    expect(await value(await beat(g, { eventIds: [E2, E3, `nope-${run}`], source: 'tv' }))).toEqual({ nextBeatMs: null });
    expect(await proofs(g.subject)).toEqual([]);
    // E4 is an hour later: far from its midnight → the 15 min cap; E1 at its midnight is not in the beat.
    expect(await value(await beat(g, { eventIds: [E2, E4], source: 'tv' }))).toEqual({ nextBeatMs: 900_000 });
    expect(await proofs(g.subject)).toEqual([]);
  });
});

describe('rate limit (AC-5)', () => {
  it('the 13th beat within a minute → 429 with retryAfterMs', async () => {
    await setClock(M - 3_600_000);
    const g = await guest();
    for (let i = 0; i < 12; i++) expect((await beat(g, { eventIds: [E1], source: 'tv' })).status, String(i)).toBe(200);
    const res = await beat(g, { eventIds: [E1], source: 'tv' });
    expect(res.status).toBe(429);
    const err = ((await res.json()) as { error: { code: string; retryAfterMs?: number } }).error;
    expect(err.code).toBe('rate_limited');
    expect(err.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('Redis down (AC-6, AC-7)', () => {
  it('the proof goes straight to Postgres without duplicates, ok + nextBeatMs, the alarm at most once a minute', async () => {
    await setClock(M);
    const g = await guest();
    const before = fastAlarms().length;
    fast.down = true;
    try {
      expect(await value(await beat(g, { eventIds: [E1], source: 'tv' }))).toEqual({ nextBeatMs: 20_000 });
      expect(await value(await beat(g, { eventIds: [E1], source: 'country' }))).toEqual({ nextBeatMs: 20_000 });
      expect(await proofs(g.subject)).toEqual([{ event_id: E1, moment_ms: String(M), first_received_at: String(M), source: 'country' }]);
      expect(fastAlarms().length - before).toBeLessThanOrEqual(1);
      expect(fastAlarms().length).toBeGreaterThanOrEqual(1);
      const atFirst = fastAlarms().length;

      await setClock(M2);
      expect((await beat(g, { eventIds: [E4], source: 'tv' })).status).toBe(200);
      expect(fastAlarms().length).toBe(atFirst + 1);
      expect(await proofs(g.subject)).toHaveLength(2);
      for (const a of fastAlarms()) expect(a).toMatchObject({ level: 'log', source: 'presence', details: { node: expect.any(String) } });
    } finally {
      fast.down = false;
    }
  });

  it('Redis down and the proof cannot be written to Postgres → unavailable, retryAfterMs 5000, the beat counted failed', async () => {
    await setClock(M);
    const g = await guest();
    const intake = presenceOf(h.deps).intake;
    const before = intake.peek();
    fast.down = true;
    presenceFaults.apply({ dbWrite: 'down' });
    try {
      const res = await beat(g, { eventIds: [E1], source: 'tv' });
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: unknown }).error).toEqual({ code: 'unavailable', retryAfterMs: 5_000 });
      expect(intake.peek().failed).toBe(before.failed + 1);
      expect(intake.peek().accepted).toBe(before.accepted);
    } finally {
      fast.down = false;
      presenceFaults.reset();
    }
    expect(await proofs(g.subject)).toEqual([]);
  });
});

describe('keys and logs (AC-56, NFR-5)', () => {
  it('every pr:* key lives at most 48 h', () => {
    expect(fast.ttls.length).toBeGreaterThan(0);
    for (const t of fast.ttls) expect(t.ttlMs, t.key).toBeLessThanOrEqual(TTL_48H);
  });

  it('the logs carry no subject id and no client address', async () => {
    const subjects = (await pool.query<{ subject_id: string }>('SELECT DISTINCT subject_id FROM presence_proofs WHERE season = $1', [SEASON])).rows;
    expect(subjects.length).toBeGreaterThan(0);
    const text = logs.join('\n');
    for (const { subject_id } of subjects) expect(text).not.toContain(subject_id);
    for (const ip of ips) expect(text).not.toContain(ip);
    for (const a of alarms) for (const { subject_id } of subjects) expect(JSON.stringify(a)).not.toContain(subject_id);
  });
});
