import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
export default function setup(): void {
  const fileEnv = parseEnvFile(path.join(serverDir, '.env.local'));
  const base = process.env.DATABASE_URI ?? fileEnv.DATABASE_URI;
  if (!base) throw new Error('DATABASE_URI is not set; run `node scripts/db.mjs env`');
  const testUri = base.replace(/(_test)?$/, '_test');
  const merged: Record<string, string> = { ...fileEnv, T2F_ENV: 'test', DATABASE_URI: testUri };
  for (const [k, v] of Object.entries(merged)) if (process.env[k] === undefined || k === 'DATABASE_URI' || k === 'T2F_ENV') process.env[k] = v;

  const bin = path.join(serverDir, 'node_modules', 'payload', 'bin.js');
  const r = spawnSync(process.execPath, [bin, 'migrate'], { cwd: serverDir, env: process.env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('payload migrate on the test database failed:\n' + (r.stderr || r.stdout).slice(-600));
}
