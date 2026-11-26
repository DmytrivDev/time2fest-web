/**
 * SPEC-14 W17 — `healthOf`, one case per sign of [А5] (AC-16, AC-17), plus the healthy baselines.
 */
import { describe, expect, it } from 'vitest';
import {
  finaliseDueAt,
  healthOf,
  HEALTH_SIGNS,
  missingRecordAt,
  SAMPLE_INTERVAL_MS,
  samplesSpanOf,
  type HealthDowntime,
  type HealthInput,
  type HealthSample,
} from '../../src/domain/presence/healthSigns';
import { windowOf } from '../../src/domain/presence/window';

const M = Date.parse('2026-12-31T22:00:00Z');
const W = windowOf(M);
const RUN = 'run-a';

/** One sample every 5 s of one node across the whole read span, Redis up for a day, no beats. */
function steady(node = 'n1', over: Partial<HealthSample> = {}): HealthSample[] {
  const span = samplesSpanOf(M);
  const out: HealthSample[] = [];
  for (let at = span.from; at <= span.to; at += SAMPLE_INTERVAL_MS) {
    out.push({ nodeId: node, at, fastReachable: true, fastRunId: RUN, fastUptimeS: 86_400, accepted: 0, failed: 0, ...over });
  }
  return out;
}

const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  eventId: 'e1',
  moment: M,
  samples: steady(),
  counters: { pre: 40, in: 30 },
  downtimes: [],
  ...over,
});

/** Spread `accepted` / `failed` over the samples inside the window. */
function withBeats(samples: HealthSample[], accepted: number, failed: number): HealthSample[] {
  const inside = samples.filter((s) => s.at > W.from && s.at <= W.until);
  return samples.map((s) => {
    const i = inside.indexOf(s);
    if (i !== 0) return s;
    return { ...s, accepted, failed };
  });
}

describe('healthOf (W17)', () => {
  it('a steady window with counters is healthy', () => {
    expect(healthOf(base())).toEqual({ state: 'healthy', signs: [] });
  });

  it('due and missing-record instants follow the window end', () => {
    expect(finaliseDueAt(M)).toBe(W.until + 10_000);
    expect(missingRecordAt(M)).toBe(W.until + 120_000);
  });

  it('fast-store-unavailable: a sample in the window with Redis unreachable', () => {
    const samples = steady().map((s) => (s.at > W.from && s.at < W.from + 6_000 ? { ...s, fastReachable: false, fastRunId: null, fastUptimeS: null } : s));
    expect(healthOf(base({ samples })).signs).toEqual(['fast-store-unavailable']);
  });

  it('fast-store-restart: the run id changes in the counting span', () => {
    const samples = steady().map((s) => (s.at > M ? { ...s, fastRunId: 'run-b' } : s));
    expect(healthOf(base({ samples })).signs).toContain('fast-store-restart');
  });

  it('fast-store-restart: Redis uptime shorter than the age of the counting span', () => {
    const samples = steady().map((s) => ({ ...s, fastUptimeS: 60 }));
    expect(healthOf(base({ samples })).signs).toEqual(['fast-store-restart']);
  });

  it('sample-gap: a live node misses samples for more than 10 s', () => {
    const samples = steady().filter((s) => !(s.at > W.from && s.at < W.from + 16_000));
    expect(healthOf(base({ samples })).signs).toEqual(['sample-gap']);
  });

  it('sample-gap: no samples at all', () => {
    expect(healthOf(base({ samples: [] })).signs).toEqual(['sample-gap']);
  });

  it('a node that stopped before the window is not judged', () => {
    const gone = steady('n2').filter((s) => s.at < W.from - 30_000);
    expect(healthOf(base({ samples: [...steady(), ...gone] }))).toEqual({ state: 'healthy', signs: [] });
  });

  it('beat-errors: 2 % failed → sign; 0.5 % → healthy', () => {
    expect(healthOf(base({ samples: withBeats(steady(), 980, 20) })).signs).toEqual(['beat-errors']);
    expect(healthOf(base({ samples: withBeats(steady(), 995, 5) }))).toEqual({ state: 'healthy', signs: [] });
  });

  it('beat-rate-drop: 40 before / 15 inside → sign; 40/25 and 10/2 → healthy', () => {
    expect(healthOf(base({ counters: { pre: 40, in: 15 } })).signs).toEqual(['beat-rate-drop']);
    expect(healthOf(base({ counters: { pre: 40, in: 25 } })).state).toBe('healthy');
    expect(healthOf(base({ counters: { pre: 10, in: 2 } })).state).toBe('healthy');
  });

  it('beat-rate-drop: missing counters', () => {
    expect(healthOf(base({ counters: null })).signs).toEqual(['beat-rate-drop']);
  });

  it('edge-region: a report overlapping the window; one outside does not count', () => {
    const edge: HealthDowntime = { kind: 'edge-region', eventId: null, from: W.until - 1, to: W.until + 60_000 };
    expect(healthOf(base({ downtimes: [edge] })).signs).toEqual(['edge-region']);
    const before: HealthDowntime = { kind: 'edge-region', eventId: null, from: W.from - 60_000, to: W.from - 1 };
    expect(healthOf(base({ downtimes: [before] })).state).toBe('healthy');
  });

  it('manual: a record of the event, or a range over the window; another event does not count', () => {
    expect(healthOf(base({ downtimes: [{ kind: 'manual', eventId: 'e1', from: 0, to: 1 }] })).signs).toEqual(['manual']);
    expect(healthOf(base({ downtimes: [{ kind: 'manual', eventId: null, from: M - 1, to: M + 1 }] })).signs).toEqual(['manual']);
    expect(healthOf(base({ downtimes: [{ kind: 'manual', eventId: 'e2', from: M - 1, to: M + 1 }] })).state).toBe('healthy');
  });

  it('every sign together comes out in the [А5] order', () => {
    const samples = withBeats(
      steady().map((s) => (s.at > W.from && s.at < W.from + 6_000 ? { ...s, fastReachable: false, fastRunId: 'run-b' } : s)).filter((s) => !(s.at > W.from + 6_000 && s.at < W.from + 20_000)),
      90,
      10,
    );
    const downtimes: HealthDowntime[] = [
      { kind: 'edge-region', eventId: null, from: M, to: M + 1 },
      { kind: 'manual', eventId: 'e1', from: 0, to: 1 },
    ];
    expect(healthOf(base({ samples, counters: null, downtimes })).signs).toEqual([...HEALTH_SIGNS]);
  });
});
