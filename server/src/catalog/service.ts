/**
 * Catalog use cases (ring 3): integrity of a pending write (AC-49) and the version bump with the
 * "Catalog changed" event (AC-67). No Payload import; every call carries the caller's transaction.
 */
import {
  applyChange,
  checkCatalog,
  newViolations,
  type CatalogChange,
  type Violation,
} from '../domain/catalog/integrity';
import { bumpedMeta } from '../domain/catalog/version';
import type { EventPublisher, Tx } from '../events/ports';
import type { Clock } from '../ports';
import type { CatalogReader, SeasonStore } from './ports';

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
  await deps.publisher.publish(tx, CATALOG_CHANGED_TOPIC, { version, at: generatedAt });
  return { version };
}
