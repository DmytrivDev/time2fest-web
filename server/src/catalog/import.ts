/**
 * `import catalog` (AC-64, AC-67, AC-75 to AC-78, AC-81), ring 3: the data files to the catalog in the
 * database. No Payload import: it works through ports.
 *
 * Order: validate both files against the shared schemas (nothing else happens when they fail), read the
 * stored rows, plan (add / change / same / skipped-admin-edited), and print the report. Only with `apply`
 * anything is written: in one transaction, the added and changed rows (each journaled as `system:import`
 * by the audit hook), the season meta, one summary journal row, and one `catalog.changed` event, the last
 * only if something changed.
 */
import { catalogVersionOf, type CatalogCountries, type CatalogSchedule } from '@time2fest/contracts';
import { CatalogChangedSchema, CountriesFileSchema, ScheduleFileSchema } from '@time2fest/contracts/schemas';
import type { Journal } from '../audit/ports';
import { fromData, IMPORTED_FIELDS, NATURAL_KEYS, type CatalogCollection } from '../domain/catalog/fromData';
import { emptyDbRows, planImport, reportLines, type DbRows, type ImportPlan } from '../domain/catalog/importPlan';
import { bumpedMeta } from '../domain/catalog/version';
import type { EventPublisher } from '../events/ports';
import type { Clock } from '../ports';
import type { CatalogImportStore, StoredCatalog } from './ports';
import { CATALOG_CHANGED_TOPIC } from './service';

export const IMPORT_ACTION = 'catalog.import';
export const SCHEDULE_FILE = 'schedule.json';
export const COUNTRIES_FILE = 'countries.json';

export interface CatalogImportPorts {
  store: CatalogImportStore;
  publisher: EventPublisher;
  journal: Journal;
  clock: Clock;
}

export interface ImportRun {
  apply: boolean;
  /** The parsed content of a source file; throws when it cannot be read. */
  readSource(file: string): unknown;
}

export interface ImportResult {
  code: 0 | 1;
  lines: string[];
  plan?: ImportPlan;
  /** Set when `apply` wrote the season: the catalog version after the run. */
  version?: string;
  published?: boolean;
}

const MAX_ISSUES = 20;

interface Checked<T> {
  ok: boolean;
  data?: T;
  lines: string[];
}

function check<T>(
  file: string,
  schema: {
    safeParse(v: unknown): { success: true; data: unknown } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
  },
  raw: unknown,
): Checked<T> {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data as T, lines: [] };
  const lines = parsed.error.issues
    .slice(0, MAX_ISSUES)
    .map((i) => `${file}: ${i.path.map(String).join('.') || '(root)'}: ${i.message}`);
  return { ok: false, lines };
}

function project(collection: CatalogCollection, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of IMPORTED_FIELDS[collection]) out[field] = row[field];
  return out;
}

function dbRowsOf(stored: StoredCatalog): DbRows {
  const db = emptyDbRows();
  for (const collection of Object.keys(NATURAL_KEYS) as CatalogCollection[]) {
    for (const row of stored[collection]) {
      db[collection].set(String(row[NATURAL_KEYS[collection]]), {
        id: String(row.id),
        importedHash: typeof row.importedHash === 'string' && row.importedHash ? row.importedHash : null,
        data: project(collection, row),
      });
    }
  }
  return db;
}

export async function importCatalog(ports: CatalogImportPorts, run: ImportRun): Promise<ImportResult> {
  let scheduleRaw: unknown;
  let countriesRaw: unknown;
  try {
    scheduleRaw = run.readSource(SCHEDULE_FILE);
  } catch {
    return { code: 1, lines: [`${SCHEDULE_FILE}: cannot be read`] };
  }
  try {
    countriesRaw = run.readSource(COUNTRIES_FILE);
  } catch {
    return { code: 1, lines: [`${COUNTRIES_FILE}: cannot be read`] };
  }
  const schedule = check<CatalogSchedule>(SCHEDULE_FILE, ScheduleFileSchema, scheduleRaw);
  const countries = check<CatalogCountries>(COUNTRIES_FILE, CountriesFileSchema, countriesRaw);
  if (!schedule.ok || !countries.ok || !schedule.data || !countries.data) {
    return { code: 1, lines: [...schedule.lines, ...countries.lines] };
  }

  const source = fromData(schedule.data, countries.data);
  const stored = await ports.store.read();
  const plan = planImport(source.rows, dbRowsOf(stored));
  const lines = reportLines(plan);
  if (!run.apply) return { code: 0, lines: ['dry run: nothing is written', ...lines], plan };

  const changed = plan.counts.add + plan.counts.change;
  const tx = await ports.store.begin();
  try {
    for (const entry of plan.entries) {
      const data = { ...entry.row.data, importedHash: entry.row.hash };
      if (entry.group === 'add') {
        await ports.store.create(tx, entry.row.collection, data);
      } else if (entry.group === 'change' && entry.existingId) {
        await ports.store.update(tx, entry.row.collection, entry.existingId, data);
      } else if (entry.backfillHash && entry.existingId) {
        await ports.store.update(tx, entry.row.collection, entry.existingId, { importedHash: entry.row.hash }, { silent: true });
      }
    }
    let version: string | undefined;
    let published = false;
    const season = stored.season;
    if (changed > 0 || !season) {
      // The source's time, unless the catalog is already at or past it (an admin change bumped it): then one second on.
      const generatedAt =
        season && season.generatedAt >= source.season.generatedAt
          ? bumpedMeta(season, Date.parse(source.season.generatedAt)).generatedAt
          : source.season.generatedAt;
      await ports.store.writeSeason(tx, {
        ...(season ? { id: season.id } : {}),
        key: season?.key ?? source.season.key,
        generatedAt,
        tzdbVersion: source.season.tzdbVersion,
      });
      version = catalogVersionOf({ generatedAt, tzdbVersion: source.season.tzdbVersion });
      await ports.publisher.publish(tx, CATALOG_CHANGED_TOPIC, CatalogChangedSchema.parse({ version, at: generatedAt }));
      published = true;
    }
    await ports.journal.append(tx, {
      actor: { kind: 'system', id: 'import', label: 'import' },
      action: IMPORT_ACTION,
      target: { collection: 'catalog', id: 'import' },
      at: ports.clock.now(),
      before: null,
      after: { ...plan.counts, ...(version ? { version } : {}) },
      revertOf: null,
    });
    await ports.store.commit(tx);
    return { code: 0, lines: ['applied', ...lines], plan, ...(version ? { version } : {}), published };
  } catch (err) {
    await ports.store.rollback(tx);
    return { code: 1, lines: [`import failed and was rolled back: ${err instanceof Error ? err.name : 'error'}`] };
  }
}
