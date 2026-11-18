/**
 * Postgres lease and run store of the moment scheduler (SPEC-07 AC-26, AC-27, AC-29, AC-37, AC-42,
 * AC-44, AC-45, AC-48, NFR-7, C6), ring 4. Raw SQL over Payload's pool, on a local `req` whose
 * transaction is opened by Payload (like `payloadClockState.ts`), so a journal row joins the same
 * transaction as the write it records.
 *
 * - Time of the lease is the DATABASE clock only (`clock_timestamp()`): the term (6 s) and the
 *   expiry check never read the process clock nor the virtual server time.
 * - `acquireOrRenew` locks the lease row (`FOR UPDATE`): renews it when this holder still holds it,
 *   takes it with `epoch + 1` when it expired (any holder, also itself), else answers "not held".
 *   Every epoch change appends one journal row `scheduler.takeover` (previous and new holder, epoch,
 *   time by the database) in the same transaction (AC-48).
 * - `claim` and `finish` (also batched: several groups, one transaction) first lock the lease row `FOR SHARE` WHERE holder, epoch and expiry still
 *   match, IN THE SAME TRANSACTION as their write (fencing, AC-45): a takeover in progress makes them
 *   wait, then the re-checked row no longer matches → `stale`, nothing written.
 * - A settled pair (`done`, `skipped`, `failed`) is never overwritten (upsert `WHERE status = 'started'`).
 * Connection failures surface as `DependencyUnavailable('postgres')`. Payload rows never leave.
 */
import { sql } from '@payloadcms/db-postgres';
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload';
import type { Payload, PayloadRequest } from 'payload';
import type { Actor, Journal } from '../audit/ports';
import { pairKey } from '../domain/scheduler/consequence';
import { LEASE_TERM_MS } from '../domain/scheduler/lease';
import { isDependencyFailure } from '../endpoints/pipeline';
import { DependencyUnavailable } from '../ports';
import type { ClaimInput, ClaimResult, FinishInput, LeaseGrant, LeaseStore, RunLedger, RunStore } from '../scheduler/ports';

type SqlQuery = ReturnType<typeof sql>;
interface Exec {
  execute(query: SqlQuery): Promise<{ rows: Record<string, unknown>[] }>;
}
interface DrizzleAdapter {
  sessions: Record<string, { db: Exec } | undefined>;
  drizzle: Exec;
}

/** The name of THE scheduler lease row (one per database). */
export const SCHEDULER_LEASE = 'scheduler';
export const TAKEOVER_ACTION = 'scheduler.takeover';
export const SKIP_ACTION = 'scheduler.skip';
export const FAIL_ACTION = 'scheduler.fail';

const LEASES = 'scheduler-leases';
const RUNS = 'scheduler-runs';
const CONTEXT = { t2fTrusted: true, t2fInternal: true };
const ACTOR: Actor = { kind: 'system', id: 'scheduler', label: 'scheduler' };
const DAY_MS = 86_400_000;

export interface PgSchedulerOptions {
  payload: () => Promise<Payload>;
  /** Journal of takeovers, skips and failures (NFR-7). */
  journal: Journal;
  /** Lease row name; tests use their own so they never meet a running scheduler. */
  name?: string;
  /** Term granted per acquire/renew; default `LEASE_TERM_MS`. */
  termMs?: number;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v));
const tsMs = (v: unknown): number => (v instanceof Date ? v.getTime() : Date.parse(String(v)));

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isDependencyFailure(err)) throw new DependencyUnavailable('postgres', { cause: err });
    throw err;
  }
}

