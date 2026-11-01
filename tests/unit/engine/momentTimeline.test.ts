import { describe, expect, it } from 'vitest';
import { momentStage, momentState, momentTimeline } from '@/lib/engine/momentTimeline';
import { event, LONDON_MIDNIGHT as T0, MIN, SEC } from '../fixtures/data';

const tl = momentTimeline(event('london', T0));

describe('momentTimeline', () => {
  it('моменти від півночі', () => {
    expect(tl).toEqual({
      eventId: 'evt_london_2027',
      t0: T0,
      howToFrom: T0 - 15 * MIN,
      stampAt: T0 + 15 * SEC,
      rateOpenAt: T0 + 5 * MIN,
      rateCloseAt: T0 + 8 * MIN,
      offerEarliestAt: T0 + 5 * MIN,
      handoverSoonAt: T0 + 14 * MIN,
      handoverAt: T0 + 15 * MIN,
    });
    expect(tl.rateCloseAt - tl.rateOpenAt).toBe(3 * MIN); // «+5 хв на 3 хв» (рішення 2026-11-01)
  });

  it.each([
    [-1, 'pre'],
    [0, 'awaiting-stamp'],
    [15 * SEC - 1, 'awaiting-stamp'],
    [15 * SEC, 'stamp'],
    [5 * MIN - 1, 'stamp'],
    [5 * MIN, 'rate'],
    [8 * MIN - 1, 'rate'],
    [8 * MIN, 'after-rate'],
  ])('стадія при t = %d → %s', (t, stage) => {
    expect(momentStage(T0 + t, tl)).toBe(stage);
  });

  it('rateMustStayOpen: поки гість взаємодіє, закриття відкладається (WCAG 2.2.1)', () => {
    const late = T0 + 9 * MIN;
    expect(momentState(late, tl)).toEqual({ stage: 'after-rate', rateMustStayOpen: false });
    expect(momentState(late, tl, { rateInteracting: true })).toEqual({ stage: 'rate', rateMustStayOpen: true });
    // взаємодія до відкриття нічого не змінює
    expect(momentState(T0 + 4 * MIN, tl, { rateInteracting: true })).toEqual({ stage: 'stamp', rateMustStayOpen: false });
    // у вікні оцінки взаємодія теж тримає картку
    expect(momentState(T0 + 6 * MIN, tl, { rateInteracting: true })).toEqual({ stage: 'rate', rateMustStayOpen: true });
  });

  it('після оцінки чи × картка не повертається', () => {
    expect(momentState(T0 + 6 * MIN, tl, { rateClosed: true }).stage).toBe('after-rate');
    expect(momentState(T0 + 6 * MIN, tl, { rateClosed: true, rateInteracting: true }).stage).toBe('after-rate');
  });
});
