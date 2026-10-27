/**
 * Мапа поясів (T079; research.md, розділ 6; вигляд — макети `Main` / `Phone-Home-Live`).
 * Одноразовий скрипт: результат комітиться (`public/zonemap.svg`, `data/zonemap.json`), CI його не перегенерує
 * і нічого не качає.
 *
 * Вхід (папки в .gitignore, ніколи не комітяться), реліз timezone-boundary-builder 2026e
 * (https://github.com/evansiroky/timezone-boundary-builder/releases/tag/2026e):
 *  - `.cache/tbb-land/combined.json` — `timezones.geojson.zip`, пояси лише суходолу (без океанів);
 *  - `.cache/tbb/combined-with-oceans-now.json` — `timezones-with-oceans-now.geojson.zip`, лише для тонких ліній
 *    поясів в океані (як на макеті).
 * Кроки: Python (`build_zonemap_offsets.py`) — зсув кожного tzid на 2027-01-01 → mapshaper: суходіл без Антарктиди,
 *   спрощення, `dissolve offset` (38 поясів, колір за станом) і `innerlines` (межі між tzid ≈ кордони країн);
 *   океан — `dissolve offset` + `innerlines` (ступінчасті лінії поясів) → d3-geo, проекція Міллера, кадр макета
 *   (1781×911, від ~168° з.д., північ ~85°, південь ~59°) → SVG і JSON.
 *
 * Запуск: node scripts/build_zonemap.mjs [--simplify=0.37%] [--islands=30] [--digits=0]
 * Залежності mapshaper і d3-geo — із devDependencies (точні версії у package.json).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoPath, geoProjection } from 'd3-geo';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const landDir = path.join(root, '.cache', 'tbb-land');
const oceanDir = path.join(root, '.cache', 'tbb');
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const SIMPLIFY = arg('simplify', '0.37%');
const OCEAN_SIMPLIFY = arg('ocean-simplify', '0.3%');
const ISLAND_KM2 = Number(arg('islands', '30'));
const DIGITS = Number(arg('digits', '0'));

/**
 * Кадр макета (assets/map.svg у visual-design): 1781×911, проекція Міллера.
 * Підібрано за точками макета (Ісландія, Велика Британія, Кабо-Верде, мис Горн, Тасманія):
 * 4.947 px на градус довготи, лівий край — 168.2° з.д., екватор на y = 580.
 */
export const MAP = { width: 1781, height: 911, lon0: -168.2, pxPerDeg: 4.947, equatorY: 580 };
const R = (MAP.pxPerDeg * 180) / Math.PI;
const millerRaw = (lambda, phi) => [lambda, 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi))];
millerRaw.invert = (x, y) => [x, 2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI];
const centerLon = MAP.lon0 + 180;
const projection = geoProjection(millerRaw)
  .rotate([-centerLon, 0])
  .scale(R)
  .translate([MAP.width / 2, MAP.equatorY])
  .clipExtent([
    [0, 0],
    [MAP.width, MAP.height],
  ])
  .precision(0.2);
const path2d = geoPath(projection).digits(DIGITS);

const landSrc = path.join(landDir, 'combined.json');
const oceanSrc = path.join(oceanDir, 'combined-with-oceans-now.json');
for (const f of [landSrc, oceanSrc]) {
  if (!existsSync(f)) {
    console.error(`Немає ${f}. Завантаж відповідний архів з релізу 2026e і розпакуй (див. шапку скрипта).`);
    process.exit(1);
  }
}

const py = (src, out) =>
  execFileSync('python', ['-X', 'utf8', path.join(root, 'scripts', 'build_zonemap_offsets.py'), src, out], { stdio: 'inherit' });
const mapshaperBin = path.join(root, 'node_modules', 'mapshaper', 'bin', 'mapshaper');
const ms = (args) => execFileSync(process.execPath, ['--max-old-space-size=8192', mapshaperBin, ...args], { stdio: 'inherit' });

// 1. Зсуви на 2027-01-01 (Python, tzdata 2026.5).
py(landSrc, path.join(landDir, 'offsets.json'));
py(oceanSrc, path.join(oceanDir, 'offsets.json'));
const landOffsets = JSON.parse(readFileSync(path.join(landDir, 'offsets.json'), 'utf8'));
const oceanOffsets = JSON.parse(readFileSync(path.join(oceanDir, 'offsets.json'), 'utf8'));

