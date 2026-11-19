/**
 * Shared boundary suite (SPEC-03 AC-20 … AC-32, NFR-2). It imports only `vitest` and `@time2fest/rules/time`, so the
 * server runs it unchanged against the same module.
 */
import { describe, expect, it } from 'vitest';
import * as rules from '@time2fest/rules/time';
import {
  CELEBRATION_LEAD,
  CELEBRATION_TAIL,
  RATING_CLOSE_AFTER,
  RATING_OPEN_AFTER,
  SERVER_CLOCK_TOLERANCE_MS,
  STAMP_DELAY,
  arrivedYear,
  canSayToast,
  currentSlotIndex,
  eventStatus,
  isCelebrating,
  isPresentByPulses,
  isRatingClosed,
  isRatingOpenFor,
  momentTimeline,
  pinnedUntilAt,
  ratingCloseAt,
  stampAcceptUntil,
  toastSeason,
  zoneState,
} from '@time2fest/rules/time';

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const I = 20 * SEC;
const D = SERVER_CLOCK_TOLERANCE_MS;

describe('AC-21 server default Δ', () => {
  it('is 1500 ms', () => {
    expect(SERVER_CLOCK_TOLERANCE_MS).toBe(1500);
  });
});

describe('AC-27 FR-STAMP-03 cases (I = 20 s, Δ = 1500 ms)', () => {
  const m = Date.parse('2027-01-01T00:00:00Z');
  const present = (pulses: readonly rules.Pulse[]) => isPresentByPulses({ moment: m, pulses, intervalMs: I, delta: D });

  it('pulse 1 s before midnight — counted', () => {
    expect(present([{ receivedAt: m - SEC }])).toBe(true);
  });
  it('page opened at m + 14 s with the first pulse at m + 14 s — counted', () => {
    expect(present([{ receivedAt: m + 14 * SEC, openedAt: m + 14 * SEC, at: m + 14 * SEC }])).toBe(true);
  });
  it('one missed pulse (received m − 40 s, m − 20 s lost, page closed before m) — counted', () => {
    expect(present([{ receivedAt: m - 40 * SEC }])).toBe(true);
  });
  it('script pulse with openedAt 23:50 local, received at m − 5 min — not counted', () => {
    expect(present([{ receivedAt: m - 5 * MIN, openedAt: m - 10 * MIN, at: m - 5 * MIN }])).toBe(false);
  });
});

describe('AC-28 Kiribati (UTC+14) / Chatham (UTC+13:45)', () => {
  const kiribati = { midnightMs: Date.parse('2026-12-31T10:00:00Z') };
  const chatham = { midnightMs: Date.parse('2026-12-31T10:15:00Z') };
  const nz = { midnightMs: Date.parse('2026-12-31T11:00:00Z') };
  const zones = [kiribati, chatham, nz];
  const T = Date.parse('2026-12-31T10:15:00Z');

  it('m(Kiribati) + 15 min = m(Chatham)', () => {
    expect(kiribati.midnightMs + 15 * MIN).toBe(chatham.midnightMs);
  });
  it('1 ms before — Kiribati is still the slot', () => {
    expect(currentSlotIndex(T - 1, zones)).toBe(0);
    expect(zoneState(T - 1, kiribati, zones)).toBe('live');
    expect(zoneState(T - 1, chatham, zones)).toBe('next');
  });
  it.each([0, 1])('at T + %i ms — Chatham is the slot, Kiribati past', (dt) => {
    expect(currentSlotIndex(T + dt, zones)).toBe(1);
    expect(zoneState(T + dt, kiribati, zones)).toBe('past');
    expect(zoneState(T + dt, chatham, zones)).toBe('live');
  });
});

