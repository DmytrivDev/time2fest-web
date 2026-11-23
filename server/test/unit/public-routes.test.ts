/**
 * SPEC-08 AC-23 (server half): the routes marked `public: true` are exactly the addresses of `PUBLIC_ROUTES`,
 * the one list the edge Worker reads too. Fails both ways: a public route missing from the list, or a listed
 * address without a public route. Plus the shape of the `site-state` row (AC-3) and of the `live-chains` row
 * (SPEC-12 AC-3, AC-11).
 */
import { PUBLIC_ROUTES } from '@time2fest/contracts';
import { describe, expect, it } from 'vitest';
import { liveChainsRoute } from '../../src/endpoints/liveChains';
import { liveSourceErrorsRoute } from '../../src/endpoints/liveSourceErrors';
import { siteStateRoute } from '../../src/endpoints/siteState';
import { rateLimitRegistry } from '../../src/registries/rateLimits';
import { routeRegistry } from '../../src/registries/routes';

describe('public routes', () => {
  it('AC-23: the public: true rows of the route table equal the PUBLIC_ROUTES paths', () => {
    const served = routeRegistry.filter((r) => r.public).map((r) => `${r.method} ${r.path}`).sort();
    const listed = PUBLIC_ROUTES.map((r) => `GET ${r.path}`).sort();
    expect(served).toEqual(listed);
    expect(served.length).toBeGreaterThan(0);
  });

  it('AC-3: GET /api/site/state is a public, rate-limited database read', () => {
    expect(siteStateRoute).toMatchObject({ key: 'site-state', method: 'GET', path: '/api/site/state', public: true, needs: ['db'], rateLimit: 'site-read' });
    expect(siteStateRoute.body).toBeUndefined();
    const limit = rateLimitRegistry.find((r) => r.key === 'site-read');
    expect(limit?.onStoreDown).toBe('memory');
    expect(limit && (limit.limit * 60_000) / limit.windowMs).toBeGreaterThanOrEqual(600);
  });

  it('SPEC-12 AC-3, AC-11: GET /api/live/chains is a public, rate-limited read listed without parameters', () => {
    expect(liveChainsRoute).toMatchObject({ key: 'live-chains', method: 'GET', path: '/api/live/chains', public: true, needs: ['db'], rateLimit: 'live-read' });
    expect(liveChainsRoute.body).toBeUndefined();
    expect(PUBLIC_ROUTES.find((r) => r.key === 'live-chains')).toEqual({
      key: 'live-chains',
      path: '/api/live/chains',
      allowedParams: [],
      freshMs: 10_000,
      staleMs: 600_000,
      r2Copy: 'live/chains.json',
      cacheTag: 't2f-live-chains',
      r2MaxAgeMs: 86_400_000, // security S12-02: no R2 fallback copy older than 24 h
    });
    const limit = rateLimitRegistry.find((r) => r.key === 'live-read');
    expect(limit).toMatchObject({ limit: 600, windowMs: 60_000, keys: ['ipDay'], onStoreDown: 'memory' });
  });

  it('SPEC-12 AC-42, NFR-4: POST /api/live/source-errors is private, 1 KiB, 10 a minute per client', () => {
    expect(liveSourceErrorsRoute).toMatchObject({ method: 'POST', path: '/api/live/source-errors', maxBodyBytes: 1_024, rateLimit: 'live-source-errors' });
    expect(liveSourceErrorsRoute.public).toBeUndefined();
    const limit = rateLimitRegistry.find((r) => r.key === 'live-source-errors');
    expect(limit).toMatchObject({ limit: 10, windowMs: 60_000, keys: ['ipDay'] });
  });
});
