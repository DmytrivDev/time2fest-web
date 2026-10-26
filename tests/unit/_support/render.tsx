import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import pending from '@/messages/_pending/us1-cards.json';
import uk from '@/messages/uk.json';
import { TimeProvider } from '@/lib/time/TimeProvider';

type Tree = { [key: string]: string | Tree };

function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const prev = out[key];
    out[key] = typeof value === 'object' && typeof prev === 'object' ? merge(prev, value) : value;
  }
  return out;
}

export const messages = merge(uk as Tree, pending as Tree);

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
