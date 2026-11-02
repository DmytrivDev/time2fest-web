/**
 * US1 — мапа поясів (T067, C18). Головна з «машиною часу» (заморожений час):
 * 38 шляхів `data-offset`, класи станів `is-past|is-live|is-next|is-ahead` від `TimeSource`,
 * на телефоні дотик до міста відкриває картку під мапою з «Відкрити країну» (без переходу),
 * Enter на поясі відкриває `ZoneCard`, стрілки гортають пояси, Esc повертає фокус; axe на мапі.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { AXE_TAGS } from './fixtures/axe';
import { gotoAt, setTime } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'US1: телефон і десктоп');
});

const SCENE = '2026-12-31T23:50:00Z'; // Лондон у ефірі, Азорські острови наступні, Європа вже зустріла

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;
const map = (page: Page) => page.locator('[data-zone-map]');
const zone = (page: Page, id: string) => map(page).locator(`path[data-zone="${id}"]`);

async function openMap(page: Page, at = SCENE) {
  await gotoAt(page, at, 0);
  // Плашка cookies — фіксована внизу за макетом: прибираємо, щоб не лежала на мапі під час кліків.
  const necessary = page.getByRole('button', { name: 'Лише необхідні' });
  if (await necessary.isVisible().catch(() => false)) await necessary.click();
  const m = map(page);
  await m.scrollIntoViewIfNeeded();
  await expect(m.locator('path[data-offset]').first()).toBeVisible();
  return m;
}

test.describe('Мапа поясів: дані й стани', () => {
  test('38 шляхів data-offset, один Tab-стоп, стани від часу', async ({ page }) => {
    const m = await openMap(page);
    await expect(m.locator('path[data-offset]')).toHaveCount(38);
    await expect(m.locator('path[data-offset][tabindex="0"]')).toHaveCount(1);
    await expect(zone(page, 'utc+0000')).toHaveClass(/is-live/);
    await expect(zone(page, 'utc-0100')).toHaveClass(/is-next/);
    await expect(zone(page, 'utc+0100')).toHaveClass(/is-past/);
    await expect(zone(page, 'utc-0500')).toHaveClass(/is-ahead/);
  });

  test('класи оновлюються, коли «машина часу» рухається', async ({ page }) => {
    await openMap(page);
    await setTime(page, { at: '2027-01-01T00:16:00Z', speed: 0 });
    await expect(zone(page, 'utc+0000')).toHaveClass(/is-past/);
    await expect(zone(page, 'utc-0100')).toHaveClass(/is-live/);
    await expect(zone(page, 'utc-0200')).toHaveClass(/is-next/);
    await setTime(page, { at: '2026-12-31T09:00:00Z', speed: 0 });
    await expect(zone(page, 'utc+1400')).toHaveClass(/is-live/);
    await expect(zone(page, 'utc+0000')).toHaveClass(/is-ahead/);
  });

  test('стан не лише кольором: легенда з підписами, штрихування й іконки на мапі', async ({ page }) => {
    const m = await openMap(page);
    const legend = m.locator('[data-map-legend]');
    for (const label of ['Вже зустріли', 'Наживо зараз', 'Найближча північ', 'Ще попереду']) await expect(legend).toContainText(label);
    await expect(zone(page, 'utc+0100')).toHaveAttribute('style', /url\(/);
    await expect(m.locator('[data-zone-icon="live"]')).toHaveCount(1);
    await expect(m.locator('[data-zone-icon="next"]')).toHaveCount(1);
  });

  test('немає горизонтального переповнення сторінки', async ({ page }) => {
    await openMap(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('Мапа поясів: телефон', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    void page;
    test.skip(testInfo.project.name !== 'phone', 'лише телефон');
  });

  test('дотик до міста відкриває картку під мапою; сторінка не змінюється', async ({ page }) => {
    const m = await openMap(page);
    const url = page.url();
    const svg = m.locator('svg[data-zone-map-svg]');
    await m.locator('button[data-city="london"]').click();
    const card = m.locator('[data-map-tap-card]');
    await expect(card).toBeVisible();
    expect(page.url()).toBe(url);
    const open = card.getByRole('link', { name: /Відкрити країну/ });
    await expect(open).toBeVisible();
    await expect(open).toHaveAttribute('href', /\/country\//);
    // Картка — під мапою, а не поверх неї.
    const svgBox = (await svg.boundingBox())!;
    const cardBox = (await card.boundingBox())!;
    expect(cardBox.y).toBeGreaterThanOrEqual(svgBox.y + svgBox.height - 1);
    // Друге місто міняє вміст картки, а не відкриває другу.
    await m.locator('button[data-city="paris"]').click();
    await expect(m.locator('[data-map-tap-card]')).toHaveCount(1);
    await expect(m.locator('[data-map-tap-card]')).toContainText('Франція');
    // Закрити × — картки немає.
    await card.getByRole('button', { name: 'Закрити картку' }).click();
    await expect(m.locator('[data-map-tap-card]')).toHaveCount(0);
  });

  test('ціль дотику точки міста щонайменше 44 px', async ({ page }) => {
    const m = await openMap(page);
    const box = (await m.locator('button[data-city="london"]').boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  });

  test('«Список» поки сховано: у перемикачі вигляду лише «Мапа»', async ({ page }) => {
    const m = await openMap(page);
    const view = m.getByRole('group', { name: 'Вигляд' });
    await expect(view.getByRole('button', { name: 'Мапа' })).toHaveAttribute('aria-pressed', 'true');
    await expect(view.getByRole('button', { name: 'Список' })).toHaveCount(0);
  });
});

test.describe('Мапа поясів: клавіатура', () => {
  test('стрілки між поясами, Enter — ZoneCard з країнами-посиланнями, Esc повертає фокус', async ({ page }) => {
    test.skip(isPhone(page), 'клавіатура: десктоп');
    const m = await openMap(page);
    const live = zone(page, 'utc+0000');
    await live.focus();
    await page.keyboard.press('ArrowRight');
    await expect(zone(page, 'utc+0100')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(live).toBeFocused();

    await page.keyboard.press('Enter');
    const card = m.locator('[data-zone-card="pinned"]');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: /Пояс UTC\+0/ })).toBeVisible();
    await expect(card.getByRole('link').first()).toHaveAttribute('href', /\/country\//);

    await page.keyboard.press('Escape');
    await expect(m.locator('[data-zone-card]')).toHaveCount(0);
    await expect(live).toBeFocused();
  });

  test('Tab проходить мапу одним стопом і виходить далі', async ({ page }) => {
    test.skip(isPhone(page), 'клавіатура: десктоп');
    const m = await openMap(page);
    await m.getByRole('button', { name: 'Мапа', exact: true }).focus();
    await page.keyboard.press('Tab');
    const onPath = await page.evaluate(() => document.activeElement?.matches('path[data-offset]') ?? false);
    expect(onPath).toBe(true);
    await page.keyboard.press('Tab');
    const stillOnPath = await page.evaluate(() => document.activeElement?.matches('path[data-offset]') ?? false);
    expect(stillOnPath).toBe(false);
  });

  test('на десктопі точка міста — посилання на країну; «Як святкувати» відкриває спливну панель', async ({ page }) => {
    test.skip(isPhone(page), 'десктоп');
    const m = await openMap(page);
    await expect(m.locator('a[data-city="london"]')).toHaveAttribute('href', /\/country\//);
    await zone(page, 'utc+0000').click();
    const card = m.locator('[data-zone-card="pinned"]');
    await card.getByRole('button', { name: 'Як святкувати' }).click();
    await expect(page.locator('[data-how-to-popover]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-how-to-popover]')).toHaveCount(0);
    await expect(card).toBeVisible(); // Esc закрив лише панель
  });
});

test.describe('Мапа поясів: доступність', () => {
  test('axe: мапа, легенда й відкрита картка без порушень (WCAG 2.1 AA)', async ({ page }) => {
    const m = await openMap(page);
    // Центр рамки поясу UTC+0 на вузькій мапі припадає на ціль міста (Азорські острови) — відкриваємо картку з клавіатури.
    await zone(page, 'utc+0000').focus();
    await page.keyboard.press('Enter');
    await expect(m.locator('[data-zone-card]')).toBeVisible();
    const { violations } = await new AxeBuilder({ page }).withTags(AXE_TAGS).include('[data-zone-map]').analyze();
    expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  test('«Зменшити рух»: пульсації немає (halo без анімації)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const m = await openMap(page);
    const name = await m.locator('a[data-city="london"] .t2f-zm-halo, button[data-city="london"] .t2f-zm-halo').first().evaluate((el) => getComputedStyle(el).animationName);
    expect(name).toBe('none');
  });
});
