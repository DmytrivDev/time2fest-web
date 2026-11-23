/** SPEC-12 AC-71, AC-75: the fake YouTube server. Loopback only; the real API is never called. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';

const A = 'zMCea32gpmg';
const B = 'MXmzsjABC-U';

let fake: { url: string; close: () => Promise<void> };
beforeAll(async () => {
  fake = await startFakeYoutube({ port: 0 });
});
afterAll(async () => {
  await fake.close();
});
beforeEach(async () => {
  await fetch(`${fake.url}/_control/reset`, { method: 'POST' });
});

const post = (path: string, body: unknown) =>
  fetch(`${fake.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const videos = (ids: string[]) => fetch(`${fake.url}/youtube/v3/videos?id=${ids.join(',')}&part=snippet,status`);
type Item = { id: string; snippet: { liveBroadcastContent: string }; status: { privacyStatus: string; embeddable: boolean }; liveStreamingDetails: Record<string, string> };

describe('fake YouTube', () => {
  it('serves every state', async () => {
    await post('/_control/videos', {
      videos: [
        { id: A, state: 'live' },
        { id: B, state: 'upcoming', scheduledStartTime: '2026-12-31T22:00:00Z' },
      ],
    });
    const body = (await (await videos([A, B])).json()) as { items: Item[] };
    expect(body.items.map((i) => i.snippet.liveBroadcastContent)).toEqual(['live', 'upcoming']);
    expect(body.items[1]?.liveStreamingDetails.scheduledStartTime).toBe('2026-12-31T22:00:00Z');

    await post('/_control/videos', { videos: [{ id: A, state: 'ended' }, { id: B, state: 'none' }] });
    const ended = (await (await videos([A, B])).json()) as { items: Item[] };
    expect(ended.items[0]?.liveStreamingDetails.actualEndTime).toBeDefined();
    expect(ended.items[1]?.liveStreamingDetails.actualEndTime).toBeUndefined();

    await post('/_control/videos', { videos: [{ id: A, state: 'private' }, { id: B, state: 'live', embeddable: false }] });
    const p = (await (await videos([A, B])).json()) as { items: Item[] };
    expect(p.items[0]?.status.privacyStatus).toBe('private');
    expect(p.items[1]?.status.embeddable).toBe(false);

    await post('/_control/videos', { videos: [{ id: A, state: 'deleted' }] });
    const d = (await (await videos([A, B])).json()) as { items: Item[] };
    expect(d.items.map((i) => i.id)).toEqual([B]);
  });

  it('never serves titles or statistics', async () => {
    await post('/_control/videos', { videos: [{ id: A, state: 'live' }] });
    const text = await (await videos([A])).text();
    expect(text).not.toMatch(/title|statistics|viewCount/);
  });

  it('refuses 51 ids and accepts 50', async () => {
    expect((await videos(Array.from({ length: 51 }, () => A))).status).toBe(400);
    expect((await videos(Array.from({ length: 50 }, () => A))).status).toBe(200);
  });

  it('answers 403 quotaExceeded per bucket', async () => {
    await post('/_control/quota', { bucket: 'queries', exceeded: true });
    const r = await videos([A]);
    expect(r.status).toBe(403);
    expect(JSON.stringify(await r.json())).toContain('quotaExceeded');
    expect((await fetch(`${fake.url}/youtube/v3/search`)).status).toBe(200);
    await post('/_control/quota', { bucket: 'search', exceeded: true });
    expect((await fetch(`${fake.url}/youtube/v3/search`)).status).toBe(403);
  });

  it('counts calls per path with ids and part, and goes down on request', async () => {
    await videos([A, B]);
    await fetch(`${fake.url}/youtube/v3/search`);
    await post('/_control/down', { on: true });
    expect((await videos([A])).status).toBe(503);
    const c = (await (await fetch(`${fake.url}/_control/calls`)).json()) as { counts: Record<string, number>; calls: { ids: string[]; part: string | null }[] };
    expect(c.counts['/youtube/v3/videos']).toBe(2);
    expect(c.counts['/youtube/v3/search']).toBe(1);
    expect(c.calls[0]).toMatchObject({ ids: [A, B], part: 'snippet,status' });
  });
});
