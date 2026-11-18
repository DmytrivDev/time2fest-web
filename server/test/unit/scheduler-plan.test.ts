import { describe, expect, it } from 'vitest';
import { seasonMoments, type SeasonEventInput, type SeasonInput, type SeasonMoment } from '@time2fest/rules/time';
import { consequenceFor, consequenceId, pairKey, seasonRunEpoch } from '../../src/domain/scheduler/consequence';
import { isLagging, lagMs, LAG_ALARM_MS, lateVerdict } from '../../src/domain/scheduler/late';
import {
  assertActionRules,
  buildPlan,
  dueGroups,
  nextDueAt,
  splitLate,
  wakeDelayMs,
  type ActionRule,
  type SchedulePlan,
} from '../../src/domain/scheduler/plan';
import { momentActionsFor, momentsRegistry } from '../../src/registries/moments';

const MIN = 60_000;
const T0 = Date.UTC(2026, 11, 31, 22); // UTC+2 midnight
const T1 = Date.UTC(2026, 11, 31, 23); // UTC+1 midnight (two zones)
const T2 = Date.UTC(2027, 0, 1, 0); // UTC midnight

const EVENTS: SeasonEventInput[] = [
  { eventId: 'e-ua', zoneId: 'utc+2', countryIso: 'UA', momentMs: T0, sortIndex: 1 },
  { eventId: 'e-de', zoneId: 'utc+1-a', countryIso: 'DE', momentMs: T1, sortIndex: 2 },
  { eventId: 'e-fr', zoneId: 'utc+1-b', countryIso: 'FR', momentMs: T1, sortIndex: 1 },
  { eventId: 'e-gb', zoneId: 'utc', countryIso: 'GB', momentMs: T2, sortIndex: 1 },
];

function season(events: SeasonEventInput[] = EVENTS): SeasonInput {
  return {
    seasonId: '2026-27',
    zones: [
      { zoneId: 'utc+2', midnightMs: T0 },
      { zoneId: 'utc+1-a', midnightMs: T1 },
      { zoneId: 'utc+1-b', midnightMs: T1 },
      { zoneId: 'utc', midnightMs: T2 },
    ],
    events,
  };
}

// Sorted by key, as the registry keeps them.
const RULES: ActionRule[] = [
  { key: 'both', kinds: ['zone-midnight', 'event-moment'], late: 'always' },
  { key: 'greet', kinds: ['zone-midnight'], late: { within: 5 * MIN } },
  { key: 'remind', kinds: ['event-reminder'], late: { until: 'event-handover' } },
  { key: 'rh-only', kinds: ['celebration-start'], late: 'always', classes: ['rehearsal'] },
  { key: 'stamp', kinds: ['event-stamp'], late: 'always' },
];

const keysOf = (ms: readonly SeasonMoment[]) => ms.map((x) => x.key);
const plan = (input = season(), cls = 'test') => buildPlan(seasonMoments(input), RULES, cls);

/** Settles every due pair (what a successful run would record). */
function settleAll(p: SchedulePlan, serverNow: number, settled: Set<string>): void {
  for (const g of dueGroups(p, serverNow, settled)) for (const x of g.moments) settled.add(pairKey(g.action, x.key));
}

describe('scheduler plan — grouping and order (AC-24, AC-30)', () => {
  it('AC-30: the two UTC+1 zones and their events form one group per action at one instant', () => {
    const groups = plan().groups.filter((g) => g.at === T1);
    expect(groups.map((g) => g.action)).toEqual(['both', 'greet']);
    expect(keysOf(groups[0]!.moments)).toEqual([
      'zone-midnight:utc+1-a',
      'zone-midnight:utc+1-b',
      'event-moment:e-de',
      'event-moment:e-fr',
    ]);
    expect(keysOf(groups[1]!.moments)).toEqual(['zone-midnight:utc+1-a', 'zone-midnight:utc+1-b']);
  });

  it('keeps the C1 order: groups by instant, equal instants by first moment then row order', () => {
    const p = plan();
    const ats = p.groups.map((g) => g.at);
    expect([...ats].sort((a, b) => a - b)).toEqual(ats);
    expect(plan().groups).toEqual(p.groups); // deterministic
    const stamps = p.groups.find((g) => g.action === 'stamp' && g.moments.length === 2)!;
    expect(keysOf(stamps.moments)).toEqual(['event-stamp:e-fr', 'event-stamp:e-de']); // sortIndex 1 before 2
  });

  it('rows of other classes are not in the plan', () => {
    expect(plan(season(), 'test').rules.has('rh-only')).toBe(false);
    expect(plan(season(), 'rehearsal').groups.some((g) => g.action === 'rh-only')).toBe(true);
  });

  it('AC-24 / AC-26: a patch moving one event by +20 min moves only its moments and keeps every key', () => {
    const before = seasonMoments(season());
    const patched = seasonMoments(season(EVENTS.map((e) => (e.eventId === 'e-de' ? { ...e, momentMs: e.momentMs + 20 * MIN } : e))));
    expect(new Set(keysOf(patched))).toEqual(new Set(keysOf(before)));
    const at = new Map(before.map((x) => [x.key, x.at]));
    for (const x of patched) {
      const delta = x.at - at.get(x.key)!;
      expect(delta).toBe(x.eventId === 'e-de' ? 20 * MIN : 0);
    }
    // Pairs settled before the patch are not repeated; the rest run at the new moment.
    const settled = new Set([pairKey('both', 'event-moment:e-de')]);
    const p = buildPlan(patched, RULES, 'test');
    const atNew = dueGroups(p, T1 + 20 * MIN, settled).filter((g) => g.at === T1 + 20 * MIN);
    expect(atNew.map((g) => [g.action, keysOf(g.moments)])).toEqual([]);
    const stampDe = dueGroups(p, T1 + 40 * MIN, settled).find((g) => g.action === 'stamp' && g.moments[0]?.eventId === 'e-de');
    expect(stampDe?.at).toBe(T1 + 20 * MIN + (before.find((x) => x.key === 'event-stamp:e-de')!.at - T1));
  });
});

