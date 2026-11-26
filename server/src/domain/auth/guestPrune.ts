/**
 * Guest cleanup rules (SPEC-10 W41, AC-5), pure: a guest is stale after 30 days without session activity, and is
 * removed only when no subject-data handler outside the ignored ones holds anything about it. SPEC-11 [П-5] (conductor
 * decision 1): `profile` and `bans` data do not keep a guest either (its nick is released on removal, AC-31).
 */

export const GUEST_STALE_MS = 30 * 24 * 60 * 60 * 1000;
/** Guests examined per run at most. */
export const GUEST_PRUNE_BATCH = 500;

/** Activity before this instant is stale at `nowMs`. */
export const staleBefore = (nowMs: number): number => nowMs - GUEST_STALE_MS;

/** True when the guest's last activity (latest session update, or creation without sessions) is 30+ days old. */
export function isStale(lastActiveAtMs: number, nowMs: number): boolean {
  return Number.isFinite(lastActiveAtMs) && lastActiveAtMs <= staleBefore(nowMs);
}

/** An export result that holds nothing: null/undefined, an empty array, or an object whose values are all empty. */
export function isEmptySubjectData(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).every(isEmptySubjectData);
  return false;
}

/** Capabilities whose data alone never keeps a guest (SPEC-11 W29). */
export const GUEST_PRUNE_IGNORED: readonly string[] = ['auth', 'bans', 'profile'];

/** True when any capability except those in `except` returned data for the subject. */
export function holdsOtherData(results: Record<string, unknown>, except: string | readonly string[]): boolean {
  const ignored = typeof except === 'string' ? [except] : except;
  return Object.entries(results).some(([capability, value]) => !ignored.includes(capability) && !isEmptySubjectData(value));
}
