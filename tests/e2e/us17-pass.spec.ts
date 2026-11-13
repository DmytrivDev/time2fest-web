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
  await expect(page.getByRole('button', { name: 'Оформити пас — $5' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Політикою конфіденційності' })).toHaveAttribute('href', '/privacy/');
  // Жодного «мертвого» посилання на `#` у вмісті сторінки.
  await expect(page.locator('main a[href="#"]')).toHaveCount(0);
});

test('«Скажи тост за $10 · …і Новорічний пас у подарунок» (дошка `Pass-5-New`): сторінка — «Тости світу» з вікном на $10', async ({ page }) => {
  await gotoAt(page, AT, 1, '/pass/');
  const row = page.locator('main [data-row="toast-gift"]');
  await expect(row).toContainText('Скажи тост за $10');
  await expect(row).toContainText('…і Новорічний пас у подарунок');
  await row.click();
  await expect(page).toHaveURL(/\/support\//, { timeout: 20_000 });
  const win = page.locator('[data-window="O-TOAST"]');
  await expect(win.getByRole('radio', { name: '$10 · феєрверк' })).toHaveAttribute('aria-checked', 'true', { timeout: 20_000 });
});

test('до свята рядка «Скажи тост за $10» немає (тост лише під час свята, 2026-11-13) — пас оформлюється без нього', async ({ page }) => {
  await gotoAt(page, '2026-12-28T14:00:00+02:00', 1, '/pass/');
  await expect(page.getByRole('button', { name: 'Оформити пас — $5' })).toBeVisible();
  await expect(page.locator('[data-row="toast-gift"]')).toHaveCount(0);
});

test('вікно пасу під час свята: рядок «Скажи тост за $10» → вікно тосту з $10; гість після $10 входить — пас на акаунті', async ({ page }) => {
  await gotoAt(page, AT, 1, '/');
  await page.locator('header').getByRole('link', { name: /Пас|Новорічний пас/ }).first().click();
  const gift = page.locator('[data-window="O-PASS-BUY"] [data-row="toast-gift"]');
  await expect(gift).toContainText('Скажи тост за $10');
  await gift.click();
  const win = page.locator('[data-window="O-TOAST"]');
  await expect(win.getByRole('radio', { name: '$10 · феєрверк' })).toHaveAttribute('aria-checked', 'true');
  await win.getByRole('textbox', { name: 'Нік для тосту' }).fill('Зоряна');
  await win.locator('[data-action="toast-pay"]').click();
  await expect(win.locator('[data-toast-gift="pending"]')).toContainText('Новорічний пас — подарунок до тосту', { timeout: 15_000 });
  await win.getByRole('button', { name: 'Увійти й активувати пас' }).click();
  await page.getByRole('button', { name: /Увійти з Google|Google/ }).first().click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('t2f:guest:v1') ?? '{}').state?.hasPass), { timeout: 15_000 }).toBe(true);
});

test('оплата поштою: «Чекаємо підтвердження» переживає перезавантаження → «Пас активний» → «Твій пас уже діє»', async ({ page }) => {
  // Швидкість 1: 30 с «Чекаємо підтвердження» не мають минути, поки сторінка перезавантажується.
  await gotoAt(page, AT, 1, '/pass/');
  await page.evaluate(() => (window as unknown as { __t2f: { setPayResult(r: string): void } }).__t2f.setPayResult('pending'));
  await page.getByRole('textbox', { name: 'Email' }).fill('olena@example.com');
  await page.getByRole('button', { name: 'Оформити пас — $5' }).click();
  await expect(page.locator('[data-phase="pending"]')).toContainText('Чекаємо підтвердження оплати');

  await page.reload();
  await waitForTimeApi(page);
  // Після перезавантаження — те саме очікування, а не нова форма оплати.
  await expect(page.locator('[data-phase="pending"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Оформити пас — $5' })).toHaveCount(0);

  await expect(page.locator('[data-phase="success"]')).toContainText('Пас активний', { timeout: 60_000 });

  await page.reload();
  const active = page.locator('[data-phase="active"]');
  await expect(active).toContainText('Твій пас уже діє');
  await expect(active.getByRole('link', { name: 'Мій паспорт Нових років' })).toHaveAttribute('href', '/passport/');
  await expect(active.getByRole('link', { name: 'Допомога' })).toHaveAttribute('href', '/help/');
});

