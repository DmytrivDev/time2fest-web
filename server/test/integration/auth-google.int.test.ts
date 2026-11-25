/**
 * SPEC-10 W34 — Google sign-in over the real pipeline and the fake OIDC (`oidc` compose service, 127.0.0.1:8091;
 * never accounts.google.com): AC-20 a verified Google email of an account made by code → the same user, Google
 * linked; AC-21 an unverified Google email of an existing account → no new rows, back with `error=failed`; AC-22 the
 * discovery document unreachable (a closed loopback port — the shared `oidc` container is never stopped, plan
 * follow-up 3) → `sign-in/social` answers `unavailable`; AC-23 a guest signing in with Google → its data moves.
 * Also the wire shape: `{kind:'redirect', url}` to the fake issuer, strict body, the return path guard, cancel.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthWiring } from '../../src/auth/instance';
import { buildDispatcher } from '../../src/container';
import type { AuthLinkHandler } from '../../src/registries/authLinks';
import { buildAuthHarness, CookieJar, makeCall, sessionOf, signIn, writeProbe, type AuthHarness } from '../support/authClient';
import { FAKE_OIDC_ISSUER, fakeGoogleCancel, fakeGoogleLogin, type FakeGoogleUser } from '../support/fakeOidc';
import { testEmail } from '../support/testEmail';
import { ownRedis, testDeps } from './helpers';

const redis = ownRedis();
const started = new Date();
const RUN = randomBytes(4).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;

const owner = new Map<string, string>();
const moving: AuthLinkHandler = {
  key: 'it-google-move',
  async link({ fromSubject, toSubject }) {
    owner.set(fromSubject, toSubject);
  },
};

type Value<T> = { ok: boolean; value: T; error?: { code: string; reason?: string } };

async function start(jar: CookieJar, returnPath: string): Promise<string> {
  const res = await h.call('/api/auth/sign-in/social', { body: { returnPath }, jar });
  expect(res.status).toBe(200);
  const body = (await res.json()) as Value<{ kind: string; url: string }>;
  expect(body.value.kind).toBe('redirect');
  expect(body.value.url.startsWith(`${FAKE_OIDC_ISSUER}/`)).toBe(true);
  return body.value.url;
}

/** The whole Google round trip; answers our callback's `Location`. */
async function google(jar: CookieJar, user: FakeGoogleUser, returnPath = '/countries/ua?x=1#a'): Promise<string> {
  const authorize = await start(jar, returnPath);
  const back = new URL(await fakeGoogleLogin(authorize, user));
  expect(back.pathname).toBe('/api/auth/callback/google');
  const res = await h.call(back.pathname + back.search, { jar });
  expect(res.status).toBe(302);
  return res.headers.get('location') ?? '';
}

const usersByEmail = async (email: string) =>
  (await pool.query('SELECT id, email_verified FROM users WHERE email = $1', [email])).rows as { id: string; email_verified: boolean }[];
const accountsOf = async (userId: string) =>
  ((await pool.query('SELECT provider_id FROM user_accounts WHERE user_id = $1 ORDER BY provider_id', [userId])).rows as { provider_id: string }[]).map(
    (r) => r.provider_id,
  );
const counts = async () =>
  (await pool.query('SELECT (SELECT count(*) FROM users)::int AS u, (SELECT count(*) FROM user_accounts)::int AS a, (SELECT count(*) FROM user_sessions)::int AS s')).rows[0] as {
    u: number;
    a: number;
    s: number;
  };

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:link:');
  await redis.deleteByPrefix('auth:rl:');
  await redis.close();
});

