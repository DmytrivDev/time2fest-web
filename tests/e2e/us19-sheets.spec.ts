/**
 * Шторки на телефоні й планшеті-портреті (правки власника 2026-11-10, `lib/overlay/sheetTop.ts`):
 * - одне правило висоти: вікна чату (і сам чат) — під рядком часу (смугу «Перший ряд» прибрано 2026-11-12); усе решта
 *   (меню, сповіщення, «Ще дії») — під
 *   відео; на сторінці без відео — обидва види на рівні шапка + 16:9 від ширини;
 * - перехід між сторінками не лишає відкритої (і тим паче порожньої) шторки;
 * - «Режим вечірки» на телефоні й планшеті-портреті веде на `/tv-info/`.
 * Вікно задає сам файл, тож він іде лише в проєкті `desktop`.
 */
import type { Locator, Page } from '@playwright/test';
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== 'desktop', 'Шторки: вікно задає файл, досить одного проєкту');
});
test.describe.configure({ timeout: 90_000 });

const AT = '2027-01-01T01:38:00+02:00';

/** Гість без штампів і пасу, cookies уже відповів. */
async function seed(page: Page) {
  await page.addInitScript(() => {
    const state = {
      v: 1,
      id: 'g-e2e-sheets',
      locale: 'uk',
      consent: { answered: true, necessary: true, analytics: false, marketing: false, facebookVideo: false },
      reducedMotion: true,
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
      nightId: '2026-27',
    };
    if (!localStorage.getItem('t2f:guest:v1')) localStorage.setItem('t2f:guest:v1', JSON.stringify({ state, version: 1 }));
  });
}

const menuButton = (page: Page) => page.locator('header button[aria-haspopup="dialog"]').filter({ hasText: 'Меню' }).first();

/** Видима шторка (шар вікон `(live)`, `Sheet` чи бічне вікно поза `(live)`). */
const openSheet = (page: Page): Locator => page.locator('[data-window-layer]:not([hidden]), [data-sheet], [data-menu]');

/** Геометрія сторінки на початку (scrollTop = 0). */
function geometry(page: Page) {
  return page.evaluate(() => {
    const slot = document.querySelector('[data-player-slot="main"]');
    let above = 0;
    document.querySelectorAll('[data-dock-above]').forEach((e) => (above = Math.max(above, e.getBoundingClientRect().bottom)));
    const header = document.querySelector('header')!.getBoundingClientRect().height;
    const bar = document.querySelector('[data-player-bar]');
    return {
      video: slot ? slot.getBoundingClientRect().bottom : 0,
      above,
      bar: bar ? bar.getBoundingClientRect().bottom : 0,
      noVideo: header + Math.round((document.documentElement.clientWidth * 9) / 16),
    };
  });
}

async function topOf(loc: Locator): Promise<number> {
  await expect(loc.first()).toBeVisible();
  // Шторка доїхала (анімацію вимкнено «Зменшити рух»).
  return (await loc.first().boundingBox())!.y;
}

