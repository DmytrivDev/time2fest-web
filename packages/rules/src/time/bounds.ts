import {
  CATCH_UP_MAX_AGE_MS,
  OFFER_MIN_AFTER,
  OFFER_MIN_BEFORE_NEXT,
  RATING_CLOSE_AFTER,
  RATING_OPEN_AFTER,
  SCHEDULE_CLOSE_MS,
} from './constants';
import { assertTolerance } from './tolerance';
import type { Ms, ZonesLike } from './types';

/** Коли закривається оцінювання: 12 год після останньої півночі свята (порожній каталог — `-Infinity`, як на master). */
export function ratingCloseAt(data: ZonesLike): Ms {
  return Math.max(...data.zones.map((z) => z.midnightMs)) + RATING_CLOSE_AFTER;
}

/** Подія відкрита для оцінки з `m + 15 с`; Δ відкриває раніше. */
export function isRatingOpenFor(now: Ms, m: Ms, delta = 0): boolean {
  assertTolerance(delta);
  return now >= m + RATING_OPEN_AFTER - delta;
}

/** Оцінювання закрите з `ratingCloseAt`; Δ закриває пізніше. */
export function isRatingClosed(now: Ms, data: ZonesLike, delta = 0): boolean {
  assertTolerance(delta);
  return now >= ratingCloseAt(data) + delta;
}

/** Пропозиції не раніше `m + OFFER_MIN_AFTER`. */
export function offerEarliestAt(m: Ms): Ms {
  return m + OFFER_MIN_AFTER;
}

/** До наступної півночі лишилося менше `OFFER_MIN_BEFORE_NEXT`. */
export function isTooCloseToNextForOffer(now: Ms, nextM: Ms): boolean {
  return nextM - now < OFFER_MIN_BEFORE_NEXT;
}

/** Розклад (нагадування) закрито за `SCHEDULE_CLOSE_MS` до півночі. */
export function isScheduleClosed(now: Ms, m: Ms): boolean {
  return m - now < SCHEDULE_CLOSE_MS;
}

/** Штамп надто старий для святкування навздогін. */
export function isStampTooOldToCelebrate(now: Ms, grantedAt: Ms): boolean {
  return now - grantedAt > CATCH_UP_MAX_AGE_MS;
}
