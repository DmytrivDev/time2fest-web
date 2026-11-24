/**
 * Stream channels and candidates store (SPEC-21a), ring 4: raw SQL on the `stream_channels` / `stream_candidates`
 * tables. Payload rows never leave this file. Every write takes the caller's `tx` (the same transaction as its
 * journal row). This phase holds the channel reads and writes of `import channels`; later phases extend it.
 */
import { sql } from '@payloadcms/db-postgres';
import type { Payload, PayloadRequest } from 'payload';
import type { ChannelImportStore, ImportedChannel, StoredChannel } from '../live/importChannels';
import type { Tx } from '../live/ports';
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

export interface PayloadStreamsStore extends ChannelImportStore {
  /** Marks a channel as edited in the admin (the import then skips it). */
  markChannelAdminEdited(tx: Tx, channelId: string, at: number): Promise<void>;
}

export function createPayloadStreamsStore(deps: PayloadStreamsDeps): PayloadStreamsStore {
  const nowIso = () => new Date(deps.clock.now()).toISOString();
  return {
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
  };
}
