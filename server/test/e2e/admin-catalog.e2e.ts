/**
 * AC-45, AC-47, AC-38 end to end (run in W53): the zone's `midnightUtc` is read-only in the edit form,
 * the six catalog collections offer no "Видалити", and the unattended slice's "Підтвердити" sets
 * `acknowledgedAt` (shown on the alarm's page).
 */
import { expect, test } from '@playwright/test';
import { api, configured, COLD_MS, openDashboard, originHeaders, ownerContext, server, signIn, SKIP_REASON } from './admin-support';

test.describe.configure({ mode: 'serial' });
test.setTimeout(COLD_MS * 2);
test.beforeEach(() => test.skip(!configured, SKIP_REASON));

const CATALOG = ['seasons', 'zones', 'events', 'countries', 'cities', 'traditions'] as const;

test('AC-45: the zone edit form shows midnightUtc read-only', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  const zones = (await api(context, 'GET', '/zones?limit=1&depth=0')).body as { docs?: Array<{ id: number }> } | null;
  const id = zones?.docs?.[0]?.id;
  expect(id, 'the seeded catalog has zones').toBeTruthy();
  await page.goto(`${server}/admin/collections/zones/${id}`, { waitUntil: 'domcontentloaded', timeout: COLD_MS });
  const field = page.locator('#field-midnightUtc');
  await expect(field).toBeVisible({ timeout: COLD_MS });
  expect(await field.evaluate((el) => (el as HTMLInputElement).readOnly || (el as HTMLInputElement).disabled)).toBe(true);
  await context.close();
});

test('AC-47: the six catalog collections show no "Видалити" action', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  for (const slug of CATALOG) {
    const list = (await api(context, 'GET', `/${slug}?limit=1&depth=0`)).body as { docs?: Array<{ id: number }> } | null;
    // The list view: select-all would reveal the bulk "Видалити" when delete were allowed.
    await page.goto(`${server}/admin/collections/${slug}`, { waitUntil: 'domcontentloaded', timeout: COLD_MS });
    await page.locator('.collection-list, .list-controls, .collection-list__no-results').first().waitFor({ timeout: COLD_MS });
    const selectAll = page.locator('.select-all input[type="checkbox"], .select-all__input input').first();
    if (await selectAll.count()) await selectAll.check({ force: true });
    await expect(page.getByRole('button', { name: 'Видалити', exact: true })).toHaveCount(0);
    // The edit view: the document controls menu would list "Видалити".
    const id = list?.docs?.[0]?.id;
    if (id !== undefined) {
      await page.goto(`${server}/admin/collections/${slug}/${id}`, { waitUntil: 'domcontentloaded', timeout: COLD_MS });
      await page.locator('form').first().waitFor({ timeout: COLD_MS });
      const menu = page.locator('.doc-controls__popup .popup-button, .doc-controls__popup button').first();
      if (await menu.count()) await menu.click();
      await expect(page.getByText('Видалити', { exact: true })).toHaveCount(0);
    }
    // And the API refuses it (a DELETE with the owner's session).
    if (id !== undefined) expect((await api(context, 'DELETE', `/${slug}/${id}`)).status).toBe(403);
  }
  await context.close();
});

test('AC-38: "Підтвердити" on an open alarm sets acknowledgedAt', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  const code = `e2e-${Date.now()}`;
  const raised = await request.post(`${server}/api/_test/alarm`, { data: { source: 'e2e', code }, headers: originHeaders });
  expect(raised.status()).toBe(200);
  const alarmId = ((await raised.json()) as { value: { id: string } }).value.id;

  await openDashboard(page);
  const row = page.locator('[data-testid="alarm-row"]', { hasText: code });
  await expect(row).toBeVisible({ timeout: COLD_MS });
  await row.locator('[data-testid="alarm-ack"]').click();
  await expect(page.locator('[data-testid="alarm-acked"]')).toContainText(alarmId);

  await expect
    .poll(async () => ((await api(context, 'GET', `/alarms/${alarmId}`)).body as { acknowledgedAt?: string | null } | null)?.acknowledgedAt, { timeout: 15_000 })
    .toBeTruthy();
  await page.goto(`${server}/admin/collections/alarms/${alarmId}`, { waitUntil: 'domcontentloaded', timeout: COLD_MS });
  await expect(page.locator('#field-acknowledgedAt')).not.toHaveValue('', { timeout: COLD_MS });
  await context.close();
});
