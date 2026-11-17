import { describe, expect, it } from 'vitest';
import { envClass, loadEnv } from '../../src/platform/env';
import { idemKey } from '../../src/platform/idempotency';
import { createAlarm, createLogger } from '../../src/platform/logger';
import { assertRegistry } from '../../src/platform/registry';
import { envRegistry } from '../../src/registries/env';

const SECRET = 'payload-secret-value-that-is-32-chars-long'; // check-secrets: allow fake payload secret for the env loader unit test
const clock = { now: () => 1_700_000_000_000 };

/** A valid raw environment of the given class. */
function rawEnv(over: Record<string, string | undefined> = {}) {
  return {
    T2F_ENV: 'test',
    DATABASE_URI: 'postgres://t2f:pw@localhost:5433/t2f_spec_02_server_skeleton_test', // check-secrets: allow fake local DATABASE_URI for the env loader unit test
    REDIS_URL: 'redis://localhost:6380/4',
    T2F_REDIS_PREFIX: 't2f:spec_02_server_skeleton:',
    PAYLOAD_SECRET: SECRET,
    ...over,
  };
}

function capture() {
  const lines: string[] = [];
  return { lines, write: (l: string) => void lines.push(l) };
}

describe('environment', () => {
  it('AC-18: an empty, unknown, wrongly cased or absent T2F_ENV is production', () => {
    expect(envClass({ T2F_ENV: '' })).toBe('production');
    expect(envClass({ T2F_ENV: 'prod' })).toBe('production');
    expect(envClass({ T2F_ENV: 'Test' })).toBe('production');
    expect(envClass({})).toBe('production');
    expect(envClass({ T2F_ENV: 'test' })).toBe('test');
    expect(envClass({ T2F_ENV: 'rehearsal' })).toBe('rehearsal');
  });

  it('AC-19: a bad PAYLOAD_SECRET is named and its value is not in the result', () => {
    expect(loadEnv(rawEnv(), envRegistry).ok).toBe(true);
    const bad = 'short-secret-xyz';
    const result = loadEnv(rawEnv({ PAYLOAD_SECRET: bad }), envRegistry);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failing).toContain('PAYLOAD_SECRET');
    expect(JSON.stringify(result)).not.toContain(bad);
  });

  it('AC-20: test class with a denylisted DATABASE_URI, and rehearsal with PAYPRO_MODE=live, are refused by name', () => {
    const denylist = ['prod-db.internal'];
    const db = loadEnv(rawEnv({ DATABASE_URI: 'postgres://u:p@PROD-DB.internal:5432/t2f' }), envRegistry, denylist); // check-secrets: allow fake production-looking DATABASE_URI that the isolation guard must reject
    expect(db).toEqual({ ok: false, failing: ['DATABASE_URI'] });

    const paypro = loadEnv(rawEnv({ T2F_ENV: 'rehearsal', PAYPRO_MODE: 'live' }), envRegistry, denylist);
    expect(paypro).toEqual({ ok: false, failing: ['PAYPRO_MODE'] });

    // Production is not guarded by the isolation rule (it requires its origins instead).
    const prod = loadEnv(
      rawEnv({ T2F_ENV: 'production', PAYPRO_MODE: 'live', T2F_ALLOWED_ORIGINS: 'https://time2fest.com' }),
      envRegistry,
      denylist,
    );
    expect(prod.ok).toBe(true);
    expect(loadEnv(rawEnv({ T2F_ENV: undefined }), envRegistry)).toEqual({ ok: false, failing: ['T2F_ALLOWED_ORIGINS'] });
  });

  it('test class: database and Redis on loopback, a t2f_ database and a t2f:<slug>: prefix; refused by name only', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      expect(loadEnv(rawEnv({ DATABASE_URI: `postgres://t2f@${host}:5433/t2f_x_test`, REDIS_URL: `redis://${host}:6380/0` }), envRegistry).ok).toBe(true);
    }
    const cases: [Record<string, string | undefined>, string[]][] = [
      [{ DATABASE_URI: 'postgres://u:pw-secret@db.example.com:5432/t2f_x' }, ['DATABASE_URI']], // check-secrets: allow fake DATABASE_URI with a password that must never be echoed
      [{ DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/postgres' }, ['DATABASE_URI']],
      [{ DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/T2F_X' }, ['DATABASE_URI']],
      [{ DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/' }, ['DATABASE_URI']],
      [{ REDIS_URL: 'redis://cache.example.com:6379/0' }, ['REDIS_URL']],
      [{ T2F_REDIS_PREFIX: undefined }, ['T2F_REDIS_PREFIX']],
      [{ T2F_REDIS_PREFIX: '' }, ['T2F_REDIS_PREFIX']],
      [{ T2F_REDIS_PREFIX: 't2f:' }, ['T2F_REDIS_PREFIX']],
      [{ T2F_REDIS_PREFIX: 'other:x:' }, ['T2F_REDIS_PREFIX']],
      [{ REDIS_URL: 'redis://10.0.0.2:6379/0', DATABASE_URI: 'postgres://t2f@10.0.0.1/t2f_x', T2F_REDIS_PREFIX: undefined }, ['DATABASE_URI', 'REDIS_URL', 'T2F_REDIS_PREFIX']],
    ];
    for (const [over, failing] of cases) {
      const result = loadEnv(rawEnv(over), envRegistry);
      expect(result, JSON.stringify(over)).toEqual({ ok: false, failing });
      expect(JSON.stringify(result)).not.toContain('pw-secret');
    }
    // Rehearsal keeps the denylist only; production is not guarded by the allowlist.
    expect(loadEnv(rawEnv({ T2F_ENV: 'rehearsal', REDIS_URL: 'redis://cache.example.com:6379/0', T2F_REDIS_PREFIX: undefined }), envRegistry).ok).toBe(true);
  });
});

describe('logger and alarm', () => {
  it('AC-56: page and log alarms each write one line; a throwing writer does not throw', () => {
    const out = capture();
    const alarm = createAlarm(createLogger([], { clock, write: out.write }));
    alarm.raise({ level: 'page', source: 'db', code: 'unreachable' });
    alarm.raise({ level: 'log', source: 'redis', code: 'slow', details: { ms: 900 } });
    expect(out.lines).toHaveLength(2);
    expect(out.lines.every((l) => l.endsWith('\n') && l.indexOf('\n') === l.length - 1)).toBe(true);
    expect(JSON.parse(out.lines[0] as string)).toEqual({ t: clock.now(), level: 'alarm', alarm: 'page', source: 'db', code: 'unreachable' });
    expect(JSON.parse(out.lines[1] as string)).toMatchObject({ level: 'alarm', alarm: 'log', source: 'redis', code: 'slow', ms: 900 });

    const broken = createAlarm(
      createLogger([], {
        clock,
        write: () => {
          throw new Error('EPIPE');
        },
      }),
    );
    expect(() => broken.raise({ level: 'page', source: 'db', code: 'x' })).not.toThrow();
  });

  it('NFR-4: a secret value in a log line, an Error message and an alarm is printed as ***', () => {
    const env = loadEnv(rawEnv(), envRegistry);
    expect(env.ok).toBe(true);
    if (!env.ok) return;
    expect(env.secrets).toContain(SECRET);

    const out = capture();
    const logger = createLogger(env.secrets, { clock, write: out.write });
    logger.info({ msg: `connecting with ${SECRET}`, nested: { list: [SECRET] } });
    logger.error({ err: new Error(`auth failed for ${SECRET}`) });
    createAlarm(logger).raise({ level: 'page', source: 'auth', code: 'leak', details: { hint: SECRET } });

    expect(out.lines).toHaveLength(3);
    for (const l of out.lines) {
      expect(l).not.toContain(SECRET);
      expect(l).toContain('***');
    }
  });

  it('AC-62: assertRegistry fails on a swapped and on a duplicated list, and passes on envRegistry', () => {
    const key = (r: { key: string }) => r.key;
    expect(() => assertRegistry('synthetic', [{ key: 'b' }, { key: 'a' }], key)).toThrow(
      'registry synthetic: row a out of order',
    );
    expect(() => assertRegistry('synthetic', [{ key: 'a' }, { key: 'a' }], key)).toThrow(
      'registry synthetic: row a duplicate',
    );
    expect(() => assertRegistry('env', envRegistry, key)).not.toThrow();
  });
});

describe('idempotency key', () => {
  it('AC-53: a subject or clientId containing ":" cannot produce the key of another pair', () => {
    expect(idemKey('a:b', 'chat.send', 'c')).not.toBe(idemKey('a', 'chat.send', 'b:c'));
    expect(idemKey('a', 'chat.send', 'b')).toBe(idemKey('a', 'chat.send', 'b'));
    expect(idemKey('alice', 'test.order', 'x').startsWith('idem:test.order:')).toBe(true);
    expect(() => idemKey('a', 'bad:method', 'c')).toThrow();
  });
});
