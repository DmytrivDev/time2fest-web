/**
 * Мапа поясів (T079; research.md, розділ 6). Одноразовий скрипт: результат комітиться
 * (`public/zonemap.svg`, `data/zonemap.json`), CI його не перегенерує і нічого не качає.
 *
 * Вхід: `.cache/tbb/combined-with-oceans-now.json` — timezone-boundary-builder 2026e,
 *       `timezones-with-oceans-now.geojson.zip` (~27 МБ) з
 *       https://github.com/evansiroky/timezone-boundary-builder/releases/tag/2026e,
 *       розпакований у `.cache/tbb/` (папка в .gitignore; ніколи не комітиться).
 * Кроки: Python (`build_zonemap_offsets.py`) дає зсув кожного tzid на 2027-01-01 → тут
 *       `offset` у властивості → mapshaper (clip, dissolve offset, simplify visvalingam
 *       keep-shapes, clean) → d3-geo (рівнопроміжна проекція, та сама, що й `mapPoint`
 *       міст у schedule.json) → SVG і JSON.
 *
 * Запуск: node scripts/build_zonemap.mjs [--simplify=0.6%] [--digits=1]
 * Залежності mapshaper і d3-geo — із devDependencies (точні версії у package.json).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoPath, geoTransform } from 'd3-geo';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache', 'tbb');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SIMPLIFY = arg('simplify', '0.6%');
const DIGITS = Number(arg('digits', '1'));

// Видима частина світу: без Антарктиди, з Шпіцбергеном і Вогняною Землею (mapPoint: y 0.07…0.80).
const LAT_TOP = 80;
const LAT_BOTTOM = -56;
const WIDTH = 1000;
const SCALE = WIDTH / 360; // px на градус
const HEIGHT = Math.round((LAT_TOP - LAT_BOTTOM) * SCALE * 10) / 10;
/**
 * Рівнопроміжна проекція (plate carrée) як плоске перетворення: `x = (lon + 180)·k`, `y = (latTop − lat)·k`.
 * Це та сама проекція, що й `mapPoint` міст у schedule.json (x = (lon + 180)/360, y = (90 − lat)/180).
 * `geoTransform`, а не сферична `geoEquirectangular`: mapshaper віддає плоскі кільця, і d3 зі сферичною
 * обробкою вважав би їх доповненням до сфери (шлях на всю ширину).
 */
const project = ([lon, lat]) => [(lon + 180) * SCALE, (LAT_TOP - lat) * SCALE];
const path2d = geoPath(
  geoTransform({
    point(lon, lat) {
      const [x, y] = project([lon, lat]);
      this.stream.point(x, y);
    },
  }),
).digits(DIGITS);

const src = path.join(cache, 'combined-with-oceans-now.json');
if (!existsSync(src)) {
  console.error(`Немає ${src}. Завантаж timezones-with-oceans-now.geojson.zip з релізу 2026e і розпакуй у .cache/tbb/`);
  process.exit(1);
}

// 1. Зсуви на 2027-01-01 (Python, tzdata 2026.5).
execFileSync('python', ['-X', 'utf8', path.join(root, 'scripts', 'build_zonemap_offsets.py')], { stdio: 'inherit' });
const offsets = JSON.parse(readFileSync(path.join(cache, 'offsets.json'), 'utf8'));

// 2. Властивість `offset` замість решти властивостей.
const geo = JSON.parse(readFileSync(src, 'utf8'));
for (const f of geo.features) f.properties = { offset: offsets[f.properties.tzid] };
writeFileSync(path.join(cache, 'annotated.json'), JSON.stringify(geo));

