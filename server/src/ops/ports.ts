/**
 * Ports of operations (SPEC-13b), ring 2: the Telegram outbox, leases of the ops jobs, backup and
 * restore runs, spend counters, the wall clock and `pg_dump`. Technology-neutral: no Payload or AWS
 * types; the adapters live in `adapters/payloadOps.ts`, `adapters/pgDump.ts`.
 */
import type { Readable } from 'node:stream';
import type { AlarmDetails } from '../alarms/ports';

/** Leases of the ops jobs over the scheduler lease table ([П-2]); `LiveLeaseName` stays untouched. */
export type OpsLeaseName = 'ops-backup' | 'ops-heartbeat' | 'ops-spend' | 'ops-telegram';

/** One holder per lease name across every instance (AC-8, AC-21, AC-40, AC-62). */
export interface OpsLease {
  /** Takes or renews the lease for `ttlMs`; false while another instance holds it. */
  acquire(name: OpsLeaseName, ttlMs: number): Promise<boolean>;
  release(name: OpsLeaseName): Promise<void>;
}

/**
 * The real wall clock (AC-22): ops schedules ignore the SPEC-07 test clock. Injected so the `ops-tick`
 * door and unit tests can pass a substitute `now`.
 */
export interface WallClock {
  /** Epoch ms. */
  now(): number;
}

/** An alarm kind: `source` / `code` as raised. */
export interface AlarmKind {
  source: string;
  code: string;
}

/** What one outbox row carries to Telegram ([П-3]). */
export type OutboxKind = 'alarm' | 'digest' | 'heartbeat' | 'storm-summary';

export type OutboxStatus = 'delivered' | 'failed' | 'pending';

/** A new outbox row: the text is final, `details` already sanitized (AC-2, AC-11). */
export interface NewOutboxRow {
  kind: OutboxKind;
  /** Set for `kind: 'alarm'` only. */
  alarm?: AlarmKind & { level: 'page' };
  details?: AlarmDetails;
  text: string;
  chatId: string;
  /**
   * Unique per cluster when set: `hb:<UTC yyyy-mm-ddThh>`, `digest:<Kyiv yyyy-mm-dd>`,
   * `storm:<window start>` — the second insert of a slot is refused (AC-21).
   */
  slotKey?: string;
  /** Epoch ms. */
  createdAt: number;
  /** Epoch ms of the first attempt; absent → `createdAt` (a storm summary waits for its window end, AC-7). */
  notBefore?: number;
}

export interface OutboxRow extends NewOutboxRow {
  id: string;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms of the next attempt while `pending`. */
  nextAttemptAt: number;
  deliveredAt: number | null;
  failedAt: number | null;
  /** Coalesced repeats of the same kind within 10 min (AC-6). */
  repeatCount: number;
}

/** The `alarm-deliveries` collection: one outbox for everything sent to Telegram ([П-3]). */
export interface Outbox {
  /** `duplicate-slot` when a row with the same `slotKey` exists. Throws when the store is down (AC-9). */
  insert(row: NewOutboxRow): Promise<{ id: string } | 'duplicate-slot'>;
  /**
   * Claims up to `limit` pending rows due at `now`, oldest `raisedAt` first, of `kinds` (all when absent): one
   * conditional update, so two instances never claim the same row (AC-8); the claim pushes their
   * `nextAttemptAt` 30 s forward, so a row claimed by a crashed holder is retried after that.
   */
  claimDue(limit: number, now: number, kinds?: readonly OutboxKind[]): Promise<OutboxRow[]>;
  /** A sent attempt succeeded: `delivered`, `attempts += 1`. */
  markDelivered(id: string, at: number, status?: number): Promise<void>;
  /** A sent attempt failed and will be repeated at `nextAt`: `attempts += 1`. */
  markRetry(id: string, nextAt: number, status?: number): Promise<void>;
  /**
   * Final failure (AC-5): the row stays as `failed`, never retried, `attempts += 1`; one
   * journal row `ops.telegram-delivery-failed` in the same transaction.
   */
  markFailed(id: string, at: number, status?: number): Promise<void>;
  /** The newest delivered `alarm` row of `kind` delivered at or after `sinceMs` (AC-6). */
  latestDeliveredOfKind(kind: AlarmKind, sinceMs: number): Promise<OutboxRow | null>;
  /**
   * The pending `alarm` row of `kind`, if any: while Telegram is down, repeats of one kind count on that row
   * instead of queueing a row each (AC-6 coalescing extended to rows not yet sent).
   */
  pendingOfKind(kind: AlarmKind): Promise<OutboxRow | null>;
  /** `repeatCount += by` (default 1) on that row instead of a new row (AC-6). */
  incrementRepeat(id: string, by?: number): Promise<void>;
  /** `alarm` rows actually sent (a successful attempt) in `[sinceMs, untilMs]` — the storm count (AC-7). */
  countSent(sinceMs: number, untilMs: number): Promise<number>;
  /**
   * Storm (AC-7): held `alarm` rows are closed as delivered without a message (`attempts` stays 0); the
   * window's summary row reports them.
   */
  markSummarized(ids: readonly string[], at: number): Promise<void>;
  /** `alarm` rows closed by `markSummarized` with `at` in `[fromMs, toMs)` (the summary text). */
  listSummarized(fromMs: number, toMs: number): Promise<OutboxRow[]>;
  /** Replaces the text of a pending row (the storm summary is written when it is sent). */
  setText(id: string, text: string): Promise<void>;
  /** A row with this `slotKey` exists, whatever its status (a missed slot already sent elsewhere, AC-21). */
  hasSlot(slotKey: string): Promise<boolean>;
}

