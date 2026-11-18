/**
 * Divergence meter (SPEC-07 AC-10 … AC-14), ring 2. Compares the REAL node clock with the edge mark
 * `x-t2f-edge-now` of trusted requests, in 60 s windows on the injected real clock (never the shared
 * or virtual one). Raises `clock/edge-divergence` (page) and `clock/edge-divergence-warn` (log); the
 * details carry `ms` and `windows` only.
 */
import {
  addSample, closeWindow, emptyWindow, windowOf,
  type DivergenceLevel, type WindowAcc,
} from '../domain/timekeeping/divergence';
import type { Alarm, Clock, Logger } from '../ports';

export const EDGE_NOW_HEADER = 'x-t2f-edge-now';
const TICK_MS = 5_000;

/** The last closed window, as the admin slice shows it. */
export interface DivergenceReading {
  /** Signed ms (arrival − edge mark, minimum of the window), or `unknown`. */
  value: number | 'unknown';
  level: DivergenceLevel;
  /** Consecutive bad windows at the last close. */
  streak: number;
  /** Real start of the closed window (ms since epoch), or `undefined` before the first close. */
  windowStart: number | undefined;
}

export interface DivergenceMeter {
  /** One trusted request: the edge mark in ms. Call only when the edge secret was verified. */
  sample(edgeNow: number): void;
  /** Closes the finished windows by real time (the 5 s timer calls it; tests call it directly). */
  tick(): void;
  /** The last closed window; `unknown` until one closed. */
  current(): DivergenceReading;
}

export interface TickTimers {
  every(fn: () => void, ms: number): void;
}

const unrefTimers: TickTimers = {
  every(fn, ms) {
    setInterval(fn, ms).unref?.();
  },
};

/** Parses the header value: decimal digits only, safe integer; anything else is `undefined`. */
export function parseEdgeNow(raw: string | null): number | undefined {
  if (raw === null || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : undefined;
}

export function createDivergenceMeter(opts: { real: Clock; alarm: Alarm; log: Logger; timers?: TickTimers }): DivergenceMeter {
  const { real, alarm, log } = opts;
  const timers = opts.timers ?? unrefTimers;
  let acc: WindowAcc | undefined;
  let streak = 0;
  let reading: DivergenceReading = { value: 'unknown', level: 'ok', streak: 0, windowStart: undefined };
  let lastClosed: number | undefined;
  let started = false;

  function close(a: WindowAcc): void {
    const verdict = closeWindow(a, streak);
    streak = verdict.streak;
    reading = { value: verdict.value, level: verdict.level, streak, windowStart: a.window * 60_000 };
    if (verdict.value === 'unknown') return;
    if (verdict.level === 'page') {
      alarm.raise({ level: 'page', source: 'clock', code: 'edge-divergence', details: { ms: verdict.value, windows: streak } });
    } else if (verdict.level === 'warn' && streak < 3) {
      alarm.raise({ level: 'log', source: 'clock', code: 'edge-divergence-warn', details: { ms: verdict.value, windows: streak } });
    }
  }

  /**
   * Closes the open window when real time left it; a window since the last closed one that was not
   * measured is an empty one: `unknown`, streak 0.
   */
  function roll(nowReal: number): void {
    const cur = windowOf(nowReal);
    if (acc && cur !== acc.window) {
      close(acc);
      lastClosed = acc.window;
      acc = undefined;
    }
    if (!acc && lastClosed !== undefined && cur - lastClosed > 1 && reading.value !== 'unknown') {
      streak = 0;
      reading = { value: 'unknown', level: 'ok', streak: 0, windowStart: (cur - 1) * 60_000 };
    }
  }

  const tick = (): void => {
    try {
      roll(real.now());
    } catch {
      log.warn({ msg: 'divergence-tick-failed' });
    }
  };

  return {
    sample(edgeNow) {
      const arrival = real.now();
      roll(arrival);
      acc = addSample(acc ?? emptyWindow(windowOf(arrival)), arrival, edgeNow);
      if (!started) {
        started = true;
        timers.every(tick, TICK_MS);
      }
    },
    tick,
    current: () => reading,
  };
}
