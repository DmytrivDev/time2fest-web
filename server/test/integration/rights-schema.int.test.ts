/**
 * SPEC-11 W10 — the database invariants of the rights tables (NFR-3, AC-10, AC-26, AC-29, AC-30, AC-47):
 * one active pass per account and season, a unique normalized nick key, one row per (provider, account id),
 * and no IP/fingerprint column anywhere in the new tables.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let pool: pg.Pool;
const tag = `rs-${randomUUID().slice(0, 8)}`;
const userIds: string[] = [];

async function user(): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, name, email, email_verified) VALUES ($1, $2, $3, false)`,
    [id, tag, `${id}@${tag}.t2f.test`],
  );
  userIds.push(id);
  return id;
}

const pass = (grantRef: string, userId: string | null, season: string, revoked = false) =>
  pool.query(
    `INSERT INTO passes (season, source, grant_ref, attached_user_id, issued_at, attached_at, revoked_at)
     VALUES ($1, 'admin', $2, $3, now(), now(), $4)`,
    [season, `${tag}-${grantRef}`, userId, revoked ? new Date() : null],
  );

const dup = async (p: Promise<unknown>) => {
  await expect(p).rejects.toMatchObject({ code: '23505' });
};

beforeAll(() => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
});

afterAll(async () => {
  await pool.query(`DELETE FROM passes WHERE grant_ref LIKE $1`, [`${tag}-%`]);
  await pool.query(`DELETE FROM profiles WHERE subject_id LIKE $1`, [`${tag}-%`]);
  await pool.query(`DELETE FROM users WHERE name = $1`, [tag]);
  await pool.end();
});

describe('SPEC-11 rights schema invariants', () => {
  it('NFR-3 / AC-10: a second active pass for one account and season is refused; a revoked one does not count', async () => {
    const u = await user();
    await pass('a1', u, '2026-27');
    await dup(pass('a2', u, '2026-27'));
    await pass('a3', u, '2027-28'); // another season is fine
    await pool.query(`UPDATE passes SET revoked_at = now() WHERE grant_ref = $1`, [`${tag}-a1`]);
    await pass('a4', u, '2026-27'); // the revoked one frees the slot
    await dup(pass('a1', null, '2026-27')); // grant_ref is unique
  });

  it('season and source are checked', async () => {
    await expect(pass('bad-season', null, '2026')).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO passes (season, source, grant_ref, issued_at) VALUES ('2026-27', 'gold', $1, now())`,
        [`${tag}-bad-source`],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('AC-29 / AC-30: two profiles with the same nick key are refused; empty keys do not collide', async () => {
    const ins = (id: string, key: string | null) =>
      pool.query(
        `INSERT INTO profiles (subject_id, nick, nick_key, updated_at) VALUES ($1, $2, $3, now())`,
        [`${tag}-${id}`, key, key],
      );
    const key = `${tag}ліра`;
    await ins('p1', key);
    await dup(ins('p2', key));
    await ins('p3', null);
    await ins('p4', null);
  });

  it('AC-47: a duplicate (provider_id, account_id) in user_accounts is refused', async () => {
    const [u1, u2] = [await user(), await user()];
    const link = (userId: string) =>
      pool.query(
        `INSERT INTO user_accounts (account_id, provider_id, user_id, updated_at) VALUES ($1, 'google', $2, now())`,
        [`${tag}-sub`, userId],
      );
    await link(u1);
    await dup(link(u2));
  });

  it('AC-26: no IP or fingerprint column in passes, bans or profiles', async () => {
    const { rows } = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name IN ('passes', 'bans', 'profiles')`,
    );
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.filter((r) => /(^|_)(ip|fingerprint|fp)(_|$)/i.test(r.column_name))).toEqual([]);
  });
});
