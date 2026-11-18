/**
 * Головна «до свята» (`/before`): дані сторінки з набору даних області (`web/data/*.json`), без бекенду.
 * Дизайн — `docs/bmad/.../ux-Time2Fest-2026-10-21/home-prefest/design-desktop.html` (рішення власника 2026-11-17).
 * Усі часи — мітки UTC (мс); у час відвідувача їх переводять компоненти (`formatClock` тощо).
 */
import type { Dataset, Gender, Ms } from '@/lib/data/types';
import { countryHref } from '@/lib/live/countryHref';

/**
 * Заглушка «Як святкувати» в `countries.json`: країна без власного тексту про традиції. Таку країну не публікуємо —
 * без «Сторінки країни», традицій і картки в «Як зустрічають Новий рік у світі» (концепція, розділ 5).
 */
export const HOW_TO_PLACEHOLDER = 'Тут ще збираємо';

export interface PrefestZone {
  id: string;
  /** 0…37 — порядок півночі (0 — Кіритіматі, UTC+14). */
  index: number;
  offsetMinutes: number;
  midnightMs: Ms;
  /** ISO країн поясу, за спаданням популярності. */
  countries: string[];
}

export interface PrefestTradition {
  id: string;
  title: string;
  text: string;
  iconId: string;
}

export interface PrefestCountry {
  iso: string;
  slug: string;
  name: string;
  flagCode: string;
  gender: Gender;
  popularity: number;
  /** Пояси країни в порядку півночі; `city` — головне місто країни в поясі (якщо є в розкладі). */
  zones: { zoneId: string; city?: string }[];
  /** Пояс головного міста країни (мовне дерево): про нього картка країни. Без нього — перший пояс країни. */
  main?: { zoneId: string; city?: string };
  /** Є власний текст про традиції — країну можна показувати з традиціями й посиланням на сторінку. */
  described: boolean;
  /** Лише для описаних країн; інакше порожньо. */
  traditions: PrefestTradition[];
  /** Текст «Як країна зустрічає Новий рік» (лише для описаних). */
  text: string;
  href: string;
}

/** Головне місце святкування в розкладі (рішення власника 2026-11-17). */
export interface MainCelebration {
  iso: string;
  flagCode: string;
  city: string;
  place: string;
  zoneId: string;
  midnightMs: Ms;
  zoneIndex: number;
  /** Місце для фото міста: `city:<ідентифікатор міста>` (`data/prelaunch/media.json`). */
  mediaSlot: string;
}

export interface PrefestModel {
  zones: PrefestZone[];
  zonesById: ReadonlyMap<string, PrefestZone>;
  /** Усі 246 країн і території, за абеткою (uk). */
  countries: PrefestCountry[];
  countriesByIso: ReadonlyMap<string, PrefestCountry>;
  /** Описані країни, за часом півночі (першого поясу країни). */
  described: PrefestCountry[];
  celebrations: MainCelebration[];
  firstMidnightMs: Ms;
  lastMidnightMs: Ms;
  /** Український текст із констант моделі (місто орієнтира) → мовою сторінки; на `/before` — без змін. */
  label: (uk: string) => string;
}

/** Налаштування мовного дерева (`app/[locale]`); `/before` будує модель без них. */
export interface PrefestModelOptions {
  /** Мова сортування назв країн. */
  locale?: string;
  /** Адреса сторінки країни. */
  href?: (country: { iso: string; slug: string }) => string;
  /** ISO → ідентифікатор головного міста країни (`data/prelaunch/countries.json`). */
  mainCityId?: (iso: string) => string | undefined;
  /** Український текст (місто, пам’ятка) → мовою сторінки. */
  label?: (uk: string) => string;
  /** Головні місця розкладу (за замовчуванням — `MAIN_CELEBRATIONS`). */
  celebrations?: typeof MAIN_CELEBRATIONS;
}

/**
 * Головні місця розкладу (рішення власника 2026-11-17): місто, пояс і пам’ятка. Набір може змінюватися;
 * місто без поясу в розкладі просто пропускається.
 */
