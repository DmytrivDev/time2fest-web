/**
 * Sign-in and mail test doors (SPEC-10 W26–W27, AC-52, AC-56, AC-13). Part of the doors module: loaded only through the
 * dynamic doors `import()`, so they exist only in the `test` class with `T2F_TEST_DOORS=1` and answer only on loopback.
 *
 * - `POST /api/_test/auth/last-code {to}` — the code of the newest message in the shared Mailpit whose `To` is exactly
 *   `to` (AC-56: Mailpit is shared by every worktree, so the door never answers for a recipient it did not match
 *   exactly; a substring hit of the Mailpit search is skipped). No message → `not_found`.
 * - `POST /api/_test/auth/expire-code {email}` — moves `expires_at` of the code row `sign-in-otp-<normalized>` into
 *   the past (AC-13). No row → `not_found`.
 * - `POST /api/_test/auth/google-user {sub,email,emailVerified,name?}` — the form fields the fake OIDC login page
 *   posts for that user (spike S5); the door itself calls nobody.
 * - `POST /api/_test/auth/free-gap {email}` — frees the 30 s gap of the address, so a second code can be asked at once
 *   (AC-54 http column). The day counter and the windows stay.
 * - `POST /api/_test/mail/counter {provider,count}` — sets today's (UTC, wall clock) sent counter of the provider.
 * - `POST /api/_test/mail/break-delivery` — the NEXT send of this process's mail service answers «both providers
 *   down» (`unavailable`) without touching a provider; one send only, undone by `reset` (AC-54 http column, AC-40).
 *   The shared `mailpit-chaos` lock cannot break a served server's primary, hence this door.
 * - `POST /api/_test/auth/write-probe` — a route that needs a subject (`subject: 'required'`, [П-6]); answers it.
 *
 * The code and the address are never logged.
 */
import {
  authExpireCodeDoor,
  authGoogleUserDoor,
  authLastCodeDoor,
  mailCounterDoor,
} from '@time2fest/contracts/schemas';
import type { z } from 'zod';
import { realClock } from '../clock';
import { normalizeEmail } from '../domain/auth/email';
import { msToUtcMidnight, utcDayKey } from '../domain/mail/day';
import { codeGapKey } from '../auth/codeLimits';
import { authPool } from '../auth/pool';
import { authOf, mailOf } from '../endpoints/deps';
import { failure } from '../endpoints/pipeline';
import type { Deps } from '../endpoints/types';
import type { MailService } from '../mail/ports';
import { mailSentKey } from '../mail/service';
import type { DoorRow } from './registry';

/** The shared main Mailpit (compose service `mailpit`); doors exist only in the `test` class. */
export const MAILPIT_API = 'http://127.0.0.1:8025';
/** How many of the newest search hits are checked for an exact recipient. */
const SEARCH_LIMIT = 50;
const CODE = /\b(\d{6})\b/;
const MAILPIT_TIMEOUT_MS = 3000;

interface MailpitAddress {
  Address?: string;
}
interface MailpitSummary {
  ID: string;
  To?: MailpitAddress[] | null;
}

async function mailpitJson(path: string): Promise<unknown> {
  const r = await fetch(MAILPIT_API + path, { signal: AbortSignal.timeout(MAILPIT_TIMEOUT_MS) });
  if (!r.ok) throw new Error(`mailpit ${r.status}`);
  return r.json();
}

/** The code of the newest message whose `To` holds exactly `to` (normalized), or `null`. */
export async function lastCodeFor(to: string): Promise<string | null> {
  const query = encodeURIComponent(`to:"${to}"`);
  const found = (await mailpitJson(`/api/v1/search?query=${query}&limit=${SEARCH_LIMIT}`)) as {
    messages?: MailpitSummary[] | null;
  };
  // Mailpit answers newest first; `to:` is a substring match, so the exact recipient is checked here.
  for (const m of found.messages ?? []) {
    const exact = (m.To ?? []).some(
      (a) => typeof a.Address === 'string' && normalizeEmail(a.Address) === to,
    );
    if (!exact) continue;
    const full = (await mailpitJson(`/api/v1/message/${encodeURIComponent(m.ID)}`)) as {
      Text?: string;
    };
    const code = CODE.exec(full.Text ?? '')?.[1];
    if (code) return code;
  }
  return null;
}

/** Empties the Better Auth tables (reset door, W26); no-op when sign-in is not wired into these deps. */
export async function clearAuthTables(deps: Deps): Promise<void> {
  if (!deps.auth) return;
  const pool = await authPool(deps);
  await pool.query(
    'DELETE FROM user_sessions; DELETE FROM user_accounts; DELETE FROM auth_verifications; DELETE FROM users;',
  );
}

