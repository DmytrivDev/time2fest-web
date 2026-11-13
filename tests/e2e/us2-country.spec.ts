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
// Телефон, як на головній: два підписи — липкий рядок (місто, відлік) і назва трансляції під «Першим рядом».
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
    await expect(caption(page).last()).toContainText('Лондон · Темза й Лондонський міст');
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
    await expect(caption(page).first()).toContainText('до півночі');

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
    await expect(page.locator('[data-stamp-block]')).toContainText(/Мій паспорт/, { timeout: 10_000 });

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
    // Телефон, як на головній: липкий рядок і назва без позначок; «Запис» видно в рядках трансляцій.
    if (!isPhone(page)) {
      await expect(page.locator('[data-caption-recording]')).toHaveText('Запис');
      await expect(page.locator('[data-caption-ago]')).toHaveText('північ була 40 хв тому');
    }
    await expect(row3(page)).toHaveText('Франція зустріла Новий рік · далі: Велика Британія о 02:00');
    // У даних немає повторів — кнопки «Подивитися північ ще раз» немає.
    await expect(page.getByRole('button', { name: 'Подивитися північ ще раз' })).toHaveCount(0);
    await expect(page.locator('[data-action="choose-stream"]:visible')).toHaveText(/Обрати трансляцію/);
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
    await expect(caption(page).first()).toContainText('Лондон');
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
    await expect(page).toHaveURL(/\/country\/velyka-brytaniia\/?(\?e=[^&]+)?$/);
    await expect(block(page)).toBeVisible();
    await expect(streamRow(page, 'src_london_1')).toHaveAttribute('data-current', /.*/);

    await setTime(page, { at: '2027-01-01T02:15:10+02:00', speed: 1 });
    await expect.poll(() => nowMs(page)).toBeGreaterThan(Date.parse('2027-01-01T00:15:00Z'));
    await expect(caption(page).first()).toContainText('Лондон');
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

// ── Пояс і подія з посилання (власник 2026-11-10: «щоб перекидало на те, на що клікнув») ──
/**
 * Головне святкування (рішення власника 2026-11-13). Тестові дані: Японія, «Токіо · відлік на Сібуї» очікується з 16:51:40
 * за Києвом (північ 17:00), вебкамери Токіо вже йдуть.
 */
test.describe('US2 · головне святкування країни', () => {
  const JP = '/country/yaponiia/';
  const TOKYO_MAIN = 'dfVK7ld38Ys';
  const SHINJUKU = 'GLQhbRGv5qU';

  test('за замовчуванням — заглушка з відліком «до початку»; кнопка відкриває список трансляцій сторінки', async ({ page, ytStub }) => {
    await gotoAt(page, '2026-12-31T16:46:00+02:00', 1, JP);
    const scene = page.locator('[data-scene="waiting"]');
    await expect(scene).toBeVisible();
    await expect(scene).toContainText('Почнеться о 16:51 за твоїм часом');
    await expect(scene.locator('[data-waiting-left]')).toHaveText(/^до початку 0?5:\d\d$/);
    await expect(page.locator('#player-title')).toContainText('Токіо · відлік на Сібуї');
    // Той самий список, що «Обрати трансляцію ›» сторінки (рішення 2026-11-13); вибір — ручний.
    await scene.getByRole('button', { name: 'Дивитися, що вже йде' }).click();
    const picker = page.locator('[data-window="O-STREAM-PICKER"]');
    await expect(picker).toBeVisible();
    await expectAxeClean(page);
    await picker.locator('button[data-source="src_tokyo_3"]').first().click();
    await ytStub.waitForPlayer();
    await expect.poll(() => videoId(ytStub)).toBe(SHINJUKU);
    await expect(page.locator('#player-title')).toContainText('Токіо · Сіндзюку');
  });

  test('обрана вебкамера: головне почалось — «Перемкнути» в рядку під відео; явний вибір головного до початку — «Трансляція очікується»', async ({ page, ytStub }) => {
    await gotoAt(page, '2026-12-31T16:51:00+02:00', 1, JP);
    await expect(page.locator('[data-scene="waiting"]')).toBeVisible();
    await streamRow(page, 'src_tokyo_3').getByRole('button', { name: /Сіндзюку/ }).first().click();
    await ytStub.waitForPlayer();
    await expect.poll(() => videoId(ytStub)).toBe(SHINJUKU);
    await expect(page.locator('#player-title')).toContainText('Токіо · Сіндзюку');

    // Явно обране головне, що ще не почалось, — та сама заглушка «Трансляція очікується».
    await streamRow(page, 'src_tokyo_1').getByRole('button', { name: /відлік на Сібуї/ }).first().click();
    await expect(page.locator('[data-scene="waiting"]')).toBeVisible();
    await streamRow(page, 'src_tokyo_3').getByRole('button', { name: /Сіндзюку/ }).first().click();
    await expect.poll(() => videoId(ytStub)).toBe(SHINJUKU);

    await setTime(page, { at: '2026-12-31T16:51:45+02:00', speed: 1 });
    const line = page.locator('[data-main-live]').filter({ visible: true });
    await expect(line).toHaveCount(1);
    expect(await videoId(ytStub)).toBe(SHINJUKU);
    await (isPhone(page) ? line : line.getByRole('button', { name: 'Перемкнути' })).click();
    await expect.poll(() => videoId(ytStub)).toBe(TOKYO_MAIN);
    await expect(page.locator('[data-main-live]')).toHaveCount(0);
    await expect(page.locator('#player-title')).toContainText('Токіо · відлік на Сібуї');
    expect((await ytStub.counters()).created).toBe(1);
  });
});

