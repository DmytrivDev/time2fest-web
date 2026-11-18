/**
 * Root Payload endpoints of the owner (SPEC-07 AC-51 … AC-53, AC-75, AC-77; C9), served under
 * `/cms-api/<path>` (Payload's REST handler matches root `endpoints` there). Payload glue (ring 4), thin:
 * the slice is `scheduler/festival.ts`, the clock actions `timekeeping/control.ts`.
 *
 * - `GET /cms-api/festival-state` → `{ ok, value: FestivalStateView }` in every class, read only.
 * - `POST /cms-api/clock` `{ action: 'set', at } | { action: 'real' } | { action: 'restart-night' }`
 *   → `{ ok, value: { now, speed, virtual, epoch } }`. Registered ONLY in `rehearsal` and `test`: in
 *   `production` the path does not exist, so Payload answers it exactly like an unknown path (AC-52).
 * Both: behind the Access gate (the proxy's identity marker, checked again here like every guarded
 * Payload endpoint) and the `owner` role, else 403 with nothing read or changed (AC-53, AC-77). The
 * POST also needs `content-type: application/json` (S4-01: a cross-site form cannot send it without
 * a preflight; the proxy checks Origin) and a body of at most 1 KB matching the strict C9 schema.
 * Speed is not an admin action: it exists only in the `ops` CLI (spec07-q1).
 */
import { sql } from '@payloadcms/db-postgres';
import type { ClockControlValue } from '@time2fest/contracts';
import { ClockControlBodySchema } from '@time2fest/contracts/schemas';
import type { Endpoint, Payload, PayloadRequest } from 'payload';
import { hasJsonContentType, passedGate } from '../access/payloadGuard';
import { roleOf } from '../access/policies';
import { createPayloadMomentSource } from '../adapters/payloadMoments';
import { createPgScheduler, SCHEDULER_LEASE } from '../adapters/pgScheduler';
import { processDeps } from '../adapters/processDeps';
import type { Journal } from '../audit/ports';
import { resolveActor } from '../audit/journal';
import { catalogStoreOf } from '../endpoints/deps';
import { isDependencyFailure } from '../endpoints/pipeline';
import type { Deps } from '../endpoints/types';
import type { EnvClass } from '../platform/env';
import { DependencyUnavailable } from '../ports';
import { festivalState, type FestivalStateDeps, type LeaseReader, type LeaseSnapshot } from '../scheduler/festival';
import type { MomentSource, RunStore } from '../scheduler/ports';
import { CLOCK_CONTROL_CLASSES, clockControlDepsOf, controlClock } from '../timekeeping/control';

const NO_STORE = { 'cache-control': 'no-store' };
const MAX_BODY_BYTES = 1024;

type Code = 'forbidden' | 'validation' | 'unavailable';
const STATUS: Record<Code, number> = { forbidden: 403, validation: 400, unavailable: 503 };
const fail = (code: Code) => Response.json({ ok: false, error: { code } }, { status: STATUS[code], headers: NO_STORE });

interface Exec {
  execute(query: ReturnType<typeof sql>): Promise<{ rows: Record<string, unknown>[] }>;
}

/** The readers never journal: only acquire/renew and finish do, and they are never called here. */
const READ_ONLY_JOURNAL: Journal = { append: () => Promise.reject(new Error('scheduler readers: read only')) };

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));

/** Read-only lease row by the DATABASE clock (like the lease store itself); never takes the lease. */
export function createPgLeaseReader(payload: () => Promise<Payload>, name: string = SCHEDULER_LEASE): LeaseReader {
  return {
    async read(): Promise<LeaseSnapshot | null> {
      try {
        const db = ((await payload()).db as unknown as { drizzle: Exec }).drizzle;
        const { rows } = await db.execute(sql`
          SELECT "holder", "epoch"::text AS "epoch",
            GREATEST(0, EXTRACT(EPOCH FROM ("expires_at" - clock_timestamp())) * 1000)::float8 AS "left_ms",
            GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - "renewed_at")) * 1000)::float8 AS "age_ms"
          FROM "scheduler_leases" WHERE "name" = ${name}`);
        const row = rows[0];
        if (!row) return null;
        const holder = typeof row.holder === 'string' && row.holder !== '' ? row.holder : null;
        return {
          holder,
          epoch: num(row.epoch),
          expiresInMs: Math.floor(num(row.left_ms)),
          renewedAgoMs: holder === null ? null : Math.floor(num(row.age_ms)),
        };
      } catch (err) {
        if (isDependencyFailure(err)) throw new DependencyUnavailable('postgres', { cause: err });
        throw err;
      }
    },
  };
}

