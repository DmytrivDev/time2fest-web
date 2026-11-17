/**
 * Seed registry (AC-45, AC-62): sorted, unique rows, each naming its collection, its natural
 * key and the one source it reads. Only the sources of AC-45 are allowed (paths relative to
 * `web/`); the scout output `data/streams.candidates.json` is never seeded, and nothing outside
 * the list is read. Empty in SPEC-02; domain waves add their rows.
 */
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

export const seedRegistry: readonly SeedRow[] = [];

assertRegistry('seed', seedRegistry, (r) => r.key);
