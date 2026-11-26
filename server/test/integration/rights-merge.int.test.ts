/**
 * SPEC-11 W28 — guest → account merge of the rights rows (`bans`, `passes`, `profile`) through the real sign-in:
 * a banned guest → the account is banned (AC-19); profile merge, account field wins, the guest's nick moves or is
 * released (AC-51); schedules: account first, then guest countries while the zone has room (AC-52, EC-7 rule); a
 * throwing `profile` row → guest kept, retry row, alarm (AC-49); a device pass left unattached (the account has its
 * own) → guest kept (AC-49); a second `linkGuest` for the pair changes nothing; both ids invalidated (AC-53).
 * The catalog is stubbed (zone Z5 with six countries, one event each); realtime publish/invalidate are spies.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkGuest, type LinkAccountData } from '../../src/auth/merge';
import { runInAuthScope } from '../../src/auth/scope';
import type { StoredCatalog } from '../../src/catalog/ports';
import { rightsOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { authLinkRegistry } from '../../src/registries/authLinks';
import { buildAuthHarness, CookieJar, sessionOf, signIn, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';

const redis = ownRedis();
const started = new Date();
const tag = randomBytes(4).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;
const made: string[] = [];
const invalidated: string[] = [];
const published: { key: string; type: string }[] = [];

const COUNTRIES = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF'];
const stored = (): StoredCatalog => ({
  season: null,
  zones: [{ zoneId: 'Z5' }],
  countries: COUNTRIES.map((iso) => ({ iso })),
  cities: COUNTRIES.map((iso) => ({ cityId: `c-${iso}`, zoneId: 'Z5', countryIso: iso })),
  events: COUNTRIES.map((iso) => ({ eventId: `${iso.toLowerCase()}1`, zoneId: 'Z5', countryIso: iso })),
  traditions: [],
});

interface Guest {
  jar: CookieJar;
  id: string;
  device: string;
}
async function guest(): Promise<Guest> {
  const jar = new CookieJar();
  const res = await writeProbe(h, { jar });
  expect(res.status).toBe(200);
  const id = ((await res.json()) as { value: { subject: string } }).value.subject;
  made.push(id);
  return { jar, id, device: jar.get(DEVICE_COOKIE) ?? '' };
}
/** Signs `jar` in as `email`; returns the account id. */
async function signInAs(jar: CookieJar, email: string): Promise<string> {
  expect((await signIn(h, redis, jar, email)).status).toBe(200);
  const id = (await sessionOf(h, jar)).user?.id ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  made.push(id);
  return id;
}
const email = (label: string) => testEmail(`rm-${label}-${tag}`);
const userRow = async (id: string) => (await pool.query('SELECT is_anonymous FROM users WHERE id::text = $1', [id])).rows[0] as { is_anonymous: boolean } | undefined;
const sessionsOf = async (id: string) => ((await pool.query('SELECT count(*)::int AS n FROM user_sessions WHERE user_id::text = $1', [id])).rows[0] as { n: number }).n;
const profileOf = async (id: string) =>
  (await pool.query('SELECT nick, nick_key, flag_code, settings, schedule FROM profiles WHERE subject_id = $1', [id])).rows[0] as
    | { nick: string | null; nick_key: string | null; flag_code: string | null; settings: Record<string, unknown>; schedule: string[] }
    | undefined;
async function putProfile(id: string, p: { nick?: string | null; flag?: string | null; settings?: Record<string, unknown>; schedule?: string[] }): Promise<void> {
  await pool.query(
    `INSERT INTO profiles (subject_id, nick, nick_key, flag_code, settings, schedule, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6::text[], now())`,
    [id, p.nick ?? null, p.nick ? p.nick.toLowerCase() : null, p.flag ?? null, JSON.stringify(p.settings ?? {}), p.schedule ?? []],
  );
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis, (deps: Deps) => {
    deps.catalogStore = { read: async () => stored() };
    const base = deps.realtime;
    deps.realtime = {
      ...(base ?? { random: {} as never, prefix: '' }),
      publisher: {
        ...(base?.publisher ?? {}),
        publish: async (_cls: string, key: string, envelope: { type: string }) => {
          published.push({ key, type: envelope.type });
          return { status: 'ok' };
        },
      } as never,
      invalidator: {
        invalidate: async (id: string) => {
          invalidated.push(id);
          return 'ok' as const;
        },
      },
    };
  });
});

