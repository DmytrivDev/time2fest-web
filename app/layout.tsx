import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import { DeviceModeReload } from '@/components/dev/DeviceModeReload';
import { ReducedMotionScript } from '@/lib/a11y/ReducedMotionHeadScript';
import { ReducedMotionSync } from '@/lib/a11y/ReducedMotionSync';
import { TIME_PREFETCH_SCRIPT } from '@/lib/time/timePrefetch';
import './globals.css';

const manrope = Manrope({
  subsets: ['cyrillic', 'latin'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Time2Fest',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${manrope.variable} dark`} style={{ colorScheme: 'dark' }} suppressHydrationWarning>
      <head>
        <ReducedMotionScript />
        {/* Ранній /api/time (SC-001): ефір не чекає гідратації, щоб дізнатися серверний час. */}
        <script dangerouslySetInnerHTML={{ __html: TIME_PREFETCH_SCRIPT }} />
      </head>
      <body>
        <ReducedMotionSync />
        <DeviceModeReload />
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
