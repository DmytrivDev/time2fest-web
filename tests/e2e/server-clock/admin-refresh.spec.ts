/**
 * SPEC-07 · AC-75, AC-76: the admin slice "Стан свята" shows the next moment and refreshes within 5 s after the server
 * clock is moved through the door. Serial (`server-clock`). Needs T2F_E2E_SERVER (admin host of the server, test class,
 * doors on), T2F_OWNER_EMAILS and T2F_E2E_OWNER_PASSWORD (the same env as the admin e2e of the server).
 */
import { expect, test } from '@playwright/test';
import { COLD_MS, configured, doors, openDashboard, ownerContext, signIn, SKIP_REASON } from '../../../server/test/e2e/admin-support';

test.describe.configure({ timeout: COLD_MS * 2 });
test.skip(!configured, SKIP_REASON);

const BEFORE = Date.parse('2026-12-31T09:00:00Z');
const AFTER = Date.parse('2026-12-31T12:00:00Z');
const REFRESH_LIMIT_MS = 5000;

test.afterEach(async ({ request }) => {
  await request.post(`${doors}/api/_test/reset`);
});

test('AC-75/AC-76: the slice shows the next moment and updates within 5 s after the clock is moved', async ({ browser, request }) => {
  const door = (at: number) => request.post(`${doors}/api/_test/clock`, { data: { at, speed: 0 } });
  expect((await door(BEFORE)).ok()).toBe(true);

  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  await openDashboard(page);

  const next = page.locator('[data-testid="festival-next-moment"]');
  await expect(next).toBeVisible({ timeout: COLD_MS });
  const first = Number(await next.getAttribute('data-at'));
  expect(first).toBeGreaterThan(BEFORE);

  const moved = Date.now();
  expect((await door(AFTER)).ok()).toBe(true);
  await expect
    .poll(async () => Number(await next.getAttribute('data-at')), { timeout: REFRESH_LIMIT_MS, intervals: [100] })
    .toBeGreaterThan(AFTER);
  const refreshMs = Date.now() - moved;
  console.log(`ADMIN_SLICE refresh_ms=${refreshMs}`);
  expect(refreshMs).toBeLessThanOrEqual(REFRESH_LIMIT_MS);

  await context.close();
});
