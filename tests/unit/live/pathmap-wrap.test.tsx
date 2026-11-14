import { describe, expect, it } from 'vitest';
import { wrapSegment } from '@/components/map/PathMap';

const SPAN = 1781;

describe('мапа шляху: лінія через край мапи (власник 2026-11-11)', () => {
  it('сусідні точки — одна лінія', () => {
    expect(wrapSegment({ x: 100, y: 10 }, { x: 600, y: 20 }, SPAN)).toEqual([[100, 10, 600, 20]]);
  });

  it('Кірітіматі (лівий край) → Апіа (правий край): дві частини через край, а не лінія через увесь світ', () => {
    const [a, b] = wrapSegment({ x: 53, y: 570 }, { x: 1770, y: 650 }, SPAN);
    expect(a).toEqual([53, 570, 1770 - SPAN, 650]);
    expect(b).toEqual([53 + SPAN, 570, 1770, 650]);
  });

  it('у зворотний бік — так само', () => {
    expect(wrapSegment({ x: 1770, y: 650 }, { x: 53, y: 570 }, SPAN)).toEqual([
      [1770, 650, 53 + SPAN, 570],
      [1770 - SPAN, 650, 53, 570],
    ]);
  });
});
