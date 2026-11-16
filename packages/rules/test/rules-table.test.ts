import { describe, expect, it } from 'vitest';
import {
  CELEBRATION_TAIL,
  CATCH_UP_MAX_AGE_MS,
  HANDOVER_AFTER,
  OFFER_MIN_AFTER,
  OFFER_MIN_BEFORE_NEXT,
  RATING_CLOSE_AFTER,
  RATING_OPEN_AFTER,
  RECORDING_AFTER,
  SCHEDULE_CLOSE_MS,
  currentSlotIndex,
  eventStatus,
  handoverMoment,
  isRatingClosed,
  isRatingOpenFor,
  isScheduleClosed,
  isStampTooOldToCelebrate,
  isTooCloseToNextForOffer,
  isZonePast,
  momentTimeline,
  nextMidnightAfter,
  offerEarliestAt,
  pinnedUntilAt,
  prevMidnightAtOrBefore,
  ratingCloseAt,
  zoneState,
} from '../src/time';

const MIN = 60_000;
const M = Date.parse('2027-01-01T00:00:00Z');
const ev = { id: 'e', midnightUtc: '2027-01-01T00:00:00Z' };

describe('AC-13 event status', () => {
  it.each([
    [-15 * MIN - 1, 'soon'],
    [-15 * MIN, 'live'],
    [HANDOVER_AFTER - 1, 'live'],
    [HANDOVER_AFTER, 'ended'],
    [RECORDING_AFTER - 1, 'ended'],
    [RECORDING_AFTER, 'recording'],
    [RECORDING_AFTER + 1, 'recording'],
  ] as const)('offset %i ms is %s', (off, status) => {
    expect(eventStatus(M + off, ev)).toBe(status);
  });
  it('handover moment is m + 15 min', () => {
    expect(handoverMoment(M)).toBe(M + 15 * MIN);
  });
});

describe('AC-14 moment timeline', () => {
  it('has the documented points', () => {
    const tl = momentTimeline(ev);
    expect(tl).toMatchObject({
      t0: M,
      howToFrom: M - 15 * MIN,
      stampAt: M + 15_000,
      rateOpenAt: M + 5 * MIN,
      rateCloseAt: M + 8 * MIN,
      offerEarliestAt: M + 5 * MIN,
      handoverSoonAt: M + 14 * MIN,
      handoverAt: M + 15 * MIN,
    });
  });
});

describe('AC-15 current slot', () => {
  const slots = [{ midnightMs: M - HANDOVER_AFTER }, { midnightMs: M }];
  it('the second-to-last slot is not current at m + 15 min, current 1 ms earlier', () => {
    const prev = slots[0]!.midnightMs;
    expect(currentSlotIndex(prev + HANDOVER_AFTER - 1, slots)).toBe(0);
    expect(currentSlotIndex(prev + HANDOVER_AFTER, slots)).toBe(1);
  });
  it('the last slot is current at m + 2 h, none at + 1 ms', () => {
    expect(currentSlotIndex(M + CELEBRATION_TAIL, slots)).toBe(1);
    expect(currentSlotIndex(M + CELEBRATION_TAIL + 1, slots)).toBe(-1);
  });
});

describe('AC-16 zone state', () => {
  const zones = [{ midnightMs: M }, { midnightMs: M + 60 * MIN }, { midnightMs: M + 120 * MIN }];
  it('past from m + 15 min', () => {
    expect(isZonePast(M + HANDOVER_AFTER - 1, M)).toBe(false);
    expect(isZonePast(M + HANDOVER_AFTER, M)).toBe(true);
    expect(zoneState(M + HANDOVER_AFTER - 1, zones[0]!, zones)).toBe('live');
    expect(zoneState(M + HANDOVER_AFTER, zones[0]!, zones)).toBe('past');
  });
  it('live, next, future', () => {
    expect(zoneState(M, zones[0]!, zones)).toBe('live');
    expect(zoneState(M, zones[1]!, zones)).toBe('next');
    expect(zoneState(M, zones[2]!, zones)).toBe('future');
  });
});

