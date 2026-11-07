/**
 * Службові сторінки (S-LEGAL, дошка `Desk-Legal-New` варіант B, рішення власника 2026-11-07): футер веде на документи,
 * перемикач документів, «Оновлено …», «Коротко», «Зміст» (на телефоні — згорнутий), розділи з номерами, таблиця,
 * «Інші документи»; без чату.
 */
import { expect, test } from './fixtures/youtube-stub';

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Службові сторінки: телефон і десктоп');
});

test('футер → «Політика конфіденційності»: документ, зміст, розділи, без чату', async ({ page }) => {
  await page.goto('/terms/');
  await expect(page.getByRole('heading', { level: 1, name: 'Умови користування' })).toBeVisible();
  await page.getByRole('contentinfo').getByRole('link', { name: /Конфіденційність|Політика конфіденційності/ }).click();
  await expect(page).toHaveURL(/\/privacy\/?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Політика конфіденційності' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Документи' }).getByRole('link', { name: 'Політика конфіденційності' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Оновлено 1 грудня 2026')).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: '2. Які дані ми збираємо' })).toBeVisible();
  await expect(page.locator('#chat-slot')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Інші документи' })).toBeVisible();
});

test('«Оплата й повернення»: таблиця цін; правила чату — окремий документ', async ({ page }) => {
  await page.goto('/payments/');
  await expect(page.getByRole('table')).toContainText('Новорічний пас');
  await page.goto('/rules/');
  await expect(page.getByRole('heading', { level: 1, name: 'Правила чату' })).toBeVisible();
});
