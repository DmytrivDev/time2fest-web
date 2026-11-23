/**
 * `POST /api/live/source-errors` against the `_test` database, Redis and the fake YouTube (SPEC-12 AC-42 … AC-45,
 * NFR-4; W25). Reports go through the real dispatcher (edge secret + `x-t2f-client`, one client address per case so
 * each has its own rate-limit bucket); the queued checks are handled by a poller built here and ticked at virtual
 * instants, never the real ticker. Only ids of `data/streams.json`.
 * - AC-42: the five refusals (body over 1 KiB, schema, code outside the list, unknown event, unknown source) → 400
 *   `validation`, nothing queued.
 * - AC-43: 5 reports in 20 s on an off-window source → one check, at the first pass after the first report (≤10 s);
 *   a report on a source of an open window → no call beyond the cycle's.
 * - AC-44: the ad-hoc ceiling (scaled down through `T2F_LIVE_CONFIG`) spent → still 202, the fake's count unchanged.
 * - AC-45: 100 reports leave the status as stored; the check (fake says `live`) makes it `live`.
 * - NFR-4: the 11th report of one client within a minute → 429 `rate_limited`.
 */
import { randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import { buildDispatcher, eventsOf, payloadOf } from '../../src/container';
import { liveOf } from '../../src/endpoints/deps';
import type { LiveEvent } from '../../src/domain/live/moment';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import { createLivePoller, type LivePoller } from '../../src/live/poller';
import { ORIGIN, ownRedis, silent, testDeps } from './helpers';

const at = (isoText: string) => Date.parse(isoText);
const SEC = 1_000;
const MIN = 60 * SEC;
const PATH = '/api/live/source-errors';
const RL_PREFIX = 'rl:live-source-errors:';
// Built at runtime: no secret-looking literal in the test.
const EDGE_SECRET = randomBytes(20).toString('hex');

/** A virtual "now" outside the blackout and far from any window of `FAR`. */
const T0 = at('2026-12-20T12:00:00Z');
const FAR: LiveEvent = { eventId: 'evt_london_2027', zoneId: 'Europe/London', moment: at('2027-01-01T00:00:00Z'), nonMidnight: false, hidden: false };
/** An event whose window is open at `T0` (moment 10 min later). */
const OPEN: LiveEvent = { eventId: 'evt_paris_2027', zoneId: 'Europe/Paris', moment: T0 + 10 * MIN, nonMidnight: false, hidden: false };

const V = { a: 'zMCea32gpmg', b: 'MXmzsjABC-U', c: 'Y6gzQmbSpEg', open: 'QI-PPEW2Bgc' };

interface Fake {
  url: string;
  close(): Promise<void>;
}

type Dispatch = (r: Request) => Promise<Response>;

const redis = ownRedis();
let fake: Fake;
let deps: Deps;
let payload: Payload;
let live: LiveWiring;
let dispatch: Dispatch;
const pollers: LivePoller[] = [];

let ipSeq = 0;
/** A fresh client address (own rate-limit bucket) from TEST-NET-3. */
const nextIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;

const reportRaw = (raw: string, ip: string) =>
  dispatch(
    new Request(`http://127.0.0.1:3000${PATH}`, {
      method: 'POST',
      body: raw,
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-t2f-edge': EDGE_SECRET, 'x-t2f-client': `${ip};UA` },
    }),
  );
const report = (body: unknown, ip: string) => reportRaw(JSON.stringify(body), ip);
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; reason?: string } }).error;

async function control(path: string, body: unknown): Promise<void> {
  const res = await fetch(fake.url + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`fake control ${path}: ${res.status}`);
}
/** The ids of every `videos.list` call the fake got, per call. */
async function fakeCalls(): Promise<string[][]> {
  const body = (await (await fetch(fake.url + '/_control/calls')).json()) as { calls: { path: string; ids: string[] }[] };
  return body.calls.filter((c) => c.path === '/youtube/v3/videos').map((c) => c.ids);
}
const callsOf = async (videoId: string) => (await fakeCalls()).filter((ids) => ids.includes(videoId)).length;
const videos = (list: { id: string; state: string }[]) => control('/_control/videos', { videos: list });

