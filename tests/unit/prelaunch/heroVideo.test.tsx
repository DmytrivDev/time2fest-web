import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { HeroVideo } from '@/components/prefest/PrefestHero';
import mediaJson from '@/data/prelaunch/media.json';
import type { MediaItem } from '@/components/prefest/PrefestContext';

const hero = (mediaJson as { items: Record<string, MediaItem> }).items.hero!;

describe('ролик банера передстартового сайту', () => {
  let play: MockInstance<() => Promise<void>>;
  let pause: MockInstance<() => void>;
  beforeEach(() => {
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('без звуку, по колу, постер; webm першим, mp4 запасним; 1080p лише для широких екранів', () => {
    const { container } = render(<HeroVideo media={hero} reduced={false} />);
    const v = container.querySelector('video')!;
    expect(v.muted).toBe(true);
    expect(v.loop).toBe(true);
    expect(v.getAttribute('playsinline')).not.toBeNull();
    expect(v.getAttribute('preload')).toBe('metadata');
    expect(v.getAttribute('poster')).toBe(hero.poster);
    expect(v.style.objectFit).toBe('cover');
    const sources = [...v.querySelectorAll('source')].map((s) => [
      s.getAttribute('src'),
      s.getAttribute('type')?.split(';')[0],
      s.getAttribute('media'),
    ]);
    expect(sources).toEqual([
      ['/media/hero/hero-1080.webm', 'video/webm', '(min-width: 1000px)'],
      ['/media/hero/hero-1080.mp4', 'video/mp4', '(min-width: 1000px)'],
      ['/media/hero/hero-720.webm', 'video/webm', null],
      ['/media/hero/hero-720.mp4', 'video/mp4', null],
    ]);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('«менше руху» — лише постер: відтворення не запускається', () => {
    const { container } = render(<HeroVideo media={hero} reduced />);
    const v = container.querySelector('video')!;
    expect(v.getAttribute('autoplay')).toBeNull();
    expect(play).not.toHaveBeenCalled();
    expect(pause).toHaveBeenCalled();
  });

  it('ввімкнули «менше руху» під час показу — ролик зупиняється', () => {
    const { rerender } = render(<HeroVideo media={hero} reduced={false} />);
    rerender(<HeroVideo media={hero} reduced />);
    expect(pause).toHaveBeenCalled();
  });
});
