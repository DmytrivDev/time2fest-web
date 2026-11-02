// Порівняння старої мапи з офіційними поясами: растр «зсув за старою мапою» vs «зсув за TBB/tzdata 2027-01-01».
// Запуск з web/: node <файл> <mapx dir>
import { chromium } from '@playwright/test';
import fs from 'node:fs';
const D = process.argv[2];
const old = JSON.parse(fs.readFileSync(`${D}/old_map.json`, 'utf8'));
const tbb = JSON.parse(fs.readFileSync(`${D}/tbb.json`, 'utf8'));
const offs = [...new Set([...old.zones.map((z) => z.offsetMinutes), ...tbb.zones.map((z) => z.offset)])].sort((a, b) => a - b);
const idx = (o) => offs.indexOf(o) + 1;
const countries = [];
for (const z of old.zones) for (const c of z.countries) countries.push({ zone: z.offsetMinutes, iso: c.iso, comp: c.component, paths: c.paths });
const rgb = (r, g, b) => `rgb(${r},${g},${b})`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" width="1781" height="911" viewBox="0 0 1781 911" shape-rendering="crispEdges"><rect width="1781" height="911" fill="#000"/>${body}</svg>`;
const oldZones = svg(countries.map((c, i) => c.paths.filter((p) => p.fill !== 'none').map((p) => `<path d="${p.d}" fill="${rgb(idx(c.zone), (i + 1) >> 8, (i + 1) & 255)}" fill-rule="${p.rule || 'nonzero'}"/>`).join('')).join(''));
const tbbZones = svg(tbb.zones.map((z) => `<path d="${z.d}" fill="${rgb(idx(z.offset), 0, 0)}"/>`).join(''));
// Накладка для ока: стара мапа за зсувом + межі офіційних поясів.
const pal = (o) => `hsl(${((o + 720) * 7) % 360} 55% 50%)`;
const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="1781" height="911" viewBox="0 0 1781 911"><rect width="1781" height="911" fill="#222"/>`
  + countries.map((c) => c.paths.filter((p) => p.fill !== 'none').map((p) => `<path d="${p.d}" fill="${pal(c.zone)}"/>`).join('')).join('')
  + tbb.zones.map((z) => `<path d="${z.d}" fill="none" stroke="#fff" stroke-width="0.8"/>`).join('') + '</svg>';
fs.writeFileSync(`${D}/overlay.svg`, overlay);
const b = await chromium.launch();
const pg = await b.newPage({ viewport: { width: 1781, height: 911 }, deviceScaleFactor: 1 });
for (const [name, s] of [['old', oldZones], ['tbb', tbbZones], ['overlay', overlay]]) {
  await pg.setContent(`<html><body style="margin:0">${s}</body></html>`);
  await pg.screenshot({ path: `${D}/r-${name}.png`, omitBackground: false });
}
await b.close();
fs.writeFileSync(`${D}/legend.json`, JSON.stringify({ offs, countries: countries.map(({ zone, iso, comp }) => ({ zone, iso, comp })) }));
console.log('offsets', offs.length, 'countries', countries.length);
