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
import seoMeta from '@/content/prelaunch/seo-meta.json';

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

/** Тексти з `content/prelaunch/seo-meta.json` (SEO-звіт, додаток А, і правка власника до опису головної). */
type SeoText = { title: string; description: string };
const SEO = seoMeta as unknown as Record<string, Record<string, SeoText> | undefined>;
const SEO_COUNTRY = (seoMeta as unknown as { country: Record<string, Record<string, SeoText> | undefined> })
  .country;
/** Сторінки, чиї тексти — у `seo-meta.json`; решта (`credits`, `notFound`) — у `prelaunch.meta` повідомлень. */
const FROM_SEO: readonly MetaPage[] = ['home', 'countries', 'pass', 'toasts', 'privacy', 'cookies', 'terms'];

/** Рік сезону в текст: «{year}» → «2027». */
const withYear = (s: string) => s.replaceAll('{year}', SEASON_VALUES.year);

/** Бренд у кінці; якщо разом понад 65 знаків — без бренду (SEO-звіт, розділ 2). */
const BRAND = ' | Time2Fest';
export function fitTitle(title: string): string {
  const bare = title.endsWith(BRAND) ? title.slice(0, -BRAND.length) : title;
  return bare.length + BRAND.length > 65 ? bare : bare + BRAND;
}

export async function pageMetadata(
  locale: Locale,
  page: MetaPage,
  options: PageMetaOptions = {},
): Promise<Metadata> {
  const seo = FROM_SEO.includes(page) ? (SEO[page]?.[locale] ?? SEO[page]?.[DEFAULT_LOCALE]) : undefined;
  if (seo) {
    return {
      title: fitTitle(withYear(seo.title)),
      description: withYear(seo.description),
      robots: { index: false, follow: false },
    };
  }
  const t = await getTranslations({ locale, namespace: `prelaunch.meta.${page}` });
  const values = { ...SEASON_VALUES, ...options.values };
  return {
    title: t(options.titleKey ?? 'title', values),
    description: t(options.descriptionKey ?? 'description', values),
    robots: { index: false, follow: false },
  };
}

/** Рік після назви свята в заголовку описаної країни: «Новий рік у Японії» → «Новий рік 2027 у Японії». */
const FEAST: Record<string, string> = {
  uk: 'Новий рік',
  en: 'New Year',
  es: 'Año Nuevo',
  fr: 'Nouvel An',
};

/**
 * Сторінка країни (рішення власника 2026-11-19: рік і в заголовку країни). Описана країна — тексти SEO-звіту з роком
 * після назви свята; країна «лише факти» — шаблон `prelaunch.meta.country.titleFacts` / `descriptionFacts` з назвою
 * країни без відмінка (форм «у країні» для 246 країн у даних немає).
 */
export async function countryMetadata(
  locale: Locale,
  iso: string,
  name: string,
  described: boolean,
): Promise<Metadata> {
  const seo = described ? SEO_COUNTRY[iso]?.[locale] : undefined;
  if (seo) {
    const feast = FEAST[locale] ?? FEAST.en!;
    const title = seo.title.startsWith(feast)
      ? `${feast} ${SEASON_VALUES.year}${seo.title.slice(feast.length)}`
      : seo.title;
    return {
      title: fitTitle(title),
      description: withYear(seo.description),
      robots: { index: false, follow: false },
    };
  }
  const t = await getTranslations({ locale, namespace: 'prelaunch.meta.country' });
  const values = { ...SEASON_VALUES, country: name };
  return {
    title: fitTitle(t('titleFacts', values)),
    description: t('descriptionFacts', values),
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