async function addSource(row: Record<string, unknown>): Promise<void> {
  await payload.create({
    collection: 'stream-sources',
    // Off-window checks far ahead, so only a report (or an open window) makes a call.
    data: {
      platform: 'youtube',
      order: 0,
      status: 'possible',
      embeddable: true,
      privacyStatus: 'public',
      nextOffWindowCheckAt: '2027-06-01T00:00:00.000Z',
      ...row,
    } as never,
    overrideAccess: true,
  });
}

function poller(wiring: LiveWiring, events: LiveEvent[]): LivePoller {
  const p = createLivePoller({
    store: wiring.store,
    quota: wiring.quota,
    lease: wiring.lease,
    statuses: createYoutubeFakeSource(fake.url),
    events: { events: async () => events },
    publisher: eventsOf(deps).publisher,
    alarm: { raise: () => {} },
    cfg: wiring.cfg,
    caller: wiring.caller,
  });
  pollers.push(p);
  return p;
}

async function pending(): Promise<string[]> {
  return (await live.store.state()).pendingChecks.map((p) => p.sourceId);
}

async function statusOf(sourceId: string): Promise<string | null | undefined> {
  return (await live.store.sources({ sourceIds: [sourceId] }))[0]?.status;
}

async function clean(): Promise<void> {
  for (const collection of ['stream-sources', 'live-quota'] as const) {
    await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true });
  }
  await live.store.claimPendingChecks();
}

beforeAll(async () => {
  fake = (await startFakeYoutube({ port: 0 })) as Fake;
  await redis.deleteByPrefix(RL_PREFIX);
  deps = testDeps({ redis, log: silent }, { T2F_EDGE_SECRET: EDGE_SECRET, T2F_YOUTUBE_BASE_URL: fake.url });
  payload = await payloadOf(deps)();
  live = liveOf(deps);
  dispatch = await buildDispatcher(deps);
}, 120_000);

beforeEach(async () => {
  await clean();
  await control('/_control/reset', {});
  await addSource({ sourceId: 'src_a', eventId: FAR.eventId, videoId: V.a });
  await addSource({ sourceId: 'src_b', eventId: FAR.eventId, videoId: V.b, order: 1 });
  await addSource({ sourceId: 'src_c', eventId: FAR.eventId, videoId: V.c, order: 2 });
  await addSource({ sourceId: 'src_open', eventId: OPEN.eventId, videoId: V.open });
  await videos([V.a, V.b, V.c, V.open].map((id) => ({ id, state: 'live' })));
});

afterEach(async () => {
  for (const p of pollers.splice(0)) await p.release();
});

afterAll(async () => {
  if (payload) await clean();
  await redis.deleteByPrefix(RL_PREFIX);
  await redis.close();
  await fake?.close();
});

