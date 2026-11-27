/**
 * SPEC-14 W39 - the owner's presence slice endpoints `/cms-api/presence/*` (AC-19), straight into Payload's REST handler
 * like `rights-bans-admin.int.test.ts`: the owner lists the season's records and adds a manual downtime (by event and by
 * range) -> `recorded_by: owner` + one audit row each; edit / delete -> 403 `forbidden`; `content-agent` and an
 * anonymous caller -> 403 with nothing changed; bad bodies -> 400; an unknown event -> 404; a failed journal write rolls
 * the record back with it (S14-05).
 */
import config from '@payload-config';
import { randomBytes } from 'node:crypto';
import type { Payload } from 'payload';
import { createLocalReq, getPayload } from 'payload';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { ownerTx } from '../../src/admin/presenceEndpoints';
import { getDeps } from '../../src/container';
import { presenceOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'presence-admin-owner@example.com';
const CONTENT = 'presence-admin-content@example.com';
const PASSWORD = 'presence-admin-password-0001'; // check-secrets: allow test fake
const run = randomBytes(3).toString('hex');
const SEASON = `t14a-${run}`;
const EVENT = `pa-${run}`;
const MOMENT = Date.parse('2032-01-01T00:00:00Z');
type Row = Record<string, unknown> & { id: number };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON of the answers in the assertions
type Json = { ok: boolean; value?: Record<string, any>; error?: { code: string; reason?: string } };

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2031-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: [{ zoneId: 'z1', midnightUtc: new Date(MOMENT).toISOString() }],
  countries: [],
  cities: [],
  events: [{ eventId: EVENT, countryIso: 'AA', zoneId: 'z1', slot: 'midnight' }],
  traditions: [],
};

