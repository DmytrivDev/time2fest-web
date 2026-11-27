/**
 * SPEC-14 W10 — the database invariants of the presence tables (NFR-5, AC-3, AC-15, AC-30):
 * the nine tables exist, one proof / stamp / window-health row per key, no subject column in `presence_samples`,
 * `reason` is limited to 200 characters.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let pool: pg.Pool;
const tag = `ps-${randomUUID().slice(0, 8)}`;

const TABLES = [
  'presence_proofs',
  'presence_event_moments',
  'presence_samples',
  'presence_window_health',
  'presence_downtimes',
  'stamps',
  'passport_achievements',
  'stamp_old_moment_log',
  'author_ids',
];

const dup = async (p: Promise<unknown>) => {
  await expect(p).rejects.toMatchObject({ code: '23505' });
};

beforeAll(() => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
});

afterAll(async () => {
  await pool.query(`DELETE FROM presence_proofs WHERE subject_id LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM stamps WHERE subject_id LIKE $1`, [`${tag}%`]);
  await pool.query(`DELETE FROM presence_window_health WHERE season = $1`, [tag]);
  await pool.query(`DELETE FROM presence_downtimes WHERE season = $1`, [tag]);
  await pool.end();
});

describe('SPEC-14 presence schema invariants', () => {
  it('the nine tables exist', async () => {
    const r = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [TABLES],
    );
    expect(r.rows.map((x) => x.table_name).sort()).toEqual([...TABLES].sort());
  });

  it('AC-3: a second proof for one subject x season x event x moment is refused', async () => {
    const ins = (moment: number) =>
      pool.query(
        `INSERT INTO presence_proofs (subject_id, season, event_id, moment_ms, first_received_at, source)
         VALUES ($1, '2026-27', 'ev1', $2, 1, 'web')`,
        [`${tag}-a`, moment],
      );
    await ins(1000);
    await dup(ins(1000));
    await ins(2000); // another moment is fine
  });

  it('AC-30: a second stamp for one subject x season x event is refused', async () => {
    const ins = () =>
      pool.query(
        `INSERT INTO stamps (subject_id, season, event_id, granted_at, presence_source, grant_kind, issued_at)
         VALUES ($1, '2026-27', 'ev1', 1, 'web', 'presence', 1)`,
        [`${tag}-s`],
      );
    await ins();
    await dup(ins());
    await expect(
      pool.query(
        `INSERT INTO stamps (subject_id, season, event_id, granted_at, presence_source, grant_kind, issued_at)
         VALUES ($1, '2026-27', 'ev2', 1, 'web', 'bogus', 1)`,
        [`${tag}-s`],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('AC-15: one system health record per window', async () => {
    const ins = () =>
      pool.query(
        `INSERT INTO presence_window_health (season, event_id, moment_ms, state, recorded_at) VALUES ($1, 'ev1', 1, 'healthy', 1)`,
        [tag],
      );
    await ins();
    await dup(ins());
  });

  it('NFR-5: presence_samples has no subject column', async () => {
    const r = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'presence_samples'`,
    );
    const cols = r.rows.map((x) => x.column_name);
    expect([...cols].sort()).toEqual(['accepted', 'at', 'failed', 'fast_reachable', 'fast_run_id', 'fast_uptime_s', 'node_id']);
    expect(cols.some((c) => /subject|user|ip|email/.test(c))).toBe(false);
  });

  it('AC-19 / AC-21: a downtime reason longer than 200 characters is refused', async () => {
    const ins = (reason: string) =>
      pool.query(
        `INSERT INTO presence_downtimes (season, kind, from_ms, to_ms, reason, recorded_by, created_at)
         VALUES ($1, 'manual', 1, 2, $2, 'owner', 1)`,
        [tag, reason],
      );
    await ins('x'.repeat(200));
    await expect(ins('x'.repeat(201))).rejects.toMatchObject({ code: '23514' });
  });
});
