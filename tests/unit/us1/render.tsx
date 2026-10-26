import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import base from '@/messages/uk.json';
import { TimeProvider } from '@/lib/time/TimeProvider';

export const messages = base;

/** 31 грудня 2026, 20:37 UTC. */
export const NOW = '2026-12-31T20:37:00Z';

export function wrap(ui: ReactElement, now: string | number = NOW) {
  return (
    <NextIntlClientProvider locale="uk" messages={messages as never}>
      <TimeProvider override={{ at: now, frozen: true }}>{ui}</TimeProvider>
    </NextIntlClientProvider>
  );
}

export function renderApp(ui: ReactElement, now: string | number = NOW) {
  return render(wrap(ui, now));
}

/** jsdom не має ResizeObserver / IntersectionObserver / matchMedia (потрібні Embla). */
export function stubBrowserApis(): void {
  class Noop {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  const g = globalThis as Record<string, unknown>;
  g.ResizeObserver ??= Noop;
  g.IntersectionObserver ??= Noop;
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
  }
}
