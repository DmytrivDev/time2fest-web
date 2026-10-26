'use client';

import { Manrope } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { ErrorContent } from '@/components/shell/ErrorContent';
import { StaticShell } from '@/components/shell/StaticShell';
import messages from '@/messages/uk.json';
import './globals.css';

const manrope = Manrope({ subsets: ['cyrillic', 'latin'], variable: '--font-manrope', display: 'swap' });

/** Помилка самого кореневого макета: замінює його, тож сама дає `<html>`, шрифт, стилі й i18n. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="uk" className={`${manrope.variable} dark`} style={{ colorScheme: 'dark' }}>
      <body>
        <title>Time2Fest</title>
        <NextIntlClientProvider locale="uk" messages={messages}>
          <StaticShell>
            <ErrorContent onRetry={retry} />
          </StaticShell>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
