// Перевірка збірки передстартового сайту: node scripts/prelaunch/check.mjs [out-prelaunch] [--strict]
// Помилки (код 1):
//   - перелік сторінок не дорівнює списку дозволених (зайва чи відсутня сторінка);
//   - у шляхах є вхід, оплата, ефір, кабінет, тестові дверцята чи машина часу; у файлах — їхні підписи;
//   - внутрішнє посилання чи файл (`href`, `src`) веде в нікуди;
//   - на сторінці не рівно один `<h1>`, немає `<title>` чи опису, `<html lang>` не збігається з мовою сторінки;
//   - на сторінці іншої мови лишився український текст.
// Попередження (з `--strict` — помилки): заглушки фото (`data-media-placeholder`), незаповнені місця `[[…]]`,
// слова-заглушки («сток», «заглушк»), мова-чернетка.
// Пошуковики (SEO-звіт, розділ 8): canonical на себе; у відкритих сторінок — взаємний hreflang (усі мови + x-default),
// без noindex (ключ `--index`) і title до 65 знаків; у закритих — noindex і без hreflang; sitemap = рівно відкриті
// сторінки; JSON-LD читається; og:image є; robots.txt є; кожне правило `_redirects` веде на наявну сторінку.
import fs from 'node:fs';
import path from 'node:path';
import {
  allowedRoutes,
  DEFAULT_LOCALE,
  LOCALE_STATUS,
  LOCALES,
  prelaunchLocales,
  publicPath,
  root,
} from './routes.mjs';
import { localePath, openRoutes, SITE_ORIGIN } from './seo-files.mjs';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const index = args.includes('--index');
const out = path.resolve(root, args.find((a) => !a.startsWith('--')) ?? 'out-prelaunch');
if (!fs.existsSync(out)) {
  console.error(`check:prelaunch: немає теки ${out} — спершу pnpm build:prelaunch`);
  process.exit(2);
}

const errors = [];
const warnings = [];
const err = (m) => errors.push(m);
const warn = (m) => warnings.push(m);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else yield full;
  }
}
const rel = (file) => `/${path.relative(out, file).split(path.sep).join('/')}`;
const files = [...walk(out)];
const fileSet = new Set(files.map(rel));

// ── 1. Сторінки = список дозволених ────────────────────────────────────────────────────────────────────────────
const locales = prelaunchLocales();
const expected = new Map(); // шлях файла → { locale, route }
for (const locale of locales) {
  for (const route of allowedRoutes())
    expected.set(`${publicPath(locale, route)}index.html`, { locale, route });
  expected.set(`${publicPath(locale, '/')}404.html`, { locale, route: '/404/' });
}
const html = files.filter((f) => f.endsWith('.html')).map(rel);
for (const p of html) if (!expected.has(p)) err(`зайва сторінка: ${p}`);
for (const p of expected.keys()) if (!fileSet.has(p)) err(`немає сторінки: ${p}`);

