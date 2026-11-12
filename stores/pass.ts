/**
 * Оформлення Новорічного пасу (імітація оплати, рішення власника 2026-10-30).
 * Одне оформлення на вкладку: сторінка `/pass/` і вікно під трансляцією показують той самий стан, тож людина, що
 * закрила вікно на «Чекаємо підтвердження», побачить пас, щойно оплату підтвердять (`PassPaymentWatcher`).
 *
 * Гість: Google або email (акаунт створюється разом з оплатою); той, хто увійшов, — email не вводить.
 * Email, на який пас уже оформлено, оплату не починає: «На цю адресу пас уже оформлено» + посилання для входу.
 * Результат оплати — перемикач тестової збірки (`stores/testControls.payResult`): `pending` → «Чекаємо підтвердження»
 * (підтверджується через `PASS_CONFIRM_MS` часу сайту), `declined` → «Оплата не пройшла», решта → «Пас активний».
 * Email — у пам’яті вкладки; поки оплата йде («opening», «pending»), стан разом з email зберігається в `localStorage`
 * (`t2f:pass-flow:v1`), щоб після перезавантаження оплата довелась до кінця, а не почалась удруге (перевірка сайту
 * 2026-11-09, A-1). Після підтвердження, відмови чи скасування email зі сховища зникає. Відновлює
 * `PassPaymentWatcher` після монтування (`resumePassFlow`), щоб розмітка гідратації була однакова.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { GOOGLE_DELAY_MS, isEmail, normalizeEmail } from '@/lib/auth/sim';
import type { Ms } from '@/lib/data/types';
import { PAY_ROUNDTRIP_MS, PENDING_CONFIRM_MS } from '@/lib/offers/paySim';
import { safeJsonStorage } from '@/lib/storage/safe';
import { useAuthStore } from '@/stores/auth';
import { useTestControls } from '@/stores/testControls';

export type PassPhase = 'form' | 'google' | 'opening' | 'pending' | 'failed' | 'success';
export type PassEmailIssue = 'empty' | 'invalid' | null;

/** «Чекаємо підтвердження» → підтверджено (час сайту). */
export const PASS_CONFIRM_MS = PENDING_CONFIRM_MS;

export const PASS_FLOW_STORAGE_KEY = 't2f:pass-flow:v1';

/** Що зберігаємо: лише незавершену оплату. */
interface PassPersisted {
  phase: PassPhase;
  email: string;
  pendingSince?: Ms;
}

export interface PassFlowState {
  phase: PassPhase;
  email: string;
  emailIssue: PassEmailIssue;
  /** На введену адресу пас уже оформлено. */
  paidEmail: boolean;
  /** Посилання для входу на `paidEmail` надіслано. */
  linkSent: boolean;
  googleFailed: boolean;
  pendingSince?: Ms;
  setEmail(v: string): void;
  /** «Оформити пас» гостя з email; `false` — оплату не почато (помилка чи адреса з пасом). */
  submitEmail(): boolean;
  /** «Оформити з Google» (гість): імітований вхід Google, далі — оплата. */
  startGoogle(): void;
  /** «Оформити пас» того, хто увійшов, і «Спробувати ще». */
  pay(): void;
  /** «Чекаємо підтвердження» → підтверджено (`PassPaymentWatcher`). */
  confirm(): void;
  /** Нове оформлення (вихід з акаунта, «Не ти?», закриття успіху). */
  reset(): void;
  /** Після відновлення зі сховища: перерваний перехід на оплату — довести до результату; перерваний Google — до форми. */
  resume(): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
function later(fn: () => void, ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    fn();
  }, ms);
}

/** Годинник сайту для `pendingSince` (машина часу тестової збірки); без нього — справжній час. */
let siteNow: () => Ms = () => Date.now();
export function setPassClock(now: () => Ms): void {
  siteNow = now;
}

