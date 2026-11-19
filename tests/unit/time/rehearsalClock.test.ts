import { afterEach, describe, expect, it, vi } from 'vitest';
import { startRehearsalClock } from '@/lib/time/rehearsalClock';

function setup() {
  let onEvent: (e: { type: string }) => void = () => {};
  const unsub = vi.fn();
  const subscribe = vi.fn((_c: string, l: { onEvent: typeof onEvent }) => {
    onEvent = l.onEvent;
    return unsub;
  });
  const resync = vi.fn();
  const stop = startRehearsalClock({ resync }, { loadTransport: async () => ({ subscribe }) as never });
  return { emit: (type: string) => onEvent({ type }), resync, subscribe, unsub, stop };
}

describe('rehearsalClock', () => {
  afterEach(() => vi.useRealTimers());

  it('clock → resync протягом 5 с, один виклик на серію подій', async () => {
    vi.useFakeTimers();
    const t = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.subscribe).toHaveBeenCalledWith('site:state', expect.anything());
    t.emit('clock');
    t.emit('clock');
    await vi.advanceTimersByTimeAsync(600);
    expect(t.resync).toHaveBeenCalledTimes(1);
  });

  it('інші типи ігноруються', async () => {
    vi.useFakeTimers();
    const t = setup();
    await vi.advanceTimersByTimeAsync(0);
    t.emit('toast');
    await vi.advanceTimersByTimeAsync(5000);
    expect(t.resync).not.toHaveBeenCalled();
  });

  it('stop знімає підписку й скасовує відкладений resync', async () => {
    vi.useFakeTimers();
    const t = setup();
    await vi.advanceTimersByTimeAsync(0);
    t.emit('clock');
    t.stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(t.unsub).toHaveBeenCalled();
    expect(t.resync).not.toHaveBeenCalled();
  });
});
