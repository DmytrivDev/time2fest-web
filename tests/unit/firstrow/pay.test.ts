import { describe, expect, it } from 'vitest';
import type { FirstRowSeedEntry, GuestFirstRowEntry } from '@/lib/data/types';
import { HOLD_EXTENSION, HOLD_MS } from '@/lib/engine/config';
import { firstRowView, type FirstRowGuest } from '@/lib/engine/firstRowView';
import {
  changeEmoji,
  confirmPending,
  EMOJI_COOLDOWN_MS,
  emojiWaitSec,
  extendHold,
  settle,
  startHold,
  validateForm,
} from '@/lib/firstrow/pay';
import { firstFreeSeat, simulateSeats, ticketCode } from '@/lib/firstrow/seatsSim';
import { event, LONDON_MIDNIGHT as T0, MIN, SEC } from '../fixtures/data';

const NOW = T0 - 60 * MIN;
const held = (seat = 10, now = NOW): GuestFirstRowEntry => {
  const r = startHold({ draft: { name: 'Я', greeting: 'Привіт' } }, seat, now, 4.99);
  if (!r.ok) throw new Error('hold');
  return r.entry;
};

describe('startHold / переходи free → held → taken', () => {
  it('утримання на HOLD_MS (10 хв) з фіксованою ціною', () => {
    expect(HOLD_MS).toBe(10 * MIN);
    expect(held(10).hold).toEqual({ seat: 10, until: NOW + 10 * MIN, extended: false });
    expect(held(10).priceLocked).toBe(4.99);
  });

  it('відмова: has-seat (одне місце на гостя) і no-seat', () => {
    expect(startHold({ seat: 3 }, 5, NOW, 4.99)).toEqual({ ok: false, error: 'has-seat' });
    expect(startHold({}, undefined, NOW, 4.99)).toEqual({ ok: false, error: 'no-seat' });
  });

  it('held → taken через settle(success)', () => {
    const out = settle('success', held(10), { now: NOW + MIN });
    expect(out.phase).toBe('success');
    expect(out.entry.seat).toBe(10);
    expect(out.entry.hold).toBeUndefined();
    expect(out.entry.priceLocked).toBeUndefined();
  });

  it('прямого free → taken немає: success без утримання → expired, місця немає', () => {
    const out = settle('success', { draft: { name: 'Я', greeting: '' } }, { now: NOW });
    expect(out.phase).toBe('expired');
    expect(out.entry.seat).toBeUndefined();
  });
});

describe('settle', () => {
  const ctx = { now: NOW + MIN };
  it('pending і declined лишають утримання', () => {
    const e = held();
    for (const r of ['pending', 'declined'] as const) {
      const out = settle(r, e, ctx);
      expect(out.phase).toBe(r);
      expect(out.entry.hold).toEqual(e.hold);
      expect(out.entry.seat).toBeUndefined();
    }
  });

  it('soldout і expired знімають утримання, але лишають draft', () => {
    for (const r of ['soldout', 'expired'] as const) {
      const out = settle(r, held(), ctx);
      expect(out.phase).toBe(r);
      expect(out.entry.hold).toBeUndefined();
      expect(out.entry.priceLocked).toBeUndefined();
      expect(out.entry.draft).toEqual({ name: 'Я', greeting: 'Привіт' });
    }
  });

  it('holdLost → soldout', () => {
    const out = settle('success', held(), { ...ctx, holdLost: true });
    expect(out.phase).toBe('soldout');
    expect(out.entry.seat).toBeUndefined();
  });

  it('success з простроченим утриманням → expired', () => {
    const out = settle('success', held(), { now: NOW + HOLD_MS + 1 });
    expect(out.phase).toBe('expired');
    expect(out.entry.hold).toBeUndefined();
  });

  it('місце вже є → success без змін', () => {
    const e: GuestFirstRowEntry = { seat: 4 };
    for (const r of ['success', 'declined', 'soldout', 'expired', 'pending'] as const) {
      expect(settle(r, e, ctx)).toEqual({ phase: 'success', entry: e });
    }
  });
});

