import type { Dataset, Ms } from '@/lib/data/types';

/** За скільки до першої півночі свято вже «йде» (рішення власника 2026-11-08). */
export const CELEBRATION_LEAD = 2 * 60 * 60 * 1_000;

/**
 * Свято йде: від `CELEBRATION_LEAD` до першої півночі до останньої півночі. У цей час дії, що ведуть з трансляцій
 * («Підтримати», «Новорічний пас», «Увійти»), відкривають вікно на місці чату (телефон — шторку), а не сторінку.
 */
export function isCelebrating(now: Ms, data: Pick<Dataset, 'zones'>): boolean {
  if (!now || data.zones.length === 0) return false;
  let first = Infinity;
  let last = -Infinity;
  for (const z of data.zones) {
    if (z.midnightMs < first) first = z.midnightMs;
    if (z.midnightMs > last) last = z.midnightMs;
  }
  return now >= first - CELEBRATION_LEAD && now <= last;
}
