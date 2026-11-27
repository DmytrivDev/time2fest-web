// SPEC-14 fix-mode: the claim service over in-memory ports.
// W2 — the subject's own stored proof moments count even when the claiming node has not cached that moment.
// S14-08 — time-only refusals skip the proof / downtime / health reads (the stamp read stays first).
import { describe, expect, it } from 'vitest';
import { stampCatalogOf } from '../../src/domain/passport/stampView';
import type { PresenceEvent } from '../../src/domain/presence/eventValidity';
import { createBeatService } from '../../src/presence/beats';
import { createNodeIntake } from '../../src/presence/intake';
import { createMomentBook } from '../../src/presence/moments';
import type { WindowHealthRow, MomentRow, MomentStore, ProofRow, RightsDb, StampRow } from '../../src/presence/ports';
import { createPresenceFaults } from '../../src/presence/faults';
import { createStampService, type StampSqlStore } from '../../src/presence/stamps';

const SEASON = '2026-27';
const M1 = Date.parse('2026-12-31T22:00:00Z');
const M2 = M1 + 600_000; // the corrected moment (seen by another node)
const EVENT = 'evt_x';

function harness(opts: { current: number; seenMoments: number[]; proofs: ProofRow[]; healthy: number[] }) {
  const calls = { proofs: 0, downtimes: 0, health: 0, stampGet: 0, momentsList: 0 };
  const stamps = new Map<string, StampRow>();
  const db = { query: async () => ({ rows: [], rowCount: 0 }), tx: async (fn: (q: unknown) => unknown) => fn({}) } as unknown as RightsDb;
  const store: StampSqlStore = {
    async insert(_q, row) {
      if (stamps.has(row.event_id)) return false;
      stamps.set(row.event_id, row);
      return true;
    },
    async get(_q, _s, _season, eventId) {
      calls.stampGet += 1;
      return stamps.get(eventId) ?? null;
    },
    async listForSubject() {
      return [...stamps.values()];
    },
    async logOldMoment() {},
  };
  const momentRows: MomentRow[] = opts.seenMoments.map((m) => ({ season: SEASON, event_id: EVENT, moment_ms: String(m), first_seen_at: '0' }));
  const momentStore: MomentStore = {
    async record(_db, season, eventId, momentMs, seenAt) {
      if (!momentRows.some((r) => r.moment_ms === String(momentMs))) momentRows.push({ season, event_id: eventId, moment_ms: String(momentMs), first_seen_at: String(seenAt) });
    },
    async list() {
      calls.momentsList += 1;
      return momentRows;
    },
  };
  const event: PresenceEvent = { eventId: EVENT, countryIso: 'XX', zoneId: 'z', momentMs: opts.current };
  const service = createStampService({
    db: async () => db,
    catalog: async () => ({ catalog: { season: SEASON, events: new Map([[EVENT, event]]) }, zones: { zones: [{ midnightMs: M1 }, { midnightMs: M2 }] } }),
    stampCatalog: async () =>
      stampCatalogOf({ events: [{ eventId: EVENT, midnightUtc: '2026-12-31T22:00:00Z', countryIso: 'XX', cityId: 'c' }], cities: [{ cityId: 'c', name: 'Місто' }], countries: [] }),
    moments: createMomentBook({ db: async () => db, store: momentStore }),
    proofs: {
      async listForSubject() {
        calls.proofs += 1;
        return opts.proofs;
      },
    },
    health: {
      async get(_db, season, eventId, moment) {
        calls.health += 1;
        return opts.healthy.includes(moment) ? ({ season, event_id: eventId, moment_ms: String(moment), state: 'healthy' } as unknown as WindowHealthRow) : null;
      },
    },
    downtimes: {
      async list() {
        calls.downtimes += 1;
        return [];
      },
    },
    store,
    faults: createPresenceFaults(),
  });
  return { service, calls, momentRows };
}

const proofAt = (moment: number): ProofRow => ({
  subject_id: 's1',
  season: SEASON,
  event_id: EVENT,
  moment_ms: String(moment),
  first_received_at: String(moment - 5_000),
  last_received_at: null,
  source: 'country',
});

describe('claim service (W2)', () => {
  it('a stored proof at a moment this node has not cached grants instead of no-presence', async () => {
    // This node still knows only M1 (healthy); another node saw the correction to M2 and stored the proof there.
    const h = harness({ current: M1, seenMoments: [M1], proofs: [proofAt(M2)], healthy: [M1] });
    const out = await h.service.claim({ subjectId: 's1', eventId: EVENT, source: 'tv', now: M2 + 20_000 });
    expect(out).toMatchObject({ ok: true, inserted: true, stamp: { eventId: EVENT, presenceSource: 'country' } });
  });

  it('without any proof the healthy known window still refuses no-presence', async () => {
    const h = harness({ current: M1, seenMoments: [M1], proofs: [], healthy: [M1] });
    const out = await h.service.claim({ subjectId: 's1', eventId: EVENT, source: 'tv', now: M1 + 20_000 });
    expect(out).toEqual({ ok: false, error: { code: 'forbidden', reason: 'no-presence' } });
  });
});

