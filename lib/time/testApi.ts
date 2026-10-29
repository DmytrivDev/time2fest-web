/**
 * `window.__t2f` — програмний інтерфейс тестової збірки (contracts/time-machine.md).
 * Встановлюється лише за `IS_TEST_BUILD` (див. `TimeProvider`).
 */
import type { ISO, PayResult } from '@/lib/data/types';
import { useAuthStore, type AuthLetter } from '@/stores/auth';
import { resetGuest } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { parseIsoWithOffset } from './params';
import type { TimeMachine } from './timeMachine';

export interface T2FTestApi {
  timeMachine: {
    get(): { at: ISO; speed: number; source: 'machine' | 'server' };
    set(opts: { at?: ISO; speed?: number }): void;
    advance(ms: number): void;
  };
  resetGuest(): void;
  setPayResult(r: PayResult): void;
  setChatAvailable(ok: boolean): void;
  setChatSlow(seconds: number): void;
  setChatEmpty(on: boolean): void;
  /** Вхід (імітація): сервіс недоступний, Google скасовано, вийти, останній лист (код і посилання). */
  setAuthUnavailable(on: boolean): void;
  setGoogleCancelled(on: boolean): void;
  signOut(): void;
  lastLetter(): AuthLetter | null;
}

declare global {
  interface Window {
    __t2f?: T2FTestApi;
  }
}

export function createTestApi(machine: TimeMachine): T2FTestApi {
  return {
    timeMachine: {
      get: () => {
        const s = machine.get();
        return { at: new Date(Math.round(s.at)).toISOString(), speed: s.speed, source: 'machine' };
      },
      set: ({ at, speed }) => {
        let ms: number | undefined;
        if (at !== undefined) {
          ms = parseIsoWithOffset(at) ?? Date.parse(at);
          if (Number.isNaN(ms)) {
            console.warn('[time-machine] Невірний t');
            ms = undefined;
            if (speed === undefined) return;
          }
        }
        machine.set({ ...(ms !== undefined ? { at: ms } : {}), ...(speed !== undefined ? { speed } : {}) });
      },
      advance: (ms) => machine.advance(ms),
    },
    resetGuest: () => resetGuest(),
    setPayResult: (r) => useTestControls.getState().setPayResult(r),
    setChatAvailable: (ok) => useTestControls.getState().setChatAvailable(ok),
    setChatSlow: (seconds) => useTestControls.getState().setSlowForcedSec(seconds),
    setChatEmpty: (on) => useTestControls.getState().setEmptyCountry(on),
    setAuthUnavailable: (on) => useTestControls.getState().setAuthUnavailable(on),
    setGoogleCancelled: (on) => useTestControls.getState().setGoogleCancelled(on),
    signOut: () => useAuthStore.getState().signOut(),
    lastLetter: () => useAuthStore.getState().letter,
  };
}

export function installTestApi(machine: TimeMachine, win: Window = window): () => void {
  const api = createTestApi(machine);
  win.__t2f = api;
  return () => {
    if (win.__t2f === api) delete win.__t2f;
  };
}
