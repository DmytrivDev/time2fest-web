/**
 * US8 — машина часу (T082, contracts/time-machine.md): параметри `t`/`speed`, збереження в `sessionStorage`,
 * прихована панель (`?panel=1`, `Ctrl+Alt+T`, `Esc`) і її розташування поза плеєром.
 * Тестова збірка (`pnpm dev:test`).
 */
import type { Page } from '@playwright/test';
import { expectNothingOverPlayer } from './fixtures/geometry';
import { DEFAULT_START, getTime, gotoAt, nowMs, waitForTimeApi } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'prod' || testInfo.project.name === 'tv', 'US8: телефон і десктоп, тестова збірка');
});
test.describe.configure({ timeout: 90_000 });

const MIDNIGHT_LONDON = Date.parse('2027-01-01T00:00:00Z');
const panel = (page: Page) => page.getByRole('dialog', { name: 'Машина часу' });

test.describe('US8 · параметри адреси', () => {
  test('?t=01:59:30&speed=10 — північ Лондона через ≈3 с, штамп ще через ≈1,5 с', async ({ page }) => {
    await gotoAt(page, '2027-01-01T01:59:30+02:00', 10);
    expect((await getTime(page)).speed).toBe(10);
    expect(await nowMs(page)).toBeGreaterThanOrEqual(Date.parse('2027-01-01T01:59:30+02:00'));

    // Холодний старт dev-сервера міг «з’їсти» частину секунд: перезапускаємо відлік з тієї ж точки
    // й міряємо реальний час у самій сторінці.
    const [toMidnight, toStamp] = await page.evaluate(async (midnight) => {
      const api = (window as unknown as { __t2f: { timeMachine: { set(o: { at: string }): void; get(): { at: string } } } }).__t2f.timeMachine;
      const virtual = () => Date.parse(api.get().at);
      api.set({ at: '2027-01-01T01:59:30+02:00' });
      const t0 = performance.now();
      const until = async (target: number) => {
        while (virtual() < target) await new Promise((r) => setTimeout(r, 10));
        return performance.now() - t0;
      };
      return [await until(midnight), await until(midnight + 15_000)];
    }, MIDNIGHT_LONDON);
    // 30 віртуальних секунд за ×10 — ≈3 с; штамп (+15 с) — ще ≈1,5 с.
    expect(toMidnight).toBeGreaterThan(2_600);
    expect(toMidnight).toBeLessThan(3_600);
    expect(toStamp - toMidnight).toBeGreaterThan(1_200);
    expect(toStamp - toMidnight).toBeLessThan(2_000);
  });

  test('speed=0 — кадр заморожено: «північ + 10 с» без штампа', async ({ page }) => {
    await gotoAt(page, '2027-01-01T02:00:10+02:00', 0);
    const a = await nowMs(page);
    await page.waitForTimeout(1_200);
    const b = await nowMs(page);
    expect(b - a).toBeLessThan(50);
    expect(Math.abs(a - (MIDNIGHT_LONDON + 10_000))).toBeLessThan(100);
    expect((await getTime(page)).speed).toBe(0);
    await expect(page.locator('[data-stamp]')).toHaveCount(0);
  });

  test('непарсований t — стартовий момент і попередження', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning') warnings.push(m.text());
    });
    await page.goto('/?t=ось-не-дата&panel=1');
    await waitForTimeApi(page);
    const at = await nowMs(page);
    const def = Date.parse(DEFAULT_START);
    expect(at).toBeGreaterThanOrEqual(def);
    expect(at - def).toBeLessThan(30_000);
    expect(warnings.some((w) => w.includes('Невірний t'))).toBe(true);
    await expect(panel(page).getByTestId('tm-warning')).toHaveText('Невірний t');
  });

  test('без параметрів — старт о 01:38 за Києвом, далі звичайний хід', async ({ page }) => {
    await page.goto('/');
    await waitForTimeApi(page);
    const at = await nowMs(page);
    expect(at - Date.parse(DEFAULT_START)).toBeGreaterThanOrEqual(0);
    expect(at - Date.parse(DEFAULT_START)).toBeLessThan(30_000);
    expect((await getTime(page)).speed).toBe(1);
  });

  test('speed=1000 → 1 (поза діапазоном 0…600)', async ({ page }) => {
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 1000);
    expect((await getTime(page)).speed).toBe(1);
    const a = await nowMs(page);
    await page.waitForTimeout(1_000);
    const dv = (await nowMs(page)) - a;
    expect(dv).toBeGreaterThan(800);
    expect(dv).toBeLessThan(2_500);
  });

  test('перехід на іншу сторінку й оновлення не повертають час на старт (sessionStorage)', async ({ page }) => {
    await gotoAt(page, '2027-01-01T02:10:00+02:00', 0);
    const target = Date.parse('2027-01-01T02:10:00+02:00');
    expect(Math.abs((await nowMs(page)) - target)).toBeLessThan(100);

    await page.reload();
    await waitForTimeApi(page);
    expect(Math.abs((await nowMs(page)) - target)).toBeLessThan(100);

    // Нова навігація без параметрів: час із сеансу, а не стартовий.
    await page.goto('/');
    await waitForTimeApi(page);
    expect(Math.abs((await nowMs(page)) - target)).toBeLessThan(100);
    const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('t2f:session:timeMachine') ?? 'null'));
    expect(saved).toMatchObject({ speed: 0 });

    // Явний t в адресі перемагає збережений.
    await gotoAt(page, '2027-01-01T01:59:30+02:00', 0);
    expect(Math.abs((await nowMs(page)) - Date.parse('2027-01-01T01:59:30+02:00'))).toBeLessThan(100);
  });
});

