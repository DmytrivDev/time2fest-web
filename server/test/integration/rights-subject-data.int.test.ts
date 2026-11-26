/**
 * SPEC-11 W36 - the `profile`, `passes` and `bans` subject-data rows over the real pipeline and Postgres:
 * AC-54 export fields exactly (no fingerprint, no email of others, no device id); AC-55 erase -> profile gone, nick free,
 * attached pass stripped, the unattached device pass stays on its payment email (EC-9); AC-56 an extra failing row does
 * not stop the others; AC-57 the account's own ban goes, the derived device ban stays and still blocks a new guest.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSubjectDataInScope } from '../../src/auth/subjectData';
import { rightsOf } from '../../src/endpoints/deps';
import { DEVICE_COOKIE } from '../../src/platform/device';
import type { SubjectDataHandler } from '../../src/platform/subjectData';
import { subjectDataRegistry } from '../../src/registries/subjectData';
import { buildAuthHarness, CookieJar, sessionOf, signIn, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
const by = `test-${randomBytes(3).toString('hex')}`;
const run = randomBytes(3).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;

const failing: SubjectDataHandler = {
  capability: 'zz-failing',
  export: async () => Promise.reject(new Error('down')),
  erase: async () => Promise.reject(new Error('down')),
  anonymise: async () => Promise.reject(new Error('down')),
};

async function account(label: string): Promise<{ id: string; device: string }> {
  const jar = new CookieJar();
  expect((await signIn(h, redis, jar, testEmail(`${label}-${run}`))).status).toBe(200);
  const id = (await sessionOf(h, jar)).user?.id ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return { id, device: jar.get(DEVICE_COOKIE) ?? '' };
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis);
});

afterAll(async () => {
  await pool.query('DELETE FROM bans WHERE created_by = $1', [by]);
  await pool.query('DELETE FROM passes WHERE grant_ref LIKE $1', [`sd-${run}-%`]);
  await pool.query('DELETE FROM profiles WHERE nick_key LIKE $1', [`sd${run}%`]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('ban:');
  await redis.close();
});

describe('rights subject data (AC-54 ... AC-57, EC-9)', () => {
  it('export has exactly the documented fields; erase frees the nick, strips the account pass, keeps the device pass and the derived ban', { timeout: 60_000 }, async () => {
    const a = await account('sd-rights');
    const nick = `Sd${run}Nick`;
    await pool.query(
      `INSERT INTO profiles (subject_id, nick, nick_key, flag_code, settings, schedule, updated_at) VALUES ($1, $2, $3, 'UA', '{"theme":"dark"}'::jsonb, ARRAY['ev-1','ev-2'], now())`,
      [a.id, nick, nick.toLowerCase()],
    );
    await pool.query(`INSERT INTO auth_verifications (identifier, value, expires_at) VALUES ($1, $2, now() + interval '1 hour')`, [
      `t2f-change-email-${a.id}`,
      JSON.stringify({ email: 'new-address@example.test' }),
    ]);
    const passes = rightsOf(h.deps).passes;
    const own = await passes.grantPass({ holder: { account: a.id }, source: 'gift', grantRef: `sd-${run}-acc` });
    expect(own.kind).toBe('granted');
    const dev = await passes.grantPass({ holder: { device: a.device, paymentEmail: `Payer-${run}@Example.test` }, source: 'purchase', grantRef: `sd-${run}-dev` });
    expect(dev.kind).toBe('granted');
    const { ban } = await rightsOf(h.deps).bans.ban({ kind: 'account', subject: a.id, by });

    const exported = await runSubjectDataInScope(h.deps, 'export', a.id, subjectDataRegistry);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const profile = exported.results.profile as Record<string, unknown>;
    expect(Object.keys(profile).sort()).toEqual(['flagCode', 'nick', 'pendingEmailChange', 'schedule', 'settings']);
    expect(profile).toMatchObject({ nick, flagCode: 'UA', settings: { theme: 'dark' }, schedule: ['ev-1', 'ev-2'], pendingEmailChange: { email: 'new-address@example.test' } });
    expect(Object.keys(profile.pendingEmailChange as object).sort()).toEqual(['email', 'sentAt']);
    const pExp = exported.results.passes as Record<string, unknown>[];
    expect(pExp).toHaveLength(2);
    for (const p of pExp) expect(Object.keys(p).sort()).toEqual(['issuedAt', 'place', 'season', 'source']);
    expect(pExp.map((p) => p.place).sort()).toEqual(['account', 'device']);
    const bExp = exported.results.bans as Record<string, unknown>[];
    expect(bExp.map((b) => b.kind).sort()).toEqual(['account', 'device']);
    for (const b of bExp) expect(Object.keys(b).sort()).toEqual(['kind', 'since']);
    const { passes: pp, bans: bb, profile: pr } = exported.results;
    const text = JSON.stringify({ pp, bb, pr });
    expect(text).not.toContain(a.device);
    expect(text).not.toContain(`payer-${run}`);
    expect(text).not.toMatch(/fp:/);

    // AC-56: an extra failing row does not stop the others; AC-55/57.
    const erased = await runSubjectDataInScope(h.deps, 'erase', a.id, [...subjectDataRegistry, failing]);
    expect(erased).toMatchObject({ ok: false, failed: ['zz-failing'] });
    expect((await pool.query('SELECT 1 FROM profiles WHERE subject_id = $1', [a.id])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM profiles WHERE nick_key = $1', [nick.toLowerCase()])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM auth_verifications WHERE identifier = $1', [`t2f-change-email-${a.id}`])).rowCount).toBe(0);
    expect((await pool.query('SELECT 1 FROM users WHERE id = $1::uuid', [a.id])).rowCount).toBe(0);

    const acc = (await pool.query('SELECT attached_user_id, payment_email, device_id, erased_at FROM passes WHERE grant_ref = $1', [`sd-${run}-acc`])).rows[0];
    expect(acc).toMatchObject({ attached_user_id: null, payment_email: null, device_id: null });
    expect(acc.erased_at).not.toBeNull();
    const kept = (await pool.query('SELECT payment_email, device_id, erased_at, revoked_at FROM passes WHERE grant_ref = $1', [`sd-${run}-dev`])).rows[0];
    expect(kept).toMatchObject({ payment_email: `payer-${run}@example.test`, device_id: a.device, erased_at: null, revoked_at: null });
    expect(await rightsOf(h.deps).passes.hasPass('some-new-guest', a.device)).toBe(true);

    expect((await pool.query('SELECT 1 FROM bans WHERE id = $1', [ban.id])).rowCount).toBe(0);
    const derived = await pool.query(`SELECT subject_id, source_ban_id FROM bans WHERE kind = 'device' AND subject_id = $1`, [a.device]);
    expect(derived.rowCount).toBe(1);
    expect(await rightsOf(h.deps).bans.bannedInDb('some-new-guest', a.device)).toEqual({ blocked: true, kind: 'device', until: null });
  });
});