describe('extendHold', () => {
  it('один раз: +5 хв і extended', () => {
    const e = held();
    const once = extendHold(e, NOW + 8 * MIN);
    expect(once.hold).toEqual({ seat: 10, until: NOW + HOLD_MS + HOLD_EXTENSION, extended: true });
    expect(extendHold(once, NOW + 9 * MIN)).toBe(once);
  });
  it('після завершення утримання продовжити не можна', () => {
    const e = held();
    expect(extendHold(e, NOW + HOLD_MS)).toBe(e);
    expect(extendHold(e, NOW + HOLD_MS + SEC)).toBe(e);
  });
});

describe('confirmPending', () => {
  it('видає місце, навіть якщо утримання щойно минуло', () => {
    const out = confirmPending(held(), { now: NOW + HOLD_MS + 5 * SEC });
    expect(out.phase).toBe('success');
    expect(out.entry.seat).toBe(10);
    expect(out.entry.hold).toBeUndefined();
  });
  it('holdLost або немає утримання → soldout; місце вже є → success', () => {
    expect(confirmPending(held(), { now: NOW, holdLost: true }).phase).toBe('soldout');
    expect(confirmPending({}, { now: NOW }).phase).toBe('soldout');
    expect(confirmPending({ seat: 2 }, { now: NOW })).toEqual({ phase: 'success', entry: { seat: 2 } });
  });
});

describe('changeEmoji / emojiWaitSec', () => {
  it('перша зміна дозволена; протягом 10 с — null; через 10 с знову можна', () => {
    expect(EMOJI_COOLDOWN_MS).toBe(10 * SEC);
    const e: GuestFirstRowEntry = { seat: 1, draft: { name: 'Я', greeting: '' } };
    const first = changeEmoji(e, 'star', NOW, null);
    expect(first?.draft).toEqual({ name: 'Я', greeting: '', emojiId: 'star' });
    expect(emojiWaitSec(NOW, NOW + 3 * SEC)).toBe(7);
    expect(changeEmoji(first!, 'heart', NOW + 3 * SEC, NOW)).toBeNull();
    expect(changeEmoji(first!, 'heart', NOW + 10 * SEC - 1, NOW)).toBeNull();
    expect(emojiWaitSec(NOW, NOW + 10 * SEC)).toBe(0);
    expect(changeEmoji(first!, 'heart', NOW + 10 * SEC, NOW)?.draft?.emojiId).toBe('heart');
  });
  it('без draft створює порожній', () => {
    expect(changeEmoji({}, 'star', NOW, undefined)?.draft).toEqual({ name: '', greeting: '', emojiId: 'star' });
  });
});

describe('validateForm', () => {
  const ok = { email: 'a@b.co', name: 'Мирон', greeting: 'З Новим роком!' };
  it('коректна форма без помилок', () => expect(validateForm(ok)).toEqual({}));
  it('некоректний email', () => {
    expect(validateForm({ ...ok, email: 'nope' }).email).toBe('email');
    expect(validateForm({ ...ok, email: 'a@b' }).email).toBe('email');
  });
  it('ім’я — від 2 до 20 символів', () => {
    expect(validateForm({ ...ok, name: '   ' }).name).toBe('name');
    expect(validateForm({ ...ok, name: 'а' }).name).toBe('name');
    expect(validateForm({ ...ok, name: ' а ' }).name).toBe('name');
    expect(validateForm({ ...ok, name: 'аб' }).name).toBeUndefined();
    expect(validateForm({ ...ok, name: 'а'.repeat(21) }).name).toBe('name');
    expect(validateForm({ ...ok, name: 'а'.repeat(20) }).name).toBeUndefined();
  });
  it('привітання з посиланням або задовге → moderation', () => {
    expect(validateForm({ ...ok, greeting: 'зайди на https://x.io' }).greeting).toBe('moderation');
    expect(validateForm({ ...ok, greeting: 'www.spam.example' }).greeting).toBe('moderation');
    expect(validateForm({ ...ok, greeting: 'a'.repeat(85) }).greeting).toBe('moderation');
    expect(validateForm({ ...ok, greeting: 'a'.repeat(84) }).greeting).toBeUndefined();
  });
});

