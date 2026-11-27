/**
 * Ports of the presence and passport domain (SPEC-14 [П-1], [П-10]). Row types and store interfaces over `RightsDb`;
 * no SQL here: the implementations live in the services of later phases. All times are server-clock ms; Postgres
 * returns `bigint` columns as strings, so rows carry `string` and the stores convert with `Number()`.
 */
import type { RightsDb } from '../rights/ports';

export type { RightsDb };

/** `bigint` as returned by `pg`. */
export type PgBigint = string;

export type PresenceSourceName = string;
export type GrantKind = 'presence' | 'downtime' | 'old-moment';

export interface ProofKey {
  subject_id: string;
  season: string;
  event_id: string;
  moment_ms: PgBigint;
}

export interface ProofRow extends ProofKey {
  first_received_at: PgBigint;
  last_received_at: PgBigint | null;
  source: PresenceSourceName;
}

export interface MomentRow {
  season: string;
  event_id: string;
  moment_ms: PgBigint;
  first_seen_at: PgBigint;
}

export interface SampleRow {
  node_id: string;
  at: PgBigint;
  fast_reachable: boolean;
  fast_run_id: string | null;
  fast_uptime_s: PgBigint | null;
  accepted: number;
  failed: number;
}

export interface WindowHealthRow {
  season: string;
  event_id: string;
  moment_ms: PgBigint;
  state: 'healthy' | 'downtime';
  signs: string[];
  recorded_by: 'system';
  recorded_at: PgBigint;
  alarmed_at: PgBigint | null;
}

export interface DowntimeRow {
  id: PgBigint;
  season: string;
  kind: 'manual' | 'edge-region';
  event_id: string | null;
  from_ms: PgBigint;
  to_ms: PgBigint;
  region: string | null;
  reason: string | null;
  recorded_by: 'owner' | 'system';
  created_at: PgBigint;
  alarmed_at: PgBigint | null;
}

export interface StampRow {
  subject_id: string;
  season: string;
  event_id: string;
  granted_at: PgBigint;
  presence_source: PresenceSourceName;
  grant_kind: GrantKind;
  issued_at: PgBigint;
}

export interface AchievementRow {
  subject_id: string;
  season: string;
  key: string;
  achieved_at: PgBigint;
}

export interface OldMomentLogRow {
  id: PgBigint;
  subject_id: string;
  season: string;
  event_id: string;
  old_moment_ms: PgBigint;
  new_moment_ms: PgBigint;
  at: PgBigint;
}

export interface AuthorIdRow {
  subject_id: string;
  author_id: string;
  created_at: PgBigint;
}

/** Proof of presence: one row per subject x season x event x moment; a higher-priority source replaces a lower one. */
export interface ProofStore {
  /** `true` when a new row was inserted; `false` when the proof already existed. */
  insert(db: RightsDb, row: Omit<ProofRow, 'last_received_at'>): Promise<boolean>;
  /** Sets `source` only where the stored source is one of `lowerSources`; returns rows changed. */
  upgradeSource(db: RightsDb, key: ProofKey, source: PresenceSourceName, lowerSources: readonly PresenceSourceName[]): Promise<number>;
  touch(db: RightsDb, key: ProofKey, at: number): Promise<void>;
  listForSubject(db: RightsDb, subjectId: string, season: string): Promise<ProofRow[]>;
}

/** Every moment the server has seen for an event. */
export interface MomentStore {
  record(db: RightsDb, season: string, eventId: string, momentMs: number, seenAt: number): Promise<void>;
  list(db: RightsDb, season: string, eventId: string): Promise<MomentRow[]>;
}

/** Per-node beat counters and fast-store reachability samples; no subject column (NFR-5). */
export interface SampleStore {
  add(
    db: RightsDb,
    row: {
      node_id: string;
      at: number;
      fast_reachable: boolean;
      fast_run_id: string | null;
      fast_uptime_s: number | null;
      accepted: number;
      failed: number;
    },
  ): Promise<void>;
  between(db: RightsDb, fromMs: number, toMs: number): Promise<SampleRow[]>;
  pruneBefore(db: RightsDb, atMs: number): Promise<number>;
}

/** Exactly one system record per window. */
export interface HealthStore {
  /** `true` when the record was written, `false` when the window already had one. */
  record(db: RightsDb, row: Omit<WindowHealthRow, 'recorded_by' | 'alarmed_at'>): Promise<boolean>;
  get(db: RightsDb, season: string, eventId: string, momentMs: number): Promise<WindowHealthRow | null>;
  markAlarmed(db: RightsDb, season: string, eventId: string, momentMs: number, at: number): Promise<void>;
}

/** Append-only manual and edge-region downtime records. */
export interface DowntimeStore {
  add(db: RightsDb, row: Omit<DowntimeRow, 'id' | 'alarmed_at'>): Promise<DowntimeRow>;
  list(db: RightsDb, season: string): Promise<DowntimeRow[]>;
  markAlarmed(db: RightsDb, id: string, at: number): Promise<void>;
}

/** Stamps: one per subject x season x event. */
export interface StampStore {
  /** `true` when a new stamp was written; `false` when one already existed. */
  insert(db: RightsDb, row: StampRow): Promise<boolean>;
  listForSubject(db: RightsDb, subjectId: string, season: string): Promise<StampRow[]>;
  logOldMoment(db: RightsDb, row: Omit<OldMomentLogRow, 'id'>): Promise<void>;
}

/** Passport achievements, one per subject x key. */
export interface AchievementStore {
  /** Inserts the keys not yet held; returns the keys that were new. */
  grant(db: RightsDb, subjectId: string, season: string, keys: readonly string[], at: number): Promise<string[]>;
  listForSubject(db: RightsDb, subjectId: string): Promise<AchievementRow[]>;
}

/** Public author ids for the author path. */
export interface AuthorIdStore {
  /** Returns the existing author id of the subject or creates one. */
  ensure(db: RightsDb, subjectId: string, makeId: () => string, at: number): Promise<string>;
  subjectOf(db: RightsDb, authorId: string): Promise<string | null>;
}

/** Injected faults of the test doors; shape follows `presenceFaultDoor` of the contracts. */
export interface PresenceFaults {
  fastStore?: 'down' | 'up';
  dbWrite?: 'down' | 'up';
  /** Share of beats answered with an error, 0..1. */
  beatErrorRate?: number;
}
