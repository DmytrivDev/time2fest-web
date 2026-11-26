// SPEC-14 W13 — proof of presence outside Redis ([П-3]; AC-3, AC-6, AC-7, AC-9, AC-12), intake counters (AC-17),
// moments (AC-32), fast-store keys TTL ≤ 48 h (AC-56), `FastStore.info` (AC-14), faults ([П-10]).
import { describe, expect, it } from 'vitest';
import { createMemoryStore } from '../../src/adapters/redis';
import { windowOf } from '../../src/domain/presence/window';
import type { AlarmInput, FastStore } from '../../src/ports';
import { DependencyUnavailable } from '../../src/ports';
import { createPresenceFaults, faultyFastStore } from '../../src/presence/faults';
import { createNodeIntake, createWindowIntake, PRESENCE_KEY_TTL_MS } from '../../src/presence/intake';
import { createMomentBook } from '../../src/presence/moments';
import type { MomentRow, MomentStore, ProofRow, ProofStore, RightsDb } from '../../src/presence/ports';
import { createProofWriter, FAST_DOWN_ALARM_EVERY_MS, proofMarkerKey, PROOF_RETRY_AFTER_MS, type ProofInput } from '../../src/presence/proofs';

const M = Date.parse('2026-12-31T22:00:00Z');
const MAX_TTL_MS = 172_800_000;

function clockAt(t: number) {
  const c = { t, now: () => c.t };
  return c;
}

/** In-memory `presence_proofs` with call counters; `fail` makes every call throw like a lost database. */
function memoryProofStore() {
  const rows = new Map<string, ProofRow>();
  const k = (r: { subject_id: string; season: string; event_id: string; moment_ms: string }) => `${r.subject_id}|${r.season}|${r.event_id}|${r.moment_ms}`;
  const calls = { insert: 0, upgrade: 0 };
  const state = { fail: false };
  const guard = () => {
    if (state.fail) throw new DependencyUnavailable('postgres');
  };
  const store: ProofStore = {
    async insert(_db, row) {
      guard();
      calls.insert += 1;
      if (rows.has(k(row))) return false;
      rows.set(k(row), { ...row, last_received_at: null });
      return true;
    },
    async upgradeSource(_db, key, source, lower) {
      guard();
      calls.upgrade += 1;
      const r = rows.get(k(key));
      if (!r || !lower.includes(r.source)) return 0;
      r.source = source;
      return 1;
    },
    async touch() {},
    async listForSubject(_db, subject, season) {
      return [...rows.values()].filter((r) => r.subject_id === subject && r.season === season);
    },
  };
  return { store, rows, calls, state };
}

/** A fast store that fails every call. */
function downStore(): FastStore {
  const fail = () => Promise.reject(new DependencyUnavailable('redis'));
  return { incrWindow: fail, setIfAbsent: fail, decrIfPresent: fail, get: fail, set: fail, del: fail, deleteByPrefix: fail };
}

/** Records the TTL of every write. */
function ttlSpy(inner: FastStore) {
  const ttls: number[] = [];
  const store: FastStore = {
    ...inner,
    incrWindow: (key, w) => (ttls.push(w), inner.incrWindow(key, w)),
    setIfAbsent: (key, v, t) => (ttls.push(t), inner.setIfAbsent(key, v, t)),
    set: (key, v, t) => (ttls.push(t), inner.set(key, v, t)),
  };
  return { store, ttls };
}

const db = {} as RightsDb;

function setup(opts: { fast?: FastStore } = {}) {
  const clock = clockAt(M);
  const proofs = memoryProofStore();
  const alarms: AlarmInput[] = [];
  const intake = createNodeIntake();
  const memory = createMemoryStore(clock);
  const spy = ttlSpy(opts.fast ?? memory);
  const faults = createPresenceFaults();
  const writer = createProofWriter({
    db: async () => db,
    fast: () => spy.store,
    store: proofs.store,
    alarm: { raise: (a) => alarms.push(a) },
    clock,
    intake,
    nodeId: 'node-1',
    faults,
  });
  return { clock, proofs, alarms, intake, memory, spy, writer, faults };
}

const beat = (over: Partial<ProofInput> = {}): ProofInput => ({
  subjectId: 'sub-1',
  season: '2026-27',
  eventId: 'ua',
  momentMs: M,
  receivedAt: M - 10_000,
  source: 'tv',
  ...over,
});

