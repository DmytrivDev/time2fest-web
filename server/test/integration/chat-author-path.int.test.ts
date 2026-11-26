/**
 * SPEC-14 W37 - the author path of the chat card: `GET /api/chat/authors/:authorId/path` (AC-49 .. AC-54).
 * Wire schema; the four cases (pass + showPath, pass + showPath off, no pass, own); 2 stamps + 3 scheduled (1 past) ->
 * 4 points, 2 planned (AC-51); unknown / malformed id -> `not_found`; `authorIdOf` stable and not the subject id
 * (AC-52); a guest author with a device pass is visible (EC-14); a banned author -> hidden (AC-53); the 61st request of a
 * device -> `rate_limited` (AC-54); private no-store headers.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { authorPathResponse } from '@time2fest/contracts/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { authorIdsOf, presenceOf, rightsOf } from '../../src/endpoints/deps';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { buildAuthHarness, CookieJar, freshIp, sessionOf, signIn, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14p-${run}`;
const M = Date.parse('2026-12-31T21:00:00Z');
const ev = (n: string) => `${n}-${run}`;
const S1 = ev('s1');
const S2 = ev('s2');
const PAST = ev('past');
const F1 = ev('f1');
const F2 = ev('f2');
const IDS = [S1, S2, PAST, F1, F2];
const MOMENTS = [M, M, M - 3_600_000, M + 3_600_000, M + 7_200_000];
const ISO = ['AA', 'BB', 'CC', 'DD', 'EE'];
const NOW = M + 16_000;
const started = new Date();

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2026-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: IDS.map((_, i) => ({ zoneId: `zp${i}`, order: i + 1, midnightUtc: new Date(MOMENTS[i]!).toISOString() })),
  countries: ISO.map((iso) => ({ iso, illustrationId: `ill-${iso}` })),
  cities: IDS.map((_, i) => ({ cityId: `cp${i}`, countryIso: ISO[i]!, zoneId: `zp${i}`, name: { uk: `City ${i}` } })),
  events: IDS.map((eventId, i) => ({ eventId, countryIso: ISO[i]!, cityId: `cp${i}`, zoneId: `zp${i}`, midnightUtc: new Date(MOMENTS[i]!).toISOString(), slot: 'midnight' })),
  traditions: [],
};
const live = IDS.map((eventId, i) => ({ eventId, zoneId: `zp${i}`, moment: MOMENTS[i]!, nonMidnight: false, hidden: false }));

let pool: pg.Pool;
let h: AuthHarness;
let n = 0;
const ref = () => `${run}-${(n += 1)}`;
const made: string[] = [];

interface Person {
  jar: CookieJar;
  ip: string;
  subject: string;
}

const setClock = async (at: number) => expect((await h.call('/api/_test/clock', { body: { at, frozen: true } })).status).toBe(200);

async function guest(): Promise<Person & { device: string }> {
  const jar = new CookieJar();
  const ip = freshIp();
  const res = await writeProbe(h, { jar, ip });
  expect(res.status).toBe(200);
  const subject = ((await res.json()) as { value: { subject: string } }).value.subject;
  made.push(subject);
  return { jar, ip, subject, device: jar.get(DEVICE_COOKIE) ?? '' };
}

async function account(label: string): Promise<Person> {
  const jar = new CookieJar();
  const ip = freshIp();
  expect((await signIn(h, redis, jar, testEmail(`${label}-${randomBytes(2).toString('hex')}`))).status).toBe(200);
  const subject = (await sessionOf(h, jar)).user?.id ?? '';
  expect(subject).toMatch(/^[0-9a-f-]{36}$/);
  made.push(subject);
  return { jar, ip, subject };
}

const setProfile = async (subject: string, settings: Record<string, unknown>, schedule: string[]) =>
  pool.query(
    `INSERT INTO profiles (subject_id, settings, schedule, updated_at) VALUES ($1, $2::jsonb, $3::text[], now())
     ON CONFLICT (subject_id) DO UPDATE SET settings = EXCLUDED.settings, schedule = EXCLUDED.schedule`,
    [subject, JSON.stringify(settings), schedule],
  );

const claim = async (p: Person, eventId: string) => expect((await h.call('/api/me/stamps', { body: { eventId, source: 'tv', at: M }, jar: p.jar, ip: p.ip })).status).toBe(200);

async function pathOf(viewer: { jar: CookieJar; ip?: string }, authorId: string) {
  const res = await h.call(`/api/chat/authors/${authorId}/path`, { jar: viewer.jar, ...(viewer.ip !== undefined ? { ip: viewer.ip } : {}) });
  return { res, body: (await res.json()) as { ok: boolean; value?: unknown; error?: { code: string } } };
}

/** An author with 2 stamps, 3 scheduled events (1 past) and the given pass / settings. */
async function author(label: string, opts: { pass: boolean; showPath?: boolean }): Promise<Person> {
  const a = await account(label);
  if (opts.pass) await rightsOf(h.deps).passes.grantPass({ holder: { account: a.subject }, source: 'gift', grantRef: ref() });
  await claim(a, S1);
  await claim(a, S2);
  await setProfile(a.subject, { showPath: opts.showPath ?? true }, [PAST, F1, F2]);
  return a;
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 4 });
  h = await buildAuthHarness(redis, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => live } };
  });
  presenceOf(h.deps).clear();
  await setClock(NOW);
  for (const eventId of [S1, S2]) expect(await presenceOf(h.deps).downtimes.addManual({ eventId, reason: 'author path test' }, M)).toMatchObject({ ok: true });
}, 60_000);

