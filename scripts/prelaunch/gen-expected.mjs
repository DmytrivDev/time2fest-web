// Очікувані трансляції для плашки «Де дивитися» (сторінка країни й вікно країни на мапі передстартового сайту) →
// `content/prelaunch/expected-streams.json`.
//   node scripts/prelaunch/gen-expected.mjs <шлях до docs/research_notes/expected-streams/expected-streams.json>
// Беремо лише країну, пояс і тип — без каналів, адрес і посилань-доказів (правило дослідження: «no evidence links on
// the site»). Показуємо лише `showOnSite` і впевненість вище здогадки; `irl` — не раніше ніж через два сезони; решта
// країн — нейтральне «Трансляція очікується» (на сайті, без запису тут).
import fs from 'node:fs';
import path from 'node:path';
import { root } from './routes.mjs';

const src = process.argv[2];
if (!src) {
  console.error('gen-expected: вкажи шлях до expected-streams.json');
  process.exit(2);
}
const raw = JSON.parse(fs.readFileSync(src, 'utf8'));
/** Типи, які показуємо, у порядку показу (у поясі країни кілька — кілька карток, без повторів). */
const KINDS = ['celebration', 'tv', 'webcam', 'address'];
const out = {};
for (const row of raw.rows) {
  if (!row.showOnSite || !KINDS.includes(row.kind)) continue;
  if (row.confidence === 'guess' || row.confidence === 'none') continue;
  // Звернення — лише ті, що йдуть в останню годину перед місцевою північчю (рішення власника 2026-11-18).
  if (row.kind === 'address' && !row.lastHour) continue;
  for (const zoneId of [row.zoneId, ...(row.alsoZones ?? [])]) {
    const key = `${row.country}:${zoneId}`;
    const list = (out[key] ??= []);
    if (!list.includes(row.kind)) list.push(row.kind);
  }
}
for (const list of Object.values(out)) list.sort((a, b) => KINDS.indexOf(a) - KINDS.indexOf(b));
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
const file = path.join(root, 'content', 'prelaunch', 'expected-streams.json');
fs.writeFileSync(
  file,
  `${JSON.stringify({ season: raw.season, checkedAt: raw.checkedAt, kinds: sorted }, null, 2)}
`,
);
const countries = new Set(Object.keys(sorted).map((k) => k.split(':')[0]));
console.log(
  `gen-expected: ${Object.keys(sorted).length} поясів країн, ${countries.size} країн → ${path.relative(root, file)}`,
);
