/**
 * SPEC-11 W14 — passes through the real pipeline (in-process dispatcher, this slot's Postgres, Redis, Centrifugo):
 * `get-session` pass fields computed only by the server (AC-1) for the FR-ID-14 rows reachable without the sign-in
 * finish step (rows 1, 2, 3, 5, 7, 8; AC-3, AC-4); the holiday on the season clock (AC-13 … AC-15, EC-12);
 * `grantPass` idempotency and `pass-owned` (AC-16); `passOwnedByEmail` (AC-11); events within 3 s (AC-12, AC-17).
 * The service is called directly (the rights doors arrive in P11).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { sessionSchema } from '@time2fest/contracts/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rightsOf, seasonCtxOf } from '../../src/endpoints/deps';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { buildAuthHarness, CookieJar, sessionOf, signIn, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';
import { api, describeRealtime, name } from './realtime-support';

const redis = ownRedis();
const started = new Date();
const tag = `rp-${randomBytes(4).toString('hex')}`;
const EVENT_MS = 3_000;
let pool: pg.Pool;
let h: AuthHarness;
let n = 0;
const ref = () => `${tag}-${(n += 1)}`;

type Wire = ReturnType<typeof sessionSchema.parse>;

async function session(jar: CookieJar, query = ''): Promise<Wire> {
  const res = await h.call(`/api/auth/get-session${query}`, { jar });
  expect(res.status).toBe(200);
  return sessionSchema.parse(((await res.json()) as { value: unknown }).value);
}

/** A guest with a session on a fresh device: jar, device id, guest subject. */
async function guest(): Promise<{ jar: CookieJar; device: string; subject: string }> {
  const jar = new CookieJar();
  const subject = ((await (await writeProbe(h, { jar })).json()) as { value: { subject: string } }).value.subject;
  const device = jar.get(DEVICE_COOKIE) ?? '';
  expect(device).not.toBe('');
  return { jar, device, subject };
}

async function account(label: string): Promise<{ jar: CookieJar; id: string; email: string; device: string }> {
  const jar = new CookieJar();
  const email = testEmail(`${label}-${randomBytes(2).toString('hex')}`);
  expect((await signIn(h, redis, jar, email)).status).toBe(200);
  const id = (await sessionOf(h, jar)).user?.id ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return { jar, id, email, device: jar.get(DEVICE_COOKIE) ?? '' };
}

const passes = () => rightsOf(h.deps).passes;
const END = () => seasonCtxOf(h.deps).currentEndMs;
const setClock = async (at: number) => {
  const res = await h.call('/api/_test/clock', { body: { at, frozen: true } });
  expect(res.status).toBe(200);
};

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis);
  await setClock(Date.parse('2026-12-01T00:00:00Z'));
});

