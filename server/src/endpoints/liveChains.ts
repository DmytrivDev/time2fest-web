/**
 * `GET /api/live/chains` (SPEC-12 AC-3, AC-10, AC-11): the bare `{version, at, chains}` body — no `ApiResult`
 * envelope — with `Cache-Control: public, max-age=10`. A public route (its path is in `PUBLIC_ROUTES`): the edge
 * caches it under the `t2f-live-chains` tag, the pipeline drops any `Set-Cookie`, and the body carries no subject
 * data. Query parameters are ignored. Transport only: the body is `readChains` of the live wiring at the server clock
 * (the same reader as the fan-out and the R2 copy). An unreadable store is a dependency failure the pipeline answers
 * 503 `unavailable` with `no-store` (the edge counts any non-2xx answer as a failure and serves its own copy).
 */
import { readChains } from '../live/snapshot';
import { liveOf } from './deps';
import type { RouteRow } from './types';

export const LIVE_CHAINS_CACHE_CONTROL = 'public, max-age=10';

export const liveChainsRoute: RouteRow = {
  key: 'live-chains',
  method: 'GET',
  path: '/api/live/chains',
  public: true,
  needs: ['db'],
  rateLimit: 'live-read',
  async handler(ctx) {
    const live = liveOf(ctx.deps);
    const body = await readChains({ store: live.store, events: live.events, cfg: live.cfg }, ctx.clock.now());
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': LIVE_CHAINS_CACHE_CONTROL },
    });
  },
};
