/**
 * `/api/me/*` (SPEC-11 AC-58): own-subject routes. The subject is only ever the session's (`ctx.subject`); no body
 * or path carries a subject id (the strict body schema refuses one: `invalid-input`).
 * - `GET /api/me/profile` (W20): no guest is created for a read; without a session the defaults are returned.
 * - `PATCH /api/me/profile` (W20): `subject: 'required'` (a guest is created on the first write), 4 KiB, `me-profile`.
 * Schedule rows (W24): PUT / toggle / replace, `subject: 'required'`, 4 KiB, `me-schedule`; email and Google rows come later. Sorted by key.
 */
import type { ProfilePatchBody } from '@time2fest/contracts/schemas';
import { profilePatchBody, scheduleBody, scheduleReplaceBody, scheduleToggleBody } from '@time2fest/contracts/schemas';
import { rightsOf } from './deps';
import { failure } from './pipeline';
import type { RouteRow } from './types';

export const ME_BODY_MAX_BYTES = 4_096;

export const meRoutes: readonly RouteRow[] = [
  {
    key: 'me-profile-get',
    method: 'GET',
    path: '/api/me/profile',
    needs: ['db'],
    async handler(ctx) {
      const profiles = rightsOf(ctx.deps).profiles;
      if (ctx.subject === undefined) return { ok: true, value: await profiles.get('', ctx.client.country) };
      return { ok: true, value: await profiles.get(ctx.subject, ctx.client.country) };
    },
  },
  {
    key: 'me-profile-patch',
    method: 'PATCH',
    path: '/api/me/profile',
    needs: ['db'],
    subject: 'required',
    body: profilePatchBody,
    maxBodyBytes: ME_BODY_MAX_BYTES,
    rateLimit: 'me-profile',
    async handler(ctx) {
      if (ctx.subject === undefined) return failure('unauthorized');
      const { nick, flagCode, settings } = ctx.body as ProfilePatchBody;
      const res = await rightsOf(ctx.deps).profiles.patch(
        ctx.subject,
        { ...(nick !== undefined ? { nick } : {}), ...(flagCode !== undefined ? { flagCode } : {}), ...(settings !== undefined ? { settings } : {}) },
        ctx.client.country,
      );
      return res;
    },
  },
  {
    key: 'me-schedule-put',
    method: 'PUT',
    path: '/api/me/schedule',
    needs: ['db'],
    subject: 'required',
    body: scheduleBody,
    maxBodyBytes: ME_BODY_MAX_BYTES,
    rateLimit: 'me-schedule',
    async handler(ctx) {
      if (ctx.subject === undefined) return failure('unauthorized');
      return rightsOf(ctx.deps).schedule.set(ctx.subject, ctx.device, (ctx.body as { eventIds: string[] }).eventIds);
    },
  },
  {
    key: 'me-schedule-replace',
    method: 'POST',
    path: '/api/me/schedule/replace',
    needs: ['db'],
    subject: 'required',
    body: scheduleReplaceBody,
    maxBodyBytes: ME_BODY_MAX_BYTES,
    rateLimit: 'me-schedule',
    async handler(ctx) {
      if (ctx.subject === undefined) return failure('unauthorized');
      const b = ctx.body as { outIso: string; eventId: string };
      return rightsOf(ctx.deps).schedule.replace(ctx.subject, ctx.device, b.outIso, b.eventId);
    },
  },
  {
    key: 'me-schedule-toggle',
    method: 'POST',
    path: '/api/me/schedule/toggle',
    needs: ['db'],
    subject: 'required',
    body: scheduleToggleBody,
    maxBodyBytes: ME_BODY_MAX_BYTES,
    rateLimit: 'me-schedule',
    async handler(ctx) {
      if (ctx.subject === undefined) return failure('unauthorized');
      return rightsOf(ctx.deps).schedule.toggle(ctx.subject, ctx.device, (ctx.body as { eventId: string }).eventId);
    },
  },
];
