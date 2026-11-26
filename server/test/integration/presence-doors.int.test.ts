/**
 * SPEC-14 W23 — the presence test doors (AC-63): `presence-fault`, `presence-downtime`, `presence-tick`,
 * `presence-health` each work in `test` with doors on (in-process dispatcher, this slot's Postgres and Redis, the test
 * clock; the catalog is stubbed so the windows are known); with `T2F_TEST_DOORS` unset every presence door answers
 * exactly like an unknown path; after `reset` the nine presence tables are empty, the `pr:*` keys are gone and the
 * fault switch is back to its defaults.
 */
import { randomBytes, randomInt } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { buildDispatcher } from '../../src/container';
import { finaliseDueAt } from '../../src/domain/presence/healthSigns';
import { windowOf } from '../../src/domain/presence/window';
import { presenceOf } from '../../src/endpoints/deps';
import { presenceFaults } from '../../src/presence/faults';
import { PRESENCE_TABLES } from '../../src/test-doors/presence';
import { buildAuthHarness, freshIp, CookieJar, writeProbe, type AuthHarness } from '../support/authClient';
import { BASE, ownRedis, testDeps } from './helpers';

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14d-${run}`;
const started = new Date();
/** A random whole hour in 2041–2050: no other run's samples share these instants. */
const M = Date.parse('2041-01-01T00:00:00Z') + randomInt(0, 80_000) * 3_600_000;
const E1 = `d1-${run}`;
const W = windowOf(M);

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2040-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: [{ zoneId: 'zd', midnightUtc: new Date(M).toISOString() }],
  countries: [],
  cities: [],
  events: [{ eventId: E1, countryIso: 'AA', zoneId: 'zd', slot: 'midnight' }],
  traditions: [],
};
const live = [{ eventId: E1, zoneId: 'zd', moment: M, nonMidnight: false, hidden: false }];

type Json = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; reason?: string } };
let h: AuthHarness;
let pool: pg.Pool;

async function door(path: string, body: unknown, jar?: CookieJar): Promise<{ status: number; json: Json }> {
  const res = await h.call(`/api/_test/presence/${path}`, { body, ...(jar ? { jar } : {}) });
  return { status: res.status, json: (await res.json()) as Json };
}
async function setClock(at: number): Promise<void> {
  expect((await h.call('/api/_test/clock', { body: { at, frozen: true } })).status).toBe(200);
}
const count = async (table: string) => ((await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0] as { n: number }).n;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => live } };
  });
  presenceOf(h.deps).clear();
  presenceOf(h.deps).intake.take();
}, 60_000);

afterAll(async () => {
  presenceFaults.reset();
  if (h) await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  for (const t of ['presence_window_health', 'presence_downtimes', 'presence_event_moments', 'presence_proofs']) await pool.query(`DELETE FROM ${t} WHERE season = $1`, [SEASON]);
  await pool.query('DELETE FROM presence_samples WHERE at >= $1 AND at <= $2', [String(M - 3_600_000), String(M + 3_600_000)]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.deleteByPrefix(`pr:`);
  await redis.close();
});

describe('presence doors (AC-63)', () => {
  it('presence-tick: one sample at the server clock, then the finalisation of due windows', async () => {
    await setClock(W.from + 1_000);
    const t = await door('tick', {});
    expect(t.status).toBe(200);
    expect(t.json.value).toMatchObject({ now: W.from + 1_000, sample: { ok: true, at: W.from + 1_000, fastReachable: true }, finalised: { written: 0, failed: 0 } });
    const rows = await pool.query('SELECT at FROM presence_samples WHERE node_id = $1 AND at = $2', [presenceOf(h.deps).nodeId, String(W.from + 1_000)]);
    expect(rows.rowCount).toBe(1);
    expect((await door('tick', { extra: 1 })).status).toBe(400);
  });

  it('presence-fault: down / up, restart → a new run id, beat error share; unknown fields refused', async () => {
    const down = await door('fault', { fastStore: 'down' });
    expect(down.status).toBe(200);
    expect(down.json.value).toMatchObject({ fastStore: 'down', dbWrite: 'ok', beatErrorRate: 0 });
    await setClock(W.from + 6_000);
    expect((await door('tick', {})).json.value).toMatchObject({ sample: { ok: true, fastReachable: false } });
    expect((await door('fault', { fastStore: 'up' })).json.value).toMatchObject({ fastStore: 'ok' });

    await setClock(W.from + 11_000);
    await door('tick', {});
    const restarted = await door('fault', { fastStore: 'restart' });
    expect(restarted.json.value).toMatchObject({ fastStore: 'ok', fastRestarts: 1 });
    await setClock(W.from + 16_000);
    await door('tick', {});
    const ids = await pool.query<{ at: string; fast_run_id: string }>(
      'SELECT at, fast_run_id FROM presence_samples WHERE node_id = $1 AND at IN ($2, $3) ORDER BY at',
      [presenceOf(h.deps).nodeId, String(W.from + 11_000), String(W.from + 16_000)],
    );
    expect(ids.rows).toHaveLength(2);
    expect(ids.rows[1]!.fast_run_id).toBe(`${ids.rows[0]!.fast_run_id}~restart-1`);

    expect((await door('fault', { beatErrorRate: 0.02, dbWrite: 'down' })).json.value).toMatchObject({ beatErrorRate: 0.02, dbWrite: 'fail' });
    expect((await door('fault', { dbWrite: 'up', beatErrorRate: 0 })).json.value).toMatchObject({ beatErrorRate: 0, dbWrite: 'ok' });
    expect((await door('fault', { fastStore: 'sideways' })).status).toBe(400);
    expect((await door('fault', { beatErrorRate: 2 })).status).toBe(400);
    expect((await door('fault', { other: true })).status).toBe(400);
  });

  it('presence-downtime: manual by event (the window, owner), manual range, edge report (system); unknown event, bad range', async () => {
    await setClock(M - 3_600_000);
    const byEvent = await door('downtime', { kind: 'manual', eventId: E1, reason: 'door test' });
    expect(byEvent.status).toBe(200);
    expect(byEvent.json.value?.downtime).toMatchObject({ kind: 'manual', eventId: E1, from: W.from, to: W.until, reason: 'door test', recordedBy: 'owner' });
    const range = await door('downtime', { kind: 'manual', from: M - 1_000, to: M + 1_000, reason: 'range' });
    expect(range.json.value?.downtime).toMatchObject({ kind: 'manual', eventId: null, from: M - 1_000, to: M + 1_000, recordedBy: 'owner' });
    const edge = await door('downtime', { kind: 'edge-region', region: 'eu-west', from: M - 2_000, to: M + 2_000 });
    expect(edge.json.value?.downtime).toMatchObject({ kind: 'edge-region', region: 'eu-west', reason: null, recordedBy: 'system' });
    const unknown = await door('downtime', { kind: 'manual', eventId: `nope-${run}`, reason: 'x' });
    expect(unknown.status).toBe(404);
    expect(unknown.json.error).toMatchObject({ code: 'not_found', reason: 'unknown-event' });
    const bad = await door('downtime', { kind: 'manual', from: M + 1, to: M, reason: 'x' });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toMatchObject({ code: 'validation', reason: 'invalid-range' });
    expect((await door('downtime', { kind: 'manual', eventId: E1, reason: 'x'.repeat(201) })).status).toBe(400);
  });

  it('presence-health: the window record, the samples around it and the downtimes that apply', async () => {
    await setClock(finaliseDueAt(M));
    const t = await door('tick', {});
    expect(t.json.value).toMatchObject({ finalised: { written: 1 } });
    const res = await door('health', { eventId: E1 });
    expect(res.status).toBe(200);
    const v = res.json.value as {
      season: string;
      moments: number[];
      records: { momentMs: number; state: string; signs: string[]; recordedBy: string }[];
      samples: { at: number; nodeId: string; fastReachable: boolean }[];
      downtimes: { kind: string }[];
    };
    expect(v.season).toBe(SEASON);
    expect(v.moments).toEqual([M]);
    expect(v.records).toHaveLength(1);
    expect(v.records[0]).toMatchObject({ momentMs: M, state: 'downtime', recordedBy: 'system' });
    expect(v.records[0]!.signs).toEqual(expect.arrayContaining(['fast-store-unavailable', 'fast-store-restart', 'manual', 'edge-region']));
    const mine = v.samples.filter((s) => s.nodeId === presenceOf(h.deps).nodeId).map((s) => s.at);
    expect(mine).toEqual(expect.arrayContaining([W.from + 1_000, W.from + 6_000, W.from + 11_000, W.from + 16_000, finaliseDueAt(M)]));
    expect(v.downtimes.map((d) => d.kind).sort()).toEqual(['edge-region', 'manual', 'manual']);
    // A second tick (the ticker of a real server would do the same) leaves the one record.
    expect((await door('tick', {})).json.value).toMatchObject({ finalised: { written: 0 } });
    expect((await pool.query('SELECT 1 FROM presence_window_health WHERE season = $1', [SEASON])).rowCount).toBe(1);
  });

  it('with doors off every presence door answers like an unknown path', async () => {
    const off = await buildDispatcher(testDeps({ redis }, { T2F_TEST_DOORS: undefined }));
    const post = (path: string, body: unknown) =>
      off(new Request(BASE + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }));
    const unknown = await post('/api/_test/nope', {});
    const unknownBody = await unknown.text();
    expect(unknown.status).toBe(404);
    const rows: Array<[string, unknown]> = [
      ['fault', { fastStore: 'down' }],
      ['downtime', { kind: 'manual', eventId: E1, reason: 'x' }],
      ['tick', {}],
      ['health', { eventId: E1 }],
    ];
    for (const [p, body] of rows) {
      const res = await post(`/api/_test/presence/${p}`, body);
      expect(res.status, p).toBe(404);
      expect(await res.text(), p).toBe(unknownBody);
    }
    expect(presenceFaults.get().fastStore).toBe('ok');
  });

  it('reset empties the nine presence tables and the pr:* keys, and drops the faults', async () => {
    // A beat in the window: a proof, a seen moment and pr:* markers.
    await setClock(M);
    const jar = new CookieJar();
    const ip = freshIp();
    const probe = await writeProbe(h, { jar, ip });
    const subject = ((await probe.json()) as { value: { subject: string } }).value.subject;
    expect((await h.call('/api/presence', { body: { eventIds: [E1], source: 'tv' }, jar, ip })).status).toBe(200);
    await pool.query("INSERT INTO stamps VALUES ($1, $2, $3, $4, 'tv', 'presence', $4)", [subject, SEASON, E1, String(M)]);
    await pool.query('INSERT INTO passport_achievements VALUES ($1, $2, $3, $4)', [subject, SEASON, `goal:${SEASON}:countries:3`, String(M)]);
    await pool.query('INSERT INTO stamp_old_moment_log (subject_id, season, event_id, old_moment_ms, new_moment_ms, at) VALUES ($1, $2, $3, $4, $4, $4)', [subject, SEASON, E1, String(M)]);
    await pool.query('INSERT INTO author_ids VALUES ($1, $2, $3)', [subject, `a-${run}`, String(M)]);
    await redis.set(`pr:door-test:${run}`, '1', 60_000);
    await door('fault', { fastStore: 'down', beatErrorRate: 0.5 });
    for (const t of PRESENCE_TABLES) expect(await count(t), t).toBeGreaterThan(0);

    const reset = await h.call('/api/_test/reset', { body: {} });
    expect(reset.status).toBe(200);
    for (const t of PRESENCE_TABLES) expect(await count(t), t).toBe(0);
    expect(await redis.get(`pr:door-test:${run}`)).toBeNull();
    expect(presenceFaults.get()).toEqual({ fastStore: 'ok', dbWrite: 'ok', beatErrorRate: 0, fastRestarts: 0 });
  }, 120_000);
});
