/**
 * Postgres adapters of the live air (SPEC-12 AC-5, AC-31, AC-35, AC-43, [П-5]), ring 4: the `stream-sources` rows,
 * the `live-state` global, the `live-quota` counters and the two live leases.
 *
 * - Writes of the live state run on the caller's transaction connection (Payload: `req.transactionID`) and first take
 *   a transaction-scoped advisory lock (the global's row does not exist before its first write), so concurrent
 *   changes commit distinct, increasing versions: `UPDATE … SET version = version + 1 … RETURNING`.
 * - Quota counters: every write is ONE statement (`INSERT … ON CONFLICT (day, bucket) DO UPDATE … RETURNING`), so a
 *   call from any instance is counted once.
 * - The leases are rows of the scheduler lease table (`pgScheduler.ts`), named `live-poller` / `live-viewers`.
 * Payload rows never leave this module: callers get `LiveSource`, `LiveStateRecord`, `QuotaState`.
 */
import { sql } from '@payloadcms/db-postgres';
import { commitTransaction, createLocalReq, initTransaction, killTransaction } from 'payload';
import type { Payload, PayloadRequest } from 'payload';
import type { Journal } from '../audit/ports';
import { SOURCE_OVERRIDES, SOURCE_PLATFORMS, type SourceOverride, type SourcePlatform, type ZoneLive } from '../domain/live/chain';
import type { QuotaBucket } from '../domain/live/config';
import { QUOTA_COUNTER_KEYS, type QuotaCounter, type QuotaCounterKey, type QuotaState } from '../domain/live/quota';
import type { Clock } from '../ports';
import type {
  ImportedSource,
  LiveFanOutClaim,
  LiveImportStore,
  LiveLease,
  LiveLeaseName,
  LiveSource,
  LiveStateRecord,
  LiveStore,
  NewSource,
  PendingCheck,
  QuotaStore,
  SourceCheck,
  SourceEdit,
  Tx,
} from '../live/ports';
import { createPgNamedLease } from './pgScheduler';

const CONTEXT = { t2fTrusted: true, t2fInternal: true };
const LOCK_KEY = 't2f:live-state';

type SqlQuery = ReturnType<typeof sql>;
interface Exec {
  execute(query: SqlQuery): Promise<{ rows: Record<string, unknown>[] }>;
}
interface DrizzleAdapter {
  sessions: Record<string, { db: Exec } | undefined>;
  drizzle: Exec;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
function ms(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
const iso = (t: number | null | undefined): string | null => (t === null || t === undefined ? null : new Date(t).toISOString());
/** A YouTube time text → ISO for a timestamp column; unreadable → `null`. */
const isoText = (v: string | null | undefined): string | null => iso(v ? ms(v) : null);

async function drizzleOf(payload: () => Promise<Payload>): Promise<Exec> {
  return ((await payload()).db as unknown as DrizzleAdapter).drizzle;
}

async function sessionOf(tx: Tx): Promise<Exec> {
  const req = tx as PayloadRequest;
  const db = req.payload.db as unknown as DrizzleAdapter;
  const id = req.transactionID;
  const session = id ? db.sessions[String(await id)]?.db : undefined;
  if (!session) throw new Error('live-state: a write needs an open transaction');
  return session;
}

/** The live lock until the transaction ends, and the row (created with the column defaults when missing). */
async function lockRow(conn: Exec): Promise<void> {
  await conn.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);
  await conn.execute(sql`
    INSERT INTO "live_state" ("version", "last_fanned_out", "updated_at", "created_at")
    SELECT 1, 0, clock_timestamp(), clock_timestamp()
    WHERE NOT EXISTS (SELECT 1 FROM "live_state")`);
}

const FIRST_ROW = sql`(SELECT "id" FROM "live_state" ORDER BY "id" LIMIT 1)`;
const STATE_COLUMNS = sql`"version"::text AS "version", "at", "last_fanned_out"::text AS "last_fanned_out", "zone_live", "pending_checks"`;

function toZoneLive(v: unknown): ZoneLive {
  if (!isRecord(v)) return {};
  const out: Record<string, { until: number }> = {};
  for (const [zone, entry] of Object.entries(v)) {
    const until = isRecord(entry) ? Number(entry.until) : NaN;
    if (Number.isFinite(until)) out[zone] = { until };
  }
  return out;
}

function toPending(v: unknown): PendingCheck[] {
  if (!Array.isArray(v)) return [];
  const out: PendingCheck[] = [];
  for (const p of v) if (isRecord(p) && typeof p.sourceId === 'string' && Number.isFinite(Number(p.at))) out.push({ sourceId: p.sourceId, at: Number(p.at) });
  return out;
}

function toState(row: Record<string, unknown> | undefined): LiveStateRecord {
  if (!row) return { version: 1, at: null, lastFannedOut: 0, zoneLive: {}, pendingChecks: [] };
  return {
    version: Number(row.version) || 1,
    at: ms(row.at),
    lastFannedOut: Number(row.last_fanned_out) || 0,
    zoneLive: toZoneLive(row.zone_live),
    pendingChecks: toPending(row.pending_checks),
  };
}

const SOURCE_COLUMNS = sql`"source_id", "event_id", "platform", "video_id", "kind", "label", "name", "order"::text AS "order", "starts_at",
  "status", "embeddable", "privacy_status", "yt_fetched_at", "last_checked", "next_off_window_check_at", "override", "hidden",
  "dead", "dead_reason", "long_news"`;

const PLATFORMS: ReadonlySet<string> = new Set(SOURCE_PLATFORMS);
const OVERRIDES: ReadonlySet<string> = new Set(SOURCE_OVERRIDES);

function toSource(row: Record<string, unknown>): LiveSource {
  const platform = String(row.platform);
  const override = str(row.override);
  return {
    sourceId: String(row.source_id),
    eventId: String(row.event_id),
    platform: (PLATFORMS.has(platform) ? platform : 'none') as SourcePlatform,
    videoId: str(row.video_id),
    kind: str(row.kind),
    label: str(row.label),
    name: str(row.name),
    order: Number(row.order) || 0,
    startsAt: ms(row.starts_at),
    status: str(row.status),
    embeddable: bool(row.embeddable),
    privacyStatus: str(row.privacy_status),
    ytFetchedAt: ms(row.yt_fetched_at),
    lastChecked: ms(row.last_checked),
    nextOffWindowCheckAt: ms(row.next_off_window_check_at),
    override: override && OVERRIDES.has(override) ? (override as SourceOverride) : null,
    hidden: row.hidden === true,
    dead: row.dead === true,
    deadReason: str(row.dead_reason),
    longNews: row.long_news === true,
  };
}

const textList = (values: readonly string[]) =>
  sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );

