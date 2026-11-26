/**
 * `/api/me/email*` and `/api/me/google` (SPEC-11 W31, W32; AC-43 … AC-48, AC-58): account-only routes of the session's
 * own subject. No row creates a guest (no `subject: 'required'`): without a session, or for a guest →
 * `unauthorized`. Every answer of the email rows and of unlink is the fresh profile (`pendingEmail`, `googleLinked`);
 * link answers `{kind:'redirect', url}` (full navigation to Google, back on `returnPath`).
 * - `POST /api/me/email {email}`: the body is read here (not by the row schema) so a malformed address answers
 *   `validation/email` (AC-43), a body with any other key `validation/invalid-input`; limits = the SPEC-10 code limits
 *   of the new address (`rights/emailChange.ts`).
 * - `POST /api/me/email/verify {code}`, `DELETE /api/me/email`, `POST|DELETE /api/me/google`: `me-profile` limit
 *   (30 per minute per subject, [А13]).
 * Sorted by key.
 */
import { emailVerifyBody, googleLinkBody } from '@time2fest/contracts/schemas';
import { emailChangePorts, startGoogleLink, unlinkGoogle } from '../auth/link';
import { createEmailChangeService } from '../rights/emailChange';
import { rightsOf } from './deps';
import { failure, readBodyBytes } from './pipeline';
import type { Ctx, Outcome, RouteRow } from './types';

const ACCOUNT_BODY_MAX_BYTES = 4_096;

/** The account id of the session, or `undefined` for no session / a guest. */
function accountOf(ctx: Ctx): string | undefined {
  return ctx.subject !== undefined && ctx.subjectKind === 'account' ? ctx.subject : undefined;
}

async function profileOf(ctx: Ctx, account: string): Promise<Outcome> {
  return { ok: true, value: await rightsOf(ctx.deps).profiles.get(account, ctx.client.country) };
}

/** `{email}` of the request body: `undefined` = not that shape (→ `invalid-input`). */
async function emailOfBody(ctx: Ctx): Promise<string | undefined> {
  const bytes = await readBodyBytes(ctx.req, ACCOUNT_BODY_MAX_BYTES);
  if (bytes === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const keys = Object.keys(raw);
  const email = (raw as { email?: unknown }).email;
  if (keys.length !== 1 || keys[0] !== 'email' || typeof email !== 'string' || email.length > 1024) return undefined;
  return email;
}

async function emailChange(ctx: Ctx) {
  return createEmailChangeService(await emailChangePorts(ctx));
}

export const meAccountRoutes: readonly RouteRow[] = [
  {
    key: 'me-email-cancel',
    method: 'DELETE',
    path: '/api/me/email',
    needs: ['db'],
    rateLimit: 'me-profile',
    async handler(ctx) {
      const account = accountOf(ctx);
      if (account === undefined) return failure('unauthorized');
      const res = await (await emailChange(ctx)).cancel(account);
      return res.ok ? profileOf(ctx, account) : res;
    },
  },
  {
    key: 'me-email-request',
    method: 'POST',
    path: '/api/me/email',
    needs: ['db'],
    maxBodyBytes: ACCOUNT_BODY_MAX_BYTES,
    async handler(ctx) {
      const account = accountOf(ctx);
      if (account === undefined) return failure('unauthorized');
      const email = await emailOfBody(ctx);
      if (email === undefined) return failure('validation', { reason: 'invalid-input' });
      const res = await (await emailChange(ctx)).request(account, email);
      return res.ok ? profileOf(ctx, account) : res;
    },
  },
  {
    key: 'me-email-verify',
    method: 'POST',
    path: '/api/me/email/verify',
    needs: ['db'],
    body: emailVerifyBody,
    maxBodyBytes: ACCOUNT_BODY_MAX_BYTES,
    rateLimit: 'me-profile',
    async handler(ctx) {
      const account = accountOf(ctx);
      if (account === undefined) return failure('unauthorized');
      const res = await (await emailChange(ctx)).verify(account, (ctx.body as { code: string }).code);
      return res.ok ? profileOf(ctx, account) : res;
    },
  },
  {
    key: 'me-google-link',
    method: 'POST',
    path: '/api/me/google',
    needs: ['db'],
    body: googleLinkBody,
    maxBodyBytes: ACCOUNT_BODY_MAX_BYTES,
    rateLimit: 'me-profile',
    async handler(ctx) {
      const account = accountOf(ctx);
      if (account === undefined) return failure('unauthorized');
      return startGoogleLink(ctx, account, (ctx.body as { returnPath: string }).returnPath);
    },
  },
  {
    key: 'me-google-unlink',
    method: 'DELETE',
    path: '/api/me/google',
    needs: ['db'],
    rateLimit: 'me-profile',
    async handler(ctx) {
      const account = accountOf(ctx);
      if (account === undefined) return failure('unauthorized');
      const res = await unlinkGoogle(ctx.deps, account);
      return res.ok ? profileOf(ctx, account) : res;
    },
  },
];
