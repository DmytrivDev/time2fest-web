import { buildLocales, type Locale } from '@/i18n/locales';

/**
 * Збірка передстартового сайту для домену (`pnpm build:prelaunch`): у ній є лише мовне дерево `app/[locale]`
 * (`pageExtensions` у `next.config.ts`), англійські сторінки копіюються в корінь, посилання англійською — без префікса.
 */
export const IS_PRELAUNCH_BUILD = process.env.NEXT_PUBLIC_PRELAUNCH === '1';

/** Мови, які мають сторінки в цій збірці (і які показує перемикач). */
export const SITE_LOCALES: Locale[] = buildLocales({
  prelaunch: IS_PRELAUNCH_BUILD,
  only: process.env.NEXT_PUBLIC_PRELAUNCH_LOCALES,
});
