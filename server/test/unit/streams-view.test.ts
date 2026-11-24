/** `live/streamsView.ts` (SPEC-21a AC-20, AC-32; A21-05): the owner view and the agent reads over in-memory ports. */
import { AGENT_CANDIDATES_PAGE_MAX } from '@time2fest/contracts';
import { describe, expect, it } from 'vitest';
import { LIVE_DEFAULTS } from '../../src/domain/live/config';
import type { StoredCandidate, StoredStreamChannel, StreamsStore } from '../../src/live/ports';
import { agentCandidates, agentChannels, byRecent, pageOf, streamsView, type StreamsViewDeps } from '../../src/live/streamsView';

const NOW = Date.parse('2026-12-31T20:00:00Z');
const CH_A = 'UCaaaaaaaaaaaaaaaaaaaaa1';
const CH_B = 'UCbbbbbbbbbbbbbbbbbbbbb2';

const channel = (channelId: string, extra: Partial<StoredStreamChannel> = {}): StoredStreamChannel => ({
  channelId,
  uploadsPlaylistId: null,
  uploadsFetchedAt: null,
  name: channelId.slice(-1),
  kind: 'tv',
  zones: ['utc+0000'],
  seasons: ['2026-27'],
  priority: 1,
  state: 'watched',
  blacklisted: false,
  blacklistReason: null,
  blacklistSource: null,
  proposedBy: null,
  adminEditedAt: null,
  lastPlaylistAt: NOW,
  lastSearchAt: null,
  ...extra,
});

const candidate = (videoId: string, changedAt: number | null, extra: Partial<StoredCandidate> = {}): StoredCandidate => ({
  videoId,
  channelId: CH_A,
  foundBy: ['playlist'],
  state: 'new',
  reason: null,
  eventId: null,
  sourceId: null,
  liveBroadcastContent: null,
  scheduledStartTime: null,
  embeddable: null,
  privacyStatus: null,
  ytFetchedAt: null,
  checkedAt: null,
  stateChangedAt: changedAt,
  stateChangedBy: null,
  evidenceUrl: null,
  note: null,
  ...extra,
});

function depsOf(channels: StoredStreamChannel[], candidates: StoredCandidate[]) {
  const filters: unknown[] = [];
  const streams = {
    channels: async () => channels,
    candidates: async (filter: Parameters<StreamsStore['candidates']>[0] = {}) => {
      filters.push(filter);
      const rows = candidates.filter((c) => (!filter.states || filter.states.includes(c.state)) && (!filter.eventId || c.eventId === filter.eventId)).sort(byRecent);
      return filter.page ? rows.slice(filter.page.offset, filter.page.offset + filter.page.limit) : rows;
    },
  } as unknown as StreamsStore;
  const deps = {
    streams,
    events: { events: async () => [{ eventId: 'ev-1', zoneId: 'utc+0000', moment: Date.parse('2027-01-01T00:00:00Z'), hidden: false }] },
    quota: { read: async () => ({}) },
    clock: { now: () => NOW },
    cfg: LIVE_DEFAULTS,
  } as unknown as StreamsViewDeps;
  return { deps, filters };
}

describe('live/streamsView', () => {
  it('pageOf cuts a page and gives the next cursor only while more remain (in memory and store-cut)', () => {
    const rows = Array.from({ length: 5 }, (_, i) => i);
    expect(pageOf(rows, 0, 2)).toEqual({ items: [0, 1], next: '2' });
    expect(pageOf(rows, 4, 2)).toEqual({ items: [4] });
    expect(pageOf([2, 3, 4], 2, 2, true)).toEqual({ items: [2, 3], next: '4' });
    expect(pageOf([4], 4, 2, true)).toEqual({ items: [4] });
  });

  it('the owner view: channels by priority, newest decision first, the blacklist marker, quota lines and the agent keys', async () => {
    const { deps } = depsOf(
      [channel(CH_B, { priority: 2, blacklisted: true }), channel(CH_A)],
      [candidate('old0000000a', 1), candidate('new0000000b', 2, { channelId: CH_B, state: 'approved' }), candidate('none000000c', null)],
    );
    const keys = [{ adminId: '7', email: 'agent@example.com', active: true, issuedAt: '2026-12-30T10:00:00.000Z' }];
    const v = await streamsView(deps, {}, keys);
    expect(v.channels.map((c) => c.channelId)).toEqual([CH_A, CH_B]);
    expect(v.candidates.map((c) => c.videoId)).toEqual(['new0000000b', 'old0000000a', 'none000000c']);
    expect(v.candidates[0]).toMatchObject({ channelName: '2', fromBlacklisted: true });
    expect(v.quota.map((q) => [q.cls, q.used, q.percent])).toEqual([
      ['candidates', 0, 0],
      ['playlists', 0, 0],
      ['search', 0, 0],
    ]);
    expect(v.events).toEqual([{ eventId: 'ev-1', zoneId: 'utc+0000', moment: '2027-01-01T00:00:00.000Z' }]);
    expect(v.agentKeys).toEqual(keys);
    expect(v.next).toBeUndefined();
    expect((await streamsView(deps, {})).agentKeys).toEqual([]);
  });

  it('the owner view pages by the cursor', async () => {
    const many = Array.from({ length: AGENT_CANDIDATES_PAGE_MAX + 1 }, (_, i) => candidate(`v${String(i).padStart(10, '0')}`, i + 1));
    const { deps } = depsOf([channel(CH_A)], many);
    const first = await streamsView(deps, {});
    expect(first.candidates).toHaveLength(AGENT_CANDIDATES_PAGE_MAX);
    expect(first.next).toBe(String(AGENT_CANDIDATES_PAGE_MAX));
    const second = await streamsView(deps, { cursor: first.next });
    expect(second.candidates.map((c) => c.videoId)).toEqual([many[0]?.videoId]);
    expect(second.next).toBeUndefined();
  });

  it('agent reads: channels without the blacklisted ones plus the blacklist; one store-cut page of candidates', async () => {
    const many = Array.from({ length: AGENT_CANDIDATES_PAGE_MAX + 1 }, (_, i) => candidate(`v${String(i).padStart(10, '0')}`, i + 1, { state: 'proposed' }));
    const { deps, filters } = depsOf([channel(CH_A), channel(CH_B, { blacklisted: true })], many);
    expect(await agentChannels(deps)).toEqual({
      channels: [{ channelId: CH_A, name: '1', type: 'tv', zones: ['utc+0000'], seasons: ['2026-27'], priority: 1, state: 'watched' }],
      blacklist: [CH_B],
    });
    const page = await agentCandidates(deps, { state: 'proposed' });
    expect(filters.at(-1)).toEqual({ states: ['proposed'], page: { offset: 0, limit: AGENT_CANDIDATES_PAGE_MAX + 1 } });
    expect(page.items).toHaveLength(AGENT_CANDIDATES_PAGE_MAX);
    expect(page.items[0]).toEqual({ videoId: many.at(-1)?.videoId, channelId: CH_A, foundBy: ['playlist'], state: 'proposed' });
    expect(page.next).toBe(String(AGENT_CANDIDATES_PAGE_MAX));
    expect((await agentCandidates(deps, { cursor: page.next })).next).toBeUndefined();
  });
});
