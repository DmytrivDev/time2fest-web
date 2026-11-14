/**
 * Акаунт на пристрої (імітація, `lib/auth/sim.ts`) у `localStorage['t2f:auth:v1']` (версія 2 — коди замість посилань).
 * Шов (`docs/backend/frontend-seam.md`, E3): це «сервер» імітації входу. Інтерфейс бачить його лише через
 * `lib/api/hooks/auth` → `lib/api/sim/auth` (компонентам імпортувати стор заборонено eslint).
 * Пошта — лише кодом із 6 цифр (рішення власника 2026-11-13): `requestCode` → `verifyCode`. Входу без підтвердження
 * пошти немає ні для нової адреси, ні після оплати. `accounts` — адреси, для яких «на сервері» вже є акаунт. Код один:
 * новий замінює попередній (вхід і зміна пошти в кабінеті — `purpose`).
 * Вкладки синхронізуються через подію `storage` (`lib/api/sim/auth` → `subscribe`).
 * `passes` — адреси акаунтів з Новорічним пасом і коли його оформлено (імітація сервера): вхід у такий акаунт
 * вмикає пас (сесія `hasPass`, `lib/api/sim/auth`).
 * Пас на пристрої (`devicePass`, рішення власника 2026-11-13): гість, що оплатив пас поштою без входу, має пас на цьому
 * пристрої одразу; в акаунт пас потрапляє, коли людина увійде з цією поштою (кодом чи Google) — тоді пас просто акаунта,
 * а запис пристрою зникає. Вихід з акаунта знімає пас акаунта (правка власника 2026-11-10).
 * Пас у подарунок до тосту за $10 (рішення власника 2026-11-12): той, хто увійшов, отримує його на акаунт одразу;
 * гість — коли вперше увійде чи створить акаунт на цьому пристрої (`pendingPassGift`, `giftPass`).
 * Прапор профілю (правка власника 2026-11-10): кожен вхід і створення акаунта одразу задає прапор за IP, якщо людина ще
 * не обрала свій (`guest.ensureProfileFlag`); так само після відновлення входу зі сховища.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  GOOGLE_DEMO_EMAIL,
  newCode,
  normalizeEmail,
  RESEND_GAP_MS,
  SEND_LIMIT,
  SEND_WINDOW_MS,
  type AuthIntent,
} from '@/lib/auth/sim';
import { safeJsonStorage } from '@/lib/storage/safe';
import { useGuestStore } from '@/stores/guest';

export const AUTH_STORAGE_KEY = 't2f:auth:v1';
export const AUTH_VERSION = 2 as const;

export interface AuthUser {
  email: string;
  via: 'google' | 'email';
  signedInAt: number;
}

/** Навіщо код: вхід (і створення акаунта) чи зміна пошти в кабінеті. */
export type CodePurpose = 'signin' | 'email-change';

export interface AuthCode {
  email: string;
  code: string;
  intent: AuthIntent;
  purpose: CodePurpose;
  sentAt: number;
  /** Невдалих спроб. */
  attempts: number;
  used: boolean;
}

export type SendResult =
  | { ok: true }
  /** Код щойно надіслано — новий можна через `RESEND_GAP_MS`. */
  | { ok: false; reason: 'wait'; until: number }
  /** Забагато кодів за 10 хвилин. */
  | { ok: false; reason: 'too-many'; until: number };

/** `isNew` — акаунт створено цим входом. */
export type SignInResult = { ok: true; isNew: boolean; email: string };

export type VerifyFail =
  | { ok: false; reason: 'wrong-code'; attemptsLeft: number }
  /** Код прострочено, використано або його немає для цієї адреси — потрібен новий. */
  | { ok: false; reason: 'expired' }
  | { ok: false; reason: 'too-many-attempts' };

export type VerifyResult = { ok: true; email: string } | VerifyFail;

interface AuthData {
  user: AuthUser | null;
  accounts: string[];
  code: AuthCode | null;
  sends: number[];
  /** email → коли оформлено пас (мс). */
  passes: Record<string, number>;
  /** Пас, оплачений на цьому пристрої без входу: пошта з оплати й коли. */
  devicePass: { email: string; since: number } | null;
  /**
   * Пас у подарунок до тосту за $10, який сказав гість без входу (рішення власника 2026-11-12): чекає тут — коли тост
   * сказано (мс) — до першого входу чи створення акаунта на цьому пристрої; тоді переходить на акаунт і зникає звідси.
   */
  pendingPassGift?: number | null;
}

interface AuthActions {
  /** Коли знову можна надіслати код; `null` — можна зараз. */
  blockedUntil(now: number): SendResult | null;
  requestCode(email: string, intent: AuthIntent, purpose: CodePurpose, now: number): SendResult;
  /** Перевірити код (лише перевірка: що далі — вхід чи зміна пошти — вирішує `lib/api/sim/*`). */
  checkCode(email: string, code: string, purpose: CodePurpose, now: number): VerifyResult;
  /** Вхід після перевірки пошти (код) — примітив «сервера» імітації. */
  signInVerified(email: string, now: number): SignInResult;
  signInGoogle(now: number): SignInResult;
  /** Пас оформлено на акаунт `email`. */
  grantPass(email: string, now: number): void;
  /** Гість оплатив пас поштою `email`: пас — на пошту (акаунт) і на цей пристрій одразу. */
  grantDevicePass(email: string, now: number): void;
  /**
   * Пас у подарунок до тосту за $10: той, хто увійшов, — одразу на акаунт (`active`); гість — чекає входу на цьому
   * пристрої (`pending`, див. `pendingPassGift`).
   */
  giftPass(now: number): 'active' | 'pending';
  /** Нова пошта акаунта (після коду зміни пошти). */
  changeEmail(email: string): void;
  signOut(): void;
  /** Тест: зробити код простроченим. */
  expireCode(): void;
}

