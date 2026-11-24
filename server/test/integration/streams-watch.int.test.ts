/**
 * The sources watch on the worktree's test database (SPEC-21a W25), run through the container path
 * (`streamsWatchOf`) with a test clock, the fake YouTube on port 0 and events of this run. The streams store is scoped
 * to the ids of the current test (other rows of the shared test database are never read or written by the pass).
 * Ids are synthetic per run; every row of the run is removed afterwards. Each test has its own winter quota day, so
 * the day boundary is 08:00 UTC.
 * - AC-26 schedule (6 h outside → 1 read; −6 h … +1 h → 7 reads; new video → candidate `playlist`);
 * - AC-27 +31 d → 1 `channels.list`; channel deleted → `off` + journal row (actor system);
 * - AC-28 search with 2 ids → 1 call, 2 candidates `search`; a `proposed` candidate of the event → no search;
 * - AC-30 `quotaExceeded` → zero calls until 08:00 UTC, candidates unchanged;
 * - AC-13 fake down → unchecked candidate checked on the next pass once it is back;
 * - AC-3 blacklisted channel via playlist and search → `rejected/blacklisted`;
 * - AC-46 +31 d: no YouTube field older than 30 d, a rejected candidate archived with our fields only;
 * - NFR-6: no videoId or channelId in any alarm or log line.
 */
