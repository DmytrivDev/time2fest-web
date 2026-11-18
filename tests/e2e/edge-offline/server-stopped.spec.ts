/**
 * SPEC-07 · AC-18: the origin server is stopped, the site behind a production-mode edge still counts down,
 * switches the air slot at the handover and shows the stamp (client rules, time from the edge).
 *
 * NOT part of the http project run: it needs infrastructure of its own, so it is gated and SKIPPED unless
 *   T2F_EDGE_OFFLINE=1  and  T2F_EDGE_BASE=http://127.0.0.1:<wrangler dev port>
 * are set. Recipe (see ./README.md): static test build (sim time machine) served by `wrangler dev` of workers/edge in
 * `production` mode with ORIGIN_URL pointing to a port where nothing listens; run
 *   npx playwright test -c playwright.http.config.ts --project=edge-offline
 * The page machine path is the sim one (`?t=`): the edge serves /api/time itself, the origin is never needed.
 */
import { gotoAt, getTime, nowMs } from '../fixtures/time';
import { expect, test } from '../fixtures/youtube-stub';

test.use({ timezoneId: 'Europe/Kyiv', locale: 'uk-UA' });
test.describe.configure({ timeout: 120_000 });
test.skip(process.env.T2F_EDGE_OFFLINE !== '1' || !process.env.T2F_EDGE_BASE, 'needs a production-mode edge with a stopped origin: set T2F_EDGE_OFFLINE=1 and T2F_EDGE_BASE');

const MIDNIGHT_LONDON = Date.parse('2027-01-01T00:00:00Z');

test('AC-18: origin stopped - the countdown ticks, the handover happens, the stamp shows', async ({ page }) => {
  // The origin really is down: any /api request other than the edge-owned /api/time must fail (5xx), not hang.
  const origin = await page.request.get('/api/health').catch(() => null);
  if (origin) expect(origin.status(), 'the origin must be stopped for this spec').toBeGreaterThanOrEqual(500);

  await gotoAt(page, '2027-01-01T01:59:40+02:00', 1);
  const timer = page.locator('[data-caption-timer]:visible').first();
  await expect(timer).toContainText(/\d\d:\d\d/);
  const first = await timer.textContent();
  await expect.poll(async () => timer.textContent(), { timeout: 5_000 }).not.toBe(first);

  // Handover at London midnight: virtual time crosses it, the stamp block appears with the share/passport actions.
  await expect.poll(async () => (await nowMs(page)) >= MIDNIGHT_LONDON, { timeout: 60_000, intervals: [250] }).toBe(true);
  expect((await getTime(page)).source).toBe('machine');
  const block = page.locator('[data-stamp-block]');
  await expect(block).toBeVisible({ timeout: 30_000 });
  await expect(block).toContainText(/Поділитися/);
  await expect(block).toContainText(/Мій паспорт/);
});
