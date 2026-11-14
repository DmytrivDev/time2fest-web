/**
 * Тост — головний платний продукт (рішення власника 2026-11-12, дошки `Desk-Toast-New`, `Phone-Toast-New` v2; замінює
 * «Чайові» 2026-11-07). Вікно «Сказати тост»: рівень $2 / $5 (за замовчуванням) / $10 і текст пишуть ДО оплати;
 * на «Оплатити $N» — фільтр (`lib/toast/filter`) і підпис (нік гостя), далі оплата PayPro Global (імітація):
 * «Чекаємо оплату» (тост уже не змінити) → підтверджено → тост одразу в чаті «Світ» і в смузі тостів → «Тост
 * опубліковано». Результат оплати — перемикач тестової збірки (`testControls.payResult`): `pending` — підтвердження через
 * `TOAST_CONFIRM_MS` часу сайту (`ToastPaymentWatcher`), `declined` — «Оплата не пройшла» (тост збережено), решта —
 * підтверджено одразу. Немає мережі — «Немає з’єднання», оплату не починаємо.
 * Тост за $10 дарує Новорічний пас (хто його ще не має): той, хто увійшов, — на акаунт одразу («Пас активний»); гість —
 * пас чекає входу на цьому пристрої (`useAuthStore.giftPass`).
 *
 * У `localStorage` (`t2f:toast:v1`): свої сказані тости (`said` — смуга, чат, привітання опівночі) і незавершена оплата
 * («paying»), щоб після перезавантаження вона дійшла до результату. Відновлює `ToastPaymentWatcher` після монтування.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { validateNick } from '@/lib/chat/nick';
import type { Ms } from '@/lib/data/types';
import { getService } from '@/lib/api/services';
import { PENDING_CONFIRM_MS, TOAST_PAY_MS } from '@/lib/offers/paySim';
import { safeJsonStorage } from '@/lib/storage/safe';
import type { ToastRecord } from '@/lib/toast/feed';
import { checkToastText, type ToastIssue } from '@/lib/toast/filter';
import { DEFAULT_TIER, isToastTier, TOAST_MAX, type ToastTier } from '@/lib/toast/tiers';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

/** `form` — рівень і тост; `paying` — оплата відкрита, тост уже не змінити. */
export type ToastPhase = 'form' | 'paying' | 'failed' | 'offline' | 'success';
/** Подарунок до тосту за $10: пас уже на акаунті чи чекає входу. */
export type ToastGift = 'active' | 'pending' | null;

export const TOAST_CONFIRM_MS = PENDING_CONFIRM_MS;
/** Імітація: скільки триває оплата на PayPro (до результату) — спільні таймінги імітації. */
export { TOAST_PAY_MS };
export const TOAST_STORAGE_KEY = 't2f:toast:v1';

interface ToastPersisted {
  said: ToastRecord[];
  /** Лише незавершена оплата. */
  flow: { phase: 'paying'; tier: ToastTier; text: string; pendingSince?: Ms; clientId?: string } | null;
}

export interface ToastFlowState {
  phase: ToastPhase;
  tier: ToastTier;
  text: string;
  /** Фільтр не пропустив текст на «Оплатити» — що й де; знімається, щойно текст змінено. */
  issue: ToastIssue | null;
  /** Оплату відкрито й чекаємо підтвердження (`pending`) — з цього моменту. */
  pendingSince?: Ms;
  /** Щойно опублікований тост (екран успіху). */
  last?: ToastRecord;
  gift: ToastGift;
  /** Замовлення цього вікна в спільному процесі оплати (`checkout`, шов E4). */
  clientId?: string;
  /** Свої сказані тости на цьому пристрої (їх пише «сервер» імітації після оплати, `lib/api/sim/checkout`). */
  said: ToastRecord[];
  /** Вікно відкрито: рівень (з кнопки «Скажи тост за $10» — $10) і типовий текст, якщо поле порожнє. Оплату не чіпає. */
  prepare(tier: ToastTier | undefined, defaultText: string): void;
  setTier(v: ToastTier): void;
  setText(v: string): void;
  /** «Оплатити $N» / «Спробувати ще»: фільтр і підпис, далі оплата; `false` — не почали. */
  pay(): boolean;
  /** «Скасувати» під час оплати — назад до форми (текст лишається). */
  toForm(): void;
  /** Оплату підтверджено (`ToastPaymentWatcher` для `pending`). */
  confirm(): void;
  /** Вікно закрито: після успіху — з нуля; оплата йде — лишаємо; інакше — форма з тим самим текстом. */
  closed(): void;
  reset(): void;
  /** Після відновлення зі сховища: перерваний перехід на оплату — довести до результату. */
  resume(): void;
}

/** Годинник сайту (машина часу) для «чекаємо підтвердження» й часу тосту — тепер у спільному процесі оплати. */
export function setToastClock(now: () => Ms): void {
  getService('checkout').dev?.setClock(now);
}

