import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { uk } from '@payloadcms/translations/languages/uk';
import { buildConfig } from 'payload';
import { harden, hardenGlobal } from './access/payloadGuard';
import { loadEnv } from './platform/env';
import { collectionRegistry } from './registries/collections';
import { envRegistry } from './registries/env';
import { globalRegistry } from './registries/globals';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const loaded = loadEnv(process.env, envRegistry);
if (!loaded.ok) {
  throw new Error('env: invalid ' + loaded.failing.join(', '));
}
const env = loaded.env as { PAYLOAD_SECRET: string; DATABASE_URI: string };

export default buildConfig({
  secret: env.PAYLOAD_SECRET,
  admin: { user: 'admins', avatar: 'default', importMap: { baseDir: dirname }, components: { views: { dashboard: { Component: '/admin/Dashboard#Dashboard' } } } },
  i18n: { supportedLanguages: { uk }, fallbackLanguage: 'uk' },
  routes: { api: '/cms-api', admin: '/admin' },
  graphQL: { disable: true },
  collections: collectionRegistry.map((r) => harden(r.collection, r)),
  globals: globalRegistry.map((r) => hardenGlobal(r.global)),
  db: postgresAdapter({
    pool: { connectionString: env.DATABASE_URI },
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
});
