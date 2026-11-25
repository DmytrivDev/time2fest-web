/**
 * SPEC-10 W25 — the email-code flow over the real pipeline: in-process dispatcher, this slot's Postgres and Redis,
 * the real mail service into the shared Mailpit, the `last-code` / `expire-code` doors. The edge secret is set so each
 * request carries its own client address (`x-t2f-client`). Our windows are aligned to the wiring's wall clock, which
 * the limit tests pin (no flake at a 10-minute boundary). Covers AC-6 … AC-16, AC-38, AC-40, NFR-4, NFR-7, EC-1,
 * EC-6, EC-8.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { codeInfoSchema, signInOutcomeSchema } from '@time2fest/contracts/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthWiring } from '../../src/auth/instance';
import { buildDispatcher } from '../../src/container';
import { testEmailKey } from '../support/testEmailKey';
import type { MailService } from '../../src/mail/ports';
import { DependencyUnavailable, type FastStore } from '../../src/ports';
import { MAILPIT_API, countMessages } from '../support/mailpit';
import { testEmail } from '../support/testEmail';
import { BASE, ORIGIN, ownRedis, testDeps } from './helpers';

const SECRET = randomBytes(20).toString('hex');
const SESSION = '__Secure-t2f.session_token';
const TEN_MIN = 600_000;
const DAY = 86_400_000;
const redis = ownRedis();
let pool: pg.Pool;

type Dispatch = (req: Request) => Promise<Response>;
type Body = { ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; reason?: string; retryAfterMs?: number; attemptsLeft?: number } };

const freshIp = () => `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

/** Pinned wall clock of the wiring (our limits and `CodeInfo` read it). */
const clock = { now: Date.now() };

async function build(overrides: Parameters<typeof testDeps>[0] = {}): Promise<Dispatch> {
  const deps = testDeps({ redis, ...overrides }, { T2F_EDGE_SECRET: SECRET });
  deps.auth = createAuthWiring({ env: deps.env, getDeps: () => deps, redis: deps.redis, now: () => clock.now });
  return buildDispatcher(deps);
}

let dispatch: Dispatch;

