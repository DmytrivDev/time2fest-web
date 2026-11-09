/**
 * «Перший ряд»: стан вікна оплати та імітації місць (T112).
 *
 * - Місце, утримання, чернетка й `priceLocked` живуть у `guest.firstRow[eventId]` (localStorage, `stores/guest`);
 *   тут лише запис туди через чисті переходи з `lib/firstrow/pay`.
 * - `simStart` — «зараз» для зміщень `firstRowSeed` (пам’ять вкладки).
 * - `flow` — що показує вікно O-FIRST-ROW. Незавершена оплата (перехід на PayPro, «Чекаємо підтвердження») зберігається
 *   в `t2f:firstrow:v1`: після перезавантаження оплата доводиться до результату, а не починається вдруге
 *   (перевірка сайту 2026-11-09, A-1). Перерваний перехід відновлюється з позначкою `interrupted` (`useFirstRowEffects`).
 * - `email` — лише в пам’яті вкладки (особистих даних не зберігаємо, data-model 2).
 * - `passGifted` — пас подаровано першою покупкою (`t2f:firstrow:v1`): знижки −50% він не дає (FR-92).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GuestFirstRowEntry, Ms } from '@/lib/data/types';
import type { FormErrors, PayPhase, SettleOutcome } from '@/lib/firstrow/pay';
import { safeJsonStorage } from '@/lib/storage/safe';
import { useGuestStore } from '@/stores/guest';

export const FIRSTROW_STORAGE_KEY = 't2f:firstrow:v1';

export interface FirstRowFlow {
  eventId: string;
  phase: PayPhase;
  /** Людина повернулася до форми, не оплативши (показуємо табло «Лишилось 1:58 з 10 хвилин»). */
  returned: boolean;
  /** Іде імітований перехід на PayPro. */
  submitting: boolean;
  /** Коли почалось «Чекаємо підтвердження оплати». */
  pendingSince?: Ms;
  /** Утримання вийшло й поновлене: нова ціна й лічильник для рядка «Час утримання вийшов». */
  expired?: { free: number; price: number; until: Ms; priceChanged: boolean };
  errors: FormErrors;
  /** Перехід на оплату перервано перезавантаженням: результат ще не отримано — `useFirstRowEffects` доводить його. */
  interrupted?: boolean;
}

interface FirstRowPersisted {
  passGifted: boolean;
  /** Лише незавершена оплата: перехід на PayPro чи «Чекаємо підтвердження». */
  flow?: FirstRowFlow | null;
}

/** Чи оплата вже пішла й результату ще немає. */
function inFlight(flow: FirstRowFlow | null | undefined): flow is FirstRowFlow {
  return !!flow && (flow.phase === 'pending' || flow.submitting || flow.interrupted === true);
}

export interface FirstRowState extends FirstRowPersisted {
  simStart: Record<string, Ms>;
  flow: FirstRowFlow | null;
  email: string;
  ensureSim(eventId: string, now: Ms): Ms;
  setFlow(flow: FirstRowFlow | null): void;
  patchFlow(patch: Partial<FirstRowFlow>): void;
  setEmail(email: string): void;
  markPassGifted(): void;
  reset(): void;
}

const emptyFlow = (eventId: string, phase: PayPhase): FirstRowFlow => ({ eventId, phase, returned: false, submitting: false, errors: {} });
export { emptyFlow };

export const useFirstRowStore = create<FirstRowState>()(
  persist(
    (set, get) => ({
      passGifted: false,
      simStart: {},
      flow: null,
      email: '',
      ensureSim: (eventId, now) => {
        const known = get().simStart[eventId];
        if (known !== undefined) return known;
        set((s) => ({ simStart: { ...s.simStart, [eventId]: now } }));
        return now;
      },
      setFlow: (flow) => set({ flow }),
      patchFlow: (patch) => set((s) => (s.flow ? { flow: { ...s.flow, ...patch } } : s)),
      setEmail: (email) => set({ email }),
      markPassGifted: () => set({ passGifted: true }),
      reset: () => set({ passGifted: false, simStart: {}, flow: null, email: '' }),
    }),
    {
      name: FIRSTROW_STORAGE_KEY,
      version: 1,
      storage: safeJsonStorage<FirstRowPersisted>('local'),
      partialize: (s) => ({ passGifted: s.passGifted, flow: inFlight(s.flow) ? { ...s.flow, errors: {} } : null }),
      migrate: () => ({ passGifted: false }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<FirstRowPersisted>;
        const flow = p.flow && typeof p.flow.eventId === 'string' && inFlight(p.flow) ? p.flow : null;
        return {
          ...current,
          passGifted: p.passGifted === true,
          flow: flow ? { ...flow, errors: {}, submitting: false, interrupted: flow.phase !== 'pending' } : current.flow,
        };
      },
    },
  ),
);

/** Запис у `guest.firstRow[eventId]`. */
export function writeEntry(eventId: string, entry: GuestFirstRowEntry): void {
  useGuestStore.getState().updateFirstRow(eventId, () => entry);
}

export function readEntry(eventId: string): GuestFirstRowEntry {
  return useGuestStore.getState().firstRow[eventId] ?? {};
}

/** Застосувати результат оплати до гостя й вікна. */
export function applyOutcome(eventId: string, outcome: SettleOutcome, now: Ms): void {
  writeEntry(eventId, outcome.entry);
  const s = useFirstRowStore.getState();
  const prev = s.flow && s.flow.eventId === eventId ? s.flow : emptyFlow(eventId, 'form');
  s.setFlow({
    ...prev,
    phase: outcome.phase,
    submitting: false,
    returned: outcome.phase === 'declined' ? true : prev.returned,
    ...(outcome.phase === 'pending' ? { pendingSince: now } : { pendingSince: undefined }),
  });
}

/** Чи дає пас гостя знижку: лише куплений, не подарований (FR-91/92). */
export function useBoughtPass(): boolean {
  const hasPass = useGuestStore((s) => s.hasPass);
  const gifted = useFirstRowStore((s) => s.passGifted);
  return hasPass && !gifted;
}

// «Скинути стан гостя» (новий id) скидає й імітацію «Першого ряду».
useGuestStore.subscribe((s, prev) => {
  if (s.id !== prev.id) useFirstRowStore.getState().reset();
});
