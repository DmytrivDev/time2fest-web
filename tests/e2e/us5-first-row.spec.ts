/**
 * US5 — «Перший ряд» на імітації оплати (T112, FR-060…): модуль зі станами, форма з утриманням на 10 хв,
 * продовження, результати оплати (success/pending/declined/soldout/expired), гонка Лондона, зміна ціни,
 * закриття продажу за 15 хв до півночі, правило однієї коралової кнопки.
 *
 * ПОКИ НЕ ЗАПУСКАЄТЬСЯ: рішення власника — e2e пишемо, але не проганяємо; перевірка — typecheck, lint, юніти, build.
 * Часи й id подій беруться з `data/schedule.json`; сторінка країни — зі `data/countries.json`.
 */
import type { Locator, Page } from '@playwright/test';
import countriesFile from '../../data/countries.json' with { type: 'json' };
import scheduleFile from '../../data/schedule.json' with { type: 'json' };
import { advance, gotoAt, setPayResult, waitForTimeApi } from './fixtures/time';
import { expect, test } from './fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.beforeEach(async ({ page }, testInfo) => {
  void page;
  test.skip(
    testInfo.project.name === 'tv' || testInfo.project.name === 'prod',
    'US5: телефон і десктоп',
  );
});
test.describe.configure({ timeout: 90_000 });

const MIN = 60_000;
const SEC = 1_000;

interface Ev {
  id: string;
  midnightUtc: string;
}
function eventById(id: string): Ev {
  for (const z of (scheduleFile as { zones: { countries: { cities: { events: Ev[] }[] }[] }[] })
    .zones) {
    for (const c of z.countries)
      for (const city of c.cities) for (const e of city.events) if (e.id === id) return e;
  }
  throw new Error(`немає події ${id} у schedule.json`);
}
const LONDON = eventById('evt_london_2027');
const LONDON_MS = Date.parse(LONDON.midnightUtc);
const iso = (ms: number) => new Date(ms).toISOString();
const countryList = ((countriesFile as { countries?: unknown }).countries ?? countriesFile) as {
  iso: string;
  slug: string;
}[];
const GB_SLUG = countryList.find((c) => c.iso === 'GB')?.slug ?? 'united-kingdom';
const LONDON_PAGE = `/country/${GB_SLUG}/`;

const LS_KEY = 't2f:guest:v1';
/** Сторінка країни Лондона за 40 хв до півночі: продаж відкритий, Лондон — 9 зайнято + місце 10. */
const OPEN_AT = iso(LONDON_MS - 40 * MIN);

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 768;
const strip = (page: Page) => page.locator('[data-first-row-strip]').first();
const win = (page: Page) => page.locator('[data-window="O-FIRST-ROW"]');
const payWin = (page: Page) => page.locator('[data-window="O-PAY"]');
const payBtn = (page: Page) => page.locator('[data-action="pay"]');

async function start(page: Page, at = OPEN_AT, path = LONDON_PAGE) {
  await gotoAt(page, at, 1, path);
  await page.evaluate((k) => localStorage.removeItem(k), LS_KEY);
  await page.reload();
  await waitForTimeApi(page);
  await expect(strip(page)).toBeVisible();
}

async function presetGuest(
  page: Page,
  firstRow: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  // Запис до завантаження застосунку: інакше persist-стор гостя встигає перезаписати localStorage до reload.
  await page.addInitScript(
    ([k, fr, ex]) => {
      if (sessionStorage.getItem('e2e:preset-applied')) return;
      sessionStorage.setItem('e2e:preset-applied', '1');
      const raw = localStorage.getItem(k as string);
      const parsed = raw ? JSON.parse(raw) : { state: {}, version: 1 };
      // Без `v` та `id` стор гостя відкидає збережене як несумісне (sanitizeGuest): буває, коли застосунок ще нічого не записав.
      parsed.state = {
        v: 1,
        id: 'g-e2e-us5',
        nightId: '2026-27',
        ...parsed.state,
        ...(ex as object),
        firstRow: { ...(parsed.state?.firstRow ?? {}), ...(fr as object) },
      };
      localStorage.setItem(k as string, JSON.stringify(parsed));
    },
    [LS_KEY, firstRow, extra] as const,
  );
  await page.reload();
  await waitForTimeApi(page);
  await expect(strip(page)).toBeVisible();
}

