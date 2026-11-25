/** SPEC-10 AC-47, AC-55, NFR-6: env blocks `auth` and `mail`, loopback-only mail and OIDC in `test`, secret masking. */
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/platform/env';
import { createLogger } from '../../src/platform/logger';
import { envRegistry } from '../../src/registries/env';

const base = {
  T2F_ENV: 'test',
  DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/t2f_spec_10_auth_mail_test',
  REDIS_URL: 'redis://127.0.0.1:6380/20',
  T2F_REDIS_PREFIX: 't2f:spec_10_auth_mail:',
  PAYLOAD_SECRET: 'payload-secret-value-that-is-32-chars-long', // check-secrets: allow test fake
};

const rehearsal = {
  T2F_ENV: 'rehearsal',
  DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_rehearsal',
  REDIS_URL: 'redis://redis:6379/0',
  T2F_REDIS_PREFIX: 't2f:rehearsal:',
  PAYLOAD_SECRET: 'payload-secret-value-that-is-32-chars-long', // check-secrets: allow test fake
};

const failingOf = (raw: Record<string, string>) => {
  const r = loadEnv(raw, envRegistry);
  return r.ok ? [] : r.failing;
};

describe('SPEC-10 auth and mail env', () => {
  it('the blocks `auth` and `mail` exist, sorted by key, with the defaults', () => {
    const keys = envRegistry.map((b) => b.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('auth');
    expect(keys).toContain('mail');
    const r = loadEnv(base, envRegistry);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env.T2F_SEASON_END).toBe('2027-01-15T00:00:00Z');
    expect(r.env.T2F_MAIL_PLAN).toBe('free');
    expect(r.env.T2F_MAIL_DAILY_CEILING).toBe(100);
    expect(r.env.SMTP_FALLBACK_DAILY_CEILING).toBe(100);
    expect(r.env.T2F_MAIL_FROM).toBe('Time2Fest <code@mail.time2fest.com>');
    expect(r.env.T2F_GOOGLE_DISCOVERY_URL).toBeUndefined();
  });

  it('the local test stack values pass in `test`', () => {
    const r = loadEnv(
      {
        ...base,
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: '1025',
        SMTP_FALLBACK_HOST: 'localhost',
        SMTP_FALLBACK_PORT: '1026',
        T2F_GOOGLE_DISCOVERY_URL: 'http://127.0.0.1:8091/google/.well-known/openid-configuration',
        T2F_MAIL_PLAN: 'pro',
      },
      envRegistry,
    );
    expect(r.ok).toBe(true);
  });

  it.each([
    ['SMTP_HOST', 'smtp.resend.com'],
    ['SMTP_FALLBACK_HOST', 'smtp.mx.cloudflare.net'],
    ['SMTP_HOST', '127.0.0.1.nip.io'],
    ['T2F_GOOGLE_DISCOVERY_URL', 'https://accounts.google.com/.well-known/openid-configuration'],
  ])('AC-47: `test` refuses %s = %s, naming the variable and never the value', (name, value) => {
    const failing = failingOf({ ...base, [name]: value });
    expect(failing).toEqual([name]);
    expect(failing.join(' ')).not.toContain(value);
  });

  it('outside `test` the Google discovery URL must be https', () => {
    const secret = 'a'.repeat(40); // check-secrets: allow test fake
    expect(failingOf({ ...rehearsal, T2F_AUTH_SECRET: secret, T2F_GOOGLE_DISCOVERY_URL: 'http://accounts.google.com/x' })).toContain(
      'T2F_GOOGLE_DISCOVERY_URL',
    );
    expect(failingOf({ ...rehearsal, T2F_AUTH_SECRET: secret, T2F_GOOGLE_DISCOVERY_URL: 'https://accounts.google.com/x' })).not.toContain(
      'T2F_GOOGLE_DISCOVERY_URL',
    );
  });

  it('T2F_AUTH_SECRET is required outside `test` and at least 32 chars', () => {
    expect(failingOf(rehearsal)).toContain('T2F_AUTH_SECRET');
    expect(failingOf({ ...base, T2F_AUTH_SECRET: 'short' })).toEqual(['T2F_AUTH_SECRET']); // check-secrets: allow test fake
    expect(failingOf({ ...base, T2F_MAIL_PLAN: 'enterprise' })).toEqual(['T2F_MAIL_PLAN']);
  });

  it('SMTP_PASSWORD and the other secrets are masked in a logger line', () => {
    const password = 're_fake_password_value_123456'; // check-secrets: allow test fake
    const fallback = 'cf_fake_fallback_value_654321'; // check-secrets: allow test fake
    const r = loadEnv({ ...base, SMTP_PASSWORD: password, SMTP_FALLBACK_PASSWORD: fallback }, envRegistry);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lines: string[] = [];
    const log = createLogger(r.secrets, { clock: { now: () => 0 }, write: (l) => void lines.push(l) });
    log.error({ msg: `smtp auth failed for ${password} / ${fallback}` });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(password);
    expect(lines[0]).not.toContain(fallback);
  });
});
