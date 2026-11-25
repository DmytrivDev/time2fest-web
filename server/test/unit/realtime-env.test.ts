import { describe, expect, it } from 'vitest';
import { parseRealtimeConfig } from '../../src/domain/realtime/config';
import { loadEnv, type RawEnv } from '../../src/platform/env';
import { envRegistry } from '../../src/registries/env';

const API_KEY = 'centrifugo-api-key-unit-test-0000000000'; // check-secrets: allow test fake
const TOKEN_SECRET = 'centrifugo-token-secret-unit-test-000000'; // check-secrets: allow test fake
const SHORT = 'k'.repeat(31); // check-secrets: allow test fake

/** A valid raw environment of the `test` class, with the realtime settings of a worktree. */
function rawEnv(over: Record<string, string | undefined> = {}): RawEnv {
  const base = baseEnv();
  return { ...base, ...classNames(over.T2F_ENV), ...over };
}

/** SPEC-13a names the `rehearsal` and `production` classes require (isolated or production-named values). */
function classNames(cls: string | undefined): Record<string, string> {
  if (cls === 'rehearsal') {
    return {
      DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_rehearsal',
      T2F_REDIS_PREFIX: 't2f:rehearsal:',
      T2F_ADMIN_HOST: 'admin-rehearsal.time2fest.com',
      T2F_R2_BUCKET: 'time2fest-rehearsal',
      T2F_CENTRIFUGO_URL: 'https://o-rehearsal.time2fest.com',
    };
  }
  if (cls === 'production') {
    return {
      DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_production',
      T2F_REDIS_PREFIX: 't2f:production:',
      T2F_ADMIN_HOST: 'admin.time2fest.com',
      T2F_R2_BUCKET: 'time2fest-prod',
      T2F_CENTRIFUGO_URL: 'https://o.time2fest.com',
    };
  }
  return {};
}

function baseEnv(): RawEnv {
  return {
    T2F_ENV: 'test',
    DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/t2f_spec_06_realtime_test',
    REDIS_URL: 'redis://127.0.0.1:6380/12',
    T2F_REDIS_PREFIX: 't2f:spec_06_realtime:',
    PAYLOAD_SECRET: 'payload-secret-value-that-is-32-chars-long', // check-secrets: allow test fake
    T2F_EDGE_SECRET: 'edge-secret-value-for-the-realtime-unit-test', // check-secrets: allow test fake
    T2F_AUTH_SECRET: 'auth-secret-value-for-the-env-unit-tests-000', // check-secrets: allow test fake (SPEC-10 requires it outside test)
    T2F_ALLOWED_ORIGINS: 'https://time2fest.com',
    T2F_ADMIN_HOST: 'admin.localhost:3100',
    T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-test.invalid',
    T2F_ACCESS_AUD: 't2f-test-aud',
    T2F_ACCESS_JWKS_URL: 'test-signer:',
    T2F_OWNER_EMAILS: 'owner@example.com',
    T2F_R2_ENDPOINT: 'http://127.0.0.1:9090',
    T2F_R2_BUCKET: 't2f-catalog',
    T2F_R2_PREFIX: 'spec_06_realtime/',
    T2F_R2_ACCESS_KEY_ID: 't2f-local',
    T2F_R2_SECRET_ACCESS_KEY: 't2f-local-secret-0000', // check-secrets: allow test fake
    T2F_CENTRIFUGO_URL: 'http://127.0.0.1:8000',
    T2F_CENTRIFUGO_PREFIX: 'spec_06_realtime_',
    // SPEC-13b AC-67: required in production since the ops wave; optional elsewhere.
    T2F_TELEGRAM_BOT_TOKEN: 'test-telegram-token-not-real', // check-secrets: allow test fake
    T2F_TELEGRAM_CHAT_ID: '-1001234567890',
    T2F_BACKUP_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // check-secrets: allow test fake backup key
    T2F_CENTRIFUGO_API_KEY: API_KEY,
    T2F_CENTRIFUGO_TOKEN_SECRET: TOKEN_SECRET,
  };
}

/** The boot sequence of `instrumentation.ts` / `env:check`: the registry, then the realtime parser. */
function boot(raw: RawEnv): { ok: true } | { ok: false; failing: string[] } {
  const env = loadEnv(raw, envRegistry);
  if (!env.ok) return env;
  const rt = parseRealtimeConfig(raw, env.class);
  return rt.ok ? { ok: true } : { ok: false, failing: rt.failing };
}

