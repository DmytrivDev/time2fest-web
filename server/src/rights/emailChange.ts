/**
 * Email change of an account (SPEC-11 W31, [П-11], [А11]; AC-43 … AC-45, EC-4). Our own flow, not Better Auth's
 * built-in one (it is silent about a taken address, DR-4):
 * - `request(account, raw)`: normalize (bad → `validation/email`); the account's own address → `validation/same-email`;
 *   another user's address → `conflict/taken`; the SPEC-10 code limits keyed by the NEW address (30 s gap →
 *   `rate_limited/wait`, 5 per 10 min / 10 per day → `too-many`); one pending change per account (a new request
 *   replaces it); the code is stored hashed (`<email>:<sha256>:<attemptsLeft>:<sentAt>`, identifier
 *   `t2f-change-email-<id>`) and mailed to the new address with `changeEmailCode`. Mail outcome as SPEC-10 [П-8]:
 *   both providers down → pending removed, limits given back, `unavailable`; recipient refused → pending removed,
 *   counted, `validation/email`.
 * - `verify(account, code)`: the pending row is CONSUMED atomically first (a parallel verify gets nothing →
 *   `conflict/expired`); a wrong code puts it back with one try less (`validation/wrong-code` + `attemptsLeft`), the
 *   5th wrong try leaves it gone (`rate_limited/too-many-attempts`); a right code sets the email (verified) — a unique
 *   violation on `users.email` (someone took the address meanwhile) → `conflict/taken`; the sign-in code of the old
 *   address is deleted; `session` (`email-changed`) and `profile` are published. No pass is attached here (EC-4: the
 *   next sign-in does it).
 * - `cancel(account)`: removes the pending change (its code then answers `expired`).
 * Never logs an address or a code.
 */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import type { ApiError } from '@time2fest/contracts';
import { normalizeEmail } from '../domain/auth/email';
import { decodeEmailChange, emailChangeIdentifier, encodeEmailChange } from '../domain/rights/signInMethods';
import type { MailSendResult } from '../mail/ports';

/** Code lifetime and tries: the same as the sign-in code (SPEC-10 FR-ID-03). */
export const EMAIL_CHANGE_TTL_MS = 600_000;
export const EMAIL_CHANGE_ATTEMPTS = 5;

export type EmailChangeResult = { ok: true; value: null } | { ok: false; error: ApiError };
type Limit = { ok: true } | { ok: false; error: ApiError };

export interface PendingRow {
  value: string;
  expiresAt: number;
}

export interface EmailChangePorts {
  /** The account, or `null` when it is gone. */
  account(userId: string): Promise<{ email: string | null; isAnonymous: boolean } | null>;
  /** Id of the user holding `email`, or `null`. */
  emailOwner(email: string): Promise<string | null>;
  /** Sets the verified email; throws the database error (SQLSTATE `23505` when taken). */
  setEmail(userId: string, email: string): Promise<void>;
  /** The verification store under one identifier. */
  pending: {
    store(identifier: string, value: string, expiresAt: number): Promise<void>;
    /** Atomic read-and-delete; `null` when absent or expired. */
    consume(identifier: string): Promise<PendingRow | null>;
    remove(identifier: string): Promise<void>;
  };
  /** Deletes the pending sign-in code of an address. */
  removeSignInCode(email: string): Promise<void>;
  /** The SPEC-10 code limits keyed by the address (`codeLimits.ts`). */
  limits: {
    admit(email: string, nowMs: number): Promise<Limit>;
    commit(email: string, nowMs: number): Promise<void>;
    release(email: string, nowMs: number): Promise<void>;
  };
  send(to: string, code: string): Promise<MailSendResult>;
  /** `session` (`email-changed`) + `profile` to the account; never throws. */
  publishChanged(userId: string): Promise<void>;
  /** `profile` to the account (the pending change moved); never throws. */
  publishProfile(userId: string): Promise<void>;
  now(): number;
  log: { warn(entry: Record<string, unknown>): void };
}

