/**
 * SPEC-10 W27 — the sign-in and mail test doors (AC-52, AC-56; AC-13 door): each works in `test` with doors on and
 * answers like an unknown path with doors off. Mail goes only to the shared Mailpit (127.0.0.1:1025) to unique
 * recipients; the last-code door must not answer for an address that only contains the asked one.
 */
import nodemailer from 'nodemailer';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthWiring } from '../../src/auth/instance';
import { buildDispatcher } from '../../src/container';
import { utcDayKey } from '../../src/domain/mail/day';
import { mailSentKey } from '../../src/mail/service';
import { doorRegistry } from '../../src/test-doors/registry';
import { fakeGoogleForm } from '../support/fakeOidc';
import { MAILPIT_API, waitForMessage } from '../support/mailpit';
import { testEmail } from '../support/testEmail';
import { BASE, ORIGIN, ownRedis, testDeps } from './helpers';

type Dispatch = (req: Request) => Promise<Response>;
const redis = ownRedis();
let pool: pg.Pool;
let dispatch: Dispatch;
const otps = new Map<string, string>();

const AUTH_DOORS: Array<[string, unknown]> = [
  ['/api/_test/auth/last-code', { to: 'nobody@t2f.test' }],
  ['/api/_test/auth/expire-code', { email: 'nobody@t2f.test' }],
  ['/api/_test/auth/google-user', { sub: 's', email: 'nobody@t2f.test', emailVerified: true }],
  ['/api/_test/auth/write-probe', {}],
  ['/api/_test/mail/counter', { provider: 'primary', count: 1 }],
];

const door = (d: Dispatch, path: string, body: unknown) =>
  d(new Request(BASE + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));

async function sendMail(to: string, text: string): Promise<void> {
  const t = nodemailer.createTransport({ host: '127.0.0.1', port: 1025, secure: false, ignoreTLS: true });
  try {
    await t.sendMail({ from: 'test@t2f.test', to, subject: 'code', text });
  } finally {
    t.close();
  }
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  const deps = testDeps({ redis });
  deps.auth = createAuthWiring({
    env: deps.env,
    redis,
    sendOtp: async ({ email, otp }) => {
      otps.set(email, otp);
    },
  });
  dispatch = await buildDispatcher(deps);
});

afterAll(async () => {
  await pool.end();
  await redis.deleteByPrefix('auth:');
  await redis.deleteByPrefix('mail:');
});

