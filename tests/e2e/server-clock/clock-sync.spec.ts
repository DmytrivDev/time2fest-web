/**
 * SPEC-07 · integration build: the time machine is a view of the server test clock (AC-59 ... AC-61, AC-64).
 * Serial (`server-clock` project): every test moves the one shared server clock. Needs T2F_E2E_SERVER.
 * `window.__t2f.timeMachine.set/advance` POST the door asynchronously, so assertions poll the door GET.
 */
import type { Page } from '@playwright/test';
import { advance, getTime, setTime, waitForTimeApi } from '../fixtures/time';
import { SERVER, SKIP_REASON, getDoorClock, getNightRun, resetServer, setDoorClock, startNightRun } from '../fixtures/serverClock';
import { expect, test } from '../fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Paris', locale: 'uk-UA' });
test.describe.configure({ mode: 'serial', timeout: 90_000 });
test.skip(!SERVER, SKIP_REASON);

const MIDNIGHT_LONDON = Date.parse('2027-01-01T00:00:00Z');
const PARIS_2359 = Date.parse('2026-12-31T23:59:00+01:00');
const pageNow = async (page: Page) => Date.parse((await getTime(page)).at);

test.afterEach(async ({ request }, testInfo) => {
  // The reset reseeds the catalog (~12 s): give it its own budget instead of the leftover of the test's.
  testInfo.setTimeout(testInfo.timeout + 60_000);
  await resetServer(request);
});

