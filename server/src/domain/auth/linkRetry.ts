/**
 * Guest-merge retry rules (SPEC-11 W29b, conductor decision 2; AC-49, AC-50), pure: a row of `auth_link_retries` is
 * retried hourly until it succeeds (the row is then deleted = closed) or reaches 24 attempts (kept as dead: it still
 * holds its guest, one `log` alarm `auth/link-retry {gaveUp:true}`).
 */

export const LINK_RETRY_MAX_ATTEMPTS = 24;
export const LINK_RETRY_EVERY_MS = 3_600_000;
/** Rows taken per run at most. */
export const LINK_RETRY_BATCH = 100;
/** A row taken by a run is hidden from other runs this long (the run closes or reschedules it well before). */
export const LINK_RETRY_CLAIM_MS = 10 * 60_000;
/** `from_subject` of the finish step of a sign-in without a guest (`auth/forward.ts`). */
export const DEVICE_SUBJECT_PREFIX = 'device:';

export interface LinkRetryRow {
  id: number;
  userId: string;
  fromSubject: string;
  handler: string;
  attempts: number;
  nextAtMs: number;
}

/** When a row that failed its `attempts`-th time is tried again. */
export const nextRetryAt = (_attempts: number, nowMs: number): number => nowMs + LINK_RETRY_EVERY_MS;

/** Due at `nowMs` and not given up. */
export const isDue = (row: Pick<LinkRetryRow, 'attempts' | 'nextAtMs'>, nowMs: number): boolean =>
  row.attempts < LINK_RETRY_MAX_ATTEMPTS && row.nextAtMs <= nowMs;

/** The row is given up after its `attempts`-th failure. */
export const gaveUp = (attempts: number): boolean => attempts >= LINK_RETRY_MAX_ATTEMPTS;

/** The device of a `device:<id>` subject, or null for a guest id. */
export function deviceOfSubject(fromSubject: string): string | null {
  return fromSubject.startsWith(DEVICE_SUBJECT_PREFIX) ? fromSubject.slice(DEVICE_SUBJECT_PREFIX.length) : null;
}
