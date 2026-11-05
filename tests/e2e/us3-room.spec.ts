/**
 * US3 — кімната перегляду (T094; FR-030…FR-032, FR-040…FR-042, quickstart 8).
 * Сторінка `/room/` (новий дизайн, власник 2026-11-05): розкладки 1 / 2 (+2 вільні місця) / 3 (+1) / 4 на десктопі,
 * до 2 вікон на телефоні; звук лише в одному вікні (кнопки й клавіші 1–4); автозапуск лише в головному; прибране
 * вікно — «Повернути» 6 с; кімната повна — «Що замінити?» на місці чату / у шторці; перетягування за смугу.
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

/** Країна → «+» на картці → «Відкрити кімнату» → `/room/`. */
async function addFromCountryPage(page: Page, sourceId: string) {
  const plus = streamRow(page, sourceId).getByRole('button', {
    name: /^Додати в кімнату перегляду:/,
  });
  await plus.click();
  // Сторінка країни (картки, 2026-11-05): «+» → підтвердження «Відкрити кімнату» і на телефоні, і на десктопі.
  await page.getByRole('button', { name: 'Відкрити кімнату' }).click();
  await expect(page).toHaveURL(/\/room\/?(\?.*)?$/);
}

/** Список трансляцій (на місці чату / у шторці). */
/** «Додати / Замінити трансляцію» під вікнами → список трансляцій. */
async function openPicker(page: Page) {
  await page.locator('[data-action="room-add"], [data-action="room-replace"]').first().click();
  await expect(page.locator('[data-source]').first()).toBeVisible();
}

/** «+» рядка трансляції у списку. */
function pickerPlus(page: Page, sourceId: string) {
  return page
    .locator('li')
    .filter({ has: page.locator(`[data-source="${sourceId}"]`) })
    .getByRole('button', { name: /^Додати в кімнату перегляду:|^У кімнаті/ });
}

