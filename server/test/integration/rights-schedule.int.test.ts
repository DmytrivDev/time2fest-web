/**
 * SPEC-11 W25 — "My schedule" through the real pipeline (in-process dispatcher, this slot's Postgres, Redis,
 * Centrifugo): a country → all its events in the zone, regions included (AC-38); the fifth country by toggle and by PUT
 * → `conflict/schedule-full`, list unchanged (AC-39); replace keeps the position; replace ∥ toggle never reaches 5
 * (AC-40); no pass → `forbidden`, a device pass → ok (AC-41); unknown/hidden id and 513 ids → `invalid-input`
 * (AC-42, NFR-4); the `profile` event (AC-35). The catalog is stubbed: zone Z5 has 6 countries (AA has three events,
 * one hidden), zone Z1 has one.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { rightsOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { buildAuthHarness, CookieJar, freshIp, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { ownRedis } from './helpers';
import { api, describeRealtime, name } from './realtime-support';

const redis = ownRedis();
const started = new Date();
let pool: pg.Pool;
let h: AuthHarness;

const COUNTRIES = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF'];
const stored = (): StoredCatalog => ({
  season: null,
  zones: [{ zoneId: 'Z5' }, { zoneId: 'Z1' }],
  countries: COUNTRIES.map((iso) => ({ iso })),
  cities: [...COUNTRIES.map((iso) => ({ cityId: `c-${iso}`, zoneId: 'Z5', countryIso: iso })), { cityId: 'c-ZZ', zoneId: 'Z1', countryIso: 'ZZ' }],
  events: [
    { eventId: 'aa1', zoneId: 'Z5', countryIso: 'AA' },
    { eventId: 'aa2', zoneId: 'Z5', countryIso: 'AA' },
    { eventId: 'aa-hid', zoneId: 'Z5', countryIso: 'AA', hidden: true },
    ...COUNTRIES.slice(1).map((iso) => ({ eventId: `${iso.toLowerCase()}1`, zoneId: 'Z5', countryIso: iso })),
    { eventId: 'zz1', zoneId: 'Z1', countryIso: 'ZZ' },
  ],
  traditions: [],
});

interface Who {
  jar: CookieJar;
  device: string;
  subject: string;
}
const grant = (device: string) =>
  rightsOf(h.deps).passes.grantPass({
    holder: { device, paymentEmail: `sched-${randomBytes(4).toString('hex')}@example.test` },
    source: 'gift',
    grantRef: `sched-${randomBytes(6).toString('hex')}`,
  });
async function guest(pass = true): Promise<Who> {
  const jar = new CookieJar();
  const res = await writeProbe(h, { jar });
  expect(res.status).toBe(200);
  const subject = ((await res.json()) as { value: { subject: string } }).value.subject;
  const device = jar.get(DEVICE_COOKIE) ?? '';
  if (pass) await grant(device);
  return { jar, device, subject };
}
type Out = { ok: boolean; value?: string[]; error?: { code: string; reason?: string } };
const call = async (w: Who, path: string, method: string, body: unknown): Promise<{ status: number; body: Out }> => {
  const res = await h.call(path, { method, body, jar: w.jar, ip: freshIp() });
  return { status: res.status, body: (await res.json()) as Out };
};
const toggle = (w: Who, eventId: string) => call(w, '/api/me/schedule/toggle', 'POST', { eventId });
const put = (w: Who, eventIds: string[]) => call(w, '/api/me/schedule', 'PUT', { eventIds });
const replace = (w: Who, outIso: string, eventId: string) => call(w, '/api/me/schedule/replace', 'POST', { outIso, eventId });
const stash = async (w: Who): Promise<string[]> =>
  (await pool.query('SELECT schedule FROM profiles WHERE subject_id = $1', [w.subject])).rows[0]?.schedule ?? [];

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis as never, (deps: Deps) => {
    deps.catalogStore = { read: async () => stored() };
  });
});

afterAll(async () => {
  await pool.query('DELETE FROM profiles WHERE updated_at >= $1', [started]);
  await pool.query('DELETE FROM passes WHERE issued_at >= $1', [started]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('rl:');
  await redis.close();
});

describe('rights and ids (AC-41, AC-42, NFR-4)', () => {
  it('no pass → forbidden, nothing written; a device pass → ok', async () => {
    const w = await guest(false);
    for (const r of [await toggle(w, 'bb1'), await put(w, ['bb1']), await replace(w, 'AA', 'bb1')]) {
      expect(r.status).toBe(403);
      expect(r.body).toMatchObject({ ok: false, error: { code: 'forbidden' } });
    }
    expect(await stash(w)).toEqual([]);
    await grant(w.device);
    expect((await toggle(w, 'bb1')).body).toEqual({ ok: true, value: ['bb1'] });
  });

  it('unknown and hidden ids, 513 ids and a foreign key → invalid-input', async () => {
    const w = await guest();
    for (const r of [await toggle(w, 'nope'), await toggle(w, 'aa-hid'), await put(w, ['aa1', 'nope']), await put(w, ['aa-hid'])]) {
      expect(r.body).toMatchObject({ ok: false, error: { code: 'validation', reason: 'invalid-input' } });
    }
    const many = await put(w, Array.from({ length: 513 }, (_, i) => `x${i}`));
    expect(many.body).toMatchObject({ ok: false, error: { code: 'validation', reason: 'invalid-input' } });
    expect((await call(w, '/api/me/schedule', 'PUT', { eventIds: [], subject: 'other' })).body).toMatchObject({ error: { reason: 'invalid-input' } });
    expect(await stash(w)).toEqual([]);
  });
});

describe('toggle, full zone, replace (AC-38, AC-39, AC-40)', () => {
  it('country → all its events; fifth country → schedule-full, unchanged; toggle again removes', async () => {
    const w = await guest();
    expect((await toggle(w, 'aa2')).body.value).toEqual(['aa1', 'aa2']);
    for (const id of ['bb1', 'cc1', 'dd1']) expect((await toggle(w, id)).status).toBe(200);
    const full = await toggle(w, 'ee1');
    expect(full.status).toBe(409);
    expect(full.body).toMatchObject({ ok: false, error: { code: 'conflict', reason: 'schedule-full' } });
    expect(await stash(w)).toEqual(['aa1', 'aa2', 'bb1', 'cc1', 'dd1']);
    expect((await toggle(w, 'aa1')).body.value).toEqual(['bb1', 'cc1', 'dd1']);
    expect((await toggle(w, 'zz1')).body.value).toEqual(['bb1', 'cc1', 'dd1', 'zz1']);
  });

  it('PUT with a fifth country in a zone → schedule-full; four are saved as given', async () => {
    const w = await guest();
    const five = await put(w, ['aa1', 'bb1', 'cc1', 'dd1', 'ee1']);
    expect(five.body).toMatchObject({ ok: false, error: { code: 'conflict', reason: 'schedule-full' } });
    expect(await stash(w)).toEqual([]);
    expect((await put(w, ['aa1', 'aa2', 'bb1', 'cc1', 'dd1'])).body.value).toEqual(['aa1', 'aa2', 'bb1', 'cc1', 'dd1']);
  });

  it('replace swaps the country in place, keeping the position; four countries remain', async () => {
    const w = await guest();
    await put(w, ['aa1', 'aa2', 'bb1', 'cc1', 'dd1']);
    const r = await replace(w, 'BB', 'ee1');
    expect(r.body.value).toEqual(['aa1', 'aa2', 'ee1', 'cc1', 'dd1']);
    expect(await stash(w)).toEqual(['aa1', 'aa2', 'ee1', 'cc1', 'dd1']);
    expect((await replace(w, 'FF', 'bb1')).body).toMatchObject({ error: { reason: 'invalid-input' } });
  });

  it('replace and toggle in parallel never leave five countries', { timeout: 60_000 }, async () => {
    for (let i = 0; i < 10; i += 1) {
      const w = await guest();
      await put(w, ['aa1', 'bb1', 'cc1', 'dd1']);
      await Promise.all([toggle(w, 'ee1'), replace(w, 'BB', 'ff1'), toggle(w, 'ff1')]);
      const list = await stash(w);
      const countries = new Set(list.map((id) => id.slice(0, 2).toUpperCase()));
      expect(countries.size).toBeLessThanOrEqual(4);
      expect(list.length).toBe(new Set(list).size);
    }
  });
});

describeRealtime('profile event (AC-35)', () => {
  type Pub = { data?: { type?: string; id?: string } };
  it('a schedule change reaches the subject channel within 3 s', { timeout: 30_000 }, async () => {
    const w = await guest();
    const channel = name('user', w.subject);
    const history = async (): Promise<Pub[]> => {
      const { json } = await api('history', { channel, limit: 100 });
      return ((json.result as { publications?: Pub[] } | undefined)?.publications ?? []) as Pub[];
    };
    const seen = new Set((await history()).map((p) => p.data?.id ?? ''));
    expect((await toggle(w, 'bb1')).status).toBe(200);
    const hit = await waitFor(async () => (await history()).find((x) => x.data?.type === 'profile' && !seen.has(x.data.id ?? '')), 3_000);
    expect(hit).toBeDefined();
  });
});