/** The undo of a pending `break-delivery` (one per process). */
let pendingBreak: (() => void) | undefined;

/** Makes the next `send` of `mail` answer `unavailable` (both providers down); the one after it is real again. */
export function breakNextDelivery(mail: MailService): void {
  pendingBreak?.();
  const real = Object.prototype.hasOwnProperty.call(mail, 'send') ? mail.send : undefined;
  const restore = () => {
    if (real !== undefined) mail.send = real;
    else delete (mail as { send?: unknown }).send;
    pendingBreak = undefined;
  };
  mail.send = async () => {
    restore();
    return { ok: false, reason: 'unavailable' };
  };
  pendingBreak = restore;
}

/** Undoes a `break-delivery` that no send consumed (reset door). */
export function restoreDelivery(): void {
  pendingBreak?.();
}

export const authDoors: readonly DoorRow[] = [
  {
    key: 'auth-expire-code',
    method: 'POST',
    path: '/api/_test/auth/expire-code',
    body: authExpireCodeDoor,
    async handler(ctx) {
      const email = normalizeEmail((ctx.body as z.infer<typeof authExpireCodeDoor>).email);
      if (!email) return failure('validation', { reason: 'invalid-input' });
      const pool = await authPool(ctx.deps);
      const r = await pool.query(
        "UPDATE auth_verifications SET expires_at = now() - interval '1 minute' WHERE identifier = $1",
        [`sign-in-otp-${email}`],
      );
      return (r.rowCount ?? 0) > 0 ? { ok: true, value: {} } : failure('not_found');
    },
  },
  {
    key: 'auth-free-gap',
    method: 'POST',
    path: '/api/_test/auth/free-gap',
    // Same body as `expire-code`: `{email}`, strict.
    body: authExpireCodeDoor,
    async handler(ctx) {
      const email = normalizeEmail((ctx.body as z.infer<typeof authExpireCodeDoor>).email);
      if (!email) return failure('validation', { reason: 'invalid-input' });
      await ctx.deps.redis.del(codeGapKey(authOf(ctx.deps).emailKey(email)));
      return { ok: true, value: {} };
    },
  },
  {
    key: 'auth-google-user',
    method: 'POST',
    path: '/api/_test/auth/google-user',
    body: authGoogleUserDoor,
    async handler(ctx) {
      const user = ctx.body as z.infer<typeof authGoogleUserDoor>;
      const claims: Record<string, unknown> = {
        sub: user.sub,
        email: user.email,
        email_verified: user.emailVerified,
      };
      if (user.name !== undefined) claims.name = user.name;
      return { ok: true, value: { username: user.sub, claims: JSON.stringify(claims) } };
    },
  },
  {
    key: 'auth-last-code',
    method: 'POST',
    path: '/api/_test/auth/last-code',
    body: authLastCodeDoor,
    async handler(ctx) {
      const to = normalizeEmail((ctx.body as z.infer<typeof authLastCodeDoor>).to);
      if (!to) return failure('validation', { reason: 'invalid-input' });
      const code = await lastCodeFor(to);
      return code ? { ok: true, value: { code } } : failure('not_found');
    },
  },
  {
    key: 'auth-write-probe',
    method: 'POST',
    path: '/api/_test/auth/write-probe',
    subject: 'required',
    async handler(ctx) {
      return { ok: true, value: { subject: ctx.subject ?? null } };
    },
  },
];

/** `POST /api/_test/mail/break-delivery` (sorted apart from the `auth-*` rows). */
export const mailBreakDeliveryDoorRow: DoorRow = {
  key: 'mail-break-delivery',
  method: 'POST',
  path: '/api/_test/mail/break-delivery',
  async handler(ctx) {
    breakNextDelivery(mailOf(ctx.deps));
    return { ok: true, value: {} };
  },
};

/** `POST /api/_test/mail/counter` (sorted apart from the `auth-*` rows). */
export const mailCounterDoorRow: DoorRow = {
  key: 'mail-counter',
  method: 'POST',
  path: '/api/_test/mail/counter',
  body: mailCounterDoor,
  async handler(ctx) {
    const { provider, count } = ctx.body as z.infer<typeof mailCounterDoor>;
    const now = new Date(realClock.now());
    await ctx.deps.redis.set(
      mailSentKey(provider, utcDayKey(now)),
      String(count),
      Math.max(1000, msToUtcMidnight(now)),
    );
    return { ok: true, value: { provider, count } };
  },
};