describe('AC-29 Nepal (UTC+5:45) / India (UTC+5:30)', () => {
  const nepal = { midnightMs: Date.parse('2026-12-31T18:15:00Z') };
  const india = { midnightMs: Date.parse('2026-12-31T18:30:00Z') };
  const myanmarBefore = { midnightMs: Date.parse('2026-12-31T17:30:00Z') };
  const bangladeshAfter = { midnightMs: Date.parse('2026-12-31T19:00:00Z') };
  const zones = [myanmarBefore, nepal, india, bangladeshAfter];
  const T = Date.parse('2026-12-31T18:30:00Z');

  it('m(Nepal) + 15 min = m(India)', () => {
    expect(nepal.midnightMs + 15 * MIN).toBe(india.midnightMs);
  });
  it('1 ms before — Nepal is still the slot', () => {
    expect(currentSlotIndex(T - 1, zones)).toBe(1);
    expect(zoneState(T - 1, nepal, zones)).toBe('live');
  });
  it.each([0, 1])('at T + %i ms — India is the slot, Nepal past', (dt) => {
    expect(currentSlotIndex(T + dt, zones)).toBe(2);
    expect(zoneState(T + dt, nepal, zones)).toBe('past');
    expect(zoneState(T + dt, india, zones)).toBe('live');
  });
});

describe('AC-30 UTC+1 at 2026-12-31T23:00:00Z', () => {
  const m = Date.parse('2026-12-31T23:00:00Z');
  const ev = { id: 'utc1', midnightUtc: '2026-12-31T23:00:00Z' };
  const zone = { midnightMs: m };
  const zones = [{ midnightMs: m - HOUR }, zone, { midnightMs: m + HOUR }];

  it('event is live, arrived year is 2027, zone not past', () => {
    expect(eventStatus(m, ev)).toBe('live');
    expect(arrivedYear(m, 60)).toBe(2027);
    expect(arrivedYear(m)).toBe(2027);
    expect(zoneState(m, zone, zones)).not.toBe('past');
  });
});

describe('AC-31 empty zone list behaves as on master 3f2389f', () => {
  const empty = { zones: [] };
  const now = Date.parse('2026-12-31T12:00:00Z');
  it('celebration, season, pin, rating close — no throw, master values', () => {
    expect(isCelebrating(now, empty)).toBe(false);
    expect(canSayToast(now, empty)).toBe(false);
    expect(toastSeason(now, empty)).toBe('before');
    expect(pinnedUntilAt(now, [])).toBeNull();
    expect(ratingCloseAt(empty)).toBe(-Infinity);
    expect(isRatingClosed(now, empty)).toBe(true);
  });
});

describe('AC-32 Δ = 1500 ms open and close examples', () => {
  const m = Date.parse('2027-01-01T00:00:00Z');
  const last = Date.parse('2027-01-01T11:00:00Z');
  const data = { zones: [{ midnightMs: Date.parse('2026-12-31T10:00:00Z') }, { midnightMs: m }, { midnightMs: last }] };

  it('rating open at m + 13.5 s, not at m + 13.499 s', () => {
    expect(isRatingOpenFor(m + 13_500, m, D)).toBe(true);
    expect(isRatingOpenFor(m + 13_499, m, D)).toBe(false);
  });
  it('rating still open at last + 12 h + 1.499 s, closed at + 1.5 s', () => {
    expect(isRatingClosed(last + 12 * HOUR + 1_499, data, D)).toBe(false);
    expect(isRatingClosed(last + 12 * HOUR + 1_500, data, D)).toBe(true);
  });
  it('toast payment start allowed at last + 2 h + 1.5 s, refused at + 1.501 s', () => {
    expect(canSayToast(last + 2 * HOUR + 1_500, data, D)).toBe(true);
    expect(canSayToast(last + 2 * HOUR + 1_501, data, D)).toBe(false);
  });
});