afterAll(async () => {
  await pool.query('DELETE FROM auth_link_retries WHERE user_id = ANY($1::text[]) OR from_subject = ANY($1::text[])', [made]);
  await pool.query('DELETE FROM profiles WHERE subject_id = ANY($1::text[])', [made]);
  await pool.query('DELETE FROM bans WHERE subject_id = ANY($1::text[])', [made]);
  await pool.query('DELETE FROM passes WHERE grant_ref LIKE $1', [`rm-${tag}-%`]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:link:');
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.close();
});

describe('merge rows bans / passes / profile', () => {
  it('registry rows are bans, passes, profile', () => {
    expect(authLinkRegistry.map((r) => r.key)).toEqual(['bans', 'passes', 'profile']);
  });

  it('AC-19: a banned guest → the account is banned; guest gone, both ids invalidated (AC-49, AC-53)', { timeout: 60_000 }, async () => {
    const g = await guest();
    await rightsOf(h.deps).bans.ban({ kind: 'guest', subject: g.id, by: 'it' });
    invalidated.length = 0;
    const account = await signInAs(g.jar, email('ban'));
    const ban = (await pool.query(`SELECT created_by FROM bans WHERE kind = 'account' AND subject_id = $1`, [account])).rows;
    expect(ban).toEqual([{ created_by: 'merge' }]);
    expect(await userRow(g.id)).toBeUndefined();
    expect(await sessionsOf(g.id)).toBe(0);
    // The guest's own ban row goes with it.
    expect((await pool.query(`SELECT count(*)::int AS n FROM bans WHERE kind = 'guest' AND subject_id = $1`, [g.id])).rows[0]).toEqual({ n: 0 });
    expect(invalidated).toEqual(expect.arrayContaining([g.id, account]));
  });

  it('AC-51 / AC-52: guest nick moves to an account without one; schedule = account + guest countries (4 max); a repeat changes nothing', { timeout: 60_000 }, async () => {
    const addr = email('nick-move');
    const account = await signInAs(new CookieJar(), addr);
    await putProfile(account, { schedule: ['aa1', 'bb1', 'cc1'], settings: { a: 1 } });
    const g = await guest();
    const nick = `Gm${tag}`;
    await putProfile(g.id, { nick, flag: 'PL', settings: { a: 2, b: 3 }, schedule: ['dd1', 'ee1'] });
    published.length = 0;
    expect(await signInAs(g.jar, addr)).toBe(account);

    const p = await profileOf(account);
    expect(p).toMatchObject({ nick, nick_key: nick.toLowerCase(), flag_code: 'PL', settings: { a: 1, b: 3 } });
    expect(p?.schedule).toEqual(['aa1', 'bb1', 'cc1', 'dd1']);
    expect(await profileOf(g.id)).toBeUndefined();
    expect(await userRow(g.id)).toBeUndefined();
    expect(published).toContainEqual({ key: account, type: 'profile' });

    // AC-53: the same pair again — all claims taken, nothing changes, nothing invalidated.
    invalidated.length = 0;
    const context = (await h.wiring.instance().$context) as unknown as LinkAccountData['ctx']['context'];
    await runInAuthScope(() =>
      linkGuest(
        { anonymousUser: { user: { id: g.id, isAnonymous: true, deviceId: g.device }, session: {} }, newUser: { user: { id: account, isAnonymous: false }, session: {} }, ctx: { context } },
        h.deps,
      ),
    );
    expect(await profileOf(account)).toEqual(p);
    expect(invalidated).toEqual([]);
  });

  it('AC-51: an account with a nick keeps it; the guest nick is released', { timeout: 60_000 }, async () => {
    const addr = email('nick-keep');
    const account = await signInAs(new CookieJar(), addr);
    const own = `Am${tag}`;
    await putProfile(account, { nick: own });
    const g = await guest();
    const theirs = `Gk${tag}`;
    await putProfile(g.id, { nick: theirs, flag: 'UA' });
    await signInAs(g.jar, addr);
    expect(await profileOf(account)).toMatchObject({ nick: own, nick_key: own.toLowerCase(), flag_code: 'UA' });
    expect((await pool.query('SELECT count(*)::int AS n FROM profiles WHERE nick_key = $1', [theirs.toLowerCase()])).rows[0]).toEqual({ n: 0 });
  });

  it('AC-49: a throwing profile row → guest kept without sessions, retry row, alarm', { timeout: 60_000 }, async () => {
    h.deps.authLinks = authLinkRegistry.map((r) =>
      r.key === 'profile'
        ? {
            key: 'profile',
            async link() {
              throw new Error('boom');
            },
          }
        : r,
    );
    try {
      const g = await guest();
      const account = await signInAs(g.jar, email('throw'));
      expect((await userRow(g.id))?.is_anonymous).toBe(true);
      expect(await sessionsOf(g.id)).toBe(0);
      const rows = (await pool.query('SELECT handler FROM auth_link_retries WHERE user_id = $1 AND from_subject = $2', [account, g.id])).rows;
      expect(rows).toEqual([{ handler: 'profile' }]);
      const alarm = await waitFor(async () => {
        const r = (await pool.query(`SELECT details FROM log_alarms WHERE source = 'auth' AND code = 'auth/link-retry' AND raised_at >= $1`, [started])).rows as {
          details: { handler?: string } | null;
        }[];
        return r.find((x) => x.details?.handler === 'profile');
      }, 5_000);
      expect(alarm).toBeDefined();
    } finally {
      delete h.deps.authLinks;
    }
  });

  it('AC-49 / AC-8: the account has its own pass → the device pass stays unattached and keeps the guest', { timeout: 60_000 }, async () => {
    const addr = email('own-pass');
    const account = await signInAs(new CookieJar(), addr);
    const passes = rightsOf(h.deps).passes;
    expect((await passes.grantPass({ holder: { account }, source: 'gift', grantRef: `rm-${tag}-acc` })).kind).toBe('granted');
    const g = await guest();
    expect((await passes.grantPass({ holder: { device: g.device, paymentEmail: `rm-${tag}@example.test` }, source: 'gift', grantRef: `rm-${tag}-dev` })).kind).toBe('granted');
    await signInAs(g.jar, addr);
    expect((await userRow(g.id))?.is_anonymous).toBe(true);
    expect(await sessionsOf(g.id)).toBe(0);
    const dev = (await pool.query('SELECT attached_user_id FROM passes WHERE grant_ref = $1', [`rm-${tag}-dev`])).rows[0];
    expect(dev).toEqual({ attached_user_id: null });
  });

  it('passes row: a guest device pass is attached to the new account (AC-5 via merge)', { timeout: 60_000 }, async () => {
    const g = await guest();
    const passes = rightsOf(h.deps).passes;
    expect((await passes.grantPass({ holder: { device: g.device, paymentEmail: `rm-${tag}-m@example.test` }, source: 'gift', grantRef: `rm-${tag}-m` })).kind).toBe('granted');
    const account = await signInAs(g.jar, email('merge-pass'));
    const row = (await pool.query('SELECT attached_user_id::text AS a FROM passes WHERE grant_ref = $1', [`rm-${tag}-m`])).rows[0];
    expect(row).toEqual({ a: account });
    expect(await userRow(g.id)).toBeUndefined();
  });
});
