/**
 * Наскрізна перевірка доступності (T131, SC-006): axe (WCAG 2.1 AA) по всіх маршрутах на `phone`, `desktop`, `tv`;
 * головна — у фазах «до півночі», «+15 с», «+2 хв», «+14 хв»; сторінка країни — живе / очікується / лише відлік / запис.
 * Плюс клавіатурний обхід головної й повернення фокуса після закриття вікна.
 * Часовий пояс браузера — Київ: північ Лондона = 02:00, Парижа = 01:00.
 */
import type { Page } from '@playwright/test';
import { runAxe } from './fixtures/axe';
import { gotoAt } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page, ytStub }, testInfo) => {
  void ytStub;
  void page;
  test.skip(testInfo.project.name === 'prod', 'a11y: тестова збірка');
});
test.describe.configure({ timeout: 90_000 });

const GB = '/country/velyka-brytaniia/';
const FR = '/country/frantsiia/';
const SN = '/country/senehal/';

interface Case {
  name: string;
  path: string;
  at?: string;
  speed?: number;
}

const CASES: Case[] = [
  { name: 'головна · до півночі', path: '/', at: '2027-01-01T01:50:00+02:00' },
  { name: 'головна · +15 с', path: '/', at: '2027-01-01T02:00:16+02:00' },
  { name: 'головна · +2 хв', path: '/', at: '2027-01-01T02:02:05+02:00' },
  { name: 'головна · +14 хв', path: '/', at: '2027-01-01T02:14:05+02:00' },
  { name: 'країна · живе', path: GB, at: '2027-01-01T01:50:00+02:00' },
  { name: 'країна · очікується', path: FR, at: '2026-12-31T22:45:00Z' },
  { name: 'країна · лише відлік', path: SN, at: '2027-01-01T01:50:00+02:00' },
  { name: 'країна · запис', path: FR, at: '2027-01-01T01:40:00+02:00' },
  { name: 'кімната', path: '/room/', at: '2027-01-01T01:50:00+02:00' },
  { name: 'список країн', path: '/countries/', at: '2027-01-01T01:50:00+02:00' },
  { name: 'ТВ', path: '/tv/', at: '2027-01-01T01:50:00+02:00' },
  { name: 'ТВ · +15 с', path: '/tv/', at: '2027-01-01T02:00:16+02:00' },
  { name: '404', path: '/takoi-storinky-nemaie/' },
];

function format(violations: Awaited<ReturnType<typeof runAxe>>): string[] {
  return violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
}

async function open(page: Page, c: Case) {
  if (c.at) await gotoAt(page, c.at, c.speed ?? 0, c.path);
  else await page.goto(c.path);
  await expect(page.locator('main').first()).toBeVisible();
  // Дати клієнтським станам (підпис, штамп, сітка) осісти. На «+15 с» блоки з’являються з CSS-переходами:
  // axe на проміжних кольорах переходу дає хибний контраст, тож чекаємо, поки всі місця догорять.
  await page.waitForTimeout(c.name.includes('+15 с') ? 8_000 : 2_500);
}

test.describe('SC-006 · axe AA по всіх маршрутах', () => {
  for (const c of CASES) {
    test(c.name, async ({ page, ytStub }) => {
      void ytStub;
      await open(page, c);
      expect(format(await runAxe(page))).toEqual([]);
    });
  }
});

test.describe('Клавіатура', () => {
  test('головна: Tab обходить без пасток, кожна зупинка видима і має контур', async ({
    page,
    ytStub,
  }, testInfo) => {
    void ytStub;
    test.skip(testInfo.project.name === 'tv', 'ТВ має власну навігацію стрілками (us7-tv)');
    await gotoAt(page, '2027-01-01T01:50:00+02:00', 0, '/');
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    const seen: string[] = [];
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        // Фокус усередині iframe плеєра — зупинка, сам iframe не перевіряємо.
        if (el.tagName === 'IFRAME') return { key: 'iframe', visible: true, outlined: true };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        // Пояс на мапі показує фокус кольором (як вибраний, без обвідки — рішення власника): `data-selected` на групі.
        const zoneRing = el.matches('g[data-offset]') && el.getAttribute('data-selected') === 'true';
        const outlined =
          zoneRing ||
          (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) ||
          cs.boxShadow !== 'none';
        const key = `${el.tagName}:${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? ''}`;
        return { key, visible: r.width > 0 && r.height > 0, outlined };
      });
      if (!info) continue;
      expect.soft(info.visible, `видима зупинка ${info.key}`).toBe(true);
      expect.soft(info.outlined, `контур фокуса ${info.key}`).toBe(true);
      seen.push(info.key);
    }
    // Фокус рухається, а не застрягає на одному елементі.
    expect(new Set(seen).size).toBeGreaterThan(8);
  });

  test('вікно закривається Esc і повертає фокус на кнопку, що його відкрила', async ({
    page,
    ytStub,
  }, testInfo) => {
    void ytStub;
    test.skip(testInfo.project.name === 'tv', 'на ТВ немає хедера');
    await gotoAt(page, '2027-01-01T01:50:00+02:00', 0, '/');
    // Мова — лише в меню (2026-11-08): перевіряємо меню на всіх розмірах.
    const trigger = page.getByRole('banner').getByRole('button', { name: 'Меню' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
