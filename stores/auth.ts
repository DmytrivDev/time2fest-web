/**
 * Акаунт на пристрої (імітація, `lib/auth/sim.ts`) у `localStorage['t2f:auth:v1']` (версія 4 — пас пристрою
 * приєднується до першого акаунта на пристрої; версія 3 — пас приєднується до акаунта лише раз; версія 2 — коди замість посилань).
 * Шов (`docs/backend/frontend-seam.md`, E3): це «сервер» імітації входу. Інтерфейс бачить його лише через
 * `lib/api/hooks/auth` → `lib/api/sim/auth` (компонентам імпортувати стор заборонено eslint).
 * Пошта — лише кодом із 6 цифр (рішення власника 2026-11-13): `requestCode` → `verifyCode`. Входу без підтвердження
 * пошти немає ні для нової адреси, ні після оплати. `accounts` — адреси, для яких «на сервері» вже є акаунт. Код один:
 * новий замінює попередній (вхід і зміна пошти в кабінеті — `purpose`).
 * Вкладки синхронізуються через подію `storage` (`lib/api/sim/auth` → `subscribe`).
 * `passes` — адреси акаунтів з Новорічним пасом і коли його оформлено (імітація сервера): вхід у такий акаунт
 * вмикає пас (сесія `hasPass`, `lib/api/sim/auth`).
 * Пас на пристрої (`devicePass`, рішення власника 2026-11-13): гість, що оплатив пас поштою без входу (чи отримав його
 * подарунком до тосту за $10), має пас на цьому пристрої одразу. Пас приєднується до ПЕРШОГО акаунта, в який ввійшли на
 * цьому пристрої (будь-яка пошта, Google чи код), раз і назавжди (рішення власника 2026-11-15, замінює правило 2026-11-14
 * «лише під поштою оплати»): у момент входу пас пристрою стає пасом акаунта (`passes`, `attached[id паса]` = акаунт), запис
 * пристрою зникає, і наступний акаунт на цьому пристрої паса не отримає. Акаунт, що вже має власний пас, пас пристрою не
 * забирає — той лишається неприєднаним на пристрої (чекає наступного акаунта без паса). Доти пас пристрою неприєднаний
 * (`unclaimed[пошта оплати]`).
 * Вихід з акаунта знімає пас акаунта (правка власника 2026-11-10).
 * Пас у подарунок до тосту за $10 (рішення власника 2026-11-12, змінено 2026-11-14): той, хто увійшов, отримує його на
 * акаунт одразу; гість — як куплений пас: на цьому пристрої одразу, з поштою оплати (`giftPass` → `grantDevicePass`).
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
export const AUTH_VERSION = 4 as const;

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

/** Пас, оплачений гостем без входу: `id` — пас «на сервері», пошта з оплати й коли. */
export interface DevicePass {
  id: string;
  email: string;
  since: number;
}

export interface AuthData {
  user: AuthUser | null;
  accounts: string[];
  code: AuthCode | null;
  sends: number[];
  /** Пошта акаунта → коли оформлено пас (мс): пас належить акаунту. */
  passes: Record<string, number>;
  /** Пас гостя, ще не приєднаний до жодного акаунта: пошта оплати → пас. */
  unclaimed: Record<string, { id: string; since: number }>;
  /** Пас гостя → пошта акаунта, до якого він приєднався (раз і назавжди; пошта змінюється разом з акаунтом). */
  attached: Record<string, string>;
  /** Пас, оплачений на цьому пристрої без входу (працює тут, поки людина не ввійде в перший акаунт на пристрої — пас переходить до нього). */
  devicePass: DevicePass | null;
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
  /**
   * Гість оплатив пас поштою `email`: пас працює на цьому пристрої одразу й чекає першого входу в акаунт на цьому
   * пристрої, щоб приєднатися до нього (`unclaimed`).
   */
  grantDevicePass(email: string, now: number): void;
  /**
   * Пас у подарунок до тосту за $10: той, хто увійшов, — одразу на акаунт (`active`); гість — як куплений: на цьому
   * пристрої з поштою оплати (`device`, далі те саме правило одноразового приєднання).
   */
  giftPass(now: number, email: string): 'active' | 'device';
  /** Нова пошта акаунта (після коду зміни пошти). */
  changeEmail(email: string): void;
  signOut(): void;
  /** Тест: зробити код простроченим. */
  expireCode(): void;
}

export type AuthStore = AuthData & AuthActions;

/** Порожній стан (скидання гостя, тести). */
export const AUTH_EMPTY: AuthData = { user: null, accounts: [], code: null, sends: [], passes: {}, unclaimed: {}, attached: {}, devicePass: null };
const EMPTY = AUTH_EMPTY;

/** Чи є пас: у того, хто увійшов, або оплачений на цьому пристрої без входу. */
export function accountHasPass(a: Pick<AuthData, 'user' | 'passes' | 'devicePass'>): boolean {
  return passPlace(a) !== null;
}

/** Де живе пас, яким користується ця сесія: на акаунті, що увійшов, чи лише на цьому пристрої. */
export function passPlace(a: Pick<AuthData, 'user' | 'passes' | 'devicePass'>): 'account' | 'device' | null {
  if (a.user !== null && a.passes[a.user.email] !== undefined) return 'account';
  return a.devicePass != null ? 'device' : null;
}

/** На цю пошту пас уже є — на акаунті чи ще неприєднаний (оплата з неї вдруге — `pass-owned`). */
export function emailHasPass(a: Pick<AuthData, 'passes' | 'unclaimed'>, email: string): boolean {
  return a.passes[email] !== undefined || a.unclaimed[email] !== undefined;
}