for (const vp of [
  { name: 'телефон 390 × 844', width: 390, height: 844 },
  { name: 'планшет-портрет 834 × 1194', width: 834, height: 1194 },
]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: true });

    test('сторінка з відео: меню й «Ще дії» — під відео, чат — під рядком часу', async ({ page }) => {
      await seed(page);
      await gotoAt(page, AT, 0, '/');
      const g = await geometry(page);
      expect(g.video).toBeGreaterThan(0);
      expect(g.above).toBeGreaterThan(g.video);
      // Без смуги «Перший ряд» найнижче з `data-dock-above` на головній — сам рядок часу.
      expect(Math.abs(g.above - g.bar)).toBeLessThanOrEqual(1);

      await menuButton(page).click();
      expect(Math.abs((await topOf(openSheet(page))) - g.video)).toBeLessThanOrEqual(3);
      await page.keyboard.press('Escape');
      await expect(openSheet(page)).toHaveCount(0);

      await page.locator('button[aria-label="Ще дії"]').filter({ visible: true }).first().click();
      expect(Math.abs((await topOf(openSheet(page))) - g.video)).toBeLessThanOrEqual(3);
      await page.keyboard.press('Escape');
      await expect(openSheet(page)).toHaveCount(0);

      // Сам чат (і вікна чату) — нижче: під рядком часу.
      await page.locator('[data-dock-expand]').click();
      const dock = page.locator('[data-chat-dock][data-state="expanded"]');
      await expect(dock).toBeVisible();
      await expect.poll(async () => Math.abs((await dock.boundingBox())!.y - g.above)).toBeLessThanOrEqual(3);
    });

    for (const path of ['/countries/', '/pass/', '/login/']) {
      test(`сторінка без відео ${path}: меню — на рівні шапка + 16:9`, async ({ page }) => {
        await seed(page);
        await gotoAt(page, AT, 0, path);
        const g = await geometry(page);
        expect(g.video).toBe(0);
        await menuButton(page).click();
        const top = await topOf(openSheet(page));
        expect(Math.abs(top - g.noVideo)).toBeLessThanOrEqual(3);
        // Не на всю висоту: між шапкою й шторкою видно сторінку.
        expect(top).toBeGreaterThan(vp.height / 4);
      });
    }

    test('перехід між сторінками не лишає відкритої чи порожньої шторки', async ({ page }) => {
      await seed(page);
      await gotoAt(page, AT, 1, '/');
      // Меню → «Країни й міста».
      await menuButton(page).click();
      await openSheet(page).first().getByRole('link', { name: /Країни/ }).first().click();
      // Сервер розробки компілює `loading.tsx` сегмента на першому переході (скелетони, 2026-11-11): під навантаженням довше 5 с.
      await expect(page).toHaveURL(/\/countries\/?/, { timeout: 20_000 });
      await page.waitForTimeout(600);
      await expect(openSheet(page)).toHaveCount(0);
      // Відкрите меню й перехід посиланням зі сторінки (картка країни).
      // Сторінка вже не скелетон: картки країн на місці (під навантаженням — не одразу).
      await expect
        .poll(() => page.evaluate(() => [...document.querySelectorAll('main a[href^="/country/"]')].some((x) => x.getBoundingClientRect().height > 0)))
        .toBe(true);
      await menuButton(page).click();
      await expect(openSheet(page).first()).toBeVisible();
      await page.evaluate(() => {
        const a = [...document.querySelectorAll<HTMLAnchorElement>('main a[href^="/country/"]')].find((x) => x.getBoundingClientRect().height > 0);
        a?.click();
      });
      await expect(page).toHaveURL(/\/country\//, { timeout: 20_000 });
      await page.waitForTimeout(600);
      await expect(openSheet(page)).toHaveCount(0);
      // Назад — теж без шторки.
      await page.goBack();
      await expect(page).toHaveURL(/\/countries\/?/);
      await page.waitForTimeout(600);
      await expect(openSheet(page)).toHaveCount(0);
    });

    test('«Режим вечірки» в меню й «Ще дії» веде на /tv-info/', async ({ page }) => {
      await seed(page);
      await gotoAt(page, AT, 0, '/');
      await menuButton(page).click();
      await expect(openSheet(page).first().getByRole('link', { name: /Режим вечірки/ })).toHaveAttribute('href', /^\/tv-info\/?$/);
      await page.keyboard.press('Escape');
      await page.locator('button[aria-label="Ще дії"]').filter({ visible: true }).first().click();
      await expect(openSheet(page).first().getByRole('link', { name: /Режим вечірки/ })).toHaveAttribute('href', /^\/tv-info\/?$/);
      // Футер на телефоні — акордеони: посилання в DOM, хоч і згорнуте.
      await expect(page.locator('footer a').filter({ hasText: 'Режим вечірки' })).toHaveAttribute('href', /^\/tv-info\/?$/);
    });
  });
}

test.describe('десктоп 1520 × 900', () => {
  test.use({ viewport: { width: 1520, height: 900 } });
  test('«Режим вечірки» веде на сам режим /tv/', async ({ page }) => {
    await seed(page);
    await gotoAt(page, AT, 0, '/');
    await expect(page.getByRole('main').getByRole('link', { name: 'Режим вечірки' })).toHaveAttribute('href', /^\/tv\/?$/);
    await expect(page.locator('footer').getByRole('link', { name: 'Режим вечірки' })).toHaveAttribute('href', /^\/tv\/?$/);
  });
});
