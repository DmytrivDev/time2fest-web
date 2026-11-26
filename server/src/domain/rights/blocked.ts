/**
 * Who may not write (SPEC-11 W15; FR-ID-16, FR-ID-17; AC-18, AC-21, AC-24). Pure: the caller reads the bans and the
 * fingerprint marks, this decides. Order: the subject's own ban (account/guest) → the device ban → the daily
 * fingerprint block, which applies only to a guest created after the mark
 * (strictly: the guest whose own request writes the mark is not blocked by it). Bans have no term (`until: null`);
 * the fingerprint block ends at the next 00:00 UTC, when the fingerprint changes.
 */

export type BlockedKind = 'account' | 'guest' | 'device' | 'ip-day';
export type Blocked = { blocked: false } | { blocked: true; kind: BlockedKind; until: number | null };

export interface BlockedInput {
  subjectKind: 'account' | 'guest';
  /** The subject's own ban, if any. */
  subjectBan: 'account' | 'guest' | null;
  /** The request's device is banned. */
  deviceBan: boolean;
  /** Ban instant on the guest's creation fingerprint (same UTC day), or `null`; blocks guests created strictly later. */
  ipDayMarkAtMs: number | null;
  /** When the guest was created (server clock), or `null` when unknown. */
  guestCreatedAtMs: number | null;
  /** The next 00:00 UTC — when the fingerprint, and so the mark, changes. */
  nextUtcMidnightMs: number;
}

const DAY_MS = 86_400_000;

/** The next 00:00 UTC strictly after `ms`. */
export function nextUtcMidnight(ms: number): number {
  return (Math.floor(ms / DAY_MS) + 1) * DAY_MS;
}

export function blockedVerdict(input: BlockedInput): Blocked {
  if (input.subjectBan !== null) return { blocked: true, kind: input.subjectBan, until: null };
  if (input.deviceBan) return { blocked: true, kind: 'device', until: null };
  if (
    input.subjectKind === 'guest' &&
    input.ipDayMarkAtMs !== null &&
    input.guestCreatedAtMs !== null &&
    input.ipDayMarkAtMs < input.guestCreatedAtMs
  ) {
    return { blocked: true, kind: 'ip-day', until: input.nextUtcMidnightMs };
  }
  return { blocked: false };
}
