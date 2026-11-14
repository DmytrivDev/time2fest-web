/**
 * Оформлення Новорічного пасу (імітація оплати, рішення власника 2026-10-30).
 * Одне оформлення на вкладку: сторінка `/pass/` і вікно під трансляцією показують той самий стан, тож людина, що
 * закрила вікно на «Чекаємо підтвердження», побачить пас, щойно оплату підтвердять (`PassPaymentWatcher`).
 *
 * Гість: Google або email (пас працює на цьому пристрої одразу після оплати; в акаунт — після входу з цією поштою,
 * рішення власника 2026-11-13); той, хто увійшов, — email не вводить.
 * Email, на який пас уже оформлено, оплату не починає: «На цю адресу пас уже оформлено» + код для входу.
 * Старт оплати, що не вдався (мережа, оплату вимкнено), — `startFailed`; замовлення, що закрилось неоплаченим, — `expired`.
 * Результат оплати — перемикач тестової збірки (`stores/testControls.payResult`): `pending` → «Чекаємо підтвердження»
 * (підтверджується через `PASS_CONFIRM_MS` часу сайту), `declined` → «Оплата не пройшла», решта → «Пас активний».
 * Email — у пам’яті вкладки; поки оплата йде («opening», «pending»), стан разом з email зберігається в `localStorage`
 * (`t2f:pass-flow:v1`), щоб після перезавантаження оплата довелась до кінця, а не почалась удруге (перевірка сайту
 * 2026-11-09, A-1). Після підтвердження, відмови чи скасування email зі сховища зникає. Відновлює
 * `PassPaymentWatcher` після монтування (`resumePassFlow`), щоб розмітка гідратації була однакова.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getService } from '@/lib/api/services';
import { authActions, currentSession, hasPassNow } from '@/lib/api/hooks/auth';
import { isEmail } from '@/lib/auth/email';
import type { Ms } from '@/lib/data/types';
import { PENDING_CONFIRM_MS } from '@/lib/offers/paySim';
import { safeJsonStorage } from '@/lib/storage/safe';

export type PassPhase = 'form' | 'google' | 'opening' | 'pending' | 'failed' | 'startFailed' | 'expired' | 'success';
export type PassEmailIssue = 'empty' | 'invalid' | null;

/** «Чекаємо підтвердження» → підтверджено (час сайту). */
export const PASS_CONFIRM_MS = PENDING_CONFIRM_MS;

export const PASS_FLOW_STORAGE_KEY = 't2f:pass-flow:v1';

/** Що зберігаємо: лише незавершену оплату (і `clientId` її замовлення). */
interface PassPersisted {
  phase: PassPhase;
  email: string;
  pendingSince?: Ms;
  clientId?: string;
}

export interface PassFlowState {
  phase: PassPhase;
  email: string;
  emailIssue: PassEmailIssue;
  /** На введену адресу пас уже оформлено. */
  paidEmail: boolean;
  googleFailed: boolean;
  /** Запит старту оплати в дорозі (кнопка «Оформити пас» — «Відкриваємо оплату…» ще до відповіді сервісу). */
  starting: boolean;
  /** Чому не вдалося почати оплату (`startFailed`). */
  startError: 'network' | 'unavailable' | null;
  pendingSince?: Ms;
  /** Замовлення цього вікна в спільному процесі оплати (`checkout`, шов E4). */
  clientId?: string;
  setEmail(v: string): void;
  /** «Оформити пас» гостя з email; `false` — оплату не почато (помилка чи адреса з пасом). */
  submitEmail(): boolean;
  /** «Оформити з Google» (гість): імітований вхід Google, далі — оплата. */
  startGoogle(): void;
  /** «Оформити пас» того, хто увійшов, і «Спробувати ще». `afterStart` — фаза «переходимо» лише після згоди сервісу. */
  pay(opts?: { afterStart?: boolean }): void;
  /** Тестова кнопка «підтвердити» (у `http` — вебхук; у `sim` — `CheckoutSettler` за часом сайту). */
  confirm(): void;
  /** Нове оформлення (вихід з акаунта, «Не ти?», закриття успіху). */
  reset(): void;
  /** Після відновлення зі сховища: перерваний перехід на оплату — довести до результату; перерваний Google — до форми. */
  resume(): void;
}

/** Вхід Google, що триває (скасування — «Не ти?», скидання). */
let googleRun: AbortController | null = null;

/** Годинник сайту для `pendingSince` (машина часу тестової збірки) — тепер у спільному процесі оплати. */
export function setPassClock(now: () => Ms): void {
  getService('checkout').dev?.setClock(now);
}

const INITIAL = {
  phase: 'form' as PassPhase,
  email: '',
  emailIssue: null,
  paidEmail: false,
  googleFailed: false,
  starting: false,
  startError: null,
  pendingSince: undefined,
  clientId: undefined,
};

