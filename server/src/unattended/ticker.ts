/**
 * The unattended-mode ticker (AC-32: a transition ≤ 30 s after the boundary), ring 3. One per
 * process: runs `tick` every 10 s, never two at once (a slow tick makes the next one skip). Several
 * instances are safe — `evaluate` locks and compares before it writes. A failing tick is reported
 * and the ticker keeps going. Started by the process background only, never by `next build` or a CLI.
 */

export const TICK_MS = 10_000;

export interface Ticker {
  /** Stops the timer and waits for a running tick to end. */
  stop(): Promise<void>;
}

export interface TickerDeps {
  tick: () => Promise<unknown>;
  onError: (err: unknown) => void;
  intervalMs?: number;
}

export function startTicker({ tick, onError, intervalMs = TICK_MS }: TickerDeps): Ticker {
  let running: Promise<void> | null = null;
  const run = () => {
    if (running) return;
    running = tick()
      .then(() => undefined, onError)
      .finally(() => {
        running = null;
      });
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  run();
  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
