/**
 * Стан сеансу вкладки: `sessionStorage['t2f:session:soundEnabled']` ('true' | 'false').
 * Читання й запис — у `try/catch`; при збої звук просто не запам’ятовується.
 */
import { create } from 'zustand';
import { safeGet, safeSet } from '@/lib/storage/safe';

export const SOUND_KEY = 't2f:session:soundEnabled';

export interface SessionState {
  soundEnabled: boolean;
  setSoundEnabled(v: boolean): void;
}

function readSound(): boolean {
  return safeGet('session', SOUND_KEY) === 'true';
}

export const useSessionStore = create<SessionState>()((set) => ({
  soundEnabled: readSound(),
  setSoundEnabled: (soundEnabled) => {
    safeSet('session', SOUND_KEY, String(soundEnabled));
    set({ soundEnabled });
  },
}));
