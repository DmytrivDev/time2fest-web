/**
 * Переважні кольори круглих прапорів (`public/flags/round`), згори вниз — як колір лежить на прапорі; до трьох,
 * кожен займає ≥ 6 % площі. Таблицю `colors.json` згенеровано з SVG (2026-11-01), для смужки штампа.
 */
import table from './colors.json';

const COLORS = table as Record<string, string[]>;

/** Майже білий (#eeeeee у пакеті прапорів) — справжній білий (правка власника 2026-11-01). */
const whiten = (c: string) => (/^#(e[d-f]|f[0-9a-f]){3}$/i.test(c) ? '#ffffff' : c);

export function flagColors(code: string): string[] {
  return (COLORS[code.toLowerCase()] ?? []).map(whiten);
}

/** Вертикальний градієнт смужки: кольори плавно переходять один в один. */
export function flagGradient(code: string): string | null {
  const cols = flagColors(code);
  if (!cols.length) return null;
  if (cols.length === 1) return cols[0]!;
  const n = cols.length;
  return `linear-gradient(180deg, ${cols.map((c, i) => `${c} ${Math.round(((i + 0.5) * 100) / n)}%`).join(', ')})`;
}
