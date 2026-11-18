import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { uk } from '@payloadcms/translations/languages/uk';
import { buildConfig } from 'payload';
import { harden, hardenGlobal } from './access/payloadGuard';
import { cmsEndpointsFor } from './admin/cmsEndpoints';
import { adminOrigins } from './domain/access/config';
import { envClass, loadEnv } from './platform/env';
import { collectionRegistry } from './registries/collections';
import { envRegistry } from './registries/env';
import { globalRegistry } from './registries/globals';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const loaded = loadEnv(process.env, envRegistry);
if (!loaded.ok) {
  throw new Error('env: invalid ' + loaded.failing.join(', '));
}
const env = loaded.env as { PAYLOAD_SECRET: string; DATABASE_URI: string; T2F_ADMIN_HOST?: string };

/**
 * CSRF (S4-01): Payload accepts its session cookie only from the admin origins when a request carries an
 * `Origin` elsewhere; a request with no `Origin` is accepted (csrf.int.test.ts). The defence is the proxy
 * rule (Origin / Sec-Fetch-Site checked in front of Payload) plus SameSite=Lax on the cookie.
 * `serverURL` stays unset: the admin client fetches relative URLs (W9 spike).
 */
const csrf = env.T2F_ADMIN_HOST ? adminOrigins(env.T2F_ADMIN_HOST, envClass(process.env)) : [];

export default buildConfig({
  secret: env.PAYLOAD_SECRET,
  admin: { user: 'admins', avatar: 'default', importMap: { baseDir: dirname }, components: { views: { dashboard: { Component: '/admin/Dashboard#Dashboard' } } } },
  i18n: { supportedLanguages: { uk }, fallbackLanguage: 'uk' },
  routes: { api: '/cms-api', admin: '/admin' },
  csrf,
  graphQL: { disable: true },
  // SPEC-07 C9 / AC-75: `GET /cms-api/festival-state` everywhere, `POST /cms-api/clock` only in rehearsal and test.
  endpoints: cmsEndpointsFor(loaded.class),
  collections: collectionRegistry.map((r) => harden(r.collection, r)),
  globals: globalRegistry.map((r) => hardenGlobal(r.global)),
  db: postgresAdapter({
    pool: { connectionString: env.DATABASE_URI },
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
});
