/**
 * Subject data of the rights capability (SPEC-11 W36, FR-PLAT-13, AC-54 ... AC-57, AC-31, EC-9): the rows `profile`,
 * `passes` and `bans` of `registries/subjectData.ts`. Like the `auth` row, a handler holds no deps: it reads them from
 * the auth scope (`requireSubjectDataDeps`), so callers run the registry through `runSubjectDataInScope`.
 * - `profile`: export nick, flag, settings, schedule and the pending email change `{email, sentAt}`; erase = the row
 *   (nick freed) and the pending change code `t2f-change-email-<id>`; anonymise = erase.
 * - `passes`: export `{season, source, issuedAt, place}` of the passes attached to the subject or unattached on its
 *   devices (no email, no device id); erase of an account strips the attached passes (account id, email, device),
 *   unattached passes stay on their payment email (FR-PRIV-05, EC-9).
 * - `bans`: export `{kind, since}` of the bans on the subject and on its devices; erase deletes the subject's OWN ban and
 *   keeps device bans derived from it [Q4] (`source_ban_id` goes null, the row stays).
 * The handlers do not depend on each other: the `auth` erase deletes the user and sessions concurrently, so nothing here
 * reads `users` / `user_sessions` on the erase path.
 */
import { decodeEmailChange, emailChangeIdentifier } from '../domain/rights/signInMethods';
import { rightsDbOf } from '../auth/pool';
import { requireSubjectDataDeps } from '../auth/scope';
import type { Deps } from '../endpoints/types';
import type { SubjectDataHandler } from '../platform/subjectData';
import type { RightsQuery } from './ports';

export const PROFILE_CAPABILITY = 'profile';
export const PASSES_CAPABILITY = 'passes';
export const BANS_CAPABILITY = 'bans';

/** The verification identifier of a pending email change (P10 `emailChange.ts` writes it). */
export const changeEmailIdentifier = emailChangeIdentifier;

