/**
 * SPEC-14 · AC-59 (browser): "rewind to midnight -> the stamp comes from the server".
 * Integration build + worktree server (`node server/scripts/stack.mjs serve`), `T2F_E2E_SERVER` set.
 * The page is open on the London air, the SERVER clock is driven through the doors (the page follows it):
 * the loop gives the server the same samples the real sampler would (clock door + presence tick door, every 5 s of
 * server time from m - 310 s past the end of the claim window), so the window record becomes `healthy`.
 * Then the stamp shows, `GET /api/me/stamps` (the page's cookies) holds it with a server grant kind, and the
 * "not confirmed" line never shows. Serial (`server-clock` project): it moves the one shared server clock.
 */
import { stampAcceptUntil, SERVER_CLOCK_TOLERANCE_MS } from '@time2fest/rules/time';
import { SERVER, SKIP_REASON, getDoorClock, resetServer, setDoorClock } from '../fixtures/serverClock';
import { waitForTimeApi } from '../fixtures/time';
import { expect, test } from '../fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.skip(!SERVER, SKIP_REASON);

const LONDON_MIDNIGHT = Date.parse('2027-01-01T00:00:00Z');
const UNCONFIRMED = /додамо до паспорта, щойно з’явиться зв’язок/;

test.afterEach(async ({ request }, testInfo) => {
  // The reset reseeds the catalog (~12 s): give it its own budget instead of the leftover of the test's.
  testInfo.setTimeout(testInfo.timeout + 60_000);
  await resetServer(request);
});

test('AC-59: midnight on the server clock - the stamp shows and the server holds it (grant kind from the server)', async ({ page, request, ytStub }) => {
  const tick = async (at: number) => {
    await setDoorClock(request, { at, speed: 0, frozen: true });
    const res = await request.post(`${SERVER}/api/_test/presence/tick`, { data: {} });
    expect(res.ok(), `presence tick door ${res.status()}`).toBe(true);
  };

  await setDoorClock(request, { at: LONDON_MIDNIGHT - 320_000, speed: 0, frozen: true });
  await page.goto('/');
  await waitForTimeApi(page);
  await ytStub.waitForPlayer();
  await expect(page.locator('[data-caption-timer]:visible').first()).toBeVisible();

  // Healthy record: samples every 5 s of server time; the page beats and is "present" at the moments the loop passes.
  const end = stampAcceptUntil(LONDON_MIDNIGHT, SERVER_CLOCK_TOLERANCE_MS) + 15_000;
  for (let at = LONDON_MIDNIGHT - 310_000; at <= end; at += 5_000) {
    await tick(at);
    if (at < LONDON_MIDNIGHT + 20_000 && at >= LONDON_MIDNIGHT - 40_000) await page.waitForTimeout(400); // let the page react around the midnight
  }
  await setDoorClock(request, { at: LONDON_MIDNIGHT + 20_000, speed: 0, frozen: true });

  const block = page.locator('[data-stamp-block]');
  await expect(block).toBeVisible({ timeout: 30_000 });
  await expect(block).toContainText(/Мій паспорт/);

  // The server holds the same stamp for the same cookies.
  let list: { eventId: string; grantedAt: number; presenceSource: string; illustrationId: string; cityName: string }[] = [];
  await expect
    .poll(
      async () => {
        const res = await page.request.get('/api/me/stamps');
        const body = (await res.json()) as { ok?: boolean; value?: typeof list } | typeof list;
        list = (Array.isArray(body) ? body : (body.value ?? [])) as typeof list;
        return list.map((s) => s.eventId);
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toContain('evt_london_2027');
  const mine = list.find((s) => s.eventId === 'evt_london_2027')!;
  // The wire stamp carries the presence source (the grant kind is the server's: a stamp is only composed on grant) and
  // the server-side composition (city name, illustration from the stored catalog).
  expect(['country', 'air', 'room', 'tv']).toContain(mine.presenceSource);
  expect(mine.illustrationId).toBeTruthy();
  expect(mine.cityName).toBeTruthy();
  expect(mine.grantedAt).toBeGreaterThanOrEqual(LONDON_MIDNIGHT);

  // Not "unconfirmed" after a minute (the page clock is the server clock).
  await setDoorClock(request, { at: LONDON_MIDNIGHT + 20_000 + 61_000, speed: 1, frozen: false });
  await expect.poll(async () => (await getDoorClock(request)).now, { timeout: 5_000 }).toBeGreaterThan(LONDON_MIDNIGHT + 80_000);
  await expect(block).toBeVisible();
  await expect(block).not.toContainText(UNCONFIRMED);
});
