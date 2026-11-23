/**
 * SPEC-12 · AC-46 (spike 4): the playing source is hidden or dead -> the next source starts <= 1 s after the event
 * reaches the tab, in the same visible player (`loadVideoById`), with one iframe. The YouTube API is the stub
 * (`fixtures/youtube-stub.ts`). Needs T2F_E2E_SERVER. Written only; run in L.
 */
import { SERVER, SKIP_REASON, setDoorClock } from '../fixtures/serverClock';
import { DEFAULT_START } from '../fixtures/time';
import { expect, test } from '../fixtures/youtube-stub';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.skip(!SERVER, SKIP_REASON);

// The http build shows the server test clock: put it on the default start (a live London air) before every test.
test.beforeEach(async ({ request }) => {
  await setDoorClock(request, { at: Date.parse(DEFAULT_START), speed: 1 });
});

const SWITCH_MS = 1_000;
const DELIVERY_P95_MS = 3_000;

interface Chains {
  chains: { eventId: string; sources: { id: string; videoId?: string; order: number }[] }[];
}

test.afterAll(async ({ request }) => {
  await request.post(`${SERVER}/api/_test/live`, { data: { door: 'reset-live' } });
});

test('AC-46: hide the playing source -> next video loads, same player, one iframe', async ({ page, request, ytStub }) => {
  await ytStub.install();
  const chains = (await (await request.get(`${SERVER}/api/live/chains`)).json()) as Chains;

  await page.goto('/');
  await ytStub.waitForPlayer();
  await ytStub.fireReady();
  // The chain under test is the one of the event the home page plays at the server clock.
  await expect.poll(async () => (await ytStub.players())[0]?.videoId ?? null).not.toBeNull();
  const playing = (await ytStub.players())[0]!.videoId!;
  const chain = chains.chains.find((c) => c.sources.some((s) => s.videoId === playing))!;
  const [first, second] = chain.sources.filter((s) => s.videoId).sort((a, b) => a.order - b.order);
  expect(second, 'the playing chain has a next source').toBeDefined();
  expect(playing).toBe(first!.videoId);
  await ytStub.fireStateChange(1);
  const before = await ytStub.counters();

  const sentAt = Date.now();
  const res = await request.post(`${SERVER}/api/_test/live`, { data: { door: 'hide', eventId: chain.eventId, sourceId: first!.id } });
  expect(res.ok()).toBe(true);
  await expect.poll(async () => (await ytStub.counters()).loadedIds.at(-1), { timeout: 10_000, intervals: [25] }).toBe(second!.videoId);
  const took = Date.now() - sentAt;

  const after = await ytStub.counters();
  expect(after.created, 'no second player is created').toBe(before.created);
  expect(after.loadVideoById).toBeGreaterThan(before.loadVideoById);
  await expect(page.locator('[data-player-host] iframe')).toHaveCount(1);
  console.log(`T2F_MEASURE ${JSON.stringify({ metric: 'live-switch-after-hide-ms', took })}`);
  // Includes the server-to-tab delivery (p95 <= 3 s, measured in hide-latency); the switch itself is bounded by 1 s.
  expect(took).toBeLessThanOrEqual(SWITCH_MS + DELIVERY_P95_MS);
});

test('AC-46: a dead source (error 150) -> next video loads <= 1 s in the same player', async ({ page, ytStub }) => {
  await ytStub.install();
  await page.goto('/');
  await ytStub.waitForPlayer();
  await ytStub.fireReady();
  await ytStub.fireStateChange(1);
  const before = await ytStub.counters();

  const sentAt = Date.now();
  await ytStub.fireError(150);
  await expect.poll(async () => (await ytStub.counters()).loadVideoById, { timeout: 5_000, intervals: [25] }).toBeGreaterThan(before.loadVideoById);
  expect(Date.now() - sentAt).toBeLessThanOrEqual(SWITCH_MS);
  expect((await ytStub.counters()).created).toBe(before.created);
});
