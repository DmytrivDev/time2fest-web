/** AC-41: звіт про помилку джерела — лише коди 2/5/100/101/150/153, не частіше раз на 30 с на джерело. */
import { describe, expect, it } from 'vitest';
import { SOURCE_ERROR_MIN_GAP_MS, shouldReport } from '@/lib/player/sourceErrors';

describe('shouldReport', () => {
  it.each([2, 5, 100, 101, 150, 153])('код %i → звіт', (code) => {
    expect(shouldReport(code, 's1', 1_000, new Map())).toBe(true);
  });

  it('код 3 та інші — без звіту', () => {
    for (const code of [0, 3, 4, 99, 200]) expect(shouldReport(code, 's1', 1_000, new Map())).toBe(false);
  });

  it('друга помилка того ж джерела за 10 с — без другого звіту', () => {
    const last = new Map([['s1', 1_000]]);
    expect(shouldReport(150, 's1', 11_000, last)).toBe(false);
  });

  it('інше джерело — окремий ліміт', () => {
    const last = new Map([['s1', 1_000]]);
    expect(shouldReport(150, 's2', 2_000, last)).toBe(true);
  });

  it('через 30 с — знову дозволено', () => {
    const last = new Map([['s1', 1_000]]);
    expect(shouldReport(150, 's1', 1_000 + SOURCE_ERROR_MIN_GAP_MS - 1, last)).toBe(false);
    expect(shouldReport(150, 's1', 1_000 + SOURCE_ERROR_MIN_GAP_MS, last)).toBe(true);
  });
});
