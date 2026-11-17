/**
 * Правила, що розходяться з головним слотом ефіру (`currentSlotIndex` / `isZonePast`), під власними назвами.
 * Поведінку збережено як на master 3f2389f (рішення власника Q2); чи зводити їх до слота — Open question 1 специфікації SPEC-03.
 */
import { HANDOVER_AFTER, HOWTO_BEFORE } from './constants';
import type { MidnightLike, Ms } from './types';

/**
 * Пояс минув передачу: `now ≥ m + HANDOVER_AFTER` для будь-якого поясу, включно з останнім (на відміну від
 * `currentSlotIndex`, де останній слот тримається до кінця свята). Кімната й планувальник. Див. Open question 1 SPEC-03.
 */
export function zonePassedHandover(now: Ms, m: Ms): boolean {
  return now >= m + HANDOVER_AFTER;
}

/**
 * Пояс країни за замовчуванням: перший, для якого `m + HANDOVER_AFTER > now`; інакше останній (порожній список — `undefined`).
 * `zones` — за зростанням півночі. Межа +15 хв, як у `zonePassedHandover` — рішення власника 2026-11-17 (було +30 хв).
 */
export function defaultCountryZone<Z extends MidnightLike>(now: Ms, zones: readonly Z[]): Z | undefined {
  return zones.find((z) => z.midnightMs + HANDOVER_AFTER > now) ?? zones.at(-1);
}

/** Вікно нагадування про подію: `m − HOWTO_BEFORE ≤ now < m + HOWTO_BEFORE`. Див. Open question 1 SPEC-03. */
export function isInReminderWindow(now: Ms, m: Ms): boolean {
  return now >= m - HOWTO_BEFORE && now < m + HOWTO_BEFORE;
}
