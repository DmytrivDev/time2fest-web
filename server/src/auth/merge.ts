/**
 * Guest → account merge (SPEC-10 W30, AC-23, AC-24, EC-2; SPEC-11 W26, [П-5], AC-49, AC-53): the anonymous plugin's
 * `onLinkAccount`, called by Better Auth after a guest's sign-in (code or Google) produced an account session. The
 * plugin runs with `disableDeleteAnonymousUser: true` (`options.ts`): the guest's removal is decided here.
 * - Guarded: the same id, or an anonymous target, is not a merge.
 * - The guest's device id moves to the account (`users.device_id`); the request's auth scope is marked `linked`
 *   (the forwarder's finish step then does not attach a second time, [П-4]).
 * - Each handler of `Deps.authLinks` (default `authLinkRegistry`: `bans`, `passes`, `profile`) runs once per
 *   `(guest, handler)`: a Redis claim `auth:link:<guest>:<handler>` (value = the account id). A second call — the same
 *   sign-in repeated, or a second tab signing the same guest into another account (EC-2) — finds the claim and skips.
 * - A handler throw, or no claim store, → one row in `auth_link_retries` + `log` alarm `auth/link-retry {handler}`;
 *   the claim stays (the retry row owns the work; `ops/linkRetry.ts` re-runs it); if that row could not be written,
 *   the claim is given back so a later sign-in re-runs the handler (S11-04). The sign-in always completes.
 * - Afterwards the guest's sessions are always revoked (`deleteUserSessions`: the session hooks publish `signed-out`);
 *   the guest is deleted only when THIS call claimed and finished every handler, no retry row comes from it and no
 *   active unattached pass is on its device (`maybeRemoveGuest`, shared with the retry job). Otherwise the guest stays
 *   for `auth-guest-prune`. Then `invalidateSubject` for both ids (AC-53).
 */
