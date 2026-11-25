/**
 * Guest → account merge (SPEC-10 W30, AC-23, AC-24, EC-2): the anonymous plugin's `onLinkAccount`, called by Better
 * Auth after a guest's sign-in (code or Google) produced an account session and BEFORE it deletes the guest.
 * - Guarded: the same id, or an anonymous target, is not a merge.
 * - The guest's device id moves to the account (`users.device_id`).
 * - Each handler of `Deps.authLinks` (default `authLinkRegistry`) runs once per `(guest, handler)`: a Redis claim
 *   `auth:link:<guest>:<handler>` (value = the account id). A second call — the same sign-in repeated, or a second tab
 *   signing the same guest into another account (EC-2) — finds the claim and skips, so the guest moves once.
 * - A handler throw, or no claim store, → one row in `auth-link-retries` + `log` alarm `auth/link-retry {handler}`;
 *   the claim stays (the retry row owns the work). The sign-in always completes: nothing escapes this function.
 * - The old and new subjects are invalidated by the session hooks (`events.ts`, spike S1: the guest's session
 *   deletion fires `signed-out`, the new session `signed-in`), not here.
 * A retry worker is not part of this wave (the spec asks only to record the task).
 */
import { realClock } from '../clock';
import type { Deps } from '../endpoints/types';
import { isDeviceId } from '../platform/device';
import { authLinkRegistry, type AuthLinkHandler } from '../registries/authLinks';
import { authScopeDeps } from './events';

/** How long a link claim is remembered (longer than any guest lives: 30 days without data, AC-5). */
const CLAIM_TTL_MS = 31 * 24 * 60 * 60 * 1000;
/** First retry no sooner than this. */
const RETRY_DELAY_MS = 5 * 60 * 1000;
const ERROR_CODE_MAX = 64;

/** What `onLinkAccount` receives (the fields this module reads). */
export interface LinkAccountData {
  anonymousUser: { user: { id: string } & Record<string, unknown>; session: Record<string, unknown> };
  newUser: { user: { id: string } & Record<string, unknown>; session: Record<string, unknown> };
  ctx: {
    context: {
      internalAdapter: { updateUser(id: string, data: Record<string, unknown>): Promise<unknown> };
      options: { database?: unknown };
    };
  };
}

interface SqlPool {
  query(text: string, values: unknown[]): Promise<unknown>;
}

export const linkClaimKey = (fromSubject: string, handler: string) => `auth:link:${fromSubject}:${handler}`;

function errorCode(err: unknown): string {
  const name = err instanceof Error ? (typeof (err as { code?: unknown }).code === 'string' ? String((err as { code?: unknown }).code) : err.name) : 'unknown';
  return name.slice(0, ERROR_CODE_MAX);
}

function poolOf(data: LinkAccountData): SqlPool | undefined {
  const db = data.ctx.context.options.database as { query?: unknown } | undefined;
  return db !== undefined && typeof db.query === 'function' ? (db as SqlPool) : undefined;
}

/** The retry task of AC-24 (Payload collection `auth-link-retries`, written on Better Auth's own pool). */
async function recordRetry(deps: Deps, data: LinkAccountData, handler: string, code: string): Promise<void> {
  const from = data.anonymousUser.user.id;
  const to = data.newUser.user.id;
  try {
    const pool = poolOf(data);
    if (pool === undefined) throw new Error('no pool');
    await pool.query(
      `INSERT INTO auth_link_retries (user_id, from_subject, handler, attempts, next_at, last_error_code)
       VALUES ($1, $2, $3, 1, $4, $5)`,
      [to, from, handler, new Date(realClock.now() + RETRY_DELAY_MS), code],
    );
  } catch {
    deps.log.error({ event: 'auth-link', outcome: 'retry-not-recorded', handler });
  }
  deps.alarm.raise({ level: 'log', source: 'auth', code: 'auth/link-retry', details: { handler } });
}

async function runHandler(deps: Deps, data: LinkAccountData, handler: AuthLinkHandler): Promise<void> {
  const fromSubject = data.anonymousUser.user.id;
  const toSubject = data.newUser.user.id;
  let claimed: boolean;
  try {
    claimed = await deps.redis.setIfAbsent(linkClaimKey(fromSubject, handler.key), toSubject, CLAIM_TTL_MS);
  } catch {
    await recordRetry(deps, data, handler.key, 'claim-unavailable');
    return;
  }
  if (!claimed) return;
  try {
    await handler.link({ fromSubject, toSubject, deps });
  } catch (err) {
    deps.log.warn({ event: 'auth-link', outcome: 'failed', handler: handler.key });
    await recordRetry(deps, data, handler.key, errorCode(err));
  }
}

/** The anonymous plugin's `onLinkAccount`. Never throws. */
export async function linkGuest(data: LinkAccountData): Promise<void> {
  const deps = authScopeDeps();
  try {
    const from = data.anonymousUser.user.id;
    const to = data.newUser.user.id;
    if (from === to || data.newUser.user.isAnonymous === true) return;
    const device = isDeviceId(data.anonymousUser.user.deviceId) ? data.anonymousUser.user.deviceId : data.newUser.session.deviceId;
    if (isDeviceId(device)) {
      try {
        await data.ctx.context.internalAdapter.updateUser(to, { deviceId: device });
      } catch {
        deps?.log.warn({ event: 'auth-link', outcome: 'device-not-moved' });
      }
    }
    if (deps === undefined) return;
    for (const handler of deps.authLinks ?? authLinkRegistry) await runHandler(deps, data, handler);
  } catch {
    try {
      deps?.log.error({ event: 'auth-link', outcome: 'unexpected' });
    } catch {
      // Nothing may escape into Better Auth (the guest would stay and the sign-in would fail).
    }
  }
}
