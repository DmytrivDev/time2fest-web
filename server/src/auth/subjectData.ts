/**
 * Subject data of sign-in (SPEC-10 W40, FR-PLAT-13, AC-49, AC-50, EC-10) and the guest store of the cleanup job
 * (W41, AC-5).
 * - export: the email (not a guest's generated placeholder), the Google name, the sign-in methods (provider ids of
 *   `user_accounts` only — columns are named explicitly, so no token ever leaves), sessions (created, expires,
 *   device id) and the distinct device ids. An unknown subject → `null`.
 * - erase: Better Auth's `internalAdapter.deleteUser` (user, accounts, sessions), then the pending codes of the
 *   address (`sign-in-otp-<email>`, spike S1: not deleted with the user), then `session` `erased` + invalidation.
 *   The session hooks also publish `signed-out` per removed session (S1).
 * - anonymise = erase (no partial anonymisation of sign-in data).
 * The handler holds no deps: it reads them from the auth scope (`scope.ts`), which every caller of the registry
 * must open anyway so Better Auth's hooks act — use `runSubjectDataInScope`. Outside a scope it throws.
 */
import { authOf } from '../endpoints/deps';
import type { GuestPruneStore } from '../ops/guestPrune';
import type { Deps } from '../endpoints/types';
import { runSubjectData, type SubjectDataHandler, type SubjectDataOp, type SubjectDataResult, type SubjectDataRow } from '../platform/subjectData';
import { publishSessionEvent } from './events';
import { requireSubjectDataDeps, runInAuthScope, runInSubjectDataScope } from './scope';

export const AUTH_CAPABILITY = 'auth';

export interface AuthSubjectExport {
  email: string | null;
  googleName: string | null;
  /** Sign-in methods: `email` for an account, plus the provider id of every linked account (no tokens). */
  methods: string[];
  sessions: { createdAt: string; expiresAt: string; deviceId: string | null }[];
  devices: string[];
  /** Guest-data moves still waiting for a retry (`auth_link_retries`) to or from this subject (S10-10). */
  pendingLinks: { handler: string; direction: 'to' | 'from'; createdAt: string }[];
}

