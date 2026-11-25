/**
 * Config for the Better Auth CLI ONLY (`npx auth@1.7.28 generate --config src/auth/cli.config.ts`). Never imported by
 * runtime code. Dummy credentials; the pool is lazy, `generate` does not need a reachable database.
 */
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
  secret: 'cli-generator-secret-not-real-0123456789abcdef', // check-secrets: allow generator dummy
  baseURL: 'http://127.0.0.1:4200',
  database: new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 1 }),
});
