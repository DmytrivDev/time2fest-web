import { describe, expect, it } from 'vitest';
import type { FirstRowSeat } from '@/lib/data/types';
import { firstRowView, type FirstRowGuest } from '@/lib/engine/firstRowView';
import { event, LONDON_MIDNIGHT as T0, MIN, RIO_MIDNIGHT, SEC } from '../fixtures/data';

const london = event('london', T0, { firstRow: { saleEnabled: true } });
const NOW = T0 - 60 * MIN;
const guest = (over: Partial<FirstRowGuest> = {}): FirstRowGuest => ({ id: 'me', hasPass: false, ...over });

function seats(taken: number, opts: { heldBy?: string; heldUntil?: number; mine?: number } = {}): FirstRowSeat[] {
  return Array.from({ length: 10 }, (_, i) => {
    const number = i + 1;
    if (opts.mine === number) {
      return {
        eventId: london.id,
        number,
        state: 'taken',
        takenAt: 0,
        participant: { holderId: 'me', name: 'Я', flagCode: 'UA', greeting: 'Привіт', emojiId: 'e1' },
      };
    }
    if (number <= taken) {
      return {
        eventId: london.id,
        number,
        state: 'taken',
        takenAt: 0,
        participant: { holderId: `p${number}`, name: `P${number}`, flagCode: 'GB', greeting: '', emojiId: 'e2' },
      };
    }
    if (opts.heldBy && number === taken + 1) {
      return { eventId: london.id, number, state: 'held', until: opts.heldUntil ?? NOW + 5 * MIN, holderId: opts.heldBy };
    }
    return { eventId: london.id, number, state: 'free' };
  });
}

describe('firstRowView: лічильник і ціна', () => {
  it('усі 10 вільні → empty, $4,99', () => {
    const v = firstRowView(NOW, london, seats(0), guest());
    expect(v).toMatchObject({ state: 'empty', freeCount: 10, total: 10, price: { current: 4.99, full: 4.99 } });
  });

  it('лічильник — вільні місця; утримані — не вільні', () => {
    const v = firstRowView(NOW, london, seats(3, { heldBy: 'other' }), guest());
    expect(v.freeCount).toBe(6);
    expect(v.state).toBe('open');
  });

  it('вільних ≤ 3 → стан last3, але ціна та сама (одна ціна, рішення 2026-11-05)', () => {
    expect(firstRowView(NOW, london, seats(6), guest()).price).toEqual({ current: 4.99, full: 4.99 });
    const v = firstRowView(NOW, london, seats(7), guest());
    expect(v.state).toBe('last3');
    expect(v.freeCount).toBe(3);
    expect(v.price).toEqual({ current: 4.99, full: 4.99 });
    expect(firstRowView(NOW, london, seats(9), guest()).price.current).toBe(4.99);
  });

  it('ціна гостя з утриманням — та сама, що й для інших', () => {
    const s = seats(6, { heldBy: 'me', heldUntil: NOW + 8 * MIN });
    const v = firstRowView(NOW, london, s, guest({ hold: { seat: 7, until: NOW + 8 * MIN, extended: false } }));
    expect(v.freeCount).toBe(3);
    expect(v.price.current).toBe(4.99);
    expect(firstRowView(NOW, london, s, guest({ id: 'x' })).price.current).toBe(4.99);
  });

  it('ціна змінилася з часу відкриття форми (власник змінив ціну під час утримання)', () => {
    expect(firstRowView(NOW, london, seats(7), guest({ priceLocked: 4.99 })).priceChanged).toBeUndefined();
    const v = firstRowView(NOW, london, seats(7), guest({ priceLocked: 3.99 }));
    expect(v.priceChanged).toEqual({ from: 3.99, to: 4.99 });
  });

  it('знижка пасу −50%', () => {
    expect(firstRowView(NOW, london, seats(0), guest({ hasPass: true })).price).toMatchObject({
      current: 4.99,
      discountReason: 'pass',
      discounted: 2.49,
    });
  });

  it('soldout: без лічильника й ціни', () => {
    const v = firstRowView(NOW, london, seats(10), guest());
    expect(v.state).toBe('soldout');
    expect(v.freeCount).toBe(0);
    expect(v.price.current).toBeNull();
  });

  it('прострочене утримання — місце знову вільне', () => {
    const v = firstRowView(NOW, london, seats(3, { heldBy: 'other', heldUntil: NOW - 1 }), guest());
    expect(v.freeCount).toBe(7);
  });
});

