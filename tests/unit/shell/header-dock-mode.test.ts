import { describe, expect, it } from 'vitest';
import { computeHeaderMode } from '@/components/shell/headerDockMode';

const base = { current: 'flow' as const, scrollY: 0, playerBottom: 700, pinned: false, reduced: false };

describe('computeHeaderMode (Н1)', () => {
  it('без плеєра — липка', () => expect(computeHeaderMode({ ...base, playerBottom: null })).toBe('sticky'));
  it('угорі й над плеєром — у потоці', () => expect(computeHeaderMode({ ...base, scrollY: 300 })).toBe('flow'));
  it('минули плеєр — закріплена', () => expect(computeHeaderMode({ ...base, scrollY: 700 })).toBe('fixed'));
  it('назад до плеєра — з’їжджає, а при зменшеному русі зникає одразу', () => {
    expect(computeHeaderMode({ ...base, current: 'fixed', scrollY: 300 })).toBe('leaving');
    expect(computeHeaderMode({ ...base, current: 'fixed', scrollY: 300, reduced: true })).toBe('flow');
  });
  it('плеєр сам липне — шапка не закріплюється', () => expect(computeHeaderMode({ ...base, scrollY: 2000, pinned: true })).toBe('flow'));
});
