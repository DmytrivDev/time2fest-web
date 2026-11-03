/**
 * US1 — мапа поясів (T067, C18). Головна з «машиною часу» (заморожений час):
 * 38 шляхів `data-offset`, класи станів `is-past|is-live|is-next|is-ahead` від `TimeSource`,
 * на телефоні дотик до міста відкриває картку під мапою з «Відкрити країну» (без переходу),
 * Enter на поясі відкриває вікно поясу під мапою, стрілки гортають пояси, Esc повертає фокус; axe на мапі.
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
const zone = (page: Page, id: string) => map(page).locator(`g[data-zone="${id}"]`);

async function openMap(page: Page, at = SCENE) {
  await gotoAt(page, at, 0);
  // Плашка cookies — фіксована внизу за макетом: прибираємо, щоб не лежала на мапі під час кліків.
  const necessary = page.getByRole('button', { name: 'Лише необхідні' });
  if (await necessary.isVisible().catch(() => false)) await necessary.click();
  const m = map(page);
  await m.scrollIntoViewIfNeeded();
  await expect(m.locator('g[data-offset]').first()).toBeVisible();
  return m;
}

/** Відкрите вікно поясу (згорнуте лишається в DOM у `Reveal`). */
const OPEN_PANEL = '[data-zone-map-card-slot] .t2f-reveal[data-open="true"] [data-zone-panel]';

test.describe('Мапа поясів: дані й стани', () => {
  test('38 шляхів data-offset, один Tab-стоп, стани від часу', async ({ page }) => {
    const m = await openMap(page);
    await expect(m.locator('g[data-offset]')).toHaveCount(38);
    await expect(m.locator('g[data-offset][tabindex="0"]')).toHaveCount(1);
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

  test('стан не лише кольором: легенда (телефон) чи черга поясів (десктоп) з підписами й іконки на мапі', async ({ page }, testInfo) => {
    const m = await openMap(page);
    if (testInfo.project.name === 'phone') {
      const legend = m.locator('[data-map-legend]');
      for (const label of ['Вже зустріли', 'Наживо зараз', 'Найближча північ', 'Ще попереду']) await expect(legend).toContainText(label);
    } else {
      const queue = m.locator('[data-map-queue]');
      for (const label of ['Зараз', 'Далі', 'Вже зустріли']) await expect(queue).toContainText(label);
    }
    await expect(zone(page, 'utc+0100')).toHaveClass(/is-past/);
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

  test('дотик до міста відкриває вікно поясу під мапою; сторінка не змінюється', async ({ page }) => {
    const m = await openMap(page);
    const url = page.url();
    const svg = m.locator('svg[data-zone-map-svg]');
    await m.locator('button[data-city="london"]').click();
    const panel = m.locator(OPEN_PANEL);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-zone-panel', 'utc+0000');
    expect(page.url()).toBe(url);
    await expect(panel.locator('[data-country-card="GB"]')).toHaveAttribute('href', /\/country\//);
    // Вікно — під мапою, а не поверх неї.
    const svgBox = (await svg.boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(svgBox.y + svgBox.height - 1);
    // Стрілка — сусідній пояс у тому самому вікні.
    await panel.getByRole('button', { name: /^Наступний пояс/ }).click();
    await expect(m.locator(OPEN_PANEL)).toHaveCount(1);
    await expect(m.locator(OPEN_PANEL)).not.toHaveAttribute('data-zone-panel', 'utc+0000');
    // Закрити × — вікна немає.
    await m.locator(OPEN_PANEL).getByRole('button', { name: 'Закрити' }).click();
    await expect(m.locator(OPEN_PANEL)).toHaveCount(0);
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
  test('стрілки між поясами, Enter — вікно поясу з країнами-посиланнями, Esc повертає фокус', async ({ page }) => {
    test.skip(isPhone(page), 'клавіатура: десктоп');
    const m = await openMap(page);
    const live = zone(page, 'utc+0000');
    await live.focus();
    await page.keyboard.press('ArrowRight');
    await expect(zone(page, 'utc+0100')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(live).toBeFocused();

    await page.keyboard.press('Enter');
    const card = m.locator(OPEN_PANEL);
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'UTC+0' })).toBeVisible();
    await expect(card.getByRole('link').first()).toHaveAttribute('href', /\/country\//);

    await page.keyboard.press('Escape');
    await expect(m.locator(OPEN_PANEL)).toHaveCount(0);
    await expect(live).toBeFocused();
  });

  test('Tab проходить мапу одним стопом і виходить далі', async ({ page }) => {
    test.skip(isPhone(page), 'клавіатура: десктоп');
    const m = await openMap(page);
    await m.getByRole('button', { name: 'Мапа', exact: true }).focus();
    await page.keyboard.press('Tab');
    const onPath = await page.evaluate(() => document.activeElement?.matches('g[data-offset]') ?? false);
    expect(onPath).toBe(true);
    await page.keyboard.press('Tab');
    const stillOnPath = await page.evaluate(() => document.activeElement?.matches('g[data-offset]') ?? false);
    expect(stillOnPath).toBe(false);
  });

  test('на десктопі точка міста — посилання на країну; клік у черзі відкриває вікно поясу під мапою з прокруткою', async ({ page }) => {
    test.skip(isPhone(page), 'десктоп');
    const m = await openMap(page);
    await expect(m.locator('a[data-city="london"]')).toHaveAttribute('href', /\/country\//);
    await m.locator('[data-queue-zone="utc-0100"]').click();
    const panel = m.locator(OPEN_PANEL);
    await expect(panel).toHaveAttribute('data-zone-panel', 'utc-0100');
    await expect(m.locator('[data-queue-zone="utc-0100"]')).toHaveAttribute('aria-pressed', 'true');
    // Верх вікна — у видимій частині сторінки (прокрутка до вікна).
    await expect(panel).toBeInViewport();
    await expect(panel.locator('[data-country-tile], [data-country-card]').first()).toHaveAttribute('href', /\/country\//);
  });
});

test.describe('Мапа поясів: доступність', () => {
  test('axe: мапа, легенда й відкрите вікно поясу без порушень (WCAG 2.1 AA)', async ({ page }) => {
    const m = await openMap(page);
    // Центр рамки поясу UTC+0 на вузькій мапі припадає на ціль міста (Азорські острови) — відкриваємо вікно з клавіатури.
    await zone(page, 'utc+0000').focus();
    await page.keyboard.press('Enter');
    await expect(m.locator(OPEN_PANEL)).toBeVisible();
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
