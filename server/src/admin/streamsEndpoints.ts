/**
 * The owner's stream sources endpoints (SPEC-21a AC-1, AC-2, AC-4, AC-15, AC-20, AC-21), Payload glue (ring 4), thin:
 * the actions are `live/sources.ts`. Served under `/cms-api/streams/*` in every class; the slice «Джерела» calls them.
 *
 * - `GET /cms-api/streams/view?state=&eventId=&cursor=` → `{ ok, value: StreamsViewValue }`: every channel with its
 *   fields, one page (≤ `AGENT_CANDIDATES_PAGE_MAX`) of the candidate queue with the filters, each with its default
 *   event ([А8]) and the derived marker "approved from a channel now blacklisted" (AC-4), the season's events to pick
 *   from, the spend of `candidates`, `playlists` and the search bucket for the current quota day, and the
 *   `stream-agent` admins with their key status (`agentKeys`: enabled and issued-at, never the key). The value is
 *   assembled by `live/streamsView.ts` (A21-05); the key itself is issued and revoked by the `admins` endpoints.
 * - `POST /cms-api/streams/<action>` for the actions of `STREAMS_ACTIONS` with `StreamsActionBody` (strict; its
 *   `action` must be the path's) → `{ ok, value }` (the outcome of the service).
 * Both: behind the Access gate and the `owner` role, else 403 `forbidden` with nothing read or changed (agent keys
 * included). The POST also needs `content-type: application/json` and a body of at most 1 KB, refused before parsing
 * (`admin/cmsHttp.ts`) → 400 `invalid`. Service refusals keep their code: `invalid` 400, `not-found` 404,
 * `invalid-state` / `chain-full` 409, `limit` 429, `unavailable` 503. The view maps the rows field by field (never
 * a raw collection document). The service writes one journal row per change in the same transaction (NFR-6).
 */
import { STREAMS_ACTIONS, type StreamsAction, type StreamsActionBody, type StreamsAgentKey } from '@time2fest/contracts';
import { StreamsActionBodySchema, StreamsViewQuerySchema } from '@time2fest/contracts/schemas';
import type { Endpoint, PayloadRequest } from 'payload';
import { z } from 'zod';
import { resolveActor } from '../audit/journal';
import type { Deps } from '../endpoints/types';
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
  type SourcesResult,
} from '../live/sources';
import { streamsView } from '../live/streamsView';
import { sourcesOf } from '../registries/revertHandlers';
import { isOwner, jsonBodyOf, NO_STORE, streamsFail } from './cmsHttp';

/** The owner from the request, as the journal names them. */
const ownerActor = (req: PayloadRequest) => ({ ...resolveActor(req.user, req.context), kind: 'owner' as const });

/** The view query: the contract filters plus the page cursor (an offset). */
const ViewQuerySchema = StreamsViewQuerySchema.extend({ cursor: z.string().regex(/^\d{1,6}$/).optional() }).strict();

/** At most this many `stream-agent` records are listed (the owner keeps one or two). */
const AGENT_ADMINS_MAX = 10;

/**
 * The `stream-agent` admins and their key status (section «Ключ агента пошуку»): whether the key is enabled and when
 * the active key was issued (the newest `key.issue` journal row of the record). Reads `enableAPIKey` only: never the
 * key, its encrypted copy or its index.
 */
export async function agentKeysOf(req: PayloadRequest): Promise<StreamsAgentKey[]> {
  const found = await req.payload.find({
    collection: 'admins',
    where: { role: { equals: 'stream-agent' } },
    sort: 'id',
    limit: AGENT_ADMINS_MAX,
    select: { email: true, enableAPIKey: true },
    overrideAccess: true,
    depth: 0,
    req,
  });
  const keys: StreamsAgentKey[] = [];
  for (const doc of found.docs as unknown as { id: number | string; email?: string; enableAPIKey?: boolean | null }[]) {
    const adminId = String(doc.id);
    const active = doc.enableAPIKey === true;
    let issuedAt: string | null = null;
    if (active) {
      const row = (
        await req.payload.find({
          collection: 'audit-log',
          where: { and: [{ action: { equals: 'key.issue' } }, { 'target.collection': { equals: 'admins' } }, { 'target.ref': { equals: adminId } }] },
          sort: '-id',
          limit: 1,
          select: { at: true },
          overrideAccess: true,
          depth: 0,
          req,
        })
      ).docs[0] as { at?: string | null } | undefined;
      issuedAt = row?.at ? new Date(row.at).toISOString() : null;
    }
    keys.push({ adminId, email: String(doc.email ?? ''), active, issuedAt });
  }
  return keys;
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
        const deps = await sourcesFor(await resolve());
        const value = await streamsView(deps, params.data, await agentKeysOf(req));
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
