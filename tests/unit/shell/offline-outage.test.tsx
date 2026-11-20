import { act, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfflineNotice } from '@/components/shell/Offline';
import uk from '@/messages/uk.json';

let current: { outage?: 'technical' } | undefined;
vi.mock('@/lib/api/hooks/site', () => ({ useSiteState: () => ({ status: 'ready', state: current }) }));

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
}
afterEach(() => {
  current = undefined;
  setOnLine(true);
});

const ui = () => (
  <NextIntlClientProvider locale="uk" messages={uk}>
    <OfflineNotice />
    <main>сторінка</main>
  </NextIntlClientProvider>
);

describe('OfflineNotice · червона кнопка', () => {
  it('аварія — смуга з текстом backendDown, сторінка лишається', () => {
    current = { outage: 'technical' };
    render(ui());
    expect(screen.getByText(uk.states.backendDown)).toBeTruthy();
    expect(screen.getByText('сторінка')).toBeTruthy();
  });

  it('наступний знімок без аварії — смуги немає', () => {
    current = { outage: 'technical' };
    const { rerender } = render(ui());
    current = {};
    rerender(ui());
    expect(screen.queryByText(uk.states.backendDown)).toBeNull();
  });

  it('без мережі й з аварією — текст offline', () => {
    current = { outage: 'technical' };
    setOnLine(false);
    render(ui());
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText(uk.states.offline)).toBeTruthy();
    expect(screen.queryByText(uk.states.backendDown)).toBeNull();
  });
});
