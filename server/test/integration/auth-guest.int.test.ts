/**
 * SPEC-10 W31 — the subject of a request and the guest on first write, over the real pipeline (this slot's Postgres,
 * Redis; edge secret set). AC-3 (reads create no user), AC-4 (a `subject: 'required'` route creates one guest bound
 * to the device; the 61st from one client in 10 min → `rate_limited`, shared with `/api/auth/sign-in/anonymous`),
 * AC-30 (the subject comes from the session cookie: `ctx.subject`, the realtime token; `device` key reaches limits).
 */
import { randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { edgeGateOf } from '../../src/container';
import { createDispatcher } from '../../src/endpoints/pipeline';
import type { RouteRow } from '../../src/endpoints/types';
import type { RateLimitRow } from '../../src/platform/rateLimit';
import { rateLimitMiddleware, subjectMiddleware } from '../../src/registries/middleware';
import { rateLimitRegistry } from '../../src/registries/rateLimits';
import { buildAuthHarness, CookieJar, freshIp, makeCall, SESSION_COOKIE, sessionOf, signIn, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
let pool: pg.Pool;
let h: AuthHarness;

const usersSince = async (): Promise<number> =>
  ((await pool.query('SELECT count(*)::int AS n FROM users WHERE created_at >= $1', [started])).rows[0] as { n: number }).n;

const probeSubject = async (res: Response): Promise<string | null> => ((await res.json()) as { value: { subject: string | null } }).value.subject;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('rl:auth-guest-create:');
  await redis.deleteByPrefix('auth:rl:');
  await redis.close();
});

describe('AC-3: reads create no guest and no account', () => {
  it('100 get-session / public / plain requests without a session add no users row', async () => {
    const before = await usersSince();
    const paths = ['/api/auth/get-session', '/api/site/state', '/api/time'];
    for (let i = 0; i < 100; i += 1) {
      const res = await h.call(paths[i % paths.length]!, { jar: new CookieJar() });
      expect(res.status).toBeLessThan(500);
      expect(res.headers.getSetCookie().some((l) => l.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
    }
    expect(await usersSince()).toBe(before);
  });
});

describe('AC-4: guest on first write', () => {
  it('the write probe creates one guest bound to the device and sets its session; the next write reuses it', async () => {
    const jar = new CookieJar();
    const ip = freshIp();
    const first = await writeProbe(h, { jar, ip });
    expect(first.status).toBe(200);
    const subject = await probeSubject(first);
    expect(subject).toMatch(/^[0-9a-f-]{36}$/);
    expect(jar.get(SESSION_COOKIE)).toBeTruthy();
    const device = jar.get('t2f_device');
    expect(device).toMatch(/^[A-Za-z0-9_-]{22}$/);

    const row = (await pool.query('SELECT is_anonymous, device_id FROM users WHERE id = $1', [subject])).rows[0] as { is_anonymous: boolean; device_id: string };
    expect(row).toEqual({ is_anonymous: true, device_id: device });
    const sessions = (await pool.query('SELECT device_id FROM user_sessions WHERE user_id = $1', [subject])).rows as { device_id: string }[];
    expect(sessions).toEqual([{ device_id: device }]);

    const before = await usersSince();
    const second = await writeProbe(h, { jar, ip });
    expect(second.status).toBe(200);
    expect(await probeSubject(second)).toBe(subject);
    expect(await usersSince()).toBe(before);
    // The guest session reads as a guest (no user), with the guest id.
    expect(await sessionOf(h, jar)).toMatchObject({ user: null, guestId: subject });
  });

  it('60 guests per client in 10 min; the 61st → rate_limited with retryAfterMs, also on /api/auth/sign-in/anonymous', { timeout: 120_000 }, async () => {
    const ip = freshIp();
    const ids = new Set<string>();
    for (let i = 0; i < 60; i += 1) {
      const res = await writeProbe(h, { jar: new CookieJar(), ip });
      expect(res.status, `guest ${i + 1}`).toBe(200);
      ids.add((await probeSubject(res)) ?? '');
    }
    expect(ids.size).toBe(60);
    const before = await usersSince();
    const refused = await writeProbe(h, { jar: new CookieJar(), ip });
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { ok: false; error: { code: string; retryAfterMs?: number } };
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterMs).toBeGreaterThan(0);
    expect(body.error.retryAfterMs).toBeLessThanOrEqual(600_000);
    const viaAuth = await h.call('/api/auth/sign-in/anonymous', { body: {}, jar: new CookieJar(), ip });
    expect(viaAuth.status).toBe(429);
    expect(await usersSince()).toBe(before);
    // Another client is not affected.
    expect((await writeProbe(h, { jar: new CookieJar() })).status).toBe(200);
  });
});

describe('AC-30: the subject comes from the session cookie', () => {
  it('an account session: the write probe answers the account (no guest), the realtime token carries its id', async () => {
    const jar = new CookieJar();
    const signed = await signIn(h, redis, jar, testEmail('subject'));
    expect(signed.status).toBe(200);
    const account = (await sessionOf(h, jar)).user?.id;
    expect(account).toMatch(/^[0-9a-f-]{36}$/);
    const before = await usersSince();
    const probe = await writeProbe(h, { jar });
    expect(await probeSubject(probe)).toBe(account);
    expect(await usersSince()).toBe(before);

    const token = await h.call('/api/realtime/token', { jar });
    expect(token.status).toBe(200);
    const value = ((await token.json()) as { value: { token: string | null } }).value;
    expect(value.token).not.toBeNull();
    expect(decodeJwt(value.token!).sub).toBe(account);
  });

  it('a guest session: the realtime token carries the guest id; no session: no token', async () => {
    const jar = new CookieJar();
    const guest = await probeSubject(await writeProbe(h, { jar }));
    const token = ((await (await h.call('/api/realtime/token', { jar })).json()) as { value: { token: string | null } }).value.token;
    expect(decodeJwt(token!).sub).toBe(guest);
    const none = ((await (await h.call('/api/realtime/token', { jar: new CookieJar() })).json()) as { value: { token: string | null } }).value.token;
    expect(none).toBeNull();
  });

  it('a device-keyed limit counts two devices separately (the `device` key reaches 30-rate-limit)', async () => {
    const row: RateLimitRow = { key: `it-device-${randomUUID().slice(0, 8)}`, limit: 1, windowMs: 60_000, keys: ['device'], onStoreDown: 'fail-closed' };
    const route: RouteRow = { key: 'it-device', method: 'GET', path: '/api/it-device', rateLimit: row.key, handler: async () => ({ ok: true, value: null }) };
    const guestRow = rateLimitRegistry.filter((r) => r.key === 'auth-guest-create');
    const dispatch = createDispatcher({
      routes: [route],
      middleware: [subjectMiddleware(guestRow), rateLimitMiddleware([row])],
      deps: h.deps,
      edge: edgeGateOf(h.deps),
    });
    const secret = String(h.deps.env.vars.T2F_EDGE_SECRET);
    const call = makeCall(dispatch, secret);
    const ip = freshIp();
    const a = new CookieJar().set('t2f_device', 'AAAAAAAAAAAAAAAAAAAAAA');
    const b = new CookieJar().set('t2f_device', 'BBBBBBBBBBBBBBBBBBBBBB');
    expect((await call('/api/it-device', { jar: a, ip })).status).toBe(200);
    expect((await call('/api/it-device', { jar: b, ip })).status).toBe(200);
    expect((await call('/api/it-device', { jar: a, ip })).status).toBe(429);
    await redis.deleteByPrefix(`rl:${row.key}:`);
  });
});
