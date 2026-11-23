import type { CollectionConfig } from 'payload';

const deny = () => false;

/** YouTube quota counters per Pacific-time day and bucket (SPEC-12): written only by the quota store. */
export const liveQuota: CollectionConfig = {
  slug: 'live-quota',
  labels: { singular: 'Квота YouTube', plural: 'Квота YouTube' },
  admin: { hidden: true },
  access: { read: deny, create: deny, update: deny, delete: deny },
  indexes: [{ fields: ['day', 'bucket'], unique: true }],
  fields: [
    { name: 'day', type: 'text', required: true, index: true },
    { name: 'bucket', type: 'text', required: true },
    { name: 'used', type: 'number', required: true, min: 0, defaultValue: 0 },
    { name: 'alarm80At', type: 'date' },
    { name: 'exceededUntil', type: 'date' },
  ],
};
