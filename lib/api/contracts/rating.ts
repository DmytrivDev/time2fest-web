/**
 * Контракт домену «Рейтинг святкувань» (`docs/backend/frontend-seam.md`): голоси зберігає й рахує сервер (байєсове
 * середнє, місце); клієнт додає назви з каталогу (`lib/rating/rating.ts` → чиста частина) і свою оцінку оптимістично.
 * Імітація «оцінок світу» (`worldVotes`) — лише в `sim`.
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { Ms, Stars } from '@/lib/data/types';

export interface RatingAggregate {
  eventId: string;
  /** Середня R і кількість v (разом з оцінкою людини). */
  mean: number;
  votes: number;
  /** Зважена W — порахована сервером, щоб телефон і ТВ показували однакові місця. */
  score: number;
  place: number;
}

export interface RatingBoard {
  /** Святкування, відкриті для оцінки (північ +15 с минула), за місцем. */
  rows: readonly RatingAggregate[];
  totalVotes: number;
  closeAt: Ms;
  closed: boolean;
  /** Оцінки цієї людини. */
  mine: Readonly<Record<string, Stars>>;
}

/** Причини відмови `vote`: `no-stamp`, `closed`, `not-open` — як нижче; `not-rated` (`forbidden`) — подія не оцінюється. */
export type RatingVoteReason = 'no-stamp' | 'closed' | 'not-open' | 'not-rated';

/** Відмови `vote`: `forbidden` `no-stamp` (оцінює лише той, хто має штамп), `conflict` `closed` | `not-open`. */
export interface RatingService {
  /** `GET /api/rating` (CDN `s-maxage=15`, без `mine`) + `GET /api/me/rating-votes`. */
  board(): Promise<ApiResult<RatingBoard>>;
  /**
   * Realtime: `rating` — новий знімок рядів раз на 30–60 с (не на кожен голос). `mine` — лише в `sim` (оцінки людини
   * змінюються на пристрої поза адаптером); у `http` не передається — свої оцінки веде кеш хука.
   */
  subscribe(onRows: (rows: readonly RatingAggregate[], totalVotes: number, mine?: Readonly<Record<string, Stars>>) => void): Unsubscribe;
  /** `PUT /api/me/rating-votes/:eventId` `{ stars }` — повторна оцінка замінює попередню. */
  vote(eventId: string, stars: Stars): Promise<ApiResult<{ eventId: string; stars: Stars }>>;
}
