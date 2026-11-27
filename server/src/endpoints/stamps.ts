/**
 * Passport routes (SPEC-14 [А7], [А10]; AC-23, AC-34, AC-35, AC-37, NFR-4, NFR-7). Transport only:
 * - `POST /api/me/stamps` (`stamp-claim`): strict `stampClaimBody`, 1 KiB, `subject: 'required'` (the session's subject;
 *   a guest is created on the first write), rate row `stamp-claim` (60 a minute per subject, memory fallback). The
 *   body's `at` is accepted and never read (AC-11). Refusals: `conflict/claim-closed`, `not_found/unknown-event`,
 *   `forbidden/no-presence`, `unavailable` + `retryAfterMs`.
 * - `GET /api/me/stamps` (`stamps-list`): the session subject's stamps of the current season ordered by `grantedAt`;
 *   without a session → `[]`, no guest is created.
 * The claim route is the only route that writes `stamps` (the guest merge is the other writer, AC-34). Neither route
 * is public, so the pipeline answers `Cache-Control: private, no-store`. Nothing is logged.
 */
import type { PassportStamp } from '@time2fest/contracts';
import { stampClaimBody, type StampClaimBody } from '@time2fest/contracts/schemas';
import { presenceOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

/** Body limit of a claim (NFR-4). */
export const STAMP_CLAIM_MAX_BODY_BYTES = 1_024;

export const stampRoutes: readonly RouteRow[] = [
  {
    key: 'stamp-claim',
    method: 'POST',
    path: '/api/me/stamps',
    needs: ['db'],
    subject: 'required',
    body: stampClaimBody,
    maxBodyBytes: STAMP_CLAIM_MAX_BODY_BYTES,
    rateLimit: 'stamp-claim',
    async handler(ctx) {
      if (ctx.subject === undefined) return failure('unauthorized');
      const { eventId, source } = ctx.body as StampClaimBody;
      const out = await presenceOf(ctx.deps).stamps.claim({ subjectId: ctx.subject, eventId, source, now: ctx.clock.now() });
      if (out.ok) {
        const value: PassportStamp = out.stamp;
        return { ok: true, value };
      }
      const e = out.error;
      return e.code === 'unavailable' ? failure('unavailable', { retryAfterMs: e.retryAfterMs }) : failure(e.code, { reason: e.reason });
    },
  },
  {
    key: 'stamps-list',
    method: 'GET',
    path: '/api/me/stamps',
    needs: ['db'],
    async handler(ctx) {
      if (ctx.subject === undefined) {
        const none: PassportStamp[] = [];
        return { ok: true, value: none };
      }
      const value: PassportStamp[] = await presenceOf(ctx.deps).stamps.list(ctx.subject, ctx.clock.now());
      return { ok: true, value };
    },
  },
];