/** Runs `fn` in one Payload-opened transaction on its Postgres session; any throw rolls it back. */
async function inTransaction<T>(getPayload: () => Promise<Payload>, fn: (db: Exec, req: PayloadRequest) => Promise<T>): Promise<T> {
  return guard(async () => {
    const req = await createLocalReq({ context: CONTEXT }, await getPayload());
    await initTransaction(req);
    try {
      const id = req.transactionID ? await req.transactionID : undefined;
      const session = id !== undefined ? (req.payload.db as unknown as DrizzleAdapter).sessions[String(id)]?.db : undefined;
      if (!session) throw new Error('scheduler store: no open transaction');
      const out = await fn(session, req);
      await commitTransaction(req);
      return out;
    } catch (err) {
      await killTransaction(req).catch(() => {});
      throw err;
    }
  });
}

/** Fencing check (AC-45): the row of a lease still held by `holder` at `epoch`, locked for the transaction. */
function fence(db: Exec, name: string, holder: string, epoch: number) {
  return db.execute(sql`
    SELECT 1 FROM "scheduler_leases"
    WHERE "name" = ${name} AND "holder" = ${holder} AND "epoch" = ${epoch}::numeric AND "expires_at" > clock_timestamp()
    FOR SHARE`);
}

export interface PgScheduler {
  lease: LeaseStore;
  runs: RunStore;
}

