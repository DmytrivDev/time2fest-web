import type { CollectionConfig } from 'payload';
import { ownerOnly } from '../access/policies';

const deny = () => false;

/** Журнал відновлень з копії (SPEC-13b): пише лише команда `ops restore-record`. */
export const restoreRuns: CollectionConfig = {
  slug: 'restore-runs',
  labels: { singular: 'Відновлення', plural: 'Відновлення' },
  admin: { hidden: true, useAsTitle: 'key' },
  access: { read: ownerOnly, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'at', type: 'date', required: true, index: true },
    { name: 'key', type: 'text', required: true },
    { name: 'durationMs', type: 'number' },
    { name: 'lossWindowMs', type: 'number' },
    { name: 'result', type: 'select', options: ['ok', 'failed'], required: true },
    { name: 'target', type: 'text' },
  ],
};
