/**
 * US8.2 (T083): у робочій збірці машини часу немає. Проєкт `prod` (порт 3100, збірка без NEXT_PUBLIC_ENV=test).
 * Файл названо `*.prod.spec.ts`, щоб його підхопив `testMatch` проєкту `prod` у playwright.config.ts.
 */
import { expect, test } from '@playwright/test';
import { bundleFilesContaining, STATIC_DIR } from './helpers/bundle';

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== 'prod', 'лише робоча збірка');
});

/** Маркер панелі в коді (атрибут `data-t2f-time-machine`). */
const PANEL_MARKER = 'data-t2f-time-machine';

test.describe('US8.2 · робоча збірка', () => {
  test('параметри t, speed, panel ігноруються; window.__t2f немає', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => warnings.push(m.text()));
    await page.goto('/?t=2020-05-05T05:05:05Z&speed=600&panel=1');
    await expect(page.locator('main#main')).toBeVisible();
    expect(await page.evaluate(() => '__t2f' in window)).toBe(false);
    expect(await page.locator('[data-t2f-time-machine]').count()).toBe(0);
    await expect(page.getByRole('dialog', { name: 'Машина часу' })).toHaveCount(0);
    // Адреса не переписується машиною часу.
    expect(new URL(page.url()).searchParams.get('t')).toBe('2020-05-05T05:05:05Z');
    expect(await page.evaluate(() => sessionStorage.getItem('t2f:session:timeMachine'))).toBeNull();
    expect(warnings.filter((w) => w.includes('[time-machine]'))).toEqual([]);
  });

  test('Ctrl+Alt+T і Esc нічого не відкривають', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main#main')).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+Alt+t');
    await page.waitForTimeout(300);
    await expect(page.getByRole('dialog', { name: 'Машина часу' })).toHaveCount(0);
    expect(await page.locator('[data-t2f-time-machine]').count()).toBe(0);
  });

  // Запобіжник шва (2026-11-14): робоча збірка — режим `http`; бекенду ще немає, тож замість сайту — «сервер недоступний»,
  // а імітований чат, вхід, оплати й тости в пакет не потрапляють.
  test('режим http без бекенду: BackendDown замість сайту, помилка в консолі', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/');
    await expect(page.locator('main#main [data-backend-down]')).toBeVisible();
    await expect.poll(() => errors.some((e) => e.includes('сервіс недоступний'))).toBe(true);
  });

  test('у пакеті JS немає імітації (чат, вхід, оплати, тости)', () => {
    for (const marker of ['[переклад]', 't2f:orders:v1', 'you@gmail.com', 'Дякую, що можна дивитися все разом']) {
      expect(bundleFilesContaining(marker), marker).toEqual([]);
    }
  });

  test('у пакеті JS немає рядка-маркера панелі', () => {
    // Збірка має існувати: інакше перевірка порожня.
    expect(() => bundleFilesContaining('t2f', STATIC_DIR)).not.toThrow();
    expect(bundleFilesContaining(PANEL_MARKER)).toEqual([]);
  });
});
