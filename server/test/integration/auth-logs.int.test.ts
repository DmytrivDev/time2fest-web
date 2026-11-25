/**
 * SPEC-10 W39 (AC-48, AC-55, NFR-6): a full auth run leaves no address and no code anywhere it could be read back.
 * The run: code request, wrong code, sign-in, failover (primary fake SMTP answers 451, the fallback is Mailpit), both
 * providers down (503 `unavailable`, page alarm) and a Google sign-in with an unverified email of an existing account.
 * Captured: the structured logger, `process.stdout` / `process.stderr` / `console`, the rows written during the test
 * in `alarms`, `log_alarms`, `alarm_deliveries` and `audit_log`, and the response bodies of the failures (a success body legitimately carries the caller's own address back). Searched for:
 * the address (with and without the `+tag`), its local part and every code issued (the right one and the wrong one) -> 0.
 * Also AC-55: the network guard (`noMailNetwork.ts`) refuses a non-loopback mail submission port and Google hosts.
 */
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeSmtp } from '../../../fakes/smtp/server.mjs';
import { createAuthWiring } from '../../src/auth/instance';
import { buildDispatcher } from '../../src/container';
import type { Logger } from '../../src/ports';
import { CookieJar, freshIp, makeCall, type Call } from '../support/authClient';
import { FAKE_OIDC_ISSUER, fakeGoogleLogin } from '../support/fakeOidc';
import { MAILPIT_API, waitForMessage } from '../support/mailpit';
import { testEmail } from '../support/testEmail';
import { ownRedis, testDeps } from './helpers';

const SECRET = randomBytes(20).toString('hex');
const redis = ownRedis();
const started = new Date();
let pool: pg.Pool;
let fake: Awaited<ReturnType<typeof startFakeSmtp>>;

/** Everything the run wrote where a person (or an attacker with log access) could read it. */
const captured: string[] = [];
const addresses: string[] = [];
const codes: string[] = [];
const bodies: string[] = [];

const capture = (chunk: unknown) => void captured.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
const logger: Logger = {
  info: (f) => void captured.push(JSON.stringify(f)),
  warn: (f) => void captured.push(JSON.stringify(f)),
  error: (f) => void captured.push(JSON.stringify(f)),
};

const restores: (() => void)[] = [];
function spyOutput(): void {
  for (const stream of [process.stdout, process.stderr]) {
    const real = stream.write.bind(stream) as (...a: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      capture(chunk);
      return real(chunk, ...rest);
    }) as typeof stream.write;
    restores.push(() => {
      stream.write = real as typeof stream.write;
    });
  }
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const real = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, (_k, v) => (v instanceof Error ? `${v.name}: ${v.message}` : v)))).join(' '));
      real(...args);
    };
    restores.push(() => {
      console[level] = real;
    });
  }
}

async function dispatcher(env: Record<string, string>, sendOtp?: (a: { email: string; otp: string }) => Promise<void>): Promise<Call> {
  const deps = testDeps({ redis, log: logger }, { T2F_EDGE_SECRET: SECRET, T2F_MAIL_DAILY_CEILING: '100000', SMTP_FALLBACK_DAILY_CEILING: '100000', ...env });
  deps.auth = createAuthWiring({ env: deps.env, getDeps: () => deps, redis, ...(sendOtp ? { sendOtp } : {}) });
  return makeCall(await buildDispatcher(deps), SECRET);
}

const codeOf = (text: string): string => /(?<!\d)(\d{6})(?!\d)/.exec(text)?.[1] ?? '';
const request = (call: Call, email: string) => call('/api/auth/email-otp/send-verification-otp', { body: { email, intent: 'signin' }, ip: freshIp() });

async function storedRows(): Promise<string[]> {
  const out: string[] = [];
  for (const table of ['alarms', 'log_alarms', 'alarm_deliveries', 'audit_log']) {
    const r = await pool.query(`SELECT row_to_json(t)::text AS j FROM ${table} t WHERE created_at >= $1`, [started]);
    for (const row of r.rows as { j: string }[]) out.push(`${table}: ${row.j}`);
  }
  return out;
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  fake = await startFakeSmtp({ port: 0 });
  await redis.deleteByPrefix('mail:');
  spyOutput();
});

afterAll(async () => {
  for (const r of restores.splice(0).reverse()) r();
  await fake.close();
  await pool.query(`DELETE FROM users WHERE email LIKE 't2f-%@t2f.test' AND created_at >= $1`, [started]);
  await pool.query(`DELETE FROM alarms WHERE created_at >= $1 AND source = 'mail'`, [started]);
  await pool.query(`DELETE FROM log_alarms WHERE created_at >= $1 AND source = 'mail'`, [started]);
  await pool.end();
  await redis.deleteByPrefix('mail:');
  await redis.deleteByPrefix('auth:rl:');
  await redis.close();
});