afterAll(async () => {
  await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  for (const t of ['stamps', 'stamp_old_moment_log', 'presence_proofs', 'presence_event_moments', 'presence_window_health', 'presence_downtimes', 'passport_achievements'])
    await pool.query(`DELETE FROM ${t} WHERE season = $1`, [SEASON]).catch(() => undefined);
  await pool.query('DELETE FROM passes WHERE grant_ref LIKE $1', [`${run}-%`]);
  await pool.query('DELETE FROM author_ids WHERE subject_id = ANY($1::text[])', [made]);
  await pool.query('DELETE FROM profiles WHERE subject_id = ANY($1::text[])', [made]);
  await pool.query('DELETE FROM bans WHERE subject_id = ANY($1::text[])', [made]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.close();
});

describe('author path (AC-49 .. AC-54)', () => {
  it('AC-52: the author id is stable, opaque and never the subject id; an unknown or malformed id is not_found', { timeout: 60_000 }, async () => {
    const a = await guest();
    const ids = authorIdsOf(h.deps);
    const id = await ids.authorIdOf(a.subject, NOW);
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(id).not.toBe(a.subject);
    expect(id).not.toContain(a.subject);
    expect(await ids.authorIdOf(a.subject, NOW + 1_000)).toBe(id);
    expect(await ids.subjectOfAuthor(id)).toBe(a.subject);
    expect(await ids.subjectOfAuthor('not-an-id')).toBeNull();
    const viewer = await guest();
    for (const bad of [randomBytes(16).toString('base64url'), 'short', a.subject]) {
      const { res, body } = await pathOf(viewer, bad);
      expect(res.status).toBe(404);
      expect(body.error?.code).toBe('not_found');
    }
  });

  it('AC-49 / AC-50 / AC-51: pass + showPath -> 2 stamps + 2 planned of 3 scheduled (1 past); headers private no-store', { timeout: 90_000 }, async () => {
    const a = await author('shown', { pass: true });
    const viewer = await guest();
    const id = await authorIdsOf(h.deps).authorIdOf(a.subject, NOW);
    const { res, body } = await pathOf(viewer, id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const value = authorPathResponse.parse(body.value);
    expect(value).toEqual({
      hidden: false,
      points: [
        { eventId: S1, planned: false },
        { eventId: S2, planned: false },
        { eventId: F1, planned: true },
        { eventId: F2, planned: true },
      ].sort((x, y) => Number(x.planned) - Number(y.planned)),
    });
    expect(value.points).toHaveLength(4);
    expect(value.points.filter((p) => p.planned)).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain(a.subject);
  });

  it('AC-50: pass + showPath off -> hidden; no pass -> empty and not hidden; a lost pass shows nothing (EC-15)', { timeout: 90_000 }, async () => {
    const viewer = await guest();
    const off = await author('off', { pass: true, showPath: false });
    expect((await pathOf(viewer, await authorIdsOf(h.deps).authorIdOf(off.subject, NOW))).body.value).toEqual({ points: [], hidden: true });
    const none = await author('nopass', { pass: false });
    expect((await pathOf(viewer, await authorIdsOf(h.deps).authorIdOf(none.subject, NOW))).body.value).toEqual({ points: [], hidden: false });
    const lost = await author('lost', { pass: true, showPath: false });
    await rightsOf(h.deps).passes.revokePass(`${run}-${n}`);
    expect((await pathOf(viewer, await authorIdsOf(h.deps).authorIdOf(lost.subject, NOW))).body.value).toEqual({ points: [], hidden: false });
  });

  it('AC-50: the viewer-author sees the own path always, without a pass and with showPath off', { timeout: 90_000 }, async () => {
    const a = await author('own', { pass: false, showPath: false });
    const id = await authorIdsOf(h.deps).authorIdOf(a.subject, NOW);
    const value = authorPathResponse.parse((await pathOf(a, id)).body.value);
    expect(value.hidden).toBe(false);
    expect(value.points.map((p) => p.eventId)).toEqual([S1, S2, F1, F2]);
  });

  it('EC-14: a guest author whose device holds a pass is visible; AC-53: a banned author -> hidden', { timeout: 90_000 }, async () => {
    const g = await guest();
    await rightsOf(h.deps).passes.grantPass({ holder: { device: g.device, paymentEmail: 'pay@example.test' }, source: 'purchase', grantRef: ref() });
    await claim(g, S1);
    await setProfile(g.subject, {}, [F1]);
    const viewer = await guest();
    const id = await authorIdsOf(h.deps).authorIdOf(g.subject, NOW);
    expect((await pathOf(viewer, id)).body.value).toEqual({
      hidden: false,
      points: [
        { eventId: S1, planned: false },
        { eventId: F1, planned: true },
      ],
    });
    await rightsOf(h.deps).bans.ban({ kind: 'guest', subject: g.subject, by: 'author-path test' });
    expect((await pathOf(viewer, id)).body.value).toEqual({ points: [], hidden: true });
  });

  it('AC-54: the 61st request of a device within 60 s -> rate_limited', { timeout: 90_000 }, async () => {
    const a = await author('rate', { pass: true });
    const id = await authorIdsOf(h.deps).authorIdOf(a.subject, NOW);
    const viewer = { jar: new CookieJar(), ip: freshIp() };
    for (let i = 0; i < 60; i += 1) expect((await pathOf(viewer, id)).res.status).toBe(200);
    const last = await pathOf(viewer, id);
    expect(last.res.status).toBe(429);
    expect(last.body.error?.code).toBe('rate_limited');
  });
});
