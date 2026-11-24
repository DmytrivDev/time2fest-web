/**
 * `import chains` (SPEC-12 AC-9, AC-68, AC-69), ring 3: `data/streams.json` to the `stream-sources` rows. No Payload
 * import: it works through ports, like `catalog/import.ts`.
 *
 * Order: validate the file, read the stored rows, plan (add / change / same / skipped-admin-edited), print the report.
 * Only with `apply` anything is written, in one transaction: the added and changed rows, one live-version bump, one
 * summary journal row and one `live.changed` (the last three only if something changed). A source with `adminEditedAt`
 * or an `override` is never written; a changed source gets only its static fields (the poller owns status and times).
 */
import { StreamChainSchema } from '@time2fest/contracts/schemas';
import { z } from 'zod';
import type { Journal } from '../audit/ports';
import type { EventPublisher } from '../events/ports';
import { activeSourceCount } from '../domain/live/candidates';
import type { LiveConfig } from '../domain/live/config';
import type { Clock } from '../ports';
import { LIVE_CHANGED_TOPIC, type LiveChangedPayload } from './poller';
import type { ImportedSource, LiveImportStore, LiveStore, StoredImportSource } from './ports';

export const CHAINS_IMPORT_ACTION = 'live.import';
export const STREAMS_FILE = 'streams.json';

const StreamsFileSchema = z.object({ chains: z.array(StreamChainSchema) });

export type ChainsGroup = 'add' | 'change' | 'same' | 'skipped-admin-edited';
const GROUPS: readonly ChainsGroup[] = ['add', 'change', 'same', 'skipped-admin-edited'];

export interface ChainsPlanEntry {
  group: ChainsGroup;
  source: ImportedSource;
}

export interface ChainsPlan {
  entries: ChainsPlanEntry[];
  counts: Record<ChainsGroup, number>;
}

export interface ChainsImportResult {
  code: 0 | 1;
  lines: string[];
  plan?: ChainsPlan;
  version?: number;
}

export interface ChainsImportPorts {
  live: LiveStore;
  sources: LiveImportStore;
  publisher: EventPublisher;
  journal: Journal;
  clock: Clock;
  /** SPEC-21a AC-23: with it, an event the import would take beyond `maxSourcesPerEvent` active sources is refused. */
  cfg?: LiveConfig;
}

