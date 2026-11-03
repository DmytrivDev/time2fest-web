// Підказка жестів на телефоні (рішення власника 2026-11-03, дошка `Phone-Map-Legend`, варіант 1): один раз, коли мапа
// видна; «масштаб» → «рух» → згасає; дотик ховає; повторно не показується.
import { act, fireEvent, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapGestureHint } from '@/components/live/MapGestureHint';
import uk from '@/messages/uk.json';

let trigger: (() => void) | null = null;
class FakeIO {
  constructor(private cb: IntersectionObserverCallback) {
    trigger = () => this.cb([{ isIntersecting: true, intersectionRatio: 0.8 } as IntersectionObserverEntry], this as never);
  }
  observe() {}
  disconnect() {}
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
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

describe('MapGestureHint', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', FakeIO);
    window.localStorage.removeItem('t2f:mapGestureHint:v1');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    trigger = null;
  });

  it('з’являється, коли мапа видна: масштаб → рух → зникає; вдруге — ні', () => {
    const a = mount();
    expect(a.container.querySelector('[data-map-gesture]')).toBeNull();
    act(() => trigger!());
    expect(a.container.querySelector('[data-map-gesture]')).toHaveAttribute('data-map-gesture', 'pinch');
    expect(a.container).toHaveTextContent('Зведи чи розведи два пальці — масштаб');
    act(() => vi.advanceTimersByTime(2400));
    expect(a.container.querySelector('[data-map-gesture]')).toHaveAttribute('data-map-gesture', 'pan');
    act(() => vi.advanceTimersByTime(2400));
    expect(a.container.querySelector('[data-map-gesture]')).toHaveAttribute('data-leaving', 'true');
    act(() => vi.advanceTimersByTime(300));
    expect(a.container.querySelector('[data-map-gesture]')).toBeNull();
    a.unmount();
    trigger = null;
    const b = mount();
    expect(trigger).toBeNull();
    expect(b.container.querySelector('[data-map-gesture]')).toBeNull();
  });

  it('дотик ховає підказку одразу', () => {
    const { container } = mount();
    act(() => trigger!());
    fireEvent.click(container.querySelector('[data-map-gesture]')!);
    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelector('[data-map-gesture]')).toBeNull();
  });
});
