/**
 * SPEC-14 W34 - subject data and retention of the passport: `runSubjectDataInScope` export lists the four groups of the
 * `stamps` handler (stamps of every season, achievements, proofs, old-moment journal), erase leaves none and touches no
 * other subject (AC-55); the declarative registry row `presence-beats` with a ≤ 48 h retention, beat keys TTL ≤ 48 h
 * (AC-56; the TTL of every written key is asserted in presence-beats); proofs of the season deleted once
 * `now > ratingCloseAt + 24 h`, stamps kept (AC-57), and the ops job is registered.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ratingCloseAt } from '@time2fest/rules/time';
import { rightsDbOf } from '../../src/auth/pool';
import { runSubjectDataInScope } from '../../src/auth/subjectData';
import type { StoredCatalog } from '../../src/catalog/ports';
import { presenceOf } from '../../src/endpoints/deps';
import { OPS_JOBS } from '../../src/ops/runner';
import { PRESENCE_KEY_TTL_MS } from '../../src/presence/intake';
import { createPresenceRetention, PROOF_RETENTION_AFTER_CLOSE_MS } from '../../src/presence/retention';
import type { StampsSubjectExport } from '../../src/presence/subjectData';
import { subjectDataRegistry } from '../../src/registries/subjectData';
import { buildAuthHarness, CookieJar, writeProbe, type AuthHarness } from '../support/authClient';
import { ownRedis } from './helpers';

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14s-${run}`;
const OLD = `t14o-${run}`;
const M = Date.parse('2026-12-31T21:00:00Z');
const E = `s1-${run}`;
const started = new Date();
const TABLES = ['stamps', 'passport_achievements', 'presence_proofs', 'stamp_old_moment_log'];

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2026-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: [{ zoneId: 'zs0', order: 1, midnightUtc: new Date(M).toISOString() }],
  countries: [{ iso: 'AA', illustrationId: 'ill-AA' }],
  cities: [{ cityId: 'cs0', countryIso: 'AA', zoneId: 'zs0', name: { uk: 'City' } }],
  events: [{ eventId: E, countryIso: 'AA', cityId: 'cs0', zoneId: 'zs0', midnightUtc: new Date(M).toISOString(), slot: 'midnight' }],
  traditions: [],
};

let pool: pg.Pool;
let h: AuthHarness;

async function subject(): Promise<string> {
  const res = await writeProbe(h, { jar: new CookieJar() });
  expect(res.status).toBe(200);
  return ((await res.json()) as { value: { subject: string } }).value.subject;
}

/** One row in each of the four tables (stamps in two seasons). */
async function fill(id: string): Promise<void> {
  for (const season of [SEASON, OLD])
    await pool.query(
      `INSERT INTO stamps (subject_id, season, event_id, granted_at, presence_source, grant_kind, issued_at) VALUES ($1, $2, $3, $4, 'tv', 'presence', $5)`,
      [id, season, E, String(M + 15_000), String(M + 16_000)],
    );
  await pool.query(`INSERT INTO passport_achievements (subject_id, season, key, achieved_at) VALUES ($1, $2, $3, $4)`, [id, SEASON, `goal:${SEASON}:countries:3`, String(M + 16_000)]);
  await pool.query(`INSERT INTO presence_proofs (subject_id, season, event_id, moment_ms, first_received_at, source) VALUES ($1, $2, $3, $4, $5, 'tv')`, [
    id,
    SEASON,
    E,
    String(M),
    String(M - 1_000),
  ]);
  await pool.query(`INSERT INTO stamp_old_moment_log (subject_id, season, event_id, old_moment_ms, new_moment_ms, at) VALUES ($1, $2, $3, $4, $5, $6)`, [
    id,
    SEASON,
    E,
    String(M),
    String(M + 60_000),
    String(M + 16_000),
  ]);
}
const count = async (table: string, id: string) => ((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE subject_id = $1`, [id])).rows[0] as { n: number }).n;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  h = await buildAuthHarness(redis, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => [{ eventId: E, zoneId: 'zs0', moment: M, nonMidnight: false, hidden: false }] } };
  });
  presenceOf(h.deps).clear();
}, 60_000);

afterAll(async () => {
  for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE season = ANY($1::text[])`, [[SEASON, OLD]]);
  await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
  await pool.end();
  await redis.close();
});

