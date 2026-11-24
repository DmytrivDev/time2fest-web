/**
 * `import channels` (SPEC-21a AC-40 ... AC-42), ring 3: `data/stream-channels.json` to the `stream-channels` rows. No
 * Payload import: it works through ports, like `live/import.ts`.
 *
 * Order: validate the file, read the stored rows, plan, print the report. Only with `apply` anything is written, in one
 * transaction with ONE journal row. No version bump, no event, no YouTube call: a new channel lands in state `watched`
 * with an empty uploads playlist (filled by the watch job). A channel with `adminEditedAt` is never written; an entry
 * of the blacklist is only added, never removed, and `blacklisted` is never unset.
 */
import { StreamChannelsFileSchema } from '@time2fest/contracts/schemas';
import { z } from 'zod';
import type { Journal } from '../audit/ports';
import type { Clock } from '../ports';
import type { LiveStore, Tx } from './ports';

export const CHANNELS_IMPORT_ACTION = 'streams.channels-import';
export const CHANNELS_FILE = 'stream-channels.json';
const IMPORT_SOURCE = 'import';

export interface ImportedChannel {
  channelId: string;
  name: string;
  kind: string;
  zones: string[];
  seasons: string[];
  priority: number;
}

export interface StoredChannel extends ImportedChannel {
  blacklisted: boolean;
  blacklistSource: string | null;
  /** Edited in the admin (`adminEditedAt` set). */
  protected: boolean;
}

export interface ChannelImportStore {
  readChannels(): Promise<StoredChannel[]>;
  addChannel(tx: Tx, channel: ImportedChannel): Promise<void>;
  changeChannel(tx: Tx, channel: ImportedChannel): Promise<void>;
  /** A blacklist entry of a channel that has no row yet. */
  addBlacklisted(tx: Tx, channelId: string, reason: string, source: string): Promise<void>;
  /** A blacklist entry of a stored, not yet blacklisted channel. */
  blacklistExisting(tx: Tx, channelId: string, reason: string, source: string): Promise<void>;
}

export type ChannelGroup = 'add' | 'change' | 'same' | 'skipped-admin-edited';
export type BlacklistGroup = 'add' | 'same' | 'kept-admin';
const GROUPS: readonly ChannelGroup[] = ['add', 'change', 'same', 'skipped-admin-edited'];
const BL_GROUPS: readonly BlacklistGroup[] = ['add', 'same', 'kept-admin'];

export interface ChannelsPlan {
  channels: { group: ChannelGroup; channel: ImportedChannel }[];
  blacklist: { group: BlacklistGroup; channelId: string; reason: string; stored: boolean }[];
  counts: Record<ChannelGroup, number>;
  blacklistCounts: Record<BlacklistGroup, number>;
}

export interface ChannelsImportResult {
  code: 0 | 1;
  lines: string[];
  plan?: ChannelsPlan;
}

export interface ChannelsImportPorts {
  live: LiveStore;
  channels: ChannelImportStore;
  journal: Journal;
  clock: Clock;
}

export interface ChannelsFileRows {
  channels: ImportedChannel[];
  blacklist: { channelId: string; reason: string }[];
}

const byId = <T extends { channelId: string }>(a: T, b: T) => (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0);

/** The rows of the file; throws on an invalid file. */
export function channelsFromData(raw: unknown): ChannelsFileRows {
  const file = StreamChannelsFileSchema.parse(raw);
  const channels = new Map<string, ImportedChannel>();
  for (const c of file.channels) {
    channels.set(c.channelId, { channelId: c.channelId, name: c.name, kind: c.kind, zones: [...new Set(c.zones)].sort(), seasons: [file.season], priority: c.priority });
  }
  const blacklist = new Map(file.blacklist.map((b) => [b.channelId, b.reason]));
  return {
    channels: [...channels.values()].sort(byId),
    blacklist: [...blacklist].map(([channelId, reason]) => ({ channelId, reason })).sort(byId),
  };
}

const sameFields = (have: StoredChannel, want: ImportedChannel): boolean =>
  have.name === want.name &&
  have.kind === want.kind &&
  have.priority === want.priority &&
  JSON.stringify([...have.zones].sort()) === JSON.stringify(want.zones) &&
  want.seasons.every((s) => have.seasons.includes(s));

