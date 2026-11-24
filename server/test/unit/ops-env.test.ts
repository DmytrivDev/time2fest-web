/** SPEC-13b AC-67, AC-14 (env half), AC-13 (test class), NFR-4: ops env names, production requirements, masking. */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadEnv, telegramDisabledReason } from '../../src/platform/env';
import { createLogger } from '../../src/platform/logger';
import { envRegistry } from '../../src/registries/env';

const TOKEN = 'test-telegram-token-not-real'; // check-secrets: allow test fake
const BACKUP_KEY = randomBytes(32).toString('base64');
const OPS = ['T2F_BACKUP_KEY', 'T2F_TELEGRAM_API_BASE', 'T2F_TELEGRAM_BOT_TOKEN', 'T2F_TELEGRAM_CHAT_ID', 'T2F_TELEGRAM_TEST_CHAT_ID'];
const PROD_REQUIRED = ['T2F_TELEGRAM_BOT_TOKEN', 'T2F_TELEGRAM_CHAT_ID', 'T2F_BACKUP_KEY'];

const shared = {
  PAYLOAD_SECRET: randomBytes(24).toString('hex'),
  REDIS_URL: 'redis://127.0.0.1:6380/5',
};

/** A valid raw env of each class with every variable that class requires, the ops ones excluded. */
function rawEnv(cls: 'test' | 'rehearsal' | 'production', over: Record<string, string | undefined> = {}) {
  const team = 'https://t2f-test.invalid';
  const deployed = {
    T2F_EDGE_SECRET: randomBytes(24).toString('hex'),
    T2F_CENTRIFUGO_API_KEY: randomBytes(24).toString('hex'),
    T2F_CENTRIFUGO_TOKEN_SECRET: randomBytes(24).toString('hex'),
    T2F_ACCESS_TEAM_DOMAIN: team,
    T2F_ACCESS_AUD: 'aud',
    T2F_ACCESS_JWKS_URL: `${team}/cdn-cgi/access/certs`,
    T2F_OWNER_EMAILS: 'owner@example.com',
    T2F_R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
    T2F_R2_ACCESS_KEY_ID: 'key-id',
    T2F_R2_SECRET_ACCESS_KEY: randomBytes(16).toString('hex'),
  };
  const byClass = {
    test: { DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/t2f_spec_13b_ops_test', T2F_REDIS_PREFIX: 't2f:spec_13b_ops:' },
    rehearsal: {
      ...deployed,
      DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_rehearsal',
      T2F_REDIS_PREFIX: 't2f:rehearsal:',
      T2F_ADMIN_HOST: 'admin-rehearsal.time2fest.com',
      T2F_R2_BUCKET: 'time2fest-rehearsal',
      T2F_R2_PREFIX: 'rehearsal/',
    },
    production: {
      ...deployed,
      DATABASE_URI: 'postgres://t2f@postgres:5432/t2f_production',
      T2F_REDIS_PREFIX: 't2f:production:',
      T2F_ADMIN_HOST: 'admin.time2fest.com',
      T2F_R2_BUCKET: 'time2fest-prod',
      T2F_R2_PREFIX: 'prod/',
      T2F_ALLOWED_ORIGINS: 'https://time2fest.com',
    },
  };
  return { ...shared, ...byClass[cls], T2F_ENV: cls, ...over };
}

const prodOps = { T2F_TELEGRAM_BOT_TOKEN: TOKEN, T2F_TELEGRAM_CHAT_ID: '-1001234567890', T2F_BACKUP_KEY: BACKUP_KEY };

describe('ops env (SPEC-13b)', () => {
  it('AC-67: block `ops` holds the five names, sorted, secrets flagged, three required in production only', () => {
    const block = envRegistry.find((b) => b.key === 'ops');
    expect(block?.vars.map((v) => v.name)).toEqual(OPS);
    const byName = new Map(block?.vars.map((v) => [v.name, v]));
    expect(byName.get('T2F_TELEGRAM_BOT_TOKEN')?.secret).toBe(true);
    expect(byName.get('T2F_BACKUP_KEY')?.secret).toBe(true);
    for (const n of OPS) expect(byName.get(n)?.requiredIn ?? [], n).toEqual(PROD_REQUIRED.includes(n) ? ['production'] : []);
  });

  it('AC-14: production without each of the three refuses, naming it', () => {
    expect(loadEnv(rawEnv('production', prodOps), envRegistry)).toMatchObject({ ok: true, class: 'production' });
    expect(loadEnv(rawEnv('production'), envRegistry)).toEqual({ ok: false, failing: PROD_REQUIRED.slice().sort((a, b) => OPS.indexOf(a) - OPS.indexOf(b)) });
    for (const name of PROD_REQUIRED) {
      expect(loadEnv(rawEnv('production', { ...prodOps, [name]: undefined }), envRegistry), name).toEqual({ ok: false, failing: [name] });
      expect(loadEnv(rawEnv('production', { ...prodOps, [name]: '' }), envRegistry), name).toEqual({ ok: false, failing: [name] });
    }
  });

  it.each(['test', 'rehearsal'] as const)('AC-14: %s starts without any ops variable', (cls) => {
    expect(loadEnv(rawEnv(cls), envRegistry)).toMatchObject({ ok: true, class: cls });
  });

  it('the backup key must be base64 of exactly 32 bytes', () => {
    for (const bad of [randomBytes(16).toString('base64'), randomBytes(33).toString('base64'), 'not base64 at all', `${BACKUP_KEY.slice(0, -2)}!=`]) {
      expect(loadEnv(rawEnv('rehearsal', { T2F_BACKUP_KEY: bad }), envRegistry), bad).toEqual({ ok: false, failing: ['T2F_BACKUP_KEY'] });
    }
    expect(loadEnv(rawEnv('rehearsal', { T2F_BACKUP_KEY: BACKUP_KEY }), envRegistry).ok).toBe(true);
  });

  it('chat ids are integers or @channel names; the API base is a URL', () => {
    for (const id of ['-1001234567890', '123456', '@t2f_alarms']) {
      expect(loadEnv(rawEnv('rehearsal', { T2F_TELEGRAM_TEST_CHAT_ID: id }), envRegistry).ok, id).toBe(true);
    }
    expect(loadEnv(rawEnv('rehearsal', { T2F_TELEGRAM_CHAT_ID: 'owner chat' }), envRegistry)).toEqual({ ok: false, failing: ['T2F_TELEGRAM_CHAT_ID'] });
    expect(loadEnv(rawEnv('rehearsal', { T2F_TELEGRAM_API_BASE: 'not a url' }), envRegistry)).toEqual({ ok: false, failing: ['T2F_TELEGRAM_API_BASE'] });
  });

  it('AC-13: in test a non-loopback Telegram base switches the sink off, never a refusal', () => {
    const off = loadEnv(rawEnv('test', { T2F_TELEGRAM_API_BASE: 'https://api.telegram.org' }), envRegistry);
    expect(off).toMatchObject({ ok: true, class: 'test', telegramDisabledReason: 'non-loopback' });
    for (const base of ['http://127.0.0.1:41234', 'http://localhost:41234', 'http://[::1]:41234']) {
      const r = loadEnv(rawEnv('test', { T2F_TELEGRAM_API_BASE: base }), envRegistry);
      expect(r.ok && r.telegramDisabledReason, base).toBeUndefined();
    }
    expect(telegramDisabledReason({}, 'test')).toBeUndefined();
    for (const cls of ['rehearsal', 'production'] as const) {
      expect(telegramDisabledReason({ T2F_TELEGRAM_API_BASE: 'https://api.telegram.org' }, cls)).toBeUndefined();
    }
  });

  it('NFR-4: the token and the backup key are masked by the logger', () => {
    const r = loadEnv(rawEnv('production', prodOps), envRegistry);
    if (!r.ok) throw new Error('expected a valid env');
    expect(r.secrets).toEqual(expect.arrayContaining([TOKEN, BACKUP_KEY]));
    const lines: string[] = [];
    const logger = createLogger(r.secrets, { clock: { now: () => 0 }, write: (l: string) => lines.push(l) });
    logger.error({ event: 'probe', note: `token ${TOKEN} key ${BACKUP_KEY}` });
    const out = lines.join('\n');
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(BACKUP_KEY);
    expect(out).toContain('probe');
  });
});
