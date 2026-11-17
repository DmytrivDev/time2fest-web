/** Correction range ±60 min (AC-55, Q3, W36), pure. */
import { describe, expect, it } from 'vitest';
import { checkRange, MAX_SHIFT_MS } from '../../src/domain/corrections/range';

const BASE = Date.parse('2026-12-31T23:00:00Z');
const MIN = 60_000;

describe('checkRange (AC-55)', () => {
  it('the limit is 60 minutes', () => {
    expect(MAX_SHIFT_MS).toBe(60 * MIN);
  });

  it('+60 and −60 min are inside (inclusive), 0 too', () => {
    expect(checkRange(BASE, BASE + 60 * MIN)).toBe('ok');
    expect(checkRange(BASE, BASE - 60 * MIN)).toBe('ok');
    expect(checkRange(BASE, BASE)).toBe('ok');
  });

  it('+61 and −61 min are refused with correction-out-of-range', () => {
    expect(checkRange(BASE, BASE + 61 * MIN)).toBe('correction-out-of-range');
    expect(checkRange(BASE, BASE - 61 * MIN)).toBe('correction-out-of-range');
    expect(checkRange(BASE, BASE + 60 * MIN + 1)).toBe('correction-out-of-range');
  });
});
