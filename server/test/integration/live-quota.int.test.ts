/**
 * Quota exhaustion and stale statuses against the `_test` database and the fake YouTube (SPEC-12 AC-31, AC-35, AC-36,
 * EC-2). Time is the test's: `tick(now)` is called directly. Video ids of `data/streams.json` only; the event is given
 * to the poller (Dubai, midnight 20:00 UTC, window 19:00 … 21:00).
 */
import type { Payload } from 'payload';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import { eventsOf, payloadOf } from '../../src/container';
import type { LiveEvent } from '../../src/domain/live/moment';
import { liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import { createLivePoller, type LivePoller } from '../../src/live/poller';
import type { AlarmInput } from '../../src/ports';
import { silent, testDeps } from './helpers';

const at = (isoText: string) => Date.parse(isoText);
const SEC = 1_000;
const DUBAI: LiveEvent = { eventId: 'evt_dubai_2027', zoneId: 'Asia/Dubai', moment: at('2026-12-31T20:00:00Z'), nonMidnight: false, hidden: false };
const IDS = ['5uZa3-RMFos', '6Xxb5uikewE'];

interface Fake {
  url: string;
  close(): Promise<void>;
}

let fake: Fake;
let deps: Deps;
let payload: Payload;
let live: LiveWiring;
const alarms: AlarmInput[] = [];
const pollers: LivePoller[] = [];

async function control(path: string, body: unknown): Promise<void> {
  const res = await fetch(fake.url + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`fake control ${path}: ${res.status}`);
}
async function callCount(): Promise<number> {
  const body = (await (await fetch(fake.url + '/_control/calls')).json()) as { calls: { path: string }[] };
  return body.calls.filter((c) => c.path === '/youtube/v3/videos').length;
}

function poller(): LivePoller {
  const p = createLivePoller({
    store: live.store,
    quota: live.quota,
    lease: live.lease,
    statuses: createYoutubeFakeSource(fake.url),
    events: { events: async () => [DUBAI] },
    publisher: eventsOf(deps).publisher,
    alarm: { raise: (a) => alarms.push(a) },
    cfg: live.cfg,
    caller: live.caller,
  });
  pollers.push(p);
  return p;
}

async function clean(): Promise<void> {
  for (const collection of ['stream-sources', 'live-quota'] as const) {
    await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true });
  }
  await live.store.claimPendingChecks();
}

async function addSources(): Promise<void> {
  for (const [i, videoId] of IDS.entries()) {
    await payload.create({
      collection: 'stream-sources',
      data: { sourceId: `src_dubai_${i + 1}`, eventId: DUBAI.eventId, platform: 'youtube', videoId, order: i, status: 'live', embeddable: true, privacyStatus: 'public' } as never,
      overrideAccess: true,
    });
  }
  await control('/_control/videos', { videos: IDS.map((id) => ({ id, state: 'live' })) });
}

const codes = (code: string) => alarms.filter((a) => a.code === code);

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
});

afterEach(async () => {
  for (const p of pollers.splice(0)) await p.release();
});

afterAll(async () => {
  if (payload) await clean();
  await fake?.close();
});

describe('quota exhausted at 20:00 UTC on 31.12 (EC-2)', () => {
  it('AC-35, AC-36: no call until 08:00 UTC on 01.01, statuses kept, one quota-exceeded line, a page stale alarm before 20:04', async () => {
    await addSources();
    const p = poller();
    await p.tick(at('2026-12-31T19:59:30Z'));
    expect(await callCount()).toBe(1);

    await control('/_control/quota', { bucket: 'queries', exceeded: true });
    await p.tick(at('2026-12-31T20:00:00Z'));
    expect(await callCount()).toBe(2);
    // The refused call is counted too (AC-31) and the bucket is stopped until the next Pacific day.
    const day = await live.quota.read('2026-12-31');
    expect(day.queries?.used).toBe(2);
    expect(day.queries?.exceededUntil).toBe(at('2027-01-01T08:00:00Z'));

    let pagedAt: number | null = null;
    for (let now = at('2026-12-31T20:00:30Z'); now < at('2026-12-31T20:04:00Z'); now += 30 * SEC) {
      await p.tick(now);
      if (pagedAt === null && codes('live/statuses-stale').some((a) => a.level === 'page')) pagedAt = now;
    }
    expect(pagedAt).not.toBeNull();
    expect(pagedAt!).toBeLessThan(at('2026-12-31T20:04:00Z'));
    expect(codes('live/quota-exceeded')).toHaveLength(1);
    expect(codes('live/quota-exceeded')[0]?.level).toBe('log');

    // Later the same quota day: off-window checks fall due, still no call.
    await control('/_control/quota', { bucket: 'queries', exceeded: false });
    await p.tick(at('2027-01-01T07:59:30Z'));
    expect(await callCount()).toBe(2);
    const rows = await live.store.sources({ eventIds: [DUBAI.eventId] });
    expect(rows.map((r) => [r.status, r.dead])).toEqual([
      ['live', false],
      ['live', false],
    ]);
    expect(rows.every((r) => r.lastChecked === at('2026-12-31T19:59:30Z'))).toBe(true);

    // The new quota day: calls resume.
    await p.tick(at('2027-01-01T08:00:00Z'));
    expect(await callCount()).toBe(3);
    expect(codes('live/quota-exceeded')).toHaveLength(1);
  });

  it('AC-36: outside every window the stale statuses are a log line only, never a page', async () => {
    await addSources();
    await control('/_control/quota', { bucket: 'queries', exceeded: true });
    const p = poller();
    const start = at('2026-12-30T10:00:00Z');
    for (let now = start; now <= start + 4 * 60 * SEC; now += 30 * SEC) await p.tick(now);
    expect(await callCount()).toBe(1);
    const stale = codes('live/statuses-stale');
    expect(stale).toHaveLength(1);
    expect(stale[0]?.level).toBe('log');
    expect(alarms.some((a) => a.level === 'page')).toBe(false);
  });
});
