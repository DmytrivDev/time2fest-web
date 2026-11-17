import { describe, expect, it } from 'vitest';
import { progressBar, rubberBand, snapPosition } from '@/lib/prefest/slider';

describe('snapPosition', () => {
  it('доводить до краю картки', () => {
    expect(snapPosition(130, 100, 1000)).toBe(100);
    expect(snapPosition(160, 100, 1000)).toBe(200);
  });
  it('тримається в межах', () => {
    expect(snapPosition(-50, 100, 1000)).toBe(0);
    expect(snapPosition(5000, 100, 1000)).toBe(1000);
  });
  it('біля кінця стає рівно в кінець', () => {
    expect(snapPosition(900, 100, 930)).toBe(930);
  });
  it('без прокрутки — нуль', () => {
    expect(snapPosition(300, 100, 0)).toBe(0);
  });
});

describe('rubberBand', () => {
  it('у межах не змінює', () => expect(rubberBand(40, 100)).toBe(40));
  it('за межами ділить на 3', () => {
    expect(rubberBand(-30, 100)).toBe(-10);
    expect(rubberBand(130, 100)).toBe(110);
  });
});

describe('progressBar', () => {
  it('на початку і в кінці', () => {
    expect(progressBar(0, 500, 1000, 1500)).toEqual({ widthPct: expect.closeTo(66.67, 1), leftPct: 0 });
    expect(progressBar(500, 500, 1000, 1500).leftPct).toBeCloseTo(33.33, 1);
  });
  it('без прокрутки — повна смужка', () => {
    expect(progressBar(0, 0, 1000, 1000)).toEqual({ widthPct: 100, leftPct: 0 });
  });
});
