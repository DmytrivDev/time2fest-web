/**
 * Вхід і реєстрація (S-AUTH, рішення 2026-10-29; дошки `Phone-Auth-*`, `Desk-Auth-*`) на імітації:
 * сторінка `/login/` і `/signup/` (Google — головна кнопка; пошта — код із 6 цифр, рішення 2026-11-13: однаково для нової
 * адреси й наявної; помилки коду, «Надіслати ще раз», стани «надсилаємо…» / «перевіряємо…» через `window.__t2f.api`),
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

const lastCode = (page: Page) => page.evaluate(() => window.__t2f?.lastCode()?.code ?? '');
const sendBtn = (page: Page) => page.locator('main form').getByRole('button', { name: 'Отримати код', exact: true });
const codeField = (page: Page) => page.getByRole('textbox', { name: 'Код із листа' });
const wrongOf = (c: string) => (c === '000000' ? '111111' : '000000');

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
    await expect(page.locator('[data-block="pass-hint"]').getByText('$5')).toBeVisible();
    // «Що дає пас» розгортає можливості на місці.
    await page.getByRole('button', { name: 'Що дає пас' }).click();
    // Розгорнуто — кнопка стає «Згорнути».
    await expect(page.getByRole('button', { name: 'Згорнути' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-block="pass-hint"] [data-block="pass-perks"]')).toBeVisible();
    await expectAxeClean(page);
  });

  test('реєстрація: як вхід — картка «Ще немає пасу?» під формою, Google — коралова, пошта — «Отримати код»', async ({ page }) => {
    await fresh(page, '/signup/');
    await expect(page.getByRole('heading', { level: 1, name: 'Створити акаунт' })).toBeVisible();
    await expect(page.locator('[data-block="pass-hint"]')).toBeVisible();
    await expect(page.locator('[data-block="pass-offer"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Створити з Google' })).toHaveClass(/coral/);
    await expect(page.getByRole('button', { name: 'Отримати код', exact: true })).toBeVisible();
    await expectAxeClean(page);
  });

  test('порожній і невірний email — помилка під полем; нова адреса — код, і лише після нього «Акаунт створено»', async ({ page }) => {
    await fresh(page, '/signup/');
    const submit = sendBtn(page);
    await submit.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Введи email' })).toBeVisible();
    await page.getByLabel('Email').fill('olena@example');
    await submit.click();
    await expect(page.getByRole('alert').filter({ hasText: 'Перевір email' })).toBeVisible();
    await page.getByLabel('Email').fill('olena@example.com');
    await submit.click();
    await expect(page.getByRole('heading', { name: 'Введи код із листа' })).toBeVisible();
    // Фокус — одразу в полі коду (телефон підставить код з листа сам).
    await expect(codeField(page)).toBeFocused();
    await expect(codeField(page)).toHaveAttribute('autocomplete', 'one-time-code');
    await expect(codeField(page)).toHaveAttribute('inputmode', 'numeric');
    // Без коду входу немає.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('t2f:auth:v1') ?? '{}').state?.user ?? null)).toBeNull();
    // Вставка «123 456» — і вхід на 6-й цифрі, без натискання «Увійти».
    const code = await lastCode(page);
    await codeField(page).fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await expect(page.getByRole('heading', { name: 'Акаунт створено' })).toBeVisible();
    // Нова адреса не перекидає з /signup/ (гонка сесії й finish, 2026-11-14): крок лишається, поки не натиснуто «Готово».
    await page.waitForTimeout(1_500);
    await expect(page).toHaveURL(/\/signup\/$/);
    await expect(page.getByRole('heading', { name: 'Акаунт створено' })).toBeVisible();
    // «Як тебе показувати» (2026-11-08): нік з пошти — перше слово до «@», прапор — за розташуванням.
    const profile = page.locator('[data-block="profile"]');
    await expect(profile.getByLabel('Нік')).toHaveValue('Olena');
    await expect(page.getByRole('link', { name: /Кабінет/ })).toBeVisible();
    await expectAxeClean(page);
  });

  test('адреса з акаунтом — той самий код; вхід повертає, звідки прийшли', async ({ page }) => {
    await fresh(page, '/login/');
    await page.evaluate(() => {
      localStorage.setItem('t2f:auth:v1', JSON.stringify({ state: { user: null, accounts: ['anna@example.com'], code: null, sends: [], passes: {} }, version: 2 }));
      sessionStorage.setItem('t2f:session:authReturn', '/countries/');
    });
    await page.reload();
    // Дочекатися гідратації: інакше введене поле очищається, а акаунт зі сховища ще не прочитано (гонка, 2026-11-09).
    await waitForTimeApi(page);
    await page.getByLabel('Email').fill('anna@example.com');
    await sendBtn(page).click();
    await expect(page.getByRole('heading', { name: 'Введи код із листа' })).toBeVisible();
    // Фокус — одразу в полі коду (телефон підставить код з листа сам).
    await expect(codeField(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Надіслати ще раз' })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByText(/Новий код можна попросити через/)).toBeVisible();
    await codeField(page).fill(await lastCode(page));
    await expect(page).toHaveURL(/\/countries\/$/, { timeout: 15_000 });
  });

  test('помилки коду: не підходить (спроби), згорів після 5, прострочений, немає зв’язку', async ({ page }) => {
    await fresh(page, '/login/');
    await page.getByLabel('Email').fill('a@example.com');
    await sendBtn(page).click();
    await expect(codeField(page)).toBeVisible();
    const wrong = wrongOf(await lastCode(page));
    await codeField(page).fill(wrong);
    await expect(page.getByRole('alert').filter({ hasText: 'Код не підходить. Лишилось 4 спроби.' })).toBeVisible();
    await expect(codeField(page)).toHaveValue('');
    for (let i = 0; i < 4; i++) {
      await codeField(page).fill(wrong);
      await page.waitForTimeout(120);
    }
    await expect(page.getByRole('alert').filter({ hasText: 'Забагато невдалих спроб' })).toBeVisible();
    await expect(codeField(page)).toBeDisabled();
    // «Надіслати новий код» — після відліку 30 с; тестом — прибираємо ліміт і просимо новий.
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('t2f:auth:v1')!);
      raw.state.sends = [];
      localStorage.setItem('t2f:auth:v1', JSON.stringify(raw));
      window.dispatchEvent(new StorageEvent('storage', { key: 't2f:auth:v1' }));
    });
    await page.getByRole('button', { name: 'Надіслати новий код' }).click();
    await expect(codeField(page)).toBeEnabled();
    await page.evaluate(() => window.__t2f?.expireCode());
    await codeField(page).fill(await lastCode(page));
    await expect(page.getByRole('alert').filter({ hasText: 'Код уже не діє' })).toBeVisible();
    // Мережа впала посеред перевірки — «Спробувати ще», введене лишається.
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('t2f:auth:v1')!);
      raw.state.sends = [];
      localStorage.setItem('t2f:auth:v1', JSON.stringify(raw));
      window.dispatchEvent(new StorageEvent('storage', { key: 't2f:auth:v1' }));
    });
    await page.getByRole('button', { name: 'Надіслати новий код' }).click();
    await expect(codeField(page)).toBeEnabled();
    await page.evaluate(() => window.__t2f?.api?.failNext('auth', 'verifyCode', 'network'));
    const fresh6 = await lastCode(page);
    await codeField(page).fill(fresh6);
    await expect(page.getByRole('alert').filter({ hasText: 'Немає зв’язку — код не перевірено' })).toBeVisible();
    await expect(codeField(page)).toHaveValue(fresh6);
    await page.getByRole('button', { name: 'Спробувати ще' }).click();
    await expect(page.getByRole('heading', { name: 'Акаунт створено' })).toBeVisible();
  });

  test('«Надсилаємо…» і «Перевіряємо…» поки сервіс відповідає (затримка з адреси)', async ({ page }) => {
    await fresh(page, '/login/?simDelay=auth.requestCode:1500,auth.verifyCode:1500');
    await page.getByLabel('Email').fill('slow@example.com');
    await sendBtn(page).click();
    await expect(page.locator('main [data-action="send-code"]')).toHaveText('Надсилаємо…');
    await expect(page.locator('main [data-action="send-code"]')).toHaveAttribute('aria-busy', 'true');
    await expect(codeField(page)).toBeVisible({ timeout: 5_000 });
    await codeField(page).fill(await lastCode(page));
    await expect(page.locator('main [data-action="verify"]')).toHaveText('Перевіряємо…');
    await expect(page.getByRole('heading', { name: 'Акаунт створено' })).toBeVisible({ timeout: 5_000 });
  });

  test('вхід недоступний і Google скасовано — з машини часу', async ({ page }) => {
    await fresh(page, '/login/');
    await page.evaluate(() => window.__t2f?.setAuthUnavailable(true));
    await page.getByLabel('Email').fill('a@example.com');
    await sendBtn(page).click();
    await expect(page.getByRole('heading', { name: 'Вхід тимчасово недоступний' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Спробувати ще' })).toBeVisible();
    await page.evaluate(() => window.__t2f?.setAuthUnavailable(false));
    await page.goto('/login/');
    // Перемикач діє лише після появи тестового API (раніше `?.` мовчки нічого не робив — гонка, 2026-11-09).
    await waitForTimeApi(page);
    await page.evaluate(() => window.__t2f?.setGoogleCancelled(true));
    await page.getByRole('button', { name: 'Продовжити з Google' }).click();
    await expect(page.getByRole('heading', { name: 'Переходимо до Google…' })).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: 'Вхід через Google не завершено' })).toBeVisible({ timeout: 5_000 });
  });

  test('забагато кодів — «Забагато спроб» з часом нового коду', async ({ page }) => {
    await fresh(page, '/login/');
    await page.evaluate(() => {
      const now = Date.now();
      localStorage.setItem(
        't2f:auth:v1',
        JSON.stringify({ state: { user: null, accounts: [], code: null, sends: [now - 300_000, now - 240_000, now - 180_000, now - 120_000, now - 60_000], passes: {} }, version: 2 }),
      );
    });
    await page.reload();
    await waitForTimeApi(page);
    await page.getByLabel('Email').fill('a@example.com');
    await sendBtn(page).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Забагато спроб' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Отримати код · о \d\d:\d\d/ })).toHaveAttribute('aria-disabled', 'true');
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
    // Google — лише ім’я; «Готово» зберігає нік і закриває вікно, аватар у шапці — з новим ніком.
    await expect(page.locator('[data-window="O-AUTH"] [data-block="profile"]').getByLabel('Нік')).toHaveValue('Олена');
    await page.locator('[data-window="O-AUTH"]').getByRole('button', { name: 'Готово' }).click();
    await expect(page.locator('[data-window="O-AUTH"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Кабінет: Олена/ })).toBeVisible();
  });

  test('вікно входу: нова пошта з кодом — «Акаунт створено» (вікно не закривається саме); наявна — одразу входить', async ({ page }) => {
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
    await win.getByLabel('Email').fill('olena@example.com');
    await win.getByRole('button', { name: 'Отримати код', exact: true }).click();
    await expect(win.getByRole('heading', { name: 'Введи код із листа' })).toBeVisible();
    await win.getByRole('textbox', { name: 'Код із листа' }).fill(await lastCode(page));
    await expect(win.getByRole('heading', { name: 'Акаунт створено' })).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(1_500);
    await expect(win.getByRole('heading', { name: 'Акаунт створено' })).toBeVisible();
    await expect(win.locator('[data-block="profile"]').getByLabel('Нік')).toHaveValue('Olena');
    await win.getByRole('button', { name: 'Готово' }).click();
    await expect(win).toHaveCount(0);
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
    const own = page.locator('[data-own="true"][data-kind="regular"]').last();
    await expect(own.locator('[data-msg-trigger]')).toHaveCount(0);
    await own.getByRole('button', { name: 'Видалити повідомлення' }).click();
    await expect(page.locator('[data-kind="deleted"][data-own="true"]')).toContainText('Твоє повідомлення видалено');
    await expect(page.getByText('Видали мене')).toHaveCount(0);
  });
});
