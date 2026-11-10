/**
 * Планшет (рішення власника 2026-11-10, `tablet-concept-2026-11-10.md`, дошки `Tab-P-New` / `Tab-L-New`):
 * - портрет 834 × 1194 (опорна): власний одноколонковий макет — поля 32 px, «Зараз і далі» сіткою по 3, «Дивляться люди»
 *   у рядку часу, смуга «Перший ряд» відкриває шторку; кегль кореня 16 px;
 * - альбом 1024 × 768 (опорна): двоколонковий; перемикач «Зараз і далі» — другим рядком і не накриває підпис (T2);
 *   наступний штамп — листівка й «що робити» поруч.
 * Вікно задає сам файл, тож він іде лише в проєкті `desktop`.
 */
import type { Page } from '@playwright/test';
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== 'desktop', 'Планшет: вікно задає файл, досить одного проєкту');
});
test.describe.configure({ timeout: 90_000 });

const AT = '2027-01-01T01:38:00+02:00';

/** Гість без штампів і пасу, cookies уже відповів. */
async function seed(page: Page) {
  await page.addInitScript(() => {
    const state = {
      v: 1,
      id: 'g-e2e-tablet',
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
      schedule: [],
      hasPass: false,
      firstRow: {},
      nightId: '2026-27',
    };
    if (!localStorage.getItem('t2f:guest:v1')) localStorage.setItem('t2f:guest:v1', JSON.stringify({ state, version: 1 }));
  });
}

const rootPx = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('портрет 834 × 1194', () => {
  test.use({ viewport: { width: 834, height: 1194 }, hasTouch: true });

  test('головна: кегль 16 px, «Зараз і далі» сіткою по 3, «Дивляться люди» в рядку часу, «Перший ряд» — шторка', async ({ page }) => {
    await seed(page);
    await gotoAt(page, AT, 1, '/');
    expect(await rootPx(page)).toBe(16);
    const section = page.locator('[data-now-next][data-layout="grid"]');
    await expect(section).toBeVisible();
    const items = section.locator('ol > li');
    await expect(items).toHaveCount(6);
    const boxes = await items.evaluateAll((els) => els.slice(0, 4).map((e) => e.getBoundingClientRect()).map((r) => ({ x: Math.round(r.left), y: Math.round(r.top) })));
    // Перші три — в одному ряду, четверта — з нового ряду під першою; ліве поле 32 px.
    expect(new Set(boxes.slice(0, 3).map((b) => b.y)).size).toBe(1);
    expect(boxes[3]!.x).toBe(boxes[0]!.x);
    expect(boxes[3]!.y).toBeGreaterThan(boxes[0]!.y);
    expect(boxes[0]!.x).toBe(32);
    // Фільтр — у рядку заголовка.
    const head = await section.locator('h2').first().boundingBox();
    const seg = await section.locator('[data-row="filter"]').first().boundingBox();
    expect(Math.abs(seg!.y + seg!.height / 2 - (head!.y + head!.height / 2))).toBeLessThan(12);
    await expect(page.locator('[data-bar-watchers]')).toBeVisible();
    expect(await noHScroll(page)).toBe(true);
    // Смуга «Перший ряд» одним рядком з ціною; натиск — вікно «Що дає „Перший ряд“» (шторка до низу відео).
    const bar = page.locator('[data-first-row-strip] button[aria-haspopup="dialog"]').first();
    await expect(bar).toContainText('Місце $');
    await bar.click();
    await expect(page.getByText('Що дає «Перший ряд»').first()).toBeVisible();
  });

  test('паспорт: поля 32 px (вада T1), наступний штамп і «що робити» поруч', async ({ page }) => {
    await seed(page);
    await gotoAt(page, AT, 1, '/passport/');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1).toBeVisible();
    expect(Math.round((await h1.boundingBox())!.x)).toBe(32);
    const tile = await page.locator('[data-next="zone"]').boundingBox();
    const block = await page.locator('[data-next-block]').boundingBox();
    expect(Math.round(tile!.y)).toBe(Math.round(block!.y));
    expect(block!.x).toBeGreaterThan(tile!.x + tile!.width);
    expect(await noHScroll(page)).toBe(true);
  });
});

test.describe('портрет 768 × 1024', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true });

  test('кегль пропорційно менший (×0,92), горизонтальної прокрутки немає', async ({ page }) => {
    await seed(page);
    await gotoAt(page, AT, 1, '/');
    expect(await rootPx(page)).toBe(14.75);
    expect(await noHScroll(page)).toBe(true);
  });

  test('кімната з 4 вікнами: кожен плеєр не менший за 200×200 px (кегль кореня менший — мінімум сталий)', async ({ page }) => {
    await page.addInitScript(() => {
      const w = (slot: number, sourceId: string, eventId: string) => ({ slot, sourceId, eventId });
      const room = {
        windows: [
          w(0, 'src_london_1', 'evt_london_2027'),
          w(1, 'src_london_2', 'evt_london_2027'),
          w(2, 'src_london_3', 'evt_london_2027'),
          w(3, 'src_paris_2', 'evt_paris_2027'),
        ],
        soundSlot: 0,
      };
      const state = { v: 1, id: 'g-e2e-tablet-room', nightId: '2026-27', room };
      if (!localStorage.getItem('t2f:guest:v1')) localStorage.setItem('t2f:guest:v1', JSON.stringify({ state, version: 1 }));
    });
    await gotoAt(page, '2027-01-01T01:50:00+02:00', 0, '/room/');
    const slots = page.locator('[data-player-slot^="room:"]');
    await expect(slots).toHaveCount(3);
    for (const b of await slots.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) {
      expect(b.width).toBeGreaterThanOrEqual(200);
      expect(b.height).toBeGreaterThanOrEqual(200);
    }
  });
});

test.describe('альбом 1024 × 768', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test('головна: кегль 16 px, перемикач «Зараз і далі» не накриває підпис (T2)', async ({ page }) => {
    await seed(page);
    await gotoAt(page, AT, 1, '/');
    expect(await rootPx(page)).toBe(16);
    const section = page.locator('[data-now-next][data-layout="carousel"]');
    await expect(section).toBeVisible();
    const meta = await section.getByText('за вашим часом', { exact: false }).first().boundingBox();
    const filter = await section.locator('[data-row="filter"]').first().boundingBox();
    expect(meta && filter).toBeTruthy();
    // Перемикач — нижче підпису, без перетину.
    expect(filter!.y).toBeGreaterThanOrEqual(meta!.y + meta!.height);
    expect(await noHScroll(page)).toBe(true);
  });

  test('паспорт: наступний штамп і «що робити» поруч', async ({ page }) => {
    await seed(page);
    await gotoAt(page, AT, 1, '/passport/');
    const tile = await page.locator('[data-next="zone"]').boundingBox();
    const block = await page.locator('[data-next-block]').boundingBox();
    expect(Math.round(tile!.y)).toBe(Math.round(block!.y));
    expect(block!.x).toBeGreaterThan(tile!.x + tile!.width);
  });
});
