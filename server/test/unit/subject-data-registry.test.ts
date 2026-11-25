/**
 * SPEC-10 W42 (AC-50, AC-5): the subject-data registry has the `auth` handler and the declarative `auth-codes` row
 * (10 min), sorted; the `auth` handler refuses to run outside the auth scope; the guest-cleanup rules and job.
 */
import { describe, expect, it } from 'vitest';
import { authSubjectData } from '../../src/auth/subjectData';
import { GUEST_STALE_MS, holdsOtherData, isEmptySubjectData, isStale } from '../../src/domain/auth/guestPrune';
import { createGuestPruneJob, GUEST_PRUNE_EVERY_MS } from '../../src/ops/guestPrune';
import type { OpsLease } from '../../src/ops/ports';
import type { SubjectDataResult } from '../../src/platform/subjectData';
import { subjectDataRegistry } from '../../src/registries/subjectData';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe('subject-data registry (AC-50)', () => {
  it('has auth (handler) and auth-codes (declarative, 10 min), sorted by capability', () => {
    const names = subjectDataRegistry.map((r) => r.capability);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(expect.arrayContaining(['auth', 'auth-codes']));
    const auth = subjectDataRegistry.find((r) => r.capability === 'auth');
    expect(auth).toBe(authSubjectData);
    expect(auth && 'declarative' in auth).toBe(false);
    expect(subjectDataRegistry.find((r) => r.capability === 'auth-codes')).toMatchObject({ declarative: true, retention: '10 min' });
  });

  it('the auth handler refuses to run outside the auth scope', async () => {
    await expect(authSubjectData.export('x')).rejects.toThrow(/runInAuthScope/);
    await expect(authSubjectData.erase('x')).rejects.toThrow(/runInAuthScope/);
  });
});

describe('guest cleanup rules (AC-5)', () => {
  const now = Date.parse('2027-02-01T00:00:00Z');
  it('stale after 30 days of no activity', () => {
    expect(isStale(now - GUEST_STALE_MS, now)).toBe(true);
    expect(isStale(now - GUEST_STALE_MS + 1, now)).toBe(false);
    expect(isStale(Number.NaN, now)).toBe(false);
  });
  it('empty results do not keep a guest; any other capability with data does', () => {
    expect(isEmptySubjectData(null)).toBe(true);
    expect(isEmptySubjectData({ a: [], b: { c: null } })).toBe(true);
    expect(isEmptySubjectData({ a: [1] })).toBe(false);
    expect(isEmptySubjectData(0)).toBe(false);
    expect(holdsOtherData({ auth: { sessions: [1] }, chat: null }, 'auth')).toBe(false);
    expect(holdsOtherData({ auth: null, chat: { messages: ['hi'] } }, 'auth')).toBe(true);
  });
});

describe('guest cleanup job', () => {
  const now = Date.parse('2027-02-01T00:00:00Z');
  const lease = (held = true): OpsLease => ({ acquire: async () => held, release: async () => {} });
  const ok = (results: Record<string, unknown>): SubjectDataResult => ({ ok: true, results, declarative: [] });

  function job(exports: Record<string, SubjectDataResult | Error>, held = true) {
    const deleted: string[] = [];
    const j = createGuestPruneJob({
      lease: lease(held),
      guests: {
        staleGuests: async () => Object.keys(exports).map((id) => ({ id, lastActiveAtMs: now - GUEST_STALE_MS - 1 })),
        deleteIfStale: async (id) => {
          deleted.push(id);
          return true;
        },
      },
      exportSubject: async (id) => {
        const r = exports[id]!;
        if (r instanceof Error) throw r;
        return r;
      },
      ownCapability: 'auth',
      log: silent,
    });
    return { j, deleted };
  }

  it('deletes guests without other data, keeps the rest, keeps on export failure; hourly; lease', async () => {
    const { j, deleted } = job({
      empty: ok({ auth: { sessions: [{}] } }),
      holds: ok({ auth: null, chat: ['x'] }),
      partial: { ok: false, failed: ['chat'], declarative: [] },
      throws: new Error('db'),
    });
    expect(await j.run(now)).toEqual({ result: 'pruned', removed: 1, kept: 1, failed: 2 });
    expect(deleted).toEqual(['empty']);
    expect(await j.run(now + GUEST_PRUNE_EVERY_MS - 1)).toEqual({ result: 'idle' });
    expect((await j.run(now + GUEST_PRUNE_EVERY_MS)).result).toBe('pruned');
    expect(await job({}, false).j.run(now)).toEqual({ result: 'not-held' });
  });
});
