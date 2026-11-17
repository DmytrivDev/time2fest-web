/**
 * Sleep windows of the unattended mode (AC-31, owner decision Q5). Payload glue (ring 4), thin: the
 * rules are in `domain/unattended/`, the transitions in `unattended/service.ts`.
 *
 * Owner only. The owner enters a one-off interval as Kyiv wall-clock times (`startsAtKyiv`,
 * `endsAtKyiv`, `YYYY-MM-DDTHH:mm`); `beforeValidate` stores their UTC instants in `startsAt` /
 * `endsAt` and refuses (400) an end not after the start or an interval that overlaps another window,
 * under the unattended-mode lock so two saves cannot both pass. Every write is journalled (audited
 * row). The ticker applies a changed window within 10 s.
 */
import { ValidationError, type CollectionBeforeValidateHook, type CollectionConfig } from 'payload';
import { accessFor } from '../access/policies';
import { lockUnattended, windowsOn } from '../adapters/payloadUnattended';
import { kyivLocalToUtc } from '../domain/unattended/kyiv';
import { validateWindow } from '../domain/unattended/windows';
import { UNATTENDED_WINDOWS } from '../unattended/service';

const policy = accessFor('unattended');
const KYIV_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const refuse = (path: string, message: string) => new ValidationError({ errors: [{ message, path }] });

/** Kyiv input → UTC instants; refuses end ≤ start and overlaps (AC-31). */
const toUtcAndCheck: CollectionBeforeValidateHook = async ({ data, originalDoc, req }) => {
  const merged = { ...((originalDoc ?? {}) as Record<string, unknown>), ...((data ?? {}) as Record<string, unknown>) };
  const startsAt = kyivLocalToUtc(String(merged.startsAtKyiv ?? ''));
  const endsAt = kyivLocalToUtc(String(merged.endsAtKyiv ?? ''));
  if (startsAt === null) throw refuse('startsAtKyiv', 'invalid-kyiv-time');
  if (endsAt === null) throw refuse('endsAtKyiv', 'invalid-kyiv-time');
  if (req.transactionID) await lockUnattended(req);
  const id = (originalDoc as { id?: unknown } | undefined)?.id;
  const check = validateWindow({ ...(id === undefined ? {} : { id: String(id) }), startsAt, endsAt }, await windowsOn(req));
  if (check !== 'ok') throw refuse('endsAtKyiv', check);
  return { ...data, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString() };
};

const kyivText = (value: unknown) => (typeof value === 'string' && KYIV_TEXT.test(value)) || 'invalid-kyiv-time';

export const unattendedWindows: CollectionConfig = {
  slug: UNATTENDED_WINDOWS,
  labels: { singular: 'Вікно сну', plural: 'Вікна сну' },
  admin: { useAsTitle: 'startsAtKyiv', group: 'Без нагляду', defaultColumns: ['startsAtKyiv', 'endsAtKyiv', 'label'] },
  access: { read: policy.read, create: policy.create, update: policy.update, delete: policy.delete },
  hooks: { beforeValidate: [toUtcAndCheck] },
  fields: [
    { name: 'startsAtKyiv', type: 'text', label: 'Початок (Київ, РРРР-ММ-ДДTГГ:ХХ)', required: true, validate: kyivText },
    { name: 'endsAtKyiv', type: 'text', label: 'Кінець (Київ, РРРР-ММ-ДДTГГ:ХХ)', required: true, validate: kyivText },
    { name: 'startsAt', type: 'date', label: 'Початок, UTC', required: true, index: true, admin: { readOnly: true } },
    { name: 'endsAt', type: 'date', label: 'Кінець, UTC', required: true, admin: { readOnly: true } },
    { name: 'label', type: 'text', label: 'Підпис', maxLength: 100 },
  ],
};