async function openForm(page: Page) {
  await strip(page).locator('[data-action="take"]').click();
  await expect(win(page)).toBeVisible();
}

async function fillForm(page: Page, v: { email?: string; name?: string; greeting?: string } = {}) {
  const w = win(page);
  await w.getByLabel('Email').fill(v.email ?? 'guest@example.com');
  await w.getByLabel('Ім’я на стіні').fill(v.name ?? 'Мирон');
  await w.getByLabel('Привітання').fill(v.greeting ?? 'З Новим роком!');
}

async function pay(page: Page) {
  await payBtn(page).click();
}

const variantOf = (loc: Locator) => loc.getAttribute('data-variant');
/** Кімната чату «Світ» (вкладка або перемикач). */
const worldRoom = (page: Page) =>
  page
    .getByRole('tab', { name: 'Світ' })
    .or(page.getByRole('radio', { name: 'Світ' }))
    .first();

test.describe('US5 · модуль «Перший ряд»', () => {
  test('сторінка країни Лондона: відкрито, лічильник «лишилось 1 з 10», $7,99, кнопки', async ({
    page,
  }) => {
    await start(page);
    const s = strip(page);
    await expect(s).toHaveAttribute('data-state', 'last3');
    await expect(s.locator('[data-row="counter"]')).toContainText('лишилось 1 з 10');
    await expect(s).toContainText('$7,99');
    await expect(s.locator('[data-action="take"]')).toHaveText('Зайняти місце');
    await expect(s.locator('[data-action="info"]')).toBeVisible();
  });

  test('Токіо: 4 зайнято, 6 вільних → open, $4,99', async ({ page }) => {
    const tokyo = eventById('evt_tokyo_2027');
    await start(page, iso(Date.parse(tokyo.midnightUtc) - 40 * MIN), '/');
    // На «/» модуль показує перший ряд події в ефірі; тут перевіряємо лише ціну/лічильник, якщо це Токіо.
    const s = strip(page);
    if ((await s.getAttribute('data-midnight')) === String(Date.parse(tokyo.midnightUtc))) {
      await expect(s.locator('[data-row="counter"]')).toContainText('лишилось 6 з 10');
      await expect(s).toContainText('$4,99');
    }
  });

  test('за 15 хв до півночі продаж закрито: closed, без лічильника й кнопки', async ({ page }) => {
    await start(page, iso(LONDON_MS - 20 * MIN));
    await expect(strip(page)).toHaveAttribute('data-state', 'last3');
    await advance(page, 5 * MIN);
    const s = strip(page);
    await expect(s).toHaveAttribute('data-state', 'closed');
    await expect(s).toContainText('Продаж закрито перед подією');
    await expect(s.locator('[data-row="counter"]')).toHaveCount(0);
    await expect(s.locator('[data-action="take"]')).toHaveCount(0);
  });
});

