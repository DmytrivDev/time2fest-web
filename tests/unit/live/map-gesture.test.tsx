// Підказка жестів на телефоні (рішення власника 2026-11-03, варіант 1): один раз — коли мапа повністю видна (не під
// смугою чату чи плашкою cookies) і простояла так мить; затемнення й два пальці, без тексту; два кола й згасає;
// дотик ховає; позначка — cookie `t2f_map_hint`, повторно не показується.
import { act, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapGestureHint, mapHintSeen } from '@/components/live/MapGestureHint';
import uk from '@/messages/uk.json';

let rect = { top: 900, bottom: 1073, height: 173 };

function Host() {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={(el) => {
        ref.current = el;
        if (el) el.getBoundingClientRect = () => ({ ...rect, left: 0, right: 338, width: 338, x: 0, y: rect.top, toJSON: () => ({}) });
      }}
    >
      <MapGestureHint boxRef={ref} />
    </div>
  );
}
const mount = () =>
  render(
    <NextIntlClientProvider locale="uk" messages={uk as never}>
      <Host />
    </NextIntlClientProvider>,
  );
const scrollTo = (top: number) => {
  rect = { top, bottom: top + 173, height: 173 };
  act(() => {
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(20);
  });
};
const clearCookie = () => {
  document.cookie = 't2f_map_hint=; Max-Age=0; Path=/';
};

describe('MapGestureHint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => window.setTimeout(() => cb(0), 16));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
    clearCookie();
    rect = { top: 900, bottom: 1073, height: 173 };
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearCookie();
  });

  it('мапа частково за екраном — немає; повністю видна й простояла — два кола анімації без тексту, згасає; вдруге — ні', () => {
    const a = mount();
    scrollTo(700); // низ мапи за краєм екрана (jsdom: 768 px)
    act(() => vi.advanceTimersByTime(500));
    expect(a.container.querySelector('[data-map-gesture]')).toBeNull();
    scrollTo(300);
    act(() => vi.advanceTimersByTime(300));
    const hint = a.container.querySelector('[data-map-gesture]')!;
    expect(hint).toHaveAttribute('data-map-gesture', 'play');
    expect(hint.querySelectorAll('[data-f]')).toHaveLength(2);
    expect(hint.querySelector('[role="status"]')).toHaveClass('sr-only');
    expect(mapHintSeen()).toBe(true);
    act(() => vi.advanceTimersByTime(5200));
    expect(a.container.querySelector('[data-map-gesture]')).toHaveAttribute('data-leaving', 'true');
    act(() => vi.advanceTimersByTime(300));
    expect(a.container.querySelector('[data-map-gesture]')).toBeNull();
    a.unmount();
    const b = mount();
    scrollTo(300);
    act(() => vi.advanceTimersByTime(500));
    expect(b.container.querySelector('[data-map-gesture]')).toBeNull();
  });

  it('швидке гортання повз мапу не рахується', () => {
    const { container } = mount();
    scrollTo(300);
    scrollTo(-200); // уже проскролили далі, не зупинившись
    act(() => vi.advanceTimersByTime(500));
    expect(container.querySelector('[data-map-gesture]')).toBeNull();
    expect(mapHintSeen()).toBe(false);
  });

  it('дотик ховає підказку одразу', () => {
    const { container } = mount();
    scrollTo(300);
    act(() => vi.advanceTimersByTime(300));
    fireEvent.click(container.querySelector('[data-map-gesture]')!);
    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelector('[data-map-gesture]')).toBeNull();
  });
});
