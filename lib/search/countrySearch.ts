/**
 * Пошук країн і міст усіма мовами сайту (рішення власника 2026-11-09): українська, англійська, іспанська, французька.
 * Раніше в «Країни й міста» знаходилися лише українські назви — «nepal», «India», «new york», «Kyiv» давали «Нічого не знайшли».
 *
 * Без нових даних:
 *  - назви країн іншими мовами — з `Intl.DisplayNames` за `iso` + короткий словник поширених назв («Britain», «Holland», «USA»);
 *  - міста: транслітерація українських назв латиницею (КМУ-2010: Київ → Kyiv), англійська назва з id міста в даних
 *    (`new-york` → «new york»), словник додаткових назв великих міст (англійська, іспанська, французька).
 * Порівняння нечутливе до регістру, діакритики («São Paulo» = «sao paulo»), дефісів, пробілів і апострофів.
 * Індекс будується один раз і мемоізується (`WeakMap` за набором даних; рядки країн — за `iso`).
 */
import type { Dataset } from '@/lib/data/types';

/** Нормалізація для порівняння: нижній регістр, без діакритики, дефіси/апострофи/крапки → один пробіл. */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase('uk')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’ʼ'`.,]/g, '')
    .replace(/[-–—_\s]+/g, ' ')
    .trim();
}

// ── Транслітерація (КМУ №55, 2010) ─────────────────────────────────────────

const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'y', і: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
};
/** Літери, що мають різний вигляд на початку слова й усередині: [початок, усередині]. */
const TR_EDGE: Record<string, [string, string]> = { є: ['ye', 'ie'], ї: ['yi', 'i'], й: ['y', 'i'], ю: ['yu', 'iu'], я: ['ya', 'ia'] };

