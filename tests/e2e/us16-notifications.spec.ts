/**
 * Сповіщення (дошка `Desk-Notif-New`, рішення власника 2026-11-09): дзвіночок з лічильником відкриває список на місці чату
 * (десктоп) чи шторкою (телефон); нові зверху, «Прочитати все»; «Налаштувати» — у тому ж вікні; відповідь у чаті
 * створює сповіщення сама.
 */
import { expect, test } from './fixtures/youtube-stub';
import { gotoAt, waitForTimeApi } from './fixtures/time';

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Сповіщення: телефон і десктоп');
});

const bell = (page: import('@playwright/test').Page) => page.getByRole('banner').getByRole('button', { name: /^Сповіщення/ });

test('дзвіночок → список: нові, «Прочитати все», налаштування', async ({ page, ytStub }) => {
  void ytStub;
  await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
  await page.evaluate(() => localStorage.removeItem('t2f:notif:v1'));
  await page.evaluate(() => (window as unknown as { __t2f: { setNotifications(n: number): void } }).__t2f.setNotifications(3));
  await expect(bell(page)).toHaveAttribute('aria-label', 'Сповіщення, 3 нові');
  await bell(page).click();
  const list = page.locator('[data-block="notif-list"]');
  await expect(list.getByRole('heading', { name: 'Нові · 3' })).toBeVisible();
  if (test.info().project.name !== 'phone') await expect(page.locator('#chat-slot [data-block="notif-list"]')).toBeVisible();
  await list.getByRole('button', { name: 'Прочитати все' }).click();
  await expect(list.getByRole('heading', { name: 'Раніше' })).toBeVisible();
  await expect(bell(page)).toHaveAttribute('aria-label', 'Сповіщення');
  await list.getByRole('button', { name: 'Налаштувати' }).click();
  const settings = page.locator('[data-block="notif-settings"]');
  await settings.getByRole('switch', { name: 'Відповіді в чаті' }).click();
  await expect(settings.getByRole('switch', { name: 'Відповіді в чаті' })).not.toBeChecked();
});

test('відповідь у чаті створює сповіщення', async ({ page, ytStub }) => {
  void ytStub;
  await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
  await page.evaluate(() => {
    localStorage.removeItem('t2f:notif:v1');
    const g = JSON.parse(localStorage.getItem('t2f:guest:v1')!);
    g.state.nick = 'Олена';
    localStorage.setItem('t2f:guest:v1', JSON.stringify(g));
  });
  await page.reload();
  await waitForTimeApi(page);
  await page.evaluate(() => (window as unknown as { __t2f: { emitReply(): void } }).__t2f.emitReply());
  await expect(bell(page)).toHaveAttribute('aria-label', 'Сповіщення, 1 нове');
  await bell(page).click();
  await expect(page.locator('[data-notif="reply"]')).toContainText('Відповідь від');
});

test('клік по сповіщенню: вікно відкрите, доки не відкриється нова сторінка (без проблиску чату)', async ({ page, ytStub }) => {
  void ytStub;
  await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
  await page.evaluate(() => localStorage.removeItem('t2f:notif:v1'));
  await page.evaluate(() => (window as unknown as { __t2f: { setNotifications(n: number): void } }).__t2f.setNotifications(3));
  await bell(page).click();
  const list = page.locator('[data-block="notif-list"]');
  await expect(list).toBeVisible();
  // Стежимо: у мить, коли вікно сповіщень зникає, адреса вже має бути нова.
  await page.evaluate(() => {
    const w = window as unknown as { __notifClosedAt?: string };
    const mo = new MutationObserver(() => {
      if (!document.querySelector('[data-block="notif-list"]') && w.__notifClosedAt === undefined) {
        w.__notifClosedAt = location.pathname;
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
  const link = list.locator('a[data-notif][href^="/passport"]').first();
  await link.click();
  await expect(page).toHaveURL(/\/passport\/?/);
  await expect(list).toHaveCount(0);
  const closedAt = await page.evaluate(() => (window as unknown as { __notifClosedAt?: string }).__notifClosedAt);
  expect(closedAt).toMatch(/^\/passport/);
});
