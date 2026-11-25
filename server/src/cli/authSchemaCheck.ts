/**
 * Schema check for Better Auth (SPEC-10 W12, AC-57): builds the static options, asks Better Auth which tables/columns it
 * would still have to create and exits 1 listing them (`missing table <t>` / `missing column <t>.<c>`), else 0.
 * Prints names only. DATABASE_URI comes from the environment (`verify-schema.mjs` passes it).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { getMigrations } from 'better-auth/db/migration';
import { authStaticOptions } from '../auth/options';

async function main(): Promise<number> {
  const uri = process.env.DATABASE_URI;
  if (!uri) {
    console.error('auth schema: DATABASE_URI is not set');
    return 1;
  }
  const pool = new pg.Pool({ connectionString: uri, max: 1 });
  try {
    const options = {
      ...authStaticOptions({
        sendOtp: async () => {},
        googleDiscoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
        googleClientId: 'schema-check',
        googleClientSecret: 'schema-check', // check-secrets: allow schema check dummy
      }),
      // A throwaway secret per run: schema work never signs anything, so no literal is needed.
      secret: randomBytes(32).toString('hex'),
      baseURL: 'http://127.0.0.1:4200',
      database: pool,
    };
    const { toBeCreated, toBeAdded } = await getMigrations(options);
    const lines: string[] = [];
    for (const t of toBeCreated) lines.push(`missing table ${t.table}`);
    for (const t of toBeAdded) for (const c of Object.keys(t.fields)) lines.push(`missing column ${t.table}.${c}`);
    if (lines.length > 0) {
      for (const l of lines) console.error(`auth schema: ${l}`);
      return 1;
    }
    console.log('auth schema: Better Auth tables and columns present');
    return 0;
  } catch (e) {
    console.error(`auth schema: check failed: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    await pool.end().catch(() => {});
  }
}

process.exit(await main());
