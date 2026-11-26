/**
 * SPEC-14 W34 - guest → account merge of the passport through the real sign-in (the `authLinks` row `stamps`):
 * guest 4 stamps + account 2 (1 shared) → 5, the shared one is the earlier issued; proofs, achievements and the
 * old-moment journal move; a second run for the pair changes nothing (AC-44); the internal event `passport.merged`
 * carries only merge-born keys, one per kind (highest threshold), and none without new keys (AC-45); the account's
 * channel gets a `stamp` `snapshot` of the merged season (AC-46, read from the Centrifugo channel history - that case
 * skips when Centrifugo is unreachable);
 * a throwing `stamps` row (door `rights/link-fault`) → retry row, alarm `auth/link-retry`, the session issued (AC-47).
 * Stamps are written straight into the table (their grant is covered by presence-claim / presence-grant).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { linkGuest, type LinkAccountData } from '../../src/auth/merge';
import { runInAuthScope } from '../../src/auth/scope';
import type { StoredCatalog } from '../../src/catalog/ports';
import { presenceOf } from '../../src/endpoints/deps';
import { mergeReportKeys, PASSPORT_MERGED_TOPIC } from '../../src/presence/links';
import { authLinkRegistry } from '../../src/registries/authLinks';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { buildAuthHarness, CookieJar, sessionOf, signIn, waitFor, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';
import { api, describeRealtime, name } from './realtime-support';

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14m-${run}`;
const M = Date.parse('2026-12-31T21:00:00Z');
const IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((n) => `${n}-${run}`);
const ISO = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF'];
const started = new Date();
const made: string[] = [];

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2026-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: IDS.map((_, i) => ({ zoneId: `zm${i}`, order: i + 1, midnightUtc: new Date(M).toISOString() })),
  countries: ISO.map((iso) => ({ iso, illustrationId: `ill-${iso}` })),
  cities: IDS.map((_, i) => ({ cityId: `cm${i}`, countryIso: ISO[i]!, zoneId: `zm${i}`, name: { uk: `City ${i}` } })),
  events: IDS.map((eventId, i) => ({ eventId, countryIso: ISO[i]!, cityId: `cm${i}`, zoneId: `zm${i}`, midnightUtc: new Date(M).toISOString(), slot: 'midnight' })),
  traditions: [],
};
const live = IDS.map((eventId, i) => ({ eventId, zoneId: `zm${i}`, moment: M, nonMidnight: false, hidden: false }));

let pool: pg.Pool;
let h: AuthHarness;

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
async function signInAs(jar: CookieJar, email: string): Promise<string> {
  expect((await signIn(h, redis, jar, email)).status).toBe(200);
  const id = (await sessionOf(h, jar)).user?.id ?? '';
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  made.push(id);
  return id;
}
const email = (label: string) => testEmail(`pm-${label}-${run}`);

/** A stamp row of `subject` for event index `i`, issued at `issued`, marked by `kind`. */
async function putStamp(subject: string, i: number, issued: number, kind: 'presence' | 'downtime' = 'presence'): Promise<void> {
  await pool.query(
    `INSERT INTO stamps (subject_id, season, event_id, granted_at, presence_source, grant_kind, issued_at) VALUES ($1, $2, $3, $4, 'tv', $5, $6)`,
    [subject, SEASON, IDS[i], String(M + 15_000), kind, String(issued)],
  );
}
const stampsOf = async (subject: string) =>
  (await pool.query<{ event_id: string; grant_kind: string; issued_at: string }>('SELECT event_id, grant_kind, issued_at FROM stamps WHERE subject_id = $1 ORDER BY event_id', [subject])).rows;
const keysOf = async (subject: string) => (await pool.query<{ key: string }>('SELECT key FROM passport_achievements WHERE subject_id = $1 ORDER BY key', [subject])).rows.map((r) => r.key);
const mergedEvents = async (subject: string) =>
  (await pool.query<{ payload: { subject: string; season: string; newKeys: string[] } }>(
    `SELECT payload FROM internal_events WHERE topic = $1 AND payload->>'subject' = $2 ORDER BY id`,
    [PASSPORT_MERGED_TOPIC, subject],
  )).rows.map((r) => r.payload);
