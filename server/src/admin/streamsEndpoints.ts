/**
 * The owner's stream sources endpoints (SPEC-21a AC-1, AC-2, AC-4, AC-15, AC-20, AC-21), Payload glue (ring 4), thin:
 * the actions are `live/sources.ts`. Served under `/cms-api/streams/*` in every class; the slice «Джерела» calls them.
 *
 * - `GET /cms-api/streams/view?state=&eventId=&cursor=` → `{ ok, value: StreamsViewValue }`: every channel with its
 *   fields, one page (≤ `AGENT_CANDIDATES_PAGE_MAX`) of the candidate queue with the filters, each with its default
 *   event ([А8]) and the derived marker "approved from a channel now blacklisted" (AC-4), the season's events to pick
 *   from, the spend of `candidates`, `playlists` and the search bucket for the current quota day.
 * - `POST /cms-api/streams/<action>` for the actions of `STREAMS_ACTIONS` with `StreamsActionBody` (strict; its
 *   `action` must be the path's) → `{ ok, value }` (the outcome of the service).
 * Both: behind the Access gate and the `owner` role, else 403 `forbidden` with nothing read or changed (agent keys
 * included). The POST also needs `content-type: application/json` and a body of at most 1 KB, refused before parsing
 * (`admin/cmsHttp.ts`) → 400 `invalid`. Service refusals keep their code: `invalid` 400, `not-found` 404,
 * `invalid-state` / `chain-full` 409, `limit` 429, `unavailable` 503. The view maps the rows field by field (never
 * a raw collection document). The service writes one journal row per change in the same transaction (NFR-6).
 */
import {
  AGENT_CANDIDATES_PAGE_MAX,
  STREAMS_ACTIONS,
  type CandidateReason,
  type CandidateState,
  type FoundBy,
  type StreamsAction,
  type StreamsActionBody,
} from '@time2fest/contracts';
import { StreamsActionBodySchema, StreamsViewQuerySchema } from '@time2fest/contracts/schemas';
import type { Endpoint, PayloadRequest } from 'payload';
import { z } from 'zod';
import { resolveActor } from '../audit/journal';
import { defaultEvent } from '../domain/live/candidates';
import { counterOf, nextDayBoundary, quotaDay } from '../domain/live/quota';
import type { Deps } from '../endpoints/types';
import type { StoredCandidate } from '../live/ports';
import {
  addCandidates,
  addChannel,
  approveCandidate,
  approveChannel,
  editChannel,
  rejectCandidate,
  requeueCandidate,
  setBlacklist,
  type SourcesDeps,
  type SourcesRefusal,
  type SourcesResult,
} from '../live/sources';
import { sourcesOf } from '../registries/revertHandlers';
import { isOwner, jsonBodyOf, NO_STORE } from './cmsHttp';

const PERCENT = 100;

type StreamsCode = SourcesRefusal;
const STATUS: Record<StreamsCode, number> = {
  invalid: 400,
  forbidden: 403,
  'not-found': 404,
  'invalid-state': 409,
  'chain-full': 409,
  limit: 429,
  unavailable: 503,
};

/** The refusal of this surface: the codes of the spec's contract (`invalid`, not the `validation` of SPEC-12). */
export const streamsFail = (code: StreamsCode, reason?: string) =>
  Response.json({ ok: false, error: reason ? { code, reason } : { code } }, { status: STATUS[code], headers: NO_STORE });

/** The owner from the request, as the journal names them. */
const ownerActor = (req: PayloadRequest) => ({ ...resolveActor(req.user, req.context), kind: 'owner' as const });

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

export interface StreamsViewChannel {
  channelId: string;
  name: string;
  kind: string;
  zones: string[];
  seasons: string[];
  priority: number;
  state: string;
  blacklisted: boolean;
  blacklistReason: string | null;
  blacklistSource: string | null;
  proposedBy: string | null;
  uploadsPlaylistId: string | null;
  uploadsFetchedAt: string | null;
  lastPlaylistAt: string | null;
  lastSearchAt: string | null;
}

export interface StreamsViewCandidate {
  videoId: string;
  channelId: string | null;
  channelName: string | null;
  foundBy: FoundBy[];
  state: CandidateState;
  reason: CandidateReason | null;
  eventId: string | null;
  sourceId: string | null;
  scheduledStartTime: string | null;
  checkedAt: string | null;
  stateChangedAt: string | null;
  evidenceUrl: string | null;
  note: string | null;
  /** The event the approval form preselects ([А8], AC-15); `null` = the owner picks. */
  defaultEventId: string | null;
  /** Approved (or active) while its channel is blacklisted now (AC-4): kept in the chain, shown with a marker. */
  fromBlacklisted: boolean;
}

export interface StreamsViewQuota {
  cls: 'candidates' | 'playlists' | 'search';
  used: number;
  limit: number;
  percent: number;
  /** The next quota-day boundary, UTC ISO. */
  resetAt: string;
}

export interface StreamsViewValue {
  now: string;
  channels: StreamsViewChannel[];
  candidates: StreamsViewCandidate[];
  /** The cursor of the next page of candidates (same filters), when there is one. */
  next?: string;
  /** The season's events (not hidden), by moment: the approval picks any of them. */
  events: { eventId: string; zoneId: string; moment: string }[];
  quota: StreamsViewQuota[];
}

/** The view query: the contract filters plus the page cursor (an offset). */
const ViewQuerySchema = StreamsViewQuerySchema.extend({ cursor: z.string().regex(/^\d{1,6}$/).optional() }).strict();
export type StreamsViewParams = z.infer<typeof ViewQuerySchema>;

const BLACKLIST_KEPT: readonly CandidateState[] = ['approved', 'active'];

