/** SPEC-12 AC-71, AC-75: the fake YouTube server. Loopback only; the real API is never called. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';

const A = 'zMCea32gpmg';
const B = 'MXmzsjABC-U';
const CH = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const CH2 = 'UCbbbbbbbbbbbbbbbbbbbbbb';

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

  describe('SPEC-21a: channels, playlists, search', () => {
    const get = (path: string) => fetch(`${fake.url}${path}`);
    type Calls = { counts: Record<string, number>; calls: { path: string; part: string | null; fields: string | null; params: Record<string, string> }[] };
    const calls = async () => (await (await get('/_control/calls')).json()) as Calls;

    it('channels.list gives the uploads playlist; unknown and deleted channels are absent', async () => {
      await post('/_control/channels', { channels: [{ id: CH, uploads: 'UUplaylist1' }, { id: CH2, deleted: true }] });
      const body = (await (await get(`/youtube/v3/channels?id=${CH},${CH2},UCzzzzzzzzzzzzzzzzzzzzzz&part=contentDetails`)).json()) as { items: unknown[] };
      expect(body.items).toEqual([{ id: CH, contentDetails: { relatedPlaylists: { uploads: 'UUplaylist1' } } }]);
      expect((await get('/youtube/v3/channels?part=contentDetails')).status).toBe(400);
    });

    it('playlistItems lists video ids newest first, caps maxResults at 50, 404 playlistNotFound for an unknown playlist', async () => {
      await post('/_control/channels', { channels: [{ id: CH, uploads: 'UUplaylist1', videos: [A, B] }] });
      const ok = (await (await get('/youtube/v3/playlistItems?playlistId=UUplaylist1&part=contentDetails&maxResults=50')).json()) as { items: { contentDetails: { videoId: string } }[] };
      expect(ok.items.map((i) => i.contentDetails.videoId)).toEqual([A, B]);
      const one = (await (await get('/youtube/v3/playlistItems?playlistId=UUplaylist1&maxResults=1')).json()) as { items: unknown[] };
      expect(one.items).toHaveLength(1);
      expect((await get('/youtube/v3/playlistItems?playlistId=UUplaylist1&maxResults=51')).status).toBe(400);
      const missing = await get('/youtube/v3/playlistItems?playlistId=UUnope&maxResults=50');
      expect(missing.status).toBe(404);
      expect(JSON.stringify(await missing.json())).toContain('playlistNotFound');
    });

    it('search returns the controlled ids only for the matching query, else an empty list', async () => {
      await post('/_control/search', { channelId: CH, ids: [A] });
      const hit = (await (await get(`/youtube/v3/search?channelId=${CH}&eventType=upcoming&type=video&part=id`)).json()) as { items: unknown[] };
      expect(hit.items).toEqual([{ id: { videoId: A } }]);
      const other = (await (await get(`/youtube/v3/search?channelId=${CH2}&eventType=upcoming&type=video&part=id`)).json()) as { items: unknown[] };
      expect(other.items).toEqual([]);
      const live = (await (await get(`/youtube/v3/search?channelId=${CH}&eventType=live&type=video&part=id`)).json()) as { items: unknown[] };
      expect(live.items).toEqual([]);
    });

    it('videos items carry snippet.channelId of the channel that lists them', async () => {
      await post('/_control/channels', { channels: [{ id: CH, videos: [A] }] });
      await post('/_control/videos', { videos: [{ id: A, state: 'live' }, { id: B, state: 'live' }] });
      const body = (await (await videos([A, B])).json()) as { items: { id: string; snippet: { channelId?: string } }[] };
      expect(body.items.find((i) => i.id === A)?.snippet.channelId).toBe(CH);
      expect(body.items.find((i) => i.id === B)?.snippet.channelId).toBeUndefined();
    });

    it('counts per method with part, fields and params; the new buckets stop their methods; reset clears everything', async () => {
      await post('/_control/channels', { channels: [{ id: CH, uploads: 'UUplaylist1', videos: [A] }] });
      await get(`/youtube/v3/channels?id=${CH}&part=contentDetails&fields=items(id)`);
      await get('/youtube/v3/playlistItems?playlistId=UUplaylist1&maxResults=50&part=contentDetails');
      await get(`/youtube/v3/search?channelId=${CH}&eventType=upcoming&type=video&part=id`);
      const c = await calls();
      expect(c.counts).toMatchObject({ '/youtube/v3/channels': 1, '/youtube/v3/playlistItems': 1, '/youtube/v3/search': 1 });
      expect(c.calls[0]).toMatchObject({ part: 'contentDetails', fields: 'items(id)', params: { id: CH } });
      expect(c.calls[2]?.params).toMatchObject({ channelId: CH, eventType: 'upcoming', type: 'video' });

      await post('/_control/quota', { bucket: 'playlists', exceeded: true });
      expect((await get('/youtube/v3/playlistItems?playlistId=UUplaylist1&maxResults=50')).status).toBe(403);
      expect((await get(`/youtube/v3/channels?id=${CH}`)).status).toBe(200);
      await post('/_control/quota', { bucket: 'candidates', exceeded: true });
      expect((await get(`/youtube/v3/search?channelId=${CH}&eventType=upcoming&type=video`)).status).toBe(403);
      expect((await post('/_control/quota', { bucket: 'nope', exceeded: true })).status).toBe(400);

      await post('/_control/reset', {});
      expect((await calls()).counts).toEqual({});
      const after = await get(`/youtube/v3/channels?id=${CH}`);
      expect(after.status).toBe(200);
      expect(((await after.json()) as { items: unknown[] }).items).toEqual([]);
      expect((await get('/youtube/v3/playlistItems?playlistId=UUplaylist1&maxResults=50')).status).toBe(404);
    });

    it('serves no title, description, thumbnails or statistics anywhere', async () => {
      await post('/_control/channels', { channels: [{ id: CH, uploads: 'UUplaylist1', videos: [A] }] });
      await post('/_control/search', { channelId: CH, ids: [A] });
      const texts = [
        await (await get(`/youtube/v3/channels?id=${CH}`)).text(),
        await (await get('/youtube/v3/playlistItems?playlistId=UUplaylist1&maxResults=50')).text(),
        await (await get(`/youtube/v3/search?channelId=${CH}&eventType=upcoming&type=video`)).text(),
      ];
      for (const t of texts) expect(t).not.toMatch(/title|description|thumbnails|statistics/i);
    });
  });
});
