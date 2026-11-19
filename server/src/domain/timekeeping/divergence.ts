/**
 * Edge-to-origin divergence (SPEC-07 AC-11 … AC-14), ring 1 — pure; every time is a parameter.
 *
 * The divergence of a 60 s window is the minimum of (real arrival time − edge mark) over the trusted
 * requests of the window: the minimum is the sample with the least network delay, so it is the closest
 * to the true clock offset. Only REAL time is used; virtual time never enters here (AC-14).
 */

export const WINDOW_MS = 60_000;
/** |value| above this is a bad window (AC-12). */
export const PAGE_MS = 250;
/** |value| above this and not above `PAGE_MS` is a warning (AC-13). */
export const WARN_MS = 100;
/** Consecutive bad windows that raise the page alarm (AC-12). */
export const PAGE_WINDOWS = 3;

export type DivergenceLevel = 'ok' | 'warn' | 'page';

export interface WindowAcc {
  /** Window index: `windowOf(real arrival)`. */
  window: number;
  /** Minimum of `arrival − edgeNow` so far, or `undefined` for a window without samples. */
  min: number | undefined;
}

export interface WindowVerdict {
  /** Divergence of the window in ms (signed), or `unknown` for a window without trusted samples. */
  value: number | 'unknown';
  level: DivergenceLevel;
  /** Consecutive bad windows including this one; 0 after a good or an empty window. */
  streak: number;
}

export const windowOf = (realMs: number): number => Math.floor(realMs / WINDOW_MS);

export const emptyWindow = (window: number): WindowAcc => ({ window, min: undefined });

/** Adds a sample to the window; the window of `arrivalReal` is the caller's business (see `windowOf`). */
export function addSample(acc: WindowAcc, arrivalReal: number, edgeNow: number): WindowAcc {
  const delta = arrivalReal - edgeNow;
  return { window: acc.window, min: acc.min === undefined || delta < acc.min ? delta : acc.min };
}

/**
 * Closes a window. A bad window (|value| > 250) extends the streak and is `page` exactly when the streak
 * reaches 3 (once per streak: windows 4, 5 … of the same streak are `warn`, not `page` again). A window of
 * 100 < |value| <= 250 is `warn` and ends the streak. An empty window is `unknown`, level `ok`, and resets
 * the streak to 0: "three in a row" needs three measured windows.
 */
export function closeWindow(acc: WindowAcc, streak: number): WindowVerdict {
  if (acc.min === undefined) return { value: 'unknown', level: 'ok', streak: 0 };
  const abs = Math.abs(acc.min);
  if (abs > PAGE_MS) {
    const next = streak + 1;
    return { value: acc.min, level: next === PAGE_WINDOWS ? 'page' : 'warn', streak: next };
  }
  return { value: acc.min, level: abs > WARN_MS ? 'warn' : 'ok', streak: 0 };
}
