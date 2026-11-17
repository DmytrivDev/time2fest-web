/**
 * Payload adapters (ring 4). Payload rows never leave this file (onion ban 3): the idempotency
 * store returns only `{ status, result }`, the seed store only counts.
 */
import type { CollectionSlug, Payload } from 'payload';
import { isDependencyFailure } from '../endpoints/pipeline';
import { DependencyUnavailable, type IdempotencyBegin, type IdempotencyStore, type SeedStore } from '../ports';

const COLLECTION = 'idempotency-records';

/**
 * The seed writes as the system: server-side, without the catalog's integrity and version hooks (AC-88)
 * and without a journal row per row (a seed is not an owner action; the stack starts from it).
 */
const SEED_CONTEXT = { t2fTrusted: true, t2fImport: true, t2fInternal: true, t2fActor: 'system:seed' };

/** Emptying a collection for the reset: server-side, not journalled. */
const CLEAR_CONTEXT = { t2fTrusted: true, t2fImport: true, t2fInternal: true, t2fActor: 'system:seed' };

/** Rows written at the same time (each in its own short transaction; the database pool holds 10). */
const CONCURRENCY = 6;
/** Rows removed by one delete call. */
const CLEAR_CHUNK = 100;

/** Runs `worker` over `items`, at most `CONCURRENCY` at a time; the first failure stops the rest from starting. */
async function inParallel<T>(items: readonly T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const item = items[next++] as T;
      try {
        await worker(item);
      } catch (err) {
        failed = true;
        throw err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane));
}

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

/** The seed's row store over Payload (upsert by natural key, count, clear); access control is bypassed. */
export function createPayloadSeedStore(getPayload: () => Promise<Payload>): SeedStore {
  return {
    upsertMany: (slug, naturalKey, rows) =>
      guard(async () => {
        const payload = await getPayload();
        const collection = slug as CollectionSlug;
        // One read of the existing keys instead of one search per row.
        const found = await payload.find({
          collection,
          depth: 0,
          pagination: false,
          select: { [naturalKey]: true } as never,
          overrideAccess: true,
        });
        const ids = new Map(
          (found.docs as unknown as Record<string, unknown>[]).map((d) => [String(d[naturalKey]), d.id as string | number]),
        );
        await inParallel(rows, async (data) => {
          const existing = ids.get(String(data[naturalKey]));
          if (existing !== undefined) {
            await payload.update({ collection, id: existing, data: data as never, depth: 0, overrideAccess: true, context: SEED_CONTEXT });
          } else {
            await payload.create({ collection, data: data as never, depth: 0, overrideAccess: true, context: SEED_CONTEXT });
          }
        });
      }),
    upsertByKey: (slug, naturalKey, data) =>
      guard(async () => {
        const payload = await getPayload();
        const collection = slug as CollectionSlug;
        const found = await payload.find({
          collection,
          where: { [naturalKey]: { equals: data[naturalKey] } },
          limit: 1,
          depth: 0,
          overrideAccess: true,
        });
        const existing = found.docs[0] as { id: string | number } | undefined;
        if (existing) {
          await payload.update({ collection, id: existing.id, data: data as never, overrideAccess: true, context: SEED_CONTEXT });
        } else {
          await payload.create({ collection, data: data as never, overrideAccess: true, context: SEED_CONTEXT });
        }
      }),
    count: (slug) =>
      guard(async () => {
        const payload = await getPayload();
        return (await payload.count({ collection: slug as CollectionSlug, overrideAccess: true })).totalDocs;
      }),
    clear: (slug) =>
      guard(async () => {
        const payload = await getPayload();
        const collection = slug as CollectionSlug;
        const found = await payload.find({ collection, depth: 0, pagination: false, select: { id: true } as never, overrideAccess: true });
        const ids = (found.docs as unknown as { id: string | number }[]).map((d) => d.id);
        const chunks: (string | number)[][] = [];
        for (let i = 0; i < ids.length; i += CLEAR_CHUNK) chunks.push(ids.slice(i, i + CLEAR_CHUNK));
        // Chunks in parallel, each its own call and transaction; every row still goes through its delete hooks.
        await inParallel(chunks, async (chunk) => {
          await payload.delete({ collection, where: { id: { in: chunk } }, overrideAccess: true, context: CLEAR_CONTEXT });
        });
      }),
  };
}
