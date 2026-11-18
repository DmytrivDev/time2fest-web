// Димова перевірка зібраного передстартового сайту в браузері (сервер: node scripts/prelaunch/serve.mjs).
//   node scripts/prelaunch/smoke.mjs [--base http://127.0.0.1:4310] [--prefix /en]
// `--prefix` — префікс англійської мови: порожній для збірки для домену, `/en` для демо.
import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const base = arg('--base', 'http://127.0.0.1:4310');
const en = arg('--prefix', '');

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch();

// 1. Перехід між сторінками без перезавантаження, адреси без префікса головної мови.
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const bad = [];
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  await page.goto(`${base}${en}/`, { waitUntil: 'load' });
  await page.evaluate(() => (window.__smoke = 1));
  await page.locator('header nav a', { hasText: 'Countries' }).first().click();
  await page.waitForURL(`**${en}/countries/`);
  check((await page.locator('h1').count()) === 1, 'головна → «Країни»: один h1');
  check((await page.evaluate(() => window.__smoke)) === 1, 'перехід без перезавантаження сторінки');
  await page.locator('a[href$="/country/japan/"]').first().click();
  await page.waitForURL(`**${en}/country/japan/`);
  check(
    (await page.locator('article[data-state="story"]').count()) === 1,
    'Японія — стан «описано»',
  );
  check(
    await page
      .locator('h1')
      .innerText()
      .then((t) => t.includes('Japan')),
    'заголовок сторінки країни англійською',
  );
  await page.goto(`${base}${en}/country/andorra/`, { waitUntil: 'load' });
  check(
    (await page.locator('article[data-state="facts"]').count()) === 1,
    'Андорра — стан «лише факти»',
  );
  check(
    (await page.getByText(/збираємо|collecting|coming soon/i).count()) === 0,
    'без заглушки «збираємо розповідь»',
  );
  // Перемикач мов: відкривається й веде на ту саму сторінку українською.
  await page.locator('button[aria-expanded]', { hasText: 'English' }).first().click();
  const uk = page.locator('a[hreflang="uk"]', { hasText: 'Українська' }).first();
  check(
    (await uk.getAttribute('href')) === '/uk/country/andorra/',
    'перемикач мов веде на /uk/country/andorra/',
  );
  await uk.click();
  await page.waitForURL('**/uk/country/andorra/');
  check(
    (await page.evaluate(() => document.documentElement.lang)) === 'uk',
    '<html lang="uk"> на українській сторінці',
  );
  check(
    (await page.evaluate(() => localStorage.getItem('t2f:lang'))) === 'uk',
    'вибір мови запам’ятано',
  );
  // Мапа на головній малюється й не падає без бекенду.
  await page.goto(`${base}/uk/#map`, { waitUntil: 'load' });
  await page.locator('#map svg path').first().waitFor({ timeout: 20000 });
  check(true, 'мапа поясів намальована');
  // Сторінки пасу й тостів: продажу немає.
  for (const path of ['/pass/', '/toasts/']) {
    await page.goto(`${base}/uk${path}`, { waitUntil: 'load' });
    check(
      (await page.getByText('Продаж стане доступний згодом').count()) >= 1,
      `${path}: «Продаж стане доступний згодом»`,
    );
    // Кнопки акордеона «Питання й відповіді» (`aria-expanded`) — це питання, а не дія; їх не рахуємо.
    const buy = page
      .locator('button:not([aria-expanded]), a[role="button"]')
      .filter({ hasText: /купити|оформити|оплатити|сказати тост/i });
    check((await buy.count()) === 0, `${path}: кнопки оформлення немає`);
  }
  check(
    (await page.getByRole('link', { name: /увійти|реєстрац|sign in/i }).count()) === 0,
    'у шапці й підвалі немає входу',
  );
  check(errors.length === 0, `без помилок сторінки${errors.length ? `: ${errors[0]}` : ''}`);
  check(
    bad.length === 0,
    `без невдалих запитів${bad.length ? `: ${bad.slice(0, 3).join(', ')}` : ''}`,
  );
  await context.close();
}

// 2. Підказка мови: браузер українською на англійській сторінці; без автоматичного перекидання.
{
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    locale: 'uk-UA',
  });
  const page = await context.newPage();
  await page.goto(`${base}${en}/about/`, { waitUntil: 'load' });
  const hint = page.locator('[data-lang-hint="uk"]');
  await hint.waitFor({ timeout: 10000 });
  check(new URL(page.url()).pathname === `${en}/about/`, 'підказка мови не перекидає сама');
  check((await hint.innerText()).includes('Читати українською?'), 'підказка мовою, яку пропонуємо');
  await hint.locator('button').click();
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  check(
    (await page.locator('[data-lang-hint]').count()) === 0,
    'закрита підказка більше не з’являється',
  );
  // Телефон: меню відкривається, у ньому навігація й мови.
  await page.locator('button[aria-controls="site-menu"]').click();
  check(await page.locator('#site-menu a[hreflang="uk"]').isVisible(), 'меню телефона: мови видно');
  await context.close();
}

// 3. Невідома адреса — сторінка 404 своєї мови.
{
  const page = await browser.newPage();
  const res = await page.goto(`${base}/uk/nema-takoi/`, { waitUntil: 'load' });
  check(res?.status() === 404, '/uk/nema-takoi/ → код 404');
  check(
    (await page.locator('[data-page="S-PL-404"][data-locale="uk"]').count()) === 1,
    'сторінка 404 українською',
  );
  await page.close();
}

await browser.close();
console.log(failures.length ? `smoke: помилок ${failures.length}` : 'smoke: усе гаразд');
process.exit(failures.length ? 1 : 0);
