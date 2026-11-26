/**
 * Opaque public author ids (SPEC-14 [П-9], [А14]; AC-52), application ring. `author_ids` maps a subject to a random
 * 128-bit base64url id created on first need (`INSERT ... ON CONFLICT (subject_id) DO NOTHING`, then a re-read, so
 * parallel callers agree). The id is never derived from the subject id. `authorIdOf` / `subjectOfAuthor` are the internal
 * interface for SPEC-15 (the chat puts the id into messages). A malformed id never reaches the database.
 * Merge: a guest's row stays with the guest (see the ledger); the account keeps or gets its own id.
 */
import { randomBytes } from 'node:crypto';
import type { AuthorIdRow, AuthorIdStore, RightsDb } from './ports';

const AUTHOR_ID = /^[A-Za-z0-9_-]{22}$/;

export const isAuthorId = (v: unknown): v is string => typeof v === 'string' && AUTHOR_ID.test(v);

/** 16 random bytes as base64url (22 characters). */
export const newAuthorId = (): string => randomBytes(16).toString('base64url');

export function createSqlAuthorIdStore(): AuthorIdStore {
  return {
    async ensure(db, subjectId, makeId, at) {
      await db.query('INSERT INTO author_ids (subject_id, author_id, created_at) VALUES ($1, $2, $3) ON CONFLICT (subject_id) DO NOTHING', [subjectId, makeId(), String(at)]);
      const res = await db.query<Pick<AuthorIdRow, 'author_id'> & Record<string, unknown>>('SELECT author_id FROM author_ids WHERE subject_id = $1', [subjectId]);
      const id = res.rows[0]?.author_id;
      if (id === undefined) throw new Error('author id missing after insert');
      return id;
    },
    async subjectOf(db, authorId) {
      const res = await db.query<{ subject_id: string }>('SELECT subject_id FROM author_ids WHERE author_id = $1', [authorId]);
      return res.rows[0]?.subject_id ?? null;
    },
  };
}

export interface AuthorIds {
  /** The subject's author id, created on first need. */
  authorIdOf(subjectId: string, now: number): Promise<string>;
  /** The subject behind an author id, or `null` (also for a malformed id). */
  subjectOfAuthor(authorId: string): Promise<string | null>;
}

export function createAuthorIds(deps: { db(): Promise<RightsDb>; store?: AuthorIdStore; makeId?: () => string }): AuthorIds {
  const store = deps.store ?? createSqlAuthorIdStore();
  const makeId = deps.makeId ?? newAuthorId;
  return {
    async authorIdOf(subjectId, now) {
      return store.ensure(await deps.db(), subjectId, makeId, now);
    },
    async subjectOfAuthor(authorId) {
      if (!isAuthorId(authorId)) return null;
      return store.subjectOf(await deps.db(), authorId);
    },
  };
}