const INITIAL = { phase: 'form' as PassPhase, email: '', emailIssue: null, paidEmail: false, linkSent: false, googleFailed: false, pendingSince: undefined };

export const usePassStore = create<PassFlowState>()(
  persist((set, get) => {
  /** Оплату підтверджено: гість входить в акаунт, створений з оплатою; пас — на акаунт і на пристрій. */
  const complete = () => {
    const auth = useAuthStore.getState();
    const now = Date.now();
    const email = auth.user?.email ?? normalizeEmail(get().email);
    if (!auth.user) auth.signInWithPurchase(email, now);
    useAuthStore.getState().grantPass(email, now);
    set({ phase: 'success', pendingSince: undefined });
  };

  const settle = () => {
    const result = useTestControls.getState().payResult;
    if (result === 'pending') set({ phase: 'pending', pendingSince: siteNow() });
    else if (result === 'declined') set({ phase: 'failed' });
    else complete();
  };

  return {
    ...INITIAL,
    setEmail: (v) => {
      const issue = get().emailIssue;
      set({
        email: v,
        paidEmail: false,
        linkSent: false,
        emailIssue: issue ? (!v.trim() ? 'empty' : isEmail(v) ? null : 'invalid') : null,
      });
    },
    submitEmail: () => {
      const value = get().email.trim();
      const issue: PassEmailIssue = !value ? 'empty' : isEmail(value) ? null : 'invalid';
      if (issue) {
        set({ emailIssue: issue, paidEmail: false });
        return false;
      }
      if (useAuthStore.getState().passes[normalizeEmail(value)] !== undefined) {
        set({ emailIssue: null, paidEmail: true });
        return false;
      }
      set({ emailIssue: null, paidEmail: false });
      get().pay();
      return true;
    },
    startGoogle: () => {
      set({ phase: 'google', googleFailed: false, paidEmail: false });
      later(() => {
        if (useTestControls.getState().googleCancelled) {
          set({ phase: 'form', googleFailed: true });
          return;
        }
        const res = useAuthStore.getState().signInGoogle(Date.now());
        // Акаунт Google уже з пасом — оплата не потрібна (сторінка покаже «Пас уже є»).
        if (useAuthStore.getState().passes[res.email] !== undefined) {
          set({ phase: 'form' });
          return;
        }
        get().pay();
      }, GOOGLE_DELAY_MS);
    },
    pay: () => {
      if (get().phase === 'opening') return;
      set({ phase: 'opening' });
      later(settle, PAY_ROUNDTRIP_MS);
    },
    confirm: () => {
      if (get().phase === 'pending') complete();
    },
    reset: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      set({ ...INITIAL });
    },
    resume: () => {
      const phase = get().phase;
      if (phase === 'opening' && !timer) later(settle, PAY_ROUNDTRIP_MS);
      else if (phase === 'google') set({ phase: 'form' });
    },
  };
  }, {
    name: PASS_FLOW_STORAGE_KEY,
    version: 1,
    storage: safeJsonStorage<PassPersisted>('local'),
    skipHydration: true,
    partialize: (s): PassPersisted =>
      s.phase === 'opening' || s.phase === 'pending' ? { phase: s.phase, email: s.email, pendingSince: s.pendingSince } : { phase: 'form', email: '' },
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<PassPersisted>;
      if (p.phase !== 'opening' && p.phase !== 'pending') return current;
      // Оплата вже йде в іншій вкладці чи до перезавантаження цієї — не перебиваємо поточне оформлення.
      if (current.phase !== 'form') return current;
      return { ...current, phase: p.phase, email: typeof p.email === 'string' ? p.email : '', pendingSince: typeof p.pendingSince === 'number' ? p.pendingSince : undefined };
    },
  }),
);

/** Відновити незавершену оплату пасу зі сховища (раз після монтування, `PassPaymentWatcher`). */
export async function resumePassFlow(): Promise<void> {
  await usePassStore.persist.rehydrate();
  usePassStore.getState().resume();
}
