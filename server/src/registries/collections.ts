/**
 * Collection registry (AC-62): sorted, unique rows. `resettable` marks the collections the
 * test reset door may clear.
 */
import type { CollectionConfig } from 'payload';
import { assertRegistry } from '../platform/registry';
import { admins } from '../collections/admins';
import { idempotencyRecords } from '../collections/idempotencyRecords';

export interface CollectionRow {
  key: string;
  collection: CollectionConfig;
  resettable: boolean;
}

export const collectionRegistry: readonly CollectionRow[] = [
  { key: 'admins', collection: admins, resettable: false },
  { key: 'idempotency-records', collection: idempotencyRecords, resettable: true },
];

assertRegistry('collections', collectionRegistry, (r) => r.key);
