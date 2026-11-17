/** Свято йде (рішення власника 2026-11-08, кінець — 2026-11-14): від 2 год до першої півночі до 2 год після останньої. */
import { describe, expect, it } from 'vitest';
import { CELEBRATION_LEAD, CELEBRATION_TAIL, isCelebrating } from '@time2fest/rules/time';

const H = 60 * 60 * 1_000;
const data = { zones: [{ midnightMs: 10 * H }, { midnightMs: 20 * H }, { midnightMs: 36 * H }] } as never;

describe('isCelebrating', () => {
  it('за 2 год до першої півночі — уже свято; раніше — ні', () => {
    expect(isCelebrating(10 * H - CELEBRATION_LEAD, data)).toBe(true);
    expect(isCelebrating(10 * H - CELEBRATION_LEAD - 1, data)).toBe(false);
  });
  it('останню північ і ще 2 год після неї — свято; далі — ні', () => {
    expect(CELEBRATION_TAIL).toBe(2 * H);
    expect(isCelebrating(36 * H, data)).toBe(true);
    expect(isCelebrating(36 * H + 1_000, data)).toBe(true);
    expect(isCelebrating(36 * H + CELEBRATION_TAIL - 1_000, data)).toBe(true);
    expect(isCelebrating(36 * H + CELEBRATION_TAIL, data)).toBe(true);
    expect(isCelebrating(36 * H + CELEBRATION_TAIL + 1_000, data)).toBe(false);
  });
  it('час ще невідомий (0) — не свято', () => {
    expect(isCelebrating(0, data)).toBe(false);
  });
});
