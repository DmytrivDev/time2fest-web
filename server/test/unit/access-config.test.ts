import { describe, expect, it } from 'vitest';
import { parseAccessConfig } from '../../src/domain/access/config';

const TEAM = 'https://t2f.cloudflareaccess.com';
const PROD = {
  T2F_ADMIN_HOST: 'admin.example.com',
  T2F_ACCESS_TEAM_DOMAIN: TEAM,
  T2F_ACCESS_AUD: 'aud-tag',
  T2F_ACCESS_JWKS_URL: `${TEAM}/cdn-cgi/access/certs`,
  T2F_OWNER_EMAILS: 'Main@Example.com,reserve@example.com',
  T2F_ACCESS_SERVICE_CNS: 'agent-1.access, agent-2.access',
};

const failing = (raw: Record<string, string | undefined>, cls: 'test' | 'rehearsal' | 'production') => {
  const r = parseAccessConfig(raw, cls);
  return r.ok ? [] : r.failing;
};

describe('parseAccessConfig (AC-7)', () => {
  it('accepts a Cloudflare config in production and normalises it', () => {
    const r = parseAccessConfig(PROD, 'production');
    expect(r).toEqual({
      ok: true,
      config: {
        adminHost: 'admin.example.com',
        issuer: TEAM,
        audience: 'aud-tag',
        jwks: { kind: 'remote', url: `${TEAM}/cdn-cgi/access/certs` },
        ownerEmails: ['main@example.com', 'reserve@example.com'],
        serviceCommonNames: ['agent-1.access', 'agent-2.access'],
      },
    });
  });

  it.each(['rehearsal', 'production'] as const)('%s: each missing setting is named', (cls) => {
    for (const name of ['T2F_ADMIN_HOST', 'T2F_ACCESS_TEAM_DOMAIN', 'T2F_ACCESS_AUD', 'T2F_ACCESS_JWKS_URL', 'T2F_OWNER_EMAILS']) {
      expect(failing({ ...PROD, [name]: undefined }, cls)).toContain(name);
    }
    expect(failing({ ...PROD, T2F_ACCESS_AUD: '' }, cls)).toEqual(['T2F_ACCESS_AUD']);
  });

  it('production refuses the test JWKS, naming T2F_ACCESS_JWKS_URL', () => {
    expect(failing({ ...PROD, T2F_ACCESS_JWKS_URL: 'test-signer:' }, 'production')).toEqual(['T2F_ACCESS_JWKS_URL']);
  });

  it('rehearsal refuses the test issuer, naming T2F_ACCESS_TEAM_DOMAIN', () => {
    expect(failing({ ...PROD, T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-test.invalid' }, 'rehearsal')).toContain('T2F_ACCESS_TEAM_DOMAIN');
  });

  it('production refuses a JWKS that is not https, not Cloudflare, or not under the team domain', () => {
    for (const url of [
      'http://127.0.0.1:9999/certs',
      'https://evil.example.com/cdn-cgi/access/certs',
      'https://other.cloudflareaccess.com/cdn-cgi/access/certs',
      `${TEAM}/somewhere-else`,
    ]) {
      expect(failing({ ...PROD, T2F_ACCESS_JWKS_URL: url }, 'production')).toEqual(['T2F_ACCESS_JWKS_URL']);
    }
  });

  it('refuses more than two owner emails (Q2)', () => {
    expect(failing({ ...PROD, T2F_OWNER_EMAILS: 'a@example.com,b@example.com,c@example.com' }, 'production')).toEqual([
      'T2F_OWNER_EMAILS',
    ]);
  });

  it('test: allows the test signer, a loopback JWKS and the .invalid test issuer', () => {
    const test = { ...PROD, T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-test.invalid', T2F_ACCESS_JWKS_URL: 'test-signer:' };
    const r = parseAccessConfig(test, 'test');
    expect(r.ok && r.config?.jwks).toEqual({ kind: 'test-signer' });
    expect(failing({ ...test, T2F_ACCESS_JWKS_URL: 'http://127.0.0.1:4555/certs' }, 'test')).toEqual([]);
    expect(failing({ ...test, T2F_ACCESS_JWKS_URL: 'http://10.0.0.1:4555/certs' }, 'test')).toEqual(['T2F_ACCESS_JWKS_URL']);
  });

  it('test without any Access setting: no config (the gate then denies everything)', () => {
    expect(parseAccessConfig({}, 'test')).toEqual({ ok: true, config: undefined });
    expect(failing({ T2F_ACCESS_AUD: 'x' }, 'test')).toContain('T2F_ADMIN_HOST');
  });
});