const count = async (table: string, subject: string) => ((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE subject_id = $1`, [subject])).rows[0] as { n: number }).n;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 4 });
  h = await buildAuthHarness(redis, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => live } };
  });
  presenceOf(h.deps).clear();
  expect((await h.call('/api/_test/clock', { body: { at: M + 60_000, frozen: true } })).status).toBe(200);
}, 60_000);

afterAll(async () => {
  await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  for (const t of ['stamps', 'stamp_old_moment_log', 'presence_proofs', 'passport_achievements']) await pool.query(`DELETE FROM ${t} WHERE season = $1`, [SEASON]);
  await pool.query(`DELETE FROM internal_events WHERE topic = $1 AND payload->>'season' = $2`, [PASSPORT_MERGED_TOPIC, SEASON]);
  await pool.query('DELETE FROM auth_link_retries WHERE user_id = ANY($1::text[]) OR from_subject = ANY($1::text[])', [made]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix('auth:link:');
  await redis.deleteByPrefix('auth:rl:');
  await redis.deleteByPrefix('auth:gap:');
  await redis.close();
});

describe('merge row stamps (AC-44, AC-45, AC-47)', () => {
  it('the registry has the row stamps, sorted', () => {
    expect(authLinkRegistry.map((r) => r.key)).toEqual(['bans', 'passes', 'profile', 'stamps']);
  });

  it('mergeReportKeys: one key per kind, the highest threshold', () => {
    const s = 'S';
    expect(mergeReportKeys([`goal:${s}:countries:3`, `goal:${s}:countries:5`, `goal:${s}:zones:3`, `streak:${s}:3`, `streak:${s}:5`])).toEqual([
      `goal:${s}:countries:5`,
      `goal:${s}:zones:3`,
      `streak:${s}:5`,
    ]);
    expect(mergeReportKeys([])).toEqual([]);
  });

  it('AC-44 / AC-45: guest 4 + account 2 (1 shared) → 5, the earlier issued stays; rows move; one key per kind; a repeat changes nothing', { timeout: 60_000 }, async () => {
    const addr = email('main');
    const account = await signInAs(new CookieJar(), addr);
    const g = await guest();
    // Account: events 0, 1 (1 issued late). Guest: 1 (issued earlier, marked 'downtime'), 2, 3, 4.
    await putStamp(account, 0, M + 20_000);
    await putStamp(account, 1, M + 40_000);
    await putStamp(g.id, 1, M + 30_000, 'downtime');
    for (const i of [2, 3, 4]) await putStamp(g.id, i, M + 30_000);
    await pool.query(
      `INSERT INTO presence_proofs (subject_id, season, event_id, moment_ms, first_received_at, source) VALUES ($1, $2, $3, $4, $5, 'tv')`,
      [g.id, SEASON, IDS[2], String(M), String(M - 1_000)],
    );
    await pool.query(`INSERT INTO passport_achievements (subject_id, season, key, achieved_at) VALUES ($1, $2, $3, $4)`, [g.id, SEASON, `goal:${SEASON}:countries:3`, String(M + 30_000)]);
    await pool.query(
      `INSERT INTO stamp_old_moment_log (subject_id, season, event_id, old_moment_ms, new_moment_ms, at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [g.id, SEASON, IDS[3], String(M), String(M + 60_000), String(M + 30_000)],
    );

    expect(await signInAs(g.jar, addr)).toBe(account);

    const merged = await stampsOf(account);
    expect(merged.map((s) => s.event_id)).toEqual(IDS.slice(0, 5));
    expect(merged.find((s) => s.event_id === IDS[1])).toMatchObject({ grant_kind: 'downtime', issued_at: String(M + 30_000) });
    for (const t of ['stamps', 'presence_proofs', 'passport_achievements', 'stamp_old_moment_log']) expect(await count(t, g.id), t).toBe(0);
    expect(await count('presence_proofs', account)).toBe(1);
    expect(await count('stamp_old_moment_log', account)).toBe(1);
    // Five countries, zones 1..5 in order: every 3- and 5-key; reported: the highest per kind.
    expect(await keysOf(account)).toEqual(
      [`goal:${SEASON}:countries:3`, `goal:${SEASON}:countries:5`, `goal:${SEASON}:zones:3`, `goal:${SEASON}:zones:5`, `streak:${SEASON}:3`, `streak:${SEASON}:5`].sort(),
    );
    const events = await waitFor(async () => {
      const e = await mergedEvents(account);
      return e.length > 0 ? e : undefined;
    }, 5_000);
    expect(events).toEqual([{ subject: account, season: SEASON, newKeys: [`goal:${SEASON}:countries:5`, `goal:${SEASON}:zones:5`, `streak:${SEASON}:5`] }]);
    expect(events?.[0]?.newKeys.filter((k) => k.includes(':countries:'))).toEqual([`goal:${SEASON}:countries:5`]);

    // A second run for the pair: nothing changes, no event.
    const keys = await keysOf(account);
    const context = (await h.wiring.instance().$context) as unknown as LinkAccountData['ctx']['context'];
    await runInAuthScope(() =>
      linkGuest(
        { anonymousUser: { user: { id: g.id, isAnonymous: true, deviceId: g.device }, session: {} }, newUser: { user: { id: account, isAnonymous: false }, session: {} }, ctx: { context } },
        h.deps,
      ),
    );
    const row = authLinkRegistry.find((r) => r.key === 'stamps')!;
    await row.link({ fromSubject: g.id, toSubject: account, deps: h.deps });
    expect(await stampsOf(account)).toEqual(merged);
    expect(await keysOf(account)).toEqual(keys);
    expect(await mergedEvents(account)).toHaveLength(1);
  });

  it('AC-45: a merge without new achievements publishes no event; the account keeps its earlier stamp', { timeout: 60_000 }, async () => {
    const addr = email('none');
    const account = await signInAs(new CookieJar(), addr);
    await putStamp(account, 0, M + 20_000);
    await putStamp(account, 1, M + 20_000);
    const g = await guest();
    await putStamp(g.id, 0, M + 50_000, 'downtime');
    await signInAs(g.jar, addr);
    expect(await stampsOf(account)).toEqual([
      { event_id: IDS[0], grant_kind: 'presence', issued_at: String(M + 20_000) },
      { event_id: IDS[1], grant_kind: 'presence', issued_at: String(M + 20_000) },
    ]);
    expect(await count('stamps', g.id)).toBe(0);
    expect(await keysOf(account)).toEqual([]);
    expect(await mergedEvents(account)).toEqual([]);
  });

  it('AC-47: a throwing stamps row → retry row, alarm, session issued; the guest keeps its stamps', { timeout: 60_000 }, async () => {
    const g = await guest();
    await putStamp(g.id, 5, M + 30_000);
    expect((await h.call('/api/_test/rights/link-fault', { body: { handler: 'stamps' } })).status).toBe(200);
    const account = await signInAs(g.jar, email('fault'));
    expect((await sessionOf(h, g.jar)).user?.id).toBe(account);
    const rows = (await pool.query('SELECT handler FROM auth_link_retries WHERE user_id = $1 AND from_subject = $2', [account, g.id])).rows;
    expect(rows).toEqual([{ handler: 'stamps' }]);
    const alarm = await waitFor(async () => {
      const r = (await pool.query(`SELECT details FROM log_alarms WHERE source = 'auth' AND code = 'auth/link-retry' AND raised_at >= $1`, [started])).rows as {
        details: { handler?: string } | null;
      }[];
      return r.find((x) => x.details?.handler === 'stamps');
    }, 5_000);
    expect(alarm).toBeDefined();
    expect(await count('stamps', g.id)).toBe(1);
    expect(await count('stamps', account)).toBe(0);
  });
});

type Pub = { data?: { type?: string; data?: { kind?: string; stamps?: { eventId: string }[] } } };
const historyOf = async (channel: string): Promise<Pub[]> =>
  (((await api('history', { channel, limit: 50 })).json.result as { publications?: Pub[] } | undefined)?.publications ?? []) as Pub[];

describeRealtime('merge snapshot (AC-46)', () => {
  // The sign-in invalidates the account's open connections (SPEC-11 AC-53), so its tab reconnects and recovers the
  // envelope from the channel history: the history of `user:#<account>` is what the tab receives.
  it('`user:#<account>` gets a `stamp` snapshot with the merged stamps of the season', { timeout: 60_000 }, async () => {
    const addr = email('snap');
    const account = await signInAs(new CookieJar(), addr);
    await putStamp(account, 0, M + 20_000);
    const g = await guest();
    await putStamp(g.id, 2, M + 20_000);
    await signInAs(g.jar, addr);
    const snap = await waitFor(async () => (await historyOf(name('user', account))).find((p) => p.data?.type === 'stamp' && p.data.data?.kind === 'snapshot'), 5_000);
    expect(snap?.data?.data?.stamps?.map((s) => s.eventId).sort()).toEqual([IDS[0], IDS[2]]);
  });
});
