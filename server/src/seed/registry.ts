/**
 * Seed registry (AC-45, AC-62): sorted, unique rows, each naming its collection, its natural
 * key and the one source it reads. Only the sources of AC-45 are allowed (paths relative to
 * `web/`); the scout output `data/streams.candidates.json` is never seeded, and nothing outside
 * the list is read. SPEC-04 adds the six catalog rows; later domain waves add theirs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CountriesFileSchema, ScheduleFileSchema } from '@time2fest/contracts/schemas';
import { fromData, type CatalogCollection } from '../domain/catalog/fromData';
import { chainsFromData } from '../live/import';
import { assertRegistry } from '../platform/registry';

/** A source the seed may read (AC-45). */
export type AllowedSource = `data/${string}.json` | `scripts/seed/${string}.seed.json` | 'lib/demo/seed.ts';

export interface SeedRow {
  key: string;
  /** Payload collection slug. */
  collection: string;
  /** Field that identifies a row across runs (ISO code, event id, videoId, …): the upsert key. */
  naturalKey: string;
  /** Where the rows come from; `fixture` = invented data defined inside `server/`. */
  source: AllowedSource | 'fixture';
  /** Applied only through `POST /api/_test/fixtures`, never by the seed itself. */
  fixture?: true;
  rows(): Promise<object[]>;
}

const NAME = '[A-Za-z0-9][A-Za-z0-9._-]*';
const ALLOWED_PATTERNS: readonly RegExp[] = [
  new RegExp(`^data/${NAME}\\.json$`),
  new RegExp(`^scripts/seed/${NAME}\\.seed\\.json$`),
  /^lib\/demo\/seed\.ts$/,
];

/** Never seeded even though it matches `data/*.json` (AC-45). */
const FORBIDDEN: ReadonlySet<string> = new Set(['data/streams.candidates.json']);

/** The AC-45 list, as checked at run time (a type alone is not enough for `as` casts). */
export const ALLOWED_SOURCES: readonly string[] = [
  'data/*.json (except data/streams.candidates.json)',
  'scripts/seed/*.seed.json',
  'lib/demo/seed.ts',
  'fixture',
];

export function isAllowedSource(source: string): boolean {
  if (source === 'fixture') return true;
  if (FORBIDDEN.has(source) || source.includes('..')) return false;
  return ALLOWED_PATTERNS.some((p) => p.test(source));
}

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');

function readData(file: 'schedule.json' | 'countries.json' | 'streams.json'): unknown {
  return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
}

/** Both data files mapped by the same function as `import catalog` (AC-88): one row set, two writers. */
function catalogSource() {
  return fromData(ScheduleFileSchema.parse(readData('schedule.json')), CountriesFileSchema.parse(readData('countries.json')));
}

/** The rows of one catalog collection with the import hash, so an `import catalog` after the seed sees "same". */
function catalogRows(collection: CatalogCollection): () => Promise<object[]> {
  return async () =>
    catalogSource()
      .rows.filter((r) => r.collection === collection)
      .map((r) => ({ ...r.data, importedHash: r.hash }));
}

function catalogRow(order: number, collection: CatalogCollection, naturalKey: string, source: 'data/schedule.json' | 'data/countries.json'): SeedRow {
  return { key: `catalog-${order}-${collection}`, collection, naturalKey, source, rows: catalogRows(collection) };
}

/** The season of the catalog: the same record `import catalog --apply` writes on an empty database. */
const seasonRow: SeedRow = {
  key: 'catalog-1-seasons',
  collection: 'seasons',
  naturalKey: 'key',
  source: 'data/schedule.json',
  async rows() {
    const { season } = catalogSource();
    return [{ key: season.key, generatedAt: season.generatedAt, tzdbVersion: season.tzdbVersion }];
  },
};

const isoOf = (t: number | null): string | null => (t === null ? null : new Date(t).toISOString());

/** The stream sources of `data/streams.json`: the rows `import chains --apply` adds on an empty database (AC-70). */
const streamSourcesRow: SeedRow = {
  key: 'live-1-stream-sources',
  collection: 'stream-sources',
  naturalKey: 'sourceId',
  source: 'data/streams.json',
  async rows() {
    return chainsFromData(readData('streams.json')).map((s) => ({
      ...s,
      startsAt: isoOf(s.startsAt),
      lastChecked: isoOf(s.lastChecked),
    }));
  },
};

// The sorted keys give the dependency order: season, zones, countries, cities, events, traditions.
export const seedRegistry: readonly SeedRow[] = [
  seasonRow,
  catalogRow(2, 'zones', 'zoneId', 'data/schedule.json'),
  catalogRow(3, 'countries', 'iso', 'data/countries.json'),
  catalogRow(4, 'cities', 'cityId', 'data/schedule.json'),
  catalogRow(5, 'events', 'eventId', 'data/schedule.json'),
  catalogRow(6, 'traditions', 'traditionId', 'data/countries.json'),
  streamSourcesRow,
];

assertRegistry('seed', seedRegistry, (r) => r.key);
