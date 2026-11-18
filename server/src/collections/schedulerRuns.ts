import type { CollectionConfig } from 'payload';

const deny = () => false;

/** One scheduler run of one action at one moment (SPEC-07): unique (runEpoch, action, momentKey). */
export const schedulerRuns: CollectionConfig = {
  slug: 'scheduler-runs',
  labels: { singular: 'Запуск планувальника', plural: 'Запуски планувальника' },
  admin: { hidden: true },
  access: { read: deny, create: deny, update: deny, delete: deny },
  indexes: [{ fields: ['runEpoch', 'action', 'momentKey'], unique: true }],
  fields: [
    { name: 'runEpoch', type: 'number', required: true },
    { name: 'action', type: 'text', required: true },
    { name: 'momentKey', type: 'text', required: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'started', value: 'started' },
        { label: 'done', value: 'done' },
        { label: 'skipped', value: 'skipped' },
        { label: 'failed', value: 'failed' },
      ],
    },
    { name: 'consequenceId', type: 'text' },
    { name: 'leaseEpoch', type: 'number' },
    { name: 'plannedAt', type: 'number' },
    { name: 'startedAt', type: 'number' },
    { name: 'finishedAt', type: 'number' },
    { name: 'reason', type: 'text' },
  ],
};