const ms = (v: string | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

/** The rows of the file: the one mapping the import and the seed share (AC-70). Throws on an invalid file. */
export function chainsFromData(raw: unknown): ImportedSource[] {
  const file = StreamsFileSchema.parse(raw);
  const out = new Map<string, ImportedSource>();
  for (const chain of file.chains) {
    for (const s of chain.sources) {
      out.set(s.id, {
        sourceId: s.id,
        eventId: chain.eventId,
        platform: s.platform === 'youtube' ? 'youtube' : 'none',
        videoId: s.videoId ?? null,
        kind: s.kind,
        name: s.title.uk,
        order: s.order,
        status: s.status,
        startsAt: ms(s.startsAt),
        embeddable: s.embeddable,
        lastChecked: ms(s.lastChecked),
      });
    }
  }
  return [...out.values()].sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
}

const staticKey = (s: Pick<StoredImportSource, 'eventId' | 'platform' | 'videoId' | 'kind' | 'name' | 'order'>): string =>
  JSON.stringify([s.eventId, s.platform, s.videoId, s.kind, s.name, s.order]);

/** Pure plan: what an import would do with the stored rows. */
export function planChains(rows: readonly ImportedSource[], stored: readonly StoredImportSource[]): ChainsPlan {
  const byId = new Map(stored.map((s) => [s.sourceId, s]));
  const counts: Record<ChainsGroup, number> = { add: 0, change: 0, same: 0, 'skipped-admin-edited': 0 };
  const entries = rows.map((source): ChainsPlanEntry => {
    const have = byId.get(source.sourceId);
    const group: ChainsGroup = !have ? 'add' : have.protected ? 'skipped-admin-edited' : staticKey(have) === staticKey(source) ? 'same' : 'change';
    counts[group] += 1;
    return { group, source };
  });
  return { entries, counts };
}

export function chainsReportLines(plan: ChainsPlan): string[] {
  const titles: Record<ChainsGroup, string> = { add: 'add', change: 'change', same: 'same', 'skipped-admin-edited': 'skipped (changed in the admin)' };
  const lines: string[] = [];
  for (const group of GROUPS) {
    const keys = plan.entries.filter((e) => e.group === group).map((e) => `stream-sources/${e.source.sourceId}`);
    lines.push(`${titles[group]}: ${keys.length}`);
    for (const key of keys) lines.push(`  ${key}`);
  }
  return lines;
}

/**
 * The events the plan would take beyond the ceiling (AC-23): the stored sources with the added and changed rows in
 * place (an added row is active when it has a video; a changed one keeps its stored dead / hidden flags). Only events
 * the import writes are checked.
 */
async function fullEvents(live: LiveStore, plan: ChainsPlan, cfg: LiveConfig): Promise<string[]> {
  const written = plan.entries.filter((e) => e.group === 'add' || e.group === 'change');
  if (written.length === 0) return [];
  const eventIds = [...new Set(written.map((e) => e.source.eventId))].sort();
  const stored = await live.sources({ eventIds });
  const bySource = new Map(stored.map((s) => [s.sourceId, { eventId: s.eventId, videoId: s.videoId ?? null, dead: s.dead, hidden: s.hidden, override: s.override ?? null }]));
  for (const { source } of written) {
    const have = bySource.get(source.sourceId);
    bySource.set(source.sourceId, { eventId: source.eventId, videoId: source.videoId, dead: have?.dead ?? false, hidden: have?.hidden ?? false, override: have?.override ?? null });
  }
  return eventIds.filter((eventId) => activeSourceCount([...bySource.values()].filter((s) => s.eventId === eventId)) > cfg.maxSourcesPerEvent);
}

export async function importChains(ports: ChainsImportPorts, run: { apply: boolean; readSource(file: string): unknown }): Promise<ChainsImportResult> {
  let raw: unknown;
  try {
    raw = run.readSource(STREAMS_FILE);
  } catch {
    return { code: 1, lines: [`${STREAMS_FILE}: cannot be read`] };
  }
  let rows: ImportedSource[];
  try {
    rows = chainsFromData(raw);
  } catch (err) {
    const issues = err instanceof z.ZodError ? err.issues.slice(0, 20).map((i) => `${STREAMS_FILE}: ${i.path.map(String).join('.') || '(root)'}: ${i.message}`) : [];
    return { code: 1, lines: issues.length ? issues : [`${STREAMS_FILE}: invalid`] };
  }
  const plan = planChains(rows, await ports.sources.read());
  const full = ports.cfg ? await fullEvents(ports.live, plan, ports.cfg) : [];
  if (full.length) return { code: 1, lines: full.map((eventId) => `chain-full: ${eventId}`), plan };
  const lines = chainsReportLines(plan);
  if (!run.apply) return { code: 0, lines: ['dry run: nothing is written', ...lines], plan };

  const changed = plan.counts.add + plan.counts.change;
  if (changed === 0) return { code: 0, lines: ['applied', ...lines], plan };
  try {
    const version = await ports.live.inTransaction(null, async (tx) => {
      for (const e of plan.entries) {
        if (e.group === 'add') await ports.sources.add(tx, e.source);
        else if (e.group === 'change') await ports.sources.change(tx, e.source);
      }
      const next = await ports.live.bumpVersion(tx);
      await ports.journal.append(tx, {
        actor: { kind: 'system', id: 'import', label: 'import' },
        action: CHAINS_IMPORT_ACTION,
        target: { collection: 'stream-sources', id: 'import' },
        at: ports.clock.now(),
        before: null,
        after: { ...plan.counts },
        revertOf: null,
      });
      const eventIds = [...new Set(plan.entries.filter((e) => e.group === 'add' || e.group === 'change').map((e) => e.source.eventId))].sort();
      const payload: LiveChangedPayload = { version: next, eventIds };
      await ports.publisher.publish(tx, LIVE_CHANGED_TOPIC, payload);
      return next;
    });
    return { code: 0, lines: ['applied', ...lines], plan, version };
  } catch (err) {
    return { code: 1, lines: [`import failed and was rolled back: ${err instanceof Error ? err.name : 'error'}`] };
  }
}
