import { describe, expect, it } from 'vitest';
import * as rule from '../src/schedule';
import { scheduleCases, scheduleSpec, type ScheduleApi } from './schedule.table';

const cat: rule.ScheduleCatalog = {
  events: scheduleSpec.events.map((e) => ({ eventId: e.id, zoneId: e.zoneId, countryIso: e.countryIso, hidden: 'hidden' in e ? e.hidden : undefined })),
  zoneCountryIsos: (z) => scheduleSpec.zoneCountries[z] ?? [],
};

const api: ScheduleApi = {
  ZONE_SLOT_LIMIT: rule.ZONE_SLOT_LIMIT,
  countryZoneEvents: (e) => rule.countryZoneEvents(e, cat),
  zoneSlotCount: (z) => rule.zoneSlotCount(z, cat),
  scheduledCountries: (s, z) => rule.scheduledCountries(s, z, cat),
  scheduleToggleResult: (s, e) => rule.scheduleToggleResult(s, e, cat),
  toggleCountryZone: (s, e) => rule.toggleCountryZone(s, e, cat),
  replaceCountryZone: (s, o, e) => rule.replaceCountryZone(s, o, e, cat),
  mergeSchedules: (a, g) => rule.mergeSchedules(a, g, cat),
  validateScheduleIds: (i) => rule.validateScheduleIds(i, cat),
};

describe('правило графіка (таблиця)', () => {
  for (const c of scheduleCases) it(c.name, () => expect(c.run(api)).toEqual(c.expected));
});
