/**
 * The owner's presence endpoints `/cms-api/presence/*` (SPEC-14 W38, AC-19), Payload glue (ring 4); served in every class.
 * - `GET /cms-api/presence` -> `{ ok, value: { season, records, downtimes, samples } }`: the window health records and the
 *   downtime records of the current season (newest first, capped), plus a per-node summary of the intake samples.
 * - `POST /cms-api/presence/downtime {eventId?, from?, to?, reason}` (strict) -> `{ ok, value: { downtime } }`: a manual
 *   downtime (an event, or a time range), `recorded_by: owner`, one journal row in its own transaction.
 * - Records are append-only: PATCH / PUT / DELETE on `/presence/downtime(s)[/:id]` are always 403 `forbidden`.
 * All: behind the Access gate and the `owner` role, else 403 `forbidden`; POST bodies are JSON of at most 1 KB, else 400.
 */
import { commitTransaction, initTransaction, killTransaction } from 'payload';
import type { Endpoint, PayloadRequest } from 'payload';
import { z } from 'zod';
import { createPayloadJournal } from '../adapters/payloadJournal';
import { rightsDbOf } from '../auth/pool';
import { resolveActor } from '../audit/journal';
import { presenceOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import type { DowntimeRow } from '../presence/ports';
import { isRevertible } from '../registries/revertHandlers';
import { fail, isOwner, jsonBodyOf, NO_STORE } from './cmsHttp';

export const PRESENCE_DOWNTIME_ACTION = 'presence.downtime-add';
const COLLECTION = 'presence-downtimes';
const LIST_CAP = 200;

const ms = z.number().int().nonnegative();
const AddBodySchema = z
  .object({ eventId: z.string().min(1).max(128).optional(), from: ms.optional(), to: ms.optional(), reason: z.string().trim().min(1).max(200) })
  .strict()
  .refine((b) => (b.from === undefined) === (b.to === undefined), { message: 'range' })
  .refine((b) => b.eventId !== undefined || b.from !== undefined, { message: 'target' });

const ownerActor = (req: PayloadRequest) => ({ ...resolveActor(req.user, req.context), kind: 'owner' as const });
const iso = (v: string | number | null): string | null => (v === null ? null : new Date(Number(v)).toISOString());

const downtimeView = (r: DowntimeRow) => ({
  id: r.id,
  kind: r.kind,
  eventId: r.event_id,
  from: iso(r.from_ms),
  to: iso(r.to_ms),
  region: r.region,
  reason: r.reason,
  recordedBy: r.recorded_by,
  createdAt: iso(r.created_at),
  alarmed: r.alarmed_at !== null,
});

async function journal(req: PayloadRequest, now: number, row: DowntimeRow): Promise<void> {
  const started = await initTransaction(req);
  try {
    await createPayloadJournal(isRevertible).append(req, {
      actor: ownerActor(req),
      action: PRESENCE_DOWNTIME_ACTION,
      target: { collection: COLLECTION, id: row.id },
      at: now,
      before: null,
      after: { season: row.season, eventId: row.event_id, from: iso(row.from_ms), to: iso(row.to_ms), reason: row.reason },
      revertOf: null,
    });
    if (started) await commitTransaction(req);
  } catch (err) {
    if (started) await killTransaction(req);
    throw err;
  }
}

function listEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/presence',
    method: 'get',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      try {
        const deps = await resolve();
        const presence = presenceOf(deps);
        const season = (await presence.season(deps.clock.now())).key;
        if (season === null) return Response.json({ ok: true, value: { season, records: [], downtimes: [], samples: [] } }, { headers: NO_STORE });
        const db = await rightsDbOf(deps);
        const records = await db.query(
          `SELECT event_id, moment_ms, state, signs, recorded_by, recorded_at, alarmed_at FROM presence_window_health
           WHERE season = $1 ORDER BY moment_ms DESC, event_id LIMIT ${LIST_CAP}`,
          [season],
        );
        const downtimes = (await presence.downtimes.list(season)).slice(-LIST_CAP).reverse();
        const samples = await db.query(
          `SELECT node_id, count(*)::int AS samples, max(at) AS last_at, sum(accepted)::bigint AS accepted, sum(failed)::bigint AS failed
           FROM presence_samples WHERE at >= $1 GROUP BY node_id ORDER BY node_id`,
          [deps.clock.now() - 24 * 3600_000],
        );
        return Response.json(
          {
            ok: true,
            value: {
              season,
              records: records.rows.map((r) => ({
                eventId: String(r.event_id),
                moment: iso(r.moment_ms as string),
                state: String(r.state),
                signs: r.signs as string[],
                recordedBy: String(r.recorded_by),
                recordedAt: iso(r.recorded_at as string),
                alarmed: r.alarmed_at !== null,
              })),
              downtimes: downtimes.map(downtimeView),
              samples: samples.rows.map((r) => ({
                node: String(r.node_id),
                samples: Number(r.samples),
                lastAt: iso(r.last_at as string),
                accepted: Number(r.accepted),
                failed: Number(r.failed),
              })),
            },
          },
          { headers: NO_STORE },
        );
      } catch {
        return fail('unavailable');
      }
    },
  };
}

function addEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/presence/downtime',
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const body = await jsonBodyOf(req, AddBodySchema);
      if (body === null) return fail('validation');
      try {
        const deps = await resolve();
        const now = deps.clock.now();
        const input =
          body.from !== undefined && body.to !== undefined
            ? { ...(body.eventId !== undefined ? { eventId: body.eventId } : {}), from: body.from, to: body.to, reason: body.reason }
            : { eventId: body.eventId as string, reason: body.reason };
        const res = await presenceOf(deps).downtimes.addManual(input as Parameters<ReturnType<typeof presenceOf>['downtimes']['addManual']>[0], now);
        if (!res.ok) return res.reason === 'unknown-event' ? fail('not-found', res.reason) : fail('validation', res.reason);
        await journal(req, now, res.row);
        return Response.json({ ok: true, value: { downtime: downtimeView(res.row) } }, { headers: NO_STORE });
      } catch {
        return fail('unavailable');
      }
    },
  };
}

/** Records are append-only: every change or removal is refused, for anyone. */
const refused = (path: string, method: 'patch' | 'put' | 'delete'): Endpoint => ({ path, method, handler: () => fail('forbidden', 'append-only') });

/** The presence endpoints, in every class. `resolve` gives the process deps (tests may pass their own). */
export function presenceEndpoints(resolve: () => Promise<Deps>): Endpoint[] {
  const methods = ['patch', 'put', 'delete'] as const;
  return [
    listEndpoint(resolve),
    addEndpoint(resolve),
    ...methods.flatMap((m) => [refused('/presence/downtime', m), refused('/presence/downtimes', m), refused('/presence/downtime/:id', m), refused('/presence/downtimes/:id', m)]),
  ];
}
