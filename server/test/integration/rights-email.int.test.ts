/**
 * SPEC-11 W33 — email change through the real pipeline (in-process dispatcher, this slot's Postgres and Redis, the
 * real mail service into the shared Mailpit; `noMailNetwork` stays on): request → code mailed, `pendingEmail`
 * (AC-43); same / taken / malformed refusals; 2nd request in 30 s → `rate_limited/wait`; verify → email changed and
 * verified, the account pass stays, `session` (`email-changed`) + `profile` published (AC-44); taken meanwhile →
 * `taken`; wrong → `wrong-code`, expired → `expired`, 5 wrong → `too-many-attempts`; cancel → `pendingEmail:null`, old
 * code `expired` (AC-45); guest / no session → `unauthorized` (AC-58); a payment email of an unattached pass is not
 * attached by the change (EC-4).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rightsOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { buildAuthHarness, CookieJar, freshIp, sessionOf, signIn, writeProbe, type AuthHarness } from '../support/authClient';
import { MAILPIT_API, waitForMessage } from '../support/mailpit';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
const tag = randomBytes(4).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;
let n = 0;
const ref = () => `re-${tag}-${(n += 1)}`;
const published: { key: string; type: string; reason?: string }[] = [];

type Body = { ok: boolean; value?: Record<string, unknown> & { pendingEmail?: { email: string; attemptsLeft: number } | null }; error?: { code: string; reason?: string; attemptsLeft?: number; retryAfterMs?: number } };
interface Account {
  jar: CookieJar;
  email: string;
  id: string;
}

async function account(label: string): Promise<Account> {
  const jar = new CookieJar();
  const email = testEmail(`re-${label}`);
  expect((await signIn(h, redis, jar, email)).status).toBe(200);
  const id = (await sessionOf(h, jar)).user?.id ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return { jar, email, id };
}

async function call(a: { jar: CookieJar } | undefined, path: string, method: string, body?: unknown): Promise<{ status: number; body: Body }> {
  const res = await h.call(path, { method, ...(body !== undefined ? { body } : {}), ...(a ? { jar: a.jar } : {}), ip: freshIp() });
  return { status: res.status, body: (await res.json()) as Body };
}
const request = (a: Account | { jar: CookieJar } | undefined, email: string) => call(a, '/api/me/email', 'POST', { email });
const verify = (a: Account, code: string) => call(a, '/api/me/email/verify', 'POST', { code });
const cancel = (a: Account) => call(a, '/api/me/email', 'DELETE');

/** The code of the newest change mail to `to`. */
async function codeTo(to: string): Promise<string> {
  const m = await waitForMessage(MAILPIT_API, to, 8_000);
  expect(m.subject).toContain('зміни пошти');
  expect(m.text).not.toMatch(/https?:\/\//);
  const code = /(\d{6})/.exec(m.subject)?.[1];
  expect(code).toMatch(/^\d{6}$/);
  return code!;
}

const userRow = async (id: string) =>
  (await pool.query('SELECT email, email_verified FROM users WHERE id = $1', [id])).rows[0] as { email: string; email_verified: boolean };
const pendingRows = async (id: string) =>
  ((await pool.query('SELECT 1 FROM auth_verifications WHERE identifier = $1', [`t2f-change-email-${id}`])).rowCount ?? 0);
const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

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
          published.push({ key, type: envelope.type, reason: envelope.data?.reason });
          return { status: 'ok' };
        },
      } as never,
      invalidator: { invalidate: async () => 'ok' as const },
    };
  });
});

