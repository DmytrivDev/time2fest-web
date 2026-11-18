/**
 * SPEC-07 · AC-4: a device clock shifted by +-1 h does not change the page time (difference from the unshifted page <= 1 s).
 * Serial (`server-clock`): the page time comes from the server clock that every test shares. Needs T2F_E2E_SERVER.
 */
import { getTime, shiftDeviceClock, waitForTimeApi } from '../fixtures/time';
import { SERVER, SKIP_REASON, resetServer, setDoorClock } from '../fixtures/serverClock';
import { expect, test } from '../fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.describe.configure({ timeout: 90_000 });
test.skip(!SERVER, SKIP_REASON);

const MIDNIGHT_LONDON = Date.parse('2027-01-01T00:00:00Z');
const HOUR = 3_600_000;

test.afterEach(async ({ request }) => {
  await resetServer(request);
});

test('AC-4: device clock +1 h / -1 h - page time differs from the unshifted page by <= 1 s', async ({ browser, request }) => {
  const at = MIDNIGHT_LONDON - 600_000;
  await setDoorClock(request, { at, speed: 0 });

  async function pageTime(shift: number): Promise<number> {
    const ctx = await browser.newContext({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
    const page = await ctx.newPage();
    if (shift !== 0) await shiftDeviceClock(page, shift);
    await page.goto('/');
    await waitForTimeApi(page);
    await expect.poll(async () => Math.abs(Date.parse((await getTime(page)).at) - at), { timeout: 10_000 }).toBeLessThan(1_500);
    const t = Date.parse((await getTime(page)).at);
    await ctx.close();
    return t;
  }

  const base = await pageTime(0);
  for (const shift of [HOUR, -HOUR]) {
    expect(Math.abs((await pageTime(shift)) - base), `shift ${shift} ms`).toBeLessThanOrEqual(1_000);
  }
});
