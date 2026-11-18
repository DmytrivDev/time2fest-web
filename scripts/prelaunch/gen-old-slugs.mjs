// Слаги країн торішнього сайту → `content/prelaunch/old-country-slugs.json` (для `_redirects`).
//   node scripts/prelaunch/gen-old-slugs.mjs <шлях до docs/site/prelaunch-content/old-urls.md>
// Береться таблиця «Країни» (ISO, старий слаг — зі старої CMS); куди вести, вирішує збірка за `urlSlug` поточних
// даних (`data/prelaunch/countries.json`): збігається — правило не потрібне, інший — 301, країни немає — список.
import fs from 'node:fs';
import path from 'node:path';
import { root } from './routes.mjs';

const src = process.argv[2];
if (!src) {
  console.error('gen-old-slugs: вкажи шлях до old-urls.md');
  process.exit(2);
}
/** Помилки ISO в старій таблиці: малі віддалені острови США записано як US. */
const FIX_ISO = { 'united-states-minor-outlying-islands': 'UM' };
const rows = fs
  .readFileSync(src, 'utf8')
  .split(/\r?\n/)
  .map((l) => /^\| ([A-Z]{2}) \| `([^`]+)` \|/.exec(l))
  .filter(Boolean)
  .map((m) => [m[2], FIX_ISO[m[2]] ?? (m[1] === 'UK' ? 'GB' : m[1])]);
const out = Object.fromEntries(rows.sort(([a], [b]) => a.localeCompare(b)));
const file = path.join(root, 'content', 'prelaunch', 'old-country-slugs.json');
fs.writeFileSync(
  file,
  `${JSON.stringify({ _about: 'Старий слаг країни → ISO (стара CMS, docs/site/prelaunch-content/old-urls.md).', slugs: out }, null, 2)}\n`,
);
console.log(`gen-old-slugs: ${rows.length} слагів → ${path.relative(root, file)}`);
