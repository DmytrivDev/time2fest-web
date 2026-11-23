/**
 * `GET /api/live/viewers` (SPEC-12 AC-60 … AC-62): the countries with at least three people now and, with
 * `viewersCount` on, the number of people on the site. Transport only: the aggregator answers from process memory
 * (presence re-read at most every 30 s); 503 `unavailable` only when presence never answered in this process.
 * Not public (`private, no-store` from the pipeline); rate-limited (`live-read`). Logs nothing.
 */
import { ok } from '@time2fest/contracts';
import { liveOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

export const liveViewersRoute: RouteRow = {
  key: 'live-viewers',
  method: 'GET',
  path: '/api/live/viewers',
  rateLimit: 'live-read',
  async handler(ctx) {
    const viewers = liveOf(ctx.deps).viewers;
    if (viewers === undefined) return failure('unavailable', { reason: 'realtime-not-configured' });
    const read = await viewers.aggregator.current();
    return read.ok ? ok(read.summary) : failure('unavailable');
  },
};
