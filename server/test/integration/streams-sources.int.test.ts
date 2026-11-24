/**
 * The stream sources services on the worktree's test database (SPEC-21a W20): candidates, channels, blacklist, approve
 * and its revert, the chain ceiling. The services run over THE process stores with a test clock of their own (a quota
 * day of this run, so the class ceilings start at zero) and the fake YouTube on port 0; the events are a stub of this
 * run. Ids are synthetic per run (`<R>v000001`, `UC<R>…`); every row of the run is removed afterwards.
 * - AC-11 one video per reason + one fit; AC-14 bad ids → no request; AC-9 two origins, one row; AC-13 fake down →
 *   `new` with no `checkedAt`, checked once the fake is back; AC-5 known / unknown channel; AC-12 5 uploads (2 upcoming,
 *   3 none), the agent's channel `proposed`; AC-2 / AC-4 blacklist with cascade and revert; AC-16 / AC-17 approve fresh
 *   (0 calls) and 6 min old (exactly 1); AC-19 approve + revert; AC-23 approve / replace / import chains → `chain-full`;
 *   AC-6 the 101st watched channel → `limit`; NFR-2 50 adds p95 ≤ 2 000 ms; NFR-6 one journal row per change, no id
 *   in any alarm.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createPayloadJournal } from '../../src/adapters/payloadJournal';
import { createPayloadStreamsStore } from '../../src/adapters/payloadStreams';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import type { Actor, StoredJournalEntry } from '../../src/audit/ports';
import { getDeps, payloadOf } from '../../src/container';
import { canRevert } from '../../src/domain/audit/revert';
import { publicChain } from '../../src/domain/live/chain';
import type { LiveEvent } from '../../src/domain/live/moment';
import { eventsOf, liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import { applyLiveAction } from '../../src/live/actions';
import { importChains } from '../../src/live/import';
import {
  addCandidates,
  addChannel,
  approveCandidate,
  LIVE_APPROVE_ACTION,
  proposeCandidate,
  retryUnchecked,
  setBlacklist,
  sourcesRevertHandlers,
  STREAMS_BLACKLIST_ACTION,
  STREAMS_CANDIDATE_ACTION,
  type SourcesDeps,
} from '../../src/live/sources';
import type { AlarmInput } from '../../src/ports';
import { isRevertible, liveActionsOf } from '../../src/registries/revertHandlers';
import { percentile } from './measure';

const DAY = 86_400_000;
const MIN = 60_000;
const R = Math.random().toString(36).slice(2, 6).padEnd(4, 'x');
const run = `ss${R}`;
const vid = (n: number) => `${R}v${String(n).padStart(6, '0')}`;
const chid = (n: number) => `UC${R}${String(n).padStart(18, '0')}`;
const EVENT_ID = `evt_${run}`;
const FULL_EVENT = `evt_${run}_full`;
const OWNER: Actor = { kind: 'owner', id: 'owner-1', label: 'owner@example.com' };
const AGENT: Actor = { kind: 'agent', id: 'agent-1', label: 'stream-agent' };

type Row = Record<string, unknown> & { id: number };
interface Fake {
  url: string;
  close(): Promise<void>;
}

describe('stream sources services', { timeout: 120_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let live: LiveWiring;
  let fake: Fake;
  let sources: SourcesDeps;
  const alarms: AlarmInput[] = [];
  /** The test clock: a quota day of this run (fresh class counters), midday UTC. */
  let now = Date.UTC(2031, 0, 1) + (Date.now() % 2_000) * DAY + DAY / 2;
  const events: LiveEvent[] = [];
  const videoIds = new Set<string>();
  const channelIds = new Set<string>();

  const control = async (path: string, body: unknown) => {
    const res = await fetch(`${fake.url}/_control/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
  };
  const counts = async () => ((await (await fetch(`${fake.url}/_control/calls`)).json()) as { counts: Record<string, number> }).counts;
  const reset = () => control('reset', {});
  const videos = (list: { id: string; state: string; embeddable?: boolean }[]) => {
    for (const v of list) videoIds.add(v.id);
    return control('videos', { videos: list });
  };
  const candidate = async (videoId: string) => (await sources.streams.candidates({ videoIds: [videoId] }))[0];
  const maxJournalId = async () =>
    Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const rowsAfter = async (after: number, action: string) =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: after } }, { action: { equals: action } }] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
  const entryOf = (row: Row): StoredJournalEntry =>
    ({
      id: String(row.id),
      actor: row.actor,
      action: row.action,
      target: row.target,
      at: 0,
      before: row.before ?? null,
      after: row.after ?? null,
      revertOf: row.revertOf ?? null,
      revertible: row.revertible === true,
    }) as StoredJournalEntry;
  async function revert(row: Row): Promise<void> {
    const handler = sourcesRevertHandlers(async () => sources, () => OWNER).find((h) => h.key === row.action);
    if (!handler?.current) throw new Error('no handler');
    const entry = entryOf(row);
    await live.store.inTransaction(null, async (tx) => {
      expect(canRevert(entry, await handler.current!(tx, entry))).toBe('ok');
      await handler.revert(tx, entry);
    });
  }
  const chainOf = async (eventId: string) => {
    const event = events.find((e) => e.eventId === eventId) as LiveEvent;
    return publicChain(event, await live.store.sources({ eventIds: [eventId] }), { now, cfg: live.cfg, zoneLive: {} });
  };

  async function clean(): Promise<void> {
    const ids = [...videoIds];
    if (ids.length) await payload.delete({ collection: 'stream-candidates' as never, where: { videoId: { in: ids } }, overrideAccess: true });
    await payload.delete({ collection: 'stream-channels' as never, where: { channelId: { like: `UC${R}` } }, overrideAccess: true });
    await payload.delete({ collection: 'stream-sources', where: { eventId: { like: EVENT_ID } }, overrideAccess: true });
  }

  beforeAll(async () => {
    deps = getDeps();
    expect(deps.env.class).toBe('test');
    payload = await payloadOf(deps)();
    live = liveOf(deps);
    fake = (await startFakeYoutube({ port: 0 })) as Fake;
    events.push(
      { eventId: EVENT_ID, zoneId: 'Europe/London', moment: now + 2 * 60 * MIN, nonMidnight: false, hidden: false },
      { eventId: FULL_EVENT, zoneId: 'Europe/London', moment: now + 2 * 60 * MIN, nonMidnight: false, hidden: false },
    );
    sources = {
      live: live.store,
      streams: createPayloadStreamsStore({ payload: payloadOf(deps), clock: { now: () => now } }),
      quota: live.quota,
      youtube: createYoutubeFakeSource(fake.url),
      events: { events: async () => events },
      journal: createPayloadJournal(isRevertible),
      publisher: eventsOf(deps).publisher,
      alarm: { raise: (a) => void alarms.push(a) },
      clock: { now: () => now },
      cfg: live.cfg,
      caller: live.caller,
    };
    await clean();
  });

  afterAll(async () => {
    if (payload) await clean();
    await fake?.close();
  });

  it('AC-11: one video per reason and one fit video → the verdicts; AC-7: every field stored', async () => {
    await reset();
    const BL = chid(1);
    await control('channels', { channels: [{ id: BL, videos: [vid(2)] }] });
    channelIds.add(BL);
    expect((await setBlacklist(sources, { channelId: BL, blacklisted: true, reason: 'spam', actor: OWNER })).ok).toBe(true);
    await videos([
      { id: vid(1), state: 'upcoming' },
      { id: vid(2), state: 'upcoming' },
      { id: vid(3), state: 'private' },
      { id: vid(4), state: 'upcoming', embeddable: false },
      { id: vid(5), state: 'none' },
    ]);
    videoIds.add(vid(6)); // unknown to the fake → not found
    const mark = await maxJournalId();
    const res = await addCandidates(sources, { videoIds: [vid(1), vid(2), vid(3), vid(4), vid(5), vid(6)], origin: 'owner', actor: OWNER });
    if (!res.ok) throw new Error(res.code);
    expect(res.value.map((o) => [o.state, o.reason ?? null])).toEqual([
      ['new', null],
      ['rejected', 'blacklisted'],
      ['rejected', 'private'],
      ['rejected', 'not-embeddable'],
      ['rejected', 'not-live'],
      ['rejected', 'not-found'],
    ]);
    expect((await counts())['/youtube/v3/videos']).toBe(1);
    expect(await candidate(vid(1))).toMatchObject({
      foundBy: ['owner'],
      liveBroadcastContent: 'upcoming',
      embeddable: true,
      privacyStatus: 'public',
      checkedAt: now,
      ytFetchedAt: now,
      state: 'new',
      stateChangedAt: now,
      stateChangedBy: 'owner:owner-1',
    });
    expect((await candidate(vid(2)))?.channelId).toBe(BL);
    // NFR-6: one journal row per change.
    expect(await rowsAfter(mark, STREAMS_CANDIDATE_ACTION)).toHaveLength(6);
  });

  it('AC-14: bad ids → invalid, the fake gets no request', async () => {
    await reset();
    for (const bad of ['short', 'has space00', `${vid(1)}x`, 'bad/char/id']) {
      const res = await addCandidates(sources, { videoIds: [bad], origin: 'agent', actor: AGENT });
      expect(res).toMatchObject({ ok: false, code: 'invalid' });
    }
    expect(await addChannel(sources, { channelId: 'UCshort', actor: OWNER })).toMatchObject({ ok: false, code: 'invalid' });
    expect(await counts()).toEqual({});
  });

  it('AC-9: the same id from the agent and the playlist → one row, two origins; a rejected one stays rejected', async () => {
    await reset();
    await videos([{ id: vid(10), state: 'upcoming' }]);
    await addCandidates(sources, { videoIds: [vid(10)], origin: 'agent', actor: AGENT });
    const again = await addCandidates(sources, { videoIds: [vid(10)], origin: 'playlist', actor: OWNER });
    expect(again).toMatchObject({ ok: true, value: [{ videoId: vid(10), state: 'new', created: false }] });
    expect((await candidate(vid(10)))?.foundBy).toEqual(['agent', 'playlist']);
    expect((await counts())['/youtube/v3/videos']).toBe(1);
    const rejected = await addCandidates(sources, { videoIds: [vid(5)], origin: 'agent', actor: AGENT });
    expect(rejected).toMatchObject({ ok: true, value: [{ state: 'rejected', reason: 'not-live', created: false }] });
  });

  it('AC-13: the fake down → new with no checkedAt; once it is back the retry checks it', async () => {
    await reset();
    await videos([{ id: vid(20), state: 'none' }]);
    await control('down', { on: true });
    const res = await addCandidates(sources, { videoIds: [vid(20)], origin: 'owner', actor: OWNER });
    expect(res).toMatchObject({ ok: true, value: [{ state: 'new', created: true }] });
    expect((await candidate(vid(20)))?.checkedAt).toBeNull();
    await control('down', { on: false });
    now += MIN;
    expect(await retryUnchecked(sources)).toBeGreaterThanOrEqual(1);
    expect(await candidate(vid(20))).toMatchObject({ state: 'rejected', reason: 'not-live', checkedAt: now });
  });

  it('AC-5: a known channel → watched with its uploads playlist after one channels.list; unknown → not-found, no row', async () => {
    await reset();
    const known = chid(5);
    await control('channels', { channels: [{ id: known, uploads: `UU${R}known`, videos: [] }] });
    const res = await addChannel(sources, { channelId: known, actor: OWNER, fields: { name: 'Known TV', kind: 'tv', zones: ['Europe/London'], priority: 1 } });
    expect(res).toMatchObject({ ok: true, value: { state: 'watched', created: true } });
    expect((await counts())['/youtube/v3/channels']).toBe(1);
    expect((await sources.streams.channels({ channelIds: [known] }))[0]).toMatchObject({
      uploadsPlaylistId: `UU${R}known`,
      uploadsFetchedAt: now,
      name: 'Known TV',
      kind: 'tv',
      zones: ['Europe/London'],
      priority: 1,
      state: 'watched',
    });
    const unknown = chid(6);
    expect(await addChannel(sources, { channelId: unknown, actor: OWNER })).toMatchObject({ ok: false, code: 'not-found' });
    expect(await sources.streams.channels({ channelIds: [unknown] })).toEqual([]);
  });

  it('AC-12: 5 uploads (2 upcoming, 3 none) → 2 new, 3 rejected; the agent channel is proposed and not watched', async () => {
    await reset();
    const ids = [vid(30), vid(31), vid(32), vid(33), vid(34)];
    await videos(ids.map((id, i) => ({ id, state: i < 2 ? 'upcoming' : 'none' })));
    await control('channels', { channels: [{ id: chid(30), videos: ids }] });
    const res = await addChannel(sources, { channelId: chid(30), actor: OWNER });
    expect(res).toMatchObject({ ok: true, value: { state: 'watched', added: 5 } });
    const rows = await sources.streams.candidates({ videoIds: ids });
    expect(rows.filter((c) => c.state === 'new')).toHaveLength(2);
    expect(rows.filter((c) => c.state === 'rejected' && c.reason === 'not-live')).toHaveLength(3);
    expect(rows.every((c) => c.foundBy.includes('playlist'))).toBe(true);

    const watched = await sources.streams.watchedCount();
    const agentIds = [vid(35)];
    await videos([{ id: vid(35), state: 'upcoming' }]);
    await control('channels', { channels: [{ id: chid(31), videos: agentIds }] });
    const agent = await addChannel(sources, { channelId: chid(31), actor: AGENT });
    expect(agent).toMatchObject({ ok: true, value: { state: 'proposed', created: true, added: 1 } });
    expect(await sources.streams.watchedCount()).toBe(watched);
    expect((await sources.streams.channels({ channelIds: [chid(31)] }))[0]).toMatchObject({ state: 'proposed', proposedBy: 'agent-1' });
  });

  it('AC-2 / AC-4: blacklisting a channel with two new and one approved → two rejected, the source stays; revert and again → three rows', async () => {
    await reset();
    const ch = chid(40);
    const ids = [vid(40), vid(41), vid(42)];
    await videos(ids.map((id) => ({ id, state: 'upcoming' })));
    await control('channels', { channels: [{ id: ch, videos: ids }] });
    await addCandidates(sources, { videoIds: ids, origin: 'owner', actor: OWNER });
    channelIds.add(ch);
    const approved = await approveCandidate(sources, { videoId: vid(42), eventId: EVENT_ID, actor: OWNER });
    expect(approved.ok).toBe(true);
    const mark = await maxJournalId();
    const res = await setBlacklist(sources, { channelId: ch, blacklisted: true, reason: 'not official', actor: OWNER });
    expect(res).toMatchObject({ ok: true, value: { blacklisted: true, rejected: 2 } });
    expect((await candidate(vid(40)))).toMatchObject({ state: 'rejected', reason: 'blacklisted' });
    expect((await candidate(vid(41)))).toMatchObject({ state: 'rejected', reason: 'blacklisted' });
    expect((await candidate(vid(42)))?.state).toBe('approved');
    expect((await chainOf(EVENT_ID))?.sources.map((s) => s.id)).toContain(approved.ok ? approved.value.sourceId : '');
    // AC-3: a later add of a video of the channel is rejected without the owner.
    await videos([{ id: vid(43), state: 'upcoming' }]);
    await control('channels', { channels: [{ id: ch, videos: [...ids, vid(43)] }] });
    expect(await addCandidates(sources, { videoIds: [vid(43)], origin: 'agent', actor: AGENT })).toMatchObject({ ok: true, value: [{ state: 'rejected', reason: 'blacklisted' }] });

    const [row] = await rowsAfter(mark, STREAMS_BLACKLIST_ACTION);
    expect(row?.after).toMatchObject({ channelId: ch, blacklisted: true, reason: 'not official' });
    expect(row?.revertible).toBe(true);
    await revert(row as Row);
    expect((await sources.streams.channels({ channelIds: [ch] }))[0]?.blacklisted).toBe(false);
    expect((await candidate(vid(40)))?.state).toBe('new');
    expect((await setBlacklist(sources, { channelId: ch, blacklisted: true, reason: 'again', actor: OWNER })).ok).toBe(true);
    expect((await sources.streams.channels({ channelIds: [ch] }))[0]).toMatchObject({ blacklisted: true, blacklistReason: 'again', blacklistSource: 'admin' });
    expect(await rowsAfter(mark, STREAMS_BLACKLIST_ACTION)).toHaveLength(3);
  });

  it('AC-16 / AC-17: a fresh candidate → approved with no request, served at once, one row, version + 1', async () => {
    await reset();
    await videos([{ id: vid(50), state: 'upcoming' }]);
    await addCandidates(sources, { videoIds: [vid(50)], origin: 'agent', actor: AGENT, eventId: EVENT_ID });
    expect((await candidate(vid(50)))?.state).toBe('proposed');
    await reset();
    now += 4 * MIN;
    const v0 = (await live.store.state()).version;
    const mark = await maxJournalId();
    const res = await approveCandidate(sources, { videoId: vid(50), eventId: EVENT_ID, actor: OWNER });
    if (!res.ok) throw new Error(res.code);
    expect(res.value.rechecked).toBe(false);
    expect(await counts()).toEqual({});
    expect((await live.store.state()).version).toBe(v0 + 1);
    const chain = await chainOf(EVENT_ID);
    expect(chain?.sources.find((s) => s.id === res.value.sourceId)).toMatchObject({ status: expect.any(String) });
    const [stored] = await live.store.sources({ sourceIds: [res.value.sourceId] });
    expect(stored).toMatchObject({ embeddable: true, privacyStatus: 'public' });
    const rows = await rowsAfter(mark, LIVE_APPROVE_ACTION);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: { kind: 'owner' }, after: { videoId: vid(50), eventId: EVENT_ID, sourceId: res.value.sourceId, state: 'approved' } });
    expect(await candidate(vid(50))).toMatchObject({ state: 'approved', eventId: EVENT_ID, sourceId: res.value.sourceId });
    // EC-7: a second approve is invalid-state.
    expect(await approveCandidate(sources, { videoId: vid(50), eventId: EVENT_ID, actor: OWNER })).toMatchObject({ ok: false, code: 'invalid-state' });
  });

  it('AC-17: a candidate checked 6 min ago → exactly one videos.list before the approve', async () => {
    await reset();
    await videos([{ id: vid(51), state: 'upcoming' }]);
    await addCandidates(sources, { videoIds: [vid(51)], origin: 'owner', actor: OWNER });
    const before = (await counts())['/youtube/v3/videos'] ?? 0;
    now += 6 * MIN;
    const res = await approveCandidate(sources, { videoId: vid(51), eventId: FULL_EVENT, actor: OWNER });
    expect(res).toMatchObject({ ok: true, value: { rechecked: true } });
    expect(((await counts())['/youtube/v3/videos'] ?? 0) - before).toBe(1);
    expect((await candidate(vid(51)))?.ytFetchedAt).toBe(now);
  });

  it('AC-19: approve then revert → the chain as before, the candidate proposed, two versions', async () => {
    await reset();
    await videos([{ id: vid(60), state: 'upcoming' }]);
    await addCandidates(sources, { videoIds: [vid(60)], origin: 'agent', actor: AGENT });
    expect((await proposeCandidate(sources, { videoId: vid(60), actor: AGENT, eventId: EVENT_ID })).ok).toBe(true);
    const chainBefore = (await chainOf(EVENT_ID))?.sources.map((s) => s.id);
    const v0 = (await live.store.state()).version;
    const mark = await maxJournalId();
    const res = await approveCandidate(sources, { videoId: vid(60), eventId: EVENT_ID, actor: OWNER });
    expect(res.ok).toBe(true);
    const [row] = await rowsAfter(mark, LIVE_APPROVE_ACTION);
    expect(row?.revertible).toBe(true);
    await revert(row as Row);
    expect((await chainOf(EVENT_ID))?.sources.map((s) => s.id)).toEqual(chainBefore);
    expect(await candidate(vid(60))).toMatchObject({ state: 'proposed', eventId: EVENT_ID, sourceId: null });
    expect((await live.store.state()).version).toBe(v0 + 2);
    expect(await rowsAfter(mark, LIVE_APPROVE_ACTION)).toHaveLength(2);
  });

  it('AC-23: 3 active sources → approve, replace and import chains refuse chain-full; after hiding one the approve passes', async () => {
    await reset();
    // FULL_EVENT has one approved source (AC-17); two more.
    const ids = [vid(70), vid(71), vid(72)];
    await videos(ids.map((id) => ({ id, state: 'upcoming' })));
    await addCandidates(sources, { videoIds: ids, origin: 'owner', actor: OWNER });
    for (const id of [vid(70), vid(71)]) expect((await approveCandidate(sources, { videoId: id, eventId: FULL_EVENT, actor: OWNER })).ok).toBe(true);
    const own = await live.store.sources({ eventIds: [FULL_EVENT] });
    expect(own).toHaveLength(3);
    const v0 = (await live.store.state()).version;
    expect(await approveCandidate(sources, { videoId: vid(72), eventId: FULL_EVENT, actor: OWNER })).toMatchObject({ ok: false, code: 'chain-full' });
    const actions = { ...liveActionsOf(deps), events: { events: async () => events } };
    const replaced = await applyLiveAction(actions, null, OWNER, { action: 'replace', eventId: FULL_EVENT, sourceId: `src_${run}_new`, videoId: vid(72), reason: 'test' });
    expect(replaced).toMatchObject({ ok: false, reason: 'invalid', detail: 'chain-full' });
    expect((await live.store.state()).version).toBe(v0);
    expect(await live.store.sources({ eventIds: [FULL_EVENT] })).toHaveLength(3);

    const chain = (n: number) => ({
      eventId: `${FULL_EVENT}_imp`,
      sources: Array.from({ length: n }, (_, i) => ({
        id: `src_${run}_imp_${i}`,
        platform: 'youtube',
        videoId: vid(80 + i),
        url: `https://www.youtube.com/watch?v=${vid(80 + i)}`,
        kind: 'webcam',
        title: { uk: `Тест ${i}` },
        order: i,
        status: 'possible',
        embeddable: true,
        isLive: false,
        lastChecked: new Date(now).toISOString(),
        verified: false,
      })),
    });
    const ports = { live: live.store, sources: { read: async () => [], add: async () => {}, change: async () => {} }, publisher: eventsOf(deps).publisher, journal: sources.journal, clock: sources.clock, cfg: live.cfg };
    const imported = await importChains(ports, { apply: false, readSource: () => ({ chains: [chain(4)] }) });
    expect(imported.code).toBe(1);
    expect(imported.lines).toEqual([`chain-full: ${FULL_EVENT}_imp`]);
    expect((await importChains(ports, { apply: false, readSource: () => ({ chains: [chain(3)] }) })).code).toBe(0);

    const hideOne = own[0] as { sourceId: string };
    await live.store.inTransaction(null, (tx) => live.store.editSource(tx, hideOne.sourceId, { hidden: true, hiddenReason: 'test' }));
    expect((await approveCandidate(sources, { videoId: vid(72), eventId: FULL_EVENT, actor: OWNER })).ok).toBe(true);
  });

  it('NFR-2: 50 adds by videoId, p95 ≤ 2 000 ms; NFR-6: no id in any alarm', async () => {
    await reset();
    const ids = Array.from({ length: 50 }, (_, i) => vid(200 + i));
    await videos(ids.map((id) => ({ id, state: 'upcoming' })));
    const took: number[] = [];
    for (const id of ids) {
      const t0 = performance.now();
      const res = await addCandidates(sources, { videoIds: [id], origin: 'agent', actor: AGENT });
      took.push(performance.now() - t0);
      expect(res.ok).toBe(true);
    }
    const p95 = percentile([...took].sort((a, b) => a - b), 0.95);
    expect(p95).toBeLessThanOrEqual(2_000);
    const text = JSON.stringify(alarms);
    for (const id of videoIds) expect(text).not.toContain(id);
    for (const id of channelIds) expect(text).not.toContain(id);
  });

  it('AC-6: with 100 watched channels the 101st is refused limit, nothing written', async () => {
    await reset();
    const watched = await sources.streams.watchedCount();
    expect(watched).toBeLessThanOrEqual(live.cfg.maxWatchedChannels);
    await live.store.inTransaction(null, async (tx) => {
      for (let i = 0; i < live.cfg.maxWatchedChannels - watched; i += 1) await sources.streams.saveChannel(tx, { channelId: chid(1_000 + i), state: 'watched' });
    });
    expect(await sources.streams.watchedCount()).toBe(live.cfg.maxWatchedChannels);
    const extra = chid(999);
    await control('channels', { channels: [{ id: extra }] });
    expect(await addChannel(sources, { channelId: extra, actor: OWNER })).toMatchObject({ ok: false, code: 'limit' });
    expect(await sources.streams.channels({ channelIds: [extra] })).toEqual([]);
    expect(await counts()).toEqual({});
  });
});
