import { describe, expect, it } from 'vitest';
import { FIRSTROW_SALE_OPEN, HANDOVER_AFTER } from '@/lib/engine/config';
import { isRoomOpen, pickSeatRoomEvent, roomWindow, seatConflict } from '@/lib/firstrow/rooms';

const H = 3_600_000;
const T0 = Date.parse('2026-12-31T10:00:00Z');
const ev = (id: string, hours: number, cityId = id, countryIso = id.toUpperCase()) => ({ id, cityId, countryIso, midnightMs: T0 + hours * H });
const events = [ev('a', 0), ev('b', 1), ev('b2', 1, 'b2', 'B2'), ev('c', 3), ev('d', 4)];

describe('roomWindow / isRoomOpen', () => {
  it('відкривається через 15 хв після попередньої різної півночі, до кінця ночі', () => {
    const w = roomWindow(events, events[3]!);
    expect(w.opensAt).toBe(T0 + 1 * H + HANDOVER_AFTER);
    expect(w.closesAt).toBe(T0 + 4 * H + HANDOVER_AFTER);
    expect(isRoomOpen(events, events[3]!, w.opensAt - 1)).toBe(false);
    expect(isRoomOpen(events, events[3]!, w.opensAt)).toBe(true);
    expect(isRoomOpen(events, events[3]!, T0 + 3 * H + 2 * H)).toBe(false);
  });
  it('перша подія ночі — з відкриття продажу', () => {
    expect(roomWindow(events, events[0]!).opensAt).toBe(FIRSTROW_SALE_OPEN);
  });
  it('події однієї півночі мають спільне вікно', () => {
    expect(roomWindow(events, events[1]!)).toEqual(roomWindow(events, events[2]!));
  });
});

describe('pickSeatRoomEvent', () => {
  const seats = { c: { seat: 2 }, d: { seat: 5 }, a: {} };
  it('кілька відкритих — найближча майбутня північ', () => {
    expect(pickSeatRoomEvent(events, seats, T0 + 3 * H - 60_000)?.id).toBe('c');
    expect(pickSeatRoomEvent(events, seats, T0 + 3 * H + 20 * 60_000)?.id).toBe('d');
  });
  it('майбутніх немає — найновіша; кімната закрита — null', () => {
    expect(pickSeatRoomEvent(events, { c: { seat: 1 } }, T0 + 3 * H + 5 * 60_000)?.id).toBe('c');
    expect(pickSeatRoomEvent(events, { c: { seat: 1 } }, T0)).toBeNull();
    expect(pickSeatRoomEvent(events, { a: {} }, T0)).toBeNull();
  });
});

describe('seatConflict', () => {
  const now = T0;
  it('той самий пояс (північ), інша країна й місто', () => {
    expect(seatConflict(events, { b: { seat: 3 } }, events[2]!, now)?.id).toBe('b');
  });
  it('та сама країна, інший пояс', () => {
    const e = [ev('x1', 0, 'x1', 'XX'), ev('x2', 5, 'x2', 'XX')];
    expect(seatConflict(e, { x1: { seat: 1 } }, e[1]!, now)?.id).toBe('x1');
  });
  it('те саме місто', () => {
    const e = [ev('y1', 0, 'cityY', 'Y1'), ev('y2', 6, 'cityY', 'Y2')];
    expect(seatConflict(e, { y1: { seat: 1 } }, e[1]!, now)?.id).toBe('y1');
  });
  it('діюче утримання блокує, прострочене — ні; інший пояс, країна й місто — можна', () => {
    expect(seatConflict(events, { b: { hold: { seat: 1, until: now + 1000, extended: false } } }, events[2]!, now)?.id).toBe('b');
    expect(seatConflict(events, { b: { hold: { seat: 1, until: now - 1, extended: false } } }, events[2]!, now)).toBeNull();
    expect(seatConflict(events, { a: { seat: 1 } }, events[3]!, now)).toBeNull();
    expect(seatConflict(events, { c: { seat: 1 } }, events[3]!, now)).toBeNull();
  });
});
