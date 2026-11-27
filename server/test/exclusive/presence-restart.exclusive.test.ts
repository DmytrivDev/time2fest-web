/**
 * SPEC-14 W47 — FR-STAMP-13 at small scale (AC-65, NFR-3, NFR-6). Runs only under the machine's EXCLUSIVE lock
 * (`T2F_EXCLUSIVE=1 node scripts/lock.mjs --mode exclusive -- npx vitest run -c vitest.integration.config.ts
 * --maxWorkers=1 test/exclusive/presence-restart.exclusive.test.ts`): it restarts the shared Redis of the `t2f`
 * compose project (no persistence: `--save '' --appendonly no`), so no other worktree may be testing meanwhile.
 * Redis is started again in `finally` whatever happens.
 *
 * In-process dispatcher over this slot's Postgres and Redis (the slot comes from the worktree, as for every
 * integration file), the test clock driven in 5 s steps through the clock door, one presence tick (sample + due
 * finalisation) per step, the catalog stubbed with two windows an hour apart (unique per run, so no other run's
 * samples fall into them).
 *
 * 1. Control (runs first: the window must be healthy, and a Redis up for less than ~6 min reads `fast-store-restart`,
 *    so the test waits until Redis has been up long enough): N beating clients + IDLE clients that never beat. The
 *    window's record is `healthy`; ≥ 99.5 % of the beating clients hold a stamp by m + 60 s (NFR-3); every idle client
 *    gets `no-presence`.
 * 2. Restart: N clients beat from m − 3 min per `nextBeatMs`; at test-clock m the shared Redis is restarted
 *    (`docker compose -p t2f restart redis`, beats keep coming meanwhile); everyone claims from m + 15 s with a retry
 *    on `unavailable`. Zero `no-presence`, N/N stamps by m + 15 s + 5 min, kinds ⊂ presence|downtime, every proof
 *    in the database after the restart (NFR-6), the window recorded as a downtime.
 *
 * Knobs: `T2F_PRESENCE_N` (default 1500), `T2F_PRESENCE_IDLE` (default max(20, N/15)). One line per run starting
 * with `PRESENCE-RESTART` is printed for the conductor: answers by code, grants by kind, max claim latency.
 */
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { finaliseDueAt } from '../../src/domain/presence/healthSigns';
import { presenceOf } from '../../src/endpoints/deps';
import { presenceFaults } from '../../src/presence/faults';
import { buildAuthHarness, type AuthHarness } from '../support/authClient';
import { ownRedis } from '../integration/helpers';
import { beatDue, claimDue, createClients, type BeatTally, type ClaimTally } from './support/virtualClients';

const N = Number(process.env.T2F_PRESENCE_N ?? '1500');
const IDLE = Number(process.env.T2F_PRESENCE_IDLE ?? String(Math.max(20, Math.round(N / 15))));
const STEP = 5_000;
/** Redis must have been up this long before the control window (its counting span is ~5.5 min of test clock). */
const REDIS_UPTIME_NEEDED_S = 420;

const COMPOSE_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../docker-compose.yml');
const composeArgs = (...args: string[]) => ['compose', '-p', 't2f', '-f', COMPOSE_FILE, ...args];
const compose = (...args: string[]) => execFileSync('docker', composeArgs(...args), { stdio: 'pipe', timeout: 120_000, encoding: 'utf8' });
const composeAsync = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts the same container (never recreates it; a running one stays) and waits until it is healthy. */
async function startAndWait(): Promise<void> {
  compose('start', 'redis');
  const id = compose('ps', '-q', 'redis').trim();
  for (let i = 0; i < 120; i += 1) {
    const health = execFileSync('docker', ['inspect', '-f', '{{.State.Health.Status}}', id], { encoding: 'utf8' }).trim();
    if (health === 'healthy') return;
    await sleep(500);
  }
  throw new Error('redis did not become healthy');
}

const redis = ownRedis();
const run = randomBytes(3).toString('hex');
const SEASON = `t14r-${run}`;
const started = new Date();
// Two windows an hour apart at a random whole hour, unique per run (samples are not season-scoped).
const MC = Date.parse('2026-12-31T10:00:00Z') + Math.floor(Math.random() * 900) * 2 * 3_600_000;
const MR = MC + 3_600_000;
const EC = `evc-${run}`;
const ER = `evr-${run}`;
const SAMPLE_SPAN = { from: MC - 900_000, to: MR + 900_000 };

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2026-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: [
    { zoneId: 'zc', midnightUtc: new Date(MC).toISOString() },
    { zoneId: 'zr', midnightUtc: new Date(MR).toISOString() },
    { zoneId: 'zl', midnightUtc: new Date(MR + 3_600_000).toISOString() },
  ],
  countries: [{ iso: 'AA', illustrationId: 'ill-aa' }],
  cities: [{ cityId: 'c1', countryIso: 'AA', zoneId: 'zc', name: { uk: 'City One' } }],
  events: [
    { eventId: EC, countryIso: 'AA', cityId: 'c1', zoneId: 'zc', midnightUtc: new Date(MC).toISOString(), slot: 'midnight' },
    { eventId: ER, countryIso: 'AA', cityId: 'c1', zoneId: 'zr', midnightUtc: new Date(MR).toISOString(), slot: 'midnight' },
  ],
  traditions: [],
};
const live = [
  { eventId: EC, zoneId: 'zc', moment: MC, nonMidnight: false, hidden: false },
  { eventId: ER, zoneId: 'zr', moment: MR, nonMidnight: false, hidden: false },
];