// 2. Суходіл без Антарктиди: властивість `offset`.
const land = JSON.parse(readFileSync(landSrc, 'utf8'));
land.features = land.features.filter((f) => !String(f.properties.tzid).startsWith('Antarctica/'));
for (const f of land.features) f.properties = { tzid: f.properties.tzid, offset: landOffsets[f.properties.tzid] };
writeFileSync(path.join(landDir, 'annotated.json'), JSON.stringify(land));

// 3. mapshaper: спрощення спільних меж один раз, потім пояси (dissolve) і межі між tzid (innerlines).
ms([
  path.join(landDir, 'annotated.json'),
  '-clip', 'bbox=-180,-60,180,86',
  '-filter-islands', `min-area=${ISLAND_KM2}km2`,
  '-simplify', 'visvalingam', SIMPLIFY, 'keep-shapes',
  '-clean',
  '-o', path.join(landDir, 'simplified.json'), 'format=geojson', 'precision=0.001',
]);
ms([path.join(landDir, 'simplified.json'), '-dissolve', 'offset', '-o', path.join(landDir, 'zones.json'), 'format=geojson', 'precision=0.001']);
ms([path.join(landDir, 'simplified.json'), '-innerlines', '-o', path.join(landDir, 'borders.json'), 'format=geojson', 'precision=0.001']);

// 4. Океан: лише лінії між поясами.
const ocean = JSON.parse(readFileSync(oceanSrc, 'utf8'));
for (const f of ocean.features) f.properties = { offset: oceanOffsets[f.properties.tzid] };
writeFileSync(path.join(oceanDir, 'annotated-ocean.json'), JSON.stringify(ocean));
ms([
  path.join(oceanDir, 'annotated-ocean.json'),
  '-clip', 'bbox=-180,-60,180,86',
  '-dissolve', 'offset',
  '-simplify', 'visvalingam', OCEAN_SIMPLIFY, 'keep-shapes',
  '-innerlines',
  // Під суходолом лінії не видно: стерти, щоб не важили.
  '-erase', path.join(landDir, 'zones.json'),
  '-o', path.join(oceanDir, 'grid.json'), 'format=geojson', 'precision=0.001',
]);

const zonesGeo = JSON.parse(readFileSync(path.join(landDir, 'zones.json'), 'utf8'));
const bordersGeo = JSON.parse(readFileSync(path.join(landDir, 'borders.json'), 'utf8'));
const gridGeo = JSON.parse(readFileSync(path.join(oceanDir, 'grid.json'), 'utf8'));

// 5. d3-geo → шляхи.
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
const round1 = (v) => Math.round(v * 10) / 10;

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
  return [round1(x), round1(y)];
}

const schedule = JSON.parse(readFileSync(path.join(root, 'data', 'schedule.json'), 'utf8'));
const scheduleZones = schedule.zones.map((z) => ({ id: z.id, offsetMinutes: z.offsetMinutes }));
const landZones = new Map(zonesGeo.features.filter((f) => f.geometry).map((f) => [f.properties.offset, f]));

/** d3 (сферична геометрія) чекає зовнішні кільця за годинниковою стрілкою, дірки — проти (mapshaper віддає RFC 7946). */
const ringArea = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2; // < 0 — за годинниковою стрілкою (lon вправо, lat угору)
};
const rewindPolygon = (rings) => rings.map((r, i) => ((ringArea(r) < 0) === (i === 0) ? r : [...r].reverse()));
for (const f of zonesGeo.features) {
  if (!f.geometry) continue;
  if (f.geometry.type === 'Polygon') f.geometry.coordinates = rewindPolygon(f.geometry.coordinates);
  else if (f.geometry.type === 'MultiPolygon') f.geometry.coordinates = f.geometry.coordinates.map(rewindPolygon);
}

const project = ([lon, lat]) => projection([lon, lat]).map(round1);

// Маркери для поясів, яких на суходолі не видно (дрібні острови або лише океан): lon/lat представника.
const MARKER_POINTS = {
  'utc+1400': [-157.4, 1.87], // Кірітіматі
  'utc+1345': [-176.5, -44.0], // Чатем
  'utc-1200': [-176.5, 0.2], // Бейкер і Гауленд
  'utc-1100': [-170.7, -14.3], // Американське Самоа
  'utc-0930': [-139.5, -9.0], // Маркізькі острови
};

