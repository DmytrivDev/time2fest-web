/**
 * Метадані сторінок мовного дерева. Задача A закладає поля (заголовок і опис кожної сторінки кожною мовою —
 * `messages/*.json`, простір `prelaunch.meta`) і місця; `canonical`, `hreflang` у розмітці, `sitemap`, `robots.txt`,
 * `og:image`, зняття `noindex` у збірці для домену й JSON-LD робить задача B (план, розділ 6).
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales';
import { SITE_LOCALES } from './env';
import { SEASON_VALUES } from './season';
import { localeHref } from './href';

export type MetaPage =
  | 'home'
  | 'countries'
  | 'country'
  | 'pass'
  | 'toasts'
  | 'privacy'
  | 'cookies'
  | 'terms'
  | 'credits'
  | 'notFound';

export interface PageMetaOptions {
  /** Підстановки в заголовок і опис (`{country}`). */
  values?: Record<string, string>;
  /** Ключі тексту, якщо вони не `title` / `description` (сторінка країни без розповіді). */
  titleKey?: string;
  descriptionKey?: string;
  /**
   * Чи відкривати сторінку пошуковикам у збірці для домену. Задача A лишає `noindex` усюди; задача B має читати
   * це поле: `false` — сторінка лишається `noindex` і не йде в `sitemap` (країна без розповіді, 404).
   */
  indexable?: boolean;
}

export async function pageMetadata(
  locale: Locale,
  page: MetaPage,
  options: PageMetaOptions = {},
): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: `prelaunch.meta.${page}` });
  const values = { ...SEASON_VALUES, ...options.values };
  return {
    title: t(options.titleKey ?? 'title', values),
    description: t(options.descriptionKey ?? 'description', values),
    robots: { index: false, follow: false },
  };
}

/** Адреси сторінки всіма мовами збірки + `x-default` (головна мова) — заготовка `hreflang` для задачі B. */
export function alternatesFor(path: string, prelaunch?: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of SITE_LOCALES) out[l] = localeHref(l, path, prelaunch);
  if (SITE_LOCALES.includes(DEFAULT_LOCALE))
    out['x-default'] = localeHref(DEFAULT_LOCALE, path, prelaunch);
  return out;
}

/** Структуровані дані сторінки (JSON-LD). Поки порожньо — заповнює задача B (`WebSite`, `Organization`, `Event`). */
export function jsonLdFor(
  locale: Locale,
  page: MetaPage,
  values?: Record<string, string>,
): object | null {
  void locale;
  void page;
  void values;
  return null;
}