/** The SET list of one check: YouTube fields (or their clearing), the verdict, the check times. */
function setsOf(check: SourceCheck, nowIso: string): SqlQuery {
  const sets: SqlQuery[] = [];
  if (check.youtube === null) {
    sets.push(sql`"live_broadcast_content" = NULL, "privacy_status" = NULL, "embeddable" = NULL, "scheduled_start_time" = NULL,
      "actual_start_time" = NULL, "actual_end_time" = NULL, "yt_fetched_at" = NULL`);
  } else {
    const f = check.youtube.fields;
    sets.push(sql`"live_broadcast_content" = ${f.liveBroadcastContent ?? null}, "privacy_status" = ${f.privacyStatus ?? null},
      "embeddable" = ${f.embeddable ?? null}::boolean, "scheduled_start_time" = ${isoText(f.scheduledStartTime)}::timestamptz,
      "actual_start_time" = ${isoText(f.actualStartTime)}::timestamptz, "actual_end_time" = ${isoText(f.actualEndTime)}::timestamptz,
      "yt_fetched_at" = ${iso(check.youtube.fetchedAt)}::timestamptz`);
  }
  const v = check.verdict;
  if (v) {
    sets.push(sql`"status" = ${v.status}, "dead" = ${v.dead}::boolean, "dead_reason" = ${v.deadReason}`);
    if (v.startsAt !== undefined) sets.push(sql`"starts_at" = ${iso(v.startsAt)}::timestamptz`);
  }
  if (check.lastChecked !== undefined) sets.push(sql`"last_checked" = ${iso(check.lastChecked)}::timestamptz`);
  if (check.nextOffWindowCheckAt !== undefined) sets.push(sql`"next_off_window_check_at" = ${iso(check.nextOffWindowCheckAt)}::timestamptz`);
  sets.push(sql`"updated_at" = ${nowIso}::timestamptz`);
  return sql.join(sets, sql`, `);
}

