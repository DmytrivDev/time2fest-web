/**
 * SPEC-11 W18 — bans and the daily-fingerprint block through the real pipeline (in-process dispatcher, this slot's
 * Postgres and Redis; the edge secret set, so every caller has its own `x-t2f-client` address):
 * account ban → `account`, no term, +400 days still banned (AC-18, AC-21); the account's devices now and later are
 * banned, a new guest of the device → `device` (AC-20); a subject's fingerprint is marked by the ban, a new guest from
 * it → `ip-day` until 00:00 UTC, an account and an older guest from it → not blocked (AC-23, AC-24, EC-10); the block
 * ends at 00:00 UTC, a 23:59 ban lasts a minute (AC-25, EC-11); `ban:*` keys only in Redis with a TTL ≤ the time to
 * 00:00 UTC, no IP or fingerprint in the database (AC-26, NFR-5); Redis down → DB bans only + `bans/fast-store-down`
 * (NFR-7). The service is called directly (the rights doors arrive in P11).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RedisStore } from '../../src/adapters/redis';
import { rightsOf } from '../../src/endpoints/deps';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { DependencyUnavailable } from '../../src/ports';
import { buildAuthHarness, CookieJar, freshIp, sessionOf, signIn, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
const by = `test-${randomBytes(3).toString('hex')}`;
const DAY = 86_400_000;
let pool: pg.Pool;
let h: AuthHarness;

/** The harness store: the real Redis, recording `ban:*` TTLs; `down` makes every `ban:*` call fail. */
const fast = { down: false, ttls: [] as { key: string; ttlMs: number; at: number }[] };
let now = 0;
const banKey = (key: string): boolean => key.startsWith('ban:');
function guard(key: string): void {
  if (fast.down && banKey(key)) throw new DependencyUnavailable('redis');
}
const store: RedisStore = {
  incrWindow: (k, w) => redis.incrWindow(k, w),
  decrIfPresent: (k) => redis.decrIfPresent(k),
  deleteByPrefix: (p) => redis.deleteByPrefix(p),
  close: async () => {},
  async setIfAbsent(k, v, ttl) {
    guard(k);
    if (banKey(k)) fast.ttls.push({ key: k, ttlMs: ttl, at: now });
    return redis.setIfAbsent(k, v, ttl);
  },
  async set(k, v, ttl) {
    guard(k);
    if (banKey(k)) fast.ttls.push({ key: k, ttlMs: ttl, at: now });
    return redis.set(k, v, ttl);
  },
  async get(k) {
    guard(k);
    return redis.get(k);
  },
  async del(k) {
    guard(k);
    return redis.del(k);
  },
};

const bans = () => rightsOf(h.deps).bans;
const setClock = async (at: number) => {
  now = at;
  const res = await h.call('/api/_test/clock', { body: { at, frozen: true } });
  expect(res.status).toBe(200);
};

/** A guest with a session: a write from `ip` on the jar's device (fresh jar → fresh device). */
async function guest(ip: string, jar = new CookieJar()): Promise<{ jar: CookieJar; device: string; subject: string }> {
  const res = await writeProbe(h, { jar, ip });
  expect(res.status).toBe(200);
  const subject = ((await res.json()) as { value: { subject: string } }).value.subject;
  return { jar, device: jar.get(DEVICE_COOKIE) ?? '', subject };
}

async function account(label: string, jar = new CookieJar()): Promise<{ jar: CookieJar; id: string; device: string }> {
  const email = testEmail(`${label}-${randomBytes(2).toString('hex')}`);
  expect((await signIn(h, redis, jar, email)).status).toBe(200);
  const id = (await sessionOf(h, jar)).user?.id ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return { jar, id, device: jar.get(DEVICE_COOKIE) ?? '' };
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(store as RedisStore);
  await setClock(Date.parse('2026-12-10T12:00:00Z'));
});

