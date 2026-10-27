import { describe, expect, it } from 'vitest';
import { computeHostPlacement } from '@/lib/player/placement';

const ORIGIN = { top: 0, left: 0 };

describe('computeHostPlacement', () => {
  it('fixed: сідає точно над слотом у вікні', () => {
    expect(computeHostPlacement({ top: 0, left: 0, width: 390, height: 219 }, ORIGIN, 'fixed', true)).toEqual({
      mode: 'fixed',
      visible: true,
      top: 0,
      left: 0,
      width: 390,
      height: 219,
    });
  });

  it('absolute: координати відносно оболонки — прокрутка (зсув обох) нічого не змінює', () => {
    const a = computeHostPlacement({ top: 88, left: 32, width: 1012, height: 569 }, { top: 64, left: 0 }, 'absolute', true);
    const b = computeHostPlacement({ top: -312, left: 32, width: 1012, height: 569 }, { top: -336, left: 0 }, 'absolute', true);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ top: 24, left: 32 });
  });

  it('слот поза екраном не ховає хост (він просто прокрутився разом зі сторінкою)', () => {
    expect(computeHostPlacement({ top: -400, left: 0, width: 390, height: 219 }, { top: -456, left: 0 }, 'absolute', true).visible).toBe(true);
  });

  it('менше 200×200 → схований (політика YouTube)', () => {
    expect(computeHostPlacement({ top: 0, left: 0, width: 320, height: 180 }, ORIGIN, 'fixed', true).visible).toBe(false);
  });

  it('без відео або без слота → схований', () => {
    expect(computeHostPlacement({ top: 0, left: 0, width: 390, height: 219 }, ORIGIN, 'fixed', false).visible).toBe(false);
    expect(computeHostPlacement(null, ORIGIN, 'absolute', true).visible).toBe(false);
  });
});
