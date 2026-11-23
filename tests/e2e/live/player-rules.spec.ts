/**
 * SPEC-12 · AC-47, AC-48: at most one autoplaying player, an invisible player is not PLAYING, nothing over the iframe
 * (9 x 9 probe points), the player area >= 200 x 200 px at p390 / t834 / d1520. Failures are reported, never fixed
 * by changing the layout. Written only; run in L.
 */
import { expectNothingOverPlayer, expectPlayerMinSize } from '../fixtures/geometry';
import { SERVER, SKIP_REASON, setDoorClock } from '../fixtures/serverClock';
import { DEFAULT_START } from '../fixtures/time';
import { expect, test } from '../fixtures/youtube-stub';

test.skip(!SERVER, SKIP_REASON);

// The http build shows the server test clock: put it on the default start (a live London air) before every test.
test.beforeEach(async ({ request }) => {
  await setDoorClock(request, { at: Date.parse(DEFAULT_START), speed: 1 });
});

const VIEWPORTS = [
  { name: 'p390', width: 390, height: 844 },
  { name: 't834', width: 834, height: 1112 },
  { name: 'd1520', width: 1520, height: 900 },
] as const;

for (const vp of VIEWPORTS) {
  test(`AC-48: ${vp.name} - player >= 200x200, nothing over the iframe`, async ({ page, ytStub }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await ytStub.install();
    await page.goto('/');
    await ytStub.waitForPlayer();
    await ytStub.fireReady();
    await expectPlayerMinSize(page);
    await expectNothingOverPlayer(page);
  });
}

test('AC-47: the room with three streams - one autoplaying player, the invisible ones are not PLAYING', async ({ page, ytStub }) => {
  await page.setViewportSize({ width: 1520, height: 900 });
  await ytStub.install();
  // The room opens empty: seed three London windows in the guest store, as tests/e2e/us3-room.spec.ts does.
  await page.addInitScript((room) => {
    if (!localStorage.getItem('t2f:guest:v1')) {
      localStorage.setItem('t2f:guest:v1', JSON.stringify({ state: { v: 1, id: 'e2e-room', nightId: '2026-27', room }, version: 1 }));
    }
  }, {
    windows: [1, 2, 3].map((n, slot) => ({ slot, sourceId: `src_london_${n}`, eventId: 'evt_london_2027' })),
    soundSlot: 0,
  });
  await page.goto('/room/');
  await ytStub.waitForPlayer();
  await ytStub.fireReady();
  const players = await ytStub.players();
  const autoplaying = players.filter((p) => p.playerVars.autoplay === 1);
  expect(autoplaying.length, 'at most one player autoplays').toBeLessThanOrEqual(1);

  const frames = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-stub-id]')].map((f) => {
      const r = f.getBoundingClientRect();
      return { id: f.dataset.stubId!, shown: r.width > 0 && r.height > 0 && getComputedStyle(f).visibility !== 'hidden' };
    }),
  );
  const now = await ytStub.players();
  for (const f of frames.filter((x) => !x.shown)) {
    expect(now.find((p) => p.stubId === f.id)?.state, `invisible player ${f.id} is not PLAYING`).not.toBe(1);
  }
});
