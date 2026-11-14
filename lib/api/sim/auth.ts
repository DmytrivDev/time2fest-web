/**
 * Адаптер `sim` домену «Вхід» (`docs/backend/frontend-seam.md`, 3.6): обгортка над «сервером» імітації `stores/auth.ts`.
 * Пошта — лише кодом із 6 цифр (рішення власника 2026-11-13): `requestCode` → `verifyCode`, однаково для нової адреси й
 * наявної. Листів немає: код видно лише в тестових засобах (`devCode` → `window.__t2f.lastCode()`, машина часу, у демо —
 * підказка під полем). Тестові перемикачі (`testControls.authUnavailable`, `googleCancelled`) теж читає адаптер.
 */
import { fail, ok } from '../result';
import type { AuthIntent, AuthService, CodeInfo, DevCode, DevCodeBox, Session } from '../contracts/auth';
import { CODE_MAX_ATTEMPTS, CODE_TTL_MS, GOOGLE_DELAY_MS, GOOGLE_DEMO_NAME, isEmail, RESEND_GAP_MS } from '@/lib/auth/sim';
import { accountHasPass, AUTH_STORAGE_KEY, useAuthStore, type AuthCode, type SendResult, type VerifyFail } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

export const codeInfoOf = (c: AuthCode | null): CodeInfo | null =>
  c && !c.used
    ? {
        email: c.email,
        intent: c.intent,
        sentAt: c.sentAt,
        resendAt: c.sentAt + RESEND_GAP_MS,
        expiresAt: c.sentAt + CODE_TTL_MS,
        attemptsLeft: Math.max(0, CODE_MAX_ATTEMPTS - c.attempts),
      }
    : null;

type AuthState = ReturnType<typeof useAuthStore.getState>;

function sessionOf(a: AuthState): Session {
  const u = a.user;
  const passSince = u ? (a.passes[u.email] ?? null) : null;
  return {
    user: u ? { id: u.email, email: u.email, via: u.via, signedInAt: u.signedInAt, ...(u.via === 'google' ? { name: GOOGLE_DEMO_NAME } : {}) } : null,
    guestId: useGuestStore.getState().id,
    hasPass: accountHasPass(a),
    passSince: passSince ?? a.devicePass?.since ?? null,
    devicePass: a.devicePass && a.devicePass.email !== u?.email ? a.devicePass : null,
    pendingPassGift: a.pendingPassGift != null,
    // Код для входу (код зміни пошти — у профілі).
    code: a.code?.purpose === 'signin' ? codeInfoOf(a.code) : null,
  };
}

/** Знімок кешується, поки стор не змінився (стабільне посилання для `useSyncExternalStore`). */
let cached: { state: AuthState; session: Session } | null = null;
function currentSession(): Session {
  const a = useAuthStore.getState();
  if (!cached || cached.state !== a) cached = { state: a, session: sessionOf(a) };
  return cached.session;
}

const unavailable = () => useTestControls.getState().authUnavailable;

/** Відмова надсилання → `ApiError` (спільна для входу й зміни пошти). */
export function sendFailure(res: Exclude<SendResult, { ok: true }>, now: number) {
  return fail<never>('rate_limited', { reason: res.reason, retryAfterMs: Math.max(0, res.until - now) });
}

/** Відмова перевірки коду → `ApiError` (`contracts/auth`, `authCodeError`). */
export function verifyFailure(res: VerifyFail) {
  if (res.reason === 'wrong-code') return fail<never>('validation', { reason: 'wrong-code', attemptsLeft: res.attemptsLeft });
  if (res.reason === 'too-many-attempts') return fail<never>('rate_limited', { reason: 'too-many-attempts' });
  return fail<never>('conflict', { reason: 'expired' });
}

let devCache: { code: AuthCode | null; out: DevCode | null } = { code: null, out: null };
const devCode: DevCodeBox = {
  // Те саме посилання, поки код не змінився (`useSyncExternalStore`).
  get: () => {
    const c = useAuthStore.getState().code;
    if (devCache.code !== c)
      devCache = { code: c, out: c ? { email: c.email, code: c.code, purpose: c.purpose, sentAt: c.sentAt, expiresAt: c.sentAt + CODE_TTL_MS, used: c.used } : null };
    return devCache.out;
  },
  subscribe: (cb) =>
    useAuthStore.subscribe((s, p) => {
      if (s.code !== p.code) cb();
    }),
  expire: () => useAuthStore.getState().expireCode(),
};

export function createSimAuth(): AuthService {
  return {
    async session() {
      return ok(currentSession());
    },
    peek: () => currentSession(),
    subscribe(onChange) {
      const off = useAuthStore.subscribe((s, p) => {
        if (s.user !== p.user || s.passes !== p.passes || s.code !== p.code || s.pendingPassGift !== p.pendingPassGift || s.devicePass !== p.devicePass)
          onChange(currentSession());
      });
      // Синхронізація вкладок: вхід в іншій вкладці впускає й цю.
      const onStorage = (e: StorageEvent) => {
        if (e.key === AUTH_STORAGE_KEY) void useAuthStore.persist.rehydrate();
      };
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        off();
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
    async requestCode(email: string, intent: AuthIntent) {
      if (unavailable()) return fail('unavailable');
      if (!isEmail(email.trim())) return fail('validation', { reason: 'email' });
      const now = Date.now();
      const res = useAuthStore.getState().requestCode(email, intent, 'signin', now);
      if (!res.ok) return sendFailure(res, now);
      return ok(codeInfoOf(useAuthStore.getState().code)!);
    },
    async verifyCode(email, code) {
      if (unavailable()) return fail('unavailable');
      const now = Date.now();
      const res = useAuthStore.getState().checkCode(email, code, 'signin', now);
      if (!res.ok) return verifyFailure(res);
      const r = useAuthStore.getState().signInVerified(res.email, now);
      return ok({ isNew: r.isNew, email: r.email });
    },
    google({ signal }) {
      // Імітований перехід до Google і назад; скасування до кінця затримки — входу немає.
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          if (useTestControls.getState().googleCancelled) return resolve(fail('conflict', { reason: 'cancelled' }));
          const r = useAuthStore.getState().signInGoogle(Date.now());
          resolve(ok({ kind: 'signed-in', isNew: r.isNew, email: r.email }));
        }, GOOGLE_DELAY_MS);
        const onAbort = () => {
          clearTimeout(timer);
          resolve(fail('conflict', { reason: 'cancelled' }));
        };
        if (signal?.aborted) onAbort();
        else signal?.addEventListener('abort', onAbort, { once: true });
      });
    },
    async signOut() {
      useAuthStore.getState().signOut();
      return ok(undefined);
    },
    devCode,
    devReset: () => useAuthStore.setState({ user: null, accounts: [], code: null, sends: [], passes: {}, devicePass: null, pendingPassGift: null }),
  };
}