describe('SPEC-10 auth and mail doors (AC-52)', () => {
  it('registry: the five rows are sorted in and the write probe needs a subject', () => {
    const keys = doorRegistry.map((d) => d.key);
    for (const k of ['auth-expire-code', 'auth-google-user', 'auth-last-code', 'auth-write-probe', 'mail-counter']) expect(keys).toContain(k);
    expect(keys.includes('last-code')).toBe(false);
    expect(doorRegistry.find((d) => d.key === 'auth-write-probe')?.subject).toBe('required');
  });

  it('last-code: the newest code of the exact recipient only (AC-56); a containing address never matches', async () => {
    const to = testEmail('code');
    const decoy = `x${to}`; // the Mailpit `to:` search finds this one too
    await sendMail(decoy, 'Ваш код входу в Time2Fest: 111111');
    await waitForMessage(MAILPIT_API, decoy);
    expect((await door(dispatch, '/api/_test/auth/last-code', { to })).status).toBe(404);

    await sendMail(to, 'Ваш код входу в Time2Fest: 222222');
    await waitForMessage(MAILPIT_API, to);
    await sendMail(to, 'Ваш код входу в Time2Fest: 333333');
    await expect.poll(async () => (await (await door(dispatch, '/api/_test/auth/last-code', { to: to.toUpperCase() })).json()) as unknown, { timeout: 5000 }).toEqual({
      ok: true,
      value: { code: '333333' },
    });
    expect(await (await door(dispatch, '/api/_test/auth/last-code', { to: decoy })).json()).toEqual({ ok: true, value: { code: '111111' } });
    expect((await door(dispatch, '/api/_test/auth/last-code', { to: testEmail() })).status).toBe(404);
  });

  it('last-code: a bad body is invalid-input', async () => {
    const res = await door(dispatch, '/api/_test/auth/last-code', { to: 'not an email' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { reason: string } }).error.reason).toBe('invalid-input');
    expect((await door(dispatch, '/api/_test/auth/last-code', { to: testEmail(), extra: 1 })).status).toBe(400);
  });

  it('expire-code: moves the code row into the past (AC-13); no row → 404', async () => {
    const email = testEmail('expire');
    const sent = await dispatch(
      new Request(`${BASE}/api/auth/email-otp/send-verification-otp`, {
        method: 'POST',
        body: JSON.stringify({ email, type: 'sign-in' }),
        headers: { 'content-type': 'application/json', origin: ORIGIN },
      }),
    );
    expect(sent.status).toBe(200);
    const row = async () =>
      (await pool.query('SELECT expires_at FROM auth_verifications WHERE identifier = $1', [`sign-in-otp-${email}`])).rows[0] as
        | { expires_at: Date }
        | undefined;
    expect((await row())!.expires_at.getTime()).toBeGreaterThan(Date.now());
    const res = await door(dispatch, '/api/_test/auth/expire-code', { email: email.toUpperCase() });
    expect(res.status).toBe(200);
    expect((await row())!.expires_at.getTime()).toBeLessThan(Date.now());
    expect((await door(dispatch, '/api/_test/auth/expire-code', { email: testEmail() })).status).toBe(404);
  });

  it('google-user: answers the fake OIDC login form fields of that user', async () => {
    const user = { sub: 'g-sub-1', email: testEmail('google'), emailVerified: false, name: 'Олена' };
    const res = await door(dispatch, '/api/_test/auth/google-user', user);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, value: fakeGoogleForm(user) });
  });

  it("mail/counter: sets today's counter of the provider", async () => {
    const res = await door(dispatch, '/api/_test/mail/counter', { provider: 'fallback', count: 42 });
    expect(res.status).toBe(200);
    expect(await redis.get(mailSentKey('fallback', utcDayKey(new Date())))).toBe('42');
    expect((await door(dispatch, '/api/_test/mail/counter', { provider: 'other', count: 1 })).status).toBe(400);
    expect((await door(dispatch, '/api/_test/mail/counter', { provider: 'primary', count: -1 })).status).toBe(400);
  });

  it('write-probe: answers in test (the guest on first write lands in P10)', async () => {
    const res = await door(dispatch, '/api/_test/auth/write-probe', {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { value: Record<string, unknown> }).value).toHaveProperty('subject');
  });

  it('reset: empties users, sessions, accounts, codes and the auth/mail keys of this slot', { timeout: 120_000 }, async () => {
    await pool.query("INSERT INTO users (name, email, email_verified) VALUES ('', $1, true)", [testEmail('reset')]);
    await door(dispatch, '/api/_test/mail/counter', { provider: 'primary', count: 3 });
    const res = await door(dispatch, '/api/_test/reset', {});
    expect(res.status).toBe(200);
    for (const t of ['users', 'user_sessions', 'user_accounts', 'auth_verifications']) {
      expect(((await pool.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0] as { n: number }).n, t).toBe(0);
    }
    expect(await redis.get(mailSentKey('primary', utcDayKey(new Date())))).toBeNull();
  });

  it('with doors off every auth door answers like an unknown path', async () => {
    const off = await buildDispatcher(testDeps({ redis }, { T2F_TEST_DOORS: undefined }));
    const unknown = await door(off, '/api/_test/nope', {});
    const unknownBody = await unknown.text();
    expect(unknown.status).toBe(404);
    for (const [path, body] of AUTH_DOORS) {
      const res = await door(off, path, body);
      expect(res.status, path).toBe(404);
      expect(await res.text(), path).toBe(unknownBody);
    }
  });
});
