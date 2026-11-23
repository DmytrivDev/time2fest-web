/**
 * Ports of the live-air capability (SPEC-12), ring 2. They name the conversation, never a vendor type.
 * `PresenceSource` is the realtime presence read (S9): only each entry's `chan_info`, never a client id.
 */
import type { StreamStatus } from '@time2fest/contracts';
import type { SourceOverride, ZoneLive, StoredSource } from '../domain/live/chain';
import type { QuotaBucket } from '../domain/live/config';
import type { LiveEvent } from '../domain/live/moment';
import type { QuotaCounterKey, QuotaState } from '../domain/live/quota';
import type { YoutubeVideoState } from '../domain/live/status';
import type { Tx } from '../events/ports';
import type { CentrifugoPresenceApi } from '../realtime/ports';

export type { Tx };

export type VideoStatusError = 'quota-exceeded' | 'unavailable' | 'invalid';

export type VideoStatusResult = { items: YoutubeVideoState[] } | { error: VideoStatusError };

/** One `videos.list` conversation: at most B ids; an id missing from `items` is gone. */
export interface VideoStatusSource {
  list(ids: readonly string[]): Promise<VideoStatusResult>;
}

/** A search call exists only to be counted (the poller never uses its result). */
export interface SearchSource {
  search(): Promise<{ ok: true } | { error: VideoStatusError }>;
}

/**
 * Quota counters per quota day (AC-31 … AC-35). Every write is one atomic statement, so calls from several
 * instances are each counted once.
 */
export interface QuotaStore {
  /** The counters of one quota day (an absent counter = nothing used yet). */
  read(day: string): Promise<QuotaState>;
  /** Adds `units` (≥1) to the counter and returns its new `used`. */
  charge(day: string, key: QuotaCounterKey, units: number): Promise<number>;
  /** Stops the bucket until `until`; true only for the call that set (or extended) the stop. */
  markExceeded(day: string, bucket: QuotaBucket, until: number): Promise<boolean>;
  /** Records the day's 80 % alarm; true only for the first call of the day. */
  mark80(day: string, bucket: QuotaBucket, at: number): Promise<boolean>;
}

/** A `stream-sources` row as the live services read it (times as epoch ms). */
export interface LiveSource extends StoredSource {
  nextOffWindowCheckAt?: number | null;
  deadReason?: string | null;
}

/** The YouTube fields of one source as fetched (AC-73: each carries `ytFetchedAt`). */
export type YoutubeFields = Omit<YoutubeVideoState, 'videoId'>;

/** The result of one check (or of the retention clearing) written onto one source. */
export interface SourceCheck {
  sourceId: string;
  /** Fetched fields with their fetch time; `null` clears every YouTube field and `ytFetchedAt` (AC-73). */
  youtube: { fields: YoutubeFields; fetchedAt: number } | null;
  /** The poller's status; absent while an `override` holds the source (AC-9). */
  verdict?: { status: StreamStatus | null; startsAt?: number | null; dead: boolean; deadReason: string | null };
  /** A successful status check at this time; absent leaves `lastChecked` as it is. */
  lastChecked?: number;
  /** Absent leaves the stored value. */
  nextOffWindowCheckAt?: number | null;
}

/** A queued ad-hoc check (a player report or a replace, AC-43). */
export interface PendingCheck {
  sourceId: string;
  at: number;
}

/** An owner / operator edit of one source (S10, AC-51 … AC-55); an absent field keeps its stored value. */
export interface SourceEdit {
  hidden?: boolean;
  hiddenReason?: string | null;
  order?: number;
  override?: SourceOverride | null;
  videoId?: string;
  status?: string | null;
  dead?: boolean;
  deadReason?: string | null;
  /** Clears every YouTube field and `ytFetchedAt`, `lastChecked` (a new video is unverified until checked). */
  clearYoutube?: boolean;
  adminEditedAt?: number;
}

/** A source added by the owner (replace by videoId, AC-55): a `youtube` source, unverified. */
export interface NewSource {
  sourceId: string;
  eventId: string;
  videoId: string;
  order: number;
  status: string;
  adminEditedAt: number;
}