/** System journal lines of the ops jobs (`audit-log`, actor `system/ops`): a skipped slot (AC-21). */
export interface OpsJournal {
  /** One line `action` about `targetId` (a slot key) with `after`, at the wall-clock `at`. */
  line(action: string, targetId: string, after: Record<string, unknown>, at: number): Promise<void>;
}

/** Stage at which a backup run stopped (AC-42, AC-44). */
export type BackupStage = 'config' | 'version' | 'dump' | 'encrypt' | 'upload' | 'manifest' | 'retention';

/** One `backup-runs` row (AC-51). */
export interface BackupRun {
  /** Epoch ms. */
  startedAt: number;
  finishedAt: number;
  result: 'failed' | 'ok';
  /** Set when `result` is `failed`. */
  stage?: BackupStage;
  /** Object key of the dump (without the env prefix's bucket), set on success. */
  key?: string;
  sizeBytes?: number;
  trigger: 'manual' | 'schedule';
}

export interface BackupRunStore {
  record(run: BackupRun): Promise<void>;
  /** The newest run, and the newest successful one (AC-45, AC-56). */
  latest(): Promise<{ last: BackupRun | null; lastOk: BackupRun | null }>;
  /** Successful runs finished at or after `sinceMs`, oldest first (loss window, AC-57). */
  okSince(sinceMs: number): Promise<BackupRun[]>;
}

/** One `restore-runs` row (AC-56, AC-57). */
export interface RestoreRun {
  /** Epoch ms. */
  at: number;
  result: 'failed' | 'ok';
  /** Object key of the dump restored from. */
  source: string;
  target: string;
  durationMs: number;
  /** Largest gap between successful backups in the 24 h before the dump (AC-57). */
  lossWindowMs: number | null;
  note?: string;
}

export interface RestoreRunStore {
  record(run: RestoreRun): Promise<void>;
  latest(): Promise<RestoreRun | null>;
}

/** A spend counter row: `<spend row key>:<period>`, e.g. `cloudflare:2026-12` (AC-60 … AC-64). */
export interface SpendCounter {
  key: string;
  /** Numbers by name (`usd`, `hours`, `classA`, `classB`, …). */
  values: Readonly<Record<string, number>>;
  /** Thresholds already alarmed in this period (`50`, `80`), once per cluster (AC-62). */
  alarmed: readonly number[];
  /** Epoch ms of the last write. */
  updatedAt: number;
}

export interface SpendCounterStore {
  get(key: string): Promise<SpendCounter | null>;
  /** Adds `delta` to the named values (creating the row), at `at`. */
  add(key: string, delta: Readonly<Record<string, number>>, at: number): Promise<void>;
  /**
   * Conditional claim of one threshold of one period (pattern `claimAlarm`, `adapters/pgAiSpend.ts`):
   * true for exactly one caller across the cluster.
   */
  claimThreshold(key: string, threshold: number): Promise<boolean>;
}

/** `pg_dump` of the environment's database ([П-8]). */
export interface DumpRunner {
  /** Major version of the `pg_dump` client. */
  version(): Promise<number>;
  /** Major version of the database server. */
  serverVersion(): Promise<number>;
  /** The custom-format dump as a stream; errors surface as stream errors. */
  dump(): Readable;
}