const newPassId = (now: number) => `pass-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const useAuthStore = create<AuthStore>()(
  persist(
    (set, get) => {
      const signIn = (email: string, via: AuthUser['via'], now: number): SignInResult => {
        const isNew = !get().accounts.includes(email);
        // Прапор — до входу: шапка, що підпишеться на `user`, одразу має прапор.
        useGuestStore.getState().ensureProfileFlag();
        set((s) => ({ user: { email, via, signedInAt: now }, accounts: isNew ? [...s.accounts, email] : s.accounts }));
        // Пас пристрою приєднується до першого акаунта, в який ввійшли тут (раз і назавжди); інший акаунт його не отримає.
        const device = get().devicePass;
        if (device) {
          const st = get();
          if (st.attached[device.id] === email) set({ devicePass: null }); // уже приєднаний до цього акаунта (міграція)
          else if (st.attached[device.id] === undefined && st.passes[email] === undefined) {
            set((x) => {
              const unclaimed = Object.fromEntries(Object.entries(x.unclaimed).filter(([, v]) => v.id !== device.id));
              return { passes: { ...x.passes, [email]: device.since }, attached: { ...x.attached, [device.id]: email }, unclaimed, devicePass: null };
            });
          }
        }
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
          const waiting = get().unclaimed[email];
          const pass: DevicePass = waiting ? { id: waiting.id, email, since: waiting.since } : { id: newPassId(now), email, since: now };
          if (!waiting) set((x) => ({ unclaimed: { ...x.unclaimed, [email]: { id: pass.id, since: now } } }));
          // На пристрої вже є пас — лишається той, що був (другий на пристрої нічого не додає).
          set((x) => ({ devicePass: x.devicePass ?? pass }));
        },
        giftPass: (now, email) => {
          const user = get().user;
          if (user) {
            get().grantPass(user.email, now);
            return 'active';
          }
          get().grantDevicePass(email, now);
          return 'device';
        },
        changeEmail: (raw) => {
          const next = normalizeEmail(raw);
          const prev = get().user?.email;
          if (!prev) return;
          set((s) => ({
            user: s.user ? { ...s.user, email: next } : s.user,
            accounts: s.accounts.map((x) => (x === prev ? next : x)),
            passes: Object.fromEntries(Object.entries(s.passes).map(([k, v]) => [k === prev ? next : k, v])),
            // Приєднаний пас іде за акаунтом, а не за старою адресою.
            attached: Object.fromEntries(Object.entries(s.attached).map(([k, v]) => [k, v === prev ? next : v])),
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
        unclaimed: s.unclaimed,
        attached: s.attached,
        devicePass: s.devicePass,
      }),
      migrate: (persisted, version) => {
        if (version === AUTH_VERSION) return persisted as AuthData;
        if (!persisted || typeof persisted !== 'object') return EMPTY;
        // Версія 3 → 4: форма стану та сама. Той, хто вже ввійшов без власного паса, а пас пристрою ще неприєднаний, —
        // перший акаунт на пристрої: пас переходить до нього.
        if (version === 3) {
          const cur = persisted as AuthData;
          const dp = cur.devicePass;
          const user = cur.user;
          if (dp && typeof dp.id === 'string' && user && cur.attached?.[dp.id] === undefined && cur.passes?.[user.email] === undefined) {
            return {
              ...cur,
              passes: { ...cur.passes, [user.email]: dp.since },
              attached: { ...cur.attached, [dp.id]: user.email },
              unclaimed: Object.fromEntries(Object.entries(cur.unclaimed ?? {}).filter(([, v]) => v.id !== dp.id)),
              devicePass: null,
            };
          }
          return cur;
        }
        if (version !== 1 && version !== 2) return EMPTY;
        // Версія 1 (посилання з листа): лист відкидаємо. Версії 1–2: пас гостя одразу записувався на пошту оплати як пас
        // акаунта — тож пас пристрою вважаємо вже приєднаним до неї. Подарунок «чекає входу» (`pendingPassGift`) пошти
        // не мав — відкидаємо (лише тестові й демо-дані).
        const old = persisted as Partial<Omit<AuthData, 'devicePass'>> & { devicePass?: { email?: unknown; since?: unknown } | null };
        const passes = { ...(old.passes ?? {}) };
        const attached: Record<string, string> = {};
        let devicePass: DevicePass | null = null;
        const dp = old.devicePass;
        if (version === 2 && dp && typeof dp.email === 'string' && typeof dp.since === 'number') {
          devicePass = { id: `pass-v2-${dp.since}`, email: dp.email, since: dp.since };
          attached[devicePass.id] = dp.email;
          passes[dp.email] ??= dp.since;
        }
        return {
          ...EMPTY,
          user: old.user ?? null,
          accounts: old.accounts ?? [],
          passes,
          attached,
          devicePass,
          ...(version === 2 ? { code: old.code ?? null, sends: old.sends ?? [] } : {}),
        };
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AuthData>;
        return {
          ...current,
          ...p,
          passes: p.passes ?? {},
          unclaimed: p.unclaimed ?? {},
          attached: p.attached ?? {},
          devicePass: p.devicePass && typeof p.devicePass.id === 'string' ? p.devicePass : null,
          code: p.code ?? null,
        };
      },
      // Після відновлення (і синхронізації вкладок): прапор профілю того, хто увійшов.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        if (state.user) useGuestStore.getState().ensureProfileFlag();
      },
    },
  ),
);
