/**
 * US1 — «Зустріти північ в ефірі, нічого не обираючи» (quickstart, сценарії 1–6; T065).
 * Головна з «машиною часу»: підпис за фазами, штамп + системне повідомлення + стіна на «+15 с»
 * (у межах 1 с, також при зсуві годинника пристрою — SC-002), оцінка на «+2 хв», остання хвилина,
 * «Лишитися тут ›» без перезапуску відео (SC-003), перехід ефіру на «+15 хв». axe на кожній фазі.
 *
 * Часовий пояс браузера — Київ: «північ о 02:00 за вашим часом» для Лондона.
 */
import type { Page } from '@playwright/test';
import { runAxe } from './fixtures/axe';
import { expectNothingOverPlayer, expectPlayerMinSize } from './fixtures/geometry';
import { gotoAt, nowMs, shiftDeviceClock, waitForTimeApi } from './fixtures/time';
import { expect, test, type YouTubeStub } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'US1: телефон і десктоп');
});
test.describe.configure({ timeout: 90_000 });

const LONDON_MIDNIGHT = Date.parse('2027-01-01T00:00:00Z');
const STAMP_AT = LONDON_MIDNIGHT + 15_000;
const LONDON_VIDEO = 'zMCea32gpmg';

const caption = (page: Page) => page.locator('[data-caption]');
const timer = (page: Page) => page.locator('[data-caption-timer]');
const row3 = (page: Page) => page.locator('[data-caption-row3]');
export const inFlow = (page: Page) => page.locator('[data-moment-slot], [data-in-flow-slot="occupied"]');

function isPhone(page: Page) {
  return (page.viewportSize()?.width ?? 0) < 768;
}

/** На телефоні чат — у вкладці «Чат». */
async function openChat(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: /^Розгорнути чат/ }).click();
}

async function expectAxeClean(page: Page) {
  const violations = await runAxe(page);
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function guestStampIds(page: Page): Promise<{ eventId: string; grantedAt: number }[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('t2f:guest:v1');
      const stamps = raw ? (JSON.parse(raw).state?.stamps ?? []) : [];
      return stamps.map((s: { eventId: string; grantedAt: number }) => ({ eventId: s.eventId, grantedAt: s.grantedAt }));
    } catch {
      return [];
    }
  });
}

/**
 * Чекає першого кадру, де одночасно є штамп у слоті під плеєром, системне повідомлення в чаті
 * й стіна «Першого ряду», що загоряється; повертає віртуальний час цього кадру.
 */
async function waitForMoment(page: Page, timeout = 30_000): Promise<number> {
  const handle = await page.waitForFunction(
    () => {
      const slot = document.querySelector('[data-moment-slot]');
      const stamp = !!slot && /Поділитися/.test(slot.textContent ?? '') && /Мій паспорт/.test(slot.textContent ?? '');
      const log = [...document.querySelectorAll('[role="log"]')].some((el) => /Велика Британія зустріла Новий рік/.test(el.textContent ?? ''));
      const wall = !!document.querySelector('[data-first-row-wall][data-phase="lighting"], [data-first-row-wall][data-phase="lit"]');
      if (!(stamp && log && wall)) return null;
      const api = (window as unknown as { __t2f?: { timeMachine: { get(): { at: string } } } }).__t2f;
      return api ? Date.parse(api.timeMachine.get().at) : null;
    },
    undefined,
    { timeout, polling: 'raf' },
  );
  return (await handle.jsonValue()) as number;
}

async function startAt(page: Page, ytStub: YouTubeStub, iso: string, speed = 1) {
  await gotoAt(page, iso, speed);
  await ytStub.waitForPlayer();
}

