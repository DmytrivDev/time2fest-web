/**
 * Collection registry (AC-62): sorted, unique rows. `resettable` marks the collections the
 * test reset door may clear.
 */
import type { CollectionConfig } from 'payload';
import { assertRegistry } from '../platform/registry';
import { admins } from '../collections/admins';
import { aiSpend } from '../collections/aiSpend';
import { agentTestPosts } from '../collections/agentTestPosts';
import { alarms } from '../collections/alarms';
import { auditLog } from '../collections/auditLog';
import { cities } from '../collections/catalog/cities';
import { countries } from '../collections/catalog/countries';
import { events } from '../collections/catalog/events';
import { seasons } from '../collections/catalog/seasons';
import { traditions } from '../collections/catalog/traditions';
import { zones } from '../collections/catalog/zones';
import { eventPatches } from '../collections/eventPatches';
import { idempotencyRecords } from '../collections/idempotencyRecords';
import { internalEvents } from '../collections/internalEvents';
import { liveQuota } from '../collections/liveQuota';
import { runRecords } from '../collections/runRecords';
import { schedulerLeases } from '../collections/schedulerLeases';
import { schedulerRuns } from '../collections/schedulerRuns';
import { streamSources } from '../collections/streamSources';
import { unattendedWindows } from '../collections/unattendedWindows';

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
  { key: 'ai-spend', collection: aiSpend, resettable: true },
  { key: 'alarms', collection: alarms, resettable: false, audited: true },
  { key: 'audit-log', collection: auditLog, resettable: false },
  { key: 'cities', collection: cities, resettable: true, audited: true },
  { key: 'countries', collection: countries, resettable: true, audited: true },
  { key: 'event-patches', collection: eventPatches, resettable: true },
  { key: 'events', collection: events, resettable: true, audited: true },
  { key: 'idempotency-records', collection: idempotencyRecords, resettable: true },
  { key: 'internal-events', collection: internalEvents, resettable: false },
  { key: 'live-quota', collection: liveQuota, resettable: true },
  { key: 'run-records', collection: runRecords, resettable: true },
  { key: 'scheduler-leases', collection: schedulerLeases, resettable: false },
  { key: 'scheduler-runs', collection: schedulerRuns, resettable: true },
  { key: 'seasons', collection: seasons, resettable: true, audited: true },
  { key: 'stream-sources', collection: streamSources, resettable: true },
  { key: 'traditions', collection: traditions, resettable: true, audited: true },
  { key: 'unattended-windows', collection: unattendedWindows, resettable: true, audited: true },
  { key: 'zones', collection: zones, resettable: true, audited: true },
];

assertRegistry('collections', collectionRegistry, (r) => r.key);
