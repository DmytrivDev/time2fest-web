/**
 * The email-code sign-in flow (SPEC-10 W23, W24; AC-6 … AC-16, AC-38, AC-40, AC-48, NFR-4, NFR-7, EC-1, EC-8).
 * Request (`POST /api/auth/email-otp/send-verification-otp`, body `requestCodeBody`):
 * - the email is validated and normalized here (bad → `validation/email`, no mail);
 * - our windows are reserved atomically and the 30 s gap claimed (`codeLimits.ts`); Better Auth then stores the hashed code
 *   (replacing the previous one, AC-15, AC-16) and calls `sendSignInCode`, which mails it through the mail service
 *   (awaited; same message, same code on the fallback);
 * - delivered → counted, `CodeInfo` from the server's wall clock, identical for a new and an existing email (AC-6);
 *   recipient refused → code row deleted, counted, `validation/email` (AC-38); both providers down → code row
 *   deleted, gap released, not counted, `unavailable` (AC-40).
 * Verify (`POST /api/auth/sign-in/email-otp`, body `verifyCodeBody`):
 * - Better Auth errors become our reasons: `INVALID_OTP` → `validation/wrong-code` + `attemptsLeft` (5 − wrong tries
 *   stored in the code row, spike S7); the 5th wrong try burns the row and answers `rate_limited/too-many-attempts`
 *   (AC-12); `OTP_EXPIRED` → `conflict/expired`; its limiter 429 → `rate_limited/too-many`;
 * - success → `SignInOutcome { isNew, email }` with the session cookie, no token (AC-14).
 * The per-request state (mail outcome, "user created") travels in the auth scope (`scope.ts`), so the Better Auth
 * callbacks reach it without a global; the deps come from the wiring's `getDeps`. No log line carries the email or the code (AC-48).
 */
import { randomUUID } from 'node:crypto';
import type { ApiError } from '@time2fest/contracts';
import { requestCodeBody, verifyCodeBody } from '@time2fest/contracts/schemas';
import { normalizeEmail } from '../domain/auth/email';
import { mailOf } from '../endpoints/deps';
import { failure, newLogId } from '../endpoints/pipeline';
import type { Ctx, Deps, Outcome } from '../endpoints/types';
import type { MailSendResult } from '../mail/ports';
import { signInCodeMail } from '../mail/templates/signInCode';
import { DependencyUnavailable } from '../ports';
import { codeRequestState, runCodeRequest, type CodeRequestState } from './scope';
import { admitCode, CODE_GAP_MS, commitCode, releaseCode, releaseGap, type CodeLimitKeys } from './codeLimits';
import type { AuthWiring } from './instance';

export const CODE_REQUEST_PATH = '/email-otp/send-verification-otp';
export const CODE_VERIFY_PATH = '/sign-in/email-otp';
/** Code lifetime (Better Auth `expiresIn` 600 s) and attempts (`allowedAttempts` 5). */
export const CODE_TTL_MS = 600_000;
export const CODE_ATTEMPTS = 5;

/** How the flow reaches Better Auth: send a JSON body, and build the success answer with the session cookies. */
export interface AuthCall {
  send(body: string): Promise<Response>;
  respond(res: Response, value: unknown): Promise<Outcome>;
}

/**
 * Better Auth's `sendVerificationOTP` callback: mails a sign-in code through the mail service of `deps` (the wiring's
 * `getDeps`), awaited.
 */
export async function sendSignInCode({ email, otp, type }: { email: string; otp: string; type: string }, deps: Deps): Promise<void> {
  const state = codeRequestState();
  if (state === undefined || type !== 'sign-in') throw new Error('auth: code delivery outside the code flow');
  const from = String(deps.env.vars.T2F_MAIL_FROM ?? 'Time2Fest <code@mail.time2fest.com>');
  const message = signInCodeMail({ code: otp, id: randomUUID(), from, to: email });
  try {
    state.mail = await mailOf(deps).send(message);
  } catch {
    // No mail service (no SMTP_HOST) or an unexpected throw: nothing was delivered.
    state.mail = { ok: false, reason: 'unavailable' };
  }
}

/** Wraps a substitute sender (tests): its return marks the code as delivered for the request in flight. */
export function substituteSender(send: (args: { email: string; otp: string; type: string }) => Promise<void>) {
  return async (args: { email: string; otp: string; type: string }): Promise<void> => {
    await send(args);
    const state = codeRequestState();
    if (state !== undefined) state.mail = { ok: true, provider: 'substitute' };
  };
}

/** The `user.create.after` hook: marks the current verify request as a sign-up (`SignInOutcome.isNew`). */
export function markUserCreated(): void {
  const state = codeRequestState();
  if (state !== undefined) state.userCreated = true;
}

function parseJson(body: string | undefined): unknown {
  try {
    return body === undefined || body === '' ? undefined : (JSON.parse(body) as unknown);
  } catch {
    return undefined;
  }
}

function rawEmailOf(raw: unknown): string | undefined {
  const value = raw !== null && typeof raw === 'object' ? (raw as { email?: unknown }).email : undefined;
  return typeof value === 'string' ? value : undefined;
}

const identifierOf =(email: string) => `sign-in-otp-${email}`;
const badEmail = (): Outcome => failure('validation', { reason: 'email' });

async function deleteCode(wiring: AuthWiring, email: string): Promise<void> {
  await (await wiring.instance().$context).internalAdapter.deleteVerificationByIdentifier(identifierOf(email));
}

