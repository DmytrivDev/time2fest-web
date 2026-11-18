/** Мовні дані сторінки — збираються на сервері під час збирання й передаються клієнтським блокам пропом. */
import storiesEn from '@/data/prelaunch/content/en.json';
import storiesUk from '@/data/prelaunch/content/uk.json';
import namesEn from '@/data/prelaunch/names/en.json';
import namesEs from '@/data/prelaunch/names/es.json';
import namesFr from '@/data/prelaunch/names/fr.json';
import type { Locale } from '@/i18n/locales';
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
