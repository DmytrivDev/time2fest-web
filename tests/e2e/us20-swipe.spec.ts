/**
 * Закриття шторок свайпом униз (Т9, правка власника 2026-11-16): справжній дотик (CDP), зона — ручка й шапка вікна
 * (`data-swipe-zone`, `lib/overlay/useSwipeDown.ts`); жест на прокручуваному вмісті шторку не закриває; вікно чату
 * («Назад · Автор повідомлення») згортає чат так само, як його шапка.
 * Телефон — проєкт `phone` (390 × 844); решту проєктів пропускаємо.
 */
import type { Locator, Page } from '@playwright/test';
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA', hasTouch: true, viewport: { width: 390, height: 844 } });
// eslint-disable-next-line no-empty-pattern -- Playwright вимагає деструктурування першого аргументу
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === 'desktop' || testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Свайп шторок — телефон');
});
test.describe.configure({ timeout: 90_000 });

const AT = '2027-01-01T01:38:00+02:00';

async function seed(page: Page) {
  await page.addInitScript(() => {
    const state = {
      v: 1, id: 'g-e2e-swipe', locale: 'uk',
      consent: { answered: true, necessary: true, analytics: false, marketing: false, facebookVideo: false },
      reducedMotion: true, chatHidden: false, zoneStreamsCollapsed: false,
      chat: { lastRoom: 'world', sentAt: [] }, room: { windows: [], soundSlot: null },
      stamps: [], pendingPresence: {}, rate: {}, offers: { nightId: '2026-27', history: [], visible: null },
      schedule: [], hasPass: false, nightId: '2026-27',
    };
    if (!localStorage.getItem('t2f:guest:v1')) localStorage.setItem('t2f:guest:v1', JSON.stringify({ state, version: 1 }));
  });
}

/** Свайп пальцем (CDP): від центру `from` на `dy` px униз, кількома кроками. */
async function swipeDown(page: Page, from: Locator, dy = 140, offsetY = 0) {
  const box = (await from.boundingBox())!;
  const x = box.x + box.width / 2 - 40;
  const y = box.y + (offsetY || box.height / 2);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 8 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

const menuButton = (page: Page) => page.locator('header button[aria-haspopup="dialog"]').filter({ hasText: 'Меню' }).first();
const layer = (page: Page) => page.locator('[data-window-layer]:not([hidden])');

test('меню: свайп униз за шапку закриває шторку', async ({ page }) => {
  await seed(page);
  await gotoAt(page, AT, 0, '/');
  await menuButton(page).click();
  await expect(layer(page)).toBeVisible();
  await swipeDown(page, layer(page).locator('[data-swipe-zone]').first());
  await expect(layer(page)).toBeHidden();
});

test('вікно тосту: свайп по шапці закриває; свайп по прокручуваному вмісту — ні', async ({ page }) => {
  await seed(page);
  await gotoAt(page, AT, 0, '/');
  await page.locator('[data-toast-strip] [data-action="toast-open"]').first().click();
  await expect(layer(page)).toBeVisible();
  // Тіло: палець у вмісті не веде шторку.
  await swipeDown(page, layer(page).locator('[data-slot-body]').first(), 160);
  await expect(layer(page)).toBeVisible();
  await swipeDown(page, layer(page).locator('[data-swipe-zone]').nth(1));
  await expect(layer(page)).toBeHidden();
});

test('чат: свайп по шапці згортає; у вікні автора (Назад · Автор) — так само', async ({ page }) => {
  await seed(page);
  await gotoAt(page, AT, 0, '/');
  await page.locator('[data-dock-expand]').click();
  const dock = page.locator('[data-chat-dock]');
  await expect(dock).toHaveAttribute('data-state', 'expanded');
  await page.getByRole('log').first().getByRole('button', { name: /^Тарас, / }).first().click();
  const author = page.locator('[data-author-header]');
  await expect(author).toBeVisible();
  await swipeDown(page, author);
  await expect(dock).toHaveAttribute('data-state', 'collapsed');
});

for (const path of ['/pass/', '/login/']) {
  test(`${path}: меню в шторці (SideDialog) закривається свайпом`, async ({ page }) => {
    await seed(page);
    await gotoAt(page, AT, 0, path);
    await menuButton(page).click();
    const menu = page.locator('[data-menu]');
    await expect(menu).toBeVisible();
    await swipeDown(page, menu.locator('header'));
    await expect(menu).toBeHidden();
  });
}

test('юридична сторінка: шторка змісту (Sheet) закривається свайпом за ручку', async ({ page }) => {
  await seed(page);
  await gotoAt(page, AT, 0, '/terms/');
  const bar = page.locator('[data-legal-bar]');
  if (!(await bar.count())) test.skip(true, 'на цій сторінці немає шторки змісту');
  await bar.click();
  const sheet = page.locator('[data-sheet]');
  await expect(sheet).toBeVisible();
  await swipeDown(page, sheet.locator('[data-swipe-zone]').first());
  await expect(sheet).toBeHidden();
});
