/**
 * US6 — «Пропозиції й вікна в потоці» (quickstart; T117, FR-063…FR-065).
 * Гість зі штампами на 2 події → картка «Уже 2 країни у твоєму паспорті» не раніше +5 хв після події, не пізніше −10 хв до
 * наступної, після оцінки, одна за раз; закрита хрестиком не повертається тієї ночі; після 3-го штампа — чайові;
 * не під час введення в чаті (~10 с); при картці з кораловою кнопкою кнопка звуку нейтральна (на екрані одна коралова);
 * cookies: у кутку (десктоп) / смугою (телефон) / в потоці, якщо чат сховано; Facebook-згода з налаштувань.
 * Оплата поза областю: «Оформити пас» і «Підтримати» показують лише «Оплата буде на наступному етапі».
 *
 * ПОКИ НЕ ЗАПУСКАЄТЬСЯ: рішення власника 2026-10-27 — e2e пишемо, але не проганяємо; перевірка — typecheck, lint, юніти, build.
 * Часовий пояс браузера — Київ: північ Лондона (00:00 UTC) = 02:00 за вашим часом; наступна основна північ — Азорські (01:00 UTC).
 */
import type { Page } from '@playwright/test';
import { runAxe } from './fixtures/axe';
import { gotoAt, setTime } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'US6: телефон і десктоп');
});
test.describe.configure({ timeout: 90_000 });

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/** Моменти за Києвом (UTC+2): Лондон 02:00. */
const LONDON_PLUS_3 = '2027-01-01T02:03:00+02:00';
const LONDON_PLUS_6 = '2027-01-01T02:06:00+02:00';
const LONDON_PLUS_52 = '2027-01-01T02:52:00+02:00';
const AZORES_PLUS_6 = '2027-01-01T03:06:00+02:00';

const slot = (page: Page) => page.locator('[data-in-flow-slot="occupied"]');
const offerCard = (page: Page, name: string | RegExp) => page.getByRole('heading', { level: 2, name });
const visibleCoral = (page: Page) => page.locator('[data-variant="coral"]:visible');

interface Seed {
  stamps?: string[];
  hasPass?: boolean;
  chatHidden?: boolean;
  consentAnswered?: boolean;
  offers?: { kind: 'pass-offer' | 'tips'; triggerEventId: string }[];
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
      firstRow: {},
      nightId: '2026-27',
    };
    localStorage.setItem(key, JSON.stringify({ state, version: 1 }));
  }, seed);
}

const TWO_STAMPS = ['evt_paris_2027', 'evt_london_2027'];

