// Знімки сторінок передстартового сайту поруч із наявними сторінками демо (для звірки «той самий вигляд, прибрано дії»).
//   node scripts/prelaunch/compare.mjs --out <тека> [--pre http://127.0.0.1:4310] [--demo http://127.0.0.1:4402]
// Ліворуч — демо (сайт свята), праворуч — передстартовий сайт українською; 1440 і 375 px; повна висота, у масштабі.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const out = path.resolve(arg('--out', 'out-prelaunch.compare'));
const pre = arg('--pre', 'http://127.0.0.1:4310');
const demo = arg('--demo', 'http://127.0.0.1:4402');
// Демо живе на віртуальній ночі свята; знімаємо його «до свята» (1 грудня), як передстартовий сайт.
const T = '?t=2026-12-01T12:00:00%2B02:00&speed=0';
const PAIRS = [
  { id: 'pass', demo: `/pass/${T}`, pre: '/uk/pass/' },
  { id: 'countries', demo: `/countries/${T}`, pre: '/uk/countries/' },
  { id: 'country-jp', demo: `/country/yaponiia/${T}`, pre: '/uk/country/japan/' },
  { id: 'country-us', demo: `/country/ssha/${T}`, pre: '/uk/country/united-states/' },
  { id: 'country-ad', demo: `/country/andorra/${T}`, pre: '/uk/country/andorra/' },
  { id: 'toasts', demo: `/support/${T}`, pre: '/uk/toasts/' },
  { id: 'privacy', demo: `/privacy/${T}`, pre: '/uk/privacy/' },
];
const SIZES = [
  { id: 'd1440', width: 1440, height: 900, scale: 0.4 },
  { id: 'p375', width: 375, height: 812, scale: 0.8 },
];
const only = arg('--only', '').split(',').filter(Boolean);

async function shot(browser, url, size) {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, locale: 'uk-UA', timezoneId: 'Europe/Kyiv', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => {
    localStorage.setItem('t2f:lang', 'uk');
    // Згода на cookies демо — щоб банер не закривав сторінку.
    localStorage.setItem('t2f:consent:v1', JSON.stringify({ state: { decided: true, analytics: false, facebookVideo: false }, version: 1 }));
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date('2026-12-01T10:00:00Z') });
  const res = await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const png = res && res.status() < 400 ? await page.screenshot({ fullPage: true }) : null;
  await ctx.close();
  return png ? PNG.sync.read(png) : null;
}

function sideBySide(a, b, scale) {
  const w = (img) => (img ? Math.round(img.width * scale) : 0);
  const h = (img) => (img ? Math.round(img.height * scale) : 0);
  const W = w(a) + 20 + w(b);
  const H = Math.max(h(a), h(b), 10);
  const outImg = new PNG({ width: Math.max(W, 10), height: H });
  outImg.data.fill(48);
  const blit = (src, x0) => {
    if (!src) return;
    for (let y = 0; y < h(src); y++)
      for (let x = 0; x < w(src); x++) {
        const sx = Math.min(src.width - 1, Math.floor(x / scale));
        const sy = Math.min(src.height - 1, Math.floor(y / scale));
        const si = (sy * src.width + sx) * 4;
        const di = (y * outImg.width + x0 + x) * 4;
        outImg.data[di] = src.data[si];
        outImg.data[di + 1] = src.data[si + 1];
        outImg.data[di + 2] = src.data[si + 2];
        outImg.data[di + 3] = 255;
      }
  };
  blit(a, 0);
  blit(b, w(a) + 20);
  return outImg;
}

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const p of PAIRS) {
  if (only.length && !only.includes(p.id)) continue;
  for (const size of SIZES) {
    const a = await shot(browser, `${demo}${p.demo}`, size);
    const b = await shot(browser, `${pre}${p.pre}`, size);
    fs.writeFileSync(path.join(out, `${p.id}.${size.id}.png`), PNG.sync.write(sideBySide(a, b, size.scale)));
    console.log(`${p.id}.${size.id}: demo ${a ? `${a.width}×${a.height}` : '—'} | prelaunch ${b ? `${b.width}×${b.height}` : '—'}`);
  }
}
await browser.close();
