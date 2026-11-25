/**
 * SPEC-10 W31 — guest merge (AC-23, AC-24, EC-2) over the real pipeline: a guest (created by the write probe) signs in
 * with a code; the registered merge handlers (a test row through `Deps.authLinks`) move its data to the account, the
 * device moves to the account, the guest is deleted; a repeated merge — the same pair, or the same guest into another
 * account — changes nothing. A throwing handler: the sign-in completes, a retry row and a `log` alarm
 * `auth/link-retry` are written.
 */
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runInAuthScope } from '../../src/auth/events';
import { linkGuest, type LinkAccountData } from '../../src/auth/merge';
import type { AuthLinkHandler } from '../../src/registries/authLinks';
import { buildAuthHarness, CookieJar, sessionOf, signIn, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
let pool: pg.Pool;
let h: AuthHarness;

/** "Data" of the test capability: guest id → owner; a move is idempotent by construction (set, not append). */
const owner = new Map<string, string>();
const calls: { from: string; to: string }[] = [];
const moving: AuthLinkHandler = {
  key: 'it-move',
  async link({ fromSubject, toSubject }) {
    calls.push({ from: fromSubject, to: toSubject });
    owner.set(fromSubject, toSubject);
  },
};
const throwing: AuthLinkHandler = {
  key: 'it-throw',
  async link() {
    throw new Error('boom');
  },
};

async function guestOf(jar: CookieJar): Promise<string> {
  const res = await writeProbe(h, { jar });
  expect(res.status).toBe(200);
  return ((await res.json()) as { value: { subject: string } }).value.subject;
}

const userRow = async (id: string) =>
  (await pool.query('SELECT is_anonymous, device_id FROM users WHERE id = $1', [id])).rows[0] as { is_anonymous: boolean | null; device_id: string | null } | undefined;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis);
});

beforeEach(() => {
  calls.length = 0;
});

afterAll(async () => {
  await pool.query('DELETE FROM auth_link_retries WHERE created_at >= $1', [started]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:link:');
  await redis.deleteByPrefix('auth:rl:');
  await redis.close();
});

describe('AC-23 / EC-2: guest merge', () => {
  it('code sign-in of a guest: handler moves the data, device on the account, guest gone; repeats change nothing', { timeout: 60_000 }, async () => {
    h.deps.authLinks = [moving];
    const jar = new CookieJar();
    const guest = await guestOf(jar);
    const device = jar.get('__Host-t2f_device');
    expect((await userRow(guest))?.is_anonymous).toBe(true);

    expect((await signIn(h, redis, jar, testEmail('merge'))).status).toBe(200);
    const account = (await sessionOf(h, jar)).user?.id ?? '';
    expect(account).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls).toEqual([{ from: guest, to: account }]);
    expect(owner.get(guest)).toBe(account);
    expect(await userRow(guest)).toBeUndefined();
    expect((await userRow(account))?.device_id).toBe(device);
    expect((await pool.query('SELECT count(*)::int AS n FROM user_sessions WHERE user_id = $1', [guest])).rows[0]).toEqual({ n: 0 });

    // The same merge again (same pair), and the same guest into another account (EC-2): no handler call, no change.
    const context = (await h.wiring.instance().$context) as unknown as LinkAccountData['ctx']['context'];
    const data = (to: string): LinkAccountData => ({
      anonymousUser: { user: { id: guest, isAnonymous: true, deviceId: device }, session: {} },
      newUser: { user: { id: to, isAnonymous: false }, session: {} },
      ctx: { context },
    });
    await runInAuthScope(h.deps, () => linkGuest(data(account)));
    const other = new CookieJar();
    expect((await signIn(h, redis, other, testEmail('merge-other'))).status).toBe(200);
    const otherId = (await sessionOf(h, other)).user?.id ?? '';
    await runInAuthScope(h.deps, () => linkGuest(data(otherId)));
    expect(calls).toEqual([{ from: guest, to: account }]);
    expect(owner.get(guest)).toBe(account);
  });

  it('guards: the same id or an anonymous target is not a merge', async () => {
    h.deps.authLinks = [moving];
    const context = (await h.wiring.instance().$context) as unknown as LinkAccountData['ctx']['context'];
    await runInAuthScope(h.deps, () =>
      linkGuest({ anonymousUser: { user: { id: 'g-same' }, session: {} }, newUser: { user: { id: 'g-same' }, session: {} }, ctx: { context } }),
    );
    await runInAuthScope(h.deps, () =>
      linkGuest({ anonymousUser: { user: { id: 'g-a' }, session: {} }, newUser: { user: { id: 'g-b', isAnonymous: true }, session: {} }, ctx: { context } }),
    );
    expect(calls).toEqual([]);
  });
});

describe('AC-24: a throwing handler', () => {
  it('the sign-in completes; a retry row and a log alarm auth/link-retry {handler} are written', { timeout: 60_000 }, async () => {
    h.deps.authLinks = [throwing];
    const jar = new CookieJar();
    const guest = await guestOf(jar);
    const signed = await signIn(h, redis, jar, testEmail('merge-throw'));
    expect(signed.status).toBe(200);
    const account = (await sessionOf(h, jar)).user?.id ?? '';
    expect(account).toMatch(/^[0-9a-f-]{36}$/);
    expect(await userRow(guest)).toBeUndefined();

    const retries = (
      await pool.query('SELECT user_id, from_subject, handler, attempts::int AS attempts FROM auth_link_retries WHERE user_id = $1', [account])
    ).rows;
    expect(retries).toEqual([{ user_id: account, from_subject: guest, handler: 'it-throw', attempts: 1 }]);
    const alarm = await waitFor(async () => {
      const rows = (
        await pool.query(`SELECT details FROM log_alarms WHERE source = 'auth' AND code = 'auth/link-retry' AND raised_at >= $1`, [started])
      ).rows as { details: { handler?: string } | null }[];
      return rows.find((r) => r.details?.handler === 'it-throw');
    }, 5_000);
    expect(alarm).toBeDefined();
  });
});
