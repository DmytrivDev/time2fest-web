/**
 * SPEC-11 W28 — the sign-in finish step without a guest (W27, [П-4], DR-3) through the real pipeline: the merge rows are
 * switched off (`Deps.authLinks = []`), so every attach seen here is the forwarder's.
 * Row 4 (path (a)) after sign-out by code and by Google; path (b) by the verified email on another device (EC-1) with a
 * `session` `pass-attached` to the old device's subjects within 3 s (AC-12); both paths → the device pass only (AC-7);
 * row 5 — the account has its own pass (AC-8); row 6 — after sign-out the device shows no pass (AC-9).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { sessionSchema } from '@time2fest/contracts/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rightsOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { buildAuthHarness, CookieJar, sessionOf, signIn, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { fakeGoogleLogin } from '../support/fakeOidc';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
const tag = randomBytes(4).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;
let n = 0;
const ref = () => `rs-${tag}-${(n += 1)}`;
const published: { key: string; type: string; reason?: string; at: number }[] = [];

type Wire = ReturnType<typeof sessionSchema.parse>;
async function session(jar: CookieJar): Promise<Wire> {
  const res = await h.call('/api/auth/get-session', { jar });
  expect(res.status).toBe(200);
  return sessionSchema.parse(((await res.json()) as { value: unknown }).value);
}
const passes = () => rightsOf(h.deps).passes;
const devicePass = async (device: string, paymentEmail = `rs-${tag}-${randomBytes(2).toString('hex')}@example.test`) => {
  const grantRef = ref();
  expect((await passes().grantPass({ holder: { device, paymentEmail }, source: 'gift', grantRef })).kind).toBe('granted');
  return grantRef;
};
const attachedTo = async (grantRef: string) =>
  ((await pool.query('SELECT attached_user_id::text AS a FROM passes WHERE grant_ref = $1', [grantRef])).rows[0] as { a: string | null }).a;

/** An account signed in by code on a fresh jar, then signed out: the jar keeps only its device. */
async function signedOut(label: string): Promise<{ jar: CookieJar; email: string; id: string; device: string }> {
  const jar = new CookieJar();
  const email = testEmail(`rs-${label}-${tag}`);
  expect((await signIn(h, redis, jar, email)).status).toBe(200);
  const id = (await sessionOf(h, jar)).user?.id ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect((await h.call('/api/auth/sign-out', { body: {}, jar })).status).toBe(200);
  return { jar, email, id, device: jar.get(DEVICE_COOKIE) ?? '' };
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis, (deps: Deps) => {
    deps.authLinks = [];
    const base = deps.realtime;
    deps.realtime = {
      ...(base ?? { random: {} as never, prefix: '' }),
      publisher: {
        ...(base?.publisher ?? {}),
        publish: async (_cls: string, key: string, envelope: { type: string; data?: { reason?: string } }) => {
          published.push({ key, type: envelope.type, reason: envelope.data?.reason, at: Date.now() });
          return { status: 'ok' };
        },
      } as never,
      invalidator: { invalidate: async () => 'ok' as const },
    };
  });
});

afterAll(async () => {
  await pool.query('DELETE FROM passes WHERE grant_ref LIKE $1', [`rs-${tag}-%`]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.close();
});

describe('sign-in finish step without a guest (W27)', () => {
  it('row 4 / DR-3: code sign-in after sign-out on a device with a pass → attached, passOn account; row 6 after sign-out', { timeout: 60_000 }, async () => {
    const a = await signedOut('row4');
    const grantRef = await devicePass(a.device);
    expect((await signIn(h, redis, a.jar, a.email)).status).toBe(200);
    expect(await attachedTo(grantRef)).toBe(a.id);
    const s = await session(a.jar);
    expect(s).toMatchObject({ hasPass: true, passOn: 'account', devicePass: null });
    // Row 6 (AC-9): the pass left the device with the account.
    expect((await h.call('/api/auth/sign-out', { body: {}, jar: a.jar })).status).toBe(200);
    expect((await session(a.jar)).hasPass).toBe(false);
  });

  it('row 4 by Google: the callback attaches the device pass', { timeout: 60_000 }, async () => {
    const jar = new CookieJar();
    // The device cookie first (no session, no guest), then the pass on it.
    await h.call('/api/auth/get-session', { jar });
    let device = jar.get(DEVICE_COOKIE) ?? '';
    if (device === '') {
      await writeProbe(h, { jar });
      device = jar.get(DEVICE_COOKIE) ?? '';
      expect((await h.call('/api/auth/sign-out', { body: {}, jar })).status).toBe(200);
    }
    const grantRef = await devicePass(device);
    const res = await h.call('/api/auth/sign-in/social', { body: { returnPath: '/' }, jar });
    expect(res.status).toBe(200);
    const url = ((await res.json()) as { value: { url: string } }).value.url;
    const back = new URL(await fakeGoogleLogin(url, { sub: `rs-${tag}-g`, email: testEmail(`rs-g-${tag}`), emailVerified: true }));
    expect((await h.call(back.pathname + back.search, { jar })).status).toBe(302);
    const id = (await sessionOf(h, jar)).user?.id ?? '';
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await attachedTo(grantRef)).toBe(id);
  });

  it('path (b) / EC-1: the verified email on another device attaches; the old device subjects get pass-attached ≤3 s (AC-12)', { timeout: 60_000 }, async () => {
    const a = await signedOut('pathb');
    // Device A: a guest with a session, its pass paid with the account's email.
    const guestJar = new CookieJar();
    const guest = ((await (await writeProbe(h, { jar: guestJar })).json()) as { value: { subject: string } }).value.subject;
    const grantRef = await devicePass(guestJar.get(DEVICE_COOKIE) ?? '', a.email);
    const t0 = Date.now();
    // Device B: a new jar (the cookie of A is lost).
    expect((await signIn(h, redis, new CookieJar(), a.email)).status).toBe(200);
    expect(await attachedTo(grantRef)).toBe(a.id);
    const hit = await waitFor(async () => published.find((p) => p.key === guest && p.reason === 'pass-attached' && p.at >= t0), 3_000);
    expect(hit).toBeDefined();
  });

  it('AC-7: both paths possible → only the device pass is attached', { timeout: 60_000 }, async () => {
    const a = await signedOut('both');
    const byEmail = await devicePass(`${randomBytes(8).toString('hex')}`, a.email);
    const onDevice = await devicePass(a.device);
    expect((await signIn(h, redis, a.jar, a.email)).status).toBe(200);
    expect(await attachedTo(onDevice)).toBe(a.id);
    expect(await attachedTo(byEmail)).toBeNull();
  });

  it('row 5 / AC-8: an account with its own pass → the device pass stays', { timeout: 60_000 }, async () => {
    const a = await signedOut('row5');
    expect((await passes().grantPass({ holder: { account: a.id }, source: 'gift', grantRef: ref() })).kind).toBe('granted');
    const onDevice = await devicePass(a.device);
    expect((await signIn(h, redis, a.jar, a.email)).status).toBe(200);
    expect(await attachedTo(onDevice)).toBeNull();
    const s = await session(a.jar);
    expect(s.passOn).toBe('account');
    expect(s.devicePass).not.toBeNull();
  });
});
