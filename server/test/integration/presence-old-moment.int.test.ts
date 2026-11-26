/**
 * SPEC-14 W27 — the old moment ([А9]; AC-32, AC-33) through the real pipeline (in-process dispatcher, this slot's
 * Postgres and Redis, the test clock). The correction is applied by changing the stubbed patched moments the presence
 * module reads (`deps.live.events`, what `momentsWithPatches` feeds) and dropping its 30 s caches:
 * - a beat around m_old, a correction to m_new, a claim → `old-moment`, `grantedAt` of m_old, one journal row
 *   (subject, event, old and new moment); an old client beating around m_old after the correction gets a proof for
 *   the old window (AC-32);
 * - after the celebration end (last midnight + `CELEBRATION_TAIL` + Δ) only the current window counts: a proof only in
 *   the old window under a healthy current window → `no-presence` (AC-33).
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { CELEBRATION_TAIL, stampGrantedAt } from '@time2fest/rules/time';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { PRESENCE_DELTA_MS } from '../../src/domain/presence/window';
import { presenceOf } from '../../src/endpoints/deps';
import { buildAuthHarness, CookieJar, freshIp, writeProbe, type AuthHarness } from '../support/authClient';
import { ownRedis } from './helpers';

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14o-${run}`;
const started = new Date();
const M_OLD = Date.parse('2026-12-31T22:00:00Z');
const M_NEW = M_OLD + 120_000;
const E1 = `eo1-${run}`; // AC-32
const E2 = `eo2-${run}`; // AC-33

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2026-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: [{ zoneId: 'za', midnightUtc: new Date(M_OLD).toISOString() }],
  countries: [{ iso: 'AA', illustrationId: 'ill-aa' }],
  cities: [{ cityId: 'c1', countryIso: 'AA', zoneId: 'za', name: { uk: 'City One' } }],
  events: [E1, E2].map((eventId) => ({ eventId, countryIso: 'AA', cityId: 'c1', zoneId: 'za', midnightUtc: new Date(M_OLD).toISOString(), slot: 'midnight' })),
  traditions: [],
};
const live = [E1, E2].map((eventId) => ({ eventId, zoneId: 'za', moment: M_OLD, nonMidnight: false, hidden: false }));

let pool: pg.Pool;
let h: AuthHarness;

interface Guest {
  jar: CookieJar;
  ip: string;
  subject: string;
}
const setClock = async (at: number) => expect((await h.call('/api/_test/clock', { body: { at, frozen: true } })).status).toBe(200);
async function guest(): Promise<Guest> {
  const jar = new CookieJar();
  const ip = freshIp();
  const res = await writeProbe(h, { jar, ip });
  expect(res.status).toBe(200);
  return { jar, ip, subject: ((await res.json()) as { value: { subject: string } }).value.subject };
}
const beat = (g: Guest, eventId: string) => h.call('/api/presence', { body: { eventIds: [eventId], source: 'tv' }, jar: g.jar, ip: g.ip });
async function claim(g: Guest, eventId: string) {
  const res = await h.call('/api/me/stamps', { body: { eventId, source: 'country', at: M_NEW }, jar: g.jar, ip: g.ip });
  return { status: res.status, body: (await res.json()) as { value?: { grantedAt: number; presenceSource: string }; error?: unknown } };
}
const proofMoments = async (subject: string, eventId: string) =>
  (await pool.query<{ moment_ms: string }>('SELECT moment_ms FROM presence_proofs WHERE subject_id = $1 AND event_id = $2 ORDER BY moment_ms', [subject, eventId])).rows.map(
    (r) => Number(r.moment_ms),
  );
const healthy = (eventId: string, moment: number) =>
  pool.query("INSERT INTO presence_window_health (season, event_id, moment_ms, state, signs, recorded_at) VALUES ($1, $2, $3, 'healthy', '{}', $4)", [
    SEASON,
    eventId,
    String(moment),
    String(moment + 60_000),
  ]);
function correct(moment: number): void {
  for (const e of live) e.moment = moment;
  presenceOf(h.deps).clear();
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => live } };
  });
  correct(M_OLD);
}, 60_000);

afterAll(async () => {
  await h.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } });
  for (const t of ['stamps', 'stamp_old_moment_log', 'presence_proofs', 'presence_event_moments', 'presence_window_health'])
    await pool.query(`DELETE FROM ${t} WHERE season = $1`, [SEASON]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  for (const p of ['pr:mk:', 'pr:pre:', 'pr:in:', 'pr:cnt:pre:', 'pr:cnt:in:']) await redis.deleteByPrefix(`${p}${SEASON}:`);
  await redis.close();
});

describe('old moment (AC-32)', () => {
  it('beat around m_old, correction to m_new, claim → old-moment with the old grantedAt and a journal row; an old client still proves the old window', async () => {
    correct(M_OLD);
    await setClock(M_OLD);
    const g = await guest();
    const g2 = await guest();
    expect((await beat(g, E1)).status).toBe(200);
    expect(await proofMoments(g.subject, E1)).toEqual([M_OLD]);

    correct(M_NEW);
    await healthy(E1, M_NEW);
    // An old site version still beats around m_old after the correction: the old window is still accepted.
    await setClock(M_OLD + 5_000);
    expect((await beat(g2, E1)).status).toBe(200);
    expect(await proofMoments(g2.subject, E1)).toEqual([M_OLD]);

    await setClock(M_NEW + 16_000);
    for (const who of [g, g2]) {
      const c = await claim(who, E1);
      expect(c.status).toBe(200);
      expect(c.body.value).toMatchObject({ grantedAt: stampGrantedAt(M_OLD), presenceSource: 'tv' });
      const rows = (await pool.query('SELECT grant_kind, granted_at FROM stamps WHERE subject_id = $1 AND event_id = $2', [who.subject, E1])).rows;
      expect(rows).toEqual([{ grant_kind: 'old-moment', granted_at: String(stampGrantedAt(M_OLD)) }]);
      const log = (
        await pool.query('SELECT season, event_id, old_moment_ms, new_moment_ms, at FROM stamp_old_moment_log WHERE subject_id = $1', [who.subject])
      ).rows;
      expect(log).toEqual([{ season: SEASON, event_id: E1, old_moment_ms: String(M_OLD), new_moment_ms: String(M_NEW), at: String(M_NEW + 16_000) }]);
    }
    // A repeat claim neither changes the stamp nor writes a second journal row.
    expect((await claim(g, E1)).body.value).toMatchObject({ grantedAt: stampGrantedAt(M_OLD) });
    expect((await pool.query('SELECT 1 FROM stamp_old_moment_log WHERE subject_id = $1', [g.subject])).rowCount).toBe(1);
  });
});

describe('after the celebration (AC-33)', () => {
  it('a proof only in the old window, claim after the celebration end, healthy current window → no-presence', async () => {
    correct(M_OLD);
    await setClock(M_OLD);
    const g = await guest();
    expect((await beat(g, E2)).status).toBe(200);
    expect(await proofMoments(g.subject, E2)).toEqual([M_OLD]);

    correct(M_NEW);
    await healthy(E2, M_NEW);
    const end = M_OLD + CELEBRATION_TAIL + PRESENCE_DELTA_MS;
    await setClock(end + 60_000);
    const c = await claim(g, E2);
    expect(c.status).toBe(403);
    expect(c.body.error).toEqual({ code: 'forbidden', reason: 'no-presence' });
    expect((await pool.query('SELECT 1 FROM stamps WHERE subject_id = $1', [g.subject])).rowCount).toBe(0);
  });
});
