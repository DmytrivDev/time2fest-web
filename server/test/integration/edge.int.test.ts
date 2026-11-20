/**
 * SPEC-05 server-side edge behaviour against the real Redis of this slot: origin check
 * (AC-15 … AC-17), forwarding headers ignored (AC-20), daily salt shared across processes
 * (AC-25), the `ipDay` rate-limit key (AC-28), cache headers (AC-32), public routes (AC-33).
 * In-process dispatcher, no server.
 */
import { randomBytes } from 'node:crypto';
import { PUBLIC_ROUTES } from '@time2fest/contracts';
import { Redis } from 'ioredis';
import { afterAll, describe, expect, it } from 'vitest';
import { buildDispatcher, edgeGateOf } from '../../src/container';
import { createDispatcher } from '../../src/endpoints/pipeline';
import type { Deps, RouteRow } from '../../src/endpoints/types';
import { utcDay } from '../../src/platform/fingerprint';
import type { RateLimitRow } from '../../src/platform/rateLimit';
import { DependencyUnavailable, type FastStore } from '../../src/ports';
import { middlewareRegistry, rateLimitMiddleware } from '../../src/registries/middleware';
import { routeRegistry } from '../../src/registries/routes';
import { BASE, ownRedis, silent, testDeps } from './helpers';

// Built at runtime (40 hex characters): no secret-looking literal in the test.
const SECRET = randomBytes(20).toString('hex');
const WRONG = randomBytes(20).toString('hex');
const CLIENT = '203.0.113.9;UA';
const redis = ownRedis();
const stamp = Date.now();

afterAll(async () => {
  await redis.deleteByPrefix('edge:salt:');
  await redis.deleteByPrefix('rl:it-');
  await redis.close();
});

const ok = (value: unknown = 1) => ({ ok: true as const, value });
const get = (path: string, headers: Record<string, string> = {}) => new Request(BASE + path, { headers });
const viaEdge = (path: string, headers: Record<string, string> = {}) =>
  get(path, { 'x-t2f-edge': SECRET, 'x-t2f-client': CLIENT, ...headers });

async function shape(res: Response) {
  const headers = [...res.headers.entries()].filter(([k]) => k !== 'date').sort(([a], [b]) => a.localeCompare(b));
  return { status: res.status, body: await res.text(), headers };
}

const probe = (key: string, path: string, extra: Partial<RouteRow> = {}): RouteRow => ({
  key,
  method: 'GET',
  path,
  handler: async (ctx) =>
    ok({
      country: ctx.client.country,
      edgeVerified: ctx.client.edgeVerified,
      addressPresent: ctx.client.addressPresent,
      ipDay: await ctx.client.ipDay(),
    }),
  ...extra,
});

function limited(deps: Deps, rows: readonly RateLimitRow[], routes: readonly RouteRow[]) {
  const middleware = middlewareRegistry.map((m) => (m.key === '30-rate-limit' ? rateLimitMiddleware(rows) : m));
  return createDispatcher({ routes, middleware, deps, edge: edgeGateOf(deps) });
}

type ProbeBody = { value: { country: string; ipDay: string } & Record<string, unknown> };

