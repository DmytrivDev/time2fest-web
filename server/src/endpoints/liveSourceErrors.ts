/**
 * `POST /api/live/source-errors` (SPEC-12 AC-42 … AC-45, NFR-4): a player reports that a source failed to play.
 * Transport only. The pipeline refuses a body over 1 KiB, a body outside the strict `SourceErrorReportSchema`
 * (a code outside `SOURCE_ERROR_CODES` included) with 400 `validation` `invalid-input` before the handler runs;
 * the `live-source-errors` row allows 10 reports a minute per daily fingerprint (429 beyond, counted only for
 * well-formed bodies). The handler refuses an unknown source, or a source of another event, the same way, without
 * queueing anything. A valid report only queues one ad-hoc check of the source (the queue holds a source once;
 * the poller asks it within 10 s, at most once per status cycle, never above the ad-hoc ceiling) and answers 202 —
 * also when the ceiling is spent. A report never changes a status (AC-45). Not public; never logs the ids.
 */
import type { SourceErrorReport } from '@time2fest/contracts';
import { SourceErrorReportSchema } from '@time2fest/contracts/schemas';
import { liveOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

/** Body limit of the route: 1 KiB (AC-42). */
export const SOURCE_ERROR_MAX_BODY_BYTES = 1_024;

export const liveSourceErrorsRoute: RouteRow = {
  key: 'live-source-errors',
  method: 'POST',
  path: '/api/live/source-errors',
  body: SourceErrorReportSchema,
  maxBodyBytes: SOURCE_ERROR_MAX_BODY_BYTES,
  needs: ['db'],
  rateLimit: 'live-source-errors',
  async handler(ctx) {
    const { eventId, sourceId } = ctx.body as SourceErrorReport;
    const live = liveOf(ctx.deps);
    const [source] = await live.store.sources({ sourceIds: [sourceId] });
    if (!source || source.eventId !== eventId) return failure('validation', { reason: 'invalid-input' });
    await live.store.addPendingCheck({ sourceId, at: ctx.clock.now() });
    return new Response(JSON.stringify({ ok: true, value: null }), {
      status: 202,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
};
