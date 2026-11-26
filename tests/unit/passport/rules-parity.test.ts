// SPEC-14 AC-36, AC-42: the shared rules (`@time2fest/rules/passport`) give the same result as the site code —
// achievements/streaks as the notifications generator, the stamp as `buildStamp`.
import { describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import type { Stamp } from '@/lib/data/types';
import { buildStamp } from '@/lib/engine/stamp';
import { goalOutcomes } from '@/lib/api/sim/NotificationsGenerator';
import { achievementsOf, stampOf, type StampLookups } from '@time2fest/rules/passport';

const data = getData();
const SEASON = data.meta.season;
const zoneOrder = (zoneId: string) => data.zonesById.get(zoneId)?.order ?? Number.NaN;

const stampFor = (eventId: string): Stamp => {
  const e = data.eventsById.get(eventId)!;
  return { eventId, grantedAt: e.midnightMs + 15_000, presenceSource: 'country', illustrationId: 'x', cityName: '', countryIso: e.countryIso };
};

/** Site goal outcomes mapped to the shared key format. */
function siteKeys(stamps: readonly Stamp[]): string[] {
  return goalOutcomes(stamps)
    .map((o) => {
      const [kind, ...rest] = o.id.split(':');
      return [kind, SEASON, ...rest].join(':');
    })
    .sort();
}
function ruleKeys(stamps: readonly Stamp[]): string[] {
  const rows = stamps.map((s) => ({ eventId: s.eventId, countryIso: s.countryIso, zoneId: data.eventsById.get(s.eventId)?.zoneId ?? '' }));
  return achievementsOf(rows, zoneOrder, SEASON);
}

/** Deterministic PRNG so the random subsets are reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('AC-42 achievementsOf equals the notifications generator', () => {
  const events = data.events;
  it('shared fixtures: 3 countries / 5 adjacent zones / all events', () => {
    const byZone = [...data.zones].sort((a, b) => a.order - b.order);
    const fixtures: string[][] = [
      [],
      events.slice(0, 1).map((e) => e.id),
      events.slice(0, 3).map((e) => e.id),
      byZone.slice(-5).map((z) => events.find((e) => e.zoneId === z.id)?.id).filter((x): x is string => !!x),
      byZone.slice(0, 5).map((z) => events.find((e) => e.zoneId === z.id)?.id).filter((x): x is string => !!x),
      events.map((e) => e.id),
    ];
    for (const ids of fixtures) {
      const stamps = ids.map(stampFor);
      expect(ruleKeys(stamps)).toEqual(siteKeys(stamps));
    }
  });
  it('random subsets of dataset events', () => {
    const rand = rng(14);
    for (let i = 0; i < 200; i += 1) {
      const n = Math.floor(rand() * 14);
      const picked = new Set<string>();
      for (let k = 0; k < n; k += 1) picked.add(events[Math.floor(rand() * events.length)]!.id);
      const stamps = [...picked].map(stampFor);
      expect(ruleKeys(stamps)).toEqual(siteKeys(stamps));
    }
  });
});

describe('AC-36 stampOf equals buildStamp for every dataset event', () => {
  const lookups: StampLookups = {
    cityName: (cityId) => data.citiesById.get(cityId)?.name.uk,
    illustrationOfUnit: (e) => data.countriesByIso.get(e.countryIso)?.illustrationId,
  };
  it('every event', () => {
    for (const e of data.events) {
      const expected = buildStamp({ event: e, country: data.countriesByIso.get(e.countryIso), city: data.citiesById.get(e.cityId), presenceSource: 'room' });
      expect(stampOf(e, lookups, 'room')).toEqual(expected);
    }
  });
});
