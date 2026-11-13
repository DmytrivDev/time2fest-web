/**
 * US6 — «Пропозиції й вікна в потоці» (quickstart; T117, FR-063…FR-065).
 * Гість зі штампами на 2 події → картка «2 Нових роки вже твої — далі буде ще краще» («Наступна північ») не раніше +5 хв після події, не пізніше −10 хв до
 * наступної, після оцінки, одна за раз; закрита хрестиком не повертається тієї ночі; чайових після 3-го штампа немає
 * (2026-11-12) — тост доступний завжди (смуга тостів);
 * не під час введення в чаті (~10 с); при картці з кораловою кнопкою кнопка звуку нейтральна (на екрані одна коралова);
 * cookies: у кутку (десктоп) / смугою (телефон) / в потоці, якщо чат сховано; Facebook-згода з налаштувань.
 * Оплата поза областю: «Оформити пас» і «Підтримати» показують лише «Оплата буде на наступному етапі».
 *
 * ПОКИ НЕ ЗАПУСКАЄТЬСЯ: рішення власника 2026-10-27 — e2e пишемо, але не проганяємо; перевірка — typecheck, lint, юніти, build.
 * Часовий пояс браузера — Київ: північ Лондона (00:00 UTC) = 02:00 за вашим часом; наступна основна північ — Азорські (01:00 UTC).
 */
import type { Page } from '@playwright/test';
import { gotoAt, setPayResult, setTime } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name === 'tv' || testInfo.project.name === 'prod',
    'US6: телефон і десктоп',
  );
});
test.describe.configure({ timeout: 90_000 });

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/** Моменти за Києвом (UTC+2): Лондон 02:00. */
const LONDON_PLUS_3 = '2027-01-01T02:03:00+02:00';
const LONDON_PLUS_6 = '2027-01-01T02:06:00+02:00';
const LONDON_PLUS_52 = '2027-01-01T02:52:00+02:00';
const AZORES_PLUS_6 = '2027-01-01T03:06:00+02:00';

/** Блок пропозиції під штампом (рішення 2026-11-01: не вікно — вікна збоку його не прибирають). */
const slot = (page: Page) => page.locator('[data-offer-block]');
const offerCard = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { level: 2, name });
const visibleCoral = (page: Page) => page.locator('[data-variant="coral"]:visible');

interface Seed {
  stamps?: string[];
  hasPass?: boolean;
  chatHidden?: boolean;
  consentAnswered?: boolean;
  offers?: { kind: 'pass-offer'; triggerEventId: string }[];
  sentMessages?: number;
}

/** Стан гостя до першого завантаження (не перезаписує наявний: перезавантаження зберігає закриті пропозиції). */
async function seedGuest(page: Page, seed: Seed = {}) {
  await page.addInitScript((s) => {
    const key = 't2f:guest:v1';
    if (localStorage.getItem(key)) return;
    const stamps = (s.stamps ?? []).map((eventId, i) => ({
      eventId,
      grantedAt: i,
      presenceSource: 'air',
      illustrationId: 'postcard-template',
      cityName: eventId.replace(/^evt_|_2027$/g, ''),
      countryIso: eventId === 'evt_paris_2027' ? 'FR' : eventId === 'evt_london_2027' ? 'GB' : 'PT',
    }));
    const history = (s.offers ?? []).map((o) => ({ ...o, shownAt: 1, dismissedAt: 2 }));
    const state = {
      v: 1,
      id: 'g-e2e-us6',
      locale: 'uk',
      consent: {
        answered: s.consentAnswered ?? true,
        necessary: true,
        analytics: false,
        marketing: false,
        facebookVideo: false,
      },
      reducedMotion: false,
      chatHidden: s.chatHidden ?? false,
      zoneStreamsCollapsed: false,
      chat: { lastRoom: 'world', sentAt: Array.from({ length: s.sentMessages ?? 0 }, (_, i) => i) },
      room: { windows: [], soundSlot: null },
      stamps,
      pendingPresence: {},
      rate: {},
      offers: { nightId: '2026-27', history, visible: null },
      schedule: [],
      hasPass: s.hasPass ?? false,
      nightId: '2026-27',
    };
    localStorage.setItem(key, JSON.stringify({ state, version: 1 }));
    // Пас — лише в того, хто увійшов в акаунт з пасом (правка власника 2026-11-10).
    if (s.hasPass) localStorage.setItem('t2f:auth:v1', JSON.stringify({ state: { user: { email: 'pass@example.com', via: 'email', signedInAt: 1 }, accounts: ['pass@example.com'], letter: null, sends: [], passes: { 'pass@example.com': 1 } }, version: 1 }));
  }, seed);
}