export type AuthStore = AuthData & AuthActions;

const EMPTY: AuthData = { user: null, accounts: [], code: null, sends: [], passes: {}, devicePass: null, pendingPassGift: null };

/** Чи є пас: у того, хто увійшов, або оплачений на цьому пристрої без входу. */
export function accountHasPass(a: Pick<AuthData, 'user' | 'passes' | 'devicePass'>): boolean {
  if (a.user !== null && a.passes[a.user.email] !== undefined) return true;
  return a.devicePass != null;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => {
      const signIn = (email: string, via: AuthUser['via'], now: number): SignInResult => {
        const isNew = !get().accounts.includes(email);
        // Прапор — до входу: шапка, що підпишеться на `user`, одразу має прапор.
        useGuestStore.getState().ensureProfileFlag();
        set((s) => ({ user: { email, via, signedInAt: now }, accounts: isNew ? [...s.accounts, email] : s.accounts }));
        // Подарунок до тосту за $10, що чекав входу на цьому пристрої, — тепер пас цього акаунта.
        const gift = get().pendingPassGift;
        if (gift != null) set((s) => ({ passes: { ...s.passes, [email]: s.passes[email] ?? gift }, pendingPassGift: null }));
        // Пас пристрою з тією ж поштою — тепер просто пас акаунта.
        if (get().devicePass?.email === email) set({ devicePass: null });
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
        requestCode: (raw, intent, purpose, now) => {
          const blocked = get().blockedUntil(now);
          if (blocked) return blocked;
          const email = normalizeEmail(raw);
          set((s) => ({
            code: { email, code: newCode(), intent, purpose, sentAt: now, attempts: 0, used: false },
            sends: [...s.sends.filter((t) => now - t < SEND_WINDOW_MS), now],
          }));
          return { ok: true };
        },
        checkCode: (raw, typed, purpose, now) => {
          const c = get().code;
          const email = normalizeEmail(raw);
          if (!c || c.email !== email || c.purpose !== purpose || c.used || now - c.sentAt > CODE_TTL_MS) return { ok: false, reason: 'expired' };
          if (c.attempts >= CODE_MAX_ATTEMPTS) return { ok: false, reason: 'too-many-attempts' };
          if (typed.replace(/\D/g, '') !== c.code) {
            const attempts = c.attempts + 1;
            set({ code: { ...c, attempts } });
            return attempts >= CODE_MAX_ATTEMPTS ? { ok: false, reason: 'too-many-attempts' } : { ok: false, reason: 'wrong-code', attemptsLeft: CODE_MAX_ATTEMPTS - attempts };
          }
          set({ code: { ...c, used: true } });
          return { ok: true, email };
        },
        signInVerified: (raw, now) => signIn(normalizeEmail(raw), 'email', now),
        signInGoogle: (now) => signIn(GOOGLE_DEMO_EMAIL, 'google', now),
        grantPass: (raw, now) => {
          const email = normalizeEmail(raw);
          set((s) => ({ passes: { ...s.passes, [email]: s.passes[email] ?? now } }));
        },
        grantDevicePass: (raw, now) => {
          const email = normalizeEmail(raw);
          get().grantPass(email, now);
          set((s) => ({ devicePass: s.devicePass ?? { email, since: s.passes[email] ?? now } }));
        },
        giftPass: (now) => {
          const user = get().user;
          if (user) {
            get().grantPass(user.email, now);
            return 'active';
          }
          set((s) => ({ pendingPassGift: s.pendingPassGift ?? now }));
          return 'pending';
        },
        changeEmail: (raw) => {
          const next = normalizeEmail(raw);
          const prev = get().user?.email;
          if (!prev) return;
          set((s) => ({
            user: s.user ? { ...s.user, email: next } : s.user,
            accounts: s.accounts.map((x) => (x === prev ? next : x)),
            passes: Object.fromEntries(Object.entries(s.passes).map(([k, v]) => [k === prev ? next : k, v])),
          }));
        },
        signOut: () => {
          set({ user: null });
        },
        expireCode: () => set((s) => (s.code ? { code: { ...s.code, sentAt: s.code.sentAt - CODE_TTL_MS - 1 } } : s)),
      };
    },
    {
      name: AUTH_STORAGE_KEY,
      version: AUTH_VERSION,
      storage: safeJsonStorage<AuthData>('local'),
      partialize: (s) => ({
        user: s.user,
        accounts: s.accounts,
        code: s.code,
        sends: s.sends,
        passes: s.passes,
        devicePass: s.devicePass,
        pendingPassGift: s.pendingPassGift ?? null,
      }),
      // Версія 1 (посилання з листа): лист відкидаємо, акаунти, вхід і паси лишаються.
      migrate: (persisted, version) => {
        if (version === AUTH_VERSION) return persisted as AuthData;
        if (version !== 1 || !persisted || typeof persisted !== 'object') return EMPTY;
        const old = persisted as Partial<AuthData> & { letter?: unknown };
        return { ...EMPTY, user: old.user ?? null, accounts: old.accounts ?? [], passes: old.passes ?? {}, pendingPassGift: old.pendingPassGift ?? null };
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthData>;
        return { ...current, ...p, passes: p.passes ?? {}, devicePass: p.devicePass ?? null, code: p.code ?? null };
      },
      // Після відновлення (і синхронізації вкладок): прапор профілю того, хто увійшов.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.user) useGuestStore.getState().ensureProfileFlag();
      },
    },
  ),
);
