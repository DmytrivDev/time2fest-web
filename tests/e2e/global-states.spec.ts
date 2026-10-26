/**
 * Глобальні стани (T130): офлайн (quickstart 12), 404 (quickstart 13), зупинені `/api/time` і чат (SC-008).
 * Часовий пояс браузера — Київ; стартовий момент без параметрів — до півночі Лондона 22 хв.
 */
import type { Page } from '@playwright/test';
import { gotoAt, nowMs } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page, ytStub }, testInfo) => {
  void ytStub;
  void page;
  test.skip(
    testInfo.project.name === 'tv' || testInfo.project.name === 'prod',
    'Глобальні стани: телефон і десктоп',
  );
});
test.describe.configure({ timeout: 90_000 });

const START = '2027-01-01T01:50:00+02:00';
const OFFLINE_TEXT = 'Немає з’єднання · Відлік іде далі. Відео й чат повернуться самі';

const timer = (page: Page) => page.locator('[data-caption-timer]');
const player = (page: Page) => page.locator('iframe[data-yt-stub]').first();

async function openChat(page: Page) {
  if ((page.viewportSize()?.width ?? 0) < 1200) {
    const tab = page.getByRole('tab', { name: /^Чат/ });
    if (await tab.isVisible()) await tab.click();
  }
}

test.describe('Офлайн (quickstart 12)', () => {
  test('«Немає з’єднання», відлік іде далі, відео й чат повертаються самі', async ({
    page,
    context,
    ytStub,
  }) => {
    void ytStub;
    await gotoAt(page, START, 1);
    await expect(player(page)).toBeAttached();
    await expect(timer(page)).toBeVisible();

    await context.setOffline(true);
    const notice = page.locator('[data-offline-notice="on"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(OFFLINE_TEXT);
    // Повідомлення в потоці, не поверх плеєра, і не як alert.
    await expect(page.getByRole('alert').filter({ hasText: 'Немає з’єднання' })).toHaveCount(0);

    const t0 = await nowMs(page);
    const text0 = await timer(page).textContent();
    await expect
      .poll(async () => (await nowMs(page)) - t0, { timeout: 10_000 })
      .toBeGreaterThan(2_000);
    await expect.poll(() => timer(page).textContent(), { timeout: 10_000 }).not.toBe(text0);

    await context.setOffline(false);
    await expect(page.locator('[data-offline-notice="off"]')).toBeAttached();
    await expect(page.getByText(OFFLINE_TEXT)).toHaveCount(0);
    await expect(player(page)).toBeAttached();
    await openChat(page);
    await expect(page.getByRole('log').first()).toBeVisible();
  });
});

test.describe('Неіснуюча адреса (quickstart 13)', () => {
  test('404 з «На головну» і «Список країн»', async ({ page, ytStub }) => {
    void ytStub;
    await page.goto('/takoi-storinky-nemaie/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Такої сторінки немає' }),
    ).toBeVisible();
    const home = page.getByRole('main').getByRole('link', { name: 'На головну' });
    const list = page.getByRole('main').getByRole('link', { name: 'Список країн' });
    await expect(home).toBeVisible();
    await expect(list).toBeVisible();
    await expect(home).toHaveAttribute('href', '/');
    await expect(list).toHaveAttribute('href', /\/countries\/?$/);
    await expect(page.getByRole('banner')).toBeVisible();
    await expect(page.getByRole('contentinfo')).toBeVisible();
    await list.click();
    await expect(page).toHaveURL(/\/countries\/?$/);
  });
});

test.describe('Зупинені джерела (SC-008)', () => {
  test('без /api/time і без чату відео та відлік працюють', async ({ page, ytStub }) => {
    void ytStub;
    await page.route('**/api/time**', (route) => route.abort('connectionrefused'));
    await gotoAt(page, START, 1);
    await page.evaluate(() =>
      (
        window as unknown as { __t2f: { setChatAvailable(ok: boolean): void } }
      ).__t2f.setChatAvailable(false),
    );

    await expect(player(page)).toBeAttached();
    const text0 = await timer(page).textContent();
    await expect.poll(() => timer(page).textContent(), { timeout: 10_000 }).not.toBe(text0);

    await openChat(page);
    await expect(
      page.getByText('Чат тимчасово недоступний, повернемося за хвилину').first(),
    ).toBeVisible();
    // Плеєр лишився той самий і видимий.
    await expect(player(page)).toBeVisible();
  });
});
