/**
 * Логіка блоку «Коли Новий рік прийде до тебе?»: пошук країни, речення «раніше / після тебе», час, що лишився.
 * Без React і без Date.now(): усе залежить лише від аргументів.
 */
import type { MainCelebration, PrefestCountry } from './model';

export const MAX_COUNTRY_ROWS = 60;

/** Країни за запитом: спершу назви, що починаються з запиту, далі ті, що його містять; не більше `limit`. */
export function searchCountries(
  countries: readonly PrefestCountry[],
  query: string,
  limit: number = MAX_COUNTRY_ROWS,
): PrefestCountry[] {
  const q = query.trim().toLowerCase();
  if (!q) return countries.slice(0, limit);
  const starts: PrefestCountry[] = [];
  const contains: PrefestCountry[] = [];
  for (const c of countries) {
    const i = c.name.toLowerCase().indexOf(q);
    if (i === 0) starts.push(c);
    else if (i > 0) contains.push(c);
  }
  return [...starts, ...contains].slice(0, limit);
}

export type BeforePart =
  | { kind: 'first' }
  | { kind: 'named'; names: string }
  | { kind: 'namedMore'; names: string; count: number }
  | { kind: 'count'; count: number };

export type AfterPart =
  | { kind: 'last' }
  | { kind: 'named'; names: string }
  | { kind: 'namedMore'; names: string }
  | { kind: 'count'; count: number };

export interface Around {
  before: BeforePart;
  after: AfterPart;
}

function uniqueCities(list: readonly MainCelebration[]): string[] {
  return [...new Set(list.map((c) => c.city))];
}

/**
 * Речення під стрічкою: `index` — індекс пояса (0…total-1). Раніше — останні три міста з головних місць до пояса
 * (+ «та ще N поясів», якщо поясів раніше більше трьох); якщо міст немає — лише кількість; після — перші три міста.
 */
export function around(celebrations: readonly MainCelebration[], index: number, total: number): Around {
  const sorted = [...celebrations].sort((a, b) => a.zoneIndex - b.zoneIndex);
  const beforeCount = index;
  const afterCount = total - 1 - index;
  const bef = uniqueCities(sorted.filter((c) => c.zoneIndex < index));
  const aft = uniqueCities(sorted.filter((c) => c.zoneIndex > index));

  let before: BeforePart;
  if (!beforeCount) before = { kind: 'first' };
  else if (bef.length) {
    const names = bef.slice(-3).join(', ');
    const shown = Math.min(3, bef.length);
    before = beforeCount > 3 ? { kind: 'namedMore', names, count: beforeCount - shown } : { kind: 'named', names };
  } else before = { kind: 'count', count: beforeCount };

  let after: AfterPart;
  if (!afterCount) after = { kind: 'last' };
  else if (aft.length) {
    const names = aft.slice(0, 3).join(', ');
    after = aft.length > 3 ? { kind: 'namedMore', names } : { kind: 'named', names };
  } else after = { kind: 'count', count: afterCount };

  return { before, after };
}

/** Скільки лишилось до півночі: повних діб і годин; `over` — уже настала. */
export function timeLeft(midnightMs: number, nowMs: number): { days: number; hours: number; over: boolean } {
  const diff = midnightMs - nowMs;
  if (diff <= 0) return { days: 0, hours: 0, over: true };
  const s = Math.floor(diff / 1000);
  return { days: Math.floor(s / 86400), hours: Math.floor((s % 86400) / 3600), over: false };
}

/** Позиція центру сегмента на стрічці, %. */
export function segmentCenterPct(index: number, total: number): number {
  return ((index + 0.5) / total) * 100;
}

/** Орієнтир приглушено, якщо він у межах одного сегмента від твого пояса. */
export function landmarkDimmed(landmarkIndex: number, yourIndex: number): boolean {
  return Math.abs(landmarkIndex - yourIndex) < 2;
}