const zones = [];
const markers = [];
for (const z of scheduleZones) {
  const f = landZones.get(z.offsetMinutes);
  let d = f ? path2d(f.geometry) : null;
  // Пояс без суходолу на мапі (UTC−12: Бейкер і Гауленд) — маленьке коло в точці представника: шлях лишається
  // фокусованим (38 поясів, стрілки клавіатури) і отримує колір стану, як решта.
  if (!d && MARKER_POINTS[z.id]) {
    const [x, y] = project(MARKER_POINTS[z.id]);
    d = `M${x - 4},${y}a4,4 0 1,0 8,0a4,4 0 1,0 -8,0Z`;
  }
  zones.push({
    offsetMinutes: z.offsetMinutes,
    offset: offsetLabel(z.offsetMinutes),
    zoneId: zoneId(z.offsetMinutes),
    d: d ?? '',
    label: f && d ? labelPoint(f.geometry) : project(MARKER_POINTS[z.id] ?? [0, 0]),
  });
  if (MARKER_POINTS[z.id] && (z.id === 'utc+1400' || z.id === 'utc+1345')) {
    const [x, y] = project(MARKER_POINTS[z.id]);
    markers.push({ zoneId: z.id, x, y });
  }
}
zones.sort((a, b) => b.offsetMinutes - a.offsetMinutes);

if (zones.length !== 38) {
  console.error(`Очікувалось 38 поясів, отримано ${zones.length}`);
  process.exit(1);
}
const missing = zones.filter((z) => !z.d && !markers.some((m) => m.zoneId === z.zoneId));
if (missing.length) {
  console.error('Пояс без шляху й маркера:', missing.map((z) => z.zoneId).join(', '));
  process.exit(1);
}

const linesD = (geo) => (geo.features ? geo.features.map((f) => f.geometry) : geo.geometries).map((g) => path2d(g) ?? '').join('');
const borders = linesD(bordersGeo);
const grid = linesD(gridGeo);

const meta = {
  source: 'timezone-boundary-builder 2026e (timezones = суходіл без океанів; лінії в океані — timezones-with-oceans-now), tzdata 2026e; зсуви на 2027-01-01',
  projection: `miller, d3-geo geoProjection; lon0 ${MAP.lon0}, ${MAP.pxPerDeg} px/deg, equator y ${MAP.equatorY}`,
  width: MAP.width,
  height: MAP.height,
  lon0: MAP.lon0,
  pxPerDeg: MAP.pxPerDeg,
  equatorY: MAP.equatorY,
  simplify: `visvalingam ${SIMPLIFY} keep-shapes`,
};

writeFileSync(path.join(root, 'data', 'zonemap.json'), JSON.stringify({ meta, zones, markers, borders, grid }));

const svg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP.width} ${MAP.height}" width="${MAP.width}" height="${MAP.height}" role="img" aria-label="Мапа часових поясів">`,
  `<path id="grid" fill="none" stroke="currentColor" stroke-width="1" d="${grid}"/>`,
  '<g id="zones" fill="none" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round">',
  ...zones.filter((z) => z.d).map((z) => `<path class="is-ahead" data-offset="${z.offset}" data-zone="${z.zoneId}" d="${z.d}"/>`),
  '</g>',
  `<g id="borders" fill="none" stroke="currentColor" stroke-width="0.5"><path d="${borders}"/></g>`,
  '<g id="markers">',
  ...markers.map((m) => `<circle data-zone-marker="${m.zoneId}" cx="${m.x}" cy="${m.y}" r="4"/>`),
  '</g>',
  '</svg>',
].join('\n');
writeFileSync(path.join(root, 'public', 'zonemap.svg'), svg);

const kb = (f) => (statSync(f).size / 1024).toFixed(1);
console.log(
  `zonemap.svg ${kb(path.join(root, 'public', 'zonemap.svg'))} КБ; zonemap.json ${kb(path.join(root, 'data', 'zonemap.json'))} КБ; поясів ${zones.length}, на суходолі ${zones.filter((z) => z.d).length}, маркерів ${markers.length}`,
);
