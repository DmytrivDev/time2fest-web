/** Time zones of the catalog. `midnightUtc` is written only by the import (AC-45). */
import type { CollectionBeforeOperationHook, CollectionConfig } from 'payload';
import { ValidationError } from 'payload';
import { TRUSTED_CONTEXT_KEY } from '../../access/payloadGuard';
import { catalogAccess, importedHash, naturalKey } from './fields';
import { bumpCatalogVersion, checkIntegrity, skipsCatalogHooks } from './hooks';

/**
 * The midnight moment of a zone cannot be edited by hand: a write that changes it is refused and the
 * value stays (AC-45). It runs before the field access strips the value (which would hide the attempt);
 * the admin form resends the unchanged value, which is fine.
 */
const refuseMidnightEdit: CollectionBeforeOperationHook = async ({ args, operation, req }) => {
  if (operation !== 'update' || skipsCatalogHooks(req)) return args;
  const next = (args as { data?: { midnightUtc?: unknown } }).data?.midnightUtc;
  if (next === undefined) return args;
  const id = (args as { id?: string | number }).id;
  const stored =
    id === undefined
      ? undefined
      : await req.payload.findByID({ collection: 'zones', id, req: { ...req, context: { ...req.context, [TRUSTED_CONTEXT_KEY]: true } }, depth: 0, overrideAccess: true, disableErrors: true });
  if (stored?.midnightUtc !== next) {
    throw new ValidationError({ errors: [{ message: 'midnightUtc is written only by the import', path: 'midnightUtc' }] });
  }
  return args;
};

export const zones: CollectionConfig = {
  slug: 'zones',
  labels: { singular: 'Пояс', plural: 'Пояси' },
  admin: { useAsTitle: 'zoneId', group: 'Каталог' },
  access: catalogAccess,
  hooks: {
    beforeOperation: [refuseMidnightEdit],
    beforeChange: [checkIntegrity('zones')],
    afterChange: [bumpCatalogVersion],
  },
  fields: [
    naturalKey('zoneId', 'Ключ поясу'),
    { name: 'order', type: 'number', label: 'Порядок', required: true },
    { name: 'offsetMinutes', type: 'number', label: 'Зсув, хв', required: true },
    {
      name: 'midnightUtc',
      type: 'text',
      label: 'Північ, UTC',
      required: true,
      access: { update: () => false },
      admin: { readOnly: true },
    },
    { name: 'representativeCityId', type: 'text', label: 'Місто-представник' },
    importedHash,
  ],
};
