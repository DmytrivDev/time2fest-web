/**
 * Read views of the stream sources (SPEC-21a AC-20, AC-32; A21-05), ring 3: the owner's slice «Джерела» and the
 * stream agent's reads. The endpoints (`admin/streamsEndpoints.ts`, `agent-api/streamAgentEndpoints.ts`) stay thin
 * glue around these functions. Reads only; sequential (the reads may share one database session).
 */
import {
  AGENT_CANDIDATES_PAGE_MAX,
  type AgentCandidate,
  type AgentCandidatesResponse,
  type AgentChannelsResponse,
  type CandidateState,
  type ChannelKind,
  type ChannelPriority,
  type StreamsAgentKey,
  type StreamsViewQuota,
  type StreamsViewQuery,
  type StreamsViewValue,
} from '@time2fest/contracts';
import { defaultEvent } from '../domain/live/candidates';
import { counterOf, nextDayBoundary, quotaDay } from '../domain/live/quota';
import type { StoredCandidate } from './ports';
import type { SourcesDeps } from './sources';

/** Percent scale (written as 1e2: the quota literal scan of `live-quota.test.ts` reads this folder). */
const PERCENT = 1e2;
const BLACKLIST_KEPT: readonly CandidateState[] = ['approved', 'active'];

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

/** Newest decision first, then by videoId (a stable page order). */
export const byRecent = (a: StoredCandidate, b: StoredCandidate) =>
  (b.stateChangedAt ?? 0) - (a.stateChangedAt ?? 0) || (a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0);

/** The offset of a page cursor (digits, checked by the caller's schema); none = the first page. */
export const offsetOf = (cursor?: string) => (cursor ? Number(cursor) : 0);

/**
 * One page of `size` at `offset` of `rows`, and the next cursor when more remain. `rows` may already be cut by the
 * store to `size + 1` from `offset` (`fetched: true`): the extra row only tells that more remain.
 */
export function pageOf<T>(rows: readonly T[], offset: number, size = AGENT_CANDIDATES_PAGE_MAX, fetched = false): { items: T[]; next?: string } {
  const from = fetched ? 0 : offset;
  const items = rows.slice(from, from + size);
  return rows.length > from + size ? { items, next: String(offset + size) } : { items };
}

export type StreamsViewDeps = Pick<SourcesDeps, 'streams' | 'events' | 'quota' | 'clock' | 'cfg'>;
export type StreamsViewParams = StreamsViewQuery & { cursor?: string };