describe('AC-17 pins', () => {
  const mids = [M, M + 60 * MIN];
  it('created exactly at midnight pins to the next midnight (EC-1)', () => {
    expect(pinnedUntilAt(M, mids)).toBe(M + 60 * MIN);
  });
  it('created after the last midnight pins to the end of the festival', () => {
    expect(pinnedUntilAt(M + 61 * MIN, mids)).toBe(M + 60 * MIN + CELEBRATION_TAIL);
    expect(pinnedUntilAt(M + 60 * MIN + CELEBRATION_TAIL - 1, mids)).toBe(M + 60 * MIN + CELEBRATION_TAIL);
  });
  it('created exactly at the end of the festival or later is null (EC-2)', () => {
    expect(pinnedUntilAt(M + 60 * MIN + CELEBRATION_TAIL, mids)).toBeNull();
    expect(pinnedUntilAt(M + 60 * MIN + CELEBRATION_TAIL + 1, mids)).toBeNull();
    expect(pinnedUntilAt(M, [])).toBeNull();
  });
  it('next and previous midnight', () => {
    expect(nextMidnightAfter(M, mids)).toBe(M + 60 * MIN);
    expect(nextMidnightAfter(M + 60 * MIN, mids)).toBeNull();
    expect(prevMidnightAtOrBefore(M, mids)).toBe(M);
    expect(prevMidnightAtOrBefore(M - 1, mids)).toBeNull();
  });
});

describe('AC-18 rating opens', () => {
  it('Δ = 0 edge', () => {
    expect(isRatingOpenFor(M + RATING_OPEN_AFTER - 1, M)).toBe(false);
    expect(isRatingOpenFor(M + RATING_OPEN_AFTER, M)).toBe(true);
    expect(isRatingOpenFor(M + RATING_OPEN_AFTER + 1, M)).toBe(true);
  });
  it('Δ opens earlier', () => {
    expect(isRatingOpenFor(M + RATING_OPEN_AFTER - 1500, M, 1500)).toBe(true);
    expect(isRatingOpenFor(M + RATING_OPEN_AFTER - 1501, M, 1500)).toBe(false);
  });
});

describe('AC-19 rating closes', () => {
  const data = { zones: [{ midnightMs: M - 60 * MIN }, { midnightMs: M }] };
  it('closed at last + 12 h', () => {
    expect(ratingCloseAt(data)).toBe(M + RATING_CLOSE_AFTER);
    expect(isRatingClosed(M + RATING_CLOSE_AFTER - 1, data)).toBe(false);
    expect(isRatingClosed(M + RATING_CLOSE_AFTER, data)).toBe(true);
    expect(isRatingClosed(M + RATING_CLOSE_AFTER + 1, data)).toBe(true);
  });
  it('Δ closes later', () => {
    expect(isRatingClosed(M + RATING_CLOSE_AFTER + 1499, data, 1500)).toBe(false);
    expect(isRatingClosed(M + RATING_CLOSE_AFTER + 1500, data, 1500)).toBe(true);
  });
  it('empty catalogue behaves as on master', () => {
    expect(ratingCloseAt({ zones: [] })).toBe(-Infinity);
    expect(isRatingClosed(M, { zones: [] })).toBe(true);
  });
});

describe('offer, schedule and catch-up bounds', () => {
  it('offer earliest is m + 5 min', () => {
    expect(offerEarliestAt(M)).toBe(M + OFFER_MIN_AFTER);
  });
  it('too close to next: strict 10 min', () => {
    const next = M + 60 * MIN;
    expect(isTooCloseToNextForOffer(next - OFFER_MIN_BEFORE_NEXT - 1, next)).toBe(false);
    expect(isTooCloseToNextForOffer(next - OFFER_MIN_BEFORE_NEXT, next)).toBe(false);
    expect(isTooCloseToNextForOffer(next - OFFER_MIN_BEFORE_NEXT + 1, next)).toBe(true);
  });
  it('schedule closes strictly inside 2 min', () => {
    expect(isScheduleClosed(M - SCHEDULE_CLOSE_MS - 1, M)).toBe(false);
    expect(isScheduleClosed(M - SCHEDULE_CLOSE_MS, M)).toBe(false);
    expect(isScheduleClosed(M - SCHEDULE_CLOSE_MS + 1, M)).toBe(true);
  });
  it('stamp too old strictly after 30 min', () => {
    expect(isStampTooOldToCelebrate(M + CATCH_UP_MAX_AGE_MS - 1, M)).toBe(false);
    expect(isStampTooOldToCelebrate(M + CATCH_UP_MAX_AGE_MS, M)).toBe(false);
    expect(isStampTooOldToCelebrate(M + CATCH_UP_MAX_AGE_MS + 1, M)).toBe(true);
  });
});
