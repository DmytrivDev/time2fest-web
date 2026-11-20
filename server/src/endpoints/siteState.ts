/**
 * `GET /api/site/state` (SPEC-08 AC-3, AC-23): the bare `SiteState` snapshot — no `ApiResult` envelope — with
 * `Cache-Control: public, max-age=10`. A public route (its path is in `PUBLIC_ROUTES`): the edge caches it,
 * the pipeline drops any `Set-Cookie`, and the body carries no subject data. Query parameters are ignored.
 * Without a catalog season there is no snapshot: 503 `unavailable`, `no-store` (the edge counts any non-2xx
 * answer as a failure and serves its own copy).
 */
import { readSnapshot } from '../site/snapshot';
import { siteOf } from './deps';
import type { RouteRow } from './types';

export const SITE_STATE_CACHE_CONTROL = 'public, max-age=10';

export const siteStateRoute: RouteRow = {
  key: 'site-state',
  method: 'GET',
  path: '/api/site/state',
  public: true,
  needs: ['db'],
  rateLimit: 'site-read',
  async handler(ctx) {
    const read = await readSnapshot(siteOf(ctx.deps).snapshot);
    if (!read.ok) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'unavailable', reason: read.reason } }), {
        status: 503,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    return new Response(JSON.stringify(read.state), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': SITE_STATE_CACHE_CONTROL },
    });
  },
};