// ── Симуляція місць ───────────────────────────────────────────────────────

const SIM = T0 - 3 * 60 * MIN;
const taken = (n: number) => ({ number: n, state: 'taken' as const, name: `P${n}`, flagCode: 'GB', takenAtOffsetSec: -100 });
const seedOf = (
  takenCount: number,
  extra: FirstRowSeedEntry['seats'] = [],
  takeOverTime?: FirstRowSeedEntry['takeOverTime'],
): FirstRowSeedEntry => ({
  eventId: 'evt_london_2027',
  seats: [...Array.from({ length: takenCount }, (_, i) => taken(i + 1)), ...extra],
  ...(takeOverTime ? { takeOverTime } : {}),
});
const guest = (entry?: GuestFirstRowEntry) => ({ id: 'me', nick: 'Мирон', flagCode: 'UA', entry });
const stateOf = (seats: { number: number; state: string }[], n: number) => seats.find((s) => s.number === n)!.state;

describe('simulateSeats', () => {
  it('без сида — 10 вільних', () => {
    const { seats, holdLost } = simulateSeats(undefined, 'evt_x', SIM, SIM, guest());
    expect(seats).toHaveLength(10);
    expect(seats.every((s) => s.state === 'free')).toBe(true);
    expect(holdLost).toBe(false);
  });

  it('сид: takenAt і held відносно simStart; held після until → free', () => {
    const seed = seedOf(2, [{ number: 8, state: 'held', heldUntilOffsetSec: 240 }]);
    const early = simulateSeats(seed, 'e', SIM, SIM + 100 * SEC, guest()).seats;
    expect(early[0]).toMatchObject({ state: 'taken', takenAt: SIM - 100 * SEC });
    expect(early[7]).toMatchObject({ state: 'held', until: SIM + 240 * SEC });
    const late = simulateSeats(seed, 'e', SIM, SIM + 240 * SEC, guest()).seats;
    expect(stateOf(late, 8)).toBe('free');
  });

  it('entry.seat → taken з isMine і holderId = guest.id', () => {
    const { seats } = simulateSeats(
      seedOf(0),
      'e',
      SIM,
      SIM,
      guest({ seat: 5, draft: { name: 'Я', greeting: 'Hi', emojiId: 'star' } }),
    );
    expect(seats[4]).toMatchObject({
      state: 'taken',
      participant: { holderId: 'me', isMine: true, name: 'Я', greeting: 'Hi', emojiId: 'star', flagCode: 'UA' },
    });
  });

  it('активне утримання гостя → held by guest', () => {
    const { seats } = simulateSeats(seedOf(0), 'e', SIM, NOW, guest({ hold: { seat: 3, until: NOW + MIN, extended: false } }));
    expect(seats[2]).toMatchObject({ state: 'held', holderId: 'me', until: NOW + MIN });
    const expired = simulateSeats(seedOf(0), 'e', SIM, NOW, guest({ hold: { seat: 3, until: NOW - 1, extended: false } }));
    expect(stateOf(expired.seats, 3)).toBe('free');
  });

  it('takeOverTime займає місце у simStart + offset', () => {
    const seed = seedOf(9, [], [{ number: 10, atOffsetFromNowSec: 90 }]);
    const before = simulateSeats(seed, 'e', SIM, SIM + 89 * SEC, guest()).seats;
    expect(stateOf(before, 10)).toBe('free');
    const after = simulateSeats(seed, 'e', SIM, SIM + 90 * SEC, guest()).seats;
    expect(after[9]).toMatchObject({ state: 'taken', takenAt: SIM + 90 * SEC });
  });

  it('takeover місця, яке утримує гість: учасник бере інше вільне', () => {
    const seed = seedOf(7, [], [{ number: 9, atOffsetFromNowSec: 10 }]); // вільні 8, 9, 10
    const g = guest({ hold: { seat: 9, until: SIM + 600 * SEC, extended: false } });
    const r = simulateSeats(seed, 'e', SIM, SIM + 20 * SEC, g);
    expect(r.holdLost).toBe(false);
    expect(stateOf(r.seats, 9)).toBe('held');
    expect(stateOf(r.seats, 8)).toBe('taken');
  });

  it('takeover місця гостя без інших вільних → holdLost', () => {
    const seed = seedOf(9, [], [{ number: 10, atOffsetFromNowSec: 90 }]);
    const g = guest({ hold: { seat: 10, until: SIM + 600 * SEC, extended: false } });
    expect(simulateSeats(seed, 'e', SIM, SIM + 60 * SEC, g).holdLost).toBe(false);
    const r = simulateSeats(seed, 'e', SIM, SIM + 91 * SEC, g);
    expect(r.holdLost).toBe(true);
    expect(stateOf(r.seats, 10)).toBe('taken');
  });

  it('firstFreeSeat і ticketCode', () => {
    const { seats } = simulateSeats(seedOf(3, [{ number: 4, state: 'held', heldUntilOffsetSec: 100 }]), 'e', SIM, SIM, guest());
    expect(firstFreeSeat(seats, SIM)).toBe(5);
    expect(firstFreeSeat(seats, SIM + 100 * SEC)).toBe(4);
    expect(firstFreeSeat(simulateSeats(seedOf(10), 'e', SIM, SIM, guest()).seats, SIM)).toBeUndefined();
    expect(ticketCode('london', 4)).toBe('LON-04');
    expect(ticketCode('12', 10)).toBe('T2F-10');
  });
});

