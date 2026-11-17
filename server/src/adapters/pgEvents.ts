/**
 * Postgres outbox of internal events (AC-40 … AC-42), ring 4.
 *
 * `publish`, on the caller's transaction connection (Payload: `req.transactionID` →
 * `payload.db.sessions[id].db`):
 * 1. `pg_advisory_xact_lock` on ONE key for the whole outbox: publishers are serialised until
 *    their transactions end, so outbox ids commit in id order and the readers' `id > lastSeen`
 *    cursor never skips a row that commits late (a per-topic lock would allow that);
 * 2. inserts the row; its serial `id` is the global order, `version` = max of the topic + 1;
 * 3. `pg_notify(channel, id)` — Postgres delivers it only on commit and drops it on rollback (AC-41).
 * The reader side is one dedicated `pg.Client` per process that `LISTEN`s (with an `error` handler
 * and reconnect), plus queries over Payload's pool.
 */
import { sql } from '@payloadcms/db-postgres';
import type { Payload, PayloadRequest } from 'payload';
import pg from 'pg';
import type { Clock } from '../ports';
import type { EventLog, EventPublisher, EventSource, InternalEvent, Tx } from '../events/ports';

type SqlQuery = ReturnType<typeof sql>;
interface Exec {
  execute(query: SqlQuery): Promise<{ rows: Record<string, unknown>[] }>;
}
interface DrizzleAdapter {
  sessions: Record<string, { db: Exec } | undefined>;
  drizzle: Exec & { transaction<T>(fn: (tx: Exec) => Promise<T>): Promise<T> };
}

const OUTBOX_LOCK = 't2f:internal-events';
const RECONNECT_MS = 1_000;

/** `t2f_<database>_events`, limited to identifier characters and 63 bytes. */
export function eventsChannel(databaseUri: string): string {
  let db = 'db';
  try {
    db = decodeURIComponent(new URL(databaseUri).pathname.replace(/^\//, '')) || db;
  } catch {
    /* keep the default */
  }
  return `t2f_${db.toLowerCase().replace(/[^a-z0-9_]/g, '_')}_events`.slice(0, 63);
}

function adapterOf(payload: Payload): DrizzleAdapter {
  return payload.db as unknown as DrizzleAdapter;
}

function toEvent(row: Record<string, unknown>): InternalEvent {
  const at = row.committed_at;
  return {
    id: String(row.id),
    topic: String(row.topic),
    version: Number(row.version),
    payload: row.payload ?? null,
    committedAt: at instanceof Date ? at.getTime() : Date.parse(String(at)),
  };
}

export function createPgEventPublisher(payload: () => Promise<Payload>, clock: Clock, channel: string): EventPublisher {
  return {
    async publish(tx: Tx, topic, body) {
      const db = adapterOf(await payload());
      const run = async (conn: Exec) => {
        await conn.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${OUTBOX_LOCK}))`);
        const inserted = await conn.execute(sql`
          INSERT INTO "internal_events" ("topic", "version", "payload", "committed_at")
          SELECT ${topic}, COALESCE(MAX("version"), 0) + 1, ${JSON.stringify(body ?? null)}::jsonb, ${new Date(clock.now()).toISOString()}
          FROM "internal_events" WHERE "topic" = ${topic}
          RETURNING "id", "version"`);
        const row = inserted.rows[0];
        if (!row) throw new Error('internal event: insert returned no row');
        await conn.execute(sql`SELECT pg_notify(${channel}, ${String(row.id)})`);
        return { version: Number(row.version) };
      };
      const id = (tx as Partial<PayloadRequest>).transactionID;
      const session = id ? db.sessions[String(await id)]?.db : undefined;
      // No open transaction: the event gets its own (atomic by itself, not with any other write).
      return session ? run(session) : db.drizzle.transaction(run);
    },
  };
}

export function createPgEventLog(payload: () => Promise<Payload>): EventLog {
  return {
    async latest(topic) {
      const { rows } = await adapterOf(await payload()).drizzle.execute(sql`
        SELECT "id", "topic", "version", "payload", "committed_at" FROM "internal_events"
        WHERE "topic" = ${topic} ORDER BY "version" DESC LIMIT 1`);
      return rows[0] ? toEvent(rows[0]) : null;
    },
  };
}

export interface PgEventSourceOptions {
  payload: () => Promise<Payload>;
  databaseUri: string;
  channel: string;
  onError: (err: unknown) => void;
}

export function createPgEventSource({ payload, databaseUri, channel, onError }: PgEventSourceOptions): EventSource {
  return {
    async maxId() {
      const { rows } = await adapterOf(await payload()).drizzle.execute(sql`SELECT COALESCE(MAX("id"), 0)::text AS "id" FROM "internal_events"`);
      return String(rows[0]?.id ?? '0');
    },
    async after(id, limit) {
      const { rows } = await adapterOf(await payload()).drizzle.execute(sql`
        SELECT "id", "topic", "version", "payload", "committed_at" FROM "internal_events"
        WHERE "id" > ${id}::bigint ORDER BY "id" LIMIT ${limit}`);
      return rows.map(toEvent);
    },
    watch(wake) {
      let client: pg.Client | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let stopped = false;
      const reconnect = () => {
        if (stopped || timer) return;
        timer = setTimeout(() => {
          timer = null;
          void connect();
        }, RECONNECT_MS);
        timer.unref?.();
      };
      const connect = async () => {
        const c = new pg.Client({ connectionString: databaseUri });
        client = c;
        c.on('error', (err) => {
          onError(err);
          void c.end().catch(() => {});
          reconnect();
        });
        c.on('notification', () => wake());
        try {
          await c.connect();
          await c.query(`LISTEN "${channel}"`);
          wake();
        } catch (err) {
          onError(err);
          void c.end().catch(() => {});
          reconnect();
        }
      };
      void connect();
      return async () => {
        stopped = true;
        if (timer) clearTimeout(timer);
        await client?.end().catch(() => {});
      };
    },
  };
}