/** The SET list of one owner / operator edit. */
function editSetsOf(edit: SourceEdit, nowIso: string): SqlQuery {
  const sets: SqlQuery[] = [];
  if (edit.hidden !== undefined) sets.push(sql`"hidden" = ${edit.hidden}::boolean`);
  if (edit.hiddenReason !== undefined) sets.push(sql`"hidden_reason" = ${edit.hiddenReason}`);
  if (edit.order !== undefined) sets.push(sql`"order" = ${edit.order}::numeric`);
  if (edit.override !== undefined) sets.push(sql`"override" = ${edit.override}::"enum_stream_sources_override"`);
  if (edit.videoId !== undefined) sets.push(sql`"video_id" = ${edit.videoId}`);
  if (edit.status !== undefined) sets.push(sql`"status" = ${edit.status}`);
  if (edit.dead !== undefined) sets.push(sql`"dead" = ${edit.dead}::boolean`);
  if (edit.deadReason !== undefined) sets.push(sql`"dead_reason" = ${edit.deadReason}`);
  if (edit.clearYoutube) {
    sets.push(sql`"live_broadcast_content" = NULL, "privacy_status" = NULL, "embeddable" = NULL, "scheduled_start_time" = NULL,
      "actual_start_time" = NULL, "actual_end_time" = NULL, "yt_fetched_at" = NULL, "last_checked" = NULL, "starts_at" = NULL`);
  }
  if (edit.adminEditedAt !== undefined) sets.push(sql`"admin_edited_at" = ${iso(edit.adminEditedAt)}::timestamptz`);
  sets.push(sql`"updated_at" = ${nowIso}::timestamptz`);
  return sql.join(sets, sql`, `);
}

export interface PayloadLiveDeps {
  payload: () => Promise<Payload>;
  /** Real time: `at` of a version change and `updated_at` of the rows. */
  clock: Clock;
}

export function createPayloadLiveStore(deps: PayloadLiveDeps): LiveStore {
  const nowIso = () => new Date(deps.clock.now()).toISOString();
  const store: LiveStore = {
    async inTransaction(tx, fn) {
      const req = tx ? (tx as PayloadRequest) : await createLocalReq({ context: CONTEXT }, await deps.payload());
      const started = await initTransaction(req);
      try {
        const result = await fn(req);
        if (started) await commitTransaction(req);
        return result;
      } catch (err) {
        await killTransaction(req);
        throw err;
      }
    },
    async sources(filter, tx) {
      const conn = tx ? await sessionOf(tx) : await drizzleOf(deps.payload);
      const where: SqlQuery[] = [];
      if (filter?.eventIds) {
        if (filter.eventIds.length === 0) return [];
        where.push(sql`"event_id" IN (${textList(filter.eventIds)})`);
      }
      if (filter?.sourceIds) {
        if (filter.sourceIds.length === 0) return [];
        where.push(sql`"source_id" IN (${textList(filter.sourceIds)})`);
      }
      const cond = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql.raw('');
      const { rows } = await conn.execute(sql`SELECT ${SOURCE_COLUMNS} FROM "stream_sources" ${cond} ORDER BY "event_id", "order", "source_id"`);
      return rows.map(toSource);
    },
    async state(tx) {
      if (!tx) {
        const { rows } = await (await drizzleOf(deps.payload)).execute(sql`SELECT ${STATE_COLUMNS} FROM "live_state" ORDER BY "id" LIMIT 1`);
        return toState(rows[0]);
      }
      const conn = await sessionOf(tx);
      await lockRow(conn);
      const { rows } = await conn.execute(sql`SELECT ${STATE_COLUMNS} FROM "live_state" ORDER BY "id" LIMIT 1`);
      return toState(rows[0]);
    },
    async applyChecks(tx, checks) {
      if (checks.length === 0) return;
      const conn = await sessionOf(tx);
      const at = nowIso();
      for (const check of checks) {
        await conn.execute(sql`UPDATE "stream_sources" SET ${setsOf(check, at)} WHERE "source_id" = ${check.sourceId}`);
      }
    },
    async bumpVersion(tx) {
      const conn = await sessionOf(tx);
      await lockRow(conn);
      const at = nowIso();
      const { rows } = await conn.execute(sql`
        UPDATE "live_state" SET "version" = "version" + 1, "at" = ${at}::timestamptz, "updated_at" = ${at}::timestamptz
        WHERE "id" = ${FIRST_ROW}
        RETURNING "version"::text AS "version"`);
      if (!rows[0]) throw new Error('live-state: update returned no row');
      return Number(rows[0].version);
    },
    async editSource(tx, sourceId, edit) {
      const conn = await sessionOf(tx);
      await conn.execute(sql`UPDATE "stream_sources" SET ${editSetsOf(edit, nowIso())} WHERE "source_id" = ${sourceId}`);
    },
    async insertSource(tx, source: NewSource) {
      const conn = await sessionOf(tx);
      const at = nowIso();
      await conn.execute(sql`
        INSERT INTO "stream_sources" ("source_id", "event_id", "platform", "video_id", "kind", "order", "status", "hidden", "dead", "long_news",
          "admin_edited_at", "updated_at", "created_at")
        VALUES (${source.sourceId}, ${source.eventId}, 'youtube', ${source.videoId}, 'main', ${source.order}::numeric, ${source.status}, false, false, false,
          ${iso(source.adminEditedAt)}::timestamptz, ${at}::timestamptz, ${at}::timestamptz)`);
    },
    async setZoneLive(tx, zoneLive) {
      const conn = await sessionOf(tx);
      await lockRow(conn);
      await conn.execute(sql`
        UPDATE "live_state" SET "zone_live" = ${JSON.stringify(zoneLive)}::jsonb, "updated_at" = ${nowIso()}::timestamptz WHERE "id" = ${FIRST_ROW}`);
    },
    async addPendingCheck(check, tx) {
      await store.inTransaction(tx ?? null, async (tx) => {
        const conn = await sessionOf(tx);
        await lockRow(conn);
        const entry = JSON.stringify([{ sourceId: check.sourceId, at: check.at }]);
        await conn.execute(sql`
          UPDATE "live_state" SET "pending_checks" = COALESCE("pending_checks", '[]'::jsonb) || ${entry}::jsonb, "updated_at" = ${nowIso()}::timestamptz
          WHERE "id" = ${FIRST_ROW}
            AND NOT (COALESCE("pending_checks", '[]'::jsonb) @> ${JSON.stringify([{ sourceId: check.sourceId }])}::jsonb)`);
      });
    },
    async claimPendingChecks() {
      return store.inTransaction(null, async (tx) => {
        const conn = await sessionOf(tx);
        await lockRow(conn);
        const { rows } = await conn.execute(sql`SELECT "pending_checks" FROM "live_state" WHERE "id" = ${FIRST_ROW}`);
        const pending = toPending(rows[0]?.pending_checks);
        if (pending.length === 0) return [];
        await conn.execute(sql`UPDATE "live_state" SET "pending_checks" = '[]'::jsonb, "updated_at" = ${nowIso()}::timestamptz WHERE "id" = ${FIRST_ROW}`);
        return pending;
      });
    },
  };
  return store;
}

