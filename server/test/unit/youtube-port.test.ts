/** SPEC-12 AC-33, AC-39, AC-71, AC-75: one port suite against both adapters, both pointed at the fake (never the real API). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createYoutubeDataSource } from '../../src/adapters/youtubeData';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import { statusFromCheck } from '../../src/domain/live/status';
import type { SearchSource, VideoStatusSource } from '../../src/live/ports';

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

const control = (path: string, body: unknown) =>
  fetch(`${fake.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const adapters: [string, () => VideoStatusSource & SearchSource][] = [
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
    expect(await make().search()).toEqual({ ok: true });
    await control('/_control/quota', { bucket: 'search', exceeded: true });
    expect(await make().search()).toEqual({ error: 'quota-exceeded' });
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
});
