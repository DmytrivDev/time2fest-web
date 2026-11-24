import type { CollectionConfig } from 'payload';
import { ownerOnly } from '../access/policies';

const deny = () => false;

/** Журнал резервних копій (SPEC-13b): пише лише завдання копіювання. */
export const backupRuns: CollectionConfig = {
  slug: 'backup-runs',
  labels: { singular: 'Резервна копія', plural: 'Резервні копії' },
  admin: { hidden: true, useAsTitle: 'key' },
  access: { read: ownerOnly, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'key', type: 'text', required: true },
    { name: 'kind', type: 'select', options: ['daily', 'hourly', 'manual'], required: true },
    { name: 'result', type: 'select', options: ['ok', 'failed'], required: true },
    { name: 'stage', type: 'text' },
    { name: 'size', type: 'number' },
    { name: 'sha256', type: 'text' },
    { name: 'durationMs', type: 'number' },
    { name: 'snapshotAt', type: 'date', index: true },
    { name: 'keyId', type: 'text' },
  ],
};
