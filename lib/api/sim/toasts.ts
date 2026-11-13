/**
 * Адаптер `sim` домену «Тости» (`docs/backend/frontend-seam.md`, E4): стрічка опублікованих тостів.
 * - свої тости — `stores/toast.said` (їх пише «сервер» оплати, `lib/api/sim/checkout`);
 * - імітовані тости інших глядачів — `simulatedToasts`: лише в тестовій і демо-збірці (`SIMULATED_TOASTS` =
 *   `IS_TEST_BUILD`), у робочій — порожньо, як і раніше.
 * Імітовані тости відомі наперед на всю ніч (зі сценарію чату): «вже сказані» відбирає хук за часом сайту. Сервер у
 * `http` віддає лише опубліковані — той самий фільтр для них нічого не змінює.
 */
import { ok } from '../result';
import type { ToastEvent, ToastsService } from '../contracts/toasts';
import { CHAT_SCRIPT } from '@/lib/chat-sim/script';
import { getData } from '@/lib/data/load';
import type { ToastRecord } from '@/lib/toast/feed';
import { checkToastText } from '@/lib/toast/filter';
import { simulatedToasts } from '@/lib/toast/worldToasts';
import { useToastStore } from '@/stores/toast';

let simCache: ToastRecord[] | null = null;
/** Усі імітовані тости свята (рахуємо раз). */
function allSimulated(): ToastRecord[] {
  if (!simCache) simCache = simulatedToasts(CHAT_SCRIPT, getData());
  return simCache;
}

/** Повний список (імітовані + свої), за часом; те саме посилання, поки свої не змінились. */
let cached: { said: ToastRecord[]; all: ToastRecord[] } | null = null;
export function simToastFeed(): ToastRecord[] {
  const said = useToastStore.getState().said;
  if (!cached || cached.said !== said) cached = { said, all: [...allSimulated(), ...said].sort((a, b) => a.createdAt - b.createdAt) };
  return cached.all;
}

export function createSimToasts(): ToastsService {
  return {
    async list(opts) {
      const all = simToastFeed();
      return ok(opts?.since === undefined ? all : all.filter((t) => t.createdAt > opts.since!));
    },
    subscribe(onEvent: (event: ToastEvent) => void) {
      return useToastStore.subscribe((s, p) => {
        if (s.said === p.said) return;
        const known = new Set(p.said.map((t) => t.id));
        for (const t of s.said) if (!known.has(t.id)) onEvent({ type: 'published', toast: t });
        // Свої тости стерто («Скинути стан гостя») — подія видалення для кожного.
        const now = new Set(s.said.map((t) => t.id));
        for (const t of p.said) if (!now.has(t.id)) onEvent({ type: 'removed', id: t.id });
      });
    },
    async mine() {
      return ok(useToastStore.getState().said);
    },
    async check(text) {
      return ok({ issue: checkToastText(text) });
    },
    peek: () => simToastFeed(),
  };
}
