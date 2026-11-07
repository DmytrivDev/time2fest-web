/**
 * «Підтримати» (`/support/`, дошка `Desk-Support-New` варіант A) і тост під час оплати (дошка `Desk-Tips-Toast`
 * варіант B), рішення власника 2026-11-07: героїчний блок, чайові з $2 / $5 / $10, «Тости світу», пас, «Питання й
 * відповіді»; «Підтримати $5» → «Поки оплачуєш — напиши тост» → «Опублікувати тост» → тост у чаті «Світ».
 */
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.describe.configure({ timeout: 90_000 });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Підтримати: телефон і десктоп');
});

const AT = '2027-01-01T03:02:00+02:00';

test('сторінка: героїчний блок, чайові, «Тости світу», пас, питання', async ({ page }) => {
  await gotoAt(page, AT, 1, '/support/');
  await expect(page.getByRole('heading', { level: 1, name: 'Скажи тост на весь світ' })).toBeVisible();
  await expect(page.locator('[data-offer="tips"]').getByRole('radio')).toHaveCount(3);
  const toasts = page.locator('[data-world-toasts]');
  await expect(toasts).toContainText(/\d+ тост/);
  await expect(toasts.locator('ul').first().getByRole('listitem')).toHaveCount(5);
  // «Переглянути всі» — решта тостів розгортається.
  await toasts.locator('[data-action="toasts-all"]').click();
  await expect(toasts.locator('[data-action="toasts-all"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: /Хочеш більше від свята/ })).toHaveAttribute('href', /\/pass\/?$/);
  await expect(page.getByRole('heading', { name: 'Питання й відповіді' })).toBeVisible();
});

test('тост → «Оплатити $5» → «Чекаємо оплату» → «Опублікувати тост» → у чаті', async ({ page }) => {
  await gotoAt(page, AT, 1, '/support/');
  await page.getByRole('button', { name: 'Підтримати $5' }).click();
  const form = page.locator('[data-tips="form"]');
  await form.getByRole('textbox', { name: 'Текст твого тосту' }).fill('За всіх із Time2Fest!');
  // Свої емодзі сайту — як у чаті.
  await form.getByRole('button', { name: 'Емодзі' }).click();
  await page.locator('[data-emoji-picker] [data-menu-item]').first().click();
  await form.locator('[data-action="tips-pay"]').click();
  await expect(page.locator('[data-tips="paying"]')).toContainText('Чекаємо оплату на PayPro Global');
  const paid = page.locator('[data-tips="paid"]');
  await expect(paid).toContainText('Оплату підтверджено', { timeout: 15_000 });
  await paid.locator('[data-action="publish-toast"]').click();
  await expect(page.locator('[data-tips="success"]')).toContainText('Ти робиш це свято можливим');
});
