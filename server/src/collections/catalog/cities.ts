/** Cities of the catalog; `zoneId` and `countryIso` are text natural keys. */
import type { CollectionConfig } from 'payload';
import { catalogAccess, importedHash, localized, naturalKey } from './fields';
import { bumpCatalogVersion, checkIntegrity } from './hooks';

export const cities: CollectionConfig = {
  slug: 'cities',
  labels: { singular: 'Місто', plural: 'Міста' },
  admin: { useAsTitle: 'cityId', group: 'Каталог' },
  access: catalogAccess,
  hooks: {
    beforeChange: [checkIntegrity('cities')],
    afterChange: [bumpCatalogVersion],
  },
  fields: [
    naturalKey('cityId', 'Ключ міста'),
    { name: 'countryIso', type: 'text', label: 'Країна (ISO)', required: true, index: true },
    { name: 'zoneId', type: 'text', label: 'Пояс', required: true, index: true },
    localized('name', 'Назва', { maxLength: 80 }),
    localized('landmark', "Пам'ятка", { maxLength: 120, optional: true }),
    { name: 'celebrationType', type: 'text', label: 'Вид святкування' },
    {
      name: 'mapPoint',
      type: 'group',
      label: 'Точка на мапі',
      fields: [
        { name: 'x', type: 'number', label: 'x' },
        { name: 'y', type: 'number', label: 'y' },
      ],
    },
    { name: 'isCountryMain', type: 'checkbox', label: 'Головне місто країни', defaultValue: false },
    { name: 'sortIndex', type: 'number', label: 'Порядок у списку' },
    importedHash,
  ],
};
