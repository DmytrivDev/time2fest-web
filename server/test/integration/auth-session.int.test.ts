/**
 * SPEC-10 W16 — sessions over the real pipeline (in-process dispatcher, this slot's Postgres and Redis, edge secret
 * set so every request carries its own client address). The code is captured from `sendOtp` (the code flow lands in
 * P9). Covers AC-1, AC-3, AC-14 (no token), AC-25, AC-26, AC-27, AC-28, AC-32 … AC-35, NFR-5.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { sessionSchema } from '@time2fest/contracts/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthWiring, type AuthWiring } from '../../src/auth/instance';
import { buildDispatcher } from '../../src/container';
import { SESSION_TTL_MS } from '../../src/domain/auth/sessionExpiry';
import type { Deps } from '../../src/endpoints/types';
import { DEVICE_MAX_AGE_S } from '../../src/platform/device';
import { BASE, ORIGIN, ownRedis, testDeps } from './helpers';
import { CookieJar } from '../support/fakeOidc';

const SECRET = randomBytes(20).toString('hex');
const RUN = randomUUID().slice(0, 8);
const SESSION = '__Secure-t2f.session_token';
const SEASON_END = Date.parse('2027-01-15T00:00:00Z');
const redis = ownRedis();
const otps = new Map<string, string>();
const anonIds: string[] = [];
let pool: pg.Pool;

const email = (name: string) => `${name}-${RUN}@t2f.test`;
/** A fresh client address per caller: Better Auth's own limiter keys on it (3 sign-ins / 10 s). */
const freshIp = () => `198.18.${randomBytes(1)[0]}.${randomBytes(1)[0]}`;

type Dispatch = (req: Request) => Promise<Response>;
type CallInit = { method?: string; body?: unknown; jar?: CookieJar; ip?: string; headers?: Record<string, string> };

function makeCall(dispatch: Dispatch) {
  return async (path: string, init: CallInit = {}): Promise<Response> => {
    const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
    const res = await dispatch(
      new Request(BASE + path, {
        method,
        headers: {
          'x-t2f-edge': SECRET,
          'x-t2f-client': `${init.ip ?? freshIp()};UA`,
          ...(method === 'GET' ? {} : { origin: ORIGIN, 'content-type': 'application/json' }),
          ...(init.jar?.headers() ?? {}),
          ...(init.headers ?? {}),
        },
        ...(method === 'GET' ? {} : { body: JSON.stringify(init.body ?? {}) }),
      }),
    );
    init.jar?.store(res);
    return res;
  };
}

async function build(now?: () => number): Promise<{ deps: Deps; wiring: AuthWiring; dispatch: Dispatch; call: ReturnType<typeof makeCall> }> {
  const deps = testDeps({ redis }, { T2F_EDGE_SECRET: SECRET });
  const wiring = createAuthWiring({
    env: deps.env,
    redis,
    sendOtp: async ({ email: to, otp }) => {
      otps.set(to, otp);
    },
    ...(now ? { now } : {}),
  });
  deps.auth = wiring;
  const dispatch = await buildDispatcher(deps);
  return { deps, wiring, dispatch, call: makeCall(dispatch) };
}

let main: Awaited<ReturnType<typeof build>>;

async function signIn(call: ReturnType<typeof makeCall>, jar: CookieJar, to: string, ua?: string): Promise<Response> {
  const ip = freshIp();
  const headers = ua ? { 'user-agent': ua } : undefined;
  const sent = await call('/api/auth/email-otp/send-verification-otp', { body: { email: to, type: 'sign-in' }, jar, ip, ...(headers ? { headers } : {}) });
  expect(sent.status).toBe(200);
  const otp = otps.get(to);
  expect(otp).toMatch(/^\d{6}$/);
  return call('/api/auth/sign-in/email-otp', { body: { email: to, otp }, jar, ip, ...(headers ? { headers } : {}) });
}

async function session(call: ReturnType<typeof makeCall>, jar: CookieJar) {
  const res = await call('/api/auth/get-session', { jar });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok: true; value: unknown };
  return sessionSchema.parse(body.value);
}

const sessionLine = (res: Response) => res.headers.getSetCookie().filter((l) => l.startsWith(`${SESSION}=`)).at(-1) ?? '';
const userCount = async () => ((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0] as { n: number }).n;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  main = await build();
});

