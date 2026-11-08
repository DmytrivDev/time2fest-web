/**
 * US7 — «Режим вечірки на телевізорі» (`/tv`, quickstart 11; T123). Проєкт `tv`, 1920×1080.
 * Той самий ефір, що на головній: «+15 с» — «<Країна> зустріла Новий рік», штамп з QR і видимою короткою адресою,
 * привітання Першого ряду по черзі; чату й хедера немає; контур фокуса ≥ 4 px; початковий фокус — картка в ефірі;
 * стрілки / Enter / Esc (Esc → головна); відео ≈ 65% ширини (дошка `TV-Party-New`, рішення 2026-11-06).
 * Розміри з дошки, затвердженої власником: поля 32 / 28 px і текст від 12 px (позначка «Програма») замість
 * колишніх 96/54 і 22 px.
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
const SAFE_X = 24;
const SAFE_Y = 24;
const MIN_FONT_PX = 12;
const MIN_FOCUS_PX = 4;

const sidebar = (page: Page) => page.locator('[data-tv-sidebar]');
const met = (page: Page) => page.locator('[data-tv-met]');

/** Пояснення режиму вже бачили (перший захід перевіряє окремий тест). */
async function skipWelcome(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('t2f:tv', JSON.stringify({ state: { show: 'all', welcomed: true }, version: 1 }));
    } catch {
      /* без сховища — пояснення покажеться */
    }
  });
}

async function openTv(page: Page, ytStub: YouTubeStub, iso: string, speed = 1, welcomed = true) {
  if (welcomed) await skipWelcome(page);
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
      if (size < 12) offenders.push(`${el.tagName.toLowerCase()} ${size}px «${text.slice(0, 40)}»`);
    }
    return { min, offenders };
  });
}

/** Видимі (з урахуванням обрізання прокруткою) елементи поза полями екрана: плеєр і його слот можуть іти до краю. */
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
        // Смуга таймлайну свідомо йде до краю екрана: картки за межами затемнюються, а не обрізаються.
        if (el.closest('[data-player-host], [data-player-slot], [data-tv-scene], [data-tv-strip]')) continue;
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

