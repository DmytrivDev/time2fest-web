import { ApiFailureSchema } from '@time2fest/contracts/schemas';
import { afterAll, describe, expect, it } from 'vitest';
import { createDispatcher } from '../../src/endpoints/pipeline';
import type { RouteRow } from '../../src/endpoints/types';
import type { RateLimitRow } from '../../src/platform/rateLimit';
import { middlewareRegistry, rateLimitMiddleware } from '../../src/registries/middleware';
import { BASE, ownRedis, testDeps } from './helpers';

const redis = ownRedis();

afterAll(async () => {
  await redis.deleteByPrefix('rl:it-');
  await redis.close();
});

describe('rate limits (real Redis)', () => {
  it('AC-49: the 4th request on a limit of 3 → 429 rate_limited with retryAfterMs > 0', async () => {
    const row: RateLimitRow = { key: `it-${Date.now()}`, limit: 3, windowMs: 60_000, keys: ['subject'], onStoreDown: 'fail-closed' };
    const route: RouteRow = { key: 'limited', method: 'GET', path: '/api/sample/limited', rateLimit: row.key, handler: async () => ({ ok: true, value: 1 }) };
    const middleware = middlewareRegistry.map((m) => (m.key === '30-rate-limit' ? rateLimitMiddleware([row]) : m));
    const dispatch = createDispatcher({ routes: [route], middleware, deps: testDeps({ redis }) });

    for (let i = 0; i < 3; i += 1) expect((await dispatch(new Request(`${BASE}/api/sample/limited`))).status).toBe(200);
    const res = await dispatch(new Request(`${BASE}/api/sample/limited`));
    expect(res.status).toBe(429);
    const body = ApiFailureSchema.parse(await res.json());
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterMs).toBeGreaterThan(0);
    expect(body.error.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('a route naming an unknown rate-limit row stops the dispatcher at startup', () => {
    const route: RouteRow = { key: 'bad', method: 'GET', path: '/api/sample/bad', rateLimit: 'nope', handler: async () => ({ ok: true, value: 1 }) };
    expect(() => createDispatcher({ routes: [route], middleware: middlewareRegistry, deps: testDeps({ redis }) })).toThrow(/unknown rate-limit row nope/);
  });
});
