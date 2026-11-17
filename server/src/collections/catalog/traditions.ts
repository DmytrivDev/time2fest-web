/** Traditions of the countries' cards. */
import type { CollectionConfig } from 'payload';
import { catalogAccess, importedHash, localized, naturalKey } from './fields';
import { bumpCatalogVersion } from './hooks';

export const traditions: CollectionConfig = {
  slug: 'traditions',
  labels: { singular: 'Традиція', plural: 'Традиції' },
  admin: { useAsTitle: 'traditionId', group: 'Каталог' },
  access: catalogAccess,
  hooks: { afterChange: [bumpCatalogVersion] },
  fields: [
    naturalKey('traditionId', 'Ключ традиції'),
    { name: 'countryIso', type: 'text', label: 'Країна (ISO)', required: true, index: true },
    localized('title', 'Заголовок', { maxLength: 80 }),
    localized('text', 'Текст', { maxLength: 600 }),
    { name: 'iconId', type: 'text', label: 'Іконка' },
    { name: 'sortIndex', type: 'number', label: 'Порядок у списку' },
    importedHash,
  ],
};
