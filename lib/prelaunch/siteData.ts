/** Мовні дані сторінки — збираються на сервері під час збирання й передаються клієнтським блокам пропом. */
import storiesEn from '@/data/prelaunch/content/en.json';
import storiesEs from '@/data/prelaunch/content/es.json';
import storiesFr from '@/data/prelaunch/content/fr.json';
import storiesUk from '@/data/prelaunch/content/uk.json';
import inCountryJson from '@/content/prelaunch/in-country.json';
import namesEn from '@/data/prelaunch/names/en.json';
import namesEs from '@/data/prelaunch/names/es.json';
import namesFr from '@/data/prelaunch/names/fr.json';
import type { Locale } from '@/i18n/locales';
import { SITE_LOCALES } from './env';
import { COUNTRY_PAGES_INDEXED } from './pages.mjs';
import type { CountryStory, SiteData, SiteNames } from './site';

type Stories = Record<string, CountryStory>;

/** Форма «у країні» 4 мовами (`content/prelaunch/in-country.json`) — заголовок і метатексти сторінки країни. */
const IN_COUNTRY = inCountryJson as unknown as Record<Locale, Record<string, string>>;

const NAMES: Record<Locale, SiteNames | null> = {
  uk: null,
  en: { ...(namesEn as SiteNames), countriesIn: IN_COUNTRY.en },
  es: { ...(namesEs as SiteNames), countriesIn: IN_COUNTRY.es },
  fr: { ...(namesFr as SiteNames), countriesIn: IN_COUNTRY.fr },
};

/**
 * Розповіді про країни за мовами (тексти задачі C, `docs/site/prelaunch-content/countries/`).
 * Файл нової мови: `data/prelaunch/content/<мова>.json` + рядок тут.
 */
const STORIES: Record<Locale, Stories> = {
  uk: storiesUk as Stories,
  en: storiesEn as Stories,
  es: storiesEs as Stories,
  fr: storiesFr as Stories,
};

export function siteData(locale: Locale): SiteData {
  return { locale, names: NAMES[locale], inCountryUk: IN_COUNTRY.uk, stories: STORIES[locale] };
}

/** Країни з розповіддю цією мовою (ISO). */
export function describedIsos(locale: Locale): string[] {
  // Ключі `ISO@пояс` — тексти інших поясів країни; описаною країну робить розповідь головного поясу (`ISO`).
  return Object.keys(STORIES[locale]).filter((k) => !k.includes('@'));
}

/** Власні файли розповідей (без підстановки англійської замість іспанської й французької). */
const OWN_STORIES: Partial<Record<Locale, Stories>> = {
  uk: storiesUk as Stories,
  en: storiesEn as Stories,
  es: storiesEs as Stories,
  fr: storiesFr as Stories,
};

/**
 * Одне правило «сторінку країни відкрити пошуковикам» (план, розділ 8; звіт SEO): є власна розповідь кожною мовою
 * цієї збірки. Інакше сторінка країни — `noindex` і поза `sitemap` (усіма мовами однаково).
 */
export function countryIndexable(
  iso: string,
  locales: readonly Locale[] = SITE_LOCALES,
  enabled: boolean = COUNTRY_PAGES_INDEXED,
): boolean {
  return enabled && locales.every((l) => Boolean(OWN_STORIES[l]?.[iso]));
}
