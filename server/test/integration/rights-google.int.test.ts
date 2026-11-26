/**
 * SPEC-11 W33 — Google link and unlink from the cabinet over the real pipeline and the fake OIDC (`oidc` compose
 * service, 127.0.0.1:8091; never accounts.google.com, NFR-6): link with a different Google email → `googleLinked:true`,
 * back on the return path, `profile` published (AC-46, [Q1]); a Google id of another account → `error=google-taken`;
 * two parallel links of one Google id by two accounts → one `user_accounts` row, the other `google-taken` (AC-47);
 * sign-in with an unlinked Google of another email links nothing to an existing account (W32 risk); code + Google →
 * unlink ok; Google only, email unverified → `conflict/last-method` (AC-48).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../../src/endpoints/types';
import { buildAuthHarness, CookieJar, freshIp, sessionOf, signIn, type AuthHarness } from '../support/authClient';
import { FAKE_OIDC_ISSUER, fakeGoogleLogin, type FakeGoogleUser } from '../support/fakeOidc';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
const RUN = randomBytes(4).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;
const published: { key: string; type: string }[] = [];
const issuerHosts = new Set<string>();
const warnings: Record<string, unknown>[] = [];

type Body = { ok: boolean; value?: Record<string, unknown> & { kind?: string; url?: string; googleLinked?: boolean }; error?: { code: string; reason?: string } };
interface Account {
  jar: CookieJar;
  email: string;
  id: string;
}

async function account(label: string): Promise<Account> {
  const jar = new CookieJar();
  const email = testEmail(`rg-${label}`);
  expect((await signIn(h, redis, jar, email)).status).toBe(200);
  const id = (await sessionOf(h, jar)).user?.id ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return { jar, email, id };
}

async function call(jar: CookieJar, path: string, method: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const res = await h.call(path, { method, ...(body !== undefined ? { body } : {}), jar, ip: freshIp() });
  return { status: res.status, body: (await res.json()) as Body };
}

/** `POST /api/me/google` → the fake issuer's authorize URL. */
async function startLink(jar: CookieJar, returnPath = '/account?tab=me#google'): Promise<string> {
  const r = await call(jar, '/api/me/google', 'POST', { returnPath });
  expect(r.status).toBe(200);
  expect(r.body.value?.kind).toBe('redirect');
  const url = String(r.body.value?.url);
  expect(url.startsWith(`${FAKE_OIDC_ISSUER}/`)).toBe(true);
  issuerHosts.add(new URL(url).host);
  return url;
}

/** Our callback (path + query) after logging in at the fake issuer. */
async function atGoogle(authorize: string, user: FakeGoogleUser): Promise<string> {
  const back = new URL(await fakeGoogleLogin(authorize, user));
  expect(back.pathname).toBe('/api/auth/callback/google');
  return back.pathname + back.search;
}

/** `Set-Cookie` names of each callback answer, by its location (S11-13). */
const callbackCookies = new Map<string, string[]>();

async function callback(jar: CookieJar, path: string): Promise<string> {
  const res = await h.call(path, { jar });
  expect(res.status).toBe(302);
  const location = res.headers.get('location') ?? '';
  callbackCookies.set(location, res.headers.getSetCookie().map((l) => l.split('=')[0] ?? ''));
  return location;
}

const link = async (a: Account, user: FakeGoogleUser, returnPath?: string) => callback(a.jar, await atGoogle(await startLink(a.jar, returnPath), user));

const googleRows = async (sub: string) =>
  ((await pool.query(`SELECT user_id::text AS u FROM user_accounts WHERE provider_id = 'google' AND account_id = $1`, [sub])).rows as { u: string }[]).map((r) => r.u);
const profile = async (a: Account) => (await call(a.jar, '/api/me/profile', 'GET')).body.value;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis, (deps: Deps) => {
    deps.authLinks = [];
    const log = deps.log;
    deps.log = { ...log, warn: (fields: Record<string, unknown>) => { warnings.push(fields); log.warn(fields); } };
    const base = deps.realtime;
    deps.realtime = {
      ...(base ?? { random: {} as never, prefix: '' }),
      publisher: {
        ...(base?.publisher ?? {}),
        publish: async (_cls: string, key: string, envelope: { type: string }) => {
          published.push({ key, type: envelope.type });
          return { status: 'ok' };
        },
      } as never,
      invalidator: { invalidate: async () => 'ok' as const },
    };
  });
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.deleteByPrefix('auth:glink:');
  await redis.deleteByPrefix('rl:');
  await redis.close();
});

