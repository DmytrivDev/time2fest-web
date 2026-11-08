/** Свято йде (рішення власника 2026-11-08): від 2 год до першої півночі до останньої півночі. */
import { describe, expect, it } from 'vitest';
import { CELEBRATION_LEAD, isCelebrating } from '@/lib/engine/celebration';

const H = 60 * 60 * 1_000;
const data = { zones: [{ midnightMs: 10 * H }, { midnightMs: 20 * H }, { midnightMs: 36 * H }] } as never;

describe('isCelebrating', () => {
  it('за 2 год до першої півночі — уже свято; раніше — ні', () => {
    expect(isCelebrating(10 * H - CELEBRATION_LEAD, data)).toBe(true);
    expect(isCelebrating(10 * H - CELEBRATION_LEAD - 1, data)).toBe(false);
  });
  it('до останньої півночі включно — свято; після — ні', () => {
    expect(isCelebrating(36 * H, data)).toBe(true);
    expect(isCelebrating(36 * H + 1, data)).toBe(false);
  });
  it('час ще невідомий (0) — не свято', () => {
    expect(isCelebrating(0, data)).toBe(false);
  });
});