/** Чекає першого кадру з «<Країна> зустріла Новий рік», штампом з QR і привітанням Першого ряду; повертає віртуальний час. */
async function waitForTvMoment(page: Page, timeout = 30_000): Promise<number> {
  const handle = await page.waitForFunction(
    () => {
      const met = document.querySelector('[data-tv-met]');
      const stamp = document.querySelector('[data-stamp="tv"]');
      const wall = document.querySelector('[data-tv-greetings]');
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
  test('розкладка: відео ≈ 65% ширини, чату й хедера немає, один плеєр, нічого поверх відео', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);

    const box = await expectPlayerMinSize(page);
    expect(box.width / 1920, 'відео ≥ 60% ширини').toBeGreaterThanOrEqual(0.6);
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

    // Колонка: логотип, один відлік, «Зараз», вкладки, «Що показувати», керування, попередження про спалахи.
    await expect(sidebar(page).getByRole('link', { name: /Time2Fest/ })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveCount(1);
    await expect(sidebar(page)).toContainText('Зараз: Лондон');
    await expect(sidebar(page).getByRole('tab')).toHaveText(['Як святкувати', 'Перший ряд', 'Рейтинг']);
    await expect(sidebar(page).getByRole('button', { name: 'Усе свято' })).toHaveAttribute('aria-pressed', 'true');
    await expect(sidebar(page).getByRole('button', { name: /Звук/ })).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: 'На весь екран' })).toBeVisible();
    await expect(sidebar(page).getByRole('link', { name: 'Вийти' })).toBeVisible();
    await expect(sidebar(page).getByRole('button', { name: /Пауза/ })).toHaveCount(0);
    await expect(sidebar(page)).toContainText('Трансляції феєрверків можуть містити спалахи');
    // Підказка клавіш під таймлайном.
    await expect(page.locator('[data-tv-hints]')).toContainText('вийти з режиму вечірки');
  });

  test('перший захід: пояснення режиму замість вкладок; «Зрозуміло · OK» — більше не показуємо', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0, false);
    const welcome = sidebar(page).locator('[data-tv-welcome]');
    await expect(welcome).toContainText('Екран працює сам');
    await expect(welcome.getByRole('img', { name: /QR-код/ })).toBeVisible();
    await expect(sidebar(page).getByRole('tab')).toHaveCount(0);
    await welcome.getByRole('button', { name: 'Зрозуміло · OK' }).click();
    await expect(welcome).toHaveCount(0);
    await expect(sidebar(page).getByRole('tab')).toHaveCount(3);
    await page.reload();
    await waitForTimeApi(page);
    await expect(sidebar(page).getByRole('tab')).toHaveCount(3);
    await expect(sidebar(page).locator('[data-tv-welcome]')).toHaveCount(0);
  });

  test('розміри з дошки й поля екрана — до півночі і опівночі', async ({ page, ytStub }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await expect(page.locator('[data-tv-card]').first()).toBeVisible();

    let fonts = await smallestFont(page);
    expect(fonts.offenders, 'текст менший за 12 px').toEqual([]);
    expect(fonts.min).toBeGreaterThanOrEqual(MIN_FONT_PX);
    expect(await outsideSafeZone(page), 'елементи поза полями екрана').toEqual([]);

    // Вкладки «Як святкувати» і «Перший ряд».
    await expect(sidebar(page).getByRole('heading', { name: /Як святкувати · / })).toBeVisible();
    await sidebar(page).getByRole('tab', { name: 'Перший ряд' }).click();
    await expect(sidebar(page).locator('[data-tv-buy]')).toContainText('Скануй телефоном');
    fonts = await smallestFont(page);
    expect(fonts.offenders).toEqual([]);
    expect(await outsideSafeZone(page)).toEqual([]);

    // Опівночі: штамп, QR, привітання.
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

  test('«+15 с»: «<Країна> зустріла Новий рік», штамп з QR і видимою адресою, привітання Першого ряду — у межах 1 с', async ({
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
    await expect(stamp).toContainText(/time2fest\.com\/s\/\S{4}/);
    await expect(stamp.getByText('Скануй, щоб поділитися')).toBeVisible();
    // Кнопок «Поділитися» в штампа на ТВ немає: лише QR.
    await expect(stamp.getByRole('button')).toHaveCount(0);
    // Низ QR «поділитися» — на рівні низу листівки (± 2 px).
    const bottoms = await stamp.evaluate((el) => {
      const art = el.querySelector('[data-stamp-art]')!.getBoundingClientRect();
      const qr = el.querySelector('figure')!.getBoundingClientRect();
      return [art.bottom, qr.bottom];
    });
    expect(Math.abs(bottoms[0]! - bottoms[1]!)).toBeLessThanOrEqual(2);

    // Привітання Першого ряду: одне, змінюється кожні 15 с; списку учасників немає.
    const greet = page.locator('[data-tv-greetings]');
    await expect(greet.locator('[data-tv-greeting]')).toHaveCount(1);
    const first = await greet.locator('[data-tv-greeting]').getAttribute('data-tv-greeting');
    await expect
      .poll(async () => greet.locator('[data-tv-greeting]').getAttribute('data-tv-greeting'), { timeout: 20_000 })
      .not.toBe(first);
    await expect(page.locator('[data-first-row-wall]')).toHaveCount(0);

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

  test('початковий фокус — картка в ефірі; стрілки, Enter, контур ≥ 4 px', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    const onAir = page.locator('[data-tv-card][aria-current="true"]');
    await expect(onAir).toBeFocused();
    await expect(onAir).toContainText('Лондон');

    const ring = async () =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const cs = getComputedStyle(el);
        return { width: parseFloat(cs.outlineWidth), style: cs.outlineStyle };
      });
    let r = await ring();
    expect(r.style).not.toBe('none');
    expect(r.width).toBeGreaterThanOrEqual(MIN_FOCUS_PX);

    // → — наступна картка таймлайну; ← — назад; на відео фокус не потрапляє.
    await page.keyboard.press('ArrowRight');
    await expect(onAir).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-tv-card'))).toBe(true);
    await page.keyboard.press('ArrowLeft');
    await expect(onAir).toBeFocused();
    await page.keyboard.press('ArrowUp');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-player-host]'))).toBe(false);
    r = await ring();
    expect(r.width).toBeGreaterThanOrEqual(MIN_FOCUS_PX);

    // Вкладки: → перемикає на «Перший ряд».
    await page.getByRole('tab', { name: 'Як святкувати' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Перший ряд' })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Перший ряд' })).toHaveAttribute('aria-selected', 'true');

    // Enter на «Звук» вмикає звук у тому самому плеєрі.
    await page.getByRole('button', { name: /Звук/ }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await ytStub.counters()).unMute).toBe(1);
    expect((await ytStub.counters()).created).toBe(1);
  });

  test('таймлайн завжди відкритий: програма й графік, фільтр «Усі · З трансляціями · Мій графік»; Esc веде на головну', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    const timeline = page.locator('[data-tv-timeline]');
    await expect(timeline.getByRole('heading', { name: 'Свято по поясах' })).toBeVisible();
    await expect(timeline.getByRole('progressbar', { name: 'Прогрес свята' })).toBeVisible();
    await expect(timeline.getByRole('button', { name: 'Усі' })).toHaveAttribute('aria-pressed', 'true');
    // Картки: час з поясом, позначка «Програма».
    const list = timeline.getByRole('list', { name: /Таймлайн свята/ });
    const current = list.locator('[aria-current="true"]');
    await expect(current).toContainText('Лондон');
    await expect(current).toContainText('UTC+0');
    await expect(current).toContainText('Програма');
    // Минулі події ліворуч за краєм, перша видима — поточна.
    const firstVisible = await list.evaluate((el) => {
      const left = el.getBoundingClientRect().left;
      const cards = [...el.querySelectorAll<HTMLElement>('[data-tv-card]')];
      // Поза затемненим краєм смуги (32 px).
      return cards.find((c) => c.getBoundingClientRect().left > left + 20)?.textContent ?? '';
    });
    expect(firstVisible).toContain('Лондон');

    // «З трансляціями» не ховає поточну подію; «Мій графік» без подій графіка — лише вона.
    await timeline.getByRole('button', { name: 'З трансляціями' }).click();
    await expect(timeline.getByRole('button', { name: 'З трансляціями' })).toHaveAttribute('aria-pressed', 'true');
    await expect(current).toContainText('Лондон');
    await timeline.getByRole('button', { name: 'Мій графік' }).click();
    await expect(list.locator('[data-tv-card]')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/(\?|$)/);
    await expect(page).not.toHaveURL(/\/tv/);
  });

  test('«Змінити трансляцію»: трансляції поясу; OK — дивитися до наступної півночі; «Назад» спершу закриває список', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await sidebar(page).getByRole('button', { name: 'Змінити трансляцію' }).click();
    const panel = sidebar(page).locator('[data-tv-panel="streams"]');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[aria-current="true"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/tv\/?(\?|$)/);
    await expect(sidebar(page).getByRole('button', { name: 'Змінити трансляцію' })).toBeFocused();

    await sidebar(page).getByRole('button', { name: 'Змінити трансляцію' }).click();
    const other = panel.locator('[data-tv-stream]:not([aria-current="true"])').first();
    const title = (await other.locator('b').innerText()).trim();
    await other.click();
    await expect(panel).toHaveCount(0);
    await expect(sidebar(page).locator('[data-tv-now]')).toContainText(title);
    // Той самий плеєр: відео міняється без нового iframe.
    expect((await ytStub.counters()).created).toBe(1);
  });

  test('«На весь екран»: лише відео на все вікно, без колонки й таймлайну; Esc — назад, фокус на кнопці', async ({ page, ytStub }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await sidebar(page).getByRole('button', { name: 'На весь екран' }).click();
    await expect(page.locator('[data-tv-root][data-full]')).toHaveCount(1);
    await expect(sidebar(page)).toBeHidden();
    await expect(page.locator('[data-tv-timeline]')).toBeHidden();
    const box = await playerBox(page);
    const view = page.viewportSize()!;
    expect(box && Math.round(box.width)).toBe(view.width);
    expect(box && Math.round(box.height)).toBe(view.height);
    await expectNothingOverPlayer(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-tv-root][data-full]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/tv\/?(\?|$)/);
    await expect(sidebar(page).getByRole('button', { name: 'На весь екран' })).toBeFocused();
  });

  test('менше вікно (1366 × 768): макет масштабується цілим, відео над слотом, колонки 65 / 35', async ({ page, ytStub }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await expect(page.locator('[data-tv-card]').first()).toBeVisible();
    const g = await page.evaluate(() => {
      const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
      return { root: r('[data-tv-root]'), side: r('[data-tv-sidebar]'), slot: r('[data-player-slot]'), host: r('[data-player-host]') };
    });
    expect(Math.round(g.root.width)).toBe(1366);
    expect(Math.round(g.root.height)).toBe(768);
    expect(g.side.left / 1366).toBeCloseTo(0.65, 2);
    expect(Math.abs(g.slot.left - g.host.left) + Math.abs(g.slot.width - g.host.width)).toBeLessThanOrEqual(1);
  });

  test('широке вікно (1920 × 912): таймлайн компактний, відео більше; перехід до таймлайну — повні картки, відео в рамці по центру', async ({
    page,
    ytStub,
  }) => {
    await page.setViewportSize({ width: 1920, height: 912 });
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    const root = page.locator('[data-tv-root]');
    await expect(root).toHaveAttribute('data-roomy', '');
    await expect(root).not.toHaveAttribute('data-tl-active', '');
    const geo = () =>
      page.evaluate(() => {
        const r = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const area = document.querySelector('[data-player-slot]')!.parentElement!.getBoundingClientRect().width;
        return { frame: r('[data-player-slot]').width, area, card: r('[data-tv-card]').height };
      });
    await expect.poll(async () => (await geo()).card).toBeLessThan(70);
    const compact = await geo();
    expect(compact.frame / compact.area).toBeGreaterThan(0.9);

    // Пульт: → — людина перейшла до таймлайну.
    await page.keyboard.press('ArrowRight');
    await expect(root).toHaveAttribute('data-tl-active', '');
    await expect.poll(async () => (await geo()).card).toBeGreaterThan(120);
    const open = await geo();
    expect(open.frame).toBeLessThan(compact.frame - 50);
    // Відео над слотом і далі (хост іде за слотом).
    const box = await playerBox(page);
    const slot = await page.locator('[data-player-slot]').boundingBox();
    expect(Math.abs(box!.x - slot!.x) + Math.abs(box!.width - slot!.width)).toBeLessThanOrEqual(2);

    // Фокус у колонці праворуч — таймлайн знову компактний.
    await sidebar(page).getByRole('tab', { name: 'Як святкувати' }).focus();
    await expect(root).not.toHaveAttribute('data-tl-active', '');
  });

  test('смуга: ← → гортають по одній картці, контур крайньої картки не обрізаний; мишею — перетягування без кліку', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    const strip = page.locator('[data-tv-strip]');
    const visibleCards = () =>
      strip.evaluate((el) => {
        const s = el.getBoundingClientRect();
        return [...el.querySelectorAll<HTMLElement>('[data-tv-card]')].filter((c) => {
          const r = c.getBoundingClientRect();
          return r.left >= s.left && r.right <= s.right;
        }).length;
      });
    const n = await visibleCards();
    for (let i = 0; i < n + 1; i++) await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    // Картка у фокусі видима разом із контуром (≥ 6 px до краю смуги).
    const edge = await page.evaluate(() => {
      const a = document.activeElement!.getBoundingClientRect();
      const s = document.querySelector('[data-tv-strip]')!.getBoundingClientRect();
      return { left: a.left - s.left, right: s.right - a.right };
    });
    expect(edge.right).toBeGreaterThanOrEqual(6);
    const before = await strip.evaluate((el) => el.scrollLeft);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(600);
    const step = (await strip.evaluate((el) => el.scrollLeft)) - before;
    expect(step).toBeGreaterThan(200);
    expect(step).toBeLessThan(260); // одна картка (236 + 12)

    // Мишею: перетягування гортає смугу, і клік по картці після нього не спрацьовує.
    const box = (await strip.boundingBox())!;
    const left0 = await strip.evaluate((el) => el.scrollLeft);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 300, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    expect(await strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(left0 + 250);
    await expect(sidebar(page).locator('[data-tv-nopass]')).toHaveCount(0);
  });

  test('«Мій графік» без пасу: картка з QR на сторінку пасу; ефір далі «Усе свято»', async ({ page, ytStub }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await sidebar(page).getByRole('button', { name: 'Мій графік' }).click();
    const card = sidebar(page).locator('[data-tv-nopass]');
    await expect(card).toContainText('Дивись лише ті півночі, які обрав');
    await expect(card).toContainText('time2fest.com/pass');
    await expect(card.getByRole('img', { name: /QR-код/ })).toBeVisible();
    await expect(sidebar(page)).toContainText('Зараз: Лондон');
    await sidebar(page).getByRole('button', { name: 'Усе свято' }).click();
    await expect(card).toHaveCount(0);
  });

  test('«Вийти» веде на головну; на головній «Режим вечірки» веде на /tv', async ({
    page,
    ytStub,
  }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await sidebar(page).getByRole('link', { name: 'Вийти' }).click();
    await expect(page).not.toHaveURL(/\/tv/);
    await waitForTimeApi(page);

    // Кнопка під плеєром; у футері теж є «Режим вечірки» (футер B, 2026-11-08) — тому в межах <main>.
    await page.getByRole('main').getByRole('link', { name: 'Режим вечірки' }).click();
    await expect(page).toHaveURL(/\/tv\/?(\?|$)/);
    await expect(page.locator('[data-tv-root]')).toBeVisible();
  });

  test('без трансляції: на місці плеєра сцена відліку, у колонці найближча трансляція з «Перемкнути», хост плеєра схований', async ({
    page,
  }) => {
    // 00:20 UTC: ефір уже в наступному слоті (Азорські острови, трансляції немає).
    await skipWelcome(page);
    await gotoAt(page, '2027-01-01T00:20:00Z', 0, '/tv/');
    await expect(page.locator('[data-tv-scene]')).toBeVisible();
    await expect(sidebar(page)).toHaveAttribute('data-tv-mode', 'scene');
    await expect(sidebar(page).locator('[data-tv-status="countdown-only"]')).toBeVisible();
    await expect(sidebar(page).locator('[data-tv-nearest]').getByRole('button', { name: 'Перемкнути' })).toBeVisible();
    // Один відлік на сторінку — у сцені; у колонці великого відліку немає.
    await expect(page.getByRole('timer')).toHaveCount(1);
    await expect(sidebar(page).getByRole('timer')).toHaveCount(0);
    expect(await playerBox(page)).toBeNull();
    expect((await smallestFont(page)).offenders).toEqual([]);
    expect(await outsideSafeZone(page)).toEqual([]);
    // Звук неактивний, поки відео немає.
    await expect(sidebar(page).getByRole('button', { name: /Звук/ })).toBeDisabled();
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

  test('зменшити рух: привітання опівночі змінюються без перегортання', async ({ page, ytStub }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openTv(page, ytStub, '2027-01-01T01:59:58+02:00', 1);
    await waitForTvMoment(page);
    const anim = await page
      .locator('[data-tv-greeting]')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(anim).toBe('none');
  });

  test('телефон: інформаційна сторінка замість режиму вечірки, без плеєра', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0, '/tv/');
    // `/tv` на телефоні веде на сторінку сайту `/tv-info/` (шапка, чат); машина часу переходить разом.
    await expect(page).toHaveURL(/\/tv-info\/\?t=/);
    const info = page.locator('[data-tv-phone]');
    await expect(info.getByRole('heading', { level: 1 })).toHaveText('Новий рік на великому екрані — для всієї компанії');
    await expect(info).toContainText('time2fest.com/tv');
    await expect(info.getByRole('button', { name: 'Скопіювати посилання' })).toBeVisible();
    await expect(info.getByRole('link', { name: 'Скласти графік' })).toHaveAttribute('href', /\/schedule\//);
    // Чат доступний — згорнутий внизу; кнопки не виходять за екран.
    await expect(page.getByRole('button', { name: /Розгорнути чат/ })).toBeVisible();
    const overflow = await page.evaluate(() => [...document.querySelectorAll('[data-tv-phone] button, [data-tv-phone] a')].some((b) => b.getBoundingClientRect().right > window.innerWidth + 0.5));
    expect(overflow).toBe(false);
    await expect(page.locator('[data-tv-root]')).toHaveCount(0);
    await expect(page.locator('[data-player-host] iframe')).toHaveCount(0);
    await expectAxeClean(page);
  });

  test('«Про режим» на екрані вечірки веде на /tv-info/; десктопна /tv-info/ — «Увімкнути режим вечірки» і «Відкрити тут ›» ведуть на /tv', async ({ page, ytStub }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await expect(sidebar(page).getByRole('link', { name: /Про режим вечірки/ })).toHaveAttribute('href', /\/tv-info\/?$/);
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0, '/tv-info/');
    const info = page.locator('[data-tv-phone]');
    await expect(info.getByRole('link', { name: 'Увімкнути режим вечірки' })).toHaveAttribute('href', /\/tv\/?$/);
    await expect(info.getByRole('link', { name: /Відкрити тут/ })).toBeVisible();
    await expect(info.getByRole('button', { name: 'Скопіювати посилання' })).toBeVisible();
    await expect(info.getByRole('link', { name: 'Скласти графік' })).toHaveAttribute('href', /\/schedule\//);
    await expectAxeClean(page);
  });

  test('телефон: «Увімкнути режим вечірки» сховано (на телефоні режиму немає)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAt(page, '2027-01-01T01:38:00+02:00', 0, '/tv-info/');
    await expect(page.locator('[data-tv-phone]').getByRole('link', { name: 'Увімкнути режим вечірки' })).toBeHidden();
  });

  test('axe до півночі: без порушень', async ({ page, ytStub }) => {
    await openTv(page, ytStub, '2027-01-01T01:38:00+02:00', 0);
    await expect(page.locator('[data-tv-card]').first()).toBeVisible();
    await expectAxeClean(page);
  });
});
