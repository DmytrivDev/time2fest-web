/** SPEC-07 AC-19…AC-22: the season moments enumerator. */
import { describe, expect, it } from 'vitest';
import {
  CELEBRATION_LEAD,
  CELEBRATION_TAIL,
  HANDOVER_AFTER,
  HOWTO_BEFORE,
  POLL_WINDOW_AFTER,
  POLL_WINDOW_BEFORE,
  RATING_CLOSE_AFTER,
  STAMP_DELAY,
  pollWindow,
  seasonMoments,
  type SeasonInput,
} from '@time2fest/rules/time';

const H = 3_600_000;
const MIN = 60_000;
const UTC = Date.UTC(2026, 11, 31, 0, 0, 0);
// Kiribati UTC+14 midnight 10:00 UTC on 31.12; Chatham UTC+13:45 midnight 10:15 UTC.
const KIR = Date.UTC(2026, 11, 31, 10, 0, 0);
const CHA = KIR + 15 * MIN;
const IND = Date.UTC(2026, 11, 31, 18, 30, 0);
const NPL = Date.UTC(2026, 11, 31, 18, 15, 0);

const catalog = (shift = 0): SeasonInput => ({
  seasonId: 's2026',
  zones: [
    { zoneId: 'z-kir', midnightMs: KIR },
    { zoneId: 'z-cha', midnightMs: CHA },
  ],
  events: [
    { eventId: 'e-kir', zoneId: 'z-kir', countryIso: 'KI', momentMs: KIR + shift, sortIndex: 1 },
    { eventId: 'e-cha', zoneId: 'z-cha', countryIso: 'NZ', momentMs: CHA + shift, sortIndex: 2 },
  ],
});

describe('AC-19 the season list', () => {
  it('small catalog gives the full expected list', () => {
    const list = seasonMoments(catalog()).map((m) => [m.key, m.at]);
    expect(list).toEqual([
      ['celebration-start:s2026', KIR - CELEBRATION_LEAD],
      ['poll-start:z-kir', KIR - H],
      ['poll-start:z-cha', CHA - H],
      ['event-reminder:e-kir', KIR - HOWTO_BEFORE],
      ['pin-end:z-kir', KIR],
      ['zone-midnight:z-kir', KIR],
      ['event-moment:e-kir', KIR],
      ['event-reminder:e-cha', CHA - HOWTO_BEFORE],
      ['event-stamp:e-kir', KIR + STAMP_DELAY],
      ['event-handover:e-kir', KIR + HANDOVER_AFTER],
      ['pin-end:z-cha', CHA],
      ['zone-midnight:z-cha', CHA],
      ['event-moment:e-cha', CHA],
      ['event-stamp:e-cha', CHA + STAMP_DELAY],
      ['event-handover:e-cha', CHA + HANDOVER_AFTER],
      ['poll-end:z-kir', KIR + H],
      ['poll-end:z-cha', CHA + H],
      ['celebration-end:s2026', CHA + CELEBRATION_TAIL],
      ['rating-close:s2026', CHA + RATING_CLOSE_AFTER],
    ]);
  });
  it('empty input gives []', () => {
    expect(seasonMoments({ seasonId: 's', zones: [], events: [] })).toEqual([]);
  });
  it('carries hidden, zone and country on event moments', () => {
    const m = seasonMoments({ ...catalog(), events: [{ eventId: 'e', zoneId: 'z-kir', countryIso: 'KI', momentMs: KIR, sortIndex: 0, hidden: true }] });
    const stamp = m.find((x) => x.kind === 'event-stamp');
    expect(stamp).toMatchObject({ eventId: 'e', zoneId: 'z-kir', countryIso: 'KI', hidden: true });
  });
  it('enumerates 5 000 moments in under 200 ms', () => {
    const zones = Array.from({ length: 50 }, (_, i) => ({ zoneId: `z${i}`, midnightMs: UTC + i * 15 * MIN }));
    const events = Array.from({ length: 1_225 }, (_, i) => ({
      eventId: `e${i}`,
      zoneId: `z${i % 50}`,
      countryIso: 'XX',
      momentMs: UTC + (i % 50) * 15 * MIN,
      sortIndex: i,
    }));
    const t0 = performance.now();
    const list = seasonMoments({ seasonId: 's', zones, events });
    expect(performance.now() - t0).toBeLessThan(200);
    expect(list.length).toBeGreaterThanOrEqual(5_000);
  });
});