import { firstOpenSeason } from '../domain/rights/passSeason';
import { deviceOfSubject, LINK_RETRY_MAX_ATTEMPTS, type LinkRetryRow } from '../domain/auth/linkRetry';
import { authOf, rightsOf, seasonCtxOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import { isDeviceId } from '../platform/device';
import { authLinkRegistry, type AuthLinkHandler } from '../registries/authLinks';
import { authPool } from './pool';
import type { LinkRetryJobDeps } from '../ops/linkRetry';
import { markScopeLinked, runInAuthScope } from './scope';

/** How long a link claim is remembered (longer than any guest lives: 30 days without data, AC-5). */
const CLAIM_TTL_MS = 31 * 24 * 60 * 60 * 1000;
/** First retry no sooner than this. */
const RETRY_DELAY_MS = 5 * 60 * 1000;
const ERROR_CODE_MAX = 64;

interface GuestAdapter {
  deleteUser(id: string): Promise<unknown>;
}

/** What `onLinkAccount` receives (the fields this module reads). */
export interface LinkAccountData {
  anonymousUser: { user: { id: string } & Record<string, unknown>; session: Record<string, unknown> };
  newUser: { user: { id: string } & Record<string, unknown>; session: Record<string, unknown> };
  ctx: {
    context: {
      internalAdapter: GuestAdapter & {
        updateUser(id: string, data: Record<string, unknown>): Promise<unknown>;
        deleteUserSessions(userId: string): Promise<unknown>;
      };
      options: { database?: unknown };
    };
  };
}

export interface SqlPool {
  query(text: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export const linkClaimKey = (fromSubject: string, handler: string) => `auth:link:${fromSubject}:${handler}`;

export function errorCode(err: unknown): string {
  const name = err instanceof Error ? (typeof (err as { code?: unknown }).code === 'string' ? String((err as { code?: unknown }).code) : err.name) : 'unknown';
  return name.slice(0, ERROR_CODE_MAX);
}

function poolOf(data: LinkAccountData): SqlPool | undefined {
  const db = data.ctx.context.options.database as { query?: unknown } | undefined;
  return db !== undefined && typeof db.query === 'function' ? (db as SqlPool) : undefined;
}

/**
 * The retry task of AC-24 (`auth_link_retries`, on Better Auth's own pool) + `log` alarm `auth/link-retry {handler}`.
 * `fromSubject` — the guest id, or `device:<id>` for the finish step of a sign-in without a guest (W27). Never throws;
 * answers whether the row was written. `next_at` follows `deps.clock` (A1).
 */
export async function recordRetry(
  deps: Deps,
  pool: SqlPool | undefined,
  task: { userId: string; fromSubject: string; handler: string; code: string },
): Promise<boolean> {
  let recorded = false;
  try {
    if (pool === undefined) throw new Error('no pool');
    await pool.query(
      `INSERT INTO auth_link_retries (user_id, from_subject, handler, attempts, next_at, last_error_code)
       VALUES ($1, $2, $3, 1, $4, $5)`,
      [task.userId, task.fromSubject, task.handler, new Date(deps.clock.now() + RETRY_DELAY_MS), task.code],
    );
    recorded = true;
  } catch {
    deps.log.error({ event: 'auth-link', outcome: 'retry-not-recorded', handler: task.handler });
  }
  deps.alarm.raise({ level: 'log', source: 'auth', code: 'auth/link-retry', details: { handler: task.handler } });
  return recorded;
}

type HandlerOutcome = 'done' | 'skipped' | 'failed';

async function runHandler(deps: Deps, pool: SqlPool | undefined, fromSubject: string, toSubject: string, handler: AuthLinkHandler): Promise<HandlerOutcome> {
  let claimed: boolean;
  try {
    claimed = await deps.redis.setIfAbsent(linkClaimKey(fromSubject, handler.key), toSubject, CLAIM_TTL_MS);
  } catch {
    await recordRetry(deps, pool, { userId: toSubject, fromSubject, handler: handler.key, code: 'claim-unavailable' });
    return 'failed';
  }
  if (!claimed) return 'skipped';
  try {
    await handler.link({ fromSubject, toSubject, deps });
    return 'done';
  } catch (err) {
    deps.log.warn({ event: 'auth-link', outcome: 'failed', handler: handler.key });
    const recorded = await recordRetry(deps, pool, { userId: toSubject, fromSubject, handler: handler.key, code: errorCode(err) });
    // No retry row owns the work (S11-04): give the claim back (best effort) so a later sign-in re-runs the handler.
    if (!recorded) await deps.redis.del(linkClaimKey(fromSubject, handler.key)).catch(() => undefined);
    return 'failed';
  }
}

/**
 * Whether something still keeps the guest ([П-5], AC-50): an `auth_link_retries` row from it (open or given up), or an
 * active (not revoked, not erased, season still open) unattached pass on its device.
 */
export async function guestHeld(deps: Deps, pool: SqlPool, guestId: string, device: string | null): Promise<boolean> {
  const retry = await pool.query('SELECT 1 FROM auth_link_retries WHERE from_subject = $1 LIMIT 1', [guestId]);
  if (retry.rows.length > 0) return true;
  if (device === null || device === '') return false;
  const open = firstOpenSeason(deps.clock.now(), seasonCtxOf(deps));
  const pass = await pool.query(
    `SELECT 1 FROM passes WHERE device_id = $1 AND attached_user_id IS NULL AND revoked_at IS NULL AND erased_at IS NULL
       AND season >= $2 LIMIT 1`,
    [device, open],
  );
  return pass.rows.length > 0;
}

/** The guest's rights rows that do not outlive it: its profile (nick released, AC-31) and its own bans. */
export async function eraseGuestRights(pool: SqlPool, guestId: string): Promise<void> {
  await pool.query('DELETE FROM profiles WHERE subject_id = $1', [guestId]);
  await pool.query(`DELETE FROM bans WHERE kind = 'guest' AND subject_id = $1`, [guestId]);
}

export type GuestRemoval = 'removed' | 'gone' | 'kept' | 'not-guest';

/**
 * Deletes the guest when nothing keeps it (`guestHeld`), then erases its rights rows. Must run inside an auth scope
 * (Better Auth's hooks). On 1.7.28 a `user.delete.before` veto returns quietly (spike S9), so the row is re-read.
 */
export async function maybeRemoveGuest(deps: Deps, guestId: string, io?: { pool?: SqlPool; adapter?: GuestAdapter }): Promise<GuestRemoval> {
  const pool = io?.pool ?? ((await authPool(deps)) as unknown as SqlPool);
  const found = await pool.query('SELECT is_anonymous, device_id FROM users WHERE id::text = $1', [guestId]);
  const user = found.rows[0];
  if (user === undefined) return 'gone';
  if (user.is_anonymous !== true) return 'not-guest';
  if (await guestHeld(deps, pool, guestId, typeof user.device_id === 'string' ? user.device_id : null)) return 'kept';
  const adapter = io?.adapter ?? (await authOf(deps).instance().$context).internalAdapter;
  await adapter.deleteUser(guestId);
  const after = await pool.query('SELECT 1 FROM users WHERE id::text = $1', [guestId]);
  if (after.rows.length > 0) return 'kept';
  await eraseGuestRights(pool, guestId);
  return 'removed';
}

/** `invalidateSubject` (SPEC-06 C6) for each id; never throws. */
export async function invalidateSubjects(deps: Deps, ids: readonly string[]): Promise<void> {
  const invalidator = deps.realtime?.invalidator;
  if (!invalidator) return;
  await Promise.all(ids.map((id) => invalidator.invalidate(id).catch(() => undefined)));
}

/**
 * The anonymous plugin's `onLinkAccount`. `deps` — the hook deps (undefined outside an auth scope: the device still
 * moves, no handler runs, the guest stays for the cleanup job). Never throws.
 */
export async function linkGuest(data: LinkAccountData, deps: Deps | undefined): Promise<void> {
  try {
    const from = data.anonymousUser.user.id;
    const to = data.newUser.user.id;
    if (from === to || data.newUser.user.isAnonymous === true) return;
    markScopeLinked();
    const adapter = data.ctx.context.internalAdapter;
    const device = isDeviceId(data.anonymousUser.user.deviceId) ? data.anonymousUser.user.deviceId : data.newUser.session.deviceId;
    if (isDeviceId(device)) {
      try {
        await adapter.updateUser(to, { deviceId: device });
      } catch {
        deps?.log.warn({ event: 'auth-link', outcome: 'device-not-moved' });
      }
    }
    if (deps === undefined) return;
    const pool = poolOf(data);
    const handlers = deps.authLinks ?? authLinkRegistry;
    let complete = true;
    let claimedAny = false;
    for (const handler of handlers) {
      const outcome = await runHandler(deps, pool, from, to, handler);
      if (outcome !== 'done') complete = false;
      if (outcome !== 'skipped') claimedAny = true;
    }
    try {
      await adapter.deleteUserSessions(from);
    } catch {
      deps.log.warn({ event: 'auth-link', outcome: 'guest-sessions-not-revoked' });
    }
    if (complete) {
      try {
        await maybeRemoveGuest(deps, from, { ...(pool ? { pool } : {}), adapter });
      } catch {
        deps.log.warn({ event: 'auth-link', outcome: 'guest-not-removed' });
      }
    }
    if (claimedAny || handlers.length === 0) await invalidateSubjects(deps, [from, to]);
  } catch {
    try {
      deps?.log.error({ event: 'auth-link', outcome: 'unexpected' });
    } catch {
      // Nothing may escape into Better Auth (the sign-in would fail).
    }
  }
}

/**
 * The sign-in side of the retry job `auth-link-retry` (SPEC-11 W29b): the row store over Better Auth's pool, the re-run
 * of one row and the guest-removal re-check after it closed. Everything runs inside an auth scope. `deps` is read per
 * run (tests replace `authLinks`).
 */
export function createLinkRetryPorts(deps: () => Deps): Pick<LinkRetryJobDeps, 'store' | 'retry' | 'afterClosed' | 'errorCode'> {
  const pool = async (): Promise<SqlPool> => (await authPool(deps())) as unknown as SqlPool;
  return {
    errorCode,
    store: {
      async takeDue(nowMs, hideUntilMs, limit) {
        if (deps().auth === undefined) return [];
        const r = await (await pool()).query(
          `UPDATE auth_link_retries SET next_at = $2, updated_at = now()
            WHERE id IN (SELECT id FROM auth_link_retries WHERE next_at <= $1 AND attempts < $4
                          ORDER BY next_at, id LIMIT $3 FOR UPDATE SKIP LOCKED)
            RETURNING id, user_id, from_subject, handler, attempts::int AS attempts`,
          [new Date(nowMs), new Date(hideUntilMs), limit, LINK_RETRY_MAX_ATTEMPTS],
        );
        return r.rows.map((row) => ({
          id: Number(row.id),
          userId: String(row.user_id),
          fromSubject: String(row.from_subject),
          handler: String(row.handler),
          attempts: Number(row.attempts),
          nextAtMs: nowMs,
        }));
      },
      async close(id) {
        await (await pool()).query('DELETE FROM auth_link_retries WHERE id = $1', [id]);
      },
      async reschedule(id, attempts, nextAtMs, code) {
        await (await pool()).query(
          'UPDATE auth_link_retries SET attempts = $2, next_at = $3, last_error_code = $4, updated_at = now() WHERE id = $1',
          [id, attempts, new Date(nextAtMs), code.slice(0, ERROR_CODE_MAX)],
        );
      },
    },
    async retry(row: LinkRetryRow) {
      const d = deps();
      await runInAuthScope(async () => {
        const device = deviceOfSubject(row.fromSubject);
        if (device !== null) {
          const u = await (await pool()).query('SELECT email, email_verified FROM users WHERE id::text = $1', [row.userId]);
          const user = u.rows[0];
          if (user === undefined) return; // the account is gone: nothing to attach to
          const email = user.email_verified === true && typeof user.email === 'string' ? user.email : null;
          await rightsOf(d).passes.attachOnSignIn({ account: row.userId, device, email });
          return;
        }
        const handler = (d.authLinks ?? authLinkRegistry).find((h) => h.key === row.handler);
        if (handler === undefined) throw Object.assign(new Error('unknown handler'), { code: 'unknown-handler' });
        await handler.link({ fromSubject: row.fromSubject, toSubject: row.userId, deps: d });
      });
    },
    async afterClosed(row: LinkRetryRow) {
      if (deviceOfSubject(row.fromSubject) !== null) return;
      const d = deps();
      await runInAuthScope(() => maybeRemoveGuest(d, row.fromSubject));
      await invalidateSubjects(d, [row.fromSubject, row.userId]);
    },
  };
}
