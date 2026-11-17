// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (/** @type {string} */ name) =>
  readFileSync(new URL(`../node/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Не секретні типові значення репетиції — єдині дозволені непорожні рядки. */
const ALLOWED_VALUES = new Set([
  'T2F_ACCESS_JWKS_URL',
  'T2F_ACCESS_TEAM_DOMAIN',
  'T2F_ADMIN_HOST',
  'T2F_R2_BUCKET',
  'PAYPRO_MODE',
]);
const COMPOSE_OWNED = ['T2F_ENV', 'T2F_HOST', 'T2F_SERVER_PORT', 'T2F_COMMIT'];

/** @param {string} text */
const assignments = (text) =>
  text
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return { name: l.slice(0, i), value: l.slice(i + 1) };
    });

/**
 * Імена, які сервер вимагає в rehearsal/production, а також ті, що без .optional().
 * @param {readonly { vars: readonly any[] }[]} registry
 */
function requiredNames(registry) {
  const names = new Set();
  for (const block of registry) {
    for (const v of block.vars) {
      const reqd = (v.requiredIn ?? []).some((/** @type {string} */ c) => c === 'rehearsal' || c === 'production');
      const always = v.schema.safeParse(undefined).success === false;
      if (reqd || always) names.add(v.name);
    }
  }
  return [...names].sort();
}

/**
 * @param {string[]} names
 * @param {string} example
 */
const missing = (names, example) => {
  const have = new Set(assignments(example).map((a) => a.name));
  return names.filter((n) => !have.has(n));
};

async function loadRegistry() {
  const file = fileURLToPath(new URL('../../../server/src/registries/env.ts', import.meta.url));
  /** @type {any} */
  const mod = await import(/* @vite-ignore */ pathToFileURL(file).href);
  return /** @type {readonly { vars: readonly any[] }[]} */ (mod.envRegistry);
}

describe('node env examples', () => {
  it('server.env.example lists every required name, values empty except safe defaults', async () => {
    const registry = await loadRegistry();
    const example = read('server.env.example');
    const names = requiredNames(registry);
    expect(names).toContain('DATABASE_URI');
    expect(names).toContain('T2F_EDGE_SECRET');
    expect(missing(names, example)).toEqual([]);
    expect(missing(['T2F_REDIS_PREFIX', 'T2F_EDGE_SECRET_PREVIOUS'], example)).toEqual([]);
    for (const a of assignments(example)) {
      if (ALLOWED_VALUES.has(a.name)) continue;
      expect(a.value, a.name).toBe('');
    }
  });

  it('allowed non-empty values are not secrets', async () => {
    const registry = await loadRegistry();
    const secrets = new Set(registry.flatMap((b) => b.vars.filter((v) => v.secret).map((v) => v.name)));
    for (const n of ALLOWED_VALUES) expect(secrets.has(n), n).toBe(false);
  });

  it('carries none of the compose-owned names', () => {
    const names = assignments(read('server.env.example')).map((a) => a.name);
    for (const n of COMPOSE_OWNED) expect(names).not.toContain(n);
  });

  it('postgres and cloudflared examples hold empty names only', () => {
    expect(assignments(read('postgres.env.example'))).toEqual([
      { name: 'POSTGRES_USER', value: '' },
      { name: 'POSTGRES_DB', value: '' },
      { name: 'POSTGRES_PASSWORD', value: '' },
    ]);
    expect(assignments(read('cloudflared.env.example'))).toEqual([{ name: 'TUNNEL_TOKEN', value: '' }]);
  });

  it('a new required registry variable turns the check red (synthetic block)', async () => {
    const registry = await loadRegistry();
    const synthetic = [
      ...registry,
      { vars: [{ name: 'T2F_NEW_REQUIRED', schema: { safeParse: () => ({ success: true }) }, requiredIn: ['rehearsal'] }] },
    ];
    expect(missing(requiredNames(synthetic), read('server.env.example'))).toEqual(['T2F_NEW_REQUIRED']);
  });
});
