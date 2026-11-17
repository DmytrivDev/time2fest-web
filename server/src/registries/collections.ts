/**
 * Collection registry (AC-62): sorted, unique rows. `resettable` marks the collections the
 * test reset door may clear.
 */
import type { CollectionConfig } from 'payload';
import { assertRegistry } from '../platform/registry';
import { admins } from '../collections/admins';
import { agentTestPosts } from '../collections/agentTestPosts';
import { alarms } from '../collections/alarms';
import { auditLog } from '../collections/auditLog';
import { idempotencyRecords } from '../collections/idempotencyRecords';
import { internalEvents } from '../collections/internalEvents';

export interface CollectionRow {
  key: string;
  collection: CollectionConfig;
  resettable: boolean;
  /** Every write is journalled in its own transaction (AC-20); `harden` attaches the hooks. */
  audited?: true;
}

export const collectionRegistry: readonly CollectionRow[] = [
  { key: 'admins', collection: admins, resettable: false, audited: true },
  { key: 'agent-test-posts', collection: agentTestPosts, resettable: false, audited: true },
  { key: 'alarms', collection: alarms, resettable: false, audited: true },
  { key: 'audit-log', collection: auditLog, resettable: false },
  { key: 'idempotency-records', collection: idempotencyRecords, resettable: true },
  { key: 'internal-events', collection: internalEvents, resettable: false },
];

assertRegistry('collections', collectionRegistry, (r) => r.key);
