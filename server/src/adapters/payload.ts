/**
 * Payload adapters (ring 4). Payload rows never leave this file (onion ban 3): the idempotency
 * store returns only `{ status, result }`.
 */
import type { Payload } from 'payload';
import { isDependencyFailure } from '../endpoints/pipeline';
import { DependencyUnavailable, type IdempotencyBegin, type IdempotencyStore } from '../ports';

const COLLECTION = 'idempotency-records';

/** A connection-level Postgres failure becomes `DependencyUnavailable`; anything else is rethrown. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isDependencyFailure(err)) throw new DependencyUnavailable('postgres', { cause: err });
    throw err;
  }
}

/** `order`-class idempotency records in Postgres (`idempotency_records`, unique `key`). */
export function createPayloadIdempotencyStore<R = unknown>(getPayload: () => Promise<Payload>): IdempotencyStore<R> {
  const read = async (payload: Payload, key: string): Promise<IdempotencyBegin<R> | undefined> => {
    const found = await payload.find({
      collection: COLLECTION,
      where: { key: { equals: key } },
      limit: 1,
      depth: 0,
      overrideAccess: true,
    });
    const doc = found.docs[0];
    if (!doc) return undefined;
    return doc.status === 'done' ? { status: 'done', result: doc.result as R } : { status: 'running' };
  };

  return {
    begin: (key) =>
      guard(async () => {
        const payload = await getPayload();
        try {
          await payload.create({ collection: COLLECTION, data: { key, status: 'running' }, overrideAccess: true });
          return 'started';
        } catch (err) {
          if (isDependencyFailure(err)) throw err;
          // The unique `key` is taken: someone began first — report what they left.
          const existing = await read(payload, key);
          if (existing) return existing;
          throw err;
        }
      }),
    finish: (key, result) =>
      guard(async () => {
        const payload = await getPayload();
        await payload.update({
          collection: COLLECTION,
          where: { key: { equals: key } },
          data: { status: 'done', result: result as never },
          overrideAccess: true,
        });
      }),
    abort: (key) =>
      guard(async () => {
        const payload = await getPayload();
        await payload.delete({ collection: COLLECTION, where: { key: { equals: key } }, overrideAccess: true });
      }),
  };
}