describe('subject data stamps (AC-55, AC-56)', () => {
  it('registry: handler stamps and declarative presence-beats (<= 48 h), sorted; beat key TTL <= 48 h', () => {
    const names = subjectDataRegistry.map((r) => r.capability);
    expect(names).toEqual([...names].sort());
    const stamps = subjectDataRegistry.find((r) => r.capability === 'stamps');
    expect(stamps && 'declarative' in stamps).toBe(false);
    expect(subjectDataRegistry.find((r) => r.capability === 'presence-beats')).toMatchObject({ declarative: true, retention: '<= 48 h' });
    expect(PRESENCE_KEY_TTL_MS).toBeLessThanOrEqual(172_800_000);
  });

  it('export lists the four groups (stamps of every season); erase leaves none and spares another subject', { timeout: 60_000 }, async () => {
    const id = await subject();
    const other = await subject();
    await fill(id);
    await fill(other);

    const exported = await runSubjectDataInScope(h.deps, 'export', id, subjectDataRegistry);
    expect(exported.ok).toBe(true);
    const value = (exported as { results: Record<string, unknown> }).results.stamps as StampsSubjectExport;
    expect(value.stamps.map((s) => s.season).sort()).toEqual([OLD, SEASON].sort());
    expect(value.stamps[0]).toMatchObject({ eventId: E, grantedAt: M + 15_000, presenceSource: 'tv', grantKind: 'presence', issuedAt: M + 16_000 });
    expect(value.achievements).toEqual([{ season: SEASON, key: `goal:${SEASON}:countries:3`, achievedAt: M + 16_000 }]);
    expect(value.proofs).toEqual([{ season: SEASON, eventId: E, momentMs: M, firstReceivedAt: M - 1_000, lastReceivedAt: null, source: 'tv' }]);
    expect(value.oldMoments).toEqual([{ season: SEASON, eventId: E, oldMomentMs: M, newMomentMs: M + 60_000, at: M + 16_000 }]);
    expect((exported as { declarative: string[] }).declarative).toContain('presence-beats');

    expect((await runSubjectDataInScope(h.deps, 'erase', id, subjectDataRegistry)).ok).toBe(true);
    for (const t of TABLES) expect(await count(t, id), t).toBe(0);
    for (const t of TABLES) expect(await count(t, other), t).toBeGreaterThan(0);
    const again = await runSubjectDataInScope(h.deps, 'export', other, subjectDataRegistry.filter((r) => r.capability === 'stamps'));
    expect(((again as { results: Record<string, StampsSubjectExport> }).results.stamps?.stamps ?? []).length).toBe(2);

    // anonymise = erase
    expect((await runSubjectDataInScope(h.deps, 'anonymise', other, subjectDataRegistry.filter((r) => r.capability === 'stamps'))).ok).toBe(true);
    for (const t of TABLES) expect(await count(t, other), t).toBe(0);
  });
});

describe('proof retention (AC-57)', () => {
  it('close + 24 h - 1 min: kept; close + 24 h + 1 min: no proofs of the season, stamps remain; the ops job is registered', { timeout: 60_000 }, async () => {
    expect(OPS_JOBS).toContain('presence-retention');
    const id = await subject();
    await fill(id);
    const close = ratingCloseAt({ zones: [{ midnightMs: M }] });
    const job = createPresenceRetention({
      db: () => rightsDbOf(h.deps),
      season: async (now) => {
        const view = await presenceOf(h.deps).catalog(now);
        return { key: view.catalog.season, zones: view.zones.zones };
      },
    });
    expect(await job.runNow(close + PROOF_RETENTION_AFTER_CLOSE_MS - 60_000)).toEqual({ result: 'not-due' });
    expect(await count('presence_proofs', id)).toBe(1);
    const r = await job.run(close + PROOF_RETENTION_AFTER_CLOSE_MS + 60_000);
    expect(r).toMatchObject({ result: 'pruned' });
    expect((await pool.query('SELECT count(*)::int AS n FROM presence_proofs WHERE season = $1', [SEASON])).rows[0]).toEqual({ n: 0 });
    expect(await count('stamps', id)).toBe(2);
    expect(await count('passport_achievements', id)).toBe(1);
    // Hourly: a second run within the hour is idle.
    expect(await job.run(close + PROOF_RETENTION_AFTER_CLOSE_MS + 120_000)).toEqual({ result: 'idle' });
  });
});
