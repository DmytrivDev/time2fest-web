import type { CollectionConfig } from 'payload';

const deny = () => false;

/** Stream sources of the live chains (SPEC-12): written only by the `live/**` services through the local API. */
export const streamSources: CollectionConfig = {
  slug: 'stream-sources',
  labels: { singular: 'Джерело трансляції', plural: 'Джерела трансляцій' },
  admin: { hidden: true },
  access: { read: deny, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'sourceId', type: 'text', required: true, unique: true, index: true },
    { name: 'eventId', type: 'text', required: true, index: true },
    {
      name: 'platform',
      type: 'select',
      required: true,
      defaultValue: 'youtube',
      options: ['youtube', 'iframe-official', 'hls', 'none'],
    },
    { name: 'kind', type: 'text' },
    { name: 'label', type: 'text' },
    { name: 'name', type: 'text' },
    { name: 'order', type: 'number', required: true, defaultValue: 0 },
    { name: 'startsAt', type: 'date' },
    { name: 'status', type: 'text' },
    { name: 'embeddable', type: 'checkbox' },
    { name: 'privacyStatus', type: 'text' },
    { name: 'liveBroadcastContent', type: 'text' },
    { name: 'scheduledStartTime', type: 'date' },
    { name: 'actualStartTime', type: 'date' },
    { name: 'actualEndTime', type: 'date' },
    { name: 'ytFetchedAt', type: 'date' },
    { name: 'lastChecked', type: 'date' },
    { name: 'nextOffWindowCheckAt', type: 'date' },
    { name: 'override', type: 'select', options: ['live', 'ended', 'hidden'] },
    { name: 'hidden', type: 'checkbox', defaultValue: false },
    { name: 'hiddenReason', type: 'text' },
    { name: 'dead', type: 'checkbox', defaultValue: false },
    { name: 'deadReason', type: 'text' },
    { name: 'longNews', type: 'checkbox', defaultValue: false },
    { name: 'rights', type: 'textarea' },
    { name: 'evidence', type: 'textarea' },
    { name: 'geo', type: 'json' },
    { name: 'adminEditedAt', type: 'date' },
  ],
};
