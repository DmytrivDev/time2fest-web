/**
 * Auth wire vocabulary (SPEC-10). Types only: zod-free, re-exported from `index.ts`.
 * The service interface stays in `lib/api/contracts/auth.ts`; the schemas are in `auth.schemas.ts`.
 */

/** `ApiError.reason` values of the sign-in routes (additive to the generic codes). */
export const AUTH_REASONS = ['cancelled', 'email', 'expired', 'too-many', 'too-many-attempts', 'wait', 'wrong-code'] as const;
export type AuthReason = (typeof AUTH_REASONS)[number];

export type AuthCodeIntent = 'signin' | 'signup';

/** Why the `session` event on `user:#<id>` was published. */
export const SESSION_EVENT_REASONS = ['signed-in', 'signed-out', 'erased', 'pass-granted', 'pass-attached', 'pass-revoked', 'email-changed'] as const;
export type SessionEventReason = (typeof SESSION_EVENT_REASONS)[number];

/** Event `session` on channel `user:#<id>`. */
export interface SessionEvent {
  type: 'session';
  id: string;
  data: { reason: SessionEventReason };
}
