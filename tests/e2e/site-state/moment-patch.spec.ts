/**
 * SPEC-08 · AC-53 (SC-019): a correction of -20 min on the event that is next on air changes the countdown in the open tab
 * within 30 s, without a reload. The server test clock is frozen before that event's moment; the correction is saved
 * the way the owner does it (admin slice "Корекції": select the event, change the moment, confirm).
 *
 * Serial (`site-state`; moves the shared server clock). Needs T2F_E2E_SERVER, T2F_OWNER_EMAILS, T2F_E2E_OWNER_PASSWORD
 * (same env as `server/test/e2e/admin-*.e2e.ts`) and the seeded catalog (the `reset` door seeds it).
 */
import { api, configured, COLD_MS, openDashboard, ownerContext, signIn, SKIP_REASON } from '../../../server/test/e2e/admin-support';
import { SERVER, getDoorClock, resetServer, setDoorClock } from '../fixtures/serverClock';
import { expect, test } from '../fixtures/youtube-stub';

test.describe.configure({ mode: 'serial', timeout: COLD_MS * 2 });
test.skip(!SERVER || !configured, SKIP_REASON);

const LEAD_MS = 2 * 60 * 60_000; // clock frozen 2 h before the moment
const SHIFT_MS = 20 * 60_000;
const SEEN_WITHIN_MS = 30_000;

test.afterAll(async ({ request }) => {
  await resetServer(request);
});

test('AC-53: -20 min on the next event -> the countdown changes in <= 30 s without reload', async ({ browser, request, baseURL }) => {
  const owner = await ownerContext(browser, request);
  const admin = await owner.newPage();
  await signIn(admin);

  // The event that is on air first: the earliest midnight event of the seeded catalog.
  const res = await api(owner, 'GET', '/events?limit=2000&depth=0&sort=eventId&where[slot][equals]=midnight');
  const docs = ((res.body as { docs?: Array<{ eventId: string }> } | null)?.docs ?? []);
  expect(docs.length, 'the seeded catalog has events').toBeGreaterThan(0);

  await openDashboard(admin);
  const slice = admin.locator('[data-testid="corrections-slice"]');
  const momentInput = slice.locator('[data-testid="corr-moment"]');
  // Earliest moment among the events (the input holds the current UTC moment as `YYYY-MM-DDTHH:mm`).
  let earliest: { id: string; moment: number } | null = null;
  for (const { eventId } of docs.slice(0, 40)) {
    await slice.locator('[data-testid="corr-filter"]').fill(eventId);
    await slice.locator('[data-testid="corr-event"]').selectOption(eventId);
    const moment = Date.parse(`${await momentInput.inputValue()}:00Z`);
    if (!earliest || moment < earliest.moment) earliest = { id: eventId, moment };
  }
  expect(earliest).not.toBeNull();
  const target = earliest!;

  expect((await setDoorClock(request, { at: target.moment - LEAD_MS, speed: 0 })).frozen).toBe(true);
  expect((await getDoorClock(request)).now).toBe(target.moment - LEAD_MS);

  const page = await browser.newPage({ viewport: { width: 1520, height: 900 }, ...(baseURL ? { baseURL } : {}) });
  await page.goto('/');
  const timer = page.locator('[data-caption-timer]:visible').first();
  await expect(timer).toContainText(/\d\d:\d\d/, { timeout: 60_000 });
  const before = await timer.textContent();

  // Owner saves the correction (slice dialog), the tab is not touched.
  await slice.locator('[data-testid="corr-filter"]').fill(target.id);
  await slice.locator('[data-testid="corr-event"]').selectOption(target.id);
  await momentInput.fill(new Date(target.moment - SHIFT_MS).toISOString().slice(0, 16));
  await slice.locator('[data-testid="corr-save"]').click();
  await admin.locator('[data-testid="corr-dialog"] [data-testid="corr-confirm"]').click();
  await expect(admin.locator('[data-testid="corr-message"]')).toHaveText('Збережено.');
  const savedAt = Date.now();

  await expect.poll(async () => timer.textContent(), { timeout: SEEN_WITHIN_MS, intervals: [250] }).not.toBe(before);
  console.log(`T2F_MEASURE ${JSON.stringify({ metric: 'moment-patch-countdown-ms', value: Date.now() - savedAt })}`);
  await owner.close();
});
