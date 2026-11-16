/**
 * Салют звуком (зменшений рух: без картинки) триває весь салют, а не 2 с (iPhone, 2026-11-16: «≈3 с» = 2 с + затухання).
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const start = vi.fn(() => true);
const stop = vi.fn();
vi.mock('@/lib/scene/sceneAudio', () => ({
  playChime: vi.fn(),
  preloadSceneSounds: vi.fn(),
  startFireworksSound: (...a: unknown[]) => (start as (...x: unknown[]) => boolean)(...a),
  stopFireworksSound: () => stop(),
  useSceneSound: () => true,
}));
vi.mock('@/lib/a11y/reducedMotion', () => ({ useReducedMotion: () => true }));

import { midnightPhase, useMidnightSound } from '@/components/player/SceneMidnight';

const M = Date.parse('2027-01-01T01:00:00Z');

describe('useMidnightSound: зменшений рух', () => {
  beforeEach(() => {
    start.mockClear();
    stop.mockClear();
  });

  it('салют починається опівночі й не гасне після перших 2 с — лише коли салют скінчився', () => {
    const { rerender, unmount } = renderHook(({ now }) => useMidnightSound(M, midnightPhase(M, now)), { initialProps: { now: M - 500 } });
    expect(start).not.toHaveBeenCalled();
    rerender({ now: M + 100 });
    expect(start).toHaveBeenCalledTimes(1);
    rerender({ now: M + 1_500 });
    rerender({ now: M + 2_500 });
    rerender({ now: M + 10_000 });
    expect(stop).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledTimes(1);
    rerender({ now: M + 41_000 });
    expect(stop).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('сцену відкрили посеред салюту — звук іде з потрібної секунди', () => {
    renderHook(() => useMidnightSound(M, midnightPhase(M, M + 12_000)));
    expect(start).toHaveBeenCalledWith(12);
  });
});
