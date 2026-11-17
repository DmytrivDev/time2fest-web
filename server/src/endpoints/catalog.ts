/**
 * `GET /api/catalog` (AC-63, AC-65): the catalog in the shape of the data files, for the site build.
 * No body, no session; rate-limited (`catalog-read`). Reaches the store through `ctx.deps`.
 */
import { readCatalog } from '../catalog/service';
import { catalogStoreOf } from './deps';
import type { RouteRow } from './types';

export const catalogRoute: RouteRow = {
  key: 'catalog',
  method: 'GET',
  path: '/api/catalog',
  needs: ['db'],
  rateLimit: 'catalog-read',
  async handler(ctx) {
    return readCatalog(catalogStoreOf(ctx.deps));
  },
};
