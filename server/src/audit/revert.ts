/**
 * Revert of a journal row (AC-22 … AC-25), ring 3.
 * - only the owner (else `forbidden`, before any lookup);
 * - an unknown row → `not-found`; no handler for its action → `not-revertible`;
 * - the target no longer holds the row's `after` → `changed-since`, nothing written;
 * - else the handler runs in one transaction; it writes the new journal row (`revertOf` = the row).
 */
import { canRevert } from '../domain/audit/revert';
import type { RevertHandler, RevertStore, Tx } from './ports';

export type RevertRefusal = 'forbidden' | 'not-found' | 'not-revertible' | 'changed-since';
export type RevertResult = { ok: true } | { ok: false; reason: RevertRefusal };

export interface RevertDeps {
  store: RevertStore;
  handlers: readonly RevertHandler[];
}

export async function revertEntry(deps: RevertDeps, tx: Tx, actorRole: string | null, id: string): Promise<RevertResult> {
  if (actorRole !== 'owner') return { ok: false, reason: 'forbidden' };
  return deps.store.inTransaction(tx, async () => {
    const entry = await deps.store.entry(tx, id);
    if (!entry) return { ok: false, reason: 'not-found' } as const;
    const handler = deps.handlers.find((h) => h.key === entry.action);
    if (!handler) return { ok: false, reason: 'not-revertible' } as const;
    const current = handler.current ? await handler.current(tx, entry) : await deps.store.current(tx, entry.target);
    if (canRevert(entry, current) !== 'ok') return { ok: false, reason: 'changed-since' } as const;
    await handler.revert(tx, entry);
    return { ok: true } as const;
  });
}
