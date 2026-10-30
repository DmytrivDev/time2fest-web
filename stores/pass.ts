/**
 * Оформлення Новорічного пасу (імітація оплати, рішення власника 2026-10-30: як у «Першому ряду»).
 * Одне оформлення на вкладку: сторінка `/pass/` і вікно під трансляцією показують той самий стан, тож людина, що
 * закрила вікно на «Чекаємо підтвердження», побачить пас, щойно оплату підтвердять (`PassPaymentWatcher`).
 *
 * Гість: Google або email (акаунт створюється разом з оплатою); той, хто увійшов, — email не вводить.
 * Email, на який пас уже оформлено, оплату не починає: «На цю адресу пас уже оформлено» + посилання для входу.
 * Результат оплати — перемикач тестової збірки (`stores/testControls.payResult`): `pending` → «Чекаємо підтвердження»
 * (підтверджується через `PASS_CONFIRM_MS` часу сайту), `declined` → «Оплата не пройшла», решта → «Пас активний».
 * Email — лише в пам’яті вкладки (особистих даних не зберігаємо).
 */
import { create } from 'zustand';
import { GOOGLE_DELAY_MS, isEmail, normalizeEmail } from '@/lib/auth/sim';
import type { Ms } from '@/lib/data/types';
import { PAY_ROUNDTRIP_MS, PENDING_CONFIRM_MS } from '@/lib/firstrow/pay';
import { useAuthStore } from '@/stores/auth';
import { useTestControls } from '@/stores/testControls';

export type PassPhase = 'form' | 'google' | 'opening' | 'pending' | 'failed' | 'success';
export type PassEmailIssue = 'empty' | 'invalid' | null;

/** «Чекаємо підтвердження» → підтверджено (час сайту), як у «Першому ряду». */
export const PASS_CONFIRM_MS = PENDING_CONFIRM_MS;

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

export const usePassStore = create<PassFlowState>()((set, get) => {
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
  };
});
