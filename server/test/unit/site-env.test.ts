/**
 * SPEC-08 env block `site` (AC-22, AC-34, AC-64, AC-65): five optional names, no PayPro name, a boot
 * without any of them in every class, and the names listed in `server/.env.example`.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/platform/env';
import { envRegistry } from '../../src/registries/env';

const SITE_NAMES = ['T2F_CF_PURGE_TOKEN', 'T2F_CF_ZONE_ID', 'T2F_GITHUB_DISPATCH_TOKEN', 'T2F_REBUILD_PRODUCTION', 'T2F_SITE_URL'];

/**
 * The registry's names at the wave base (`git show 9d18cf7:server/src/registries/env.ts`), pinned here because CI
 * checks out one commit only (`actions/checkout` default depth 1), so the base is not readable there.
 */
const BASE_NAMES = [
  'ANTHROPIC_API_KEY', 'DATABASE_URI', 'DEEPSEEK_API_KEY', 'PAYLOAD_SECRET', 'PAYPRO_MODE', 'REDIS_URL', 'SMTP_HOST', 'SMTP_PORT',
  'T2F_ACCESS_AUD', 'T2F_ACCESS_JWKS_URL', 'T2F_ACCESS_SERVICE_CNS', 'T2F_ACCESS_TEAM_DOMAIN', 'T2F_ADMIN_HOST',
  'T2F_AI_ANTHROPIC_MODEL', 'T2F_AI_ANTHROPIC_PRICE_CACHE_READ', 'T2F_AI_ANTHROPIC_PRICE_CACHE_WRITE', 'T2F_AI_ANTHROPIC_PRICE_INPUT',
  'T2F_AI_ANTHROPIC_PRICE_OUTPUT', 'T2F_AI_ANTHROPIC_RPM', 'T2F_AI_ANTHROPIC_URL', 'T2F_AI_ANTHROPIC_VERSION', 'T2F_AI_DEEPSEEK_MODEL',
  'T2F_AI_DEEPSEEK_PRICE_CACHE_HIT', 'T2F_AI_DEEPSEEK_PRICE_CACHE_MISS', 'T2F_AI_DEEPSEEK_PRICE_OUTPUT', 'T2F_AI_DEEPSEEK_RPM',
  'T2F_AI_DEEPSEEK_URL', 'T2F_AI_PROCESSES', 'T2F_AI_TOASTS_RPM_SHARE', 'T2F_AI_TOASTS_SPEND_SHARE', 'T2F_ALLOWED_ORIGINS',
  'T2F_CATALOG_RATE_PER_MIN', 'T2F_CENTRIFUGO_API_KEY', 'T2F_CENTRIFUGO_PREFIX', 'T2F_CENTRIFUGO_TOKEN_SECRET', 'T2F_CENTRIFUGO_URL',
  'T2F_COMMIT', 'T2F_EDGE_SECRET', 'T2F_EDGE_SECRET_PREVIOUS', 'T2F_ENV', 'T2F_HOST', 'T2F_LOCK_DIR', 'T2F_OWNER_EMAILS',
  'T2F_R2_ACCESS_KEY_ID', 'T2F_R2_BUCKET', 'T2F_R2_ENDPOINT', 'T2F_R2_PREFIX', 'T2F_R2_SECRET_ACCESS_KEY', 'T2F_REDIS_PREFIX',
  'T2F_SERVER_PORT', 'T2F_SLOT', 'T2F_SLUG', 'T2F_TEST_DOORS', 'T2F_WEB_PORT',
];

const names = () => envRegistry.flatMap((b) => b.vars.map((v) => v.name));