describe('POST /api/live/source-errors', { timeout: 180_000 }, () => {
  it('AC-42: over 1 KiB, bad schema, code outside the list, unknown event, unknown source → 400 validation, nothing queued', async () => {
    const valid = { eventId: FAR.eventId, sourceId: 'src_a', code: 150 };
    // Valid JSON of a valid report, padded with whitespace past 1 024 bytes: only the size is wrong.
    const big = `{"eventId":"${FAR.eventId}","sourceId":"src_a","code":150${' '.repeat(1_024)}}`;
    expect(big.length).toBeGreaterThan(1_024);
    const cases: [string, () => Promise<Response>][] = [
      ['over 1 KiB', () => reportRaw(big, nextIp())],
      ['bad schema', () => report({ eventId: FAR.eventId, sourceId: 'src_a', code: '150', extra: 1 }, nextIp())],
      ['code outside the list', () => report({ ...valid, code: 3 }, nextIp())],
      ['unknown event', () => report({ ...valid, eventId: 'evt_nowhere_2027' }, nextIp())],
      ['unknown source', () => report({ ...valid, sourceId: 'src_nowhere' }, nextIp())],
    ];
    for (const [name, send] of cases) {
      const res = await send();
      expect(res.status, name).toBe(400);
      expect((await errorOf(res)).code, name).toBe('validation');
    }
    expect(await pending()).toEqual([]);
    // The control: the same report, well-formed, is accepted.
    expect((await report(valid, nextIp())).status).toBe(202);
    expect(await pending()).toEqual(['src_a']);
  });

  it('AC-43: 5 reports in 20 s on an off-window source → one check, at the first pass ≤10 s after the first report', async () => {
    const p = poller(live, [FAR, OPEN]);
    await p.tick(T0); // the first status cycle (only the open window is asked)
    const before = await callsOf(V.a);
    expect(before).toBe(0);
    const ip = nextIp();
    for (let i = 0; i < 5; i++) {
      const res = await report({ eventId: FAR.eventId, sourceId: 'src_a', code: 150 }, ip);
      expect(res.status).toBe(202);
      await p.tick(T0 + (i + 1) * 5 * SEC);
      // Checked at the first pass (5 s after the first report), never again within the 20 s.
      expect(await callsOf(V.a), `after report ${i + 1}`).toBe(1);
    }
  });

  it('AC-43: a report on a source of an open window → no call beyond the cycle', async () => {
    const p = poller(live, [FAR, OPEN]);
    await p.tick(T0);
    expect(await callsOf(V.open)).toBe(1);
    expect((await report({ eventId: OPEN.eventId, sourceId: 'src_open', code: 101 }, nextIp())).status).toBe(202);
    await p.tick(T0 + 5 * SEC);
    await p.tick(T0 + 10 * SEC);
    expect(await callsOf(V.open)).toBe(1);
  });

  it('AC-45: 100 reports leave the status as stored; the check (fake says live) makes it live', async () => {
    for (let i = 0; i < 100; i++) {
      const res = await report({ eventId: FAR.eventId, sourceId: 'src_b', code: [2, 5, 100, 101, 150, 153][i % 6] }, nextIp());
      expect(res.status).toBe(202);
    }
    expect(await statusOf('src_b')).toBe('possible');
    expect(await pending()).toEqual(['src_b']);
    const p = poller(live, [FAR]);
    await p.tick(T0);
    expect(await callsOf(V.b)).toBe(1);
    expect(await statusOf('src_b')).toBe('live');
  });

  it('AC-44: the ad-hoc ceiling spent → 202 and no YouTube call', async () => {
    const scaled = testDeps({ redis, log: silent }, { T2F_EDGE_SECRET: EDGE_SECRET, T2F_YOUTUBE_BASE_URL: fake.url, T2F_LIVE_CONFIG: JSON.stringify({ adHocCeiling: 1 }) });
    const scaledLive = liveOf(scaled);
    expect(scaledLive.cfg.adHocCeiling).toBe(1);
    const scaledDispatch = await buildDispatcher(scaled);
    const send = (sourceId: string) =>
      scaledDispatch(
        new Request(`http://127.0.0.1:3000${PATH}`, {
          method: 'POST',
          body: JSON.stringify({ eventId: FAR.eventId, sourceId, code: 150 }),
          headers: { 'content-type': 'application/json', origin: ORIGIN, 'x-t2f-edge': EDGE_SECRET, 'x-t2f-client': `${nextIp()};UA` },
        }),
      );
    const p = poller(scaledLive, [FAR]);
    expect((await send('src_a')).status).toBe(202);
    await p.tick(T0); // spends the one ad-hoc unit
    expect(await callsOf(V.a)).toBe(1);
    const total = (await fakeCalls()).length;
    expect((await send('src_c')).status).toBe(202);
    await p.tick(T0 + 5 * SEC);
    expect((await fakeCalls()).length).toBe(total);
    expect(await statusOf('src_c')).toBe('possible');
  });

  it('NFR-4: the 11th report of one client within a minute → 429 rate_limited', async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      expect((await report({ eventId: FAR.eventId, sourceId: 'src_c', code: 5 }, ip)).status, `report ${i + 1}`).toBe(202);
    }
    const res = await report({ eventId: FAR.eventId, sourceId: 'src_c', code: 5 }, ip);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe('rate_limited');
  });
});
