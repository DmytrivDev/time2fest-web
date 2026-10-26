/**
 * Один спільний «секундний» годинник на весь сайт (contracts/time-api.md, п. 6):
 * компоненти не заводять власних `setInterval`, а підписуються на цей.
 * Такт вирівнюється на межу секунди джерела часу; при прискоренні «машини часу»
 * такт частішає (не частіше ніж раз на 100 мс). Стрибок джерела (перемотка,
 * нова синхронізація) — негайний такт.
 */
import type { TimeSourceLike } from './types';

export const MIN_TICK_MS = 100;
export const MAX_TICK_MS = 1_000;
/** Невеликий запас, щоб такт гарантовано потрапив після межі секунди. */
const BOUNDARY_SLACK_MS = 5;

export interface Clock {
  /** Значення `now` останнього такту (стабільне між тактами). */
  getSnapshot(): number;
  subscribe(listener: () => void): () => void;
  /** Примусовий такт (наприклад після перемотки). */
  tick(): void;
  readonly source: TimeSourceLike;
}

export interface ClockDeps {
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export function nextTickDelay(now: number, speed: number): number {
  if (!(speed > 0)) return MAX_TICK_MS;
  const toBoundary = 1_000 - (((now % 1_000) + 1_000) % 1_000);
  const real = (toBoundary + BOUNDARY_SLACK_MS) / speed;
  return Math.min(MAX_TICK_MS, Math.max(MIN_TICK_MS, real));
}

export function createClock(source: TimeSourceLike, deps: ClockDeps = {}): Clock {
  const setTimer =
    deps.setTimer ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
  const listeners = new Set<() => void>();
  let current = source.now();
  let cancel: (() => void) | null = null;
  let unsubSource: (() => void) | null = null;

  const schedule = () => {
    cancel?.();
    cancel = setTimer(run, nextTickDelay(current, source.speed));
  };
  const run = () => {
    cancel = null;
    tick();
  };
  function tick() {
    current = source.now();
    for (const l of [...listeners]) l();
    if (listeners.size > 0) schedule();
  }

  return {
    source,
    getSnapshot: () => current,
    tick,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        unsubSource = source.subscribe(tick);
        current = source.now();
        schedule();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          cancel?.();
          cancel = null;
          unsubSource?.();
          unsubSource = null;
        }
      };
    },
  };
}
