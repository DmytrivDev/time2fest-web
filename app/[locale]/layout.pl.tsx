import { Manrope } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { LocaleLang } from '@/components/prelaunch/LocaleLang';
import { LOCALE_STATUS } from '@/i18n/locales';
import { ReducedMotionScript } from '@/lib/a11y/ReducedMotionHeadScript';
import { ReducedMotionSync } from '@/lib/a11y/ReducedMotionSync';
import { IS_PRELAUNCH_BUILD, SITE_LOCALES } from '@/lib/prelaunch/env';
import { clientMessages } from '@/lib/prelaunch/messages';
import { localeOf, type LocaleParams } from '@/lib/prelaunch/params';
import '@/app/globals.css';

/**
 * Мовне дерево (план передстартового сайту, розділ 3). Файли маршрутів тут мають розширення `.pl.tsx`:
 * звичайна збірка (демо, тестова, робоча) бачить їх разом з рештою сайту, а збірка для домену
 * (`pnpm build:prelaunch`, `pageExtensions` у `next.config.ts`) — лише їх. Тому в збірці для домену цей макет —
 * кореневий (сам малює `<html lang>`, без запобіжника шва й раннього `/api/time`), а в решті — вкладений у
 * `app/layout.tsx`.
 */
const manrope = Manrope({
  subsets: ['cyrillic', 'latin'],
  variable: '--font-manrope',
  display: 'swap',
});

export function generateStaticParams() {
  return SITE_LOCALES.map((locale) => ({ locale }));
}
export const dynamicParams = false;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: LocaleParams;
}) {
  const locale = await localeOf(params);
  const content = (
    <NextIntlClientProvider locale={locale} messages={clientMessages(locale)}>
      {children}
    </NextIntlClientProvider>
  );
  if (!IS_PRELAUNCH_BUILD)
    return (
      <>
        <LocaleLang locale={locale} />
        {content}
      </>
    );
  return (
    <html
      lang={locale}
      className={`${manrope.variable} dark`}
      style={{ colorScheme: 'dark' }}
      data-locale-status={LOCALE_STATUS[locale]}
      suppressHydrationWarning
    >
      <head>
        <ReducedMotionScript />
      </head>
      <body>
        <ReducedMotionSync />
        {content}
      </body>
    </html>
  );
}
