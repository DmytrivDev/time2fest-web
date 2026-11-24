import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

/** Loads .env.local, points DATABASE_URI at the `_test` database and migrates it. */
export default function setup(): () => Promise<void> {
  const fileEnv = parseEnvFile(path.join(serverDir, '.env.local'));
  const base = process.env.DATABASE_URI ?? fileEnv.DATABASE_URI;
  if (!base) throw new Error('DATABASE_URI is not set; run `node scripts/db.mjs env`');
  const testUri = base.replace(/(_test)?$/, '_test');
  const merged: Record<string, string> = { ...fileEnv, T2F_ENV: 'test', DATABASE_URI: testUri };
  for (const [k, v] of Object.entries(merged)) if (process.env[k] === undefined || k === 'DATABASE_URI' || k === 'T2F_ENV') process.env[k] = v;

  const bin = path.join(serverDir, 'node_modules', 'payload', 'bin.js');
  const r = spawnSync(process.execPath, [bin, 'migrate'], { cwd: serverDir, env: process.env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('payload migrate on the test database failed:\n' + (r.stderr || r.stdout).slice(-600));

  const startedAt = new Date().toISOString();
  const uri = testUri;
  // SPEC-13b AC-27 / W39: at the end of the suite no `ops/unregistered-alarm` marker may remain, except for kinds with
  // source `test` (the older tests raise `test/*` codes through the alarm door on purpose).
  return async () => {
    const c = new pg.Client({ connectionString: uri });
    await c.connect();
    try {
      const r = await c.query<{ source: string | null; code: string | null }>(
        `SELECT details->>'source' AS source, details->>'code' AS code FROM log_alarms
          WHERE source = 'ops' AND code = 'unregistered-alarm' AND raised_at >= $1
            AND COALESCE(details->>'source', '') <> 'test'`,
        [startedAt],
      );
      if (r.rows.length > 0) {
        const kinds = [...new Set(r.rows.map((x) => `${x.source ?? '?'}/${x.code ?? '?'}`))].join(', ');
        throw new Error(`unregistered alarm kinds were raised during the integration run (add them to registries/ops.ts): ${kinds}`);
      }
    } finally {
      await c.end();
    }
  };
}
