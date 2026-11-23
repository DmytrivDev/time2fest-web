/**
 * The live status poller against the `_test` database and the fake YouTube (SPEC-12 AC-9, AC-10, AC-24, AC-28 … AC-30,
 * AC-39, AC-58). Time is the test's: `tick(now)` is called directly with virtual instants, never the real ticker.
 * Only ids of `data/streams.json`; the events are given to the poller (the catalog is not read).
 */
import type { Payload } from 'payload';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import { eventsOf, payloadOf, youtubeAdapterFor } from '../../src/container';
import { liveOf } from '../../src/endpoints/deps';
import { publicChain } from '../../src/domain/live/chain';
import type { LiveEvent } from '../../src/domain/live/moment';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import { createLivePoller, LIVE_CHANGED_TOPIC, type LiveChangedPayload, type LivePoller } from '../../src/live/poller';
import type { AlarmInput } from '../../src/ports';
import { silent, testDeps } from './helpers';

const at = (isoText: string) => Date.parse(isoText);
const SEC = 1_000;

const LONDON: LiveEvent = { eventId: 'evt_london_2027', zoneId: 'Europe/London', moment: at('2027-01-01T00:00:00Z'), nonMidnight: false, hidden: false };
const PARIS: LiveEvent = { eventId: 'evt_paris_2027', zoneId: 'Europe/Paris', moment: at('2026-12-31T23:00:00Z'), nonMidnight: false, hidden: false };
/** A non-midnight Paris event at 22:50 UTC (AC-58): its own moment and window, not the midnight slot. */
const PARIS_SHOW: LiveEvent = { eventId: 'evt_paris-show_2027', zoneId: 'Europe/Paris', moment: at('2026-12-31T22:50:00Z'), nonMidnight: true, hidden: false };

const V = {
  london1: 'zMCea32gpmg',
  london2: 'MXmzsjABC-U',
  london3: 'Y6gzQmbSpEg',
  paris1: 'QI-PPEW2Bgc',
  paris2: '-xzg3wujOVM',
};

interface Fake {
  url: string;
  close(): Promise<void>;
}

let fake: Fake;
let deps: Deps;
let payload: Payload;
let live: LiveWiring;
const alarms: AlarmInput[] = [];
const changes: LiveChangedPayload[] = [];
const pollers: LivePoller[] = [];

async function control(path: string, body: unknown): Promise<void> {
  const res = await fetch(fake.url + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`fake control ${path}: ${res.status}`);
}
async function fakeCalls(): Promise<string[][]> {
  const body = (await (await fetch(fake.url + '/_control/calls')).json()) as { calls: { path: string; ids: string[] }[] };
  return body.calls.filter((c) => c.path === '/youtube/v3/videos').map((c) => c.ids);
}
const videos = (list: { id: string; state: string; embeddable?: boolean; scheduledStartTime?: string }[]) => control('/_control/videos', { videos: list });

async function addSource(row: Record<string, unknown>): Promise<void> {
  await payload.create({
    collection: 'stream-sources',
    data: { platform: 'youtube', order: 0, status: 'live', embeddable: true, privacyStatus: 'public', ...row } as never,
    overrideAccess: true,
  });
}

function poller(events: LiveEvent[]): LivePoller {
  const real = eventsOf(deps).publisher;
  const p = createLivePoller({
    store: live.store,
    quota: live.quota,
    lease: live.lease,
    statuses: createYoutubeFakeSource(fake.url),
    events: { events: async () => events },
    publisher: {
      async publish(tx, topic, body) {
        if (topic === LIVE_CHANGED_TOPIC) changes.push(body as LiveChangedPayload);
        return real.publish(tx, topic, body);
      },
    },
    alarm: { raise: (a) => alarms.push(a) },
    cfg: live.cfg,
    caller: live.caller,
  });
  pollers.push(p);
  return p;
}

async function chainOf(event: LiveEvent, now: number) {
  const sources = await live.store.sources({ eventIds: [event.eventId] });
  return publicChain(event, sources, { now, cfg: live.cfg, zoneLive: (await live.store.state()).zoneLive });
}

async function clean(): Promise<void> {
  for (const collection of ['stream-sources', 'live-quota'] as const) {
    await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true });
  }
  await live.store.claimPendingChecks();
}

