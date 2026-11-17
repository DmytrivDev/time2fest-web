/**
 * Auto-on after an unacknowledged `page` alarm (AC-34), ring 1 — pure.
 *
 * An open `page` alarm is due 15 minutes after it was raised. `ignoreDueUpTo` lets a manual switch
 * take precedence over alarms that were already due when the owner switched (AC-35: a manual off ends
 * the alarm-caused mode); an alarm that becomes due after the switch turns the mode on again.
 */

export const ALARM_GRACE_MS = 15 * 60_000;

export interface PageAlarm {
  /** Epoch ms. */
  raisedAt: number;
  acknowledgedAt: number | null;
}

/** The instant an alarm becomes due. */
export const dueAt = (alarm: PageAlarm): number => alarm.raisedAt + ALARM_GRACE_MS;

/** True when an unacknowledged alarm is due at `now` (and, with `ignoreDueUpTo`, became due after that instant). */
export function alarmDue(openPageAlarms: readonly PageAlarm[], now: number, ignoreDueUpTo: number | null = null): boolean {
  return openPageAlarms.some((a) => a.acknowledgedAt === null && dueAt(a) <= now && (ignoreDueUpTo === null || dueAt(a) > ignoreDueUpTo));
}
