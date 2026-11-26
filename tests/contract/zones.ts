import { getData } from '@/lib/data/load';
import type { FullZone } from './profile.suite';

/** Five events of five distinct countries in one zone (the bundled data set; the server's seed is the same set). */
export function fullZoneOfData(): FullZone {
  const data = getData();
  const byZone = new Map<string, Map<string, string>>();
  for (const e of data.events) {
    const zone = byZone.get(e.zoneId) ?? new Map<string, string>();
    if (!zone.has(e.countryIso)) zone.set(e.countryIso, e.id);
    byZone.set(e.zoneId, zone);
  }
  for (const zone of byZone.values()) {
    if (zone.size >= 5) {
      const pairs = [...zone].slice(0, 5);
      return { eventIds: pairs.map(([, id]) => id), isos: pairs.map(([iso]) => iso) };
    }
  }
  throw new Error('no zone with five countries in the data set');
}