describe('realtime env (SPEC-06)', () => {
  it('AC-11: a non-empty prefix that is not `<slug>_` refuses start and names T2F_CENTRIFUGO_PREFIX', () => {
    for (const bad of ['a:b_', 'a#b_', 'ABC_', 'abc', `${'a'.repeat(41)}_`]) {
      expect(boot(rawEnv({ T2F_CENTRIFUGO_PREFIX: bad }))).toEqual({ ok: false, failing: ['T2F_CENTRIFUGO_PREFIX'] });
    }
    for (const cls of ['rehearsal', 'production']) {
      expect(boot(rawEnv({ T2F_ENV: cls, T2F_CENTRIFUGO_PREFIX: 'ABC_' }))).toEqual({ ok: false, failing: ['T2F_CENTRIFUGO_PREFIX'] });
    }
    expect(boot(rawEnv({ T2F_CENTRIFUGO_PREFIX: 'abc_' }))).toEqual({ ok: true });
  });

  it('AC-10: the prefix applies in test only; rehearsal and production resolve it to empty', () => {
    expect(parseRealtimeConfig(rawEnv({ T2F_CENTRIFUGO_PREFIX: 'abc_' }), 'test')).toMatchObject({ ok: true, config: { prefix: 'abc_' } });
    expect(parseRealtimeConfig(rawEnv({ T2F_CENTRIFUGO_PREFIX: undefined }), 'test')).toMatchObject({ ok: true, config: { prefix: '' } });
    for (const cls of ['rehearsal', 'production'] as const) {
      expect(parseRealtimeConfig(rawEnv({ T2F_CENTRIFUGO_PREFIX: 'abc_' }), cls)).toMatchObject({ ok: true, config: { prefix: '' } });
    }
  });

  describe.each(['rehearsal', 'production'])('AC-20: %s', (cls) => {
    it('starts with every realtime variable present', () => {
      expect(boot(rawEnv({ T2F_ENV: cls }))).toEqual({ ok: true });
    });

    it.each(['T2F_CENTRIFUGO_API_KEY', 'T2F_CENTRIFUGO_TOKEN_SECRET', 'T2F_CENTRIFUGO_URL'])('refuses without %s, naming exactly it', (name) => {
      expect(boot(rawEnv({ T2F_ENV: cls, [name]: undefined }))).toEqual({ ok: false, failing: [name] });
      expect(boot(rawEnv({ T2F_ENV: cls, [name]: '' }))).toEqual({ ok: false, failing: [name] });
    });

    it.each(['T2F_CENTRIFUGO_API_KEY', 'T2F_CENTRIFUGO_TOKEN_SECRET'])('refuses a 31-character %s, naming exactly it', (name) => {
      expect(boot(rawEnv({ T2F_ENV: cls, [name]: SHORT }))).toEqual({ ok: false, failing: [name] });
    });
    it('refuses a token secret equal to the API key, naming the token secret and never a value', () => {
      const result = boot(rawEnv({ T2F_ENV: cls, T2F_CENTRIFUGO_TOKEN_SECRET: API_KEY }));
      expect(result).toEqual({ ok: false, failing: ['T2F_CENTRIFUGO_TOKEN_SECRET'] });
      expect(JSON.stringify(result)).not.toContain(API_KEY);
    });
  });

  it('both keys are secret (masked in logs) and required in rehearsal and production', () => {
    const block = envRegistry.find((b) => b.key === 'realtime');
    for (const name of ['T2F_CENTRIFUGO_API_KEY', 'T2F_CENTRIFUGO_TOKEN_SECRET']) {
      const v = block?.vars.find((x) => x.name === name);
      expect(v?.secret).toBe(true);
      expect(v?.requiredIn).toEqual(['rehearsal', 'production']);
    }
    const env = loadEnv(rawEnv(), envRegistry);
    expect(env.ok && env.secrets).toEqual(expect.arrayContaining([API_KEY, TOKEN_SECRET]));
  });

  it('test may share one value for the token secret and the API key (local stand)', () => {
    expect(boot(rawEnv({ T2F_CENTRIFUGO_TOKEN_SECRET: API_KEY }))).toEqual({ ok: true });
  });

  it('test starts without the URL and both keys', () => {
    const raw = rawEnv({ T2F_CENTRIFUGO_URL: undefined, T2F_CENTRIFUGO_API_KEY: undefined, T2F_CENTRIFUGO_TOKEN_SECRET: undefined });
    expect(boot(raw)).toEqual({ ok: true });
    expect(parseRealtimeConfig(raw, 'test')).toEqual({ ok: true, config: { prefix: 'spec_06_realtime_' } });
  });

  it('carries the URL and both keys into the config', () => {
    expect(parseRealtimeConfig(rawEnv(), 'test')).toEqual({
      ok: true,
      config: { url: 'http://127.0.0.1:8000', apiKey: API_KEY, tokenSecret: TOKEN_SECRET, prefix: 'spec_06_realtime_' },
    });
  });
});
