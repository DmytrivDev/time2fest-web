/**
 * `GET /api/realtime/token` (C1; AC-12 … AC-19): a Centrifugo connection token for the request's subject.
 * Not public (`Cache-Control: private, no-store` from the pipeline, no CORS); rate-limited (`realtime-token`).
 * Without a signing secret — possible only in the `test` class — it answers 503 `realtime-not-configured`.
 * Reaches its ports through `ctx.deps` only and never logs the token.
 */
import type { RealtimeReason } from '@time2fest/contracts';
import { issueRealtimeToken } from '../realtime/token';
import { realtimeOf, subjectsOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

const NOT_CONFIGURED: RealtimeReason = 'realtime-not-configured';

export const realtimeTokenRoute: RouteRow = {
  key: 'realtime-token',
  method: 'GET',
  path: '/api/realtime/token',
  rateLimit: 'realtime-token',
  async handler(ctx) {
    const realtime = realtimeOf(ctx.deps);
    if (realtime.signer === undefined) return failure('unavailable', { reason: NOT_CONFIGURED });
    return issueRealtimeToken(
      { resolver: subjectsOf(ctx.deps), signer: realtime.signer, clock: ctx.clock, random: realtime.random },
      ctx.req,
    );
  },
};
