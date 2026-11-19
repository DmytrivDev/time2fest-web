/** Moderation and AI settings (SPEC-09): thresholds and spend ceilings. The owner reads; the admin slice endpoint writes. */
import type { GlobalConfig } from 'payload';
import { ownerOnly } from '../access/policies';

const never = () => false;

export const moderationSettings: GlobalConfig = {
  slug: 'moderation-settings',
  label: 'Модерація й AI',
  admin: { group: 'Модерація' },
  access: { read: ownerOnly, update: never, readVersions: ownerOnly },
  fields: [
    { name: 'reviewThreshold', type: 'number', label: 'Поріг перевірки', defaultValue: 0.5, admin: { readOnly: true } },
    { name: 'blockThreshold', type: 'number', label: 'Поріг блокування', defaultValue: 0.8, admin: { readOnly: true } },
    { name: 'nightCeilingUsd', type: 'number', label: 'Стеля за ніч, USD', defaultValue: 50, admin: { readOnly: true } },
    { name: 'monthCeilingUsd', type: 'number', label: 'Стеля за місяць, USD', defaultValue: 100, admin: { readOnly: true } },
    { name: 'version', type: 'number', label: 'Версія', defaultValue: 0, admin: { readOnly: true } },
  ],
};
