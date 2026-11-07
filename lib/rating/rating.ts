/**
 * «Рейтинг святкувань» (рішення власника 2026-11-07, концепція `rating-concept-2026-11-07.md`, дошки `Desk-Rating-New`
 * v2): один рейтинг — за зірками; у ньому головні святкування (`isRateable`), північ яких уже минула.
 *
 * Місце визначає зважена оцінка (байєсове середнє, як IMDb Top 250): `W = (v·R + m·C) / (v + m)`, де R — середня
 * оцінка святкування, v — кількість оцінок, C — середня всіх святкувань, m — «довіра» (адмінка, 200). Святкування з
 * кількома оцінками тягнеться до загальної середньої й не обганяє те, що оцінили тисячі.
 *
 * Спільного бекенду на прототипі немає — «оцінки світу» імітуємо (як чат): стала середня й кількість для кожної події за
 * її популярністю, кількість росте перші 3 год після півночі; оцінка самої людини додається до них.
 * Оцінювання закривається через 12 год після останнього Нового року (адмінка).
 */
import type { Dataset, Ms, Stars } from '@/lib/data/types';
import { isRateable } from '@/lib/passport/passport';

/** «Довіра» m у формулі (адмінка). */
export const RATING_TRUST = 200;
/** Скільки після останнього Нового року ще можна оцінювати (адмінка). */
export const RATING_CLOSE_AFTER: Ms = 12 * 60 * 60_000;
/**
 * Святкування з’являється в рейтингу одразу зі штампом — через 15 с після півночі (власник 2026-11-07: «щойно переглянув
 * Лондон — а в рейтингу його немає»). Оцінок спершу мало, тож воно стоїть біля загальної середньої й піднімається чи
 * опускається, поки оцінок більшає.
 */
export const RATING_OPEN_AFTER: Ms = 15_000;
const GROW: Ms = 3 * 60 * 60_000;

export interface RatingRow {
  eventId: string;
  city: string;
  countryIso: string;
  flagCode: string;
  href: string;
  /** Середня оцінка R і кількість оцінок v (разом з оцінкою людини). */
  mean: number;
  votes: number;
  /** Зважена оцінка W — за нею місце. */
  score: number;
  place: number;
  /** Оцінка людини; `undefined` — не оцінювала. */
  mine?: Stars;
}

export interface RatingAhead {
  eventId: string;
  city: string;
  flagCode: string;
  midnightMs: Ms;
}

export interface RatingState {
  rows: RatingRow[];
  ahead: RatingAhead[];
  totalVotes: number;
  closeAt: Ms;
  closed: boolean;
}

/** Стабільне псевдовипадкове число 0–1 з рядка (імітатор). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

/** Імітовані «оцінки світу» події на момент `now`: середня й кількість. */
export function worldVotes(eventId: string, popularity: number, midnightMs: Ms, now: Ms): { mean: number; votes: number } {
  const r = hash01(eventId);
  const mean = Math.round((3.9 + r * 0.9 + (popularity - 60) / 200) * 100) / 100;
  const full = Math.round(popularity * popularity * (1.2 + r * 1.6));
  const share = Math.min(1, Math.max(0, (now - midnightMs) / GROW));
  return { mean: Math.min(5, Math.max(1, mean)), votes: Math.round(full * share) };
}

/** Порядковий числівник для «6-те місце»: 1-ше, 2-ге, 3-тє, 7-ме, 40-ве, 11-те… */
export function ukOrdinal(n: number): string {
  const two = n % 100;
  const one = n % 10;
  if (two >= 10 && two < 20) return `${n}-те`;
  if (one === 0) return two === 40 ? `${n}-ве` : `${n}-те`;
  return `${n}-${['', 'ше', 'ге', 'тє', 'те', 'те', 'те', 'ме', 'ме', 'те'][one]}`;
}

export function weighted(mean: number, votes: number, globalMean: number, m = RATING_TRUST): number {
  return (votes * mean + m * globalMean) / (votes + m);
}

/** Коли закривається оцінювання: 12 год після останньої півночі свята. */
export function ratingCloseAt(data: Dataset): Ms {
  return Math.max(...data.zones.map((z) => z.midnightMs)) + RATING_CLOSE_AFTER;
}

export function ratingState(data: Dataset, now: Ms, mine: Readonly<Record<string, { stars?: Stars } | undefined>>): RatingState {
  const events = data.events.filter((e) => isRateable(data, e.id));
  const open = events.filter((e) => now >= e.midnightMs + RATING_OPEN_AFTER);
  const base = open.map((e) => {
    const w = worldVotes(e.id, e.popularity, e.midnightMs, now);
    const own = mine[e.id]?.stars;
    const votes = w.votes + (own ? 1 : 0);
    const mean = votes ? (w.mean * w.votes + (own ?? 0)) / votes : w.mean;
    const country = data.countriesByIso.get(e.countryIso);
    return {
      eventId: e.id,
      city: data.citiesById.get(e.cityId)?.name.uk ?? e.id,
      countryIso: e.countryIso,
      flagCode: country?.flagCode ?? e.countryIso,
      href: country ? `/country/${country.slug}/` : '/',
      mean,
      votes,
      ...(own ? { mine: own } : {}),
    };
  });
  const globalMean = base.length ? base.reduce((n, r) => n + r.mean, 0) / base.length : 4.3;
  const rows: RatingRow[] = base
    .map((r) => ({ ...r, score: weighted(r.mean, r.votes, globalMean), place: 0 }))
    .sort((a, b) => b.score - a.score || b.votes - a.votes)
    .map((r, i) => ({ ...r, place: i + 1 }));
  const ahead = events
    .filter((e) => now < e.midnightMs + RATING_OPEN_AFTER)
    .sort((a, b) => a.midnightMs - b.midnightMs)
    .map((e) => ({
      eventId: e.id,
      city: data.citiesById.get(e.cityId)?.name.uk ?? e.id,
      flagCode: data.countriesByIso.get(e.countryIso)?.flagCode ?? e.countryIso,
      midnightMs: e.midnightMs,
    }));
  const closeAt = ratingCloseAt(data);
  return { rows, ahead, totalVotes: rows.reduce((n, r) => n + r.votes, 0), closeAt, closed: now >= closeAt };
}
