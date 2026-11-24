/**
 * The stream agent's endpoints (SPEC-21a AC-3, AC-31 … AC-33, AC-37, NFR-6), Payload glue (ring 4), thin: the actions
 * are `live/sources.ts`. Served under `/cms-api/stream-agent/*` in every class; the service-token allow-list of the
 * gate (`domain/access/classify.ts`) lets exactly these three through.
 *
 * - `GET /cms-api/stream-agent/channels` → `{ ok, value: AgentChannelsResponse }`: the channels (not blacklisted) and
 *   the blacklisted channelIds.
 * - `GET /cms-api/stream-agent/candidates?state=&eventId=&cursor=` → `{ ok, value: AgentCandidatesResponse }`: one page
 *   (≤ `AGENT_CANDIDATES_PAGE_MAX`) of the queue, newest decision first, `next` while more remain.
 * - `POST /cms-api/stream-agent/candidates` `AgentProposeBody` (strict, ≤1 KB) → `{ ok, value: AgentProposeResult }`:
 *   a videoId through `addCandidates` (origin `agent`), a channelId through `addChannel` — both with actor `agent`, so
 *   the service caps a candidate at `proposed` and a channel at `proposed` (AC-31). Nothing here touches chains, the
 *   live version or site state.
 * Every request: behind the Access gate and the `stream-agent` role, read fresh from the request (the API-key lookup
 * runs per request, so a revoked key is refused on the very next one, AC-38), else 403 `forbidden` with nothing read
 * or changed. Then the per-minute limit of `registries/rateLimits.ts` by admins id (propose: fail-closed on a fast-store
 * outage, read: counted in this process), and for a valid proposal the daily cap `LIVE_DEFAULTS.agent.proposalsPerDay`
 * per agent and quota day (one `live_quota` row `agent:<admins id>`, so it survives restarts) — over → 429
 * `rate-limited` with `retryAfterMs`, state unchanged (AC-37). Refusal codes as the owner's surface (`streamsFail`).
 * Logs carry nothing of the request (no key, no ids).
 */
import {
  AGENT_CANDIDATES_PAGE_MAX,
  type AgentCandidate,
  type AgentCandidatesResponse,
  type AgentChannelsResponse,
  type AgentProposeResult,
  type ChannelKind,
  type ChannelPriority,
} from '@time2fest/contracts';
import { AgentCandidatesQuerySchema, AgentProposeBodySchema } from '@time2fest/contracts/schemas';
import type { Endpoint, PayloadRequest } from 'payload';
import { streamsFail } from '../admin/streamsEndpoints';
import { isStreamAgent, jsonBodyOf, NO_STORE } from '../admin/cmsHttp';
import { resolveActor } from '../audit/journal';
import { agentProposalAllowed } from '../domain/live/candidates';
import { nextDayBoundary, quotaDay, type QuotaCounterKey } from '../domain/live/quota';
import type { Deps } from '../endpoints/types';
import type { StoredCandidate } from '../live/ports';
import { addCandidates, addChannel, type SourcesDeps } from '../live/sources';
import { checkLimit, type RateLimitRow } from '../platform/rateLimit';
import { rateLimitRegistry } from '../registries/rateLimits';
import { sourcesOf } from '../registries/revertHandlers';

type SourcesFor = (deps: Deps) => Promise<SourcesDeps>;

const PROPOSE_ROW = 'stream-agent-propose';
const READ_ROW = 'stream-agent-read';

function rowOf(key: string): RateLimitRow {
  const row = rateLimitRegistry.find((r) => r.key === key);
  if (!row) throw new Error(`stream-agent: rate-limit row ${key} is missing`);
  return row;
}

const rateLimited = (retryAfterMs: number) =>
  Response.json({ ok: false, error: { code: 'rate-limited', retryAfterMs } }, { status: 429, headers: NO_STORE });

/** The agent from the request, as the journal names it (always `agent`). */
const agentActor = (req: PayloadRequest) => ({ ...resolveActor(req.user, req.context), kind: 'agent' as const });
const agentId = (req: PayloadRequest) => String((req.user as { id?: unknown } | null)?.id ?? '');

/** The per-minute limit of `rowKey` for this agent; a refusal response, or `null` to go on. */
async function minuteLimit(deps: Deps, rowKey: string, req: PayloadRequest): Promise<Response | null> {
  const verdict = await checkLimit(rowOf(rowKey), { subject: agentId(req) }, { fast: deps.redis, memory: deps.memory });
  if (verdict.ok) return null;
  if (verdict.error.code === 'rate_limited') return rateLimited(verdict.error.retryAfterMs ?? rowOf(rowKey).windowMs);
  return streamsFail('unavailable');
}

/** Counts one proposal against the agent's daily cap ([П-3]); a refusal response, or `null` to go on. */
async function dailyCap(sources: SourcesDeps, req: PayloadRequest): Promise<Response | null> {
  const now = sources.clock.now();
  const day = quotaDay(now, sources.cfg.dayTimeZone);
  // A per-agent counter row of `live_quota` (`bucket` is text); the quota readers skip keys they do not know.
  const used = await sources.quota.charge(day, `agent:${agentId(req)}` as QuotaCounterKey, 1);
  if (agentProposalAllowed(used - 1, sources.cfg)) return null;
  return rateLimited(Math.max(1, nextDayBoundary(now, sources.cfg.dayTimeZone) - now));
}

