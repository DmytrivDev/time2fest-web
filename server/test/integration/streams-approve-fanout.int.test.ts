/**
 * Approve → `chain` on `live:streams` (SPEC-21a AC-18) and the candidate following its source (AC-10), on the
 * worktree's test database, the shared Centrifugo and the fake YouTube on port 0. Modelled on `live-fanout.int.test.ts`:
 * the fan-out runs on a delivery loop of its own over the real `liveFanOutDepsOf` deps with the events of this run (a
 * stub), publishes are observed through a recorder in front of the real Centrifugo publisher.
 * - AC-18: 20 approvals (one event each, fresh candidates): from the approve's answer to the `chain` event carrying
 *   the new source ≤ 3 000 ms, every time.
 * - AC-10: the fake turns the video `upcoming` → `live` → `ended`; poller passes move the candidate `approved` →
 *   `active` → `dead` in the poller's transaction, one journal row each.
 */
import type { RealtimeEnvelope, StreamEvent } from '@time2fest/contracts';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createPayloadJournal } from '../../src/adapters/payloadJournal';
import { createPayloadStreamsStore } from '../../src/adapters/payloadStreams';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import type { Actor } from '../../src/audit/ports';
import { eventsOf, liveFanOutDepsOf, payloadOf, startBackground } from '../../src/container';
import type { LiveEvent } from '../../src/domain/live/moment';
import { liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import type { EventBus } from '../../src/events/bus';
import { createLiveFanOutSubscribers, settleLiveFanOuts, type LiveFanOutDeps } from '../../src/live/fanout';
import { createLivePoller } from '../../src/live/poller';
import { addCandidates, approveCandidate, STREAMS_CANDIDATE_ACTION, type SourcesDeps } from '../../src/live/sources';
import type { ChannelPublisher } from '../../src/realtime/ports';
import { isRevertible } from '../../src/registries/revertHandlers';
import { testDeps } from './helpers';
import { note, percentile } from './measure';

const R = Math.random().toString(36).slice(2, 6).padEnd(4, 'x');
const run = `sf${R}`;
const vid = (n: number) => `${R}f${String(n).padStart(6, '0')}`;
const MOMENT = Date.parse('2027-01-01T00:00:00Z');
const OWNER: Actor = { kind: 'owner', id: 'owner-1', label: 'owner@example.com' };
const N = 20;
const events: LiveEvent[] = Array.from({ length: N + 1 }, (_, i) => ({ eventId: `evt_${run}_${i}`, zoneId: 'Europe/London', moment: MOMENT, nonMidnight: false, hidden: false }));

const published: { version: number; at: number; envelope: RealtimeEnvelope }[] = [];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const end = performance.now() + ms;
  while (!pred()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(20);
  }
}

function recording(inner: ChannelPublisher | undefined): ChannelPublisher {
  return {
    async publish(classKey, key, envelope) {
      const result = inner ? await inner.publish(classKey, key, envelope) : ({ status: 'ok' } as const);
      if (result.status === 'ok') published.push({ version: envelope.version ?? 0, at: performance.now(), envelope });
      return result;
    },
  };
}

interface Fake {
  url: string;
  close(): Promise<void>;
}

let deps: Deps;
let payload: Payload;
let live: LiveWiring;
let fake: Fake;
let bus: EventBus;
let sources: SourcesDeps;
/** The test clock: just before the moment, so every event's window is open and the checks are fresh. */
let now = MOMENT - 10 * 60_000;
const videoIds: string[] = [];

