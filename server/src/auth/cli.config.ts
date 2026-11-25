/**
 * Config for the Better Auth CLI ONLY (`npx auth@1.7.28 generate --config src/auth/cli.config.ts`). Never imported by
 * runtime code. Dummy credentials; the pool is lazy, `generate` does not need a reachable database.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { betterAuth } from 'better-auth';
import { authStaticOptions } from './options';

export const auth = betterAuth({
  ...authStaticOptions({
    sendOtp: async () => {},
    googleDiscoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
    googleClientId: 'cli-dummy',
    googleClientSecret: 'cli-dummy', // check-secrets: allow generator dummy
  }),
  // A throwaway secret per run: schema work never signs anything, so no literal is needed.
  secret: randomBytes(32).toString('hex'),
  baseURL: 'http://127.0.0.1:4200',
  database: new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 1 }),
});