/** What a reader of the scheduler state needs, over `payload` (the slice, the `clock` CLI). */
export interface SchedulerReaders {
  lease: LeaseReader;
  runs: Pick<RunStore, 'ledger' | 'missed24h'>;
  source: MomentSource;
}

export function schedulerReadersOf(deps: Deps, payload: () => Promise<Payload>): SchedulerReaders {
  return {
    lease: createPgLeaseReader(payload),
    runs: createPgScheduler({ payload, journal: READ_ONLY_JOURNAL }).runs,
    source: createPayloadMomentSource({ payload, catalog: catalogStoreOf(deps) }),
  };
}

/** The slice's deps of a process: its clock, scheduler and divergence meter, the stores over `payload`. */
export function festivalDepsOf(deps: Deps, payload: () => Promise<Payload>): FestivalStateDeps {
  const { lease, runs, source } = schedulerReadersOf(deps, payload);
  const shared = deps.sharedClock;
  return {
    clock: deps.clock,
    ...(shared ? { clockState: () => shared.state() } : {}),
    source,
    lease,
    runs,
    ...(deps.scheduler ? { scheduler: deps.scheduler } : {}),
    ...(deps.divergence ? { divergence: deps.divergence } : {}),
  };
}

/** Owner who passed the Access gate (or a server-side call carrying an owner user). */
const isOwner = (req: PayloadRequest) => passedGate(req) && roleOf(req.user) === 'owner';

/** The parsed C9 body, or `null` (wrong type, empty, over 1 KB, not JSON, not the strict schema). */
async function clockBodyOf(req: PayloadRequest) {
  if (!hasJsonContentType(req)) return null;
  try {
    const text = req.text ? await req.text() : '';
    if (text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return null;
    const parsed = ClockControlBodySchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function festivalStateEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/festival-state',
    method: 'get',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const deps = await resolve();
      const view = await festivalState(festivalDepsOf(deps, async () => req.payload));
      return Response.json({ ok: true, value: view }, { headers: NO_STORE });
    },
  };
}

function clockEndpoint(resolve: () => Promise<Deps>): Endpoint {
  return {
    path: '/clock',
    method: 'post',
    handler: async (req) => {
      if (!isOwner(req)) return fail('forbidden');
      const body = await clockBodyOf(req);
      if (body === null) return fail('validation');
      const control = clockControlDepsOf(await resolve());
      if (!control) return fail('forbidden');
      try {
        const result = await controlClock(control, 'owner', { ...resolveActor(req.user, req.context), kind: 'owner' }, body);
        if (!result.ok) return fail(result.code);
        const { now, speed, virtual, epoch } = result.value;
        const value: ClockControlValue = { now, speed, virtual, epoch };
        return Response.json({ ok: true, value }, { headers: NO_STORE });
      } catch {
        // The change is one transaction: a failed store wrote nothing.
        return fail('unavailable');
      }
    },
  };
}

/**
 * The root endpoints of class `cls`. `resolve` gives the process deps (tests may pass their own).
 * `POST /clock` exists only where clock control exists (`rehearsal`, `test`).
 */
export function cmsEndpointsFor(cls: EnvClass, resolve: () => Promise<Deps> = processDeps): Endpoint[] {
  const endpoints = [festivalStateEndpoint(resolve)];
  if (CLOCK_CONTROL_CLASSES.includes(cls)) endpoints.push(clockEndpoint(resolve));
  return endpoints;
}
