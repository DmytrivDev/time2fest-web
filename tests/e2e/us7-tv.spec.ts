/**
 * US7 — «Режим вечірки на телевізорі» (`/tv`, quickstart 11; T123). Проєкт `tv`, 1920×1080.
 * Той самий ефір, що на головній: «+15 с» — «<Країна> зустріла Новий рік», штамп з QR і видимою короткою адресою,
 * стіна загоряється; чату й хедера немає; текст ≥ 22 px; усе в безпечній зоні 96/54; контур фокуса ≥ 4 px;
 * початковий фокус — перша картка черги; стрілки / Enter / Esc (Esc → головна); плеєр ≥ 70% ширини.
 *
 * Часовий пояс браузера — Київ: «північ о 02:00 за вашим часом» для Лондона.
 * За рішенням власника (2026-10-27) цей файл написано, але e2e не запускається в межах US7.
 */
import type { Page } from '@playwright/test';
import { runAxe } from './fixtures/axe';
import { expectNothingOverPlayer, expectPlayerMinSize, playerBox } from './fixtures/geometry';
import { gotoAt, waitForTimeApi } from './fixtures/time';
import { expect, test, type YouTubeStub } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA', viewport: { width: 1920, height: 1080 } });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(testInfo.project.name !== 'tv', 'US7: лише проєкт tv (1920×1080)');
});
test.describe.configure({ timeout: 90_000 });

const LONDON_MIDNIGHT = Date.parse('2027-01-01T00:00:00Z');
const STAMP_AT = LONDON_MIDNIGHT + 15_000;
const SAFE_X = 96;
const SAFE_Y = 54;
const MIN_FONT_PX = 22;
const MIN_FOCUS_PX = 4;

const sidebar = (page: Page) => page.locator('[data-tv-sidebar]');
const met = (page: Page) => page.locator('[data-tv-met]');

async function openTv(page: Page, ytStub: YouTubeStub, iso: string, speed = 1) {
  await gotoAt(page, iso, speed, '/tv/');
  await ytStub.waitForPlayer();
}

async function expectAxeClean(page: Page) {
  const violations = await runAxe(page);
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

/** Найменший обчислений `font-size` усіх видимих текстових вузлів (без SVG-малюнків і прихованого для екрана тексту). */
async function smallestFont(page: Page): Promise<{ min: number; offenders: string[] }> {
  return page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let min = Number.POSITIVE_INFINITY;
    const offenders: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const el = node.parentElement;
      if (!text || !el) continue;
      if (
        el.closest(
          'svg, script, style, noscript, [data-player-host], nextjs-portal, [data-nextjs-toast]',
        )
      )
        continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      // «Лише для зчитувача» (sr-only: 1×1 px) у видимий текст не рахується.
      if (r.width <= 1 || r.height <= 1) continue;
      const size = parseFloat(cs.fontSize);
      if (size < min) min = size;
      if (size < 22) offenders.push(`${el.tagName.toLowerCase()} ${size}px «${text.slice(0, 40)}»`);
    }
    return { min, offenders };
  });
}

/** Видимі (з урахуванням обрізання прокруткою) елементи поза безпечною зоною: плеєр і його слот можуть іти до краю. */
async function outsideSafeZone(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ x, y }) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const visibleRect = (el: Element) => {
        const r = el.getBoundingClientRect();
        let { left, top, right, bottom } = r;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (/(auto|scroll|hidden|clip)/.test(cs.overflowX + cs.overflowY)) {
            const pr = p.getBoundingClientRect();
            left = Math.max(left, pr.left);
            top = Math.max(top, pr.top);
            right = Math.min(right, pr.right);
            bottom = Math.min(bottom, pr.bottom);
          }
        }
        return { left, top, right, bottom, ok: right > left && bottom > top };
      };
      const bad: string[] = [];
      const selector =
        'a, button, h1, h2, h3, p, li, time, figure, [role="progressbar"], [role="timer"], [role="status"], [data-tv-card], [data-stamp]';
      for (const el of document.querySelectorAll(`[data-tv-root] ${selector}`)) {
        if (el.closest('[data-player-host], [data-player-slot], [data-tv-scene]')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 1 || r.height <= 1) continue; // sr-only
        const v = visibleRect(el);
        if (!v.ok) continue;
        if (
          v.left < x - 0.5 ||
          v.top < y - 0.5 ||
          v.right > W - x + 0.5 ||
          v.bottom > H - y + 0.5
        ) {
          bad.push(
            `${el.tagName.toLowerCase()} «${(el.textContent ?? '').trim().slice(0, 30)}» ${[v.left, v.top, v.right, v.bottom].map(Math.round).join(',')}`,
          );
        }
      }
      return bad;
    },
    { x: SAFE_X, y: SAFE_Y },
  );
}

