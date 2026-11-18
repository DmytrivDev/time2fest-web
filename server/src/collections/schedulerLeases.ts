import type { CollectionConfig } from 'payload';

const deny = () => false;

/** The scheduler lease (SPEC-07): one row per lease name; only the adapter writes it. */
export const schedulerLeases: CollectionConfig = {
  slug: 'scheduler-leases',
  labels: { singular: 'Оренда планувальника', plural: 'Оренди планувальника' },
  admin: { hidden: true },
  access: { read: deny, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'name', type: 'text', required: true, unique: true, index: true },
    { name: 'holder', type: 'text', required: true },
    { name: 'epoch', type: 'number', required: true, defaultValue: 0 },
    { name: 'expiresAt', type: 'date', required: true },
    { name: 'renewedAt', type: 'date', required: true },
  ],
};
