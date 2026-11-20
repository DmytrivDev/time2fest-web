/**
 * SPEC-08 AC-23 (server half): the routes marked `public: true` are exactly the addresses of `PUBLIC_ROUTES`,
 * the one list the edge Worker reads too. Fails both ways: a public route missing from the list, or a listed
 * address without a public route. Plus the shape of the `site-state` row (AC-3).
 */
import { PUBLIC_ROUTES } from '@time2fest/contracts';
import { describe, expect, it } from 'vitest';
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
});
