/**
 * US1 — крайні випадки ефіру (T066): подія без трансляції → сцена відліку (FR-015);
 * Facebook без згоди → картка на місці плеєра (FR-044); `onError(101)` → наступне джерело й повідомлення (FR-043);
 * рядок «За вашим графіком зараз — <Місто> · Перейти ›» (FR-014); під відео при прокрутці нічого не плаває (мініплеєра немає — рішення власника);
 * закріплений плеєр ≥ 200 px на телефоні.
 */
import type { Page } from '@playwright/test';
import { expectNothingOverPlayer, expectPlayerMinSize, playerBox } from './fixtures/geometry';
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'US1: телефон і десктоп');
});
test.describe.configure({ timeout: 90_000 });

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;

/** Стан гостя з тестовим графіком (`GuestState.schedule`) до завантаження сторінки. */
async function seedSchedule(page: Page, eventIds: string[]) {
  await page.addInitScript((ids) => {
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
      stamps: [],
      pendingPresence: {},
      rate: {},
      offers: { nightId: '2026-27', history: [], visible: null },
      schedule: ids,
      hasPass: true,
      firstRow: {},
      nightId: '2026-27',
    };
    if (!localStorage.getItem('t2f:guest:v1')) localStorage.setItem('t2f:guest:v1', JSON.stringify({ state, version: 1 }));
  }, eventIds);
}

test.describe('US1 · крайні випадки ефіру', () => {
  test('подія без трансляції — сцена відліку на місці плеєра (FR-015)', async ({ page, ytStub }) => {
    // 02:20 за Києвом: ефір уже на Азорських островах (північ о 03:00), трансляцій немає.
    await gotoAt(page, '2027-01-01T02:20:00+02:00', 0);
    const slot = page.locator('[data-player-slot="main"]');
    await expect(slot).toHaveAttribute('data-player-state', 'fallback');
    await expect(slot.locator('[data-video-area="countdown-scene"]')).toBeVisible();
    expect(await playerBox(page)).toBeNull();
    expect((await ytStub.counters()).created).toBe(0);
    // Звук вмикати нічого — кнопка неактивна з причиною в назві.
    await expect(page.getByRole('button', { name: /Увімкнути звук/ })).toBeDisabled();
  });

  test.fixme('єдине джерело — Facebook без згоди: картка на місці плеєра, звук неактивний (FR-044)', async ({ page }) => {
    // У data/streams.json немає події, де Facebook — єдине придатне джерело; потрібна тестова фікстура даних (T069).
    await gotoAt(page, '2027-01-01T02:00:00+02:00', 0);
    await expect(page.locator('[data-video-area="facebook-consent"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Увімкнути звук/ })).toBeDisabled();
  });

  test('onError(101) — наступне джерело ланцюжка й «Перемкнули на іншу трансляцію з цього місця» (FR-043)', async ({ page, ytStub }) => {
    await gotoAt(page, '2027-01-01T01:50:00+02:00', 1);
    await ytStub.waitForPlayer();
    await expect.poll(async () => (await ytStub.players())[0]?.videoId).toBe('zMCea32gpmg');

    await ytStub.fireError(101);
    await expect(page.getByRole('status').filter({ hasText: 'Перемкнули на іншу трансляцію з цього місця' })).toBeVisible();
    await expect.poll(async () => (await ytStub.players())[0]?.videoId).toBe('MXmzsjABC-U');
    const c = await ytStub.counters();
    expect(c.created).toBe(1);
    expect(c.loadedIds).toContain('MXmzsjABC-U');
    // Фокус не переноситься на повідомлення.
    expect(await page.evaluate(() => document.activeElement?.getAttribute('role'))).not.toBe('status');
    await expectNothingOverPlayer(page);
  });

  test('рядок графіка: «За вашим графіком зараз — <Місто> · Перейти ›» (FR-014)', async ({ page, ytStub }) => {
    await seedSchedule(page, ['evt_canary_2027']);
    await gotoAt(page, '2027-01-01T01:58:00+02:00', 0);
    await ytStub.waitForPlayer();
    const hint = page.locator('[data-schedule-hint]');
    await expect(hint).toContainText('За вашим графіком зараз — Канарські острови');
    const link = hint.getByRole('link', { name: /Перейти/ });
    await expect(link).toHaveAttribute('href', /\/country\/[a-z-]+\/?$/);
  });

  test('без графіка рядка немає', async ({ page, ytStub }) => {
    await gotoAt(page, '2027-01-01T01:58:00+02:00', 0);
    await ytStub.waitForPlayer();
    await expect(page.locator('[data-caption]')).toBeVisible();
    await expect(page.locator('[data-schedule-hint]')).toHaveCount(0);
  });

  test('десктоп: під відео при прокрутці нічого не плаває; плеєр точно над слотом і прокручується разом із ним', async ({ page, ytStub }) => {
    test.skip(isPhone(page), 'десктоп');
    await gotoAt(page, '2027-01-01T01:50:00+02:00', 1);
    await ytStub.waitForPlayer();
    const rects = () =>
      page.evaluate(() => {
        const r = (s: string) => {
          const b = document.querySelector(s)!.getBoundingClientRect();
          return [b.x, b.y, b.width, b.height].map((v) => Math.round(v));
        };
        return { host: r('[data-player-host] iframe'), slot: r('[data-player-slot="main"]') };
      });
    const before = await rects();
    expect(before.host).toEqual(before.slot);
    await page.mouse.wheel(0, 800);
    await expect.poll(async () => (await rects()).slot[1]).toBeLessThan((before.slot[1] ?? 0) - 500);
    const after = await rects();
    expect(after.host).toEqual(after.slot);
    await expect(page.locator('[data-mini-player]')).toHaveCount(0);
    expect((await ytStub.counters()).created).toBe(1);
  });

  test('телефон: плеєр закріплений угорі й не менший за 200 px', async ({ page, ytStub }) => {
    test.skip(!isPhone(page), 'лише телефон');
    await gotoAt(page, '2027-01-01T01:50:00+02:00', 1);
    await ytStub.waitForPlayer();
    await page.mouse.wheel(0, 900);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    const box = await expectPlayerMinSize(page);
    expect(Math.abs(box.y)).toBeLessThanOrEqual(1);
    await expectNothingOverPlayer(page);
  });
});
