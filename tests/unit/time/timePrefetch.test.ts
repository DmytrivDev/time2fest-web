import { describe, expect, it } from 'vitest';
import { takeTimePrefetch, TIME_PREFETCH_KEY } from '@/lib/time/timePrefetch';

describe('takeTimePrefetch', () => {
  it('немає ранньої відповіді — null', async () => {
    expect(await takeTimePrefetch({})).toBeNull();
  });

  it('бере відповідь один раз і рахує rtt та зсув від середини запиту', async () => {
    const win: Record<string, unknown> = {
      [TIME_PREFETCH_KEY]: {
        url: 'http://x/api/time-none',
        p0: 100,
        promise: Promise.resolve({ now: 10_000, p1: 300 }),
      },
    };
    const s = await takeTimePrefetch(win);
    expect(s).toEqual({ rtt: 200, offset: 10_000 - 200 });
    expect(win[TIME_PREFETCH_KEY]).toBeUndefined();
    expect(await takeTimePrefetch(win)).toBeNull();
  });

  it('невдала або некоректна відповідь — null', async () => {
    const win = {
      [TIME_PREFETCH_KEY]: { url: 'u', p0: 0, promise: Promise.resolve({ now: 'x', p1: 1 }) },
    };
    expect(await takeTimePrefetch(win)).toBeNull();
  });
});
