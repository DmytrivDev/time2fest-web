/**
 * Оплата чайових «Скажи тост на весь світ» — варіант B «Тост під час оплати» (дошка `Desk-Tips-Toast`, рішення власника
 * 2026-11-07; раніше — `Desk-Tips-Pay`, `Desk-Tips-Thanks`, 2026-11-01).
 * «Підтримати $N» одразу відкриває оплату PayPro Global (імітація) — вікно «Чайові» показує «Чекаємо оплату» і поле
 * тосту: «Поки оплачуєш — напиши тост». Оплату підтвердили — «Перевір тост — і в чат», «Опублікувати тост»; не
 * натиснули — публікуємо самі за `TOAST_AUTO_MS`. Email для квитанції просить сторінка PayPro (акаунт не потрібен).
 * Результат оплати — перемикач тестової збірки (`testControls.payResult`): `pending` — підтвердження через
 * `TIPS_CONFIRM_MS` часу сайту, `declined` — «Оплата не пройшла», решта — підтверджено одразу. Немає мережі — «Немає
 * з’єднання», оплату не починаємо. Після публікації золотий тост гостя — у чаті «Світ», пропозиція чайових зникає.
 */
import { create } from 'zustand';
import { buildToast } from '@/lib/chat-sim/toast';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { Ms } from '@/lib/data/types';
import { PAY_ROUNDTRIP_MS, PENDING_CONFIRM_MS } from '@/lib/firstrow/pay';
import type { TipAmount } from '@/lib/offers/format';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

/** `form` — суми (з «Підтримати» в хедері); `paying` — оплата відкрита, пишемо тост; `paid` — оплачено, тост ще не в чаті. */
export type TipsPhase = 'form' | 'paying' | 'paid' | 'failed' | 'offline' | 'success';

export const TIPS_CONFIRM_MS = PENDING_CONFIRM_MS;
/** Імітація: скільки триває оплата на PayPro (є час написати тост, як у справжній оплаті). */
export const TIPS_PAY_MS = 6_000;
/** Оплату підтверджено, а «Опублікувати тост» не натиснули — публікуємо самі. */
export const TOAST_AUTO_MS = 30_000;

export interface TipsFlowState {
  phase: TipsPhase;
  amount: TipAmount;
  toast: string;
  /** Звідки оплата: блок (під штампом, сторінка «Підтримати») — без форми, одразу оплата. */
  fromBlock: boolean;
  /** Оплату відкрито й чекаємо підтвердження (`pending`) — з цього моменту. */
  pendingSince?: Ms;
  /** Оплату підтверджено — від цього моменту рахуємо автопублікацію. */
  paidAt?: Ms;
  setAmount(v: TipAmount): void;
  setToast(v: string): void;
  /** Блок: одразу оплата з його сумою; `toast` — типовий текст, якщо гість ще нічого не писав. */
  payFromBlock(amount: TipAmount, toast: string): void;
  /** «Підтримати $N» / «Спробувати ще» / «Оплатити» — (знову) відкрити оплату. */
  pay(): void;
  /** «Скасувати» й «Змінити» після помилки — назад до сум. */
  toForm(): void;
  /** Оплату підтверджено (`TipsPaymentWatcher` для `pending`). */
  confirm(): void;
  /** «Опублікувати тост» (чи сам за `TOAST_AUTO_MS`). */
  publish(): void;
  reset(): void;
}

let timer: ReturnType<typeof setTimeout> | null = null;
let siteNow: () => Ms = () => Date.now();
export function setTipsClock(now: () => Ms): void {
  siteNow = now;
}

const isOffline = () =>
  useTestControls.getState().offlineSimulated || (typeof navigator !== 'undefined' && navigator.onLine === false);

const INITIAL = { phase: 'form' as TipsPhase, amount: 5 as TipAmount, toast: '', fromBlock: false, pendingSince: undefined, paidAt: undefined };

export const useTipsStore = create<TipsFlowState>()((set, get) => {
  const settle = () => {
    const result = useTestControls.getState().payResult;
    if (result === 'pending') set({ pendingSince: siteNow() });
    else if (result === 'declined') set({ phase: 'failed' });
    else set({ phase: 'paid', paidAt: siteNow(), pendingSince: undefined });
  };
  return {
    ...INITIAL,
    setAmount: (amount) => set({ amount }),
    setToast: (toast) => set({ toast }),
    payFromBlock: (amount, toast) => {
      set({ amount, fromBlock: true, toast: get().toast || toast });
      get().pay();
    },
    pay: () => {
      if (isOffline()) {
        set({ phase: 'offline' });
        return;
      }
      set({ phase: 'paying', pendingSince: undefined });
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (get().phase === 'paying' && get().pendingSince === undefined) settle();
      }, PAY_ROUNDTRIP_MS + TIPS_PAY_MS);
    },
    toForm: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      set({ phase: 'form', fromBlock: false, pendingSince: undefined, paidAt: undefined });
    },
    confirm: () => {
      if (get().phase === 'paying') set({ phase: 'paid', paidAt: siteNow(), pendingSince: undefined });
    },
    publish: () => {
      if (get().phase !== 'paid') return;
      const g = useGuestStore.getState();
      const now = siteNow();
      useChatFeed.getState().append([
        buildToast({ text: get().toast, amount: get().amount, now, guestId: g.id, nick: g.nick, flagCode: g.flagCode ?? g.detectedFlag, hasPass: g.hasPass }),
      ]);
      g.actOffer('primary', 'tips');
      g.dismissOffer(now, 'tips');
      set({ phase: 'success', paidAt: undefined });
    },
    reset: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      set({ ...INITIAL });
    },
  };
});
