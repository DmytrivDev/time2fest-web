/**
 * Admin settings (owner only; agents may not read it). `agentPublish` (AC-19): while it is off,
 * an agent's attempt to publish is kept as a proposal. Absent counts as on (the default).
 */
import type { GlobalConfig } from 'payload';
import { ownerOnly } from '../access/policies';

export const ADMIN_SETTINGS = 'admin-settings';

export const adminSettings: GlobalConfig = {
  slug: ADMIN_SETTINGS,
  label: 'Налаштування адмінки',
  access: { read: ownerOnly, update: ownerOnly, readVersions: ownerOnly },
  fields: [{ name: 'agentPublish', type: 'checkbox', defaultValue: true }],
};
