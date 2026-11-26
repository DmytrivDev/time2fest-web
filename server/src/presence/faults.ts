/**
 * Injected presence faults (SPEC-14 [П-10]), application ring. A process-local switch read by the proof writer, the
 * sampler and the finaliser; only the `presence-fault` test door writes it (defaults: everything up, no beat errors).
 * The door body follows `presenceFaultDoor` of the contracts (`'down' | 'up'`); the door's `fastStore: 'restart'`
 * (SPEC-14 W23) calls `restartFastStore`: from then on `info()` reports a new run id, as a restarted Redis would.
 * The injected beat error share is spread exactly (`nextBeatFails`: error diffusion, the n-th failure on the
 * ceil(n / rate)-th beat after the rate was set), so a test of 50 beats at 2 % sees exactly one failure.
 */
import { DependencyUnavailable, type FastStore } from '../ports';
import type { PresenceFaults } from './ports';

export interface PresenceFaultState {
  fastStore: 'ok' | 'down';
  dbWrite: 'ok' | 'fail';
  /** Share of beats answered with an error, 0..1. */
  beatErrorRate: number;
  /** Simulated fast-store restarts so far; > 0 suffixes the reported run id. */
  fastRestarts: number;
}

export interface PresenceFaultSwitch {
  get(): Readonly<PresenceFaultState>;
  /** Applies the given fields of a door body; absent fields keep their value. */
  apply(patch: PresenceFaults): Readonly<PresenceFaultState>;
  /** One simulated fast-store restart (a new run id from now on). */
  restartFastStore(): Readonly<PresenceFaultState>;
  /** Whether the next beat fails under the injected share (exact spread; the accumulator restarts when the share is set). */
  nextBeatFails(): boolean;
  reset(): void;
}

const initial = (): PresenceFaultState => ({ fastStore: 'ok', dbWrite: 'ok', beatErrorRate: 0, fastRestarts: 0 });
/** Float slack of the error accumulator (0.02 × 50 must reach 1). */
const ACC_EPS = 1e-9;

export function createPresenceFaults(): PresenceFaultSwitch {
  let state = initial();
  let errorAcc = 0;
  return {
    get: () => state,
    apply(patch) {
      const next = { ...state };
      if (patch.fastStore !== undefined) next.fastStore = patch.fastStore === 'down' ? 'down' : 'ok';
      if (patch.dbWrite !== undefined) next.dbWrite = patch.dbWrite === 'down' ? 'fail' : 'ok';
      if (patch.beatErrorRate !== undefined && Number.isFinite(patch.beatErrorRate)) {
        next.beatErrorRate = Math.min(1, Math.max(0, patch.beatErrorRate));
        errorAcc = 0;
      }
      state = next;
      return state;
    },
    restartFastStore() {
      state = { ...state, fastRestarts: state.fastRestarts + 1 };
      return state;
    },
    nextBeatFails() {
      if (state.beatErrorRate <= 0) return false;
      errorAcc += state.beatErrorRate;
      if (errorAcc < 1 - ACC_EPS) return false;
      errorAcc -= 1;
      return true;
    },
    reset() {
      state = initial();
      errorAcc = 0;
    },
  };
}

/** The process's switch (one per process; the door and the presence services share it). */
export const presenceFaults: PresenceFaultSwitch = createPresenceFaults();

/** A fast store that fails with `DependencyUnavailable('redis')` on every call while the fault says `down`. */
export function faultyFastStore(store: FastStore, faults: PresenceFaultSwitch): FastStore {
  const gate = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    (...a: A): Promise<R> => (faults.get().fastStore === 'down' ? Promise.reject(new DependencyUnavailable('redis')) : fn(...a));
  return {
    incrWindow: gate((k: string, w: number) => store.incrWindow(k, w)),
    setIfAbsent: gate((k: string, v: string, t: number) => store.setIfAbsent(k, v, t)),
    decrIfPresent: gate((k: string) => store.decrIfPresent(k)),
    get: gate((k: string) => store.get(k)),
    set: gate((k: string, v: string, t: number) => store.set(k, v, t)),
    del: gate((k: string) => store.del(k)),
    deleteByPrefix: gate((p: string) => store.deleteByPrefix(p)),
    ...(store.info
      ? {
          info: gate(async () => {
            const info = await store.info!();
            const n = faults.get().fastRestarts;
            return n > 0 ? { ...info, runId: `${info.runId}~restart-${n}` } : info;
          }),
        }
      : {}),
  };
}

/** Throws `DependencyUnavailable('postgres')` while the fault says database writes fail. */
export function assertDbWritable(faults: PresenceFaultSwitch): void {
  if (faults.get().dbWrite === 'fail') throw new DependencyUnavailable('postgres');
}

/** Whether this beat is answered with an injected error (`random` in [0, 1)); the process uses `nextBeatFails` instead. */
export function beatFails(faults: PresenceFaultSwitch, random: number): boolean {
  const rate = faults.get().beatErrorRate;
  return rate > 0 && random < rate;
}