describe('claim service (S14-08)', () => {
  it('before m + 15 s: only the stamp read, no proof / downtime / health / moment reads', async () => {
    const h = harness({ current: M1, seenMoments: [M1], proofs: [proofAt(M1)], healthy: [] });
    const out = await h.service.claim({ subjectId: 's1', eventId: EVENT, source: 'tv', now: M1 + 1_000 });
    expect(out).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(h.calls).toEqual({ proofs: 0, downtimes: 0, health: 0, stampGet: 1, momentsList: 0 });
    expect(h.momentRows).toHaveLength(1);
  });

  it('unknown event: no proof reads', async () => {
    const h = harness({ current: M1, seenMoments: [M1], proofs: [], healthy: [] });
    const out = await h.service.claim({ subjectId: 's1', eventId: 'evt_none', source: 'tv', now: M1 + 20_000 });
    expect(out).toEqual({ ok: false, error: { code: 'not_found', reason: 'unknown-event' } });
    expect(h.calls.proofs + h.calls.downtimes + h.calls.health).toBe(0);
  });

  it('an existing stamp still wins after the claim closed (idempotency)', async () => {
    const h = harness({ current: M1, seenMoments: [M1], proofs: [proofAt(M1)], healthy: [] });
    expect(await h.service.claim({ subjectId: 's1', eventId: EVENT, source: 'tv', now: M1 + 20_000 })).toMatchObject({ ok: true, inserted: true });
    const late = M2 + 13 * 3_600_000;
    expect(await h.service.claim({ subjectId: 's1', eventId: EVENT, source: 'tv', now: late })).toMatchObject({ ok: true, inserted: false });
    const h2 = harness({ current: M1, seenMoments: [M1], proofs: [proofAt(M1)], healthy: [] });
    expect(await h2.service.claim({ subjectId: 's1', eventId: EVENT, source: 'tv', now: late })).toEqual({ ok: false, error: { code: 'conflict', reason: 'claim-closed' } });
    expect(h2.calls.proofs).toBe(0);
  });
});

describe('presence pool timeout (S14-03)', () => {
  it('a claim whose proof read times out answers unavailable 5000, never no-presence', async () => {
    // The presence pool cannot hand out a connection within its timeout (pg throws on connect).
    const failing = createStampService({
      db: async () => {
        throw new Error('timeout exceeded when trying to connect');
      },
      catalog: async () => ({ catalog: { season: SEASON, events: new Map() }, zones: { zones: [] } }),
      stampCatalog: async () => stampCatalogOf({ events: [], cities: [], countries: [] }),
      moments: createMomentBook({ db: async () => ({}) as RightsDb, store: { record: async () => {}, list: async () => [] } }),
      proofs: { listForSubject: async () => [] },
      health: { get: async () => null },
      downtimes: { list: async () => [] },
      store: { insert: async () => false, get: async () => null, listForSubject: async () => [], logOldMoment: async () => {} },
      faults: createPresenceFaults(),
    });
    expect(await failing.claim({ subjectId: 's1', eventId: EVENT, source: 'tv', now: M1 + 20_000 })).toEqual({
      ok: false,
      error: { code: 'unavailable', retryAfterMs: 5_000 },
    });
  });

  it('a beat whose moment-book write times out answers unavailable and counts as failed', async () => {
    const intake = createNodeIntake();
    const event: PresenceEvent = { eventId: EVENT, countryIso: 'XX', zoneId: 'z', momentMs: M1 };
    const beats = createBeatService({
      catalog: async () => ({ catalog: { season: SEASON, events: new Map([[EVENT, event]]) }, zones: { zones: [{ midnightMs: M1 }] } }),
      moments: createMomentBook({
        db: async () => {
          throw new Error('timeout exceeded when trying to connect');
        },
        store: { record: async () => {}, list: async () => [] },
      }),
      proofs: { record: async () => ({ ok: true, proof: 'exists', via: 'fast' }), recordBeat: async () => ({ ok: true, written: [] }) },
      windows: { count: async () => true, counts: async () => null },
      intake,
      faults: createPresenceFaults(),
      random: () => 0.99,
    });
    expect(await beats.beat({ subjectId: 's1', eventIds: [EVENT], source: 'tv', receivedAt: M1 - 10_000 })).toEqual({ ok: false, retryAfterMs: 5_000 });
    expect(intake.take()).toEqual({ accepted: 0, failed: 1 });
  });
});
