/**
 * SPEC-08 · AC-52: the owner toggles a switch -> the open tab has the new `version`.
 * - realtime up: 20 toggles through `/api/_test/site`, p95 <= 3 s, prints `T2F_MEASURE {"metric":"site-toggle-ms",...}`;
 * - realtime stopped (the variant sets `T2F_E2E_NO_REALTIME=1` after Centrifugo is stopped by hand/`pnpm stack`): <= 30 s.
 *
 * The tab's receipt is observed without an app test hook: a websocket frame of the realtime channel or a poll answer of
 * `GET /api/site/state` that carries the new `version` (the snapshot envelope is `{type:'snapshot', version, ...}`).
 * Serial (`site-state`). Needs T2F_E2E_SERVER.
 */
import type { Page, Response } from '@playwright/test';
import { SERVER, SKIP_REASON, resetServer } from '../fixtures/serverClock';
import { expect, test } from '../fixtures/youtube-stub';

test.describe.configure({ mode: 'serial', timeout: 180_000 });
test.skip(!SERVER, SKIP_REASON);

const NO_REALTIME = process.env.T2F_E2E_NO_REALTIME === '1';
const TOGGLES = 20;
const REALTIME_P95_MS = 3_000;
const POLL_LIMIT_MS = 30_000;

/** Highest site `version` the tab has received so far (websocket frames and state polls), with receipt times. */
function watchVersions(page: Page): { seen: Map<number, number> } {
  const seen = new Map<number, number>();
  const note = (text: string) => {
    for (const m of text.matchAll(/"version"\s*:\s*(\d+)/g)) {
      const v = Number(m[1]);
      if (!seen.has(v)) seen.set(v, Date.now());
    }
  };
  page.on('websocket', (ws) => ws.on('framereceived', (f) => note(typeof f.payload === 'string' ? f.payload : f.payload.toString('utf8'))));
  page.on('response', (res: Response) => {
    if (res.url().includes('/api/site/state')) void res.text().then(note, () => undefined);
  });
  return { seen };
}

async function toggle(request: import('@playwright/test').APIRequestContext, value: boolean): Promise<number> {
  const res = await request.post(`${SERVER}/api/_test/site`, { data: { action: 'switch', key: 'chat', value, mode: 'manual', reason: 'e2e latency' } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { value: { version: number } }).value.version;
}

test.afterAll(async ({ request }) => {
  await resetServer(request);
});

test(NO_REALTIME ? 'AC-52: without realtime the tab has the new version within 30 s' : 'AC-52: 20 toggles reach the open tab, p95 <= 3 s', async ({ page, request }) => {
  const { seen } = watchVersions(page);
  await page.goto('/');
  await expect(page.locator('[data-video-area]').first()).toBeVisible({ timeout: 60_000 });

  const samples: number[] = [];
  const count = NO_REALTIME ? 1 : TOGGLES;
  let on = false;
  for (let i = 0; i < count; i += 1) {
    const sentAt = Date.now();
    const version = await toggle(request, on);
    on = !on;
    await expect.poll(() => seen.has(version), { timeout: NO_REALTIME ? POLL_LIMIT_MS : 15_000, intervals: [50] }).toBe(true);
    samples.push(seen.get(version)! - sentAt);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
  console.log(`T2F_MEASURE ${JSON.stringify({ metric: 'site-toggle-ms', variant: NO_REALTIME ? 'poll' : 'realtime', p95, samples })}`);
  expect(p95).toBeLessThanOrEqual(NO_REALTIME ? POLL_LIMIT_MS : REALTIME_P95_MS);
});
