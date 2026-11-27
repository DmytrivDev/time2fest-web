// SPEC-14 W11 — pure presence rules: beat schedule (AC-2), window membership through the rules (AC-4, AC-10, AC-11),
// source priority (AC-9), event validity (AC-8, AC-28), accepted old moments ([А9], AC-32).
import { isPresentByPulses, PULSE_INTERVAL_MS, SERVER_CLOCK_TOLERANCE_MS, stampAcceptUntil } from '@time2fest/rules/time';
import { describe, expect, it } from 'vitest';
import { nextBeatMs } from '../../src/domain/presence/beatSchedule';
import { presenceCatalogOf, validEvent } from '../../src/domain/presence/eventValidity';
import { higherSource, SOURCES_BY_PRIORITY, sourcesBelow } from '../../src/domain/presence/source';
import {
  acceptedMomentsOf,
  celebrationOver,
  inWindow,
  phaseOf,
  PRESENCE_DELTA_MS,
  windowOf,
  windowsContaining,
} from '../../src/domain/presence/window';

const M = Date.parse('2026-12-31T22:00:00Z');
const MIN = 60_000;

describe('nextBeatMs (AC-2)', () => {
  it.each([
    ['m − 1 h', M - 60 * MIN, 900_000],
    ['m − 4 min', M - 4 * MIN, 60_000],
    ['m − 30 s', M - 30_000, 20_000],
    ['m + 20 s', M + 20_000, null],
  ])('%s', (_label, now, expected) => {
    expect(nextBeatMs(now, [M])).toBe(expected);
  });

  it('counts down to m − 5 min when closer than 20 min, capped at 15 min', () => {
    expect(nextBeatMs(M - 10 * MIN, [M])).toBe(5 * MIN);
    expect(nextBeatMs(M - 20 * MIN, [M])).toBe(15 * MIN);
  });

  it('switches at the bounds: m − 5 min → 60 s, m − 2 min → I, m + 15 s + Δ → I, one ms later → null', () => {
    expect(nextBeatMs(M - 5 * MIN - 1, [M])).toBe(1);
    expect(nextBeatMs(M - 5 * MIN, [M])).toBe(60_000);
    expect(nextBeatMs(M - 2 * MIN - 1, [M])).toBe(60_000);
    expect(nextBeatMs(M - 2 * MIN, [M])).toBe(PULSE_INTERVAL_MS);
    const end = stampAcceptUntil(M, SERVER_CLOCK_TOLERANCE_MS);
    expect(nextBeatMs(end, [M])).toBe(PULSE_INTERVAL_MS);
    expect(nextBeatMs(end + 1, [M])).toBeNull();
  });

  it('uses the nearest moment still accepting presence; no events → null (AC-8)', () => {
    expect(nextBeatMs(M + 10_000, [M, M + 3_600_000])).toBe(PULSE_INTERVAL_MS);
    expect(nextBeatMs(M + 20_000, [M, M + 3_600_000])).toBe(900_000);
    expect(nextBeatMs(M, [])).toBeNull();
    expect(nextBeatMs(M, [Number.NaN])).toBeNull();
  });
});

describe('window (AC-4, AC-10, AC-11)', () => {
  const rule = (receivedAt: number) =>
    isPresentByPulses({ moment: M, pulses: [{ receivedAt }], intervalMs: PULSE_INTERVAL_MS, delta: SERVER_CLOCK_TOLERANCE_MS });

  it('Δ is the shared server tolerance', () => {
    expect(PRESENCE_DELTA_MS).toBe(SERVER_CLOCK_TOLERANCE_MS);
  });

  it('bounds are the rule’s own: from and until are in, one ms outside is out', () => {
    const w = windowOf(M);
    expect(w.until).toBe(stampAcceptUntil(M, SERVER_CLOCK_TOLERANCE_MS));
    for (const t of [w.from, w.until, M]) expect([inWindow(t, M), rule(t)]).toEqual([true, true]);
    for (const t of [w.from - 1, w.until + 1]) expect([inWindow(t, M), rule(t)]).toEqual([false, false]);
  });

  it('only the receipt time decides: a client openedAt/at inside the window does not count (AC-11)', () => {
    const outside = windowOf(M).from - 5_000;
    expect(isPresentByPulses({ moment: M, pulses: [{ receivedAt: outside, openedAt: M, at: M }], intervalMs: PULSE_INTERVAL_MS, delta: PRESENCE_DELTA_MS })).toBe(false);
    expect(inWindow(outside, M)).toBe(false);
  });

  it('phase: pre in [m − 5 min; from), in inside, null elsewhere (AC-17)', () => {
    const w = windowOf(M);
    expect(phaseOf(M - 5 * MIN, M)).toBe('pre');
    expect(phaseOf(M - 5 * MIN - 1, M)).toBeNull();
    expect(phaseOf(w.from - 1, M)).toBe('pre');
    expect(phaseOf(w.from, M)).toBe('in');
    expect(phaseOf(w.until + 1, M)).toBeNull();
  });

  it('windowsContaining picks every moment whose window holds the receipt', () => {
    expect(windowsContaining(M, [M, M + 10_000, M + 3_600_000])).toEqual([M, M + 10_000]);
  });
});

describe('accepted moments ([А9], AC-32)', () => {
  const zones = { zones: [{ midnightMs: M - 3_600_000 }, { midnightMs: M }] };
  const end = M + 2 * 3_600_000 + SERVER_CLOCK_TOLERANCE_MS;

  it('old moments count until the celebration is over, the current one always', () => {
    expect(acceptedMomentsOf(M, [M - 600_000, M, Number.NaN], M, zones)).toEqual([M - 600_000, M]);
    expect(celebrationOver(end, zones)).toBe(false);
    expect(celebrationOver(end + 1, zones)).toBe(true);
    expect(acceptedMomentsOf(M, [M - 600_000], end + 1, zones)).toEqual([M]);
  });
});

describe('source priority (AC-9)', () => {
  it('country > room > air > tv, read off the rules', () => {
    expect(SOURCES_BY_PRIORITY).toEqual(['country', 'room', 'air', 'tv']);
    expect(higherSource('tv', 'country')).toBe('country');
    expect(higherSource('room', 'air')).toBe('room');
    expect(sourcesBelow('room')).toEqual(['air', 'tv']);
    expect(sourcesBelow('tv')).toEqual([]);
  });
});

describe('event validity (AC-8, AC-28)', () => {
  const rows = [
    { eventId: 'a' },
    { eventId: 'b', slot: 'midnight' },
    { eventId: 'c', slot: 'noon' },
    { eventId: 'd', slot: 'midnight' },
    { eventId: 'e', hidden: true },
  ];
  const patched = ['a', 'b', 'c', 'd', 'e', 'x'].map((id) => ({
    eventId: id,
    countryIso: 'UA',
    zoneId: 'z',
    moment: id === 'b' ? M + 60_000 : M,
    hidden: id === 'd',
  }));

  it('season catalog, midnight slot, not hidden after the patch; moment is the effective one', () => {
    const cat = presenceCatalogOf('2026-27', rows, patched);
    expect([...cat.events.keys()].sort()).toEqual(['a', 'b']);
    expect(validEvent(cat, 'b')?.momentMs).toBe(M + 60_000);
    for (const id of ['c', 'd', 'e', 'x']) expect(validEvent(cat, id)).toBeNull();
  });

  it('no season → no valid event', () => {
    expect(presenceCatalogOf(null, rows, patched).events.size).toBe(0);
  });
});