describe('link (AC-46, AC-47, [Q1])', () => {
  it('a Google with another email links to the code account; back on the return path; googleLinked; profile event', { timeout: 60_000 }, async () => {
    const a = await account('diff');
    const sub = `rg-${RUN}-diff`;
    const mark = published.length;
    const loc = await link(a, { sub, email: testEmail('rg-other-gmail'), emailVerified: true, name: 'Other' });
    expect(loc).toBe('/account?tab=me#google');
    expect(await googleRows(sub)).toEqual([a.id]);
    expect((await profile(a))?.googleLinked).toBe(true);
    expect(published.slice(mark)).toContainEqual({ key: a.id, type: 'profile' });
    // The account's email is not changed by the link.
    expect(((await pool.query('SELECT email FROM users WHERE id = $1', [a.id])).rows[0] as { email: string }).email).toBe(a.email);
    // Signing in with that Google leads to the same account.
    const jar = new CookieJar();
    const res = await h.call('/api/auth/sign-in/social', { body: { returnPath: '/' }, jar });
    const url = ((await res.json()) as Body).value?.url as string;
    await callback(jar, await atGoogle(url, { sub, email: testEmail('rg-other-gmail2'), emailVerified: true }));
    expect((await sessionOf(h, jar)).user?.id).toBe(a.id);
  });

  it('a Google id of another account → error=google-taken, nothing linked', { timeout: 60_000 }, async () => {
    const owner = await account('owner');
    const sub = `rg-${RUN}-taken`;
    expect(await link(owner, { sub, email: testEmail('rg-taken-g'), emailVerified: true })).toBe('/account?tab=me#google');
    const b = await account('taker');
    expect(await link(b, { sub, email: testEmail('rg-taken-g'), emailVerified: true }, '/account')).toBe('/account?error=google-taken');
    expect(await googleRows(sub)).toEqual([owner.id]);
    expect((await profile(b))?.googleLinked).toBe(false);
  });

  it('AC-47: two parallel links of one Google id by two accounts → one row; the other google-taken', { timeout: 90_000 }, async () => {
    const a = await account('par-a');
    const b = await account('par-b');
    const sub = `rg-${RUN}-par`;
    const user = { sub, email: testEmail('rg-par-g'), emailVerified: true };
    const [ca, cb] = [await atGoogle(await startLink(a.jar, '/account'), user), await atGoogle(await startLink(b.jar, '/account'), user)];
    // Both callbacks pass Better Auth's "already linked?" read before either inserts: the insert of this Google id waits
    // 1 s, so the loser meets the unique index (not Better Auth's own check).
    const fn = `rg_slow_${RUN}`;
    await pool.query(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.account_id = '${sub}' THEN PERFORM pg_sleep(1); END IF; RETURN NEW; END $$`,
    );
    await pool.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON user_accounts FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
    let locs: string[] = [];
    try {
      locs = await Promise.all([callback(a.jar, ca), callback(b.jar, cb)]);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON user_accounts`);
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    const rows = await googleRows(sub);
    expect(rows).toHaveLength(1);
    expect([...locs].sort()).toEqual(['/account', '/account?error=google-taken']);
    const winner = rows[0] === a.id ? 0 : 1;
    expect(locs[winner]).toBe('/account');
    // The loser met the unique index (Better Auth's insert threw), not Better Auth's own check.
    expect(warnings).toContainEqual({ event: 'google-link', outcome: 'taken' });
    // S11-13: the loser's own redirect clears the OAuth state cookie, as the winner's does.
    const stateCookie = callbackCookies.get('/account')?.find((n) => n.endsWith('.state'));
    expect(stateCookie).toBeDefined();
    expect(callbackCookies.get('/account?error=google-taken')).toContain(stateCookie);
  });

  it('sign-in with an unlinked Google of another email links nothing to an existing account', { timeout: 60_000 }, async () => {
    const a = await account('nolink');
    const jar = new CookieJar();
    const res = await h.call('/api/auth/sign-in/social', { body: { returnPath: '/' }, jar });
    const url = ((await res.json()) as Body).value?.url as string;
    const sub = `rg-${RUN}-nolink`;
    await callback(jar, await atGoogle(url, { sub, email: testEmail('rg-nolink-g'), emailVerified: true }));
    const rows = await googleRows(sub);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toBe(a.id);
    expect((await profile(a))?.googleLinked).toBe(false);
  });
});

describe('unlink (AC-48)', () => {
  it('code + Google → unlinked, googleLinked false, profile event', { timeout: 60_000 }, async () => {
    const a = await account('unlink');
    const sub = `rg-${RUN}-unlink`;
    await link(a, { sub, email: testEmail('rg-unlink-g'), emailVerified: true });
    const mark = published.length;
    const r = await call(a.jar, '/api/me/google', 'DELETE');
    expect(r.status).toBe(200);
    expect(r.body.value?.googleLinked).toBe(false);
    expect(await googleRows(sub)).toEqual([]);
    expect(published.slice(mark)).toContainEqual({ key: a.id, type: 'profile' });
  });

  it('Google only, email not verified → conflict/last-method, row kept', { timeout: 60_000 }, async () => {
    const jar = new CookieJar();
    const res = await h.call('/api/auth/sign-in/social', { body: { returnPath: '/' }, jar });
    const url = ((await res.json()) as Body).value?.url as string;
    const sub = `rg-${RUN}-only`;
    await callback(jar, await atGoogle(url, { sub, email: testEmail('rg-only-g'), emailVerified: false }));
    const id = (await sessionOf(h, jar)).user?.id;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const r = await call(jar, '/api/me/google', 'DELETE');
    expect(r.body.error).toEqual({ code: 'conflict', reason: 'last-method' });
    expect(await googleRows(sub)).toEqual([id]);
  });
});

describe('NFR-6', () => {
  it('every authorize URL went to the fake OIDC only', () => {
    expect([...issuerHosts]).toEqual(['127.0.0.1:8091']);
  });
});
