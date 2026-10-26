import type { Decorator } from '@storybook/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import ukMessages from '../../messages/uk.json';
import pending from '../../messages/_pending/us1-cards.json';

type Tree = { [key: string]: string | Tree };

function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    const prev = out[key];
    out[key] = typeof value === 'object' && typeof prev === 'object' ? merge(prev, value) : value;
  }
  return out;
}

/** Словник uk.json + `_pending/us1-cards.json` (до злиття в uk.json). */
export const us1Messages = merge(ukMessages as Tree, pending as Tree);

/** Декоратор історій US1-карток: підмішує ще не злиті рядки. */
export const withUs1Messages: Decorator = (Story) => (
  <NextIntlClientProvider locale="uk" messages={us1Messages}>
    <Story />
  </NextIntlClientProvider>
);
