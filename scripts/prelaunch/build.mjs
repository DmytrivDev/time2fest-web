// Збірка передстартового сайту для домену: `pnpm build:prelaunch` → тека `out-prelaunch`.
//   1. перевіряє дані (`gen-data --check`) і звітує про відсутні переклади (збірку це не зупиняє);
//   2. збирає Next у `.next-prelaunch` з `NEXT_PUBLIC_PRELAUNCH=1` — у такій збірці є лише мовне дерево `app/[locale]`
//      (файли `*.pl.tsx`); входу, оплати, ефіру, кабінету, тестових дверцят і машини часу в ній немає взагалі;
//   3. кладе в `out-prelaunch` лише дозволені сторінки (`routes.mjs`): головна мова — в корінь без префікса,
//      решта — під `/<мова>/`; сторінка `/404/` кожної мови стає `404.html`;
//   4. запускає перевірку (`check.mjs`). Ключ `--strict` (для розгортання) — заглушки й відсутні переклади стають помилкою.
// Нічого не розгортає.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  allowedRoutes,
  DEFAULT_LOCALE,
  LOCALE_STATUS,
  prelaunchLocales,
  OPTIONAL_PUBLIC_ENTRIES,
  PUBLIC_ENTRIES,
  publicPath,
  root,
} from './routes.mjs';

const BUILD_DIR = '.next-prelaunch';
const OUT_DIR = 'out-prelaunch';
const strict = process.argv.includes('--strict');
const skipNext = process.argv.includes('--skip-next'); // лише перескласти out-prelaunch з готової збірки

const node = (args, env = {}) => {
  const r = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  return r.status ?? 1;
};
const fail = (message) => {
  console.error(`build:prelaunch: ${message}`);
  process.exit(1);
};

const locales = prelaunchLocales();
console.log(
  `build:prelaunch: мови — ${locales.map((l) => `${l} (${LOCALE_STATUS[l]})`).join(', ')}`,
);

if (node(['scripts/prelaunch/gen-data.mjs', '--check'])) fail('дані data/prelaunch застаріли');
if (
  node([
    'scripts/prelaunch/messages.mjs',
    '--json',
    'out-prelaunch.messages.json',
    ...(strict ? ['--strict', locales.filter((l) => l !== 'uk').join(',')] : []),
  ])
)
  fail('бракує перекладів (режим --strict)');

if (!skipNext) {
  for (const pre of ['scripts/sync_tokens.mjs']) if (node([pre, '--check'])) fail(`${pre} --check`);
  fs.rmSync(path.join(root, BUILD_DIR), { recursive: true, force: true });
  const status = node(['node_modules/next/dist/bin/next', 'build'], {
    NEXT_PUBLIC_PRELAUNCH: '1',
    NEXT_PUBLIC_PRELAUNCH_LOCALES: locales.join(','),
    NEXT_DIST_DIR: BUILD_DIR,
    // Робоча збірка: без тестового коду. Режим даних — `http`; мовне дерево до `lib/api` не звертається.
    NEXT_PUBLIC_ENV: 'production',
    NEXT_PUBLIC_DEMO: '',
    NEXT_PUBLIC_API_MODE: 'http',
  });
  if (status) fail('next build завершився з помилкою');
}

const src = path.join(root, BUILD_DIR);
const out = path.join(root, OUT_DIR);
if (!fs.existsSync(src)) fail(`немає ${BUILD_DIR} — запусти без --skip-next`);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const entry of PUBLIC_ENTRIES) {
  const from = path.join(src, entry);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(out, entry), { recursive: true });
  else console.warn(`build:prelaunch: у збірці немає ${entry}`);
}
for (const entry of OPTIONAL_PUBLIC_ENTRIES) {
  const from = path.join(src, entry);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(out, entry), { recursive: true });
}

function flattenSegments(fromDir, toPrefix) {
  for (const e of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, e.name);
    if (e.isDirectory()) flattenSegments(from, `${toPrefix}.${e.name}`);
    else fs.copyFileSync(from, `${toPrefix}.${e.name}`);
  }
}

/** Файли однієї сторінки: усе, що лежить у її теці, без вкладених сторінок. */
function copyPage(fromDir, toDir) {
  fs.mkdirSync(toDir, { recursive: true });
  for (const e of fs.readdirSync(fromDir, { withFileTypes: true })) {
    const from = path.join(fromDir, e.name);
    // Теки інших сторінок не беремо. Дані сегментів сторінки Next кладе вкладеними теками
    // (`__next.$d$locale/countries/__PAGE__.txt`), а браузер просить їх одним файлом із крапками
    // (`__next.$d$locale.countries.__PAGE__.txt`) — тож розгортаємо теку в такі файли.
    if (e.isDirectory()) {
      if (e.name.startsWith('__next')) flattenSegments(from, path.join(toDir, e.name));
    } else fs.copyFileSync(from, path.join(toDir, e.name));
  }
}

const routes = allowedRoutes();
let pages = 0;
const missing = [];
for (const locale of locales) {
  for (const route of routes) {
    const from = path.join(src, locale, route);
    if (!fs.existsSync(path.join(from, 'index.html'))) {
      missing.push(`/${locale}${route}`);
      continue;
    }
    copyPage(from, path.join(out, publicPath(locale, route)));
    pages += 1;
  }
  const notFound = path.join(src, locale, '404', 'index.html');
  if (fs.existsSync(notFound))
    fs.copyFileSync(notFound, path.join(out, publicPath(locale, '/'), '404.html'));
  else missing.push(`/${locale}/404/`);
}
if (missing.length)
  fail(
    `збірка не дала сторінок: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` … (${missing.length})` : ''}`,
  );
if (!locales.includes(DEFAULT_LOCALE))
  console.warn(
    `build:prelaunch: головної мови (${DEFAULT_LOCALE}) у збірці немає — корінь сайту порожній`,
  );

console.log(`build:prelaunch: ${pages} сторінок, ${locales.length} мов → ${OUT_DIR}`);
if (node(['scripts/prelaunch/check.mjs', OUT_DIR, ...(strict ? ['--strict'] : [])]))
  fail('перевірка out-prelaunch не пройшла');
