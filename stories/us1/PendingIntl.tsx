import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import base from '../../messages/uk.json';
import pending from '../../messages/_pending/us1-windows.json';

type Tree = { [key: string]: string | Tree };

function merge(a: Tree, b: Tree): Tree {
  const out: Tree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    out[k] = typeof v === 'object' && typeof cur === 'object' ? merge(cur, v) : v;
  }
  return out;
}

/** Переклади `uk.json` + нові рядки US1 із `messages/_pending/us1-windows.json` (поки головна сесія їх не злила). */
export const US1_MESSAGES = merge(base as Tree, pending as Tree);

/** Обгортка історій: додає рядки з `_pending` поверх тих, що дає глобальний декоратор. */
export function PendingIntl({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="uk" messages={US1_MESSAGES}>
      {children}
    </NextIntlClientProvider>
  );
}
