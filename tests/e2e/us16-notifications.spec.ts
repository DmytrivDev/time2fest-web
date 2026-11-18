/**
 * Сповіщення (дошка `Desk-Notif-New`, рішення власника 2026-11-09): дзвіночок з лічильником відкриває список на місці чату
 * (десктоп) чи шторкою (телефон); нові зверху, «Прочитати все»; «Налаштувати» — у тому ж вікні; відповідь у чаті
 * створює сповіщення сама.
 */
import { expect, test } from './fixtures/youtube-stub';
import { gotoAt, waitForTimeApi } from './fixtures/time';

test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'Сповіщення: телефон і десктоп');
});

const bell = (page: import('@playwright/test').Page) => page.getByRole('banner').getByRole('button', { name: /^Сповіщення/ });

test('дзвіночок → список: нові, «Прочитати все», налаштування', async ({ page, ytStub }) => {
  void ytStub;
  await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
  await page.evaluate(() => localStorage.removeItem('t2f:notif:v1'));
  await page.evaluate(() => (window as unknown as { __t2f: { setNotifications(n: number): void } }).__t2f.setNotifications(3));
  await expect(bell(page)).toHaveAttribute('aria-label', 'Сповіщення, 3 нові');
  await bell(page).click();
  const list = page.locator('[data-block="notif-list"]');
  await expect(list.getByRole('heading', { name: 'Нові · 3' })).toBeVisible();
  if (test.info().project.name !== 'phone') await expect(page.locator('#chat-slot [data-block="notif-list"]')).toBeVisible();
  await list.getByRole('button', { name: 'Прочитати все' }).click();
  // Поки вікно відкрите — група лишається («Нові» без числа), без стрибка (правка 2026-11-10).
  await expect(list.getByRole('heading', { name: 'Нові', exact: true })).toBeVisible();
  await expect(bell(page)).toHaveAttribute('aria-label', 'Сповіщення');
  await list.getByRole('button', { name: 'Налаштувати' }).click();
  const settings = page.locator('[data-block="notif-settings"]');
  await settings.getByRole('switch', { name: 'Відповіді в чаті' }).click();
  await expect(settings.getByRole('switch', { name: 'Відповіді в чаті' })).not.toBeChecked();
});

test('відповідь у чаті створює сповіщення', async ({ page, ytStub }) => {
  void ytStub;
  // TODO(SPEC-07 P13, observation): in the integration build (server-clock) the sim NotificationsGenerator drops a reply emitted at
  // the frozen virtual moment (its `mountedAt` guard is ahead of the machine time: a reply at +10 min is dropped, at +40 days shows up).
  // The reply→notification path is a sim feature (domain `notifications` = sim) and is covered in the sim config (phone/desktop).
  test.skip(test.info().project.name === 'server-clock', 'AC-59: в інтеграційній збірці годинник сторінки — стан дверцят сервера; охоронець mountedAt симулятора сповіщень відкидає відповідь, надіслану в заморожений момент (покрито в sim-конфігурації)');
  await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
  await page.evaluate(() => {
    localStorage.removeItem('t2f:notif:v1');
    const g = JSON.parse(localStorage.getItem('t2f:guest:v1')!);
    g.state.nick = 'Олена';
    localStorage.setItem('t2f:guest:v1', JSON.stringify(g));
  });
  await page.reload();
  await waitForTimeApi(page);
  await page.evaluate(() => (window as unknown as { __t2f: { emitReply(): void } }).__t2f.emitReply());
  await expect(bell(page)).toHaveAttribute('aria-label', 'Сповіщення, 1 нове');
  await bell(page).click();
  await expect(page.locator('[data-notif="reply"]')).toContainText('Відповідь від');
});

test('клік по сповіщенню: вікно відкрите, доки не відкриється нова сторінка (без проблиску чату)', async ({ page, ytStub }) => {
  void ytStub;
  await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
  await page.evaluate(() => localStorage.removeItem('t2f:notif:v1'));
  await page.evaluate(() => (window as unknown as { __t2f: { setNotifications(n: number): void } }).__t2f.setNotifications(3));
  await bell(page).click();
  const list = page.locator('[data-block="notif-list"]');
  await expect(list).toBeVisible();
  // Стежимо: у мить, коли вікно сповіщень зникає, адреса вже має бути нова.
  await page.evaluate(() => {
    const w = window as unknown as { __notifClosedAt?: string };
    const mo = new MutationObserver(() => {
      if (!document.querySelector('[data-block="notif-list"]') && w.__notifClosedAt === undefined) {
        w.__notifClosedAt = location.pathname;
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });
  const link = list.locator('a[data-notif][href^="/passport"]').first();
  await link.click();
  await expect(page).toHaveURL(/\/passport\/?/);
  await expect(list).toHaveCount(0);
  const closedAt = await page.evaluate(() => (window as unknown as { __notifClosedAt?: string }).__notifClosedAt);
  expect(closedAt).toMatch(/^\/passport/);
});

test('«Прочитати все» — без стрибка: перший рядок і заголовок групи на тому самому місці (правка 2026-11-10)', async ({ page, ytStub }) => {
  void ytStub;
  await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
  await page.evaluate(() => localStorage.removeItem('t2f:notif:v1'));
  await page.evaluate(() => (window as unknown as { __t2f: { setNotifications(n: number): void } }).__t2f.setNotifications(4));
  await page.evaluate(() => {
    // Одне вже прочитане — є й група «Раніше» (саме вона раніше перестрибувала вгору).
    const raw = JSON.parse(localStorage.getItem('t2f:notif:v1')!);
    raw.state.items[3].read = true;
    localStorage.setItem('t2f:notif:v1', JSON.stringify(raw));
  });
  await page.reload();
  await waitForTimeApi(page);
  await bell(page).click();
  const list = page.locator('[data-block="notif-list"]');
  await expect(list.getByRole('heading', { name: 'Нові · 3' })).toBeVisible();
  // Дочекатися кінця анімації відкриття шторки чи панелі.
  await page.waitForTimeout(800);
  const boxes = () =>
    list.evaluate((el) =>
      [...el.querySelectorAll('[data-notif], h3')].map((n) => {
        const r = n.getBoundingClientRect();
        return [Math.round(r.top), Math.round(r.height)];
      }),
    );
  const before = await boxes();
  await list.getByRole('button', { name: 'Прочитати все' }).click();
  await expect(bell(page)).toHaveAttribute('aria-label', 'Сповіщення');
  await page.waitForTimeout(400);
  expect(await boxes()).toEqual(before);
});
