/**
 * Н1 (2026-11-16): шапка, що ховається й повертається. Сторінка з плеєром — угорі в потоці, закріплена лише після плеєра;
 * сторінка без плеєра — липка завжди. Телефон і десктоп.
 */
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Н1: телефон і десктоп');
});

const dockMode = (page: import('@playwright/test').Page) => page.locator('[data-header-dock]').getAttribute('data-header-dock');
const headerTop = (page: import('@playwright/test').Page) => page.locator('[data-header-dock] > header').evaluate((e) => e.getBoundingClientRect().top);

test('сторінка з плеєром: у потоці → закріплена після плеєра → назад у потік', async ({ page }) => {
  await gotoAt(page, '2027-01-01T01:38:00+02:00', 0, '/');
  await page.waitForSelector('[data-player-slot="main"]');
  expect(await dockMode(page)).toBe('flow');
  const slotBottom = await page.locator('[data-player-slot="main"]').evaluate((e) => e.getBoundingClientRect().bottom + window.scrollY);
  // Угорі шапка їде зі сторінкою і не накриває відео.
  await page.evaluate(() => window.scrollTo(0, 60));
  await page.waitForTimeout(150);
  expect(await dockMode(page)).toBe('flow');
  expect(await headerTop(page)).toBeLessThan(0);
  // Минули плеєр — закріплена, у висоту шапки місце в потоці лишилось (стрибка немає).
  const heightBefore = await page.locator('[data-header-dock]').evaluate((e) => e.getBoundingClientRect().height);
  await page.evaluate((y) => window.scrollTo(0, y + 40), slotBottom);
  await page.waitForTimeout(500);
  expect(await dockMode(page)).toBe('fixed');
  expect(await headerTop(page)).toBe(0);
  expect(await page.locator('[data-header-dock]').evaluate((e) => e.getBoundingClientRect().height)).toBe(heightBefore);
  // Назад до плеєра — ховається.
  await page.evaluate((y) => window.scrollTo(0, y - 200), slotBottom);
  await page.waitForTimeout(700);
  expect(await dockMode(page)).toBe('flow');
  expect(await headerTop(page)).toBeLessThan(0);
});

test('сторінка без плеєра: шапка липка завжди', async ({ page }) => {
  await gotoAt(page, '2027-01-01T01:38:00+02:00', 0, '/countries/');
  await page.waitForSelector('[data-header-dock]');
  await page.waitForTimeout(300);
  expect(await dockMode(page)).toBe('sticky');
  await page.evaluate(() => window.scrollTo(0, 800));
  await page.waitForTimeout(200);
  expect(await headerTop(page)).toBe(0);
});
