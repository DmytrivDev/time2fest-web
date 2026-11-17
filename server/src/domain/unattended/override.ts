/**
 * The owner's manual switch of the unattended mode (AC-33, owner decision Q5), ring 1 — pure.
 *
 * A manual on/off made at instant `at` holds until the nearest boundary of any sleep window after
 * `at`; from that boundary on the schedule applies again. With no boundary after `at` it holds
 * until the owner switches again. The boundary is worked out from the windows as they are now, so a
 * window added after the switch still ends it. A different Q5 answer ("until I switch back") changes
 * this file and `kyiv.ts` only.
 */
import { nextBoundary, type SleepWindow } from './windows';

export interface ManualHold {
  on: boolean;
  /** When the owner switched (epoch ms). */
  at: number;
}

/** The instant the hold ends (exclusive), or `null` = it holds until the next manual switch. */
export function holdUntil(windows: readonly SleepWindow[], at: number): number | null {
  return nextBoundary(windows, at);
}

/** Whether a manual switch made at `hold.at` still holds at `now`. */
export function holdActive(hold: ManualHold, windows: readonly SleepWindow[], now: number): boolean {
  const until = holdUntil(windows, hold.at);
  return until === null || now < until;
}