function retryAfterOf(res: Response): Omit<ApiError, 'code'> {
  const seconds = Number(res.headers.get('x-retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? { retryAfterMs: Math.ceil(seconds * 1000) } : {};
}

function unknownError(ctx: Ctx, status: number): Outcome {
  const logId = newLogId();
  ctx.log.error({ event: 'auth-error', route: ctx.route.key, status, logId });
  return failure('unknown', { message: logId });
}

/** `POST /api/auth/email-otp/send-verification-otp`. */
export async function requestCode(ctx: Ctx, wiring: AuthWiring, body: string | undefined, call: AuthCall): Promise<Outcome> {
  // Normalized before the format check (EC-8: upper case and surrounding spaces are not a bad address).
  const raw = parseJson(body);
  const email = normalizeEmail(rawEmailOf(raw) ?? '');
  if (email === undefined) return badEmail();
  const parsed = requestCodeBody.safeParse({ ...(raw as object), email });
  if (!parsed.success) return badEmail();

  const now = wiring.now();
  const stores = { fast: ctx.deps.redis, memory: ctx.deps.memory };
  const keys: CodeLimitKeys = {
    email: wiring.emailKey(email),
    device: ctx.device,
    ipDay: await ctx.client.ipDay(),
    ip48Day: await ctx.client.ip48Day(),
  };
  const admitted = await admitCode(stores, keys, now);
  if (!admitted.ok) return { ok: false, error: admitted.error };

  const state: CodeRequestState = {};
  let res: Response;
  try {
    res = await runCodeRequest(state, () => call.send(JSON.stringify({ email, type: 'sign-in' })));
  } catch (err) {
    // Unknown whether a mail went out: only the gap is freed, the window hits stay reserved.
    await releaseGap(stores, keys);
    throw err;
  }
  if (res.status >= 400) {
    // Better Auth refused before the send: nothing went out.
    await releaseCode(stores, keys, now);
    if (res.status === 429) return failure('rate_limited', { reason: 'too-many', ...retryAfterOf(res) });
    if (res.status === 400) return badEmail();
    return unknownError(ctx, res.status);
  }

  // No outcome = the sender threw (swallowed by Better Auth): treated as both providers down (AC-40, [А8]).
  const mail: MailSendResult = state.mail ?? { ok: false, reason: 'unavailable' };
  if (!mail.ok) {
    await deleteCode(wiring, email);
    if (mail.reason === 'unavailable') {
      await releaseCode(stores, keys, now);
      ctx.log.warn({ event: 'auth-code', outcome: 'unavailable' });
      return failure('unavailable');
    }
  }
  try {
    await commitCode(stores, keys, now);
  } catch (err) {
    if (!(err instanceof DependencyUnavailable)) throw err;
    // The mail went out; the day counter is best effort from here (the windows and the 30 s gap are already held).
    ctx.log.warn({ event: 'auth-code', outcome: 'not-counted' });
  }
  if (!mail.ok) return badEmail();
  return {
    ok: true,
    value: {
      email,
      intent: parsed.data.intent,
      sentAt: now,
      resendAt: now + CODE_GAP_MS,
      expiresAt: now + CODE_TTL_MS,
      attemptsLeft: CODE_ATTEMPTS,
    },
  };
}

/** Wrong tries stored in the code row (`<hash>:<n>`, spike S7); `undefined` when there is no row. */
async function wrongTries(wiring: AuthWiring, email: string): Promise<number | undefined> {
  const row = await (await wiring.instance().$context).internalAdapter.findVerificationValue(identifierOf(email));
  if (!row) return undefined;
  const tail = String(row.value).slice(String(row.value).lastIndexOf(':') + 1);
  const n = Number.parseInt(tail, 10);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { code?: unknown } | null;
    return typeof body?.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/** `INVALID_OTP`: `wrong-code` with the tries left, or — on the 5th wrong try — burn the code (AC-11, AC-12). */
async function wrongCode(wiring: AuthWiring, email: string): Promise<Outcome> {
  const tries = await wrongTries(wiring, email);
  if (tries === undefined) return failure('validation', { reason: 'wrong-code', attemptsLeft: 0 });
  if (tries >= CODE_ATTEMPTS) {
    await deleteCode(wiring, email);
    return failure('rate_limited', { reason: 'too-many-attempts' });
  }
  return failure('validation', { reason: 'wrong-code', attemptsLeft: CODE_ATTEMPTS - tries });
}

/** `POST /api/auth/sign-in/email-otp`. */
export async function verifyCode(ctx: Ctx, wiring: AuthWiring, body: string | undefined, call: AuthCall): Promise<Outcome> {
  const raw = parseJson(body);
  const email = normalizeEmail(rawEmailOf(raw) ?? '');
  if (email === undefined) return badEmail();
  const parsed = verifyCodeBody.safeParse({ ...(raw as object), email });
  if (!parsed.success) {
    // A malformed code is a wrong code that costs no try.
    const tries = await wrongTries(wiring, email);
    return failure('validation', { reason: 'wrong-code', attemptsLeft: tries === undefined ? 0 : Math.max(0, CODE_ATTEMPTS - tries) });
  }

  const state: CodeRequestState = {};
  const res = await runCodeRequest(state, () => call.send(JSON.stringify({ email, otp: parsed.data.otp })));
  if (res.status < 300) return call.respond(res, { isNew: state.userCreated === true, email });
  if (res.status === 429) return failure('rate_limited', { reason: 'too-many', ...retryAfterOf(res) });
  const code = await errorCode(res);
  if (code === 'INVALID_OTP') return wrongCode(wiring, email);
  if (code === 'OTP_EXPIRED') return failure('conflict', { reason: 'expired' });
  if (code === 'TOO_MANY_ATTEMPTS') return failure('rate_limited', { reason: 'too-many-attempts' });
  return unknownError(ctx, res.status);
}