test.describe('US3 · кімната перегляду', () => {
  test('acc.1: розкладки 1 / 2 + 2 місця / 3 + 1 місце / 4 = 2×2 (десктоп), місце — розміром із вікно', async ({
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
      const slots = page.locator('[data-room-slot]');
      await expect(slots).toHaveCount({ 1: 0, 2: 2, 3: 1, 4: 0 }[n]!);

      const boxes = [];
      for (let i = 0; i < n; i++) boxes.push(await box(win(page, i)));
      if (n === 2) {
        expect(Math.abs(boxes[0]!.y - boxes[1]!.y)).toBeLessThan(2);
        expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.width - 2);
        const s0 = await box(slots.first());
        expect(s0.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 2);
        expect(Math.abs(s0.height - boxes[0]!.height)).toBeLessThan(4);
      }
      if (n === 3) {
        const e = await box(slots.first());
        expect(Math.abs(e.y - boxes[2]!.y)).toBeLessThan(2);
        expect(e.x).toBeGreaterThan(boxes[2]!.x + boxes[2]!.width - 2);
        expect(Math.abs(e.height - boxes[2]!.height)).toBeLessThan(4);
      }
      if (n === 4) {
        expect(Math.abs(boxes[2]!.y - boxes[3]!.y)).toBeLessThan(2);
        expect(boxes[2]!.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 2);
      }
      // Згори нічого: немає посилання «← країна», заголовок кімнати — під вікнами.
      await expect(page.getByRole('link', { name: /^←|^Назад:/ })).toHaveCount(0);
      const title = await box(page.getByRole('heading', { level: 1, name: 'Кімната перегляду' }));
      expect(title.y).toBeGreaterThan(boxes[0]!.y + boxes[0]!.height - 2);
      await ctx.close();
    }
  });

  test('вільне місце відкриває список трансляцій; ✓ — те, що вже в кімнаті', async ({ page }) => {
    test.skip(isPhone(page), 'вільні місця при 3 вікнах — десктоп');
    await seedRoom(page, [L1, L2, { ...P2, slot: 2 }], 0);
    await gotoAt(page, NOW, 0, ROOM);
    await page.locator('[data-room-slot]').first().click();
    await expect(page.locator('[data-source="src_london_3"]')).toBeVisible();
    await expect(pickerPlus(page, 'src_london_2')).toHaveAttribute('aria-pressed', 'true');
    await pickerPlus(page, 'src_london_3').click();
    await expect(grid(page)).toHaveAttribute('data-room-layout', '4');
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toContain('src_london_3');
  });

  test('acc.2: на телефоні третя трансляція — «Що замінити?» у шторці, нове вікно на місці вибраного', async ({
    page,
    ytStub,
  }) => {
    test.skip(!isPhone(page), 'ліміт 2 вікна — лише телефон');
    await seedRoom(page, [L1, L2], 0);
    await gotoAt(page, NOW, 0, GB);
    await ytStub.waitForPlayer();

    await addFromCountryPage(page, 'src_london_3');
    await expect(grid(page)).toHaveAttribute('data-room-layout', '2');
    const replace = page.locator('[data-room-replace]');
    await expect(replace).toBeVisible();
    await expect(replace).toContainText('На телефоні до 2 вікон');
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toEqual([
      'src_london_1',
      'src_london_2',
    ]);

    await replace.locator('[data-replace-slot="1"]').click();
    await expect(replace).toHaveCount(0);
    await expect(grid(page)).toHaveAttribute('data-room-layout', '2');
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toEqual([
      'src_london_1',
      'src_london_3',
    ]);
    // Підсумок — у смузі заміненого вікна, з «Повернути».
    await expect(win(page, 1).getByRole('button', { name: 'Повернути' })).toBeVisible();
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
    expect((await ytStub.counters()).created).toBe(2);
  });

  test('acc.3: звук лише в одному вікні — кнопкою й клавішею; підпис «звук — у вікні «…»»', async ({
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

    await win(page, 3)
      .getByRole('button', { name: /^Звук сюди/ })
      .click();
    await expect(page.locator('[data-room-window][data-sound]')).toHaveCount(1);
    await expect(win(page, 3)).toHaveAttribute('data-sound', /.*/);
    await expect(win(page, 3).getByRole('button', { name: /^Звук тут/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      page.locator('[aria-live]').filter({ hasText: 'Звук перенесено у вікно «Париж»' }).first(),
    ).toBeAttached();
    await expect(page.getByText(/звук — у вікні «Париж/)).toBeVisible();
    expect((await savedRoom(page)).soundSlot).toBe(3);
    await expect(slotOf(page, 3).locator('iframe')).toHaveCount(1);

    // Клавіша 2 — звук у вікно на другому місці.
    await page.locator('h1').click();
    await page.keyboard.press('2');
    await expect(win(page, 1)).toHaveAttribute('data-sound', /.*/);
    expect((await savedRoom(page)).soundSlot).toBe(1);
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

  test('перетягування за смугу міняє вікна місцями без перезапуску плеєрів', async ({
    page,
    ytStub,
  }) => {
    test.skip(isPhone(page), 'перетягування — десктоп');
    await seedRoom(page, [L1, L2], 0);
    await gotoAt(page, NOW, 0, ROOM);
    await ytStub.waitForPlayer();
    const created = (await ytStub.counters()).created;
    const from = await box(win(page, 0).locator('h2'));
    const to = await box(win(page, 1));
    await page.mouse.move(from.x + 30, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 60, from.y + 20, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
    await expect(win(page, 1).getByText('Відпусти — поміняти місцями')).toBeVisible();
    await page.mouse.up();
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toEqual([
      'src_london_2',
      'src_london_1',
    ]);
    // DOM не переставляється (CSS order) — плеєри ті самі.
    const order0 = await win(page, 0).evaluate((el) => getComputedStyle(el).order);
    expect(order0).toBe('1');
    expect((await ytStub.counters()).created).toBe(created);
  });

  test('десктоп: кімната повна — «Що замінити?» на місці чату, «Скасувати», заміна з «Повернути»', async ({
    page,
  }) => {
    test.skip(isPhone(page), 'схема 2×2 — десктоп');
    const P1: SeedWindow = { slot: 2, sourceId: 'src_paris_1', eventId: 'evt_paris_2027' };
    await seedRoom(page, [L1, L2, P1, P2], 0);
    await gotoAt(page, NOW, 0, ROOM);
    const replace = page.locator('[data-room-replace]');

    // Скасування: кімната не змінюється.
    await openPicker(page);
    await pickerPlus(page, 'src_london_3').click();
    await expect(replace).toBeVisible();
    await expect(replace.locator('[data-replace-slot]')).toHaveCount(4);
    await expect(page.getByRole('button', { name: /^Замінити це вікно/ })).toHaveCount(0);
    await replace.getByRole('button', { name: 'Скасувати' }).click();
    await expect(replace).toHaveCount(0);
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toEqual([
      'src_london_1',
      'src_london_2',
      'src_paris_1',
      'src_paris_2',
    ]);

    // Заміна: вікно 3 отримує нову трансляцію на тому самому місці; у смузі — «Замінено … · Повернути».
    await openPicker(page);
    await pickerPlus(page, 'src_london_3').click();
    await replace.locator('[data-replace-slot="2"]').click();
    await expect(replace).toHaveCount(0);
    const saved = await savedRoom(page);
    expect(saved.windows.map((w) => `${w.slot}:${w.sourceId}`)).toEqual([
      '0:src_london_1',
      '1:src_london_2',
      '2:src_london_3',
      '3:src_paris_2',
    ]);
    await expect(slotOf(page, 2).locator('iframe')).toHaveCount(1);
    await expect(win(page, 2)).toContainText('Замінено:');
    await win(page, 2).getByRole('button', { name: 'Повернути' }).click();
    expect((await savedRoom(page)).windows[2]!.sourceId).toBe('src_paris_1');
  });

  test('прибрати вікно: «Повернути» на його місці 6 с; останнє не прибирається', async ({
    page,
  }) => {
    test.skip(isPhone(page), 'плитка «Повернути» — десктоп');
    await seedRoom(page, [L1, L2, L3], 1);
    await gotoAt(page, NOW, 0, ROOM);
    await expect(win(page, 1)).toHaveAttribute('data-sound', /.*/);

    await win(page, 1)
      .getByRole('button', { name: /^Прибрати вікно:/ })
      .click();
    const undo = page.locator('[data-room-undo]');
    await expect(undo).toBeVisible();
    await expect(page.locator('[data-room-window][data-sound]')).toHaveCount(1);
    await expect(win(page, 0)).toHaveAttribute('data-sound', /.*/);
    await undo.getByRole('button', { name: 'Повернути' }).click();
    await expect(page.locator('[data-room-window]')).toHaveCount(3);
    expect((await savedRoom(page)).windows.map((w) => w.sourceId)).toEqual([
      'src_london_1',
      'src_london_2',
      'src_london_3',
    ]);

    await win(page, 1)
      .getByRole('button', { name: /^Прибрати вікно:/ })
      .click();
    await win(page, 2)
      .getByRole('button', { name: /^Прибрати вікно:/ })
      .click();
    await expect(grid(page)).toHaveAttribute('data-room-layout', '1');
    const last = win(page, 0).getByRole('button', { name: /^Прибрати вікно:/ });
    await expect(last).toHaveAttribute('aria-disabled', 'true');
    await last.click({ force: true });
    expect((await savedRoom(page)).windows).toHaveLength(1);
    // Через 6 с плитка зникає, лишається одне вікно на всю ширину.
    await expect(undo).toHaveCount(0, { timeout: 9_000 });
  });

  test('телефон: розгорнутий чат згортає вікно без звуку', async ({ page }) => {
    test.skip(!isPhone(page), 'телефон');
    await seedRoom(page, [L1, L2], 0);
    await gotoAt(page, NOW, 0, ROOM);
    await page
      .getByRole('button', { name: /Розгорнути чат/ })
      .first()
      .click();
    await expect(win(page, 1)).toHaveAttribute('data-folded', '');
    await expect(win(page, 0)).not.toHaveAttribute('data-folded', /.*/);
  });

  test('доступність: кімната з вікнами без порушень axe', async ({ page, ytStub }) => {
    void ytStub;
    await seedRoom(page, isPhone(page) ? [L1, L2] : ALL.slice(0, 3), 0);
    await gotoAt(page, NOW, 0, ROOM);
    await expect(page.locator('[data-room-window]').first()).toBeVisible();
    await expectAxeClean(page);
  });
});
