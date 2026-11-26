/**
 * SPEC-14 W20 (AC-20, AC-22, AC-64; AC-6's alarm) — the three presence alarms in the TEST Telegram channel
 * (`startTelegramFake`, never a live chat) through the real ops outbox and sender:
 * - `presence/downtime` (`page`) by its real trigger, an edge-region report overlapping an event's span;
 * - `presence/fast-store-down` and `presence/finalise-failed` are `log` kinds: SPEC-13b AC-12 sends no message for a
 *   `log` raise (`alarms/delivery.ts`: one `log-alarms` row; Telegram only in the morning digest). So, as the ops
 *   suite does for its log kinds (AC-28), the registry row is proven in the channel with a `page` raise of that exact
 *   kind, and the real trigger (a proof written while the fast store is down; a sample written while database writes
 *   fail) is proven by its `log-alarms` row.
 */
import { randomBytes, randomInt } from 'node:crypto';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import { payloadOf, startOpsTickerOf } from '../../src/container';
import { presenceOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import type { OpsRunner } from '../../src/ops/runner';
import { PRESENCE_DOWNTIME_TOPIC } from '../../src/presence/downtime';
import { presenceFaults } from '../../src/presence/faults';
import { expectAlarmInTestChannel } from '../support/expectAlarmInTestChannel';
import { startTelegramFake, type FakeTelegramHandle } from '../support/fakeTelegram';
import { sleep } from './scheduler-support';
import { testDeps } from './helpers';

const run = randomBytes(3).toString('hex');
const SEASON = `t14a-${run}`;
const M = Date.parse('2041-01-01T00:00:00Z') + randomInt(0, 80_000) * 3_600_000;
const E1 = `a1-${run}`;
const SUBJECT = `alarm-${run}`;

const stored: StoredCatalog = {
  season: { id: '1', key: SEASON, generatedAt: '2040-11-01T00:00:00Z', tzdbVersion: '2026f' },
  zones: [{ zoneId: 'za', midnightUtc: new Date(M).toISOString() }],
  countries: [],
  cities: [],
  events: [{ eventId: E1, countryIso: 'AA', zoneId: 'za', slot: 'midnight' }],
  traditions: [],
};

describe('presence alarms in the test Telegram channel (AC-64)', () => {
  let fake: FakeTelegramHandle;
  let deps: Deps;
  let payload: Payload;
  let runner: OpsRunner | undefined;

  const started = new Date();
  const logRows = async (code: string) =>
    (
      await payload.find({
        collection: 'log-alarms',
        where: { and: [{ code: { equals: code } }, { createdAt: { greater_than_equal: started.toISOString() } }] },
        overrideAccess: true,
        depth: 0,
        limit: 50,
      })
    ).docs;
  async function expectLogRow(code: string): Promise<void> {
    const end = Date.now() + 10_000;
    let rows = await logRows(code);
    while (rows.length === 0 && Date.now() < end) {
      await sleep(250);
      rows = await logRows(code);
    }
    expect(rows.length, `log-alarms row of ${code}`).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ source: 'presence', code });
  }
  /** The kind rendered in the channel: a `page` raise of exactly this registry row. */
  const pageRaise = (code: string) => async () => deps.alarm.raise({ level: 'page', source: 'presence', code, details: { node: 'test', stage: 'test' } });

  // Repeats of a delivered kind within 10 min are coalesced: every case starts from an empty outbox of the test DB.
  const clearOutbox = async () => {
    await payload.delete({ collection: 'alarm-deliveries', where: { id: { exists: true } }, overrideAccess: true });
  };

  beforeAll(async () => {
    fake = await startTelegramFake();
    deps = testDeps({}, fake.env);
    deps.catalogStore = { read: async () => stored };
    deps.live = { ...deps.live!, events: { events: async () => [{ eventId: E1, zoneId: 'za', moment: M, nonMidnight: false, hidden: false }] } };
    payload = await payloadOf(deps)();
    runner = startOpsTickerOf(deps, 500);
  }, 120_000);

  afterAll(async () => {
    presenceFaults.reset();
    await runner?.stop();
    await fake?.close();
    if (payload) {
      const db = (payload.db as unknown as { pool: { query(q: string, v?: unknown[]): Promise<unknown> } }).pool;
      await db.query('DELETE FROM presence_proofs WHERE subject_id = $1', [SUBJECT]);
      await db.query('DELETE FROM presence_downtimes WHERE season = $1', [SEASON]);
      await db.query(`DELETE FROM internal_events WHERE topic = $1 AND payload->>'season' = $2`, [PRESENCE_DOWNTIME_TOPIC, SEASON]);
      await clearOutbox();
      for (const code of ['presence/fast-store-down', 'presence/finalise-failed']) {
        for (const r of await logRows(code)) await payload.delete({ collection: 'log-alarms', id: r.id, overrideAccess: true });
      }
    }
  }, 60_000);

  it('presence/downtime (page): an edge report over an event', async () => {
    await clearOutbox();
    const ms = await expectAlarmInTestChannel(
      { source: 'presence', code: 'presence/downtime' },
      async () => {
        const out = await presenceOf(deps).downtimes.reportEdgeFailure({ region: 'eu-west', from: M - 1_000, to: M + 1_000 }, M + 60_000);
        expect(out.ok).toBe(true);
      },
      fake,
    );
    expect(ms).toBeLessThan(60_000);
  }, 90_000);

  it('presence/fast-store-down (log): a proof written while Redis is down → log row; the kind renders in the channel', async () => {
    presenceFaults.apply({ fastStore: 'down' });
    try {
      const out = await presenceOf(deps).proofs.record({ subjectId: SUBJECT, season: SEASON, eventId: E1, momentMs: M, receivedAt: M, source: 'tv' });
      expect(out).toMatchObject({ ok: true, via: 'db' });
    } finally {
      presenceFaults.reset();
    }
    await expectLogRow('presence/fast-store-down');
    await clearOutbox();
    expect(await expectAlarmInTestChannel({ source: 'presence', code: 'presence/fast-store-down' }, pageRaise('presence/fast-store-down'), fake)).toBeLessThan(60_000);
  }, 90_000);

  it('presence/finalise-failed (log): a sample written while database writes fail → log row; the kind renders in the channel', async () => {
    presenceFaults.apply({ dbWrite: 'down' });
    try {
      expect((await presenceOf(deps).sampler.sampleOnce(M)).ok).toBe(false);
    } finally {
      presenceFaults.reset();
    }
    await expectLogRow('presence/finalise-failed');
    await clearOutbox();
    expect(await expectAlarmInTestChannel({ source: 'presence', code: 'presence/finalise-failed' }, pageRaise('presence/finalise-failed'), fake)).toBeLessThan(60_000);
  }, 90_000);
});
