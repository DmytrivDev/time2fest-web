// «Рейтинг святкувань» (рішення власника 2026-11-07): зважена оцінка замість порогу «мало оцінок», закриття через 12 год
// після останнього Нового року, у рейтингу — лише головні святкування після своєї півночі, оцінка людини враховується.
import { describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import { isRateable } from '@/lib/passport/passport';
import { ratingState, worldVotes } from '@/lib/api/sim/rating';
import { buildRatingState, ukOrdinal, weighted } from '@/lib/rating/rating';
import { RATING_CLOSE_AFTER, RATING_OPEN_AFTER, ratingCloseAt } from '@time2fest/rules/time';

const data = getData();
const ev = (cityId: string) => data.events.find((e) => e.cityId === cityId)!;
const AFTER_ALL = Math.max(...data.zones.map((z) => z.midnightMs)) + 60 * 60_000;

describe('рейтинг святкувань', () => {
  it('формула: багато оцінок тримають середню, кілька — тягнуться до загальної', () => {
    expect(weighted(4.8, 18_420, 4.3)).toBeCloseTo(4.795, 2);
    expect(weighted(4.9, 14, 4.3)).toBeCloseTo(4.34, 2);
    // 4,9 від чотирнадцяти людей не обганяє 4,7 від тисяч.
    expect(weighted(4.9, 14, 4.3)).toBeLessThan(weighted(4.7, 9_870, 4.3));
  });

  it('закривається через 12 год після останньої півночі', () => {
    const last = Math.max(...data.zones.map((z) => z.midnightMs));
    expect(ratingCloseAt(data)).toBe(last + RATING_CLOSE_AFTER);
    expect(ratingState(data, last + RATING_CLOSE_AFTER - 1, {}).closed).toBe(false);
    expect(ratingState(data, last + RATING_CLOSE_AFTER, {}).closed).toBe(true);
  });

  it('у рейтингу — лише головні святкування, північ яких минула (+15 с, разом зі штампом); решта — «Ще попереду»', () => {
    const kyiv = ev('kyiv');
    const before = ratingState(data, kyiv.midnightMs + RATING_OPEN_AFTER - 1, {});
    expect(before.rows.some((r) => r.eventId === kyiv.id)).toBe(false);
    expect(before.ahead.some((a) => a.eventId === kyiv.id)).toBe(true);
    const after = ratingState(data, kyiv.midnightMs + RATING_OPEN_AFTER, {});
    expect(after.rows.some((r) => r.eventId === kyiv.id)).toBe(true);
    const all = ratingState(data, AFTER_ALL, {});
    expect(all.ahead).toHaveLength(0);
    expect(all.rows.every((r) => isRateable(data, r.eventId))).toBe(true);
    expect(all.rows.some((r) => r.eventId === ev('london').id)).toBe(true); // головне святкування з вебкамерою
    expect(all.rows.some((r) => r.eventId === ev('kiritimati').id)).toBe(false); // лише відлік
  });

  it('місця йдуть за зваженою оцінкою, 1…N без пропусків', () => {
    const { rows } = ratingState(data, AFTER_ALL, {});
    expect(rows.length).toBeGreaterThan(3);
    rows.forEach((r, i) => {
      expect(r.place).toBe(i + 1);
      if (i) expect(r.score).toBeLessThanOrEqual(rows[i - 1]!.score);
    });
  });

  it('оцінка людини додається до оцінок світу й позначається як «твоя»', () => {
    const kyiv = ev('kyiv');
    const at = kyiv.midnightMs + RATING_OPEN_AFTER;
    const world = worldVotes(kyiv.id, kyiv.popularity, kyiv.midnightMs, at);
    const row = ratingState(data, at, { [kyiv.id]: { stars: 1 } }).rows.find((r) => r.eventId === kyiv.id)!;
    expect(row.mine).toBe(1);
    expect(row.votes).toBe(world.votes + 1);
    expect(row.mean).toBeLessThan(world.mean);
  });

  it('оцінки світу ростуть перші 3 год після півночі й стабільні між викликами', () => {
    const e = ev('kyiv');
    const a = worldVotes(e.id, e.popularity, e.midnightMs, e.midnightMs + 30 * 60_000);
    const b = worldVotes(e.id, e.popularity, e.midnightMs, e.midnightMs + 3 * 60 * 60_000);
    expect(a.votes).toBeLessThan(b.votes);
    expect(worldVotes(e.id, e.popularity, e.midnightMs, e.midnightMs + 5 * 60 * 60_000)).toEqual(b);
    expect(a.mean).toBe(b.mean);
  });

  it('buildRatingState: ряди з агрегатів сервера (порядок за місцем, «твоя» з mine), чужі й невідомі події не падають', () => {
    const kyiv = ev('kyiv');
    const london = ev('london');
    const agg = {
      rows: [
        { eventId: kyiv.id, mean: 4.2, votes: 5, score: 4.1, place: 2 },
        { eventId: london.id, mean: 4.8, votes: 9, score: 4.6, place: 1 },
      ],
      totalVotes: 14,
      mine: { [kyiv.id]: 3 as const },
    };
    const st = buildRatingState(data, AFTER_ALL, agg);
    expect(st.rows.map((r) => [r.eventId, r.place, r.mine])).toEqual([[london.id, 1, undefined], [kyiv.id, 2, 3]]);
    expect(st.totalVotes).toBe(14);
    expect(st.closed).toBe(false);
    expect(st.ahead).toHaveLength(0);
    expect(buildRatingState(data, 0, { rows: [], totalVotes: 0, mine: {} }).ahead.length).toBeGreaterThan(0);
  });

  it('«6-те місце»: порядкові числівники', () => {
    expect([1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 21, 23, 40, 42].map(ukOrdinal)).toEqual([
      '1-ше', '2-ге', '3-тє', '4-те', '6-те', '7-ме', '8-ме', '9-те', '10-те', '11-те', '13-те', '21-ше', '23-тє', '40-ве', '42-ге',
    ]);
  });
});
