/** Пояси країни для вибору «Мій пояс» у налаштуваннях кабінету (без React; `autoHomeIso` читає стан гостя). */

import { getData } from '@/lib/data/load';
import { detectFlag } from '@/lib/geo/detectFlag';
import { utcLabel } from '@/lib/i18n/time';
import { useGuestStore } from '@/stores/guest';

/** Країна «Визначати автоматично»: прапор, визначений для гостя, інакше за мовою браузера, інакше Україна. */
export function autoHomeIso(): string {
  return (useGuestStore.getState().detectedFlag ?? detectFlag() ?? 'UA').toUpperCase();
}

/** Пояси країни з назвою за головним містом поясу (без бази всіх міст, власник 2026-11-08). */
export function countryZones(iso: string) {
  const data = getData();
  const c = data.countriesByIso.get(iso);
  if (!c) return [];
  return c.zoneIds
    .map((id) => data.zonesById.get(id))
    .filter((z): z is NonNullable<typeof z> => !!z)
    .sort((a, b) => b.offsetMinutes - a.offsetMinutes)
    .map((z) => {
      const inZone = data.cities.filter((x) => x.countryIso === iso && x.zoneId === z.id);
      const city = inZone.find((x) => x.isCountryMain) ?? inZone[0] ?? data.citiesById.get(z.representativeCityId);
      return { id: z.id, label: utcLabel(z.offsetMinutes), city: city?.name.uk ?? '' };
    });
}