describe('scheduler plan — exactly-once across jumps (AC-26, AC-36, AC-37, AC-38)', () => {
  it('AC-37: a backward jump does not repeat settled pairs; a new run epoch does', () => {
    const p = plan();
    const settled = new Set<string>();
    settleAll(p, T1 + MIN, settled);
    expect(settled.size).toBeGreaterThan(0);
    expect(dueGroups(p, T0 - 1, settled)).toEqual([]); // jumped back
    expect(dueGroups(p, T1 + MIN, settled)).toEqual([]); // and forward over the same moments again
    const fresh = dueGroups(p, T1 + MIN, new Set()); // restart-night: new epoch, empty ledger
    expect(fresh.length).toBeGreaterThan(0);
    const g = fresh[0]!;
    expect(consequenceId(g.action, 2, keysOf(g.moments))).not.toBe(consequenceId(g.action, 1, keysOf(g.moments)));
  });

  it('AC-36: a forward jump makes everything in between due, then the late rules decide', () => {
    const p = plan();
    const now = T2 + 2 * MIN;
    const due = dueGroups(p, now, new Set());
    const verdicts = due.map((g) => [g.action, g.at, splitLate(p, g, now)] as const);
    const greet = verdicts.filter(([a]) => a === 'greet');
    expect(greet.map(([, at, s]) => [at, s.run.length, s.skip.map((k) => k.verdict.reason)])).toEqual([
      [T0, 0, ['within-exceeded']],
      [T1, 0, ['within-exceeded', 'within-exceeded']],
      [T2, 1, []],
    ]);
    // `always`: every stamp runs whatever the lateness (AC-33).
    expect(verdicts.filter(([a]) => a === 'stamp').every(([, , s]) => s.skip.length === 0 && s.run.length > 0)).toBe(true);
    // `until: event-handover`: only the reminder whose handover is still ahead runs (AC-35).
    const remind = verdicts.filter(([a]) => a === 'remind').map(([, , s]) => [keysOf(s.run), s.skip.map((k) => k.verdict.reason)]);
    expect(remind).toEqual([
      [[], ['until-passed']],
      [[], ['until-passed', 'until-passed']],
      [['event-reminder:e-gb'], []],
    ]);
  });

  it('within is strict (> limit); until missing for the subject → skipped, season-wide kind → used', () => {
    expect(lateVerdict({ within: 5 * MIN }, 0, 5 * MIN)).toEqual({ run: true, lateMs: 5 * MIN });
    expect(lateVerdict({ within: 5 * MIN }, 0, 5 * MIN + 1).run).toBe(false);
    const rules: ActionRule[] = [
      { key: 'a', kinds: ['zone-midnight'], late: { until: 'event-handover' } },
      { key: 'b', kinds: ['zone-midnight'], late: { until: 'celebration-end' } },
    ];
    const p = buildPlan(seasonMoments(season()), rules, 'test');
    const [a, b] = dueGroups(p, T0, new Set());
    expect(splitLate(p, a!, T0).skip[0]?.verdict.reason).toBe('until-missing');
    expect(splitLate(p, b!, T0).run.length).toBe(1);
  });

  it('AC-38: frozen virtual time runs nothing and raises no lag', () => {
    const p = plan();
    expect(dueGroups(p, T2 + MIN, new Set(), { frozen: true })).toEqual([]);
    expect(lagMs(T0, T2, 0)).toBe(0);
    expect(isLagging(T0, T2, 0)).toBe(false);
  });

  it('`since` drops groups before the start of a fresh run', () => {
    const due = dueGroups(plan(), T1 + MIN, new Set(), { since: T1 });
    expect(due.every((g) => g.at >= T1)).toBe(true);
    expect(due.length).toBeGreaterThan(0);
  });
});

