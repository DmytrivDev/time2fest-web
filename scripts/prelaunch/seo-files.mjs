// Службові файли пошуковиків і краю для `out-prelaunch` (SEO-звіт, розділи 6–7; план, розділ 6):
// `robots.txt`, `sitemap.xml` (лише відкриті сторінки, з hreflang-альтернативами), `_redirects` (Cloudflare Pages:
// 301 зі старих адрес), правка `_headers` (знято `X-Robots-Tag: noindex` у збірці для домену).
// Чого `_redirects` не вміє (410, 301 з адреси без кінцевої риски) — описано в `docs/site/prelaunch-edge.md`.
import fs from 'node:fs';
import path from 'node:path';
import { COUNTRY_PAGES_INDEXED } from '../../lib/prelaunch/pages.mjs';
import { DEFAULT_LOCALE, STATIC_ROUTES, root } from './routes.mjs';

export const SITE_ORIGIN = 'https://time2fest.com';

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));

/** Шлях сторінки мовою (головна мова — без префікса). */
export const localePath = (locale, route) =>
  locale === DEFAULT_LOCALE ? route : `/${locale}${route}`;

/**
 * Відкриті сторінки (SEO-звіт, розділ 6): головна, список країн, пас, тости, документи — і країни з власною
 * розповіддю кожною мовою збірки (те саме правило, що `countryIndexable` у `lib/prelaunch/siteData.ts`).
 */
export function openRoutes(locales, countriesIndexed = COUNTRY_PAGES_INDEXED) {
  const countries = readJson('data/prelaunch/countries.json').countries;
  const stories = locales.map((l) => {
    const file = path.join(root, 'data', 'prelaunch', 'content', `${l}.json`);
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  });
  const described = Object.keys(countries)
    .filter((iso) => stories.every((s) => s[iso]))
    .sort();
  if (!countriesIndexed) return [...STATIC_ROUTES];
  return [...STATIC_ROUTES, ...described.map((iso) => `/country/${countries[iso].urlSlug}/`)];
}

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** `sitemap.xml`: кожна відкрита сторінка кожною мовою + взаємні `xhtml:link` (усі мови й `x-default`). */
export function sitemapXml(locales, countriesIndexed = COUNTRY_PAGES_INDEXED) {
  const routes = openRoutes(locales, countriesIndexed);
  const urls = [];
  for (const route of routes) {
    const alts = locales.map((l) => [l, `${SITE_ORIGIN}${localePath(l, route)}`]);
    if (locales.includes(DEFAULT_LOCALE))
      alts.push(['x-default', `${SITE_ORIGIN}${localePath(DEFAULT_LOCALE, route)}`]);
    for (const l of locales) {
      urls.push(
        [
          '  <url>',
          `    <loc>${xml(`${SITE_ORIGIN}${localePath(l, route)}`)}</loc>`,
          ...alts.map(
            ([hl, href]) => `    <xhtml:link rel="alternate" hreflang="${hl}" href="${xml(href)}"/>`,
          ),
          '  </url>',
        ].join('\n'),
      );
    }
  }
  return {
    count: urls.length,
    text: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      ...urls,
      '</urlset>',
      '',
    ].join('\n'),
  };
}

/** `robots.txt`: домен — дозволено все й адреса sitemap; перегляд — закрито (сторінки й так `noindex`). */
export function robotsTxt(index) {
  return index
    ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`
    : 'User-agent: *\nDisallow: /\n';
}

/** Префікси торішнього сайту: англійська без префікса й `/en/…`, решта мов — свої. */
const OLD_PREFIXES = [
  ['', ''],
  ['/uk', '/uk'],
  ['/es', '/es'],
  ['/fr', '/fr'],
  ['/en', ''],
];

/** Шляхи входу й кабінету торішнього сайту — на головну (сторінок немає; були `noindex`). */
const ACCOUNT_PATHS = [
  '/login',
  '/register',
  '/forget-password',
  '/reset-password',
  '/login-success',
  '/pending-payment',
  '/profile',
];

/**
 * `_redirects` (Cloudflare Pages): 301 зі старих адрес одразу на кінцеву (SEO-звіт, розділ 7). Кожне правило — для
 * всіх чотирьох мов і для `/en/…`. Старий слаг країни з не-ASCII — і як є, і закодованим (так його просить браузер).
 */
export function redirectsFile() {
  const countries = readJson('data/prelaunch/countries.json').countries;
  const old = readJson('content/prelaunch/old-country-slugs.json').slugs;
  const rules = [];
  // Правила з `*` — окремо й у кінці: Cloudflare (Workers Static Assets) рахує динамічними (ліміт 100) усі правила,
  // що стоять після першого правила з `*`. Джерела точних і динамічних правил не перетинаються, тож порядок безпечний.
  const dynamicRules = [];
  // Кожне джерело — і без кінцевої риски, і з нею: на краї правило зони «без риски → з рискою» (301) спрацьовує раніше
  // за `_redirects`, тож стара адреса `/agreement` приходить сюди вже як `/agreement/`.
  const seen = new Set();
  const add = (from, to) => {
    const bare = from.replace(/\/+$/, '');
    for (const form of [bare, `${bare}/`])
      for (const f of new Set([form, encodeURI(form)])) {
        if (seen.has(f)) continue;
        seen.add(f);
        rules.push(`${f} ${to} 301`);
      }
  };
  for (const [p, t] of OLD_PREFIXES) {
    const home = `${t}/`;
    add(`${p}/country`, `${t}/countries/`);
    add(`${p}/country/`, `${t}/countries/`);
    for (const [slug, iso] of Object.entries(old)) {
      const now = countries[iso]?.urlSlug;
      if (now === slug) continue;
      const to = now ? `${t}/country/${now}/` : `${t}/countries/`;
      add(`${p}/country/${slug}`, to);
      add(`${p}/country/${slug}/`, to);
    }
    for (const doc of ['/agreement', '/disclaimer']) add(`${p}${doc}`, `${t}/terms/`);
    // «Про проєкт» до окремого дизайну немає (рішення 2026-11-18) — про сайт і контакти розповідає головна.
    for (const x of ['/about', '/contact']) add(`${p}${x}`, home);
    for (const x of ['/ambassadors', '/ambassadors/list', '/become-ambassador']) add(`${p}${x}`, home);
    for (const x of ACCOUNT_PATHS) add(`${p}${x}`, home);
    dynamicRules.push(`${p}/profile/* ${home} 301`);
  }
  rules.push('/api/sitemap.xml /sitemap.xml 301');
  // Решта `/en/…` — та сама адреса без префікса (після всіх точних правил: діє перше збігле).
  rules.push('/en / 301');
  rules.push(...dynamicRules);
  rules.push('/en/* /:splat 301');
  const header = [
    '# Старі адреси time2fest.com → нові (SEO-звіт, розділ 7). Згенеровано build:prelaunch (scripts/prelaunch/seo-files.mjs).',
    '# 410 для особистих сторінок амбасадорів і 301 з адрес без кінцевої риски — на краї (docs/site/prelaunch-edge.md).',
  ];
  return { count: rules.length, dynamic: rules.filter((r) => r.includes('*')).length, text: [...header, ...rules, ''].join('\n') };
}

/** `_headers` збірки для домену — без загального `X-Robots-Tag: noindex` (відкриті сторінки керуються `<meta robots>`). */
export function headersForIndex(text) {
  // `[ \t]*`, не `\s*`: у файлі з CRLF `^` збігається й після `\r`, і `\s*` з'їдав би перенос рядка шляху.
  return text.replace(/^[ \t]*X-Robots-Tag:[^\r\n]*\r?\n/m, '');
}
