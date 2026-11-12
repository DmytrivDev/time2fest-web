/**
 * «Підтримати» (`/support/`, дошка `Desk-Support-New` варіант A, 2026-11-07); з 2026-11-12 підтримка — це тост
 * (дошки `Desk-Toast-New`, `Phone-Toast-New`): героїчний блок, «Обери тост» $2 / $5 / $10 і що дає рівень, «Тости світу»,
 * пас, «Питання й відповіді»; «Сказати тост · $5» → вікно тосту → текст до оплати → «Оплатити $5» → «Чекаємо оплату» →
 * «Тост опубліковано»; `/support/?toast=10` (зі сторінки пасу) — вікно з $10.
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

test('сторінка: героїчний блок, рівні тосту, «Тости світу», пас, питання', async ({ page }) => {
  await gotoAt(page, AT, 1, '/support/');
  await expect(page.getByRole('heading', { level: 1, name: 'Скажи тост на весь світ' })).toBeVisible();
  const offer = page.locator('[data-offer="toast"]');
  await expect(offer.getByRole('radio')).toHaveCount(3);
  await expect(offer.getByRole('radio', { name: '$5 · пляшка ігристого' })).toHaveAttribute('aria-checked', 'true');
  await expect(offer.getByRole('button', { name: 'Сказати тост · $5' })).toBeVisible();
  const toasts = page.locator('[data-world-toasts]');
  await expect(toasts).toContainText(/\d+ тост/);
  await expect(toasts.locator('ul').first().getByRole('listitem')).toHaveCount(5);
  // «Переглянути всі» — решта тостів розгортається.
  await toasts.locator('[data-action="toasts-all"]').click();
  await expect(toasts.locator('[data-action="toasts-all"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: /Хочеш більше від свята/ })).toHaveAttribute('href', /\/pass\/?$/);
  await expect(page.getByRole('heading', { name: 'Питання й відповіді' })).toBeVisible();
});

test('«Сказати тост · $2» → підпис → тост з емодзі → «Оплатити $2» → «Чекаємо оплату» → «Тост опубліковано»', async ({ page }) => {
  await gotoAt(page, AT, 1, '/support/');
  const offer = page.locator('[data-offer="toast"]');
  await offer.getByRole('radio', { name: '$2 · келих' }).click();
  await offer.getByRole('button', { name: 'Сказати тост · $2' }).click();
  const win = page.locator('[data-window="O-TOAST"]');
  await expect(win.getByRole('radio', { name: '$2 · келих' })).toHaveAttribute('aria-checked', 'true');
  // Гість без ніку: «Оплатити» неактивна, доки не підписано.
  await expect(win.locator('[data-action="toast-pay"]')).toBeDisabled();
  await win.getByRole('textbox', { name: 'Нік для тосту' }).fill('Зоряна');
  await win.getByRole('textbox', { name: 'Текст твого тосту' }).fill('За всіх із Time2Fest!');
  // Свої емодзі сайту — як у чаті.
  await win.getByRole('button', { name: 'Емодзі' }).click();
  await page.locator('[data-emoji-picker] [data-menu-item]').first().click();
  await win.locator('[data-action="toast-pay"]').click();
  await expect(win).toContainText('Чекаємо оплату на PayPro Global');
  await expect(win).toContainText('Тост опубліковано', { timeout: 15_000 });
  await expect(win).toContainText('Він уже в чаті «Світ» — його бачать усі, хто зараз дивиться.');
});

test('/support/?toast=10 — вікно тосту одразу з $10', async ({ page }) => {
  await gotoAt(page, AT, 1, '/support/?toast=10');
  const win = page.locator('[data-window="O-TOAST"]');
  await expect(win.getByRole('radio', { name: '$10 · феєрверк' })).toHaveAttribute('aria-checked', 'true');
  await expect(win.getByRole('button', { name: 'Оплатити $10' })).toBeVisible();
});