export interface LiveStateRecord {
  version: number;
  at: number | null;
  lastFannedOut: number;
  zoneLive: ZoneLive;
  pendingChecks: PendingCheck[];
}

export interface LiveStore {
  /** Runs `fn` in one transaction (joining `tx`'s when given); a throw rolls it back. */
  inTransaction<T>(tx: Tx | null, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Stored sources, every one or those of the given events / source ids. */
  sources(filter?: { eventIds?: readonly string[]; sourceIds?: readonly string[] }, tx?: Tx): Promise<LiveSource[]>;
  /** The live state; inside `tx` it first takes the live lock (held until `tx` ends). */
  state(tx?: Tx): Promise<LiveStateRecord>;
  /** Writes check results in `tx`. */
  applyChecks(tx: Tx, checks: readonly SourceCheck[]): Promise<void>;
  /** `version + 1` (and `at` = now) under the live lock in `tx`; returns the new version. */
  bumpVersion(tx: Tx): Promise<number>;
  /** Applies one edit to one source in `tx`. */
  editSource(tx: Tx, sourceId: string, edit: SourceEdit): Promise<void>;
  /** Adds one source in `tx`. */
  insertSource(tx: Tx, source: NewSource): Promise<void>;
  /** Writes `live-state.zoneLive` under the live lock in `tx`. */
  setZoneLive(tx: Tx, zoneLive: ZoneLive): Promise<void>;
  /** Queues an ad-hoc check of a source (a source already queued stays queued once); joins `tx` when given. */
  addPendingCheck(check: PendingCheck, tx?: Tx): Promise<void>;
  /** Takes every queued check and empties the queue, atomically (one instance gets each). */
  claimPendingChecks(): Promise<PendingCheck[]>;
}

/** A source of `data/streams.json` as `import chains` writes it (times as epoch ms). */
export interface ImportedSource {
  sourceId: string;
  eventId: string;
  platform: SourcePlatformLike;
  videoId: string | null;
  kind: string;
  name: string;
  order: number;
  /** Initial poller fields: written on add only, never on change. */
  status: string | null;
  startsAt: number | null;
  embeddable: boolean;
  lastChecked: number | null;
}

type SourcePlatformLike = 'youtube' | 'none';

/** A stored source as `import chains` compares it. */
export interface StoredImportSource extends Omit<ImportedSource, 'status' | 'startsAt' | 'embeddable' | 'lastChecked'> {
  /** Owner-edited (`adminEditedAt`) or `override` set: the import never writes it. */
  protected: boolean;
}

/** The `stream-sources` conversation of `import chains`. */
export interface LiveImportStore {
  read(): Promise<StoredImportSource[]>;
  add(tx: Tx, source: ImportedSource): Promise<void>;
  /** Writes only the static fields (event, platform, video, kind, name, order). */
  change(tx: Tx, source: ImportedSource): Promise<void>;
}

/**
 * Claims the fan-out of one live version across instances (AC-5): true for exactly one caller per version, and never
 * for a version ≤ one already claimed (`live-state.lastFannedOut`).
 */
export interface LiveFanOutClaim {
  claim(version: number): Promise<boolean>;
}

/** The events the live air knows:their effective moments and the `hidden` correction (AC-10, AC-58). */
export interface LiveEventSource {
  events(): Promise<LiveEvent[]>;
}

/** The presence of one channel (SPEC-12 AC-61): `unavailable` when the transport cannot answer now. */
export type PresenceSource = CentrifugoPresenceApi;

export type LiveLeaseName = 'live-poller' | 'live-viewers';

/** One holder per lease name across every instance (Postgres lease rows, [П-5]). */
export interface LiveLease {
  /** Takes or renews the lease for `ttlMs`; false while another instance holds it. */
  acquire(name: LiveLeaseName, ttlMs: number): Promise<boolean>;
  release(name: LiveLeaseName): Promise<void>;
}