test.describe('US5 · форма й утримання', () => {
  test('«Зайняти місце» відкриває вікно: поля, емоція, «Місце тримаємо до», коралова «Оплатити»', async ({
    page,
  }) => {
    await start(page);
    await openForm(page);
    const w = win(page);
    await expect(w.getByLabel('Email')).toBeVisible();
    await expect(w.getByLabel('Ім’я на стіні')).toBeVisible();
    await expect(w.getByLabel('Привітання')).toBeVisible();
    await expect(w.getByRole('radio').first()).toBeVisible();
    await expect(w.locator('[data-row="hold-until"]')).toContainText('Місце тримаємо до');
    await expect(payBtn(page)).toContainText('Оплатити $7,99');
    expect(await variantOf(payBtn(page))).toBe('coral');
    if (isPhone(page)) await expect(page.getByRole('dialog').first()).toBeVisible();
  });

  test('правило однієї коралової: форма відкрита → «Оплатити» коралова, звук нейтральний', async ({
    page,
  }) => {
    await start(page);
    await openForm(page);
    expect(await variantOf(payBtn(page))).toBe('coral');
    // Решта видимих кнопок не коралові, окрім «Оплатити» (звук поступається вікну).
    const coral = page.locator('[data-variant="coral"]:visible');
    await expect(coral).toHaveCount(1);
  });

  test('коли звук коралова (muted), «Зайняти місце» — tonal', async ({ page }) => {
    await start(page);
    const take = strip(page).locator('[data-action="take"]');
    await expect(take).toBeVisible();
    // Коралових на екрані не більше однієї, і це не «Зайняти місце».
    expect(await variantOf(take)).not.toBe('coral');
    if ((await page.locator('[data-variant="coral"]:visible').count()) === 1) {
      expect(await variantOf(take)).toBe('tonal');
    }
  });

  test('валідація: порожня форма не платить і показує помилки', async ({ page }) => {
    await start(page);
    await openForm(page);
    await pay(page);
    await expect(win(page)).toBeVisible();
    await expect(win(page).getByText('Перевір email — схоже, в ньому помилка')).toBeVisible();
    await expect(win(page).getByText('Напиши ім’я — так тебе побачать на стіні')).toBeVisible();
    await fillForm(page, { greeting: 'зайди на https://x.io' });
    await pay(page);
    await expect(
      win(page).getByText('Привітання не пройшло модерацію — зміни текст'),
    ).toBeVisible();
  });

  test('за ≤2 хв до кінця — табло «Лишилось m:ss з 10 хвилин» і «Продовжити» (один раз)', async ({
    page,
  }) => {
    await start(page);
    await openForm(page);
    await expect(win(page).locator('[data-row="hold-board"]')).toHaveCount(0);
    await advance(page, 8 * MIN + 30 * SEC);
    await expect(win(page).locator('[data-row="hold-board"]')).toContainText('з 10 хвилин');
    const extend = win(page).locator('[data-action="extend"]');
    await expect(extend).toBeVisible();
    await extend.click();
    await expect(win(page).locator('[data-row="extended"]')).toContainText(
      'Продовжили — тримаємо до',
    );
    await expect(win(page).locator('[data-action="extend"]')).toHaveCount(0);
  });

  test('утримання минуло: «Час утримання вийшов — місце знову вільне.» і нове утримання', async ({
    page,
  }) => {
    // Токіо (6 вільних): у Лондоні останнє місце за 10 хв забирає імітований учасник (гонка) — там буде «Розпродано».
    const tokyo = eventById('evt_tokyo_2027');
    const jp = countryList.find((c) => c.iso === 'JP')?.slug ?? 'yaponiia';
    await start(page, iso(Date.parse(tokyo.midnightUtc) - 40 * MIN), `/country/${jp}/`);
    await openForm(page);
    await advance(page, 10 * MIN + 5 * SEC);
    const notice = win(page).locator('[data-row="notice"]');
    await expect(notice).toContainText('Час утримання вийшов — місце знову вільне.');
    await expect(win(page).locator('[data-row="hold-until"]')).toContainText('Місце тримаємо до');
  });

  test('зміна ціни: зафіксовано $4,99, зараз $7,99 → «Ціна змінилася»', async ({ page }) => {
    await start(page);
    await presetGuest(page, {
      [LONDON.id]: {
        hold: { seat: 10, until: Date.parse(OPEN_AT) + 30 * MIN, extended: false },
        priceLocked: 4.99,
      },
    });
    await openForm(page);
    await expect(win(page).locator('[data-row="price-changed"]')).toContainText(
      'Ціна змінилася: $7,99 замість $4,99',
    );
    await expect(payBtn(page)).toContainText('Оплатити $7,99');
  });
});