async function post(d: Dispatch, path: string, body: unknown, ip = freshIp()): Promise<{ res: Response; body: Body }> {
  const res = await d(
    new Request(BASE + path, {
      method: 'POST',
      headers: { 'x-t2f-edge': SECRET, 'x-t2f-client': `${ip};UA`, origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { res, body: (await res.json()) as Body };
}

const request = (email: string, ip?: string, d: Dispatch = dispatch) =>
  post(d, '/api/auth/email-otp/send-verification-otp', { email, intent: 'signin' }, ip);
const verify = (email: string, otp: string, ip?: string) => post(dispatch, '/api/auth/sign-in/email-otp', { email, otp }, ip);
const errorOf = (b: Body) => (b.ok ? undefined : b.error);
/** Frees the 30 s gap of an address (only where a test needs a second code at once). */
const dropGap = (email: string) => redis.del(`auth:gap:${testEmailKey(email)}`);

/** The newest code mailed to `to` (door), polled until it differs from `not`. */
async function lastCode(to: string, not?: string): Promise<string> {
  const until = Date.now() + 5000;
  for (;;) {
    const { res, body } = await post(dispatch, '/api/_test/auth/last-code', { to });
    if (res.status === 200 && body.ok && body.value.code !== not) return String(body.value.code);
    if (Date.now() > until) throw new Error('no code mail');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const codeRow = async (email: string) =>
  (await pool.query('SELECT value FROM auth_verifications WHERE identifier = $1', [`sign-in-otp-${email}`])).rows[0] as
    | { value: string }
    | undefined;
const userCount = async () => ((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0] as { n: number }).n;
const aligned = () => Math.floor(Date.now() / TEN_MIN) * TEN_MIN + 1000;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  await redis.deleteByPrefix('auth:');
  await redis.deleteByPrefix('mail:');
  dispatch = await build();
});

afterAll(async () => {
  await pool.query(`DELETE FROM users WHERE email LIKE 't2f-%@t2f.test'`);
  await pool.query(`DELETE FROM auth_verifications WHERE identifier LIKE 'sign-in-otp-t2f-%@t2f.test'`);
  await pool.end();
  await redis.deleteByPrefix('auth:');
  await redis.deleteByPrefix('mail:');
  await redis.close();
});

describe('code request (AC-6 … AC-10, EC-1, EC-8)', () => {
  it('AC-6: CodeInfo of the same form for a new and an existing email; no account is created', async () => {
    clock.now = Date.now();
    const existing = testEmail('existing');
    expect((await request(existing)).res.status).toBe(200);
    const signedIn = await verify(existing, await lastCode(existing));
    expect(signedIn.res.status).toBe(200);
    await dropGap(existing);

    const before = await userCount();
    const fresh = testEmail('new');
    const a = await request(fresh);
    const b = await request(existing);
    expect(await userCount()).toBe(before);
    for (const [r, email] of [
      [a, fresh],
      [b, existing],
    ] as const) {
      expect(r.res.status).toBe(200);
      expect(r.body.ok).toBe(true);
      const info = codeInfoSchema.parse((r.body as { value: unknown }).value);
      expect(info).toEqual({
        email,
        intent: 'signin',
        sentAt: clock.now,
        resendAt: clock.now + 30_000,
        expiresAt: clock.now + TEN_MIN,
        attemptsLeft: 5,
      });
    }
    expect(Object.keys((a.body as { value: object }).value).sort()).toEqual(Object.keys((b.body as { value: object }).value).sort());
  });

  it('AC-7: a malformed email → validation/email, no code row, no mail', async () => {
    for (const bad of ['no-at-sign', 'a b@t2f.test', '@', 'x'.repeat(260) + '@t2f.test']) {
      const r = await request(bad);
      expect(errorOf(r.body)).toEqual({ code: 'validation', reason: 'email' });
    }
    const r = await post(dispatch, '/api/auth/email-otp/send-verification-otp', { email: testEmail(), type: 'sign-in' });
    expect(errorOf(r.body)).toEqual({ code: 'validation', reason: 'email' });
    expect(await codeRow('no-at-sign')).toBeUndefined();
  });

  it('AC-8 / EC-1: a second code within 30 s → rate_limited/wait + retryAfterMs; of two parallel requests one waits', async () => {
    clock.now = Date.now();
    const email = testEmail('gap');
    expect((await request(email)).res.status).toBe(200);
    const again = errorOf((await request(email)).body);
    expect(again).toMatchObject({ code: 'rate_limited', reason: 'wait' });
    expect(again!.retryAfterMs).toBeGreaterThan(0);
    expect(again!.retryAfterMs).toBeLessThanOrEqual(30_000);

    const twin = testEmail('twin');
    const both = await Promise.all([request(twin), request(twin)]);
    const statuses = both.map((r) => (r.body.ok ? 'ok' : r.body.error.reason)).sort();
    expect(statuses).toEqual(['ok', 'wait']);
  });

  it('EC-8: upper case and spaces are normalized before the limits and the answer', async () => {
    clock.now = Date.now();
    const email = testEmail('norm');
    const r = await request(`  ${email.toUpperCase()} `);
    expect(r.res.status).toBe(200);
    expect((r.body as { value: Record<string, unknown> }).value.email).toBe(email);
    expect(errorOf((await request(email)).body)).toMatchObject({ code: 'rate_limited', reason: 'wait' });
  });

  it('AC-9: 5 codes per 10 min per email → the 6th is rate_limited/too-many', async () => {
    clock.now = aligned();
    const email = testEmail('email5');
    for (let i = 0; i < 5; i += 1) {
      await dropGap(email);
      expect((await request(email)).res.status).toBe(200);
    }
    await dropGap(email);
    expect(errorOf((await request(email)).body)).toEqual({ code: 'rate_limited', reason: 'too-many', retryAfterMs: TEN_MIN - 1000 });
  });

  it('AC-9: 5 codes per 10 min per client (ipDay) → the 6th is rate_limited/too-many', async () => {
    clock.now = aligned();
    const ip = freshIp();
    for (let i = 0; i < 5; i += 1) expect((await request(testEmail('ip'), ip)).res.status).toBe(200);
    expect(errorOf((await request(testEmail('ip'), ip)).body)).toMatchObject({ code: 'rate_limited', reason: 'too-many' });
    expect((await request(testEmail('ip'))).res.status).toBe(200);
  });

  it('AC-9 / EC-6: 5 codes per 10 min per IPv6 /48 even when every request comes from another /64', async () => {
    clock.now = aligned();
    const net = `2001:db8:${randomBytes(2).toString('hex')}`;
    for (let i = 1; i <= 5; i += 1) expect((await request(testEmail('v6'), `${net}:${i}::7`)).res.status).toBe(200);
    expect(errorOf((await request(testEmail('v6'), `${net}:6::7`)).body)).toMatchObject({ code: 'rate_limited', reason: 'too-many' });
  });

  it('S10-01: 12 parallel requests from one client for 12 addresses → exactly 5 × 200, 7 × too-many; same for one /48', async () => {
    clock.now = aligned();
    const ip = freshIp();
    const one = await Promise.all(Array.from({ length: 12 }, () => request(testEmail('par'), ip)));
    expect(one.filter((r) => r.res.status === 200)).toHaveLength(5);
    for (const r of one.filter((x) => x.res.status !== 200)) expect(errorOf(r.body)).toMatchObject({ code: 'rate_limited', reason: 'too-many' });
    const net = `2001:db8:${randomBytes(2).toString('hex')}`;
    const wide = await Promise.all(Array.from({ length: 12 }, (_, i) => request(testEmail('par48'), `${net}:${i + 1}::7`)));
    expect(wide.filter((r) => r.res.status === 200)).toHaveLength(5);
    expect(wide.filter((r) => r.res.status === 429)).toHaveLength(7);
  });

  it('S10-01: both providers down gives the reserved hits back — the client still has its 5 codes', async () => {
    clock.now = aligned();
    const down = await build({ mail: { send: async () => ({ ok: false, reason: 'unavailable' }) } });
    const ip = freshIp();
    for (let i = 0; i < 6; i += 1) expect(errorOf((await request(testEmail('dn'), ip, down)).body)).toEqual({ code: 'unavailable' });
    for (let i = 0; i < 5; i += 1) expect((await request(testEmail('dn'), ip)).res.status).toBe(200);
    expect(errorOf((await request(testEmail('dn'), ip)).body)).toMatchObject({ code: 'rate_limited', reason: 'too-many' });
  });

  it('AC-10 / NFR-7: 10 codes per UTC day per email → the 11th is too-many until 00:00 UTC; 10 mails in Mailpit', async () => {
    const dayStart = Math.floor(Date.now() / DAY) * DAY;
    const email = testEmail('day10');
    for (let i = 0; i < 10; i += 1) {
      clock.now = dayStart + 60_000 + Math.floor(i / 5) * TEN_MIN + i * 1000;
      await dropGap(email);
      expect((await request(email)).res.status).toBe(200);
    }
    clock.now = dayStart + 60_000 + 3 * TEN_MIN;
    await dropGap(email);
    expect(errorOf((await request(email)).body)).toEqual({
      code: 'rate_limited',
      reason: 'too-many',
      retryAfterMs: dayStart + DAY - clock.now,
    });
    expect(await countMessages(MAILPIT_API, email)).toBe(10);
  });
});

describe('verify (AC-11 … AC-16)', () => {
  it('AC-14: the right code signs in: session cookie, SignInOutcome, no token; isNew only the first time', async () => {
    clock.now = Date.now();
    const email = testEmail('signin');
    await request(email);
    const first = await verify(email, await lastCode(email));
    expect(first.res.status).toBe(200);
    expect(first.res.headers.getSetCookie().some((l) => l.startsWith(`${SESSION}=`))).toBe(true);
    expect(signInOutcomeSchema.parse((first.body as { value: unknown }).value)).toEqual({ isNew: true, email });
    expect(JSON.stringify(first.body)).not.toMatch(/token/i);

    const prev = await lastCode(email);
    await dropGap(email);
    await request(email);
    const second = await verify(email, await lastCode(email, prev));
    expect(signInOutcomeSchema.parse((second.body as { value: unknown }).value)).toEqual({ isNew: false, email });
  });

  it('AC-11 / AC-12: a wrong code → wrong-code with attemptsLeft −1; the 5th → too-many-attempts and the code is burnt', async () => {
    clock.now = Date.now();
    const email = testEmail('wrong');
    await request(email);
    const code = await lastCode(email);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let left = 4; left >= 1; left -= 1) {
      expect(errorOf((await verify(email, wrong)).body)).toEqual({ code: 'validation', reason: 'wrong-code', attemptsLeft: left });
    }
    expect(errorOf((await verify(email, wrong)).body)).toEqual({ code: 'rate_limited', reason: 'too-many-attempts' });
    expect(await codeRow(email)).toBeUndefined();
    const late = await verify(email, code);
    expect(late.res.status).not.toBe(200);
    expect(late.res.headers.getSetCookie().some((l) => l.startsWith(`${SESSION}=`) && !/max-age=0/i.test(l))).toBe(false);
  });

  it('AC-13: a code older than 10 minutes → conflict/expired', async () => {
    clock.now = Date.now();
    const email = testEmail('expired');
    await request(email);
    const code = await lastCode(email);
    expect((await post(dispatch, '/api/_test/auth/expire-code', { email })).res.status).toBe(200);
    expect(errorOf((await verify(email, code)).body)).toEqual({ code: 'conflict', reason: 'expired' });
  });

  it('AC-15 / AC-16: a new code invalidates the previous one; codes are stored only hashed', async () => {
    clock.now = Date.now();
    const email = testEmail('replace');
    await request(email);
    const first = await lastCode(email);
    const row = await codeRow(email);
    expect(row).toBeDefined();
    expect(row!.value).not.toContain(first);
    await dropGap(email);
    await request(email);
    const second = await lastCode(email, first);
    expect((await codeRow(email))!.value).not.toContain(second);
    expect(errorOf((await verify(email, first)).body)).toMatchObject({ code: 'validation', reason: 'wrong-code' });
    expect((await verify(email, second)).res.status).toBe(200);
  });
});

describe('mail outcomes and Redis (AC-38, AC-40, NFR-4)', () => {
  const stub = (reason: 'recipient' | 'unavailable'): MailService => ({ send: async () => ({ ok: false, reason }) });

  it('AC-40: both providers down → unavailable, no code row, and an immediate retry is not `wait`', async () => {
    clock.now = Date.now();
    const down = await build({ mail: stub('unavailable') });
    const email = testEmail('down');
    for (let i = 0; i < 6; i += 1) {
      expect(errorOf((await request(email, undefined, down)).body)).toEqual({ code: 'unavailable' });
    }
    expect(await codeRow(email)).toBeUndefined();
    // Not counted: the same address still gets its code at once.
    expect((await request(email)).res.status).toBe(200);
  });

  it('AC-40: a sender that throws (Better Auth swallows it and answers 200) → unavailable, not counted', async () => {
    clock.now = Date.now();
    const deps = testDeps({ redis }, { T2F_EDGE_SECRET: SECRET });
    deps.auth = createAuthWiring({
      env: deps.env,
      getDeps: () => deps,
      redis,
      now: () => clock.now,
      sendOtp: async () => {
        throw new Error('delivery failed');
      },
    });
    const throwing = await buildDispatcher(deps);
    const email = testEmail('throws');
    for (let i = 0; i < 6; i += 1) {
      expect(errorOf((await request(email, undefined, throwing)).body)).toEqual({ code: 'unavailable' });
    }
    expect(await codeRow(email)).toBeUndefined();
    expect((await request(email)).res.status).toBe(200);
  });

  it('AC-38: the recipient refused → validation/email, no code row', async () => {
    clock.now = Date.now();
    const refused = await build({ mail: stub('recipient') });
    const email = testEmail('refused');
    expect(errorOf((await request(email, undefined, refused)).body)).toEqual({ code: 'validation', reason: 'email' });
    expect(await codeRow(email)).toBeUndefined();
  });

  it('NFR-4: Redis unreachable → unavailable, no code row, no mail', async () => {
    clock.now = Date.now();
    const fail = (): Promise<never> => Promise.reject(new DependencyUnavailable('redis'));
    const broken: FastStore = { incrWindow: fail, setIfAbsent: fail, decrIfPresent: fail, get: fail, set: fail, del: fail, deleteByPrefix: fail };
    const noRedis = await build({ redis: broken });
    const email = testEmail('noredis');
    expect(errorOf((await request(email, undefined, noRedis)).body)).toEqual({ code: 'unavailable' });
    expect(await codeRow(email)).toBeUndefined();
    expect(await countMessages(MAILPIT_API, email)).toBe(0);
  });
});
