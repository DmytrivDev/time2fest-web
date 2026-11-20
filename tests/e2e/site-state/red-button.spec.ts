/**
 * SPEC-08 · AC-44 / AC-56 (e2e half): the origin is stopped, the edge cache is warm, the red-button object appears in
 * the bucket -> two tabs (desktop, phone) show the `states.backendDown` strip within 60 s and the player element stays.
 *
 * Own project `site-state` (serial). Needs T2F_E2E_SERVER, T2F_EDGE_SECRET (the server's edge secret) and the
 * integration build in `out-int`. The edge is started here (`edgeHarness.ts`); the real server keeps running, only the
 * forwarder in front of it is closed. If the harness cannot serve the integration build, read `/api/site/state` through
 * the harness and the page through the web server with a proxy rule (decide in L, record).
 */
import { SERVER, SKIP_REASON } from '../fixtures/serverClock';
import { expect, test } from '../fixtures/youtube-stub';
import { startEdge, type Edge } from './edgeHarness';

const SECRET = process.env.T2F_EDGE_SECRET ?? '';
const SHOWN_WITHIN_MS = 60_000;
const WARMUP_REQUESTS = 20;

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.skip(!SERVER || !SECRET, `${SKIP_REASON}; T2F_EDGE_SECRET is also required`);

let edge: Edge;
test.beforeAll(async () => {
  edge = await startEdge({ server: SERVER!, secret: SECRET });
});
test.afterAll(async () => {
  await edge?.close();
});

test('AC-44: red button with a stopped origin -> the strip in both tabs, the player stays', async ({ browser, request }) => {
  // Warm the edge cache with the live snapshot.
  for (let i = 0; i < WARMUP_REQUESTS; i += 1) {
    expect((await request.get(`${edge.url}/api/site/state`)).ok()).toBe(true);
  }

  const desktop = await browser.newContext({ viewport: { width: 1520, height: 900 }, baseURL: edge.url });
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, baseURL: edge.url });
  const tabs = [await desktop.newPage(), await phone.newPage()];
  for (const tab of tabs) {
    await tab.goto('/');
    await expect(tab.locator('[data-offline-notice="off"]').first()).toBeAttached({ timeout: 30_000 });
    await expect(tab.locator('[data-video-area]').first()).toBeVisible({ timeout: 30_000 });
  }

  await edge.stopOrigin();
  const putAt = Date.now();
  await edge.putRedButton();

  for (const tab of tabs) {
    const strip = tab.locator('[data-offline-notice="on"]').first();
    await expect(strip).toContainText(/кеш|cache|caché|cach/i, { timeout: SHOWN_WITHIN_MS });
    // The player is not replaced by the strip (AC-56).
    await expect(tab.locator('[data-video-area]').first()).toBeVisible();
  }
  console.log(`T2F_MEASURE ${JSON.stringify({ metric: 'red-button-strip-ms', value: Date.now() - putAt })}`);
  await desktop.close();
  await phone.close();
});
