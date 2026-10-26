/**
 * Фікстура геометрії плеєра (конституція I, research.md 3):
 * - iframe плеєра не менший за 200×200 px;
 * - «нічого поверх плеєра»: у жодній точці прямокутника плеєра верхнім елементом не є
 *   щось, крім самого iframe (виняток — мініплеєр `[data-miniplayer]`, той самий хост).
 */
import { expect, type Page } from '@playwright/test';

export const PLAYER_IFRAME = '[data-player-host] iframe';
export const MIN_PLAYER_PX = 200;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Прямокутник iframe плеєра (у в’юпорті) або `null`, якщо його немає чи він схований. */
export async function playerBox(page: Page, selector = PLAYER_IFRAME): Promise<Box | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) return null;
    const host = el.closest<HTMLElement>('[data-player-host]');
    if (host && getComputedStyle(host).visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  }, selector);
}

/** iframe плеєра видимий і ≥ 200×200 px. */
export async function expectPlayerMinSize(page: Page, selector = PLAYER_IFRAME): Promise<Box> {
  const box = await playerBox(page, selector);
  expect(box, `плеєр (${selector}) має бути видимим`).not.toBeNull();
  expect(box!.width, 'ширина плеєра ≥ 200 px').toBeGreaterThanOrEqual(MIN_PLAYER_PX);
  expect(box!.height, 'висота плеєра ≥ 200 px').toBeGreaterThanOrEqual(MIN_PLAYER_PX);
  return box!;
}

export interface OverlapReport {
  x: number;
  y: number;
  element: string;
}

/**
 * Елементи, що лежать поверх плеєра. Сітка `grid × grid` точок усередині прямокутника iframe
 * (з відступом 1 px від країв) + `elementFromPoint`. Точки поза в’юпортом пропускаються.
 */
export async function findElementsOverPlayer(
  page: Page,
  opts: { selector?: string; grid?: number; allow?: string[] } = {},
): Promise<OverlapReport[]> {
  const { selector = PLAYER_IFRAME, grid = 9, allow = ['[data-miniplayer]'] } = opts;
  return page.evaluate(
    ({ sel, n, allowed }) => {
      const frame = document.querySelector<HTMLElement>(sel);
      if (!frame) return [];
      const r = frame.getBoundingClientRect();
      const out: { x: number; y: number; element: string }[] = [];
      const describe = (el: Element) => {
        const id = el.id ? `#${el.id}` : '';
        const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}` : '';
        return `${el.tagName.toLowerCase()}${id}${cls}`;
      };
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const x = r.left + 1 + ((r.width - 2) * i) / (n - 1);
          const y = r.top + 1 + ((r.height - 2) * j) / (n - 1);
          if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
          const top = document.elementFromPoint(x, y);
          if (!top || top === frame || frame.contains(top)) continue;
          if (allowed.some((a) => top.closest(a))) continue;
          out.push({ x: Math.round(x), y: Math.round(y), element: describe(top) });
        }
      }
      return out;
    },
    { sel: selector, n: Math.max(2, grid), allowed: allow },
  );
}

/** Нічого не лежить поверх плеєра. */
export async function expectNothingOverPlayer(
  page: Page,
  opts?: { selector?: string; grid?: number; allow?: string[] },
): Promise<void> {
  const overlaps = await findElementsOverPlayer(page, opts);
  expect(overlaps, `поверх плеєра: ${overlaps.map((o) => o.element).join(', ')}`).toEqual([]);
}
