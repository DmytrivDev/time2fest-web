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

  it('AC-58: admins and idempotency_records exist, users does not', async () => {
    const t = await tables(testUri);
    expect(t).toContain('admins');
    expect(t).toContain('idempotency_records');
    expect(t).not.toContain('users');
  });

  it('AC-59: migrate, migrate:down, migrate pass on a copy and no auth schema exists', async () => {
    expect(payload(['migrate'], migUri).status).toBe(0);
    expect(payload(['migrate:down'], migUri).status).toBe(0);
    expect(payload(['migrate'], migUri).status).toBe(0);
    const rows = await query(migUri, "SELECT 1 FROM information_schema.schemata WHERE schema_name='auth'");
    expect(rows).toHaveLength(0);
  }, 180_000);
});
