import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import uk from '@/messages/uk.json';
import { TimeProvider } from '@/lib/time/TimeProvider';

export const messages = uk;

/** «Зараз» у тестах карток: 23:50 UTC 31 грудня (Лондон у ефірі, Париж позаду). */
export const NOW = '2026-12-31T23:50:00Z';

export function renderWithApp(ui: ReactElement, now: string = NOW) {
  return render(
    <NextIntlClientProvider locale="uk" messages={messages as never}>
      <TimeProvider override={{ at: now, frozen: true }}>{ui}</TimeProvider>
    </NextIntlClientProvider>,
  );
}

export function wrap(ui: ReactElement, now: string = NOW) {
  return (
    <NextIntlClientProvider locale="uk" messages={messages as never}>
      <TimeProvider override={{ at: now, frozen: true }}>{ui}</TimeProvider>
    </NextIntlClientProvider>
  );
}
