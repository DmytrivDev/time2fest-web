/**
 * Шов: хуки рейтингу над підміненим сервісом. Перевіряємо: завантаження й ряди з агрегатів і каталогу, realtime-знімок,
 * оптимістичний голос, відмову (перечитування), кеш між монтуваннями, незмінний знімок не будить споживачів.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RatingAggregate, RatingBoard, RatingService } from '@/lib/api/contracts/rating';
import { ratingActions, useMyVote, useMyVotes, useRatingBoard } from '@/lib/api/hooks/rating';
import { fail, ok } from '@/lib/api/result';
import { setServicesForTest } from '@/lib/api/services';
import { getData } from '@/lib/data/load';
import type { Stars } from '@/lib/data/types';
import { RATING_OPEN_AFTER } from '@time2fest/rules/time';

const data = getData();
const kyiv = data.events.find((e) => e.cityId === 'kyiv')!;
const london = data.events.find((e) => e.cityId === 'london')!;
const NOW = Math.max(...data.zones.map((z) => z.midnightMs)) + 60_000;

const agg = (eventId: string, place: number, score: number): RatingAggregate => ({ eventId, place, score, mean: score, votes: 10 });

function fakeService(initial: RatingBoard) {
  const board = initial;
  type Cb = Parameters<RatingService['subscribe']>[0];
  const listeners = new Set<Cb>();
  const svc: RatingService = {
    board: vi.fn(async () => ok(board)),
    subscribe: vi.fn((cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    vote: vi.fn(async (eventId, stars) => ok({ eventId, stars })),
  };
  return {
    svc,
    listeners,
    emit: (rows: readonly RatingAggregate[], total: number, mine?: Record<string, Stars>) => listeners.forEach((l) => l(rows, total, mine)),
  };
}

const BOARD: RatingBoard = { rows: [agg(london.id, 1, 4.8), agg(kyiv.id, 2, 4.5)], totalVotes: 20, closeAt: NOW + 1, closed: false, mine: {} };

let restore: () => void = () => undefined;
afterEach(() => restore());

describe('useRatingBoard', () => {
  let fake: ReturnType<typeof fakeService>;
  beforeEach(() => {
    fake = fakeService(BOARD);
    restore = setServicesForTest({ rating: fake.svc });
  });

  it('idle → ready: ряди з агрегатів сервера й каталогу (місто, посилання), «ще попереду» — за часом', async () => {
    const { result } = renderHook(() => useRatingBoard(NOW));
    expect(result.current.status).not.toBe('ready');
    expect(result.current.state.rows).toEqual([]);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const { rows, totalVotes, closed, ahead } = result.current.state;
    expect(rows.map((r) => [r.eventId, r.place])).toEqual([
      [london.id, 1],
      [kyiv.id, 2],
    ]);
    expect(rows[0]!.city).toBe(data.citiesById.get(london.cityId)!.name.uk);
    expect(rows[0]!.href).toMatch(/^\//);
    expect(totalVotes).toBe(20);
    expect(closed).toBe(false);
    expect(ahead).toEqual([]);
    expect(fake.svc.board).toHaveBeenCalledTimes(1);
  });

  it('ahead і closed залежать лише від часу сайту', async () => {
    const early = kyiv.midnightMs + RATING_OPEN_AFTER - 1;
    const { result, rerender } = renderHook(({ now }) => useRatingBoard(now), { initialProps: { now: early } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.state.ahead.some((a) => a.eventId === kyiv.id)).toBe(true);
    rerender({ now: result.current.state.closeAt });
    expect(result.current.state.closed).toBe(true);
  });

  it('realtime: знімок змінює ряди; однаковий знімок не перерендерює', async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useRatingBoard(NOW);
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = renders;
    act(() => fake.emit([agg(london.id, 1, 4.8), agg(kyiv.id, 2, 4.5)], 20));
    expect(renders).toBe(before);
    act(() => fake.emit([agg(kyiv.id, 1, 4.9), agg(london.id, 2, 4.8)], 21));
    expect(result.current.state.rows.map((r) => r.eventId)).toEqual([kyiv.id, london.id]);
    expect(result.current.state.totalVotes).toBe(21);
  });
});

describe('голоси', () => {
  let fake: ReturnType<typeof fakeService>;
  beforeEach(() => {
    fake = fakeService({ ...BOARD, mine: { [london.id]: 5 } });
    restore = setServicesForTest({ rating: fake.svc });
  });

  it('useMyVotes / useMyVote читають оцінки людини з тієї ж дошки; один запит на кілька хуків', async () => {
    const { result } = renderHook(() => ({ all: useMyVotes(), one: useMyVote(london.id), none: useMyVote(kyiv.id), board: useRatingBoard(NOW) }));
    expect(result.current.one).toBeUndefined();
    await waitFor(() => expect(result.current.one).toBe(5));
    expect(result.current.all).toEqual({ [london.id]: 5 });
    expect(result.current.none).toBeUndefined();
    expect(result.current.board.state.rows.find((r) => r.eventId === london.id)?.mine).toBe(5);
    expect(fake.svc.board).toHaveBeenCalledTimes(1);
    expect(fake.svc.subscribe).toHaveBeenCalledTimes(1);
  });

  it('vote: оптимістично змінює mine до відповіді сервісу й викликає сервіс', async () => {
    let release!: () => void;
    (fake.svc.vote as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (eventId: string, stars: number) => new Promise((res) => (release = () => res(ok({ eventId, stars })))),
    );
    const { result } = renderHook(() => ({ mine: useMyVote(kyiv.id), all: useMyVotes() }));
    await waitFor(() => expect(result.current.all).toEqual({ [london.id]: 5 }));
    let done!: Promise<boolean>;
    act(() => {
      done = ratingActions.vote(kyiv.id, 3);
    });
    expect(result.current.mine).toBe(3);
    expect(fake.svc.vote).toHaveBeenCalledWith(kyiv.id, 3);
    await act(async () => {
      release();
      await done;
    });
    expect(result.current.mine).toBe(3);
    expect(fake.svc.board).toHaveBeenCalledTimes(1);
  });

  it('відмова голосу: перечитуємо дошку (правда — у сервера)', async () => {
    (fake.svc.vote as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fail('conflict', { reason: 'closed' }));
    const { result } = renderHook(() => ({ mine: useMyVote(kyiv.id), all: useMyVotes() }));
    await waitFor(() => expect(result.current.all).toEqual({ [london.id]: 5 }));
    await act(async () => {
      await ratingActions.vote(kyiv.id, 2);
    });
    expect(fake.svc.board).toHaveBeenCalledTimes(2);
    expect(result.current.mine).toBeUndefined();
  });

  it('оцінки з realtime-знімка (інший пристрій, стор) потрапляють у mine', async () => {
    const { result } = renderHook(() => ({ mine: useMyVote(kyiv.id), all: useMyVotes() }));
    await waitFor(() => expect(result.current.all).toEqual({ [london.id]: 5 }));
    act(() => fake.emit(BOARD.rows, 20, { [kyiv.id]: 4 }));
    expect(result.current.mine).toBe(4);
  });

  it('голос до завершення першого завантаження не губиться (дошка прийшла без нього)', async () => {
    const { result } = renderHook(() => useMyVote(kyiv.id));
    await act(async () => {
      await ratingActions.vote(kyiv.id, 4);
    });
    expect(result.current).toBe(4);
  });

  it('кеш живе між монтуваннями: другий хук бачить дані одразу', async () => {
    const first = renderHook(() => useMyVotes());
    await waitFor(() => expect(first.result.current).toEqual({ [london.id]: 5 }));
    first.unmount();
    expect(fake.listeners.size).toBe(0);
    const second = renderHook(() => useMyVotes());
    expect(second.result.current).toEqual({ [london.id]: 5 });
  });
});
