/**
 * Сторінка «Новорічний пас» `/pass/` (S-PASS, дошки `S-PASS · …`, v100) — до перевірки сайту 2026-11-09 її не відкривав
 * жоден e2e. Гість: ціна, Google, email, службові посилання на справжні сторінки; оформлення поштою з «Чекаємо
 * підтвердження» переживає перезавантаження (A-1, 2026-11-09) і закінчується «Пас активний» без другої оплати;
 * «Твій пас уже діє» веде в паспорт.
 */
import { gotoAt, waitForTimeApi } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.describe.configure({ timeout: 120_000 });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Пас: телефон і десктоп');
});

const AT = '2027-01-01T01:38:00+02:00';

test('гість: ціна, оформлення з Google чи поштою, посилання на умови й конфіденційність', async ({ page }) => {
  await gotoAt(page, AT, 1, '/pass/');
  await expect(page.getByRole('heading', { level: 1, name: 'Новорічний пас' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Оформити з Google' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Оформити пас — $4,99' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Політикою конфіденційності' })).toHaveAttribute('href', '/privacy/');
  // Жодного «мертвого» посилання на `#` у вмісті сторінки.
  await expect(page.locator('main a[href="#"]')).toHaveCount(0);
});

test('оплата поштою: «Чекаємо підтвердження» переживає перезавантаження → «Пас активний» → «Твій пас уже діє»', async ({ page }) => {
  // Швидкість 1: 30 с «Чекаємо підтвердження» не мають минути, поки сторінка перезавантажується.
  await gotoAt(page, AT, 1, '/pass/');
  await page.evaluate(() => (window as unknown as { __t2f: { setPayResult(r: string): void } }).__t2f.setPayResult('pending'));
  await page.getByRole('textbox', { name: 'Email' }).fill('olena@example.com');
  await page.getByRole('button', { name: 'Оформити пас — $4,99' }).click();
  await expect(page.locator('[data-phase="pending"]')).toContainText('Чекаємо підтвердження оплати');

  await page.reload();
  await waitForTimeApi(page);
  // Після перезавантаження — те саме очікування, а не нова форма оплати.
  await expect(page.locator('[data-phase="pending"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Оформити пас — $4,99' })).toHaveCount(0);

  await expect(page.locator('[data-phase="success"]')).toContainText('Пас активний', { timeout: 60_000 });

  await page.reload();
  const active = page.locator('[data-phase="active"]');
  await expect(active).toContainText('Твій пас уже діє');
  await expect(active.getByRole('link', { name: 'Мій паспорт Нових років' })).toHaveAttribute('href', '/passport/');
  await expect(active.getByRole('link', { name: 'Допомога' })).toHaveAttribute('href', '/help/');
});
