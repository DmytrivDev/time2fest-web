import { describe, expect, it } from 'vitest';
import { stampOf, type StampEventLike, type StampLookups } from '../src/passport';

const lookups: StampLookups = {
  cityName: (id) => ({ c1: 'Sydney', c2: 'Perth' })[id],
  illustrationOfUnit: (e) => (e.countryIso === 'AU' ? 'au' : undefined),
};
const base = { midnightUtc: '2026-12-31T13:00:00Z', countryIso: 'AU' };
const e1: StampEventLike = { ...base, id: 'e1', cityId: 'c1' };
const e2: StampEventLike = { ...base, id: 'e2', cityId: 'c2', midnightUtc: '2026-12-31T16:00:00Z' };

describe('stampOf (AC-31, AC-36)', () => {
  it('two events of one country give two distinct stamps', () => {
    const a = stampOf(e1, lookups, 'room');
    const b = stampOf(e2, lookups, 'room');
    expect(a.eventId).not.toBe(b.eventId);
    expect(a.cityName).toBe('Sydney');
    expect(b.cityName).toBe('Perth');
    expect(a.countryIso).toBe(b.countryIso);
  });
  it('grantedAt is midnight + 15 s; midnightMs wins when given', () => {
    expect(stampOf(e1, lookups, 'air').grantedAt).toBe(Date.parse('2026-12-31T13:00:15Z'));
    expect(stampOf({ ...e1, midnightMs: 1_000 }, lookups, 'air').grantedAt).toBe(16_000);
  });
  it('carries the presence source and the illustration', () => {
    expect(stampOf(e1, lookups, 'tv')).toEqual({
      eventId: 'e1',
      grantedAt: Date.parse('2026-12-31T13:00:15Z'),
      presenceSource: 'tv',
      illustrationId: 'au',
      cityName: 'Sydney',
      countryIso: 'AU',
    });
  });
  it('falls back to generic illustration and empty city name', () => {
    const s = stampOf({ ...e1, countryIso: 'ZZ', cityId: 'nope' }, lookups, 'country');
    expect(s.illustrationId).toBe('generic');
    expect(s.cityName).toBe('');
  });
});
