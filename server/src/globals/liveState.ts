import type { GlobalConfig } from 'payload';

const never = () => false;

/** Live chains state (SPEC-12): the chain version and fan-out marker; only the live store writes it. */
export const liveState: GlobalConfig = {
  slug: 'live-state',
  label: 'Стан ефіру',
  admin: { hidden: true },
  access: { read: never, update: never },
  fields: [
    { name: 'version', type: 'number', required: true, defaultValue: 1 },
    { name: 'at', type: 'date' },
    { name: 'lastFannedOut', type: 'number', defaultValue: 0 },
    { name: 'zoneLive', type: 'json' },
    { name: 'pendingChecks', type: 'json' },
  ],
};
