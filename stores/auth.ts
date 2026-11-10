/**
 * Акаунт на пристрої (імітація, `lib/auth/sim.ts`) у `localStorage['t2f:auth:v1']`.
 * `accounts` — адреси, для яких «на сервері» вже є акаунт. Вхід поштою (`emailSignIn`, без коду — рішення 2026-10-30):
 * нова адреса — акаунт створено й людина вже увійшла (екран «Акаунт створено», лист з посиланням для інших пристроїв);
 * адреса з акаунтом — лист з посиланням для входу. Лист (`letter`) один: новий замінює попередній.
 * Вкладки синхронізуються через подію `storage` (`useAuthTabSync`): посилання з листа, відкрите в новій вкладці,
 * впускає й ту вкладку, що чекала на лист.
 * `passes` — адреси акаунтів з Новорічним пасом і коли його оформлено (імітація сервера): вхід у такий акаунт
 * вмикає пас і на цьому пристрої (`guest.hasPass`).
 * Пас на пристрої — лише пас акаунта, що увійшов (правка власника 2026-11-10): без входу паса немає, вихід його
 * знімає, вхід в акаунт без пасу його не дає. `syncDevicePass` тримає `guest.hasPass` = «увійшов і акаунт з пасом»
 * після відновлення зі сховища, входу, виходу й оформлення пасу.
 * Прапор профілю (правка власника 2026-11-10): кожен вхід і створення акаунта (пас на `/pass/`, Google, пошта, посилання з
 * листа, «Перший ряд» з подарунковим пасом — усе через `signIn`) одразу задає прапор за IP, якщо людина ще не обрала свій
 * (`guest.ensureProfileFlag`); так само після відновлення входу зі сховища. Інакше аватар у шапці був літерою без прапора.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  GOOGLE_DEMO_EMAIL,
  LETTER_TTL_MS,
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
  token: string;
  intent: AuthIntent;
  sentAt: number;
  used: boolean;
  /** `welcome` — «ти увійшов» після створення акаунта (посилання — для інших пристроїв); інакше — посилання для входу. */
  welcome?: boolean;
}

export type SendResult =
  | { ok: true }
  /** Лист щойно надіслано — новий можна через хвилину. */
  | { ok: false; reason: 'wait'; until: number }
  /** Забагато листів за 10 хвилин. */
  | { ok: false; reason: 'too-many'; until: number };

/** `new` — акаунт створено цим входом. */
export type SignInResult = { ok: true; isNew: boolean; email: string };
/** Вхід поштою: нова адреса — увійшов одразу; адреса з акаунтом — надіслано посилання; або лист поки не можна. */
export type EmailSignInResult = { ok: true; sent: false; result: SignInResult } | { ok: true; sent: true } | Exclude<SendResult, { ok: true }>;
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
  /** Вхід поштою без коду (див. вище). */
  emailSignIn(email: string, intent: AuthIntent, now: number): EmailSignInResult;
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

/** Чи є пас у того, хто увійшов. */
export function accountHasPass(a: Pick<AuthData, 'user' | 'passes'>): boolean {
  return a.user !== null && a.passes[a.user.email] !== undefined;
}

/** `guest.hasPass` — пас акаунта, що увійшов (див. шапку). `a` — стан акаунта, коли стор ще створюється. */
export function syncDevicePass(a?: Pick<AuthData, 'user' | 'passes'>): void {
  const want = accountHasPass(a ?? useAuthStore.getState());
  const guest = useGuestStore.getState();
  if (guest.hasPass !== want) guest.setHasPass(want);
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => {
      const signIn = (email: string, via: AuthUser['via'], now: number): SignInResult => {
        const isNew = !get().accounts.includes(email);
        // Прапор — до входу: шапка, що підпишеться на `user`, одразу має прапор.
        useGuestStore.getState().ensureProfileFlag();
        set((s) => ({ user: { email, via, signedInAt: now }, accounts: isNew ? [...s.accounts, email] : s.accounts }));
        // Пас на пристрої — пас цього акаунта: є — вмикається, немає — вимикається.
        syncDevicePass(get());
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
            letter: { email, token: newToken(), intent, sentAt: now, used: false },
            sends: [...s.sends.filter((t) => now - t < SEND_WINDOW_MS), now],
          }));
          return { ok: true };
        },
        emailSignIn: (raw, intent, now) => {
          const email = normalizeEmail(raw);
          if (get().accounts.includes(email)) {
            const res = get().sendLetter(email, intent, now);
            return res.ok ? { ok: true, sent: true } : res;
          }
          const result = signIn(email, 'email', now);
          // Лист «ти увійшов»: посилання з нього — вхід на інших пристроях.
          set({ letter: { email, token: newToken(), intent, sentAt: now, used: false, welcome: true } });
          return { ok: true, sent: false, result };
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
          syncDevicePass(get());
        },
        signOut: () => {
          set({ user: null });
          syncDevicePass(get());
        },
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
      // Після відновлення (і синхронізації вкладок): пас гостя без входу, що лишився від старого стану, знімається.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        syncDevicePass(state);
        if (state.user) useGuestStore.getState().ensureProfileFlag();
      },
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
