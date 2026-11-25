/**
 * Email rules of sign-in (SPEC-10 W13, EC-8), ring 1: pure, no I/O.
 * - `normalizeEmail` trims and lowercases before any comparison or limit; the format is the contracts rule
 *   (3 … 254 characters, exactly one `@`, no whitespace).
 * - `emailKey` is the HMAC-SHA256 hex of the normalized address under a server pepper (S10-06): limit and Redis keys
 *   never contain the address, and a guessed address cannot be confirmed without the server secret.
 */
import { createHmac } from 'node:crypto';

const MAX_EMAIL = 254;
const FORMAT = /^[^\s@]+@[^\s@]+$/;

/** The normalized address, or `undefined` when it breaks the format rule. */
export function normalizeEmail(raw: string): string | undefined {
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > MAX_EMAIL || !FORMAT.test(email)) return undefined;
  return email;
}

/** HMAC-SHA256 hex of the normalized address under `pepper` (callers normalize first). */
export function emailKey(email: string, pepper: string): string {
  return createHmac('sha256', pepper).update(email).digest('hex');
}
