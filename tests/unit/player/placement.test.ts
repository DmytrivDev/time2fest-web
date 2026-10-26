import { describe, expect, it } from 'vitest';
import { computeHostPlacement } from '@/lib/player/placement';

const VP = { width: 390, height: 844 };

describe('computeHostPlacement', () => {
  it('сідає точно над слотом', () => {
    expect(computeHostPlacement({ top: 56, left: 0, width: 390, height: 219 }, VP, true)).toEqual({
      visible: true,
      top: 56,
      left: 0,
      width: 390,
      height: 219,
    });
  });

  it('слот поза екраном → схований (visibility, не розмір)', () => {
    const p = computeHostPlacement({ top: -400, left: 0, width: 390, height: 219 }, VP, true);
    expect(p.visible).toBe(false);
    expect(p.width).toBe(390);
  });

  it('менше 200×200 → схований (політика YouTube)', () => {
    expect(computeHostPlacement({ top: 0, left: 0, width: 320, height: 180 }, VP, true).visible).toBe(false);
  });

  it('без відео або без слота → схований', () => {
    expect(computeHostPlacement({ top: 0, left: 0, width: 390, height: 219 }, VP, false).visible).toBe(false);
    expect(computeHostPlacement(null, VP, true).visible).toBe(false);
  });
});
