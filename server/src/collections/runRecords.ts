import type { CollectionConfig } from 'payload';
import { ownerOnly } from '../access/policies';

const deny = () => false;

/** What a scheduled consequence did and when (SPEC-07): read by the owner only, written by the adapter. */
export const runRecords: CollectionConfig = {
  slug: 'run-records',
  labels: { singular: 'Запис виконання', plural: 'Записи виконання' },
  admin: { hidden: true },
  access: { read: ownerOnly, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'consequenceId', type: 'text', required: true, unique: true, index: true },
    { name: 'keys', type: 'json' },
    { name: 'action', type: 'text', required: true },
    { name: 'runEpoch', type: 'number', required: true },
    { name: 'plannedAt', type: 'number', required: true },
    { name: 'startedAt', type: 'number', required: true },
    { name: 'at', type: 'number', required: true },
  ],
};
