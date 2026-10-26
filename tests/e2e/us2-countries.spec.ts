/**
 * US2 — список країн (T088, FR-081). Сторінка `/countries/` з «машиною часу»: країни згруповані за станом
 * поясів (наживо / далі / ще попереду / уже зустріли), пошук за назвою країни чи міста з порожнім станом,
 * перемикач «Лише з трансляціями», діалог «Фільтри» (0 статусів → «Показати 0 країн» неактивна з поясненням),
 * перехід на сторінку країни; axe на списку й на відкритому діалозі.
 * Момент за замовчуванням: 2027-01-01T01:38+02:00 — Лондон (UTC+0) наживо, Франція вже зустріла.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/youtube-stub';
import { runAxe } from './fixtures/axe';
import { DEFAULT_START, gotoAt } from './fixtures/time';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name === 'tv' || testInfo.project.name === 'prod',
    'US2: телефон і десктоп',
  );
});

const EMPTY = 'Нічого не знайшли — спробуй іншу назву';
const search = (page: Page) => page.getByRole('searchbox', { name: 'Знайти країну чи місто' });
const streamsOnly = (page: Page) => page.getByRole('switch', { name: 'Лише з трансляціями' });
const row = (page: Page, iso: string) => page.locator(`[data-country-row="${iso}"]`);
const group = (page: Page, id: string) => page.locator(`[data-zone-group="${id}"]`);

async function openList(page: Page) {
  await gotoAt(page, DEFAULT_START, 0, '/countries/');
  await expect(page.getByRole('heading', { level: 1, name: 'Країни й міста' })).toBeVisible();
}

async function openFilters(page: Page) {
  await page.getByRole('button', { name: /^Фільтри/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Фільтри' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('Список країн', () => {
  test('країни згруповані за поясами: Лондон наживо, Франція вже зустріла', async ({ page }) => {
    await openList(page);
    const live = group(page, 'live');
    await expect(live).toBeVisible();
    await expect(live.getByRole('heading', { name: /^Зараз наживо/ })).toBeVisible();
    await expect(live.locator('[data-country-row="GB"][data-status="live"]')).toBeVisible();
    await expect(group(page, 'next')).toBeVisible();
    await expect(group(page, 'next').getByRole('heading', { name: /^Далі/ })).toBeVisible();
    await expect(group(page, 'later')).toHaveCount(1);
    await expect(group(page, 'met')).toHaveCount(1);
    await expect(group(page, 'met').getByRole('heading', { name: /^Уже зустріли/ })).toBeVisible();
  });

  test('пошук: «Бра» знаходить Бразилію, нісенітниця дає порожній стан, очищення повертає групи', async ({
    page,
  }) => {
    await openList(page);
    await search(page).fill('Бра');
    // Бразилія має кілька поясів — рядок UTC−3 (Ріо-де-Жанейро).
    await expect(
      row(page, 'BR')
        .filter({ hasText: 'Ріо-де-Жанейро' })
        .getByRole('link', { name: /Бразилія/ }),
    ).toBeVisible();
    await expect(page.getByText(EMPTY)).toHaveCount(0);

    await search(page).fill('ццццйййй');
    await expect(page.getByText(EMPTY)).toBeVisible();
    await expect(page.locator('[data-country-row]:visible')).toHaveCount(0);

    await search(page).fill('');
    await expect(page.getByText(EMPTY)).toHaveCount(0);
    await expect(row(page, 'GB')).toBeVisible();
    await expect(group(page, 'next')).toBeVisible();
  });

  test('«Лише з трансляціями» лишає наживо й очікувані; інший статус у фільтрах вимикає перемикач', async ({
    page,
  }) => {
    await openList(page);
    const toggle = streamsOnly(page);
    await expect(toggle).not.toBeChecked();
    await expect(row(page, 'GB')).toBeVisible();

    await toggle.click();
    await expect(toggle).toBeChecked();
    await expect(row(page, 'GB')).toBeVisible();
    await expect(
      page.locator('[data-country-row][data-status="countdown-only"]:visible'),
    ).toHaveCount(0);
    await expect(page.locator('[data-country-row][data-status="possible"]:visible')).toHaveCount(0);
    await expect(page.locator('[data-country-row="GH"]:visible')).toHaveCount(0); // Гана без трансляції

    const dialog = await openFilters(page);
    await expect(dialog.getByRole('checkbox', { name: /^Наживо/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /^Трансляція очікується/ })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /^Трансляція можлива/ })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: /^Лише відлік/ })).not.toBeChecked();

    await dialog.getByRole('checkbox', { name: /^Лише відлік/ }).check();
    await dialog.getByRole('button', { name: /^Показати \d+/ }).click();
    await expect(dialog).toBeHidden();
    await expect(toggle).not.toBeChecked();
  });

  test('фільтри: 0 статусів — «Показати 0 країн» неактивна з поясненням, «Скинути» повертає', async ({
    page,
  }) => {
    await openList(page);
    const dialog = await openFilters(page);
    for (const name of [
      /^Наживо/,
      /^Трансляція очікується/,
      /^Трансляція можлива/,
      /^Лише відлік/,
    ]) {
      await dialog.getByRole('checkbox', { name }).uncheck();
    }
    const show = dialog.getByRole('button', { name: 'Показати 0 країн' });
    await expect(show).toBeVisible();
    await expect(show).toBeDisabled();
    await expect(dialog.getByText('Обери хоча б один статус')).toBeVisible();

    await dialog.getByRole('button', { name: 'Скинути' }).click();
    const showAgain = dialog.getByRole('button', { name: /^Показати \d+/ });
    await expect(showAgain).toBeEnabled();
    await expect(dialog.getByText('Обери хоча б один статус')).toHaveCount(0);
  });

  test('перехід на сторінку країни: Франція → /country/frantsiia/', async ({ page }) => {
    await openList(page);
    await search(page).fill('Франція');
    const link = row(page, 'FR').getByRole('link', { name: /Франція/ });
    await expect(link).toHaveAttribute('href', /\/country\/frantsiia\/?$/);
    await link.click();
    await expect(page).toHaveURL(/\/country\/frantsiia\/?$/);
  });
});

test.describe('Список країн: доступність', () => {
  test('axe: список без порушень (WCAG 2.1 AA)', async ({ page }) => {
    await openList(page);
    await expect(row(page, 'GB')).toBeVisible();
    const violations = await runAxe(page);
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });

  test('axe: відкритий діалог «Фільтри» без порушень', async ({ page }) => {
    await openList(page);
    await openFilters(page);
    const violations = await runAxe(page);
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });
});
