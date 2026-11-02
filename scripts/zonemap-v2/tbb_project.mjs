// Тимчасово: офіційні межі поясів (TBB 2026f, «now», суходіл) → шляхи SVG у кадрі старої мапи 1781×911 за зсувом на 2027-01-01.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { geoArea, geoPath, geoProjection } from 'd3-geo';

const dir = path.resolve('.cache/tbb26f');
const out = process.argv[2];
const MAP = { width: 1781, height: 911, lon0: -168.2, pxPerDeg: 4.947, equatorY: 580 };
const R = (MAP.pxPerDeg * 180) / Math.PI;
const millerRaw = (l, p) => [l, 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * p))];
millerRaw.invert = (x, y) => [x, 2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI];
const projection = geoProjection(millerRaw).rotate([-(MAP.lon0 + 180), 0]).scale(R).translate([MAP.width / 2, MAP.equatorY]).precision(0.2);
const p2raw = geoPath(projection).digits(1);
// d3 чекає обхід за годинниковою стрілкою: полігон «більший за півкулю» — обернений, перевертаємо кільця.
function fix(g) {
  if (!g) return g;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
  if (!polys) return g;
  const out = polys.map((rings) => (geoArea({ type: 'Polygon', coordinates: rings }) > 2 * Math.PI ? rings.map((r) => [...r].reverse()) : rings));
  return g.type === 'Polygon' ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out };
}
const p2 = (f) => p2raw(f.type === 'Feature' ? { ...f, geometry: fix(f.geometry) } : fix(f));

const offsets = JSON.parse(readFileSync(path.join(dir, 'offsets.json'), 'utf8'));
const src = JSON.parse(readFileSync(path.join(dir, 'combined-now.json'), 'utf8'));
src.features = src.features.filter((f) => !String(f.properties.tzid).startsWith('Antarctica/'));
for (const f of src.features) f.properties = { tzid: f.properties.tzid, offset: offsets[f.properties.tzid] };
writeFileSync(path.join(dir, 'annotated.json'), JSON.stringify(src));
const ms = (args) => execFileSync(process.execPath, ['--max-old-space-size=8192', 'node_modules/mapshaper/bin/mapshaper', ...args], { stdio: 'inherit' });
ms([path.join(dir, 'annotated.json'), '-simplify', 'visvalingam', '2%', 'keep-shapes', '-clean', '-o', path.join(dir, 'simp.json'), 'format=geojson', 'precision=0.001']);
ms([path.join(dir, 'simp.json'), '-dissolve', 'offset', '-o', path.join(dir, 'zones.json'), 'format=geojson', 'precision=0.001']);
ms([path.join(dir, 'simp.json'), '-innerlines', '-o', path.join(dir, 'inner.json'), 'format=geojson', 'precision=0.001']);
const zones = JSON.parse(readFileSync(path.join(dir, 'zones.json'), 'utf8'));
const inner = JSON.parse(readFileSync(path.join(dir, 'inner.json'), 'utf8'));
const tz = JSON.parse(readFileSync(path.join(dir, 'simp.json'), 'utf8'));
const res = {
  zones: zones.features.map((f) => ({ offset: f.properties.offset, d: p2(f) })),
  tzids: tz.features.map((f) => ({ tzid: f.properties.tzid, offset: f.properties.offset, d: p2(f) })),
  inner: (inner.features ?? inner.geometries ?? [inner]).map((f) => p2(f) ?? '').join(''),
};
writeFileSync(out, JSON.stringify(res));
console.log('zones', res.zones.length, 'tzids', res.tzids.length);
