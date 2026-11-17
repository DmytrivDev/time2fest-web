import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/platform/env';
import { envRegistry } from '../../src/registries/env';

const SECRET = 'payload-secret-value-that-is-32-chars-long'; // check-secrets: allow fake payload secret for the env loader unit test

/** The values `db.mjs` writes into a worktree `.env.local` (test class). */
const base = {
  T2F_ENV: 'test',
  DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/t2f_spec_04_admin_catalog',
  REDIS_URL: 'redis://127.0.0.1:6380/5',
  T2F_REDIS_PREFIX: 't2f:spec_04_admin_catalog:',
  PAYLOAD_SECRET: SECRET,
  T2F_ADMIN_HOST: 'admin.localhost:3100',
  T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-test.invalid',
  T2F_ACCESS_AUD: 't2f-test-aud',
  T2F_ACCESS_JWKS_URL: 'test-signer:',
  T2F_OWNER_EMAILS: 'owner+x@example.com,owner2+x@example.com',
  T2F_ACCESS_SERVICE_CNS: 'test-agent.access',
  T2F_R2_ENDPOINT: 'http://127.0.0.1:9090',
  T2F_R2_BUCKET: 't2f-catalog',
  T2F_R2_PREFIX: 'spec_04_admin_catalog/',
  T2F_R2_ACCESS_KEY_ID: 't2f-local',
  T2F_R2_SECRET_ACCESS_KEY: 't2f-local-secret-0000',
};

describe('env blocks access and catalog', () => {
  it('accepts the test-class .env.local values and masks the R2 secret', () => {
    const r = loadEnv(base, envRegistry);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.secrets).toContain(base.T2F_R2_SECRET_ACCESS_KEY);
    expect(r.secrets).toContain(base.T2F_R2_ACCESS_KEY_ID);
    const marked = envRegistry.flatMap((b) => b.vars).filter((v) => v.secret).map((v) => v.name);
    expect(marked).toContain('T2F_R2_SECRET_ACCESS_KEY');
    expect(r.env.T2F_CATALOG_RATE_PER_MIN).toBe(30);
  });

  it('names T2F_ACCESS_AUD when it is absent in production', () => {
    const prod: Record<string, string | undefined> = { ...base, T2F_ENV: 'production' };
    delete prod.T2F_ACCESS_AUD;
    const r = loadEnv(prod, envRegistry);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failing).toContain('T2F_ACCESS_AUD');
  });

  it('rejects a malformed R2 prefix', () => {
    const r = loadEnv({ ...base, T2F_R2_PREFIX: 'Bad/Prefix' }, envRegistry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing).toContain('T2F_R2_PREFIX');
  });
});
