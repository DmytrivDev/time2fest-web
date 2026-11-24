/**
 * Postgres stores of operations (SPEC-13b [П-2], [П-3]), ring 4: the Telegram outbox (`alarm-deliveries`), the
 * `log`-alarm store (`log-alarms`) and the leases of the ops jobs. Raw SQL over Payload's pool (pattern
 * `pgAiSpend.ts`); Payload rows never leave this file.
 *
 * - `claimDue` is ONE conditional update (`FOR UPDATE SKIP LOCKED` on `status = 'pending'` and a due
 *   `next_attempt_at`) that pushes the claimed rows 30 s forward: two instances never claim one row, and a row
 *   claimed by a holder that crashed before marking it is retried after that (AC-3, AC-8).
 * - `markFailed` writes the journal row `ops.telegram-delivery-failed` in the same transaction (AC-5).
 * - Times are the caller's wall clock (`now` / `at` parameters, AC-22), so the `ops-tick` door can substitute it;
 *   the lease alone runs on the database clock (`createPgScheduler`).
 * Connection failures surface as `DependencyUnavailable('postgres')`.
 */
import { sql } from '@payloadcms/db-postgres';
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload';
import type { Payload, PayloadRequest } from 'payload';
import type { AlarmDetails, LogAlarmRecord, LogAlarmStore } from '../alarms/ports';
import type { Actor, Journal } from '../audit/ports';
import { isDependencyFailure } from '../endpoints/pipeline';
import type { OpsJournal, Outbox, OutboxKind, OutboxRow, OpsLease, OpsLeaseName, WallClock } from '../ops/ports';
import { DependencyUnavailable } from '../ports';
import { findKind } from '../registries/ops';
import { createPgScheduler } from './pgScheduler';

type SqlQuery = ReturnType<typeof sql>;
interface Exec {
  execute(query: SqlQuery): Promise<{ rows: Record<string, unknown>[] }>;
}
interface DrizzleAdapter {
  sessions: Record<string, { db: Exec } | undefined>;
  drizzle: Exec;
}

export const ALARM_DELIVERIES = 'alarm-deliveries';
export const DELIVERY_FAILED_ACTION = 'ops.telegram-delivery-failed';
/** How long a claim holds a row before another holder may take it (a crash between claim and mark). */
export const CLAIM_HOLD_MS = 30_000;
const CONTEXT = { t2fTrusted: true, t2fInternal: true };
const ACTOR: Actor = { kind: 'system', id: 'ops', label: 'ops' };
const MAX_CODE = 100;

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const tsMs = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const ms = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
};
const iso = (ms: number) => new Date(ms).toISOString();

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isDependencyFailure(err)) throw new DependencyUnavailable('postgres', { cause: err });
    throw err;
  }
}

function detailsOf(v: unknown): AlarmDetails | undefined {
  if (v === null || v === undefined) return undefined;
  const raw = typeof v === 'string' ? (JSON.parse(v) as unknown) : v;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof val === 'number' || typeof val === 'string') out[k] = val;
  }
  return out;
}

const KINDS: readonly OutboxKind[] = ['alarm', 'digest', 'heartbeat', 'storm-summary'];

function toRow(r: Record<string, unknown>): OutboxRow {
  const kind = (KINDS as readonly string[]).includes(String(r.kind)) ? (String(r.kind) as OutboxKind) : 'alarm';
  const createdAt = tsMs(r.raised_at) ?? 0;
  const row: OutboxRow = {
    id: String(r.id),
    kind,
    text: String(r.text ?? ''),
    chatId: '',
    createdAt,
    status: r.status === 'delivered' || r.status === 'failed' ? r.status : 'pending',
    attempts: num(r.attempts),
    nextAttemptAt: tsMs(r.next_attempt_at) ?? createdAt,
    deliveredAt: tsMs(r.delivered_at),
    failedAt: tsMs(r.failed_at),
    repeatCount: num(r.repeat_count),
  };
  if (kind === 'alarm' && typeof r.source === 'string' && typeof r.code === 'string') {
    row.alarm = { source: r.source, code: r.code, level: 'page' };
  }
  const details = detailsOf(r.details);
  if (details) row.details = details;
  if (typeof r.slot_key === 'string') row.slotKey = r.slot_key;
  return row;
}

