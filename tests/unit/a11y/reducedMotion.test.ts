import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeReduceMotion,
  REDUCED_MOTION_INIT_SCRIPT,
  useReducedMotion,
  useReducedMotionAttribute,
} from '@/lib/a11y/reducedMotion';
import { GUEST_STORAGE_KEY, useGuestStore } from '@/stores/guest';

function mockMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const mq = {
    get matches() {
      return matches;
    },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => mq));
  return {
    set(v: boolean) {
      matches = v;
      listeners.forEach((l) => l());
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  useGuestStore.getState().setReducedMotion(false);
  document.documentElement.removeAttribute('data-reduce-motion');
});

describe('зменшити рух: системне АБО сайтове', () => {
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])('система %s, сайт %s → %s', (system, site, expected) => {
    expect(computeReduceMotion(system, site)).toBe(expected);
  });

  it('хук стежить за matchMedia change і перемикачем сайту', () => {
    const mq = mockMatchMedia(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => mq.set(true));
    expect(result.current).toBe(true);
    act(() => mq.set(false));
    act(() => useGuestStore.getState().setReducedMotion(true));
    expect(result.current).toBe(true);
  });

  it('атрибут <html data-reduce-motion> оновлюється', () => {
    mockMatchMedia(false);
    renderHook(() => useReducedMotionAttribute());
    expect(document.documentElement.getAttribute('data-reduce-motion')).toBe('false');
    act(() => useGuestStore.getState().setReducedMotion(true));
    expect(document.documentElement.getAttribute('data-reduce-motion')).toBe('true');
  });

  it('вбудований скрипт до гідратації: система або збережений перемикач; пошкоджене сховище не ламає', () => {
    const run = () => new Function(REDUCED_MOTION_INIT_SCRIPT)();
    mockMatchMedia(false);
    run();
    expect(document.documentElement.getAttribute('data-reduce-motion')).toBe('false');

    localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify({ state: { reducedMotion: true }, version: 1 }));
    run();
    expect(document.documentElement.getAttribute('data-reduce-motion')).toBe('true');

    localStorage.setItem(GUEST_STORAGE_KEY, '{broken');
    mockMatchMedia(true);
    run();
    expect(document.documentElement.getAttribute('data-reduce-motion')).toBe('true');
  });
});
