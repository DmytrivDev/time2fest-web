/**
 * `pnpm env:check` — validates the server environment (AC-19, AC-20) and prints only names.
 * Loads `server/.env.local` when present; variables already set in the process win.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { envRegistry } from '../registries/env';
import { loadEnv } from './env';

const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const result = loadEnv(process.env, envRegistry);
if (!result.ok) {
  console.error(`env: invalid ${result.failing.join(', ')}`);
  process.exit(1);
}
console.log(`env: ok (${result.class})`);