export interface ProfileSubjectExport {
  nick: string | null;
  flagCode: string | null;
  settings: Record<string, unknown>;
  schedule: string[];
  pendingEmailChange: { email: string; sentAt: string } | null;
}
export interface PassSubjectExport {
  season: string;
  source: string;
  issuedAt: string;
  place: 'account' | 'device';
}
export interface BanSubjectExport {
  kind: 'account' | 'guest' | 'device';
  since: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

/** The device ids of a subject: its own row (a guest's device) and its sessions' devices. */
async function devicesOf(db: RightsQuery, subjectId: string): Promise<string[]> {
  const res = await db.query<{ device_id: string | null }>(
    `SELECT device_id FROM users WHERE id::text = $1
     UNION SELECT device_id FROM user_sessions WHERE user_id::text = $1`,
    [subjectId],
  );
  return [...new Set(res.rows.map((r) => r.device_id).filter((d): d is string => typeof d === 'string' && d !== ''))].sort();
}

async function pendingChangeOf(db: RightsQuery, subjectId: string): Promise<ProfileSubjectExport['pendingEmailChange']> {
  const res = await db.query<{ value: unknown; created_at: unknown }>(
    'SELECT value, created_at FROM auth_verifications WHERE identifier = $1 AND expires_at > now() ORDER BY created_at DESC LIMIT 1',
    [changeEmailIdentifier(subjectId)],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  // Value shape of `emailChange.ts` (plan [П-11]): `<email>:<sha256>:<attemptsLeft>:<sentAt>`.
  const email = decodeEmailChange(row.value)?.email ?? null;
  return email === null ? null : { email, sentAt: iso(row.created_at) };
}

async function profileExport(deps: Deps, subjectId: string): Promise<ProfileSubjectExport | null> {
  const db = await rightsDbOf(deps);
  const res = await db.query<{ nick: string | null; flag_code: string | null; settings: Record<string, unknown>; schedule: string[] }>(
    'SELECT nick, flag_code, settings, schedule FROM profiles WHERE subject_id = $1',
    [subjectId],
  );
  const row = res.rows[0];
  const pendingEmailChange = await pendingChangeOf(db, subjectId);
  if (row === undefined) return pendingEmailChange === null ? null : { nick: null, flagCode: null, settings: {}, schedule: [], pendingEmailChange };
  return { nick: row.nick, flagCode: row.flag_code, settings: row.settings, schedule: [...row.schedule], pendingEmailChange };
}

async function profileErase(deps: Deps, subjectId: string): Promise<{ erased: boolean }> {
  const db = await rightsDbOf(deps);
  const res = await db.query('DELETE FROM profiles WHERE subject_id = $1', [subjectId]);
  await db.query('DELETE FROM auth_verifications WHERE identifier = $1', [changeEmailIdentifier(subjectId)]);
  return { erased: (res.rowCount ?? 0) > 0 };
}

async function passesExport(deps: Deps, subjectId: string): Promise<PassSubjectExport[]> {
  const db = await rightsDbOf(deps);
  const devices = await devicesOf(db, subjectId);
  const res = await db.query<{ season: string; source: string; issued_at: unknown; attached: boolean }>(
    `SELECT season, source, issued_at, (attached_user_id IS NOT NULL) AS attached FROM passes
      WHERE revoked_at IS NULL AND erased_at IS NULL
        AND (attached_user_id::text = $1 OR (attached_user_id IS NULL AND device_id = ANY($2::text[])))
      ORDER BY season, issued_at, id`,
    [subjectId, devices],
  );
  return res.rows.map((r) => ({ season: r.season, source: r.source, issuedAt: iso(r.issued_at), place: r.attached ? 'account' : 'device' }));
}

async function passesErase(deps: Deps, subjectId: string): Promise<{ stripped: number }> {
  const db = await rightsDbOf(deps);
  const res = await db.query(
    `UPDATE passes SET attached_user_id = NULL, payment_email = NULL, device_id = NULL, erased_at = now()
      WHERE attached_user_id::text = $1 AND erased_at IS NULL`,
    [subjectId],
  );
  return { stripped: res.rowCount ?? 0 };
}

async function bansExport(deps: Deps, subjectId: string): Promise<BanSubjectExport[]> {
  const db = await rightsDbOf(deps);
  const devices = await devicesOf(db, subjectId);
  const res = await db.query<{ kind: BanSubjectExport['kind']; created_at: unknown }>(
    `SELECT kind, created_at FROM bans
      WHERE (kind IN ('account', 'guest') AND subject_id = $1) OR (kind = 'device' AND subject_id = ANY($2::text[]))
      ORDER BY created_at, id`,
    [subjectId, devices],
  );
  return res.rows.map((r) => ({ kind: r.kind, since: iso(r.created_at) }));
}

async function bansErase(deps: Deps, subjectId: string): Promise<{ removed: number }> {
  const db = await rightsDbOf(deps);
  const res = await db.query(`DELETE FROM bans WHERE kind IN ('account', 'guest') AND subject_id = $1`, [subjectId]);
  return { removed: res.rowCount ?? 0 };
}

function handler<E>(
  capability: string,
  exp: (deps: Deps, id: string) => Promise<E>,
  era: (deps: Deps, id: string) => Promise<unknown>,
): SubjectDataHandler {
  return {
    capability,
    export: (id) => exp(requireSubjectDataDeps(), id),
    erase: (id) => era(requireSubjectDataDeps(), id),
    anonymise: (id) => era(requireSubjectDataDeps(), id),
  };
}

export const profileSubjectData = handler(PROFILE_CAPABILITY, profileExport, profileErase);
export const passesSubjectData = handler(PASSES_CAPABILITY, passesExport, passesErase);
export const bansSubjectData = handler(BANS_CAPABILITY, bansExport, bansErase);
