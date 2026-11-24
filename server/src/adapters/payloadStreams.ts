/**
 * Stream channels and candidates store (SPEC-21a), ring 4: raw SQL on the `stream_channels` / `stream_candidates`
 * tables. Payload rows never leave this file. Every write takes the caller's `tx` (the same transaction as its
 * journal row). This phase holds the channel reads and writes of `import channels`; later phases extend it.
 */
import { sql } from '@payloadcms/db-postgres';
import type { Payload, PayloadRequest } from 'payload';
import type { ChannelImportStore, ImportedChannel, StoredChannel } from '../live/importChannels';
import type { CandidateFilter, StoredCandidate, StoredStreamChannel, StreamsStore, Tx } from '../live/ports';
import type { Clock } from '../ports';

type SqlQuery = ReturnType<typeof sql>;
interface Exec {
  execute(query: SqlQuery): Promise<{ rows: Record<string, unknown>[] }>;
}
interface DrizzleAdapter {
  sessions: Record<string, { db: Exec } | undefined>;
  drizzle: Exec;
}

export interface PayloadStreamsDeps {
  payload: () => Promise<Payload>;
  clock: Clock;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

async function drizzleOf(payload: () => Promise<Payload>): Promise<Exec> {
  return ((await payload()).db as unknown as DrizzleAdapter).drizzle;
}

async function sessionOf(tx: Tx): Promise<Exec> {
  const req = tx as PayloadRequest;
  const db = req.payload.db as unknown as DrizzleAdapter;
  const id = req.transactionID;
  const session = id ? db.sessions[String(await id)]?.db : undefined;
  if (!session) throw new Error('streams: a write needs an open transaction');
  return session;
}

export interface PayloadStreamsStore extends ChannelImportStore, StreamsStore {
  /** Marks a channel as edited in the admin (the import then skips it). */
  markChannelAdminEdited(tx: Tx, channelId: string, at: number): Promise<void>;
}

export function createPayloadStreamsStore(deps: PayloadStreamsDeps): PayloadStreamsStore {
  const nowIso = () => new Date(deps.clock.now()).toISOString();
  const execOf = async (tx?: Tx): Promise<Exec> => (tx ? sessionOf(tx) : drizzleOf(deps.payload));
  const store: PayloadStreamsStore = {
    async readChannels(): Promise<StoredChannel[]> {
      const { rows } = await (await drizzleOf(deps.payload)).execute(sql`
        SELECT "channel_id", "name", "kind", "zones", "seasons", "priority"::text AS "priority", "blacklisted", "blacklist_source", "admin_edited_at"
        FROM "stream_channels" ORDER BY "channel_id"`);
      return rows.map((r) => ({
        channelId: String(r.channel_id),
        name: str(r.name) ?? '',
        kind: str(r.kind) ?? '',
        zones: strings(r.zones),
        seasons: strings(r.seasons),
        priority: Number(r.priority) || 3,
        blacklisted: r.blacklisted === true,
        blacklistSource: str(r.blacklist_source),
        protected: r.admin_edited_at !== null && r.admin_edited_at !== undefined,
      }));
    },
    async addChannel(tx, c: ImportedChannel) {
      const at = nowIso();
      await (await sessionOf(tx)).execute(sql`
        INSERT INTO "stream_channels" ("channel_id", "name", "kind", "zones", "seasons", "priority", "state", "blacklisted", "updated_at", "created_at")
        VALUES (${c.channelId}, ${c.name}, ${c.kind}, ${JSON.stringify(c.zones)}::jsonb, ${JSON.stringify(c.seasons)}::jsonb, ${c.priority}::numeric,
          'watched', false, ${at}::timestamptz, ${at}::timestamptz)`);
    },
    async changeChannel(tx, c: ImportedChannel) {
      await (await sessionOf(tx)).execute(sql`
        UPDATE "stream_channels" SET "name" = ${c.name}, "kind" = ${c.kind}, "zones" = ${JSON.stringify(c.zones)}::jsonb,
          "seasons" = ${JSON.stringify(c.seasons)}::jsonb, "priority" = ${c.priority}::numeric, "updated_at" = ${nowIso()}::timestamptz
        WHERE "channel_id" = ${c.channelId}`);
    },
    async addBlacklisted(tx, channelId, reason, source) {
      const at = nowIso();
      await (await sessionOf(tx)).execute(sql`
        INSERT INTO "stream_channels" ("channel_id", "name", "kind", "zones", "seasons", "priority", "state", "blacklisted", "blacklist_reason",
          "blacklist_source", "updated_at", "created_at")
        VALUES (${channelId}, ${channelId}, 'tv', '[]'::jsonb, '[]'::jsonb, 3::numeric, 'off', true, ${reason}, ${source}, ${at}::timestamptz, ${at}::timestamptz)`);
    },
    async blacklistExisting(tx, channelId, reason, source) {
      await (await sessionOf(tx)).execute(sql`
        UPDATE "stream_channels" SET "blacklisted" = true, "blacklist_reason" = ${reason}, "blacklist_source" = ${source}, "updated_at" = ${nowIso()}::timestamptz
        WHERE "channel_id" = ${channelId}`);
    },
    async markChannelAdminEdited(tx, channelId, at) {
      await (await sessionOf(tx)).execute(sql`
        UPDATE "stream_channels" SET "admin_edited_at" = ${new Date(at).toISOString()}::timestamptz, "updated_at" = ${nowIso()}::timestamptz
        WHERE "channel_id" = ${channelId}`);
    },
    async candidates(filter: CandidateFilter = {}, tx?: Tx): Promise<StoredCandidate[]> {
      const where: SqlQuery[] = [sql`TRUE`];
      if (filter.videoIds) where.push(inList('video_id', filter.videoIds));
      if (filter.sourceIds) where.push(inList('source_id', filter.sourceIds));
      if (filter.states) where.push(inList('state', filter.states));
      if (filter.eventId !== undefined) where.push(sql`"event_id" = ${filter.eventId}`);
      if (filter.channelId !== undefined) where.push(sql`"channel_id" = ${filter.channelId}`);
      const lock = tx ? sql` FOR UPDATE` : sql``;
      const { rows } = await (await execOf(tx)).execute(sql`
        SELECT "video_id", "channel_id", "found_by", "state", "reason", "event_id", "source_id", "live_broadcast_content", "scheduled_start_time",
          "embeddable", "privacy_status", "yt_fetched_at", "checked_at", "state_changed_at", "state_changed_by", "evidence_url", "note"
        FROM "stream_candidates" WHERE ${sql.join(where, sql` AND `)} ORDER BY "video_id"${lock}`);
      return rows.map(candidateOf);
    },
    async channels(filter = {}, tx?: Tx): Promise<StoredStreamChannel[]> {
      const where: SqlQuery[] = [sql`TRUE`];
      if (filter.channelIds) where.push(inList('channel_id', filter.channelIds));
      if (filter.state !== undefined) where.push(sql`"state" = ${filter.state}`);
      if (filter.blacklisted !== undefined) where.push(sql`COALESCE("blacklisted", false) = ${filter.blacklisted}::boolean`);
      const lock = tx ? sql` FOR UPDATE` : sql``;
      const { rows } = await (await execOf(tx)).execute(sql`
        SELECT "channel_id", "uploads_playlist_id", "uploads_fetched_at", "name", "kind", "zones", "seasons", "priority"::text AS "priority", "state",
          "blacklisted", "blacklist_reason", "blacklist_source", "proposed_by", "admin_edited_at", "last_playlist_at", "last_search_at"
        FROM "stream_channels" WHERE ${sql.join(where, sql` AND `)} ORDER BY "channel_id"${lock}`);
      return rows.map(channelOf);
    },
    async saveCandidate(tx, c, by, at) {
      const [have] = await store.candidates({ videoIds: [c.videoId] }, tx);
      const base: StoredCandidate = have ?? {
        videoId: c.videoId,
        channelId: null,
        foundBy: [],
        state: 'new',
        reason: null,
        eventId: null,
        sourceId: null,
        liveBroadcastContent: null,
        scheduledStartTime: null,
        embeddable: null,
        privacyStatus: null,
        ytFetchedAt: null,
        checkedAt: null,
        stateChangedAt: null,
        stateChangedBy: null,
        evidenceUrl: null,
        note: null,
      };
      const next: StoredCandidate = { ...base, ...definedOf(c) };
      if (!have || have.state !== next.state) {
        next.stateChangedAt = at;
        next.stateChangedBy = by;
      }
      const now = nowIso();
      await (await sessionOf(tx)).execute(sql`
        INSERT INTO "stream_candidates" ("video_id", "channel_id", "found_by", "state", "reason", "event_id", "source_id", "live_broadcast_content",
          "scheduled_start_time", "embeddable", "privacy_status", "yt_fetched_at", "checked_at", "state_changed_at", "state_changed_by", "evidence_url", "note",
          "updated_at", "created_at")
        VALUES (${next.videoId}, ${next.channelId}, ${JSON.stringify(next.foundBy)}::jsonb, ${next.state}, ${next.reason}, ${next.eventId}, ${next.sourceId},
          ${next.liveBroadcastContent}, ${iso(next.scheduledStartTime)}::timestamptz, ${next.embeddable}::boolean, ${next.privacyStatus},
          ${iso(next.ytFetchedAt)}::timestamptz, ${iso(next.checkedAt)}::timestamptz, ${iso(next.stateChangedAt)}::timestamptz, ${next.stateChangedBy},
          ${next.evidenceUrl}, ${next.note}, ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT ("video_id") DO UPDATE SET "channel_id" = EXCLUDED."channel_id", "found_by" = EXCLUDED."found_by", "state" = EXCLUDED."state",
          "reason" = EXCLUDED."reason", "event_id" = EXCLUDED."event_id", "source_id" = EXCLUDED."source_id",
          "live_broadcast_content" = EXCLUDED."live_broadcast_content", "scheduled_start_time" = EXCLUDED."scheduled_start_time",
          "embeddable" = EXCLUDED."embeddable", "privacy_status" = EXCLUDED."privacy_status", "yt_fetched_at" = EXCLUDED."yt_fetched_at",
          "checked_at" = EXCLUDED."checked_at", "state_changed_at" = EXCLUDED."state_changed_at", "state_changed_by" = EXCLUDED."state_changed_by",
          "evidence_url" = EXCLUDED."evidence_url", "note" = EXCLUDED."note", "updated_at" = EXCLUDED."updated_at"`);
    },
    async saveChannel(tx, c) {
      const [have] = await store.channels({ channelIds: [c.channelId] }, tx);
      const base: StoredStreamChannel = have ?? {
        channelId: c.channelId,
        uploadsPlaylistId: null,
        uploadsFetchedAt: null,
        name: c.channelId,
        kind: 'tv',
        zones: [],
        seasons: [],
        priority: 3,
        state: 'watched',
        blacklisted: false,
        blacklistReason: null,
        blacklistSource: null,
        proposedBy: null,
        adminEditedAt: null,
        lastPlaylistAt: null,
        lastSearchAt: null,
      };
      const n: StoredStreamChannel = { ...base, ...definedOf(c) };
      const now = nowIso();
      await (await sessionOf(tx)).execute(sql`
        INSERT INTO "stream_channels" ("channel_id", "uploads_playlist_id", "uploads_fetched_at", "name", "kind", "zones", "seasons", "priority", "state",
          "blacklisted", "blacklist_reason", "blacklist_source", "proposed_by", "admin_edited_at", "last_playlist_at", "last_search_at", "updated_at", "created_at")
        VALUES (${n.channelId}, ${n.uploadsPlaylistId}, ${iso(n.uploadsFetchedAt)}::timestamptz, ${n.name}, ${n.kind}, ${JSON.stringify(n.zones)}::jsonb,
          ${JSON.stringify(n.seasons)}::jsonb, ${n.priority}::numeric, ${n.state}, ${n.blacklisted}::boolean, ${n.blacklistReason}, ${n.blacklistSource},
          ${n.proposedBy}, ${iso(n.adminEditedAt)}::timestamptz, ${iso(n.lastPlaylistAt)}::timestamptz, ${iso(n.lastSearchAt)}::timestamptz,
          ${now}::timestamptz, ${now}::timestamptz)
        ON CONFLICT ("channel_id") DO UPDATE SET "uploads_playlist_id" = EXCLUDED."uploads_playlist_id", "uploads_fetched_at" = EXCLUDED."uploads_fetched_at",
          "name" = EXCLUDED."name", "kind" = EXCLUDED."kind", "zones" = EXCLUDED."zones", "seasons" = EXCLUDED."seasons", "priority" = EXCLUDED."priority",
          "state" = EXCLUDED."state", "blacklisted" = EXCLUDED."blacklisted", "blacklist_reason" = EXCLUDED."blacklist_reason",
          "blacklist_source" = EXCLUDED."blacklist_source", "proposed_by" = EXCLUDED."proposed_by", "admin_edited_at" = EXCLUDED."admin_edited_at",
          "last_playlist_at" = EXCLUDED."last_playlist_at", "last_search_at" = EXCLUDED."last_search_at", "updated_at" = EXCLUDED."updated_at"`);
    },
    async watchedCount(tx) {
      const { rows } = await (await execOf(tx)).execute(sql`
        SELECT count(*)::int AS "n" FROM "stream_channels" WHERE "state" = 'watched' AND COALESCE("blacklisted", false) = false`);
      return Number(rows[0]?.n ?? 0);
    },
    async deleteSource(tx, sourceId) {
      await (await sessionOf(tx)).execute(sql`DELETE FROM "stream_sources" WHERE "source_id" = ${sourceId}`);
    },
  };
  return store;
}

const inList = (column: string, values: readonly string[]): SqlQuery =>
  values.length ? sql`${sql.identifier(column)} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})` : sql`FALSE`;

function definedOf<T extends object>(v: T): Partial<T> {
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Partial<T>;
}

function ms(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}
const iso = (t: number | null | undefined): string | null => (t === null || t === undefined ? null : new Date(t).toISOString());
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function candidateOf(r: Record<string, unknown>): StoredCandidate {
  return {
    videoId: String(r.video_id),
    channelId: str(r.channel_id),
    foundBy: strings(r.found_by) as StoredCandidate['foundBy'],
    state: String(r.state) as StoredCandidate['state'],
    reason: str(r.reason) as StoredCandidate['reason'],
    eventId: str(r.event_id),
    sourceId: str(r.source_id),
    liveBroadcastContent: str(r.live_broadcast_content),
    scheduledStartTime: ms(r.scheduled_start_time),
    embeddable: bool(r.embeddable),
    privacyStatus: str(r.privacy_status),
    ytFetchedAt: ms(r.yt_fetched_at),
    checkedAt: ms(r.checked_at),
    stateChangedAt: ms(r.state_changed_at),
    stateChangedBy: str(r.state_changed_by),
    evidenceUrl: str(r.evidence_url),
    note: str(r.note),
  };
}

function channelOf(r: Record<string, unknown>): StoredStreamChannel {
  return {
    channelId: String(r.channel_id),
    uploadsPlaylistId: str(r.uploads_playlist_id),
    uploadsFetchedAt: ms(r.uploads_fetched_at),
    name: str(r.name) ?? '',
    kind: str(r.kind) ?? '',
    zones: strings(r.zones),
    seasons: strings(r.seasons),
    priority: Number(r.priority) || 3,
    state: (str(r.state) ?? 'off') as StoredStreamChannel['state'],
    blacklisted: r.blacklisted === true,
    blacklistReason: str(r.blacklist_reason),
    blacklistSource: str(r.blacklist_source),
    proposedBy: str(r.proposed_by),
    adminEditedAt: ms(r.admin_edited_at),
    lastPlaylistAt: ms(r.last_playlist_at),
    lastSearchAt: ms(r.last_search_at),
  };
}
