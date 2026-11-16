/**
 * Data survives a stack restart (AC-3). Runs only under `pnpm --dir server test:int:exclusive`:
 * `stack.mjs down` stops the shared containers of the `t2f` project, so no other worktree may test meanwhile.
 * The containers are started again in `finally`; nothing is removed.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const stack = path.join(serverDir, 'scripts', 'stack.mjs');
const databaseUri = (process.env.DATABASE_URI ?? '').replace(/(_test)?$/, '_test');
const KEY = `restart:${Date.now()}`;

function stackCmd(cmd: 'up' | 'down') {
  return spawnSync(process.execPath, [stack, cmd], { cwd: serverDir, encoding: 'utf8', timeout: 180_000 });
}

async function connect(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: databaseUri });
  for (let i = 0; ; i += 1) {
    try {
      await c.connect();
      return c;
    } catch (e) {
      if (i > 30) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

afterAll(async () => {
  stackCmd('up');
  const c = await connect();
  await c.query('DELETE FROM idempotency_records WHERE key = $1', [KEY]);
  await c.end();
}, 240_000);

describe('stack restart (AC-3)', () => {
  it('a row inserted before `stack down` is still there after `stack up`', async () => {
    const before = await connect();
    await before.query("INSERT INTO idempotency_records (key, status) VALUES ($1, 'done')", [KEY]);
    await before.end().catch(() => undefined);

    expect(stackCmd('down').status).toBe(0);
    expect(stackCmd('up').status).toBe(0);

    const after = await connect();
    try {
      const r = await after.query('SELECT key FROM idempotency_records WHERE key = $1', [KEY]);
      expect(r.rowCount).toBe(1);
    } finally {
      await after.end();
    }
  }, 300_000);
});