describe('proof writer', () => {
  it('first beat inserts once, the tenth does not reach the database (AC-3)', async () => {
    const s = setup();
    expect(await s.writer.record(beat())).toEqual({ ok: true, proof: 'inserted', via: 'fast' });
    for (let i = 0; i < 9; i += 1) expect(await s.writer.record(beat({ receivedAt: M - 9_000 + i }))).toEqual({ ok: true, proof: 'exists', via: 'fast' });
    expect(s.proofs.calls.insert).toBe(1);
    expect(s.proofs.calls.upgrade).toBe(0);
    expect([...s.proofs.rows.values()]).toEqual([
      { subject_id: 'sub-1', season: '2026-27', event_id: 'ua', moment_ms: String(M), first_received_at: String(M - 10_000), last_received_at: null, source: 'tv' },
    ]);
  });

  it('tv then country → country; a lower source never downgrades (AC-9)', async () => {
    const s = setup();
    await s.writer.record(beat({ source: 'tv' }));
    expect(await s.writer.record(beat({ source: 'country' }))).toMatchObject({ ok: true, proof: 'upgraded' });
    expect(await s.writer.record(beat({ source: 'room' }))).toMatchObject({ ok: true, proof: 'exists' });
    expect([...s.proofs.rows.values()][0]?.source).toBe('country');
    expect(await s.memory.get(proofMarkerKey('2026-27', 'ua', M, 'sub-1'))).toBe('country');
  });

  it('after a fast-store flush the proof stays; a higher source still upgrades the old row (AC-12)', async () => {
    const s = setup();
    await s.writer.record(beat({ source: 'tv' }));
    await s.memory.deleteByPrefix('pr:');
    expect(await s.writer.record(beat({ source: 'air' }))).toMatchObject({ ok: true, proof: 'upgraded' });
    expect(s.proofs.rows.size).toBe(1);
    expect([...s.proofs.rows.values()][0]?.source).toBe('air');
  });

  it('throwing fast store → straight to the database without duplicates, alarm once a minute (AC-6)', async () => {
    const s = setup({ fast: downStore() });
    expect(await s.writer.record(beat())).toEqual({ ok: true, proof: 'inserted', via: 'db' });
    expect(await s.writer.record(beat())).toEqual({ ok: true, proof: 'exists', via: 'db' });
    expect(await s.writer.record(beat({ source: 'room' }))).toEqual({ ok: true, proof: 'upgraded', via: 'db' });
    expect(s.proofs.rows.size).toBe(1);
    expect(s.alarms.map((a) => a.code)).toEqual(['presence/fast-store-down']);
    s.clock.t += FAST_DOWN_ALARM_EVERY_MS;
    await s.writer.record(beat());
    expect(s.alarms.map((a) => a.code)).toEqual(['presence/fast-store-down', 'presence/fast-store-down']);
    expect(JSON.stringify(s.alarms)).not.toContain('sub-1');
  });

  it('the fastStore fault behaves like a lost Redis ([П-10])', async () => {
    const s = setup();
    s.faults.apply({ fastStore: 'down' });
    expect(await s.writer.record(beat())).toEqual({ ok: true, proof: 'inserted', via: 'db' });
    expect(await s.memory.get(proofMarkerKey('2026-27', 'ua', M, 'sub-1'))).toBeNull();
  });

  it('both failing → unavailable 5000 and the beat counts as failed (AC-7)', async () => {
    const s = setup({ fast: downStore() });
    s.proofs.state.fail = true;
    expect(await s.writer.recordBeat([beat()])).toEqual({ ok: false, retryAfterMs: PROOF_RETRY_AFTER_MS });
    expect(s.intake.take()).toEqual({ accepted: 0, failed: 1 });
  });

  it('database lost with Redis up → unavailable, and the marker is removed so the next beat retries (AC-3)', async () => {
    const s = setup();
    s.faults.apply({ dbWrite: 'down' });
    expect(await s.writer.recordBeat([beat()])).toEqual({ ok: false, retryAfterMs: PROOF_RETRY_AFTER_MS });
    expect(await s.memory.get(proofMarkerKey('2026-27', 'ua', M, 'sub-1'))).toBeNull();
    s.faults.reset();
    expect(await s.writer.recordBeat([beat()])).toEqual({ ok: true, written: ['inserted'] });
    expect(s.intake.take()).toEqual({ accepted: 1, failed: 1 });
  });

  it('an out-of-window beat writes no proof and still counts as accepted (AC-4)', async () => {
    const s = setup();
    expect(await s.writer.recordBeat([])).toEqual({ ok: true, written: [] });
    expect(s.proofs.calls.insert).toBe(0);
    expect(s.intake.take()).toEqual({ accepted: 1, failed: 0 });
  });
});