// 3. mapshaper: обрізати, об’єднати до 38 мультиполігонів, спростити.
const mapshaperBin = path.join(root, 'node_modules', 'mapshaper', 'bin', 'mapshaper');
execFileSync(
  process.execPath,
  [
    '--max-old-space-size=8192',
    mapshaperBin,
    path.join(cache, 'annotated.json'),
    '-clip',
    `bbox=-180,${LAT_BOTTOM},180,${LAT_TOP}`,
    '-dissolve',
    'offset',
    '-simplify',
    'visvalingam',
    SIMPLIFY,
    'keep-shapes',
    '-clean',
    '-o',
    path.join(cache, 'zones.json'),
    'format=geojson',
    'precision=0.001',
  ],
  { stdio: 'inherit' },
);
const zonesGeo = JSON.parse(readFileSync(path.join(cache, 'zones.json'), 'utf8'));

// 4. d3-geo → шляхи.
const sign = (min) => (min < 0 ? '-' : '+');
const offsetLabel = (min) => {
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return `${sign(min)}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
};
const zoneId = (min) => {
  const a = Math.abs(min);
  return `utc${sign(min)}${String(Math.floor(a / 60)).padStart(2, '0')}${String(a % 60).padStart(2, '0')}`;
};

/** Точка підпису: центроїд найбільшого полігона поясу (у координатах SVG). */
function labelPoint(geometry) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let best = polys[0];
  let bestArea = -1;
  for (const rings of polys) {
    const a = Math.abs(path2d.area({ type: 'Polygon', coordinates: rings }));
    if (a > bestArea) {
      bestArea = a;
      best = rings;
    }
  }
  const [x, y] = path2d.centroid({ type: 'Polygon', coordinates: best });
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

const zones = zonesGeo.features
  .map((f) => ({
    offsetMinutes: f.properties.offset,
    offset: offsetLabel(f.properties.offset),
    zoneId: zoneId(f.properties.offset),
    d: path2d(f.geometry),
    label: labelPoint(f.geometry),
  }))
  .sort((a, b) => b.offsetMinutes - a.offsetMinutes);

if (zones.length !== 38) {
  console.error(`Очікувалось 38 поясів, отримано ${zones.length}`);
  process.exit(1);
}
const empty = zones.filter((z) => !z.d);
if (empty.length) {
  console.error('Порожній шлях:', empty.map((z) => z.zoneId).join(', '));
  process.exit(1);
}

// Маркери для дрібних поясів, що можуть зникнути після спрощення (Кірітіматі, Чатем): lon/lat міст.
const markers = [
  { zoneId: 'utc+1400', name: 'Кірітіматі', lonLat: [-157.4, 1.87] },
  { zoneId: 'utc+1345', name: 'Чатем', lonLat: [-176.5, -44.0] },
].map((m) => {
  const [x, y] = project(m.lonLat);
  return { zoneId: m.zoneId, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
});

const meta = {
  source: 'timezone-boundary-builder 2026e (timezones-with-oceans-now), tzdata 2026e; зсуви на 2027-01-01',
  projection: 'equirectangular (plate carrée), d3-geo geoTransform',
  width: WIDTH,
  height: HEIGHT,
  latTop: LAT_TOP,
  latBottom: LAT_BOTTOM,
  simplify: `visvalingam ${SIMPLIFY} keep-shapes`,
};

writeFileSync(path.join(root, 'data', 'zonemap.json'), JSON.stringify({ meta, zones, markers }));

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img" aria-label="Мапа часових поясів">`,
  '<g id="zones" fill="none" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round">',
  ...zones.map((z) => `<path class="is-ahead" data-offset="${z.offset}" data-zone="${z.zoneId}" d="${z.d}"/>`),
  '</g>',
  '<g id="markers">',
  ...markers.map((m) => `<circle data-zone-marker="${m.zoneId}" cx="${m.x}" cy="${m.y}" r="4"/>`),
  '</g>',
  '</svg>',
].join('\n');
writeFileSync(path.join(root, 'public', 'zonemap.svg'), svg);

const kb = (f) => (statSync(f).size / 1024).toFixed(1);
console.log(`zonemap.svg ${kb(path.join(root, 'public', 'zonemap.svg'))} КБ; zonemap.json ${kb(path.join(root, 'data', 'zonemap.json'))} КБ; поясів ${zones.length}`);
