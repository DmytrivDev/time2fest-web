// Очікувані трансляції для плашки «Де дивитися» на мапі передстартового сайту → `data/prelaunch/expected.json`.
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
/** Типи, які показуємо, у порядку переваги (у поясі країни кілька — показуємо перший). */
const KINDS = ['celebration', 'tv', 'webcam', 'address'];
const out = {};
for (const row of raw.rows) {
  if (!row.showOnSite || !KINDS.includes(row.kind)) continue;
  if (row.confidence === 'guess' || row.confidence === 'none') continue;
  for (const zoneId of [row.zoneId, ...(row.alsoZones ?? [])]) {
    const key = `${row.country}:${zoneId}`;
    const prev = out[key];
    if (!prev || KINDS.indexOf(row.kind) < KINDS.indexOf(prev)) out[key] = row.kind;
  }
}
const sorted = Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
const file = path.join(root, 'data', 'prelaunch', 'expected.json');
fs.writeFileSync(
  file,
  `${JSON.stringify({ season: raw.season, checkedAt: raw.checkedAt, kinds: sorted }, null, 2)}\n`,
);
console.log(`gen-expected: ${Object.keys(sorted).length} записів → ${path.relative(root, file)}`);