const COLUMNS = sql.raw(
  '"id", "kind", "slot_key", "source", "code", "text", "details", "status", "attempts", "next_attempt_at", "delivered_at", "failed_at", "repeat_count", "raised_at"',
);

/** Runs `fn` in one Payload-opened transaction on its Postgres session (pattern `pgScheduler.ts`). */
async function inTransaction<T>(getPayload: () => Promise<Payload>, fn: (db: Exec, req: PayloadRequest) => Promise<T>): Promise<T> {
  return guard(async () => {
    const req = await createLocalReq({ context: CONTEXT }, await getPayload());
    await initTransaction(req);
    try {
      const id = req.transactionID ? await req.transactionID : undefined;
      const session = id !== undefined ? (req.payload.db as unknown as DrizzleAdapter).sessions[String(id)]?.db : undefined;
      if (!session) throw new Error('ops outbox: no open transaction');
      const out = await fn(session, req);
      await commitTransaction(req);
      return out;
    } catch (err) {
      await killTransaction(req).catch(() => {});
      throw err;
    }
  });
}

export interface PayloadOutboxOptions {
  payload: () => Promise<Payload>;
  /** Journal of final delivery failures (AC-5). */
  journal: Journal;
}

/** The Telegram outbox over `alarm_deliveries` ([П-3]). The chat id is not stored: the sender adds it. */
export function createPayloadOutbox({ payload, journal }: PayloadOutboxOptions): Outbox {
  const db = async (): Promise<Exec> => ((await payload()).db as unknown as DrizzleAdapter).drizzle;
  const exec = (q: SqlQuery) => guard(async () => (await db()).execute(q));

  return {
    async insert(row) {
      const alarm = row.alarm;
      const domain = alarm ? (findKind(alarm.source, alarm.code)?.domain.domain ?? null) : null;
      const first = row.notBefore ?? row.createdAt;
      const { rows } = await exec(sql`
        INSERT INTO "alarm_deliveries"
          ("kind", "slot_key", "source", "code", "level", "domain", "text", "details", "status", "attempts",
           "next_attempt_at", "repeat_count", "raised_at", "updated_at", "created_at")
        VALUES (${row.kind}, ${row.slotKey ?? null}, ${alarm ? alarm.source.slice(0, MAX_CODE) : null},
          ${alarm ? alarm.code.slice(0, MAX_CODE) : null}, ${alarm ? alarm.level : null}, ${domain}, ${row.text},
          ${row.details ? JSON.stringify(row.details) : null}::jsonb, 'pending', 0, ${iso(first)}::timestamptz, 0,
          ${iso(row.createdAt)}::timestamptz, now(), now())
        ON CONFLICT ("slot_key") DO NOTHING
        RETURNING "id"`);
      const id = rows[0]?.id;
      return id === undefined ? 'duplicate-slot' : { id: String(id) };
    },

    async claimDue(limit, now, kinds) {
      if (limit <= 0) return [];
      const only = kinds && kinds.length > 0 ? sql`AND "kind" IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})` : sql``;
      const { rows } = await exec(sql`
        UPDATE "alarm_deliveries" SET "next_attempt_at" = ${iso(now + CLAIM_HOLD_MS)}::timestamptz, "updated_at" = now()
        WHERE "id" IN (
          SELECT "id" FROM "alarm_deliveries"
          WHERE "status" = 'pending' AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${iso(now)}::timestamptz) ${only}
          ORDER BY "raised_at", "id"
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED)
        AND "status" = 'pending'
        RETURNING ${COLUMNS}`);
      return rows.map(toRow).sort((a, b) => a.createdAt - b.createdAt || Number(a.id) - Number(b.id));
    },

    async markDelivered(id, at, status) {
      await exec(sql`
        UPDATE "alarm_deliveries" SET "status" = 'delivered', "delivered_at" = ${iso(at)}::timestamptz,
          "attempts" = "attempts" + 1, "last_status" = ${status ?? null}, "updated_at" = now()
        WHERE "id" = ${Number(id)} AND "status" = 'pending'`);
    },

    async markRetry(id, nextAt, status) {
      await exec(sql`
        UPDATE "alarm_deliveries" SET "next_attempt_at" = ${iso(nextAt)}::timestamptz, "attempts" = "attempts" + 1,
          "last_status" = ${status ?? null}, "updated_at" = now()
        WHERE "id" = ${Number(id)} AND "status" = 'pending'`);
    },

    async markFailed(id, at, status) {
      await inTransaction(payload, async (tx, req) => {
        const updated = (
          await tx.execute(sql`
            UPDATE "alarm_deliveries" SET "status" = 'failed', "failed_at" = ${iso(at)}::timestamptz,
              "attempts" = "attempts" + 1, "last_status" = ${status ?? null}, "updated_at" = now()
            WHERE "id" = ${Number(id)} AND "status" = 'pending'
            RETURNING "id", "kind", "source", "code", "attempts"`)
        ).rows[0];
        if (!updated) return;
        await journal.append(req, {
          actor: ACTOR,
          action: DELIVERY_FAILED_ACTION,
          target: { collection: ALARM_DELIVERIES, id: String(updated.id) },
          at,
          before: { status: 'pending' },
          after: {
            status: 'failed',
            kind: String(updated.kind),
            ...(typeof updated.source === 'string' ? { source: updated.source, code: String(updated.code) } : {}),
            attempts: num(updated.attempts),
            ...(status !== undefined ? { httpStatus: status } : {}),
          },
          revertOf: null,
        });
      });
    },

    async latestDeliveredOfKind(kind, sinceMs) {
      const { rows } = await exec(sql`
        SELECT ${COLUMNS} FROM "alarm_deliveries"
        WHERE "kind" = 'alarm' AND "status" = 'delivered' AND "source" = ${kind.source} AND "code" = ${kind.code}
          AND "delivered_at" >= ${iso(sinceMs)}::timestamptz
        ORDER BY "delivered_at" DESC, "id" DESC LIMIT 1`);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async pendingOfKind(kind) {
      const { rows } = await exec(sql`
        SELECT ${COLUMNS} FROM "alarm_deliveries"
        WHERE "kind" = 'alarm' AND "status" = 'pending' AND "source" = ${kind.source} AND "code" = ${kind.code}
        ORDER BY "raised_at" DESC, "id" DESC LIMIT 1`);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async incrementRepeat(id, by = 1) {
      await exec(sql`
        UPDATE "alarm_deliveries" SET "repeat_count" = "repeat_count" + ${Math.max(1, Math.floor(by))}, "updated_at" = now()
        WHERE "id" = ${Number(id)}`);
    },

    async countSent(sinceMs, untilMs) {
      const { rows } = await exec(sql`
        SELECT count(*)::int AS "n" FROM "alarm_deliveries"
        WHERE "kind" = 'alarm' AND "status" = 'delivered' AND "attempts" > 0 AND "delivered_at" >= ${iso(sinceMs)}::timestamptz
          AND "delivered_at" <= ${iso(untilMs)}::timestamptz`);
      return num(rows[0]?.n);
    },

    async markSummarized(ids, at) {
      if (ids.length === 0) return;
      await exec(sql`
        UPDATE "alarm_deliveries" SET "status" = 'delivered', "delivered_at" = ${iso(at)}::timestamptz, "updated_at" = now()
        WHERE "id" IN (${sql.join(ids.map((id) => sql`${Number(id)}`), sql`, `)}) AND "status" = 'pending' AND "attempts" = 0`);
    },

    async listSummarized(fromMs, toMs) {
      const { rows } = await exec(sql`
        SELECT ${COLUMNS} FROM "alarm_deliveries"
        WHERE "kind" = 'alarm' AND "status" = 'delivered' AND "attempts" = 0
          AND "delivered_at" >= ${iso(fromMs)}::timestamptz AND "delivered_at" < ${iso(toMs)}::timestamptz
        ORDER BY "raised_at", "id"`);
      return rows.map(toRow);
    },

    async setText(id, text) {
      await exec(sql`
        UPDATE "alarm_deliveries" SET "text" = ${text}, "updated_at" = now() WHERE "id" = ${Number(id)} AND "status" = 'pending'`);
    },

    async hasSlot(slotKey) {
      const { rows } = await exec(sql`SELECT 1 AS "one" FROM "alarm_deliveries" WHERE "slot_key" = ${slotKey} LIMIT 1`);
      return rows.length > 0;
    },
  };
}

/** `log` alarms over `log_alarms` (AC-12): `raisedAt` from the wall clock. */
export function createPayloadLogAlarms(payload: () => Promise<Payload>, clock: WallClock): LogAlarmStore {
  const exec = (q: SqlQuery) => guard(async () => ((await payload()).db as unknown as DrizzleAdapter).drizzle.execute(q));
  return {
    async insert({ source, code, details }) {
      const domain = findKind(source, code)?.domain.domain ?? null;
      const { rows } = await exec(sql`
        INSERT INTO "log_alarms" ("source", "code", "domain", "details", "raised_at", "updated_at", "created_at")
        VALUES (${source.slice(0, MAX_CODE)}, ${code.slice(0, MAX_CODE)}, ${domain},
          ${details ? JSON.stringify(details) : null}::jsonb, ${iso(clock.now())}::timestamptz, now(), now())
        RETURNING "id"`);
      return { id: String(rows[0]?.id) };
    },
    async listLog(sinceMs) {
      const { rows } = await exec(sql`
        SELECT "id", "source", "code", "details", "raised_at" FROM "log_alarms"
        WHERE "raised_at" >= ${iso(sinceMs)}::timestamptz ORDER BY "raised_at" DESC, "id" DESC`);
      return rows.map(
        (r): LogAlarmRecord => ({
          id: String(r.id),
          source: String(r.source),
          code: String(r.code),
          details: detailsOf(r.details) ?? null,
          raisedAt: tsMs(r.raised_at) ?? 0,
        }),
      );
    },
    async pruneLog(beforeMs) {
      const { rows } = await exec(sql`
        DELETE FROM "log_alarms" WHERE "raised_at" < ${iso(beforeMs)}::timestamptz RETURNING "id"`);
      return rows.length;
    },
  };
}

/** Journal lines of the ops jobs (AC-21: a skipped heartbeat or digest slot); target = the outbox slot. */
export function createPayloadOpsJournal({ payload, journal }: { payload: () => Promise<Payload>; journal: Journal }): OpsJournal {
  return {
    async line(action, targetId, after, at) {
      await guard(async () => {
        const req = await createLocalReq({ context: CONTEXT }, await payload());
        await journal.append(req, { actor: ACTOR, action, target: { collection: ALARM_DELIVERIES, id: targetId }, at, before: null, after, revertOf: null });
      });
    },
  };
}

export interface PgOpsLeaseOptions {
  payload: () => Promise<Payload>;
  /** Journal of lease takeovers (the scheduler store journals each epoch change). */
  journal: Journal;
  /** This process: host, pid and a random part. */
  holderId: string;
}

/** The ops leases over the scheduler lease table ([П-2], copy of `createPgLiveLease`): one row per name. */
export function createPgOpsLease(opts: PgOpsLeaseOptions): OpsLease {
  const stores = new Map<string, ReturnType<typeof createPgScheduler>['lease']>();
  const epochs = new Map<OpsLeaseName, number>();
  const lastTtl = new Map<OpsLeaseName, number>();
  const leaseOf = (name: OpsLeaseName, ttlMs: number) => {
    const key = `${name}:${ttlMs}`;
    let lease = stores.get(key);
    if (!lease) {
      lease = createPgScheduler({ payload: opts.payload, journal: opts.journal, name, termMs: ttlMs }).lease;
      stores.set(key, lease);
    }
    return lease;
  };
  return {
    async acquire(name, ttlMs) {
      const grant = await leaseOf(name, ttlMs).acquireOrRenew(opts.holderId);
      lastTtl.set(name, ttlMs);
      if (grant.held) epochs.set(name, grant.epoch);
      else epochs.delete(name);
      return grant.held;
    },
    async release(name) {
      const epoch = epochs.get(name);
      const ttl = lastTtl.get(name);
      if (epoch === undefined || ttl === undefined) return;
      await leaseOf(name, ttl).release?.(opts.holderId, epoch);
      epochs.delete(name);
    },
  };
}
