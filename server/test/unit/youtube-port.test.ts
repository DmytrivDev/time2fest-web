/** SPEC-12 AC-33, AC-39, AC-71, AC-75: one port suite against both adapters, both pointed at the fake (never the real API). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createYoutubeDataSource, VIDEO_FIELDS, VIDEO_PARTS, type YoutubeSource } from '../../src/adapters/youtubeData';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import { statusFromCheck } from '../../src/domain/live/status';

const A = 'zMCea32gpmg';
const B = 'MXmzsjABC-U';
const CH = 'UCaaaaaaaaaaaaaaaaaaaaaa';

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

const control = (path: string, body: unknown) =>
  fetch(`${fake.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const adapters: [string, () => YoutubeSource][] = [
  ['youtubeData', () => createYoutubeDataSource({ baseUrl: fake.url, apiKey: 'fake-key' })], // check-secrets: allow test fake
  ['youtubeFake', () => createYoutubeFakeSource(fake.url)],
];

describe.each(adapters)('video status port: %s', (_name, make) => {
  it('maps states to domain statuses', async () => {
    const now = Date.parse('2026-12-31T12:00:00Z');
    await control('/_control/videos', { videos: [{ id: A, state: 'live' }, { id: B, state: 'upcoming', scheduledStartTime: '2026-12-31T22:00:00Z' }] });
    const r = await make().list([A, B]);
    if (!('items' in r)) throw new Error('expected items');
    expect(statusFromCheck(r.items.find((i) => i.videoId === A), now)).toEqual({ kind: 'alive', status: 'live' });
    expect(statusFromCheck(r.items.find((i) => i.videoId === B), now)).toMatchObject({ kind: 'alive', status: 'expected' });
    await control('/_control/videos', { videos: [{ id: A, state: 'deleted' }, { id: B, state: 'private' }] });
    const g = await make().list([A, B]);
    if (!('items' in g)) throw new Error('expected items');
    expect(statusFromCheck(g.items.find((i) => i.videoId === A), now)).toEqual({ kind: 'dead', reason: 'missing' });
    expect(statusFromCheck(g.items.find((i) => i.videoId === B), now)).toEqual({ kind: 'dead', reason: 'private' });
  });

  it('takes a batch of 50 and refuses 51 without a call', async () => {
    expect(await make().list(Array.from({ length: 50 }, () => A))).toEqual({ items: [] });
    expect(await make().list(Array.from({ length: 51 }, () => A))).toEqual({ error: 'invalid' });
    const c = (await (await fetch(`${fake.url}/_control/calls`)).json()) as { counts: Record<string, number> };
    expect(c.counts['/youtube/v3/videos']).toBe(1);
  });

  it('reports quota-exceeded per bucket and unavailable when down', async () => {
    await control('/_control/quota', { bucket: 'queries', exceeded: true });
    expect(await make().list([A])).toEqual({ error: 'quota-exceeded' });
    expect(await make().search({ channelId: CH })).toEqual({ ids: [] });
    await control('/_control/quota', { bucket: 'search', exceeded: true });
    expect(await make().search({ channelId: CH })).toEqual({ error: 'quota-exceeded' });
    await control('/_control/reset', {});
    await control('/_control/down', { on: true });
    expect(await make().list([A])).toEqual({ error: 'unavailable' });
  });

  it('never asks for statistics or titles and never maps a title', async () => {
    await control('/_control/videos', { videos: [{ id: A, state: 'live' }] });
    const r = await make().list([A]);
    expect(JSON.stringify(r)).not.toMatch(/title|statistics/i);
    const c = (await (await fetch(`${fake.url}/_control/calls`)).json()) as { calls: { part: string | null; fields: string | null }[] };
    for (const call of c.calls) expect(`${call.part}${call.fields}`).not.toMatch(/statistics|title/i);
  });

  it('channels: maps the uploads playlist, an unknown channel is absent, 51 ids refused without a call', async () => {
    await control('/_control/channels', { channels: [{ id: CH, uploads: 'UUplaylist1' }] });
    expect(await make().channels([CH, 'UCzzzzzzzzzzzzzzzzzzzzzz'])).toEqual({ channels: [{ id: CH, uploadsPlaylistId: 'UUplaylist1' }] });
    expect(await make().channels(Array.from({ length: 51 }, () => CH))).toEqual({ error: 'invalid' });
    expect(await make().channels([])).toEqual({ error: 'invalid' });
  });

  it('firstPage: video ids newest first, not-found for an unknown playlist, quota and down mapped', async () => {
    await control('/_control/channels', { channels: [{ id: CH, uploads: 'UUplaylist1', videos: [B, A] }] });
    expect(await make().firstPage('UUplaylist1')).toEqual({ ok: true, videoIds: [B, A] });
    expect(await make().firstPage('UUnope')).toEqual({ ok: false, reason: 'not-found' });
    await control('/_control/quota', { bucket: 'playlists', exceeded: true });
    expect(await make().firstPage('UUplaylist1')).toEqual({ ok: false, reason: 'quota-exceeded' });
    await control('/_control/reset', {});
    await control('/_control/down', { on: true });
    expect(await make().firstPage('UUplaylist1')).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('search: the controlled ids of the channel; videos carry channelId', async () => {
    await control('/_control/search', { channelId: CH, ids: [A, B] });
    expect(await make().search({ channelId: CH })).toEqual({ ids: [A, B] });
    await control('/_control/channels', { channels: [{ id: CH, videos: [A] }] });
    await control('/_control/videos', { videos: [{ id: A, state: 'upcoming' }] });
    const r = await make().list([A]);
    if (!('items' in r)) throw new Error('expected items');
    expect(r.items[0]?.channelId).toBe(CH);
  });

  it('sends exactly the minimal part and fields of every method, and never a title, description, thumbnail or statistic', async () => {
    await control('/_control/channels', { channels: [{ id: CH, uploads: 'UUplaylist1', videos: [A] }] });
    await control('/_control/videos', { videos: [{ id: A, state: 'live' }] });
    const s = make();
    await s.list([A]);
    await s.channels([CH]);
    await s.firstPage('UUplaylist1');
    await s.search({ channelId: CH });
    const c = (await (await fetch(`${fake.url}/_control/calls`)).json()) as { calls: { path: string; part: string | null; fields: string | null; params: Record<string, string> }[] };
    const by = (p: string) => c.calls.find((x) => x.path === p);
    expect(by('/youtube/v3/videos')).toMatchObject({ part: VIDEO_PARTS, fields: VIDEO_FIELDS });
    expect(by('/youtube/v3/videos')?.fields).toContain('snippet(channelId,liveBroadcastContent)');
    expect(by('/youtube/v3/channels')).toMatchObject({ part: 'contentDetails', fields: 'items(id,contentDetails/relatedPlaylists/uploads)' });
    expect(by('/youtube/v3/playlistItems')).toMatchObject({ part: 'contentDetails', fields: 'items/contentDetails/videoId', params: { playlistId: 'UUplaylist1', maxResults: '50' } });
    expect(by('/youtube/v3/search')).toMatchObject({
      part: 'id',
      fields: 'items/id/videoId',
      params: { channelId: CH, eventType: 'upcoming', type: 'video' },
    });
    for (const call of c.calls) expect(`${call.part} ${call.fields}`).not.toMatch(/title|description|thumbnails|statistics/i);
  });
});
