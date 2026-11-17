/**
 * Journal hooks for audited collections (AC-20), Payload glue (ring 4; the ports and pure code are in `audit/`). `harden` attaches them to every
 * registry row marked `audited`.
 *
 * `afterChange` / `afterDelete` append exactly one journal row on the operation's own `req`, so in
 * the operation's transaction. A journal failure is rethrown: Payload then rolls the whole
 * transaction back, data row included.
 *
 * Request context a caller may set (each is consumed by the first journal row of the request):
 * - `t2fAction`: the action kind instead of `collection.<operation>` (e.g. `key.issue`);
 * - `t2fRevertOf`: the journal row id this write reverts;
 * - `t2fActor`: see `resolveActor`.
 */
import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, CollectionSlug, PayloadRequest } from 'payload';
import { createPayloadJournal } from '../adapters/payloadJournal';
import { ACTION_CONTEXT_KEY, redactSecrets, resolveActor, REVERT_OF_CONTEXT_KEY } from '../audit/journal';
import type { Journal, JournalEntry } from '../audit/ports';
import { clockFor } from '../clock';
import { envClass } from '../platform/env';
import { isRevertible } from '../registries/revertHandlers';

const OVERRIDE_KEY = Symbol.for('t2f.test.journalOverride');
let defaultJournal: Journal | undefined;

/** Test class only: replaces the journal (e.g. one that throws); `null` restores it. */
export function overrideJournalForTest(journal: Journal | null): void {
  if (envClass(process.env) !== 'test') throw new Error('journal override: test class only');
  (globalThis as unknown as Record<symbol, Journal | null>)[OVERRIDE_KEY] = journal;
}

function journal(): Journal {
  const override = (globalThis as unknown as Record<symbol, Journal | null | undefined>)[OVERRIDE_KEY];
  if (override && envClass(process.env) === 'test') return override;
  // Built on first use, so no registry is read at module load.
  return (defaultJournal ??= createPayloadJournal(isRevertible));
}

function take(req: PayloadRequest, key: string): string | null {
  const value = req.context?.[key];
  if (req.context) delete req.context[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function append(req: PayloadRequest, base: Omit<JournalEntry, 'actor' | 'action' | 'at' | 'revertOf'>, operation: string): Promise<void> {
  const entry: JournalEntry = {
    ...base,
    actor: resolveActor(req.user, req.context),
    action: take(req, ACTION_CONTEXT_KEY) ?? `collection.${operation}`,
    at: clockFor(envClass(process.env)).now(),
    revertOf: take(req, REVERT_OF_CONTEXT_KEY),
  };
  await journal().append(req, entry);
}

/** An internal consequence (e.g. the season `generatedAt` bump) is not an owner action: no journal row. */
function isInternal(req: PayloadRequest): boolean {
  return req.context?.t2fInternal === true;
}

export function auditAfterChange(slug: CollectionSlug): CollectionAfterChangeHook {
  return async ({ doc, previousDoc, operation, req }) => {
    if (isInternal(req)) return doc;
    const id = (doc as { id: string | number }).id;
    // The stored value at depth 0 (relations as ids), the same shape the revert check reads. The import
    // writes at depth 0 itself, so the returned document already is that value: one round trip less per row.
    const stored =
      req.context?.t2fImport === true
        ? undefined
        : await req.payload.findByID({ collection: slug, id, req, depth: 0, overrideAccess: true, disableErrors: true });
    await append(
      req,
      {
        target: { collection: slug, id: String(id) },
        before: operation === 'create' ? null : redactSecrets(previousDoc),
        after: redactSecrets(stored ?? doc),
      },
      operation,
    );
    return doc;
  };
}

export function auditAfterDelete(slug: CollectionSlug): CollectionAfterDeleteHook {
  return async ({ doc, id, req }) => {
    if (isInternal(req)) return doc;
    await append(req, { target: { collection: slug, id: String(id) }, before: redactSecrets(doc), after: null }, 'delete');
    return doc;
  };
}
