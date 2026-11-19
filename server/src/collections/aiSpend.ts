import type { CollectionConfig } from 'payload';

const deny = () => false;

/** AI spend per period (SPEC-09): `night:<year>` / `month:<yyyy-mm>`; only the spend adapter writes it. */
export const aiSpend: CollectionConfig = {
  slug: 'ai-spend',
  labels: { singular: 'Витрати AI', plural: 'Витрати AI' },
  admin: { hidden: true },
  access: { read: deny, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'period', type: 'text', required: true, unique: true, index: true },
    { name: 'amountMicros', type: 'number', required: true, min: 0, defaultValue: 0 },
    { name: 'alarm50At', type: 'date' },
    { name: 'alarm80At', type: 'date' },
    { name: 'alarm100At', type: 'date' },
  ],
};
