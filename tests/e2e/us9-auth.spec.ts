/**
 * Вхід і реєстрація (S-AUTH, рішення 2026-10-29; дошки `Phone-Auth-*`, `Desk-Auth-*`) на імітації:
 * сторінка `/login/` і `/signup/` (лист, код, помилки, «Акаунт створено», посилання з листа),
 * вхід під час трансляції — вікно на місці O-NICK, після входу аватар у хедері; на телефоні вікно, відкрите при згорнутому
 * чаті, — окремий шар, чат не розгортається.
 *
 * ПОКИ НЕ ЗАПУСКАЄТЬСЯ: рішення власника 2026-10-27 — e2e пишемо, але не проганяємо; перевірка — typecheck, lint, юніти, build.
 */
import type { Page } from '@playwright/test';
import { runAxe } from './fixtures/axe';
import { gotoAt, waitForTimeApi } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Вхід: телефон і десктоп');
});
test.describe.configure({ timeout: 90_000 });

const LIVE = '2027-01-01T01:50:00+02:00';

async function fresh(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(() => {
    localStorage.removeItem('t2f:auth:v1');
    localStorage.removeItem('t2f:guest:v1');
  });
  await page.goto(path);
  await waitForTimeApi(page);
}

const code = (page: Page) => page.evaluate(() => window.__t2f?.lastLetter()?.code ?? '');
const otp = (page: Page) => page.locator('input[autocomplete="one-time-code"]');

