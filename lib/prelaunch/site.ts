/**
 * Дані мовного дерева, яких немає в каталозі: англійські адреси країн і головні міста (`data/prelaunch/countries.json`),
 * назви мовою сторінки (`data/prelaunch/names/<мова>.json`), розповіді про країни (`data/prelaunch/content/<мова>.json`).
 * Каталог (`data/countries.json`, `data/schedule.json`) не змінюється: сервер звіряє його побайтово.
 */
import extrasJson from '@/data/prelaunch/countries.json';
import type { Country, Dataset } from '@/lib/data/types';
import type { Locale } from '@/i18n/locales';

export interface CountryExtra {
  /** Адреса сторінки країни в мовному дереві: `/country/<urlSlug>/` — англійська, однакова для всіх мов. */
  urlSlug: string;
  /** Головне місто: про нього картка й сторінка країни (а не про перший пояс країни). */
  mainCityId: string;
}

export const COUNTRY_EXTRAS = (extrasJson as { countries: Record<string, CountryExtra> }).countries;

const isoBySlug = new Map(Object.entries(COUNTRY_EXTRAS).map(([iso, x]) => [x.urlSlug, iso]));
export function isoByUrlSlug(urlSlug: string): string | undefined {
  return isoBySlug.get(urlSlug);
}

export interface SiteNames {
  countries: Record<string, string>;
  /** Форма «у країні» мовою сторінки (`у Японії`, `in the UK`, `au Japon`) — для H1 і заголовків; поки порожньо. */
  countriesIn?: Record<string, string>;
  cities: Record<string, string>;
  /** Пам’ятки головних місць розкладу: український текст → мова сторінки. */
  places: Record<string, string>;
}

export interface CountryStory {
  /** Розповідь; абзаци — через порожній рядок. */
  text: string;
  /** Рівно три картки «Як святкувати»; `iconId` — іконка набору (інакше — з каталогу країни). */
  traditions: { id: string; title: string; text: string; iconId?: string }[];
  /** Title і description сторінки з набору країни (головний пояс) — замість шаблону SEO-звіту. */
  meta?: { title: string; description: string };
  /** Одиниця конвеєра «Країни», з якої взято тексти (`jp`, `br-4`). */
  kit?: string;
  /** Заголовок і опис сторінки для пошуку, написані під країну (звіт SEO, розділ 10); заповнює задача C, читає B. */
  seo?: { title?: string; description?: string };
  /** Дати публікації й правки розповіді (ISO), для структурованих даних. */
  published?: string;
  updated?: string;
}

/** Усе мовне, що сторінка передає з сервера в браузер: лише своєю мовою. */
export interface SiteData {
  locale: Locale;
  /** `null` — українська: назви беруться з каталогу. */
  names: SiteNames | null;
  /** Українська форма «у країні» (назви українською — з каталогу, а форми — окремим файлом). */
  inCountryUk?: Record<string, string>;
  /** Розповіді про країни цією мовою, за ISO. Країна без розповіді — сторінка «лише факти». */
  stories: Record<string, CountryStory>;
}

/** Форма «у країні» мовою сторінки; українською — з `data/prelaunch/names/uk.json`, якщо є. */
export function inCountryOf(site: SiteData, iso: string): string | undefined {
  return site.names?.countriesIn?.[iso] ?? site.inCountryUk?.[iso];
}

/**
 * Каталог мовою сторінки. Щоб наявний код (модель головної, мапа) не знав про мови, назви кладуться туди, де він їх
 * читає (`name.uk`), а «Як святкують» — з розповідей цієї мови; у країни без розповіді текст порожній (а не заглушка
 * каталогу «Тут ще збираємо…»).
 */
/** Українські назви міст, що в каталозі сайту написані інакше, ніж у глосарії (одне написання по всьому сайту). */
const UK_CITY_FIXES: Readonly<Record<string, string>> = { kiritimati: 'Кіритіматі' };

export function localizeDataset(data: Dataset, site: SiteData): Dataset {
  const countries: Country[] = data.countries.map((c) => {
    const story = site.stories[c.iso];
    return {
      ...c,
      name: { uk: site.names?.countries[c.iso] ?? c.name.uk },
      howTo: story
        ? {
            ...c.howTo,
            text: story.text,
            traditions: story.traditions.map((t) => ({
              ...t,
              iconId: t.iconId ?? c.howTo.traditions.find((x) => x.id === t.id)?.iconId ?? 'fireworks',
            })),
          }
        : { ...c.howTo, text: '', traditions: [] },
    };
  });
  const cities = data.cities.map((c) => ({
    ...c,
    name: { uk: site.names?.cities[c.id] ?? UK_CITY_FIXES[c.id] ?? c.name.uk },
  }));
  return {
    ...data,
    countries,
    countriesByIso: new Map(countries.map((c) => [c.iso, c])),
    countriesBySlug: new Map(countries.map((c) => [c.slug, c])),
    cities,
    citiesById: new Map(cities.map((c) => [c.id, c])),
  };
}

/** Український текст з констант моделі (місто чи пам’ятка головного місця) → мовою сторінки. */
export function labelFor(data: Dataset, site: SiteData): (uk: string) => string {
  if (!site.names) return (uk) => uk;
  const map = new Map<string, string>(Object.entries(site.names.places));
  for (const c of data.cities) {
    const name = site.names.cities[c.id];
    if (name && !map.has(c.name.uk)) map.set(c.name.uk, name);
  }
  return (uk) => map.get(uk) ?? uk;
}
