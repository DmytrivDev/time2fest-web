import type { CollectionConfig } from 'payload';
import { ownerOnly } from '../access/policies';

const deny = () => false;

/**
 * Черга відправлення в Telegram (SPEC-13b, [П-3]): тривоги, пульс, дайджест і підсумок шторму.
 * Пишуть лише адаптери; власник читає.
 */
export const alarmDeliveries: CollectionConfig = {
  slug: 'alarm-deliveries',
  labels: { singular: 'Відправлення тривоги', plural: 'Відправлення тривог' },
  admin: { hidden: true, useAsTitle: 'code' },
  access: { read: ownerOnly, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'kind', type: 'select', options: ['alarm', 'heartbeat', 'digest', 'storm-summary'], required: true, defaultValue: 'alarm' },
    { name: 'slotKey', type: 'text', unique: true },
    { name: 'source', type: 'text' },
    { name: 'code', type: 'text' },
    { name: 'level', type: 'text' },
    { name: 'domain', type: 'text' },
    { name: 'text', type: 'text', required: true, maxLength: 1000 },
    { name: 'details', type: 'json' },
    { name: 'status', type: 'select', options: ['pending', 'delivered', 'failed'], required: true, defaultValue: 'pending' },
    { name: 'attempts', type: 'number', required: true, defaultValue: 0, min: 0 },
    { name: 'nextAttemptAt', type: 'date', index: true },
    { name: 'deliveredAt', type: 'date' },
    { name: 'failedAt', type: 'date' },
    { name: 'lastStatus', type: 'number' },
    { name: 'repeatCount', type: 'number', required: true, defaultValue: 0, min: 0 },
    { name: 'raisedAt', type: 'date', required: true },
  ],
};