test.describe('US5 · результат оплати', () => {
  test('success: підтверджено, квиток, «Змінити напис чи емоцію», модуль mine, чат і кімната', async ({
    page,
  }) => {
    await start(page);
    await openForm(page);
    await fillForm(page);
    await setPayResult(page, 'success');
    await pay(page);
    const done = payWin(page);
    await expect(done).toContainText('Оплату підтверджено', { timeout: 10_000 });
    await expect(done.locator('[data-ticket]')).toBeVisible();
    await expect(done.getByRole('button', { name: 'Змінити напис чи емоцію' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(strip(page)).toHaveAttribute('data-state', 'mine');
    await expect(strip(page)).toContainText('Твоє місце');

    if (isPhone(page)) await page.getByRole('tab', { name: /^Чат/ }).click();
    // На сторінці країни чат відкривається в кімнаті країни; системне повідомлення — у «Світі» й «Першому ряду».
    await worldRoom(page).click();
    await expect(
      page.locator('[data-kind="system"]').filter({ hasText: 'тепер у першому ряду' }).first(),
    ).toBeVisible();
    await expect(
      page
        .getByRole('tab', { name: 'Перший ряд' })
        .or(page.getByRole('radio', { name: 'Перший ряд' }))
        .first(),
    ).toBeVisible();
  });

  test('опівночі +15 с у чаті з’являється привітальна картка Першого ряду', async ({ page }) => {
    await start(page);
    await openForm(page);
    await fillForm(page);
    await setPayResult(page, 'success');
    await pay(page);
    await expect(payWin(page)).toContainText('Оплату підтверджено', { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await advance(page, 40 * MIN + 16 * SEC);
    if (isPhone(page)) await page.getByRole('tab', { name: /^Чат/ }).click();
    await worldRoom(page).click();
    await expect(page.locator('[data-kind="greeting"]').first()).toContainText(
      'Time2Fest вітає з Новим роком',
    );
  });

  test('pending: «Чекаємо підтвердження оплати», через 30 с сайту — підтверджено', async ({
    page,
  }) => {
    await start(page);
    await openForm(page);
    await fillForm(page);
    await setPayResult(page, 'pending');
    await pay(page);
    await expect(payWin(page)).toContainText('Чекаємо підтвердження оплати', { timeout: 10_000 });
    await advance(page, 31 * SEC);
    await expect(payWin(page)).toContainText('Оплату підтверджено');
  });

  test('declined: «Оплата не пройшла — гроші не списано.», дані форми збережені', async ({
    page,
  }) => {
    await start(page);
    await openForm(page);
    await fillForm(page, { name: 'Олег' });
    await setPayResult(page, 'declined');
    await pay(page);
    await expect(win(page).locator('[data-row="notice"]')).toContainText(
      'Оплата не пройшла — гроші не списано.',
      { timeout: 10_000 },
    );
    await expect(win(page).getByLabel('Ім’я на стіні')).toHaveValue('Олег');
    await expect(win(page).getByLabel('Email')).toHaveValue('guest@example.com');
  });

  test('soldout: «Останнє місце щойно зайняли», «Гроші не списано.», «Розпродано»', async ({
    page,
  }) => {
    await start(page);
    await openForm(page);
    await fillForm(page);
    await setPayResult(page, 'soldout');
    await pay(page);
    const w = payWin(page);
    await expect(w).toContainText('Останнє місце щойно зайняли', { timeout: 10_000 });
    await expect(w).toContainText('Гроші не списано.');
    await expect(w).toContainText(/Перший ряд · .+ — розпродано\./);
  });

  test('expired: повернулися з оплати після спливу утримання → повідомлення про вихід часу', async ({
    page,
  }) => {
    await start(page);
    await openForm(page);
    await fillForm(page);
    await setPayResult(page, 'expired');
    await pay(page);
    await expect(win(page).locator('[data-row="notice"]')).toContainText(
      'Час утримання вийшов — місце знову вільне.',
      { timeout: 10_000 },
    );
  });

  test('гонка Лондона: форма тримає місце 10, +90 с учасник займає → оплата дає «розпродано»', async ({
    page,
  }) => {
    await start(page);
    await openForm(page); // утримує місце 10
    await fillForm(page);
    await advance(page, 95 * SEC);
    await setPayResult(page, 'success');
    await pay(page);
    const w = payWin(page);
    await expect(w).toContainText('Останнє місце щойно зайняли', { timeout: 10_000 });
    await expect(w).toContainText('Гроші не списано.');
    await page.keyboard.press('Escape');
    await expect(strip(page)).toHaveAttribute('data-state', 'soldout');
  });
});
