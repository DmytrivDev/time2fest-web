/**
 * Адаптер `sim` домену «Вхід» (`docs/backend/frontend-seam.md`, E3): обгортка над «сервером» імітації `stores/auth.ts`.
 * Тут — і лише тут — правило пошти (рішення власника 2026-10-30, остаточне рішення для бекенду ще не ухвалене):
 *   • нова пошта у формі входу → акаунт створено й людина увійшла одразу (+ лист «ти увійшов» для інших пристроїв);
 *   • пошта з акаунтом → лише посилання з листа;
 *   • пошта, введена при оплаті пасу гостем → після оплати людина входить у неї без листа (`simSignInAfterPurchase`).
 * Щоб імітувати бекенд «посилання для кожної пошти», досить `NEW_EMAIL_SIGNS_IN_AT_ONCE = false` — інтерфейс не змінюється.
 * Тестові перемикачі (`testControls.authUnavailable`, `googleCancelled`) теж читає адаптер, а не компоненти.
 */
import { fail, ok, type ApiResult } from '../result';
import type { AuthIntent, AuthService, DevLetter, DevMailbox, LinkInfo, Session } from '../contracts/auth';
import { GOOGLE_DELAY_MS, GOOGLE_DEMO_NAME, LETTER_TTL_MS, RESEND_GAP_MS, normalizeEmail } from '@/lib/auth/sim';
import { accountHasPass, AUTH_STORAGE_KEY, useAuthStore, type AuthLetter, type EmailSignInResult, type SignInResult } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

/** Правило пошти імітації (див. шапку). `false` — як бекенд, що вимагає посилання для кожної пошти. */
export const NEW_EMAIL_SIGNS_IN_AT_ONCE = true;

/** Вхід поштою з форми (синхронне ядро; адаптер загортає в `Promise`). */
export function simEmailSignIn(raw: string, intent: AuthIntent, now: number): EmailSignInResult {
  const auth = useAuthStore.getState();
  const email = normalizeEmail(raw);
  if (!NEW_EMAIL_SIGNS_IN_AT_ONCE || auth.accounts.includes(email)) {
    const res = auth.sendLetter(email, intent, now);
    return res.ok ? { ok: true, sent: true } : res;
  }
  const result = auth.signInWithPurchase(email, now);
  // Лист «ти увійшов»: посилання з нього — вхід на інших пристроях.
  useAuthStore.getState().sendWelcome(email, intent, now);
  return { ok: true, sent: false, result };
}

/** Оплату пасу гостем підтверджено: вхід у пошту з форми оплати (той самий виняток правила, що й нова пошта). */
export function simSignInAfterPurchase(raw: string, now: number): SignInResult {
  return useAuthStore.getState().signInWithPurchase(normalizeEmail(raw), now);
}

const linkOf = (l: AuthLetter | null): LinkInfo | null =>
  l ? { email: l.email, intent: l.intent, sentAt: l.sentAt, resendAt: l.sentAt + RESEND_GAP_MS, expiresAt: l.sentAt + LETTER_TTL_MS, used: l.used, welcome: !!l.welcome } : null;

type AuthState = ReturnType<typeof useAuthStore.getState>;

function sessionOf(a: AuthState): Session {
  const u = a.user;
  return {
    user: u ? { id: u.email, email: u.email, via: u.via, signedInAt: u.signedInAt, ...(u.via === 'google' ? { name: GOOGLE_DEMO_NAME } : {}) } : null,
    guestId: useGuestStore.getState().id,
    hasPass: accountHasPass(a),
    passSince: u ? (a.passes[u.email] ?? null) : null,
    pendingPassGift: a.pendingPassGift != null,
    link: linkOf(a.letter),
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

let devCache: { letter: AuthLetter | null; out: DevLetter | null } = { letter: null, out: null };
const devMailbox: DevMailbox = {
  // Те саме посилання, поки лист не змінився (`useSyncExternalStore`).
  get: () => {
    const l = useAuthStore.getState().letter;
    if (devCache.letter !== l) devCache = { letter: l, out: l ? { email: l.email, token: l.token, sentAt: l.sentAt, expiresAt: l.sentAt + LETTER_TTL_MS, used: l.used } : null };
    return devCache.out;
  },
  subscribe: (cb) =>
    useAuthStore.subscribe((s, p) => {
      if (s.letter !== p.letter) cb();
    }),
  expire: () => useAuthStore.getState().expireLetter(),
};

export function createSimAuth(): AuthService {
  return {
    async session() {
      return ok(currentSession());
    },
    peek: () => currentSession(),
    subscribe(onChange) {
      const off = useAuthStore.subscribe((s, p) => {
        if (s.user !== p.user || s.passes !== p.passes || s.letter !== p.letter || s.pendingPassGift !== p.pendingPassGift) onChange(currentSession());
      });
      // Синхронізація вкладок (колишній `useAuthTabSync`): посилання з листа, відкрите в іншій вкладці, впускає й цю.
      const onStorage = (e: StorageEvent) => {
        if (e.key === AUTH_STORAGE_KEY) void useAuthStore.persist.rehydrate();
      };
      if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
      return () => {
        off();
        if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
      };
    },
    async emailSignIn(email, intent) {
      if (unavailable()) return fail('unavailable');
      const now = Date.now();
      const res = simEmailSignIn(email, intent, now);
      if (!res.ok) return fail('rate_limited', { reason: res.reason, retryAfterMs: res.until - now });
      if (!res.sent) return ok({ kind: 'signed-in', isNew: res.result.isNew, email: res.result.email });
      return ok({ kind: 'link-sent', link: linkOf(useAuthStore.getState().letter)! });
    },
    async sendLink(email, intent) {
      if (unavailable()) return fail('unavailable');
      const now = Date.now();
      const res = useAuthStore.getState().sendLetter(email, intent, now);
      if (!res.ok) return fail('rate_limited', { reason: res.reason, retryAfterMs: res.until - now });
      return ok(linkOf(useAuthStore.getState().letter)!);
    },
    async openLink(token) {
      const res = useAuthStore.getState().openLink(token, Date.now());
      if (res.ok) return ok({ kind: 'signed-in', isNew: res.isNew, email: res.email });
      return ok(res.reason === 'expired' ? { kind: 'expired', ...(res.email ? { email: res.email } : {}) } : { kind: 'invalid' });
    },
    google({ signal }) {
      // Імітований перехід до Google і назад; скасування до кінця затримки — входу немає (як раніше `clearTimeout`).
      return new Promise<ApiResult<{ kind: 'signed-in'; isNew: boolean; email: string }>>((resolve) => {
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
    devMailbox,
  };
}
