/**
 * Sign-in methods and the pending email change (SPEC-11 W30; AC-43, AC-48, [А11], [А12]), ring 1: pure, no I/O.
 * - `signInMethods`: the ways an account can still sign in — `email` when it is not a guest and its address is verified
 *   (the code sign-in has no `user_accounts` row, research-better-auth §4), plus every provider row it has.
 * - `canUnlink(methods, provider)`: refuse only when that provider is the sole method (`conflict/last-method`).
 * - Email-change value codec: `<email>:<sha256(code)>:<attemptsLeft>:<sentAt>` in `auth_verifications.value`; the
 *   address may itself contain `:`, so it is everything before the last three fields.
 */

export interface SignInMethodsInput {
  isAnonymous: boolean;
  emailVerified: boolean;
  providerIds: readonly string[];
}

/** The account's sign-in methods, unique, `email` first. */
export function signInMethods({ isAnonymous, emailVerified, providerIds }: SignInMethodsInput): string[] {
  const out = new Set<string>();
  if (!isAnonymous && emailVerified) out.add('email');
  for (const p of providerIds) if (p !== '' && p !== 'credential') out.add(p);
  return [...out];
}

/** Whether `provider` may be removed: it must not be the only method left. */
export function canUnlink(methods: readonly string[], provider: string): boolean {
  return methods.some((m) => m !== provider);
}

/** Identifier of the pending email change of an account in `auth_verifications`. */
export const emailChangeIdentifier = (userId: string): string => `t2f-change-email-${userId}`;

export interface EmailChangeValue {
  email: string;
  /** sha256 hex of the code. */
  hash: string;
  attemptsLeft: number;
  sentAt: number;
}

export function encodeEmailChange(v: EmailChangeValue): string {
  return `${v.email}:${v.hash}:${v.attemptsLeft}:${v.sentAt}`;
}

/** The decoded value, or `undefined` for a malformed one. */
export function decodeEmailChange(raw: unknown): EmailChangeValue | undefined {
  if (typeof raw !== 'string') return undefined;
  const parts = raw.split(':');
  if (parts.length < 4) return undefined;
  const sentAt = Number(parts.pop());
  const attemptsLeft = Number(parts.pop());
  const hash = parts.pop() ?? '';
  const email = parts.join(':');
  if (email === '' || !/^[0-9a-f]{64}$/.test(hash)) return undefined;
  if (!Number.isInteger(attemptsLeft) || attemptsLeft < 0 || !Number.isInteger(sentAt) || sentAt < 0) return undefined;
  return { email, hash, attemptsLeft, sentAt };
}
