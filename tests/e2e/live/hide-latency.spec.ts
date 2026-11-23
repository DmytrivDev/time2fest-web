/**
 * SPEC-12 · AC-21: the owner hides a source -> the open tab drops it, p95 <= 3 s over 20 hides (realtime up).
 * Receipt is observed without an app hook: a realtime frame or a `GET /api/live/chains` answer whose `version`
 * is the one the door returned. Prints `T2F_MEASURE {"metric":"live-hide-ms",...}`. Serial. Needs T2F_E2E_SERVER.
 * Written only; run in L (`-c playwright.http.config.ts --workers=2`).
 */
import type { Page, Response } from '@playwright/test';
import { SERVER, SKIP_REASON } from '../fixtures/serverClock';
import { expect, test } from '../fixtures/youtube-stub';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.skip(!SERVER, SKIP_REASON);

const HIDES = 20;
const P95_MS = 3_000;

interface Chains {
  version: number;
  chains: { eventId: string; sources: { id: string }[] }[];
}

function watchVersions(page: Page): Map<number, number> {
  const seen = new Map<number, number>();
  const note = (text: string) => {
    for (const m of text.matchAll(/"version"\s*:\s*(\d+)/g)) if (!seen.has(Number(m[1]))) seen.set(Number(m[1]), Date.now());
  };
  page.on('websocket', (ws) => ws.on('framereceived', (f) => note(typeof f.payload === 'string' ? f.payload : f.payload.toString('utf8'))));
  page.on('response', (res: Response) => {
    if (res.url().includes('/api/live/chains')) void res.text().then(note, () => undefined);
  });
  return seen;
}

test.afterAll(async ({ request }) => {
  await request.post(`${SERVER}/api/_test/live`, { data: { door: 'reset-live' } });
});

test('AC-21: 20 hides reach the open tab, p95 <= 3 s', async ({ page, request }) => {
  const seen = watchVersions(page);
  await page.goto('/');
  await expect(page.locator('[data-video-area]').first()).toBeVisible({ timeout: 60_000 });

  const chains = (await (await request.get(`${SERVER}/api/live/chains`)).json()) as Chains;
  const pairs = chains.chains.flatMap((c) => c.sources.map((s) => ({ eventId: c.eventId, sourceId: s.id })));
  expect(pairs.length, 'the seed has at least 20 sources to hide').toBeGreaterThanOrEqual(HIDES);

  const samples: number[] = [];
  for (const pair of pairs.slice(0, HIDES)) {
    const sentAt = Date.now();
    const res = await request.post(`${SERVER}/api/_test/live`, { data: { door: 'hide', ...pair } });
    expect(res.ok()).toBe(true);
    const version = ((await res.json()) as { value: { version: number } }).value.version;
    await expect.poll(() => seen.has(version), { timeout: 15_000, intervals: [50] }).toBe(true);
    samples.push(seen.get(version)! - sentAt);
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
  console.log(`T2F_MEASURE ${JSON.stringify({ metric: 'live-hide-ms', variant: 'realtime', p95, samples })}`);
  expect(p95).toBeLessThanOrEqual(P95_MS);
});
