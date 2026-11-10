/**
 * Аркуш порівняння: для кожної сторінки — знімки кількох розмірів поруч (верх сторінки, однаковий масштаб).
 *   node scripts/contact-sheet.mjs <тека зі знімками> <тека аркушів> [висота_вікна_у_px=1300]
 * Імена знімків: <сторінка>-<W>x<H>.png (як знімає baseline-shots.mjs з SIZES).
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const [src, out, cropArg] = process.argv.slice(2);
const crop = Number(cropArg ?? 1300);
fs.mkdirSync(out, { recursive: true });
const files = fs.readdirSync(src).filter((f) => f.endsWith('.png'));
const pages = [...new Set(files.map((f) => f.replace(/-\d+x\d+\.png$/, '')))];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
for (const name of pages) {
  const shots = files.filter((f) => f.startsWith(`${name}-`) && /-\d+x\d+\.png$/.test(f)).sort((a, b) => parseInt(a.split('-').pop()) - parseInt(b.split('-').pop()));
  const cols = shots
    .map((f) => {
      const [w, h] = f.match(/(\d+)x(\d+)\.png$/).slice(1).map(Number);
      const data = fs.readFileSync(path.join(src, f)).toString('base64');
      // Кожен знімок — однакова ширина колонки 380 px; показуємо верх сторінки висотою `crop` px вікна.
      const scale = 380 / w;
      return `<figure><figcaption>${w}×${h}</figcaption><div style="width:380px;height:${Math.round(crop * scale)}px;overflow:hidden;border:1px solid #444"><img src="data:image/png;base64,${data}" style="width:380px;display:block"></div></figure>`;
    })
    .join('');
  await page.setContent(`<body style="margin:0;background:#222;color:#ddd;font:14px sans-serif"><h3 style="margin:8px">${name}</h3><div style="display:flex;gap:12px;padding:0 8px 8px;align-items:flex-start">${cols}</div></body>`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
}
await browser.close();
console.log(`аркушів: ${pages.length}`);