describe('AC-20 Δ shifts only the shiftable bounds, in the person’s favour', () => {
  const m = Date.parse('2027-01-01T00:00:00Z');
  const first = Date.parse('2026-12-31T10:00:00Z');
  const data = { zones: [{ midnightMs: first }, { midnightMs: m }] };
  const end = m + CELEBRATION_TAIL;

  it('celebration end (toast payment start) moves 1500 ms later', () => {
    expect(isCelebrating(end + D, data)).toBe(false);
    expect(isCelebrating(end + D, data, D)).toBe(true);
    expect(isCelebrating(end + D + 1, data, D)).toBe(false);
    expect(toastSeason(end + D, data, D)).toBe('during');
    expect(toastSeason(end + D + 1, data, D)).toBe('after');
  });
  it('celebration start does not move', () => {
    const start = first - CELEBRATION_LEAD;
    expect(isCelebrating(start - 1, data, D)).toBe(false);
    expect(isCelebrating(start, data, D)).toBe(true);
  });
  it('rating close moves 1500 ms later', () => {
    const close = m + RATING_CLOSE_AFTER;
    expect(isRatingClosed(close, data)).toBe(true);
    expect(isRatingClosed(close + D - 1, data, D)).toBe(false);
    expect(isRatingClosed(close + D, data, D)).toBe(true);
  });
  it('rating open moves 1500 ms earlier', () => {
    const open = m + RATING_OPEN_AFTER;
    expect(isRatingOpenFor(open - D, m)).toBe(false);
    expect(isRatingOpenFor(open - D, m, D)).toBe(true);
    expect(isRatingOpenFor(open - D - 1, m, D)).toBe(false);
  });
  it('stamp accept bound moves 1500 ms later', () => {
    expect(stampAcceptUntil(m, D) - stampAcceptUntil(m)).toBe(D);
    expect(stampAcceptUntil(m)).toBe(m + STAMP_DELAY);
  });
  it('pulse window widens by 1500 ms on both sides', () => {
    const p = (receivedAt: number, delta?: number) =>
      isPresentByPulses({ moment: m, pulses: [{ receivedAt }], intervalMs: I, delta });
    expect(p(m - 2 * I - D)).toBe(false);
    expect(p(m - 2 * I - D, D)).toBe(true);
    expect(p(m - 2 * I - D - 1, D)).toBe(false);
    expect(p(m + STAMP_DELAY + D)).toBe(false);
    expect(p(m + STAMP_DELAY + D, D)).toBe(true);
    expect(p(m + STAMP_DELAY + D + 1, D)).toBe(false);
  });
  it('eventStatus, momentTimeline, currentSlotIndex, zoneState take no Δ and ignore an extra one', () => {
    const ev = { id: 'e', midnightUtc: '2027-01-01T00:00:00Z' };
    const zones = data.zones;
    const loose = <F>(f: F) => f as unknown as (...args: unknown[]) => unknown;
    expect(eventStatus.length).toBe(2);
    expect(momentTimeline.length).toBe(1);
    expect(currentSlotIndex.length).toBe(2);
    expect(zoneState.length).toBe(3);
    for (const now of [m - 15 * MIN, m - 1, m, m + 15 * MIN - 1, m + 15 * MIN, m + 30 * MIN]) {
      expect(loose(eventStatus)(now, ev, D)).toEqual(eventStatus(now, ev));
      expect(loose(currentSlotIndex)(now, zones, D)).toEqual(currentSlotIndex(now, zones));
      expect(loose(zoneState)(now, zones[1], zones, D)).toEqual(zoneState(now, zones[1]!, zones));
    }
    expect(loose(momentTimeline)(ev, D)).toEqual(momentTimeline(ev));
  });
});

describe('AC-21 a call without Δ equals the call with Δ = 0', () => {
  const m = Date.parse('2027-01-01T00:00:00Z');
  const data = { zones: [{ midnightMs: m - HOUR }, { midnightMs: m }] };
  const times = [m - 3 * HOUR, m, m + RATING_OPEN_AFTER - 1, m + RATING_OPEN_AFTER, m + CELEBRATION_TAIL, m + CELEBRATION_TAIL + 1, m + RATING_CLOSE_AFTER];

  it.each(times)('at %i', (now) => {
    expect(isCelebrating(now, data)).toBe(isCelebrating(now, data, 0));
    expect(canSayToast(now, data)).toBe(canSayToast(now, data, 0));
    expect(toastSeason(now, data)).toBe(toastSeason(now, data, 0));
    expect(isRatingOpenFor(now, m)).toBe(isRatingOpenFor(now, m, 0));
    expect(isRatingClosed(now, data)).toBe(isRatingClosed(now, data, 0));
    const pulses = [{ receivedAt: now }];
    expect(isPresentByPulses({ moment: m, pulses, intervalMs: I })).toBe(
      isPresentByPulses({ moment: m, pulses, intervalMs: I, delta: 0 }),
    );
  });
  it('stampAcceptUntil', () => {
    expect(stampAcceptUntil(m)).toBe(stampAcceptUntil(m, 0));
  });
});