const iso = (ms: number | null) => (ms == null ? undefined : new Date(ms).toISOString());

/** Newest decision first, then by videoId (a stable page order). */
const byRecent = (a: StoredCandidate, b: StoredCandidate) =>
  (b.stateChangedAt ?? 0) - (a.stateChangedAt ?? 0) || (a.videoId < b.videoId ? -1 : a.videoId > b.videoId ? 1 : 0);

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

function channelsEndpoint(resolve: () => Promise<Deps>, sourcesFor: SourcesFor): Endpoint {
  return {
    path: '/stream-agent/channels',
    method: 'get',
    handler: async (req) => {
      if (!isStreamAgent(req)) return streamsFail('forbidden');
      try {
        const deps = await resolve();
        const limited = await minuteLimit(deps, READ_ROW, req);
        if (limited) return limited;
        const channels = await (await sourcesFor(deps)).streams.channels();
        const value: AgentChannelsResponse = {
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
        return Response.json({ ok: true, value }, { headers: NO_STORE });
      } catch {
        return streamsFail('unavailable');
      }
    },
  };
}

function candidatesReadEndpoint(resolve: () => Promise<Deps>, sourcesFor: SourcesFor): Endpoint {
  return {
    path: '/stream-agent/candidates',
    method: 'get',
    handler: async (req) => {
      if (!isStreamAgent(req)) return streamsFail('forbidden');
      try {
        const deps = await resolve();
        const limited = await minuteLimit(deps, READ_ROW, req);
        if (limited) return limited;
        const search = req.searchParams ?? new URL(req.url ?? 'http://local/').searchParams;
        const params = AgentCandidatesQuerySchema.safeParse(Object.fromEntries(search));
        if (!params.success || (params.data.cursor !== undefined && !/^\d+$/.test(params.data.cursor))) return streamsFail('invalid');
        const { state, eventId, cursor } = params.data;
        const all = await (await sourcesFor(deps)).streams.candidates({ ...(state ? { states: [state] } : {}), ...(eventId ? { eventId } : {}) });
        const offset = cursor ? Number(cursor) : 0;
        const sorted = [...all].sort(byRecent);
        const value: AgentCandidatesResponse = {
          items: sorted.slice(offset, offset + AGENT_CANDIDATES_PAGE_MAX).map(agentCandidate),
          ...(offset + AGENT_CANDIDATES_PAGE_MAX < sorted.length ? { next: String(offset + AGENT_CANDIDATES_PAGE_MAX) } : {}),
        };
        return Response.json({ ok: true, value }, { headers: NO_STORE });
      } catch {
        return streamsFail('unavailable');
      }
    },
  };
}

function proposeEndpoint(resolve: () => Promise<Deps>, sourcesFor: SourcesFor): Endpoint {
  return {
    path: '/stream-agent/candidates',
    method: 'post',
    handler: async (req) => {
      if (!isStreamAgent(req)) return streamsFail('forbidden');
      try {
        const deps = await resolve();
        const limited = await minuteLimit(deps, PROPOSE_ROW, req);
        if (limited) return limited;
        const body = await jsonBodyOf(req, AgentProposeBodySchema);
        if (body === null) return streamsFail('invalid');
        const sources = await sourcesFor(deps);
        const capped = await dailyCap(sources, req);
        if (capped) return capped;
        const actor = agentActor(req);
        const extras = {
          ...(body.eventId !== undefined ? { eventId: body.eventId } : {}),
          ...(body.evidenceUrl !== undefined ? { evidenceUrl: body.evidenceUrl } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
        };
        let value: AgentProposeResult;
        if ('channelId' in body) {
          const added = await addChannel(sources, { channelId: body.channelId, actor, ...extras });
          if (!added.ok) return streamsFail(added.code, added.detail);
          value = { channelId: added.value.channelId, state: added.value.state, created: added.value.created, added: added.value.added };
        } else {
          const added = await addCandidates(sources, { videoIds: [body.videoId], origin: 'agent', actor, ...extras });
          if (!added.ok) return streamsFail(added.code, added.detail);
          const one = added.value[0];
          if (!one) return streamsFail('unavailable');
          value = { videoId: one.videoId, state: one.state, ...(one.reason ? { reason: one.reason } : {}), created: one.created };
        }
        return Response.json({ ok: true, value }, { headers: NO_STORE });
      } catch {
        // One transaction per proposal: a failed store wrote nothing.
        return streamsFail('unavailable');
      }
    },
  };
}

/** The three stream-agent endpoints, in every class. `resolve` gives the process deps (tests may pass their own). */
export function streamAgentEndpoints(resolve: () => Promise<Deps>, sourcesFor: SourcesFor = sourcesOf): Endpoint[] {
  return [channelsEndpoint(resolve, sourcesFor), candidatesReadEndpoint(resolve, sourcesFor), proposeEndpoint(resolve, sourcesFor)];
}