let pool: pg.Pool;
let h: AuthHarness;
/** The conductor's summary lines: written to stdout at once (vitest keeps them) and repeated after the run. */
const lines: string[] = [];
const summary = (line: string) => {
  lines.push(line);
  process.stdout.write(`${line}\n`);
};

async function clockTo(at: number): Promise<void> {
  const r = await h.call('/api/_test/clock', { body: { at, frozen: true } });
  if (r.status !== 200) throw new Error(`clock door ${r.status}`);
}
/** One presence tick; while Redis restarts the door may fail — the next step samples again. */
async function tick(): Promise<void> {
  await h.call('/api/_test/presence/tick', { body: {} }).catch(() => undefined);
}
const record = async (eventId: string, moment: number) =>
  (await pool.query<{ state: string; signs: string[] }>('SELECT state, signs FROM presence_window_health WHERE season = $1 AND event_id = $2 AND moment_ms = $3', [SEASON, eventId, String(moment)])).rows[0];
const grantsByKind = async (eventId: string, subjects: string[]) =>
  Object.fromEntries(
    (await pool.query<{ grant_kind: string; n: string }>('SELECT grant_kind, count(*) AS n FROM stamps WHERE season = $1 AND event_id = $2 AND subject_id = ANY($3) GROUP BY grant_kind', [SEASON, eventId, subjects])).rows.map((r) => [r.grant_kind, Number(r.n)]),
  ) as Record<string, number>;
const fmt = (o: Record<string, number>) => Object.entries(o).sort().map(([k, v]) => `${k}:${v}`).join(',') || '-';
const newBeats = (): BeatTally => ({ ok: 0, unavailable: 0, limited: 0, other: 0 });
const newClaims = (): ClaimTally => ({ answers: {}, maxMs: 0 });
const spread = (m: number) => (i: number) => m - 180_000 + (i % 20) * 1_000;

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 4 });
  h = await buildAuthHarness(redis, (deps) => {
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => live } };
  });
  presenceOf(h.deps).clear();
  await pool.query('DELETE FROM presence_samples WHERE at >= $1 AND at <= $2', [String(SAMPLE_SPAN.from), String(SAMPLE_SPAN.to)]);
  const info = await redis.info!();
  if (info.uptimeS < REDIS_UPTIME_NEEDED_S) await sleep((REDIS_UPTIME_NEEDED_S - info.uptimeS) * 1_000);
}, 600_000);

afterAll(async () => {
  try {
    await startAndWait();
  } finally {
    presenceFaults.reset();
    await h?.call('/api/_test/clock', { body: { at: Date.now(), speed: 1, frozen: false } }).catch(() => undefined);
    for (const t of ['stamps', 'passport_achievements', 'stamp_old_moment_log', 'presence_proofs', 'presence_event_moments', 'presence_window_health', 'presence_downtimes'])
      await pool.query(`DELETE FROM ${t} WHERE season = $1`, [SEASON]);
    await pool.query('DELETE FROM presence_samples WHERE at >= $1 AND at <= $2', [String(SAMPLE_SPAN.from), String(SAMPLE_SPAN.to)]);
    await pool.query('DELETE FROM users WHERE created_at >= $1', [started]);
    await pool.end();
    await redis.deleteByPrefix('pr:').catch(() => 0);
    await redis.close();
    if (lines.length > 0) process.stdout.write(`${lines.join('\n')}\n`);
  }
}, 120_000);

