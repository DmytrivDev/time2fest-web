/**
 * SPEC-14 W27 — stamp claims through the real pipeline (in-process dispatcher, this slot's Postgres and Redis, the test
 * clock; the catalog and the patched moments are stubbed so the windows are known; health records and downtime records
 * are written directly / through the presence services so every branch is reached):
 * AC-11 (`openedAt` never makes presence), AC-12 (proofs survive a flush of the presence keys), AC-18 (no record past
 * end + 2 min → downtime), AC-23 (same stamp twice, one row), AC-24 (presence before the record), AC-25 (`no-presence`
 * only under a healthy record), AC-26 (`unavailable` ranges), AC-27 (close + Δ ± 1 ms), AC-28 (`unknown-event`),
 * AC-29 (one test per downtime kind), AC-30 (10 parallel claims), AC-31 (one stamp per event), AC-34 (a pass changes
 * nothing), AC-35 (61st claim a minute → 429), AC-36 (read-time composition), AC-37 (ordered list, `[]` without a
 * session and no guest), NFR-4 (1 KiB), NFR-5 (no subject in logs), NFR-7 (`private, no-store`).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { stampGrantedAt } from '@time2fest/rules/time';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { finaliseDueAt, missingRecordAt } from '../../src/domain/presence/healthSigns';
import { PRESENCE_DELTA_MS, windowOf } from '../../src/domain/presence/window';
import { presenceOf } from '../../src/endpoints/deps';
import { presenceFaults } from '../../src/presence/faults';
import { buildAuthHarness, CookieJar, freshIp, writeProbe, type AuthHarness } from '../support/authClient';
import { ownRedis } from './helpers';

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14c-${run}`;
const started = new Date();
const M0 = Date.parse('2026-12-31T21:00:00Z');
const M = M0 + 3_600_000;
const M2 = M + 3_600_000;
const CLOSE = M2 + 12 * 3_600_000; // ratingCloseAt of the stubbed zones
const ev = (name: string) => `${name}-${run}`;
const EP = ev('ep'); // proofs (AA, city 1)
const EP2 = ev('ep2'); // proofs (AA, city 2)
const EH = ev('eh'); // healthy record
const EN = ev('en'); // never a record
const ED = ev('ed'); // a `downtime` record
const EM = ev('em'); // manual downtime of the event
const E0 = ev('e0'); // an hour earlier, `downtime` record
const EE = ev('ee'); // zone b, edge-region range
const EC = ev('ec'); // concert slot
const EX = ev('ex'); // hidden by a correction

const city = (cityId: string, name: string) => ({ cityId, countryIso: 'AA', zoneId: 'za', name: { uk: name } });
const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2026-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: [
    { zoneId: 'z0', midnightUtc: new Date(M0).toISOString() },
    { zoneId: 'za', midnightUtc: new Date(M).toISOString() },
    { zoneId: 'zb', midnightUtc: new Date(M2).toISOString() },
  ],
  countries: [
    { iso: 'AA', illustrationId: 'ill-aa' },
    { iso: 'BB', illustrationId: 'ill-bb' },
  ],
  cities: [city('c1', 'City One'), city('c2', 'City Two'), { cityId: 'c3', countryIso: 'BB', zoneId: 'zb', name: { uk: 'City Three' } }],
  events: [
    ...[EP, EH, EN, ED, EM, EC, EX].map((eventId) => ({ eventId, countryIso: 'AA', cityId: 'c1', zoneId: 'za', midnightUtc: new Date(M).toISOString(), slot: eventId === EC ? 'concert' : 'midnight' })),
    { eventId: EP2, countryIso: 'AA', cityId: 'c2', zoneId: 'za', midnightUtc: new Date(M).toISOString(), slot: 'midnight' },
    { eventId: E0, countryIso: 'AA', cityId: 'c1', zoneId: 'z0', midnightUtc: new Date(M0).toISOString(), slot: 'midnight' },
    { eventId: EE, countryIso: 'BB', cityId: 'c3', zoneId: 'zb', midnightUtc: new Date(M2).toISOString(), slot: 'midnight' },
  ],
  traditions: [],
};
const live = [
  ...[EP, EP2, EH, EN, ED, EM].map((eventId) => ({ eventId, zoneId: 'za', moment: M, nonMidnight: false, hidden: false })),
  { eventId: EC, zoneId: 'za', moment: M, nonMidnight: true, hidden: false },
  { eventId: EX, zoneId: 'za', moment: M, nonMidnight: false, hidden: true },
  { eventId: E0, zoneId: 'z0', moment: M0, nonMidnight: false, hidden: false },
  { eventId: EE, zoneId: 'zb', moment: M2, nonMidnight: false, hidden: false },
];

const logs: string[] = [];
let pool: pg.Pool;
let h: AuthHarness;

interface Guest {
  jar: CookieJar;
  ip: string;
  subject: string;
}
interface Body {
  ok: boolean;
  value?: { eventId: string; grantedAt: number; presenceSource: string; illustrationId: string; cityName: string; countryIso: string };
  error?: { code: string; reason?: string; retryAfterMs?: number };
}

const setClock = async (at: number) => expect((await h.call('/api/_test/clock', { body: { at, frozen: true } })).status).toBe(200);
async function guest(): Promise<Guest> {
  const jar = new CookieJar();
  const ip = freshIp();
  const res = await writeProbe(h, { jar, ip });
  expect(res.status).toBe(200);
  return { jar, ip, subject: ((await res.json()) as { value: { subject: string } }).value.subject };
}
const beat = (g: Guest, eventIds: string[], source = 'tv', openedAt?: number) =>
  h.call('/api/presence', { body: { eventIds, source, ...(openedAt !== undefined ? { openedAt } : {}) }, jar: g.jar, ip: g.ip });
const claimRes = (g: Guest, eventId: string, source = 'tv', at = M) => h.call('/api/me/stamps', { body: { eventId, source, at }, jar: g.jar, ip: g.ip });
async function claim(g: Guest, eventId: string, source = 'tv', at = M): Promise<{ status: number; body: Body; res: Response }> {
  const res = await claimRes(g, eventId, source, at);
  return { status: res.status, body: (await res.json()) as Body, res };
}
const stampRows = async (subject: string) =>
  (await pool.query<{ event_id: string; grant_kind: string; granted_at: string; presence_source: string }>(
    'SELECT event_id, grant_kind, granted_at, presence_source FROM stamps WHERE subject_id = $1 ORDER BY event_id',
    [subject],
  )).rows;
const record = (eventId: string, moment: number, state: 'healthy' | 'downtime', signs: string[] = []) =>
  pool.query('INSERT INTO presence_window_health (season, event_id, moment_ms, state, signs, recorded_at) VALUES ($1, $2, $3, $4, $5::text[], $6)', [
    SEASON,
    eventId,
    String(moment),
    state,
    signs,
    String(moment + 60_000),
  ]);

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 4 });
  h = await buildAuthHarness(redis, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => live } };
    const capture = (fields: Record<string, unknown>) => void logs.push(JSON.stringify(fields));
    deps.log = { info: capture, warn: capture, error: capture };
  });
  presenceOf(h.deps).clear();
  await record(EH, M, 'healthy');
  await record(ED, M, 'downtime', ['fast-store-unavailable']);
  await record(E0, M0, 'downtime', ['sample-gap']);
  await setClock(M);
  expect(await presenceOf(h.deps).downtimes.addManual({ eventId: EM, reason: 'test manual' }, M)).toMatchObject({ ok: true });
  const w2 = windowOf(M2);
  expect(await presenceOf(h.deps).downtimes.reportEdgeFailure({ region: 'eu-test', from: w2.from, to: w2.until }, M)).toMatchObject({ ok: true });
}, 60_000);

afterAll(async () => {
  presenceFaults.reset();
  await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  for (const t of ['stamps', 'stamp_old_moment_log', 'presence_proofs', 'presence_event_moments', 'presence_window_health', 'presence_downtimes'])
    await pool.query(`DELETE FROM ${t} WHERE season = $1`, [SEASON]);
  await pool.query(`DELETE FROM passes WHERE grant_ref LIKE $1`, [`pc-${run}-%`]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix(`pr:`);
  await redis.close();
});

describe('body, headers (AC-23, NFR-4, NFR-7)', () => {
  it('strict body; a body over 1 KiB is refused; both routes answer private, no-store', async () => {
    const g = await guest();
    for (const body of [{ eventId: EP, source: 'tv', at: M, extra: 1 }, { eventId: EP, source: 'radio', at: M }, { eventId: 'x'.repeat(65), source: 'tv', at: M }]) {
      expect((await h.call('/api/me/stamps', { body, jar: g.jar, ip: g.ip })).status, JSON.stringify(body)).toBe(400);
    }
    const big = await h.call('/api/me/stamps', { body: { eventId: EP, source: 'tv', at: M, pad: 'a'.repeat(1_100) }, jar: g.jar, ip: g.ip });
    expect(big.status).toBe(400);
    const c = await claimRes(g, EN);
    expect(c.headers.get('cache-control')).toBe('private, no-store');
    const l = await h.call('/api/me/stamps', { method: 'GET', jar: g.jar, ip: g.ip });
    expect(l.status).toBe(200);
    expect(l.headers.get('cache-control')).toBe('private, no-store');
  });
});

describe('presence (AC-11, AC-12, AC-23, AC-24, AC-30, AC-31)', () => {
  it('beat in the window, claim at m + 16 s → presence at once, before any record; a repeat → the same stamp, one row', async () => {
    await setClock(M);
    const g = await guest();
    expect((await beat(g, [EP], 'room')).status).toBe(200);
    await setClock(M + 16_000);
    const first = await claim(g, EP, 'tv');
    expect(first.status).toBe(200);
    expect(first.body.value).toEqual({ eventId: EP, grantedAt: stampGrantedAt(M), presenceSource: 'room', illustrationId: 'ill-aa', cityName: 'City One', countryIso: 'AA' });
    expect((await pool.query('SELECT 1 FROM presence_window_health WHERE season = $1 AND event_id = $2', [SEASON, EP])).rowCount).toBe(0);
    await setClock(M + 60_000);
    const again = await claim(g, EP, 'country', M + 59_000);
    expect(again.body.value).toEqual(first.body.value);
    expect(await stampRows(g.subject)).toEqual([{ event_id: EP, grant_kind: 'presence', granted_at: String(stampGrantedAt(M)), presence_source: 'room' }]);
  });

  it('a flush of the presence keys after the beat → still presence from the Postgres proof (AC-12)', async () => {
    await setClock(M + 1_000);
    const g = await guest();
    expect((await beat(g, [EP2])).status).toBe(200);
    expect(await redis.get(`pr:mk:${SEASON}:${EP2}:${M}:${g.subject}`)).toBe('tv');
    await redis.deleteByPrefix('pr:');
    expect(await redis.get(`pr:mk:${SEASON}:${EP2}:${M}:${g.subject}`)).toBeNull();
    await setClock(M + 20_000);
    const c = await claim(g, EP2);
    expect(c.status).toBe(200);
    expect((await stampRows(g.subject))[0]).toMatchObject({ grant_kind: 'presence' });
  });

  it('10 parallel claims → one row, 10 identical stamps (AC-30)', async () => {
    await setClock(M);
    const g = await guest();
    expect((await beat(g, [EP])).status).toBe(200);
    await setClock(M + 30_000);
    const out = await Promise.all(Array.from({ length: 10 }, () => claim(g, EP)));
    for (const o of out) expect(o.status).toBe(200);
    for (const o of out) expect(o.body.value).toEqual(out[0]!.body.value);
    expect(await stampRows(g.subject)).toHaveLength(1);
  });

  it('two events of one country from a room source → two stamps of that country (AC-31)', async () => {
    await setClock(M);
    const g = await guest();
    expect((await beat(g, [EP, EP2], 'room')).status).toBe(200);
    await setClock(M + 30_000);
    const a = await claim(g, EP, 'room');
    const b = await claim(g, EP2, 'room');
    expect([a.body.value?.cityName, b.body.value?.cityName]).toEqual(['City One', 'City Two']);
    expect([a.body.value?.countryIso, b.body.value?.countryIso]).toEqual(['AA', 'AA']);
    expect(await stampRows(g.subject)).toHaveLength(2);
  });

  it('a beat at m − 5 min with openedAt inside the window, healthy window → no-presence (AC-11)', async () => {
    await setClock(M - 300_000);
    const g = await guest();
    expect((await beat(g, [EH], 'tv', M - 30_000)).status).toBe(200);
    await setClock(M + 30_000);
    const c = await claim(g, EH, 'tv', M);
    expect(c.status).toBe(403);
    expect(c.body.error).toEqual({ code: 'forbidden', reason: 'no-presence' });
  });
});

describe('downtime (AC-18, AC-29) and no-presence (AC-25, AC-34)', () => {
  it('each downtime kind → downtime with the body source: record, manual, edge-region, missing record', async () => {
    await setClock(M2 + 30_000);
    const g = await guest();
    for (const e of [ED, EM, EE]) {
      const c = await claim(g, e, 'air');
      expect(c.status, e).toBe(200);
      expect(c.body.value?.presenceSource).toBe('air');
    }
    const g2 = await guest();
    await setClock(windowOf(M).until + 180_000);
    expect(windowOf(M).until + 180_000).toBeGreaterThan(missingRecordAt(M));
    expect((await claim(g2, EN, 'country')).status).toBe(200);
    const kinds = [...(await stampRows(g.subject)), ...(await stampRows(g2.subject))].map((r) => [r.event_id, r.grant_kind, r.presence_source]);
    expect(kinds.sort()).toEqual(
      [
        [ED, 'downtime', 'air'],
        [EM, 'downtime', 'air'],
        [EE, 'downtime', 'air'],
        [EN, 'downtime', 'country'],
      ].sort(),
    );
  });

  it('healthy record and no proof → no-presence; without a record → not no-presence (AC-25)', async () => {
    await setClock(M + 30_000);
    const g = await guest();
    expect((await claim(g, EH)).body.error).toEqual({ code: 'forbidden', reason: 'no-presence' });
    const n = await claim(g, EN);
    expect(n.status).toBe(503);
    expect(n.body.error?.reason).toBeUndefined();
  });

  it('a subject with a pass and no proof under a healthy window → no-presence (AC-34)', async () => {
    await setClock(M + 30_000);
    const g = await guest();
    const pass = await h.call('/api/_test/rights/pass-grant', {
      body: { holder: { device: 'current', paymentEmail: `pc-${run}@example.test` }, source: 'purchase', grantRef: `pc-${run}-1` },
      jar: g.jar,
      ip: g.ip,
    });
    expect(pass.status).toBe(200);
    expect((await claim(g, EH)).body.error).toEqual({ code: 'forbidden', reason: 'no-presence' });
    expect(await stampRows(g.subject)).toEqual([]);
  });
});

describe('unavailable (AC-26), unknown event (AC-28), close (AC-27)', () => {
  it('at m − 10 s → until m + 15 s; at m + 16 s without proof and record → 1 000…30 000; database fault → 5 000; never no-presence', async () => {
    const g = await guest();
    await setClock(M - 10_000);
    const early = await claim(g, EN);
    expect(early.status).toBe(503);
    expect(early.body.error).toEqual({ code: 'unavailable', retryAfterMs: 25_000 });
    await setClock(M + 16_000);
    const waiting = await claim(g, EN);
    expect(waiting.body.error?.code).toBe('unavailable');
    expect(waiting.body.error?.retryAfterMs).toBe(Math.min(30_000, Math.max(1_000, finaliseDueAt(M) - (M + 16_000))));
    presenceFaults.apply({ dbWrite: 'down' });
    try {
      const fault = await claim(g, EH);
      expect(fault.status).toBe(503);
      expect(fault.body.error).toEqual({ code: 'unavailable', retryAfterMs: 5_000 });
    } finally {
      presenceFaults.reset();
    }
  });

  it('unknown id, a non-midnight event, a hidden event → unknown-event', async () => {
    await setClock(M + 30_000);
    const g = await guest();
    for (const e of [ev('nope'), EC, EX]) {
      const c = await claim(g, e);
      expect(c.status, e).toBe(404);
      expect(c.body.error).toEqual({ code: 'not_found', reason: 'unknown-event' });
    }
  });

  it('close + Δ − 1 ms → evaluated; close + Δ + 1 ms → claim-closed; an existing stamp after the close → the same stamp', async () => {
    const g = await guest();
    await setClock(M2 + 30_000);
    const had = await claim(g, ED);
    expect(had.status).toBe(200);
    await setClock(CLOSE + PRESENCE_DELTA_MS - 1);
    expect((await claim(g, EH)).body.error).toEqual({ code: 'forbidden', reason: 'no-presence' });
    await setClock(CLOSE + PRESENCE_DELTA_MS + 1);
    const closed = await claim(g, EH);
    expect(closed.status).toBe(409);
    expect(closed.body.error).toEqual({ code: 'conflict', reason: 'claim-closed' });
    const same = await claim(g, ED);
    expect(same.status).toBe(200);
    expect(same.body.value).toEqual(had.body.value);
  });
});

describe('rate limit (AC-35)', () => {
  it('the 61st claim within 60 s → rate_limited with retryAfterMs', async () => {
    await setClock(M + 30_000);
    const g = await guest();
    for (let i = 0; i < 60; i += 1) expect((await claimRes(g, EH)).status, `claim ${i + 1}`).toBe(403);
    const last = await claim(g, EH);
    expect(last.status).toBe(429);
    expect(last.body.error?.code).toBe('rate_limited');
    expect(last.body.error?.retryAfterMs).toBeGreaterThan(0);
  });
});

describe('list (AC-36, AC-37)', () => {
  it('3 stamps → ordered by grantedAt; a changed illustration changes the stamps already granted', async () => {
    await setClock(M2 + 30_000);
    const g = await guest();
    for (const e of [EE, ED, E0]) expect((await claim(g, e)).status, e).toBe(200);
    const list = async () => ((await (await h.call('/api/me/stamps', { method: 'GET', jar: g.jar, ip: g.ip })).json()) as { value: Body['value'][] }).value;
    const first = await list();
    expect(first.map((s) => s?.eventId)).toEqual([E0, ED, EE]);
    expect(first.map((s) => s?.grantedAt)).toEqual([stampGrantedAt(M0), stampGrantedAt(M), stampGrantedAt(M2)]);
    expect(first[2]?.illustrationId).toBe('ill-bb');
    const bb = stored.countries.find((c) => c.iso === 'BB')!;
    bb.illustrationId = 'ill-bb-new';
    try {
      presenceOf(h.deps).clear();
      expect((await list())[2]?.illustrationId).toBe('ill-bb-new');
    } finally {
      bb.illustrationId = 'ill-bb';
      presenceOf(h.deps).clear();
    }
  });

  it('no session → [] and no guest is created', async () => {
    const users = async () => ((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0] as { n: number }).n;
    const before = await users();
    const jar = new CookieJar();
    const res = await h.call('/api/me/stamps', { method: 'GET', jar, ip: freshIp() });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { value: unknown }).value).toEqual([]);
    expect(await users()).toBe(before);
  });
});

describe('logs (NFR-5)', () => {
  it('the logs carry no subject id', async () => {
    const subjects = (await pool.query<{ subject_id: string }>('SELECT DISTINCT subject_id FROM stamps WHERE season = $1', [SEASON])).rows;
    expect(subjects.length).toBeGreaterThan(3);
    const text = logs.join('\n');
    for (const { subject_id } of subjects) expect(text).not.toContain(subject_id);
  });
});
