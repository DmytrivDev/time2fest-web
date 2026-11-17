import type { CollectionConfig } from 'payload';

const deny = () => false;

export const idempotencyRecords: CollectionConfig = {
  slug: 'idempotency-records',
  labels: { singular: 'Запис ідемпотентності', plural: 'Записи ідемпотентності' },
  admin: { hidden: true },
  access: { read: deny, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'key', type: 'text', required: true, unique: true, index: true },
    {
      name: 'status',
      type: 'select',
      required: true,
      options: [
        { label: 'running', value: 'running' },
        { label: 'done', value: 'done' },
      ],
    },
    { name: 'result', type: 'json' },
  ],
};
