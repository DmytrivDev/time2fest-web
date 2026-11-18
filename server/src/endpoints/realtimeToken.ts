/**
 * `GET /api/realtime/token` (C1; AC-12 … AC-19): a Centrifugo connection token for the request's subject.
 * Not public (`Cache-Control: private, no-store` from the pipeline, no CORS); rate-limited (`realtime-token`).
 * The use case decides every answer, including 503 `realtime-not-configured` without a signing secret.
 * Reaches its ports through `ctx.deps` only and never logs the token.
 */
import { issueRealtimeToken } from '../realtime/token';
import { realtimeOf, subjectsOf } from './deps';
import type { RouteRow } from './types';

export const realtimeTokenRoute: RouteRow = {
  key: 'realtime-token',
  method: 'GET',
  path: '/api/realtime/token',
  rateLimit: 'realtime-token',
  async handler(ctx) {
    const realtime = realtimeOf(ctx.deps);
    return issueRealtimeToken(
      { resolver: subjectsOf(ctx.deps), signer: realtime.signer, clock: ctx.clock, random: realtime.random },
      ctx.req,
    );
  },
};