test.describe('US1 · ефір на головній', () => {
  test('сценарій 1: старт без параметрів — Лондон, відлік, відео без звуку', async ({ page, ytStub }) => {
    await page.goto('/');
    await waitForTimeApi(page);
    await ytStub.waitForPlayer();

    await expect(timer(page)).toContainText(/до півночі\s*00:2[12]:\d\d/);
    await expect(row3(page)).toHaveText('Велика Британія · північ о 02:00 за вашим часом');
    await expect(caption(page).getByRole('link', { name: /Лондон/ })).toBeVisible();

    // Відео грає без звуку, автозапуск — один плеєр на сторінці.
    const players = await ytStub.players();
    expect(players).toHaveLength(1);
    expect(players[0]!.videoId).toBe(LONDON_VIDEO);
    expect(players[0]!.muted).toBe(true);
    expect(players[0]!.playerVars.autoplay).toBe(1);
    expect(players[0]!.playerVars.mute).toBe(1);
    await expect(page.locator('[data-player-host] iframe')).toHaveCount(1);
    await expectPlayerMinSize(page);
    await expectNothingOverPlayer(page);

    await expect(page.getByRole('button', { name: 'Увімкнути звук' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Обрати трансляцію/ })).toBeVisible();
    // Одна коралова кнопка на екрані.
    expect(await page.locator('[data-variant="coral"]:visible').count()).toBeLessThanOrEqual(1);

    await expectAxeClean(page);
  });

  test('«Увімкнути звук» вмикає звук у тому самому плеєрі', async ({ page, ytStub }) => {
    await startAt(page, ytStub, '2027-01-01T01:50:00+02:00', 1);
    await page.getByRole('button', { name: 'Увімкнути звук' }).click();
    await expect.poll(async () => (await ytStub.counters()).unMute).toBe(1);
    expect((await ytStub.counters()).created).toBe(1);
    await expect(page.getByRole('button', { name: 'Звук увімкнено' })).toBeVisible();
  });

  test('сценарій 2: «+15 с» — штамп, системне повідомлення й стіна разом, у межах 1 с', async ({ page, ytStub }) => {
    await startAt(page, ytStub, '2027-01-01T01:59:58+02:00', 1);
    await openChat(page);
    await expect(row3(page)).toHaveText('Велика Британія · північ о 02:00 за вашим часом');

    const at = await waitForMoment(page);
    expect(at).toBeGreaterThanOrEqual(STAMP_AT);
    expect(at - STAMP_AT).toBeLessThanOrEqual(1_000);

    await expect(row3(page)).toHaveText('Велика Британія зустріла Новий рік');
    await expect(timer(page)).toHaveCount(0);
    expect(await guestStampIds(page)).toEqual([{ eventId: 'evt_london_2027', grantedAt: STAMP_AT }]);
    await expectNothingOverPlayer(page);
    await expectAxeClean(page);
  });

  test('сценарій 2 (SC-002): годинник пристрою зсунуто на +10 хв — момент однаково на «+15 с»', async ({ page, ytStub }) => {
    await shiftDeviceClock(page, 10 * 60_000);
    await startAt(page, ytStub, '2027-01-01T01:59:58+02:00', 1);
    await openChat(page);
    const at = await waitForMoment(page);
    expect(at).toBeGreaterThanOrEqual(STAMP_AT);
    expect(at - STAMP_AT).toBeLessThanOrEqual(1_000);
    expect(await guestStampIds(page)).toEqual([{ eventId: 'evt_london_2027', grantedAt: STAMP_AT }]);
  });

  test('сценарій 3: «+2 хв» — рядок «Штамп у паспорті» і «Як тобі шоу?»', async ({ page, ytStub }) => {
    await startAt(page, ytStub, '2027-01-01T02:00:10+02:00', 1);
    await expect.poll(() => guestStampIds(page), { timeout: 20_000 }).toHaveLength(1);
    // Перемотка до «+2 хв» без перезавантаження.
    await page.evaluate(() =>
      (window as unknown as { __t2f: { timeMachine: { set(o: { at: string; speed: number }): void } } }).__t2f.timeMachine.set({
        at: '2027-01-01T02:02:00+02:00',
        speed: 1,
      }),
    );
    await expect(page.getByText('Штамп у паспорті').first()).toBeVisible();
    await expect(page.getByText('Як тобі шоу?')).toBeVisible();
    await expectNothingOverPlayer(page);
    await expectAxeClean(page);
  });

  test('сценарій 4: «+14 хв» — «далі через 0:59», «Далі: …», «Лишитися тут ›»', async ({ page, ytStub }) => {
    await startAt(page, ytStub, '2027-01-01T02:14:01+02:00', 0);
    await expect(timer(page)).toContainText(/далі через\s*0:59/);
    await expect(row3(page)).toHaveText('Далі: Азорські острови');
    await expect(page.getByRole('link', { name: /Лишитися тут/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Обрати трансляцію/ })).toHaveCount(0);
    await expectAxeClean(page);
  });

  test('сценарій 5: «Лишитися тут ›» — сторінка країни, відео не перезапускається (SC-003)', async ({ page, ytStub }) => {
    await startAt(page, ytStub, '2027-01-01T02:14:10+02:00', 1);
    await expect(page.getByRole('link', { name: /Лишитися тут/ })).toBeVisible();
    const before = await ytStub.counters();
    const iframeId = await ytStub.iframeId();

    await page.getByRole('link', { name: /Лишитися тут/ }).click();
    await expect(page).toHaveURL(/\/country\/velyka-brytaniia\/?$/);

    // Перехід ефіру настає вже на сторінці країни: відео лишається тим самим.
    await page.evaluate(() =>
      (window as unknown as { __t2f: { timeMachine: { set(o: { at: string }): void } } }).__t2f.timeMachine.set({
        at: '2027-01-01T02:15:05+02:00',
      }),
    );
    await expect.poll(() => nowMs(page)).toBeGreaterThan(Date.parse('2027-01-01T00:15:00Z'));
    const after = await ytStub.counters();
    expect(after.created).toBe(1);
    expect(after.destroyed).toBe(0);
    expect(after.loadVideoById).toBe(before.loadVideoById);
    expect(await ytStub.sameIframe()).toBe(true);
    expect(await ytStub.iframeId()).toBe(iframeId);
    expect((await ytStub.players())[0]!.videoId).toBe(LONDON_VIDEO);
  });

  test('сценарій 6: «+15 хв» — ефір на наступній події, навіть якщо до неї година', async ({ page, ytStub }) => {
    await startAt(page, ytStub, '2027-01-01T02:14:55+02:00', 1);
    await expect(row3(page)).toHaveText('Португалія · північ о 03:00 за вашим часом', { timeout: 15_000 });
    await expect(caption(page).getByRole('link', { name: /Азорські острови/ })).toBeVisible();
    // Трансляції в Азорських островів немає — на місці плеєра сцена відліку, не плеєр.
    await expect(page.locator('[data-player-slot="main"]')).toHaveAttribute('data-player-state', 'fallback');
    await expect(timer(page)).toContainText(/до півночі\s*00:4[45]:\d\d/);
    expect((await ytStub.counters()).created).toBe(1);
    await expectAxeClean(page);
  });

  test('перехід ефіру з трансляцією на трансляцію — той самий плеєр, loadVideoById', async ({ page, ytStub }) => {
    // Париж (північ 01:00 за Києвом) → Лондон о 01:15.
    await startAt(page, ytStub, '2027-01-01T01:14:56+02:00', 1);
    await expect(row3(page)).toHaveText('Велика Британія · північ о 02:00 за вашим часом', { timeout: 15_000 });
    await expect.poll(async () => (await ytStub.players())[0]?.videoId).toBe(LONDON_VIDEO);
    const c = await ytStub.counters();
    expect(c.created).toBe(1);
    expect(c.destroyed).toBe(0);
    expect(await ytStub.sameIframe()).toBe(true);
  });
});