async function expectAxeClean(page: Page) {
  const violations = await runAxe(page);
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test.describe('S-AUTH · сторінка', () => {
  test('вхід: Google, email, «Створити акаунт», картка пасу; одна коралова кнопка', async ({ page }) => {
    await fresh(page, '/login/');
    await expect(page.getByRole('heading', { level: 1, name: 'Увійти' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Продовжити з Google' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Створити акаунт' })).toHaveAttribute('href', '/signup/');
    await expect(page.getByText('Ще немає Новорічного пасу?')).toBeVisible();
    await expect(page.locator('[data-block="pass-hint"]').getByText('$4,99')).toBeVisible();
    // «Що дає пас» розгортає можливості на місці.
    await page.getByRole('button', { name: 'Що дає пас' }).click();
    // Розгорнуто — кнопка стає «Згорнути».
    await expect(page.getByRole('button', { name: 'Згорнути' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-block="pass-hint"] [data-block="pass-perks"]')).toBeVisible();
    await expectAxeClean(page);
  });

  test('реєстрація: як вхід — картка «Ще немає пасу?» під формою, коралова «Створити акаунт»', async ({ page }) => {
    await fresh(page, '/signup/');
    await expect(page.getByRole('heading', { level: 1, name: 'Створити акаунт' })).toBeVisible();
    await expect(page.locator('[data-block="pass-hint"]')).toBeVisible();
    await expect(page.locator('[data-block="pass-offer"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Створити акаунт', exact: true })).toBeVisible();
    await expectAxeClean(page);
  });

  test('порожній і невірний email — помилка під полем; лист → код → «Акаунт створено»', async ({ page }) => {
    await fresh(page, '/signup/');
    const submit = page.getByRole('button', { name: 'Створити акаунт', exact: true });
    await submit.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Введи email' })).toBeVisible();
    await page.getByLabel('Email').fill('olena@example');
    await submit.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Перевір email' })).toBeVisible();
    await page.getByLabel('Email').fill('olena@example.com');
    await submit.click();
    await expect(page.getByRole('heading', { name: 'Ми надіслали посилання' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Надіслати ще раз' })).toHaveAttribute('aria-disabled', 'true');

    await page.getByRole('button', { name: 'Ввести код із листа' }).click();
    await otp(page).fill('000000');
    await expect(page.getByRole('alert').filter({ hasText: /Код не підходить|Забагато/ })).toBeVisible();
    await otp(page).fill(await code(page));
    await expect(page.getByRole('heading', { name: 'Акаунт створено' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Профіль/ })).toBeVisible();
    await expectAxeClean(page);
  });

  test('повторний вхід — без «Акаунт створено», повернення на сторінку, звідки прийшли', async ({ page }) => {
    await fresh(page, '/login/');
    await page.getByLabel('Email').fill('anna@example.com');
    await page.getByRole('button', { name: 'Надіслати посилання' }).click();
    await page.getByRole('button', { name: 'Ввести код із листа' }).click();
    await otp(page).fill(await code(page));
    await expect(page.getByRole('heading', { name: 'Акаунт створено' })).toBeVisible();
    await page.evaluate(() => {
      window.__t2f?.signOut();
      sessionStorage.setItem('t2f:session:authReturn', '/countries/');
    });
    // Новий лист — через 10 хвилин після трьох; тут перший після виходу (хвилина минула не завжди — обходимо через сховище).
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('t2f:auth:v1') ?? '{}');
      raw.state.sends = [];
      localStorage.setItem('t2f:auth:v1', JSON.stringify(raw));
    });
    await page.goto('/login/');
    await page.getByLabel('Email').fill('anna@example.com');
    await page.getByRole('button', { name: 'Надіслати посилання' }).click();
    await page.getByRole('button', { name: 'Ввести код із листа' }).click();
    await otp(page).fill(await code(page));
    await expect(page).toHaveURL(/\/countries\/$/);
  });

  test('посилання з листа: новий акаунт — «Акаунт створено», вдруге — «Посилання вже не діє»', async ({ page }) => {
    await fresh(page, '/login/');
    await page.getByLabel('Email').fill('link@example.com');
    await page.getByRole('button', { name: 'Надіслати посилання' }).click();
    const token = await page.evaluate(() => window.__t2f?.lastLetter()?.token ?? '');
    await page.goto(`/login/?link=${token}`);
    await expect(page.getByRole('heading', { name: 'Акаунт створено' })).toBeVisible();
    await page.goto(`/login/?link=${token}`);
    await expect(page.getByRole('heading', { name: 'Посилання вже не діє' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Надіслати нове' })).toBeVisible();
  });

  test('вхід недоступний і Google скасовано — з машини часу', async ({ page }) => {
    await fresh(page, '/login/');
    await page.evaluate(() => window.__t2f?.setAuthUnavailable(true));
    await page.getByLabel('Email').fill('a@example.com');
    await page.getByRole('button', { name: 'Надіслати посилання' }).click();
    await expect(page.getByRole('heading', { name: 'Вхід тимчасово недоступний' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Спробувати ще' })).toBeVisible();
    await page.evaluate(() => window.__t2f?.setAuthUnavailable(false));
    await page.goto('/login/');
    await page.evaluate(() => window.__t2f?.setGoogleCancelled(true));
    await page.getByRole('button', { name: 'Продовжити з Google' }).click();
    await expect(page.getByRole('heading', { name: 'Переходимо до Google…' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Вхід через Google не завершено' })).toBeVisible({ timeout: 5_000 });
  });

  test('забагато листів — «Забагато спроб» з часом нового листа', async ({ page }) => {
    await fresh(page, '/login/');
    await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem(
        't2f:auth:v1',
        JSON.stringify({ state: { user: null, accounts: [], letter: null, sends: [now - 300_000, now - 200_000, now - 100_000] }, version: 1 }),
      );
    });
    await page.reload();
    await page.getByLabel('Email').fill('a@example.com');
    await page.getByRole('button', { name: 'Надіслати посилання' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Забагато спроб' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Надіслати посилання · о \d\d:\d\d/ })).toHaveAttribute('aria-disabled', 'true');
  });
});

test.describe('S-AUTH · під час трансляції', () => {
  test('«Увійти» у вікні ніку → вікно входу на тому ж місці; вхід закриває його', async ({ page }) => {
    await gotoAt(page, LIVE, 1);
    await waitForTimeApi(page);
    await page.evaluate(() => {
      localStorage.removeItem('t2f:auth:v1');
      localStorage.removeItem('t2f:guest:v1');
    });
    await page.reload();
    await waitForTimeApi(page);
    if ((page.viewportSize()?.width ?? 0) < 768) await page.getByRole('button', { name: /^Розгорнути чат/ }).click();
    await page.getByRole('textbox', { name: /Повідомлення в чат/ }).fill('Привіт');
    await page.getByRole('button', { name: /^Надіслати/ }).click();
    await page.locator('[data-window="O-NICK"]').getByRole('button', { name: 'Увійти' }).click();
    const win = page.locator('[data-window="O-AUTH"]');
    await expect(win.getByRole('button', { name: 'Продовжити з Google' })).toBeVisible();
    await expect(win.locator('[data-block="pass-row"]')).toBeVisible();
    // «Що дає акаунт» — можливості акаунта й картка пасу замість форми; «Назад» повертає.
    await win.getByRole('button', { name: 'Що дає акаунт' }).click();
    await expect(win.locator('[data-block="account-perks"]')).toBeVisible();
    await expect(win.locator('[data-block="pass-hint"]')).toBeVisible();
    await win.getByRole('button', { name: 'Назад' }).click();
    await win.getByRole('button', { name: 'Створити акаунт' }).click();
    await expect(page.locator('[data-window="O-AUTH"] [data-auth-mode="signup"]')).toBeVisible();
    await page.locator('[data-window="O-AUTH"]').getByRole('button', { name: 'Увійти' }).click();
    await page.locator('[data-window="O-AUTH"]').getByRole('button', { name: 'Продовжити з Google' }).click();
    await expect(page.locator('[data-window="O-AUTH"]').getByRole('heading', { name: 'Акаунт створено' })).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-window="O-AUTH"]').getByRole('button', { name: 'Повернутися до трансляції' }).click();
    await expect(page.locator('[data-window="O-AUTH"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Профіль/ })).toBeVisible();
  });

  test('свій нік у панелі автора — олівець відкриває «Нік і прапор»', async ({ page }) => {
    await gotoAt(page, LIVE, 1);
    await waitForTimeApi(page);
    await page.evaluate(() => {
      const k = 't2f:guest:v1';
      const raw = JSON.parse(localStorage.getItem(k) ?? '{"state":{},"version":1}');
      raw.state = { ...raw.state, nick: 'Тест', flagCode: 'CO' };
      localStorage.setItem(k, JSON.stringify(raw));
    });
    await page.reload();
    await waitForTimeApi(page);
    if ((page.viewportSize()?.width ?? 0) < 768) await page.getByRole('button', { name: /^Розгорнути чат/ }).click();
    await page.getByRole('textbox', { name: /Повідомлення в чат/ }).fill('Привіт');
    await page.getByRole('button', { name: /^Надіслати/ }).click();
    await page.locator('[data-own="true"] [data-chat-author]').last().click();
    await page.getByRole('button', { name: 'Змінити нік і прапор' }).click();
    await expect(page.locator('[data-window="O-NICK"]')).toBeVisible();
  });

  test('своє повідомлення: «⋯» — лише «Видалити повідомлення», підтвердження, рядок «Твоє повідомлення видалено»', async ({ page }) => {
    await gotoAt(page, LIVE, 1);
    await waitForTimeApi(page);
    await page.evaluate(() => {
      const k = 't2f:guest:v1';
      const raw = JSON.parse(localStorage.getItem(k) ?? '{"state":{},"version":1}');
      raw.state = { ...raw.state, nick: 'Тест', flagCode: 'CO' };
      localStorage.setItem(k, JSON.stringify(raw));
    });
    await page.reload();
    await waitForTimeApi(page);
    if ((page.viewportSize()?.width ?? 0) < 768) await page.getByRole('button', { name: /^Розгорнути чат/ }).click();
    await page.getByRole('textbox', { name: /Повідомлення в чат/ }).fill('Видали мене');
    await page.getByRole('button', { name: /^Надіслати/ }).click();
    await page.locator('[data-own="true"][data-kind="regular"] [data-msg-trigger]').last().click();
    const menu = page.locator('[data-message-menu][data-own="true"]');
    await expect(menu.getByRole('menuitem', { name: 'Поскаржитись' })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Видалити повідомлення' }).click();
    await expect(menu.getByText('Видалити назавжди? Повернути не вийде.')).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Видалити', exact: true }).click();
    await expect(page.locator('[data-kind="deleted"][data-own="true"]')).toContainText('Твоє повідомлення видалено');
    await expect(page.getByText('Видали мене')).toHaveCount(0);
  });
});
