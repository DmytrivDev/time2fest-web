/**
 * Фікстура «машини часу» (contracts/time-machine.md): обгортки над `window.__t2f` тестової збірки.
 * Працює лише з `pnpm dev:test` / `build:test` (NEXT_PUBLIC_ENV=test).
 */
import type { Page } from '@playwright/test';

export type ISO = string;

export interface TimeMachineState {
  at: ISO;
  speed: number;
  source: 'machine' | 'server';
}

interface T2FTestApi {
  timeMachine: {
    get(): TimeMachineState;
    set(opts: { at?: ISO; speed?: number }): void;
    advance(ms: number): void;
  };
  resetGuest(): void;
  setPayResult(r: 'success' | 'pending' | 'declined' | 'soldout' | 'expired'): void;
  setChatAvailable(ok: boolean): void;
}

/** Без глобального доповнення `Window` (його оголошує lib/time/testApi.ts) — лише локальне приведення. */
type WithApi = { __t2f?: T2FTestApi };

/** Стартовий момент без параметрів (уточнення 2026-10-26): до півночі Лондона 22 хв. */
export const DEFAULT_START: ISO = '2027-01-01T01:38:00+02:00';

/** Чекає, поки тестова збірка виставить `window.__t2f`. */
export async function waitForTimeApi(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForFunction(() => Boolean((window as unknown as WithApi).__t2f?.timeMachine), undefined, { timeout });
}

/**
 * Відкрити сторінку у віртуальний момент `iso` зі швидкістю `speed` (`0` — заморожено).
 * Приклад: `await gotoAt(page, '2027-01-01T01:59:30+02:00', 10)`.
 */
export async function gotoAt(page: Page, iso: ISO, speed = 1, path = '/'): Promise<void> {
  const url = new URL(path, 'http://placeholder');
  url.searchParams.set('t', iso);
  url.searchParams.set('speed', String(speed));
  await page.goto(`${url.pathname}${url.search}${url.hash}`);
  await waitForTimeApi(page);
}

export async function getTime(page: Page): Promise<TimeMachineState> {
  await waitForTimeApi(page);
  return page.evaluate(() => (window as unknown as WithApi).__t2f!.timeMachine.get());
}

/** Перемотати/змінити швидкість без перезавантаження. */
export async function setTime(page: Page, opts: { at?: ISO; speed?: number }): Promise<void> {
  await waitForTimeApi(page);
  await page.evaluate((o) => (window as unknown as WithApi).__t2f!.timeMachine.set(o), opts);
}

/** Миттєвий стрибок уперед на `ms`. */
export async function advance(page: Page, ms: number): Promise<void> {
  await waitForTimeApi(page);
  await page.evaluate((d) => (window as unknown as WithApi).__t2f!.timeMachine.advance(d), ms);
}

/** Віртуальний «зараз» у мс epoch. */
export async function nowMs(page: Page): Promise<number> {
  return Date.parse((await getTime(page)).at);
}

export async function resetGuest(page: Page): Promise<void> {
  await waitForTimeApi(page);
  await page.evaluate(() => (window as unknown as WithApi).__t2f!.resetGuest());
}

export async function setPayResult(
  page: Page,
  r: 'success' | 'pending' | 'declined' | 'soldout' | 'expired',
): Promise<void> {
  await waitForTimeApi(page);
  await page.evaluate((v) => (window as unknown as WithApi).__t2f!.setPayResult(v), r);
}

export async function setChatAvailable(page: Page, ok: boolean): Promise<void> {
  await waitForTimeApi(page);
  await page.evaluate((v) => (window as unknown as WithApi).__t2f!.setChatAvailable(v), ok);
}

/** Зсув годинника пристрою (SC-002: події мають іти від серверного часу, не від `Date`). */
export async function shiftDeviceClock(page: Page, ms: number): Promise<void> {
  await page.addInitScript((delta) => {
    const RealDate = Date;
    const realNow = RealDate.now.bind(RealDate);
    function ShiftedDate(this: unknown, ...args: unknown[]) {
      const d = args.length === 0 ? new RealDate(realNow() + delta) : new (RealDate as unknown as new (...a: unknown[]) => Date)(...args);
      return new.target ? d : d.toString();
    }
    ShiftedDate.prototype = RealDate.prototype;
    ShiftedDate.now = () => realNow() + delta;
    ShiftedDate.parse = RealDate.parse;
    ShiftedDate.UTC = RealDate.UTC;
    (window as unknown as { Date: unknown }).Date = ShiftedDate;
  }, ms);
}
