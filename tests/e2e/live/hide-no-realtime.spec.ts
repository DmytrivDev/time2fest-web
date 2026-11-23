/**
 * SPEC-12 · AC-22: realtime is down and the edge purge fails -> the open tab drops the hidden source within 30 s
 * (poll 15 s + edge freshness 10 s). The page is served through the Worker harness (`site-state/edgeHarness.ts`);
 * no purge reaches the edge (the run's server has no purge token); realtime is down for the tab: its Centrifugo
 * websocket is refused in the browser (`T2F_E2E_NO_REALTIME=1`), so the shared Centrifugo container keeps running. Serial. Needs T2F_E2E_SERVER and T2F_EDGE_SECRET. Written only; run in L.
 */
import { SERVER, SKIP_REASON, setDoorClock } from '../fixtures/serverClock';
import { DEFAULT_START } from '../fixtures/time';
import { expect, test } from '../fixtures/youtube-stub';
import { startEdge, type Edge } from '../site-state/edgeHarness';

test.describe.configure({ mode: 'serial', timeout: 240_000 });
test.skip(!SERVER, SKIP_REASON);
test.skip(process.env.T2F_E2E_NO_REALTIME !== '1', 'the variant needs Centrifugo stopped (T2F_E2E_NO_REALTIME=1)');

const SECRET = process.env.T2F_EDGE_SECRET ?? '';
const LIMIT_MS = 30_000;
// With T2F_EDGE_SECRET set the origin answers only edge traffic: the spec's own calls (doors, chains) carry the secret.
test.use({ extraHTTPHeaders: SECRET ? { 'x-t2f-edge': SECRET } : {} });

let edge: Edge;
// The http build shows the server test clock: put it on the default start (a live London air).
test.beforeEach(async ({ request }) => {
  await setDoorClock(request, { at: Date.parse(DEFAULT_START), speed: 1 });
});
test.beforeAll(async () => {
  edge = await startEdge({ server: SERVER!, secret: SECRET });
});
test.afterAll(async ({ request }) => {
  await edge?.close();
  await request.post(`${SERVER}/api/_test/live`, { data: { door: 'reset-live' } });
});

test('AC-22: no realtime + failed purge -> hidden source gone from the tab <= 30 s', async ({ page, request }) => {
  let lastChains = '';
  page.on('response', (res) => {
    if (res.url().includes('/api/live/chains')) void res.text().then((t) => (lastChains = t), () => undefined);
  });
  // Realtime down for the tab: every Centrifugo websocket is closed at once, so the adapter stays on the 15 s poll.
  await page.routeWebSocket(/connection\/websocket/, (ws) => ws.close());
  await page.goto(edge.url);
  await expect(page.locator('[data-video-area]').first()).toBeVisible({ timeout: 60_000 });

  const chains = (await (await request.get(`${SERVER}/api/live/chains`)).json()) as { chains: { eventId: string; sources: { id: string }[] }[] };
  const chain = chains.chains.find((c) => c.sources.length > 1)!;
  const target = chain.sources[0]!;
  await expect.poll(() => lastChains.includes(target.id), { timeout: 20_000 }).toBe(true);

  const sentAt = Date.now();
  const res = await request.post(`${SERVER}/api/_test/live`, { data: { door: 'hide', eventId: chain.eventId, sourceId: target.id } });
  expect(res.ok()).toBe(true);
  await expect.poll(() => !lastChains.includes(target.id), { timeout: LIMIT_MS, intervals: [250] }).toBe(true);
  const took = Date.now() - sentAt;
  console.log(`T2F_MEASURE ${JSON.stringify({ metric: 'live-hide-ms', variant: 'poll', took })}`);
  expect(took).toBeLessThanOrEqual(LIMIT_MS);
});
