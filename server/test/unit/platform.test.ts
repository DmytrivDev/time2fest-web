import { describe, expect, it } from 'vitest';
import { envClass, loadEnv } from '../../src/platform/env';
import { createAlarm, createLogger } from '../../src/platform/logger';
import { assertRegistry } from '../../src/platform/registry';
import { envRegistry } from '../../src/registries/env';

const SECRET = 'payload-secret-value-that-is-32-chars-long';
const clock = { now: () => 1_700_000_000_000 };

/** A valid raw environment of the given class. */
function rawEnv(over: Record<string, string | undefined> = {}) {
  return {
    T2F_ENV: 'test',
    DATABASE_URI: 'postgres://t2f:pw@localhost:5433/t2f_spec_02_server_skeleton_test',
    REDIS_URL: 'redis://localhost:6380/4',
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
    expect(loadEnv(rawEnv()).ok).toBe(true);
    const bad = 'short-secret-xyz';
    const result = loadEnv(rawEnv({ PAYLOAD_SECRET: bad }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failing).toContain('PAYLOAD_SECRET');
    expect(JSON.stringify(result)).not.toContain(bad);
  });

  it('AC-20: test class with a denylisted DATABASE_URI, and rehearsal with PAYPRO_MODE=live, are refused by name', () => {
    const denylist = ['prod-db.internal'];
    const db = loadEnv(rawEnv({ DATABASE_URI: 'postgres://u:p@PROD-DB.internal:5432/t2f' }), envRegistry, denylist);
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
    expect(loadEnv(rawEnv({ T2F_ENV: undefined }))).toEqual({ ok: false, failing: ['T2F_ALLOWED_ORIGINS'] });
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
    const env = loadEnv(rawEnv());
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