/** A valid raw environment of `cls` with every variable it requires and none of the `site` block. */
function rawEnv(cls: 'test' | 'rehearsal' | 'production', over: Record<string, string | undefined> = {}) {
  const isolated =
    cls === 'production'
      ? { DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_production', T2F_REDIS_PREFIX: 't2f:production:', T2F_ADMIN_HOST: 'admin.time2fest.com', T2F_R2_BUCKET: 'time2fest-prod', T2F_CENTRIFUGO_URL: 'https://o.time2fest.com' }
      : cls === 'rehearsal'
        ? { DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_rehearsal', T2F_REDIS_PREFIX: 't2f:rehearsal:', T2F_ADMIN_HOST: 'admin-rehearsal.time2fest.com', T2F_R2_BUCKET: 'time2fest-rehearsal', T2F_CENTRIFUGO_URL: 'https://o-rehearsal.time2fest.com' }
        : { DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/t2f_spec_08_site_state_test', T2F_REDIS_PREFIX: 't2f:spec_08_site_state:', T2F_ADMIN_HOST: 'admin.localhost:3100', T2F_R2_BUCKET: 't2f-catalog', T2F_CENTRIFUGO_URL: 'http://127.0.0.1:8000', REDIS_URL: 'redis://127.0.0.1:6380/12' };
  return {
    T2F_ENV: cls,
    REDIS_URL: 'redis://redis:6379/0',
    T2F_CENTRIFUGO_API_KEY: randomBytes(24).toString('hex'),
    T2F_CENTRIFUGO_TOKEN_SECRET: randomBytes(24).toString('hex'),
    PAYLOAD_SECRET: randomBytes(24).toString('hex'),
    T2F_EDGE_SECRET: randomBytes(24).toString('hex'),
    T2F_ALLOWED_ORIGINS: 'https://time2fest.com',
    T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-test.invalid',
    T2F_ACCESS_AUD: 't2f-test-aud',
    T2F_ACCESS_JWKS_URL: 'https://t2f-test.invalid/cdn-cgi/access/certs',
    T2F_OWNER_EMAILS: 'owner@example.com',
    T2F_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    T2F_R2_PREFIX: 'site_env/',
    T2F_R2_ACCESS_KEY_ID: 't2f-site-env',
    T2F_R2_SECRET_ACCESS_KEY: randomBytes(16).toString('hex'),
    ...isolated,
    ...over,
  };
}

describe('SPEC-08 env block `site`', () => {
  it('AC-64: the registry gains exactly the five site names over the wave base, and no PayPro name', () => {
    const added = names().filter((n) => !BASE_NAMES.includes(n)).sort();
    expect(added).toEqual(SITE_NAMES);
    expect(added.filter((n) => /PAYPRO/i.test(n))).toEqual([]);
    expect(BASE_NAMES.filter((n) => !names().includes(n))).toEqual([]);
  });

  it.each(['test', 'rehearsal', 'production'] as const)('AC-34, AC-65: class %s boots without any site variable', (cls) => {
    const result = loadEnv(rawEnv(cls), envRegistry);
    expect(result).toMatchObject({ ok: true, class: cls });
    if (result.ok) expect(result.env.T2F_REBUILD_PRODUCTION).toBe('0');
  });

  it('both tokens are secret (masked in every log line), the other three are not', () => {
    const site = envRegistry.find((b) => b.key === 'site');
    const secret = (site?.vars ?? []).filter((v) => v.secret).map((v) => v.name).sort();
    expect(secret).toEqual(['T2F_CF_PURGE_TOKEN', 'T2F_GITHUB_DISPATCH_TOKEN']);
    expect(site?.vars.every((v) => v.requiredIn === undefined)).toBe(true);
  });

  it('values are validated: zone id is 32 hex, site URL is a URL, the production switch is 0 or 1', () => {
    const zone = 'a'.repeat(32);
    expect(loadEnv(rawEnv('test', { T2F_CF_ZONE_ID: zone, T2F_SITE_URL: 'https://time2fest.com', T2F_REBUILD_PRODUCTION: '1' }), envRegistry).ok).toBe(true);
    expect(loadEnv(rawEnv('test', { T2F_CF_ZONE_ID: 'zone' }), envRegistry)).toEqual({ ok: false, failing: ['T2F_CF_ZONE_ID'] });
    expect(loadEnv(rawEnv('test', { T2F_SITE_URL: 'time2fest' }), envRegistry)).toEqual({ ok: false, failing: ['T2F_SITE_URL'] });
    expect(loadEnv(rawEnv('test', { T2F_REBUILD_PRODUCTION: 'yes' }), envRegistry)).toEqual({ ok: false, failing: ['T2F_REBUILD_PRODUCTION'] });
  });

  it('server/.env.example lists the five names with empty values', () => {
    const text = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    for (const name of SITE_NAMES) expect(text.split('\n')).toContain(`${name}=`);
    expect(text).not.toMatch(/^[^#]*PAYPRO(?!_MODE=)/m);
  });
});