interface SqlPool {
  query(text: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

async function contextOf(deps: Deps) {
  return authOf(deps).instance().$context;
}

async function poolOf(deps: Deps): Promise<SqlPool> {
  const db = (await contextOf(deps)).options.database as { query?: unknown } | undefined;
  if (db === undefined || typeof db.query !== 'function') throw new Error('auth subject data: no database pool');
  return db as SqlPool;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** The `name` claim of an id token (payload only, signature not needed: our own stored row), or null. */
function nameClaimOf(idToken: unknown): string | null {
  if (typeof idToken !== 'string') return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { name?: unknown };
    return typeof payload.name === 'string' && payload.name !== '' ? payload.name : null;
  } catch {
    return null;
  }
}

async function exportOf(deps: Deps, subjectId: string): Promise<AuthSubjectExport | null> {
  const pool = await poolOf(deps);
  const users = await pool.query('SELECT email, name, is_anonymous, device_id FROM users WHERE id::text = $1', [subjectId]);
  const user = users.rows[0];
  if (user === undefined) return null;
  const guest = user.is_anonymous === true;
  // `id_token` is read only to take the `name` claim; it never leaves this function.
  const accounts = await pool.query('SELECT provider_id, id_token FROM user_accounts WHERE user_id::text = $1 ORDER BY provider_id', [subjectId]);
  const providers = [...new Set(accounts.rows.map((r) => String(r.provider_id)))];
  const googleClaim = accounts.rows.filter((r) => r.provider_id === 'google').map((r) => nameClaimOf(r.id_token)).find((n) => n !== null) ?? null;
  const sessions = await pool.query('SELECT created_at, expires_at, device_id FROM user_sessions WHERE user_id::text = $1 ORDER BY created_at', [subjectId]);
  const sessionRows = sessions.rows.map((r) => ({
    createdAt: iso(r.created_at),
    expiresAt: iso(r.expires_at),
    deviceId: typeof r.device_id === 'string' && r.device_id !== '' ? r.device_id : null,
  }));
  const devices = new Set<string>();
  if (typeof user.device_id === 'string' && user.device_id !== '') devices.add(user.device_id);
  for (const s of sessionRows) if (s.deviceId !== null) devices.add(s.deviceId);
  const name = typeof user.name === 'string' ? user.name : '';
  const links = await pool.query(
    'SELECT handler, user_id, created_at FROM auth_link_retries WHERE user_id = $1 OR from_subject = $1 ORDER BY created_at, id',
    [subjectId],
  );
  const pendingLinks = links.rows.map((r) => ({
    handler: String(r.handler),
    direction: (String(r.user_id) === subjectId ? 'to' : 'from') as 'to' | 'from',
    createdAt: iso(r.created_at),
  }));
  return {
    email: guest ? null : String(user.email),
    // A Google-made account keeps the Google name on the user; a linked one only in the id token (no update on link).
    googleName: providers.includes('google') ? (googleClaim ?? (name !== '' ? name : null)) : null,
    methods: guest ? providers : [...new Set(['email', ...providers])],
    sessions: sessionRows,
    devices: [...devices].sort(),
    pendingLinks,
  };
}

async function eraseOf(deps: Deps, subjectId: string): Promise<{ erased: boolean }> {
  const pool = await poolOf(deps);
  const found = await pool.query('SELECT email, is_anonymous FROM users WHERE id::text = $1', [subjectId]);
  const user = found.rows[0];
  if (user === undefined) {
    await pool.query('DELETE FROM auth_link_retries WHERE user_id = $1 OR from_subject = $1', [subjectId]);
    return { erased: false };
  }
  // No foreign key on `auth_link_retries` (Payload table): its rows of the subject go explicitly (S10-10).
  await pool.query('DELETE FROM auth_link_retries WHERE user_id = $1 OR from_subject = $1', [subjectId]);
  // `erased` goes out BEFORE the deletion: the session-delete hooks publish `signed-out` and disconnect the subject's
  // connections, so a later `erased` would reach the history only, not an open tab (Better Auth 1.7.27 runs those
  // hooks inside `deleteUser`).
  await publishSessionEvent(deps, subjectId, 'erased');
  const ctx = await contextOf(deps);
  await ctx.internalAdapter.deleteUser(subjectId);
  if (user.is_anonymous !== true) await ctx.internalAdapter.deleteVerificationByIdentifier(`sign-in-otp-${String(user.email)}`);
  return { erased: true };
}

/** The `auth` row of `registries/subjectData.ts`. */
export const authSubjectData: SubjectDataHandler = {
  capability: AUTH_CAPABILITY,
  export: async (subjectId) => exportOf(requireSubjectDataDeps(), subjectId),
  erase: async (subjectId) => eraseOf(requireSubjectDataDeps(), subjectId),
  anonymise: async (subjectId) => eraseOf(requireSubjectDataDeps(), subjectId),
};

/** `runSubjectData` inside the auth scope of `deps` (the `auth` handler and Better Auth's hooks need it). */
export function runSubjectDataInScope(deps: Deps, op: SubjectDataOp, subjectId: string, rows: readonly SubjectDataRow[]): Promise<SubjectDataResult> {
  return runInSubjectDataScope(deps, () => runSubjectData(op, subjectId, rows));
}

const LAST_ACTIVE = `COALESCE((SELECT max(s.updated_at) FROM user_sessions s WHERE s.user_id = u.id), u.created_at)`;

/** The guest store over Better Auth's pool; deletion through its internal adapter inside the auth scope. */
export function createAuthGuestStore(deps: () => Deps): GuestPruneStore {
  return {
    async staleGuests(beforeMs, limit, after) {
      // Sign-in not wired into these deps → no guests to look at.
      if (deps().auth === undefined) return [];
      const pool = await poolOf(deps());
      // Keyset cursor `<last as text>|<id>` (text keeps the full timestamp precision), S10-09.
      const bar = after?.lastIndexOf('|') ?? -1;
      const [afterLast, afterId] = after !== undefined && bar > 0 ? [after.slice(0, bar), after.slice(bar + 1)] : [null, null];
      const r = await pool.query(
        `SELECT id, last, last::text AS last_text FROM (
           SELECT u.id::text AS id, ${LAST_ACTIVE} AS last FROM users u WHERE u.is_anonymous = true
         ) g
          WHERE last < $1 AND ($3::timestamptz IS NULL OR (last, id) > ($3::timestamptz, $4::text))
          ORDER BY last, id LIMIT $2`,
        [new Date(beforeMs), limit, afterLast, afterId],
      );
      return r.rows.map((row) => ({
        id: String(row.id),
        lastActiveAtMs: row.last instanceof Date ? row.last.getTime() : Date.parse(String(row.last)),
        cursor: `${String(row.last_text)}|${String(row.id)}`,
      }));
    },
    async deleteIfStale(id, beforeMs) {
      const d = deps();
      const pool = await poolOf(d);
      const r = await pool.query(`SELECT 1 FROM users u WHERE u.id::text = $1 AND u.is_anonymous = true AND ${LAST_ACTIVE} < $2`, [id, new Date(beforeMs)]);
      if (r.rows.length === 0) return false;
      const ctx = await contextOf(d);
      await runInAuthScope(() => ctx.internalAdapter.deleteUser(id));
      return true;
    },
  };
}
