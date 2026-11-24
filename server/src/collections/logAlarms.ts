import type { CollectionConfig } from 'payload';
import { ownerOnly } from '../access/policies';

const deny = () => false;

/** Тривоги рівня `log` без повідомлення в Telegram (SPEC-13b, AC-12); пишуть адаптери, чистка через 30 днів. */
export const logAlarms: CollectionConfig = {
  slug: 'log-alarms',
  labels: { singular: 'Журнальна тривога', plural: 'Журнальні тривоги' },
  admin: { hidden: true, useAsTitle: 'code' },
  access: { read: ownerOnly, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'source', type: 'text', required: true },
    { name: 'code', type: 'text', required: true },
    { name: 'domain', type: 'text' },
    { name: 'details', type: 'json' },
    { name: 'raisedAt', type: 'date', required: true, index: true },
  ],
};
