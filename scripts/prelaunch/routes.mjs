// Список дозволених сторінок передстартового сайту (план, розділи 3–5). Саме дозволених, а не заборонених:
// у `out-prelaunch` потрапляє лише те, що тут названо. Спільне для збирання (`build.mjs`) і перевірки (`check.mjs`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const LOCALES = ['en', 'uk', 'es', 'fr'];
export const DEFAULT_LOCALE = 'en';
/** Готовність мов — те саме, що `LOCALE_STATUS` у `i18n/locales.ts` (тест `tests/unit/prelaunch/locales.test.ts` звіряє). */
export const LOCALE_STATUS = { en: 'draft', uk: 'ready', es: 'pending', fr: 'pending' };

/** Сторінки без мови (шлях зі скісними рисками). */
export const STATIC_ROUTES = [
  '/',
  '/countries/',
  '/pass/',
  '/toasts/',
  '/about/',
  '/privacy/',
  '/cookies/',
  '/terms/',
];

/** Теки з `public/`, потрібні передстартовому сайту (звуки ефіру й копія завантажувача YouTube — ні). */
export const PUBLIC_ENTRIES = ['_next', 'brand', 'flags', '_headers'];
/** Необов’язкові теки: є — копіюємо (фото й відео задачі C у `public/media/`). */
export const OPTIONAL_PUBLIC_ENTRIES = ['media'];

export function countrySlugs() {
  const file = JSON.parse(
    fs.readFileSync(path.join(root, 'data/prelaunch/countries.json'), 'utf8'),
  );
  return Object.values(file.countries).map((c) => c.urlSlug);
}

/** Мови збірки для домену: без `pending`, або явний перелік (`T2F_PRELAUNCH_LOCALES=en,uk,es,fr`). */
export function prelaunchLocales(only = process.env.T2F_PRELAUNCH_LOCALES) {
  if (only) {
    const picked = only.split(',').map((x) => x.trim());
    const found = LOCALES.filter((l) => picked.includes(l));
    if (found.length) return found;
  }
  return LOCALES.filter((l) => LOCALE_STATUS[l] !== 'pending');
}

/** Усі дозволені сторінки однієї мови (шляхи без мови). */
export function allowedRoutes() {
  return [...STATIC_ROUTES, ...countrySlugs().map((s) => `/country/${s}/`)];
}

/** Де сторінка мови лежить у `out-prelaunch`: головна мова — в корені, решта — під `/<мова>/`. */
export function publicPath(locale, route) {
  return locale === DEFAULT_LOCALE ? route : `/${locale}${route}`;
}
