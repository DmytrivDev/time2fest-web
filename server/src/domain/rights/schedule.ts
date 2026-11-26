/**
 * SPEC-11 W23 — server wrapper over the shared schedule rule (`@time2fest/rules/schedule`, AC-37). Pure.
 * `scheduleCatalogFrom(stored)` turns the stored catalog into the rule's catalog: events (hidden ones flagged) and the
 * countries of a zone (from the cities of the zone). Memoized per stored object; the service caches the read itself.
 */
import {
  countryZoneEvents,
  mergeSchedules,
  replaceCountryZone,
  scheduleToggleResult,
  toggleCountryZone,
  validateScheduleIds,
  ZONE_SLOT_LIMIT,
  type ScheduleCatalog,
  type ScheduleEvent,
} from '@time2fest/rules/schedule';

export type { ScheduleCatalog, ScheduleEvent, ScheduleToggle } from '@time2fest/rules/schedule';
export {
  countryZoneEvents,
  mergeSchedules,
  replaceCountryZone,
  scheduleToggleResult,
  toggleCountryZone,
  validateScheduleIds,
  ZONE_SLOT_LIMIT,
};

/** The most ids a schedule may hold (the body limit, NFR-4). */
export const SCHEDULE_MAX_IDS = 512;

/** The part of the stored catalog the rule reads (structural: ring 1 imports nothing outward, A4). */
export interface ScheduleCatalogSource {
  readonly events: readonly Record<string, unknown>[];
  readonly cities: readonly Record<string, unknown>[];
}

const memo = new WeakMap<ScheduleCatalogSource, ScheduleCatalog>();

export function scheduleCatalogFrom(stored: ScheduleCatalogSource): ScheduleCatalog {
  const hit = memo.get(stored);
  if (hit !== undefined) return hit;
  const events: ScheduleEvent[] = [];
  for (const e of stored.events) {
    if (typeof e.eventId !== 'string' || typeof e.zoneId !== 'string' || typeof e.countryIso !== 'string') continue;
    events.push({ eventId: e.eventId, zoneId: e.zoneId, countryIso: e.countryIso, ...(e.hidden === true ? { hidden: true } : {}) });
  }
  const zones = new Map<string, Set<string>>();
  for (const c of stored.cities) {
    if (typeof c.zoneId !== 'string' || typeof c.countryIso !== 'string') continue;
    let s = zones.get(c.zoneId);
    if (s === undefined) zones.set(c.zoneId, (s = new Set()));
    s.add(c.countryIso);
  }
  const built: ScheduleCatalog = { events, zoneCountryIsos: (zoneId) => [...(zones.get(zoneId) ?? [])] };
  memo.set(stored, built);
  return built;
}
