/**
 * Shared helpers of the integration suite: deps for the `test` class against this worktree's
 * real Postgres and Redis, with a Redis store the test owns (and closes).
 */
import { createDeps, type DepsOverrides } from '../../src/container';
import { createRedisStore, type RedisStore } from '../../src/adapters/redis';
import type { Deps } from '../../src/endpoints/types';

/** Loopback, like every caller of the test doors (they refuse any other Host). */
export const BASE = 'http://127.0.0.1:3000';
export const ORIGIN = 'http://allowed.test';
export const silent = { info: () => {}, warn: () => {}, error: () => {} };

export function ownRedis(): RedisStore {
  return createRedisStore({ REDIS_URL: process.env.REDIS_URL, T2F_REDIS_PREFIX: process.env.T2F_REDIS_PREFIX });
}

export function testDeps(overrides: DepsOverrides = {}, env: Record<string, string | undefined> = {}): Deps {
  return createDeps(
    { ...process.env, T2F_ENV: 'test', T2F_TEST_DOORS: '1', T2F_ALLOWED_ORIGINS: ORIGIN, ...env },
    { log: silent, ...overrides },
  );
}

export const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(BASE + path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
  });
