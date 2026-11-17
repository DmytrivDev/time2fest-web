/**
 * Exit rule of the alarm-caused unattended mode (AC-35, owner decision Q4), ring 1 — pure.
 *
 * While the mode is on with the cause `alarm`, it ends only when no unacknowledged `page` alarm is
 * left (the owner acknowledged all of them), or by the owner's manual off — which replaces the cause
 * with `manual` and so is handled by `machine.ts`, not here. There is no timeout: hours of quiet do
 * not end it. A different Q4 answer (e.g. a quiet period) changes this file only.
 */
import type { PageAlarm } from './alarmTrigger';

/** Whether the alarm-caused mode ends now. */
export function alarmModeEnds(openPageAlarms: readonly PageAlarm[]): boolean {
  return !openPageAlarms.some((a) => a.acknowledgedAt === null);
}
