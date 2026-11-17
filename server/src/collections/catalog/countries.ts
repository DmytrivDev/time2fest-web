/** Countries of the catalog. `iso` and `slug` never change after creation (AC-46). */
import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload';
import { ValidationError } from 'payload';
import { catalogAccess, importedHash, localized, naturalKey } from './fields';
import { bumpCatalogVersion, checkIntegrity } from './hooks';

export const GENDERS = ['m', 'f', 'n', 'pl'] as const;

const IMMUTABLE = ['iso', 'slug'] as const;

/** A change of `iso` or `slug` on an existing country is refused (AC-46). */
const refuseKeyChange: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update') return data;
  for (const key of IMMUTABLE) {
    const next = (data as Record<string, unknown>)[key];
    const prev = (originalDoc as Record<string, unknown> | undefined)?.[key];
    if (next !== undefined && next !== prev) {
      throw new ValidationError({ errors: [{ message: `${key} cannot be changed`, path: key }] });
    }
  }
  return data;
};

export const countries: CollectionConfig = {
  slug: 'countries',
  labels: { singular: 'Країна', plural: 'Країни' },
  admin: { useAsTitle: 'iso', group: 'Каталог' },
  access: catalogAccess,
  hooks: {
    beforeChange: [refuseKeyChange, checkIntegrity('countries')],
    afterChange: [bumpCatalogVersion],
  },
  fields: [
    naturalKey('iso', 'ISO-код'),
    naturalKey('slug', 'Slug'),
    localized('name', 'Назва', { maxLength: 80 }),
    { name: 'gender', type: 'select', label: 'Рід', options: [...GENDERS] },
    { name: 'flagCode', type: 'text', label: 'Код прапора' },
    { name: 'zoneIds', type: 'json', label: 'Пояси' },
    { name: 'illustrationId', type: 'text', label: 'Ілюстрація' },
    localized('howToText', 'Як зустрічають', { optional: true }),
    { name: 'gallery', type: 'json', label: 'Галерея' },
    { name: 'popularity', type: 'number', label: 'Популярність' },
    { name: 'sortIndex', type: 'number', label: 'Порядок у списку' },
    importedHash,
  ],
};
