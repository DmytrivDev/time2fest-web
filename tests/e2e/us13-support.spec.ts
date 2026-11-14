/**
 * «Тости світу» (`/support/`; було «Підтримати», рішення власника 2026-11-13). Три стани за правилом тосту:
 * - свято йде — «Тости світу», лічильники, «Сказати тост» (вікно → текст до оплати → «Оплатити» → «Тост опубліковано»),
 *   УСІ тости свята (закріплені, далі найновіші, «Показати ще»); порожньо — «Тостів ще немає — скажи перший»;
 * - до свята — «Тости відкриються разом зі святом» з датою й часом, що таке тост, три рівні лише для показу, без оплати;
 * - після свята — архів тостів без «Сказати тост», рядок про наступний Новий рік.
 * `/support/?toast=10` (зі сторінки пасу) — під час свята вікно з $10; поза святом вікна немає.
 */
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.describe.configure({ timeout: 90_000 });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Тости світу: телефон і десктоп');
});

const AT = '2027-01-01T03:02:00+02:00';
/** Через 10 хв після півночі UTC−1: перший тост поясу ($5 / $10) уже закріплено до наступної півночі. */
const PINNED = '2027-01-01T03:10:00+02:00';
const BEFORE = '2026-12-28T14:00:00+02:00';
const AFTER = '2027-01-02T14:00:00+02:00';
/** За годину до першої півночі (UTC+14): свято вже йде, тостів ще немає. */
const EMPTY = '2026-12-31T11:00:00+02:00';

test('свято йде: «Тости світу», лічильники, усі тости — закріплені й найновіші, «Показати ще»', async ({ page }) => {
  await gotoAt(page, PINNED, 1, '/support/');
  await expect(page.getByRole('heading', { level: 1, name: 'Тости світу' })).toBeVisible();
  await expect(page.locator('[data-toast-counters]')).toContainText(/\d+ тост\S* за свято · \d+ країн/);
  await expect(page.locator('[data-action="support-toast"]')).toHaveText('Сказати тост');
  const toasts = page.locator('[data-world-toasts]');
  await expect(toasts).toContainText('Закріплені до наступної півночі');
  await expect(toasts.locator('[data-toast-list="pinned"] > li').first()).toContainText(/до \d\d:\d\d/);
  const all = toasts.locator('[data-toast-list="all"] > li');
  await expect(all).toHaveCount(20);
  await toasts.locator('[data-action="toasts-more"]').click();
  await expect.poll(() => all.count()).toBeGreaterThan(20);
  await expect(page.getByRole('link', { name: /Хочеш більше від свята/ })).toHaveAttribute('href', /\/pass\/?$/);
  await expect(page.getByRole('heading', { name: 'Питання й відповіді' })).toBeVisible();
  // Вибору рівнів на сторінці немає — рівні у вікні тосту.
  await expect(page.locator('main [role="radio"]')).toHaveCount(0);
});

test('«Сказати тост» → $2 → підпис → тост з емодзі → «Оплатити $2» → «Чекаємо оплату» → «Тост опубліковано»', async ({ page }) => {
  await gotoAt(page, AT, 1, '/support/');
  await page.locator('[data-action="support-toast"]').click();
  const win = page.locator('[data-window="O-TOAST"]');
  await win.getByRole('radio', { name: '$2 · келих' }).click();
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
  // Свій тост — першим серед «Усі тости».
  await expect(page.locator('[data-toast-list="all"] > li').first()).toContainText('За всіх із Time2Fest!');
});

test('/support/?toast=10 — вікно тосту одразу з $10', async ({ page }) => {
  await gotoAt(page, AT, 1, '/support/?toast=10');
  const win = page.locator('[data-window="O-TOAST"]');
  await expect(win.getByRole('radio', { name: '$10 · феєрверк' })).toHaveAttribute('aria-checked', 'true');
  await expect(win.getByRole('button', { name: 'Оплатити $10' })).toBeVisible();
});

test('свято йде, тостів ще немає: «Тостів ще немає — скажи перший»', async ({ page }) => {
  await gotoAt(page, EMPTY, 1, '/support/');
  await expect(page.locator('[data-world-toasts]')).toContainText('Тостів ще немає — скажи перший');
  await expect(page.locator('[data-action="support-toast"]')).toBeVisible();
  await expect(page.locator('[data-toast-counters]')).toHaveCount(0);
});

test('до свята: «Тости відкриються разом зі святом», дата й час, три рівні без вибору; оплати немає', async ({ page }) => {
  await gotoAt(page, BEFORE, 1, '/support/?toast=10');
  await expect(page.getByRole('heading', { level: 1, name: 'Тости світу' })).toBeVisible();
  const opens = page.locator('[data-toasts-open]');
  await expect(opens).toContainText('Тости відкриються разом зі святом');
  // Перша північ — UTC+14 о 10:00 UTC; тости — за 2 год: 31 грудня о 10:00 за Києвом.
  await expect(opens).toContainText('31 грудня о 10:00 за твоїм часом');
  const about = page.locator('[data-toast-about]');
  await expect(about.getByRole('listitem').filter({ hasText: '$10' }).first()).toBeVisible();
  await expect(about.locator('[role="radio"]')).toHaveCount(0);
  await expect(about).toContainText('Твій нік у привітанні опівночі');
  await expect(page.locator('[data-action="support-toast"]')).toHaveCount(0);
  await expect(page.locator('[data-world-toasts]')).toHaveCount(0);
  // Застаріле посилання не відкриває оплату; адреса чиста.
  await expect(page).not.toHaveURL(/toast=10/);
  await expect(page.locator('[data-window="O-TOAST"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Хочеш більше від свята/ })).toBeVisible();
  // У шапці — лише «Новорічний пас», «Сказати тост» немає.
  await expect(page.locator('header [data-action="header-toast"]')).toHaveCount(0);
});

test('після свята: архів тостів без «Сказати тост», рядок про наступний Новий рік', async ({ page }) => {
  await gotoAt(page, AFTER, 1, '/support/');
  await expect(page.getByRole('heading', { level: 1, name: 'Тости світу' })).toBeVisible();
  await expect(page.locator('main')).toContainText('Нові тости відкриються наступного Нового року.');
  await expect(page.locator('[data-action="support-toast"]')).toHaveCount(0);
  const all = page.locator('[data-toast-list="all"] > li');
  await expect(all.first()).toContainText(/1 січня, \d\d:\d\d/);
  await expect(page.locator('[data-toast-list="pinned"]')).toHaveCount(0);
  await expect(page.locator('header [data-action="header-toast"]')).toHaveCount(0);
});

/** Межа кінця свята (2026-11-14): остання північ (UTC−12) = 14:00 за Києвом; свято йде ще 2 год — до 16:00. */
test('ще свято: за 30 с до «остання північ + 2 год» «Сказати тост» є', async ({ page }) => {
  await gotoAt(page, '2027-01-01T15:59:30+02:00', 0, '/support/');
  await expect(page.locator('[data-action="support-toast"]')).toBeVisible();
  await expect(page.locator('main')).not.toContainText('Нові тости відкриються наступного Нового року.');
});

test('свято скінчилось: через 1,5 хв після «остання північ + 2 год» (годинник сторінки округлюється до хвилини, межа включно) — архів без «Сказати тост»', async ({ page }) => {
  await gotoAt(page, '2027-01-01T16:01:30+02:00', 0, '/support/');
  await expect(page.locator('main')).toContainText('Нові тости відкриються наступного Нового року.');
  await expect(page.locator('[data-action="support-toast"]')).toHaveCount(0);
});
