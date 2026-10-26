/**
 * US3 — кімната перегляду (T094; FR-030…FR-032, FR-040…FR-042, quickstart 8).
 * Сторінка `/room/`: розкладки 1 / 2 / 3 (2×2 з вільною клітинкою) / 4 на десктопі, до 2 вікон на телефоні,
 * звук лише в одному вікні, автозапуск лише в головному, «← <країна>» веде до країни вікна зі звуком.
 *
 * Час: «зараз» 01:50 за Києвом = 23:50Z, за 10 хв до півночі Лондона (швидкість 0 — годинник стоїть).
 * Вікна: london_1 (слот 0, головне), london_2, london_3 — Лондон, паризька трансляція paris_2 (Франція) — усі «наживо».
 * Стан кімнати засіваємо в `localStorage['t2f:guest:v1']` через `addInitScript` (тільки якщо ключа ще немає,
 * тому повторне відкриття сторінки — «перезавантаження» — стан не перезаписує).
 *
 * Часовий пояс браузера — Київ. Ці тести лише написані: e2e запускається окремо (рішення власника).
 */
import type { Locator, Page } from '@playwright/test';
import { runAxe } from './fixtures/axe';
import { expectNothingOverPlayer, expectPlayerMinSize, MIN_PLAYER_PX } from './fixtures/geometry';
import { gotoAt } from './fixtures/time';
import { expect, installYouTubeStub, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name === 'tv' || testInfo.project.name === 'prod',
    'US3: телефон і десктоп',
  );
});
test.describe.configure({ timeout: 90_000 });

const NOW = '2027-01-01T01:50:00+02:00';
const ROOM = '/room/';
const GB = '/country/velyka-brytaniia/';
const FR = '/country/frantsiia/';
const GUEST_KEY = 't2f:guest:v1';

interface SeedWindow {
  slot: number;
  sourceId: string;
  eventId: string;
}
const L1: SeedWindow = { slot: 0, sourceId: 'src_london_1', eventId: 'evt_london_2027' };
const L2: SeedWindow = { slot: 1, sourceId: 'src_london_2', eventId: 'evt_london_2027' };
const L3: SeedWindow = { slot: 2, sourceId: 'src_london_3', eventId: 'evt_london_2027' };
const P2: SeedWindow = { slot: 3, sourceId: 'src_paris_2', eventId: 'evt_paris_2027' };
const ALL = [L1, L2, L3, P2];

const grid = (page: Page) => page.locator('[data-room-grid]');
const win = (page: Page, slot: number) => page.locator(`[data-room-window="${slot}"]`);
const streamRow = (page: Page, id: string) => page.locator(`[data-stream-row="${id}"]`);
const slotOf = (page: Page, slot: number) => page.locator(`[data-player-slot="room:${slot}"]`);
const facade = (loc: Locator) => loc.locator('[data-facade], [data-resume-card]');

function isPhone(page: Page) {
  return (page.viewportSize()?.width ?? 0) < 768;
}

/** Кімната в `localStorage` до першого завантаження сторінки (не перезаписує наявний стан). */
async function seedRoom(
  page: Page,
  windows: SeedWindow[],
  soundSlot: number | null = windows[0]?.slot ?? null,
) {
  await page.addInitScript(
    ({ key, room }) => {
      try {
        if (localStorage.getItem(key)) return;
        const state = { v: 1, id: 'e2e-room', nightId: '2026-27', room };
        localStorage.setItem(key, JSON.stringify({ state, version: 1 }));
      } catch {
        // без збереження
      }
    },
    { key: GUEST_KEY, room: { windows, soundSlot } },
  );
}

async function savedRoom(page: Page): Promise<{ windows: SeedWindow[]; soundSlot: number | null }> {
  return page.evaluate((key) => {
    try {
      const raw = localStorage.getItem(key);
      return (raw ? JSON.parse(raw).state?.room : null) ?? { windows: [], soundSlot: null };
    } catch {
      return { windows: [], soundSlot: null };
    }
  }, GUEST_KEY);
}

async function box(loc: Locator) {
  const b = await loc.boundingBox();
  expect(b, 'елемент має бути видимим').not.toBeNull();
  return b!;
}

