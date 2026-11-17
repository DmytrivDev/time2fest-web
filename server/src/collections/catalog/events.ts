/** Events of the catalog: the midnight of a city and, optionally, other moments of the night (AC-48). */
import type { CollectionConfig, Validate } from 'payload';
import { catalogAccess, importedHash, localized, naturalKey } from './fields';
import { bumpCatalogVersion, checkIntegrity } from './hooks';

export const SLOTS = ['midnight', 'fireworks-20', 'dawn', 'jan-1'] as const;

/** A slot other than `midnight` needs its own moment `startsAt` (AC-48). */
export const startsAtRequired: Validate = (value, { siblingData }) => {
  const slot = (siblingData as { slot?: unknown } | undefined)?.slot ?? 'midnight';
  return slot !== 'midnight' && !value ? 'startsAt is required when slot is not midnight' : true;
};

export const events: CollectionConfig = {
  slug: 'events',
  labels: { singular: 'Подія', plural: 'Події' },
  admin: { useAsTitle: 'eventId', group: 'Каталог' },
  access: catalogAccess,
  hooks: {
    beforeChange: [checkIntegrity('events')],
    afterChange: [bumpCatalogVersion],
  },
  fields: [
    naturalKey('eventId', 'Ключ події'),
    { name: 'cityId', type: 'text', label: 'Місто', required: true, index: true },
    { name: 'zoneId', type: 'text', label: 'Пояс', required: true, index: true },
    { name: 'countryIso', type: 'text', label: 'Країна (ISO)', required: true, index: true },
    { name: 'midnightUtc', type: 'text', label: 'Північ, UTC', required: true },
    { name: 'isMainCelebration', type: 'checkbox', label: 'Головне святкування', defaultValue: false },
    { name: 'type', type: 'text', label: 'Вид' },
    { name: 'popularity', type: 'number', label: 'Популярність' },
    localized('restrainedNote', 'Стримана примітка', { maxLength: 200, optional: true }),
    { name: 'slot', type: 'select', label: 'Слот', options: [...SLOTS], required: true, defaultValue: 'midnight' },
    { name: 'startsAt', type: 'date', label: 'Початок, UTC', validate: startsAtRequired },
    { name: 'sortIndex', type: 'number', label: 'Порядок у списку' },
    importedHash,
  ],
};
