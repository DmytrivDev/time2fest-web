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
 * outage, read: counted in this process), and for a valid proposal the agent's daily ceilings of `proposeAsAgent`
 * (`live/sources.ts`: `agent.proposalsPerDay` and its share of the `candidates` / `playlists` class ceilings, in
 * `live_quota` rows `agent:<admins id>[:<class>]`, so they survive restarts) — over → 429 `rate-limited` with
 * `retryAfterMs`, state unchanged (AC-37). Refusal codes as the owner's surface (`streamsFail`).
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
import type { Deps } from '../endpoints/types';
import type { StoredCandidate } from '../live/ports';
import { proposeAsAgent, type SourcesDeps } from '../live/sources';
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

const iso = (ms: number | null) => (ms == null ? undefined : new Date(ms).toISOString());

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
        // The owner view's bound (S21-07); the store orders and cuts the page, one row more tells whether more remain.
        if (!params.success || (params.data.cursor !== undefined && !/^\d{1,6}$/.test(params.data.cursor))) return streamsFail('invalid');
        const { state, eventId, cursor } = params.data;
        const offset = cursor ? Number(cursor) : 0;
        const rows: StoredCandidate[] = await (await sourcesFor(deps)).streams.candidates({
          ...(state ? { states: [state] } : {}),
          ...(eventId ? { eventId } : {}),
          page: { offset, limit: AGENT_CANDIDATES_PAGE_MAX + 1 },
        });
        const value: AgentCandidatesResponse = {
          items: rows.slice(0, AGENT_CANDIDATES_PAGE_MAX).map(agentCandidate),
          ...(rows.length > AGENT_CANDIDATES_PAGE_MAX ? { next: String(offset + AGENT_CANDIDATES_PAGE_MAX) } : {}),
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
        const result = await proposeAsAgent(sources, { ...body, actor: agentActor(req) });
        if (!result.ok) return result.code === 'agent-capped' ? rateLimited(result.retryAfterMs) : streamsFail(result.code, result.detail);
        let value: AgentProposeResult;
        if (Array.isArray(result.value)) {
          const one = result.value[0];
          if (!one) return streamsFail('unavailable');
          value = { videoId: one.videoId, state: one.state, ...(one.reason ? { reason: one.reason } : {}), created: one.created };
        } else {
          const c = result.value;
          value = { channelId: c.channelId, state: c.state, created: c.created, added: c.added };
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
