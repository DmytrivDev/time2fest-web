'use client';

/**
 * Хуки домену «Рейтинг святкувань» (`docs/backend/frontend-seam.md`). Одна дошка (`RatingBoard`) — один ресурс кешу:
 * агрегати сервера (місце, середня, зважена) і оцінки людини (`mine`). Ряди для сторінок складає чиста
 * `buildRatingState` з каталогу, агрегатів і часу сайту `now` (`ahead` і `closed` залежать лише від часу).
 * Голос — оптимістично: `mine` змінюється одразу, сервіс підтверджує; на відмову — перечитуємо дошку.
 */
import { useMemo } from 'react';
import type { RatingAggregate, RatingBoard } from '../contracts/rating';
import { createResource, useResource, type ResourceStatus } from '../resource';
import { getService } from '../services';
import { getData } from '@/lib/data/load';
import type { Ms, Stars } from '@/lib/data/types';
import { buildRatingState, type RatingState } from '@/lib/rating/rating';

interface RatingEvent {
  rows: readonly RatingAggregate[];
  totalVotes: number;
  mine?: Readonly<Record<string, Stars>>;
}

const NO_MINE: Readonly<Record<string, Stars>> = {};
const NO_ROWS: readonly RatingAggregate[] = [];

function sameRows(a: readonly RatingAggregate[], b: readonly RatingAggregate[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i]!;
    return x.eventId === y.eventId && x.mean === y.mean && x.votes === y.votes && x.score === y.score && x.place === y.place;
  });
}

function sameMine(a: Readonly<Record<string, Stars>>, b: Readonly<Record<string, Stars>>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

export const ratingBoard = createResource<RatingBoard, RatingEvent>(() => {
  const svc = getService('rating');
  return {
    load: () => svc.board(),
    subscribe: (cb) => svc.subscribe((rows, totalVotes, mine) => cb({ rows, totalVotes, mine })),
    reduce: (board, e) => {
      const mine = e.mine ?? board.mine;
      // Знімок без змін (щосекунди) — той самий об’єкт: ресурс не сповіщає споживачів.
      if (sameRows(board.rows, e.rows) && board.totalVotes === e.totalVotes && sameMine(board.mine, mine)) return board;
      return { ...board, rows: e.rows, totalVotes: e.totalVotes, mine };
    },
  };
});

export interface RatingView {
  status: ResourceStatus;
  /** До завантаження — без рядів (дивись `status`); `ahead` і `closed` — з часу `now`. */
  state: RatingState;
}

/** Рейтинг святкувань на момент `now` (час сайту; кожна сторінка округляє по-своєму: секунда чи хвилина). */
export function useRatingBoard(now: Ms): RatingView {
  const st = useResource(ratingBoard);
  const board = st.data;
  const state = useMemo(
    () => buildRatingState(getData(), now, { rows: board?.rows ?? NO_ROWS, totalVotes: board?.totalVotes ?? 0, mine: board?.mine ?? NO_MINE }),
    [board, now],
  );
  return { status: st.status, state };
}

/** Усі оцінки людини: `eventId → зірки`. До завантаження — порожньо. */
export function useMyVotes(): Readonly<Record<string, Stars>> {
  return useResource(ratingBoard).data?.mine ?? NO_MINE;
}

/** Оцінка людини для одного святкування; `undefined` — не оцінювала (або ще не завантажено). */
export function useMyVote(eventId: string | undefined): Stars | undefined {
  const mine = useMyVotes();
  return eventId ? mine[eventId] : undefined;
}

async function vote(eventId: string, stars: Stars): Promise<void> {
  ratingBoard.mutate((b) => ({ ...b, mine: { ...b.mine, [eventId]: stars } }));
  const res = await getService('rating').vote(eventId, stars);
  // Відмова — правда у сервера. Дошку ніхто не читав (немає кешу) — теж читаємо, щоб оцінка не загубилась.
  if (!res.ok || ratingBoard.getSnapshot().status !== 'ready') {
    await ratingBoard.refresh();
    return;
  }
  // Дошка могла завантажитись між голосом і відповіддю, зі станом до голосу (подію до завантаження кеш відкидає).
  if (ratingBoard.getSnapshot().data?.mine[eventId] !== stars) ratingBoard.mutate((b) => ({ ...b, mine: { ...b.mine, [eventId]: stars } }));
}

/** Дії з оцінками (стала функція — можна передавати в обробники без `useCallback`). */
export const ratingActions = { vote } as const;
