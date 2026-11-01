/**
 * Оплата чайових «Скажи тост на весь світ» (дошки `Desk-Tips-Pay`, `Desk-Tips-Thanks`, рішення власника 2026-11-01).
 * Як оплата пасу (`stores/pass`): імітація PayPro Global, результат — перемикач тестової збірки (`testControls.payResult`):
 * `pending` → «Чекаємо підтвердження» (підтверджується через `TIPS_CONFIRM_MS` часу сайту), `declined` → «Оплата не
 * пройшла», решта → «Дякуємо». Немає мережі (чи імітація «офлайн») — «Немає з’єднання», оплату не починаємо.
 * Після оплати золотий тост гостя з’являється в чаті «Світ», а пропозиція чайових під штампом зникає.
 * Звідки: блок під штампом (одразу оплата, без форми) або «Підтримати» в хедері (форма у вікні: тост, сума, email).
 */
import { create } from 'zustand';
import { isEmail } from '@/lib/auth/sim';
import { buildToast } from '@/lib/chat-sim/toast';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { Ms } from '@/lib/data/types';
import { PAY_ROUNDTRIP_MS, PENDING_CONFIRM_MS } from '@/lib/firstrow/pay';
import type { TipAmount } from '@/lib/offers/format';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

export type TipsPhase = 'form' | 'opening' | 'pending' | 'failed' | 'offline' | 'success';
export type TipsEmailIssue = 'empty' | 'invalid' | null;

export const TIPS_CONFIRM_MS = PENDING_CONFIRM_MS;

export interface TipsFlowState {
  phase: TipsPhase;
  amount: TipAmount;
  toast: string;
  email: string;
  emailIssue: TipsEmailIssue;
  /** Звідки оплата: блок під штампом — без форми (email попросить PayPro). */
  fromBlock: boolean;
  pendingSince?: Ms;
  setAmount(v: TipAmount): void;
  setToast(v: string): void;
  setEmail(v: string): void;
  /** Блок під штампом: одразу оплата з його сумою й тостом. */
  payFromBlock(amount: TipAmount, toast: string): void;
  /** Форма у вікні: перевірити email і почати оплату; `false` — є помилка. */
  submit(): boolean;
  /** «Спробувати ще» / почати оплату. */
  pay(): void;
  /** «Скасувати» на «Відкриваємо оплату…» і «Змінити» після помилки — назад до форми. */
  toForm(): void;
  /** «Чекаємо підтвердження» → підтверджено (`TipsPaymentWatcher`). */
  confirm(): void;
  reset(): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let siteNow: () => Ms = () => Date.now();
export function setTipsClock(now: () => Ms): void {
  siteNow = now;
}

const isOffline = () =>
  useTestControls.getState().offlineSimulated || (typeof navigator !== 'undefined' && navigator.onLine === false);

const INITIAL = { phase: 'form' as TipsPhase, amount: 5 as TipAmount, toast: '', email: '', emailIssue: null, fromBlock: false, pendingSince: undefined };

export const useTipsStore = create<TipsFlowState>()((set, get) => {
  /** Оплачено: тост — у чат «Світ», пропозиція чайових під штампом зникає. */
  const complete = () => {
    const g = useGuestStore.getState();
    const now = siteNow();
    useChatFeed.getState().append([
      buildToast({ text: get().toast, amount: get().amount, now, guestId: g.id, nick: g.nick, flagCode: g.flagCode ?? g.detectedFlag, hasPass: g.hasPass }),
    ]);
    g.actOffer('primary', 'tips');
    g.dismissOffer(now, 'tips');
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
    setAmount: (amount) => set({ amount }),
    setToast: (toast) => set({ toast }),
    setEmail: (email) => {
      const issue = get().emailIssue;
      set({ email, emailIssue: issue ? (!email.trim() ? 'empty' : isEmail(email) ? null : 'invalid') : null });
    },
    payFromBlock: (amount, toast) => {
      set({ amount, toast, fromBlock: true });
      get().pay();
    },
    submit: () => {
      const v = get().email.trim();
      const issue: TipsEmailIssue = !v ? 'empty' : isEmail(v) ? null : 'invalid';
      set({ emailIssue: issue });
      if (issue) return false;
      get().pay();
      return true;
    },
    pay: () => {
      if (get().phase === 'opening') return;
      if (isOffline()) {
        set({ phase: 'offline' });
        return;
      }
      set({ phase: 'opening' });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (get().phase === 'opening') settle();
      }, PAY_ROUNDTRIP_MS);
    },
    toForm: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      set({ phase: 'form', fromBlock: false, pendingSince: undefined });
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
