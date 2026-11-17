/**
 * Shared setup of the stack-level tests: this worktree's identity and `.env.local` values.
 * The stack (`pnpm stack`) must be serving in another terminal.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorktree } from '../../scripts/lib/worktree.mjs';

export const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function readEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  const file = path.join(serverDir, '.env.local');
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

export const envLocal = readEnvLocal();

export interface Wt {
  slug: string;
  slot: number;
  redisDb: number;
  redisPrefix: string;
  database: string;
  testDatabase: string;
  ports: { server: number; web: number };
  mailAddress: (name: string) => string;
}

export const wt: Wt = resolveWorktree(serverDir, { ...envLocal, ...process.env });
export const SERVER = `http://127.0.0.1:${wt.ports.server}`;
export const REDIS_HOST_PORT = 6380;
export const PG_BASE = 'postgres://t2f@127.0.0.1:5433';