describe('scheduler consequence ids (AC-28, AC-29, C4)', () => {
  it('same keys in any order → same id; other epoch or action → other id', () => {
    const id = consequenceId('greet', 3, ['zone-midnight:b', 'zone-midnight:a']);
    expect(id).toMatch(/^greet:3:[0-9a-f]{16}$/);
    expect(consequenceId('greet', 3, ['zone-midnight:a', 'zone-midnight:b', 'zone-midnight:a'])).toBe(id);
    expect(consequenceId('greet', 4, ['zone-midnight:a', 'zone-midnight:b'])).not.toBe(id);
    expect(consequenceId('other', 3, ['zone-midnight:a', 'zone-midnight:b'])).not.toBe(id);
    expect(() => consequenceId('greet', 3, [])).toThrow();
  });

  it('AC-29: a retry after a crash reproduces the id, from the keys or from the started rows', () => {
    const p = plan();
    const g = dueGroups(p, T1, new Set()).find((x) => x.action === 'both' && x.at === T1)!;
    const keys = keysOf(g.moments);
    const first = consequenceFor('both', 7, keys);
    // Crash after publishing: rows stay `started` with `first`; nothing settled → same keys, same id.
    const retry = dueGroups(p, T1 + 30_000, new Set()).find((x) => x.action === 'both' && x.at === T1)!;
    expect(consequenceFor('both', 7, keysOf(retry.moments))).toBe(first);
    // The group shrank meanwhile (one key settled elsewhere): the started id is still reused.
    const started = new Map(keys.map((k) => [pairKey('both', k), first]));
    expect(consequenceFor('both', 7, keys.slice(1), started)).toBe(first);
    // Mixed started ids → computed afresh.
    started.set(pairKey('both', keys[1]!), 'both:7:0000000000000000');
    expect(consequenceFor('both', 7, keys.slice(0, 2), started)).toBe(consequenceId('both', 7, keys.slice(0, 2)));
  });

  it('production run epoch is the season start year', () => {
    expect(seasonRunEpoch('2026-27')).toBe(2026);
    expect(() => seasonRunEpoch('2026')).toThrow();
  });
});

describe('scheduler timing helpers (AC-39)', () => {
  it('lag is server lateness ÷ speed, bounded by real time observed due', () => {
    expect(lagMs(0, 600 * 3_000, 600)).toBe(3_000);
    expect(lagMs(0, 60 * MIN, 1, 500)).toBe(500); // a +1 h jump is not 1 h of lag
    expect(isLagging(0, LAG_ALARM_MS, 1)).toBe(false);
    expect(isLagging(0, LAG_ALARM_MS + 1, 1)).toBe(true);
  });

  it('next due instant and wake delay', () => {
    const p = plan();
    const first = p.groups[0]!.at;
    expect(nextDueAt(p, first - 1, new Set())).toBe(first);
    expect(nextDueAt(p, Number.MAX_SAFE_INTEGER, new Set())).toBeNull();
    expect(wakeDelayMs(first, first - 600_000, 600, 250)).toBe(250);
    expect(wakeDelayMs(first, first - 60_000, 600, 250)).toBe(100);
    expect(wakeDelayMs(first, first - 1, 0, 250)).toBe(250);
    expect(wakeDelayMs(null, 0, 1, 250)).toBe(250);
  });
});

describe('moment-action registry (C5, AC-73)', () => {
  it('holds only the run recorder (SPEC-07 W29) and filters by class', () => {
    expect(momentsRegistry.map((r) => r.key)).toEqual(['run-recorder']);
    expect(momentActionsFor('production')).toEqual([]);
  });

  it('rejects malformed rows', () => {
    expect(() => assertActionRules(RULES)).not.toThrow();
    expect(() => assertActionRules([{ key: 'Bad Key', kinds: ['zone-midnight'], late: 'always' }])).toThrow(/kebab/);
    expect(() => assertActionRules([{ key: 'x', kinds: [], late: 'always' }])).toThrow(/no moment kinds/);
    expect(() => assertActionRules([{ key: 'x', kinds: ['pin-end', 'pin-end'], late: 'always' }])).toThrow(/duplicate/);
    expect(() => assertActionRules([{ key: 'x', kinds: ['pin-end'], late: { within: 0 } }])).toThrow(/within/);
  });
});

describe('NFR-6: 5 000 moments recomputed within 200 ms', () => {
  it('seasonMoments + buildPlan + dueGroups', () => {
    const zones = Array.from({ length: 40 }, (_, i) => ({ zoneId: `z${i}`, midnightMs: T0 + i * 15 * MIN }));
    const events = Array.from({ length: 1210 }, (_, i) => ({
      eventId: `e${i}`,
      zoneId: `z${i % 40}`,
      countryIso: 'XX',
      momentMs: T0 + (i % 40) * 15 * MIN,
      sortIndex: i,
    }));
    const input: SeasonInput = { seasonId: '2026-27', zones, events };
    const run = () => {
      const p = buildPlan(seasonMoments(input), RULES, 'test');
      return dueGroups(p, T0 + 5 * 60 * MIN, new Set()).length;
    };
    run(); // warm once
    const start = performance.now();
    const moments = seasonMoments(input).length;
    run();
    const elapsed = performance.now() - start;
    expect(moments).toBeGreaterThanOrEqual(5_000);
    expect(elapsed).toBeLessThan(200);
  });
});