const TWO_STAMPS = ['evt_paris_2027', 'evt_london_2027'];

test.describe('US6 · пропозиція пасу після 2-го Нового року', () => {
  test('не раніше +5 хв після події: о +3 хв картки немає, о +6 хв — є, одна коралова, звук нейтральний', async ({
    page,
  }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_3, 0);
    await expect(offerCard(page, /Нових роки вже твої/)).toHaveCount(0);

    await setTime(page, { at: LONDON_PLUS_6 });
    const card = offerCard(page, '2 Нових роки вже твої — далі буде ще краще');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(slot(page)).toContainText('Оформити пас · $5');
    await expect(slot(page)).toContainText('разово, на весь сезон · без підписки');
    await expect(slot(page).getByRole('list', { name: 'Твій новорічний шлях' })).toBeVisible();
    await expect(slot(page)).toContainText('Наступна північ · за');

    // Одна коралова кнопка на екрані — «Оформити пас»; кнопка звуку нейтральна.
    await expect(visibleCoral(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Оформити пас · $5' })).toHaveAttribute(
      'data-variant',
      'coral',
    );
    await expect(page.getByRole('button', { name: /Увімкнути звук/ }).first()).not.toHaveAttribute(
      'data-variant',
      'coral',
    );

    // Фокус сторінка не забрала.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });

  test('не пізніше −10 хв до наступної: о +52 хв (Азори о +60) картки немає', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_52, 1);
    await page.waitForTimeout(3_000);
    await expect(offerCard(page, /Нових роки вже твої/)).toHaveCount(0);
  });

  test('«Оформити пас» записує дію й відкриває вікно «Новорічний пас» на місці чату; трансляція лишається', async ({
    page,
  }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await slot(page).getByRole('button', { name: 'Оформити пас · $5' }).click();
    await expect(page.getByRole('dialog', { name: 'Новорічний пас' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    const acted = await page.evaluate(
      () =>
        (JSON.parse(localStorage.getItem('t2f:guest:v1') ?? '{}').state?.offers?.history ?? []).find(
          (h: { kind: string }) => h.kind === 'pass-offer',
        )?.acted,
    );
    expect(acted).toBe('primary');
  });

  test('закрита хрестиком не повертається тієї ночі (і після перезавантаження)', async ({
    page,
  }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await page.getByRole('button', { name: 'Закрити пропозицію' }).click();
    await expect(offerCard(page, /Нових роки вже твої/)).toHaveCount(0);

    await setTime(page, { at: '2027-01-01T02:20:00+02:00' });
    await page.waitForTimeout(2_500);
    await expect(offerCard(page, /Нових роки вже твої/)).toHaveCount(0);

    await page.reload();
    await page.waitForTimeout(2_500);
    await expect(offerCard(page, /Нових роки вже твої/)).toHaveCount(0);
  });

  test('вікно збоку («Обрати трансляцію») пропозицію не прибирає', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await expect(offerCard(page, /Нових роки вже твої/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Обрати трансляцію' }).click();
    await expect(offerCard(page, /Нових роки вже твої/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(offerCard(page, /Нових роки вже твої/)).toBeVisible();
  });

  test('є пас — пропозиції пасу немає', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS, hasPass: true });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await page.waitForTimeout(2_500);
    await expect(offerCard(page, /Нових роки вже твої/)).toHaveCount(0);
  });

  test('«Детальніше» — вікно пасу (трансляція грає) або сторінка /pass/; «Що дає пас» на сторінці більше немає', async ({
    page,
  }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await slot(page).getByRole('button', { name: 'Детальніше' }).locator('visible=true').click();
    await expect(page.getByRole('heading', { level: 2, name: 'Що дає Новорічний пас' })).toHaveCount(0);
    await expect
      .poll(async () => (await page.getByRole('dialog', { name: 'Новорічний пас' }).count()) > 0 || new URL(page.url()).pathname === '/pass/')
      .toBe(true);
  });

  test('не під час введення в чаті: фокус у полі блокує картку, після виходу вона з’являється', async ({
    page,
  }) => {
    test.skip(isPhone(page), 'поле чату на телефоні — у вкладці; правило перевіряє юніт (uiState)');
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, '2027-01-01T02:04:30+02:00', 0);
    const field = page.getByRole('textbox', { name: /Повідомлення в чат/ });
    await field.focus();
    await setTime(page, { at: LONDON_PLUS_6 });
    await page.waitForTimeout(2_500);
    await expect(offerCard(page, /Нових роки вже твої/)).toHaveCount(0);
    // Не клавішею: час заморожено (speed 0), а натискання в полі — «введення» ще 10 с віртуального часу.
    await field.blur();
    await expect(offerCard(page, /Нових роки вже твої/)).toBeVisible({ timeout: 10_000 });
  });

});

// Рішення власника 2026-11-12: чайових-пропозиції під штампом більше немає — тост доступний усім і завжди
// (смуга тостів під плеєром, келих у полі чату, «Підтримати»), зокрема власникам пасу.
test.describe('US6 · тост замість чайових', () => {
  test('після 3-го штампа (пас уже показували) — картки чайових немає; смуга тостів → вікно → тост у чаті', async ({
    page,
  }) => {
    await seedGuest(page, {
      stamps: [...TWO_STAMPS, 'evt_azores_2027'],
      offers: [{ kind: 'pass-offer', triggerEventId: 'evt_london_2027' }],
    });
    await gotoAt(page, AZORES_PLUS_6, 0);
    const strip = page.locator('[data-toast-strip]');
    await expect(strip).toBeVisible({ timeout: 10_000 });
    await expect(offerCard(page, 'Скажи тост на весь світ')).toHaveCount(0);
    await expect(slot(page)).toHaveCount(0);
    await setPayResult(page, 'success');
    await strip.locator('[data-action="toast-open"]').first().click();
    const win = page.locator('[data-window="O-TOAST"]');
    await expect(win.getByRole('radio', { name: '$5 · пляшка ігристого' })).toHaveAttribute('aria-checked', 'true');
    await win.getByRole('textbox', { name: 'Нік для тосту' }).fill('Зоряна');
    await win.getByRole('textbox', { name: 'Текст твого тосту' }).fill('Піднімаю келих за всіх!');
    await win.locator('[data-action="toast-pay"]').click();
    await expect(win).toContainText('Тост опубліковано', { timeout: 10_000 });
    await expect(page.locator('[data-toast="true"]').filter({ hasText: 'Піднімаю келих за всіх!' }).first()).toBeAttached();
  });

  test('власник пасу теж може сказати тост; у вікні — «Новорічний пас у тебе вже є»', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS, hasPass: true });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await page.locator('[data-toast-strip] [data-action="toast-open"]').first().click();
    const win = page.locator('[data-window="O-TOAST"]');
    await expect(win).toContainText('Новорічний пас у тебе вже є');
  });

  // Рішення 2026-11-13: у розгорнутій смузі — кнопка «Усі тости» на сторінку «Тости світу» (замість посилання на чат).
  test('розгорнута смуга: «Усі тости» — кнопка на сторінку «Тости світу»', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, AZORES_PLUS_6, 0);
    const strip = page.locator('[data-toast-strip]');
    await expect(strip).toBeVisible({ timeout: 10_000 });
    await strip.locator('[data-action="toast-expand"]').first().click();
    const all = strip.locator('[data-action="toast-all"]');
    await expect(all).toBeVisible();
    await expect(all).toHaveText('Усі тости');
    await expect(all).toHaveAttribute('href', /^\/support\/?$/);
    await all.click();
    await expect(page).toHaveURL(/\/support\//, { timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Тости світу' })).toBeVisible();
  });

  // Рішення 2026-11-13: клік на картку тосту (десктоп) веде на «Тости світу», а не перемикає чат на «Світ».
  test('десктоп: картка тосту — посилання на «Тости світу»', async ({ page }) => {
    test.skip(isPhone(page), 'картка-посилання є лише на десктопі');
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, AZORES_PLUS_6, 0);
    const card = page.locator('[data-toast-strip] [data-action="toast-card"]');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toHaveAttribute('href', /^\/support\/?$/);
    await card.click();
    await expect(page).toHaveURL(/\/support\//, { timeout: 20_000 });
  });

  test('до свята смуги тостів і келиха в полі чату немає', async ({ page }) => {
    await seedGuest(page, {});
    await gotoAt(page, '2026-12-28T14:00:00+02:00', 0);
    await expect(page.locator('#player-title')).toBeVisible({ timeout: 15_000 });
    if (isPhone(page)) await page.getByRole('button', { name: /^Розгорнути чат/ }).click();
    await expect(page.getByRole('textbox', { name: /Повідомлення/ }).first()).toBeVisible();
    await expect(page.locator('[data-toast-strip]')).toHaveCount(0);
    await expect(page.locator('[data-action="chat-toast"]')).toHaveCount(0);
  });
});