async function expectAxeClean(page: Page) {
  const violations = await runAxe(page);
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

/** Країна → «+» біля рядка → нове вікно → `/room/` (десктоп: меню; телефон: підтвердження). */
async function addFromCountryPage(page: Page, sourceId: string) {
  const plus = streamRow(page, sourceId).getByRole('button', {
    name: /^Додати в кімнату перегляду:/,
  });
  await plus.click();
  if (isPhone(page)) await page.getByRole('button', { name: 'Відкрити кімнату' }).click();
  else await page.getByRole('button', { name: /Додати нове вікно трансляції/ }).click();
  await expect(page).toHaveURL(/\/room\/?(\?.*)?$/);
}

/** Відкрити панель «Додати трансляцію» у шапці кімнати. */
async function openAddPanel(page: Page) {
  await page.getByRole('button', { name: 'Додати трансляцію' }).first().click();
  const panel = page.locator('[data-add-stream-panel]');
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('US3 · кімната перегляду', () => {
  test('acc.1: розкладки 1 / 2 поруч / 3 = 2×2 з вільною клітинкою / 4 = 2×2 (десктоп)', async ({
    page: first,
    browser,
  }) => {
    test.skip(isPhone(first), 'розкладки 2×2 — лише десктоп');
    for (const n of [1, 2, 3, 4]) {
      // Свій контекст на кожну розкладку: скрипти сіяння накопичуються на сторінці, а localStorage — спільний у контексті.
      const ctx = await browser.newContext({
        viewport: first.viewportSize()!,
        timezoneId: 'Europe/Kyiv',
        locale: 'uk-UA',
        baseURL: test.info().project.use.baseURL,
      });
      const page = await ctx.newPage();
      await installYouTubeStub(page);
      await seedRoom(page, ALL.slice(0, n), 0);
      await gotoAt(page, NOW, 0, ROOM);
      await expect(grid(page)).toHaveAttribute('data-room-layout', String(n));
      await expect(page.locator('[data-room-window]')).toHaveCount(n);

      const boxes = [];
      for (let i = 0; i < n; i++) boxes.push(await box(win(page, i)));
      if (n === 1) {
        await expect(page.locator('[data-empty-cell]')).toHaveCount(0);
      }
      if (n === 2) {
        expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
        expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width - 2);
        await expect(page.locator('[data-empty-cell]')).toHaveCount(0);
      }
      if (n === 3) {
        expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
        expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 2);
        const empty = page.locator('[data-empty-cell]');
        await expect(empty).toHaveCount(1);
        await expect(empty.getByRole('button', { name: 'Додати трансляцію' })).toBeVisible();
        // вільна клітинка — праворуч від третього вікна, у тому самому ряду
        const e = await box(empty);
        expect(Math.abs(e.y - boxes[2]!.y)).toBeLessThan(2);
        expect(e.x).toBeGreaterThan(boxes[2]!.x + boxes[2]!.width - 2);
      }
      if (n === 4) {
        expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
        expect(Math.abs(boxes[2]!.y - boxes[3]!.y)).toBeLessThan(2);
        expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 2);
        await expect(page.locator('[data-empty-cell]')).toHaveCount(0);
      }
      await ctx.close();
    }
  });

  test('клітинка «Додати трансляцію» (3 вікна) відкриває панель вибору', async ({ page }) => {
    test.skip(isPhone(page), 'вільна клітинка — лише десктоп');
    // Панель показує трансляції країни й поясу вікна зі звуком (Лондон, пояс 02:00): Париж (пояс 01:00) туди не входить.
    await seedRoom(page, [L1, L2, { ...P2, slot: 2 }], 0);
    await gotoAt(page, NOW, 0, ROOM);
    await page
      .locator('[data-empty-cell]')
      .getByRole('button', { name: 'Додати трансляцію' })
      .click();
    const panel = page.locator('[data-add-stream-panel]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-add-row="src_london_3"]')).toBeVisible();
    await expect(panel.locator('[data-add-row="src_london_3"]')).not.toHaveAttribute(
      'data-in-room',
      /.*/,
    );
    // вікна, що вже є в кімнаті, не додаються вдруге
    await expect(panel.locator('[data-add-row="src_london_1"]')).toHaveAttribute(
      'data-in-room',
      /.*/,
    );
  });

  test('acc.2: на телефоні третя трансляція — пояснення «до 2 вікон», нове вікно замість прибраного', async ({
    page,
    ytStub,
  }) => {
    test.skip(!isPhone(page), 'ліміт 2 вікна — лише телефон');
    await seedRoom(page, [L1, L2], 0);
    await gotoAt(page, NOW, 0, GB);
    await ytStub.waitForPlayer();

    await addFromCountryPage(page, 'src_london_3');
    await expect(grid(page)).toHaveAttribute('data-room-layout', '2');
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: 'На телефоні в кімнаті до 2 вікон — прибери одне, щоб додати інше' }),
    ).toBeVisible();
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toEqual([
      'src_london_1',
      'src_london_2',
    ]);

    // Прибираємо вікно 2 — на його місце стає очікувана трансляція.
    await win(page, 1)
      .getByRole('button', { name: /^Прибрати вікно:/ })
      .click();
    await expect(page.getByText('На телефоні в кімнаті до 2 вікон', { exact: false })).toHaveCount(
      0,
    );
    await expect(grid(page)).toHaveAttribute('data-room-layout', '2');
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toEqual([
      'src_london_1',
      'src_london_3',
    ]);
  });

  test('додавання з країни: нове вікно стартує, головний iframe не перестворюється (FR-040/042)', async ({
    page,
    ytStub,
  }) => {
    await gotoAt(page, NOW, 0, GB);
    await ytStub.waitForPlayer();
    const mainId = await ytStub.iframeId();
    expect(mainId).not.toBeNull();

    await addFromCountryPage(page, 'src_london_2');
    await expect(grid(page)).toHaveAttribute('data-room-layout', '2');
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toEqual([
      'src_london_1',
      'src_london_2',
    ]);

    // Вікно 1 — спільний PlayerHost над слотом `main`; вікно 2 — свій плеєр, запущений після «+».
    const mainSlot = win(page, 0).locator('[data-player-slot="main"]');
    await expect(mainSlot).toBeVisible();
    const host = await box(page.locator('[data-player-host]').first());
    const slotBox = await box(mainSlot);
    expect(Math.abs(host.x - slotBox.x)).toBeLessThan(3);
    expect(Math.abs(host.y - slotBox.y)).toBeLessThan(3);
    await expect(slotOf(page, 1).locator('iframe')).toHaveCount(1);
    await expect(facade(slotOf(page, 1))).toHaveCount(0);

    expect(await ytStub.iframeId()).toBe(mainId);
    // У кімнаті два iframe, тож `sameIframe()` (рівно один у документі) тут не підходить: перевіряємо, що перший вузол живий.
    expect(
      await page.evaluate(() =>
        Boolean(
          (window as unknown as { __ytStub?: { firstIframe?: HTMLIFrameElement | null } }).__ytStub
            ?.firstIframe?.isConnected,
        ),
      ),
    ).toBe(true);
    const created = (await ytStub.counters()).created;
    expect(created).toBe(2);

    // Назад у країну (вікно зі звуком — головне, Лондон): головне відео не перезапускалось.
    await page.getByRole('link', { name: /^←|^Назад:/ }).click();
    await expect(page).toHaveURL(/\/country\/velyka-brytaniia\/?(\?.*)?$/);
    expect(await ytStub.iframeId()).toBe(mainId);
    expect(await ytStub.sameIframe()).toBe(true);
    expect((await ytStub.counters()).loadVideoById).toBe(0);
  });

  test('acc.3: звук лише в одному вікні, вибране виділене, оголошення «Звук перенесено у вікно «…»»', async ({
    page,
  }) => {
    test.skip(isPhone(page), 'четверте вікно — лише десктоп');
    await seedRoom(page, ALL, 0);
    await gotoAt(page, NOW, 0, ROOM);
    await expect(win(page, 0)).toHaveAttribute('data-sound', /.*/);
    await expect(page.locator('[data-room-window][data-sound]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Звук тут/ })).toHaveCount(1);
    await expect(win(page, 0).getByRole('button', { name: /^Звук тут/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(win(page, 3).getByRole('button', { name: /^Звук сюди/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    const outline = (loc: Locator) =>
      loc.evaluate((el) => {
        const cs = getComputedStyle(el);
        return `${cs.borderTopColor}|${cs.boxShadow}|${cs.outlineColor}|${cs.outlineStyle}`;
      });
    const plainBefore = await outline(win(page, 3));

    await win(page, 3)
      .getByRole('button', { name: /^Звук сюди/ })
      .click();
    await expect(page.locator('[data-room-window][data-sound]')).toHaveCount(1);
    await expect(win(page, 3)).toHaveAttribute('data-sound', /.*/);
    await expect(win(page, 0)).not.toHaveAttribute('data-sound', /.*/);
    await expect(page.getByRole('button', { name: /^Звук тут/ })).toHaveCount(1);
    await expect(win(page, 3).getByRole('button', { name: /^Звук тут/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(win(page, 0).getByRole('button', { name: /^Звук сюди/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Вибране вікно візуально відрізняється від решти.
    expect(await outline(win(page, 3))).not.toBe(plainBefore);
    expect(await outline(win(page, 3))).not.toBe(await outline(win(page, 1)));

    // Оголошення для зчитувача й підпис під сіткою.
    await expect(
      page.locator('[aria-live]').filter({ hasText: 'Звук перенесено у вікно «Париж»' }).first(),
    ).toBeAttached();
    await expect(page.getByText('Звук у вікні «Париж»')).toBeVisible();
    expect((await savedRoom(page)).soundSlot).toBe(3);

    // «Звук сюди» запускає відновлене вікно; у ній немає двох плеєрів із увімкненим звуком.
    await expect(slotOf(page, 3).locator('iframe')).toHaveCount(1);
  });

  test('усі вікна: відеообласть ≥ 200×200, поверх плеєра нічого (FR-040)', async ({
    page,
    ytStub,
  }) => {
    const windows = isPhone(page) ? [L1, L2] : ALL;
    await seedRoom(page, windows, 0);
    await gotoAt(page, NOW, 0, ROOM);
    await ytStub.waitForPlayer();
    await expectPlayerMinSize(page);
    await expectNothingOverPlayer(page);
    for (const w of windows) {
      const slot =
        w.slot === 0 ? win(page, 0).locator('[data-player-slot="main"]') : slotOf(page, w.slot);
      const b = await box(slot);
      expect(b.width, `вікно ${w.slot}: ширина`).toBeGreaterThanOrEqual(MIN_PLAYER_PX);
      expect(b.height, `вікно ${w.slot}: висота`).toBeGreaterThanOrEqual(MIN_PLAYER_PX);
    }
  });

  test('автозапуск лише в головному вікні; після «перезавантаження» решта — заглушки до натискання (FR-040)', async ({
    page,
    ytStub,
  }) => {
    // Додаємо вікно з інтерфейсу: воно стартує одразу.
    await gotoAt(page, NOW, 0, GB);
    await ytStub.waitForPlayer();
    await addFromCountryPage(page, 'src_london_2');
    await expect(slotOf(page, 1).locator('iframe')).toHaveCount(1);
    expect((await savedRoom(page)).windows).toHaveLength(2);

    // «Перезавантаження»: повне завантаження сторінки; localStorage лишається, сеанс — ні.
    await gotoAt(page, NOW, 0, ROOM);
    await ytStub.waitForPlayer();
    await expect(grid(page)).toHaveAttribute('data-room-layout', '2');
    expect((await ytStub.counters()).created).toBe(1);
    await expect(slotOf(page, 1).locator('iframe')).toHaveCount(0);
    const card = slotOf(page, 1).locator('[data-resume-card]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Натисни, щоб увімкнути');
    // заглушка має розмір плеєра
    const b = await box(card.first());
    expect(b.width).toBeGreaterThanOrEqual(MIN_PLAYER_PX);
    expect(b.height).toBeGreaterThanOrEqual(MIN_PLAYER_PX);

    // Натискання запускає лише це вікно.
    await card.getByRole('button').first().click();
    await expect(slotOf(page, 1).locator('iframe')).toHaveCount(1);
    await expect.poll(async () => (await ytStub.counters()).created).toBe(2);
  });

  test('acc.4: «← <країна>» веде до країни вікна зі звуком', async ({ page }) => {
    test.skip(isPhone(page), 'два вікна з різних країн; звук переносимо на десктопі');
    await seedRoom(
      page,
      [L1, P2].map((w, i) => ({ ...w, slot: i })),
      0,
    );
    await gotoAt(page, NOW, 0, ROOM);
    const back = page.getByRole('link', { name: /^←|^Назад:/ });
    await expect(back).toHaveAttribute('href', new RegExp(`${GB}$`));

    await win(page, 1)
      .getByRole('button', { name: /^Звук сюди/ })
      .click();
    await expect(back).toHaveAttribute('href', new RegExp(`${FR}$`));
    await expect(back).toHaveAccessibleName(/Франція|Франции|Франц/);
    await back.click();
    await expect(page).toHaveURL(/\/country\/frantsiia\/?(\?.*)?$/);
  });

  test('телефон: «← <країна>» веде до країни головного вікна', async ({ page }) => {
    test.skip(!isPhone(page), 'телефон');
    await seedRoom(page, [L1, { ...P2, slot: 1 }], 0);
    await gotoAt(page, NOW, 0, ROOM);
    const back = page.getByRole('link', { name: /^←|^Назад:/ });
    await expect(back).toHaveAttribute('href', new RegExp(`${GB}$`));
    await back.click();
    await expect(page).toHaveURL(/\/country\/velyka-brytaniia\/?(\?.*)?$/);
  });

  test('десктоп: кімната повна — режим «Замінити це вікно» і «Скасувати»', async ({ page }) => {
    test.skip(isPhone(page), 'режим вибору вікна — лише десктоп');
    // Панель показує трансляції країни й поясу вікна зі звуком (Лондон): вільна лишається `src_london_3`.
    const P1: SeedWindow = { slot: 2, sourceId: 'src_paris_1', eventId: 'evt_paris_2027' };
    await seedRoom(page, [L1, L2, P1, P2], 0);
    await gotoAt(page, NOW, 0, ROOM);
    const banner = page.getByRole('status').filter({ hasText: 'Кімната повна. Обери вікно для' });

    // Скасування: кімната не змінюється.
    let panel = await openAddPanel(page);
    await panel.locator('[data-add-row="src_london_3"]').getByRole('button').first().click();
    await expect(banner).toBeVisible();
    await page.getByRole('button', { name: 'Скасувати' }).click();
    await expect(banner).toHaveCount(0);
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toEqual([
      'src_london_1',
      'src_london_2',
      'src_paris_1',
      'src_paris_2',
    ]);

    // Заміна: вікно 3 отримує нову трансляцію на тому самому місці.
    panel = await openAddPanel(page);
    await panel.locator('[data-add-row="src_london_3"]').getByRole('button').first().click();
    await expect(banner).toBeVisible();
    await expect(page.getByRole('button', { name: /^Замінити це вікно/ })).toHaveCount(4);
    await win(page, 2)
      .getByRole('button', { name: /^Замінити це вікно/ })
      .click();
    await expect(banner).toHaveCount(0);
    await expect(grid(page)).toHaveAttribute('data-room-layout', '4');
    const saved = await savedRoom(page);
    expect(saved.windows.map((w) => `${w.slot}:${w.sourceId}`)).toEqual([
      '0:src_london_1',
      '1:src_london_2',
      '2:src_london_3',
      '3:src_paris_2',
    ]);
    // замінене вікно стартує одразу (людина його вибрала)
    await expect(slotOf(page, 2).locator('iframe')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Замінити це вікно/ })).toHaveCount(0);
  });

  test('останнє вікно не прибирається; «×» прибирає зайве і звук переходить на перше', async ({
    page,
  }) => {
    test.skip(isPhone(page), 'звук між вікнами переносимо на десктопі');
    await seedRoom(page, [L1, L2, L3], 1);
    await gotoAt(page, NOW, 0, ROOM);
    await expect(win(page, 1)).toHaveAttribute('data-sound', /.*/);

    await win(page, 1)
      .getByRole('button', { name: /^Прибрати вікно:/ })
      .click();
    await expect(grid(page)).toHaveAttribute('data-room-layout', '2');
    await expect(page.locator('[data-room-window][data-sound]')).toHaveCount(1);
    await expect(win(page, 0)).toHaveAttribute('data-sound', /.*/);

    await win(page, 2)
      .getByRole('button', { name: /^Прибрати вікно:/ })
      .click();
    await expect(grid(page)).toHaveAttribute('data-room-layout', '1');
    const last = win(page, 0).getByRole('button', { name: /^Прибрати вікно:/ });
    await expect(last).toHaveAttribute('aria-disabled', 'true');
    await last.click({ force: true });
    await expect(grid(page)).toHaveAttribute('data-room-layout', '1');
    expect((await savedRoom(page)).windows).toHaveLength(1);
  });

  test('доступність: кімната з вікнами без порушень axe', async ({ page, ytStub }) => {
    void ytStub;
    await seedRoom(page, isPhone(page) ? [L1, L2] : ALL.slice(0, 3), 0);
    await gotoAt(page, NOW, 0, ROOM);
    await expect(page.locator('[data-room-window]').first()).toBeVisible();
    await expectAxeClean(page);
  });
});