describe('edge origin check and client (real Redis)', () => {
  const classes: [string, Record<string, string>][] = [
    ['AC-15 rehearsal', { T2F_ENV: 'rehearsal', T2F_EDGE_SECRET: SECRET }],
    ['AC-16 test with a secret', { T2F_EDGE_SECRET: SECRET }],
  ];
  for (const [label, env] of classes) {
    it(`${label}: no secret or a wrong one → the response of an unknown path; the handler never runs`, async () => {
      let calls = 0;
      const spy: RouteRow = {
        key: 'spy',
        method: 'GET',
        path: '/api/spy',
        handler: async () => {
          calls += 1;
          return ok();
        },
      };
      const dispatch = await buildDispatcher(testDeps({ redis }, env), [...routeRegistry, spy]);
      const refused = [
        await shape(await dispatch(get('/api/time'))),
        await shape(await dispatch(get('/api/time', { 'x-t2f-edge': WRONG }))),
        await shape(await dispatch(get('/api/spy'))),
        await shape(await dispatch(get('/api/spy', { 'x-t2f-edge': WRONG }))),
      ];
      const nope = await shape(await dispatch(get('/api/nope')));
      const nopeWrong = await shape(await dispatch(get('/api/nope', { 'x-t2f-edge': WRONG })));
      expect(nope.status).toBe(404);
      for (const r of [...refused, nopeWrong]) expect(r).toEqual(nope);
      expect(calls).toBe(0);
      // Control: the valid secret reaches the handler.
      expect((await dispatch(viaEdge('/api/spy'))).status).toBe(200);
      expect(calls).toBe(1);
    });
  }

  it('AC-17: test class without a secret → /api/time answers 200 and the client is unverified', async () => {
    const deps = testDeps({ redis });
    const dispatch = createDispatcher({
      routes: [...routeRegistry, probe('probe', '/api/probe')],
      middleware: middlewareRegistry,
      deps,
      edge: edgeGateOf(deps),
    });
    expect((await dispatch(get('/api/time'))).status).toBe(200);
    const body = (await (await dispatch(get('/api/probe', { 'x-t2f-client': CLIENT }))).json()) as ProbeBody;
    expect(body.value).toMatchObject({ edgeVerified: false, addressPresent: false, country: 'unknown' });
  });

  it('AC-20: forwarding headers do not change the country or the ipDay value', async () => {
    const dispatch = await buildDispatcher(testDeps({ redis }, { T2F_EDGE_SECRET: SECRET }), [probe('probe', '/api/probe')]);
    const read = async (extra: Record<string, string>) =>
      ((await (await dispatch(viaEdge('/api/probe', extra))).json()) as ProbeBody).value;
    const base = await read({});
    expect(base.country).toBe('UA');
    expect(base.ipDay).toMatch(/^fp:/);
    for (const name of ['X-Forwarded-For', 'X-Real-IP', 'CF-Connecting-IP', 'True-Client-IP', 'Forwarded']) {
      expect(await read({ [name]: '198.51.100.200' })).toEqual(base);
    }
  });

  it('AC-25: two processes on one Redis → the same ipDay; the salt key lives ≤ 24 h', async () => {
    const env = { T2F_EDGE_SECRET: SECRET };
    const a = await buildDispatcher(testDeps({ redis }, env), [probe('probe', '/api/probe')]);
    const other = ownRedis();
    const b = await buildDispatcher(testDeps({ redis: other }, env), [probe('probe', '/api/probe')]);
    const read = async (d: typeof a) => ((await (await d(viaEdge('/api/probe'))).json()) as ProbeBody).value.ipDay;
    expect(await read(a)).toBe(await read(b));
    await other.close();

    const raw = new Redis(process.env.REDIS_URL as string, { keyPrefix: process.env.T2F_REDIS_PREFIX, lazyConnect: true });
    try {
      const ttl = await raw.pttl(`edge:salt:${utcDay(Date.now())}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(86_400_000);
    } finally {
      raw.disconnect();
    }
  });

  it('AC-28: ipDay limit 2 → the third request of one client is 429; three clients are all served', async () => {
    const row: RateLimitRow = { key: `it-edge-${stamp}`, limit: 2, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'fail-closed' };
    const route = probe('limited', '/api/limited', { rateLimit: row.key });
    const deps = testDeps({ redis }, { T2F_EDGE_SECRET: SECRET });
    const dispatch = limited(deps, [row], [route]);
    const from = (ip: string, xff: string) =>
      get('/api/limited', { 'x-t2f-edge': SECRET, 'x-t2f-client': `${ip};UA`, 'x-forwarded-for': xff });

    const same: Response[] = [];
    for (const xff of ['198.51.100.1', '198.51.100.2', '198.51.100.3']) same.push(await dispatch(from('203.0.113.50', xff)));
    expect(same.map((r) => r.status)).toEqual([200, 200, 429]);
    expect(((await (same[2] as Response).json()) as { error: { code: string } }).error.code).toBe('rate_limited');

    const other: number[] = [];
    for (const ip of ['203.0.113.51', '203.0.113.52', '203.0.113.53']) other.push((await dispatch(from(ip, '198.51.100.1'))).status);
    expect(other).toEqual([200, 200, 200]);
  });

  it('AC-32: cache headers — default and max-age raised to private, no-store; no-store kept; errors never cacheable', async () => {
    const withHeader = (key: string, value?: string): RouteRow => ({
      key,
      method: 'GET',
      path: `/api/cc/${key}`,
      handler: async () => {
        const headers = new Headers({ 'content-type': 'application/json' });
        if (value !== undefined) headers.set('cache-control', value);
        return new Response('{"ok":true,"value":1}', { headers });
      },
    });
    const row: RateLimitRow = { key: `it-edge-cc-${stamp}`, limit: 1, windowMs: 60_000, keys: ['subject'], onStoreDown: 'fail-closed' };
    const routes: RouteRow[] = [
      withHeader('none'),
      withHeader('age', 'max-age=60'),
      withHeader('store', 'no-store, max-age=0'),
      {
        key: 'boom',
        method: 'GET',
        path: '/api/cc/boom',
        handler: async () => {
          throw new Error('boom');
        },
      },
      { key: 'rl', method: 'GET', path: '/api/cc/rl', rateLimit: row.key, handler: async () => ok() },
    ];
    const dispatch = limited(testDeps({ redis }), [row], routes);
    const cc = async (path: string) => (await dispatch(get(path))).headers.get('cache-control');
    expect(await cc('/api/cc/none')).toBe('private, no-store');
    expect(await cc('/api/cc/age')).toBe('private, no-store');
    expect(await cc('/api/cc/store')).toBe('no-store, max-age=0');
    expect(await cc('/api/nope')).toContain('no-store');
    expect((await dispatch(get('/api/cc/boom'))).status).toBe(500);
    expect(await cc('/api/cc/boom')).toContain('no-store');
    await dispatch(get('/api/cc/rl'));
    const refused = await dispatch(get('/api/cc/rl'));
    expect(refused.status).toBe(429);
    expect(refused.headers.get('cache-control')).toContain('no-store');

    const fail = async (): Promise<never> => {
      throw new DependencyUnavailable('redis');
    };
    const down: FastStore = { incrWindow: fail, setIfAbsent: fail, get: fail, set: fail, del: fail, deleteByPrefix: fail };
    const closed = limited(testDeps({ redis: down }), [row], routes);
    const unavailable = await closed(get('/api/cc/rl'));
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get('cache-control')).toContain('no-store');
  });

  it('AC-33: a public route loses its Set-Cookie and logs one warning; the public production routes are exactly PUBLIC_ROUTES', async () => {
    const warnings: unknown[] = [];
    const log = {
      ...silent,
      warn: (e: unknown) => {
        warnings.push(e);
      },
    };
    const route: RouteRow = {
      key: 'pub',
      method: 'GET',
      path: '/api/pub',
      public: true,
      handler: async () =>
        new Response('{"ok":true,"value":1}', { headers: { 'set-cookie': 'a=b; Path=/', 'content-type': 'application/json' } }),
    };
    const deps = testDeps({ redis, log });
    const dispatch = createDispatcher({ routes: [route], middleware: middlewareRegistry, deps, edge: edgeGateOf(deps) });
    const res = await dispatch(get('/api/pub'));
    expect(res.status).toBe(200);
    expect(res.headers.has('set-cookie')).toBe(false);
    expect(warnings).toEqual([{ event: 'public-set-cookie', route: 'pub' }]);
    expect(routeRegistry.filter((r) => r.public).map((r) => r.path).sort()).toEqual(PUBLIC_ROUTES.map((r) => r.path).sort());
  });
});
