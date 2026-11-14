/**
 * Коли тост можна сказати (рішення власника 2026-11-13, кінець — 2026-11-14): лише поки свято йде — те саме правило,
 * що `isCelebrating` (від 2 год до першої півночі до 2 год після останньої). До свята тост недоречний: ні чату, ні
 * смуги, ніхто його не побачить; після — свято скінчилось. Одне чисте правило для шапки, смуги, чату, картки штампа, пасу й сторінки
 * «Тости світу» (`/support/`).
 */
import { CELEBRATION_LEAD, isCelebrating } from '@/lib/engine/celebration';
import type { Dataset, Ms } from '@/lib/data/types';

/** Період тостів: до свята, свято йде, свято скінчилось. */
export type ToastSeason = 'before' | 'during' | 'after';

/** Від якої миті тости відкриті: `CELEBRATION_LEAD` до першої півночі; поясів немає — `null`. */
export function toastsOpenAt(data: Pick<Dataset, 'zones'>): Ms | null {
  if (data.zones.length === 0) return null;
  let first = Infinity;
  for (const z of data.zones) if (z.midnightMs < first) first = z.midnightMs;
  return first - CELEBRATION_LEAD;
}

/** Чи можна сказати тост у мить `now` — свято йде (`isCelebrating`). */
export function canSayToast(now: Ms, data: Pick<Dataset, 'zones'>): boolean {
  return isCelebrating(now, data);
}

/** Який період у мить `now`: свято йде — `during`; до відкриття тостів (і час невідомий) — `before`; інакше — `after`. */
export function toastSeason(now: Ms, data: Pick<Dataset, 'zones'>): ToastSeason {
  if (canSayToast(now, data)) return 'during';
  const open = toastsOpenAt(data);
  if (!now || open === null || now < open) return 'before';
  return 'after';
}