test.describe('US8 · прихована панель', () => {
  test('за замовчуванням прихована; Ctrl+Alt+T відкриває, Esc закриває', async ({ page }) => {
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0);
    await expect(panel(page)).toHaveCount(0);
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+Alt+t');
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    // Те саме сполучення перемикає туди й назад.
    await page.keyboard.press('Control+Alt+t');
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Control+Alt+t');
    await expect(panel(page)).toHaveCount(0);
  });

  test('?panel=1 відкриває одразу; показує час, швидкість і джерело', async ({ page }) => {
    await gotoAt(page, '2027-01-01T02:00:10+02:00', 0, '/?panel=1');
    const p = panel(page);
    await expect(p).toBeVisible();
    await expect(p).toHaveAttribute('aria-modal', 'false');
    await expect(p.getByTestId('tm-utc')).toHaveText('2027-01-01 00:00:10');
    await expect(p.getByTestId('tm-kyiv')).toContainText('02:00:10');
    await expect(p.getByTestId('tm-speed')).toHaveText('×0');
    await expect(p.getByTestId('tm-source')).toHaveText('machine');
  });

  test('швидкість, стрибки й «Застосувати» керують часом', async ({ page }) => {
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0, '/?panel=1');
    const p = panel(page);
    await p.getByRole('radio', { name: '×10' }).click();
    expect((await getTime(page)).speed).toBe(10);
    await p.getByRole('radio', { name: 'Пауза' }).click();
    expect((await getTime(page)).speed).toBe(0);

    await p.getByRole('button', { name: 'Північ', exact: true }).click();
    expect(Math.abs((await nowMs(page)) - MIDNIGHT_LONDON)).toBeLessThan(100);
    await p.getByRole('button', { name: '−15 хв' }).click();
    expect(Math.abs((await nowMs(page)) - (MIDNIGHT_LONDON - 15 * 60_000))).toBeLessThan(100);
    await p.getByRole('button', { name: '+14 хв' }).click();
    expect(Math.abs((await nowMs(page)) - (MIDNIGHT_LONDON + 14 * 60_000))).toBeLessThan(100);

    await p.getByLabel('Момент').fill('2027-01-01T01:59:30');
    await p.getByRole('button', { name: 'Застосувати' }).click();
    expect(Math.abs((await nowMs(page)) - Date.parse('2027-01-01T01:59:30+02:00'))).toBeLessThan(100);
    // Зміна потрапила в адресу (replaceState), щоб посиланням можна було поділитися.
    await expect.poll(() => new URL(page.url()).searchParams.get('t')).toBe('2026-12-31T23:59:30Z');
  });

  test('панель не перекриває плеєр і не блокує сторінку', async ({ page }) => {
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0, '/?panel=1');
    const p = panel(page);
    await expect(p).toBeVisible();
    await expectNothingOverPlayer(page);

    const pb = await p.boundingBox();
    expect(pb).not.toBeNull();
    const slot = await page.locator('[data-player-slot="main"]').first().boundingBox();
    if (slot) {
      const overlap =
        pb!.x < slot.x + slot.width && pb!.x + pb!.width > slot.x && pb!.y < slot.y + slot.height && pb!.y + pb!.height > slot.y;
      expect(overlap, 'панель не перекриває область плеєра').toBe(false);
    }

    // Не блокує: на тілі немає inert / aria-hidden / pointer-events: none, модальних вікон немає.
    const state = await page.evaluate(() => {
      const main = document.querySelector('main#main');
      return {
        bodyPointer: getComputedStyle(document.body).pointerEvents,
        mainHidden: main?.closest('[aria-hidden="true"], [inert]') != null,
        modal: document.querySelectorAll('[aria-modal="true"]').length,
      };
    });
    expect(state).toEqual({ bodyPointer: 'auto', mainHidden: false, modal: 0 });
    await page.keyboard.press('Escape');
    await expect(p).toHaveCount(0);
  });
});
