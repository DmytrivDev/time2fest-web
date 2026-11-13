/** Шов: адаптер `sim` рейтингу — «сервер» оцінок над `guest.rate` і імітацією `worldVotes`. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSimRating, minesOf, setSimRatingNow, simAggregates } from '@/lib/api/sim/rating';
import { getData } from '@/lib/data/load';
import { RATING_OPEN_AFTER, ratingCloseAt } from '@/lib/rating/rating';
import { useGuestStore } from '@/stores/guest';

const data = getData();
const kyiv = data.events.find((e) => e.cityId === 'kyiv')!;
const AFTER_ALL = Math.max(...data.zones.map((z) => z.midnightMs)) + 60 * 60_000;

beforeEach(() => {
  useGuestStore.setState({ rate: {} });
  setSimRatingNow(0);
});

describe('sim-адаптер рейтингу', () => {
  it('board: до півночі +15 с — порожньо, після — з’являється святкування; закриття — за часом адмінки', async () => {
    const svc = createSimRating();
    setSimRatingNow(kyiv.midnightMs + RATING_OPEN_AFTER - 1);
    const before = await svc.board();
    expect(before.ok && before.value.rows.some((r) => r.eventId === kyiv.id)).toBe(false);
    setSimRatingNow(kyiv.midnightMs + RATING_OPEN_AFTER);
    const after = await svc.board();
    expect(after.ok && after.value.rows.some((r) => r.eventId === kyiv.id)).toBe(true);
    setSimRatingNow(ratingCloseAt(data));
    const closed = await svc.board();
    expect(closed.ok && closed.value.closed).toBe(true);
  });

  it('board: місця 1..N підряд, зважена оцінка спадає, свої оцінки — з guest.rate', async () => {
    useGuestStore.setState({ rate: { [kyiv.id]: { stars: 5, closed: false }, other: { closed: true } } });
    setSimRatingNow(AFTER_ALL);
    const res = await createSimRating().board();
    if (!res.ok) throw new Error('board');
    expect(res.value.rows.map((r) => r.place)).toEqual(res.value.rows.map((_, i) => i + 1));
    const scores = res.value.rows.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(res.value.mine).toEqual({ [kyiv.id]: 5 });
    expect(res.value.totalVotes).toBe(res.value.rows.reduce((n, r) => n + r.votes, 0));
  });

  it('vote пише в guest.rate (єдиний шлях запису) і зберігає «закрито»', async () => {
    useGuestStore.setState({ rate: { [kyiv.id]: { closed: true } } });
    const res = await createSimRating().vote(kyiv.id, 4);
    expect(res).toEqual({ ok: true, value: { eventId: kyiv.id, stars: 4 } });
    expect(useGuestStore.getState().rate[kyiv.id]).toEqual({ closed: true, stars: 4 });
  });

  it('subscribe: знімок на тик годинника й на зміну оцінок у сторі; відписка зупиняє', () => {
    const svc = createSimRating();
    const onUpdate = vi.fn();
    const off = svc.subscribe(onUpdate);
    setSimRatingNow(AFTER_ALL);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0]![2]).toEqual({});
    useGuestStore.getState().setRate(kyiv.id, { stars: 3 });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate.mock.calls[1]![2]).toEqual({ [kyiv.id]: 3 });
    off();
    setSimRatingNow(AFTER_ALL + 1000);
    useGuestStore.getState().setRate(kyiv.id, { stars: 1 });
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it('simAggregates: оцінка людини додається до оцінок світу', () => {
    const at = kyiv.midnightMs + 6 * 3_600_000;
    const without = simAggregates(data, at, {}).rows.find((r) => r.eventId === kyiv.id)!;
    const withOwn = simAggregates(data, at, { [kyiv.id]: 1 }).rows.find((r) => r.eventId === kyiv.id)!;
    expect(withOwn.votes).toBe(without.votes + 1);
    expect(withOwn.mean).toBeLessThan(without.mean);
  });

  it('minesOf лишає лише виставлені зірки', () => {
    expect(minesOf({ a: { stars: 2 }, b: {}, c: undefined })).toEqual({ a: 2 });
  });
});
