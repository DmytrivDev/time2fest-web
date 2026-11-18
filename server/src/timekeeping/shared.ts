/**
 * The shared server clock of one process (SPEC-07 AC-1, AC-49, AC-50), ring 3.
 *
 * `now()` reads a cached copy of the stored state: real time while the clock is not virtual, else
 * the virtual instant. The cache is refreshed from the store
 * - on boot (`startClockRefresh`, called by `startProcessBackground`),
 * - on every `clock.changed` internal event (subscriber row `clock-refresh`),
 * - every 5 s as a fallback (unref'd timer of `startClockRefresh`),
 * - and right after a change made by this process (`change`).
 * A process that never starts its background (CLI, tests) must call `refresh()` itself to see a
 * state written by another process.
 *
 * The cache box is injected: the composition root passes the process-wide box, so every deps set
 * and every module copy of one process reads the same cache. Real time comes from the injected
 * `real` clock; this module never reads the wall clock.
 */
import { effective, now as stateNow, type VirtualState } from '../domain/timekeeping/virtual';
import type { EventSubscriber } from '../events/ports';
import type { Clock } from '../ports';
import { CLOCK_CHANGED_TOPIC, type Actor, type ClockStateStore } from './ports';

/** The cached state of one process. */
export interface ClockCache {
  state: VirtualState;
}

export interface SharedClock extends Clock {
  /** Reloads the cache from the store. */
  refresh(): Promise<void>;
  /** The cached state. */
  state(): VirtualState;
  /** Puts a state into the cache, unless the cache already holds a later change (`seq`). */
  apply(state: VirtualState): void;
  /** `store.change`, then `apply` of the written state: the changing process sees it at once. */
  change(actor: Actor, fn: (state: VirtualState, realNow: number) => VirtualState): Promise<VirtualState>;
  /** Current instant, speed and frozen flag, in the shape of `GET /api/_test/clock`. */
  view(): { now: number; speed: number; frozen: boolean };
}

export interface SharedClockDeps {
  store: ClockStateStore;
  real: Clock;
  cache: ClockCache;
}

export function createSharedClock({ store, real, cache }: SharedClockDeps): SharedClock {
  // Number of applies so far: a refresh that saw none during its load may also move `seq` back
  // (a re-created database), any other refresh only forward.
  let applied = 0;
  const put = (state: VirtualState) => {
    cache.state = state;
    applied += 1;
  };
  const apply = (state: VirtualState) => {
    if (state.seq >= cache.state.seq) put(state);
  };
  return {
    now: () => stateNow(cache.state, real.now()),
    state: () => cache.state,
    apply,
    async refresh() {
      const mark = applied;
      const loaded = await store.load();
      if (applied === mark) put(loaded);
      else apply(loaded);
    },
    async change(actor, fn) {
      const written = await store.change(actor, fn);
      apply(written);
      return written;
    },
    view() {
      const s = cache.state;
      return { now: stateNow(s, real.now()), ...effective(s) };
    },
  };
}

/**
 * Subscriber row `clock-refresh`: every committed `clock.changed` reloads the cache of the
 * receiving process. `shared` resolves to `undefined` in production (no shared clock).
 */
export function createClockRefreshSubscriber(shared: () => Promise<Pick<SharedClock, 'refresh'> | undefined>): EventSubscriber {
  return {
    key: 'clock-refresh',
    topic: CLOCK_CHANGED_TOPIC,
    async handle() {
      await (await shared())?.refresh();
    },
  };
}

export interface ClockRefresh {
  stop(): void;
}

/**
 * Refreshes `shared` now and then every `intervalMs` (default 5 s) on an unref'd timer. A failed
 * refresh (database down) is reported through `onError` and the cache stays as it is. Resolves
 * once the first refresh settled.
 */
export async function startClockRefresh(
  shared: Pick<SharedClock, 'refresh'>,
  opts: { onError(err: unknown): void; intervalMs?: number },
): Promise<ClockRefresh> {
  const tick = () => shared.refresh().catch(opts.onError);
  await tick();
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 5_000);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