const newClientId = () => `pass-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Підписка вікна на свої замовлення (один раз на вкладку). */
let listening: (() => void) | null = null;
function listen(): void {
  if (listening) return;
  listening = getService('checkout').subscribe((o) => {
    const st = usePassStore.getState();
    if (o.clientId !== st.clientId || o.product.kind !== 'pass') return;
    if (o.status === 'pending') usePassStore.setState({ phase: 'pending', pendingSince: o.pendingSince });
    else if (o.status === 'paid') usePassStore.setState({ phase: 'success', pendingSince: undefined, clientId: undefined });
    else if (o.status === 'declined') usePassStore.setState({ phase: 'failed', pendingSince: undefined, clientId: undefined });
    else if (o.status === 'expired') usePassStore.setState({ phase: 'expired', pendingSince: undefined, clientId: undefined });
    else if (o.status === 'cancelled') usePassStore.setState({ phase: 'form', pendingSince: undefined, clientId: undefined });
  });
}

export const usePassStore = create<PassFlowState>()(
  persist((set, get) => {
  // Оплата — один процес для пасу й тосту (`checkout`): старт тут, результат (пас на акаунт, вхід гостя в пошту з оплати)
  // видає «сервер» (`lib/api/sim/checkout`), вікно лише стежить за своїм замовленням (`listen`).

  return {
    ...INITIAL,
    setEmail: (v) => {
      const issue = get().emailIssue;
      set({
        email: v,
        paidEmail: false,
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
      // «На цю адресу пас уже оформлено» вирішує сервіс оплати (`conflict` `pass-owned`, шов — залишки E5): фаза
      // «Переходимо на оплату» вмикається лише після згоди сервісу (у `sim` — у тому ж такті), тож відмова не блимає.
      set({ emailIssue: null, paidEmail: false });
      get().pay({ afterStart: true });
      return true;
    },
    startGoogle: () => {
      set({ phase: 'google', googleFailed: false, paidEmail: false });
      // Вхід Google — через сервіс входу (шов, залишки E5); «скасовано» з тестової панелі читає адаптер.
      googleRun?.abort();
      const run = new AbortController();
      googleRun = run;
      void authActions.google({ returnPath: '/pass/', signal: run.signal }).then((res) => {
        if (run.signal.aborted || get().phase !== 'google') return;
        googleRun = null;
        if (!res.ok) {
          set({ phase: 'form', googleFailed: true });
          return;
        }
        if (res.value.kind === 'redirect') {
          window.location.assign(res.value.url);
          return;
        }
        // Акаунт Google уже з пасом — оплата не потрібна (сторінка покаже «Пас уже є»).
        if (hasPassNow()) {
          set({ phase: 'form' });
          return;
        }
        get().pay();
      });
    },
    pay: (opts) => {
      if (get().phase === 'opening' || get().clientId) return;
      const clientId = newClientId();
      // Гість з поштою: «Переходимо на оплату» — лише коли сервіс прийняв замовлення (див. `submitEmail`); до відповіді
      // кнопка вже «зайнята» (`starting`).
      set(opts?.afterStart ? { clientId, starting: true, startError: null } : { phase: 'opening', clientId, starting: true, startError: null });
      listen();
      const signedIn = (currentSession()?.user ?? null) !== null;
      void getService('checkout')
        .start({ product: { kind: 'pass' }, ...(signedIn ? {} : { email: get().email }), returnPath: '/pass/', clientId })
        .then((res) => {
          if (get().clientId !== clientId) return;
          set({ starting: false });
          if (res.ok) {
            // Подія замовлення могла вже змінити фазу («чекаємо», «оплачено») — тоді не повертаємо «переходимо».
            if (get().phase === 'form' && res.value.order.status === 'open') set({ phase: 'opening' });
            return;
          }
          // На цю адресу пас уже оформлено — як перевірка форми; інакше — «Не вдалося відкрити оплату» (гроші не списано).
          if (res.error.reason === 'pass-owned') set({ phase: 'form', paidEmail: true, clientId: undefined });
          else set({ phase: 'startFailed', startError: res.error.code === 'unavailable' ? 'unavailable' : 'network', clientId: undefined });
        });
    },
    confirm: () => {
      const { phase, clientId } = get();
      if (phase === 'pending' && clientId) getService('checkout').dev?.confirm(clientId);
    },
    reset: () => {
      googleRun?.abort();
      googleRun = null;
      set({ ...INITIAL });
    },
    resume: () => {
      const { phase, clientId } = get();
      if (phase === 'google') set({ phase: 'form' });
      if ((phase !== 'opening' && phase !== 'pending') || !clientId) return;
      listen();
      // Замовлення немає (сховище оплат стерто) — до форми, а не вічне «переходимо на оплату».
      void getService('checkout')
        .open()
        .then((res) => {
          if (res.ok && !res.value.some((o) => o.clientId === clientId) && get().clientId === clientId) set({ phase: 'form', pendingSince: undefined, clientId: undefined });
        });
    },
  };
  }, {
    name: PASS_FLOW_STORAGE_KEY,
    version: 1,
    storage: safeJsonStorage<PassPersisted>('local'),
    skipHydration: true,
    partialize: (s): PassPersisted =>
      s.phase === 'opening' || s.phase === 'pending' ? { phase: s.phase, email: s.email, pendingSince: s.pendingSince, clientId: s.clientId } : { phase: 'form', email: '' },
    merge: (persisted, current) => {
      const p = (persisted ?? {}) as Partial<PassPersisted>;
      if (p.phase !== 'opening' && p.phase !== 'pending') return current;
      // Оплата вже йде в іншій вкладці чи до перезавантаження цієї — не перебиваємо поточне оформлення.
      if (current.phase !== 'form') return current;
      return {
        ...current,
        phase: p.phase,
        email: typeof p.email === 'string' ? p.email : '',
        pendingSince: typeof p.pendingSince === 'number' ? p.pendingSince : undefined,
        clientId: typeof p.clientId === 'string' ? p.clientId : undefined,
      };
    },
  }),
);

/** Відновити незавершену оплату пасу зі сховища (раз після монтування, `PassPaymentWatcher`). */
export async function resumePassFlow(): Promise<void> {
  await usePassStore.persist.rehydrate();
  usePassStore.getState().resume();
}
