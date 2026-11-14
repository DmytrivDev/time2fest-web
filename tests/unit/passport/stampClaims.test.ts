/**
 * Штамп, якого сервер не підтвердив (стан шва №14, 2026-11-14): показуємо одразу; підтвердження повторюємо у фоні з
 * наростаючою паузою; за хвилину без підтвердження — «непідтверджений» (тихий рядок), повтори тривають; мережа штампа
 * не забирає, явна відмова сервера — знімає; список переживає перезавантаження.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fail, ok, type ApiResult } from '@/lib/api/result';
import type { Stamp } from '@/lib/data/types';
import { claimDelay, createStampClaimer, retryableClaimError, UNCONFIRMED_AFTER_MS, type PendingClaim } from '@/lib/passport/stampClaims';

const T0 = Date.UTC(2027, 0, 1, 0, 0, 15);
const STAMP: Stamp = { eventId: 'evt_london_2027', grantedAt: T0, presenceSource: 'air', illustrationId: 'gb', cityName: 'Лондон', countryIso: 'GB' };

function setup(answers: (() => ApiResult<unknown>)[], saved: PendingClaim[] = []) {
  let stored: readonly PendingClaim[] = saved;
  const claim = vi.fn(async () => (answers.shift() ?? (() => ok(STAMP)))());
  const claimer = createStampClaimer({
    claim,
    now: () => Date.now(),
    load: () => stored.map((p) => ({ ...p })),
    save: (l) => {
      stored = l.map((p) => ({ ...p }));
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  });
  return { claimer, claim, stored: () => stored };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => vi.useRealTimers());

describe('пауза між спробами', () => {
  it('2 → 4 → 8 → 15 → 30 с, далі щопівхвилини', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(claimDelay)).toEqual([2_000, 4_000, 8_000, 15_000, 30_000, 30_000, 30_000]);
  });
  it('повторюємо лише мережу, недоступність, ліміт, невідоме', () => {
    expect(retryableClaimError({ code: 'network' })).toBe(true);
    expect(retryableClaimError({ code: 'unavailable' })).toBe(true);
    expect(retryableClaimError({ code: 'rate_limited' })).toBe(true);
    expect(retryableClaimError({ code: 'forbidden' })).toBe(false);
    expect(retryableClaimError({ code: 'validation' })).toBe(false);
  });
});

describe('createStampClaimer', () => {
  it('сервер підтвердив з першого разу — штамп більше не чекає', async () => {
    const { claimer, claim, stored } = setup([]);
    expect(claimer.add(STAMP)).toBe(true);
    expect(claimer.snapshot().pending).toHaveLength(1);
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    expect(claimer.snapshot().pending).toEqual([]);
    expect(stored()).toEqual([]);
  });

  it('мережа: штамп лишається, повтори з паузою; за хвилину — «непідтверджений»; підтвердження прибирає рядок', async () => {
    const net = () => fail('network');
    const { claimer, claim } = setup([net, net, net, net, net, net]);
    claimer.add(STAMP);
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(claim).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(claim).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(claim).toHaveBeenCalledTimes(4);
    expect(claimer.snapshot().unconfirmed).toEqual([]);
    // 14 с минуло; до хвилини — ще 46 с: спроба на 29-й (15 с) і на 59-й (30 с).
    await vi.advanceTimersByTimeAsync(UNCONFIRMED_AFTER_MS - 14_000);
    expect(claimer.snapshot().unconfirmed).toEqual([STAMP.eventId]);
    expect(claimer.snapshot().pending.map((p) => p.stamp)).toEqual([STAMP]);
    expect(claim).toHaveBeenCalledTimes(6);
    // Наступна спроба (30 с) — успішна: рядок зникає.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(claim).toHaveBeenCalledTimes(7);
    expect(claimer.snapshot()).toEqual({ pending: [], unconfirmed: [] });
  });

  it('з’явилась мережа — пробуємо одразу, не чекаючи паузи', async () => {
    const { claimer, claim } = setup([() => fail('network')]);
    claimer.add(STAMP);
    await flush();
    claimer.retryNow();
    await flush();
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claimer.snapshot().pending).toEqual([]);
  });

  it('явна відмова сервера («присутності не було») — штамп знімається; мережа — ніколи', async () => {
    const { claimer } = setup([() => fail('forbidden', { reason: 'no-presence' })]);
    claimer.add(STAMP);
    await flush();
    expect(claimer.snapshot().pending).toEqual([]);
  });

  it('наступне відкриття сайту: список зі сховища, «непідтверджений» одразу, якщо хвилина вже минула; повтор — одразу', async () => {
    const saved: PendingClaim[] = [{ stamp: STAMP, since: T0 - 5 * 60_000, attempts: 9 }];
    const { claimer, claim } = setup([() => fail('network')], saved);
    claimer.resume();
    expect(claimer.snapshot().unconfirmed).toEqual([STAMP.eventId]);
    await flush();
    expect(claim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claimer.snapshot().pending).toEqual([]);
  });

  it('той самий штамп удруге не додається; подія сервера `granted` прибирає очікування', async () => {
    const { claimer } = setup([() => fail('network')]);
    expect(claimer.add(STAMP)).toBe(true);
    expect(claimer.add(STAMP)).toBe(false);
    await flush();
    claimer.confirmed(STAMP.eventId);
    expect(claimer.snapshot().pending).toEqual([]);
  });
});
