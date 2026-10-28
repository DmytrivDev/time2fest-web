/**
 * US2 — сторінка країни, пульт (T087; FR-020…FR-024, quickstart 7 і 13).
 * Сторінка `/country/<slug>/` з «машиною часу» і заглушкою YouTube:
 * - acc.1: дотик до рядка іншої трансляції перемикає плеєр (той самий iframe, `loadVideoById`), звук і стан зберігаються;
 * - acc.2: «Очікується» — сцена на місці плеєра й відлік у підписі, потім трансляція з’являється сама;
 * - acc.3: країна без трансляції — сцена відліку, «Як святкувати», чат, штамп опівночі;
 * - acc.4: +40 хв — «Запис», «північ була 40 хв тому», «… зустріла Новий рік · далі: …», без «Подивитися північ ще раз»
 *   (у даних немає повторів), «Зараз і далі» замість трансляцій поясу;
 * - acc.5 / FR-024: ефір перейшов, а сторінка країни — ні (і після «Лишитися тут ›» відео не перезапускається);
 * - статичні сторінки ≈240 країн, 404 для невідомого slug; axe.
 *
 * Часовий пояс браузера — Київ: Париж опівночі = 01:00, Лондон = 02:00.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { runAxe } from './fixtures/axe';
import { expectNothingOverPlayer, expectPlayerMinSize } from './fixtures/geometry';
import { gotoAt, nowMs, setTime } from './fixtures/time';
import { expect, test, type YouTubeStub } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'US2: телефон і десктоп');
});
test.describe.configure({ timeout: 90_000 });

const GB = '/country/velyka-brytaniia/';
const FR = '/country/frantsiia/';
const SN = '/country/senehal/';
const LONDON_1 = 'zMCea32gpmg';
const LONDON_2 = 'MXmzsjABC-U';
const PARIS_1 = 'QI-PPEW2Bgc';
const PARIS_2 = '-xzg3wujOVM';

const block = (page: Page) => page.locator('[data-player-block="remote"]');
const caption = (page: Page) => page.locator('[data-caption]');
const row3 = (page: Page) => page.locator('[data-caption-row3]');
const streamRow = (page: Page, id: string) => page.locator(`[data-stream-row="${id}"]`);

function isPhone(page: Page) {
  return (page.viewportSize()?.width ?? 0) < 768;
}

async function expectAxeClean(page: Page) {
  const violations = await runAxe(page);
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

async function videoId(ytStub: YouTubeStub): Promise<string | null> {
  return (await ytStub.players())[0]?.videoId ?? null;
}

async function guestStampIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('t2f:guest:v1');
      return ((raw ? JSON.parse(raw).state?.stamps : []) ?? []).map((s: { eventId: string }) => s.eventId);
    } catch {
      return [];
    }
  });
}

test.describe('US2 · сторінка країни', () => {
  test('acc.1: дотик до рядка іншої трансляції — той самий плеєр, звук зберігається', async ({ page, ytStub }) => {
    await gotoAt(page, '2027-01-01T01:50:00+02:00', 1, GB);
    await ytStub.waitForPlayer();
    await expect.poll(() => videoId(ytStub)).toBe(LONDON_1);
    await expect(block(page)).toBeVisible();
    await expect(streamRow(page, 'src_london_1')).toHaveAttribute('data-current', /.*/);

    await page.getByRole('button', { name: 'Увімкнути звук' }).click();
    await expect.poll(async () => (await ytStub.counters()).unMute).toBe(1);

    await streamRow(page, 'src_london_2').getByRole('button', { name: /Темза й Лондонський міст/ }).first().click();
    await expect.poll(() => videoId(ytStub)).toBe(LONDON_2);
    const c = await ytStub.counters();
    expect(c.created).toBe(1);
    expect(c.destroyed).toBe(0);
    expect(c.loadedIds).toContain(LONDON_2);
    expect((await ytStub.players())[0]!.muted).toBe(false);
    await expect(page.getByRole('button', { name: 'Звук увімкнено' })).toBeVisible();
    await expect(streamRow(page, 'src_london_2').locator('button[aria-pressed="true"]')).toHaveCount(1);
    await expect(caption(page)).toContainText('Лондон · Темза й Лондонський міст');
    await expect(page).toHaveURL(/\/country\/velyka-brytaniia\/?(\?.*)?$/);

    await expectPlayerMinSize(page);
    await expectNothingOverPlayer(page);
    expect(await page.locator('[data-variant="coral"]:visible').count()).toBeLessThanOrEqual(1);
    await expectAxeClean(page);
  });

  test('acc.2: «Очікується» — сцена й відлік, потім трансляція з’являється сама', async ({ page, ytStub }) => {
    // Париж: основне джерело очікується з 22:50Z, запасні — наживо. Запасні ламаються → лишається лише очікуване.
    await gotoAt(page, '2026-12-31T22:45:00Z', 1, FR);
    await ytStub.waitForPlayer();
    await expect.poll(() => videoId(ytStub)).toBe(PARIS_2);
    await expect(streamRow(page, 'src_paris_1')).toContainText('Очікується');

    await ytStub.fireError(150);
    await expect.poll(() => videoId(ytStub)).not.toBe(PARIS_2);
    await ytStub.fireError(150);
    await expect(page.locator('[data-video-area="expected-scene"]')).toBeVisible();
    await expect(page.locator('[data-caption-timer="countdown"]')).toBeVisible();
    await expect(caption(page)).toContainText('до півночі');

    // Настає startsAt — без перезавантаження, у тому самому iframe.
    await setTime(page, { at: '2026-12-31T22:50:05Z', speed: 1 });
    await expect.poll(() => videoId(ytStub)).toBe(PARIS_1);
    await expect(page.locator('[data-video-area="expected-scene"]')).toHaveCount(0);
    expect((await ytStub.counters()).created).toBe(1);
    await expectAxeClean(page);
  });

  test('acc.3: без трансляції — сцена відліку, «Як святкувати», чат і штамп опівночі', async ({ page, ytStub }) => {
    await gotoAt(page, '2027-01-01T01:59:55+02:00', 1, SN);
    await expect(page.locator('[data-video-area="countdown-scene"]')).toBeVisible();
    expect((await ytStub.counters()).created).toBe(0);
    await expect(page.getByRole('heading', { name: /Як святкувати · Сенегал/ })).toBeVisible();
    await expect(row3(page)).toHaveText('Сенегал · північ о 02:00 за вашим часом');
    await expectAxeClean(page);

    // Штамп нараховується опівночі (+15 с), хоча трансляції немає.
    await expect.poll(() => guestStampIds(page), { timeout: 40_000 }).toContain('evt_dakar_2027');
    await expect(page.locator('[data-moment-slot]')).toContainText(/Мій паспорт/, { timeout: 10_000 });

    // Чат є завжди: кімнати «Світ» і «Країна».
    if (isPhone(page)) await page.getByRole('button', { name: /^Розгорнути чат/ }).click();
    const rooms = page.getByRole('radiogroup', { name: 'Кімнати чату' });
    await expect(rooms.getByRole('radio', { name: 'Країна' })).toBeVisible();
    await expect(rooms.getByRole('radio', { name: 'Світ' })).toBeVisible();
    await expect(page.locator('[data-room="country:SN"]')).toBeVisible();
    await rooms.getByRole('radio', { name: 'Світ' }).click();
    await expect(page.locator('[data-room="world"]')).toBeVisible();
  });

  test('acc.4: через 40 хв після півночі — запис, «північ була 40 хв тому», «Зараз і далі»', async ({ page, ytStub }) => {
    await gotoAt(page, '2027-01-01T01:40:00+02:00', 0, FR);
    await ytStub.waitForPlayer();
    await expect(page.locator('[data-caption-recording]')).toHaveText('Запис');
    await expect(page.locator('[data-caption-ago]')).toHaveText('північ була 40 хв тому');
    await expect(row3(page)).toHaveText('Франція зустріла Новий рік · далі: Велика Британія о 02:00');
    // У даних немає повторів — кнопки «Подивитися північ ще раз» немає.
    await expect(page.getByRole('button', { name: 'Подивитися північ ще раз' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Записи' })).toBeVisible();
    await expect(streamRow(page, 'src_paris_2')).toContainText('Запис');
    await expect(page.getByText('Трансляції в цьому поясі')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Зараз і далі' }).first()).toBeVisible();
    await expectAxeClean(page);
  });

  test('acc.5 (FR-024): ефір перейшов — сторінка країни не перемикається', async ({ page, ytStub }) => {
    await gotoAt(page, '2027-01-01T02:14:40+02:00', 1, GB);
    await ytStub.waitForPlayer();
    await expect.poll(() => videoId(ytStub)).toBe(LONDON_1);
    const before = await ytStub.counters();

    await setTime(page, { at: '2027-01-01T02:15:30+02:00', speed: 1 });
    await expect.poll(() => nowMs(page)).toBeGreaterThan(Date.parse('2027-01-01T00:15:00Z'));
    await expect(caption(page)).toContainText('Лондон');
    await expect(row3(page)).toHaveText('Велика Британія зустріла Новий рік');
    const after = await ytStub.counters();
    expect(after.loadVideoById).toBe(before.loadVideoById);
    expect(after.created).toBe(1);
    expect(await videoId(ytStub)).toBe(LONDON_1);
    await expect(page).toHaveURL(/\/country\/velyka-brytaniia\//);
  });

  test('«Лишитися тут ›» → пульт: та сама трансляція, відео не перезапускається', async ({ page, ytStub }) => {
    await gotoAt(page, '2027-01-01T02:14:10+02:00', 1);
    await ytStub.waitForPlayer();
    const iframeId = await ytStub.iframeId();
    const before = await ytStub.counters();
    await page.getByRole('link', { name: /Лишитися тут/ }).click();
    await expect(page).toHaveURL(/\/country\/velyka-brytaniia\/?$/);
    await expect(block(page)).toBeVisible();
    await expect(streamRow(page, 'src_london_1')).toHaveAttribute('data-current', /.*/);

    await setTime(page, { at: '2027-01-01T02:15:10+02:00', speed: 1 });
    await expect.poll(() => nowMs(page)).toBeGreaterThan(Date.parse('2027-01-01T00:15:00Z'));
    await expect(caption(page)).toContainText('Лондон');
    const after = await ytStub.counters();
    expect(after.created).toBe(1);
    expect(after.loadVideoById).toBe(before.loadVideoById);
    expect(await ytStub.sameIframe()).toBe(true);
    expect(await ytStub.iframeId()).toBe(iframeId);
  });

  test('статичні сторінки ≈240 країн і 404 для невідомого slug', async ({ page, request }) => {
    const countries = (JSON.parse(readFileSync(join(process.cwd(), 'data', 'countries.json'), 'utf8')) as { countries: { slug: string }[] }).countries;
    expect(countries.length).toBeGreaterThanOrEqual(230);
    expect(countries.length).toBeLessThanOrEqual(260);
    // Після `pnpm build` у `out/country/` — по сторінці на країну (`generateStaticParams`).
    const outDir = join(process.cwd(), 'out', 'country');
    if (existsSync(outDir)) {
      const pages = readdirSync(outDir).filter((d) => existsSync(join(outDir, d, 'index.html')));
      expect(pages.length).toBe(countries.length);
    }

    const res = await request.get('/country/no-such-country/');
    expect(res.status()).toBe(404);
    const ok = await page.goto(SN);
    expect(ok?.status()).toBe(200);
  });
});
