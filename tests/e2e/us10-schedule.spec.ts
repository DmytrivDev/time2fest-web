/**
 * «Мій графік» (`/schedule/`) за дошками `Desk-Schedule-New` / `Phone-Schedule-New` v4 (рішення власника 2026-11-06):
 * пояси — акордеон зі слотами (до 4 країн, стільки слотів, скільки країн у поясі), поточний пояс відкритий; «+» у вільному
 * слоті — країни поясу на місці чату (телефон — шторкою); додали — тостер «Додано в графік · Повернути»; пояс повний —
 * «Замінити в графіку?»; без пасу — вікно «Графік — у Новорічному пасі».
 */
import type { Page } from '@playwright/test';
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Графік: телефон і десктоп');
});
test.describe.configure({ timeout: 90_000 });

const AT = '2027-01-01T01:38:00+02:00';

async function seed(page: Page, pass: boolean, schedule: string[]) {
  await page.addInitScript(
    ({ pass, schedule }) => {
      const state = {
        v: 1,
        id: 'g-e2e',
        locale: 'uk',
        consent: { answered: true, necessary: true, analytics: false, marketing: false, facebookVideo: false },
        reducedMotion: false,
        chatHidden: false,
        zoneStreamsCollapsed: false,
        chat: { lastRoom: 'world', sentAt: [] },
        room: { windows: [], soundSlot: null },
        stamps: [],
        pendingPresence: {},
        rate: {},
        offers: { nightId: '2026-27', history: [], visible: null },
        schedule,
        hasPass: pass,
        firstRow: {},
        nightId: '2026-27',
      };
      if (!localStorage.getItem('t2f:guest:v1')) localStorage.setItem('t2f:guest:v1', JSON.stringify({ state, version: 1 }));
    },
    { pass, schedule },
  );
}

test('поточний пояс відкритий, слоти; «+» — країни поясу; додали — тостер і «Повернути»', async ({ page }) => {
  await seed(page, true, ['evt_london_2027']);
  await gotoAt(page, AT, 1, '/schedule/');
  const now = page.locator('[data-zone="utc+0000"]');
  await expect(now).toHaveAttribute('data-open', 'true');
  await expect(now.locator('[data-slot="GB"]')).toBeVisible();
  // Пояс UTC−1 (Кабо-Верде, Азорські острови) — 2 країни, 2 слоти.
  await expect(page.locator('[data-zone="utc-0100"]')).toContainText('0 з 2');
  await now.getByRole('button', { name: /Додати країну/ }).first().click();
  const panel = page.locator('[data-schedule-zone="utc+0000"]');
  await expect(panel).toBeVisible();
  await panel.locator('[data-schedule-country="PT"] button[aria-pressed]').click();
  const toast = page.locator('[data-schedule-toast]');
  await expect(toast).toContainText('Додано в графік — Португалія');
  await expect(now.locator('[data-slot="PT"]')).toBeVisible();
  await toast.getByRole('button', { name: 'Повернути' }).click();
  await expect(now.locator('[data-slot="PT"]')).toHaveCount(0);
  // Поточний пояс можна згорнути й розгорнути знову (правка власника 2026-11-07).
  await now.getByRole('button', { expanded: true }).click();
  await expect(now).not.toHaveAttribute('data-open', 'true');
  await now.getByRole('button', { expanded: false }).click();
  await expect(now).toHaveAttribute('data-open', 'true');
});

test('пояс повний — «Замінити в графіку?», нова країна на місці старої', async ({ page }) => {
  await seed(page, true, ['evt_rio-de-janeiro_2027', 'evt_buenos-aires_2027', 'evt_asuncion_2027']);
  await gotoAt(page, AT, 1, '/schedule/');
  const zone = page.locator('[data-zone="utc-0300"]');
  await zone.getByRole('button', { expanded: false }).click();
  await zone.getByRole('button', { name: /Додати країну/ }).first().click();
  const panel = page.locator('[data-schedule-zone="utc-0300"]');
  await panel.locator('[data-schedule-country="UY"] button[aria-pressed]').click();
  await panel.locator('[data-schedule-country="CL"] button[aria-pressed]').click();
  const replace = page.locator('[data-schedule-replace]');
  await expect(replace).toBeVisible();
  await replace.locator('[data-replace-country="PY"] button').click();
  await expect(page.locator('[data-schedule-toast]')).toContainText('Замінено в графіку: Парагвай → Чилі');
  await expect(zone.locator('[data-slot]')).toHaveCount(4);
  await expect(zone.locator('[data-slot]').nth(2)).toHaveAttribute('data-slot', 'CL');
});

test('без пасу — «+» відкриває «Графік — у Новорічному пасі»', async ({ page }) => {
  await seed(page, false, []);
  await gotoAt(page, AT, 1, '/schedule/');
  await expect(page.locator('[data-schedule-page]')).toContainText('Графік — у Новорічному пасі');
  await page.locator('[data-zone="utc+0000"]').getByRole('button', { name: /Додати країну/ }).first().click();
  await expect(page.locator('[data-window="O-SCHEDULE-GATE"]')).toBeVisible();
});
