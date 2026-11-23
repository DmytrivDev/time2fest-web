/**
 * `GET /api/live/viewer-token` (SPEC-12 AC-59, AC-61, [П-2]): the `live:viewers` subscription token of the one
 * lock-holder tab of a browser. The country is the edge gate's `ctx.client.country` (Cloudflare's IP country;
 * `XX`, `T1`, absent → no country); the address never reaches this route. Not public (`private, no-store` from the
 * pipeline, no CORS); rate-limited (`live-viewer-token`); 503 `realtime-not-configured` without the token secret.
 * Never logs the token or the country.
 */
import { issueViewerToken } from '../live/viewers';
import { liveOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

export const liveViewerTokenRoute: RouteRow = {
  key: 'live-viewer-token',
  method: 'GET',
  path: '/api/live/viewer-token',
  rateLimit: 'live-viewer-token',
  async handler(ctx) {
    const viewers = liveOf(ctx.deps).viewers;
    if (viewers === undefined) return failure('unavailable', { reason: 'realtime-not-configured' });
    return issueViewerToken(viewers.token, ctx.client.country);
  },
};