test.describe('SPEC-07 · server clock and the time machine', () => {
  test('AC-59: server clock 23:59:00 Paris - the page starts from it, not from the default start', async ({ page, request }) => {
    await setDoorClock(request, { at: PARIS_2359, speed: 1 });
    await page.goto('/');
    await waitForTimeApi(page);
    await expect.poll(async () => Math.abs((await pageNow(page)) - (await getDoorClock(request)).now), { timeout: 10_000 }).toBeLessThan(1_500);
    expect(Math.abs((await pageNow(page)) - PARIS_2359)).toBeLessThan(45_000); // elapsed since the door was set (cold page load); the default start is days away
    await expect(page.locator('[data-caption-timer]:visible').first()).toBeVisible();
  });

  test('AC-59: without ?t= the page takes the server clock state, not sessionStorage', async ({ page, request }) => {
    const at = MIDNIGHT_LONDON - 600_000;
    await setDoorClock(request, { at, speed: 0 });
    await page.addInitScript(() => sessionStorage.setItem('t2f.timeMachine', JSON.stringify({ at: '2020-01-01T00:00:00Z', speed: 1 })));
    await page.goto('/');
    await waitForTimeApi(page);
    await expect.poll(async () => Math.abs((await pageNow(page)) - at), { timeout: 10_000 }).toBeLessThan(1_500);
  });

  test('AC-60: ?t= and ?speed= reach the door and leave the URL', async ({ page, request }) => {
    const at = MIDNIGHT_LONDON - 120_000;
    await page.goto(`/?t=${encodeURIComponent(new Date(at).toISOString())}&speed=0`);
    await waitForTimeApi(page);
    await expect.poll(async () => (await getDoorClock(request)).speed).toBe(0);
    expect(Math.abs((await getDoorClock(request)).now - at)).toBeLessThan(1_000);
    await expect.poll(() => new URL(page.url()).search).not.toMatch(/[?&](t|speed)=/);
    expect(Math.abs((await pageNow(page)) - at)).toBeLessThan(1_500);
  });

  test('AC-60: __t2f.timeMachine.set and advance - door state equals page state within 1 s', async ({ page, request }) => {
    await page.goto('/');
    await waitForTimeApi(page);
    const at = MIDNIGHT_LONDON - 300_000;
    await setTime(page, { at: new Date(at).toISOString(), speed: 0 });
    await expect.poll(async () => (await getDoorClock(request)).speed).toBe(0);
    await expect.poll(async () => Math.abs((await getDoorClock(request)).now - at), { timeout: 10_000 }).toBeLessThan(1_000);
    await advance(page, 90_000);
    await expect.poll(async () => Math.abs((await getDoorClock(request)).now - (at + 90_000)), { timeout: 10_000 }).toBeLessThan(1_000);
    expect(Math.abs((await pageNow(page)) - (await getDoorClock(request)).now)).toBeLessThan(1_000);
  });

  test('AC-60: the time machine panel (pause, midnight, speed) reaches the door', async ({ page, request }) => {
    // «Північ» jumps to the NEXT midnight from now: start at 23:38 London so that it is London's (as in us8).
    await setDoorClock(request, { at: MIDNIGHT_LONDON - 22 * 60_000, speed: 1 });
    await page.goto('/?panel=1');
    await waitForTimeApi(page);
    const panel = page.getByRole('dialog', { name: 'Машина часу' });
    await expect(panel).toBeVisible();
    await panel.getByRole('radio', { name: 'Пауза' }).click();
    await expect.poll(async () => (await getDoorClock(request)).speed).toBe(0);
    await panel.getByRole('button', { name: 'Північ', exact: true }).click();
    await expect.poll(async () => Math.abs((await getDoorClock(request)).now - MIDNIGHT_LONDON), { timeout: 10_000 }).toBeLessThan(1_500);
    await panel.getByRole('radio', { name: '×10' }).click();
    await expect.poll(async () => (await getDoorClock(request)).speed).toBe(10);
    // Leave a quiet page: ×10 through London's midnight keeps the celebration animating during teardown.
    await setDoorClock(request, { frozen: true });
  });

  test('AC-61: a door change from outside - the page follows within 2 s; frozen means speed 0', async ({ page, request }) => {
    await page.goto('/');
    await waitForTimeApi(page);
    const at = MIDNIGHT_LONDON - 3_600_000;
    await setDoorClock(request, { at, speed: 1 });
    const t0 = Date.now();
    await expect
      .poll(async () => Math.abs((await pageNow(page)) - (at + (Date.now() - t0))), { timeout: 4_000, intervals: [100] })
      .toBeLessThan(2_500);
    await setDoorClock(request, { at, frozen: true });
    await expect.poll(async () => (await getTime(page)).speed, { timeout: 4_000, intervals: [100] }).toBe(0);
    const a = await pageNow(page);
    await page.waitForTimeout(1_500);
    expect(Math.abs((await pageNow(page)) - a)).toBeLessThan(100);
  });

  test('AC-64: jump to 5 s before a zone midnight - a run-recorder row within 2 s after midnight', async ({ page, request }) => {
    await startNightRun(request, { speed: 1, from: MIDNIGHT_LONDON - 60_000 });
    await page.goto('/');
    await waitForTimeApi(page);
    await setTime(page, { at: new Date(MIDNIGHT_LONDON - 5_000).toISOString(), speed: 1 });
    await expect
      .poll(async () => Math.abs((await getDoorClock(request)).now - (MIDNIGHT_LONDON - 5_000)), { timeout: 10_000 })
      .toBeLessThan(3_000);
    const nearMidnight = async () => (await getNightRun(request)).records.filter((r) => Math.abs(r.plannedAt - MIDNIGHT_LONDON) <= 1_000);
    await expect.poll(async () => (await nearMidnight()).length, { timeout: 20_000, intervals: [500] }).toBeGreaterThan(0);
    for (const rec of await nearMidnight()) {
      // `plannedAt` and `at` are both server (virtual) time; `startedAt` is real wall-clock time — a different scale.
      // At speed 1 the server lateness equals the real one.
      expect(rec.at - rec.plannedAt).toBeGreaterThanOrEqual(0);
      expect(rec.at - rec.plannedAt).toBeLessThanOrEqual(2_000);
    }
  });
});