/** Newest decision first, then by videoId (a stable page order). */
const byRecent = (a: StoredCandidate, b: StoredCandidate) =>
  (b.stateChangedAt ?? 0) - (a.stateChangedAt ?? 0) || (a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0);

/** What the slice «Джерела» shows (AC-20). Reads only; sequential (the reads may share one database session). */
export async function streamsView(deps: Pick<SourcesDeps, 'streams' | 'events' | 'quota' | 'clock' | 'cfg'>, params: StreamsViewParams): Promise<StreamsViewValue> {
  const { cfg } = deps;
  const now = deps.clock.now();
  const channels = await deps.streams.channels();
  const all = await deps.streams.candidates({ ...(params.state ? { states: [params.state] } : {}), ...(params.eventId ? { eventId: params.eventId } : {}) });
  const events = (await deps.events.events()).filter((e) => !e.hidden);
  const counters = await deps.quota.read(quotaDay(now, cfg.dayTimeZone));
  const byId = new Map(channels.map((c) => [c.channelId, c]));
  const offset = params.cursor ? Number(params.cursor) : 0;
  const sorted = [...all].sort(byRecent);
  const page = sorted.slice(offset, offset + AGENT_CANDIDATES_PAGE_MAX);
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
    candidates: page.map((c) => {
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
    ...(offset + AGENT_CANDIDATES_PAGE_MAX < sorted.length ? { next: String(offset + AGENT_CANDIDATES_PAGE_MAX) } : {}),
    events: [...events]
      .sort((a, b) => a.moment - b.moment || (a.eventId < b.eventId ? -1 : 1))
      .map((e) => ({ eventId: e.eventId, zoneId: e.zoneId, moment: new Date(e.moment).toISOString() })),
    quota: [
      spend('candidates', counterOf(counters, 'candidates', now, cfg).used, cfg.classCeilings.candidates),
      spend('playlists', counterOf(counters, 'playlists', now, cfg).used, cfg.classCeilings.playlists),
      spend('search', counterOf(counters, 'search', now, cfg).used, cfg.buckets.search.perDay),
    ],
  };
}

/** One owner action through the sources services (each writes its own transaction and journal row). */
export async function applyStreamsAction(deps: SourcesDeps, req: PayloadRequest, body: StreamsActionBody): Promise<SourcesResult<unknown>> {
  const actor = ownerActor(req);
  switch (body.action) {
    case 'channel-add':
      return addChannel(deps, { channelId: body.channelId, actor, fields: { name: body.name, kind: body.kind, zones: body.zones, priority: body.priority } });
    case 'channel-edit':
      return editChannel(deps, {
        channelId: body.channelId,
        actor,
        fields: { name: body.name, kind: body.kind, zones: body.zones, priority: body.priority },
        ...(body.state ? { state: body.state } : {}),
      });
    case 'blacklist':
    case 'unblacklist':
      return setBlacklist(deps, { channelId: body.channelId, blacklisted: body.action === 'blacklist', reason: body.reason, actor });
    case 'channel-approve':
      return approveChannel(deps, { channelId: body.channelId, actor });
    case 'candidate-add': {
      const eventId = body.eventId !== undefined ? { eventId: body.eventId } : {};
      if ('channelId' in body) return addChannel(deps, { channelId: body.channelId, actor, ...eventId });
      const added = await addCandidates(deps, { videoIds: [body.videoId], origin: 'owner', actor, ...eventId });
      return added.ok ? { ok: true, value: added.value[0] ?? null } : added;
    }
    case 'approve':
      return approveCandidate(deps, { videoId: body.videoId, eventId: body.eventId, actor, ...(body.reason ? { reason: body.reason } : {}) });
    case 'reject':
      return rejectCandidate(deps, { videoId: body.videoId, actor, reason: body.reason });
    case 'requeue':
      return requeueCandidate(deps, { videoId: body.videoId, actor });
  }
}

type SourcesFor = (deps: Deps) => Promise<SourcesDeps>;

function viewEndpoint(resolve: () => Promise<Deps>, sourcesFor: SourcesFor): Endpoint {
  return {
    path: '/streams/view',
    method: 'get',
    handler: async (req) => {
      if (!isOwner(req)) return streamsFail('forbidden');
      const search = req.searchParams ?? new URL(req.url ?? 'http://local/').searchParams;
      const params = ViewQuerySchema.safeParse(Object.fromEntries(search));
      if (!params.success) return streamsFail('invalid');
      try {
        const value = await streamsView(await sourcesFor(await resolve()), params.data);
        return Response.json({ ok: true, value }, { headers: NO_STORE });
      } catch {
        return streamsFail('unavailable');
      }
    },
  };
}

function actionEndpoint(action: StreamsAction, resolve: () => Promise<Deps>, sourcesFor: SourcesFor): Endpoint {
  return {
    path: `/streams/${action}`,
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return streamsFail('forbidden');
      const body = await jsonBodyOf(req, StreamsActionBodySchema);
      if (body === null || body.action !== action) return streamsFail('invalid');
      try {
        const result = await applyStreamsAction(await sourcesFor(await resolve()), req, body);
        if (result.ok) return Response.json({ ok: true, value: result.value }, { headers: NO_STORE });
        return streamsFail(result.code, result.detail);
      } catch {
        // One transaction per action: a failed store wrote nothing.
        return streamsFail('unavailable');
      }
    },
  };
}

/** The stream sources endpoints, in every class. `resolve` gives the process deps (tests may pass their own). */
export function streamsEndpoints(resolve: () => Promise<Deps>, sourcesFor: SourcesFor = sourcesOf): Endpoint[] {
  return [viewEndpoint(resolve, sourcesFor), ...STREAMS_ACTIONS.map((action) => actionEndpoint(action, resolve, sourcesFor))];
}
