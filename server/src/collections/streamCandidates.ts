import type { CollectionConfig } from 'payload';

const deny = () => false;

/** The candidate queue of stream videos (SPEC-21a): written only by the `live/**` services. State, reason and found-by are validated in the domain, not in the database. */
export const streamCandidates: CollectionConfig = {
  slug: 'stream-candidates',
  labels: { singular: 'Кандидат трансляції', plural: 'Кандидати трансляцій' },
  admin: { hidden: true },
  access: { read: deny, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'videoId', type: 'text', required: true, unique: true, index: true },
    { name: 'channelId', type: 'text', index: true },
    { name: 'foundBy', type: 'json' },
    { name: 'liveBroadcastContent', type: 'text' },
    { name: 'scheduledStartTime', type: 'date' },
    { name: 'embeddable', type: 'checkbox' },
    { name: 'privacyStatus', type: 'text' },
    { name: 'ytFetchedAt', type: 'date' },
    { name: 'checkedAt', type: 'date' },
    { name: 'eventId', type: 'text' },
    { name: 'sourceId', type: 'text' },
    { name: 'state', type: 'text', required: true, defaultValue: 'new', index: true },
    { name: 'reason', type: 'text' },
    { name: 'stateChangedAt', type: 'date' },
    { name: 'stateChangedBy', type: 'text' },
    { name: 'evidenceUrl', type: 'text' },
    { name: 'note', type: 'text' },
  ],
};
