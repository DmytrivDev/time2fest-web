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
  await expect(toasts.getByRole('listitem')).toHaveCount(5);
  await expect(page.getByRole('link', { name: /Хочеш більше від свята/ })).toHaveAttribute('href', /\/pass\/?$/);
  await expect(page.getByRole('heading', { name: 'Питання й відповіді' })).toBeVisible();
});

test('тост під час оплати: «Поки оплачуєш — напиши тост» → «Опублікувати тост» → у чаті', async ({ page }) => {
  await gotoAt(page, AT, 1, '/support/');
  await page.getByRole('button', { name: 'Підтримати $5' }).click();
  const paying = page.locator('[data-tips="paying"]');
  await expect(paying).toContainText('Поки оплачуєш — напиши тост');
  await paying.getByRole('textbox', { name: 'Текст твого тосту' }).fill('За всіх із Time2Fest!');
  const paid = page.locator('[data-tips="paid"]');
  await expect(paid).toContainText('Оплату підтверджено', { timeout: 15_000 });
  await paid.locator('[data-action="publish-toast"]').click();
  await expect(page.locator('[data-tips="success"]')).toContainText('Ти робиш це свято можливим');
});
