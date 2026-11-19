/**
 * Server clock (AC-34, AC-41; SPEC-07 AC-1, AC-49). The only folder in `server/src` that reads the wall clock.
 * - `virtualNow` is the pure core (ring 1, `domain/timekeeping/virtual.ts`), re-exported here;
 * - `realClock` reads `Date.now()`, `monotonicClock` reads `performance.now()`;
 * - `clockFor('production')` is the real clock: production has no virtual time at all;
 * - `clockFor('test' | 'rehearsal', shared)` is the shared clock of the process (`timekeeping/shared.ts`),
 *   whose state lives in the database and is cached per process in `processClockCache()`. Without
 *   `shared` (a Payload hook that has no deps) it is the read-only view of that same process cache;
 * - the test clock (`createTestClock`) is a facade over the shared clock and its store, reachable for
 *   change only from `test-doors` (and tests). Its changes go through the store, so they persist and
 *   reach every process of the environment.
 */
import { backToReal, initialState, now as stateNow, testSet, type TestClockChange } from '../domain/timekeeping/virtual';
import type { EnvClass } from '../platform/env';
import type { Clock } from '../ports';
import type { Actor, MonotonicClock } from '../timekeeping/ports';
import type { ClockCache, SharedClock } from '../timekeeping/shared';

export { virtualNow, type VirtualAnchor as ClockState } from '../domain/timekeeping/virtual';

export const realClock: Clock = Object.freeze({ now: () => Date.now() });

/** Durations only: never goes backwards, unrelated to the wall clock or to virtual time. */
export const monotonicClock: MonotonicClock = Object.freeze({ now: () => performance.now() });

const KEY = Symbol.for('t2f.clock');

/** The clock cache of this process, shared by every deps set and every module copy in it. */
export function processClockCache(): ClockCache {
  const g = globalThis as unknown as Record<symbol, ClockCache | undefined>;
  return (g[KEY] ??= { state: initialState(Date.now()) });
}

/** Read-only view of the process cache, for callers without deps (Payload hooks). */
const processView: Clock = Object.freeze({ now: () => stateNow(processClockCache().state, Date.now()) });

/** Real time for production; the shared clock (or the read-only process view) for test and rehearsal. */
export function clockFor(cls: EnvClass, shared?: SharedClock): Clock {
  if (cls === 'production') return realClock;
  return shared ?? processView;
}

export interface TestClock extends Clock {
  /** Changes the virtual time; re-anchors at the current virtual instant first, so nothing jumps. */
  set(change: TestClockChange): Promise<void>;
  state(): { now: number; speed: number; frozen: boolean };
  /** Back to real time, speed 1, not frozen (no write when the clock is already real). */
  reset(): Promise<void>;
}

/** The actor of the journal rows of the test door. */
export const TEST_DOOR_ACTOR: Actor = Object.freeze({ kind: 'system', id: 'test-door', label: 'test-door' });

/** The controllable test clock over `shared`. Import only from `test-doors` (and tests). */
export function createTestClock(shared: SharedClock): TestClock {
  return {
    now: () => shared.now(),
    async set(change) {
      await shared.change(TEST_DOOR_ACTOR, (s, real) => testSet(s, change, real));
    },
    state: () => shared.view(),
    async reset() {
      await shared.change(TEST_DOOR_ACTOR, (s, real) => (s.virtual ? backToReal(s, real) : s));
    },
  };
}
