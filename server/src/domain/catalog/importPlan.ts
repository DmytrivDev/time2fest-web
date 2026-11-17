/**
 * Import plan (AC-75 … AC-77), ring 1: pure. Compares the rows of the data files with the rows in
 * the database and puts each into one of four groups.
 *
 * - `add`: not in the database.
 * - `change`: in the database, untouched by an admin, and the source differs.
 * - `same`: nothing to write (a row that equals the source but has no stored hash only gets its hash filled in).
 * - `skipped-admin-edited`: the row in the database no longer matches the hash stored at its last import.
 */
import { rowHash, type CatalogCollection, type SourceRow } from './fromData';

export const PLAN_GROUPS = ['add', 'change', 'same', 'skipped-admin-edited'] as const;
export type PlanGroup = (typeof PLAN_GROUPS)[number];

/** A row as stored: its id, the hash kept at its last import and its fields. */
export interface DbRow {
  id: string;
  importedHash: string | null;
  data: Record<string, unknown>;
}

export type DbRows = Record<CatalogCollection, Map<string, DbRow>>;

export interface PlanEntry {
  group: PlanGroup;
  row: SourceRow;
  /** The id of the stored row (every group but `add`). */
  existingId?: string;
  /** The row equals the source but has no hash: write the hash, nothing else. */
  backfillHash?: true;
}

export interface ImportPlan {
  entries: PlanEntry[];
  counts: Record<PlanGroup, number>;
}

export function emptyDbRows(): DbRows {
  return {
    zones: new Map(),
    countries: new Map(),
    cities: new Map(),
    events: new Map(),
    traditions: new Map(),
  };
}

export function planImport(source: readonly SourceRow[], db: DbRows): ImportPlan {
  const entries: PlanEntry[] = [];
  const counts: Record<PlanGroup, number> = { add: 0, change: 0, same: 0, 'skipped-admin-edited': 0 };
  for (const row of source) {
    const stored = db[row.collection].get(row.key);
    const entry = decide(row, stored);
    counts[entry.group] += 1;
    entries.push(entry);
  }
  return { entries, counts };
}

function decide(row: SourceRow, stored: DbRow | undefined): PlanEntry {
  if (!stored) return { group: 'add', row };
  const current = rowHash(row.collection, stored.data);
  if (current === row.hash) {
    return stored.importedHash === row.hash
      ? { group: 'same', row, existingId: stored.id }
      : { group: 'same', row, existingId: stored.id, backfillHash: true };
  }
  if (stored.importedHash === null || current !== stored.importedHash) {
    return { group: 'skipped-admin-edited', row, existingId: stored.id };
  }
  return { group: 'change', row, existingId: stored.id };
}

/** The report of a plan: the four groups, each with its record keys. */
export function reportLines(plan: ImportPlan): string[] {
  const titles: Record<PlanGroup, string> = {
    add: 'add',
    change: 'change',
    same: 'same',
    'skipped-admin-edited': 'skipped (changed in the admin)',
  };
  const lines: string[] = [];
  for (const group of PLAN_GROUPS) {
    const keys = plan.entries.filter((e) => e.group === group).map((e) => `${e.row.collection}/${e.row.key}`);
    lines.push(`${titles[group]}: ${keys.length}`);
    for (const key of keys) lines.push(`  ${key}`);
  }
  return lines;
}