/** Чекає першого кадру з «<Країна> зустріла Новий рік», штампом з QR і стіною, що загоряється; повертає віртуальний час. */
async function waitForTvMoment(page: Page, timeout = 30_000): Promise<number> {
  const handle = await page.waitForFunction(
    () => {
      const met = document.querySelector('[data-tv-met]');
      const stamp = document.querySelector('[data-stamp="tv"]');
      const wall = document.querySelector(
        '[data-first-row-wall][data-phase="lighting"], [data-first-row-wall][data-phase="lit"]',
      );
      const ok =
        !!met &&
        /Велика Британія зустріла Новий рік/.test(met.textContent ?? '') &&
        !!stamp &&
        !!wall;
      if (!ok) return null;
      const api = (window as unknown as { __t2f?: { timeMachine: { get(): { at: string } } } })
        .__t2f;
      return api ? Date.parse(api.timeMachine.get().at) : null;
    },
    undefined,
    { timeout, polling: 'raf' },
  );
  return (await handle.jsonValue()) as number;
}

test.describe('US7 · режим вечірки на ТВ', () => {
  test('розкладка: плеєр ≥ 70% ширини, чату й хедера немає, один плеєр, нічого поверх відео', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);

    const box = await expectPlayerMinSize(page);
    expect(box.width / 1920, 'плеєр ≥ 70% ширини').toBeGreaterThanOrEqual(0.7);
    await expectNothingOverPlayer(page);
    await expect(page.locator('[data-player-host] iframe')).toHaveCount(1);
    const players = await ytStub.players();
    expect(players).toHaveLength(1);
    expect(players[0]!.playerVars.autoplay).toBe(1);

    // Ні хедера, ні футера, ні чату.
    await expect(
      page.locator('header, footer, #chat, [role="log"], textarea, [data-chat]'),
    ).toHaveCount(0);
    await expect(page.getByRole('banner')).toHaveCount(0);
    await expect(page.getByRole('contentinfo')).toHaveCount(0);
    await expect(page.locator('main')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    // Колонка: логотип, один відлік, «Зараз», вкладки, смуга керування, попередження про спалахи.
    await expect(sidebar(page).getByRole('link', { name: /Time2Fest/ })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveCount(1);
    await expect(sidebar(page)).toContainText('Зараз: Лондон');
    await expect(sidebar(page).getByRole('tab')).toHaveText([
      'Далі',
      'Як святкувати',
      'Перший ряд',
    ]);
    for (const name of ['Пауза', 'Звук', 'Вийти'])
      await expect(
        sidebar(page)
          .getByRole('button', { name: new RegExp(name) })
          .or(sidebar(page).getByRole('link', { name })),
      ).toBeVisible();
    await expect(sidebar(page)).toContainText('Трансляції феєрверків можуть містити спалахи');
    // Підказка клавіш під таймлайном.
    await expect(page.locator('[data-tv-hints]')).toContainText('вийти з режиму вечірки');
  });

  test('текст ≥ 22 px і безпечна зона 96/54 — до півночі і опівночі', async ({ page, ytStub }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await expect(page.locator('[data-tv-card]').first()).toBeVisible();

    let fonts = await smallestFont(page);
    expect(fonts.offenders, 'текст менший за 22 px').toEqual([]);
    expect(fonts.min).toBeGreaterThanOrEqual(MIN_FONT_PX);
    expect(await outsideSafeZone(page), 'елементи поза безпечною зоною 96/54').toEqual([]);

    // Вкладки «Як святкувати» і «Перший ряд».
    await sidebar(page).getByRole('tab', { name: 'Як святкувати' }).click();
    await expect(sidebar(page).getByRole('heading', { name: /Як святкувати · / })).toBeVisible();
    fonts = await smallestFont(page);
    expect(fonts.offenders).toEqual([]);
    await sidebar(page).getByRole('tab', { name: 'Перший ряд' }).click();
    await expect(sidebar(page).getByText('Скануй телефоном, щоб зайняти місце')).toBeVisible();
    fonts = await smallestFont(page);
    expect(fonts.offenders).toEqual([]);
    expect(await outsideSafeZone(page)).toEqual([]);

    // Таймлайн відкрито.
    await page.getByRole('button', { name: 'Показати все свято: таймлайн подій' }).click();
    await expect(page.getByRole('button', { name: 'Сховати таймлайн' })).toBeVisible();
    fonts = await smallestFont(page);
    expect(fonts.offenders).toEqual([]);
    expect(await outsideSafeZone(page)).toEqual([]);

    // Опівночі: штамп, QR, стіна.
    await page.evaluate(() =>
      (
        window as unknown as {
          __t2f: { timeMachine: { set(o: { at: string; speed: number }): void } };
        }
      ).__t2f.timeMachine.set({ at: '2027-01-01T00:00:40Z', speed: 0 }),
    );
    await expect(met(page)).toHaveText('Велика Британія зустріла Новий рік');
    fonts = await smallestFont(page);
    expect(fonts.offenders).toEqual([]);
    expect(await outsideSafeZone(page)).toEqual([]);
  });

  test('«+15 с»: «<Країна> зустріла Новий рік», штамп з QR і видимою адресою, стіна загоряється — у межах 1 с', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:59:58+02:00', 1);
    // За < 5 хв великого відліку в колонці немає (див. тест нижче) — лише «північ о … за вашим часом».
    await expect(sidebar(page).locator('[data-tv-midnight-at]')).toContainText(
      'північ о 02:00 за вашим часом',
    );
    await expect(met(page)).toHaveCount(0);

    const at = await waitForTvMoment(page);
    expect(at).toBeGreaterThanOrEqual(STAMP_AT);
    expect(at - STAMP_AT).toBeLessThanOrEqual(1_000);

    await expect(met(page)).toHaveText('Велика Британія зустріла Новий рік');
    // Великого відліку вже немає, колонка в режимі «опівночі».
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(sidebar(page)).toHaveAttribute('data-tv-mode', 'moment');

    const stamp = page.locator('[data-stamp="tv"]');
    await expect(stamp).toBeVisible();
    await expect(stamp.getByRole('img', { name: /QR-код/ })).toBeVisible();
    const url = await stamp.locator('figcaption').innerText();
    expect(url.replace(/\s+/g, '')).toMatch(/^time2fest\.com\/s\/\S+$/);
    await expect(stamp.getByText('Скануй, щоб поділитися')).toBeVisible();
    // Кнопок «Поділитися» в штампа на ТВ немає: лише QR.
    await expect(stamp.getByRole('button')).toHaveCount(0);

    // Стіна «Першого ряду» загоряється і дозагоряється до кінця.
    await expect(page.locator('[data-first-row-wall]')).toBeVisible();
    await expect(page.locator('[data-first-row-wall][data-phase="lit"]')).toBeVisible({
      timeout: 15_000,
    });

    // Штамп справді записаний у паспорті гостя (джерело присутності — `tv`).
    const stamps = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('t2f:guest:v1');
        return (raw ? (JSON.parse(raw).state?.stamps ?? []) : []).map(
          (s: { eventId: string; presenceSource: string }) => `${s.eventId}:${s.presenceSource}`,
        );
      } catch {
        return [];
      }
    });
    expect(stamps).toContain('evt_london_2027:tv');

    expect(await outsideSafeZone(page)).toEqual([]);
    expect((await smallestFont(page)).offenders).toEqual([]);
    await expectAxeClean(page);
  });

  test('початковий фокус — перша картка черги; стрілки, Enter, контур ≥ 4 px', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    const first = page.locator('[data-tv-card]').first();
    await expect(first).toBeFocused();
    await expect(first).toHaveAttribute('data-tv-initial', '');

    const ring = async () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const cs = getComputedStyle(el);
        return { width: parseFloat(cs.outlineWidth), style: cs.outlineStyle };
      });
    let r = await ring();
    expect(r.style).not.toBe('none');
    expect(r.width).toBeGreaterThanOrEqual(MIN_FOCUS_PX);

    // ↓ — наступна картка черги; ↑ — назад; ↑ ще раз — угору до вкладок; на відео фокус не потрапляє.
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-tv-card]').nth(1)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('tab', { name: 'Далі' })).toBeFocused();
    r = await ring();
    expect(r.width).toBeGreaterThanOrEqual(MIN_FOCUS_PX);
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-player-host]'))).toBe(
      false,
    );

    // → між вкладками, Enter відкриває вкладку «Перший ряд».
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Перший ряд' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Перший ряд' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Enter на «Звук» вмикає звук у тому самому плеєрі.
    await page.getByRole('button', { name: /Звук/ }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await ytStub.counters()).unMute).toBe(1);
    expect((await ytStub.counters()).created).toBe(1);
  });

  test('таймлайн схований за замовчуванням; Enter відкриває; «Назад» спершу закриває його, а Esc потім веде на головну', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    const timeline = page.locator('[data-tv-timeline]');
    await expect(timeline).toHaveAttribute('data-tv-timeline', 'closed');
    await expect(
      timeline.getByRole('heading', { name: 'Свято по поясах · за вашим часом' }),
    ).toBeVisible();
    await expect(timeline.getByRole('progressbar', { name: 'Прогрес свята' })).toBeVisible();
    await expect(timeline).toContainText('Показати все свято');
    await expect(timeline.getByRole('button', { name: 'Лише з трансляціями' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(timeline.getByRole('button', { name: 'У моєму графіку' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await timeline.getByRole('button', { name: 'Показати все свято: таймлайн подій' }).focus();
    await page.keyboard.press('Enter');
    await expect(timeline).toHaveAttribute('data-tv-timeline', 'open');
    // Минулі події ліворуч за краєм, перша видима — поточна (Лондон, «В ефірі»).
    const list = timeline.getByRole('list', { name: /Таймлайн свята/ });
    await expect(list.locator('[aria-current="true"]')).toContainText('Лондон');
    const firstVisible = await list.evaluate((el) => {
      const left = el.getBoundingClientRect().left;
      const cards = [...el.querySelectorAll<HTMLElement>('[data-tv-card]')];
      return cards.find((c) => c.getBoundingClientRect().right > left + 4)?.textContent ?? '';
    });
    expect(firstVisible).toContain('Лондон');

    // Фільтр «Лише з трансляціями» не ховає поточну подію.
    await timeline.getByRole('button', { name: 'Лише з трансляціями' }).click();
    await expect(timeline.getByRole('button', { name: 'Лише з трансляціями' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(list.locator('[aria-current="true"]')).toContainText('Лондон');

    await page.keyboard.press('Escape');
    await expect(timeline).toHaveAttribute('data-tv-timeline', 'closed');
    await expect(page).toHaveURL(/\/tv\/?(\?|$)/);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect(page).not.toHaveURL(/\/tv/);
  });

  test('«Вийти» веде на головну; на головній «Режим вечірки» веде на /tv', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await sidebar(page).getByRole('link', { name: 'Вийти' }).click();
    await expect(page).not.toHaveURL(/\/tv/);
    await waitForTimeApi(page);

    await page.getByRole('link', { name: 'Режим вечірки' }).click();
    await expect(page).toHaveURL(/\/tv\/?(\?|$)/);
    await expect(page.locator('[data-tv-root]')).toBeVisible();
  });

  test('без трансляції: на місці плеєра сцена відліку, у колонці «Найближчі трансляції», хост плеєра схований', async ({
    page,
  }) => {
    // 00:20 UTC: ефір уже в наступному слоті (Азорські острови, трансляції немає).
    await gotoAt(page, '2027-01-01T00:20:00Z', 0, '/tv/');
    await expect(page.locator('[data-tv-scene]')).toBeVisible();
    await expect(sidebar(page)).toHaveAttribute('data-tv-mode', 'scene');
    await expect(
      sidebar(page).getByRole('heading', { name: 'Найближчі трансляції' }),
    ).toBeVisible();
    // Один відлік на сторінку — у сцені; у колонці великого відліку немає.
    await expect(page.getByRole('timer')).toHaveCount(1);
    await expect(sidebar(page).getByRole('timer')).toHaveCount(0);
    expect(await playerBox(page)).toBeNull();
    expect((await smallestFont(page)).offenders).toEqual([]);
    expect(await outsideSafeZone(page)).toEqual([]);
    // Кнопки керування відео неактивні, поки відео немає.
    await expect(sidebar(page).getByRole('button', { name: /Пауза/ })).toBeDisabled();
  });

  test('до події менше 5 хв — великого відліку в колонці немає; остання хвилина — «далі через»', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:56:00+02:00', 0);
    await expect(page.getByRole('timer')).toHaveCount(0);
    await expect(sidebar(page).locator('[data-tv-midnight-at]')).toContainText(
      'північ о 02:00 за вашим часом',
    );

    await page.evaluate(() =>
      (
        window as unknown as {
          __t2f: { timeMachine: { set(o: { at: string; speed: number }): void } };
        }
      ).__t2f.timeMachine.set({ at: '2027-01-01T00:14:30Z', speed: 0 }),
    );
    await expect(sidebar(page).locator('[data-tv-next-in]')).toContainText('далі через 0:30');
  });

  test('offline: відлік іде далі, у колонці тихий рядок', async ({ page, ytStub, context }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 1);
    await context.setOffline(true);
    await expect(sidebar(page).locator('[data-tv-offline]')).toContainText('Немає з’єднання');
    await expect(page.getByRole('timer')).toBeVisible();
    await context.setOffline(false);
    await expect(sidebar(page).locator('[data-tv-offline]')).toHaveCount(0);
  });

  test('зменшити рух: стіна опівночі без загоряння по черзі', async ({ page, ytStub }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openTv(page, ytStub, '2027-01-01T01:59:58+02:00', 1);
    await waitForTvMoment(page);
    await expect(page.locator('[data-first-row-wall][data-phase="lit"]')).toBeVisible();
    // Жодного «щойно загорілось» місця: руху немає.
    await expect(page.locator('[data-seat][data-fresh="true"]')).toHaveCount(0);
  });

  test('axe до півночі: без порушень', async ({ page, ytStub }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await expect(page.locator('[data-tv-card]').first()).toBeVisible();
    await expectAxeClean(page);
  });
});