afterAll(async () => {
  fast.down = false;
  await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  await pool.query('DELETE FROM bans WHERE created_by = $1', [by]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('ban:');
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.close();
});

describe('account ban (AC-18, AC-20, AC-21)', () => {
  it('account → no term; its device and a later device are banned; a new guest of the device → device', { timeout: 60_000 }, async () => {
    const a = await account('ban-acc');
    const { ban, created } = await bans().ban({ kind: 'account', subject: a.id, by, reasonCode: 'spam' });
    expect(created).toBe(true);
    expect(await bans().ban({ kind: 'account', subject: a.id, by })).toMatchObject({ created: false, ban: { id: ban.id } });
    expect(await bans().isBlocked(a.id, { subjectKind: 'account', device: a.device })).toEqual({ blocked: true, kind: 'account', until: null });

    const derived = await pool.query(`SELECT subject_id FROM bans WHERE kind = 'device' AND source_ban_id = $1`, [ban.id]);
    expect(derived.rows.map((r) => r.subject_id)).toContain(a.device);

    // Sign out → a new guest on the same device is banned through the device.
    expect((await h.call('/api/auth/sign-out', { method: 'POST', body: {}, jar: a.jar })).status).toBe(200);
    const g = await guest(freshIp(), a.jar);
    expect(g.device).toBe(a.device);
    expect(g.subject).not.toBe(a.id);
    expect(await bans().isBlocked(g.subject, { subjectKind: 'guest', device: g.device })).toEqual({ blocked: true, kind: 'device', until: null });

    // A later session of the account on another device bans that device too.
    const other = new CookieJar();
    await guest(freshIp(), other);
    const again = await account('ban-acc-2', other);
    expect(again.device).not.toBe(a.device);
    const otherDevice = again.device;
    // Same account: sign the original address in on the new device.
    const email = (await pool.query('SELECT email FROM users WHERE id = $1::uuid', [a.id])).rows[0]?.email as string;
    const jar3 = new CookieJar();
    await guest(freshIp(), jar3);
    expect((await signIn(h, redis, jar3, email)).status).toBe(200);
    const device3 = jar3.get(DEVICE_COOKIE) ?? '';
    const later = await waitFor(async () => {
      const r = await pool.query(`SELECT 1 FROM bans WHERE kind = 'device' AND subject_id = $1 AND source_ban_id = $2`, [device3, ban.id]);
      return r.rowCount ? true : undefined;
    }, 3_000);
    expect(later).toBe(true);
    // An unrelated account's device is not banned.
    expect(await bans().isBlocked(again.id, { subjectKind: 'account', device: otherDevice })).toEqual({ blocked: false });

    // +400 days: still banned, no term.
    await setClock(now + 400 * DAY);
    expect(await bans().isBlocked(a.id, { subjectKind: 'account' })).toEqual({ blocked: true, kind: 'account', until: null });
    await setClock(Date.parse('2026-12-10T12:00:00Z'));

    // Unban removes the derived device bans as well.
    expect((await bans().unban(ban.id)).removed).toBe(true);
    expect((await pool.query('SELECT 1 FROM bans WHERE id = $1::uuid OR source_ban_id = $1::uuid', [ban.id])).rowCount).toBe(0);
    expect(await bans().isBlocked(g.subject, { subjectKind: 'guest', device: g.device })).toEqual({ blocked: false });
  });
});

describe('daily-fingerprint block (AC-23 … AC-26, NFR-5, EC-10, EC-11)', () => {
  it('a new guest from the banned subject address → ip-day; an account and an older guest → not; ends at 00:00 UTC', { timeout: 60_000 }, async () => {
    const T = Date.parse('2026-12-10T15:00:00Z');
    await setClock(T);
    const ipA = freshIp();
    const older = await guest(ipA);
    await setClock(T + 1_000);
    const s = await guest(ipA);
    await setClock(T + 2_000);
    await bans().ban({ kind: 'guest', subject: s.subject, by });
    expect(await bans().isBlocked(s.subject, { subjectKind: 'guest', device: s.device })).toEqual({ blocked: true, kind: 'guest', until: null });

    await setClock(T + 3_000);
    const fresh = await guest(ipA);
    const midnight = Date.parse('2026-12-11T00:00:00Z');
    expect(await bans().isBlocked(fresh.subject, { subjectKind: 'guest', device: fresh.device })).toEqual({ blocked: true, kind: 'ip-day', until: midnight });
    // Another address is not blocked.
    const elsewhere = await guest(freshIp());
    expect(await bans().isBlocked(elsewhere.subject, { subjectKind: 'guest', device: elsewhere.device })).toEqual({ blocked: false });
    // The older guest from the same address is not blocked (EC-10).
    expect(await bans().isBlocked(older.subject, { subjectKind: 'guest', device: older.device })).toEqual({ blocked: false });
    // An account writing from the same address is not blocked.
    const acc = await account('ipday-acc');
    expect((await writeProbe(h, { jar: acc.jar, ip: ipA })).status).toBe(200);
    expect(await bans().isBlocked(acc.id, { subjectKind: 'account', device: acc.device })).toEqual({ blocked: false });

    // TTL of every ban:* key ≤ the time to the next 00:00 UTC of its write.
    const written = fast.ttls.filter((t) => t.at >= T);
    expect(written.length).toBeGreaterThan(0);
    for (const t of written) expect(t.ttlMs).toBeLessThanOrEqual(Date.parse('2026-12-11T00:00:00Z') - t.at);

    // Past 00:00 UTC the fingerprint changes: a new guest from the address is not blocked.
    await setClock(midnight + 1_000);
    const nextDay = await guest(ipA);
    expect(await bans().isBlocked(nextDay.subject, { subjectKind: 'guest', device: nextDay.device })).toEqual({ blocked: false });
    // The banned guest itself stays banned.
    expect(await bans().isBlocked(s.subject, { subjectKind: 'guest' })).toMatchObject({ blocked: true, kind: 'guest' });
  });

  it('a banned subject marks each new fingerprint it writes from (AC-23)', { timeout: 60_000 }, async () => {
    const T = Date.parse('2026-12-12T10:00:00Z');
    await setClock(T);
    const s = await guest(freshIp());
    await bans().ban({ kind: 'guest', subject: s.subject, by });
    await setClock(T + 1_000);
    const ipB = freshIp();
    expect((await writeProbe(h, { jar: s.jar, ip: ipB })).status).toBe(200);
    await setClock(T + 2_000);
    const fresh = await guest(ipB);
    expect(await bans().isBlocked(fresh.subject, { subjectKind: 'guest', device: fresh.device })).toMatchObject({ blocked: true, kind: 'ip-day' });
  });

  it('a ban at 23:59 UTC blocks by fingerprint for one minute (EC-11)', { timeout: 60_000 }, async () => {
    const T = Date.parse('2026-12-13T23:59:00Z');
    const midnight = Date.parse('2026-12-14T00:00:00Z');
    await setClock(T);
    const ip = freshIp();
    const s = await guest(ip);
    await setClock(T + 500);
    fast.ttls = [];
    await bans().ban({ kind: 'guest', subject: s.subject, by });
    await setClock(T + 1_000);
    const fresh = await guest(ip);
    expect(await bans().isBlocked(fresh.subject, { subjectKind: 'guest', device: fresh.device })).toEqual({ blocked: true, kind: 'ip-day', until: midnight });
    expect(fast.ttls.length).toBeGreaterThan(0);
    for (const t of fast.ttls) expect(t.ttlMs).toBeLessThanOrEqual(60_000);
    await setClock(midnight);
    const after = await guest(ip);
    expect(await bans().isBlocked(after.subject, { subjectKind: 'guest', device: after.device })).toEqual({ blocked: false });
  });

  it('no IP or fingerprint in the database (AC-26)', async () => {
    const cols = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_name IN ('bans', 'profiles', 'passes') AND (column_name ~ '(^|_)(ip|fp)($|_)' OR column_name ~ 'fingerprint|address')`,
    );
    expect(cols.rows.filter((r) => r.column_name !== 'payment_email')).toEqual([]);
    for (const table of ['bans', 'profiles', 'passes']) {
      const rows = await pool.query(`SELECT count(*)::int AS n FROM ${table} t WHERE row_to_json(t)::text ~ '(fp:[0-9a-f]{16}|ban:)'`);
      expect(rows.rows[0].n, table).toBe(0);
    }
  });
});

describe('Redis down (NFR-7)', () => {
  it('account ban still blocks, ip-day does not, alarm bans/fast-store-down', { timeout: 60_000 }, async () => {
    const T = Date.parse('2026-12-15T10:00:00Z');
    await setClock(T);
    const a = await account('ban-down');
    await bans().ban({ kind: 'account', subject: a.id, by });
    const ip = freshIp();
    const s = await guest(ip);
    await setClock(T + 1_000);
    await bans().ban({ kind: 'guest', subject: s.subject, by });
    await setClock(T + 2_000);
    const fresh = await guest(ip);
    expect(await bans().isBlocked(fresh.subject, { subjectKind: 'guest', device: fresh.device })).toMatchObject({ kind: 'ip-day' });

    const since = new Date();
    fast.down = true;
    try {
      expect(await bans().isBlocked(a.id, { subjectKind: 'account' })).toEqual({ blocked: true, kind: 'account', until: null });
      expect(await bans().isBlocked(fresh.subject, { subjectKind: 'guest', device: fresh.device })).toEqual({ blocked: false });
      // A request still goes through while the marks cannot be written.
      expect((await writeProbe(h, { jar: fresh.jar, ip: freshIp() })).status).toBe(200);
    } finally {
      fast.down = false;
    }
    const alarm = await waitFor(async () => {
      const r = await pool.query(`SELECT source FROM log_alarms WHERE source = 'bans' AND code = 'bans/fast-store-down' AND raised_at >= $1`, [since]);
      return r.rows[0] as { source: string } | undefined;
    }, 3_000);
    expect(alarm).toBeDefined();
  });
});
