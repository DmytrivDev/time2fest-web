/**
 * US2 — «Країни й міста» (FR-081; довідник за поясами — рішення власника 2026-11-04, дошка `Desk-Countries-Next`, v2).
 * Сторінка `/countries/` з «машиною часу»: рядки поясів як у «Списку» головної, на старті згорнуті; розгорнутий пояс —
 * картки країн за регіонами, клік — сторінка країни; пошук — лише пояси зі збігами, розгорнуті; порожній стан;
 * «З трансляціями»; «Мапа»; колонка чату на десктопі; axe на згорнутому й розгорнутому списку.
 * Момент за замовчуванням: 2027-01-01T01:38+02:00 — Лондон (UTC+0) наживо, Франція вже зустріла.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/youtube-stub';
import { runAxe } from './fixtures/axe';
import { DEFAULT_START, gotoAt } from './fixtures/time';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name === 'tv' || testInfo.project.name === 'prod', 'US2: телефон і десктоп');
});

const EMPTY = 'Нічого не знайшли — спробуй іншу назву';
const search = (page: Page) => page.getByRole('searchbox', { name: 'Знайти країну чи місто' });
const zoneRow = (page: Page, id: string) => page.locator(`[data-zone-list] [data-zone-row="${id}"]`);
const card = (page: Page, iso: string) => page.locator(`[data-country-card="${iso}"]`);

async function openList(page: Page) {
  await gotoAt(page, DEFAULT_START, 0, '/countries/');
  await expect(page.getByRole('heading', { level: 1, name: 'Країни й міста' })).toBeVisible();
  await expect(zoneRow(page, 'utc+0000')).toBeVisible();
}

test.describe('Країни й міста', () => {
  test('на старті всі пояси згорнуті; клік розгортає пояс із картками за регіонами; Лондон — «Трансляція»', async ({ page }) => {
    await openList(page);
    const live = zoneRow(page, 'utc+0000');
    await expect(live.locator('> button')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-zone-list-past]')).toHaveAttribute('aria-expanded', 'false');
    await live.locator('> button').click();
    await expect(live.locator('> button')).toHaveAttribute('aria-expanded', 'true');
    await expect(live.locator('[data-region="europe"]')).toBeVisible();
    await expect(card(page, 'GB')).toHaveAttribute('data-status', 'live');
    await expect(card(page, 'GB')).toContainText('Трансляція');
  });

  test('пошук: «Бразил» — лише пояси з Бразилією, розгорнуті; нісенітниця — порожній стан; «Очистити» повертає все', async ({ page }) => {
    await openList(page);
    await search(page).fill('Бразил');
    const rows = page.locator('[data-zone-list] [data-zone-row]');
    await expect(rows.first()).toBeVisible();
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      await expect(rows.nth(i).locator('> button')).toHaveAttribute('aria-expanded', 'true');
      await expect(rows.nth(i).locator('[data-country-card="BR"]')).toBeVisible();
    }
    await search(page).fill('Атлантида');
    await expect(page.getByText(EMPTY)).toBeVisible();
    await search(page).fill('Бразил');
    await page.getByRole('button', { name: 'Очистити' }).click();
    await expect(page.getByText(EMPTY)).toHaveCount(0);
    await expect(zoneRow(page, 'utc+0000').locator('> button')).toHaveAttribute('aria-expanded', 'false');
  });

  test('«З трансляціями» лишає лише країни з трансляціями', async ({ page }) => {
    await openList(page);
    await page.getByRole('radio', { name: 'З трансляціями' }).click();
    await expect(card(page, 'GB')).toBeVisible();
    await expect(page.locator('[data-country-card][data-status="none"]')).toHaveCount(0);
  });

  test('перехід на сторінку країни: Франція → /country/frantsiia/', async ({ page }) => {
    await openList(page);
    await search(page).fill('Франція');
    const link = card(page, 'FR').getByRole('link', { name: /Франція/ });
    await expect(link).toHaveAttribute('href', /\/country\/frantsiia\/?$/);
    await link.click();
    await expect(page).toHaveURL(/\/country\/frantsiia\/?$/);
  });

  test('«Мапа» — мапа поясів замість списку; десктоп — колонка чату поруч', async ({ page }, testInfo) => {
    await openList(page);
    await page.getByRole('button', { name: 'Мапа', exact: true }).click();
    await expect(page.locator('[data-zone-map]')).toBeVisible();
    await expect(page.locator('[data-zone-list]')).toHaveCount(0);
    if (testInfo.project.name !== 'phone') await expect(page.locator('#chat')).toBeVisible();
  });
});

test.describe('Країни й міста: доступність', () => {
  test('axe: згорнутий і розгорнутий список без порушень (WCAG 2.1 AA)', async ({ page }) => {
    await openList(page);
    const fmt = (vs: Awaited<ReturnType<typeof runAxe>>) => vs.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(fmt(await runAxe(page))).toEqual([]);
    await zoneRow(page, 'utc+0000').locator('> button').click();
    await expect(card(page, 'GB')).toBeVisible();
    expect(fmt(await runAxe(page))).toEqual([]);
  });
});
