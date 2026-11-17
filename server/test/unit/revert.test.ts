import { describe, expect, it, vi } from 'vitest';
import type { RevertHandler, RevertStore, StoredJournalEntry } from '../../src/audit/ports';
import { revertEntry } from '../../src/audit/revert';
import { canRevert, deepEqual, restoreData } from '../../src/domain/audit/revert';

const entry = (over: Partial<StoredJournalEntry> = {}): StoredJournalEntry => ({
  id: '7',
  actor: { kind: 'owner', id: '1', label: 'owner@example.com' },
  action: 'collection.update',
  target: { collection: 'agent-test-posts', id: '3' },
  at: 0,
  before: { id: 3, title: 'A', status: 'draft', updatedAt: 't0' },
  after: { id: 3, title: 'B', status: 'draft', updatedAt: 't1' },
  revertOf: null,
  revertible: true,
  ...over,
});

describe('revert rules (AC-22, AC-23)', () => {
  it('ok while the target holds `after`; bookkeeping fields are ignored', () => {
    expect(canRevert(entry(), { id: 3, title: 'B', status: 'draft', updatedAt: 'later' })).toBe('ok');
  });

  it('changed-since when a field of `after` differs, or the target is gone', () => {
    expect(canRevert(entry(), { id: 3, title: 'C', status: 'draft' })).toBe('changed-since');
    expect(canRevert(entry(), null)).toBe('changed-since');
    expect(canRevert(entry({ after: null }), { title: 'B' })).toBe('changed-since');
  });

  it('deep compare: nested values, arrays, null ≡ undefined', () => {
    expect(deepEqual({ a: [1, { b: null }] }, { a: [1, { b: undefined }] })).toBe(true);
    expect(deepEqual({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('restore data: every field of `after` set to its `before` value, bookkeeping excluded', () => {
    expect(restoreData(entry().before, { ...entry().after, extra: 1 })).toEqual({ title: 'A', status: 'draft', extra: null });
  });
});

describe('revert use case (AC-22 … AC-25)', () => {
  function setup(current: Record<string, unknown> | null, stored: StoredJournalEntry | null = entry()) {
    const handler: RevertHandler = { key: 'collection.update', revert: vi.fn(async () => {}) };
    const store: RevertStore = {
      entry: vi.fn(async () => stored),
      current: vi.fn(async () => current),
      inTransaction: async (_tx, fn) => fn(),
    };
    return { handler, store, deps: { store, handlers: [handler] } };
  }
  const tx = {};

  it('a role other than owner is refused before any lookup', async () => {
    const { deps, store } = setup({ title: 'B', status: 'draft' });
    expect(await revertEntry(deps, tx, 'content-agent', '7')).toEqual({ ok: false, reason: 'forbidden' });
    expect(await revertEntry(deps, tx, null, '7')).toEqual({ ok: false, reason: 'forbidden' });
    expect(store.entry).not.toHaveBeenCalled();
  });

  it('unknown row → not-found; no handler → not-revertible', async () => {
    expect(await revertEntry(setup(null, null).deps, tx, 'owner', '9')).toEqual({ ok: false, reason: 'not-found' });
    const { deps, handler } = setup({ title: 'B' }, entry({ action: 'key.issue' }));
    expect(await revertEntry(deps, tx, 'owner', '7')).toEqual({ ok: false, reason: 'not-revertible' });
    expect(handler.revert).not.toHaveBeenCalled();
  });

  it('changed-since writes nothing; a matching target runs the handler once', async () => {
    const stale = setup({ title: 'C', status: 'draft' });
    expect(await revertEntry(stale.deps, tx, 'owner', '7')).toEqual({ ok: false, reason: 'changed-since' });
    expect(stale.handler.revert).not.toHaveBeenCalled();

    const fresh = setup({ id: 3, title: 'B', status: 'draft' });
    expect(await revertEntry(fresh.deps, tx, 'owner', '7')).toEqual({ ok: true });
    expect(fresh.handler.revert).toHaveBeenCalledTimes(1);
  });
});
