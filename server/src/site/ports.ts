/**
 * Ports of the site state (SPEC-08 AC-4, AC-18), ring 2: technology-neutral.
 *
 * Lock order: a transaction that changes the site record takes the site lock BEFORE it publishes any
 * internal event (the outbox has its own lock), so a site change and a correction or catalog change
 * never wait on each other's lock in opposite orders.
 */
import type { SiteState, SiteSwitches } from '@time2fest/contracts';
import type { CatalogProduct, ProductSelections } from '../domain/site/products';
import type { SiteRecord } from '../domain/site/snapshot';
import type { PaymentsPause } from '../domain/site/switches';
import type { Tx } from '../events/ports';

export type { Tx, CatalogProduct, SiteRecord };

/** What a change writes; the store adds `version + 1` and `at`. */
export interface SiteRecordPatch {
  switches?: SiteSwitches;
  paymentsPause?: PaymentsPause;
  productSelections?: ProductSelections;
}

export interface SiteStore {
  /** Runs `fn` in one transaction: `tx`'s when given (joined), else a new one; a throw rolls it back. */
  inTransaction<T>(tx: Tx | null, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /**
   * The stored record (defaults before the first write). Inside a transaction it first takes the site lock,
   * held until the transaction ends, so a read-decide-write never loses another writer's change.
   */
  read(tx?: Tx): Promise<SiteRecord>;
  /** Writes `patch` with `version + 1` and `at` = now, under the site lock, in `tx`; returns the new record. */
  write(tx: Tx, patch: SiteRecordPatch): Promise<SiteRecord>;
  /** `version + 1` (and `at` = now) in `tx`, under the site lock: a change outside the record (patch, catalog). */
  bumpVersion(tx: Tx): Promise<number>;
}

/** What a correction or catalog change needs: the site version grows in the same transaction (AC-4). */
export type SiteVersionBump = Pick<SiteStore, 'bumpVersion'>;

/** The products port (AC-18): the default adapter is empty in every class; a fake only in `test`. */
export interface ProductCatalog {
  list(): Promise<readonly CatalogProduct[]>;
}

/**
 * Where a committed snapshot goes (SPEC-08 AC-5 … AC-7, AC-33, AC-37): realtime publish, edge purge,
 * R2 copy. Implemented and used by the after-commit fan-out (S·P4); never called inside a transaction.
 */
export interface SnapshotSink {
  publish(state: SiteState): Promise<void>;
  purge(): Promise<void>;
  copy(state: SiteState): Promise<void>;
}

/** The persisted rebuild state of the site record (`rebuildDueAt`, `rebuildDeferred`). */
export interface RebuildStore {
  /**
   * Moves the due time to `dueAt`, never earlier than the stored one. With `keepDeferred`, a launch already
   * deferred to the window's end stays where it is.
   */
  schedule(dueAt: number, keepDeferred: boolean): Promise<void>;
  /** The pending launch, or `null`. */
  pending(): Promise<{ dueAt: number; deferred: boolean } | null>;
  /**
   * Claims the launch due at `dueAt` (conditional on the stored due time being exactly `dueAt`): `next` =
   * `null` clears it, a number defers it to that time. True for exactly one caller across instances.
   */
  claim(dueAt: number, next: number | null): Promise<boolean>;
}

/** Starts one rebuild; throws when it was not accepted. */
export interface RebuildLauncher {
  launch(catalogVersion: string): Promise<void>;
}

/** Claims the fan-out of one version across instances: true for exactly one caller per version, and never for a version ≤ one already claimed. */
export interface FanOutClaim {
  claim(version: number): Promise<boolean>;
}