export function createPgScheduler({ payload, journal, name = SCHEDULER_LEASE, termMs = LEASE_TERM_MS }: PgSchedulerOptions): PgScheduler {
  /** Remaining term of the lease row by the database clock, ms. */
  const leftOf = sql`GREATEST(0, EXTRACT(EPOCH FROM ("expires_at" - clock_timestamp())) * 1000)::float8`;
  const standby = (row: Record<string, unknown>): LeaseGrant => ({ held: false, epoch: num(row.epoch), expiresInMs: 0, freeInMs: Math.max(0, Math.ceil(num(row.left_ms))) });

  const lease: LeaseStore = {
    async acquireOrRenew(holder) {
      // A standby looks without a lock or a transaction, so it never holds up the renew of the
      // holder. Only a free (expired) lease or its own one is decided under `FOR UPDATE` below.
      const peek = await guard(async () => {
        const db = (await payload()).db as unknown as DrizzleAdapter;
        return (
          await db.drizzle.execute(sql`
            SELECT "holder", "epoch"::text AS "epoch", ("expires_at" <= clock_timestamp()) AS "expired", ${leftOf} AS "left_ms"
            FROM "scheduler_leases" WHERE "name" = ${name}`)
        ).rows[0];
      });
      if (peek && peek.expired !== true && String(peek.holder ?? '') !== holder) return standby(peek);
      return inTransaction(payload, async (db, req): Promise<LeaseGrant> => {
        await db.execute(sql`
          INSERT INTO "scheduler_leases" ("name", "holder", "epoch", "expires_at", "renewed_at")
          VALUES (${name}, '', 0, to_timestamp(0), clock_timestamp())
          ON CONFLICT ("name") DO NOTHING`);
        const current = (
          await db.execute(sql`
            SELECT "holder", "epoch"::text AS "epoch", ("expires_at" <= clock_timestamp()) AS "expired", ${leftOf} AS "left_ms"
            FROM "scheduler_leases" WHERE "name" = ${name} FOR UPDATE`)
        ).rows[0];
        if (!current) throw new Error('scheduler lease: row missing');
        const prevHolder = String(current.holder ?? '');
        const prevEpoch = num(current.epoch);
        const expired = current.expired === true;
        // Re-checked under the lock: another holder took it meanwhile. The standby learns when the
        // term ends, so it tries again right then (AC-44).
        if (!expired && prevHolder !== holder) return standby(current);

        const takeover = expired;
        const updated = (
          await db.execute(sql`
            UPDATE "scheduler_leases" SET
              "holder" = ${holder},
              "epoch" = CASE WHEN ${takeover}::boolean THEN "epoch" + 1 ELSE "epoch" END,
              "expires_at" = clock_timestamp() + (${termMs}::int * interval '1 millisecond'),
              "renewed_at" = clock_timestamp(),
              "updated_at" = clock_timestamp()
            WHERE "name" = ${name}
            RETURNING "epoch"::text AS "epoch", "renewed_at",
              GREATEST(0, EXTRACT(EPOCH FROM ("expires_at" - clock_timestamp())) * 1000)::float8 AS "left_ms"`)
        ).rows[0];
        if (!updated) throw new Error('scheduler lease: update returned no row');
        const epoch = num(updated.epoch);
        const grant: LeaseGrant = { held: true, epoch, expiresInMs: Math.max(0, Math.floor(num(updated.left_ms))) };
        if (!takeover) return grant;
        await journal.append(req, {
          actor: ACTOR,
          action: TAKEOVER_ACTION,
          target: { collection: LEASES, id: name },
          at: tsMs(updated.renewed_at),
          before: { holder: prevHolder || null, epoch: prevEpoch },
          after: { holder, epoch },
          revertOf: null,
        });
        return prevHolder ? { ...grant, previousHolder: prevHolder } : grant;
      });
    },
    async release(holder, epoch) {
      await guard(async () => {
        const db = (await payload()).db as unknown as DrizzleAdapter;
        await db.drizzle.execute(sql`
          UPDATE "scheduler_leases" SET "expires_at" = clock_timestamp() - interval '1 millisecond', "updated_at" = clock_timestamp()
          WHERE "name" = ${name} AND "holder" = ${holder} AND "epoch" = ${epoch}::numeric`);
      });
    },
  };

  /** The `started` rows of one claim (never over a settled pair): `claimed` when at least one row was written. */
  async function claimRows(db: Exec, input: ClaimInput): Promise<ClaimResult> {
    const written = await db.execute(sql`
      INSERT INTO "scheduler_runs" ("run_epoch", "action", "moment_key", "status", "consequence_id", "lease_epoch", "planned_at", "started_at")
      SELECT ${input.runEpoch}::numeric, ${input.action}, k, 'started'::"enum_scheduler_runs_status", ${input.consequenceId},
             ${input.leaseEpoch}::numeric, ${input.plannedAt}::numeric, ${input.startedAt}::numeric
      FROM jsonb_array_elements_text(${JSON.stringify(input.keys)}::jsonb) AS k
      ON CONFLICT ("run_epoch", "action", "moment_key") DO UPDATE SET
        "consequence_id" = EXCLUDED."consequence_id",
        "lease_epoch" = EXCLUDED."lease_epoch",
        "planned_at" = EXCLUDED."planned_at",
        "started_at" = EXCLUDED."started_at",
        "updated_at" = now()
      WHERE "scheduler_runs"."status" = 'started'
      RETURNING "moment_key"`);
    return written.rows.length > 0 ? 'claimed' : 'done';
  }

  /** The final status of one group (creates never-claimed rows; a settled pair is never overwritten). */
  async function finishRows(db: Exec, req: PayloadRequest, input: FinishInput): Promise<void> {
    const written = await db.execute(sql`
      INSERT INTO "scheduler_runs" ("run_epoch", "action", "moment_key", "status", "reason", "consequence_id", "lease_epoch", "planned_at", "finished_at")
      SELECT ${input.runEpoch}::numeric, ${input.action}, k, ${input.status}::"enum_scheduler_runs_status", ${input.reason ?? null},
             ${input.consequenceId ?? null}, ${input.leaseEpoch}::numeric, ${input.plannedAt}::numeric, ${input.finishedAt}::numeric
      FROM jsonb_array_elements_text(${JSON.stringify(input.keys)}::jsonb) AS k
      ON CONFLICT ("run_epoch", "action", "moment_key") DO UPDATE SET
        "status" = EXCLUDED."status",
        "reason" = EXCLUDED."reason",
        "consequence_id" = COALESCE(EXCLUDED."consequence_id", "scheduler_runs"."consequence_id"),
        "lease_epoch" = EXCLUDED."lease_epoch",
        "finished_at" = EXCLUDED."finished_at",
        "updated_at" = now()
      WHERE "scheduler_runs"."status" = 'started'
      RETURNING "moment_key"`);
    if (input.status === 'done' || written.rows.length === 0) return;
    // NFR-7, AC-34, AC-40: one journal row per skipped/failed group, in the same transaction.
    await journal.append(req, {
      actor: ACTOR,
      action: input.status === 'skipped' ? SKIP_ACTION : FAIL_ACTION,
      target: { collection: RUNS, id: `${input.runEpoch}:${input.action}` },
      at: input.finishedAt,
      before: null,
      after: {
        action: input.action,
        runEpoch: input.runEpoch,
        keys: written.rows.map((r) => String(r.moment_key)),
        status: input.status,
        reason: input.reason ?? null,
        plannedAt: input.plannedAt,
        lateMs: Math.max(0, input.finishedAt - input.plannedAt),
        consequenceId: input.consequenceId ?? null,
      },
      revertOf: null,
    });
  }

  /** All inputs of one batch share one holder and lease epoch: checked once, so one fence covers them. */
  function batchOwner(inputs: readonly { holder: string; leaseEpoch: number }[]): { holder: string; leaseEpoch: number } {
    const first = inputs[0];
    if (!first) throw new Error('scheduler store: empty batch');
    if (inputs.some((i) => i.holder !== first.holder || i.leaseEpoch !== first.leaseEpoch)) throw new Error('scheduler store: one batch, one holder and lease epoch');
    return first;
  }

  const runs: RunStore = {
    async claim(input: ClaimInput) {
      const r = await runs.claimGroups([input]);
      return r === 'stale' ? 'stale' : (r[0] ?? 'done');
    },
    finish(input: FinishInput) {
      return runs.finishGroups([input]);
    },
    async claimGroups(inputs) {
      if (inputs.length === 0) return [];
      const owner = batchOwner(inputs);
      return inTransaction(payload, async (db): Promise<'stale' | ClaimResult[]> => {
        if ((await fence(db, name, owner.holder, owner.leaseEpoch)).rows.length === 0) return 'stale';
        const out: ClaimResult[] = [];
        for (const input of inputs) out.push(await claimRows(db, input));
        return out;
      });
    },
    async finishGroups(inputs) {
      if (inputs.length === 0) return 'finished';
      const owner = batchOwner(inputs);
      return inTransaction(payload, async (db, req): Promise<'finished' | 'stale'> => {
        if ((await fence(db, name, owner.holder, owner.leaseEpoch)).rows.length === 0) return 'stale';
        for (const input of inputs) await finishRows(db, req, input);
        return 'finished';
      });
    },
    ledger(runEpoch) {
      return guard(async (): Promise<RunLedger> => {
        const db = (await payload()).db as unknown as DrizzleAdapter;
        const { rows } = await db.drizzle.execute(sql`
          SELECT "action", "moment_key", "status", "consequence_id" FROM "scheduler_runs" WHERE "run_epoch" = ${runEpoch}::numeric`);
        const settled = new Set<string>();
        const started = new Map<string, string>();
        for (const r of rows) {
          const key = pairKey(String(r.action), String(r.moment_key));
          if (r.status === 'started') {
            if (typeof r.consequence_id === 'string') started.set(key, r.consequence_id);
          } else settled.add(key);
        }
        return { settled, started };
      });
    },
    missed24h(serverNow) {
      return guard(async () => {
        const db = (await payload()).db as unknown as DrizzleAdapter;
        const { rows } = await db.drizzle.execute(sql`
          SELECT count(*) FILTER (WHERE "status" = 'skipped')::int AS "skipped", count(*) FILTER (WHERE "status" = 'failed')::int AS "failed"
          FROM "scheduler_runs"
          WHERE "status" IN ('skipped', 'failed') AND "finished_at" > ${serverNow - DAY_MS}::numeric AND "finished_at" <= ${serverNow}::numeric`);
        return { skipped: num(rows[0]?.skipped ?? 0), failed: num(rows[0]?.failed ?? 0) };
      });
    },
  };

  return { lease, runs };
}