afterAll(async () => {
  await pool.query(`DELETE FROM users WHERE email LIKE $1 OR id = ANY($2::uuid[])`, [`%-${RUN}@t2f.test`, anonIds]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.close();
});

describe('device cookie (AC-1)', () => {
  it('a non-public response to a request without t2f_device sets it with the required attributes; the next request gets none', async () => {
    const jar = new CookieJar();
    const first = await main.call('/api/auth/get-session', { jar });
    const line = first.headers.getSetCookie().find((l) => l.startsWith('t2f_device='));
    expect(line).toBeDefined();
    const attrs = line!.split(';').map((p) => p.trim());
    expect(attrs[0]).toMatch(/^t2f_device=[A-Za-z0-9_-]{22}$/);
    expect(attrs.slice(1).sort()).toEqual(['HttpOnly', `Max-Age=${DEVICE_MAX_AGE_S}`, 'Path=/', 'SameSite=Lax', 'Secure'].sort());
    expect(DEVICE_MAX_AGE_S).toBe(400 * 86400);
    expect(line!.toLowerCase()).not.toContain('domain=');

    const second = await main.call('/api/time', { jar });
    expect(second.headers.getSetCookie().some((l) => l.startsWith('t2f_device='))).toBe(false);
    // A forged cookie of another shape is ignored and replaced.
    const forged = await main.call('/api/time', { jar: new CookieJar().set('t2f_device', 'short') });
    expect(forged.headers.getSetCookie().some((l) => /^t2f_device=[A-Za-z0-9_-]{22};/.test(l))).toBe(true);
  });

  it('a public route never sets it', async () => {
    const res = await main.call('/api/site/state');
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});

describe('no row without a session (AC-3)', () => {
  it('100 get-session calls without a session (with and without a device) create no user', async () => {
    const before = await userCount();
    const jar = new CookieJar();
    for (let i = 0; i < 100; i++) {
      const res = await main.call('/api/auth/get-session', i % 2 === 0 ? { jar } : {});
      expect(res.status).toBe(200);
    }
    for (let i = 0; i < 5; i++) await main.call('/api/site/state');
    expect(await userCount()).toBe(before);
    const s = await session(main.call, jar);
    expect(s).toEqual({ user: null, guestId: jar.get('t2f_device'), hasPass: false, passOn: null, passSince: null, devicePass: null, code: null });
  });
});

describe('sign-in session (AC-14, AC-26, AC-35, NFR-5)', () => {
  it('sets the __Secure- cookie, no token in the body, session row without IP, UA ≤128, device id stored', async () => {
    const jar = new CookieJar();
    const to = email('sess');
    const res = await signIn(main.call, jar, to, 'U'.repeat(300));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; value: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.value).not.toHaveProperty('token');
    expect(JSON.stringify(body)).not.toContain(jar.get(SESSION)!.split('.')[0]!);

    const line = sessionLine(res);
    const attrs = line.split(';').map((p) => p.trim().toLowerCase());
    expect(attrs).toEqual(expect.arrayContaining(['httponly', 'secure', 'samesite=lax', 'path=/']));
    expect(attrs.some((a) => a.startsWith('domain='))).toBe(false);

    const row = (
      await pool.query(
        'SELECT s.ip_address, s.user_agent, s.device_id, s.expires_at FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1',
        [to],
      )
    ).rows[0] as { ip_address: string | null; user_agent: string; device_id: string; expires_at: Date };
    expect(row.ip_address ?? '').toBe('');
    expect(row.user_agent).toHaveLength(128);
    expect(row.device_id).toBe(jar.get('t2f_device'));

    const s = await session(main.call, jar);
    expect(s.user).toMatchObject({ email: to, via: 'email' });
    expect(s.guestId).toBe(jar.get('t2f_device'));
    expect(s.hasPass).toBe(false);
    const gs = await main.call('/api/auth/get-session', { jar });
    expect(JSON.stringify(await gs.json())).not.toContain('token');
  });

  for (const [label, nowIso, expected] of [
    ['before the season end → season end', '2027-01-05T00:00:00Z', SEASON_END],
    ['after the season end → now + 60 days', '2027-02-01T00:00:00Z', Date.parse('2027-02-01T00:00:00Z') + SESSION_TTL_MS],
  ] as const) {
    it(`AC-26 ${label}`, async () => {
      const now = Date.parse(nowIso);
      const { call } = await build(() => now);
      const jar = new CookieJar();
      const to = email(`exp${now}`);
      const res = await signIn(call, jar, to);
      expect(res.status).toBe(200);
      const row = (await pool.query('SELECT s.expires_at FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1', [to])).rows[0] as {
        expires_at: Date;
      };
      expect(row.expires_at.getTime()).toBe(expected);
      const maxAge = /max-age=(\d+)/i.exec(sessionLine(res))?.[1];
      expect(Number(maxAge)).toBe(Math.floor((expected - now) / 1000));
      const expires = /expires=([^;]+)/i.exec(sessionLine(res))?.[1];
      expect(Date.parse(expires!)).toBe(now + Number(maxAge) * 1000);
    });
  }
});

describe('revoke and sign-out (AC-25, AC-27, AC-28)', () => {
  it('AC-27 a revoked session answers as no session; AC-25 signing in with the dead cookie keeps the new one', async () => {
    const jar = new CookieJar();
    const to = email('revoke');
    expect((await signIn(main.call, jar, to)).status).toBe(200);
    const dead = jar.get(SESSION)!;
    const s = await session(main.call, jar);
    await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [s.user!.id]);

    const after = await session(main.call, jar);
    expect(after.user).toBeNull();
    expect(jar.get(SESSION)).toBeUndefined();

    jar.set(SESSION, dead);
    const again = await signIn(main.call, jar, to);
    expect(again.status).toBe(200);
    expect(sessionLine(again)).not.toMatch(/max-age=0\b/i);
    expect((await session(main.call, jar)).user?.email).toBe(to);
  });

  it('AC-28 signing out on device A keeps the session on device B', async () => {
    const to = email('twodev');
    const a = new CookieJar();
    const b = new CookieJar();
    expect((await signIn(main.call, a, to)).status).toBe(200);
    expect((await signIn(main.call, b, to)).status).toBe(200);
    expect(a.get('t2f_device')).not.toBe(b.get('t2f_device'));
    const out = await main.call('/api/auth/sign-out', { method: 'POST', body: {}, jar: a });
    expect(out.status).toBe(200);
    expect((await session(main.call, a)).user).toBeNull();
    expect((await session(main.call, b)).user?.email).toBe(to);
    // The device cookie survives the sign-out (AC-2 precondition).
    expect(a.get('t2f_device')).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('edge, origin and mounted paths (AC-32 … AC-34)', () => {
  it('AC-32 forged client address headers do not change Better Auth\'s limiter key', async () => {
    const ip = freshIp();
    const forged: Record<string, string>[] = [
      { 'x-forwarded-for': '1.1.1.1' },
      { 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3' },
      { 'x-t2f-ip': 'fd00::1', forwarded: 'for=4.4.4.4' },
      { 'x-forwarded-for': '5.5.5.5', 'x-t2f-ip': 'fd00::2' },
    ];
    const statuses: number[] = [];
    for (const headers of forged) {
      const res = await main.call('/api/auth/sign-in/anonymous', { method: 'POST', body: {}, ip, headers });
      statuses.push(res.status);
      if (res.status === 200) {
        const body = (await res.json()) as { value: { user: { id: string }; token?: string } };
        expect(body.value.token).toBeUndefined();
        anonIds.push(body.value.user.id);
      } else {
        const body = (await res.json()) as { error: { code: string; retryAfterMs?: number } };
        expect(body.error.code).toBe('rate_limited');
        expect(body.error.retryAfterMs).toBeGreaterThan(0);
      }
    }
    // Better Auth's sign-in rule: 3 per 10 s per address — all four count against the one edge address.
    expect(statuses).toEqual([200, 200, 200, 429]);
    // Control: another edge address is a separate bucket.
    const other = await main.call('/api/auth/sign-in/anonymous', { method: 'POST', body: {}, ip: freshIp(), headers: forged[0] });
    expect(other.status).toBe(200);
    anonIds.push(((await other.json()) as { value: { user: { id: string } } }).value.user.id);
    const ips = (await pool.query('SELECT ip_address FROM user_sessions WHERE user_id = ANY($1::uuid[])', [anonIds])).rows as { ip_address: string | null }[];
    expect(ips.length).toBeGreaterThan(0);
    for (const r of ips) expect(r.ip_address ?? '').toBe('');
  });

  it('AC-33 a foreign Origin (or none) on a POST → 403', async () => {
    for (const origin of ['https://evil.example', undefined]) {
      const headers: Record<string, string> = origin ? { origin } : {};
      const res = await main.dispatch(
        new Request(BASE + '/api/auth/sign-out', {
          method: 'POST',
          headers: { 'x-t2f-edge': SECRET, 'x-t2f-client': `${freshIp()};UA`, 'content-type': 'application/json', ...headers },
          body: '{}',
        }),
      );
      expect(res.status).toBe(403);
    }
    const otp = await main.call('/api/auth/email-otp/send-verification-otp', {
      body: { email: email('evil'), type: 'sign-in' },
      headers: { origin: 'https://evil.example' },
    });
    expect(otp.status).toBe(403);
    expect(otps.has(email('evil'))).toBe(false);
  });

  it('AC-34 paths outside the list → 404', async () => {
    for (const path of ['/api/auth/sign-up/email', '/api/auth/delete-user', '/api/auth/change-email', '/api/auth/list-sessions', '/api/auth/ok']) {
      const res = await main.call(path, { method: 'POST', body: {} });
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: { code: 'not_found' } });
    }
    expect((await main.call('/api/auth/list-sessions')).status).toBe(404);
  });
});