test.describe('US6 · пропозиція пасу після 2-го Нового року', () => {
  test('не раніше +5 хв після події: о +3 хв картки немає, о +6 хв — є, одна коралова, звук нейтральний', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_3, 0);
    await expect(offerCard(page, /Уже 2 країни/)).toHaveCount(0);

    await setTime(page, { at: LONDON_PLUS_6 });
    const card = offerCard(page, 'Уже 2 країни у твоєму паспорті');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(slot(page)).toContainText('Оформити пас');
    await expect(slot(page)).toContainText('$4,99');
    await expect(slot(page)).toContainText('разово, на весь сезон · без підписки');
    await expect(slot(page).getByText('Ще в пасі:')).toBeVisible();

    // Одна коралова кнопка на екрані — «Оформити пас»; кнопка звуку нейтральна.
    await expect(visibleCoral(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Оформити пас' })).toHaveAttribute('data-variant', 'coral');
    await expect(page.getByRole('button', { name: /Увімкнути звук/ }).first()).not.toHaveAttribute('data-variant', 'coral');

    // Фокус сторінка не забрала.
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });

  test('не пізніше −10 хв до наступної: о +52 хв (Азори о +60) картки немає', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_52, 1);
    await page.waitForTimeout(3_000);
    await expect(offerCard(page, /Уже 2 країни/)).toHaveCount(0);
  });

  test('«Оформити пас» не веде на фальшивий чекаут — лише «Оплата буде на наступному етапі»', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await page.getByRole('button', { name: 'Оформити пас' }).click();
    await expect(slot(page).getByRole('status')).toHaveText('Оплата буде на наступному етапі');
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('закрита хрестиком не повертається тієї ночі (і після перезавантаження)', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await page.getByRole('button', { name: 'Закрити пропозицію' }).click();
    await expect(offerCard(page, /Уже 2 країни/)).toHaveCount(0);

    await setTime(page, { at: '2027-01-01T02:20:00+02:00' });
    await page.waitForTimeout(2_500);
    await expect(offerCard(page, /Уже 2 країни/)).toHaveCount(0);

    await page.reload();
    await page.waitForTimeout(2_500);
    await expect(offerCard(page, /Уже 2 країни/)).toHaveCount(0);
  });

  test('Esc закриває картку; звук знову коралевий', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await expect(offerCard(page, /Уже 2 країни/)).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await expect(offerCard(page, /Уже 2 країни/)).toHaveCount(0);
  });

  test('є пас — пропозиції пасу немає', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS, hasPass: true });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await page.waitForTimeout(2_500);
    await expect(offerCard(page, /Уже 2 країни/)).toHaveCount(0);
  });

  test('«Детальніше» → «Що дає Новорічний пас» (3 головні + «Ще в пасі:»), axe чистий', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await page.getByRole('button', { name: 'Детальніше' }).click();
    await expect(offerCard(page, 'Що дає Новорічний пас')).toBeVisible();
    await expect(slot(page).getByRole('list', { name: 'Головне в пасі' }).getByRole('listitem')).toHaveCount(3);
    await expect(slot(page).getByText('Ще в пасі:')).toBeVisible();
    const violations = await runAxe(page);
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  test('не під час введення в чаті: фокус у полі блокує картку, після виходу вона з’являється', async ({ page }) => {
    test.skip(isPhone(page), 'поле чату на телефоні — у вкладці; правило перевіряє юніт (uiState)');
    await seedGuest(page, { stamps: TWO_STAMPS });
    await gotoAt(page, '2027-01-01T02:04:30+02:00', 0);
    const field = page.getByRole('textbox', { name: /Повідомлення в чат/ });
    await field.focus();
    await setTime(page, { at: LONDON_PLUS_6 });
    await page.waitForTimeout(2_500);
    await expect(offerCard(page, /Уже 2 країни/)).toHaveCount(0);
    await field.press('Tab');
    await expect(offerCard(page, /Уже 2 країни/)).toBeVisible({ timeout: 10_000 });
  });

  test('писав у чаті — серед головних «−50% на «Перший ряд»»', async ({ page }) => {
    await seedGuest(page, { stamps: TWO_STAMPS, sentMessages: 1 });
    await gotoAt(page, LONDON_PLUS_6, 0);
    await expect(slot(page).getByRole('list', { name: 'Головне в пасі' })).toContainText('−50% на «Перший ряд»');
  });
});

