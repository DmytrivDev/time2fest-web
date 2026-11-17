/**
 * Catalog use cases (ring 3): integrity of a pending write (AC-49) and the version bump with the
 * "Catalog changed" event (AC-67). No Payload import; every call carries the caller's transaction.
 */
import { fail, ok, type ApiResult, type CatalogPayload, type CatalogReason } from '@time2fest/contracts';
import { assembleCatalog, type CatalogRows } from '../domain/catalog/assemble';
import {
  applyChange,
  checkCatalog,
  newViolations,
  toSnapshotRow,
  type CatalogChange,
  type Violation,
} from '../domain/catalog/integrity';
import { bumpedMeta } from '../domain/catalog/version';
import type { EventPublisher, Tx } from '../events/ports';
import type { Clock } from '../ports';
import type { CatalogReader, CatalogStore, SeasonStore } from './ports';
import { CatalogChangedSchema } from '@time2fest/contracts/schemas';

export const CATALOG_CHANGED_TOPIC = 'catalog.changed';

/** A write that would break catalog integrity; `violations` name the rules. */
export class CatalogIntegrityError extends Error {
  readonly violations: Violation[];

  constructor(violations: Violation[]) {
    super(`catalog integrity: ${violations.map((v) => v.rule).join(', ')}`);
    this.name = 'CatalogIntegrityError';
    this.violations = violations;
  }
}

/** Refuses a write that introduces a violation the catalog did not have before it. */
export async function assertIntegrityAfter(reader: CatalogReader, tx: Tx, change: CatalogChange): Promise<void> {
  const before = await reader.snapshot(tx);
  const introduced = newViolations(checkCatalog(before), checkCatalog(applyChange(before, change)));
  if (introduced.length > 0) throw new CatalogIntegrityError(introduced);
}

/**
 * A catalog record changed: sets the season's `generatedAt` to server time and publishes
 * `catalog.changed` `{ version, at }` in the same transaction. No season → nothing to version.
 */
export async function recordCatalogChange(
  deps: { seasons: SeasonStore; publisher: EventPublisher; clock: Clock },
  tx: Tx,
): Promise<{ version: string } | null> {
  const season = await deps.seasons.current(tx);
  if (!season) return null;
  const { generatedAt, version } = bumpedMeta(season, deps.clock.now());
  await deps.seasons.setGeneratedAt(tx, season.id, generatedAt);
  await deps.publisher.publish(tx, CATALOG_CHANGED_TOPIC, CatalogChangedSchema.parse({ version, at: generatedAt }));
  return { version };
}

const INVALID: CatalogReason = 'catalog-invalid';

/** The stored catalog as the integrity rules see it; hidden events never count. */
function snapshotOf(stored: Awaited<ReturnType<CatalogStore['read']>>) {
  return {
    zones: stored.zones.map((r) => toSnapshotRow('zones', r)),
    countries: stored.countries.map((r) => toSnapshotRow('countries', r)),
    cities: stored.cities.map((r) => toSnapshotRow('cities', r)),
    events: stored.events.map((r) => toSnapshotRow('events', r)),
  };
}

/**
 * `GET /api/catalog` (AC-63, AC-65): the catalog in the shape of `data/`, or `unavailable` with the reason
 * `catalog-invalid` when there is no season or a record breaks an integrity rule.
 */
export async function readCatalog(store: CatalogStore): Promise<ApiResult<CatalogPayload>> {
  const stored = await store.read();
  if (!stored.season || checkCatalog(snapshotOf(stored)).length > 0) return fail('unavailable', { reason: INVALID });
  const rows: CatalogRows = { ...stored, season: stored.season };
  return ok(assembleCatalog(rows));
}

/** A moment of a night other than midnight (AC-66), for the consumers of SPEC-12. */
export interface NonMidnightEvent {
  eventId: string;
  cityId: string;
  zoneId: string;
  countryIso: string;
  slot: string;
  startsAt: string;
}

/** A stored `startsAt` as an ISO instant, or `null` when it is absent or not a date. */
function instantOf(value: unknown): string | null {
  if (typeof value !== 'string' && !(value instanceof Date)) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/**
 * Read port: events of a kind other than `midnight`, with their own `startsAt` (AC-66). Such an
 * event without a valid `startsAt` breaks AC-48 (a write without it is refused), so it can only come
 * from outside the API; it has no moment and is left out rather than failing the whole read.
 */
export async function nonMidnightEvents(store: CatalogStore): Promise<NonMidnightEvent[]> {
  const stored = await store.read();
  return stored.events.flatMap((e) => {
    if (e.slot === undefined || e.slot === null || e.slot === 'midnight') return [];
    const startsAt = instantOf(e.startsAt);
    if (startsAt === null) return [];
    return [
      {
        eventId: String(e.eventId),
        cityId: String(e.cityId),
        zoneId: String(e.zoneId),
        countryIso: String(e.countryIso),
        slot: String(e.slot),
        startsAt,
      },
    ];
  });
}

/** Read port: the midnight moment of every zone. */
export async function zoneMoments(store: CatalogStore): Promise<{ zoneId: string; midnightUtc: string }[]> {
  const stored = await store.read();
  return [...stored.zones]
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((z) => ({ zoneId: String(z.zoneId), midnightUtc: String(z.midnightUtc) }));
}