/** Українська назва → латиниця за КМУ-2010; `ь`, апостроф — пропускаються; `зг` → `zgh`. */
export function translit(uk: string): string {
  const s = uk.toLocaleLowerCase('uk');
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    const prev = s[i - 1];
    const wordStart = i === 0 || !prev || !/\p{L}/u.test(prev);
    if (ch === 'ь' || /[’ʼ'`]/.test(ch)) continue;
    if (ch === 'г' && prev === 'з') {
      out += 'gh';
      continue;
    }
    const edge = TR_EDGE[ch];
    if (edge) out += wordStart ? edge[0] : edge[1];
    else out += TR[ch] ?? ch;
  }
  return out;
}

/** Спрощений варіант «як пишуть люди»: ю → yu, я → ya, є → ye, ї → yi, й → y усюди (Kyiv, Yuzhnyi). */
function translitLoose(uk: string): string {
  return translit(uk.replace(/ю/gi, 'yu').replace(/я/gi, 'ya').replace(/є/gi, 'ye').replace(/ї/gi, 'yi').replace(/й/gi, 'y'));
}

// ── Країни ─────────────────────────────────────────────────────────────────

/** Поширені назви, яких немає в `Intl.DisplayNames`. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  GB: ['Britain', 'Great Britain', 'UK', 'England', 'Scotland', 'Wales', 'Inglaterra', 'Angleterre', 'Reino Unido', 'Royaume-Uni'],
  US: ['USA', 'U.S.', 'America', 'United States of America', 'Estados Unidos', 'EEUU', 'Etats-Unis', 'États-Unis'],
  NL: ['Holland', 'Holanda', 'Hollande', 'Netherlands'],
  CZ: ['Czech Republic', 'Czechia', 'Chequia', 'Tchequie'],
  MM: ['Burma', 'Birmania', 'Birmanie'],
  CI: ['Ivory Coast', 'Costa de Marfil', 'Cote dIvoire'],
  TR: ['Turkey', 'Turquia', 'Turquie'],
  MK: ['Macedonia', 'North Macedonia'],
  SZ: ['Swaziland', 'Eswatini', 'Suazilandia'],
  TL: ['East Timor', 'Timor-Leste', 'Timor Oriental'],
  CV: ['Cape Verde', 'Cabo Verde'],
  KR: ['South Korea', 'Corea del Sur', 'Coree du Sud', 'Korea'],
  KP: ['North Korea', 'Corea del Norte', 'Coree du Nord'],
  AE: ['UAE', 'Emirates', 'Emiratos', 'Emirats'],
  RU: ['Russia', 'Rusia', 'Russie'],
  VA: ['Vatican', 'Vaticano', 'Holy See'],
  CD: ['DR Congo', 'DRC', 'Congo Kinshasa'],
  CG: ['Congo Brazzaville'],
  PS: ['Palestine', 'Gaza', 'West Bank'],
  BY: ['Belarus', 'Bielorrusia', 'Bielorussie', 'Byelorussia'],
  MD: ['Moldova', 'Moldavia', 'Moldavie'],
  UA: ['Ukraine', 'Ucrania'],
};

const LANGS = ['en', 'es', 'fr'] as const;
let displayNames: Intl.DisplayNames[] | null = null;
function getDisplayNames(): Intl.DisplayNames[] {
  if (displayNames) return displayNames;
  displayNames = [];
  for (const l of LANGS) {
    try {
      displayNames.push(new Intl.DisplayNames([l], { type: 'region' }));
    } catch {
      // середовище без Intl.DisplayNames — лишаються українські назви й словник
    }
  }
  return displayNames;
}

const countryCache = new Map<string, string[]>();
/** Рядки країни для пошуку (без української назви): en, es, fr, словник, `iso`. Усе згорнуто `fold`. */
export function countryForeignTerms(iso: string): string[] {
  const key = iso.toUpperCase();
  const hit = countryCache.get(key);
  if (hit) return hit;
  const terms = new Set<string>();
  for (const dn of getDisplayNames()) {
    try {
      const n = dn.of(key);
      if (n && n !== key) terms.add(fold(n));
    } catch {
      // нестандартний код (напр. `earth`) — пропускаємо
    }
  }
  for (const a of COUNTRY_ALIASES[key] ?? []) terms.add(fold(a));
  const out = [...terms];
  countryCache.set(key, out);
  return out;
}

/** Країна `iso` (з українською назвою `ukName`) підходить під запит `q` (уже згорнутий `fold`). */
export function matchesCountryName(iso: string, ukName: string, q: string): boolean {
  if (!q) return true;
  if (fold(ukName).includes(q)) return true;
  if (q.length === 2 && q === iso.toLowerCase()) return true;
  return countryForeignTerms(iso).some((t) => t.includes(q));
}

// ── Міста ──────────────────────────────────────────────────────────────────

/** Додаткові назви великих міст (за `id` міста в даних): англійська, іспанська, французька, поширені варіанти. */
export const CITY_NAMES: Record<string, string[]> = {
  'new-york': ['New York City', 'NYC', 'Nueva York'],
  london: ['Londres'],
  paris: ['París'],
  tokyo: ['Tokio'],
  sydney: ['Sídney'],
  'rio-de-janeiro': ['Rio', 'Río de Janeiro'],
  dubai: ['Dubái', 'Dubaï'],
  moscow: ['Moscú', 'Moscou'],
  'new-delhi': ['Delhi', 'Nueva Delhi'],
  beijing: ['Peking', 'Pekín', 'Pékin'],
  seoul: ['Seúl', 'Séoul'],
  berlin: ['Berlín'],
  rome: ['Roma'],
  madrid: [],
  cairo: ['El Cairo', 'Le Caire'],
  istanbul: ['Estambul', 'Constantinople'],
  'los-angeles': ['Los Ángeles', 'LA'],
  toronto: [],
  'mexico-city': ['Ciudad de México', 'Mexico', 'CDMX'],
  'buenos-aires': [],
  kyiv: ['Kiev'],
  warsaw: ['Warszawa', 'Varsovia', 'Varsovie'],
  vienna: ['Wien', 'Viena', 'Vienne'],
  prague: ['Praha', 'Praga'],
  lisbon: ['Lisboa', 'Lisbonne'],
  athens: ['Atenas', 'Athènes'],
  brussels: ['Bruxelles', 'Bruselas'],
  copenhagen: ['Copenhague', 'København'],
  stockholm: ['Estocolmo'],
  zurich: ['Zürich', 'Zúrich'],
  singapore: ['Singapur', 'Singapour'],
  'hong-kong': ['Hongkong'],
  bangkok: ['Bangkok'],
  'ho-chi-minh': ['Ho Chi Minh City', 'Saigon'],
  jerusalem: ['Jerusalén', 'Jérusalem'],
  tehran: ['Teherán', 'Téhéran'],
  baghdad: ['Bagdad'],
  damascus: ['Damasco', 'Damas'],
  johannesburg: ['Johannesburgo'],
  nairobi: [],
  lagos: [],
  havana: ['La Habana', 'La Havane'],
  'san-juan': [],
  'port-of-spain': [],
  'st-johns': ["Saint John's", 'San Juan de Terranova'],
  'st-johns-ag': ["Saint John's", 'Antigua'],
  chicago: ['Chicago'],
  vancouver: [],
  honolulu: [],
  anchorage: [],
  'saint-denis': ['St Denis'],
  'victoria-sc': ['Victoria', 'Seychelles'],
  'san-jose-cr': ['San Jose', 'San José'],
  tbilisi: ['Tiflis'],
  yerevan: ['Erevan', 'Ereván'],
  tallinn: [],
  'dar-es-salaam': [],
  kamchatka: ['Petropavlovsk-Kamchatsky'],
  chisinau: ['Kishinev', 'Chisináu'],
  minsk: [],
  'saint-petersburg': ['St Petersburg', 'San Petersburgo'],
};

/** Англійська назва з id міста: `new-york` → `new york`; `st-johns` → ще й `saint johns`. */
function cityEnglish(id: string): string[] {
  const base = id.replace(/-/g, ' ');
  const out = [base];
  if (/^st /.test(base)) out.push(base.replace(/^st /, 'saint '));
  return out;
}

export interface SearchIndex {
  /** Згорнуті рядки міста за його українською назвою (різні міста з однаковою назвою — разом). */
  cityTerms: ReadonlyMap<string, readonly string[]>;
}

const indexCache = new WeakMap<Dataset, SearchIndex>();
/** Індекс пошуку для набору даних: будується один раз. */
export function getSearchIndex(data: Dataset): SearchIndex {
  const hit = indexCache.get(data);
  if (hit) return hit;
  const cityTerms = new Map<string, string[]>();
  for (const c of data.cities) {
    const uk = c.name.uk;
    const terms = cityTerms.get(uk) ?? [];
    terms.push(fold(uk), fold(translit(uk)), fold(translitLoose(uk)));
    for (const n of cityEnglish(c.id)) terms.push(fold(n));
    for (const n of CITY_NAMES[c.id] ?? []) terms.push(fold(n));
    if (c.landmark) terms.push(fold(c.landmark.uk));
    cityTerms.set(uk, terms);
  }
  for (const [k, v] of cityTerms) cityTerms.set(k, [...new Set(v)]);
  const index: SearchIndex = { cityTerms };
  indexCache.set(data, index);
  return index;
}

/** Місто з українською назвою `ukName` підходить під запит `q` (згорнутий `fold`). */
export function matchesCityName(index: SearchIndex, ukName: string, q: string): boolean {
  if (!q) return true;
  const terms = index.cityTerms.get(ukName);
  if (terms) return terms.some((t) => t.includes(q));
  return fold(ukName).includes(q) || fold(translit(ukName)).includes(q);
}