describe('window intake (AC-17)', () => {
  const w = { season: '2026-27', eventId: 'ua', momentMs: M };

  it('distinct subjects before and in the window; in counts only subjects seen before', async () => {
    const clock = clockAt(M);
    const memory = createMemoryStore(clock);
    const intake = createWindowIntake(() => memory);
    const pre = M - 120_000;
    const inside = windowOf(M).from;
    for (const s of ['a', 'b', 'c']) await intake.count(w, s, pre);
    await intake.count(w, 'a', pre + 1_000); // the same subject again
    await intake.count(w, 'a', inside);
    await intake.count(w, 'a', inside + 1_000);
    await intake.count(w, 'z', inside); // never seen before the window
    await intake.count(w, 'b', M - 3_600_000); // far before: neither
    expect(await intake.counts(w)).toEqual({ pre: 3, in: 1 });
  });

  it('a lost fast store never throws: count → false, counts → null', async () => {
    const intake = createWindowIntake(() => downStore());
    expect(await intake.count(w, 'a', M)).toBe(false);
    expect(await intake.counts(w)).toBeNull();
  });
});

describe('fast-store keys (AC-56)', () => {
  it('every presence key is written with a TTL ≤ 172 800 s', async () => {
    const s = setup();
    await s.writer.record(beat({ source: 'tv' }));
    await s.writer.record(beat({ source: 'country' }));
    const intake = createWindowIntake(() => s.spy.store);
    const w = { season: '2026-27', eventId: 'ua', momentMs: M };
    await intake.count(w, 'a', M - 120_000);
    await intake.count(w, 'a', M);
    expect(s.spy.ttls.length).toBeGreaterThanOrEqual(6);
    for (const t of s.spy.ttls) expect(t).toBeLessThanOrEqual(MAX_TTL_MS);
    expect(PRESENCE_KEY_TTL_MS).toBeLessThanOrEqual(MAX_TTL_MS);
  });
});

describe('moment book (AC-32)', () => {
  function memoryMoments() {
    const rows: MomentRow[] = [];
    let lists = 0;
    const store: MomentStore = {
      async record(_db, season, eventId, momentMs, seenAt) {
        if (!rows.some((r) => r.season === season && r.event_id === eventId && r.moment_ms === String(momentMs))) {
          rows.push({ season, event_id: eventId, moment_ms: String(momentMs), first_seen_at: String(seenAt) });
        }
      },
      async list(_db, season, eventId) {
        lists += 1;
        return rows.filter((r) => r.season === season && r.event_id === eventId);
      },
    };
    return { store, rows, lists: () => lists };
  }
  const zones = { zones: [{ midnightMs: M }] };

  it('records each moment once and keeps old moments accepted until the celebration ends', async () => {
    const mem = memoryMoments();
    const book = createMomentBook({ db: async () => db, store: mem.store });
    await book.observe('2026-27', [{ eventId: 'ua', momentMs: M }], M - 3_600_000);
    await book.observe('2026-27', [{ eventId: 'ua', momentMs: M }], M - 3_000_000);
    await book.observe('2026-27', [{ eventId: 'ua', momentMs: M + 600_000 }], M - 1_000_000);
    expect(mem.rows.map((r) => r.moment_ms)).toEqual([String(M), String(M + 600_000)]);
    expect(await book.accepted('2026-27', 'ua', M + 600_000, M, zones)).toEqual([M, M + 600_000]);
    expect(await book.accepted('2026-27', 'ua', M + 600_000, M + 600_000 + 3 * 3_600_000, zones)).toEqual([M + 600_000]);
  });

  it('a fresh process reads moments seen by another one from the database', async () => {
    const mem = memoryMoments();
    await createMomentBook({ db: async () => db, store: mem.store }).observe('2026-27', [{ eventId: 'ua', momentMs: M - 600_000 }], M - 3_600_000);
    const other = createMomentBook({ db: async () => db, store: mem.store });
    expect(await other.seen('2026-27', 'ua', M)).toEqual([M - 600_000]);
    await other.seen('2026-27', 'ua', M + 1_000);
    expect(mem.lists()).toBe(1);
  });
});

describe('FastStore.info (AC-14)', () => {
  it('memory store: a fixed run id per store and uptime from the clock', async () => {
    const clock = clockAt(M);
    const a = createMemoryStore(clock);
    const b = createMemoryStore(clock);
    clock.t += 12_500;
    const ia = await a.info!();
    expect(ia.uptimeS).toBe(12);
    expect(ia.runId).not.toBe('');
    expect((await a.info!()).runId).toBe(ia.runId);
    expect((await b.info!()).runId).not.toBe(ia.runId);
  });

  it('faultyFastStore fails info too while the fault is on', async () => {
    const faults = createPresenceFaults();
    const store = faultyFastStore(createMemoryStore(clockAt(M)), faults);
    faults.apply({ fastStore: 'down' });
    await expect(store.info!()).rejects.toBeInstanceOf(DependencyUnavailable);
    await expect(store.get('k')).rejects.toBeInstanceOf(DependencyUnavailable);
    faults.reset();
    expect(await store.get('k')).toBeNull();
  });
});
