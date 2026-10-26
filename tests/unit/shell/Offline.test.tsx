import { act, render, renderHook, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';
import { BackendDown, OfflineNotice, useOnline } from '@/components/shell/Offline';
import uk from '@/messages/uk.json';

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
}
function fire(type: 'online' | 'offline') {
  act(() => {
    setOnLine(type === 'online');
    window.dispatchEvent(new Event(type));
  });
}

afterEach(() => setOnLine(true));

describe('useOnline', () => {
  it('читає navigator.onLine і реагує на події online/offline', () => {
    setOnLine(true);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(true);
    fire('offline');
    expect(result.current).toBe(false);
    fire('online');
    expect(result.current).toBe(true);
  });

  it('стартує з offline, якщо мережі немає', () => {
    setOnLine(false);
    const { result } = renderHook(() => useOnline());
    expect(result.current).toBe(false);
  });
});

describe('OfflineNotice', () => {
  const wrap = (ui: React.ReactNode) => (
    <NextIntlClientProvider locale="uk" messages={uk}>
      {ui}
    </NextIntlClientProvider>
  );

  it('з’являється без мережі й зникає, коли вона повертається', () => {
    setOnLine(true);
    render(wrap(<OfflineNotice />));
    expect(screen.queryByText(uk.states.offline)).toBeNull();
    fire('offline');
    expect(screen.getByText(uk.states.offline)).toBeTruthy();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    expect(screen.queryByRole('alert')).toBeNull();
    fire('online');
    expect(screen.queryByText(uk.states.offline)).toBeNull();
  });
});

describe('BackendDown', () => {
  it('пояснює, що функції акаунта недоступні', () => {
    render(
      <NextIntlClientProvider locale="uk" messages={uk}>
        <BackendDown />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(uk.states.backendDown)).toBeTruthy();
  });
});
