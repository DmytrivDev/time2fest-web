/**
 * «Звідки дивляться» (C1 рядок 1 «Зараз дивляться люди з N країн»).
 * Справжньої присутності ще немає, тож глядачі імітуються — найпопулярніші країни набору даних (як на макетах
 * `Main` / `Phone-Home-Live`: 140 країн). Чесне число (рішення власника 2026-11-12): імітація — лише в тестовій і
 * демо-збірці (`IS_TEST_BUILD`, та сама межа, що в імітованих тостів); у робочій збірці без справжніх даних — порожньо,
 * і рядок «Зараз дивляться люди з …» не показується. Справжнє джерело замінить `currentViewers`.
 */
import type { ViewerCountry } from '@time2fest/contracts';
import type { Dataset } from '@/lib/data/types';
import { IS_TEST_BUILD } from '@/lib/env';

export type { ViewerCountry };

export const SIMULATED_VIEWER_COUNTRIES = 140;

/** Демо-число людей на сайті (рядок «Зараз на Time2Fest {count} людей», [А22], AC-67) — лише за `SIMULATED_PRESENCE`. */
export const SIMULATED_PEOPLE = 12_480;

/** Чи можна показувати імітовану присутність (лише тестова й демо-збірка). */
export const SIMULATED_PRESENCE = IS_TEST_BUILD;

export function simulatedViewers(data: Dataset, count = SIMULATED_VIEWER_COUNTRIES): ViewerCountry[] {
  return [...data.countries]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, count)
    .map((c) => ({ iso: c.iso, name: c.name.uk, flagCode: c.flagCode }));
}

/** Країни глядачів для рядка «Зараз дивляться»: імітація в тестовій і демо-збірці, у робочій — порожньо. */
export function currentViewers(data: Dataset): ViewerCountry[] {
  return SIMULATED_PRESENCE ? simulatedViewers(data) : [];
}
