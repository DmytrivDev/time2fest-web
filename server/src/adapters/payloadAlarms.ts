/**
 * Alarm store over Payload (AC-37, AC-38), ring 4. Saves go through the Local API as a server-side
 * call, journalled with the actor `system:alarms`; the acknowledgement runs on the caller's `req`
 * (its transaction), so the audit hook journals it in the same transaction.
 */
import type { Payload, PayloadRequest } from 'payload';
import type { AlarmRecord, AlarmStore } from '../alarms/ports';
import { ACTOR_CONTEXT_KEY } from '../audit/journal';
import type { Clock } from '../ports';

export const ALARMS = 'alarms';
const ID = /^\d{1,15}$/;
const MAX_TEXT = 100;

const iso = (ms: number) => new Date(ms).toISOString();

function toRecord(doc: Record<string, unknown>): AlarmRecord {
  return {
    id: String(doc.id),
    source: String(doc.source),
    code: String(doc.code),
    level: 'page',
    raisedAt: Date.parse(String(doc.raisedAt)),
    acknowledgedAt: doc.acknowledgedAt ? Date.parse(String(doc.acknowledgedAt)) : null,
  };
}

export function createPayloadAlarmStore(payload: () => Promise<Payload>, clock: Clock): AlarmStore {
  return {
    async save({ source, code }) {
      const p = await payload();
      const doc = await p.create({
        collection: ALARMS,
        data: { source: source.slice(0, MAX_TEXT), code: code.slice(0, MAX_TEXT), level: 'page', raisedAt: iso(clock.now()), acknowledgedAt: null },
        overrideAccess: true,
        depth: 0,
        context: { [ACTOR_CONTEXT_KEY]: 'system:alarms' },
      });
      return { id: String(doc.id) };
    },
    async listOpenPage() {
      const p = await payload();
      const found = await p.find({
        collection: ALARMS,
        where: { and: [{ level: { equals: 'page' } }, { acknowledgedAt: { exists: false } }] },
        sort: '-raisedAt',
        limit: 100,
        depth: 0,
        overrideAccess: true,
      });
      return found.docs.map((d) => toRecord(d as unknown as Record<string, unknown>));
    },
    async acknowledge(tx, id, at) {
      if (!ID.test(id)) return 'not-found';
      const req = tx as PayloadRequest;
      const doc = await req.payload.findByID({ collection: ALARMS, id: Number(id), req, overrideAccess: true, depth: 0, disableErrors: true });
      if (!doc) return 'not-found';
      if (doc.acknowledgedAt) return 'already';
      await req.payload.update({ collection: ALARMS, id: Number(id), data: { acknowledgedAt: iso(at) }, req, overrideAccess: true, depth: 0 });
      return 'ok';
    },
  };
}