describe('owner presence endpoints', { timeout: 120_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let pool: pg.Pool;
  let owner: Record<string, string>;
  let content: Record<string, string>;
  const saved: { catalogStore: Deps['catalogStore']; live: Deps['live'] }[] = [];

  const post = (path: string, body: unknown, headers = owner) => rest('POST', path, { headers, body });
  const maxJournalId = async () => Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const rowsAfter = async (after: number) =>
    (await payload.find({ collection: 'audit-log', where: { id: { greater_than: after } }, sort: 'id', pagination: false, overrideAccess: true, depth: 0 })).docs as unknown as Row[];
  const downtimeCount = async () => Number((await pool.query('SELECT count(*) FROM presence_downtimes WHERE season = $1', [SEASON])).rows[0].count);

  beforeAll(async () => {
    deps = getDeps();
    expect(deps.env.class).toBe('test');
    saved.push({ catalogStore: deps.catalogStore, live: deps.live });
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => [{ eventId: EVENT, zoneId: 'z1', moment: MOMENT, nonMidnight: false, hidden: false }] } };
    presenceOf(deps).clear();
    payload = await getPayload({ config });
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    const id = await makeAdmin(payload, CONTENT, PASSWORD, 'content-agent');
    const issued = await rest('POST', `/admins/${id}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    content = { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  });

  afterAll(async () => {
    const s = saved[0];
    if (s) {
      deps.catalogStore = s.catalogStore;
      deps.live = s.live;
      presenceOf(deps).clear();
    }
    if (pool) {
      await pool.query('DELETE FROM presence_downtimes WHERE season = $1', [SEASON]);
      await pool.end();
    }
    if (payload) await removeAdmins(payload, [OWNER, CONTENT]);
  });

  it('AC-19: owner adds a manual downtime by event and by range: recorded_by owner, one audit row each, listed', async () => {
    const mark = await maxJournalId();
    const byEvent = await post('/presence/downtime', { eventId: EVENT, reason: 'edge outage' });
    expect(byEvent.status, await byEvent.clone().text()).toBe(200);
    const a = ((await byEvent.json()) as Json).value?.downtime;
    expect(a).toMatchObject({ kind: 'manual', eventId: EVENT, recordedBy: 'owner', reason: 'edge outage' });

    const byRange = await post('/presence/downtime', { from: MOMENT - 60_000, to: MOMENT + 60_000, reason: 'range outage' });
    expect(byRange.status, await byRange.clone().text()).toBe(200);
    const b = ((await byRange.json()) as Json).value?.downtime;
    expect(b).toMatchObject({ kind: 'manual', eventId: null, recordedBy: 'owner' });

    // Payload's own audit hook may add `collection.create` rows around ours; ours are exactly two.
    const rows = (await rowsAfter(mark)).filter((r) => r.action === 'presence.downtime-add');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.actor).toMatchObject({ kind: 'owner', label: OWNER });
    const db = await pool.query('SELECT recorded_by FROM presence_downtimes WHERE season = $1', [SEASON]);
    expect(db.rows.map((r) => r.recorded_by)).toEqual(['owner', 'owner']);

    const list = (await (await rest('GET', '/presence', { headers: owner })).json()) as Json;
    expect(list.value?.season).toBe(SEASON);
    const ids = (list.value?.downtimes as { id: string }[]).map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([a?.id, b?.id]));
    expect(Array.isArray(list.value?.records)).toBe(true);
    expect(Array.isArray(list.value?.samples)).toBe(true);
  });

  it('AC-19: edit and delete of any record -> 403 forbidden, nothing changes', async () => {
    const before = await downtimeCount();
    const mark = await maxJournalId();
    const id = (await pool.query('SELECT id FROM presence_downtimes WHERE season = $1 LIMIT 1', [SEASON])).rows[0]?.id;
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      for (const path of ['/presence/downtime', '/presence/downtimes', `/presence/downtime/${id}`, `/presence/downtimes/${id}`]) {
        const res = await rest(method, path, { headers: owner, body: { reason: 'x' } });
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(((await res.json()) as Json).error?.code).toBe('forbidden');
      }
    }
    expect(await downtimeCount()).toBe(before);
    expect(await rowsAfter(mark)).toHaveLength(0);
  });

  it('bad bodies -> 400, unknown event -> 404, nothing written', async () => {
    const before = await downtimeCount();
    const mark = await maxJournalId();
    expect((await post('/presence/downtime', { reason: 'no target' })).status).toBe(400);
    expect((await post('/presence/downtime', { eventId: EVENT })).status).toBe(400);
    expect((await post('/presence/downtime', { eventId: EVENT, reason: 'x'.repeat(201) })).status).toBe(400);
    expect((await post('/presence/downtime', { eventId: EVENT, from: MOMENT, reason: 'half range' })).status).toBe(400);
    expect((await post('/presence/downtime', { from: MOMENT + 5, to: MOMENT, reason: 'reversed' })).status).toBe(400);
    expect((await post('/presence/downtime', { eventId: EVENT, reason: 'x', extra: 1 })).status).toBe(400);
    expect((await post('/presence/downtime', { eventId: `nope-${run}`, reason: 'unknown' })).status).toBe(404);
    expect(await downtimeCount()).toBe(before);
    expect(await rowsAfter(mark)).toHaveLength(0);
  });

  it('AC-19: content-agent and an anonymous caller get 403; nothing changes', async () => {
    const before = await downtimeCount();
    const mark = await maxJournalId();
    for (const headers of [content, {} as Record<string, string>]) {
      expect((await rest('GET', '/presence', { headers })).status).toBe(403);
      expect((await post('/presence/downtime', { eventId: EVENT, reason: 'x' }, headers)).status).toBe(403);
    }
    expect(await downtimeCount()).toBe(before);
    expect(await rowsAfter(mark)).toHaveLength(0);
  });

  it('S14-05: the record and its journal row share one transaction - a failed journal write keeps neither', async () => {
    const before = await downtimeCount();
    const mark = await maxJournalId();
    const req = await createLocalReq({}, payload);
    const failing = ownerTx(req, MOMENT, async () => {
      throw new Error('journal down');
    });
    await expect(presenceOf(deps).downtimes.addManual({ eventId: EVENT, reason: 'rolled back' }, MOMENT, failing)).rejects.toThrow('journal down');
    expect(await downtimeCount()).toBe(before);
    expect((await rowsAfter(mark)).filter((r) => r.action === 'presence.downtime-add')).toHaveLength(0);
  });
});
