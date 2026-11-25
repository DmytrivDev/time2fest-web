/**
 * SPEC-10 W42 — the `auth` subject-data handler over the real pipeline, Postgres and the fake OIDC:
 * AC-49 export of an account made by code and linked to Google → email, Google name, methods (provider ids only),
 * sessions (created, expires, device id) and device ids — no token anywhere; AC-50 erase → no user, accounts,
 * sessions or pending code of the address; EC-10 another handler failing does not stop the `auth` erase; a
 * subscriber on `user:#<id>` receives `session` `erased` (skips when Centrifugo is unreachable).
 */
import { randomBytes } from 'node:crypto';
import type { Centrifuge, PublicationContext } from 'centrifuge';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSubjectDataInScope, type AuthSubjectExport } from '../../src/auth/subjectData';
import type { SubjectDataHandler } from '../../src/platform/subjectData';
import { subjectDataRegistry } from '../../src/registries/subjectData';
import { buildAuthHarness, CookieJar, freshIp, sessionOf, signIn, waitFor, type AuthHarness } from '../support/authClient';
import { fakeGoogleLogin } from '../support/fakeOidc';
import { testEmail } from '../support/testEmail';
import { emailKey } from '../../src/domain/auth/email';
import { ownRedis } from './helpers';
import { api, centrifugeClient, connectAndWait, describeRealtime, name } from './realtime-support';

const redis = ownRedis();
const started = new Date();
const RUN = randomBytes(4).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;
const clients: Centrifuge[] = [];

const failing: SubjectDataHandler = {
  capability: 'zz-failing',
  export: async () => Promise.reject(new Error('down')),
  erase: async () => Promise.reject(new Error('down')),
  anonymise: async () => Promise.reject(new Error('down')),
};

/** Code sign-in of `email`, then Google with the same verified email in another jar (AC-20 linking). */
async function accountWithGoogle(email: string, googleName: string): Promise<{ id: string; code: CookieJar; google: CookieJar }> {
  const code = new CookieJar();
  expect((await signIn(h, redis, code, email)).status).toBe(200);
  const id = (await sessionOf(h, code)).user?.id ?? '';
  const google = new CookieJar();
  const started = await h.call('/api/auth/sign-in/social', { body: { returnPath: '/' }, jar: google });
  const authorize = ((await started.json()) as { value: { url: string } }).value.url;
  const back = new URL(await fakeGoogleLogin(authorize, { sub: `g-${RUN}-${randomBytes(4).toString('hex')}`, email, emailVerified: true, name: googleName }));
  expect((await h.call(back.pathname + back.search, { jar: google })).status).toBe(302);
  expect((await sessionOf(h, google)).user?.id).toBe(id);
  return { id, code, google };
}

/** A pending (unused) code of `email`. */
async function pendingCode(email: string): Promise<void> {
  await redis.del(`auth:gap:${emailKey(email)}`);
  const res = await h.call('/api/auth/email-otp/send-verification-otp', { body: { email, intent: 'signin' }, ip: freshIp() });
  expect(res.status).toBe(200);
}

const rowsOf = async (id: string, email: string) =>
  (
    await pool.query(
      `SELECT (SELECT count(*) FROM users WHERE id = $1)::int AS u, (SELECT count(*) FROM user_accounts WHERE user_id = $1)::int AS a,
              (SELECT count(*) FROM user_sessions WHERE user_id = $1)::int AS s, (SELECT count(*) FROM auth_verifications WHERE identifier = $2)::int AS v`,
      [id, `sign-in-otp-${email}`],
    )
  ).rows[0] as { u: number; a: number; s: number; v: number };

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis);
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.close();
});

