/**
 * Injected presence faults (SPEC-14 [П-10]), application ring. A process-local switch read by the proof writer, the
 * sampler and the finaliser; only the `presence-fault` test door writes it (defaults: everything up, no beat errors).
 * The door body follows `presenceFaultDoor` of the contracts (`'down' | 'up'`).
 */
import { DependencyUnavailable, type FastStore } from '../ports';
import type { PresenceFaults } from './ports';

export interface PresenceFaultState {
  fastStore: 'ok' | 'down';
  dbWrite: 'ok' | 'fail';
  /** Share of beats answered with an error, 0..1. */
  beatErrorRate: number;
}

export interface PresenceFaultSwitch {
  get(): Readonly<PresenceFaultState>;
  /** Applies the given fields of a door body; absent fields keep their value. */
  apply(patch: PresenceFaults): Readonly<PresenceFaultState>;
  reset(): void;
}

const initial = (): PresenceFaultState => ({ fastStore: 'ok', dbWrite: 'ok', beatErrorRate: 0 });

export function createPresenceFaults(): PresenceFaultSwitch {
  let state = initial();
  return {
    get: () => state,
    apply(patch) {
      const next = { ...state };
      if (patch.fastStore !== undefined) next.fastStore = patch.fastStore === 'down' ? 'down' : 'ok';
      if (patch.dbWrite !== undefined) next.dbWrite = patch.dbWrite === 'down' ? 'fail' : 'ok';
      if (patch.beatErrorRate !== undefined && Number.isFinite(patch.beatErrorRate)) {
        next.beatErrorRate = Math.min(1, Math.max(0, patch.beatErrorRate));
      }
      state = next;
      return state;
    },
    reset() {
      state = initial();
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
    ...(store.info ? { info: gate(() => store.info!()) } : {}),
  };
}

/** Throws `DependencyUnavailable('postgres')` while the fault says database writes fail. */
export function assertDbWritable(faults: PresenceFaultSwitch): void {
  if (faults.get().dbWrite === 'fail') throw new DependencyUnavailable('postgres');
}

/** Whether this beat is answered with an injected error (`random` in [0, 1)). */
export function beatFails(faults: PresenceFaultSwitch, random: number): boolean {
  const rate = faults.get().beatErrorRate;
  return rate > 0 && random < rate;
}
