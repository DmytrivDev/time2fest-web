import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClock, nextTickDelay } from '@/lib/time/clock';
import { createTestApi } from '@/lib/time/testApi';
import { TimeMachine } from '@/lib/time/timeMachine';
import { TimeProvider, useNow, useTimeSource } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

describe('clock', () => {
  it('такт вирівнюється на межу секунди; при прискоренні частішає, але не частіше 100 мс', () => {
    expect(nextTickDelay(10_250, 1)).toBe(755);
    expect(nextTickDelay(10_000, 1)).toBe(1_000);
    expect(nextTickDelay(10_900, 10)).toBe(100);
    expect(nextTickDelay(10_000, 600)).toBe(100);
    expect(nextTickDelay(10_000, 0)).toBe(1_000);
  });

  it('одна підписка на джерело для всіх слухачів; стрибок машини — негайний такт', () => {
    const c = { p: 0 };
    const m = new TimeMachine({ at: 1_000, speed: 1, perfNow: () => c.p });
    const timers: (() => void)[] = [];
    const clock = createClock(m, {
      setTimer: (fn) => {
        timers.push(fn);
        return () => undefined;
      },
    });
    const a = vi.fn();
    const b = vi.fn();
    clock.subscribe(a);
    clock.subscribe(b);
    c.p = 1_000;
    timers.at(-1)!();
    expect(clock.getSnapshot()).toBe(2_000);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    m.advance(60_000);
    expect(clock.getSnapshot()).toBe(62_000);
    expect(a).toHaveBeenCalledTimes(2);
  });
});

function Show() {
  const now = useNow();
  const src = useTimeSource();
  return (
    <p data-testid="now">
      {now}|{src.status}
    </p>
  );
}

describe('TimeProvider', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
  afterEach(() => vi.useRealTimers());

  it('override frozen: заморожений кадр', () => {
    render(
      <TimeProvider override={{ at: '2027-01-01T02:00:10+02:00', frozen: true }}>
        <Show />
      </TimeProvider>,
    );
    expect(screen.getByTestId('now').textContent).toBe(`${Date.parse('2027-01-01T00:00:10Z')}|machine`);
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId('now').textContent).toBe(`${Date.parse('2027-01-01T00:00:10Z')}|machine`);
  });

  it('override зі швидкістю: useNow оновлюється тактами', () => {
    render(
      <TimeProvider override={{ at: Date.parse('2027-01-01T00:00:00Z'), speed: 1 }}>
        <Show />
      </TimeProvider>,
    );
    act(() => {
      vi.advanceTimersByTime(3_010);
    });
    const v = Number(screen.getByTestId('now').textContent!.split('|')[0]);
    expect(v).toBeGreaterThanOrEqual(Date.parse('2027-01-01T00:00:03Z'));
    expect(v).toBeLessThan(Date.parse('2027-01-01T00:00:04Z'));
  });
});

describe('window.__t2f', () => {
  it('get/set/advance, resetGuest, setPayResult, setChatAvailable', () => {
    const c = { p: 0 };
    const m = new TimeMachine({ at: Date.parse('2026-12-31T23:38:00Z'), perfNow: () => c.p });
    const api = createTestApi(m);
    expect(api.timeMachine.get()).toEqual({ at: '2026-12-31T23:38:00.000Z', speed: 1, source: 'machine' });
    api.timeMachine.set({ at: '2027-01-01T01:59:30+02:00', speed: 10 });
    expect(m.now()).toBe(Date.parse('2026-12-31T23:59:30Z'));
    api.timeMachine.advance(30_000);
    expect(m.now()).toBe(Date.parse('2027-01-01T00:00:00Z'));

    useGuestStore.getState().setNick('Оля');
    const oldId = useGuestStore.getState().id;
    api.resetGuest();
    expect(useGuestStore.getState().nick).toBeUndefined();
    expect(useGuestStore.getState().id).not.toBe(oldId);

    api.setPayResult('declined');
    api.setChatAvailable(false);
    expect(useTestControls.getState()).toMatchObject({ payResult: 'declined', chatAvailable: false });
  });
});