const fail = (code: ApiError['code'], extra: Omit<ApiError, 'code'> = {}): { ok: false; error: ApiError } => ({
  ok: false,
  error: { code, ...extra },
});
const OK: EmailChangeResult = { ok: true, value: null };

const sha256 = (code: string): string => createHash('sha256').update(code).digest('hex');

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

const isUnique = (err: unknown, depth = 0): boolean =>
  depth < 4 &&
  err !== null &&
  typeof err === 'object' &&
  ((err as { code?: unknown }).code === '23505' || isUnique((err as { cause?: unknown }).cause, depth + 1));

export interface EmailChangeService {
  request(userId: string, rawEmail: string): Promise<EmailChangeResult>;
  verify(userId: string, code: string): Promise<EmailChangeResult>;
  cancel(userId: string): Promise<EmailChangeResult>;
}

export function createEmailChangeService(ports: EmailChangePorts): EmailChangeService {
  return {
    async request(userId, rawEmail) {
      const email = normalizeEmail(rawEmail);
      if (email === undefined) return fail('validation', { reason: 'email' });
      const account = await ports.account(userId);
      if (account === null || account.isAnonymous) return fail('unauthorized');
      if (account.email !== null && account.email.toLowerCase() === email) return fail('validation', { reason: 'same-email' });
      const owner = await ports.emailOwner(email);
      if (owner !== null && owner !== userId) return fail('conflict', { reason: 'taken' });

      const now = ports.now();
      const admitted = await ports.limits.admit(email, now);
      if (!admitted.ok) return admitted;

      const identifier = emailChangeIdentifier(userId);
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const value = encodeEmailChange({ email, hash: sha256(code), attemptsLeft: EMAIL_CHANGE_ATTEMPTS, sentAt: now });
      await ports.pending.store(identifier, value, now + EMAIL_CHANGE_TTL_MS);

      let mail: MailSendResult;
      try {
        mail = await ports.send(email, code);
      } catch {
        mail = { ok: false, reason: 'unavailable' };
      }
      if (!mail.ok) {
        await ports.pending.remove(identifier);
        if (mail.reason === 'unavailable') {
          await ports.limits.release(email, now);
          ports.log.warn({ event: 'email-change', outcome: 'unavailable' });
          return fail('unavailable');
        }
      }
      try {
        await ports.limits.commit(email, now);
      } catch {
        ports.log.warn({ event: 'email-change', outcome: 'not-counted' });
      }
      if (!mail.ok) return fail('validation', { reason: 'email' });
      await ports.publishProfile(userId).catch(() => undefined);
      return OK;
    },

    async verify(userId, code) {
      const identifier = emailChangeIdentifier(userId);
      const row = await ports.pending.consume(identifier);
      const pending = row === null ? undefined : decodeEmailChange(row.value);
      if (row === null || pending === undefined) return fail('conflict', { reason: 'expired' });

      if (!/^\d{6}$/.test(code) || !sameHash(sha256(code), pending.hash)) {
        const left = pending.attemptsLeft - 1;
        if (left <= 0) return fail('rate_limited', { reason: 'too-many-attempts' });
        await ports.pending.store(identifier, encodeEmailChange({ ...pending, attemptsLeft: left }), row.expiresAt);
        return fail('validation', { reason: 'wrong-code', attemptsLeft: left });
      }

      const account = await ports.account(userId);
      if (account === null || account.isAnonymous) return fail('unauthorized');
      try {
        await ports.setEmail(userId, pending.email);
      } catch (err) {
        if (isUnique(err)) return fail('conflict', { reason: 'taken' });
        throw err;
      }
      if (account.email !== null) await ports.removeSignInCode(account.email.toLowerCase());
      await ports.publishChanged(userId).catch(() => undefined);
      return OK;
    },

    async cancel(userId) {
      await ports.pending.remove(emailChangeIdentifier(userId));
      await ports.publishProfile(userId).catch(() => undefined);
      return OK;
    },
  };
}
