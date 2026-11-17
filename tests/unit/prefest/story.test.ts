import { describe, expect, it } from 'vitest';
import { STORY_H, STORY_W, withAlpha } from '@/lib/prefest/story';

describe('story', () => {
  it('розмір 9:16', () => {
    expect(STORY_W / STORY_H).toBeCloseTo(9 / 16, 5);
  });
  it('withAlpha переводить hex', () => {
    expect(withAlpha('#121214', 0.5)).toBe('rgba(18,18,20,0.5)');
    expect(withAlpha('red', 0.5)).toBe('red');
  });
});
