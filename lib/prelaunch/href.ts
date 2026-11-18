import { DEFAULT_LOCALE, LOCALES, type Locale } from '@/i18n/locales';
import { IS_PRELAUNCH_BUILD } from './env';
import { isRouteEnabled } from './pages.mjs';

/** Сторінки мовного дерева (шлях без мови, зі скісними рисками). */
export const PAGES = {
  home: '/',
  countries: '/countries/',
  pass: '/pass/',
  toasts: '/toasts/',
  privacy: '/privacy/',
  cookies: '/cookies/',
  terms: '/terms/',
  credits: '/credits/',
} as const;
export type PageKey = keyof typeof PAGES;

export function countryPath(urlSlug: string): string {
  return `/country/${urlSlug}/`;
}

/**
 * Адреса сторінки мовою `locale`. На домені головна мова живе без префікса (`/countries/`), решта — з ним
 * (`/uk/countries/`). У демо й тестовій збірці префікс має кожна мова: адреси без нього зайняті сторінками ефіру.
 */
export function localeHref(
  locale: Locale,
  path: string,
  prelaunch: boolean = IS_PRELAUNCH_BUILD,
): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return prelaunch && locale === DEFAULT_LOCALE ? p : `/${locale}${p}`;
}

/** Зворотне до `localeHref`: мова й шлях без мови з адреси сторінки. */
export function splitLocalePath(
  pathname: string,
  prelaunch: boolean = IS_PRELAUNCH_BUILD,
): { locale: Locale; path: string } {
  const m = /^\/([a-z]{2})(\/.*)?$/.exec(pathname);
  const found = m && (LOCALES as readonly string[]).includes(m[1]!) ? (m[1] as Locale) : null;
  if (found) return { locale: found, path: m![2] ?? '/' };
  return { locale: prelaunch ? DEFAULT_LOCALE : 'uk', path: pathname || '/' };
}

/** Сторінка увімкнена в передстартовому сайті (список дозволених — `lib/prelaunch/pages.mjs`). */
export function isPageEnabled(key: PageKey): boolean {
  return isRouteEnabled(PAGES[key]);
}
