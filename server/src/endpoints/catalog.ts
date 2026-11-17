/**
 * `GET /api/catalog` (AC-63, AC-65): the catalog in the shape of the data files, for the site build.
 * No body, no session; rate-limited (`catalog-read`). Reaches the store through the composition root,
 * loaded on first use (the root imports the route registry).
 */
import type { RouteRow } from './types';

export const catalogRoute: RouteRow = {
  key: 'catalog',
  method: 'GET',
  path: '/api/catalog',
  needs: ['db'],
  rateLimit: 'catalog-read',
  async handler(ctx) {
    const [{ catalogStoreOf }, { readCatalog }] = await Promise.all([import('../container'), import('../catalog/service')]);
    return readCatalog(catalogStoreOf(ctx.deps));
  },
};