afterAll(async () => {
  await pool.query('DELETE FROM passes WHERE grant_ref LIKE $1', [`re-${tag}-%`]);
  await pool.query(`DELETE FROM auth_verifications WHERE identifier LIKE 't2f-change-email-%' AND created_at >= $1`, [started]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.deleteByPrefix('rl:');
  await redis.close();
});

describe('email change request (AC-43)', () => {
  it('mails a code to the new address and answers pendingEmail; 2nd request in 30 s → rate_limited/wait', { timeout: 60_000 }, async () => {
    const a = await account('req');
    const to = testEmail('re-new');
    const r = await request(a, `  ${to.toUpperCase()} `);
    expect(r.status).toBe(200);
    expect(r.body.value?.pendingEmail).toMatchObject({ email: to, attemptsLeft: 5 });
    await codeTo(to);
    const again = await request(a, to);
    expect(again.body.error).toMatchObject({ code: 'rate_limited', reason: 'wait' });
    expect(again.body.error?.retryAfterMs).toBeGreaterThan(0);
    // The profile read shows the pending change too.
    expect((await call(a, '/api/me/profile', 'GET')).body.value?.pendingEmail).toMatchObject({ email: to });
  });

  it('refuses the same address, another account’s address, a malformed one, an extra key', { timeout: 60_000 }, async () => {
    const a = await account('refuse');
    const other = await account('other');
    expect((await request(a, a.email.toUpperCase())).body.error).toEqual({ code: 'validation', reason: 'same-email' });
    // The code limits run before the owner lookup (S11-01): free the 30 s gap `other`'s own sign-in code left.
    await redis.deleteByPrefix('auth:gap:');
    expect((await request(a, other.email)).body.error).toEqual({ code: 'conflict', reason: 'taken' });
    expect((await request(a, 'not-an-address')).body.error).toEqual({ code: 'validation', reason: 'email' });
    expect((await call(a, '/api/me/email', 'POST', { email: testEmail(), subject: other.id })).body.error).toMatchObject({ code: 'validation', reason: 'invalid-input' });
    expect(await pendingRows(a.id)).toBe(0);
  });

  it('S11-01: `taken` is answered within the code limits, and the request row stops a subject after 10 per 10 min', { timeout: 60_000 }, async () => {
    const a = await account('probe');
    const other = await account('probe-other');
    // Right after `other`'s sign-in its address is inside the 30 s code gap: the limits answer before the owner lookup.
    expect((await request(a, other.email)).body.error).toMatchObject({ code: 'rate_limited', reason: 'wait' });
    await redis.deleteByPrefix('auth:gap:');
    // Within the limits → `taken`, and the probed address keeps its reserved hit (a new 30 s gap).
    expect((await request(a, other.email)).body.error).toEqual({ code: 'conflict', reason: 'taken' });
    expect((await request(a, other.email)).body.error).toMatchObject({ code: 'rate_limited', reason: 'wait' });
    // 3 used above; 7 more (malformed, no mail) reach the handler, the 11th is refused by the row (fresh IP each time).
    for (let i = 0; i < 7; i += 1) expect((await request(a, 'not-an-address')).body.error).toEqual({ code: 'validation', reason: 'email' });
    const over = await request(a, testEmail('re-probe-x'));
    expect(over.status).toBe(429);
    expect(over.body.error).toMatchObject({ code: 'rate_limited' });
    expect(over.body.error?.reason).toBeUndefined();
  });

  it('AC-58: a guest and a request without a session → unauthorized on every account row', { timeout: 30_000 }, async () => {
    const jar = new CookieJar();
    expect((await writeProbe(h, { jar })).status).toBe(200);
    const guest = { jar };
    for (const [path, method, body] of [
      ['/api/me/email', 'POST', { email: testEmail() }],
      ['/api/me/email/verify', 'POST', { code: '123456' }],
      ['/api/me/email', 'DELETE', undefined],
      ['/api/me/google', 'POST', { returnPath: '/' }],
      ['/api/me/google', 'DELETE', undefined],
    ] as const) {
      expect((await call(guest, path, method, body)).body.error?.code).toBe('unauthorized');
      expect((await call(undefined, path, method, body)).body.error?.code).toBe('unauthorized');
    }
  });
});

describe('verify and cancel (AC-44, AC-45, EC-4)', () => {
  it('wrong → wrong-code; right → email changed and verified, account pass kept, session email-changed + profile', { timeout: 60_000 }, async () => {
    const a = await account('ok');
    const grantRef = ref();
    expect((await rightsOf(h.deps).passes.grantPass({ holder: { account: a.id }, source: 'gift', grantRef })).kind).toBe('granted');
    const to = testEmail('re-ok-new');
    expect((await request(a, to)).status).toBe(200);
    const code = await codeTo(to);

    expect((await verify(a, wrongCode(code))).body.error).toEqual({ code: 'validation', reason: 'wrong-code', attemptsLeft: 4 });
    expect((await call(a, '/api/me/profile', 'GET')).body.value?.pendingEmail).toMatchObject({ attemptsLeft: 4 });

    const mark = published.length;
    const ok = await verify(a, code);
    expect(ok.status).toBe(200);
    expect(ok.body.value?.pendingEmail).toBeNull();
    expect(await userRow(a.id)).toEqual({ email: to, email_verified: true });
    const pass = (await pool.query('SELECT attached_user_id::text AS u FROM passes WHERE grant_ref = $1', [grantRef])).rows[0] as { u: string };
    expect(pass.u).toBe(a.id);
    const events = published.slice(mark).filter((e) => e.key === a.id);
    expect(events).toContainEqual({ key: a.id, type: 'session', reason: 'email-changed' });
    expect(events.some((e) => e.type === 'profile')).toBe(true);
    // The session still reads the account, with the new email.
    expect((await sessionOf(h, a.jar)).user?.id).toBe(a.id);
    // The code is single-use.
    expect((await verify(a, code)).body.error).toEqual({ code: 'conflict', reason: 'expired' });
  });

  it('address taken meanwhile (another account signed up with it) → conflict/taken, email unchanged', { timeout: 60_000 }, async () => {
    const a = await account('race');
    const to = testEmail('re-race-new');
    expect((await request(a, to)).status).toBe(200);
    const code = await codeTo(to);
    expect((await signIn(h, redis, new CookieJar(), to)).status).toBe(200);
    expect((await verify(a, code)).body.error).toEqual({ code: 'conflict', reason: 'taken' });
    expect((await userRow(a.id)).email).toBe(a.email);
  });

  it('expired → expired; 5 wrong tries → too-many-attempts and the code is gone', { timeout: 60_000 }, async () => {
    const a = await account('exp');
    const to = testEmail('re-exp-new');
    expect((await request(a, to)).status).toBe(200);
    const code = await codeTo(to);
    await pool.query(`UPDATE auth_verifications SET expires_at = now() - interval '1 second' WHERE identifier = $1`, [`t2f-change-email-${a.id}`]);
    expect((await call(a, '/api/me/profile', 'GET')).body.value?.pendingEmail).toBeNull();
    expect((await verify(a, code)).body.error).toEqual({ code: 'conflict', reason: 'expired' });

    const b = await account('many');
    const to2 = testEmail('re-many-new');
    expect((await request(b, to2)).status).toBe(200);
    const code2 = await codeTo(to2);
    for (let left = 4; left >= 1; left -= 1) {
      expect((await verify(b, wrongCode(code2))).body.error).toEqual({ code: 'validation', reason: 'wrong-code', attemptsLeft: left });
    }
    expect((await verify(b, wrongCode(code2))).body.error).toEqual({ code: 'rate_limited', reason: 'too-many-attempts' });
    expect(await pendingRows(b.id)).toBe(0);
    expect((await verify(b, code2)).body.error).toEqual({ code: 'conflict', reason: 'expired' });
  });

  it('AC-45: cancel → pendingEmail null; the old code → expired', { timeout: 60_000 }, async () => {
    const a = await account('cancel');
    const to = testEmail('re-cancel-new');
    expect((await request(a, to)).status).toBe(200);
    const code = await codeTo(to);
    const c = await cancel(a);
    expect(c.status).toBe(200);
    expect(c.body.value?.pendingEmail).toBeNull();
    expect((await verify(a, code)).body.error).toEqual({ code: 'conflict', reason: 'expired' });
    expect((await userRow(a.id)).email).toBe(a.email);
  });

  it('EC-4: changing to the payment email of an unattached pass does not attach it', { timeout: 60_000 }, async () => {
    const a = await account('ec4');
    const to = testEmail('re-ec4-pay');
    const grantRef = ref();
    const device = `dev-${tag}-ec4`;
    expect((await rightsOf(h.deps).passes.grantPass({ holder: { device, paymentEmail: to }, source: 'purchase', grantRef })).kind).toBe('granted');
    expect((await request(a, to)).status).toBe(200);
    expect((await verify(a, await codeTo(to))).status).toBe(200);
    const pass = (await pool.query('SELECT attached_user_id FROM passes WHERE grant_ref = $1', [grantRef])).rows[0] as { attached_user_id: string | null };
    expect(pass.attached_user_id).toBeNull();
  });
});
