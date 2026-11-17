/**
 * `pnpm env:check` — validates the server environment (AC-19, AC-20) and prints only names.
 * Loads `server/.env.local` when present; variables already set in the process win.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseAccessConfig } from '../domain/access/config';
import { parseRealtimeConfig } from '../domain/realtime/config';
import { envRegistry } from '../registries/env';
import { loadEnv } from './env';

const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const result = loadEnv(process.env, envRegistry);
if (!result.ok) {
  console.error(`env: invalid ${result.failing.join(', ')}`);
  process.exit(1);
}
// Access settings (AC-7): rehearsal/production refuse a missing or test issuer/JWKS.
const access = parseAccessConfig(process.env, result.class);
if (!access.ok) {
  console.error(`env: invalid ${access.failing.join(', ')}`);
  process.exit(1);
}
// Realtime settings (SPEC-06 AC-11, AC-20): a bad channel prefix, or no Centrifugo URL outside test.
const realtime = parseRealtimeConfig(process.env, result.class);
if (!realtime.ok) {
  console.error(`env: invalid ${realtime.failing.join(', ')}`);
  process.exit(1);
}
console.log(`env: ok (${result.class})`);
