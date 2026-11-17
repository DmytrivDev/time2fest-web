/**
 * Server clock (AC-34, AC-41). The only file in `server/src` that reads the wall clock.
 * - `virtualNow` is the pure core (ring 1);
 * - `realClock` reads `Date.now()`;
 * - the test clock is a process singleton, reachable for change only through `createTestClock`,
 *   which only `test-doors` imports. `clockFor('production' | 'rehearsal')` is the real clock.
 */
import type { EnvClass } from '../platform/env';
import type { Clock } from '../ports';

export interface ClockState {
  anchorVirtual: number;
  anchorReal: number;
  speed: number;
  frozen: boolean;
}

/** Virtual instant for a real instant: constant when frozen, else anchor + elapsed · speed. */
export function virtualNow(state: ClockState, realNow: number): number {
  if (state.frozen) return state.anchorVirtual;
  return Math.round(state.anchorVirtual + (realNow - state.anchorReal) * state.speed);
}

export const realClock: Clock = Object.freeze({ now: () => Date.now() });

export interface TestClock extends Clock {
  /** Changes the virtual time; re-anchors at the current virtual instant first, so nothing jumps. */
  set(change: { at?: number; speed?: number; frozen?: boolean }): void;
  state(): { now: number; speed: number; frozen: boolean };
  /** Back to real time, speed 1, not frozen. */
  reset(): void;
}

const KEY = Symbol.for('t2f.clock');

function realState(): ClockState {
  const t = Date.now();
  return { anchorVirtual: t, anchorReal: t, speed: 1, frozen: false };
}

/** The singleton state, shared by every module copy in the process. */
function singleton(): { state: ClockState } {
  const g = globalThis as unknown as Record<symbol, { state: ClockState } | undefined>;
  let box = g[KEY];
  if (!box) {
    box = { state: realState() };
    g[KEY] = box;
  }
  return box;
}

const testView: Clock = Object.freeze({ now: () => virtualNow(singleton().state, Date.now()) });

/** The controllable test clock. Import only from `test-doors`. */
export function createTestClock(): TestClock {
  const box = singleton();
  return {
    now: () => virtualNow(box.state, Date.now()),
    set(change) {
      if (change.speed !== undefined && !(Number.isFinite(change.speed) && change.speed >= 0)) {
        throw new Error('clock: speed must be a finite number ≥ 0');
      }
      if (change.at !== undefined && !Number.isFinite(change.at)) throw new Error('clock: at must be a finite number');
      const real = Date.now();
      const current = virtualNow(box.state, real);
      box.state = {
        anchorVirtual: change.at ?? current,
        anchorReal: real,
        speed: change.speed ?? box.state.speed,
        frozen: change.frozen ?? box.state.frozen,
      };
    },
    state: () => ({ now: virtualNow(box.state, Date.now()), speed: box.state.speed, frozen: box.state.frozen }),
    reset() {
      box.state = realState();
    },
  };
}

/** Real time for production and rehearsal; the read-only view of the test clock for `test`. */
export function clockFor(cls: EnvClass): Clock {
  return cls === 'test' ? testView : realClock;
}