/** Pure plan: what an import would do with the stored rows. A changed channel keeps the seasons it already has. */
export function planChannels(file: ChannelsFileRows, stored: readonly StoredChannel[]): ChannelsPlan {
  const have = new Map(stored.map((s) => [s.channelId, s]));
  const counts: Record<ChannelGroup, number> = { add: 0, change: 0, same: 0, 'skipped-admin-edited': 0 };
  const blacklistCounts: Record<BlacklistGroup, number> = { add: 0, same: 0, 'kept-admin': 0 };
  const channels = file.channels.map((channel) => {
    const row = have.get(channel.channelId);
    const group: ChannelGroup = !row ? 'add' : row.protected ? 'skipped-admin-edited' : sameFields(row, channel) ? 'same' : 'change';
    counts[group] += 1;
    const out = group === 'change' && row ? { ...channel, seasons: [...new Set([...row.seasons, ...channel.seasons])].sort() } : channel;
    return { group, channel: out };
  });
  const blacklist = file.blacklist.map((b) => {
    const row = have.get(b.channelId);
    const group: BlacklistGroup = row?.blacklisted ? (row.blacklistSource === IMPORT_SOURCE ? 'same' : 'kept-admin') : 'add';
    blacklistCounts[group] += 1;
    return { group, channelId: b.channelId, reason: b.reason, stored: row !== undefined };
  });
  return { channels, blacklist, counts, blacklistCounts };
}

export function channelsReportLines(plan: ChannelsPlan): string[] {
  const titles: Record<ChannelGroup, string> = { add: 'add', change: 'change', same: 'same', 'skipped-admin-edited': 'skipped (changed in the admin)' };
  const lines: string[] = [];
  for (const group of GROUPS) {
    const keys = plan.channels.filter((e) => e.group === group).map((e) => `stream-channels/${e.channel.channelId}`);
    lines.push(`${titles[group]}: ${keys.length}`);
    for (const key of keys) lines.push(`  ${key}`);
  }
  for (const group of BL_GROUPS) {
    const keys = plan.blacklist.filter((e) => e.group === group).map((e) => `blacklist/${e.channelId}`);
    lines.push(`blacklist ${group}: ${keys.length}`);
    for (const key of keys) lines.push(`  ${key}`);
  }
  return lines;
}

export async function importChannels(ports: ChannelsImportPorts, run: { apply: boolean; readSource(file: string): unknown }): Promise<ChannelsImportResult> {
  let raw: unknown;
  try {
    raw = run.readSource(CHANNELS_FILE);
  } catch {
    return { code: 1, lines: [`${CHANNELS_FILE}: cannot be read`] };
  }
  let file: ChannelsFileRows;
  try {
    file = channelsFromData(raw);
  } catch (err) {
    const issues = err instanceof z.ZodError ? err.issues.slice(0, 20).map((i) => `${CHANNELS_FILE}: ${i.path.map(String).join('.') || '(root)'}: ${i.message}`) : [];
    return { code: 1, lines: issues.length ? issues : [`${CHANNELS_FILE}: invalid`] };
  }
  const plan = planChannels(file, await ports.channels.readChannels());
  const lines = channelsReportLines(plan);
  if (!run.apply) return { code: 0, lines: ['dry run: nothing is written', ...lines], plan };

  const changed = plan.counts.add + plan.counts.change + plan.blacklistCounts.add;
  if (changed === 0) return { code: 0, lines: ['applied', ...lines], plan };
  try {
    await ports.live.inTransaction(null, async (tx) => {
      for (const e of plan.channels) {
        if (e.group === 'add') await ports.channels.addChannel(tx, e.channel);
        else if (e.group === 'change') await ports.channels.changeChannel(tx, e.channel);
      }
      for (const b of plan.blacklist) {
        if (b.group !== 'add') continue;
        if (b.stored) await ports.channels.blacklistExisting(tx, b.channelId, b.reason, IMPORT_SOURCE);
        else await ports.channels.addBlacklisted(tx, b.channelId, b.reason, IMPORT_SOURCE);
      }
      await ports.journal.append(tx, {
        actor: { kind: 'system', id: 'import', label: 'import' },
        action: CHANNELS_IMPORT_ACTION,
        target: { collection: 'stream-channels', id: 'import' },
        at: ports.clock.now(),
        before: null,
        after: { ...plan.counts, blacklistAdd: plan.blacklistCounts.add, blacklistSame: plan.blacklistCounts.same, blacklistKeptAdmin: plan.blacklistCounts['kept-admin'] },
        revertOf: null,
      });
    });
    return { code: 0, lines: ['applied', ...lines], plan };
  } catch (err) {
    return { code: 1, lines: [`import failed and was rolled back: ${err instanceof Error ? err.name : 'error'}`] };
  }
}
