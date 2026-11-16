/**
 * Fast-store adapters (ring 4): the Redis `FastStore` and the in-process one used by the
 * `memory` rate-limit policy (AC-50).
 * - The Redis client is lazy, never queues offline and never retries a command: a request
 *   either reaches Redis now or fails with `DependencyUnavailable`.
 * - Every key is under `T2F_REDIS_PREFIX` (applied by the client). `SCAN` does not apply the
 *   client prefix, so `deleteByPrefix` matches the full prefix itself and strips it again
 *   before `UNLINK` (which does apply it).
 */
import { Redis } from 'ioredis';
import { DependencyUnavailable, type Clock, type FastStore } from '../ports';

export interface RedisStore extends FastStore {
  /** Closes the connection; the store is unusable afterwards. */
  close(): Promise<void>;
}

export interface RedisStoreVars {
  REDIS_URL?: unknown;
  T2F_REDIS_PREFIX?: unknown;
}

const SCAN_BATCH = 500;
const CONNECTION_TEXT = /Stream isn't writeable|Connection is closed|ECONNREFUSED|ETIMEDOUT|ECONNRESET|connect/i;

/** `*`, `?`, `[`, `]` and `\` are literal in the match pattern. */
function escapeGlob(s: string): string {
  return s.replace(/[*?[\]\\]/g, '\\$&');
}

/** A Redis store for the URL (its path is the slot's database) and key prefix of `vars`. */
export function createRedisStore(vars: RedisStoreVars, opts: { onError?: (err: unknown) => void } = {}): RedisStore {
  if (typeof vars.REDIS_URL !== 'string') throw new Error('redis: REDIS_URL is not set');
  const prefix = typeof vars.T2F_REDIS_PREFIX === 'string' ? vars.T2F_REDIS_PREFIX : '';
  const client = new Redis(vars.REDIS_URL, {
    keyPrefix: prefix,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: 500,
    lazyConnect: true,
  });
  // Without a listener ioredis prints every reconnect failure; the caller decides what to log.
  client.on('error', (err: unknown) => opts.onError?.(err));

  let connecting: Promise<void> | undefined;
  async function ready(): Promise<void> {
    if (client.status === 'wait') {
      connecting ??= client.connect().finally(() => {
        connecting = undefined;
      });
    }
    if (connecting) await connecting;
  }

  /** Runs one operation; a connection-level failure becomes `DependencyUnavailable`. */
  async function op<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await ready();
      return await fn();
    } catch (err) {
      const code = (err as { code?: unknown }).code;
      const text = err instanceof Error ? err.message : '';
      if (client.status !== 'ready' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || CONNECTION_TEXT.test(text)) {
        throw new DependencyUnavailable('redis', { cause: err });
      }
      throw err;
    }
  }

  return {
    incrWindow: (key, windowMs) =>
      op(async () => {
        const res = await client.multi().incr(key).pexpire(key, windowMs, 'NX').pttl(key).exec();
        if (!res) throw new DependencyUnavailable('redis');
        for (const [err] of res) if (err) throw err;
        return { count: Number(res[0]?.[1]), ttlMs: Number(res[2]?.[1]) };
      }),
    setIfAbsent: (key, value, ttlMs) => op(async () => (await client.set(key, value, 'PX', ttlMs, 'NX')) === 'OK'),
    get: (key) => op(() => client.get(key)),
    set: (key, value, ttlMs) =>
      op(async () => {
        await client.set(key, value, 'PX', ttlMs);
      }),
    del: (key) =>
      op(async () => {
        await client.unlink(key);
      }),
    deleteByPrefix: (sub) =>
      op(async () => {
        const full = prefix + sub;
        // An empty full prefix would match every key of the database — never this worktree's alone.
        if (full === '') throw new Error('redis: deleteByPrefix needs a non-empty prefix');
        const match = `${escapeGlob(full)}*`;
        let cursor = '0';
        let deleted = 0;
        do {
          const [next, keys] = await client.scan(cursor, 'MATCH', match, 'COUNT', SCAN_BATCH);
          cursor = next;
          const own = keys.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
          for (let i = 0; i < own.length; i += SCAN_BATCH) {
            deleted += await client.unlink(...own.slice(i, i + SCAN_BATCH));
          }
        } while (cursor !== '0');
        return deleted;
      }),
    async close() {
      if (client.status === 'wait' || client.status === 'end') {
        client.disconnect();
        return;
      }
      await client.quit().catch(() => client.disconnect());
    },
  };
}

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

/** In-process `FastStore` with lazy expiry, timed by `clock`. One per process. */
export function createMemoryStore(clock: Clock): FastStore {
  const map = new Map<string, MemoryEntry>();
  const live = (key: string): MemoryEntry | undefined => {
    const e = map.get(key);
    if (e && e.expiresAt <= clock.now()) {
      map.delete(key);
      return undefined;
    }
    return e;
  };
  return {
    async incrWindow(key, windowMs) {
      const now = clock.now();
      const e = live(key);
      if (!e) {
        map.set(key, { value: '1', expiresAt: now + windowMs });
        return { count: 1, ttlMs: windowMs };
      }
      e.value = String(Number(e.value) + 1);
      return { count: Number(e.value), ttlMs: e.expiresAt - now };
    },
    async setIfAbsent(key, value, ttlMs) {
      if (live(key)) return false;
      map.set(key, { value, expiresAt: clock.now() + ttlMs });
      return true;
    },
    async get(key) {
      return live(key)?.value ?? null;
    },
    async set(key, value, ttlMs) {
      map.set(key, { value, expiresAt: clock.now() + ttlMs });
    },
    async del(key) {
      map.delete(key);
    },
    async deleteByPrefix(prefix) {
      let n = 0;
      for (const key of [...map.keys()]) {
        if (key.startsWith(prefix)) {
          map.delete(key);
          n += 1;
        }
      }
      return n;
    },
  };
}
