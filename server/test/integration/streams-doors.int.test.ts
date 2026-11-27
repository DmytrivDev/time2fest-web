/**
 * SPEC-21a AC-44: the `live` door variants `channels`, `search-results` and the `quota` bucket, in class `test` against the
 * fake YouTube; `reset-live` empties the candidates and channels; the door registry keeps its row count (20, as asserted
 * by `doors-gating.test.ts`). No request leaves the machine: the fake is loopback.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { buildDispatcher, createDeps, payloadOf, seedStoreOf } from '../../src/container';
import { quotaDay } from '../../src/domain/live/quota';
import { liveOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { baseSeedRows, runSeed } from '../../src/seed/index';
import { doorRegistry } from '../../src/test-doors/registry';

const BASE = 'http://127.0.0.1:3000';
const JSON_TYPE = { 'content-type': 'application/json' };
const SLUG = 'streams_doors_int_test';
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const CH = 'UCaaaaaaaaaaaaaaaaaaaaaa';
const V1 = 'dOoRvIdEo01';
const V2 = 'dOoRvIdEo02';
const CONTEXT = { t2fInternal: true };

describe('live door SPEC-21a variants (AC-44)', { timeout: 120_000 }, () => {
  type Fake = { url: string; close: () => Promise<void> };
  let fake: Fake;
  let deps: Deps;
  let payload: Payload;
  let dispatch: (r: Request) => Promise<Response>;
  const liveDoor = (body: unknown) => dispatch(new Request(`${BASE}/api/_test/live`, { method: 'POST', body: JSON.stringify(body), headers: JSON_TYPE }));
  const ok = async (res: Response) => {
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { value: Record<string, unknown> }).value;
  };
  const get = async (path: string) => (await fetch(`${fake.url}${path}`)).json() as Promise<{ items: unknown[] }>;
  const count = async (collection: string) => (await payload.count({ collection: collection as never, overrideAccess: true })).totalDocs;

  beforeAll(async () => {
    fake = (await startFakeYoutube({ port: 0 })) as Fake;
    deps = createDeps({ ...process.env, T2F_ENV: 'test', T2F_TEST_DOORS: '1', T2F_SLUG: SLUG, T2F_YOUTUBE_BASE_URL: fake.url }, { log: silent });
    payload = await payloadOf(deps)();
    await runSeed(seedStoreOf(deps), baseSeedRows());
    dispatch = await buildDispatcher(deps);
    await ok(await liveDoor({ door: 'reset-live' }));
  });

  afterAll(async () => {
    await liveDoor({ door: 'reset-live' });
    await fake.close();
  });

  it('channels sets the uploads playlist and videos of a channel in the fake; deleted channels vanish', async () => {
    await ok(await liveDoor({ door: 'channels', channels: [{ id: CH, uploads: 'UUdoorlist1', videos: [V1, V2] }, { id: 'UCbbbbbbbbbbbbbbbbbbbbbb', deleted: true }] }));
    expect((await get(`/youtube/v3/channels?id=${CH},UCbbbbbbbbbbbbbbbbbbbbbb`)).items).toEqual([
      { id: CH, contentDetails: { relatedPlaylists: { uploads: 'UUdoorlist1' } } },
    ]);
    const page = await get('/youtube/v3/playlistItems?playlistId=UUdoorlist1&maxResults=50');
    expect(page.items).toEqual([{ contentDetails: { videoId: V1 } }, { contentDetails: { videoId: V2 } }]);
    expect((await liveDoor({ door: 'channels', channels: [] })).status).toBe(400);
  });

  it('search-results sets the ids a search of the channel returns', async () => {
    await ok(await liveDoor({ door: 'search-results', channelId: CH, ids: [V2] }));
    expect((await get(`/youtube/v3/search?channelId=${CH}&eventType=upcoming&type=video&part=id`)).items).toEqual([{ id: { videoId: V2 } }]);
    await ok(await liveDoor({ door: 'search-results', channelId: CH, ids: [] }));
    expect((await get(`/youtube/v3/search?channelId=${CH}&eventType=upcoming&type=video&part=id`)).items).toEqual([]);
  });

  it('quota with a bucket sets that counter (default queries), replacing the others', async () => {
    const live = liveOf(deps);
    const day = quotaDay(deps.clock.now(), live.cfg.dayTimeZone);
    expect(await ok(await liveDoor({ door: 'quota', used: 7, bucket: 'candidates' }))).toEqual({ day });
    let state = await live.quota.read(day);
    expect(state.candidates?.used).toBe(7);
    expect(state.queries).toBeUndefined();
    await ok(await liveDoor({ door: 'quota', used: 11, bucket: 'playlists' }));
    state = await live.quota.read(day);
    expect(state.playlists?.used).toBe(11);
    expect(state.candidates).toBeUndefined();
    await ok(await liveDoor({ door: 'quota', used: 20, bucket: 'search', exceeded: true }));
    state = await live.quota.read(day);
    expect(state.search?.used).toBe(20);
    expect(state.search?.exceededUntil).not.toBeNull();
    await ok(await liveDoor({ door: 'quota', used: 30 }));
    state = await live.quota.read(day);
    expect(state.queries?.used).toBe(30);
    expect(state.search).toBeUndefined();
    expect((await liveDoor({ door: 'quota', used: 1, bucket: 'candidates', exceeded: true })).status).toBe(400);
    expect((await liveDoor({ door: 'quota', used: 1, bucket: 'nope' })).status).toBe(400);
  });

  it('reset-live empties stream-candidates and stream-channels and the fake channels', async () => {
    await payload.create({
      collection: 'stream-channels',
      data: { channelId: CH, name: 'Door channel', kind: 'broadcaster', priority: 3, state: 'watched' } as never,
      overrideAccess: true,
      context: CONTEXT,
    });
    await payload.create({ collection: 'stream-candidates', data: { videoId: V1, state: 'new', foundBy: ['playlist'] } as never, overrideAccess: true, context: CONTEXT });
    expect(await count('stream-channels')).toBe(1);
    expect(await count('stream-candidates')).toBe(1);
    await ok(await liveDoor({ door: 'reset-live' }));
    expect(await count('stream-channels')).toBe(0);
    expect(await count('stream-candidates')).toBe(0);
    expect((await get(`/youtube/v3/channels?id=${CH}`)).items).toEqual([]);
  });

  it('the door registry keeps its 36 rows (no new streams door row; SPEC-10 added 6 door rows, SPEC-11 6 rights rows, SPEC-14 4 presence rows)', () => {
    // SPEC-10: 4 auth rows, then 2 more for AC-54 (`auth/free-gap`, `mail/break-delivery`).
    expect(doorRegistry).toHaveLength(36);
    expect(doorRegistry.filter((d) => d.path === '/api/_test/live')).toHaveLength(1);
  });
});
