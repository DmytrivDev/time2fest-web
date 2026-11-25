import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bin = path.join(serverDir, 'node_modules', 'payload', 'bin.js');

function tables(uri: string): Promise<string[]> {
  return query(uri, "SELECT table_name FROM information_schema.tables WHERE table_schema='public'").then((r) =>
    r.map((row) => String(row.table_name)),
  );
}

async function query(uri: string, sql: string): Promise<Record<string, unknown>[]> {
  const c = new pg.Client({ connectionString: uri });
  await c.connect();
  try {
    return (await c.query(sql)).rows;
  } finally {
    await c.end();
  }
}

function payload(args: string[], uri: string) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URI: uri },
    encoding: 'utf8',
  });
}

function dbTool(args: string[]) {
  return spawnSync(process.execPath, ['scripts/db.mjs', ...args], { cwd: serverDir, env: process.env, encoding: 'utf8' });
}

describe('payload schema', () => {
  const testUri = process.env.DATABASE_URI as string;
  const migUri = testUri.replace(/_test$/, '_migcheck');

  beforeAll(() => {
    expect(dbTool(['migcheck', 'up']).status).toBe(0);
  });
  afterAll(() => {
    dbTool(['migcheck', 'drop']);
  });

  it('AC-58: admins and idempotency_records exist; no Payload users collection', async () => {
    const t = await tables(testUri);
    expect(t).toContain('admins');
    expect(t).toContain('idempotency_records');
    // SPEC-10 [П-4]/[А1] (AC-57): `users` is now Better Auth's own table (migration *_spec10_auth), never a Payload
    // collection: it has Better Auth's columns and none of Payload's auth columns, and no Payload relation points at it.
    const cols = (await query(testUri, "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='users'")).map(
      (r) => String(r.column_name),
    );
    expect(cols).toEqual(expect.arrayContaining(['email_verified', 'is_anonymous', 'device_id']));
    expect(cols).not.toEqual(expect.arrayContaining(['hash']));
    expect(cols).not.toEqual(expect.arrayContaining(['salt']));
    const rels = await query(testUri, "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'payload_%' AND column_name='users_id'");
    expect(rels).toEqual([]);
  });

  it('SPEC-07 NFR-2: lease, runs, run records and clock state tables exist with their unique indexes', async () => {
    const t = await tables(testUri);
    for (const name of ['scheduler_leases', 'scheduler_runs', 'run_records', 'clock_state']) expect(t).toContain(name);
    const idx = await query(
      testUri,
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND tablename IN ('scheduler_leases','scheduler_runs','run_records')",
    );
    const names = idx.map((r) => String(r.indexname));
    expect(names).toEqual(
      expect.arrayContaining(['scheduler_leases_name_idx', 'run_records_consequence_id_idx', 'runEpoch_action_momentKey_idx']),
    );
  });

  it('SPEC-09: ai_spend has a unique period index and the moderation-settings global table exists', async () => {
    const t = await tables(testUri);
    expect(t).toContain('ai_spend');
    expect(t).toContain('moderation_settings');
    expect(t).toContain('site_state');
    const idx = await query(
      testUri,
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='ai_spend' AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%(period)%'",
    );
    expect(idx.length).toBeGreaterThanOrEqual(1);
  });

  it('AC-59: migrate, migrate:down, migrate pass on a copy and no auth schema exists', async () => {
    expect(payload(['migrate'], migUri).status).toBe(0);
    expect(payload(['migrate:down'], migUri).status).toBe(0);
    expect(payload(['migrate'], migUri).status).toBe(0);
    const rows = await query(migUri, "SELECT 1 FROM information_schema.schemata WHERE schema_name='auth'");
    expect(rows).toHaveLength(0);
  }, 180_000);
});