test.describe('US6 · «Потрібен пас»', () => {
  test('кнопка графіка без пасу → вікно «Графік — у Новорічному пасі» на місці чату → «Усе про пас»', async ({ page }) => {
    await seedGuest(page, {});
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    await page
      .getByRole('button', { name: /^Додати в графік: / })
      .first()
      .click();
    // Рішення 2026-10-31: вікно на місці чату / шторкою, не плашка в потоці; безплатного нагадування немає.
    const gate = page.locator('[data-window="O-SCHEDULE-GATE"]');
    await expect(gate).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Графік — у Новорічному пасі' })).toBeVisible();
    await expect(gate).not.toContainText('безплатно');
    await expect(gate.getByRole('button', { name: /Оформити пас/ })).toBeVisible();
    await gate.getByRole('button', { name: /Усе про пас/ }).click();
    await expect(page.locator('[data-window="O-PASS-INFO-BOARD"]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Що дає Новорічний пас' })).toBeVisible();
  });
});

test.describe('US6 · «Поділитися» штампом', () => {
  test('штамп → «Поділитися» → панель із прев’ю й чотирма діями; системний шеринг першим', async ({
    page,
  }) => {
    await seedGuest(page, { stamps: ['evt_london_2027'] });
    await gotoAt(page, '2027-01-01T02:00:20+02:00', 0);
    await page.getByRole('button', { name: 'Поділитися' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Поділитися штампом' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img')).toHaveAttribute('alt', /Прев’ю картки: .* Новий рік о/);
    const actions = dialog.locator('[data-row="actions"] > li');
    await expect(actions).toHaveCount(4);
    await expect(actions.first().getByRole('button', { name: 'Поділитися…' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'WhatsApp' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Копіювати посилання' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Завантажити зображення' })).toBeVisible();
    await dialog.getByRole('radio', { name: '1:1' }).click();
    await expect(dialog.locator('[data-row="preview"]')).toHaveAttribute('data-ratio', 'square');
  });
});

