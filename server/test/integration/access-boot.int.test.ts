/**
 * AC-7: rehearsal/production refuse to start with missing or test Access settings, naming the
 * variable. Spawns the real boot check (`env.check.ts`) with a production environment.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tsx = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const TEAM = 'https://t2f.cloudflareaccess.com';
const PRODUCTION: Record<string, string> = {
  T2F_ENV: 'production',
  T2F_ALLOWED_ORIGINS: 'https://time2fest.com',
  T2F_ADMIN_HOST: 'admin.time2fest.com',
  T2F_ACCESS_TEAM_DOMAIN: TEAM,
  T2F_ACCESS_AUD: 'aud-tag',
  T2F_ACCESS_JWKS_URL: `${TEAM}/cdn-cgi/access/certs`,
  T2F_OWNER_EMAILS: 'main@example.com,reserve@example.com',
  T2F_R2_ENDPOINT: 'https://r2.example.com',
  T2F_R2_BUCKET: 'bucket',
  T2F_R2_PREFIX: 'prod/',
  T2F_R2_ACCESS_KEY_ID: 'key-id',
  T2F_R2_SECRET_ACCESS_KEY: 'key-secret',
};

function envCheck(over: Record<string, string>) {
  return spawnSync(process.execPath, [tsx, 'src/platform/env.check.ts'], {
    cwd: serverDir,
    env: { ...process.env, ...PRODUCTION, ...over },
    encoding: 'utf8',
  });
}

describe('Access boot refusal (AC-7)', () => {
  it('a complete Cloudflare config starts', () => {
    const r = envCheck({});
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('production with the test JWKS → exit ≠ 0 naming T2F_ACCESS_JWKS_URL', () => {
    const r = envCheck({ T2F_ACCESS_JWKS_URL: 'test-signer:' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('T2F_ACCESS_JWKS_URL');
  });

  it('production without T2F_ACCESS_AUD → exit ≠ 0 naming it', () => {
    const r = envCheck({ T2F_ACCESS_AUD: '' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('T2F_ACCESS_AUD');
  });

  it('rehearsal with the test issuer → exit ≠ 0 naming T2F_ACCESS_TEAM_DOMAIN', () => {
    const r = envCheck({ T2F_ENV: 'rehearsal', T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-test.invalid' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('T2F_ACCESS_TEAM_DOMAIN');
  });
});
