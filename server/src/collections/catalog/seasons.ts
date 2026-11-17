/** The season of the catalog: its generation time and the tzdb version the catalog version is made of. */
import type { CollectionConfig } from 'payload';
import { catalogAccess, importedHash, naturalKey } from './fields';

export const seasons: CollectionConfig = {
  slug: 'seasons',
  labels: { singular: 'Сезон', plural: 'Сезони' },
  admin: { useAsTitle: 'key', group: 'Каталог' },
  access: catalogAccess,
  fields: [
    naturalKey('key', 'Ключ сезону'),
    { name: 'generatedAt', type: 'text', label: 'Згенеровано', required: true },
    { name: 'tzdbVersion', type: 'text', label: 'Версія tzdb', required: true },
    importedHash,
  ],
};
