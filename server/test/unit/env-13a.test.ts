/**
 * SPEC-13a env rules: production denylist and isolated variables (AC-39), the previous edge
 * secret (AC-36, rotation), the listen host (AC-2, schema part) and the image commit.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv, PRODUCTION_DENYLIST, PRODUCTION_HOSTS, PRODUCTION_NAMES } from '../../src/platform/env';
import { envRegistry } from '../../src/registries/env';

const EDGE_SECRET = randomBytes(24).toString('hex');
const PAYLOAD_SECRET = randomBytes(24).toString('hex');

/** A valid raw environment of class `rehearsal` with every variable it requires. */
function rawEnv(over: Record<string, string | undefined> = {}) {
  return {
    T2F_ENV: 'rehearsal',
    DATABASE_URI: 'postgres://t2f:pw@postgres:5432/t2f_rehearsal', // check-secrets: allow fake rehearsal DATABASE_URI for the env loader unit test
    REDIS_URL: 'redis://redis:6379/0',
    T2F_REDIS_PREFIX: 't2f:rehearsal:',
    T2F_CENTRIFUGO_URL: 'https://o-rehearsal.time2fest.com',
    T2F_CENTRIFUGO_API_KEY: randomBytes(24).toString('hex'),
    T2F_CENTRIFUGO_TOKEN_SECRET: randomBytes(24).toString('hex'),
    PAYLOAD_SECRET,
    T2F_EDGE_SECRET: EDGE_SECRET,
    T2F_ADMIN_HOST: 'admin-rehearsal.time2fest.com',
    T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-test.invalid',
    T2F_ACCESS_AUD: 't2f-test-aud',
    T2F_ACCESS_JWKS_URL: 'https://t2f-test.invalid/cdn-cgi/access/certs',
    T2F_OWNER_EMAILS: 'owner@example.com',
    T2F_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    T2F_R2_BUCKET: 'time2fest-rehearsal',
    T2F_R2_PREFIX: 'rehearsal/',
    T2F_R2_ACCESS_KEY_ID: 't2f-rehearsal',
    T2F_R2_SECRET_ACCESS_KEY: randomBytes(16).toString('hex'),
    // SPEC-13b AC-67: required in production since the ops wave; optional elsewhere.
    T2F_TELEGRAM_BOT_TOKEN: 'test-telegram-token-not-real', // check-secrets: allow test fake
    T2F_TELEGRAM_CHAT_ID: '-1001234567890',
    T2F_BACKUP_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // check-secrets: allow test fake backup key
    ...over,
  };
}

