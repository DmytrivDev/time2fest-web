import { describe, expect, it } from 'vitest';
import { arrivedYear, canSayToast, isCelebrating, toastSeason, toastsOpenAt } from '@time2fest/rules/time';

const H = 3_600_000;
const first = Date.UTC(2026, 11, 31, 10, 0, 0);
const last = Date.UTC(2027, 0, 1, 12, 0, 0);
const data = { zones: [{ midnightMs: last }, { midnightMs: first }, { midnightMs: first + 5 * H }] };
const empty = { zones: [] };

describe('AC-11 isCelebrating boundaries', () => {
  it('four points', () => {
    expect(isCelebrating(first - 2 * H - 1, data)).toBe(false);
    expect(isCelebrating(first - 2 * H, data)).toBe(true);
    expect(isCelebrating(last + 2 * H, data)).toBe(true);
    expect(isCelebrating(last + 2 * H + 1, data)).toBe(false);
  });
  it('delta shifts only the end bound', () => {
    expect(isCelebrating(last + 2 * H + 1500, data, 1500)).toBe(true);
    expect(isCelebrating(last + 2 * H + 1501, data, 1500)).toBe(false);
    expect(isCelebrating(first - 2 * H - 1, data, 1500)).toBe(false);
  });
  it('canSayToast equals isCelebrating at delta 0', () => {
    for (const t of [first - 2 * H - 1, first - 2 * H, last + 2 * H, last + 2 * H + 1]) {
      expect(canSayToast(t, data)).toBe(isCelebrating(t, data));
    }
  });
  it('rejects an invalid delta', () => {
    expect(() => isCelebrating(first, data, -1)).toThrow(RangeError);
  });
});

describe('AC-12 toastSeason phases', () => {
  it('before / during / after', () => {
    expect(toastsOpenAt(data)).toBe(first - 2 * H);
    expect(toastSeason(first - 2 * H - 1, data)).toBe('before');
    expect(toastSeason(first - 2 * H, data)).toBe('during');
    expect(toastSeason(last + 2 * H, data)).toBe('during');
    expect(toastSeason(last + 2 * H + 1, data)).toBe('after');
  });
});

describe('empty zone list (as on master)', () => {
  it('is never celebrating, opens never, season before', () => {
    expect(isCelebrating(first, empty)).toBe(false);
    expect(toastsOpenAt(empty)).toBeNull();
    expect(toastSeason(first, empty)).toBe('before');
  });
});

describe('arrivedYear', () => {
  it('is the new year for any zone without an offset and with one', () => {
    expect(arrivedYear(first)).toBe(2027);
    expect(arrivedYear(first, 840)).toBe(2027);
    expect(arrivedYear(last, -720)).toBe(2027);
  });
});