describe('AC-20 tie order', () => {
  it('Kiribati handover = Chatham midnight: handover first, then midnight', () => {
    const list = seasonMoments(catalog());
    const idx = (k: string) => list.findIndex((m) => m.key === k);
    expect(list[idx('event-handover:e-kir')]!.at).toBe(CHA);
    expect(idx('event-handover:e-kir')).toBeLessThan(idx('pin-end:z-cha'));
    expect(idx('pin-end:z-cha')).toBeLessThan(idx('zone-midnight:z-cha'));
    expect(idx('zone-midnight:z-cha')).toBeLessThan(idx('event-moment:e-cha'));
  });
  it('Nepal handover 18:30 UTC = India midnight', () => {
    const list = seasonMoments({
      seasonId: 's',
      zones: [
        { zoneId: 'z-npl', midnightMs: NPL },
        { zoneId: 'z-ind', midnightMs: IND },
      ],
      events: [{ eventId: 'e-npl', zoneId: 'z-npl', countryIso: 'NP', momentMs: NPL, sortIndex: 1 }],
    });
    const at = list.filter((m) => m.at === IND).map((m) => m.key);
    expect(at.slice(0, 3)).toEqual(['event-handover:e-npl', 'pin-end:z-ind', 'zone-midnight:z-ind']);
  });
  it('three countries in one zone stamp by sortIndex, not by id', () => {
    const events = [
      { eventId: 'a', zoneId: 'z', countryIso: 'AA', momentMs: UTC, sortIndex: 3 },
      { eventId: 'b', zoneId: 'z', countryIso: 'BB', momentMs: UTC, sortIndex: 1 },
      { eventId: 'c', zoneId: 'z', countryIso: 'CC', momentMs: UTC, sortIndex: 2 },
    ];
    const stamps = seasonMoments({ seasonId: 's', zones: [{ zoneId: 'z', midnightMs: UTC }], events }).filter((m) => m.kind === 'event-stamp');
    expect(stamps.map((m) => m.eventId)).toEqual(['b', 'c', 'a']);
  });
});

describe('AC-21 keys', () => {
  it('a +-20 min correction of the same event keeps the key set', () => {
    const keys = (s: number) => seasonMoments(catalog(s)).map((m) => m.key).sort();
    expect(keys(20 * MIN)).toEqual(keys(0));
    expect(keys(-20 * MIN)).toEqual(keys(0));
  });
  it('zone moments do not follow the event correction (AC-24 rules half)', () => {
    const at = (s: number) => seasonMoments(catalog(s)).find((m) => m.key === 'zone-midnight:z-kir')!.at;
    expect(at(20 * MIN)).toBe(KIR);
  });
});

describe('AC-22 poll window', () => {
  it('constants are 1 h each side', () => {
    expect(POLL_WINDOW_BEFORE).toBe(3_600_000);
    expect(POLL_WINDOW_AFTER).toBe(3_600_000);
    expect(pollWindow(KIR)).toEqual({ from: KIR - 3_600_000, to: KIR + 3_600_000 });
  });
  it('poll-start / poll-end of three zones equal midnight -/+ 3 600 000', () => {
    const zones = [KIR, CHA, IND].map((midnightMs, i) => ({ zoneId: `z${i}`, midnightMs }));
    const list = seasonMoments({ seasonId: 's', zones, events: [] });
    for (const z of zones) {
      expect(list.find((m) => m.key === `poll-start:${z.zoneId}`)!.at).toBe(z.midnightMs - 3_600_000);
      expect(list.find((m) => m.key === `poll-end:${z.zoneId}`)!.at).toBe(z.midnightMs + 3_600_000);
    }
  });
});
