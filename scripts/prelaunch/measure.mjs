// Заміри ширини контейнера й шапки: демо поруч із передстартовим сайтом.
//   node scripts/prelaunch/measure.mjs [--pre http://127.0.0.1:4320] [--demo http://127.0.0.1:4321] [--widths 1440,1920]
// Для кожної пари сторінок друкує: шапку (висота, position, фон), ліву й праву межу вмісту (найширші блоки
// всередині main), і чи є колонка праворуч.
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const pre = arg('--pre', 'http://127.0.0.1:4320');
const demo = arg('--demo', 'http://127.0.0.1:4321');
const widths = arg('--widths', '1440,1920').split(',').map(Number);
const T = '?t=2026-12-01T12:00:00%2B02:00&speed=0';
const PAIRS = [
  { id: 'home', demo: `/before/${T}`, pre: '/uk/' },
  { id: 'live-home', demo: `/${T}`, pre: '/uk/' },
  { id: 'pass', demo: `/pass/${T}`, pre: '/uk/pass/' },
  { id: 'countries', demo: `/countries/${T}`, pre: '/uk/countries/' },
  { id: 'country-fr', demo: `/country/frantsiia/${T}`, pre: '/uk/country/france/' },
  { id: 'privacy', demo: `/privacy/${T}`, pre: '/uk/privacy/' },
];
const only = arg('--only', '').split(',').filter(Boolean);

async function measure(browser, url, width) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
  });
  await ctx.addInitScript(() => {
    localStorage.setItem('t2f:lang', 'uk');
    localStorage.setItem(
      't2f:consent:v1',
      JSON.stringify({
        state: { decided: true, analytics: false, facebookVideo: false },
        version: 1,
      }),
    );
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date('2026-12-01T10:00:00Z') });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const r = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return [Math.round(b.left), Math.round(b.right), Math.round(b.height)];
    };
    const header = document.querySelector('header');
    const hs = header ? getComputedStyle(header) : null;
    // Найлівіший і найправіший край видимих блоків у main (крім фону на всю ширину).
    const main = document.querySelector('main') ?? document.body;
    let L = Infinity;
    let R = -Infinity;
    for (const el of main.querySelectorAll(
      'section, article, aside, h1, h2, nav, [class*="card"]',
    )) {
      const b = el.getBoundingClientRect();
      if (b.width < 40 || b.height < 20 || b.width >= innerWidth - 2) continue;
      L = Math.min(L, b.left);
      R = Math.max(R, b.right);
    }
    const headerInner = header?.querySelector('a[href]')?.getBoundingClientRect();
    const lastHeaderItem = header
      ? [...header.querySelectorAll('a,button')]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .at(-1)
          ?.getBoundingClientRect()
      : null;
    return {
      header: header
        ? {
            box: box(header),
            pos: hs.position,
            bg: hs.backgroundColor,
            logoL: Math.round(headerInner?.left ?? -1),
            lastR: Math.round(lastHeaderItem?.right ?? -1),
          }
        : null,
      content: [Math.round(L), Math.round(R)],
      aside: box(document.querySelector('aside')),
    };
  });
  await ctx.close();
  return r;
}

const browser = await chromium.launch();
for (const p of PAIRS) {
  if (only.length && !only.includes(p.id)) continue;
  for (const w of widths) {
    const d = await measure(browser, demo + p.demo, w);
    const q = await measure(browser, pre + p.pre, w);
    console.log(`${p.id} @${w}\n  demo ${JSON.stringify(d)}\n  pre  ${JSON.stringify(q)}`);
  }
}
await browser.close();
