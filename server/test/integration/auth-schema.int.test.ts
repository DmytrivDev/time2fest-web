/**
 * SPEC-10 W12 / AC-57: the Better Auth schema check is green on the migrated test database and red (naming the column)
 * when a column Better Auth expects is missing. The destructive case runs on a throwaway `_migcheck` database.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tsx = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const payloadBin = path.join(serverDir, 'node_modules', 'payload', 'bin.js');

const testUri = process.env.DATABASE_URI ?? '';
const scratchUri = testUri.replace(/_test$/, '_migcheck');
const scratchName = new URL(scratchUri).pathname.slice(1);

function check(uri: string) {
  const r = spawnSync(process.execPath, [tsx, 'src/cli/authSchemaCheck.ts'], {
    cwd: serverDir,
    env: { ...process.env, DATABASE_URI: uri },
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

async function admin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const u = new URL(testUri);
  u.pathname = '/postgres';
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

describe('auth schema check', () => {
  beforeAll(async () => {
    expect(testUri).toMatch(/_test$/);
    await admin(async (c) => {
      await c.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
      await c.query(`CREATE DATABASE "${scratchName}"`);
    });
    const m = spawnSync(process.execPath, [payloadBin, 'migrate'], {
      cwd: serverDir,
      env: { ...process.env, DATABASE_URI: scratchUri },
      encoding: 'utf8',
    });
    expect(m.status, (m.stderr || m.stdout).slice(-400)).toBe(0);
  }, 120_000);

  afterAll(async () => {
    await admin((c) => c.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`));
  });

  it('is green on the migrated test database', () => {
    const r = check(testUri);
    expect(r.status, r.out).toBe(0);
  });

  it('is red and names the missing column, then green again after restoring it', async () => {
    const db = new pg.Client({ connectionString: scratchUri });
    await db.connect();
    try {
      await db.query('ALTER TABLE user_sessions DROP COLUMN device_id');
      const red = check(scratchUri);
      expect(red.status).toBe(1);
      expect(red.out).toContain('user_sessions.device_id');
      await db.query('ALTER TABLE user_sessions ADD COLUMN device_id text');
      expect(check(scratchUri).status).toBe(0);
    } finally {
      await db.end();
    }
  });

  it('is red and names a missing table', async () => {
    const db = new pg.Client({ connectionString: scratchUri });
    await db.connect();
    try {
      await db.query('ALTER TABLE user_sessions RENAME TO user_sessions_x');
      const red = check(scratchUri);
      expect(red.status).toBe(1);
      expect(red.out).toContain('missing table user_sessions');
    } finally {
      await db.end();
    }
  });
});