test.describe('US6 · чайові після 3-го Нового року', () => {
  test('після 3-го штампа (пас уже показували) — «Чайові»: $2 / $5 / $10, «Підтримати $5»', async ({ page }) => {
    await seedGuest(page, {
      stamps: [...TWO_STAMPS, 'evt_azores_2027'],
      offers: [{ kind: 'pass-offer', triggerEventId: 'evt_london_2027' }],
    });
    await gotoAt(page, AZORES_PLUS_6, 0);
    await expect(offerCard(page, 'Чайові')).toBeVisible({ timeout: 10_000 });
    await expect(slot(page).getByRole('radio')).toHaveText(['$2', '$5', '$10']);
    await slot(page).getByRole('radio', { name: '$5' }).click();
    await expect(page.getByRole('button', { name: 'Підтримати $5' })).toHaveAttribute('data-variant', 'coral');
    await expect(slot(page)).toContainText('Входити не треба — email для квитанції попросить сторінка оплати');
    await expect(visibleCoral(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Підтримати $5' }).click();
    await expect(slot(page).getByRole('status')).toHaveText('Оплата буде на наступному етапі');
  });
});

test.describe('US6 · «Потрібен пас»', () => {
  test('кнопка графіка без пасу → «Щоб додавати в графік, потрібен Новорічний пас» → «Що дає пас»', async ({ page }) => {
    await seedGuest(page, {});
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    await page.getByRole('button', { name: /^Додати в графік: / }).first().click();
    await expect(offerCard(page, 'Щоб додавати в графік, потрібен Новорічний пас')).toBeVisible();
    await expect(slot(page)).toContainText('Перше нагадування — безплатно.');
    await expect(visibleCoral(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Що дає пас' }).click();
    await expect(offerCard(page, 'Що дає Новорічний пас')).toBeVisible();
  });
});

test.describe('US6 · «Поділитися» штампом', () => {
  test('штамп → «Поділитися» → панель із прев’ю й чотирма діями; системний шеринг першим', async ({ page }) => {
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
  test('перший візит: банер із трьома рівноцінними кнопками; «Прийняти» зберігає вибір і ховає банер', async ({ page }) => {
    await seedGuest(page, { consentAnswered: false });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    const banner = page.locator('[data-cookie-banner]');
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button')).toHaveText(['Прийняти', 'Лише необхідні', 'Налаштувати']);
    await expect(banner.locator('[data-variant="coral"]')).toHaveCount(0);

    if (isPhone(page)) {
      await expect(banner).toHaveAttribute('data-cookie-banner', 'strip');
      const box = (await banner.boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.x).toBe(0);
      expect(Math.round(box.width)).toBe(vp.width);
      expect(Math.round(box.y + box.height)).toBe(vp.height);
    } else {
      await expect(banner).toHaveAttribute('data-cookie-banner', 'corner');
      const box = (await banner.boundingBox())!;
      expect(box.width).toBeLessThanOrEqual(360);
      expect(box.x).toBeLessThan(64);
      // Не на плеєрі: нічого поверх відео.
      const player = (await page.locator('[data-player-slot="main"]').boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(player.y + player.height - 1);
    }

    // DOM рано: одразу після посилань-пропусків, до хедера.
    const order = await page.evaluate(() => {
      const all = [...document.querySelectorAll('nav[aria-label], [data-cookie-banner], header')];
      return all.map((el) => (el.hasAttribute('data-cookie-banner') ? 'cookies' : el.tagName.toLowerCase()));
    });
    expect(order.indexOf('cookies')).toBeLessThan(order.indexOf('header'));

    await banner.getByRole('button', { name: 'Прийняти' }).click();
    await expect(banner).toHaveCount(0);
    const consent = await page.evaluate(() => JSON.parse(localStorage.getItem('t2f:guest:v1') ?? '{}').state?.consent);
    expect(consent).toMatchObject({ answered: true, analytics: true, marketing: true, facebookVideo: true });
  });

  test('чат сховано (десктоп): банер — смуга в потоці під кнопками плеєра, на місці штампа, не на відео', async ({ page }) => {
    test.skip(isPhone(page), 'на телефоні завжди смуга внизу');
    await seedGuest(page, { consentAnswered: false, chatHidden: true });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    const banner = page.locator('[data-cookie-banner]');
    await expect(banner).toHaveAttribute('data-cookie-banner', 'inflow');
    const player = (await page.locator('[data-player-slot="main"]').boundingBox())!;
    const box = (await banner.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(player.y + player.height - 1);
    // У потоці, не fixed.
    expect(await banner.evaluate((el) => getComputedStyle(el).position)).not.toBe('fixed');
  });

  test('«Налаштувати» — 4 категорії; «Відео з Facebook» пишеться в guest.consent', async ({ page }) => {
    await seedGuest(page, { consentAnswered: false });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    await page.locator('[data-cookie-banner]').getByRole('button', { name: 'Налаштувати' }).click();
    const dialog = page.getByRole('dialog', { name: 'Налаштування cookies' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('switch')).toHaveCount(4);
    await expect(dialog.getByRole('switch', { name: 'Необхідні' })).toBeDisabled();
    await expect(dialog.getByText('Завжди увімкнені')).toBeVisible();
    // Одна коралова кнопка — «Зберегти вибір»; звук нейтральний.
    await expect(visibleCoral(page)).toHaveCount(1);
    await dialog.getByRole('switch', { name: 'Відео з Facebook' }).click();
    await dialog.getByRole('button', { name: 'Зберегти вибір' }).click();
    await expect(page.locator('[data-cookie-banner]')).toHaveCount(0);
    const consent = await page.evaluate(() => JSON.parse(localStorage.getItem('t2f:guest:v1') ?? '{}').state?.consent);
    expect(consent).toMatchObject({ answered: true, analytics: false, marketing: false, facebookVideo: true });
    // Ту саму згоду читає картка плеєра `FacebookConsentCard` (див. us1-edge: сцена «єдине джерело — Facebook»).
  });

  test('футер: «Налаштування cookies» відкриває налаштування будь-коли', async ({ page }) => {
    await seedGuest(page, {});
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    await page.getByRole('button', { name: 'Налаштування cookies' }).click();
    await expect(page.getByRole('dialog', { name: 'Налаштування cookies' })).toBeVisible();
    await expect(page.getByText(/Змінити вибір можна будь-коли/)).toBeVisible();
  });
});
