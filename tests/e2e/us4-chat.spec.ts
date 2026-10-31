/**
 * US4 — «Чат свята» на імітаторі (quickstart 9; T101, FR-050…056).
 * Нік і прапор на першому власному повідомленні (2–20 символів, прапор за розташуванням), пауза з
 * «Нові повідомлення N ↓», повільний режим, 200 символів з лічильником від 180 і без посилань, «чат недоступний»,
 * панель автора зі шляхом, сховано чат (телефон: згорнути вікно; десктоп: вікно з полем тимчасово відкриває колонку), axe.
 *
 * ПОКИ НЕ ЗАПУСКАЄТЬСЯ: рішення власника 2026-10-27 — e2e пишемо, але не проганяємо; перевірка — typecheck, lint, юніти, build.
 * Часовий пояс браузера — Київ; мова — uk-UA (прапор за розташуванням — UA).
 */
import type { Page } from '@playwright/test';
import { runAxe } from './fixtures/axe';
import { advance, gotoAt, setChatAvailable, waitForTimeApi } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name === 'tv' || testInfo.project.name === 'prod',
    'US4: телефон і десктоп',
  );
});
test.describe.configure({ timeout: 90_000 });

/** Кілька хвилин після півночі Лондона: повільний режим сценарію (00:00–00:10 UTC) уже скінчився. */
const QUIET = '2027-01-01T02:20:00+02:00';
/** П’ята хвилина після півночі: повільний режим «Світу» діє (15 с). */
const SLOW = '2027-01-01T02:05:00+02:00';
/** До півночі Лондона: ефір з трансляцією (о 02:20 ефір — Азори без трансляції, плеєра немає). */
const LIVE = '2027-01-01T01:50:00+02:00';

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;
const field = (page: Page) => page.getByRole('textbox', { name: /Повідомлення в чат/ });
const send = (page: Page) => page.getByRole('button', { name: /^Надіслати/ });

async function openChat(page: Page) {
  if (isPhone(page)) await page.getByRole('button', { name: /^Розгорнути чат/ }).click();
  await expect(page.getByRole('log').first()).toBeVisible();
}

async function startChat(page: Page, iso = QUIET, speed = 1) {
  await gotoAt(page, iso, speed);
  await waitForTimeApi(page);
  await page.evaluate(() => localStorage.removeItem('t2f:guest:v1'));
  await page.reload();
  await waitForTimeApi(page);
  await openChat(page);
}

