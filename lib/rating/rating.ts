/**
 * «Рейтинг святкувань» (рішення власника 2026-11-07, концепція `rating-concept-2026-11-07.md`, дошки `Desk-Rating-New`
 * v2): один рейтинг — за зірками; у ньому головні святкування (`isRateable`), північ яких уже минула.
 *
 * Місце визначає зважена оцінка (байєсове середнє, як IMDb Top 250): `W = (v·R + m·C) / (v + m)`, де R — середня
 * оцінка святкування, v — кількість оцінок, C — середня всіх святкувань, m — «довіра» (адмінка, 200). Святкування з
 * кількома оцінками тягнеться до загальної середньої й не обганяє те, що оцінили тисячі.
 *
 * Тут лише чиста частина: формула, ряди з агрегатів сервера (`buildRatingState`), порядковий числівник. Агрегати
 * («оцінки світу») дає сервіс `rating` (`lib/api/contracts/rating.ts`); у прототипі їх імітує `lib/api/sim/rating.ts`.
 * Оцінювання закривається через 12 год після останнього Нового року (адмінка).
 */
import type { RatingAggregate } from '@/lib/api/contracts/rating';
import type { Dataset, Ms, Stars } from '@/lib/data/types';
import { isRateable } from '@/lib/passport/passport';
import { countryHref } from '@/lib/live/countryHref';

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

/** Що дає сервіс рейтингу для побудови рядів (`RatingBoard` без часу закриття). */
export interface RatingAggregates {
  rows: readonly RatingAggregate[];
  totalVotes: number;
  mine: Readonly<Record<string, Stars>>;
}

/**
 * Ряди рейтингу з агрегатів сервера й каталогу: назви, прапори, посилання — з каталогу; місце, середню й зважену оцінку
 * дає сервер. `ahead` («ще попереду») і `closed` залежать лише від часу сайту `now`.
 */
export function buildRatingState(data: Dataset, now: Ms, agg: RatingAggregates): RatingState {
  const rows: RatingRow[] = [...agg.rows]
    .sort((a, b) => a.place - b.place)
    .map((r) => {
      const e = data.eventsById.get(r.eventId);
      const country = e ? data.countriesByIso.get(e.countryIso) : undefined;
      const own = agg.mine[r.eventId];
      return {
        eventId: r.eventId,
        city: e ? (data.citiesById.get(e.cityId)?.name.uk ?? e.id) : r.eventId,
        countryIso: e?.countryIso ?? '',
        flagCode: country?.flagCode ?? e?.countryIso ?? '',
        href: country && e ? countryHref(country, { eventId: e.id }) : '/',
        mean: r.mean,
        votes: r.votes,
        score: r.score,
        place: r.place,
        ...(own ? { mine: own } : {}),
      };
    });
  const ahead = data.events
    .filter((e) => isRateable(data, e.id) && now < e.midnightMs + RATING_OPEN_AFTER)
    .sort((a, b) => a.midnightMs - b.midnightMs)
    .map((e) => ({
      eventId: e.id,
      city: data.citiesById.get(e.cityId)?.name.uk ?? e.id,
      flagCode: data.countriesByIso.get(e.countryIso)?.flagCode ?? e.countryIso,
      midnightMs: e.midnightMs,
    }));
  const closeAt = ratingCloseAt(data);
  return { rows, ahead, totalVotes: agg.totalVotes, closeAt, closed: now >= closeAt };
}
