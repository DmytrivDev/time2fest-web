/**
 * SPEC-10 W42 (AC-5) — the `auth-guest-prune` job through the `ops-tick` door over real Postgres: a guest with no
 * session activity for 30+ days and no data in any other subject-data handler is removed with its sessions; a stale
 * guest that a (test) handler holds data for is kept; a recent guest is kept.
 * The two stale guests are made stale by moving their own rows 31 days back (the door ticks at the real now), so no
 * other guest of the shared test database is touched.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SubjectDataHandler } from '../../src/platform/subjectData';
import { subjectDataRegistry } from '../../src/registries/subjectData';
import { buildAuthHarness, CookieJar, writeProbe, type AuthHarness } from '../support/authClient';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
const DAY = 86_400_000;
let pool: pg.Pool;
let h: AuthHarness;
const held = new Set<string>();
const made: string[] = [];

/** A test capability that holds data for the guests in `held`. */
const keeper: SubjectDataHandler = {
  capability: 'it-keeper',
  export: async (id) => (held.has(id) ? { items: ['x'] } : null),
  erase: async () => null,
  anonymise: async () => null,
};

async function guest(): Promise<string> {
  const res = await writeProbe(h, { jar: new CookieJar() });
  expect(res.status).toBe(200);
  const id = ((await res.json()) as { value: { subject: string } }).value.subject;
  made.push(id);
  return id;
}

async function age(id: string, days: number): Promise<void> {
  const at = new Date(Date.now() - days * DAY);
  await pool.query('UPDATE users SET created_at = $2, updated_at = $2 WHERE id = $1', [id, at]);
  await pool.query('UPDATE user_sessions SET created_at = $2, updated_at = $2 WHERE user_id = $1', [id, at]);
}

const countOf = async (id: string) =>
  (await pool.query('SELECT (SELECT count(*) FROM users WHERE id = $1)::int AS u, (SELECT count(*) FROM user_sessions WHERE user_id = $1)::int AS s', [id]))
    .rows[0] as { u: number; s: number };

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  // The `ops-auth` lease lives 90 min; a process of an earlier file or run that was killed while holding it (the crash
  // case of the alarm tests) would make this tick `not-held`. This test's process is the only holder it means.
  await pool.query(`UPDATE scheduler_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE name = 'ops-auth'`);
  h = await buildAuthHarness(redis, (deps) => {
    deps.subjectData = [...subjectDataRegistry, keeper];
  });
});

afterAll(async () => {
  await h.deps.opsRunner?.stop();
  await pool.query('DELETE FROM users WHERE created_at >= $1 OR id = ANY($2::uuid[])', [started, made]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.close();
});

describe('guest cleanup through the ops-tick door (AC-5)', () => {
  it('removes a stale guest without data with its sessions; keeps a stale guest with data and a recent guest', { timeout: 60_000 }, async () => {
    const lonely = await guest();
    const keptByData = await guest();
    const recent = await guest();
    held.add(keptByData);
    expect((await countOf(lonely)).s).toBe(1);
    await age(lonely, 31);
    await age(keptByData, 31);
    await age(recent, 29);

    const res = await h.call('/api/_test/ops-tick', { body: { now: new Date().toISOString(), jobs: ['auth-guest-prune'] } });
    expect(res.status).toBe(200);
    const out = ((await res.json()) as { value: { jobs: Record<string, { result: string; removed?: number; kept?: number }> } }).value.jobs['auth-guest-prune']!;
    expect(out.result).toBe('pruned');
    expect(out.removed).toBeGreaterThanOrEqual(1);
    expect(out.kept).toBeGreaterThanOrEqual(1);

    expect(await countOf(lonely)).toEqual({ u: 0, s: 0 });
    expect(await countOf(keptByData)).toEqual({ u: 1, s: 1 });
    expect(await countOf(recent)).toEqual({ u: 1, s: 1 });

    // Hourly: a second tick in the same hour does nothing.
    const again = await h.call('/api/_test/ops-tick', { body: { now: new Date().toISOString(), jobs: ['auth-guest-prune'] } });
    expect(((await again.json()) as { value: { jobs: Record<string, { result: string }> } }).value.jobs['auth-guest-prune']).toEqual({ result: 'idle' });
  });
});