async function expectAxeClean(page: Page) {
  const violations = await runAxe(page);
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

async function setNick(page: Page, nick: string) {
  await page.evaluate((n) => {
    const key = 't2f:guest:v1';
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = { ...parsed.state, nick: n, flagCode: 'UA' };
    localStorage.setItem(key, JSON.stringify(parsed));
  }, nick);
  await page.reload();
  await waitForTimeApi(page);
  await openChat(page);
}

test.describe('US4 · чат свята', () => {
  test('перше власне повідомлення відкриває нік і прапор; нік 2–20 символів; прапор за розташуванням', async ({
    page,
    ytStub,
  }) => {
    await startChat(page, LIVE);
    await ytStub.waitForPlayer();
    await field(page).fill('З Новим роком із Києва!');
    await send(page).click();

    const dialog = page.getByRole('dialog', { name: /Як тебе підписати в чаті/ });
    await expect(dialog).toBeVisible();
    // На телефоні вікно ніка модальне: поле під ним приховане від дерева доступності, але текст лишається.
    await expect(
      page.getByRole('textbox', { name: /Повідомлення в чат/, includeHidden: true }),
    ).toHaveValue('З Новим роком із Києва!');
    await expect(dialog.getByText('Україна')).toBeVisible(); // прапор за розташуванням (uk-UA / Київ)
    // Одна коралова кнопка на екрані: «Готово» (звук стає нейтральним).
    expect(await page.locator('[data-variant="coral"]:visible').count()).toBe(1);
    await expectAxeClean(page);

    const nick = dialog.getByRole('textbox', { name: /Нік/ });
    await nick.fill('М');
    await dialog.getByRole('button', { name: 'Готово' }).click();
    await expect(dialog).toBeVisible(); // менше 2 символів не проходить
    await expect(dialog.getByText('Мінімум 2 символи')).toBeVisible();

    await nick.fill('а'.repeat(25));
    await expect(dialog.getByText('Максимум 20 символів')).toBeVisible(); // більше 20 — помилка, не обрізання
    await expect(dialog.getByText('25/20')).toBeVisible();

    await nick.fill('Мирон');
    await dialog.getByRole('button', { name: 'Готово' }).click();
    await expect(dialog).toBeHidden();
    const log = page.getByRole('log').first();
    await expect(log.getByText('З Новим роком із Києва!')).toBeVisible();
    await expect(log.locator('[data-own="true"]')).toHaveCount(1);
    await expect(field(page)).toHaveValue('');
  });

  test('пауза: прокрутка вгору зупиняє стрічку, «Нові повідомлення N ↓» повертає до кінця', async ({
    page,
  }) => {
    await startChat(page, QUIET, 10);
    await setNick(page, 'Мирон');
    const log = page.getByRole('log').first();
    await log.evaluate((el) => (el.scrollTop = 0));
    // Примітка про паузу — лише для зчитувача (на макеті видно тільки капсулу «Нові повідомлення N ↓»).
    await expect(page.locator('[data-row="paused"]')).toHaveText('Стрічку зупинено — читай у своєму темпі');
    await advance(page, 5 * 60_000);
    const pill = page.getByRole('button', { name: /^Нові повідомлення \d+/ });
    await expect(pill).toBeVisible();
    const count = async () => Number(/(\d+)/.exec((await pill.textContent()) ?? '')?.[1] ?? 0);
    const before = await count();
    await pill.click();
    // Клік веде до першого непобаченого повідомлення (не до кінця): побачені рахуються прочитаними, капсула
    // або зникає (усі в полі зору), або лічильник меншає.
    await expect(async () => {
      if (await pill.isVisible()) {
        expect(await count()).toBeLessThan(before);
      }
    }).toPass();
    await expectAxeClean(page);
  });

  test('«Пауза чату» — кнопка-перемикач; стрічка накопичується', async ({ page }) => {
    await startChat(page, QUIET, 10);
    const pause = page.getByRole('button', { name: 'Пауза чату' });
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    await advance(page, 3 * 60_000);
    await expect(page.getByRole('button', { name: /^Нові повідомлення \d+/ })).toBeVisible();
  });

  test('повільний режим: після відправлення «Надіслати — зачекай N с»', async ({ page }) => {
    await startChat(page, SLOW);
    await setNick(page, 'Мирон');
    await field(page).fill('Перше');
    await send(page).click();
    await expect(page.getByRole('log').first().getByText('Перше', { exact: true })).toBeVisible();
    await field(page).fill('Друге');
    await expect(page.getByRole('button', { name: /Надіслати — зачекай \d+ с/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByText(/можна писати через \d+ с/)).toBeVisible();
    await advance(page, 16_000);
    await expect(send(page)).not.toHaveAttribute('aria-disabled', 'true');
  });

  test('200 символів: лічильник від 180, «Досить» на межі; посилання не надсилаються, текст лишається', async ({
    page,
  }) => {
    await startChat(page);
    await setNick(page, 'Мирон');
    await field(page).fill('а'.repeat(179));
    await expect(page.getByText('179/200')).toHaveCount(0);
    await field(page).fill('а'.repeat(184));
    await expect(page.getByText('184/200')).toBeVisible();
    await field(page).fill('а'.repeat(205));
    await expect(field(page)).toHaveValue('а'.repeat(200));
    await expect(page.getByText('200/200')).toBeVisible();
    await expect(page.getByText('Досить')).toBeVisible();

    await field(page).fill('дивись www.example.com');
    await send(page).click();
    await expect(
      page.getByText(/Посилання в чаті не надсилаються — прибери його, текст лишиться/),
    ).toBeVisible();
    await expect(field(page)).toHaveValue('дивись www.example.com');
    await expectAxeClean(page);
  });

  test('емодзі в полі: вибір над рядком поля, вставка, відправлення; відповідь і реакція', async ({ page }) => {
    await startChat(page);
    await setNick(page, 'Мирон');
    await field(page).fill('Ура ');
    await page.getByRole('button', { name: 'Емодзі' }).click();
    const picker = page.getByRole('group', { name: 'Вибір емодзі' });
    await expect(picker).toBeVisible();
    // Над рядком поля: нижній край вибору вище за верх поля й «Надіслати», від лівого краю поля до правого краю кнопки.
    const [pb, fb, sb] = await Promise.all([picker.boundingBox(), field(page).boundingBox(), send(page).boundingBox()]);
    expect(pb!.y + pb!.height).toBeLessThanOrEqual(fb!.y);
    expect(pb!.x).toBeLessThanOrEqual(fb!.x);
    expect(pb!.x + pb!.width).toBeGreaterThanOrEqual(sb!.x + sb!.width - 1);
    await picker.getByRole('button', { name: 'Вставити Хлопавка' }).click();
    await expect(field(page)).toHaveValue('Ура 🎉');
    await expect(field(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await send(page).click();
    const log = page.getByRole('log').first();
    await expect(log.locator('[data-own="true"]')).toHaveCount(1);

    await log
      .getByRole('button', { name: /^Дії з повідомленням/ })
      .first()
      .click();
    // Меню «⋯» (однакове на десктопі й телефоні) живе в шарі чату: сім швидких емодзі й «ще» (варіант А, a34a784),
    // без підписів, `aria-label` на клітинці.
    const actions = page.getByRole('menu', { name: 'Дії з повідомленням' });
    await expect(actions).toBeVisible();
    await expect(actions.getByRole('menuitemcheckbox')).toHaveCount(7);
    await actions.getByRole('menuitemcheckbox', { name: 'Реакція Хлопавка' }).click();
    await expect(actions).toBeHidden();
    await expect(
      log.getByRole('button', { name: /^Реакція Хлопавка: \d+, твоя\. Прибрати/ }).first(),
    ).toBeVisible();
  });

  test('чат недоступний: повідомлення замість стрічки, відео й сторінка працюють', async ({
    page,
    ytStub,
  }) => {
    await startChat(page, LIVE);
    await ytStub.waitForPlayer();
    await setChatAvailable(page, false);
    await expect(page.getByText('Чат тимчасово недоступний, повернемося за хвилину')).toBeVisible();
    await expect(field(page)).toHaveCount(0);
    await expect(page.locator('[data-player-host] iframe')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Чат тимчасово недоступний, повернемося за хвилину' })).toBeVisible();
    await expect(page.getByText('Трансляція й «Події» працюють як звичайно.')).toBeVisible();
    if (isPhone(page)) {
      // Телефон: «Згорнути чат» згортає вікно, у згорнутому — «0 нових».
      await page.getByRole('button', { name: 'Згорнути чат' }).click();
      await expect(page.locator('[data-dock-pill]')).toHaveText('0 нових');
    } else {
      // Десктоп: «Сховати чат» ховає колонку, пілюля «Показати чат» без лічильника.
      await page.getByRole('button', { name: 'Сховати чат' }).click();
      await expect(page.locator('[data-chat-hidden-button]')).toBeVisible();
      await expect(page.locator('.t2f-show-chat-count')).toHaveCount(0);
    }
    await setChatAvailable(page, true);
    await expect(page.getByText('Чат тимчасово недоступний, повернемося за хвилину')).toBeHidden();
  });

  test('дотик до ніка з пасом → панель автора з «Шлях <нік>»: зустрінуті жовті, заплановані порожні, підказки', async ({
    page,
  }) => {
    // Чекаємо, поки сценарій дійде до Karim (до 60 с), а потім axe: довше за типовий таймаут файлу.
    test.setTimeout(180_000);
    await startChat(page, '2027-01-01T02:03:00+02:00', 5);
    const log = page.getByRole('log').first();
    // Автори з пасом у сценарії: Karim має шлях (Окленд → Дубай → Каїр).
    await expect
      .poll(async () => await log.getByRole('button', { name: /^Karim, / }).count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    await log
      .getByRole('button', { name: /^Karim, / })
      .first()
      .click();

    const panel = page.getByRole('dialog', { name: 'Автор повідомлення' });
    await expect(panel.getByRole('heading', { name: 'Шлях Karim' })).toBeVisible();
    await expect(panel.locator('[data-point="met"]').first()).toBeVisible();
    await expect(panel.locator('[data-point="planned"]').first()).toBeVisible();
    await panel.locator('[data-point="met"]').first().hover();
    await expect(page.getByText(/північ о \d\d:\d\d за вашим часом/).first()).toBeVisible();
    await expect(panel.getByText('Хочеш, щоб інші бачили твій шлях? Оформи Новорічний пас.')).toBeVisible();
    // Картка «Переглянути шлях»: зустрінуті місця, далі заплановані (без часу), прапори з’єднані пунктиром.
    await panel.getByRole('button', { name: /Переглянути шлях/ }).click();
    await expect(panel.locator('[data-row="rows"] li').first()).toContainText('Окленд');
    await expect(panel.locator('[data-row="rows"] li[data-planned]').first()).toContainText('У графіку');
    expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await expectAxeClean(page);

    // Підказка точки — верхній шар: перший Esc закриває її, наступний — панель.
    await page.keyboard.press('Escape');
    if (await panel.isVisible()) await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });

  test('автор без пасу: картки шляху немає, мапа затемнена з плашкою', async ({ page }) => {
    // Чекаємо, поки сценарій дійде до Karim (до 60 с), а потім axe: довше за типовий таймаут файлу.
    test.setTimeout(180_000);
    await startChat(page, '2027-01-01T02:03:00+02:00', 5);
    const log = page.getByRole('log').first();
    await expect
      .poll(async () => await log.getByRole('button', { name: /^Тарас, / }).count(), {
        timeout: 60_000,
      })
      .toBeGreaterThan(0);
    await log
      .getByRole('button', { name: /^Тарас, / })
      .first()
      .click();
    const panel = page.getByRole('dialog', { name: 'Автор повідомлення' });
    await expect(panel.getByText('Тарас').first()).toBeVisible();
    await expect(panel.getByRole('button', { name: /Переглянути шлях/ })).toHaveCount(0);
    await expect(panel.getByText(/поки не може показати шлях: це можливість Новорічного пасу/)).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Поскаржитись' })).toBeVisible();
  });

  test('чат сховано: телефон — згорнуте вікно з «N нових»; десктоп — колонки немає, «Показати чат» повертає її', async ({
    page,
  }) => {
    await startChat(page, QUIET, 10);
    if (isPhone(page)) {
      await page.getByRole('button', { name: 'Згорнути чат', exact: true }).click();
      await expect(page.getByRole('log')).toHaveCount(0);
      await advance(page, 5 * 60_000);
      const open = page.getByRole('button', { name: /^Розгорнути чат/ });
      await expect(open).toBeVisible();
      await expect(open).toContainText(/\d+\+? нових/);
      await open.click();
      await expect(field(page)).toBeVisible();
      return;
    }

    await page.getByRole('button', { name: 'Сховати чат' }).click();
    await expect(page.locator('#chat')).toBeHidden();
    const show = page.getByRole('button', { name: /^Показати чат/ });
    await expect(show).toBeVisible();
    await show.click();
    await expect(page.locator('#chat')).toBeVisible();
    await expect(field(page)).toBeVisible();
    // Вікно з полем введення на сховану колонку відкриває її тимчасово (`data-chat-forced`): покрито юнітом OverlayManager.
  });

  test('axe: головна з відкритим чатом', async ({ page }) => {
    await startChat(page);
    await expectAxeClean(page);
  });
});
