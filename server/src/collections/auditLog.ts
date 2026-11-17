/**
 * The audit journal (AC-20 … AC-25, NFR-6). The owner reads it; no role creates, updates or
 * deletes a row through the API or the admin (AC-21) — rows are written only by the journal
 * (`audit/journal.ts`, `overrideAccess` on the caller's `req`). There is no delete code for it.
 *
 * `POST /cms-api/audit-log/:id/revert` (owner): reverts one row in one step (`audit/revert.ts`),
 * answering an `ApiResult`.
 */
import { commitTransaction, initTransaction, killTransaction } from 'payload';
import type { CollectionConfig, CollectionSlug, Endpoint, PayloadRequest } from 'payload';
import { accessFor, roleOf } from '../access/policies';
import { AUDIT_LOG, redactSecrets } from '../audit/journal';
import type { Actor, RevertStore, StoredJournalEntry, Tx } from '../audit/ports';
import { revertEntry, type RevertRefusal } from '../audit/revert';
import { revertHandlerRegistry } from '../registries/revertHandlers';

const never = () => false;
const ID = /^\d{1,15}$/;
const NO_STORE = { 'cache-control': 'no-store' };

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function toEntry(doc: Record<string, unknown>): StoredJournalEntry {
  const actor = asRecord(doc.actor) ?? {};
  const target = asRecord(doc.target) ?? {};
  return {
    id: String(doc.id),
    actor: { kind: actor.kind as Actor['kind'], id: String(actor.ref ?? ''), label: String(actor.label ?? '') },
    action: String(doc.action ?? ''),
    target: { collection: String(target.collection ?? ''), id: String(target.ref ?? '') },
    at: Date.parse(String(doc.at)),
    before: asRecord(doc.before),
    after: asRecord(doc.after),
    revertOf: typeof doc.revertOf === 'string' && doc.revertOf ? doc.revertOf : null,
    revertible: doc.revertible === true,
  };
}

/** The journal and its targets over Payload, on the endpoint's `req`. */
export function payloadRevertStore(): RevertStore {
  return {
    async entry(tx: Tx, id) {
      if (!ID.test(id)) return null;
      const req = tx as PayloadRequest;
      const doc = await req.payload.findByID({ collection: AUDIT_LOG, id: Number(id), req, overrideAccess: true, depth: 0, disableErrors: true });
      return doc ? toEntry(doc as unknown as Record<string, unknown>) : null;
    },
    async current(tx: Tx, target) {
      const req = tx as PayloadRequest;
      if (!(target.collection in req.payload.collections)) return null;
      const doc = await req.payload.findByID({
        collection: target.collection as CollectionSlug,
        id: target.id,
        req,
        overrideAccess: true,
        depth: 0,
        disableErrors: true,
      });
      return doc ? redactSecrets(doc) : null;
    },
    async inTransaction(tx: Tx, fn) {
      const req = tx as PayloadRequest;
      const started = await initTransaction(req);
      try {
        const result = await fn();
        if (started) await commitTransaction(req);
        return result;
      } catch (err) {
        await killTransaction(req);
        throw err;
      }
    },
  };
}

const REFUSAL: Record<RevertRefusal, { status: number; code: 'forbidden' | 'not_found' | 'conflict' }> = {
  forbidden: { status: 403, code: 'forbidden' },
  'not-found': { status: 404, code: 'not_found' },
  'not-revertible': { status: 409, code: 'conflict' },
  'changed-since': { status: 409, code: 'conflict' },
};

const revertEndpoint: Endpoint = {
  path: '/:id/revert',
  method: 'post',
  handler: async (req) => {
    const id = String(req.routeParams?.id ?? '');
    const result = await revertEntry({ store: payloadRevertStore(), handlers: revertHandlerRegistry }, req, roleOf(req.user), id);
    if (result.ok) return Response.json({ ok: true, value: {} }, { headers: NO_STORE });
    const { status, code } = REFUSAL[result.reason];
    return Response.json({ ok: false, error: { code, reason: result.reason } }, { status, headers: NO_STORE });
  },
};

const policy = accessFor('audit');

export const auditLog: CollectionConfig = {
  slug: AUDIT_LOG,
  labels: { singular: 'Запис журналу', plural: 'Журнал змін' },
  admin: { useAsTitle: 'action', defaultColumns: ['at', 'action', 'actor', 'target', 'revertible'] },
  access: { read: policy.read, create: never, update: never, delete: never },
  endpoints: [revertEndpoint],
  fields: [
    {
      name: 'actor',
      type: 'group',
      fields: [
        { name: 'kind', type: 'select', options: ['owner', 'agent', 'system'], required: true },
        { name: 'ref', type: 'text', required: true },
        { name: 'label', type: 'text', required: true },
      ],
    },
    { name: 'action', type: 'text', required: true, index: true },
    {
      name: 'target',
      type: 'group',
      fields: [
        { name: 'collection', type: 'text', required: true, index: true },
        { name: 'ref', type: 'text', required: true, index: true },
      ],
    },
    { name: 'at', type: 'date', required: true, index: true },
    { name: 'before', type: 'json' },
    { name: 'after', type: 'json' },
    { name: 'revertOf', type: 'text', index: true },
    { name: 'revertible', type: 'checkbox', required: true, defaultValue: false },
  ],
};
