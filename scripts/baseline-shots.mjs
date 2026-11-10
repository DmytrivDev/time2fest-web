/**
 * Еталонні скріншоти сайту для порівняння «до / після» (рішення власника 2026-11-09: перед пропорційним масштабом
 * зафіксувати поточний стан, щоб нічого з того, що працює, не змінилось).
 *
 * Знімає кожну сторінку на кожній ширині в замороженому моменті часу (speed=0), з прихованими відео (кадр YouTube
 * щоразу інший) і відповіддю на cookies. Друга команда порівнює дві теки попіксельно.
 *
 *   node scripts/baseline-shots.mjs shoot <тека> [baseURL]        — зняти (за замовчуванням http://localhost:3001)
 *   node scripts/baseline-shots.mjs diff <тека-до> <тека-після>    — порівняти, звіт diff.json у теці «після»
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const AT = '2026-12-31T23:38:00Z';

export const PAGES = [
  ['home', '/'],
  ['countries', '/countries/'],
  ['country-ua', '/country/ukraina/'],
  ['country-br', '/country/brazyliia/'],
  ['room', '/room/'],
  ['schedule', '/schedule/'],
  ['passport', '/passport/'],
  ['rating', '/rating/'],
  ['support', '/support/'],
  ['account', '/account/'],
  ['pass', '/pass/'],
  ['tv', '/tv/'],
  ['tv-info', '/tv-info/'],
  ['login', '/login/'],
  ['signup', '/signup/'],
  ['about', '/about/'],
  ['terms', '/terms/'],
  ['help', '/help/'],
];

export const WIDTHS = [
  [1920, 1080],
  [1520, 900],
  [1440, 900],
  [1280, 800],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [375, 812],
  [360, 800],
];

async function shoot(dir, base) {
  fs.mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const log = [];
  // SIZES=1024x768,834x1194 — інші розміри (напр. планшет); PAGES_ONLY=home,room — лише ці сторінки.
  const sizes = process.env.SIZES ? process.env.SIZES.split(',').map((x) => x.split('x').map(Number)) : WIDTHS;
  const only = process.env.PAGES_ONLY ? new Set(process.env.PAGES_ONLY.split(',')) : null;
  for (const [w, h] of sizes) {
    const context = await browser.newContext({
      viewport: { width: w, height: h },
      locale: 'uk-UA',
      timezoneId: 'Europe/Kyiv',
      reducedMotion: 'reduce',
      ...(w < 768 || process.env.TOUCH ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}),
    });
    // Згода на cookies відповіла «лише необхідні» — смуга не перекриває сторінку.
    await context.addInitScript(() => {
      try {
        if (!localStorage.getItem('t2f:baseline')) {
          localStorage.clear();
          localStorage.setItem('t2f:baseline', '1');
        }
      } catch {
        // сховище недоступне — знімаємо без скидання
      }
    });
    const page = await context.newPage();
    for (const [name, url] of PAGES) {
      if (name === 'tv' && w < 1024) continue;
      if (only && !only.has(name)) continue;
      const file = path.join(dir, process.env.SIZES ? `${name}-${w}x${h}.png` : `${name}-${w}.png`);
      try {
        await page.goto(`${base}${url}?t=${AT}&speed=0`, { waitUntil: 'load', timeout: 60_000 });
        await page.waitForFunction(() => Boolean(window.__t2f?.timeMachine), undefined, { timeout: 20_000 }).catch(() => {});
        const only = page.getByRole('button', { name: 'Лише необхідні', exact: true });
        if (await only.isVisible().catch(() => false)) await only.click();
        await page.waitForTimeout(2500);
        await page.addStyleTag({
          content: 'iframe, video { visibility: hidden !important; } *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
        });
        await page.waitForTimeout(300);
        // Лічильник «N нових» на згорнутому чаті росте з імітатором — маска, щоб знімки були стабільні.
        await page.screenshot({ path: file, fullPage: true, mask: [page.getByText(/^\d+\+? нових$/)] });
        log.push({ name, w, ok: true });
      } catch (e) {
        log.push({ name, w, ok: false, error: String(e).slice(0, 200) });
      }
    }
    await context.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(dir, 'shots.json'), JSON.stringify({ at: AT, base, taken: new Date().toISOString(), log }, null, 2));
  console.log(`знято: ${log.filter((x) => x.ok).length}, помилок: ${log.filter((x) => !x.ok).length}`);
}

async function diff(before, after) {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const files = fs.readdirSync(before).filter((f) => f.endsWith('.png'));
  const result = [];
  for (const f of files) {
    const b = path.join(before, f);
    const a = path.join(after, f);
    if (!fs.existsSync(a)) {
      result.push({ file: f, status: 'missing' });
      continue;
    }
    const r = await page.evaluate(
      async ([x, y]) => {
        const load = (src) =>
          new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = rej;
            i.src = src;
          });
        const [i1, i2] = await Promise.all([load(x), load(y)]);
        if (i1.width !== i2.width || i1.height !== i2.height) return { size: [i1.width, i1.height, i2.width, i2.height] };
        const c = document.createElement('canvas');
        c.width = i1.width;
        c.height = i1.height;
        const g = c.getContext('2d');
        g.drawImage(i1, 0, 0);
        const d1 = g.getImageData(0, 0, c.width, c.height).data;
        g.drawImage(i2, 0, 0);
        const d2 = g.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        for (let k = 0; k < d1.length; k += 4) {
          if (Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]) > 30) {
            n++;
            const p = k / 4;
            const x = p % c.width;
            const y = Math.floor(p / c.width);
            if (x < x0) x0 = x;
            if (y < y0) y0 = y;
            if (x > x1) x1 = x;
            if (y > y1) y1 = y;
          }
        }
        return { changed: n, total: c.width * c.height, box: n ? [x0, y0, x1, y1] : null };
      },
      [`data:image/png;base64,${fs.readFileSync(b).toString('base64')}`, `data:image/png;base64,${fs.readFileSync(a).toString('base64')}`],
    );
    result.push({ file: f, ...r });
  }
  await browser.close();
  fs.writeFileSync(path.join(after, 'diff.json'), JSON.stringify(result, null, 2));
  const bad = result.filter((r) => r.status === 'missing' || r.size || (r.changed ?? 0) > 0);
  console.log(`файлів: ${result.length}, з різницею: ${bad.length}`);
  for (const r of bad) console.log(' ', r.file, r.size ? `розмір ${r.size.join('×')}` : r.status ?? `${r.changed} px у ${JSON.stringify(r.box)}`);
}

const [cmd, a1, a2] = process.argv.slice(2);
if (cmd === 'shoot') await shoot(a1, a2 ?? 'http://localhost:3001');
else if (cmd === 'diff') await diff(a1, a2);
else console.log('node scripts/baseline-shots.mjs shoot <тека> [baseURL] | diff <до> <після>');
