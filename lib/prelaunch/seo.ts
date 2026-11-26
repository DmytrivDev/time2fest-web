/**
 * Метадані сторінок мовного дерева (план, розділ 6; SEO-звіт, розділи 2, 5, 6): title і description кожною мовою,
 * `canonical` на себе повною адресою, `hreflang` на всі мови збірки + `x-default` (лише відкриті сторінки), Open
 * Graph і Twitter з картинкою 1200×630, `robots`, JSON-LD. Відкривати пошуковикам — лише у збірці для домену
 * (`pnpm build:prelaunch --index` → `NEXT_PUBLIC_PRELAUNCH_INDEX=1`); локальний перегляд і демо — `noindex`.
 */
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/locales';
import siteJson from '@/data/prelaunch/site.json';
import { SITE_LOCALES } from './env';
import { SEASON_VALUES } from './season';
import { localeHref } from './href';
import seoMeta from '@/content/prelaunch/seo-meta.json';

/** Адреса домену (повні `canonical`, `hreflang`, `og:url`, `sitemap`). */
export const SITE_ORIGIN = 'https://time2fest.com';
/** Збірка для домену: відкриті сторінки без `noindex`. Решта збірок (перегляд, демо) — закриті. */
export const INDEX_BUILD = process.env.NEXT_PUBLIC_PRELAUNCH_INDEX === '1';
/** Картинка для соцмереж — кадр банера без тексту (одна на всі мови). */
export const OG_IMAGE = { path: '/media/og-1200x630.jpg', width: 1200, height: 630 } as const;

export type MetaPage =
  | 'home'
  | 'countries'
  | 'country'
  | 'pass'
  | 'pricing'
  | 'privacy'
  | 'cookies'
  | 'terms'
  | 'refunds'
  | 'rules'
  | 'credits'
  | 'notFound';

/** Шлях сторінки без мови (сторінка країни — свій, `/country/<slug>/`). */
export const PAGE_PATHS: Readonly<Record<Exclude<MetaPage, 'country' | 'notFound'>, string>> = {
  home: '/',
  countries: '/countries/',
  pass: '/pass/',
  pricing: '/pricing/',
  privacy: '/privacy/',
  cookies: '/cookies/',
  terms: '/terms/',
  refunds: '/refunds/',
  rules: '/rules/',
  credits: '/credits/',
};

export interface PageMetaOptions {
  /** Підстановки в заголовок і опис (`{country}`). */
  values?: Record<string, string>;
}

/** Повна адреса сторінки мовою (`https://time2fest.com/uk/country/japan/`). */
export function absoluteUrl(locale: Locale, path: string): string {
  return `${SITE_ORIGIN}${localeHref(locale, path, true)}`;
}

/** Адреси сторінки всіма мовами збірки + `x-default` (головна мова) — взаємний набір `hreflang`. */
export function alternatesFor(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of SITE_LOCALES) out[l] = absoluteUrl(l, path);
  if (SITE_LOCALES.includes(DEFAULT_LOCALE)) out['x-default'] = absoluteUrl(DEFAULT_LOCALE, path);
  return out;
}

const OG_LOCALE: Record<Locale, string> = { en: 'en_US', uk: 'uk_UA', es: 'es_ES', fr: 'fr_FR' };

/** Спільна частина метаданих: canonical, hreflang (лише відкриті), robots, Open Graph, Twitter. */
function seoFields(
  locale: Locale,
  path: string | null,
  title: string,
  description: string,
  open: boolean,
): Metadata {
  const index = INDEX_BUILD && open && path !== null;
  const url = path === null ? undefined : absoluteUrl(locale, path);
  const image = {
    url: `${SITE_ORIGIN}${OG_IMAGE.path}`,
    width: OG_IMAGE.width,
    height: OG_IMAGE.height,
    alt: title,
  };
  return {
    title,
    description,
    ...(url && path
      ? { alternates: { canonical: url, ...(open ? { languages: alternatesFor(path) } : {}) } }
      : {}),
    robots: index
      ? { index: true, follow: true, 'max-image-preview': 'large' }
      : { index: false, follow: INDEX_BUILD },
    openGraph: {
      type: 'website',
      siteName: 'Time2Fest',
      title,
      description,
      ...(url ? { url } : {}),
      locale: OG_LOCALE[locale],
      images: [image],
    },
    twitter: { card: 'summary_large_image', title, description, images: [image.url] },
  };
}

/** Тексти з `content/prelaunch/seo-meta.json` (SEO-звіт, додаток А, і правка власника до опису головної). */
type SeoText = { title: string; description: string };
const SEO = seoMeta as unknown as Record<string, Record<string, SeoText> | undefined>;
const SEO_COUNTRY = (seoMeta as unknown as { country: Record<string, Record<string, SeoText> | undefined> })
  .country;
/** Сторінки, чиї тексти — у `seo-meta.json`; решта (`credits`, `notFound`) — у `prelaunch.meta` повідомлень. */
const FROM_SEO: readonly MetaPage[] = [
  'home',
  'countries',
  'pass',
  'pricing',
  'privacy',
  'cookies',
  'terms',
  'refunds',
  'rules',
];

/** Рік сезону в текст: «{year}» → «2027». */
const withYear = (s: string) => s.replaceAll('{year}', SEASON_VALUES.year);

/** Бренд у кінці; якщо разом довше за 65 знаків — без бренду (SEO-звіт, розділ 2). */
const BRAND = ' | Time2Fest';
export function fitTitle(title: string, ceiling = 65): string {
  const bare = title.endsWith(BRAND) ? title.slice(0, -BRAND.length) : title;
  return bare.length + BRAND.length > ceiling ? bare : bare + BRAND;
}