import type { Payload } from 'payload';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createPayloadStreamsStore } from '../../src/adapters/payloadStreams';
import { payloadOf, streamsWatchOf } from '../../src/container';
import type { LiveEvent } from '../../src/domain/live/moment';
import { liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import type { StoredCandidate, StoredStreamChannel, StreamsStore } from '../../src/live/ports';
import type { StreamsWatch } from '../../src/live/watch';
import type { AlarmInput } from '../../src/ports';
import { testDeps } from './helpers';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MIN = 60_000;
const R = Math.random().toString(36).slice(2, 6).padEnd(4, 'x');
const vid = (n: number) => `${R}w${String(n).padStart(6, '0')}`;
const chid = (n: number) => `UC${R}${String(n).padStart(18, '0')}`;
const YEAR = 2040 + (Date.now() % 50);
const PATH = { videos: '/youtube/v3/videos', channels: '/youtube/v3/channels', playlist: '/youtube/v3/playlistItems', search: '/youtube/v3/search' };

type Row = Record<string, unknown> & { id: number };
interface Fake {
  url: string;
  close(): Promise<void>;
}

describe('streams watch', { timeout: 120_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let live: LiveWiring;
  let fake: Fake;
  let streams: StreamsStore;
  let now = 0;
  const alarms: AlarmInput[] = [];
  const logs: unknown[] = [];
  const events: LiveEvent[] = [];
  const scope = { channels: new Set<string>(), videos: new Set<string>() };
  const allVideos = new Set<string>();
  const days = new Set<string>();
  const watches: StreamsWatch[] = [];

  const control = async (path: string, body: unknown) => {
    const res = await fetch(`${fake.url}/_control/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
  };
  const counts = async () => ((await (await fetch(`${fake.url}/_control/calls`)).json()) as { counts: Record<string, number> }).counts;
  const count = async (path: string) => (await counts())[path] ?? 0;
  /** Winter day `n` of this run at midday UTC (the quota-day boundary is 08:00 UTC). */
  const dayStart = (n: number) => Date.UTC(YEAR, 0, 3 + 2 * n) + 12 * HOUR;

  const useVideos = (...ids: string[]) => ids.forEach((id) => (scope.videos.add(id), allVideos.add(id)));
  const useChannels = (...ids: string[]) => ids.forEach((id) => scope.channels.add(id));

  /** A watched channel of one zone of this run, uploads known now and not due for a refresh. */
  async function seedChannel(channelId: string, zone: string, extra: Partial<StoredStreamChannel> = {}) {
    useChannels(channelId);
    const row: StoredStreamChannel = {
      channelId,
      uploadsPlaylistId: `UU${channelId.slice(2)}`,
      uploadsFetchedAt: now,
      name: channelId,
      kind: 'tv',
      zones: [zone],
      seasons: [],
      priority: 3,
      state: 'watched',
      blacklisted: false,
      blacklistReason: null,
      blacklistSource: null,
      proposedBy: null,
      adminEditedAt: null,
      lastPlaylistAt: null,
      lastSearchAt: null,
      ...extra,
    };
    await live.store.inTransaction(null, (tx) => streams.saveChannel(tx, row));
  }
  async function seedCandidate(c: Partial<StoredCandidate> & Pick<StoredCandidate, 'videoId' | 'state'>, at = now) {
    useVideos(c.videoId);
    const row: StoredCandidate = {
      channelId: null,
      foundBy: ['owner'],
      reason: null,
      eventId: null,
      sourceId: null,
      liveBroadcastContent: null,
      scheduledStartTime: null,
      embeddable: null,
      privacyStatus: null,
      ytFetchedAt: null,
      checkedAt: null,
      stateChangedAt: at,
      stateChangedBy: 'owner:owner-1',
      evidenceUrl: null,
      note: null,
      ...c,
    };
    await live.store.inTransaction(null, (tx) => streams.saveCandidate(tx, row, 'owner:owner-1', at));
  }
  const candidate = async (videoId: string) => (await streams.candidates({ videoIds: [videoId] }))[0];
  const channel = async (channelId: string) => (await streams.channels({ channelIds: [channelId] }))[0];

  function watch(): StreamsWatch {
    const scoped: StreamsStore = {
      ...streams,
      candidates: async (filter, tx) => (await streams.candidates(filter, tx)).filter((c) => scope.videos.has(c.videoId)),
      channels: async (filter, tx) => (await streams.channels(filter, tx)).filter((c) => scope.channels.has(c.channelId)),
    };
    const w = streamsWatchOf(deps, {
      streams: scoped,
      events: { events: async () => events },
      clock: { now: () => now },
      alarm: { raise: (a) => void alarms.push(a) },
    });
    if (!w) throw new Error('no watch');
    watches.push(w);
    return w;
  }
  async function tick(w: StreamsWatch) {
    const r = await w.tick();
    expect(r.ran).toBe(true);
    return r;
  }

  async function clean(): Promise<void> {
    const ids = [...allVideos];
    if (ids.length) await payload.delete({ collection: 'stream-candidates' as never, where: { videoId: { in: ids } }, overrideAccess: true });
    await payload.delete({ collection: 'stream-channels' as never, where: { channelId: { like: `UC${R}` } }, overrideAccess: true });
    const quotaDays = [...days];
    if (quotaDays.length) await payload.delete({ collection: 'live-quota', where: { day: { in: quotaDays } }, overrideAccess: true });
  }

  beforeAll(async () => {
    fake = (await startFakeYoutube({ port: 0 })) as Fake;
    deps = testDeps({ log: { info: (...a: unknown[]) => void logs.push(a), warn: (...a: unknown[]) => void logs.push(a), error: (...a: unknown[]) => void logs.push(a) } }, { T2F_YOUTUBE_BASE_URL: fake.url });
    payload = await payloadOf(deps)();
    live = liveOf(deps);
    streams = createPayloadStreamsStore({ payload: payloadOf(deps), clock: { now: () => now } });
    for (let n = 0; n < 12; n++) for (let d = -1; d < 40; d++) days.add(new Date(dayStart(n) + d * DAY - 8 * HOUR).toISOString().slice(0, 10));
  });

  beforeEach(async () => {
    scope.channels.clear();
    scope.videos.clear();
    await control('reset', {});
  });

  afterEach(async () => {
    for (const w of watches.splice(0)) await w.release();
  });

  afterAll(async () => {
    if (payload) await clean();
    await fake?.close();
  });

  it('the watch exists only with a YouTube source (container path)', () => {
    expect(streamsWatchOf(testDeps({}, { T2F_YOUTUBE_BASE_URL: undefined }))).toBeUndefined();
  });

  it('AC-26: 6 h outside → 1 read; −6 h … +1 h → 7 reads; a new video → candidate `playlist`', async () => {
    const M = dayStart(0) + 12 * HOUR;
    now = M - 12 * HOUR;
    const W = chid(1);
    events.push({ eventId: `evt_${R}_1`, zoneId: `Z${R}1`, moment: M, nonMidnight: false, hidden: false });
    await control('channels', { channels: [{ id: W, videos: [] }] });
    await seedChannel(W, `Z${R}1`);
    const w = watch();
    for (let h = 12; h > 6; h--) {
      now = M - h * HOUR;
      await tick(w);
    }
    expect(await count(PATH.playlist)).toBe(1);
    const V = vid(1);
    useVideos(V);
    for (let h = 6; h >= 0; h--) {
      now = M - h * HOUR;
      if (h === 0) {
        await control('videos', { videos: [{ id: V, state: 'upcoming' }] });
        await control('channels', { channels: [{ id: W, videos: [V] }] });
      }
      await tick(w);
    }
    expect(await count(PATH.playlist)).toBe(8);
    now = M + HOUR;
    await tick(w);
    expect(await count(PATH.playlist)).toBe(8);
    const c = await candidate(V);
    expect(c?.foundBy).toEqual(['playlist']);
    expect(c?.state).toBe('new');
  });

  it('AC-27: +31 d → 1 channels.list; the channel deleted → off with a journal row of the system', async () => {
    now = dayStart(1);
    const W = chid(2);
    await control('channels', { channels: [{ id: W, videos: [] }] });
    await seedChannel(W, `Z${R}2`, { uploadsFetchedAt: now - 31 * DAY, lastPlaylistAt: now });
    const w = watch();
    await tick(w);
    expect(await count(PATH.channels)).toBe(1);
    expect(await count(PATH.playlist)).toBe(0);
    expect((await channel(W))?.uploadsFetchedAt).toBe(now);

    await control('channels', { channels: [{ id: W, deleted: true }] });
    now += 31 * DAY;
    const before = Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
    await tick(w);
    expect(await count(PATH.channels)).toBe(2);
    expect(await count(PATH.playlist)).toBe(0);
    expect((await channel(W))?.state).toBe('off');
    const rows = (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: before } }, { action: { equals: 'streams.channel' } }] },
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
    const mine = rows.filter((r) => (r.target as { ref?: string } | undefined)?.ref === W);
    expect(mine).toHaveLength(1);
    expect((mine[0]?.actor as { kind?: string }).kind).toBe('system');
  });

  it('AC-28: a search with 2 ids → 1 call, 2 candidates `search`; a proposed candidate of the event → no search', async () => {
    now = dayStart(2);
    const W = chid(3);
    const W2 = chid(4);
    const [A, B, P] = [vid(3), vid(4), vid(5)];
    useVideos(A, B);
    events.push(
      { eventId: `evt_${R}_3`, zoneId: `Z${R}3`, moment: now + 6 * HOUR, nonMidnight: false, hidden: false },
      { eventId: `evt_${R}_4`, zoneId: `Z${R}4`, moment: now + 6 * HOUR, nonMidnight: false, hidden: false },
    );
    await control('videos', { videos: [{ id: A, state: 'upcoming' }, { id: B, state: 'upcoming' }] });
    await control('channels', { channels: [{ id: W, videos: [] }, { id: W2, videos: [] }] });
    await control('search', { channelId: W, ids: [A, B] });
    await control('search', { channelId: W2, ids: [A] });
    await seedChannel(W, `Z${R}3`, { lastPlaylistAt: now });
    await seedChannel(W2, `Z${R}4`, { lastPlaylistAt: now });
    await seedCandidate({ videoId: P, state: 'proposed', eventId: `evt_${R}_4`, checkedAt: now });
    const w = watch();
    await tick(w);
    expect(await count(PATH.search)).toBe(1);
    for (const id of [A, B]) expect((await candidate(id))?.foundBy).toEqual(['search']);
    now += 30 * MIN;
    await tick(w);
    expect(await count(PATH.search)).toBe(1);
  });

  it('AC-30: quotaExceeded → zero calls until 08:00 UTC, the candidates unchanged', async () => {
    now = dayStart(3);
    const W = chid(5);
    const C = vid(6);
    await control('channels', { channels: [{ id: W, videos: [] }] });
    await seedChannel(W, `Z${R}5`);
    await seedCandidate({ videoId: C, state: 'proposed', checkedAt: now });
    const before = await candidate(C);
    await control('quota', { bucket: 'playlists', exceeded: true });
    const w = watch();
    await tick(w);
    const first = await counts();
    expect(first[PATH.playlist]).toBe(1);
    for (const h of [1, 6, 12, 19]) {
      now = dayStart(3) + h * HOUR - MIN;
      await tick(w);
    }
    expect(await counts()).toEqual(first);
    expect(await candidate(C)).toEqual(before);
    await control('quota', { bucket: 'playlists', exceeded: false });
    now = dayStart(3) + 20 * HOUR; // 08:00 UTC of the next day
    await tick(w);
    expect(await count(PATH.playlist)).toBe(2);
    expect(await candidate(C)).toEqual(before);
  });

  it('AC-13: the fake down → the candidate stays unchecked; back → checked on the next pass', async () => {
    now = dayStart(4);
    const V = vid(7);
    await control('videos', { videos: [{ id: V, state: 'upcoming' }] });
    await seedCandidate({ videoId: V, state: 'new' });
    await control('down', { on: true });
    const w = watch();
    await tick(w);
    expect((await candidate(V))?.checkedAt).toBeNull();
    expect((await candidate(V))?.state).toBe('new');
    await control('down', { on: false });
    now += MIN;
    await tick(w);
    expect((await candidate(V))?.checkedAt).toBe(now);
    expect((await candidate(V))?.state).toBe('new');
  });

  it('AC-3: a video of a blacklisted channel via playlist and via search → rejected / blacklisted', async () => {
    now = dayStart(5);
    const BL = chid(6);
    const W = chid(7);
    const [X, Y] = [vid(8), vid(9)];
    useVideos(X, Y);
    events.push({ eventId: `evt_${R}_7`, zoneId: `Z${R}7`, moment: now + 6 * HOUR, nonMidnight: false, hidden: false });
    await control('videos', { videos: [{ id: X, state: 'upcoming' }, { id: Y, state: 'upcoming' }] });
    await control('channels', { channels: [{ id: BL, videos: [X, Y] }, { id: W, videos: [X] }] });
    await control('search', { channelId: W, ids: [Y] });
    await seedChannel(BL, `Z${R}7`, { state: 'off', blacklisted: true, blacklistReason: 'spam', blacklistSource: 'admin' });
    await seedChannel(W, `Z${R}7`);
    const w = watch();
    await tick(w);
    expect(await count(PATH.search)).toBe(1);
    const x = await candidate(X);
    const y = await candidate(Y);
    expect([x?.state, x?.reason, x?.foundBy]).toEqual(['rejected', 'blacklisted', ['playlist']]);
    expect([y?.state, y?.reason, y?.foundBy]).toEqual(['rejected', 'blacklisted', ['search']]);
  });

  it('AC-46: +31 d → no YouTube field older than 30 d; a rejected candidate archived with our fields only', async () => {
    const T = dayStart(6);
    now = T;
    const [N, Pr, Rj] = [vid(10), vid(11), vid(12)];
    const fields = { channelId: chid(8), liveBroadcastContent: 'upcoming', scheduledStartTime: T + DAY, embeddable: true, privacyStatus: 'public', ytFetchedAt: T, checkedAt: T };
    await seedCandidate({ videoId: N, state: 'new', ...fields });
    await seedCandidate({ videoId: Pr, state: 'proposed', ...fields });
    await seedCandidate({ videoId: Rj, state: 'rejected', reason: 'not-live', ...fields });
    await control('videos', { videos: [{ id: N, state: 'upcoming' }] });
    now = T + 31 * DAY;
    const w = watch();
    const r = await tick(w);
    expect(r.retention).toEqual({ refreshed: 1, stripped: 1, archived: 1 });
    const all = await streams.candidates({ videoIds: [N, Pr, Rj] });
    expect(all.filter((c) => c.ytFetchedAt != null && now - c.ytFetchedAt > 30 * DAY)).toEqual([]);
    expect((await candidate(N))?.ytFetchedAt).toBe(now);
    const pr = await candidate(Pr);
    expect([pr?.state, pr?.ytFetchedAt, pr?.liveBroadcastContent]).toEqual(['proposed', null, null]);
    const rj = await candidate(Rj);
    expect(rj).toMatchObject({
      videoId: Rj,
      channelId: chid(8),
      foundBy: ['owner'],
      state: 'archive',
      reason: 'not-live',
      stateChangedAt: T,
      liveBroadcastContent: null,
      scheduledStartTime: null,
      embeddable: null,
      privacyStatus: null,
      ytFetchedAt: null,
    });
  });

  it('NFR-6: no videoId or channelId in any alarm or log line', () => {
    const text = JSON.stringify([alarms, logs]);
    for (const id of [...allVideos, ...[1, 2, 3, 4, 5, 6, 7, 8].map(chid)]) expect(text.includes(id)).toBe(false);
  });
});
