/**
 * SPEC-11 W35 — the rights test doors (AC-62, [П-15]): each door works in `test` with doors on; each fixture name
 * yields the state it names (`get-session`, `isBlocked`, the rows); `reset` empties `passes`, `bans`, `profiles`; with
 * `T2F_TEST_DOORS` unset every rights door answers exactly like an unknown path.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher } from '../../src/container';
import { rightsOf } from '../../src/endpoints/deps';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { RIGHTS_FIXTURE_VALUES as V } from '../../src/test-doors/rights';
import { buildAuthHarness, CookieJar, freshIp, sessionOf, signIn, type AuthHarness } from '../support/authClient';
import { BASE, ownRedis, testDeps } from './helpers';

const redis = ownRedis();
const tag = randomBytes(4).toString('hex');
let pool: pg.Pool;
let h: AuthHarness;

type Json = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; reason?: string } };
async function door(path: string, body: unknown, jar?: CookieJar, ip?: string): Promise<{ status: number; json: Json }> {
  const res = await h.call(`/api/_test/rights/${path}`, { body, ...(jar ? { jar } : {}), ...(ip ? { ip } : {}) });
  return { status: res.status, json: (await res.json()) as Json };
}
const fixture = (name: string, jar = new CookieJar(), ip?: string) => door('fixture', { name }, jar, ip);
async function session(jar: CookieJar): Promise<Record<string, unknown>> {
  const res = await h.call('/api/auth/get-session', { jar });
  return ((await res.json()) as { value: Record<string, unknown> }).value;
}
const count = async (table: string) => ((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0] as { n: number }).n;
const FIXTURE_EMAILS = [V.accountEmail, V.attachedEmail, V.bannedEmail, V.mergeEmail];

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  // Leftovers of an aborted earlier run (the fixture addresses are fixed).
  await pool.query("DELETE FROM passes WHERE grant_ref LIKE 'fixture-%'");
  await pool.query('DELETE FROM profiles WHERE subject_id IN (SELECT id::text FROM users WHERE email = ANY($1))', [FIXTURE_EMAILS]);
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [FIXTURE_EMAILS]);
  h = await buildAuthHarness(redis);
});

afterAll(async () => {
  await pool.end();
  await redis.deleteByPrefix('auth:');
  await redis.deleteByPrefix('ban:');
});

describe('SPEC-11 rights doors (AC-62)', () => {
  it('pass-grant to the current device → device pass on get-session; a second pass → pass-owned; revoke', async () => {
    const jar = new CookieJar();
    const ref = `rd-${tag}-g1`;
    const g = await door('pass-grant', { holder: { device: 'current', paymentEmail: `rd-${tag}@example.com` }, source: 'purchase', grantRef: ref }, jar);
    expect(g.status).toBe(200);
    expect(g.json.value).toMatchObject({ created: true });
    expect(await session(jar)).toMatchObject({ hasPass: true, passOn: 'device', devicePass: { email: `rd-${tag}@example.com` } });
    const again = await door('pass-grant', { holder: { device: 'current', paymentEmail: `rd-${tag}@example.com` }, source: 'purchase', grantRef: `rd-${tag}-g2` }, jar);
    expect(again.status).toBe(409);
    expect(again.json.error?.reason).toBe('pass-owned');
    expect((await door('pass-grant', { holder: { device: 'current', paymentEmail: 'x@example.com' }, source: 'bogus', grantRef: `rd-${tag}-g3` }, jar)).status).toBe(400);
    expect((await door('pass-revoke', { grantRef: ref })).json.value).toMatchObject({ revoked: true });
    expect(await session(jar)).toMatchObject({ hasPass: false, passOn: null });
    expect((await door('pass-revoke', { grantRef: `rd-${tag}-none` })).status).toBe(404);
  });

  it('ban: device (current) and ip-day; a non-fingerprint ip-day subject is invalid-input', async () => {
    const jar = new CookieJar();
    const b = await door('ban', { kind: 'device', subject: 'current' }, jar);
    expect(b.status).toBe(200);
    expect((await rightsOf(h.deps).bans.isBlocked('nobody', { device: jar.get(DEVICE_COOKIE)! })).blocked).toBe(true);
    expect((await door('ban', { kind: 'ip-day', subject: 'noaddr:x' })).status).toBe(400);
    expect((await door('ban', { kind: 'ip-day', subject: 'current' })).status).toBe(200);
    expect((await door('ban', { kind: 'other', subject: 'x' })).status).toBe(400);
  });

  it('profile-seed writes the row; a nick another subject holds → conflict/taken', async () => {
    const nick = `Seed${tag}`;
    expect((await door('profile-seed', { subject: `rd-${tag}-a`, nick, flagCode: 'UA', settings: { hour12: true } })).status).toBe(200);
    const row = (await pool.query('SELECT nick, flag_code, settings FROM profiles WHERE subject_id = $1', [`rd-${tag}-a`])).rows[0];
    expect(row).toMatchObject({ nick, flag_code: 'UA', settings: { hour12: true } });
    const taken = await door('profile-seed', { subject: `rd-${tag}-b`, nick: nick.toUpperCase() });
    expect(taken.status).toBe(409);
    expect(taken.json.error?.reason).toBe('taken');
    expect((await door('profile-seed', { subject: `rd-${tag}-c`, extra: 1 })).status).toBe(400);
  });

  it('link-fault: an unknown row → 404; an armed row throws once on the next merge (retry row)', { timeout: 60_000 }, async () => {
    expect((await door('link-fault', { handler: 'nope' })).status).toBe(404);
    const jar = new CookieJar();
    const m = await fixture('merge-pair', jar);
    expect(m.status).toBe(200);
    expect((await door('link-fault', { handler: 'profile' })).status).toBe(200);
    expect((await signIn(h, redis, jar, V.mergeEmail)).status).toBe(200);
    const retries = await pool.query("SELECT 1 FROM auth_link_retries WHERE from_subject = $1 AND handler = 'profile'", [m.json.value!.guestId]);
    expect(retries.rowCount).toBe(1);
    expect(h.deps.authLinks).toBeUndefined();
  });

  it('fixtures: pass-account, pass-device, pass-attached', { timeout: 60_000 }, async () => {
    const acc = await fixture('pass-account');
    expect(acc.status).toBe(200);
    const accJar = new CookieJar();
    expect((await signIn(h, redis, accJar, V.accountEmail)).status).toBe(200);
    expect(await session(accJar)).toMatchObject({ hasPass: true, passOn: 'account' });

    const devJar = new CookieJar();
    expect((await fixture('pass-device', devJar)).status).toBe(200);
    expect(await session(devJar)).toMatchObject({ hasPass: true, passOn: 'device', devicePass: { email: V.devicePaymentEmail } });

    const attJar = new CookieJar();
    const att = await fixture('pass-attached', attJar);
    expect(att.status).toBe(200);
    const row = (await pool.query('SELECT attached_user_id::text AS a, device_id FROM passes WHERE id = $1::uuid', [att.json.value!.passId])).rows[0];
    expect(row).toEqual({ a: att.json.value!.accountId, device_id: attJar.get(DEVICE_COOKIE) });
    expect(await session(attJar)).toMatchObject({ hasPass: false }); // attached: no longer a device pass
    expect((await signIn(h, redis, attJar, V.attachedEmail)).status).toBe(200);
    expect(await session(attJar)).toMatchObject({ hasPass: true, passOn: 'account' });
  });

  it('fixtures: ban-account, ban-guest, ban-device, ban-ip-day; an unknown name → 404', { timeout: 60_000 }, async () => {
    const bans = rightsOf(h.deps).bans;
    const a = await fixture('ban-account');
    expect((await bans.isBlocked(String(a.json.value!.accountId), { subjectKind: 'account' })).blocked).toBe(true);
    const g = await fixture('ban-guest');
    expect((await bans.isBlocked(String(g.json.value!.guestId), { subjectKind: 'guest' })).blocked).toBe(true);
    const dJar = new CookieJar();
    await fixture('ban-device', dJar);
    expect((await bans.isBlocked('nobody', { device: dJar.get(DEVICE_COOKIE)! })).blocked).toBe(true);

    const ip = freshIp();
    expect((await fixture('ban-ip-day', new CookieJar(), ip)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 5)); // the block applies to a guest made strictly after the mark
    const later = new CookieJar();
    const probe = await h.call('/api/_test/auth/write-probe', { body: {}, jar: later, ip });
    const guestId = ((await probe.json()) as { value: { subject: string } }).value.subject;
    expect((await bans.isBlocked(guestId, { subjectKind: 'guest' })).blocked).toBe(true);

    expect((await fixture('nope')).status).toBe(404);
  });

  it('fixture merge-pair: the caller is the guest; sign-in merges (account nick and flag win, guest setting moves)', { timeout: 60_000 }, async () => {
    const jar = new CookieJar();
    const m = await fixture('merge-pair', jar);
    expect(m.status).toBe(200);
    expect((await sessionOf(h, jar)).guestId).toBe(m.json.value!.guestId);
    expect((await signIn(h, redis, jar, V.mergeEmail)).status).toBe(200);
    const row = (await pool.query('SELECT nick, flag_code, settings FROM profiles WHERE subject_id = $1', [m.json.value!.accountId])).rows[0] as {
      nick: string;
      flag_code: string;
      settings: Record<string, unknown>;
    };
    expect(row).toMatchObject({ nick: V.mergeAccountNick, flag_code: V.mergeAccountFlag });
    expect(row.settings.hour12).toBe(true);
  });

  it('reset empties passes, bans and profiles', { timeout: 120_000 }, async () => {
    expect((await count('passes')) + (await count('bans')) + (await count('profiles'))).toBeGreaterThan(0);
    expect((await h.call('/api/_test/reset', { body: {} })).status).toBe(200);
    for (const t of ['passes', 'bans', 'profiles']) expect(await count(t), t).toBe(0);
  });

  it('with doors off every rights door answers like an unknown path', async () => {
    const off = await buildDispatcher(testDeps({ redis }, { T2F_TEST_DOORS: undefined }));
    const post = (path: string, body: unknown) =>
      off(new Request(BASE + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    const unknown = await post('/api/_test/nope', {});
    const unknownBody = await unknown.text();
    expect(unknown.status).toBe(404);
    const rows: Array<[string, unknown]> = [
      ['ban', { kind: 'device', subject: 'current' }],
      ['fixture', { name: 'pass-device' }],
      ['link-fault', { handler: 'profile' }],
      ['pass-grant', { holder: { account: 'x' }, source: 'admin', grantRef: 'x' }],
      ['pass-revoke', { grantRef: 'x' }],
      ['profile-seed', { subject: 'x' }],
    ];
    for (const [p, body] of rows) {
      const res = await post(`/api/_test/rights/${p}`, body);
      expect(res.status, p).toBe(404);
      expect(await res.text(), p).toBe(unknownBody);
    }
  });
});
