/**
 * `POST /api/presence` (SPEC-14 AC-1 … AC-9, AC-11, NFR-4, NFR-5, NFR-7): the presence beat. Transport only: the strict
 * body (`presenceBeatBody`, any other field — player state included — is `validation`/`invalid-input`), 1 KiB limit,
 * the `presence-beat` rate row (12 a minute per subject, memory when Redis is down, AC-5). The subject is the session's
 * (a guest is created on the first beat, [А15]); `openedAt` is accepted as a hint and never read (AC-11). Redis
 * failures are handled inside the service ([П-3]): the route needs only the database. Not public, so the pipeline
 * answers `Cache-Control: private, no-store`. Logs nothing.
 */
import type { PresenceBeatResponse } from '@time2fest/contracts';
import { presenceBeatBody, type PresenceBeatBody } from '@time2fest/contracts/schemas';
import { presenceOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

/** Body limit of the beat (NFR-4). */
export const PRESENCE_BEAT_MAX_BODY_BYTES = 1_024;

export const presenceBeatRoute: RouteRow = {
  key: 'presence-beat',
  method: 'POST',
  path: '/api/presence',
  needs: ['db'],
  subject: 'required',
  body: presenceBeatBody,
  maxBodyBytes: PRESENCE_BEAT_MAX_BODY_BYTES,
  rateLimit: 'presence-beat',
  async handler(ctx) {
    if (ctx.subject === undefined) return failure('unauthorized');
    const { eventIds, source } = ctx.body as PresenceBeatBody;
    const out = await presenceOf(ctx.deps).beats.beat({ subjectId: ctx.subject, eventIds, source, receivedAt: ctx.clock.now() });
    if (!out.ok) return failure('unavailable', { retryAfterMs: out.retryAfterMs });
    const value: PresenceBeatResponse = { nextBeatMs: out.nextBeatMs };
    return { ok: true, value };
  },
};
