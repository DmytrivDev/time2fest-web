/** Main celebration of a pair inside one correction (AC-56 … AC-58, Q6, W37), pure. */
import { describe, expect, it } from 'vitest';
import { applyMainRules, PAIR_WITHOUT_MAIN, type PairEvent } from '../../src/domain/corrections/mainCelebration';

const ev = (eventId: string, isMain: boolean, hidden = false): PairEvent => ({ eventId, isMain, hidden });

describe('applyMainRules', () => {
  it('AC-56: marking the second event main unsets the first in the same correction', () => {
    expect(applyMainRules([ev('a', true), ev('b', false)], { b: { isMain: true } })).toEqual({
      changes: { a: { isMainCelebration: false } },
      warnings: [],
    });
  });

  it('AC-56: no extra change when the old main is unset in the request itself', () => {
    expect(applyMainRules([ev('a', true), ev('b', false)], { a: { isMain: false }, b: { isMain: true } })).toEqual({ changes: {}, warnings: [] });
  });

  it('two events of one pair marked main in one correction → invalid-input', () => {
    expect(applyMainRules([ev('a', false), ev('b', false)], { a: { isMain: true }, b: { isMain: true } })).toBe('invalid-input');
  });

  it('AC-57: hiding the main while another visible event exists, without a new main → main-required', () => {
    expect(applyMainRules([ev('a', true), ev('b', false)], { a: { hidden: true } })).toBe('main-required');
  });

  it('AC-57: hiding the main with a new visible main in the same correction → allowed', () => {
    expect(applyMainRules([ev('a', true), ev('b', false)], { a: { hidden: true }, b: { isMain: true } })).toEqual({
      changes: { a: { isMainCelebration: false } },
      warnings: [],
    });
  });

  it('AC-57: a new main that is itself hidden does not count', () => {
    expect(applyMainRules([ev('a', true), ev('b', false, true), ev('c', false)], { a: { hidden: true }, b: { isMain: true } })).toBe('main-required');
  });

  it('AC-58: a single-event pair → allowed with the warning pair-without-main', () => {
    expect(applyMainRules([ev('a', true)], { a: { hidden: true } })).toEqual({ changes: {}, warnings: [PAIR_WITHOUT_MAIN] });
  });

  it('AC-58: the other event is already hidden → warning, not a refusal', () => {
    expect(applyMainRules([ev('a', true), ev('b', false, true)], { a: { hidden: true } })).toEqual({ changes: {}, warnings: [PAIR_WITHOUT_MAIN] });
  });

  it('hiding a non-main event or changing nothing about mains → no change, no warning', () => {
    expect(applyMainRules([ev('a', true), ev('b', false)], { b: { hidden: true } })).toEqual({ changes: {}, warnings: [] });
    expect(applyMainRules([ev('a', true), ev('b', false)], {})).toEqual({ changes: {}, warnings: [] });
  });
});
