// Дані передстартового сайту, яких немає в каталозі (`data/countries.json`, `data/schedule.json` не змінюються):
//   data/prelaunch/countries.json   — ISO → англійська адреса сторінки (`urlSlug`) і головне місто країни (`mainCityId`);
//   data/prelaunch/names/<мова>.json — назви країн (CLDR), міст і пам’яток мовою сторінки.
// Запуск: node scripts/prelaunch/gen-data.mjs [--check]. `--check` нічого не пише й падає, якщо файли застаріли.
// Правки вручну — лише в таблицях нижче: файли в data/prelaunch/ перезаписуються.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
/** Назви міст і місць іспанською й французькою, що відрізняються від англійських (Londres, Tokio, Pékin…). */
const NAMES_ESFR = JSON.parse(fs.readFileSync(new URL('./names-esfr.json', import.meta.url), 'utf8'));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const countries = read('data/countries.json').countries;
const schedule = read('data/schedule.json');

const LOCALES = ['en', 'uk', 'es', 'fr'];

/** Адреса країни, коли назва CLDR для адреси не годиться (дужки, «St.», службові уточнення). */
const SLUG_OVERRIDES = {
  BL: 'saint-barthelemy',
  CD: 'dr-congo',
  CG: 'congo',
  HK: 'hong-kong',
  KN: 'saint-kitts-and-nevis',
  LC: 'saint-lucia',
  MF: 'saint-martin',
  MM: 'myanmar',
  MO: 'macao',
  PM: 'saint-pierre-and-miquelon',
  PS: 'palestine',
  SH: 'saint-helena',
  TR: 'turkey',
  UM: 'us-outlying-islands',
  VC: 'saint-vincent-and-the-grenadines',
  VI: 'us-virgin-islands',
};

/** Головне місто країни з кількома поясами: про нього картка країни й сторінка країни (план, розділ 9, пункт 2). */
const MAIN_CITY = {
  AU: 'sydney',
  BR: 'rio-de-janeiro',
  CA: 'toronto',
  CD: 'kinshasa',
  CL: 'santiago',
  CN: 'beijing',
  EC: 'guayaquil',
  ES: 'madrid',
  FM: 'pohnpei',
  GL: 'nuuk',
  ID: 'jakarta',
  KI: 'tarawa',
  MN: 'ulaanbaatar',
  MX: 'mexico-city',
  NZ: 'auckland',
  PF: 'tahiti',
  PG: 'port-moresby',
  PT: 'lisbon',
  RU: 'moscow',
  UM: 'midway',
  US: 'new-york',
};

/** Назви країн, які сайт уже пише інакше, ніж CLDR (коротка звична форма). */
const NAME_OVERRIDES = {
  en: {
    HK: 'Hong Kong',
    MO: 'Macao',
    MM: 'Myanmar',
    CD: 'DR Congo',
    CG: 'Republic of the Congo',
    PS: 'Palestine',
    TR: 'Turkey',
  },
  es: {
    HK: 'Hong Kong',
    MO: 'Macao',
    MM: 'Myanmar',
    CD: 'RD del Congo',
    TL: 'Timor Oriental',
    CG: 'República del Congo',
    PS: 'Palestina',
  },
  fr: {
    HK: 'Hong Kong',
    MO: 'Macao',
    MM: 'Myanmar',
    CD: 'RD Congo',
    CG: 'République du Congo',
    PS: 'Palestine',
  },
};

/** Англійські назви міст, які не виходять з ідентифікатора («new-york» → «New York» виходить сам). */
const CITY_EN = {
  andorra: 'Andorra la Vella',
  asuncion: 'Asunción',
  azores: 'Azores',
  'baker-island': 'Baker Island',
  bogota: 'Bogotá',
  canary: 'Canary Islands',
  cancun: 'Cancún',
  chagos: 'Chagos Archipelago',
  chatham: 'Chatham Islands',
  chisinau: 'Chișinău',
  christmas: 'Christmas Island',
  cocos: 'Cocos Islands',
  'dar-es-salaam': 'Dar es Salaam',
  djibouti: 'Djibouti City',
  easter: 'Easter Island',
  'el-aaiun': 'El Aaiún',
  faroe: 'Tórshavn',
  'fernando-de-noronha': 'Fernando de Noronha',
  'fort-de-france': 'Fort-de-France',
  galapagos: 'Galápagos',
  gambier: 'Gambier Islands',
  gaza: 'Gaza',
  guatemala: 'Guatemala City',
  'ho-chi-minh': 'Ho Chi Minh City',
  'isle-of-man': 'Isle of Man',
  kuwait: 'Kuwait City',
  lome: 'Lomé',
  luxembourg: 'Luxembourg City',
  macau: 'Macao',
  maldives: 'Malé',
  marquesas: 'Marquesas Islands',
  'mata-utu': 'Mata-Utu',
  mazatlan: 'Mazatlán',
  midway: 'Midway Atoll',
  ndjamena: 'N’Djamena',
  norfolk: 'Norfolk Island',
  noumea: 'Nouméa',
  'pago-pago': 'Pago Pago',
  panama: 'Panama City',
  pitcairn: 'Pitcairn Islands',
  'port-au-prince': 'Port-au-Prince',
  'port-of-spain': 'Port of Spain',
  'porto-novo': 'Porto-Novo',
  'rio-de-janeiro': 'Rio de Janeiro',
  'san-jose-cr': 'San José',
  'sao-tome': 'São Tomé',
  'saint-denis': 'Saint-Denis',
  'south-georgia': 'South Georgia',
  'st-barthelemy': 'Gustavia',
  'st-georges': 'St. George’s',
  'st-helena': 'Jamestown',
  'st-johns': 'St. John’s',
  'st-johns-ag': 'St. John’s',
  thule: 'Qaanaaq',
  tirane: 'Tirana',
  vatican: 'Vatican City',
  'victoria-sc': 'Victoria',
  yaounde: 'Yaoundé',
  zurich: 'Zurich',
};

