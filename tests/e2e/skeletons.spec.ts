/**
 * Скелетони сторінок (правка власника 2026-11-10): при клієнтському переході показується скелетон саме цієї сторінки
 * (власний `loading.tsx` сегмента), а не загальний скелетон групи `(live)` з плеєром головної; і той самий маркер
 * `data-skeleton`, що в статичному HTML до гідратації (пряме відкриття / перезавантаження).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/youtube-stub';

const JS = /\/_next\/static\/.*\.js(\?|$)/;

const CASES = [
  { url: '/country/ukraina/', kind: 'country' },
  { url: '/login/', kind: 'login' },
  { url: '/schedule/', kind: 'schedule' },
] as const;

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Скелетони: телефон і десктоп');
});

/**
 * Клієнтський перехід з головної, поки JS цільової сторінки ще вантажиться: нові чанки тримаємо, доки тест не відпустить
 * (у dev-збірці RSC-відповідь буває довшою за будь-яку фіксовану затримку чанків — тоді скелетон не встигав з’явитись).
 */
async function navigateSlow(page: Page, url: string) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as unknown as { next?: { router?: unknown } }).next?.router));
  // Головна догружає власні чанки (ліниві частини) — даємо їй завершити, щоб затримувати лише чанки цільової сторінки.
  await page.waitForTimeout(2500);
  let release = () => undefined as void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  await page.route(JS, async (route) => {
    await Promise.race([gate, new Promise((r) => setTimeout(r, 45_000))]);
    await route.continue().catch(() => undefined);
  });
  await page.evaluate((u) => (window as unknown as { next: { router: { push: (u: string) => void } } }).next.router.push(u), url);
  return release;
}

for (const { url, kind } of CASES) {
  test(`${url}: скелетон «${kind}» — і при переході, і до гідратації`, async ({ page, context }) => {
    test.setTimeout(120_000);
    // Клієнтський перехід: скелетон цієї сторінки, не загальний (у `(live)` раніше — плеєр головної).
    const release = await navigateSlow(page, url);
    await expect(page.locator(`[data-skeleton="${kind}"]`).first()).toBeAttached({ timeout: 40_000 });
    await expect(page.locator('[data-page-skeleton]')).toHaveCount(0);
    release();
    await page.unroute(JS);
    await expect(page.locator(`[aria-busy="true"][data-skeleton="${kind}"]`)).toHaveCount(0, { timeout: 60_000 });

    // Пряме відкриття: статичний HTML без JS має той самий маркер.
    const fresh = await context.newPage();
    await fresh.route(JS, (route) => route.abort());
    await fresh.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(fresh.locator(`[data-skeleton="${kind}"]`).first()).toBeAttached();
    await fresh.close();
  });
}
