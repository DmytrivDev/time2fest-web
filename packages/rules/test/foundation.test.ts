import { describe, expect, it } from 'vitest';
import {
  CATCH_UP_MAX_AGE_MS,
  CELEBRATION_LEAD,
  CELEBRATION_TAIL,
  DELAY_NOTICE_FROM,
  HANDOVER_AFTER,
  HOWTO_BEFORE,
  LAST_MINUTE_FROM,
  OFFER_MIN_AFTER,
  OFFER_MIN_BEFORE_NEXT,
  RATE_DURATION,
  RATE_OPEN_AFTER,
  RATING_CLOSE_AFTER,
  RATING_OPEN_AFTER,
  RECORDING_AFTER,
  SCHEDULE_CLOSE_MS,
  SERVER_CLOCK_TOLERANCE_MS,
  STAMP_DELAY,
  assertPulseInterval,
  assertTolerance,
} from '@time2fest/rules/time';

const MIN = 60_000;
const HOUR = 60 * MIN;

describe('constants equal master 3f2389f', () => {
  it('durations', () => {
    expect(HOWTO_BEFORE).toBe(15 * MIN);
    expect(STAMP_DELAY).toBe(15_000);
    expect(RATE_OPEN_AFTER).toBe(5 * MIN);
    expect(RATE_DURATION).toBe(3 * MIN);
    expect(OFFER_MIN_AFTER).toBe(5 * MIN);
    expect(OFFER_MIN_BEFORE_NEXT).toBe(10 * MIN);
    expect(HANDOVER_AFTER).toBe(15 * MIN);
    expect(LAST_MINUTE_FROM).toBe(14 * MIN);
    expect(RECORDING_AFTER).toBe(30 * MIN);
    expect(DELAY_NOTICE_FROM).toBe(5 * MIN);
    expect(CELEBRATION_LEAD).toBe(2 * HOUR);
    expect(CELEBRATION_TAIL).toBe(2 * HOUR);
    expect(RATING_OPEN_AFTER).toBe(15_000);
    expect(RATING_CLOSE_AFTER).toBe(12 * HOUR);
    expect(SCHEDULE_CLOSE_MS).toBe(2 * MIN);
    expect(CATCH_UP_MAX_AGE_MS).toBe(30 * MIN);
  });

  it('server clock tolerance is 1500 ms', () => {
    expect(SERVER_CLOCK_TOLERANCE_MS).toBe(1500);
  });
});

describe('AC-22 tolerance validation', () => {
  it('rejects a negative or non-finite delta', () => {
    expect(() => assertTolerance(-1)).toThrow(RangeError);
    expect(() => assertTolerance(Number.NaN)).toThrow(RangeError);
    expect(() => assertTolerance(Infinity)).toThrow(RangeError);
  });
  it('accepts 0 and positive finite deltas', () => {
    expect(() => assertTolerance(0)).not.toThrow();
    expect(() => assertTolerance(1500)).not.toThrow();
  });
  it('rejects a zero or infinite pulse interval', () => {
    expect(() => assertPulseInterval(0)).toThrow(RangeError);
    expect(() => assertPulseInterval(Infinity)).toThrow(RangeError);
    expect(() => assertPulseInterval(-5)).toThrow(RangeError);
    expect(() => assertPulseInterval(20_000)).not.toThrow();
  });
});
