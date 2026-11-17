/**
 * Event corrections (AC-53 … AC-62), kept apart from the catalog's base values. Payload glue (ring 4),
 * thin: the rules are in `domain/corrections/`, the use cases in `corrections/service.ts`.
 *
 * The owner reads the rows; nobody creates, updates or deletes them through the API — a correction is
 * saved only by `POST /cms-api/event-patches/save` (owner), which journals and publishes it in one
 * transaction. `POST /cms-api/event-patches/preview` (owner) answers "was → will be", the zone's local
 * time and the warnings, and writes nothing (AC-53). Both answer an `ApiResult`.
 *
 * Body of both: `{ changes: { [eventId]: PatchChange }, expectedVersions: { [eventId]: number }, confirmWarnings?: true }`.
 */
import type { CollectionConfig, Endpoint, PayloadRequest } from 'payload';
import { hasJsonContentType } from '../access/payloadGuard';
import { ownerOnly, roleOf } from '../access/policies';
import { processDeps } from '../adapters/processDeps';
import { resolveActor } from '../audit/journal';
import { EVENT_PATCHES, previewCorrection, saveCorrection, type CorrectionRequest, type CorrectionResult } from '../corrections/service';
import { NOTE_MAX, type CorrectionReason } from '../domain/corrections/rules';
import { correctionsOf } from '../endpoints/deps';

const never = () => false;
const NO_STORE = { 'cache-control': 'no-store' };
const MAX_BODY_BYTES = 64 * 1024;

const REFUSAL: Record<CorrectionReason, { status: number; code: 'validation' | 'not_found' | 'conflict' }> = {
  'invalid-input': { status: 400, code: 'validation' },
  'unknown-event': { status: 404, code: 'not_found' },
  'changed-since': { status: 409, code: 'conflict' },
  'correction-out-of-range': { status: 400, code: 'validation' },
  'main-required': { status: 409, code: 'conflict' },
  'warnings-not-confirmed': { status: 409, code: 'conflict' },
};

const forbidden = () => Response.json({ ok: false, error: { code: 'forbidden' } }, { status: 403, headers: NO_STORE });

function answer<T>(result: CorrectionResult<T>): Response {
  if (result.ok) return Response.json({ ok: true, value: result.value }, { headers: NO_STORE });
  const { status, code } = REFUSAL[result.reason];
  const error = { code, reason: result.reason, ...(result.warnings ? { warnings: result.warnings } : {}) };
  return Response.json({ ok: false, error }, { status, headers: NO_STORE });
}

/** The JSON body as a request, or `null` when it is not a JSON object within the size limit. */
async function bodyOf(req: PayloadRequest): Promise<CorrectionRequest | null> {
  if (!hasJsonContentType(req)) return null;
  try {
    const text = req.text ? await req.text() : '';
    if (text.length === 0 || text.length > MAX_BODY_BYTES) return null;
    const body = JSON.parse(text) as unknown;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
    const b = body as Record<string, unknown>;
    return { changes: b.changes, expectedVersions: b.expectedVersions, confirmWarnings: b.confirmWarnings };
  } catch {
    return null;
  }
}

const invalid = () => answer({ ok: false, reason: 'invalid-input' });

const previewEndpoint: Endpoint = {
  path: '/preview',
  method: 'post',
  handler: async (req) => {
    if (roleOf(req.user) !== 'owner') return forbidden();
    const body = await bodyOf(req);
    if (!body) return invalid();
    return answer(await previewCorrection(correctionsOf(await processDeps()).store, req, body));
  },
};

const saveEndpoint: Endpoint = {
  path: '/save',
  method: 'post',
  handler: async (req) => {
    if (roleOf(req.user) !== 'owner') return forbidden();
    const body = await bodyOf(req);
    if (!body) return invalid();
    const deps = correctionsOf(await processDeps());
    const actor = resolveActor(req.user, req.context);
    return answer(await saveCorrection(deps, req, body, { ...actor, kind: 'owner' }));
  },
};

export const eventPatches: CollectionConfig = {
  slug: EVENT_PATCHES,
  labels: { singular: 'Поправка події', plural: 'Поправки подій' },
  admin: { useAsTitle: 'eventId', group: 'Каталог', defaultColumns: ['eventId', 'moment', 'isMainCelebration', 'hidden', 'version'] },
  access: { read: ownerOnly, create: never, update: never, delete: never },
  endpoints: [previewEndpoint, saveEndpoint],
  fields: [
    { name: 'eventId', type: 'text', label: 'Ключ події', required: true, unique: true, index: true },
    { name: 'moment', type: 'number', label: 'Момент, мс UTC' },
    { name: 'isMainCelebration', type: 'checkbox', label: 'Головне святкування' },
    { name: 'restrained', type: 'checkbox', label: 'Стриманий режим', defaultValue: false },
    { name: 'restrainedNote', type: 'text', label: 'Примітка (uk), простий текст', maxLength: NOTE_MAX },
    { name: 'hidden', type: 'checkbox', label: 'Сховано', defaultValue: false },
    { name: 'version', type: 'number', label: 'Версія поправки події', required: true, defaultValue: 0 },
    { name: 'topicVersion', type: 'number', label: 'Версія поправок', required: true, defaultValue: 0, index: true },
  ],
};
