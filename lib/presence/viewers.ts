/**
 * «Звідки дивляться» (C1 рядок 1 «Зараз дивляться люди з 140 країн», шар мапи «Звідки дивляться»).
 * Клікабельна версія: присутності ще немає, тож глядачі імітуються — найпопулярніші країни набору даних
 * (як на макетах `Main` / `Phone-Home-Live`: 140 країн). Справжнє джерело замінить цю функцію.
 */
import type { Dataset } from '@/lib/data/types';

export const SIMULATED_VIEWER_COUNTRIES = 140;

export interface ViewerCountry {
  iso: string;
  name: string;
  flagCode: string;
}

export function simulatedViewers(data: Dataset, count = SIMULATED_VIEWER_COUNTRIES): ViewerCountry[] {
  return [...data.countries]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, count)
    .map((c) => ({ iso: c.iso, name: c.name.uk, flagCode: c.flagCode }));
}
