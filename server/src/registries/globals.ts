/**
 * Global registry: sorted, unique rows, one line per global. Every global is hardened by
 * `payload.config.ts` (the second Payload check, AC-5).
 */
import type { GlobalConfig } from 'payload';
import { assertRegistry } from '../platform/registry';
import { adminSettings } from '../globals/adminSettings';
import { unattendedState } from '../globals/unattendedState';

export interface GlobalRow {
  key: string;
  global: GlobalConfig;
}

export const globalRegistry: readonly GlobalRow[] = [
  { key: 'admin-settings', global: adminSettings },
  { key: 'unattended-state', global: unattendedState },
];

assertRegistry('globals', globalRegistry, (r) => r.key);