const control = async (path: string, body: unknown) => {
  const res = await fetch(`${fake.url}/_control/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  expect(res.status).toBe(200);
};

async function clean(): Promise<void> {
  if (videoIds.length) await payload.delete({ collection: 'stream-candidates' as never, where: { videoId: { in: videoIds } }, overrideAccess: true });
  await payload.delete({ collection: 'stream-sources', where: { eventId: { like: `evt_${run}_` } }, overrideAccess: true });
}

beforeAll(async () => {
  deps = testDeps();
  payload = await payloadOf(deps)();
  live = liveOf(deps);
  fake = (await startFakeYoutube({ port: 0 })) as Fake;
  for (let i = 0; i <= N; i += 1) videoIds.push(vid(i));
  sources = {
    live: live.store,
    streams: createPayloadStreamsStore({ payload: payloadOf(deps), clock: { now: () => now } }),
    quota: live.quota,
    youtube: createYoutubeFakeSource(fake.url),
    events: { events: async () => events },
    journal: createPayloadJournal(isRevertible),
    publisher: eventsOf(deps).publisher,
    alarm: { raise: () => {} },
    clock: { now: () => now },
    cfg: live.cfg,
    caller: live.caller,
  };
  await clean();
  const real = liveFanOutDepsOf(deps);
  const core: LiveFanOutDeps = {
    ...real,
    chains: { ...real.chains, events: { events: async () => events } },
    publisher: recording(real.publisher),
    alarm: { raise: () => {} },
    sleep: async () => {},
  };
  delete core.purge;
  delete core.copy;
  bus = await startBackground(deps, createLiveFanOutSubscribers(async () => core));
});

afterAll(async () => {
  await bus?.stop();
  await settleLiveFanOuts();
  if (payload) await clean();
  await fake?.close();
});

describe('approve fan-out and the candidate following its source', { timeout: 120_000 }, () => {
  it('AC-18: approve → the chain event with the new source on live:streams ≤ 3 000 ms, 20 times', async () => {
    await control('videos', { videos: videoIds.map((id) => ({ id, state: 'upcoming' })) });
    const added = await addCandidates(sources, { videoIds: videoIds.slice(0, N), origin: 'owner', actor: OWNER });
    expect(added.ok).toBe(true);
    const delays: number[] = [];
    for (let i = 0; i < N; i += 1) {
      const eventId = events[i]!.eventId;
      const res = await approveCandidate(sources, { videoId: vid(i), eventId, actor: OWNER });
      const answeredAt = performance.now();
      if (!res.ok) throw new Error(res.code);
      const { version, sourceId } = res.value;
      const hit = () =>
        published.find((p) => {
          const data = p.envelope.data as StreamEvent | undefined;
          return p.version >= version && data?.type === 'chain' && data.chain.eventId === eventId && data.chain.sources.some((s) => s.id === sourceId);
        });
      await until(() => hit() !== undefined, 5_000, `the chain of approve ${i}`);
      delays.push((hit()?.at ?? 0) - answeredAt);
    }
    await settleLiveFanOuts();
    const sorted = [...delays].sort((a, b) => a - b);
    note(`T2F_MEASURE ${JSON.stringify({ metric: 'streams-approve-chain-ms', n: sorted.length, p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95), max: sorted.at(-1) })}`);
    expect(sorted.at(-1)).toBeLessThanOrEqual(3_000);
  });

  it('AC-10: upcoming → live → ended: the candidate approved → active → dead, in the poller transaction', async () => {
    const id = vid(N);
    const eventId = events[N]!.eventId;
    await control('videos', { videos: [{ id, state: 'upcoming' }] });
    await addCandidates(sources, { videoIds: [id], origin: 'owner', actor: OWNER });
    expect((await approveCandidate(sources, { videoId: id, eventId, actor: OWNER })).ok).toBe(true);
    const poller = createLivePoller({
      store: live.store,
      quota: live.quota,
      lease: live.lease,
      statuses: createYoutubeFakeSource(fake.url),
      events: { events: async () => [events[N]!] },
      publisher: eventsOf(deps).publisher,
      alarm: { raise: () => {} },
      cfg: live.cfg,
      caller: live.caller,
      streams: sources.streams,
      journal: sources.journal,
    });
    const state = async () => (await sources.streams.candidates({ videoIds: [id] }))[0]?.state;
    const journalRows = async () =>
      (await payload.find({ collection: 'audit-log', where: { action: { equals: STREAMS_CANDIDATE_ACTION } }, sort: '-id', limit: 20, overrideAccess: true, depth: 0 })).docs.filter(
        (d) => (d as { target?: { ref?: string } }).target?.ref === id && (d as { actor?: { kind?: string } }).actor?.kind === 'system',
      );
    try {
      now = MOMENT - 60_000;
      await poller.tick(now);
      expect(await state()).toBe('approved');
      await control('videos', { videos: [{ id, state: 'live' }] });
      now += live.cfg.tickMs + 1_000;
      expect((await poller.tick(now)).ran).toBe(true);
      expect(await state()).toBe('active');
      await control('videos', { videos: [{ id, state: 'ended' }] });
      now += live.cfg.tickMs + 1_000;
      await poller.tick(now);
      expect(await state()).toBe('dead');
      expect(await journalRows()).toHaveLength(2);
    } finally {
      await poller.release();
    }
  });
});
