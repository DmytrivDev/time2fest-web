// Знімки сторінок зібраного передстартового сайту на 375 і 1440 px (для звірки з дошками `home-prefest`).
//   node scripts/prelaunch/serve.mjs out-prelaunch --port 4310   (в іншому вікні)
//   node scripts/prelaunch/shots.mjs --out <тека> [--base http://127.0.0.1:4310] [--only home,country]
// Годинник сторінки зупинено на 2026-12-01T10:00:00Z, пояс — Europe/Kyiv; анімації вимкнено. Пише також
// `report.json`: помилки консолі, невдалі запити, горизонтальна прокрутка.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const base = arg('--base', 'http://127.0.0.1:4310');
const out = path.resolve(arg('--out', 'out-prelaunch.shots'));
const only = arg('--only', '').split(',').filter(Boolean);

const PAGES = [
  { id: 'home', path: '/' },
  { id: 'countries', path: '/countries/' },
  { id: 'country-story', path: '/country/japan/' },
  { id: 'country-facts', path: '/country/andorra/' },
  { id: 'country-zones', path: '/country/united-states/' },
  { id: 'pass', path: '/pass/' },
  { id: 'toasts', path: '/toasts/' },
  { id: 'about', path: '/about/' },
  { id: 'privacy', path: '/privacy/' },
  { id: 'cookies', path: '/cookies/' },
  { id: 'terms', path: '/terms/' },
  { id: '404', path: '/no-such-page/' },
];
const LOCALES = [
  { id: 'en', prefix: '', lang: 'en-US' },
  { id: 'uk', prefix: '/uk', lang: 'uk-UA' },
];
const SIZES = [
  { id: 'p375', width: 375, height: 812 },
  { id: 'd1440', width: 1440, height: 900 },
];

fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const report = [];
for (const size of SIZES) {
  for (const locale of LOCALES) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      locale: locale.lang,
      timezoneId: 'Europe/Kyiv',
      reducedMotion: 'reduce',
      deviceScaleFactor: 1,
    });
    // Вибір мови вже зроблено — підказка мови не закриває знімок.
    await context.addInitScript((l) => window.localStorage.setItem('t2f:lang', l), locale.id);
    for (const p of PAGES) {
      if (only.length && !only.includes(p.id)) continue;
      const page = await context.newPage();
      const problems = [];
      page.on('console', (m) => {
        if (m.type() === 'error') problems.push(`console: ${m.text().slice(0, 300)}`);
      });
      page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
      page.on('response', (r) => {
        if (r.status() >= 400 && !(p.id === '404' && r.url().endsWith(p.path)))
          problems.push(`${r.status()} ${r.url()}`);
      });
      await page.clock.install({ time: new Date('2026-12-01T10:00:00Z') });
      await page.goto(`${base}${locale.prefix}${p.path}`, { waitUntil: 'load' });
      await page.waitForTimeout(800);
      // Прокрутити сторінку до кінця й назад: блоки, що вантажаться в полі зору (мапа), встигають з'явитися.
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += 600) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1200);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (overflow > 0) problems.push(`горизонтальна прокрутка: ${overflow}px`);
      const h1 = await page.locator('h1').count();
      if (h1 !== 1) problems.push(`h1: ${h1}`);
      const file = `${p.id}.${locale.id}.${size.id}.png`;
      await page.screenshot({ path: path.join(out, file), fullPage: true });
      report.push({ file, url: `${locale.prefix}${p.path}`, problems });
      if (problems.length) console.log(`${file}: ${problems.join(' | ')}`);
      await page.close();
    }
    await context.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
console.log(
  `shots: ${report.length} знімків → ${out}; з проблемами: ${report.filter((r) => r.problems.length).length}`,
);
