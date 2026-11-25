// Таблиця правила графіка (packages/rules) через обгортку сайту з крихітним Dataset (SPEC-11 AC-37, EC-13).
import { describe, expect, it } from 'vitest';
import * as site from '@/lib/schedule/countryZone';
import type { Dataset } from '@/lib/data/types';
import { scheduleCases, scheduleSpec, type ScheduleApi } from '../../../packages/rules/test/schedule.table';

// Приховані події сайт не знає (у Dataset їх немає) — випадки з hidden перевіряє лише тест правил.
const visible = scheduleSpec.events.filter((e) => !('hidden' in e && e.hidden));
const cities = Object.entries(scheduleSpec.zoneCountries).flatMap(([zoneId, isos]) =>
  isos.map((countryIso) => ({ id: `${zoneId}-${countryIso}`, zoneId, countryIso })),
);
const data = {
  events: visible.map((e) => ({ id: e.id, zoneId: e.zoneId, countryIso: e.countryIso })),
  cities,
} as unknown as Dataset;

const api: ScheduleApi = {
  ZONE_SLOT_LIMIT: site.ZONE_SLOT_LIMIT,
  countryZoneEvents: (e) => site.countryZoneEvents(e, data),
  zoneSlotCount: (z) => site.zoneSlotCount(z, data),
  scheduledCountries: (s, z) => site.scheduledCountries(s, z, data),
  scheduleToggleResult: (s, e) => site.scheduleToggleResult(s, e, data),
  toggleCountryZone: (s, e) => site.toggleCountryZone(s, e, data),
  replaceCountryZone: (s, o, e) => site.replaceCountryZone(s, o, e, data),
  mergeSchedules: (a, g) => site.mergeSchedules(a, g, data),
  validateScheduleIds: (i) => site.validateScheduleIds(i, data),
};

describe('правило графіка через обгортку сайту', () => {
  for (const c of scheduleCases) {
    // «прихована подія» у Dataset сайту просто невідома → теж false, тож таблиця діє без винятків.
    it(c.name, () => expect(c.run(api)).toEqual(c.expected));
  }
});
