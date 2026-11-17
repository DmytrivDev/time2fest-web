/**
 * AC-26 … AC-30, AC-24, NFR-10 end to end (run in W53): the first screen shows the three slices and
 * the last 20 journal rows; a failing test slice leaves the others standing with an error in its
 * place; the admin is Ukrainian; revert buttons exist only on revertible rows; ten loads stay ≤3 s p95.
 */
import { expect, test } from '@playwright/test';
import { api, configured, COLD_MS, openDashboard, originHeaders, ownerContext, server, signIn, SKIP_REASON } from './admin-support';

test.describe.configure({ mode: 'serial' });
test.setTimeout(COLD_MS * 2);

const setFail = (request: import('@playwright/test').APIRequestContext, fail: boolean) =>
  request.post(`${server}/api/_test/admin-test-slice`, { data: { fail }, headers: originHeaders });

test.beforeEach(() => test.skip(!configured, SKIP_REASON));
test.afterEach(async ({ request }) => {
  if (configured) await setFail(request, false);
});

/** One created post and `n` updates of it: 1 non-revertible and n revertible journal rows. */
async function journalRows(context: import('@playwright/test').BrowserContext, n: number) {
  const created = await api(context, 'POST', '/agent-test-posts', { title: 'e2e-0', status: 'draft' });
  expect(created.status).toBe(201);
  const id = (created.body as { doc: { id: number } }).doc.id;
  for (let i = 1; i <= n; i++) expect((await api(context, 'PATCH', `/agent-test-posts/${id}`, { title: `e2e-${i}` })).status).toBe(200);
}

test('AC-26/AC-30: three slices in order, 20 journal rows, language uk, Ukrainian labels', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  await journalRows(context, 21);
  await openDashboard(page);

  const slices = page.locator('[data-slice]');
  await expect(slices).toHaveCount(3);
  expect(await slices.evaluateAll((els) => els.map((e) => e.getAttribute('data-slice')))).toEqual(['10-corrections', '20-unattended', '90-test']);
  await expect(page.locator('[data-testid="corrections-slice"]')).toBeVisible();
  await expect(page.locator('[data-testid="unattended-slice"]')).toBeVisible();
  await expect(page.locator('[data-testid="test-slice"]')).toBeVisible();
  await expect(page.locator('[data-testid="journal-row"]')).toHaveCount(20);

  await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
  await page.goto(`${server}/admin/collections/events`, { waitUntil: 'domcontentloaded', timeout: COLD_MS });
  await expect(page.getByRole('heading', { name: 'Події', exact: true }).first()).toBeVisible();
  await page.goto(`${server}/admin/collections/alarms`, { waitUntil: 'domcontentloaded', timeout: COLD_MS });
  await expect(page.getByRole('heading', { name: 'Тривоги', exact: true }).first()).toBeVisible();
  await context.close();
});

test('AC-24: a row of a kind with no handler has no button; a revertible row has one', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  await journalRows(context, 2);
  await openDashboard(page);

  const revertible = page.locator('[data-testid="journal-row"][data-revertible="true"]');
  const plain = page.locator('[data-testid="journal-row"][data-revertible="false"]');
  await expect(revertible.first()).toBeVisible();
  await expect(revertible.first().locator('[data-testid="revert-button"]')).toHaveCount(1);
  expect(await plain.count()).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="journal-row"][data-revertible="false"] [data-testid="revert-button"]')).toHaveCount(0);
  await context.close();
});

test('AC-27: with the fail flag the test slice shows an error, the other slices and the journal stay', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  await openDashboard(page); // warm before the flag is set
  expect((await setFail(request, true)).status()).toBe(200);
  await openDashboard(page);

  await expect(page.locator('[data-slice="90-test"] [data-testid="slice-error"]')).toHaveText('Зріз «Тестовий зріз» не відмалювався');
  await expect(page.locator('[data-testid="corrections-slice"]')).toBeVisible();
  await expect(page.locator('[data-testid="unattended-slice"]')).toBeVisible();
  await expect(page.locator('[data-testid="journal"]')).toBeVisible();
  await context.close();
});

test('AC-29: the test slice action is journalled and revertible from the journal', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  await openDashboard(page);
  const action = page.locator('[data-testid="test-slice-action"]');
  await action.click();
  await expect(page.locator('[data-testid="test-slice-count"]')).toHaveText('Лічильник: 1');
  await action.click();
  await expect(page.locator('[data-testid="test-slice-count"]')).toHaveText('Лічильник: 2');
  await openDashboard(page);
  const first = page.locator('[data-testid="journal-row"]').first();
  await expect(first).toHaveAttribute('data-revertible', 'true');
  await first.locator('[data-testid="revert-button"]').click();
  const info = (await page.locator('[data-testid="test-slice-info"]').textContent()) ?? '';
  const id = /запис (\d+):/.exec(info)?.[1];
  expect(id).toBeTruthy();
  await expect
    .poll(async () => ((await api(context, 'GET', `/agent-test-posts/${id}`)).body as { title?: string } | null)?.title, { timeout: 15_000 })
    .toBe('slice-1');
  await context.close();
});

test('NFR-10: ten loads of the first screen, p95 ≤ 3000 ms', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  await openDashboard(page); // warm
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    await openDashboard(page);
    times.push(Date.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.ceil(0.95 * times.length) - 1] as number;
  console.log(`NFR-10 first screen, 10 loads (ms): ${times.join(', ')}; p95 = ${p95}`);
  expect(p95).toBeLessThanOrEqual(3000);
  await context.close();
});
