/**
 * Службові сторінки (S-LEGAL, дошка `Desk-Legal-New2` варіант B, рішення власника 2026-11-08): футер веде на документи,
 * сайдбар «Документи» з розділами (телефон — смуга «Зміст» і шторка), «Оновлено …», розділи, таблиця, «Інші документи»; без чату.
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
  // Десктоп — закріплений сайдбар «Документи» з розділами; телефон — смуга «Зміст» і шторка (дошка `Desk-Legal-New2`, B).
  if (test.info().project.name === 'phone') {
    await page.locator('[data-legal-bar]').click();
  }
  const nav = page.getByRole('navigation', { name: 'Документи' }).filter({ visible: true });
  await expect(nav.getByRole('link', { name: 'Політика конфіденційності' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: /Які дані ми збираємо/ })).toBeVisible();
  if (test.info().project.name === 'phone') await page.keyboard.press('Escape');
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
