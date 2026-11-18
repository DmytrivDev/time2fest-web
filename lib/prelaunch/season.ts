/**
 * Рік сезону — одна змінна для текстів і метаданих (рішення власника 2026-11-18, звіт SEO, розділ 3): «2027» не
 * вписуємо в рядки. 1 лютого 2027 перемикається на 2028 (і сезон — на «2027/28»).
 */
export const SEASON_YEAR = 2027;
export const SEASON_LABEL = `${SEASON_YEAR - 1}/${String(SEASON_YEAR).slice(2)}`;

/** Підстановки сезону для `t()`: `{year}`, `{season}`. */
export const SEASON_VALUES = { year: String(SEASON_YEAR), season: SEASON_LABEL } as const;
