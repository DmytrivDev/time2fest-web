/**
 * Isolation, this worktree's half (SPEC-02 AC-12): its rows, Redis keys and mails all carry its own slug.
 * Requires the stack (postgres, redis, mailpit) up. Cleans up only its own data.
 */
import net from 'node:net';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PG_BASE, REDIS_HOST_PORT, wt } from './env';

const KEY_PREFIX = `iso:${wt.slug}:`;
const redisKey = `${wt.redisPrefix}iso:key`;
const mailTo = wt.mailAddress('iso');
const client = new pg.Client({ connectionString: `${PG_BASE}/${wt.testDatabase}` });
const redis = new Redis({ host: '127.0.0.1', port: REDIS_HOST_PORT, db: wt.redisDb, lazyConnect: true });

const CRLF = String.fromCharCode(13, 10);

function smtpSend(to: string): Promise<void> {
  // [reply code expected, command sent after it]
  const message = ['Subject: isolation', `To: ${to}`, 'From: iso@example.com', '', 'body', '.'].join(CRLF);
  const script: Array<[string, string | null]> = [
    ['220', 'EHLO localhost'],
    ['250', 'MAIL FROM:<iso@example.com>'],
    ['250', `RCPT TO:<${to}>`],
    ['250', 'DATA'],
    ['354', message],
    ['250', 'QUIT'],
    ['221', null],
  ];
  return new Promise((resolve, reject) => {
    const sock = net.connect(1025, '127.0.0.1');
    let step = 0;
    let buf = '';
    const fail = (e: Error) => {
      clearTimeout(timer);
      sock.destroy();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error('smtp timeout')), 10_000);
    sock.on('data', (d) => {
      buf += String(d);
      if (!buf.endsWith(CRLF)) return;
      const lines = buf.split(CRLF).filter((l) => l !== '');
      const last = lines[lines.length - 1] ?? '';
      if (/^\d{3}-/.test(last)) return;
      buf = '';
      const [code, next] = script[step] ?? ['', null];
      if (!last.startsWith(code)) return fail(new Error(`smtp: expected ${code}, got ${last}`));
      step += 1;
      if (next === null) {
        clearTimeout(timer);
        sock.end();
        resolve();
        return;
      }
      sock.write(next + CRLF);
    });
    sock.on('error', fail);
  });
}

beforeAll(async () => {
  await client.connect();
  await redis.connect();
});

afterAll(async () => {
  await client.query('DELETE FROM idempotency_records WHERE key LIKE $1', [`${KEY_PREFIX}%`]).catch(() => undefined);
  await redis.del(redisKey).catch(() => undefined);
  await client.end().catch(() => undefined);
  redis.disconnect();
  // Delete only this worktree's mails (Mailpit search by recipient).
  await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${mailTo}`)}`, { method: 'DELETE' }).catch(
    () => undefined,
  );
});

describe('isolation (AC-12, single worktree)', () => {
  it('database rows written by this worktree carry its slug in the key', async () => {
    for (const n of [1, 2]) {
      await client.query("INSERT INTO idempotency_records (key, status) VALUES ($1, 'done')", [`${KEY_PREFIX}${n}`]);
    }
    const rows = await client.query<{ key: string }>('SELECT key FROM idempotency_records WHERE key LIKE $1', [`iso:%`]);
    const own = rows.rows.filter((r) => r.key.startsWith(KEY_PREFIX));
    expect(own).toHaveLength(2);
    for (const r of own) expect(r.key).toContain(wt.slug);
  });

  it('SCAN of the own Redis DB returns only own-prefix keys', async () => {
    await redis.set(redisKey, '1', 'PX', 60_000);
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await redis.scan(cursor, 'MATCH', 't2f:*', 'COUNT', 500);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== '0');
    expect(keys).toContain(redisKey);
    for (const k of keys) expect(k.startsWith(wt.redisPrefix)).toBe(true);
  });

  it('a mail to this worktree address is found by its slug and only such messages', async () => {
    await smtpSend(mailTo);
    const res = await fetch(`http://127.0.0.1:8025/api/v1/search?query=${encodeURIComponent(`to:${wt.slug}`)}`);
    const body = (await res.json()) as { messages: Array<{ To: Array<{ Address: string }> }> };
    expect(body.messages.length).toBeGreaterThanOrEqual(1);
    for (const m of body.messages) {
      for (const to of m.To) expect(to.Address).toContain(wt.slug);
    }
  });
});