test.describe('сторінка країни відкриває пояс і місто, на які клікнули', () => {
  /** Вибраний пояс у шапці: десктоп — чип, телефон — кнопка «місто · UTC» над відео. */
  const selectedZone = (page: Page) =>
    test.info().project.name === 'phone'
      ? page.locator('[data-country-row] button[aria-haspopup="dialog"]')
      : page.locator('[data-country-header] [data-zone-option][aria-checked="true"]');

  test('«Зараз і далі» на головній: Ріо-де-Жанейро → Бразилія, UTC−3 (а не перший пояс, що вже грає)', async ({ page }) => {
    await gotoAt(page, '2027-01-01T03:55:00+02:00', 0, '/');
    const rio = page.locator('a[href*="/country/brazyliia/"]').filter({ hasText: 'Ріо-де-Жанейро' }).first();
    await expect(rio).toHaveAttribute('href', /\?e=evt_rio-de-janeiro_2027/);
    await rio.scrollIntoViewIfNeeded();
    await rio.click();
    // дев-сервер віддає RSC сторінки не одразу
    await expect(page).toHaveURL(/\/country\/brazyliia\/\?e=evt_rio-de-janeiro_2027/, { timeout: 30_000 });
    await expect(selectedZone(page)).toContainText('UTC−3');
    await expect(selectedZone(page)).toContainText('Ріо-де-Жанейро');
    await expect(page.locator('#player-title')).toContainText('Ріо');
  });

  test('пряма адреса: Австралія ?e=Перт → UTC+8; США ?zone=UTC−8 → Лос-Анджелес; без параметрів — як було', async ({ page }) => {
    await gotoAt(page, '2026-12-31T12:00:00+02:00', 0, '/country/avstraliia/?e=evt_perth_2027');
    await expect(selectedZone(page)).toContainText('UTC+8');
    await gotoAt(page, '2026-12-31T12:00:00+02:00', 0, `/country/ssha/?zone=${encodeURIComponent('utc-0800')}`);
    await expect(selectedZone(page)).toContainText('UTC−8');
    // Подія з іншої країни чи невідомий пояс — ігноруються (пояс за замовчуванням).
    await gotoAt(page, '2026-12-31T12:00:00+02:00', 0, '/country/ssha/?e=evt_perth_2027');
    await expect(selectedZone(page)).toContainText('UTC−5');
  });

  test('та сама сторінка, інше місто в «Зараз і далі» — пояс перемикається', async ({ page }) => {
    // Після півночі Ріо (+45 хв) на сторінці — «Зараз і далі» з Манаусом (UTC−4).
    await gotoAt(page, '2027-01-01T05:45:00+02:00', 0, '/country/brazyliia/?e=evt_rio-de-janeiro_2027');
    await expect(selectedZone(page)).toContainText('UTC−3');
    const manaus = page.locator('a[href*="?e=evt_manaus_2027"]').first();
    await manaus.scrollIntoViewIfNeeded();
    await manaus.click();
    await expect(page).toHaveURL(/\?e=evt_manaus_2027/, { timeout: 30_000 });
    await expect(selectedZone(page)).toContainText('UTC−4');
  });
});