/** What the slice «Джерела» shows (AC-20); `agentKeys` comes from the admins records (ring 4 reads them). */
export async function streamsView(deps: StreamsViewDeps, params: StreamsViewParams, agentKeys: StreamsAgentKey[] = []): Promise<StreamsViewValue> {
  const { cfg } = deps;
  const now = deps.clock.now();
  const channels = await deps.streams.channels();
  const all = await deps.streams.candidates({ ...(params.state ? { states: [params.state] } : {}), ...(params.eventId ? { eventId: params.eventId } : {}) });
  const events = (await deps.events.events()).filter((e) => !e.hidden);
  const counters = await deps.quota.read(quotaDay(now, cfg.dayTimeZone));
  const byId = new Map(channels.map((c) => [c.channelId, c]));
  const page = pageOf([...all].sort(byRecent), offsetOf(params.cursor));
  const resetAt = new Date(nextDayBoundary(now, cfg.dayTimeZone)).toISOString();
  const spend = (cls: StreamsViewQuota['cls'], used: number, limit: number): StreamsViewQuota => ({
    cls,
    used,
    limit,
    percent: limit > 0 ? Math.floor((used / limit) * PERCENT) : 0,
    resetAt,
  });
  return {
    now: new Date(now).toISOString(),
    channels: channels
      .map((c) => ({
        channelId: c.channelId,
        name: c.name,
        kind: c.kind,
        zones: [...c.zones],
        seasons: [...c.seasons],
        priority: c.priority,
        state: c.state,
        blacklisted: c.blacklisted,
        blacklistReason: c.blacklistReason,
        blacklistSource: c.blacklistSource,
        proposedBy: c.proposedBy,
        uploadsPlaylistId: c.uploadsPlaylistId,
        uploadsFetchedAt: iso(c.uploadsFetchedAt),
        lastPlaylistAt: iso(c.lastPlaylistAt),
        lastSearchAt: iso(c.lastSearchAt),
      }))
      .sort((a, b) => a.priority - b.priority || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    candidates: page.items.map((c) => {
      const channel = c.channelId ? byId.get(c.channelId) : undefined;
      return {
        videoId: c.videoId,
        channelId: c.channelId,
        channelName: channel?.name ?? null,
        foundBy: [...c.foundBy],
        state: c.state,
        reason: c.reason,
        eventId: c.eventId,
        sourceId: c.sourceId,
        scheduledStartTime: iso(c.scheduledStartTime),
        checkedAt: iso(c.checkedAt),
        stateChangedAt: iso(c.stateChangedAt),
        evidenceUrl: c.evidenceUrl,
        note: c.note,
        defaultEventId: defaultEvent(c.scheduledStartTime, channel?.zones ?? [], events, cfg),
        fromBlacklisted: channel?.blacklisted === true && BLACKLIST_KEPT.includes(c.state),
      };
    }),
    ...(page.next ? { next: page.next } : {}),
    events: [...events]
      .sort((a, b) => a.moment - b.moment || (a.eventId < b.eventId ? -1 : 1))
      .map((e) => ({ eventId: e.eventId, zoneId: e.zoneId, moment: new Date(e.moment).toISOString() })),
    quota: [
      spend('candidates', counterOf(counters, 'candidates', now, cfg).used, cfg.classCeilings.candidates),
      spend('playlists', counterOf(counters, 'playlists', now, cfg).used, cfg.classCeilings.playlists),
      spend('search', counterOf(counters, 'search', now, cfg).used, cfg.buckets.search.perDay),
    ],
    agentKeys: agentKeys.map((k) => ({ ...k })),
  };
}

/** The agent's channel list (AC-32): channels not blacklisted by priority, and the blacklisted channelIds. */
export async function agentChannels(deps: Pick<SourcesDeps, 'streams'>): Promise<AgentChannelsResponse> {
  const channels = await deps.streams.channels();
  return {
    channels: channels
      .filter((c) => !c.blacklisted)
      .sort((a, b) => a.priority - b.priority || (a.channelId < b.channelId ? -1 : 1))
      .map((c) => ({
        channelId: c.channelId,
        name: c.name,
        type: c.kind as ChannelKind,
        zones: [...c.zones],
        seasons: [...c.seasons],
        priority: c.priority as ChannelPriority,
        state: c.state,
      })),
    blacklist: channels.filter((c) => c.blacklisted).map((c) => c.channelId).sort(),
  };
}

function agentCandidate(c: StoredCandidate): AgentCandidate {
  const scheduled = iso(c.scheduledStartTime);
  const checked = iso(c.checkedAt);
  return {
    videoId: c.videoId,
    ...(c.channelId ? { channelId: c.channelId } : {}),
    foundBy: [...c.foundBy],
    state: c.state,
    ...(c.eventId ? { eventId: c.eventId } : {}),
    ...(c.reason ? { reason: c.reason } : {}),
    ...(scheduled ? { scheduledStartTime: scheduled } : {}),
    ...(checked ? { checkedAt: checked } : {}),
  };
}

/** One page of the agent's queue (AC-32): the store orders and cuts it, one row more tells whether more remain (S21-07). */
export async function agentCandidates(deps: Pick<SourcesDeps, 'streams'>, params: StreamsViewParams): Promise<AgentCandidatesResponse> {
  const offset = offsetOf(params.cursor);
  const rows = await deps.streams.candidates({
    ...(params.state ? { states: [params.state] } : {}),
    ...(params.eventId ? { eventId: params.eventId } : {}),
    page: { offset, limit: AGENT_CANDIDATES_PAGE_MAX + 1 },
  });
  const page = pageOf(rows, offset, AGENT_CANDIDATES_PAGE_MAX, true);
  return { items: page.items.map(agentCandidate), ...(page.next ? { next: page.next } : {}) };
}