test('оформлення пасу поштою: прапор за IP одразу в аватарі шапки, без перезавантаження (правка 2026-11-10)', async ({ page }) => {
  await gotoAt(page, AT, 1, '/pass/');
  await page.getByRole('textbox', { name: 'Email' }).fill('flag@example.com');
  await page.getByRole('button', { name: 'Оформити пас — $5' }).click();
  await expect(page.locator('[data-phase="success"]')).toContainText('Пас активний', { timeout: 60_000 });
  // Аватар — круглий прапор під вуаллю (не просто літера на темному тлі).
  const avatar = page.getByRole('banner').locator('span[style*="background-image"]');
  await expect(avatar.first()).toHaveAttribute('style', /ua/i);
  const flag = await page.evaluate(() => JSON.parse(localStorage.getItem('t2f:guest:v1') ?? '{}').state?.flagCode);
  expect(flag).toBe('UA');
});

/** Старий стан пристрою: пас гостя без входу (до правки 2026-11-10 так лишалось після виходу й скидання). */
const STALE_GUEST = {
  v: 1,
  id: 'g-old',
  locale: 'uk',
  consent: { answered: true, necessary: true, analytics: false, marketing: false, facebookVideo: false },
  reducedMotion: false,
  chatHidden: false,
  zoneStreamsCollapsed: false,
  chat: { lastRoom: 'world', sentAt: [] },
  room: { windows: [], soundSlot: null },
  stamps: [],
  pendingPresence: {},
  rate: {},
  offers: { nightId: '2026-27', history: [], visible: null },
  schedule: ['evt_lisbon_2027', 'evt_madrid_2027'],
  hasPass: true,
  nightId: '2026-27',
};

type Api = { __t2f: { signOut(): void; resetGuest(): void } };

test('без входу паса немає: старий «пас на пристрої» знімається, сторінка пасу — оформлення (правка 2026-11-10)', async ({ page }) => {
  await page.addInitScript((state) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('t2f:guest:v1', JSON.stringify({ state, version: 1 }));
  }, STALE_GUEST);
  await gotoAt(page, AT, 1, '/pass/');
  await expect(page.getByRole('button', { name: 'Оформити з Google' })).toBeVisible();
  await expect(page.locator('[data-phase="active"]')).toHaveCount(0);
  await expect(page.locator('main')).not.toContainText('Твій пас уже діє');
  const hasPass = await page.evaluate(() => JSON.parse(localStorage.getItem('t2f:guest:v1') ?? '{}').state?.hasPass);
  expect(hasPass).toBe(false);
});

test('вхід Google без оплати пасу не дає; оплата дає; вихід знімає; «Скинути стан гостя» стирає все', async ({ page }) => {
  await gotoAt(page, AT, 1, '/login/');
  await page.getByRole('button', { name: /Google/ }).first().click();
  await page.getByRole('button', { name: 'Готово' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await gotoAt(page, AT, 1, '/pass/');
  // Увійшов, але паса немає — форма оформлення для того, хто увійшов.
  await expect(page.locator('[data-phase="active"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Оформити пас/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Оформити пас/ }).first().click();
  await expect(page.locator('[data-phase="success"]')).toContainText('Пас активний', { timeout: 30_000 });

  // Вихід — без входу паса на пристрої немає.
  await page.evaluate(() => (window as unknown as Api).__t2f.signOut());
  await page.reload();
  await waitForTimeApi(page);
  await expect(page.getByRole('button', { name: 'Оформити з Google' })).toBeVisible();
  await expect(page.locator('[data-phase="active"]')).toHaveCount(0);

  // «Скинути стан гостя» — жодного ключа сайту в localStorage, після перезавантаження — як новий гість.
  await page.evaluate(() => (window as unknown as Api).__t2f.resetGuest());
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('t2f:')));
  expect(keys).toEqual([]);
  await page.reload();
  await waitForTimeApi(page);
  // Знову Google — акаунт новий, паса немає.
  await gotoAt(page, AT, 1, '/login/');
  await page.getByRole('button', { name: /Google/ }).first().click();
  await page.getByRole('button', { name: 'Готово' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
  await gotoAt(page, AT, 1, '/pass/');
  await expect(page.locator('[data-phase="active"]')).toHaveCount(0);
});

test('сторінка входу: «Оформити пас» веде на сторінку «Новорічний пас»', async ({ page }) => {
  await gotoAt(page, AT, 1, '/login/');
  await page.locator('[data-block="pass-hint"] [data-action="get-pass"]').click();
  await page.waitForURL(/\/pass\//);
  await expect(page.getByRole('heading', { level: 1, name: 'Новорічний пас' })).toBeVisible();
});