afterAll(async () => {
  await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  await pool.query('DELETE FROM passes WHERE grant_ref LIKE $1', [`${tag}-%`]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.close();
});

describe('session pass fields (FR-ID-14, AC-1, AC-3, AC-4)', () => {
  it('row 1 → row 2: a guest-paid pass on the device; client-sent fields change nothing', { timeout: 30_000 }, async () => {
    const g = await guest();
    const before = await session(g.jar, '?hasPass=true&passOn=account');
    expect(before).toMatchObject({ user: null, hasPass: false, passOn: null, passSince: null, devicePass: null, code: null });
    expect(before.passNight).toBeUndefined();

    const granted = await passes().grantPass({ holder: { device: g.device, paymentEmail: ' Pay@Example.TEST ' }, source: 'purchase', grantRef: ref() });
    expect(granted.kind).toBe('granted');
    const since = granted.kind === 'granted' ? granted.pass.issuedAt : 0;
    expect(await session(g.jar)).toMatchObject({
      user: null,
      hasPass: true,
      passOn: 'device',
      passSince: since,
      passNight: '2026-27',
      devicePass: { email: 'pay@example.test', since },
    });
    // No session cookie at all: the device still carries its pass.
    const bare = new CookieJar().set(DEVICE_COOKIE, g.device);
    expect(await session(bare)).toMatchObject({ hasPass: true, passOn: 'device' });
  });

  it('row 3 → row 5 → row 7: account pass, then a device pass, then sign-out', { timeout: 30_000 }, async () => {
    const a = await account('row7');
    expect(await session(a.jar)).toMatchObject({ hasPass: false, passOn: null, devicePass: null });

    const own = await passes().grantPass({ holder: { account: a.id }, source: 'gift', grantRef: ref() });
    expect(own.kind).toBe('granted');
    expect(await session(a.jar)).toMatchObject({ hasPass: true, passOn: 'account', passNight: '2026-27', devicePass: null });

    await passes().grantPass({ holder: { device: a.device, paymentEmail: testEmail('row7-pay') }, source: 'purchase', grantRef: ref() });
    const row5 = await session(a.jar);
    expect(row5).toMatchObject({ hasPass: true, passOn: 'account' });
    expect(row5.devicePass).not.toBeNull();

    expect((await h.call('/api/auth/sign-out', { body: {}, jar: a.jar })).status).toBe(200);
    const row7 = await session(a.jar);
    expect(row7).toMatchObject({ user: null, hasPass: true, passOn: 'device' });
    expect(row7.devicePass).not.toBeNull();
  });

  it('AC-4: an account without its own pass uses the unattached device pass', { timeout: 30_000 }, async () => {
    const a = await account('ac4');
    await passes().grantPass({ holder: { device: a.device, paymentEmail: testEmail('ac4-pay') }, source: 'purchase', grantRef: ref() });
    expect(await session(a.jar)).toMatchObject({ hasPass: true, passOn: 'device' });
  });
});

describe('holiday of a pass (FR-ID-15, AC-13 … AC-15, EC-12)', () => {
  it('before and during → 2026-27; +1 s after the end → no pass; issued after the end → 2027-28', { timeout: 30_000 }, async () => {
    const g = await guest();
    await setClock(END() - 40 * 86_400_000);
    await passes().grantPass({ holder: { device: g.device, paymentEmail: testEmail('season') }, source: 'purchase', grantRef: ref() });
    expect(await session(g.jar)).toMatchObject({ hasPass: true, passNight: '2026-27' });

    await setClock(Date.parse('2027-01-01T00:00:00Z'));
    expect(await session(g.jar)).toMatchObject({ hasPass: true, passNight: '2026-27' });

    await setClock(END() + 1_000);
    const after = await session(g.jar);
    expect(after).toMatchObject({ hasPass: false, passOn: null, devicePass: null });
    expect(after.passNight).toBeUndefined();

    // EC-12: the expired record stays, the next purchase is a second record for the next holiday, active at once.
    const next = await passes().grantPass({ holder: { device: g.device, paymentEmail: testEmail('season') }, source: 'purchase', grantRef: ref() });
    expect(next.kind === 'granted' && next.pass.season).toBe('2027-28');
    expect(await session(g.jar)).toMatchObject({ hasPass: true, passOn: 'device', passNight: '2027-28' });
    const rows = await pool.query('SELECT season FROM passes WHERE device_id = $1 ORDER BY issued_at', [g.device]);
    expect(rows.rows.map((r: { season: string }) => r.season)).toEqual(['2026-27', '2027-28']);
    await setClock(Date.parse('2026-12-01T00:00:00Z'));
  });
});

describe('grantPass / passOwnedByEmail (AC-11, AC-16)', () => {
  it('the same grantRef twice → one record, the same pass', async () => {
    const g = await guest();
    const r = ref();
    const one = await passes().grantPass({ holder: { device: g.device, paymentEmail: testEmail('dup') }, source: 'purchase', grantRef: r });
    const two = await passes().grantPass({ holder: { device: g.device, paymentEmail: testEmail('dup') }, source: 'purchase', grantRef: r });
    expect(one).toMatchObject({ kind: 'granted', created: true });
    expect(two).toMatchObject({ kind: 'granted', created: false });
    expect(one.kind === 'granted' && two.kind === 'granted' && one.pass.id === two.pass.id).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS c FROM passes WHERE grant_ref = $1', [r])).rows[0].c).toBe(1);
  });

  it('pass-owned: account with a pass; device with a pass; payment email that already owns a pass', { timeout: 30_000 }, async () => {
    const a = await account('owned');
    expect((await passes().grantPass({ holder: { account: a.id }, source: 'gift', grantRef: ref() })).kind).toBe('granted');
    expect(await passes().grantPass({ holder: { account: a.id }, source: 'gift', grantRef: ref() })).toEqual({ kind: 'pass-owned' });

    const g = await guest();
    expect((await passes().grantPass({ holder: { device: g.device, paymentEmail: testEmail('owned-1') }, source: 'purchase', grantRef: ref() })).kind).toBe('granted');
    expect(await passes().grantPass({ holder: { device: g.device, paymentEmail: testEmail('owned-2') }, source: 'purchase', grantRef: ref() })).toEqual({ kind: 'pass-owned' });

    const other = await guest();
    expect(await passes().grantPass({ holder: { device: other.device, paymentEmail: a.email }, source: 'purchase', grantRef: ref() })).toEqual({ kind: 'pass-owned' });
  });

  it('passOwnedByEmail: account pass → true, unattached pass → true, none → false', { timeout: 30_000 }, async () => {
    const a = await account('owns');
    await passes().grantPass({ holder: { account: a.id }, source: 'admin', grantRef: ref() });
    expect(await passes().passOwnedByEmail(a.email.toUpperCase())).toBe(true);

    const g = await guest();
    const pay = testEmail('owns-pay');
    await passes().grantPass({ holder: { device: g.device, paymentEmail: pay }, source: 'purchase', grantRef: ref() });
    expect(await passes().passOwnedByEmail(pay)).toBe(true);

    expect(await passes().passOwnedByEmail(testEmail('owns-none'))).toBe(false);
  });
});

type Pub = { data?: { type?: string; id?: string; data?: { reason?: string } } };
async function history(channel: string): Promise<Pub[]> {
  const { json } = await api('history', { channel, limit: 50 });
  return ((json.result as { publications?: Pub[] } | undefined)?.publications ?? []) as Pub[];
}
const idsOf = async (channel: string) => new Set((await history(channel)).map((p) => p.data?.id ?? ''));
async function newEvent(channel: string, reason: string, known: Set<string>, t0: number): Promise<number | undefined> {
  return waitFor(async () => {
    const hit = (await history(channel)).find((p) => p.data?.type === 'session' && p.data.data?.reason === reason && !known.has(p.data.id ?? ''));
    return hit ? performance.now() - t0 : undefined;
  }, EVENT_MS + 1_000);
}

describeRealtime('pass events (AC-12, AC-17)', () => {
  it('granted → attached by email elsewhere (old device notified, row 8) → revoked, each within 3 s', { timeout: 60_000 }, async () => {
    const a = await account('events');
    const accountChannel = name('user', a.id);

    // A guest-paid pass on device A with the account's email; attached by path (b) on the account's device.
    const g = await guest();
    const guestChannel = name('user', g.subject);
    let known = await idsOf(guestChannel);
    let t0 = performance.now();
    const r = ref();
    await passes().grantPass({ holder: { device: g.device, paymentEmail: a.email }, source: 'purchase', grantRef: r });
    const granted = await newEvent(guestChannel, 'pass-granted', known, t0);
    expect(granted).toBeDefined();
    expect(granted!).toBeLessThanOrEqual(EVENT_MS);

    known = await idsOf(guestChannel);
    const knownAccount = await idsOf(accountChannel);
    t0 = performance.now();
    const attached = await passes().attachOnSignIn({ account: a.id, device: a.device, email: a.email });
    expect(attached).toMatchObject({ from: 'email', previousDevice: g.device });
    expect(attached.attached).not.toBeNull();
    const onAccount = await newEvent(accountChannel, 'pass-attached', knownAccount, t0);
    const onOldDevice = await newEvent(guestChannel, 'pass-attached', known, t0);
    expect(onAccount).toBeDefined();
    expect(onOldDevice).toBeDefined();
    expect(Math.max(onAccount!, onOldDevice!)).toBeLessThanOrEqual(EVENT_MS);
    expect(await session(g.jar)).toMatchObject({ hasPass: false, passOn: null, devicePass: null });
    expect(await session(a.jar)).toMatchObject({ hasPass: true, passOn: 'account', devicePass: null });

    const k = await idsOf(accountChannel);
    t0 = performance.now();
    expect(await passes().revokePass(r)).toMatchObject({ revoked: true });
    const revoked = await newEvent(accountChannel, 'pass-revoked', k, t0);
    expect(revoked).toBeDefined();
    expect(revoked!).toBeLessThanOrEqual(EVENT_MS);
    expect(await session(a.jar)).toMatchObject({ hasPass: false, passOn: null });
    expect(await passes().revokePass(r)).toMatchObject({ revoked: false });
  });
});
