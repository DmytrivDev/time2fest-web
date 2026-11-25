/**
 * `/api/me/*` (SPEC-11 AC-58): own-subject routes. The subject is only ever the session's (`ctx.subject`); no body
 * or path carries a subject id (the strict body schema refuses one: `invalid-input`).
 * - `GET /api/me/profile` (W20): no guest is created for a read; without a session the defaults are returned.
 * - `PATCH /api/me/profile` (W20): `subject: 'required'` (a guest is created on the first write), 4 KiB, `me-profile`.
 * Schedule, email and Google rows are added by later phases. Sorted by key.
 */
import type { ProfilePatchBody } from '@time2fest/contracts/schemas';
import { profilePatchBody } from '@time2fest/contracts/schemas';
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
];
