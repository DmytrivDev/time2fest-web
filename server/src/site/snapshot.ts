/**
 * The snapshot reader (SPEC-08 AC-8, AC-9, AC-37), ring 3: the site record, the corrections' effective
 * patches and the catalog meta, assembled by the pure `buildSnapshot`. No Payload import.
 *
 * Read order matters: the record (its version) is read FIRST, then the patches and the catalog meta.
 * A correction or a catalog change commits its content and the version bump in one transaction, so
 * anything read after the record is at least as new as the record's version: a snapshot never carries a
 * version with content older than that version (AC-37).
 */
import type { SiteEventPatch, SiteState } from '@time2fest/contracts';
import { buildSnapshot } from '../domain/site/snapshot';
import type { SiteStore } from './ports';

export interface CatalogMeta {
  generatedAt: string;
  tzdbVersion: string;
}

export interface SnapshotReadDeps {
  store: Pick<SiteStore, 'read'>;
  /** Every effective event patch by event id (the corrections' read port, `currentPatches`). */
  patches: () => Promise<Readonly<Record<string, SiteEventPatch>>>;
  /** The current season's meta, or `null` when the catalog has no season yet. */
  catalogMeta: () => Promise<CatalogMeta | null>;
}

export type SnapshotRead = { ok: true; state: SiteState } | { ok: false; reason: 'catalog-unavailable' };

/** The current `site` snapshot, outside any transaction. */
export async function readSnapshot(deps: SnapshotReadDeps): Promise<SnapshotRead> {
  const record = await deps.store.read();
  const [patches, catalogMeta] = await Promise.all([deps.patches(), deps.catalogMeta()]);
  if (!catalogMeta) return { ok: false, reason: 'catalog-unavailable' };
  return { ok: true, state: buildSnapshot({ record, patches, catalogMeta }) };
}