// ── 2. Заборонені шляхи й підписи ──────────────────────────────────────────────────────────────────────────────
// Сегменти адрес повного сайту, яких на передстартовому бути не може (усюди, крім `_next`).
const FORBIDDEN_SEGMENTS = [
  'login',
  'signup',
  'register',
  'auth',
  'account',
  'profile',
  'payments',
  'pay',
  'checkout',
  'order',
  'orders',
  'room',
  'live',
  'schedule',
  'passport',
  'rating',
  'support',
  'tv',
  'tv-info',
  'notifications',
  'help',
  // 'rules' — з 2026-11-26 відкрита сторінка «Правила чату» (вимога платіжного провайдера).
  'before',
  'api',
  'test',
  'dev',
  'doors',
  'time-machine',
  'yt',
  'sounds',
];
// Сторінка країни має власний слаг (є країни на кшталт «georgia»), тож сегмент перевіряємо поза `/country/<слаг>/`.
for (const p of fileSet) {
  if (p.startsWith('/_next/')) continue;
  const segs = p
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/\.(html|txt)$/, ''));
  const iCountry = segs.indexOf('country');
  segs.forEach((seg, i) => {
    if (iCountry >= 0 && i === iCountry + 1) return;
    if (LOCALES.includes(seg) && i === 0) return;
    if (FORBIDDEN_SEGMENTS.includes(seg)) err(`заборонений шлях: ${p}`);
  });
}
// Підписи коду, якого в збірці бути не може: машина часу й тестові дверцята сайту, імітація, вхід, оплата, чат.
const SIGNATURES = [
  ['машина часу', /Машина часу|timeMachine|__t2f\b/],
  ['тестові дверцята', /\/api\/test\/|testDoors|X-T2F-Test/i],
  ['вхід і кабінет', /t2f:auth:v\d|\/api\/auth\//],
  ['оплата', /\/api\/orders|paypro\.global\/|checkoutUrl/i],
  ['ефір і чат', /centrifug|youtube\.com\/iframe_api|\/api\/realtime\//i],
];
for (const file of files) {
  if (!/\.(js|html|txt|json)$/.test(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const [name, re] of SIGNATURES) if (re.test(text)) err(`підпис «${name}» у ${rel(file)}`);
}

// ── 3. Сторінки: посилання, заголовки, мова, заглушки ──────────────────────────────────────────────────────────
const resolves = (url) => {
  const clean = url.split('#')[0].split('?')[0];
  if (clean === '') return true;
  if (fileSet.has(clean)) return true;
  return clean.endsWith('/')
    ? fileSet.has(`${clean}index.html`)
    : fileSet.has(`${clean}/index.html`);
};
const text = (s) =>
  s
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
const PLACEHOLDER_WORDS =
  /(?<![а-яіїєґ])сток(?:ов|\s|$|[.,·])|заглушк|placeholder|lorem ipsum|stock (?:photo|video|footage)/i;
/** Заглушки, дозволені в збірці для домену (рішення власника 2026-11-18): лише кадр замість ролика. */
const ALLOWED_PLACEHOLDERS = new Set(['video:what']);
let placeholders = 0;
let allowedPlaceholders = 0;
let unfilled = 0;
const broken = new Map();
for (const [p, { locale }] of expected) {
  if (!fileSet.has(p)) continue;
  const page = fs.readFileSync(path.join(out, p), 'utf8');
  const h1 = (page.match(/<h1[\s>]/g) ?? []).length;
  if (h1 !== 1) err(`${p}: <h1> — ${h1}, має бути 1`);
  if (!/<title>[^<]+<\/title>/.test(page)) err(`${p}: немає <title>`);
  if (!/<meta name="description" content="[^"]+"/.test(page))
    err(`${p}: немає опису (meta description)`);
  const lang = /<html[^>]*\slang="([^"]+)"/.exec(page)?.[1];
  if (lang !== locale) err(`${p}: <html lang="${lang}">, має бути "${locale}"`);
  for (const m of page.matchAll(/\s(?:href|src)="(\/[^"]*)"/g)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (url.startsWith('//')) continue;
    if (!resolves(url)) broken.set(url, (broken.get(url) ?? 0) + 1);
  }
  for (const m of page.matchAll(/\shref="\/((?:en|uk|es|fr)\/)?[^"]*"/g)) {
    // Посилання на мову, якої немає в збірці, зловить перевірка вище; тут — на `/en/…` (головна мова живе без префікса).
    if (m[1] === `${DEFAULT_LOCALE}/`)
      err(`${p}: посилання з префіксом головної мови: ${m[0].trim()}`);
  }
  for (const m of page.matchAll(/data-media-placeholder="([^"]*)"/g)) {
    if (ALLOWED_PLACEHOLDERS.has(m[1])) allowedPlaceholders += 1;
    else placeholders += 1;
  }
  const body = text(page);
  unfilled += (body.match(/\[\[/g) ?? []).length;
  if (PLACEHOLDER_WORDS.test(body))
    warn(`${p}: слово-заглушка у тексті («${PLACEHOLDER_WORDS.exec(body)[0].trim()}»)`);
  // Чужа мова на сторінці: кирилиця поза українською версією (крім назв мов у перемикачі й підказки мови).
  if (locale !== 'uk') {
    const foreign = body
      .replace(/Українська|Читати українською\?|Перейти|Закрити/g, '')
      .match(/[А-Яа-яІіЇїЄєҐґ]{3,}/g);
    if (foreign)
      err(
        `${p}: український текст на сторінці мови ${locale}: «${[...new Set(foreign)].slice(0, 5).join('», «')}»`,
      );
  }
}
for (const [url, n] of broken) err(`посилання в нікуди: ${url} (${n} стор.)`);
if (allowedPlaceholders)
  console.log(
    `check:prelaunch: дозволена заглушка — кадр замість ролика «Що таке Time2Fest» (video:what): ${allowedPlaceholders} стор.`,
  );
if (placeholders)
  warn(
    `заглушок фото й відео (data-media-placeholder): ${placeholders} — справжні кадри додає задача C (data/prelaunch/media.json)`,
  );
if (unfilled)
  warn(`незаповнених місць [[…]] у текстах: ${unfilled} — документи чекають даних власника`);
for (const l of locales)
  if (LOCALE_STATUS[l] !== 'ready') warn(`мова ${l} — ${LOCALE_STATUS[l]} (не вичитано)`);

// ── 4. Пошуковики ──────────────────────────────────────────────────────────────────────────────────────────────
const open = new Set(openRoutes(locales));
const metaContent = (page, attr, name) =>
  new RegExp(`<meta ${attr}="${name}" content="([^"]*)"`).exec(page)?.[1];
const absolute = (locale, route) => `${SITE_ORIGIN}${localePath(locale, route)}`;
let longTitles = 0;
for (const [p, { locale, route }] of expected) {
  if (!fileSet.has(p)) continue;
  const page = fs.readFileSync(path.join(out, p), 'utf8');
  const robots = metaContent(page, 'name', 'robots') ?? '';
  const isOpen = route !== '/404/' && open.has(route);
  if (route !== '/404/') {
    const canonical = /<link rel="canonical" href="([^"]+)"/.exec(page)?.[1];
    if (canonical !== absolute(locale, route)) err(`${p}: canonical «${canonical}», має бути ${absolute(locale, route)}`);
  }
  const alts = [...page.matchAll(/<link rel="alternate" hrefLang="([^"]+)" href="([^"]+)"/g)].map((m) => `${m[1]} ${m[2]}`);
  if (isOpen) {
    const want = [...locales.map((l) => `${l} ${absolute(l, route)}`), ...(locales.includes(DEFAULT_LOCALE) ? [`x-default ${absolute(DEFAULT_LOCALE, route)}`] : [])];
    if (alts.sort().join('|') !== want.sort().join('|')) err(`${p}: hreflang неповний чи не взаємний (${alts.length} з ${want.length})`);
    if (index && /noindex/.test(robots)) err(`${p}: відкрита сторінка з noindex у збірці для домену`);
    if (!index && !/noindex/.test(robots)) err(`${p}: збірка перегляду без noindex`);
    const title = /<title>([^<]+)<\/title>/.exec(page)?.[1]?.replace(/&amp;/g, '&') ?? '';
    if ([...title].length > 65) {
      longTitles += 1;
      warn(`${p}: title ${[...title].length} знаків (понад 65)`);
    }
  } else {
    if (!/noindex/.test(robots)) err(`${p}: закрита сторінка без noindex`);
    if (alts.length) err(`${p}: закрита сторінка з hreflang`);
  }
  if (route !== '/404/' && !metaContent(page, 'property', 'og:image')) err(`${p}: немає og:image`);
  for (const m of page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(m[1]);
    } catch {
      err(`${p}: JSON-LD не читається`);
    }
  }
}
const sitemapFile = path.join(out, 'sitemap.xml');
if (!fs.existsSync(sitemapFile)) err('немає sitemap.xml');
else {
  const locs = [...fs.readFileSync(sitemapFile, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  const want = locales.flatMap((l) => [...open].map((r) => absolute(l, r))).sort();
  if (locs.join('|') !== want.join('|')) err(`sitemap.xml: ${locs.length} адрес, відкритих сторінок ${want.length}`);
}
if (!fs.existsSync(path.join(out, 'robots.txt'))) err('немає robots.txt');
const redirectsFile = path.join(out, '_redirects');
if (fs.existsSync(redirectsFile)) {
  for (const line of fs.readFileSync(redirectsFile, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    const [from, to, code, extra] = line.split(' ');
    if (!from?.startsWith('/') || !to || code !== '301' || extra) err(`_redirects: неправильний рядок «${line}»`);
    else if (!to.includes(':') && to !== '/sitemap.xml' && !resolves(to)) err(`_redirects: «${from}» веде в нікуди (${to})`);
  }
} else err('немає _redirects');
if (longTitles) console.log(`check:prelaunch: title понад 65 знаків — ${longTitles}`);

// ── Підсумок ───────────────────────────────────────────────────────────────────────────────────────────────────
const failures = strict ? [...errors, ...warnings] : errors;
for (const w of strict ? [] : warnings) console.warn(`check:prelaunch: увага — ${w}`);
for (const e of failures.slice(0, 60)) console.error(`check:prelaunch: помилка — ${e}`);
if (failures.length > 60) console.error(`check:prelaunch: … і ще ${failures.length - 60}`);
console.log(
  `check:prelaunch: сторінок ${html.length} (очікувано ${expected.size}), файлів ${files.length}, мови ${locales.join(', ')}; помилок ${failures.length}, попереджень ${strict ? 0 : warnings.length}`,
);
process.exit(failures.length ? 1 : 0);
