// SPEC-11 W23 — the shared schedule table (AC-37) through the server wrapper.
import { describe, expect, it } from 'vitest';
import type { StoredCatalog } from '../../src/catalog/ports';
import * as S from '../../src/domain/rights/schedule';
import { scheduleCases, scheduleSpec, type ScheduleApi } from '../../../packages/rules/test/schedule.table';

const stored: StoredCatalog = {
  season: null,
  zones: [],
  countries: [],
  // One city per (zone, country) is enough for the zone's country list.
  cities: Object.entries(scheduleSpec.zoneCountries).flatMap(([zoneId, isos]) => isos.map((iso) => ({ cityId: `${zoneId}-${iso}`, zoneId, countryIso: iso }))),
  events: scheduleSpec.events.map((e) => ({ eventId: e.id, zoneId: e.zoneId, countryIso: e.countryIso, ...(e.hidden ? { hidden: true } : {}) })),
  traditions: [],
};
const cat = S.scheduleCatalogFrom(stored);
const api: ScheduleApi = {
  ZONE_SLOT_LIMIT: S.ZONE_SLOT_LIMIT,
  countryZoneEvents: (id) => S.countryZoneEvents(id, cat),
  zoneSlotCount: (z) => Math.min(S.ZONE_SLOT_LIMIT, new Set(cat.zoneCountryIsos(z)).size),
  scheduledCountries: (s, z) => {
    const out: string[] = [];
    for (const id of s) {
      const e = cat.events.find((x) => x.eventId === id);
      if (e && e.zoneId === z && !out.includes(e.countryIso)) out.push(e.countryIso);
    }
    return out;
  },
  scheduleToggleResult: (s, id) => S.scheduleToggleResult(s, id, cat),
  toggleCountryZone: (s, id) => S.toggleCountryZone(s, id, cat),
  replaceCountryZone: (s, out, id) => S.replaceCountryZone(s, out, id, cat),
  mergeSchedules: (a, g) => S.mergeSchedules(a, g, cat),
  validateScheduleIds: (ids) => S.validateScheduleIds(ids, cat),
};

describe('schedule rule through the server wrapper (AC-37)', () => {
  for (const c of scheduleCases) it(c.name, () => expect(c.run(api)).toEqual(c.expected));
  it('memoizes the catalog per stored object', () => expect(S.scheduleCatalogFrom(stored)).toBe(cat));
});
