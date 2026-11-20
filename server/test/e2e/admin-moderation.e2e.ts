/**
 * AC-41, AC-43 end to end (run in L): the moderation slice shows the spend a test door sets, and a rejected
 * form (review above block) shows the Ukrainian refusal. Needs the test class with doors on and an owner.
 */
import { expect, test } from '@playwright/test';
import { configured, COLD_MS, doors, openDashboard, ownerContext, signIn, SKIP_REASON } from './admin-support';

test.describe.configure({ mode: 'serial' });
test.setTimeout(COLD_MS * 2);
test.beforeEach(() => test.skip(!configured, SKIP_REASON));

test('AC-41: the slice shows the month spend set through the door', async ({ browser, request }) => {
  const res = await request.post(`${doors}/api/_test/moderation`, { data: { op: 'setSpend', period: 'month', usd: 12.5 } });
  expect(res.status()).toBe(200);
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  await openDashboard(page);
  await expect(page.locator('[data-testid="spend-month"]')).toContainText('$12.50');
  await expect(page.locator('[data-testid="task-moderation"]')).toBeVisible();
  await request.post(`${doors}/api/_test/moderation`, { data: { op: 'reset' } });
});

test('AC-43: review above block is refused with a message', async ({ browser, request }) => {
  const context = await ownerContext(browser, request);
  const page = await context.newPage();
  await signIn(page);
  await openDashboard(page);
  const slice = page.locator('[data-testid="moderation-slice"]');
  await slice.locator('input[name="review"]').fill('0.9');
  await slice.locator('input[name="block"]').fill('0.8');
  await slice.getByRole('button', { name: 'Зберегти' }).click();
  await expect(slice.getByRole('alert')).toContainText('Дані не прийнято');
});
