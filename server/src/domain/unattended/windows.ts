/**
 * Sleep windows of the unattended mode (AC-31, AC-32), ring 1 — pure, time is a parameter.
 *
 * A window is a one-off interval of UTC instants (epoch ms), half-open: `[startsAt, endsAt)`. The
 * start instant is inside the window, the end instant is not. Two windows overlap when they share an
 * instant; windows that only touch (one ends where the next starts) do not.
 */

export interface SleepWindow {
  /** Stored record id; absent for a window that is not saved yet. */
  id?: string;
  startsAt: number;
  endsAt: number;
}

export type WindowCheck = 'ok' | 'end-not-after-start' | 'overlaps';

/** Whether `candidate` may be stored next to `existing` (a row with the candidate's own id is ignored, for updates). */
export function validateWindow(candidate: SleepWindow, existing: readonly SleepWindow[]): WindowCheck {
  if (!(candidate.endsAt > candidate.startsAt)) return 'end-not-after-start';
  const others = existing.filter((w) => candidate.id === undefined || w.id !== candidate.id);
  return others.some((w) => candidate.startsAt < w.endsAt && w.startsAt < candidate.endsAt) ? 'overlaps' : 'ok';
}

/** The window `now` is inside, or `null`. */
export function activeWindow(windows: readonly SleepWindow[], now: number): SleepWindow | null {
  return windows.find((w) => w.startsAt <= now && now < w.endsAt) ?? null;
}

/** The nearest window boundary (a start or an end) strictly after `now`, or `null` when there is none. */
export function nextBoundary(windows: readonly SleepWindow[], now: number): number | null {
  let next: number | null = null;
  for (const w of windows) {
    for (const b of [w.startsAt, w.endsAt]) {
      if (b > now && (next === null || b < next)) next = b;
    }
  }
  return next;
}
