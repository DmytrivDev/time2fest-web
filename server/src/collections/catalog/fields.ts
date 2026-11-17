/**
 * Shared field builders of the catalog collections (AC-43 … AC-48), Payload glue (ring 4), thin.
 * Plain text only: no rich text anywhere in the catalog (security A03). Relations between catalog
 * records are text natural keys (`zoneId`, `countryIso`, `cityId`), not relationship fields, so the
 * journal and the revert compare stored values as they are.
 */
import type { Access, CollectionConfig, Field } from 'payload';
import { accessFor } from '../../access/policies';

export const LANGUAGES = ['uk', 'en', 'es', 'fr'] as const;

const POLICY = accessFor('catalog');

/** No role deletes a catalog record (AC-47, Q7): a record is hidden by a correction, never removed. */
export const noDelete: Access = () => false;

/** Access of every catalog collection: owner reads and writes, agents read; nobody deletes. */
export const catalogAccess: NonNullable<CollectionConfig['access']> = {
  read: POLICY.read,
  create: POLICY.create,
  update: POLICY.update,
  delete: noDelete,
};

/** Text in four languages: `uk` is required unless `optional`; `en`, `es`, `fr` never are (AC-43). */
export function localized(name: string, label: string, options: { maxLength?: number; optional?: boolean } = {}): Field {
  const { maxLength, optional = false } = options;
  return {
    name,
    type: 'group',
    label,
    fields: LANGUAGES.map(
      (lang): Field => ({
        name: lang,
        type: 'text',
        label: lang,
        required: lang === 'uk' && !optional,
        ...(maxLength ? { maxLength } : {}),
      }),
    ),
  };
}

/** A unique, indexed text key (the natural key the import and the other collections use). */
export function naturalKey(name: string, label: string): Field {
  return { name, type: 'text', label, required: true, unique: true, index: true };
}

/** The hash the import keeps to skip unchanged records. */
export const importedHash: Field = { name: 'importedHash', type: 'text', admin: { hidden: true } };
