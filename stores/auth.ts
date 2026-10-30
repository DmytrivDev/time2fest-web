/**
 * Акаунт на пристрої (імітація, `lib/auth/sim.ts`) у `localStorage['t2f:auth:v1']`.
 * `accounts` — адреси, для яких «на сервері» вже є акаунт: перший вхід з новою адресою створює акаунт
 * (екран «Акаунт створено»), повторний — просто вхід. Лист (`letter`) один: новий замінює попередній.
 * Вкладки синхронізуються через подію `storage` (`useAuthTabSync`): посилання з листа, відкрите в новій вкладці,
 * впускає й ту вкладку, що чекала на лист.
 * `passes` — адреси акаунтів з Новорічним пасом і коли його оформлено (імітація сервера): вхід у такий акаунт
 * вмикає пас і на цьому пристрої (`guest.hasPass`).
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  GOOGLE_DEMO_EMAIL,
  LETTER_TTL_MS,
  MAX_CODE_TRIES,
  newCode,
  newToken,
  normalizeEmail,
  RESEND_GAP_MS,
  SEND_LIMIT,
  SEND_WINDOW_MS,
  type AuthIntent,
} from '@/lib/auth/sim';
import { safeJsonStorage } from '@/lib/storage/safe';
import { useGuestStore } from '@/stores/guest';

export const AUTH_STORAGE_KEY = 't2f:auth:v1';
export const AUTH_VERSION = 1 as const;

export interface AuthUser {
  email: string;
  via: 'google' | 'email';
  signedInAt: number;
}

export interface AuthLetter {
  email: string;
  code: string;
  token: string;
  intent: AuthIntent;
  sentAt: number;
  used: boolean;
  tries: number;
}

export type SendResult =
  | { ok: true }
  /** Лист щойно надіслано — новий можна через хвилину. */
  | { ok: false; reason: 'wait'; until: number }
  /** Забагато листів за 10 хвилин. */
  | { ok: false; reason: 'too-many'; until: number };

/** `new` — акаунт створено цим входом. */
export type SignInResult = { ok: true; isNew: boolean; email: string };
export type CodeResult = SignInResult | { ok: false; reason: 'wrong' | 'expired' | 'burned' | 'none' };
export type LinkResult = SignInResult | { ok: false; reason: 'expired' | 'none'; email?: string };

interface AuthData {
  user: AuthUser | null;
  accounts: string[];
  letter: AuthLetter | null;
  sends: number[];
  /** email → коли оформлено пас (мс). */
  passes: Record<string, number>;
}

interface AuthActions {
  /** Коли знову можна надіслати лист; `null` — можна зараз. */
  blockedUntil(now: number): SendResult | null;
  sendLetter(email: string, intent: AuthIntent, now: number): SendResult;
  verifyCode(code: string, now: number): CodeResult;
  openLink(token: string, now: number): LinkResult;
  signInGoogle(now: number): SignInResult;
  /** Акаунт створюється разом з оплатою пасу (email з форми) — і людина одразу входить. */
  signInWithPurchase(email: string, now: number): SignInResult;
  /** Пас оформлено на акаунт `email`. */
  grantPass(email: string, now: number): void;
  signOut(): void;
  /** Тестова пошта: зробити лист простроченим. */
  expireLetter(): void;
}

export type AuthStore = AuthData & AuthActions;

const EMPTY: AuthData = { user: null, accounts: [], letter: null, sends: [], passes: {} };

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => {
      const signIn = (email: string, via: AuthUser['via'], now: number): SignInResult => {
        const isNew = !get().accounts.includes(email);
        set((s) => ({ user: { email, via, signedInAt: now }, accounts: isNew ? [...s.accounts, email] : s.accounts }));
        // Пас на акаунті — вмикається й тут.
        if (get().passes[email] !== undefined) useGuestStore.getState().setHasPass(true);
        return { ok: true, isNew, email };
      };
      return {
        ...EMPTY,
        blockedUntil: (now) => {
          const recent = get().sends.filter((t) => now - t < SEND_WINDOW_MS);
          if (recent.length >= SEND_LIMIT) return { ok: false, reason: 'too-many', until: recent[0]! + SEND_WINDOW_MS };
          const last = recent.at(-1);
          if (last !== undefined && now - last < RESEND_GAP_MS) return { ok: false, reason: 'wait', until: last + RESEND_GAP_MS };
          return null;
        },
        sendLetter: (raw, intent, now) => {
          const blocked = get().blockedUntil(now);
          if (blocked) return blocked;
          const email = normalizeEmail(raw);
          set((s) => ({
            letter: { email, code: newCode(), token: newToken(), intent, sentAt: now, used: false, tries: 0 },
            sends: [...s.sends.filter((t) => now - t < SEND_WINDOW_MS), now],
          }));
          return { ok: true };
        },
        verifyCode: (code, now) => {
          const letter = get().letter;
          if (!letter) return { ok: false, reason: 'none' };
          if (letter.used || letter.tries >= MAX_CODE_TRIES) return { ok: false, reason: 'burned' };
          if (now - letter.sentAt > LETTER_TTL_MS) return { ok: false, reason: 'expired' };
          if (code !== letter.code) {
            const tries = letter.tries + 1;
            set({ letter: { ...letter, tries } });
            return { ok: false, reason: tries >= MAX_CODE_TRIES ? 'burned' : 'wrong' };
          }
          set({ letter: { ...letter, used: true } });
          return signIn(letter.email, 'email', now);
        },
        openLink: (token, now) => {
          const letter = get().letter;
          if (!letter || letter.token !== token) return { ok: false, reason: 'none' };
          if (letter.used || now - letter.sentAt > LETTER_TTL_MS) return { ok: false, reason: 'expired', email: letter.email };
          set({ letter: { ...letter, used: true } });
          return signIn(letter.email, 'email', now);
        },
        signInGoogle: (now) => signIn(GOOGLE_DEMO_EMAIL, 'google', now),
        signInWithPurchase: (raw, now) => signIn(normalizeEmail(raw), 'email', now),
        grantPass: (raw, now) => {
          const email = normalizeEmail(raw);
          set((s) => ({ passes: { ...s.passes, [email]: s.passes[email] ?? now } }));
          useGuestStore.getState().setHasPass(true);
        },
        signOut: () => set({ user: null }),
        expireLetter: () =>
          set((s) => (s.letter ? { letter: { ...s.letter, sentAt: s.letter.sentAt - LETTER_TTL_MS - 1 } } : s)),
      };
    },
    {
      name: AUTH_STORAGE_KEY,
      version: AUTH_VERSION,
      storage: safeJsonStorage<AuthData>('local'),
      partialize: (s) => ({ user: s.user, accounts: s.accounts, letter: s.letter, sends: s.sends, passes: s.passes }),
      migrate: (persisted, version) => (version === AUTH_VERSION ? (persisted as AuthData) : EMPTY),
      // Збережене до появи `passes` — без нього.
      merge: (persisted, current) => ({ ...current, ...(persisted as Partial<AuthData>), passes: (persisted as Partial<AuthData> | undefined)?.passes ?? {} }),
    },
  ),
);

/** Синхронізація вкладок: інша вкладка увійшла (посилання з листа) — ця підхоплює. */
export function useAuthTabSync(): void {
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === AUTH_STORAGE_KEY) void useAuthStore.persist.rehydrate();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
}
