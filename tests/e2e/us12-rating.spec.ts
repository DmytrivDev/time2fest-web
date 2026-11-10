/**
 * «Рейтинг святкувань» за дошками `Desk-Rating-New` / `Phone-Rating-New` v2 (рішення власника 2026-11-07): відлік до
 * закриття, «Оціни, де ти був» з підтвердженням оцінки, список з медалями й колонкою «Твоя оцінка», фільтр «Де я був»,
 * «Ще попереду», «Рейтинг у чотирьох числах»; «Оцінити» в списку — оцінка на місці чату; на сторінці країни — чіп «★ 4,7 · 2-ге місце ›»; на ТВ — вкладка «Рейтинг».
 */
import type { Page } from '@playwright/test';
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.describe.configure({ timeout: 90_000 });

const AT = '2027-01-01T02:30:00+02:00';

async function seed(page: Page) {
  await page.addInitScript(() => {
    const ms = (iso: string) => Date.parse(iso);
    const st = (eventId: string, iso: string, city: string, at: string) => ({
      eventId,
      grantedAt: ms(at),
      presenceSource: 'country',
      illustrationId: 'x',
      cityName: city,
      countryIso: iso,
    });
    const state = {
      v: 1,
      id: 'g-e2e',
      locale: 'uk',
      consent: { answered: true, necessary: true, analytics: false, marketing: false, facebookVideo: false },
      reducedMotion: true,
      chatHidden: false,
      zoneStreamsCollapsed: false,
      chat: { lastRoom: 'world', sentAt: [] },
      room: { windows: [], soundSlot: null },
      stamps: [
        st('evt_auckland_2027', 'NZ', 'Окленд', '2026-12-31T11:00:30Z'),
        st('evt_dubai_2027', 'AE', 'Дубай', '2026-12-31T20:00:30Z'),
        st('evt_kyiv_2027', 'UA', 'Київ', '2026-12-31T22:00:30Z'),
      ],
      stampsDismissed: [],
      pendingPresence: {},
      rate: { evt_kyiv_2027: { stars: 4 } },
      offers: { nightId: '2026-27', history: [], visible: null },
      schedule: [],
      hasPass: true,
      firstRow: {},
      nightId: '2026-27',
    };
    if (!localStorage.getItem('t2f:guest:v1')) localStorage.setItem('t2f:guest:v1', JSON.stringify({ state, version: 1 }));
    // Пас — лише в того, хто увійшов в акаунт з пасом (правка власника 2026-11-10).
    if (!localStorage.getItem('t2f:auth:v1')) localStorage.setItem('t2f:auth:v1', JSON.stringify({ state: { user: { email: 'pass@example.com', via: 'email', signedInAt: 1 }, accounts: ['pass@example.com'], letter: null, sends: [], passes: { 'pass@example.com': 1 } }, version: 1 }));
    localStorage.setItem('t2f:tv', JSON.stringify({ state: { welcomed: true, show: 'all' }, version: 1 }));
  });
}

test.describe('сторінка рейтингу', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Рейтинг: телефон і десктоп');
  });

  test('відлік, оцінка з підтвердженням, «Твоя оцінка» в списку, фільтр «Де я був»', async ({ page }) => {
    await seed(page);
    await gotoAt(page, AT, 1, '/rating/');
    await expect(page.getByRole('heading', { level: 1, name: 'Рейтинг святкувань' })).toBeVisible();
    await expect(page.locator('[data-rating-countdown="open"] [role="timer"]')).toBeVisible();
    // Київ уже оцінений — оцінити лишаються Окленд і Дубай.
    await expect(page.locator('[data-rate-card]')).toHaveCount(2);
    const card = page.locator('[data-rate-card="evt_dubai_2027"]');
    // Наведення: світяться зірки до наведеної включно (власник 2026-11-07).
    await card.getByRole('radio', { name: '3 з 5' }).hover();
    await expect(card.locator('[role="radio"][data-lit]')).toHaveCount(3);
    await card.getByRole('radio', { name: '5 з 5' }).click();
    await expect(card).toContainText('Ти поставив 5 з 5');
    await expect(page.locator('[data-rating-row="evt_dubai_2027"]')).toContainText('Оцінити');
    await card.getByRole('button', { name: 'Підтвердити' }).click();
    await expect(card).toContainText('Дякуємо');
    await expect(card.getByRole('link', { name: /Рейтинг святкувань/ })).toHaveCount(0);
    await expect(page.locator('[data-rating-row="evt_dubai_2027"]').getByLabel('Твоя оцінка: 5 з 5')).toBeVisible();
    await expect(page.locator('[data-rating-row="evt_kyiv_2027"]').getByLabel('Твоя оцінка: 4 з 5')).toBeVisible();
    // Медалі — перші три місця.
    await expect(page.locator('[data-rating-row][data-place]')).toHaveCount(3);
    await page.getByRole('button', { name: 'Де я був' }).click();
    await expect(page.locator('[data-rating-row]')).toHaveCount(3);
    await expect(page.getByRole('heading', { name: 'Ще попереду' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Рейтинг у чотирьох числах' })).toBeVisible();
    // «Оцінити» в колонці «Твоя оцінка» — оцінка на місці чату (на телефоні — шторкою).
    await page.getByRole('button', { name: 'Усі', exact: true }).click();
    await page.locator('[data-rating-row="evt_auckland_2027"] [data-action="rate-open"]').click();
    const panel = page.locator('[data-rate-panel="evt_auckland_2027"]');
    await panel.getByRole('radio', { name: '4 з 5' }).click();
    await panel.getByRole('button', { name: 'Підтвердити' }).click();
    await expect(page.locator('[data-rating-row="evt_auckland_2027"]').getByLabel('Твоя оцінка: 4 з 5')).toBeVisible();
  });

  test('сторінка країни після півночі: чіп «★ … · …-е місце ›» веде в рейтинг', async ({ page }) => {
    await seed(page);
    await gotoAt(page, AT, 1, '/country/ukraina/');
    const chip = page.locator('[data-rating-chip]:visible');
    await expect(chip).toHaveText(/\d,\d · \d+-(ше|ге|тє|те|ме|ве) місце/);
    await chip.click();
    await expect(page).toHaveURL(/\/rating\/?/);
  });
});

test('ТВ: вкладка «Рейтинг» — топ-5 і QR «Оціни з телефона»', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'tv', 'Лише режим вечірки');
  await seed(page);
  await gotoAt(page, AT, 1, '/tv/');
  await page.getByRole('tab', { name: /Рейтинг/ }).click();
  const tab = page.locator('[data-tv-rating]');
  await expect(tab.locator('li')).toHaveCount(5);
  await expect(page.locator('[data-tv-rate-qr]')).toContainText('time2fest.com/rating');
});
