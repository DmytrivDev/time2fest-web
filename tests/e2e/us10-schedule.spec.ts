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
      // Пас — лише в того, хто увійшов в акаунт з пасом (правка власника 2026-11-10).
      if (pass && !localStorage.getItem('t2f:auth:v1')) localStorage.setItem('t2f:auth:v1', JSON.stringify({ state: { user: { email: 'pass@example.com', via: 'email', signedInAt: 1 }, accounts: ['pass@example.com'], letter: null, sends: [], passes: { 'pass@example.com': 1 } }, version: 1 }));
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

test('старий стан: «пас на пристрої» без входу й графік з Португалією й Іспанією — пасу немає, графік не видно (правка 2026-11-10)', async ({ page }) => {
  // До правки пас жив на пристрої окремо від входу: лишався після виходу, а графік, складений з ним, показувався гостю.
  await seed(page, true, ['evt_lisbon_2027', 'evt_madrid_2027']);
  await page.addInitScript(() => localStorage.removeItem('t2f:auth:v1'));
  await gotoAt(page, AT, 1, '/schedule/');
  const root = page.locator('[data-schedule-page]');
  await expect(root).toContainText('Графік — у Новорічному пасі');
  await expect(root.locator('[data-slot="PT"], [data-slot="ES"]')).toHaveCount(0);
  await page.locator('[data-zone="utc+0000"]').getByRole('button', { name: /Додати країну/ }).first().click();
  await expect(page.locator('[data-window="O-SCHEDULE-GATE"]')).toBeVisible();
  await expect(page.locator('[data-schedule-zone]')).toHaveCount(0);
});

test('відео головної не грає на сторінці без плеєра: графік — пауза, назад на головну — грає далі (правка 2026-11-10)', async ({ page, ytStub }) => {
  await seed(page, false, []);
  await gotoAt(page, AT, 1, '/');
  await ytStub.waitForPlayer();
  await expect.poll(async () => (await ytStub.players())[0]?.state).toBe(1);
  // Перехід усередині сайту (той самий макет і той самий плеєр).
  // Посилання футера (на телефоні — у згорнутому акордеоні, тож клік скриптом).
  await page.locator('footer a[href="/schedule/"]').first().evaluate((a: HTMLAnchorElement) => a.click());
  await page.waitForURL(/\/schedule\//);
  await expect.poll(async () => (await ytStub.players())[0]?.state).toBe(2);
  await page.goBack();
  await page.waitForURL((u) => u.pathname === '/');
  await expect.poll(async () => (await ytStub.players())[0]?.state).toBe(1);
  expect((await ytStub.counters()).created).toBe(1);
});
