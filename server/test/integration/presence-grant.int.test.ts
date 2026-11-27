/**
 * SPEC-14 W30 - consequences of a granted stamp: the `stamp` envelope on `user:#<subject>` within 3 s (AC-39), a publish
 * fault never fails the claim and leaves a log line without the subject (AC-39, NFR-5), exactly one internal event
 * `passport.stamp-granted` per inserted stamp and none on a repeat (AC-40), achievements stored once with their season
 * keys (AC-41), a season switch gives an empty passport while the old stamps and achievements stay, and the new season
 * counts from zero (AC-38, AC-43). Grants come from manual downtime records (no beats needed). Skips when Centrifugo is
 * unreachable (SPEC-06 AC-62).
 */
import { randomBytes } from 'node:crypto';
import type { Centrifuge, PublicationContext } from 'centrifuge';
import pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { presenceOf } from '../../src/endpoints/deps';
import { STAMP_GRANTED_TOPIC } from '../../src/presence/events';
import { presenceFaults } from '../../src/presence/faults';
import { buildAuthHarness, CookieJar, freshIp, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { ownRedis } from './helpers';
import { centrifugeClient, connectAndWait, describeRealtime, name } from './realtime-support';

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14g-${run}`;
const SEASON2 = `t14h-${run}`;
const M = Date.parse('2026-12-31T21:00:00Z');
const ev = (n: string) => `${n}-${run}`;
const IDS = [ev('g1'), ev('g2'), ev('g3'), ev('g4')];
const ISO = ['AA', 'BB', 'CC', 'DD'];
const started = new Date();

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2026-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: IDS.map((_, i) => ({ zoneId: `zg${i}`, order: i + 1, midnightUtc: new Date(M).toISOString() })),
  countries: ISO.map((iso) => ({ iso, illustrationId: `ill-${iso}` })),
  cities: IDS.map((_, i) => ({ cityId: `cg${i}`, countryIso: ISO[i]!, zoneId: `zg${i}`, name: { uk: `City ${i}` } })),
  events: IDS.map((eventId, i) => ({ eventId, countryIso: ISO[i]!, cityId: `cg${i}`, zoneId: `zg${i}`, midnightUtc: new Date(M).toISOString(), slot: 'midnight' })),
  traditions: [],
};
const live = IDS.map((eventId, i) => ({ eventId, zoneId: `zg${i}`, moment: M, nonMidnight: false, hidden: false }));

const logs: string[] = [];
let pool: pg.Pool;
let h: AuthHarness;
const clients: Centrifuge[] = [];

interface Guest {
  jar: CookieJar;
  ip: string;
  subject: string;
}
const setClock = async (at: number) => expect((await h.call('/api/_test/clock', { body: { at, frozen: true } })).status).toBe(200);
async function guest(): Promise<Guest> {
  const jar = new CookieJar();
  const ip = freshIp();
  const res = await writeProbe(h, { jar, ip });
  expect(res.status).toBe(200);
  return { jar, ip, subject: ((await res.json()) as { value: { subject: string } }).value.subject };
}
const claim = async (g: Guest, eventId: string) => {
  const res = await h.call('/api/me/stamps', { body: { eventId, source: 'tv', at: M }, jar: g.jar, ip: g.ip });
  return { status: res.status, body: (await res.json()) as { ok: boolean } };
};
const internalEvents = async (subject: string) =>
  (await pool.query<{ payload: { eventId: string; grantKind: string; season: string; newKeys: string[] } }>(
    `SELECT payload FROM internal_events WHERE topic = $1 AND payload->>'subject' = $2 ORDER BY id`,
    [STAMP_GRANTED_TOPIC, subject],
  )).rows.map((r) => r.payload);
const keysOf = async (subject: string) =>
  (await pool.query<{ season: string; key: string }>('SELECT season, key FROM passport_achievements WHERE subject_id = $1 ORDER BY key', [subject])).rows;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 4 });
  h = await buildAuthHarness(redis, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => live } };
    const capture = (fields: Record<string, unknown>) => void logs.push(JSON.stringify(fields));
    deps.log = { info: capture, warn: capture, error: capture };
  });
  presenceOf(h.deps).clear();
  await setClock(M);
  for (const eventId of IDS) expect(await presenceOf(h.deps).downtimes.addManual({ eventId, reason: 'grant test' }, M)).toMatchObject({ ok: true });
}, 60_000);

afterAll(async () => {
  for (const c of clients) c.disconnect();
  presenceFaults.reset();
  await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  for (const t of ['stamps', 'stamp_old_moment_log', 'presence_proofs', 'presence_event_moments', 'presence_window_health', 'presence_downtimes', 'passport_achievements'])
    await pool.query(`DELETE FROM ${t} WHERE season = ANY($1::text[])`, [[SEASON, SEASON2]]).catch(() => undefined);
  await pool.query(`DELETE FROM internal_events WHERE topic = $1 AND payload->>'season' = ANY($2::text[])`, [STAMP_GRANTED_TOPIC, [SEASON, SEASON2]]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.close();
});

describeRealtime('grant consequences (AC-38 .. AC-43)', () => {
  it('a second tab gets `granted` within 3 s; one internal event per stamp, none on a repeat; goal keys on the 3rd country', { timeout: 60_000 }, async () => {
    await setClock(M + 16_000);
    const g = await guest();
    const token = ((await (await h.call('/api/realtime/token', { jar: g.jar, ip: g.ip })).json()) as { value: { token: string } }).value.token;
    const client = centrifugeClient(token);
    clients.push(client);
    expect(await connectAndWait(client)).toBe('connected');
    const received: { type?: string; data?: { kind?: string; stamp?: { eventId?: string } } }[] = [];
    const sub = client.newSubscription(name('user', g.subject));
    sub.on('publication', (ctx: PublicationContext) => received.push(ctx.data as (typeof received)[number]));
    await new Promise<void>((resolve, reject) => {
      sub.once('subscribed', () => resolve());
      sub.once('error', (ctx) => reject(new Error(`subscribe refused ${ctx.error.code}`)));
      sub.subscribe();
    });

    const t0 = performance.now();
    expect((await claim(g, IDS[0]!)).status).toBe(200);
    const seen = await waitFor(async () => (received.find((p) => p.type === 'stamp' && p.data?.kind === 'granted') ? performance.now() - t0 : undefined), 3_000);
    expect(seen).toBeDefined();
    expect(received.find((p) => p.type === 'stamp')?.data?.stamp?.eventId).toBe(IDS[0]);

    expect((await internalEvents(g.subject)).map((e) => e.eventId)).toEqual([IDS[0]]);
    // A repeat claim returns the same stamp and publishes nothing more.
    expect((await claim(g, IDS[0]!)).status).toBe(200);
    expect(await internalEvents(g.subject)).toHaveLength(1);
    expect(received.filter((p) => p.type === 'stamp')).toHaveLength(1);
    expect(await keysOf(g.subject)).toEqual([]);

    expect((await claim(g, IDS[1]!)).status).toBe(200);
    expect((await internalEvents(g.subject))[1]!.newKeys).toEqual([]);
    expect((await claim(g, IDS[2]!)).status).toBe(200);
    const third = (await internalEvents(g.subject))[2]!;
    expect(third).toMatchObject({ eventId: IDS[2], grantKind: 'downtime', season: SEASON });
    expect(third.newKeys).toEqual([`goal:${SEASON}:countries:3`, `goal:${SEASON}:zones:3`, `streak:${SEASON}:3`]);
    expect((await keysOf(g.subject)).map((r) => r.key)).toEqual(third.newKeys);
    // The 4th stamp adds nothing new (no 5-goal yet); keys stay held once.
    expect((await claim(g, IDS[3]!)).status).toBe(200);
    expect((await internalEvents(g.subject))[3]!.newKeys).toEqual([]);
    expect(await keysOf(g.subject)).toHaveLength(3);
  });

  it('a publish fault: the claim is ok, the stamp and the internal event exist, a log line without the subject', { timeout: 60_000 }, async () => {
    const g = await guest();
    const realtime = h.deps.realtime!;
    const real = realtime.publisher;
    realtime.publisher = { publish: async () => Promise.reject(new Error('centrifugo down')) } as typeof real;
    logs.length = 0;
    try {
      const res = await claim(g, IDS[0]!);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    } finally {
      realtime.publisher = real;
    }
    expect((await pool.query('SELECT 1 FROM stamps WHERE subject_id = $1', [g.subject])).rowCount).toBe(1);
    expect(await internalEvents(g.subject)).toHaveLength(1);
    const line = logs.find((l) => l.includes('stamp-publish'));
    expect(line).toBeDefined();
    expect(logs.join('\n')).not.toContain(g.subject);
  });

  it('a season switch: an empty passport, old stamps and achievements stay, the new season counts from zero', { timeout: 60_000 }, async () => {
    const g = await guest();
    for (const id of IDS.slice(0, 3)) expect((await claim(g, id)).status).toBe(200);
    const list = async () => (await (await h.call('/api/me/stamps', { method: 'GET', jar: g.jar, ip: g.ip })).json()) as { value: unknown[] };
    expect((await list()).value).toHaveLength(3);
    const before = await keysOf(g.subject);
    expect(before).toHaveLength(3);

    stored.season = { ...stored.season!, key: SEASON2 };
    presenceOf(h.deps).clear();
    try {
      expect((await list()).value).toEqual([]);
      expect((await pool.query('SELECT 1 FROM stamps WHERE subject_id = $1 AND season = $2', [g.subject, SEASON])).rowCount).toBe(3);
      expect(await keysOf(g.subject)).toEqual(before);
      expect(await presenceOf(h.deps).downtimes.addManual({ eventId: IDS[0]!, reason: 'season 2' }, M + 16_000)).toMatchObject({ ok: true });
      // First stamp of the new season: no goal reached, so no new keys; old keys untouched.
      expect((await claim(g, IDS[0]!)).status).toBe(200);
      expect((await list()).value).toHaveLength(1);
      expect((await internalEvents(g.subject)).at(-1)).toMatchObject({ season: SEASON2, newKeys: [] });
      expect(await keysOf(g.subject)).toEqual(before);
    } finally {
      stored.season = { ...stored.season!, key: SEASON };
      presenceOf(h.deps).clear();
    }
  });
});
