/**
 * `/api/auth/*` (SPEC-10 W15, [П-1]): one exact row per allowed Better Auth path; every row forwards through
 * `auth/forward.ts`. Any other `/api/auth/*` path is the dispatcher's single 404 (AC-34). No row is public, so cookies
 * survive `finalize`; POST rows pass `10-origin` (foreign `Origin` → 403, AC-33) before Better Auth sees them.
 * `/sign-in/anonymous` is not mounted (S10-08): guests are created only server-side by `25-subject`.
 * Rows carry no `body` schema: the forwarder reads the body itself (4 KiB) and the code flow validates (W24).
 */
import { AUTH_MAX_BODY_BYTES, forwardToAuth } from '../auth/forward';
import type { HttpMethod, RouteRow } from './types';

const row = (key: string, method: HttpMethod, path: string, rateLimit?: string): RouteRow => ({
  key,
  method,
  path: `/api/auth${path}`,
  needs: ['db'],
  maxBodyBytes: AUTH_MAX_BODY_BYTES,
  ...(rateLimit !== undefined ? { rateLimit } : {}),
  handler: forwardToAuth,
});

/** Sorted by key (registry order). */
export const authRoutes: readonly RouteRow[] = [
  row('auth-callback-google', 'GET', '/callback/google'),
  row('auth-get-session', 'GET', '/get-session'),
  row('auth-send-otp', 'POST', '/email-otp/send-verification-otp'),
  row('auth-sign-in-email-otp', 'POST', '/sign-in/email-otp'),
  row('auth-sign-in-social', 'POST', '/sign-in/social'),
  row('auth-sign-out', 'POST', '/sign-out'),
];