export const MAIN_CELEBRATIONS: readonly { iso: string; city: string; place: string; zoneId: string }[] = [
  { iso: 'NZ', city: 'Окленд', place: 'Sky Tower', zoneId: 'utc+1300' },
  { iso: 'AU', city: 'Сідней', place: 'Harbour Bridge', zoneId: 'utc+1100' },
  { iso: 'JP', city: 'Токіо', place: 'дзвони храмів', zoneId: 'utc+0900' },
  { iso: 'AE', city: 'Дубай', place: 'Бурдж-Халіфа', zoneId: 'utc+0400' },
  { iso: 'DE', city: 'Берлін', place: 'Бранденбурзькі ворота', zoneId: 'utc+0100' },
  { iso: 'FR', city: 'Париж', place: 'Єлисейські Поля', zoneId: 'utc+0100' },
  { iso: 'IT', city: 'Рим', place: 'Колізей', zoneId: 'utc+0100' },
  { iso: 'GB', city: 'Лондон', place: 'Біг-Бен і London Eye', zoneId: 'utc+0000' },
  { iso: 'BR', city: 'Ріо-де-Жанейро', place: 'пляж Копакабана', zoneId: 'utc-0300' },
  { iso: 'US', city: 'Нью-Йорк', place: 'Таймс-сквер', zoneId: 'utc-0500' },
  { iso: 'US', city: 'Лос-Анджелес', place: 'Grand Park', zoneId: 'utc-0800' },
];

/** Орієнтири на стрічці 38 поясів («Коли Новий рік прийде до тебе?»). */
export const STRIP_LANDMARKS: readonly { city: string; zoneId: string }[] = [
  { city: 'Окленд', zoneId: 'utc+1300' },
  { city: 'Токіо', zoneId: 'utc+0900' },
  { city: 'Дубай', zoneId: 'utc+0400' },
  { city: 'Лондон', zoneId: 'utc+0000' },
  { city: 'Нью-Йорк', zoneId: 'utc-0500' },
];

/** Країни, що стоять першими в переліках (прапори «Ніч у русі», країна за замовчуванням); Росія й Білорусь — останніми. */
export const PREFERRED_ISO: readonly string[] = [
  'UA', 'GB', 'FR', 'DE', 'IT', 'ES', 'US', 'JP', 'AU', 'NZ', 'BR', 'AE', 'CN', 'IN', 'TR', 'PL', 'CA', 'MX', 'AR', 'KR', 'EG', 'ZA',
];
const LAST_ISO = new Set(['RU', 'BY']);

export function isDescribed(howTo: { text?: string } | undefined): boolean {
  const text = howTo?.text ?? '';
  return text.trim().length > 0 && !text.includes(HOW_TO_PLACEHOLDER);
}

/** Порядок «спершу відомі країни»: за `PREFERRED_ISO`, далі за популярністю; Росія й Білорусь — у кінці. */
export function byPreference(a: PrefestCountry, b: PrefestCountry): number {
  const rank = (c: PrefestCountry) => {
    if (LAST_ISO.has(c.iso)) return 1000;
    const i = PREFERRED_ISO.indexOf(c.iso);
    return i < 0 ? 100 : i;
  };
  return rank(a) - rank(b) || b.popularity - a.popularity;
}

