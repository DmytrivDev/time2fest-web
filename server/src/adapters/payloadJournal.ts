/**
 * The audit journal over Payload (AC-20, NFR-5), ring 4. Rows are created through the Local API with the
 * CALLER'S `req`, so the row joins the caller's transaction, and with `overrideAccess`, because no role may
 * write the journal through the API (AC-21). `isRevertible` comes from the revert-handler registry.
 */
import type { PayloadRequest } from 'payload';
import { AUDIT_LOG } from '../audit/journal';
import type { Journal, JournalEntry, Tx } from '../audit/ports';

export function createPayloadJournal(isRevertible: (action: string) => boolean): Journal {
  return {
    async append(tx: Tx, entry: JournalEntry) {
      const req = tx as PayloadRequest;
      await req.payload.create({
        collection: AUDIT_LOG,
        req,
        overrideAccess: true,
        depth: 0,
        data: {
          actor: { kind: entry.actor.kind, ref: entry.actor.id, label: entry.actor.label },
          action: entry.action,
          target: { collection: entry.target.collection, ref: entry.target.id },
          at: new Date(entry.at).toISOString(),
          before: entry.before,
          after: entry.after,
          revertOf: entry.revertOf,
          revertible: isRevertible(entry.action),
        },
      });
    },
  };
}
