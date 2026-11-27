/**
 * SPEC-14 S14-10 — the `users.created_at` cache of the established-subject rule: the PK-indexed read, no query for a
 * non-uuid id, a short negative / failure cache, and priming from the session fast path.
 */
import { describe, expect, it } from 'vitest';
import type { RightsDb } from '../../src/presence/ports';
import { createSubjectAges, SUBJECT_AGE_NEGATIVE_MS } from '../../src/presence/subjectAges';

const ID = '0b6f3c2e-6a43-4f7e-9a51-2d3c4b5a6f70';

function fakeDb(answer: () => Promise<{ ms: number | null } | undefined>) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const db = {
    async query(sql: string, params: unknown[]) {
      calls.push({ sql, params });
      const row = await answer();
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    },
  } as unknown as RightsDb;
  return { db, calls };
}

describe('subject ages (S14-10)', () => {
  it('reads users by the primary key (id = $1::uuid, no cast of the column) and caches the value', async () => {
    const { db, calls } = fakeDb(async () => ({ ms: 1_000 }));
    const ages = createSubjectAges({ db: async () => db });
    expect(await ages.createdAt(ID)).toBe(1_000);
    expect(await ages.createdAt(ID)).toBe(1_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain('WHERE id = $1::uuid');
    expect(calls[0]?.sql).not.toContain('id::text');
  });

  it('an id that is not a uuid is never queried', async () => {
    const { db, calls } = fakeDb(async () => ({ ms: 1_000 }));
    const ages = createSubjectAges({ db: async () => db });
    expect(await ages.createdAt('not-a-uuid')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('an unknown subject and a failed read are remembered as null for a short time', async () => {
    let now = 0;
    let fail = true;
    const { db, calls } = fakeDb(async () => {
      if (fail) throw new Error('pool timeout');
      return undefined;
    });
    const ages = createSubjectAges({ db: async () => db, now: () => now });
    expect(await ages.createdAt(ID)).toBeNull();
    expect(await ages.createdAt(ID)).toBeNull();
    expect(calls).toHaveLength(1);
    now += SUBJECT_AGE_NEGATIVE_MS + 1;
    fail = false;
    expect(await ages.createdAt(ID)).toBeNull();
    expect(await ages.createdAt(ID)).toBeNull();
    expect(calls).toHaveLength(2);
  });

  it('a primed value (session fast path) answers without a query and clears a negative entry', async () => {
    const { db, calls } = fakeDb(async () => undefined);
    const ages = createSubjectAges({ db: async () => db });
    expect(await ages.createdAt(ID)).toBeNull();
    ages.prime(ID, 5_000);
    expect(await ages.createdAt(ID)).toBe(5_000);
    ages.prime(ID, Number.NaN);
    expect(await ages.createdAt(ID)).toBe(5_000);
    expect(calls).toHaveLength(1);
  });
});
