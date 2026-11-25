import type { CollectionConfig } from 'payload';

const deny = () => false;

/** Retry queue of a failed guest-to-account data merge (SPEC-10 AC-24); only the auth adapter touches it. */
export const authLinkRetries: CollectionConfig = {
  slug: 'auth-link-retries',
  labels: { singular: 'Повтор злиття гостя', plural: 'Повтори злиття гостя' },
  admin: { hidden: true },
  access: { read: deny, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'userId', type: 'text', required: true, index: true },
    { name: 'fromSubject', type: 'text', required: true },
    { name: 'handler', type: 'text', required: true },
    { name: 'attempts', type: 'number', required: true, min: 0, defaultValue: 0 },
    { name: 'nextAt', type: 'date', required: true },
    { name: 'lastErrorCode', type: 'text', maxLength: 64 },
  ],
};
