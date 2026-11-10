/**
 * Кабінет `/account/` (дошки `Desk-Cabinet-New2` / `New3`, рішення власника 2026-11-08): гість — на вхід; профіль (нік і прапор
 * зберігаються — аватар у шапці оновлюється), плашка пасу, «Як ти входиш» без пароля; країна й пояс; меню кабінету на місці
 * чату (десктоп) або кнопкою розділів унизу (телефон).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/youtube-stub';

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Кабінет: телефон і десктоп');
});

async function signedIn(page: Page, pass = false) {
  await page.goto('/');
  await page.evaluate((hasPass) => {
    localStorage.setItem(
      't2f:auth:v1',
      JSON.stringify({ state: { user: { email: 'olena@example.com', via: 'email', signedInAt: Date.now() }, accounts: ['olena@example.com'], letter: null, sends: [], passes: hasPass ? { 'olena@example.com': 1 } : {} }, version: 1 }),
    );
    const g = JSON.parse(localStorage.getItem('t2f:guest:v1') || 'null');
    if (g) {
      g.state.nick = 'Олена';
      g.state.flagCode = 'UA';
      g.state.hasPass = hasPass;
      localStorage.setItem('t2f:guest:v1', JSON.stringify(g));
    }
    localStorage.removeItem('t2f:account:v1');
  }, pass);
  await page.goto('/account/');
}

test('гість — на сторінку входу', async ({ page }) => {
  await page.goto('/account/');
  await expect(page).toHaveURL(/\/login\/?/);
});

test('профіль: нік зберігається, плашка пасу «неактивний», вхід без пароля', async ({ page }) => {
  await signedIn(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Кабінет' })).toBeVisible();
  await expect(page.locator('[data-block="pass-plaque"]')).toHaveAttribute('data-pass', 'inactive');
  await expect(page.locator('[data-block="login"]')).not.toContainText('Пароль');
  const nick = page.locator('#profile').getByLabel('Нік');
  await nick.fill('Зірочка');
  await page.locator('#profile').getByRole('button', { name: 'Зберегти' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Збережено' })).toBeVisible();
  await expect(page.getByRole('banner').getByRole('link', { name: /Кабінет: Зірочка/ })).toBeVisible();
});

test('країна й пояс: США → Лос-Анджелес', async ({ page }) => {
  await signedIn(page, true);
  const st = page.locator('#settings');
  await st.getByRole('button', { name: 'Змінити' }).click();
  const picker = page.locator('[data-block="zone-picker"]');
  await picker.locator('button').first().click();
  await page.getByLabel('Пошук країни').fill('США');
  await picker.getByRole('button', { name: 'США', exact: true }).click();
  await picker.getByRole('radio', { name: /Лос-Анджелес/ }).click();
  await expect(picker.getByRole('radio', { name: /Лос-Анджелес/ })).toHaveAttribute('aria-checked', 'true');
  await picker.getByRole('button', { name: 'Готово' }).click();
  await expect(st).toContainText('США · UTC−8 · Лос-Анджелес');
});

test('меню кабінету: десктоп — на місці чату, телефон — кнопка розділів унизу', async ({ page }) => {
  await signedIn(page);
  if (test.info().project.name === 'phone') {
    await page.locator('[data-cabinet-bar]').click();
    await expect(page.getByRole('dialog').getByRole('navigation', { name: 'Розділи кабінету' })).toBeVisible();
  } else {
    await expect(page.locator('#chat-slot [data-block="cabinet-nav"]')).toBeVisible();
  }
});
