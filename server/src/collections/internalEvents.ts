/**
 * Outbox of internal events (AC-40 … AC-42). Hidden; no role reaches it through the API — rows are
 * written only by the events adapter, on the caller's transaction, and read by the delivery loop.
 * The serial `id` is the global order; `version` grows by one per topic.
 */
import type { CollectionConfig } from 'payload';

const never = () => false;

export const INTERNAL_EVENTS = 'internal-events';

export const internalEvents: CollectionConfig = {
  slug: INTERNAL_EVENTS,
  labels: { singular: 'Внутрішня подія', plural: 'Внутрішні події' },
  admin: { hidden: true },
  access: { read: never, create: never, update: never, delete: never },
  timestamps: false,
  // `publish` reads MAX(version) of one topic under the outbox lock: with only `(topic)` that is a scan of
  // every row of the topic per event; `(topic, version)` makes it one index probe (SPEC-14 PERF-2).
  indexes: [{ fields: ['topic', 'version'] }],
  fields: [
    { name: 'topic', type: 'text', required: true, index: true },
    { name: 'version', type: 'number', required: true },
    { name: 'payload', type: 'json' },
    { name: 'committedAt', type: 'date', required: true },
  ],
};