describe('auth subject data (AC-49, AC-50, EC-10)', () => {
  it('AC-49: export of a code + Google account — exact fields, provider ids only, no tokens', { timeout: 60_000 }, async () => {
    const email = testEmail('sd-export');
    const { id } = await accountWithGoogle(email, 'Subject Name');
    const r = await runSubjectDataInScope(h.deps, 'export', id, subjectDataRegistry);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.declarative).toEqual(expect.arrayContaining(['auth-codes']));
    const out = r.results.auth as AuthSubjectExport;
    expect(Object.keys(out).sort()).toEqual(['devices', 'email', 'googleName', 'methods', 'sessions']);
    expect(out.email).toBe(email);
    expect(out.googleName).toBe('Subject Name');
    const providers = ((await pool.query('SELECT DISTINCT provider_id FROM user_accounts WHERE user_id = $1', [id])).rows as { provider_id: string }[]).map((p) => p.provider_id);
    expect(providers).toContain('google');
    expect([...out.methods].sort()).toEqual([...new Set(['email', ...providers])].sort());
    const sessions = (await pool.query('SELECT created_at, expires_at, device_id FROM user_sessions WHERE user_id = $1 ORDER BY created_at', [id])).rows as {
      created_at: Date;
      expires_at: Date;
      device_id: string;
    }[];
    expect(out.sessions).toEqual(sessions.map((s) => ({ createdAt: s.created_at.toISOString(), expiresAt: s.expires_at.toISOString(), deviceId: s.device_id })));
    expect(out.sessions).toHaveLength(2);
    for (const s of out.sessions) expect(Object.keys(s).sort()).toEqual(['createdAt', 'deviceId', 'expiresAt']);
    const userDevice = ((await pool.query('SELECT device_id FROM users WHERE id = $1', [id])).rows[0] as { device_id: string | null }).device_id;
    expect(out.devices).toEqual([...new Set([...sessions.map((s) => s.device_id), ...(userDevice ? [userDevice] : [])])].sort());
    expect(out.devices.length).toBeGreaterThanOrEqual(1);
    // No token column, no token value.
    const text = JSON.stringify(out);
    expect(text).not.toMatch(/token|password|scope/i);
    const secrets = (await pool.query('SELECT access_token, refresh_token, id_token FROM user_accounts WHERE user_id = $1', [id])).rows as Record<string, string | null>[];
    for (const row of secrets) for (const v of Object.values(row)) if (v) expect(text).not.toContain(v);
  });

  it('AC-50 + EC-10: erase removes user, accounts, sessions and the pending code even when another handler fails', { timeout: 60_000 }, async () => {
    const email = testEmail('sd-erase');
    const { id } = await accountWithGoogle(email, 'Erase Me');
    await pendingCode(email);
    const before = await rowsOf(id, email);
    expect(before.u).toBe(1);
    expect(before.a).toBeGreaterThanOrEqual(1);
    expect(before.s).toBe(2);
    expect(before.v).toBe(1);
    const r = await runSubjectDataInScope(h.deps, 'erase', id, [...subjectDataRegistry, failing]);
    expect(r).toEqual({ ok: false, failed: ['zz-failing'], declarative: expect.arrayContaining(['auth-codes']) });
    expect(await rowsOf(id, email)).toEqual({ u: 0, a: 0, s: 0, v: 0 });
    // Idempotent: a second erase finds nothing; export of the erased subject is empty.
    expect(await runSubjectDataInScope(h.deps, 'erase', id, subjectDataRegistry)).toMatchObject({ ok: true, results: { auth: { erased: false } } });
    expect(await runSubjectDataInScope(h.deps, 'export', id, subjectDataRegistry)).toMatchObject({ ok: true, results: { auth: null } });
  });
});

describeRealtime('AC-50: erase publishes `session` erased', () => {
  it('a subscriber on the personal channel (a second tab) receives `erased`', { timeout: 60_000 }, async () => {
    const jar = new CookieJar();
    expect((await signIn(h, redis, jar, testEmail('sd-event'))).status).toBe(200);
    const id = (await sessionOf(h, jar)).user?.id ?? '';
    const token = ((await (await h.call('/api/realtime/token', { jar })).json()) as { value: { token: string } }).value.token;
    const client = centrifugeClient(token);
    clients.push(client);
    expect(await connectAndWait(client)).toBe('connected');
    const channel = name('user', id);
    const reasons: string[] = [];
    const sub = client.newSubscription(channel);
    sub.on('publication', (ctx: PublicationContext) => reasons.push(String((ctx.data as { data?: { reason?: string } }).data?.reason)));
    await new Promise<void>((resolve, reject) => {
      sub.once('subscribed', () => resolve());
      sub.once('error', (ctx) => reject(new Error(`subscribe refused ${ctx.error.code}`)));
      sub.subscribe();
    });
    expect((await runSubjectDataInScope(h.deps, 'erase', id, subjectDataRegistry)).ok).toBe(true);
    const inHistory = await waitFor(async () => {
      const { json } = await api('history', { channel, limit: 20 });
      const pubs = ((json.result as { publications?: { data?: { type?: string; data?: { reason?: string } } }[] } | undefined)?.publications ?? []);
      return pubs.some((p) => p.data?.type === 'session' && p.data.data?.reason === 'erased') ? true : undefined;
    }, 3_000);
    expect(inHistory).toBe(true);
    expect(await waitFor(async () => (reasons.includes('erased') ? true : undefined), 3_000)).toBe(true);
  });
});