describe('no addresses or codes in logs, alarms, audit, errors (AC-48)', () => {
  it('a full run leaves 0 hits for the address, its local part and every code', { timeout: 180_000 }, async () => {
    // 1. Code request + wrong code + sign-in over Mailpit.
    const mailpit = await dispatcher({ SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_FALLBACK_HOST: '127.0.0.1', SMTP_FALLBACK_PORT: '1026' });
    const plain = testEmail('plain');
    addresses.push(plain);
    expect((await request(mailpit, plain)).status).toBe(200);
    const plainCode = codeOf((await waitForMessage(MAILPIT_API, plain)).text);
    expect(plainCode).toMatch(/^\d{6}$/);
    const wrong = plainCode === '135790' ? '246801' : '135790';
    codes.push(plainCode, wrong);
    const bad = await mailpit('/api/auth/sign-in/email-otp', { body: { email: plain, otp: wrong }, ip: freshIp() });
    expect(bad.status).toBe(400);
    bodies.push(await bad.text());
    const good = await mailpit('/api/auth/sign-in/email-otp', { body: { email: plain, otp: plainCode }, ip: freshIp() });
    expect(good.status).toBe(200);

    // 2. Failover: the primary (fake SMTP) answers 451 for `+q451`, the fallback (Mailpit) delivers.
    const failover = await dispatcher({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(fake.port), SMTP_FALLBACK_HOST: '127.0.0.1', SMTP_FALLBACK_PORT: '1025' });
    const moved = testEmail('q451');
    addresses.push(moved);
    const movedRes = await request(failover, moved);
    expect(movedRes.status).toBe(200);
    const movedCode = codeOf((await waitForMessage(MAILPIT_API, moved)).text);
    expect(movedCode).toMatch(/^\d{6}$/);
    codes.push(movedCode);
    const movedIn = await failover('/api/auth/sign-in/email-otp', { body: { email: moved, otp: movedCode }, ip: freshIp() });
    expect(movedIn.status).toBe(200);

    // 3. Both providers down: 503, the all-providers-down alarm.
    await redis.deleteByPrefix('mail:');
    const down = await dispatcher({ SMTP_HOST: '127.0.0.1', SMTP_PORT: String(fake.port), SMTP_FALLBACK_HOST: '127.0.0.1', SMTP_FALLBACK_PORT: String(fake.port) });
    const dead = testEmail('q451');
    addresses.push(dead);
    const deadRes = await request(down, dead);
    expect(deadRes.status).toBe(503);
    bodies.push(await deadRes.text());

    // 4. Google with an unverified email of an existing account: refused, back with error=failed.
    const sent = new Map<string, string>();
    const google = await dispatcher({}, async ({ email, otp }) => void sent.set(email, otp));
    const owner = testEmail('google');
    addresses.push(owner);
    expect((await request(google, owner)).status).toBe(200);
    const ownerCode = sent.get(owner) ?? '';
    codes.push(ownerCode);
    expect((await google('/api/auth/sign-in/email-otp', { body: { email: owner, otp: ownerCode }, ip: freshIp() })).status).toBe(200);
    const jar = new CookieJar();
    const startRes = await google('/api/auth/sign-in/social', { body: { returnPath: '/countries/ua' }, jar });
    expect(startRes.status).toBe(200);
    const url = ((await startRes.json()) as { value: { url: string } }).value.url;
    expect(url.startsWith(`${FAKE_OIDC_ISSUER}/`)).toBe(true);
    const sub = `g-logs-${randomBytes(3).toString('hex')}`;
    const back = new URL(await fakeGoogleLogin(url, { sub, email: owner, emailVerified: false, name: 'Unverified' }));
    const cb = await google(back.pathname + back.search, { jar });
    expect(cb.status).toBe(302);
    expect(cb.headers.get('location')).toContain('error=failed');
    bodies.push(cb.headers.get('location') ?? '');

    // Let the alarm writes settle, then read back what the run stored.
    let rows: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      rows = await storedRows();
      if (rows.some((r) => r.includes('all-providers-down'))) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(rows.some((r) => r.includes('all-providers-down'))).toBe(true);
    expect(rows.some((r) => r.includes('provider-failover'))).toBe(true);

    const haystack = [...captured, ...bodies, ...rows].join('\n');
    const needles = new Set<string>();
    for (const a of addresses) {
      const lower = a.toLowerCase();
      const local = lower.split('@')[0] ?? '';
      needles.add(lower);
      needles.add(lower.replace(/\+[^@]*@/, '@'));
      needles.add(local);
      needles.add(local.split('+')[0] ?? '');
    }
    const lowered = haystack.toLowerCase();
    for (const n of needles) {
      expect(n.length).toBeGreaterThan(8);
      const at = lowered.indexOf(n);
      expect({ needle: 'address-or-local-part', hit: at >= 0, ctx: at >= 0 ? haystack.slice(Math.max(0, at - 150), at + 120) : '' }).toEqual({ needle: 'address-or-local-part', hit: false, ctx: '' });
    }
    for (const c of codes.filter((x) => x !== '')) {
      expect({ needle: 'code', hit: new RegExp(`(?<!\\d)${c}(?!\\d)`).test(haystack) }).toEqual({ needle: 'code', hit: false });
    }
    // The run did write log lines: the check above is not vacuous.
    expect(captured.some((l) => l.includes('auth-code'))).toBe(true);
  });
});

describe('the test network guard (AC-55, NFR-6)', () => {
  it('refuses mail submission to a non-loopback host and the Google / provider API hosts; loopback is free', async () => {
    for (const port of [25, 465, 587, 2465, 2587]) {
      expect(() => net.connect(port, 'smtp.mail-provider.example')).toThrow(/test network guard/);
    }
    expect(() => net.connect({ port: 587, host: 'smtp.resend.com' })).toThrow(/test network guard/);
    await expect(fetch('https://accounts.google.com/o/oauth2/v2/auth')).rejects.toThrow(/test network guard/);
    await expect(fetch('https://oauth2.googleapis.com/token', { method: 'POST' })).rejects.toThrow(/test network guard/);
    await expect(fetch('https://api.resend.com/emails', { method: 'POST' })).rejects.toThrow(/test network guard/);
    await expect(fetch('https://something.cloudflare.net/x')).rejects.toThrow(/test network guard/);
    const ok = await fetch(`${MAILPIT_API}/api/v1/info`);
    expect(ok.status).toBe(200);
  });
});