beforeAll(async () => {
  fake = (await startFakeYoutube({ port: 0 })) as Fake;
  deps = testDeps({ log: silent }, { T2F_YOUTUBE_BASE_URL: fake.url });
  payload = await payloadOf(deps)();
  live = liveOf(deps);
});

beforeEach(async () => {
  await clean();
  await control('/_control/reset', {});
  alarms.length = 0;
  changes.length = 0;
});

afterEach(async () => {
  for (const p of pollers.splice(0)) await p.release();
});

afterAll(async () => {
  if (payload) await clean();
  await fake?.close();
});

describe('live poller (fake YouTube, test clock)', () => {
  it('AC-39: every class selects the fake; the status source exists only with T2F_YOUTUBE_BASE_URL', () => {
    for (const cls of ['test', 'rehearsal', 'production'] as const) expect(youtubeAdapterFor(cls)).toBe('fake');
    expect(live.statuses).toBeDefined();
    expect(liveOf(testDeps({ log: silent }, { T2F_YOUTUBE_BASE_URL: undefined })).statuses).toBeUndefined();
  });

  it('AC-24: 10 min of an open window — no source lastChecked older than 30 s', { timeout: 120_000 }, async () => {
    await addSource({ sourceId: 'src_london_1', eventId: LONDON.eventId, videoId: V.london1, order: 0 });
    await addSource({ sourceId: 'src_london_2', eventId: LONDON.eventId, videoId: V.london2, order: 1 });
    await addSource({ sourceId: 'src_london_3', eventId: LONDON.eventId, videoId: V.london3, order: 2 });
    await videos([V.london1, V.london2, V.london3].map((id) => ({ id, state: 'live' })));
    const p = poller([LONDON]);
    const start = at('2026-12-31T23:05:00Z');
    let worst = 0;
    for (let now = start; now <= start + 10 * 60 * SEC; now += 5 * SEC) {
      expect((await p.tick(now)).ran).toBe(true);
      const rows = await live.store.sources({ eventIds: [LONDON.eventId] });
      for (const r of rows) worst = Math.max(worst, now - (r.lastChecked ?? 0));
      // The next pass comes 5 s later: the age then is at most 30 s.
      for (const r of rows) expect(now + 5 * SEC - (r.lastChecked ?? 0)).toBeLessThanOrEqual(30 * SEC);
    }
    expect(worst).toBeLessThanOrEqual(30 * SEC);
    // One merged cycle per 30 s: one call per cycle for three ids.
    expect((await fakeCalls()).length).toBe(21);
  });

  it('AC-28: expected without startsAt at −5:30, possible in the first tick after −5 min', async () => {
    await addSource({ sourceId: 'src_paris_2', eventId: PARIS.eventId, videoId: V.paris2, status: 'expected' });
    // The fake is down: statuses stay as stored, only time changes the chain.
    await control('/_control/down', { on: true });
    const p = poller([PARIS]);
    const before = at('2026-12-31T22:54:30Z');
    await p.tick(before);
    expect((await chainOf(PARIS, before))?.sources.map((s) => s.status)).toEqual(['expected']);
    const after = at('2026-12-31T22:55:00Z');
    const report = await p.tick(after);
    expect((await chainOf(PARIS, after))?.sources.map((s) => s.status)).toEqual(['possible']);
    expect(report.version).toBeGreaterThan(0);
    expect(changes.at(-1)).toEqual({ version: report.version, eventIds: [PARIS.eventId] });
  });

  it('AC-29: embeddable false → the source leaves the chain and a chain change is published', async () => {
    await addSource({ sourceId: 'src_paris_2', eventId: PARIS.eventId, videoId: V.paris2, order: 0 });
    await addSource({ sourceId: 'src_paris_3', eventId: PARIS.eventId, videoId: 'IOGYiO96eHA', order: 1 });
    await videos([
      { id: V.paris2, state: 'live', embeddable: false },
      { id: 'IOGYiO96eHA', state: 'live' },
    ]);
    const now = at('2026-12-31T22:30:00Z');
    const report = await poller([PARIS]).tick(now);
    expect((await chainOf(PARIS, now))?.sources.map((s) => s.id)).toEqual(['src_paris_3']);
    expect(changes).toEqual([{ version: report.version, eventIds: [PARIS.eventId] }]);
  });

  it('AC-30: main ended → the next one is first; all dead → sources: []', async () => {
    await addSource({ sourceId: 'src_london_1', eventId: LONDON.eventId, videoId: V.london1, order: 0 });
    await addSource({ sourceId: 'src_london_2', eventId: LONDON.eventId, videoId: V.london2, order: 1 });
    await videos([
      { id: V.london1, state: 'ended' },
      { id: V.london2, state: 'live' },
    ]);
    const p = poller([LONDON]);
    const t1 = at('2026-12-31T23:30:00Z');
    await p.tick(t1);
    expect((await chainOf(LONDON, t1))?.sources.map((s) => s.id)).toEqual(['src_london_2']);
    expect(changes.at(-1)?.eventIds).toEqual([LONDON.eventId]);
    await videos([{ id: V.london2, state: 'deleted' }]);
    const t2 = t1 + 30 * SEC;
    await p.tick(t2);
    expect(await chainOf(LONDON, t2)).toEqual({ eventId: LONDON.eventId, sources: [] });
    expect(changes).toHaveLength(2);
  });

  it('AC-9: an override live is kept although the fake says ended; one override-kept line', async () => {
    await addSource({ sourceId: 'src_london_1', eventId: LONDON.eventId, videoId: V.london1, order: 0, override: 'live', status: 'live' });
    await videos([{ id: V.london1, state: 'ended' }]);
    const p = poller([LONDON]);
    const t = at('2026-12-31T23:30:00Z');
    await p.tick(t);
    await p.tick(t + 30 * SEC);
    const [row] = await live.store.sources({ sourceIds: ['src_london_1'] });
    expect(row).toMatchObject({ status: 'live', dead: false, override: 'live' });
    expect((await chainOf(LONDON, t + 30 * SEC))?.sources.map((s) => [s.id, s.status, s.override])).toEqual([['src_london_1', 'live', true]]);
    expect(alarms.filter((a) => a.code === 'live/override-kept')).toHaveLength(1);
  });

  it('AC-10: a hidden event patch → no chain, and the fake is never asked its ids', async () => {
    await addSource({ sourceId: 'src_london_1', eventId: LONDON.eventId, videoId: V.london1 });
    await videos([{ id: V.london1, state: 'live' }]);
    const hidden = { ...LONDON, hidden: true };
    const p = poller([hidden]);
    const t = at('2026-12-31T23:30:00Z');
    for (let i = 0; i < 4; i += 1) await p.tick(t + i * 30 * SEC);
    expect((await fakeCalls()).flat()).not.toContain(V.london1);
    expect(await chainOf(hidden, t)).toBeNull();
  });

  it('AC-58: a non-midnight event at 22:50 UTC — its startsAt, polled 21:50 … 23:50 only, not in the midnight slot', async () => {
    const far = '2027-01-10T00:00:00Z';
    await addSource({ sourceId: 'src_paris_1', eventId: PARIS_SHOW.eventId, videoId: V.paris1, startsAt: '2026-12-31T22:50:00Z', nextOffWindowCheckAt: far });
    await addSource({ sourceId: 'src_paris_2', eventId: PARIS.eventId, videoId: V.paris2, nextOffWindowCheckAt: far });
    await videos([
      { id: V.paris1, state: 'live' },
      { id: V.paris2, state: 'live' },
    ]);
    const p = poller([PARIS_SHOW, PARIS]);
    const asked = async (now: number) => {
      await control('/_control/reset', {});
      await videos([
        { id: V.paris1, state: 'live' },
        { id: V.paris2, state: 'live' },
      ]);
      await p.tick(now);
      return (await fakeCalls()).flat();
    };
    expect(await asked(at('2026-12-31T21:49:00Z'))).toEqual([]);
    expect(await asked(at('2026-12-31T21:50:00Z'))).toEqual([V.paris1]);
    expect(await asked(at('2026-12-31T22:00:00Z'))).toEqual([V.paris1, V.paris2]);
    expect(await asked(at('2026-12-31T23:49:30Z'))).toEqual([V.paris1, V.paris2]);
    expect(await asked(at('2026-12-31T23:50:00Z'))).toEqual([V.paris2]);
    const now = at('2026-12-31T22:40:00Z');
    const show = await chainOf(PARIS_SHOW, now);
    expect(show?.sources.map((s) => [s.id, s.startsAt])).toEqual([['src_paris_1', '2026-12-31T22:50:00.000Z']]);
    expect((await chainOf(PARIS, now))?.sources.map((s) => s.id)).toEqual(['src_paris_2']);
  });
});
