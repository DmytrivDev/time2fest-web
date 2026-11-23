/**
 * SPEC-12 · AC-61: three browser contexts, one of them with two pages -> the aggregate on the site is 3 (one tab per
 * browser counts, Web Locks). Reads the count from the line next to the player.
 * Needs T2F_E2E_SERVER and the integration build with realtime. Written only; run in L.
 */
import { SERVER, SKIP_REASON } from '../fixtures/serverClock';
import { expect, test } from '../fixtures/youtube-stub';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
test.skip(!SERVER, SKIP_REASON);

test.afterAll(async ({ request }) => {
  await request.post(`${SERVER}/api/_test/live`, { data: { door: 'reset-live' } });
});

test('AC-61: 3 contexts (one with 2 pages) -> aggregate 3', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  await Promise.all(pages.map((p) => p.goto('/')));
  const second = await contexts[0]!.newPage();
  await second.goto('/');

  const line = pages[1]!.getByText(/Зараз на Time2Fest|Now on Time2Fest/i).first();
  await expect(line).toContainText(/\b3\b/, { timeout: 30_000 });
  await Promise.all(contexts.map((c) => c.close()));
});
