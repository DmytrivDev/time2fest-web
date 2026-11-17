/**
 * Мапа поясів «до свята»: та сама модель (`buildMapModel`), але без трансляцій і подій — до свята їх ще немає, тож
 * підказки, вікна й точки міст показують лише час півночі. Країни без опису — без традицій (`described: false`).
 */
import type { MapCountry, MapModel } from '@/lib/map/model';

export function prefestMapModel(base: MapModel, isDescribed: (iso: string) => boolean): MapModel {
  return {
    zones: base.zones.map((z) => ({
      ...z,
      streams: [],
      streamCount: 0,
      countries: z.countries.map((c): MapCountry => {
        const described = isDescribed(c.iso);
        const rest: MapCountry = { ...c, streams: [], eventIds: [], described, traditions: described ? (c.traditions ?? []) : [] };
        // Головне місто з трансляцією й «тиха зустріч» — про ефір; до свята їх не показуємо.
        delete rest.mainCity;
        delete rest.quiet;
        return rest;
      }),
    })),
    cities: base.cities.map((c) => ({ ...c, stream: 'none' as const })),
  };
}
