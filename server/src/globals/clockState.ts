import type { GlobalConfig } from 'payload';

const never = () => false;

/** The shared server clock (SPEC-07): "real" by default; only the adapter writes it. */
export const clockState: GlobalConfig = {
  slug: 'clock-state',
  label: 'Годинник сервера',
  admin: { hidden: true },
  access: { read: never, update: never },
  fields: [
    { name: 'virtual', type: 'checkbox', defaultValue: false },
    { name: 'anchorVirtual', type: 'number' },
    { name: 'anchorReal', type: 'number' },
    { name: 'speed', type: 'number', defaultValue: 1 },
    { name: 'frozen', type: 'checkbox', defaultValue: false },
    { name: 'runEpoch', type: 'number', defaultValue: 0 },
    { name: 'seq', type: 'number', defaultValue: 0 },
  ],
};
