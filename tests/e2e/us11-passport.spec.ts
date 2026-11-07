/**
 * «Мій паспорт Нових років» за дошками `Desk-Passport-New` / `Phone-Passport-New` v1 (рішення власника 2026-11-07):
 * інфографіка; мапа шляху — у пасі (без пасу затемнена з карткою пасу, так само на «Моєму графіку»); з пасом —
 * «Поділитися шляхом / паспортом»; листівки з оцінкою лише головних святкувань; велика листівка; «За континентами».
 */
import type { Page } from '@playwright/test';
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Паспорт: телефон і десктоп');
});
test.describe.configure({ timeout: 90_000 });

const AT = '2027-01-01T01:38:00+02:00';

async function seed(page: Page, pass: boolean) {
  await page.addInitScript((pass) => {
    const ms = (iso: string) => Date.parse(iso);
    const st = (eventId: string, iso: string, city: string, at: string, extra = {}) => ({
      eventId,
      grantedAt: ms(at),
      presenceSource: 'country',
      illustrationId: 'x',
      cityName: city,
      countryIso: iso,
      ...extra,
    });
    const state = {
      v: 1,
      id: 'g-e2e',
      locale: 'uk',
      consent: { answered: true, necessary: true, analytics: false, marketing: false, facebookVideo: false },
      reducedMotion: false,
      chatHidden: false,
      zoneStreamsCollapsed: false,
      chat: { lastRoom: 'world', sentAt: [] },
      room: { windows: [], soundSlot: null },
      stamps: [
        st('evt_auckland_2027', 'NZ', 'Окленд', '2026-12-31T11:00:30Z'),
        st('evt_dubai_2027', 'AE', 'Дубай', '2026-12-31T20:00:30Z', { firstRowSeat: 4 }),
        st('evt_kyiv_2027', 'UA', 'Київ', '2026-12-31T22:00:30Z'),
      ],
      pendingPresence: {},
      rate: { evt_kyiv_2027: { stars: 4 } },
      offers: { nightId: '2026-27', history: [], visible: null },
      schedule: [],
      hasPass: pass,
      firstRow: {},
      nightId: '2026-27',
    };
    if (!localStorage.getItem('t2f:guest:v1')) localStorage.setItem('t2f:guest:v1', JSON.stringify({ state, version: 1 }));
  }, pass);
}

test('з пасом: інфографіка, мапа з шляхом і «Поділитися шляхом»; оцінка лише головних святкувань', async ({ page }) => {
  await seed(page, true);
  await gotoAt(page, AT, 1, '/passport/');
  const profile = page.locator('[data-passport-profile]');
  await expect(profile).toContainText('3');
  await expect(profile).toContainText('з 6');
  await expect(page.locator('[data-passport-map="pass"] [data-visited="UA"]')).toHaveCount(1);
  // Окленд — головне святкування (поки з вебкамерою): «Як тобі шоу?»; Київ — уже оцінений: «Твоя оцінка».
  await expect(page.locator('[data-stamp-card="evt_auckland_2027"] [data-stamp-rate]')).toContainText('Як тобі шоу?');
  await expect(page.locator('[data-stamp-card="evt_kyiv_2027"] [data-stamp-rate]')).toBeVisible();
  await page.locator('[data-action="share-route"]').click();
  await expect(page.getByRole('dialog').or(page.locator('[data-overlay]')).first()).toContainText('Поділитися шляхом');
});

test('без пасу: мапа затемнена з карткою пасу; так само на «Моєму графіку»', async ({ page }) => {
  await seed(page, false);
  await gotoAt(page, AT, 1, '/passport/');
  await expect(page.locator('[data-passport-map="locked"] [data-path-lock="passport"]')).toBeVisible();
  await expect(page.locator('[data-action="share-route"]')).toHaveCount(0);
  await expect(page.locator('[data-point]')).toHaveCount(0);
  await gotoAt(page, AT, 1, '/schedule/');
  await expect(page.locator('[data-path-lock="schedule"]')).toBeVisible();
});

test('велика листівка: гортати й «Поділитися штампом»; «За континентами»', async ({ page }) => {
  await seed(page, true);
  await gotoAt(page, AT, 1, '/passport/');
  await page.locator('[data-stamp-card="evt_dubai_2027"] button[aria-label^="Відкрити"]').click();
  const big = page.locator('[data-big-postcard]');
  await expect(big).toHaveAttribute('data-big-postcard', 'evt_dubai_2027');
  await big.getByRole('button', { name: 'Наступна листівка' }).click();
  await expect(page.locator('[data-big-postcard]')).toHaveAttribute('data-big-postcard', 'evt_kyiv_2027');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'За континентами' }).click();
  await expect(page.getByRole('heading', { name: /Океанія · 1/ })).toBeVisible();
  await expect(page.locator('b', { hasText: 'Африка' })).toBeVisible();
});