describe('NFR-2 no module state: equal arguments give equal results', () => {
  const m = Date.parse('2027-01-01T00:00:00Z');
  const ev = { id: 'e', midnightUtc: '2027-01-01T00:00:00Z' };
  const next = { id: 'n', midnightUtc: '2027-01-01T01:00:00Z' };
  const zones = [{ midnightMs: m - HOUR }, { midnightMs: m }, { midnightMs: m + HOUR }];
  const data = { zones };
  const midnights = zones.map((z) => z.midnightMs);
  const surface = { source: 'room' as const, eventIds: ['e'], openedAt: m - MIN };
  const now = m + 20 * SEC;

  const calls: Record<string, () => unknown> = {
    arrivedYear: () => rules.arrivedYear(m, 120),
    assertPulseInterval: () => rules.assertPulseInterval(I),
    assertTolerance: () => rules.assertTolerance(D),
    canSayToast: () => rules.canSayToast(now, data, D),
    captionPhase: () => rules.captionPhase(m + 14 * MIN, ev, 'broadcast', next),
    currentSlotIndex: () => rules.currentSlotIndex(now, zones),
    defaultCountryZone: () => rules.defaultCountryZone(now, zones),
    eventStatus: () => rules.eventStatus(now, ev),
    handoverMoment: () => rules.handoverMoment(m),
    isCelebrating: () => rules.isCelebrating(now, data, D),
    isInReminderWindow: () => rules.isInReminderWindow(now, m),
    isPresentByPulses: () => rules.isPresentByPulses({ moment: m, pulses: [{ receivedAt: now }], intervalMs: I, delta: D }),
    isRatingClosed: () => rules.isRatingClosed(now, data, D),
    isRatingOpenFor: () => rules.isRatingOpenFor(now, m, D),
    isScheduleClosed: () => rules.isScheduleClosed(now, m),
    isStampTooOldToCelebrate: () => rules.isStampTooOldToCelebrate(now, m + STAMP_DELAY),
    isTooCloseToNextForOffer: () => rules.isTooCloseToNextForOffer(now, m + HOUR),
    isZonePast: () => rules.isZonePast(now, m),
    midnightOf: () => rules.midnightOf(ev),
    momentStage: () => rules.momentStage(now, rules.momentTimeline(ev)),
    momentState: () => rules.momentState(now, rules.momentTimeline(ev), { rateInteracting: true }),
    momentTimeline: () => rules.momentTimeline(ev),
    nextMidnightAfter: () => rules.nextMidnightAfter(now, midnights),
    offerEarliestAt: () => rules.offerEarliestAt(m),
    pinnedUntilAt: () => rules.pinnedUntilAt(now, midnights),
    pollWindow: () => rules.pollWindow(m),
    presenceMoment: () => rules.presenceMoment(surface, ev),
    presenceOf: () => rules.presenceOf(surface, now, ev),
    presentEvents: () => rules.presentEvents([surface], [ev], now),
    prevMidnightAtOrBefore: () => rules.prevMidnightAtOrBefore(now, midnights),
    ratingCloseAt: () => rules.ratingCloseAt(data),
    seasonMoments: () => rules.seasonMoments({ seasonId: 's', zones: [{ zoneId: 'z', midnightMs: m }], events: [{ eventId: 'e', zoneId: 'z', countryIso: 'XX', momentMs: m, sortIndex: 0 }] }),
    stampAcceptUntil: () => rules.stampAcceptUntil(m, D),
    stampGrantedAt: () => rules.stampGrantedAt(m),
    toRuntime: () => rules.toRuntime(now, { id: 'e', midnightUtc: ev.midnightUtc, midnightMs: m }),
    toastSeason: () => rules.toastSeason(now, data, D),
    toastsOpenAt: () => rules.toastsOpenAt(data),
    zonePassedHandover: () => rules.zonePassedHandover(now, m),
    zoneState: () => rules.zoneState(now, zones[1]!, zones),
  };

  it('covers every exported function', () => {
    const exported = Object.entries(rules)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .sort();
    expect(Object.keys(calls).sort()).toEqual(exported);
  });
  it.each(Object.keys(calls))('%s', (name) => {
    const call = calls[name]!;
    expect(call()).toEqual(call());
  });
});