/** `import chains` storage: raw rows of `stream-sources`, writes on the caller's transaction. */
export function createPayloadLiveImportStore(deps: PayloadLiveDeps): LiveImportStore {
  const nowIso = () => new Date(deps.clock.now()).toISOString();
  return {
    async read() {
      const { rows } = await (await drizzleOf(deps.payload)).execute(sql`
        SELECT "source_id", "event_id", "platform", "video_id", "kind", "name", "order"::text AS "order", "override", "admin_edited_at"
        FROM "stream_sources" ORDER BY "source_id"`);
      return rows.map((r) => ({
        sourceId: String(r.source_id),
        eventId: String(r.event_id),
        platform: r.platform === 'youtube' ? 'youtube' : 'none',
        videoId: str(r.video_id),
        kind: str(r.kind) ?? '',
        name: str(r.name) ?? '',
        order: Number(r.order) || 0,
        protected: r.admin_edited_at !== null && r.admin_edited_at !== undefined ? true : r.override !== null && r.override !== undefined,
      }));
    },
    async add(tx, s: ImportedSource) {
      const at = nowIso();
      await (await sessionOf(tx)).execute(sql`
        INSERT INTO "stream_sources" ("source_id", "event_id", "platform", "video_id", "kind", "name", "order", "starts_at", "status", "embeddable",
          "last_checked", "hidden", "dead", "long_news", "updated_at", "created_at")
        VALUES (${s.sourceId}, ${s.eventId}, ${s.platform}::"enum_stream_sources_platform", ${s.videoId}, ${s.kind}, ${s.name}, ${s.order}::numeric,
          ${iso(s.startsAt)}::timestamptz, ${s.status}, ${s.embeddable}::boolean, ${iso(s.lastChecked)}::timestamptz, false, false, false,
          ${at}::timestamptz, ${at}::timestamptz)`);
    },
    async change(tx, s: ImportedSource) {
      await (await sessionOf(tx)).execute(sql`
        UPDATE "stream_sources" SET "event_id" = ${s.eventId}, "platform" = ${s.platform}::"enum_stream_sources_platform", "video_id" = ${s.videoId},
          "kind" = ${s.kind}, "name" = ${s.name}, "order" = ${s.order}::numeric, "updated_at" = ${nowIso()}::timestamptz
        WHERE "source_id" = ${s.sourceId}`);
    },
  };
}

