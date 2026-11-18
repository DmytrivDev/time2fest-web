/** Мовні дані сторінки — збираються на сервері під час збирання й передаються клієнтським блокам пропом. */
import storiesEn from '@/data/prelaunch/content/en.json';
import storiesUk from '@/data/prelaunch/content/uk.json';
import namesEn from '@/data/prelaunch/names/en.json';
import namesEs from '@/data/prelaunch/names/es.json';
import namesFr from '@/data/prelaunch/names/fr.json';
import type { Locale } from '@/i18n/locales';
import { SITE_LOCALES } from './env';
import type { CountryStory, SiteData, SiteNames } from './site';

type Stories = Record<string, CountryStory>;

const NAMES: Record<Locale, SiteNames | null> = {
  uk: null,
  en: namesEn as SiteNames,
  es: namesEs as SiteNames,
  fr: namesFr as SiteNames,
};

/**
 * Розповіді про країни за мовами. Іспанської й французької ще немає (задача C) — ці мови показують англійські.
 * Файл нової мови: `data/prelaunch/content/<мова>.json` + рядок тут.
 */
const STORIES: Record<Locale, Stories> = {
  uk: storiesUk as Stories,
  en: storiesEn as Stories,
  es: storiesEn as Stories,
  fr: storiesEn as Stories,
};

export function siteData(locale: Locale): SiteData {
  return { locale, names: NAMES[locale], stories: STORIES[locale] };
}

/** Країни з розповіддю цією мовою (ISO). */
export function describedIsos(locale: Locale): string[] {
  return Object.keys(STORIES[locale]);
}

/** Власні файли розповідей (без підстановки англійської замість іспанської й французької). */
const OWN_STORIES: Partial<Record<Locale, Stories>> = {
  uk: storiesUk as Stories,
  en: storiesEn as Stories,
};

/**
 * Одне правило «сторінку країни відкрити пошуковикам» (план, розділ 8; звіт SEO): є власна розповідь кожною мовою
 * цієї збірки. Інакше сторінка країни — `noindex` і поза `sitemap` (усіма мовами однаково).
 */
export function countryIndexable(iso: string, locales: readonly Locale[] = SITE_LOCALES): boolean {
  return locales.every((l) => Boolean(OWN_STORIES[l]?.[iso]));
}