test.describe('US6 · cookies', () => {
  test('перший візит: плашка внизу, дії рівноцінні; «Прийняти» зберігає вибір і ховає плашку', async ({
    page,
  }) => {
    await seedGuest(page, { consentAnswered: false });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    const banner = page.locator('[data-cookie-banner]');
    await expect(banner).toBeVisible();
    // Рішення 2026-11-02 (дошка `Desk-Cookies-Design`): «Налаштувати», «Лише необхідні», «Прийняти», × — без коралової.
    await expect(banner.getByRole('button').filter({ hasText: /\S/ })).toHaveText(['Налаштувати', 'Лише необхідні', 'Прийняти']);
    await expect(banner.getByRole('button', { name: 'Закрити — лише необхідні' })).toBeVisible();
    await expect(banner.locator('[data-variant="coral"]')).toHaveCount(0);
    expect(await banner.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');

    // Плашка в’їжджає знизу (transform, 260 мс) — міряємо після анімації.
    await expect.poll(() => banner.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    const box = (await banner.boundingBox())!;
    const vp = page.viewportSize()!;
    if (isPhone(page)) {
      // Телефон вертикально: картка над згорнутим вікном чату, з відступами 12 px.
      await expect(banner).toHaveAttribute('data-cookie-banner', 'card');
      expect(Math.round(box.x)).toBe(12);
      expect(Math.round(box.width)).toBe(vp.width - 24);
      const dock = (await page.locator('[data-chat-dock]').boundingBox())!;
      expect(Math.round(box.y + box.height)).toBe(Math.round(dock.y) - 12);
    } else {
      // Десктоп: один рядок завширшки з колонку відео, 16 px від низу; чат праворуч не закриває.
      await expect(banner).toHaveAttribute('data-cookie-banner', 'bar');
      const player = (await page.locator('[data-player-slot="main"]').boundingBox())!;
      expect(Math.abs(box.x - player.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.width - player.width)).toBeLessThanOrEqual(1);
      expect(Math.round(vp.height - box.y - box.height)).toBe(16);
    }

    // DOM рано: одразу після посилань-пропусків, до хедера.
    const order = await page.evaluate(() => {
      const all = [...document.querySelectorAll('nav[aria-label], [data-cookie-banner], header')];
      return all.map((el) =>
        el.hasAttribute('data-cookie-banner') ? 'cookies' : el.tagName.toLowerCase(),
      );
    });
    expect(order.indexOf('cookies')).toBeLessThan(order.indexOf('header'));

    await banner.getByRole('button', { name: 'Прийняти' }).click();
    await expect(banner).toHaveCount(0);
    const consent = await page.evaluate(
      () => JSON.parse(localStorage.getItem('t2f:guest:v1') ?? '{}').state?.consent,
    );
    expect(consent).toMatchObject({
      answered: true,
      analytics: true,
      marketing: true,
      facebookVideo: true,
    });
  });

  test('не лягає на відео: низький екран — схована, прокрутили — виїхала, назад — знову схована', async ({ page }) => {
    test.skip(isPhone(page), 'телефон вертикально: відео вгорі, картка внизу — не перетинаються');
    // Пропорційний макет (2026-11-09): на 1280 усе ×0,84 — «низький екран» тепер 540 px (було 640 при 16 px).
    await page.setViewportSize({ width: 1280, height: 540 });
    await seedGuest(page, { consentAnswered: false });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    const banner = page.locator('[data-cookie-banner]');
    await expect(banner).toHaveAttribute('data-hidden', 'true');
    await expect(banner).toHaveAttribute('aria-hidden', 'true');
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect(banner).toHaveAttribute('data-hidden', 'false');
    const player = (await page.locator('[data-player-host]').boundingBox())!;
    const box = (await banner.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(player.y + player.height);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(banner).toHaveAttribute('data-hidden', 'true');
  });

  test('× — те саме, що «Лише необхідні»: плашка зникає, вибір збережено', async ({ page }) => {
    await seedGuest(page, { consentAnswered: false });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    const banner = page.locator('[data-cookie-banner]');
    await banner.getByRole('button', { name: 'Закрити — лише необхідні' }).click();
    await expect(banner).toHaveCount(0);
    const consent = await page.evaluate(
      () => JSON.parse(localStorage.getItem('t2f:guest:v1') ?? '{}').state?.consent,
    );
    expect(consent).toMatchObject({ answered: true, analytics: false, marketing: false, facebookVideo: false });
  });

  test('«Налаштувати» — 4 категорії; «Відео з Facebook» пишеться в guest.consent', async ({
    page,
  }) => {
    await seedGuest(page, { consentAnswered: false });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    await page.locator('[data-cookie-banner]').getByRole('button', { name: 'Налаштувати' }).click();
    const dialog = page.getByRole('dialog', { name: 'Налаштування cookies' });
    await expect(dialog).toBeVisible();
    // Поки відкриті налаштування, плашки немає.
    await expect(page.locator('[data-cookie-banner]')).toHaveCount(0);
    await expect(dialog.getByRole('switch')).toHaveCount(4);
    await expect(dialog.getByRole('switch', { name: 'Необхідні' })).toBeDisabled();
    await expect(dialog.getByText('Завжди увімкнені')).toBeVisible();
    // Одна коралова кнопка — «Зберегти вибір»; звук нейтральний.
    await expect(visibleCoral(page)).toHaveCount(1);
    await dialog.getByRole('switch', { name: 'Відео з Facebook' }).click();
    await dialog.getByRole('button', { name: 'Зберегти вибір' }).click();
    await expect(page.locator('[data-cookie-banner]')).toHaveCount(0);
    const consent = await page.evaluate(
      () => JSON.parse(localStorage.getItem('t2f:guest:v1') ?? '{}').state?.consent,
    );
    expect(consent).toMatchObject({
      answered: true,
      analytics: false,
      marketing: false,
      facebookVideo: true,
    });
    // Ту саму згоду читає картка плеєра `FacebookConsentCard` (див. us1-edge: сцена «єдине джерело — Facebook»).
  });

  test('футер: «Налаштування cookies» відкриває налаштування будь-коли', async ({ page }) => {
    await seedGuest(page, {});
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    // Футер B (2026-11-08): на телефоні колонка «Довідка» — акордеон, спершу розгорнути.
    const footer = page.getByRole('contentinfo');
    if (test.info().project.name === 'phone') await footer.getByRole('button', { name: 'Довідка' }).click();
    await footer.getByRole('button', { name: 'Налаштування cookies' }).click();
    await expect(page.getByRole('dialog', { name: 'Налаштування cookies' })).toBeVisible();
    await expect(page.getByText(/Змінити вибір можна будь-коли/)).toBeVisible();
  });
});
