/**
 * SPEC-11 W38 - the owner's ban endpoints `/cms-api/bans/*` (AC-22, conductor decision 6), straight into Payload's REST
 * handler like `streams-admin.int.test.ts`: owner bans an account / a guest / a device by id (blocked, one journal row),
 * a repeated ban writes nothing more, an unknown id -> 404; unban removes the ban and its derived device bans
 * (not blocked, journal row); `content-agent` and an anonymous caller -> 403 with nothing changed.
 */
import config from '@payload-config';
import { randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import { getPayload } from 'payload';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDeps } from '../../src/container';
import { rightsOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { DEVICE_COOKIE } from '../../src/platform/device';
import { buildAuthHarness, CookieJar, sessionOf, signIn, writeProbe, type AuthHarness } from '../support/authClient';
import { testEmail } from '../support/testEmail';
import { ownRedis } from './helpers';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'bans-admin-owner@example.com';
const CONTENT = 'bans-admin-content@example.com';
const PASSWORD = 'bans-admin-password-0001'; // check-secrets: allow test fake
const redis = ownRedis();
const started = new Date();
const run = randomBytes(3).toString('hex');
type Row = Record<string, unknown> & { id: number };
type Json = { ok: boolean; value?: Record<string, unknown>; error?: { code: string } };

describe('owner ban endpoints', { timeout: 120_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let h: AuthHarness;
  let pool: pg.Pool;
  let owner: Record<string, string>;
  let content: Record<string, string>;
  const banIds: string[] = [];

  const bans = () => rightsOf(deps).bans;
  const post = (path: string, body: unknown, headers = owner) => rest('POST', path, { headers, body });
  const maxJournalId = async () => Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const rowsAfter = async (after: number) =>
    (await payload.find({ collection: 'audit-log', where: { id: { greater_than: after } }, sort: 'id', pagination: false, overrideAccess: true, depth: 0 })).docs as unknown as Row[];

  async function ban(kind: string, subjectId: string): Promise<Json> {
    const res = await post('/bans/ban', { kind, subjectId });
    expect(res.status, await res.clone().text()).toBe(200);
    const json = (await res.json()) as Json;
    banIds.push(String((json.value?.ban as { id: string }).id));
    return json;
  }

  beforeAll(async () => {
    deps = getDeps();
    expect(deps.env.class).toBe('test');
    payload = await getPayload({ config });
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
    h = await buildAuthHarness(redis);
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    const id = await makeAdmin(payload, CONTENT, PASSWORD, 'content-agent');
    const issued = await rest('POST', `/admins/${id}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    content = { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  });

  afterAll(async () => {
    if (pool) {
      await pool.query('DELETE FROM bans WHERE id = ANY($1::uuid[])', [banIds]);
      await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
      await pool.end();
    }
    if (payload) await removeAdmins(payload, [OWNER, CONTENT]);
    await redis.deleteByPrefix('auth:rl:');
    await redis.deleteByPrefix('ban:');
    await redis.close();
  });

  it('AC-22: owner bans an account, a guest and a device by id; one journal row each; repeat writes nothing', async () => {
    const jar = new CookieJar();
    expect((await signIn(h, redis, jar, testEmail(`bans-admin-${run}`))).status).toBe(200);
    const account = (await sessionOf(h, jar)).user?.id ?? '';
    const device = jar.get(DEVICE_COOKIE) ?? '';
    const probe = await writeProbe(h, { jar: new CookieJar() });
    const guest = ((await probe.json()) as { value: { subject: string } }).value.subject;

    const mark = await maxJournalId();
    const acc = await ban('account', account);
    expect(acc.value).toMatchObject({ created: true });
    await ban('guest', guest);
    await ban('device', `dev-${run}`);
    const rows = await rowsAfter(mark);
    expect(rows.map((r) => r.action)).toEqual(['rights.ban', 'rights.ban', 'rights.ban']);
    expect(rows[0]?.actor).toMatchObject({ kind: 'owner', label: OWNER });

    expect(await bans().bannedInDb(account)).toMatchObject({ blocked: true });
    expect(await bans().bannedInDb(guest)).toMatchObject({ blocked: true });
    expect(await bans().bannedInDb('someone', `dev-${run}`)).toMatchObject({ blocked: true });
    expect(await bans().bannedInDb('someone', device)).toMatchObject({ blocked: true });

    const again = await ban('account', account);
    expect(again.value).toMatchObject({ created: false });
    expect(await rowsAfter(mark)).toHaveLength(3);

    const list = (await (await rest('GET', '/bans', { headers: owner })).json()) as Json;
    const listed = (list.value?.bans as Record<string, unknown>[]).find((b) => b.id === (acc.value?.ban as { id: string }).id);
    expect(listed).toMatchObject({ kind: 'account', subjectId: account, source: 'owner' });
    expect(Number(listed?.derived)).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(list)).not.toMatch(/fp:/);

    // Unban: the ban and its derived device ban go; journal row; a second unban -> 404.
    const mark2 = await maxJournalId();
    const res = await post('/bans/unban', { banId: (acc.value?.ban as { id: string }).id });
    expect(res.status).toBe(200);
    expect((await rowsAfter(mark2)).map((r) => r.action)).toEqual(['rights.unban']);
    expect(await bans().bannedInDb(account)).toEqual({ blocked: false });
    expect(await bans().bannedInDb('someone', device)).toEqual({ blocked: false });
    expect((await post('/bans/unban', { banId: (acc.value?.ban as { id: string }).id })).status).toBe(404);
  });

  it('unknown account / guest id -> 404 with nothing written; bad bodies -> 400', async () => {
    const mark = await maxJournalId();
    expect((await post('/bans/ban', { kind: 'account', subjectId: '00000000-0000-4000-8000-000000000000' })).status).toBe(404);
    expect((await post('/bans/ban', { kind: 'guest', subjectId: '00000000-0000-4000-8000-000000000001' })).status).toBe(404);
    expect((await post('/bans/ban', { kind: 'nope', subjectId: 'x' })).status).toBe(400);
    expect((await post('/bans/unban', { banId: 'not-a-uuid' })).status).toBe(400);
    expect(await rowsAfter(mark)).toHaveLength(0);
  });

  it('AC-22: content-agent and an anonymous caller get 403; nothing changes', async () => {
    const mark = await maxJournalId();
    const before = (await bans().list()).length;
    for (const headers of [content, {} as Record<string, string>]) {
      expect((await rest('GET', '/bans', { headers })).status).toBe(403);
      expect((await post('/bans/ban', { kind: 'device', subjectId: `x-${run}` }, headers)).status).toBe(403);
      expect((await post('/bans/unban', { banId: '00000000-0000-4000-8000-000000000002' }, headers)).status).toBe(403);
    }
    expect((await bans().list()).length).toBe(before);
    expect(await rowsAfter(mark)).toHaveLength(0);
  });
});