export async function pageMetadata(
  locale: Locale,
  page: Exclude<MetaPage, 'country'>,
  options: PageMetaOptions = {},
): Promise<Metadata> {
  const path = page === 'notFound' ? null : PAGE_PATHS[page];
  const open = page !== 'notFound';
  const seo = FROM_SEO.includes(page) ? (SEO[page]?.[locale] ?? SEO[page]?.[DEFAULT_LOCALE]) : undefined;
  if (seo) return seoFields(locale, path, fitTitle(withYear(seo.title)), withYear(seo.description), open);
  const t = await getTranslations({ locale, namespace: `prelaunch.meta.${page}` });
  const values = { ...SEASON_VALUES, ...options.values };
  return seoFields(locale, path, fitTitle(t('title', values)), t('description', values), open);
}

/** Рік після назви свята в заголовку описаної країни: «Новий рік у Японії» → «Новий рік 2027 у Японії». */
const FEAST: Record<string, string> = {
  uk: 'Новий рік',
  en: 'New Year',
  es: 'Año Nuevo',
  fr: 'Nouvel An',
};

/**
 * Коротший хвіст title країни, коли з роком і брендом виходить понад 65 знаків (SEO-звіт, розділ 2): «…: як
 * святкують, традиції» → «…: традиції». Шаблоном, а не обрізанням.
 */
const SHORT_TAIL: Record<string, string> = {
  uk: 'традиції',
  en: 'Traditions & Countdown',
  es: 'tradiciones',
  fr: 'traditions',
};

/** Title країни в межах 65: повний → з коротким хвостом → без хвоста → без бренду. */
export function countryTitle(full: string, locale: string): string {
  const bare = full.endsWith(BRAND) ? full.slice(0, -BRAND.length) : full;
  const sep = bare.lastIndexOf(':');
  const head = sep > 0 ? bare.slice(0, sep).trimEnd() : bare;
  const colon = locale === 'fr' ? ' : ' : ': ';
  const variants = [bare, `${head}${colon}${SHORT_TAIL[locale] ?? SHORT_TAIL.en}`, head];
  for (const v of variants) if (v.length + BRAND.length <= 65) return v + BRAND;
  return head;
}

/**
 * Сторінка країни (рішення власника 2026-11-19: рік і в заголовку країни). Описана країна — тексти SEO-звіту з роком
 * після назви свята, відкрита; країна «лише факти» — шаблон `prelaunch.meta.country.titleFacts` / `descriptionFacts`
 * з назвою країни без відмінка, `noindex` і без `hreflang` (план, розділ 8; `countryIndexable`).
 */
export async function countryMetadata(
  locale: Locale,
  iso: string,
  name: string,
  slug: string,
  described: boolean,
  open: boolean,
  inCountry?: string,
  kitMeta?: { title: string; description: string },
): Promise<Metadata> {
  const path = `/country/${slug}/`;
  // Набір країни (головний пояс) має власні title і description, написані під країну (`docs/site/country-kit.md` §6а).
  if (described && kitMeta) return seoFields(locale, path, fitTitle(kitMeta.title), kitMeta.description, open);
  const seo = described ? SEO_COUNTRY[iso]?.[locale] : undefined;
  if (seo) {
    const feast = FEAST[locale] ?? FEAST.en!;
    const full = seo.title.startsWith(feast)
      ? `${feast} ${SEASON_VALUES.year}${seo.title.slice(feast.length)}`
      : seo.title;
    return seoFields(locale, path, countryTitle(full, locale), withYear(seo.description), open);
  }
  const t = await getTranslations({ locale, namespace: 'prelaunch.meta.country' });
  const values = { ...SEASON_VALUES, country: name, inCountry: inCountry ?? '' };
  return seoFields(
    locale,
    path,
    countryTitle(t(inCountry ? 'titleFactsIn' : 'titleFacts', values), locale),
    t(inCountry ? 'descriptionFactsIn' : 'descriptionFacts', values),
    open,
  );
}

/** Соцмережі з підвалу — `sameAs` організації. */
const SOCIAL = (siteJson as { social: { name: string; url: string }[] }).social;

/**
 * Структуровані дані (SEO-звіт, розділ 5): головна англійською — `WebSite` + `Organization` (Google бере назву сайту
 * лише з головної домену); внутрішні сторінки — `BreadcrumbList`. `FAQPage`, `Event`, `ItemList` не ставимо;
 * `Article` для описаних країн — коли будуть справжні дати публікації й правки.
 */
export async function jsonLdFor(
  locale: Locale,
  page: MetaPage,
  crumb?: { name: string; path: string },
): Promise<object[] | null> {
  if (page === 'notFound') return null;
  if (page === 'home') {
    if (locale !== DEFAULT_LOCALE) return null;
    return [
      { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Time2Fest', url: `${SITE_ORIGIN}/` },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Time2Fest',
        url: `${SITE_ORIGIN}/`,
        logo: `${SITE_ORIGIN}/brand/logo.png`,
        sameAs: SOCIAL.map((s) => s.url),
      },
    ];
  }
  const t = await getTranslations({ locale, namespace: 'prelaunch.header' });
  if (!crumb && (page === 'countries' || page === 'pass' || page === 'pricing'))
    crumb = { name: t(page), path: PAGE_PATHS[page] };
  if (!crumb) return null;
  const items: { name: string; path: string }[] = [{ name: t('home'), path: '/' }];
  if (page === 'country') items.push({ name: t('countries'), path: '/countries/' });
  items.push(crumb);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        item: absoluteUrl(locale, it.path),
      })),
    },
  ];
}