/** Пам’ятки головних місць розкладу (`MAIN_CELEBRATIONS` у lib/prefest/model.ts): ключ — український текст. */
const PLACES = {
  'Sky Tower': { en: 'Sky Tower' },
  'Harbour Bridge': { en: 'Harbour Bridge' },
  'дзвони храмів': { en: 'temple bells' },
  'Бурдж-Халіфа': { en: 'Burj Khalifa' },
  'Бранденбурзькі ворота': { en: 'Brandenburg Gate' },
  'Єлисейські Поля': { en: 'Champs-Élysées' },
  Колізей: { en: 'the Colosseum' },
  'Біг-Бен і London Eye': { en: 'Big Ben and the London Eye' },
  'пляж Копакабана': { en: 'Copacabana Beach' },
  'Таймс-сквер': { en: 'Times Square' },
  'Grand Park': { en: 'Grand Park' },
  'Лас-Вегас-Стріп': { en: 'the Las Vegas Strip', es: 'el Strip de Las Vegas', fr: 'le Strip de Las Vegas' },
};

const slugify = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[’'.]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Апостроф як на сайті: U+2019.
const tidy = (s) => s.replace(/[ʼ']/g, '’');
const titleCase = (id) =>
  id
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const cities = [];
for (const z of schedule.zones)
  for (const c of z.countries)
    for (const city of c.cities) cities.push({ ...city, iso: c.iso, zoneId: z.id });

const display = Object.fromEntries(
  LOCALES.map((l) => [l, new Intl.DisplayNames([l], { type: 'region' })]),
);
const countryName = (locale, c) => {
  if (locale === 'uk') return c.name.uk;
  return NAME_OVERRIDES[locale]?.[c.iso] ?? tidy(display[locale].of(c.iso) ?? c.name.uk);
};

const prelaunchCountries = {};
const seen = new Map();
for (const c of [...countries].sort((a, b) => a.iso.localeCompare(b.iso))) {
  const urlSlug = SLUG_OVERRIDES[c.iso] ?? slugify(countryName('en', c));
  if (!urlSlug) throw new Error(`gen-data: empty urlSlug for ${c.iso}`);
  if (seen.has(urlSlug))
    throw new Error(`gen-data: urlSlug "${urlSlug}" is used by ${seen.get(urlSlug)} and ${c.iso}`);
  seen.set(urlSlug, c.iso);
  const own = cities.filter((x) => x.iso === c.iso);
  const mainCityId = MAIN_CITY[c.iso] ?? (own.length === 1 ? own[0].id : undefined);
  if (!mainCityId || !own.some((x) => x.id === mainCityId))
    throw new Error(`gen-data: no main city for ${c.iso} — add it to MAIN_CITY`);
  prelaunchCountries[c.iso] = { urlSlug, mainCityId };
}

const files = {
  'data/prelaunch/countries.json': { version: 1, countries: prelaunchCountries },
};
for (const locale of LOCALES) {
  if (locale === 'uk') continue; // українські назви — у каталозі
  files[`data/prelaunch/names/${locale}.json`] = {
    locale,
    countries: Object.fromEntries(
      [...countries]
        .sort((a, b) => a.iso.localeCompare(b.iso))
        .map((c) => [c.iso, countryName(locale, c)]),
    ),
    // Міста: усталені назви мови (`names-esfr.json`, глосарій задачі C), інакше — англійська.
    cities: Object.fromEntries(
      cities
        .map((c) => [c.id, NAMES_ESFR.cities[locale]?.[c.id] ?? CITY_EN[c.id] ?? titleCase(c.id)])
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
    places: Object.fromEntries(
      Object.entries(PLACES).map(([uk, t]) => [uk, NAMES_ESFR.places[locale]?.[uk] ?? t[locale] ?? t.en]),
    ),
  };
}

const check = process.argv.includes('--check');
let stale = 0;
for (const [rel, value] of Object.entries(files)) {
  const text = `${JSON.stringify(value, null, 1)}\n`;
  const file = path.join(root, rel);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current === text) continue;
  stale += 1;
  if (check) console.error(`gen-data: ${rel} is stale — run node scripts/prelaunch/gen-data.mjs`);
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    console.log(`gen-data: wrote ${rel}`);
  }
}
if (check && stale) process.exit(1);
if (!stale) console.log('gen-data: up to date');
