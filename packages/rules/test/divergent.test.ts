import { describe, expect, it } from 'vitest';
import {
  currentSlotIndex,
  defaultCountryZone,
  isInReminderWindow,
  zonePassedHandover,
} from '@time2fest/rules/time';

// Expected values are hard-coded from the master 3f2389f expressions:
// useRoomLiveStreams.ts:31 / engineScheduler.ts:108 — passed iff now >= m + 15 min;
// countryData.ts:54 — first zone with m + 30 min > now, else the last;
// NotificationsGenerator.tsx:84 — m − 15 min <= now < m + 15 min.
const MIN = 60_000;
const M = Date.parse('2027-01-01T00:00:00Z');

describe('AC-7 zonePassedHandover', () => {
  it('bound at m + 15 min', () => {
    expect(zonePassedHandover(M + 15 * MIN - 1, M)).toBe(false);
    expect(zonePassedHandover(M + 15 * MIN, M)).toBe(true);
    expect(zonePassedHandover(M + 15 * MIN + 1, M)).toBe(true);
  });
  it('the last zone at m + 16 min counts as passed while it stays the current slot', () => {
    const slots = [{ midnightMs: M - 60 * MIN }, { midnightMs: M }];
    const now = M + 16 * MIN;
    expect(zonePassedHandover(now, M)).toBe(true);
    expect(currentSlotIndex(now, slots)).toBe(1);
  });
});

describe('AC-7 defaultCountryZone', () => {
  const zones = [
    { id: 'a', midnightMs: M },
    { id: 'b', midnightMs: M + 60 * MIN },
  ];
  it('bound at m + 30 min of the first zone', () => {
    expect(defaultCountryZone(M + 30 * MIN - 1, zones)?.id).toBe('a');
    expect(defaultCountryZone(M + 30 * MIN, zones)?.id).toBe('b');
    expect(defaultCountryZone(M + 30 * MIN + 1, zones)?.id).toBe('b');
  });
  it('after every zone — the last one', () => {
    expect(defaultCountryZone(M + 90 * MIN - 1, zones)?.id).toBe('b');
    expect(defaultCountryZone(M + 90 * MIN, zones)?.id).toBe('b');
    expect(defaultCountryZone(M + 90 * MIN + 1, zones)?.id).toBe('b');
  });
  it('no zones — undefined', () => {
    expect(defaultCountryZone(M, [])).toBeUndefined();
  });
});

describe('AC-7 isInReminderWindow', () => {
  it('opens at m − 15 min (inclusive)', () => {
    expect(isInReminderWindow(M - 15 * MIN - 1, M)).toBe(false);
    expect(isInReminderWindow(M - 15 * MIN, M)).toBe(true);
    expect(isInReminderWindow(M - 15 * MIN + 1, M)).toBe(true);
  });
  it('closes at m + 15 min (exclusive)', () => {
    expect(isInReminderWindow(M + 15 * MIN - 1, M)).toBe(true);
    expect(isInReminderWindow(M + 15 * MIN, M)).toBe(false);
    expect(isInReminderWindow(M + 15 * MIN + 1, M)).toBe(false);
  });
});
