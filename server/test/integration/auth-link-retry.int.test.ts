/**
 * SPEC-11 W29b (conductor decision 2; AC-49, AC-50) — the `auth-link-retry` job through the `ops-tick` door over real
 * Postgres: a failed finish-step attach (no guest) → retry row `passes` / `device:<id>` → the next run attaches the pass
 * and closes the row; a guest kept by a failed `profile` row → the run succeeds and the guest is removed; a row that
 * always fails → 24 attempts in all, then never again, and exactly one give-up alarm.
 * Each tick is 61 minutes after the previous one (the job is hourly; rows are rescheduled one hour ahead).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rightsOf } from '../../src/endpoints/deps';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { authLinkRegistry, type AuthLinkHandler } from '../../src/registries/authLinks';
import { buildAuthHarness, CookieJar, sessionOf, signIn, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
const tag = randomBytes(4).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;
let at = Date.now();
/** Alarms raised in this process (the `log-alarms` row is throttled per kind for 60 s). */
const raised: { code: string; details?: Record<string, unknown> }[] = [];
const made: string[] = [];

const always: AuthLinkHandler = {
  key: `it-always-${tag}`,
  async link() {
    throw Object.assign(new Error('nope'), { code: 'it-nope' });
  },
};

async function tick(): Promise<{ result: string; closed?: number; failed?: number }> {
  at += 61 * 60_000;
  const res = await h.call('/api/_test/ops-tick', { body: { now: new Date(at).toISOString(), jobs: ['auth-link-retry'] } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { value: { jobs: Record<string, { result: string }> } }).value.jobs['auth-link-retry']!;
}
const retriesFrom = async (from: string) =>
  (await pool.query('SELECT handler, attempts::int AS attempts, last_error_code FROM auth_link_retries WHERE from_subject = $1', [from])).rows as {
    handler: string;
    attempts: number;
    last_error_code: string | null;
  }[];
const ref = (k: string) => `lr-${tag}-${k}`;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  await pool.query(`UPDATE scheduler_leases SET expires_at = clock_timestamp() - interval '1 millisecond' WHERE name = 'ops-auth-link'`);
  h = await buildAuthHarness(redis);
  const alarm = h.deps.alarm;
  h.deps.alarm = {
    ...alarm,
    raise: (a) => {
      raised.push({ code: a.code, ...(a.details ? { details: a.details as Record<string, unknown> } : {}) });
      alarm.raise(a);
    },
  };
});

afterAll(async () => {
  await h.deps.opsRunner?.stop();
  await pool.query('DELETE FROM auth_link_retries WHERE created_at >= $1', [started]);
  await pool.query('DELETE FROM passes WHERE grant_ref LIKE $1', [`lr-${tag}-%`]);
  await pool.query('DELETE FROM profiles WHERE subject_id = ANY($1::text[])', [made]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:link:');
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.close();
});

describe('auth-link-retry job (W29b)', () => {
  it('a failed finish-step attach → retry row passes/device:<id> → the next run attaches and closes it', { timeout: 60_000 }, async () => {
    const jar = new CookieJar();
    const email = testEmail(`lr-dev-${tag}`);
    expect((await signIn(h, redis, jar, email)).status).toBe(200);
    const account = (await sessionOf(h, jar)).user?.id ?? '';
    expect((await h.call('/api/auth/sign-out', { body: {}, jar })).status).toBe(200);
    const device = jar.get(DEVICE_COOKIE) ?? '';
    expect((await rightsOf(h.deps).passes.grantPass({ holder: { device, paymentEmail: `lr-${tag}@example.test` }, source: 'gift', grantRef: ref('dev') })).kind).toBe('granted');

    // The attach fails in the database (a trigger on this pass only): the sign-in still completes.
    const fn = `lr_fail_${tag}`;
    await pool.query(`CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'it' USING ERRCODE = 'P0001'; END $$`);
    await pool.query(`CREATE TRIGGER ${fn} BEFORE UPDATE ON passes FOR EACH ROW WHEN (OLD.grant_ref = '${ref('dev')}') EXECUTE FUNCTION ${fn}()`);
    try {
      expect((await signIn(h, redis, jar, email)).status).toBe(200);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${fn} ON passes`);
      await pool.query(`DROP FUNCTION IF EXISTS ${fn}()`);
    }
    expect(await retriesFrom(`device:${device}`)).toEqual([{ handler: 'passes', attempts: 1, last_error_code: 'P0001' }]);

    const out = await tick();
    expect(out.result).toBe('retried');
    expect(await retriesFrom(`device:${device}`)).toEqual([]);
    const pass = (await pool.query('SELECT attached_user_id::text AS a FROM passes WHERE grant_ref = $1', [ref('dev')])).rows[0];
    expect(pass).toEqual({ a: account });
  });

  it('a guest kept by a failed profile row → the run succeeds, the guest is removed and its profile merged', { timeout: 60_000 }, async () => {
    h.deps.authLinks = authLinkRegistry.map((r) =>
      r.key === 'profile'
        ? {
            key: 'profile',
            async link() {
              throw new Error('boom');
            },
          }
        : r,
    );
    const jar = new CookieJar();
    const guest = ((await (await writeProbe(h, { jar })).json()) as { value: { subject: string } }).value.subject;
    made.push(guest);
    const nick = `Lr${tag}`;
    await pool.query(`INSERT INTO profiles (subject_id, nick, nick_key, settings, schedule, updated_at) VALUES ($1, $2, $3, '{}'::jsonb, '{}', now())`, [
      guest,
      nick,
      nick.toLowerCase(),
    ]);
    try {
      expect((await signIn(h, redis, jar, testEmail(`lr-guest-${tag}`))).status).toBe(200);
    } finally {
      delete h.deps.authLinks;
    }
    const account = (await sessionOf(h, jar)).user?.id ?? '';
    made.push(account);
    expect(await retriesFrom(guest)).toEqual([expect.objectContaining({ handler: 'profile', attempts: 1 })]);
    expect((await pool.query('SELECT 1 FROM users WHERE id::text = $1', [guest])).rows).toHaveLength(1);

    await tick();
    expect(await retriesFrom(guest)).toEqual([]);
    expect((await pool.query('SELECT 1 FROM users WHERE id::text = $1', [guest])).rows).toHaveLength(0);
    expect((await pool.query('SELECT nick FROM profiles WHERE subject_id = $1', [account])).rows).toEqual([{ nick }]);
  });

  it('a row that always fails: 24 attempts in all, then no more; one give-up alarm', { timeout: 120_000 }, async () => {
    h.deps.authLinks = [...authLinkRegistry, always];
    const from = `lr-guest-${tag}`;
    try {
      await pool.query(
        `INSERT INTO auth_link_retries (user_id, from_subject, handler, attempts, next_at, last_error_code) VALUES ($1, $2, $3, 1, $4, 'first')`,
        [`lr-acc-${tag}`, from, always.key, new Date(at)],
      );
      for (let i = 0; i < 23; i += 1) await tick();
      expect(await retriesFrom(from)).toEqual([{ handler: always.key, attempts: 24, last_error_code: 'it-nope' }]);
      await tick();
      await tick();
      expect((await retriesFrom(from))[0]?.attempts).toBe(24);
      const gaveUp = raised.filter((r) => r.code === 'auth/link-retry' && r.details?.handler === always.key);
      expect(gaveUp).toEqual([{ code: 'auth/link-retry', details: { handler: always.key, gaveUp: true } }]);
    } finally {
      delete h.deps.authLinks;
    }
  });
});
