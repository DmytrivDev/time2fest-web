/**
 * The 30-day retention of YouTube fields against the `_test` database and the fake YouTube (SPEC-12 AC-73, AC-74,
 * EC-23). Time is the test's: `tick(now)` is called directly. One seed source of London; the event is given to the
 * poller, its window (31.12 23:00 … 01.01 01:00) is never open here, so every check is an off-window one.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import { AUDIT_LOG } from '../../src/audit/journal';
import { eventsOf, payloadOf } from '../../src/container';
import { publicChain } from '../../src/domain/live/chain';
import type { LiveEvent } from '../../src/domain/live/moment';
import { liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import { createLivePoller, type LivePoller } from '../../src/live/poller';
import { silent, testDeps } from './helpers';

const at = (isoText: string) => Date.parse(isoText);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const LONDON: LiveEvent = { eventId: 'evt_london_2027', zoneId: 'Europe/London', moment: at('2027-01-01T00:00:00Z'), nonMidnight: false, hidden: false };
const VIDEO = 'zMCea32gpmg';
const SOURCE = 'src_london_1';
const YOUTUBE_FIELDS = ['liveBroadcastContent', 'privacyStatus', 'embeddable', 'scheduledStartTime', 'actualStartTime', 'actualEndTime', 'ytFetchedAt'] as const;

interface Fake {
  url: string;
  close(): Promise<void>;
}

let fake: Fake;
let deps: Deps;
let payload: Payload;
let live: LiveWiring;
let p: LivePoller;

async function control(path: string, body: unknown): Promise<void> {
  const res = await fetch(fake.url + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`fake control ${path}: ${res.status}`);
}

async function clean(): Promise<void> {
  for (const collection of ['stream-sources', 'live-quota'] as const) {
    await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true });
  }
  await live.store.claimPendingChecks();
}

async function row(): Promise<Record<string, unknown>> {
  const found = await payload.find({ collection: 'stream-sources', where: { sourceId: { equals: SOURCE } }, overrideAccess: true, limit: 1 });
  return found.docs[0] as unknown as Record<string, unknown>;
}

async function servedIds(now: number): Promise<string[]> {
  const sources = await live.store.sources({ eventIds: [LONDON.eventId] });
  return publicChain(LONDON, sources, { now, cfg: live.cfg })?.sources.map((s) => s.id) ?? [];
}

beforeAll(async () => {
  fake = (await startFakeYoutube({ port: 0 })) as Fake;
  deps = testDeps({ log: silent }, { T2F_YOUTUBE_BASE_URL: fake.url });
  payload = await payloadOf(deps)();
  live = liveOf(deps);
  await clean();
  // Imported without any YouTube field: only the poller's checks fill them.
  await payload.create({
    collection: 'stream-sources',
    data: { sourceId: SOURCE, eventId: LONDON.eventId, platform: 'youtube', videoId: VIDEO, order: 0, status: 'live' } as never,
    overrideAccess: true,
  });
  p = createLivePoller({
    store: live.store,
    quota: live.quota,
    lease: live.lease,
    statuses: createYoutubeFakeSource(fake.url),
    events: { events: async () => [LONDON] },
    publisher: eventsOf(deps).publisher,
    alarm: { raise: () => {} },
    cfg: live.cfg,
    caller: live.caller,
  });
});

afterAll(async () => {
  await p?.release();
  if (payload) await clean();
  await fake?.close();
});

describe('YouTube fields older than 30 days (EC-23)', () => {
  it('AC-73, AC-74: +31 days without a check — fields cleared everywhere, the source absent; the first good check returns it', async () => {
    const t0 = at('2026-11-20T12:00:00Z');
    await control('/_control/videos', { videos: [{ id: VIDEO, state: 'live' }] });
    await p.tick(t0);
    expect(await row()).toMatchObject({ privacyStatus: 'public', embeddable: true, liveBroadcastContent: 'live' });
    expect(await servedIds(t0)).toEqual([SOURCE]);

    // A month offline: every check fails.
    await control('/_control/down', { on: true });
    const t31 = t0 + 31 * DAY;
    const before = (await live.store.state()).version;
    await p.tick(t31);
    const cleared = await row();
    for (const field of YOUTUBE_FIELDS) expect(cleared[field] ?? null, field).toBeNull();
    expect(await servedIds(t31)).toEqual([]);
    expect((await live.store.state()).version).toBeGreaterThan(before);

    // No journal row of the live air carries a YouTube value.
    const journal = await payload.find({ collection: AUDIT_LOG as 'audit-log', where: { 'target.collection': { equals: 'stream-sources' } }, overrideAccess: true, limit: 0, pagination: false });
    for (const doc of journal.docs as unknown as { before?: unknown; after?: unknown }[]) {
      const text = JSON.stringify([doc.before ?? null, doc.after ?? null]);
      for (const field of YOUTUBE_FIELDS) expect(text.includes(`"${field}"`), field).toBe(false);
    }

    // The fake is back; the next off-window check (on the 6 h grid) returns the source.
    await control('/_control/down', { on: false });
    const next = (await live.store.sources({ sourceIds: [SOURCE] }))[0]?.nextOffWindowCheckAt ?? 0;
    expect(next - t31).toBeGreaterThanOrEqual(6 * HOUR);
    await p.tick(next);
    expect(await row()).toMatchObject({ privacyStatus: 'public', embeddable: true });
    expect(await servedIds(next)).toEqual([SOURCE]);
  });
});