/**
 * The live fan-out claim (AC-5): ONE conditional `UPDATE … SET last_fanned_out = v WHERE last_fanned_out < v
 * RETURNING`, outside any transaction, so exactly one instance and one event claim a version.
 */
export function createPayloadLiveFanOutClaim(payload: () => Promise<Payload>): LiveFanOutClaim {
  return {
    async claim(version) {
      const { rows } = await (await drizzleOf(payload)).execute(sql`
        UPDATE "live_state" SET "last_fanned_out" = ${version}::numeric
        WHERE "id" = ${FIRST_ROW} AND COALESCE("last_fanned_out", 0) < ${version}::numeric
        RETURNING "id"`);
      return rows.length === 1;
    },
  };
}

const KEYS: ReadonlySet<string> = new Set(QUOTA_COUNTER_KEYS);

/** Quota counters: one atomic statement per write, keyed by (quota day, bucket). */
export function createPayloadQuotaStore(payload: () => Promise<Payload>): QuotaStore {
  return {
    async read(day) {
      const { rows } = await (await drizzleOf(payload)).execute(sql`
        SELECT "bucket", "used"::text AS "used", "alarm80_at", "exceeded_until" FROM "live_quota" WHERE "day" = ${day}`);
      const state: Partial<Record<QuotaCounterKey, QuotaCounter>> = {};
      for (const r of rows) {
        const key = String(r.bucket);
        if (!KEYS.has(key)) continue;
        state[key as QuotaCounterKey] = { day, used: Number(r.used) || 0, alarm80At: ms(r.alarm80_at), exceededUntil: ms(r.exceeded_until), minute: 0, minuteUsed: 0 };
      }
      return state as QuotaState;
    },
    async charge(day, key, units) {
      const n = Math.max(1, Math.ceil(units));
      const { rows } = await (await drizzleOf(payload)).execute(sql`
        INSERT INTO "live_quota" ("day", "bucket", "used", "updated_at", "created_at")
        VALUES (${day}, ${key}, ${n}::numeric, clock_timestamp(), clock_timestamp())
        ON CONFLICT ("day", "bucket") DO UPDATE SET "used" = "live_quota"."used" + EXCLUDED."used", "updated_at" = clock_timestamp()
        RETURNING "used"::text AS "used"`);
      return Number(rows[0]?.used) || n;
    },
    async markExceeded(day, bucket: QuotaBucket, until) {
      const { rows } = await (await drizzleOf(payload)).execute(sql`
        INSERT INTO "live_quota" ("day", "bucket", "used", "exceeded_until", "updated_at", "created_at")
        VALUES (${day}, ${bucket}, 0, ${iso(until)}::timestamptz, clock_timestamp(), clock_timestamp())
        ON CONFLICT ("day", "bucket") DO UPDATE SET "exceeded_until" = EXCLUDED."exceeded_until", "updated_at" = clock_timestamp()
          WHERE "live_quota"."exceeded_until" IS NULL OR "live_quota"."exceeded_until" < EXCLUDED."exceeded_until"
        RETURNING "id"`);
      return rows.length === 1;
    },
    async mark80(day, bucket: QuotaBucket, at) {
      const { rows } = await (await drizzleOf(payload)).execute(sql`
        INSERT INTO "live_quota" ("day", "bucket", "used", "alarm80_at", "updated_at", "created_at")
        VALUES (${day}, ${bucket}, 0, ${iso(at)}::timestamptz, clock_timestamp(), clock_timestamp())
        ON CONFLICT ("day", "bucket") DO UPDATE SET "alarm80_at" = EXCLUDED."alarm80_at", "updated_at" = clock_timestamp()
          WHERE "live_quota"."alarm80_at" IS NULL
        RETURNING "id"`);
      return rows.length === 1;
    },
  };
}

export interface PgLiveLeaseOptions {
  payload: () => Promise<Payload>;
  /** Journal of lease takeovers (the scheduler store journals each epoch change). */
  journal: Journal;
  /** This process: host, pid and a random part. */
  holderId: string;
}

/** The live leases over the scheduler lease table: one row per name, the term set by `acquire`. */
export function createPgLiveLease(opts: PgLiveLeaseOptions): LiveLease {
  return createPgNamedLease<LiveLeaseName>(opts);
}