export function buildPrefestModel(data: Dataset, options: PrefestModelOptions = {}): PrefestModel {
  const label = options.label ?? ((uk: string) => uk);
  const sortedZones = [...data.zones].sort((a, b) => a.midnightMs - b.midnightMs);
  const zoneIndex = new Map(sortedZones.map((z, i) => [z.id, i]));

  const countries: PrefestCountry[] = data.countries.map((c) => {
    const described = isDescribed(c.howTo);
    const zones = [...c.zoneIds]
      .filter((id) => zoneIndex.has(id))
      .sort((a, b) => (zoneIndex.get(a) ?? 0) - (zoneIndex.get(b) ?? 0))
      .map((zoneId) => {
        const own = data.cities.filter((x) => x.countryIso === c.iso && x.zoneId === zoneId);
        const main = own.find((x) => x.isCountryMain) ?? own[0];
        return main ? { zoneId, city: main.name.uk } : { zoneId };
      });
    const mainCity = data.citiesById.get(options.mainCityId?.(c.iso) ?? '');
    const main = mainCity && zoneIndex.has(mainCity.zoneId) ? { zoneId: mainCity.zoneId, city: mainCity.name.uk } : undefined;
    return {
      iso: c.iso,
      slug: c.slug,
      name: c.name.uk,
      flagCode: c.flagCode,
      gender: c.gender,
      popularity: c.popularity,
      zones,
      ...(main ? { main } : {}),
      described,
      traditions: described ? c.howTo.traditions.slice(0, 3) : [],
      text: described ? c.howTo.text : '',
      href: options.href ? options.href(c) : countryHref(c),
    };
  });
  countries.sort((a, b) => a.name.localeCompare(b.name, options.locale ?? 'uk'));
  const countriesByIso = new Map(countries.map((c) => [c.iso, c]));

  const zones: PrefestZone[] = sortedZones.map((z, index) => ({
    id: z.id,
    index,
    offsetMinutes: z.offsetMinutes,
    midnightMs: z.midnightMs,
    countries: countries
      .filter((c) => c.zones.some((x) => x.zoneId === z.id))
      .sort((a, b) => b.popularity - a.popularity)
      .map((c) => c.iso),
  }));
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  const firstZoneIndex = (c: PrefestCountry) => zonesById.get((c.main ?? c.zones[0])?.zoneId ?? '')?.index ?? 99;
  const described = countries
    .filter((c) => c.described)
    .sort((a, b) => firstZoneIndex(a) - firstZoneIndex(b) || b.popularity - a.popularity);

  // Назви міст у константах — українські; у мовному дереві каталог уже перекладено, тож місто шукаємо через `label`.
  const cityIdByName = new Map<string, string>();
  const mainCelebrations = options.celebrations ?? MAIN_CELEBRATIONS;
  for (const e of mainCelebrations) {
    const city = data.cities.find((x) => x.countryIso === e.iso && x.zoneId === e.zoneId && x.name.uk === label(e.city));
    if (city) cityIdByName.set(`${e.iso}|${e.city}`, city.id);
  }
  const celebrations: MainCelebration[] = mainCelebrations.flatMap((e) => {
    const z = zonesById.get(e.zoneId);
    const c = countriesByIso.get(e.iso);
    if (!z || !c) return [];
    const mediaSlot = `city:${cityIdByName.get(`${e.iso}|${e.city}`) ?? `${e.iso.toLowerCase()}-${e.zoneId}`}`;
    return [{ ...e, city: label(e.city), place: label(e.place), flagCode: c.flagCode, midnightMs: z.midnightMs, zoneIndex: z.index, mediaSlot }];
  });

  return {
    zones,
    zonesById,
    countries,
    countriesByIso,
    described,
    celebrations,
    firstMidnightMs: zones[0]?.midnightMs ?? 0,
    lastMidnightMs: zones.at(-1)?.midnightMs ?? 0,
    label,
  };
}

/** Пояс відвідувача за його зсувом у ніч свята (через браузер, без геолокації); не знайшли — UTC+2. */
export function viewerZone(model: PrefestModel, offsetMinutes: number): PrefestZone {
  return (
    model.zones.find((z) => z.offsetMinutes === offsetMinutes) ??
    model.zonesById.get('utc+0200') ??
    model.zones[0]!
  );
}

/** Країна за замовчуванням у «Коли Новий рік прийде до тебе?»: найвідоміша країна поясу відвідувача. */
export function defaultCountry(model: PrefestModel, zone: PrefestZone): { country: PrefestCountry; zoneId: string } {
  const list = zone.countries
    .map((iso) => model.countriesByIso.get(iso))
    .filter((c): c is PrefestCountry => Boolean(c))
    .sort(byPreference);
  const country = list[0] ?? model.countries[0]!;
  const zoneId = country.zones.some((z) => z.zoneId === zone.id) ? zone.id : (country.zones[0]?.zoneId ?? zone.id);
  return { country, zoneId };
}

/** Скільки різних країн і територій уже зустріли Новий рік до поясу з індексом `index` (не включно). */
export function countriesMetBefore(model: PrefestModel, index: number): number {
  const seen = new Set<string>();
  for (const z of model.zones.slice(0, index)) for (const iso of z.countries) seen.add(iso);
  return seen.size;
}
