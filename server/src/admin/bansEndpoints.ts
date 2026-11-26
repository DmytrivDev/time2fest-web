/**
 * The owner's ban endpoints `/cms-api/bans/*` (SPEC-11 W37, AC-22, conductor decision 6), Payload glue (ring 4):
 * the actions are `rights/bans.ts`. Served in every class; the slice «Баны» calls them.
 * - `GET /cms-api/bans` -> `{ ok, value: { bans } }`: kind, subject id, created, source, derived count (no fingerprints).
 * - `POST /cms-api/bans/ban {kind, subjectId}` (strict) -> `{ ok, value: { ban, created } }`; an unknown account or
 *   guest id -> 404 `not-found`, nothing written.
 * - `POST /cms-api/bans/unban {banId}` -> `{ ok, value: { removed } }`.
 * All: behind the Access gate and the `owner` role, else 403 `forbidden`; POST bodies are JSON of at most 1 KB, else
 * 400 `validation`. A change writes one journal row (own transaction, after the ban store has answered: the ban tables
 * live on Better Auth's pool, the journal on Payload's).
 */
import { commitTransaction, initTransaction, killTransaction } from 'payload';
import type { Endpoint, PayloadRequest } from 'payload';
import { z } from 'zod';
import { createPayloadJournal } from '../adapters/payloadJournal';
import { rightsDbOf } from '../auth/pool';
import { resolveActor } from '../audit/journal';
import { rightsOf } from '../endpoints/deps';
import type { Deps } from '../endpoints/types';
import { isRevertible } from '../registries/revertHandlers';
import type { BanRecord } from '../rights/bans';
import { fail, isOwner, jsonBodyOf, NO_STORE } from './cmsHttp';

export const BAN_ACTION = 'rights.ban';
export const UNBAN_ACTION = 'rights.unban';
const BANS = 'bans';

const BanBodySchema = z.object({ kind: z.enum(['account', 'guest', 'device']), subjectId: z.string().min(1).max(128) }).strict();
const UnbanBodySchema = z.object({ banId: z.string().uuid() }).strict();

const ownerActor = (req: PayloadRequest) => ({ ...resolveActor(req.user, req.context), kind: 'owner' as const });

/** The wire shape of a ban: no fingerprint, no marks. */
const viewOf = (b: BanRecord, derived: number) => ({
  id: b.id,
  kind: b.kind,
  subjectId: b.subjectId,
  createdAt: new Date(b.createdAt).toISOString(),
  source: b.sourceBanId !== null ? 'derived' : b.createdBy,
  sourceBanId: b.sourceBanId,
  derived,
});

/** One journal row in its own transaction. */
async function journal(req: PayloadRequest, now: number, action: string, ban: BanRecord, before: unknown, after: unknown): Promise<void> {
  const started = await initTransaction(req);
  try {
    await createPayloadJournal(isRevertible).append(req, {
      actor: ownerActor(req),
      action,
      target: { collection: BANS, id: ban.id },
      at: now,
      before: before as Record<string, unknown> | null,
      after: after as Record<string, unknown> | null,
      revertOf: null,
    });
    if (started) await commitTransaction(req);
  } catch (err) {
    if (started) await killTransaction(req);
    throw err;
  }
}

async function subjectExists(deps: Deps, kind: string, id: string): Promise<boolean> {
  if (kind === 'device') return true;
  const db = await rightsDbOf(deps);
  const res = await db.query('SELECT 1 FROM users WHERE id::text = $1 AND is_anonymous = $2', [id, kind === 'guest']);
  return res.rows.length > 0;
}

function listEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/bans',
    method: 'get',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      try {
        const bans = await rightsOf(await resolve()).bans.list();
        const counts = new Map<string, number>();
        for (const b of bans) if (b.sourceBanId !== null) counts.set(b.sourceBanId, (counts.get(b.sourceBanId) ?? 0) + 1);
        return Response.json({ ok: true, value: { bans: bans.map((b) => viewOf(b, counts.get(b.id) ?? 0)) } }, { headers: NO_STORE });
      } catch {
        return fail('unavailable');
      }
    },
  };
}

function banEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/bans/ban',
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const body = await jsonBodyOf(req, BanBodySchema);
      if (body === null) return fail('validation');
      try {
        const deps = await resolve();
        if (!(await subjectExists(deps, body.kind, body.subjectId))) return fail('not-found');
        const actor = ownerActor(req);
        const { ban, created } = await rightsOf(deps).bans.ban({ kind: body.kind, subject: body.subjectId, by: 'owner' });
        if (created) await journal(req, deps.clock.now(), BAN_ACTION, ban, null, { kind: ban.kind, subjectId: ban.subjectId, by: actor.label });
        return Response.json({ ok: true, value: { ban: viewOf(ban, 0), created } }, { headers: NO_STORE });
      } catch {
        return fail('unavailable');
      }
    },
  };
}

function unbanEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/bans/unban',
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const body = await jsonBodyOf(req, UnbanBodySchema);
      if (body === null) return fail('validation');
      try {
        const deps = await resolve();
        const { removed, ban } = await rightsOf(deps).bans.unban(body.banId);
        if (!removed || ban === null) return fail('not-found');
        await journal(req, deps.clock.now(), UNBAN_ACTION, ban, { kind: ban.kind, subjectId: ban.subjectId }, null);
        return Response.json({ ok: true, value: { removed: true } }, { headers: NO_STORE });
      } catch {
        return fail('unavailable');
      }
    },
  };
}

/** The ban endpoints, in every class. `resolve` gives the process deps (tests may pass their own). */
export function bansEndpoints(resolve: () => Promise<Deps>): Endpoint[] {
  return [listEndpoint(resolve), banEndpoint(resolve), unbanEndpoint(resolve)];
}
