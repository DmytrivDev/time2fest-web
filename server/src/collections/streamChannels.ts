import type { CollectionConfig } from 'payload';

const deny = () => false;

/** Watched YouTube channels and the channel blacklist (SPEC-21a): written only by the `live/**` services. State, kind and priority are validated in the domain, not in the database. */
export const streamChannels: CollectionConfig = {
  slug: 'stream-channels',
  labels: { singular: 'Канал трансляцій', plural: 'Канали трансляцій' },
  admin: { hidden: true },
  access: { read: deny, create: deny, update: deny, delete: deny },
  fields: [
    { name: 'channelId', type: 'text', required: true, unique: true, index: true },
    { name: 'uploadsPlaylistId', type: 'text' },
    { name: 'uploadsFetchedAt', type: 'date' },
    { name: 'name', type: 'text', required: true },
    { name: 'kind', type: 'text', required: true },
    { name: 'zones', type: 'json' },
    { name: 'seasons', type: 'json' },
    { name: 'priority', type: 'number', required: true, defaultValue: 3 },
    { name: 'state', type: 'text', required: true, defaultValue: 'watched', index: true },
    { name: 'blacklisted', type: 'checkbox', defaultValue: false },
    { name: 'blacklistReason', type: 'text' },
    { name: 'blacklistSource', type: 'text' },
    { name: 'proposedBy', type: 'text' },
    { name: 'adminEditedAt', type: 'date' },
    { name: 'lastPlaylistAt', type: 'date' },
    { name: 'lastSearchAt', type: 'date' },
  ],
};