describe('firstRowView: утримання 10 хв', () => {
  const hold = (remaining: number, extended = false) =>
    firstRowView(NOW, london, seats(2, { heldBy: 'me', heldUntil: NOW + remaining }), guest({ hold: { seat: 3, until: NOW + remaining, extended } })).hold!;

  it('warn5 і warn1', () => {
    expect(hold(6 * MIN)).toMatchObject({ remainingMs: 6 * MIN, warn5: false, warn1: false, canExtend: true });
    expect(hold(5 * MIN)).toMatchObject({ warn5: true, warn1: false });
    expect(hold(1 * MIN)).toMatchObject({ warn5: true, warn1: true });
  });

  it('продовжити можна один раз; «Ще 2 хвилини» з 2 хв', () => {
    expect(hold(3 * MIN).extendOffered).toBe(false);
    expect(hold(2 * MIN).extendOffered).toBe(true);
    expect(hold(2 * MIN, true)).toMatchObject({ canExtend: false, extendOffered: false });
  });

  it('після until — holdExpired, утримання немає', () => {
    const v = firstRowView(NOW, london, seats(2), guest({ hold: { seat: 3, until: NOW - SEC, extended: false } }));
    expect(v.hold).toBeUndefined();
    expect(v.holdExpired).toBe(true);
  });
});

describe('firstRowView: пріоритет станів', () => {
  it('restrained > mine > closed > soldout > last3 > open > empty', () => {
    const restrained = event('london', T0, { firstRow: { saleEnabled: true }, restrained: { note: { uk: 'Жалоба' } } });
    expect(firstRowView(NOW, restrained, seats(9, { mine: 10 }), guest()).state).toBe('restrained');
    const mine = firstRowView(T0 - 5 * MIN, london, seats(9, { mine: 10 }), guest());
    expect(mine.state).toBe('mine');
    expect(mine.mySeat).toEqual({ number: 10, emojiId: 'e1', greeting: 'Привіт' });
    expect(firstRowView(T0 - 5 * MIN, london, seats(10), guest()).state).toBe('closed');
  });

  it('продаж закрито за 5 хв до півночі (рішення 2026-10-31)', () => {
    expect(firstRowView(T0 - 5 * MIN - 1, london, seats(0), guest()).state).toBe('empty');
    const v = firstRowView(T0 - 5 * MIN, london, seats(0), guest());
    expect(v.state).toBe('closed');
    expect(v.saleClosesAt).toBe(T0 - 5 * MIN);
    expect(v.price.current).toBeNull();
  });

  it('до відкриття продажу (2026-12-01) — closed', () => {
    expect(firstRowView(Date.parse('2026-11-30T23:59:59Z'), london, seats(0), guest()).state).toBe('closed');
  });

  it('nextSale передається як є', () => {
    const v = firstRowView(T0 - 5 * MIN, london, seats(0), guest(), {
      nextSale: { eventId: 'evt_rio_2027', midnightUtc: new Date(RIO_MIDNIGHT).toISOString() },
    });
    expect(v.nextSale!.eventId).toBe('evt_rio_2027');
  });
});

describe('firstRowView: стіна', () => {
  it('idle → lighting → lit на «+15 с»', () => {
    expect(firstRowView(T0 + 14 * SEC, london, seats(5), guest()).wall).toEqual({ phase: 'idle', lightingFrom: T0 + 15 * SEC });
    expect(firstRowView(T0 + 15 * SEC, london, seats(5), guest()).wall.phase).toBe('lighting');
    expect(firstRowView(T0 + 25 * SEC, london, seats(5), guest()).wall.phase).toBe('lit');
  });

  it('під «зменшити рух» — одразу lit', () => {
    expect(firstRowView(T0 + 15 * SEC, london, seats(5), guest(), { reducedMotion: true }).wall.phase).toBe('lit');
  });
});
