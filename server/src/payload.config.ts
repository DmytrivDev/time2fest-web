import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { buildConfig } from 'payload';
import { loadEnv } from './platform/env';
import { collectionRegistry } from './registries/collections';
import { envRegistry } from './registries/env';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const loaded = loadEnv(process.env, envRegistry);
if (!loaded.ok) {
  throw new Error('env: invalid ' + loaded.failing.join(', '));
}
const env = loaded.env as { PAYLOAD_SECRET: string; DATABASE_URI: string };

export default buildConfig({
  secret: env.PAYLOAD_SECRET,
  admin: { user: 'admins' },
  routes: { api: '/cms-api', admin: '/admin' },
  graphQL: { disable: true },
  collections: collectionRegistry.map((r) => r.collection),
  db: postgresAdapter({
    pool: { connectionString: env.DATABASE_URI },
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
});
