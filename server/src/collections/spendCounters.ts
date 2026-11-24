import type { CollectionConfig } from 'payload';
import { ownerOnly } from '../access/policies';

const deny = () => false;

/** Лічильники витрат Cloudflare, пошти й сервера за місяць (SPEC-13b): пише лише завдання витрат. */
export const spendCounters: CollectionConfig = {
  slug: 'spend-counters',
  labels: { singular: 'Лічильник витрат', plural: 'Лічильники витрат' },
  admin: { hidden: true, useAsTitle: 'row' },
  access: { read: ownerOnly, create: deny, update: deny, delete: deny },
  indexes: [{ fields: ['row', 'period'], unique: true }],
  fields: [
    { name: 'row', type: 'text', required: true },
    { name: 'period', type: 'text', required: true },
    { name: 'amountMicros', type: 'number', required: true, defaultValue: 0 },
    { name: 'classA', type: 'number', defaultValue: 0 },
    { name: 'classB', type: 'number', defaultValue: 0 },
    { name: 'storageBytes', type: 'number', defaultValue: 0 },
    { name: 'alarm50At', type: 'date' },
    { name: 'alarm80At', type: 'date' },
    { name: 'meta', type: 'json' },
  ],
};