describe('SPEC-13a environment', () => {
  it('AC-39: the denylist holds the production names by convention', () => {
    expect(PRODUCTION_DENYLIST).toEqual(['time2fest-prod', 'o.time2fest.com', 't2f_production', 't2f:production:']);
  });

  it('AC-39: the rehearsal values pass', () => {
    const result = loadEnv(rawEnv(), envRegistry);
    expect(result).toMatchObject({ ok: true, class: 'rehearsal' });
  });

  it.each([
    ['T2F_R2_BUCKET', 'time2fest-prod'],
    ['T2F_CENTRIFUGO_URL', 'https://o.time2fest.com'],
    ['DATABASE_URI', 'postgres://t2f:pw@postgres:5432/t2f_production'], // check-secrets: allow fake production-named DATABASE_URI for the denylist test
    ['T2F_REDIS_PREFIX', 't2f:production:'],
  ])('AC-39: rehearsal with a production %s refuses to start, naming it', (name, value) => {
    const result = loadEnv(rawEnv({ [name]: value }), envRegistry);
    expect(result).toEqual({ ok: false, failing: [name] });
  });

  it('AC-39: a test class pointing at a production bucket is refused too', () => {
    const result = loadEnv(
      rawEnv({
        T2F_ENV: 'test',
        DATABASE_URI: 'postgres://t2f:pw@localhost:5433/t2f_spec_13a_server_deploy_test', // check-secrets: allow fake local DATABASE_URI for the env loader unit test
        REDIS_URL: 'redis://localhost:6380/26',
        T2F_REDIS_PREFIX: 't2f:spec_13a_server_deploy:',
        T2F_R2_BUCKET: 'time2fest-prod',
      }),
      envRegistry,
    );
    expect(result).toEqual({ ok: false, failing: ['T2F_R2_BUCKET'] });
  });

  it('S4: rehearsal or test pointing T2F_ADMIN_HOST at the production admin host is refused, by exact host only', () => {
    expect(PRODUCTION_HOSTS).toEqual(['admin.time2fest.com']);
    for (const host of ['admin.time2fest.com', 'ADMIN.time2fest.com', 'admin.time2fest.com:443', 'admin.time2fest.com.']) {
      expect(loadEnv(rawEnv({ T2F_ADMIN_HOST: host }), envRegistry), host).toEqual({ ok: false, failing: ['T2F_ADMIN_HOST'] });
    }
    const test = loadEnv(
      rawEnv({
        T2F_ENV: 'test',
        DATABASE_URI: 'postgres://t2f@localhost:5433/t2f_spec_13a_server_deploy_test',
        REDIS_URL: 'redis://localhost:6380/26',
        T2F_REDIS_PREFIX: 't2f:spec_13a_server_deploy:',
        T2F_ADMIN_HOST: 'admin.time2fest.com',
      }),
      envRegistry,
    );
    expect(test).toEqual({ ok: false, failing: ['T2F_ADMIN_HOST'] });
    // Not a substring rule: the rehearsal host and other hosts ending in the same name pass.
    for (const host of ['admin-rehearsal.time2fest.com', 'xadmin.time2fest.com', 'admin.time2fest.com.example.org']) {
      expect(loadEnv(rawEnv({ T2F_ADMIN_HOST: host }), envRegistry).ok, host).toBe(true);
    }
  });

  it('S5: a percent-encoded production name in a URL path or host is still refused; an undecodable URL is refused', () => {
    const cases: [string, string][] = [
      ['DATABASE_URI', 'postgres://t2f@postgres:5432/t2f%5Fproduction'],
      ['DATABASE_URI', 'postgres://t2f@postgres:5432/T2F%5fPRODUCTION'],
      ['T2F_CENTRIFUGO_URL', 'https://o%2Etime2fest.com'],
      ['REDIS_URL', 'redis://redis:6379/t2f%3Aproduction%3A'],
      ['DATABASE_URI', 'postgres://t2f@postgres:5432/t2f_%E0%A4%A'],
    ];
    for (const [name, value] of cases) {
      expect(loadEnv(rawEnv({ [name]: value }), envRegistry), value).toEqual({ ok: false, failing: [name] });
    }
  });

  it('S4: production refuses to start unless the database, bucket and Redis prefix carry the production names', () => {
    const prod = (over: Record<string, string | undefined> = {}) =>
      loadEnv(
        rawEnv({
          T2F_ENV: 'production',
          T2F_ALLOWED_ORIGINS: 'https://time2fest.com',
          T2F_ADMIN_HOST: 'admin.time2fest.com',
          DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_production',
          T2F_R2_BUCKET: 'time2fest-prod',
          T2F_REDIS_PREFIX: 't2f:production:',
          ...over,
        }),
        envRegistry,
      );
    expect(prod()).toMatchObject({ ok: true, class: 'production' });
    expect(PRODUCTION_NAMES).toEqual({ bucket: 'time2fest-prod', database: 't2f_production', redisPrefix: 't2f:production:' });
    const cases: [Record<string, string | undefined>, string[]][] = [
      [{ T2F_R2_BUCKET: 'time2fest-rehearsal' }, ['T2F_R2_BUCKET']],
      [{ DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_rehearsal' }, ['DATABASE_URI']],
      [{ DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_production_old' }, ['DATABASE_URI']],
      [{ T2F_REDIS_PREFIX: 't2f:rehearsal:' }, ['T2F_REDIS_PREFIX']],
      [{ T2F_REDIS_PREFIX: undefined }, ['T2F_REDIS_PREFIX']],
      [
        { DATABASE_URI: 'postgres://t2f@postgres:5432/other', T2F_R2_BUCKET: 'bucket', T2F_REDIS_PREFIX: 'x:' },
        ['T2F_R2_BUCKET', 'DATABASE_URI', 'T2F_REDIS_PREFIX'],
      ],
    ];
    for (const [over, failing] of cases) {
      const result = prod(over);
      expect(result, JSON.stringify(over)).toEqual({ ok: false, failing });
    }
    // A missing bucket is named once (required and conventional).
    expect(prod({ T2F_R2_BUCKET: undefined })).toEqual({ ok: false, failing: ['T2F_R2_BUCKET'] });
  });

  it('AC-36: a previous secret shorter than 32 characters is named, its value is not in the result', () => {
    const short = randomBytes(16).toString('hex').slice(0, 31);
    const result = loadEnv(rawEnv({ T2F_EDGE_SECRET_PREVIOUS: short }), envRegistry);
    expect(result).toEqual({ ok: false, failing: ['T2F_EDGE_SECRET_PREVIOUS'] });
    expect(JSON.stringify(result)).not.toContain(short);
  });

  it('AC-36: a previous secret equal to the current one is named once, no value in the result', () => {
    const result = loadEnv(rawEnv({ T2F_EDGE_SECRET_PREVIOUS: EDGE_SECRET }), envRegistry);
    expect(result).toEqual({ ok: false, failing: ['T2F_EDGE_SECRET_PREVIOUS'] });
    expect(JSON.stringify(result)).not.toContain(EDGE_SECRET);
  });

  it('AC-35: an empty previous secret is unset; a distinct one is accepted and masked as a secret', () => {
    const empty = loadEnv(rawEnv({ T2F_EDGE_SECRET_PREVIOUS: '' }), envRegistry);
    expect(empty.ok).toBe(true);
    if (empty.ok) expect(empty.env.T2F_EDGE_SECRET_PREVIOUS).toBeUndefined();

    const previous = randomBytes(24).toString('hex');
    const result = loadEnv(rawEnv({ T2F_EDGE_SECRET_PREVIOUS: previous }), envRegistry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.env.T2F_EDGE_SECRET_PREVIOUS).toBe(previous);
    expect(result.secrets).toContain(previous);
  });

  it('AC-2: an invalid T2F_HOST is refused by name; an address or a host name passes', () => {
    expect(loadEnv(rawEnv({ T2F_HOST: 'bad host;' }), envRegistry)).toEqual({ ok: false, failing: ['T2F_HOST'] });
    expect(loadEnv(rawEnv({ T2F_HOST: '0.0.0.0' }), envRegistry).ok).toBe(true);
    expect(loadEnv(rawEnv({ T2F_HOST: 'server' }), envRegistry).ok).toBe(true);
  });

  it('AC-1: T2F_COMMIT is a full 40-character lowercase hex hash', () => {
    expect(loadEnv(rawEnv({ T2F_COMMIT: 'a'.repeat(40) }), envRegistry).ok).toBe(true);
    expect(loadEnv(rawEnv({ T2F_COMMIT: 'abc123' }), envRegistry)).toEqual({ ok: false, failing: ['T2F_COMMIT'] });
  });
});