describe('ціна через firstRowView на симульованих місцях', () => {
  const london = event('london', T0, { firstRow: { saleEnabled: true } });
  const fg = (over: Partial<FirstRowGuest> = {}): FirstRowGuest => ({ id: 'me', hasPass: false, ...over });
  const view = (takenCount: number, entry: GuestFirstRowEntry | undefined, now = NOW, g: Partial<FirstRowGuest> = {}) => {
    const { seats } = simulateSeats(seedOf(takenCount), london.id, SIM, now, guest(entry));
    return firstRowView(now, london, seats, fg({ ...entry, ...g }));
  };

  it('≥4 вільних → $4,99; ≤3 → $7,99', () => {
    expect(view(6, undefined).price.current).toBe(4.99);
    expect(view(6, undefined).freeCount).toBe(4);
    expect(view(7, undefined).price.current).toBe(7.99);
  });

  it('власне утримання: ціна від free + 1', () => {
    const entry = { hold: { seat: 7, until: NOW + 5 * MIN, extended: false } };
    const v = view(6, entry);
    expect(v.freeCount).toBe(3);
    expect(v.price.current).toBe(4.99);
  });

  it('priceLocked 4.99 при поточній 7.99 → priceChanged', () => {
    const v = view(8, undefined, NOW, { priceLocked: 4.99 });
    expect(v.price.current).toBe(7.99);
    expect(v.priceChanged).toEqual({ from: 4.99, to: 7.99 });
  });

  it('за 15 хв до півночі — closed, ціни немає', () => {
    const v = view(3, undefined, T0 - 15 * MIN);
    expect(v.state).toBe('closed');
    expect(v.price.current).toBeNull();
    expect(view(3, undefined, T0 - 15 * MIN - 1).state).toBe('open');
  });
});