describe('sign-in/social wire', () => {
  it('answers {kind:"redirect", url} to the fake issuer; a body with anything else is invalid-input', async () => {
    await start(new CookieJar(), '/countries/ua');
    const extra = await h.call('/api/auth/sign-in/social', { body: { returnPath: '/', provider: 'google', idToken: { token: 'x' } } });
    expect(extra.status).toBe(400);
    expect(((await extra.json()) as Value<never>).error?.code).toBe('validation');
  });

  it('AC-17: a new account comes back to the return path with signin=google&new=1, hash kept', { timeout: 30_000 }, async () => {
    const loc = await google(new CookieJar(), { sub: `g-${RUN}-new`, email: testEmail('gnew'), emailVerified: true, name: 'G New' });
    expect(loc).toBe('/countries/ua?x=1&signin=google&new=1#a');
  });

  it('AC-18: an unsafe return path comes back to /', { timeout: 30_000 }, async () => {
    const loc = await google(new CookieJar(), { sub: `g-${RUN}-evil`, email: testEmail('gevil'), emailVerified: true }, '//evil.example');
    expect(loc).toBe('/?signin=google&new=1');
  });

  it('AC-19: cancel at Google → error=cancelled on the return path', { timeout: 30_000 }, async () => {
    const jar = new CookieJar();
    const authorize = new URL(await start(jar, '/countries/ua#a'));
    const cancel = new URL(fakeGoogleCancel('http://127.0.0.1:4200', authorize.searchParams.get('state') ?? ''));
    const res = await h.call(cancel.pathname + cancel.search, { jar });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/countries/ua?error=cancelled#a');
  });
});

describe('linking rules ([А12])', () => {
  it('AC-20: verified Google email of a code account → same user, Google linked, no new user', { timeout: 60_000 }, async () => {
    const email = testEmail('glink');
    expect((await signIn(h, redis, new CookieJar(), email)).status).toBe(200);
    const [user] = await usersByEmail(email);
    expect(user).toBeDefined();

    const jar = new CookieJar();
    const loc = await google(jar, { sub: `g-${RUN}-link`, email, emailVerified: true, name: 'Linked' });
    expect(loc).toBe('/countries/ua?x=1&signin=google#a');
    expect((await usersByEmail(email)).map((u) => u.id)).toEqual([user!.id]);
    const accounts = await accountsOf(user!.id);
    expect(accounts.filter((p) => p === 'google')).toHaveLength(1);
    const session = await sessionOf(h, jar);
    expect(session.user?.id).toBe(user!.id);
  });

  it('AC-21: unverified Google email of an existing account → no rows, error=failed', { timeout: 60_000 }, async () => {
    const email = testEmail('gunv');
    expect((await signIn(h, redis, new CookieJar(), email)).status).toBe(200);
    const [user] = await usersByEmail(email);
    const before = await counts();
    const accounts = await accountsOf(user!.id);

    const jar = new CookieJar();
    const loc = await google(jar, { sub: `g-${RUN}-unv`, email, emailVerified: false });
    expect(loc).toBe('/countries/ua?x=1&error=failed#a');
    expect(await counts()).toEqual(before);
    expect(await accountsOf(user!.id)).toEqual(accounts);
    expect(jar.get('__Secure-t2f.session_token')).toBeUndefined();
  });
});

describe('AC-22: discovery down', () => {
  it('sign-in/social answers unavailable', { timeout: 60_000 }, async () => {
    const secret = randomBytes(20).toString('hex');
    // Port 9 (discard) on loopback: nothing listens, the connection is refused at once.
    const deps = testDeps({ redis }, { T2F_EDGE_SECRET: secret, T2F_GOOGLE_DISCOVERY_URL: 'http://127.0.0.1:9/google/.well-known/openid-configuration' });
    deps.auth = createAuthWiring({ env: deps.env, redis, sendOtp: async () => {} });
    const call = makeCall(await buildDispatcher(deps), secret);
    const res = await call('/api/auth/sign-in/social', { body: { returnPath: '/' } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as Value<never>).error?.code).toBe('unavailable');
  });
});

describe('AC-23: guest → Google', () => {
  it('the guest data and device move to the new account, the guest is deleted', { timeout: 60_000 }, async () => {
    h.deps.authLinks = [moving];
    const jar = new CookieJar();
    const probe = await writeProbe(h, { jar });
    expect(probe.status).toBe(200);
    const guest = ((await probe.json()) as Value<{ subject: string }>).value.subject;
    const device = jar.get('__Host-t2f_device');

    const loc = await google(jar, { sub: `g-${RUN}-guest`, email: testEmail('gguest'), emailVerified: true });
    expect(loc).toBe('/countries/ua?x=1&signin=google&new=1#a');
    const account = (await sessionOf(h, jar)).user?.id ?? '';
    expect(account).toMatch(/^[0-9a-f-]{36}$/);
    expect(owner.get(guest)).toBe(account);
    expect((await pool.query('SELECT 1 FROM users WHERE id = $1', [guest])).rowCount).toBe(0);
    expect((await pool.query('SELECT device_id FROM users WHERE id = $1', [account])).rows[0]?.device_id).toBe(device);
  });
});