describe(`presence across a Redis restart at midnight (exclusive lock, N=${N})`, () => {
  it('control (NFR-3): healthy window, ≥ 99.5 % confirmed by m + 60 s, every non-beating subject gets no-presence', async () => {
    const t0 = Date.now();
    const clients = await createClients(h, N, spread(MC));
    const idle = await createClients(h, IDLE, () => 0);
    for (const c of idle) c.nextBeatAt = null;
    const beats = newBeats();
    const claims = newClaims();
    const end = finaliseDueAt(MC) + STEP;
    for (let t = MC - 310_000; t <= end; t += STEP) {
      await clockTo(t);
      await tick();
      await beatDue(h, clients, EC, t, beats);
      if (t >= MC + 15_000) await claimDue(h, clients, EC, MC, t, claims);
    }
    const health = await record(EC, MC);
    const idleClaims = newClaims();
    await claimDue(h, idle, EC, MC, end, idleClaims);
    const confirmed = clients.filter((c) => c.grantedAtClock !== null && c.grantedAtClock <= MC + 60_000).length;
    const kinds = await grantsByKind(EC, clients.map((c) => c.subject));
    summary(
      `PRESENCE-RESTART control N=${N} idle=${IDLE} record=${health?.state}${health?.signs.length ? `[${health.signs.join(',')}]` : ''} confirmed<=m+60s=${confirmed}/${N} (${((100 * confirmed) / N).toFixed(2)}%) answers{${fmt(claims.answers)}} idle{${fmt(idleClaims.answers)}} grants{${fmt(kinds)}} beats{ok:${beats.ok},unavailable:${beats.unavailable},429:${beats.limited},other:${beats.other}} maxClaimMs=${Math.round(Math.max(claims.maxMs, idleClaims.maxMs))} wall=${Math.round((Date.now() - t0) / 1000)}s`,
    );
    expect(health).toMatchObject({ state: 'healthy', signs: [] });
    expect(confirmed / N).toBeGreaterThanOrEqual(0.995);
    expect(idleClaims.answers).toEqual({ 'no-presence': IDLE });
  }, 1_800_000);

  it('restart at test-clock midnight (AC-65, NFR-6): zero no-presence, N/N stamps by m + 15 s + 5 min, proofs kept', async () => {
    const t0 = Date.now();
    const clients = await createClients(h, N, spread(MR));
    const beats = newBeats();
    const claims = newClaims();
    const before = await redis.info!();
    let after: { runId: string; uptimeS: number } | undefined;
    const deadline = MR + 15_000 + 300_000;
    const end = finaliseDueAt(MR) + STEP;
    let restartMs = 0;
    try {
      for (let t = MR - 180_000; t <= deadline; t += STEP) {
        await clockTo(t);
        if (t === MR) {
          const r0 = Date.now();
          const restart = composeAsync('docker', composeArgs('restart', 'redis'), { timeout: 120_000 });
          await beatDue(h, clients, ER, t, beats); // beats keep coming while Redis goes down
          await restart;
          await startAndWait();
          restartMs = Date.now() - r0;
          for (let i = 0; i < 100; i += 1) {
            after = await redis.info!().catch(() => undefined);
            if (after) break;
            await sleep(200);
          }
        }
        await tick();
        await beatDue(h, clients, ER, t, beats);
        if (t >= MR + 15_000) await claimDue(h, clients, ER, MR, t, claims);
        if (t >= end && clients.every((c) => c.claim === 'granted' || (c.claim !== null && c.claim !== 'unavailable' && c.claim !== 'rate_limited'))) break;
      }
    } finally {
      await startAndWait();
    }
    const subjects = clients.map((c) => c.subject);
    const proofs = Number(
      (await pool.query<{ n: string }>('SELECT count(DISTINCT subject_id) AS n FROM presence_proofs WHERE season = $1 AND event_id = $2 AND subject_id = ANY($3)', [SEASON, ER, subjects])).rows[0]!.n,
    );
    const kinds = await grantsByKind(ER, subjects);
    const health = await record(ER, MR);
    const granted = clients.filter((c) => c.claim === 'granted' && c.grantedAtClock !== null && c.grantedAtClock <= deadline).length;
    const lastGrant = Math.max(...clients.map((c) => c.grantedAtClock ?? Number.NaN));
    summary(
      `PRESENCE-RESTART restart N=${N} redisRestart=${before.runId !== after?.runId ? 'yes' : 'NO'} (${restartMs} ms) record=${health?.state}${health?.signs.length ? `[${health.signs.join(',')}]` : ''} granted=${granted}/${N} lastGrant=m+${Math.round((lastGrant - MR) / 1000)}s answers{${fmt(claims.answers)}} grants{${fmt(kinds)}} proofs=${proofs}/${N} beats{ok:${beats.ok},unavailable:${beats.unavailable},429:${beats.limited},other:${beats.other}} maxClaimMs=${Math.round(claims.maxMs)} wall=${Math.round((Date.now() - t0) / 1000)}s`,
    );
    expect(after, 'Redis answered after the restart').toBeDefined();
    expect(after!.runId).not.toBe(before.runId);
    expect(claims.answers['no-presence'] ?? 0).toBe(0);
    expect(granted).toBe(N);
    expect(Object.keys(kinds).every((k) => k === 'presence' || k === 'downtime')).toBe(true);
    expect(Object.values(kinds).reduce((a, b) => a + b, 0)).toBe(N);
    expect(proofs).toBe(N);
    expect(health?.state).toBe('downtime');
  }, 1_800_000);
});