const newClientId = () => `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Підписка вікна на свої замовлення (один раз на вкладку). Результат оплати (тост у чаті й серед своїх, пас у подарунок)
 * видає «сервер» (`lib/api/sim/checkout`); вікно лише показує його.
 */
let listening: (() => void) | null = null;
function listen(): void {
  if (listening) return;
  listening = getService('checkout').subscribe((o) => {
    const st = useToastStore.getState();
    if (o.clientId !== st.clientId || o.product.kind !== 'toast') return;
    if (o.status === 'pending') useToastStore.setState({ pendingSince: o.pendingSince });
    else if (o.status === 'paid') useToastStore.setState({ phase: 'success', last: o.toast, gift: o.gift?.pass ?? null, pendingSince: undefined, clientId: undefined });
    else if (o.status === 'declined') useToastStore.setState({ phase: 'failed', pendingSince: undefined, clientId: undefined });
    else if (o.status === 'cancelled' || o.status === 'expired') useToastStore.setState({ phase: 'form', pendingSince: undefined, clientId: undefined });
  });
}

const isOffline = () =>
  useTestControls.getState().offlineSimulated || (typeof navigator !== 'undefined' && navigator.onLine === false);

/** Підпис тосту готовий: нік є й дійсний (тост ніколи не підписують «Гість»). */
export function signatureReady(nick: string | undefined): boolean {
  return !!nick && validateNick(nick) === null;
}

const FORM = { phase: 'form' as ToastPhase, tier: DEFAULT_TIER, text: '', issue: null, pendingSince: undefined, last: undefined, gift: null as ToastGift, clientId: undefined };

export const useToastStore = create<ToastFlowState>()(
  persist(
    (set, get) => {
      return {
        ...FORM,
        said: [],
        prepare: (tier, defaultText) => {
          const s = get();
          if (s.phase === 'paying') return;
          set({
            ...FORM,
            tier: tier ?? DEFAULT_TIER,
            text: s.phase === 'success' || !s.text ? defaultText : s.text,
          });
        },
        setTier: (tier) => set({ tier }),
        setText: (text) => set({ text: text.slice(0, TOAST_MAX), issue: null }),
        pay: () => {
          const s = get();
          if (s.phase === 'paying' || !s.text.trim()) return false;
          const issue = checkToastText(s.text);
          if (issue) {
            set({ issue, phase: 'form' });
            return false;
          }
          if (!signatureReady(useGuestStore.getState().nick)) return false;
          if (isOffline()) {
            set({ phase: 'offline' });
            return false;
          }
          const clientId = newClientId();
          set({ phase: 'paying', issue: null, pendingSince: undefined, clientId });
          listen();
          void getService('checkout')
            .start({ product: { kind: 'toast', tier: s.tier, text: s.text }, returnPath: '/', clientId })
            .then((res) => {
              // Старт не вдався: мережа — «Немає з’єднання» (гроші не списано, текст лишається); інше — «Оплата не пройшла».
              if (!res.ok && get().clientId === clientId)
                set({ phase: res.error.code === 'network' ? 'offline' : 'failed', pendingSince: undefined, clientId: undefined });
            });
          return true;
        },
        toForm: () => {
          const { clientId } = get();
          if (clientId) void getService('checkout').cancel(`ord-${clientId}`);
          set({ phase: 'form', pendingSince: undefined, clientId: undefined });
        },
        confirm: () => {
          const { phase, clientId } = get();
          if (phase === 'paying' && clientId) getService('checkout').dev?.confirm(clientId);
        },
        closed: () => {
          const phase = get().phase;
          if (phase === 'paying') return;
          if (phase === 'success') set({ ...FORM });
          else set({ phase: 'form', issue: null, tier: DEFAULT_TIER });
        },
        reset: () => {
          set({ ...FORM });
        },
        resume: () => {
          const { phase, clientId } = get();
          if (phase !== 'paying' || !clientId) return;
          listen();
          // Замовлення немає (сховище оплат стерто) — до форми з тим самим текстом.
          void getService('checkout')
            .open()
            .then((res) => {
              if (res.ok && !res.value.some((o) => o.clientId === clientId) && get().clientId === clientId) set({ phase: 'form', pendingSince: undefined, clientId: undefined });
            });
        },
      };
    },
    {
      name: TOAST_STORAGE_KEY,
      version: 1,
      storage: safeJsonStorage<ToastPersisted>('local'),
      skipHydration: true,
      partialize: (s): ToastPersisted => ({
        said: s.said,
        flow: s.phase === 'paying' ? { phase: 'paying', tier: s.tier, text: s.text, pendingSince: s.pendingSince, clientId: s.clientId } : null,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ToastPersisted>;
        const said = Array.isArray(p.said) ? p.said.filter((t) => t && typeof t.id === 'string' && isToastTier(t.tier)) : [];
        // Свої тости — з обох джерел (інша вкладка могла сказати ще один).
        const ids = new Set(current.said.map((t) => t.id));
        const merged = { ...current, said: [...current.said, ...said.filter((t) => !ids.has(t.id))].sort((a, b) => a.createdAt - b.createdAt) };
        const f = p.flow;
        if (!f || f.phase !== 'paying' || current.phase !== 'form' || !isToastTier(f.tier)) return merged;
        return {
          ...merged,
          phase: 'paying',
          tier: f.tier,
          text: typeof f.text === 'string' ? f.text : '',
          pendingSince: typeof f.pendingSince === 'number' ? f.pendingSince : undefined,
          clientId: typeof f.clientId === 'string' ? f.clientId : undefined,
        };
      },
    },
  ),
);

/** Відновити свої тости й незавершену оплату зі сховища (раз після монтування, `ToastPaymentWatcher`). */
export async function resumeToastFlow(): Promise<void> {
  await useToastStore.persist.rehydrate();
  useToastStore.getState().resume();
}
