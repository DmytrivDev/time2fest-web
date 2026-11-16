/**
 * AC-42: the integration web build asks the server for the time and gets the frozen test clock.
 * Needs `pnpm serve:int` (web) and the server in test mode. Env: T2F_E2E_BASE (web URL), T2F_E2E_SERVER (server URL).
 */
import { expect, test } from '@playwright/test';

const web = process.env.T2F_E2E_BASE ?? '';
const server = process.env.T2F_E2E_SERVER ?? '';
const AT = Date.parse('2026-12-31T23:59:00Z');

test('AC-42: the integration build shows the server clock', async ({ page, request }) => {
  test.skip(!web || !server, 'set T2F_E2E_BASE (web) and T2F_E2E_SERVER (server)');
  const set = await request.post(`${server}/api/_test/clock`, { data: { at: AT, frozen: true }, headers: { Origin: web } });
  expect(set.ok()).toBe(true);
  try {
    await page.goto(`${web}/`);
    const r = await page.evaluate(
      () => (window as unknown as { __t2fTimePrefetch?: { promise: Promise<{ now: number } | null> } }).__t2fTimePrefetch?.promise,
    );
    expect(r).toBeTruthy();
    expect(Math.abs((r?.now ?? 0) - AT)).toBeLessThanOrEqual(2000);
  } finally {
    await request.post(`${server}/api/_test/reset`, { headers: { Origin: web } });
  }
});
